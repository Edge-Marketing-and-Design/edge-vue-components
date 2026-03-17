const {
  onCall,
  HttpsError,
  logger,
  db,
  admin,
  onSchedule,
  onDocumentWritten,
  permissionCheck,
} = require('./config.js')
const historyConfig = require('./history.config.json')

const DEFAULTS = Object.freeze({
  historyCollection: 'history',
  retainDays: 90,
  listLimit: 50,
  maxListLimit: 200,
  restoreTarget: 'beforeData',
  storeBeforeData: true,
  storeAfterData: true,
  cleanupBatchSize: 200,
  cleanupMaxDeletesPerRun: 1000,
})

const assertCallableUser = (request) => {
  if (!request?.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
}

const normalizeConfig = () => {
  const defaults = historyConfig?.defaults || {}
  const cleanup = historyConfig?.cleanup || {}

  return {
    enabled: historyConfig?.enabled !== false,
    historyCollection: String(historyConfig?.historyCollection || DEFAULTS.historyCollection).trim() || DEFAULTS.historyCollection,
    defaults: {
      retainDays: normalizePositiveInt(defaults.retainDays, DEFAULTS.retainDays),
      listLimit: normalizePositiveInt(defaults.listLimit, DEFAULTS.listLimit),
      maxListLimit: normalizePositiveInt(defaults.maxListLimit, DEFAULTS.maxListLimit),
      restoreTarget: normalizeRestoreTarget(defaults.restoreTarget || DEFAULTS.restoreTarget),
      storeBeforeData: defaults.storeBeforeData !== false,
      storeAfterData: defaults.storeAfterData !== false,
    },
    cleanup: {
      enabled: cleanup.enabled !== false,
      batchSize: normalizePositiveInt(cleanup.batchSize, DEFAULTS.cleanupBatchSize),
      maxDeletesPerRun: normalizePositiveInt(cleanup.maxDeletesPerRun, DEFAULTS.cleanupMaxDeletesPerRun),
    },
    rules: Array.isArray(historyConfig?.rules) ? historyConfig.rules.filter(isHistoryRule) : [],
  }
}

const getConfig = () => normalizeConfig()

const isHistoryRule = (rule) => {
  return typeof rule?.match === 'string' && rule.match.trim() !== ''
}

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0)
    return fallback
  return Math.trunc(parsed)
}

const normalizeRestoreTarget = (value) => {
  return value === 'afterData' ? 'afterData' : 'beforeData'
}

const getEventPath = (event) => {
  const explicitPath = String(event?.data?.after?.ref?.path || event?.data?.before?.ref?.path || '').trim()
  if (explicitPath)
    return explicitPath

  const orgId = String(event?.params?.orgId || '').trim()
  const documentPath = String(event?.params?.documentPath || '').trim()
  if (!orgId || !documentPath)
    return ''
  return `organizations/${orgId}/${documentPath}`
}

const getRelativePath = (path, orgId = '') => {
  const normalizedOrgId = String(orgId || '').trim()
  const expectedPrefix = normalizedOrgId
    ? `organizations/${normalizedOrgId}/`
    : 'organizations/'

  if (path.startsWith(expectedPrefix))
    return path.slice(expectedPrefix.length)

  const segments = String(path || '').split('/').filter(Boolean)
  if (segments[0] !== 'organizations' || segments.length < 3)
    return ''

  return segments.slice(2).join('/')
}

const getActionFromChange = (beforeExists, afterExists) => {
  if (!beforeExists && afterExists)
    return 'create'
  if (beforeExists && !afterExists)
    return 'delete'
  return 'update'
}

const matchRule = (relativePath, rules = []) => {
  for (const rule of rules) {
    if (pathMatchesPattern(relativePath, rule.match))
      return rule
  }
  return null
}

