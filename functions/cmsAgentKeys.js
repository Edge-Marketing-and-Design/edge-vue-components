// Agent keys (first-release plan, phase 4; decision D8): a developer creates
// a key in the Hub and gives it to an agent (the MCP). The key acts as that
// developer, in one organization, for the draft-only CMS operations only. It
// expires and can be revoked. Only a hash of the secret is stored; the full
// key is shown once, when it is created.
//
// Keys live in the top-level agent-keys collection, not under the
// organization: the Hub's generic Firestore rules (owned by
// @edgedev/firebase) let organization editors create documents under
// organizations/{orgId}/..., so a key stored there could be forged with any
// createdBy. Only root admins match a top-level path under those rules.
// Keep identical to edge/functions/cmsAgentKeys.js.
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const {
  logger,
  db,
  onCall,
  onRequest,
  HttpsError,
  permissionCheck,
} = require('./config.js')
const { authorizeOperation, gatherSiteReadiness, performCheck, performRun } = require('./cmsOperations.js')
const { buildPreviewUrl, issuePreviewToken, previewBaseUrl, previewTokensEnabled } = require('./cmsPreviewTokens.js')

const DOC_ID_PATTERN = /^[^/]{1,1500}$/
const KEY_PREFIX = 'cmsak'
const DEFAULT_DAYS = 30
const MAX_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
// cmsak.<keyId>.<secret>: Firestore auto ids and base64url secrets.
const TOKEN_PATTERN = /^cmsak\.([A-Za-z0-9]{20})\.([A-Za-z0-9_-]{43})$/

const requireDocId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !DOC_ID_PATTERN.test(id) || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

const hashSecret = secret => createHash('sha256').update(secret).digest('hex')

// A 20-character alphanumeric key id, the token's middle part.
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const newKeyId = () => [...randomBytes(20)].map(byte => ALPHANUMERIC[byte % ALPHANUMERIC.length]).join('')
const agentKeys = () => db.collection('agent-keys')

const assertCaller = (request) => {
  const uid = request?.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  return { uid, orgId: requireDocId(request.data.orgId, 'organization id') }
}

// What a key looks like to the Hub: never the hash.
const describeKey = (id, key) => ({
  keyId: id,
  name: key.name || '',
  createdBy: key.createdBy || null,
  createdAt: key.createdAt || null,
  expiresAt: key.expiresAt || null,
  revokedAt: key.revokedAt || null,
  revokedBy: key.revokedBy || null,
  lastUsedAt: key.lastUsedAt || null,
  useCount: key.useCount || 0,
  hint: key.hint || '',
})

// Creating a key needs block and site write access: the key can do no more
// than its creator, and it is meant for building sites.
exports.createAgentKey = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { uid, orgId } = assertCaller(request)
  const canWrite = await permissionCheck(uid, 'write', `organizations/${orgId}/blocks`)
    && await permissionCheck(uid, 'write', `organizations/${orgId}/sites`)
  if (!canWrite)
    throw new HttpsError('permission-denied', 'Only people who can edit blocks and sites can create agent keys.')
  const name = typeof request.data.name === 'string' ? request.data.name.trim().slice(0, 100) : ''
  if (!name)
    throw new HttpsError('invalid-argument', 'Give the key a name, for example the machine or agent it is for.')
  const days = request.data.expiresInDays === undefined ? DEFAULT_DAYS : Number(request.data.expiresInDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)
    throw new HttpsError('invalid-argument', `expiresInDays must be a whole number from 1 to ${MAX_DAYS}.`)

  const ref = agentKeys().doc(newKeyId())
  const secret = randomBytes(32).toString('base64url')
  const now = Date.now()
  const key = {
    docId: ref.id,
    orgId,
    name,
    createdBy: uid,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    useCount: 0,
    keyHash: hashSecret(secret),
    hint: secret.slice(-4),
    scope: 'cms-operations',
  }
  await ref.set(key)
  logger.log(`Agent key ${ref.id} created by ${uid}`, { orgId, expiresAt: key.expiresAt })
  return { ...describeKey(ref.id, key), token: `${KEY_PREFIX}.${ref.id}.${secret}` }
})

// Your own keys; organization admins see everyone's.
exports.listAgentKeys = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { uid, orgId } = assertCaller(request)
  const isAdmin = await permissionCheck(uid, 'assign', `organizations/${orgId}/blocks`)
  const inOrg = agentKeys().where('orgId', '==', orgId)
  const snap = isAdmin ? await inOrg.get() : await inOrg.where('createdBy', '==', uid).get()
  const keys = snap.docs.map(doc => describeKey(doc.id, doc.data() || {}))
  keys.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { keys, isAdmin }
})

// The key's creator or an organization admin can revoke it.
exports.revokeAgentKey = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { uid, orgId } = assertCaller(request)
  const keyId = requireDocId(request.data.keyId, 'key id')
  const ref = agentKeys().doc(keyId)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.orgId !== orgId)
    throw new HttpsError('not-found', `Agent key "${keyId}" does not exist.`)
  const key = snap.data() || {}
  if (key.createdBy !== uid && !await permissionCheck(uid, 'assign', `organizations/${orgId}/blocks`))
    throw new HttpsError('permission-denied', 'Only the key\'s creator or an organization admin can revoke it.')
  if (key.revokedAt)
    return describeKey(keyId, key)
  const revoked = { revokedAt: new Date().toISOString(), revokedBy: uid }
  await ref.update(revoked)
  logger.log(`Agent key ${keyId} revoked by ${uid}`, { orgId })
  return describeKey(keyId, { ...key, ...revoked })
})

