// Hub-managed personal/device credentials. Keep identical in functions/.
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { admin, db, onCall, onRequest, HttpsError, permissionCheck, logger } = require('./config.js')

const DAY_MS = 86400000
const SESSION_MS = 15 * 60 * 1000
const connections = () => db.collection('agent-connections')
const sessions = () => db.collection('agent-sessions')
const hash = value => createHash('sha256').update(value).digest('hex')
const docId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 1500 || id.includes('/') || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}
const assertCaller = (request) => {
  if (!request.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  return request.auth.uid
}
const lifetime = (days = 30) => {
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new HttpsError('invalid-argument', 'expiresInDays must be a whole number from 1 to 90.')
  return days * DAY_MS
}
const describe = (connectionId, data) => ({
  connectionId,
  name: data.name,
  createdBy: data.createdBy,
  createdAt: data.createdAt,
  expiresAt: data.expiresAt,
  renewedAt: data.renewedAt || null,
  revokedAt: data.revokedAt || null,
  lastUsedAt: data.lastUsedAt || null,
  hint: data.hint,
})
const requireActive = (data, label) => {
  if (data.revokedAt)
    throw new HttpsError('unauthenticated', `${label} was revoked. Reconnect in the Hub.`)
  if (!(Date.parse(data.expiresAt) > Date.now()))
    throw new HttpsError('unauthenticated', `${label} expired. Renew the connection in the Hub.`)
}
const authenticate = async (collection, prefix, header) => {
  const token = String(header || '').replace(/^Bearer\s+/i, '').trim()
  const match = new RegExp(`^${prefix}\\.([a-f0-9]{40})\\.([A-Za-z0-9_-]{43})$`).exec(token)
  if (!match)
    throw new HttpsError('unauthenticated', 'A valid Hub-issued credential is required.')
  const snap = await collection.doc(match[1]).get()
  const data = snap.exists ? snap.data() : null
  const expected = Buffer.from(String(data?.keyHash || ''), 'hex')
  const actual = Buffer.from(hash(match[2]), 'hex')
  if (!data || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new HttpsError('unauthenticated', 'Invalid Hub-issued credential.')
  requireActive(data, prefix === 'cmsac' ? 'Connection' : 'Session')
  return { id: snap.id, ref: snap.ref, data }
}
const canBuild = async (uid, orgId) =>
  await permissionCheck(uid, 'write', `organizations/${orgId}/sites`)
  && await permissionCheck(uid, 'write', `organizations/${orgId}/blocks`)

// Pages of the live org list; no persisted or local organization grant list.
const organizationPage = async (uid, { startAfter = '', limit = 50 } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new HttpsError('invalid-argument', 'limit must be from 1 to 100.')
  let query = db.collection('organizations').orderBy('__name__').limit(limit)
  if (startAfter)
    query = query.startAfter(docId(startAfter, 'organization cursor'))
  const snap = await query.get()
  const organizations = []
  for (const org of snap.docs) {
    if (await canBuild(uid, org.id))
      organizations.push({ orgId: org.id, name: String(org.data()?.name || org.id) })
  }
  return { organizations, nextStartAfter: snap.size === limit ? snap.docs.at(-1).id : null }
}
const requireBuilder = async (uid) => {
  // Creation uses the selected Hub org to establish eligibility; access is
  // rechecked for every requested organization later.
  if (!await permissionCheck(uid, 'write', 'organizations'))
    return false
  return true
}
const assertEligible = async (uid, orgId) => {
  if (!await requireBuilder(uid) && !await canBuild(uid, docId(orgId, 'organization id')))
    throw new HttpsError('permission-denied', 'CMS edit access is required to connect an agent.')
}
const issue = async (collection, prefix, data) => {
  const ref = collection.doc(randomBytes(20).toString('hex'))
  const secret = randomBytes(32).toString('base64url')
  await ref.set({ ...data, keyHash: hash(secret), hint: secret.slice(-4) })
  return { id: ref.id, token: `${prefix}.${ref.id}.${secret}` }
}
exports.createAgentConnection = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  await assertEligible(uid, request.data.orgId)
  const name = typeof request.data.name === 'string' ? request.data.name.trim().slice(0, 100) : ''
  if (!name)
    throw new HttpsError('invalid-argument', 'Give the connection a person/device name.')
  const now = Date.now()
  const data = { name, createdBy: uid, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + lifetime(request.data.expiresInDays)).toISOString(), revokedAt: null, scope: 'cms-drafts' }
  const result = await issue(connections(), 'cmsac', data)
  return { ...describe(result.id, { ...data, hint: result.token.slice(-4) }), token: result.token }
})
exports.listAgentConnections = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  const isAdmin = await permissionCheck(uid, 'assign', 'agent-connections')
  const query = isAdmin ? connections() : connections().where('createdBy', '==', uid)
  const snap = await query.get()
  return { connections: snap.docs.map(doc => describe(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), isAdmin }
})
exports.renewAgentConnection = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  await assertEligible(uid, request.data.orgId)
  const ref = connections().doc(docId(request.data.connectionId, 'connection id'))
  const requestedExpiry = Date.now() + lifetime(request.data.expiresInDays)
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists)
      throw new HttpsError('not-found', 'Connection does not exist.')
    const data = snap.data()
    if (data.createdBy !== uid)
      throw new HttpsError('permission-denied', 'Only the creator can renew this connection.')
    if (data.revokedAt)
      throw new HttpsError('failed-precondition', 'A revoked connection cannot be renewed. Create a new one.')
    const renewed = { expiresAt: new Date(Math.max(requestedExpiry, Date.parse(data.expiresAt) || 0)).toISOString(), renewedAt: new Date().toISOString() }
    transaction.update(ref, renewed)
    return describe(ref.id, { ...data, ...renewed })
  })
})
exports.revokeAgentConnection = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  const isAdmin = await permissionCheck(uid, 'assign', 'agent-connections')
  const ref = connections().doc(docId(request.data.connectionId, 'connection id'))
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists)
      throw new HttpsError('not-found', 'Connection does not exist.')
    const data = snap.data()
    if (data.createdBy !== uid && !isAdmin)
      throw new HttpsError('permission-denied', 'Only the creator or a Hub administrator can revoke this connection.')
    const revoked = { revokedAt: data.revokedAt || new Date().toISOString(), revokedBy: uid }
    transaction.update(ref, revoked)
    return describe(ref.id, { ...data, ...revoked })
  })
})
const verifyConnection = async (header) => {
  const connection = await authenticate(connections(), 'cmsac', header)
  if (connection.data.scope !== 'cms-drafts')
    throw new HttpsError('permission-denied', 'Connection is not authorized for CMS drafts.')
  return connection
}
exports.agentConnection = onRequest({ timeoutSeconds: 60 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'method-not-allowed', message: 'Use POST.' })
    return
  }
  try {
    const connection = await verifyConnection(req.get ? req.get('authorization') : req.headers?.authorization)
    const body = req.body || {}
    if (body.action === 'organizations') {
      res.json({ ok: true, ...await organizationPage(connection.data.createdBy, body) })
      return
    }
    if (body.action !== 'session')
      throw new HttpsError('invalid-argument', 'action must be organizations or session.')
    const orgId = docId(body.orgId, 'organization id')
    const scope = body.scope
    if (scope !== 'organization' && scope !== 'site')
      throw new HttpsError('invalid-argument', 'Choose organization or site scope explicitly.')
    const siteId = scope === 'site' ? docId(body.siteId, 'site id') : null
    if (scope === 'organization' && body.siteId)
      throw new HttpsError('invalid-argument', 'Organization sessions cannot select a site.')
    if (!await canBuild(connection.data.createdBy, orgId))
      throw new HttpsError('permission-denied', 'No current CMS edit access to this organization.')
    const org = db.collection('organizations').doc(orgId)
    const orgSnap = await org.get()
    if (!orgSnap.exists)
      throw new HttpsError('not-found', 'Organization does not exist.')
    const siteSnap = siteId ? await org.collection('sites').doc(siteId).get() : null
    if (siteSnap && !siteSnap.exists)
      throw new HttpsError('not-found', 'Site does not exist in the selected organization.')
    const expiresAt = new Date(Math.min(Date.now() + SESSION_MS, Date.parse(connection.data.expiresAt))).toISOString()
    const data = { connectionId: connection.id, createdBy: connection.data.createdBy, orgId, siteId, scope, createdAt: new Date().toISOString(), expiresAt, expiresAtTimestamp: admin.firestore.Timestamp.fromMillis(Date.parse(expiresAt)), revokedAt: null }
    const session = await issue(sessions(), 'cmsas', data)
    await connection.ref.update({ lastUsedAt: new Date().toISOString() })
    res.json({ ok: true, sessionId: session.id, token: session.token, expiresAt, orgId, organizationName: String(orgSnap.data()?.name || orgId), siteId, siteName: siteSnap ? String(siteSnap.data()?.name || siteId) : null, scope })
  }
  catch (error) {
    const statuses = { 'invalid-argument': 400, 'unauthenticated': 401, 'permission-denied': 403, 'not-found': 404, 'failed-precondition': 409 }
    const status = statuses[error.code] || 500
    if (status === 500)
      logger.error('Agent connection request failed', { error: error.message })
    res.status(status).json({ ok: false, code: status === 500 ? 'internal' : error.code, message: status === 500 ? 'Connection request failed.' : error.message })
  }
})