const pathMatchesPattern = (path, pattern) => {
  const pathSegments = String(path || '').split('/').filter(Boolean)
  const patternSegments = String(pattern || '').split('/').filter(Boolean)

  if (pathSegments.length !== patternSegments.length)
    return false

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i]
    if (patternSegment === '*')
      continue
    if (patternSegment !== pathSegments[i])
      return false
  }

  return true
}

const buildExpireAt = (retainDays) => {
  const safeRetainDays = normalizePositiveInt(retainDays, DEFAULTS.retainDays)
  const nowMs = Date.now()
  const expireMs = nowMs + (safeRetainDays * 24 * 60 * 60 * 1000)
  return admin.firestore.Timestamp.fromMillis(expireMs)
}

const serializeForResponse = (value) => {
  if (value === null || value === undefined)
    return value

  if (value instanceof admin.firestore.Timestamp) {
    return {
      millis: value.toMillis(),
      iso: value.toDate().toISOString(),
    }
  }

  if (Array.isArray(value))
    return value.map(serializeForResponse)

  if (typeof value === 'object') {
    const output = {}
    for (const [key, child] of Object.entries(value))
      output[key] = serializeForResponse(child)
    return output
  }

  return value
}

const buildHistoryEntry = ({
  orgId,
  path,
  relativePath,
  action,
  rule,
  beforeData,
  afterData,
}) => {
  const config = getConfig()
  const retainDays = normalizePositiveInt(rule?.retainDays, config.defaults.retainDays)
  const storeBeforeData = rule?.storeBeforeData !== undefined
    ? rule.storeBeforeData !== false
    : config.defaults.storeBeforeData
  const storeAfterData = rule?.storeAfterData !== undefined
    ? rule.storeAfterData !== false
    : config.defaults.storeAfterData

  const segments = String(path || '').split('/').filter(Boolean)
  const docId = segments.at(-1) || ''

  return {
    orgId,
    path,
    relativePath,
    docId,
    entityType: String(rule?.label || '').trim() || null,
    ruleMatch: String(rule?.match || '').trim(),
    action,
    beforeData: storeBeforeData ? beforeData : null,
    afterData: storeAfterData ? afterData : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expireAt: buildExpireAt(retainDays),
  }
}

exports.trackHistory = onDocumentWritten(
  { document: 'organizations/{orgId}/{documentPath=**}', timeoutSeconds: 180 },
  async (event) => {
    const config = getConfig()
    if (!config.enabled || config.rules.length === 0)
      return

    const orgId = String(event?.params?.orgId || '').trim()
    const path = getEventPath(event)
    if (!orgId || !path)
      return

    const relativePath = getRelativePath(path, orgId)
    if (!relativePath)
      return

    const rule = matchRule(relativePath, config.rules)
    if (!rule)
      return

    const beforeExists = !!event?.data?.before?.exists
    const afterExists = !!event?.data?.after?.exists
    const beforeData = beforeExists ? (event.data.before.data() || null) : null
    const afterData = afterExists ? (event.data.after.data() || null) : null
    const action = getActionFromChange(beforeExists, afterExists)

    const historyEntry = buildHistoryEntry({
      orgId,
      path,
      relativePath,
      action,
      rule,
      beforeData,
      afterData,
    })

    await db.collection(config.historyCollection).add(historyEntry)
    logger.log(`History recorded for ${path}`)
  },
)

