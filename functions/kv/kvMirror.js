// kvMirror.js
// Generic Firestore→Cloudflare KV mirroring helper.
// - Writes a canonical KV key per Firestore doc (value = serialized data).
// - Optionally writes index keys that carry JSON in **metadata** (value = '1').
// - Index-key metadata always includes { canonical: <canonicalKey> }.
// - Keeps a small manifest per canonical key to clean up all index keys on delete.
// - Publishes a sharded collection-generation vector after complete logical mirrors.

const { onDocumentWritten, db, Firestore, logger } = require('../config.js')
const kv = require('./kvClient')
const { runKvMirrorFollowup } = require('./kvMirrorFollowups')
const {
  collectionScopeFromCanonicalKey,
  collectionVersionShard,
  createCollectionVersionOperation,
  isSourceStateCurrent,
  materializeCollectionVersionOperation,
  sourceStateFromEvent,
} = require('./kvMirrorProtocol')

function json(x) {
  return JSON.stringify(x)
}

const KV_RETRY_TOPIC = process.env.KV_RETRY_TOPIC || 'kv-mirror-retry'
const INDEX_WRITE_CONCURRENCY = Number(process.env.KV_MIRROR_INDEX_CONCURRENCY || 20)
const KV_MIRROR_DISABLED = ['1', 'true', 'yes'].includes(String(process.env.KV_MIRROR_DISABLED || '').trim().toLowerCase())

function toSortedUniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map(String))]
    .sort()
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function areSameStrings(a = [], b = []) {
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i])
      return false
  }
  return true
}

function normalizeConcurrency(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1)
    return 1
  return Math.floor(n)
}

async function runWithConcurrency(items, limit, worker) {
  const values = Array.isArray(items) ? items : []
  if (!values.length)
    return
  const max = normalizeConcurrency(limit)
  let cursor = 0
  const workers = Array.from({ length: Math.min(max, values.length) }, async () => {
    for (;;) {
      const idx = cursor
      cursor += 1
      if (idx >= values.length)
        return
      await worker(values[idx], idx)
    }
  })
  await Promise.all(workers)
}

async function enqueueKvRetry(payload, minuteDelay = 1) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {}
  await db.collection('topic-queue').add({
    topic: KV_RETRY_TOPIC,
    payload: {
      ...safePayload,
      attempt: Number(safePayload.attempt || 0),
    },
    minuteDelay: Number(minuteDelay || 0),
    retry: 0,
    timestamp: Firestore.FieldValue.serverTimestamp(),
  })
}

async function safeKvOperation({
  run,
  payload,
  label,
  queueOnFailure = true,
}) {
  try {
    await run()
    return true
  }
  catch (err) {
    const message = String(err?.message || err || 'KV operation failed')
    logger.warn(queueOnFailure
      ? 'KV operation failed; queued for retry'
      : 'KV operation failed; deferred to mirror finalization retry', {
      label,
      error: message.slice(0, 500),
      key: payload?.key,
      op: payload?.op,
    })
    if (queueOnFailure) {
      try {
        await enqueueKvRetry(payload)
      }
      catch (queueErr) {
        logger.error('Failed to enqueue KV retry', {
          label,
          key: payload?.key,
          op: payload?.op,
          error: String(queueErr?.message || queueErr || 'enqueue failed').slice(0, 500),
        })
      }
    }
    return false
  }
}

function slugIndexValue(value, maxLength = 80) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
}

function setDiff(oldArr = [], newArr = []) {
  const A = new Set(oldArr)
  const B = new Set(newArr)
  const toRemove = [...A].filter(x => !B.has(x))
  const toAdd = [...B].filter(x => !A.has(x))
  return { toRemove, toAdd }
}

function createRedactionNode() {
  return {
    redact: false,
    children: Object.create(null),
  }
}

function buildRedactionTree(redactedFields) {
  const root = createRedactionNode()
  let pathCount = 0

  for (const fieldPath of Array.isArray(redactedFields) ? redactedFields : []) {
    if (typeof fieldPath !== 'string')
      continue
    const segments = fieldPath
      .split('.')
      .map(segment => segment.trim())
      .filter(Boolean)
    if (!segments.length)
      continue

    let node = root
    for (const segment of segments) {
      if (!node.children[segment])
        node.children[segment] = createRedactionNode()
      node = node.children[segment]
    }
    if (!node.redact) {
      node.redact = true
      pathCount += 1
    }
  }

  return pathCount ? root : null
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]')
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype?.constructor?.name === 'Object'
}