// Parent revocation/expiry and current creator permissions are authoritative.
exports.verifyAgentSession = async (orgId, header, body) => {
  const session = await authenticate(sessions(), 'cmsas', header)
  const parent = await connections().doc(session.data.connectionId).get()
  if (!parent.exists)
    throw new HttpsError('unauthenticated', 'Connection no longer exists.')
  const connection = parent.data()
  requireActive(connection, 'Connection')
  if (connection.scope !== 'cms-drafts' || connection.createdBy !== session.data.createdBy)
    throw new HttpsError('permission-denied', 'Session connection is invalid.')
  if (session.data.orgId !== orgId)
    throw new HttpsError('permission-denied', 'Session belongs to a different organization.')
  const type = body.operation?.type || ''
  if (session.data.scope === 'site') {
    const target = (body.action === 'check' || body.action === 'run') ? body.operation?.siteId : body.siteId
    if (target !== session.data.siteId)
      throw new HttpsError('permission-denied', 'Session belongs to a different site.')
    if ((body.action === 'check' || body.action === 'run') && !type.startsWith('page.') && type !== 'site.update')
      throw new HttpsError('permission-denied', 'Site sessions only allow page operations and updates to this site.')
  }
  else if (session.data.scope === 'organization') {
    if (!['check', 'run'].includes(body.action) || (!type.startsWith('block.') && !type.startsWith('theme.') && type !== 'site.create'))
      throw new HttpsError('permission-denied', 'Organization sessions only allow library/theme work and site creation. Open a site session for page work.')
  }
  else {
    throw new HttpsError('permission-denied', 'Invalid session scope.')
  }
  if (!await canBuild(connection.createdBy, orgId))
    throw new HttpsError('permission-denied', 'No current CMS edit access to this organization.')
  return { uid: connection.createdBy, keyId: session.id, ref: session.ref, connectionId: session.data.connectionId }
}