exports.listHistory = onCall(async (request) => {
  assertCallableUser(request)
  const config = getConfig()
  const data = request.data || {}
  const authUid = request.auth.uid
  const limit = Math.min(
    normalizePositiveInt(data.limit, config.defaults.listLimit),
    config.defaults.maxListLimit,
  )
  const cursorCreatedAtMs = data.cursorCreatedAtMs ? Number(data.cursorCreatedAtMs) : null
  const path = String(data.path || '').trim()
  const orgId = String(data.orgId || '').trim() || extractOrgIdFromPath(path)

  if (!orgId)
    throw new HttpsError('invalid-argument', 'Missing orgId or path')

  let query = db.collection(config.historyCollection)

  if (path) {
    const allowed = await permissionCheck(authUid, 'write', path)
    if (!allowed)
      throw new HttpsError('permission-denied', 'Not allowed to read history for this path')
    query = query.where('path', '==', path)
  }
  else {
    const allowed = await permissionCheck(authUid, 'write', `organizations/${orgId}`)
    if (!allowed)
      throw new HttpsError('permission-denied', 'Not allowed to read org history')
    query = query.where('orgId', '==', orgId)
  }

  if (cursorCreatedAtMs && Number.isFinite(cursorCreatedAtMs))
    query = query.where('createdAt', '<', admin.firestore.Timestamp.fromMillis(cursorCreatedAtMs))

  const snapshot = await query
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  const lastDoc = snapshot.docs.at(-1) || null
  const lastCreatedAt = lastDoc?.get('createdAt')

  return {
    items: snapshot.docs.map((doc) => {
      return {
        historyId: doc.id,
        ...serializeForResponse(doc.data() || {}),
      }
    }),
    nextCursorCreatedAtMs: lastCreatedAt instanceof admin.firestore.Timestamp
      ? lastCreatedAt.toMillis()
      : null,
  }
})

exports.restoreHistory = onCall(async (request) => {
  assertCallableUser(request)
  const config = getConfig()
  const data = request.data || {}
  const historyId = String(data.historyId || '').trim()
  const targetState = normalizeRestoreTarget(data.targetState || config.defaults.restoreTarget)

  if (!historyId)
    throw new HttpsError('invalid-argument', 'Missing historyId')

  const historyRef = db.collection(config.historyCollection).doc(historyId)
  const historySnap = await historyRef.get()
  if (!historySnap.exists)
    throw new HttpsError('not-found', 'History entry not found')

  const historyData = historySnap.data() || {}
  const targetPath = String(historyData.path || '').trim()
  if (!targetPath)
    throw new HttpsError('failed-precondition', 'History entry is missing path')

  const allowed = await permissionCheck(request.auth.uid, 'write', targetPath)
  if (!allowed)
    throw new HttpsError('permission-denied', 'Not allowed to restore this path')

  const restoreData = historyData[targetState]
  const targetRef = db.doc(targetPath)

  if (restoreData === null || restoreData === undefined) {
    await targetRef.delete()
    return {
      restored: true,
      targetState,
      action: 'delete',
      path: targetPath,
    }
  }

  await targetRef.set(restoreData, { merge: false })
  return {
    restored: true,
    targetState,
    action: 'write',
    path: targetPath,
  }
})

exports.cleanupHistory = onSchedule(
  { schedule: 'every 24 hours', timeoutSeconds: 540 },
  async () => {
    const config = getConfig()
    if (!config.enabled || !config.cleanup.enabled)
      return

    const collectionRef = db.collection(config.historyCollection)
    const now = admin.firestore.Timestamp.now()
    let deleted = 0

    while (deleted < config.cleanup.maxDeletesPerRun) {
      const remaining = config.cleanup.maxDeletesPerRun - deleted
      const batchSize = Math.min(config.cleanup.batchSize, remaining)
      const snapshot = await collectionRef
        .where('expireAt', '<=', now)
        .orderBy('expireAt', 'asc')
        .limit(batchSize)
        .get()

      if (snapshot.empty)
        break

      const batch = db.batch()
      for (const doc of snapshot.docs)
        batch.delete(doc.ref)

      await batch.commit()
      deleted += snapshot.docs.length

      if (snapshot.docs.length < batchSize)
        break
    }

    logger.log(`History cleanup deleted ${deleted} expired entries`)
  },
)

function extractOrgIdFromPath(path) {
  const segments = String(path || '').split('/').filter(Boolean)
  if (segments[0] !== 'organizations' || segments.length < 2)
    return ''
  return segments[1] || ''
}