function redactValue(value, node, keepEmptyObject = false) {
  if (node?.redact) {
    return {
      omitted: true,
      redacted: true,
    }
  }

  if (Array.isArray(value)) {
    let redacted = false
    const output = value.map((item) => {
      const result = redactValue(item, node, true)
      redacted = redacted || result.redacted
      return result.omitted ? null : result.value
    })
    return {
      omitted: false,
      redacted,
      value: output,
    }
  }

  if (!isPlainObject(value)) {
    return {
      omitted: false,
      redacted: false,
      value,
    }
  }

  let redacted = false
  const output = {}
  for (const [key, childValue] of Object.entries(value)) {
    const result = redactValue(childValue, node?.children?.[key], false)
    redacted = redacted || result.redacted
    if (!result.omitted)
      output[key] = result.value
  }

  if (redacted && !keepEmptyObject && Object.keys(value).length && !Object.keys(output).length) {
    return {
      omitted: true,
      redacted: true,
    }
  }

  return {
    omitted: false,
    redacted,
    value: output,
  }
}

function redactConfiguredFields(value, redactionTree) {
  if (!redactionTree || value === null || value === undefined)
    return value
  const result = redactValue(value, redactionTree, true)
  if (!result.omitted)
    return result.value
  return Array.isArray(value) ? [] : {}
}

function createObjectView(source, overrides) {
  if (!source || typeof source !== 'object')
    return source
  return Object.assign(Object.create(Object.getPrototypeOf(source)), source, overrides)
}

function getRedactedField(data, fieldPath) {
  if (typeof fieldPath !== 'string')
    return undefined
  return fieldPath
    .split('.')
    .filter(Boolean)
    .reduce((value, segment) => value?.[segment], data)
}

function createRedactedEventView(event, redactionTree) {
  if (!redactionTree || !event?.data)
    return event

  const createSnapshotView = (snapshot) => {
    if (!snapshot?.exists || typeof snapshot.data !== 'function')
      return snapshot
    const redactedData = redactConfiguredFields(snapshot.data(), redactionTree)
    return createObjectView(snapshot, {
      data: () => redactedData,
      get: fieldPath => getRedactedField(redactedData, fieldPath),
    })
  }

  const eventData = createObjectView(event.data, {
    before: createSnapshotView(event.data.before),
    after: createSnapshotView(event.data.after),
  })
  return createObjectView(event, { data: eventData })
}

async function runKvPayload(operation) {
  if (operation?.op === 'putCollectionVersion') {
    const materialized = materializeCollectionVersionOperation(operation)
    return kv.put(materialized.key, materialized.value, materialized.opts)
  }
  if (operation?.op === 'put')
    return kv.put(operation.key, operation.value, operation.opts)
  if (operation?.op === 'putIndexMeta')
    return kv.putIndexMeta(operation.key, operation.metadata, operation.opts)
  if (operation?.op === 'del')
    return kv.del(operation.key)
  throw new Error(`Unsupported KV mirror operation: ${operation?.op || ''}`)
}

async function runMirrorPhase(operations) {
  let succeeded = true
  await runWithConcurrency(operations, INDEX_WRITE_CONCURRENCY, async (operation) => {
    const operationSucceeded = await safeKvOperation({
      run: () => runKvPayload(operation),
      payload: operation,
      label: `${operation.op}:${operation.key}`,
      queueOnFailure: false,
    })
    if (!operationSucceeded)
      succeeded = false
  })
  return succeeded
}

/**
 * createKvMirrorHandler({
 *   document: 'organizations/{orgId}/sites/{siteId}/published_posts/{postId}',
 *   makeCanonicalKey: (params, data) => `post:${params.orgId}:${params.siteId}:${params.postId}`,
 *   makeIndexKeys: (params, data) => [...],                  // optional
 *   makeMetadata: (data, params) => ({ title: data.title }), // optional, merged with { canonical }
 *   serialize: (data) => JSON.stringify(data),               // optional
 *   redactedFields: ['privateNotes', 'meta.internalEmail'],   // optional dot paths; traverses arrays
 *   makeAfterMirrorOperation: ({ event, params, data, canonicalKey }) => null, // optional
 *   timeoutSeconds: 180                                      // optional
 * })
 */