// Verifies a bearer token for `orgId`. Returns the key's creator and id.
const verifyAgentKey = async (orgId, header) => {
  const token = String(header || '').replace(/^Bearer\s+/i, '').trim()
  const match = TOKEN_PATTERN.exec(token)
  if (!match)
    throw new HttpsError('unauthenticated', 'An agent key is required (Authorization: Bearer cmsak.…).')
  const [, keyId, secret] = match
  const snap = await agentKeys().doc(keyId).get()
  const key = (snap.exists && snap.data()?.orgId === orgId) ? (snap.data() || {}) : null
  const expected = Buffer.from(String(key?.keyHash || ''), 'hex')
  const actual = Buffer.from(hashSecret(secret), 'hex')
  if (!key || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new HttpsError('unauthenticated', 'This agent key is not valid for this organization.')
  if (key.revokedAt)
    throw new HttpsError('unauthenticated', 'This agent key was revoked.')
  if (!key.expiresAt || Date.parse(key.expiresAt) <= Date.now())
    throw new HttpsError('unauthenticated', 'This agent key has expired. Create a new one in the Hub.')
  return { uid: key.createdBy, keyId, ref: snap.ref }
}

const HTTP_STATUS = {
  'invalid-argument': 400,
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'failed-precondition': 409,
}

// POST { orgId, action: 'check' | 'run', operation, checksum?, client? }
// or { orgId, action: 'preview', siteId, pageId, source?, blockDrafts? }, or
// { orgId, action: 'readiness', siteId } with
// Authorization: Bearer <agent key>. Runs the draft-only CMS operations as
// the key's creator, or returns a short-lived preview link for one page the
// creator can read. Responses are JSON: { ok: true, ... } or
// { ok: false, code, message, details }.

// A preview link for one draft (or published) page, for checking what the
// agent built.
const previewLink = async ({ uid, orgId, body }) => {
  const siteId = requireDocId(body.siteId, 'site id')
  const pageId = requireDocId(body.pageId, 'page id')
  const source = body.source === 'published' ? 'published' : 'draft'
  if (!await permissionCheck(uid, 'read', `organizations/${orgId}/sites`))
    throw new HttpsError('permission-denied', 'Not allowed to read sites in this organization.')
  if (!previewTokensEnabled())
    throw new HttpsError('failed-precondition', 'Preview links are not configured: set CMS_PREVIEW_TOKEN_SECRET in the Functions environment.')
  const page = await db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection(source === 'published' ? 'published' : 'pages').doc(pageId).get()
  if (!page.exists)
    throw new HttpsError('not-found', `${source === 'published' ? 'Published' : 'Draft'} page "${pageId}" does not exist on site "${siteId}".`)
  const { token, expiresAt } = issuePreviewToken({ orgId, siteId, pageId, source })
  // blockDrafts: render unreleased block drafts (draft pages only).
  const blockDrafts = body.blockDrafts === true && source === 'draft'
  // viewport / width: render at a phone, tablet or custom width.
  const viewport = typeof body.viewport === 'string' ? body.viewport : ''
  const width = body.width === undefined ? null : Number(body.width)
  const url = buildPreviewUrl({ baseUrl: previewBaseUrl(), orgId, siteId, pageId, source, token, blockDrafts, viewport, width })
  const applied = new URL(url).searchParams
  return { url, expiresAt, blockDrafts, viewport: applied.get('viewport') || null, width: applied.get('width') ? Number(applied.get('width')) : null }
}
exports.agentOperation = onRequest({ timeoutSeconds: 120 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'method-not-allowed', message: 'Use POST.' })
    return
  }
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {}
    const orgId = requireDocId(body.orgId, 'organization id')
    const { uid, keyId, ref } = await verifyAgentKey(orgId, req.get ? req.get('authorization') : req.headers?.authorization)
    let result
    if (body.action === 'preview') {
      result = await previewLink({ uid, orgId, body })
    }
    else if (body.action === 'readiness') {
      if (!await permissionCheck(uid, 'read', `organizations/${orgId}/sites`))
        throw new HttpsError('permission-denied', 'Not allowed to read sites in this organization.')
      result = await gatherSiteReadiness({ orgId, siteId: requireDocId(body.siteId, 'site id') })
    }
    else if (body.action === 'check' || body.action === 'run') {
      const caller = await authorizeOperation({ uid, orgId, operation: body.operation })
      result = body.action === 'check'
        ? await performCheck(caller)
        : await performRun({ ...caller, checksum: body.checksum, client: body.client, via: 'agent', agentKeyId: keyId })
    }
    else {
      throw new HttpsError('invalid-argument', 'action must be "check", "run", "preview" or "readiness".')
    }
    const used = await ref.get()
    await ref.update({ lastUsedAt: new Date().toISOString(), useCount: (used.data()?.useCount || 0) + 1 })
    res.status(200).json({ ok: true, ...result })
  }
  catch (error) {
    const code = (error instanceof HttpsError || error?.code) ? String(error.code) : 'internal'
    const status = HTTP_STATUS[code] || 500
    if (status === 500)
      logger.error('Agent operation failed', { error: error?.message })
    res.status(status).json({ ok: false, code, message: status === 500 ? 'The operation failed.' : String(error.message || ''), details: error?.details || null })
  }
})

// For tests.
exports.verifyAgentKey = verifyAgentKey