function createKvMirrorHandler({
  document,
  makeCanonicalKey,
  makeIndexKeys,
  makeMetadata,
  serialize = json,
  redactedFields = [],
  makeAfterMirrorOperation,
  timeoutSeconds = 180,
}) {
  const redactionTree = buildRedactionTree(redactedFields)

  return onDocumentWritten({ document, timeoutSeconds }, async (event) => {
    if (KV_MIRROR_DISABLED) {
      logger.log('KV mirror disabled by environment', { document })
      return
    }
    const after = event.data?.after
    const params = event.params || {}
    const sourceData = after?.exists ? after.data() : null
    const data = redactConfiguredFields(sourceData, redactionTree)
    const canonicalKey = makeCanonicalKey(params, sourceData)
    if (!canonicalKey) {
      logger.warn('KV mirror skipped due to missing canonical key', { document })
      return
    }

    const indexingEnabled = typeof makeIndexKeys === 'function'
    const manifestKey = indexingEnabled ? `idx:manifest:${canonicalKey}` : null
    const phases = []

    if (!after?.exists) {
      let keys = [canonicalKey]
      if (indexingEnabled) {
        let previousManifest = null
        try {
          previousManifest = await kv.get(manifestKey, 'json')
        }
        catch (_) {
          previousManifest = null
        }
        keys = [
          ...(Array.isArray(previousManifest?.indexKeys) ? previousManifest.indexKeys : []),
          canonicalKey,
          manifestKey,
        ]
      }
      phases.push(toSortedUniqueStrings(keys).map(key => ({ op: 'del', key, source: 'kvMirror' })))
    }
    else {
      const baseMeta = { canonical: canonicalKey }
      const customMetaCandidate = typeof makeMetadata === 'function' ? (makeMetadata(data, params) || null) : null
      const redactedMetaCandidate = redactConfiguredFields(customMetaCandidate, redactionTree)
      const metaValue = (redactedMetaCandidate && typeof redactedMetaCandidate === 'object')
        ? { ...redactedMetaCandidate, canonical: canonicalKey }
        : baseMeta
      const serializedData = serialize(data)
      phases.push([{
        op: 'put',
        key: canonicalKey,
        value: serializedData,
        opts: { metadata: metaValue },
        source: 'kvMirror',
      }])

      if (indexingEnabled) {
        const resolvedIndexKeys = await Promise.resolve(makeIndexKeys(params, data))
        const nextIndexKeys = toSortedUniqueStrings(resolvedIndexKeys || [])
        let previousManifest = null
        try {
          previousManifest = await kv.get(manifestKey, 'json')
        }
        catch (_) {
          previousManifest = null
        }

        const oldIndexKeys = toSortedUniqueStrings(Array.isArray(previousManifest?.indexKeys) ? previousManifest.indexKeys : [])
        const previousMetaHash = typeof previousManifest?.metadataHash === 'string' ? previousManifest.metadataHash : ''
        const currentMetaHash = stableStringify(metaValue)
        const { toRemove, toAdd } = setDiff(oldIndexKeys, nextIndexKeys)
        const keysToUpsert = previousMetaHash !== currentMetaHash ? nextIndexKeys : toAdd
        phases.push([
          ...keysToUpsert.map(key => ({
            op: 'putIndexMeta',
            key,
            metadata: metaValue,
            source: 'kvMirror',
          })),
          ...toRemove.map(key => ({ op: 'del', key, source: 'kvMirror' })),
        ])

        const manifestUnchanged = areSameStrings(oldIndexKeys, nextIndexKeys)
          && previousMetaHash === currentMetaHash
        if (!manifestUnchanged) {
          phases.push([{
            op: 'put',
            key: manifestKey,
            value: { indexKeys: nextIndexKeys, metadataHash: currentMetaHash },
            source: 'kvMirror',
          }])
        }
      }
    }

    const followupEvent = createRedactedEventView(event, redactionTree)
    const afterOperation = typeof makeAfterMirrorOperation === 'function'
      ? await Promise.resolve(makeAfterMirrorOperation({
        event: followupEvent,
        params,
        data,
        canonicalKey,
      }))
      : null
    const versionOperation = createCollectionVersionOperation({
      event,
      canonicalKey,
      deleted: !after?.exists,
    })
    const sourceState = sourceStateFromEvent(event)
    const finalizationPayload = {
      op: 'finalizeMirror',
      key: versionOperation?.key || canonicalKey,
      sourceState,
      phases,
      afterOperation,
      versionOperation,
      source: 'kvMirror',
    }

    if (!await isSourceStateCurrent(db, sourceState)) {
      logger.log('KV mirror skipped for superseded Firestore event', { document, canonicalKey })
      return
    }

    for (const phase of phases) {
      if (!await runMirrorPhase(phase)) {
        await enqueueKvRetry(finalizationPayload)
        return
      }
    }

    if (afterOperation) {
      try {
        await runKvMirrorFollowup(afterOperation)
      }
      catch (error) {
        logger.warn('KV mirror follow-up failed; queued complete mirror for retry', {
          canonicalKey,
          error: String(error?.message || error || 'follow-up failed').slice(0, 500),
        })
        await enqueueKvRetry(finalizationPayload)
        return
      }
    }

    if (versionOperation) {
      await safeKvOperation({
        run: () => runKvPayload(versionOperation),
        payload: versionOperation,
        label: `put:${versionOperation.key}`,
      })
    }
  })
}

function createKvMirrorHandlerFromFields({
  documentPath,
  uniqueKey,
  keyCollectionName,
  indexKeys = [],
  indexCsvKeys = [],
  metadataKeys = [],
  metaKeyTruncate = {},
  serialize = json,
  redactedFields = [],
}) {
  if (!uniqueKey || typeof uniqueKey !== 'string') {
    throw new Error('createKvMirrorHandlerFromFields requires uniqueKey (e.g. "{orgId}:{siteId}")')
  }
  const docIdParam = 'docId'
  const basePath = documentPath || ''
  const document = basePath.includes(`{${docIdParam}}`) ? basePath : `${basePath}/{${docIdParam}}`
  const collection = String(basePath || '')
    .replace(new RegExp(`/{${docIdParam}}$`), '')
    .split('/')
    .filter(Boolean)
    .pop()
  const keyCollection = String(keyCollectionName || '').trim() || collection
  const csvIndexFields = new Set(
    (Array.isArray(indexCsvKeys) ? indexCsvKeys : [])
      .filter(field => typeof field === 'string' && field.trim())
      .map(field => field.trim()),
  )

  const resolveUniqueKey = (params) => {
    const template = String(uniqueKey || '').trim()
    if (!template)
      return ''
    const tokens = template.match(/\{[^}]+\}/g) || []
    let missing = false
    const value = template.replace(/\{([^}]+)\}/g, (_, key) => {
      const resolved = params?.[key]
      if (resolved === undefined || resolved === null || resolved === '') {
        missing = true
        return ''
      }
      return String(resolved)
    })
    if (missing)
      return ''
    if (tokens.length === 0)
      return value
    return value
  }

  const makeCanonicalKey = (params) => {
    const resolvedKey = resolveUniqueKey(params)
    const docId = params?.[docIdParam]
    if (!keyCollection || !docId || !resolvedKey)
      return ''
    return `${keyCollection}:${resolvedKey}:${docId}`
  }

  const makeIndexKeys = (params, data) => {
    const docId = params?.[docIdParam]
    const resolvedKey = resolveUniqueKey(params)

    if (!keyCollection || !docId || !resolvedKey)
      return []

    const keys = []
    const fields = Array.isArray(indexKeys) ? indexKeys : []
    for (const field of fields) {
      if (!field || typeof field !== 'string')
        continue
      const rawValue = data?.[field]
      const values = Array.isArray(rawValue)
        ? rawValue
        : (
            (csvIndexFields.has(field) && typeof rawValue === 'string')
              ? rawValue.split(',').map(value => value.trim())
              : [rawValue]
          )
      for (const value of values) {
        if (value === undefined || value === null || value === '')
          continue
        const slug = slugIndexValue(value)
        if (!slug)
          continue
        keys.push(`idx:${keyCollection}:${field}:${resolvedKey}:${slug}:${docId}`)
      }
    }
    return keys
  }

  const makeMetadata = (data) => {
    const meta = {}
    const keys = Array.isArray(metadataKeys) ? metadataKeys : []
    const truncateMap = (metaKeyTruncate && typeof metaKeyTruncate === 'object')
      ? metaKeyTruncate
      : {}
    for (const key of keys) {
      const raw = data?.[key] ?? ''
      const truncateLength = Number(truncateMap?.[key])
      if (Number.isFinite(truncateLength) && truncateLength >= 0 && typeof raw === 'string') {
        meta[key] = raw.slice(0, Math.floor(truncateLength))
      }
      else {
        meta[key] = raw
      }
    }
    return meta
  }

  return createKvMirrorHandler({
    document,
    makeCanonicalKey,
    makeIndexKeys: indexKeys.length ? makeIndexKeys : undefined,
    makeMetadata: metadataKeys.length ? makeMetadata : undefined,
    serialize,
    redactedFields,
    timeoutSeconds: 180,
  })
}

module.exports = {
  createKvMirrorHandler,
  createKvMirrorHandlerFromFields,
  collectionScopeFromCanonicalKey,
  collectionVersionShard,
  createCollectionVersionOperation,
}
