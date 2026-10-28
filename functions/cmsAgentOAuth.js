// OAuth 2.1 sign-in for the remote CMS MCP (cms-agentMcp), so Claude
// connectors (claude.ai, Desktop, mobile, Claude Code) sign in with the
// person's own Hub account instead of a pasted cmsac.… credential. See
// docs/features/cms/remote-mcp-design.md, "OAuth sign-in (phase 2)".
// - Issuer: the Hub's own origin (CMS_AGENT_HUB_URL); a Hosting rewrite sends
//   /.well-known/oauth-authorization-server here.
// - Clients: a pinned allowlist of Client ID Metadata Documents; nothing is
//   fetched and there is no dynamic registration.
// - The consent screen is the Hub page /app/agent-authorize, which calls
//   describeAgentAuthorization and decideAgentAuthorization. Nothing is
//   written before a signed-in person allows the request.
// - Each approval becomes an agent-connections document with kind "oauth"
//   (the grant), so cms-agentMcp runs it through the same checks as a Hub
//   connection. Access tokens (cmsat.…, 1 hour) are in agent-oauth-tokens;
//   refresh tokens (cmsrt.…) rotate on every use and a reused one revokes the
//   grant. Grants last 30 days from the last refresh, at most 90 days.
// Keep identical in functions/.
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { Timestamp } = require('firebase-admin/firestore')
const { admin, db, onCall, onRequest, HttpsError, logger } = require('./config.js')
const { organizationPage } = require('./cmsAgentConnections.js')

const DAY_MS = 86400000
const SCOPE = 'cms-drafts'
const CODE_MS = 5 * 60 * 1000
const ACCESS_MS = 60 * 60 * 1000
const IDLE_MS = 30 * DAY_MS
const MAX_MS = 90 * DAY_MS
const USER_CHECK_MS = 5 * 60 * 1000
const RETIRED_REFRESH_KEPT = 10
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// client_id → what the consent screen names and where codes may go, pinned
// from each client's published metadata document (checked 2026-10-28).
const CLIENTS = Object.freeze({
  'https://claude.ai/oauth/mcp-oauth-client-metadata': { name: 'Claude', label: 'Claude (claude.ai)', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] },
  'https://claude.ai/oauth/claude-code-client-metadata': { name: 'Claude Code', label: 'Claude Code', redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'] },
  // Codex uses this stable id only because the metadata advertises the iss
  // response parameter; otherwise it would send a per-server id.
  'https://chatgpt.com/oauth/codex/client.json': { name: 'Codex', label: 'Codex', redirectUris: ['http://127.0.0.1/callback', 'http://localhost/callback'] },
})
const AUTHORIZE_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope']

const connections = () => db.collection('agent-connections')
const codes = () => db.collection('agent-oauth-codes')
const tokens = () => db.collection('agent-oauth-tokens')

const str = value => ((typeof value === 'string' && value.length <= 2048) ? value.trim() : '')
const trimSlash = value => str(value).replace(/\/+$/, '')
const iso = ms => new Date(ms).toISOString()
const hash = value => createHash('sha256').update(value).digest('hex')
const pkceChallenge = verifier => createHash('sha256').update(verifier).digest('base64url')
const secretMatches = (storedHash, secret) => {
  const expected = Buffer.from(String(storedHash || ''), 'hex')
  const actual = Buffer.from(hash(secret), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
const newCredential = (prefix) => {
  const id = randomBytes(20).toString('hex')
  const secret = randomBytes(32).toString('base64url')
  return { id, secret, token: `${prefix}.${id}.${secret}` }
}
const parseCredential = (prefix, value) => {
  const match = new RegExp(`^${prefix}\\.([a-f0-9]{40})\\.([A-Za-z0-9_-]{43})$`).exec(str(value))
  return match ? { id: match[1], secret: match[2] } : null
}

const functionUrl = (name) => {
  let project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  if (!project) {
    try {
      project = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''
    }
    catch {}
  }
  const region = process.env.FUNCTION_REGION || process.env.FIREBASE_STORE_REGION || 'us-west1'
  return `https://${region}-${project}.cloudfunctions.net/${name}`
}
// The issuer is empty until the Hub sets CMS_AGENT_HUB_URL; sign-in is off
// then and cms-agentMcp answers as it did before OAuth.
const oauthUrls = () => {
  const mcp = trimSlash(process.env.CMS_AGENT_MCP_URL) || functionUrl('cms-agentMcp')
  return {
    issuer: trimSlash(process.env.CMS_AGENT_HUB_URL),
    mcp,
    oauth: trimSlash(process.env.CMS_AGENT_OAUTH_URL) || functionUrl('cms-agentOAuth'),
    resourceMetadata: `${mcp}/.well-known/oauth-protected-resource`,
  }
}
// Scheme and host compared case-insensitively (URL lowercases them), the path
// exactly, a trailing slash ignored.
const canonicalUrl = (value) => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  }
  catch {
    return ''
  }
}
const resourceMatches = (value, mcp) => !str(value) || canonicalUrl(str(value)) === canonicalUrl(mcp)

const authorizationServerMetadata = urls => ({
  issuer: urls.issuer,
  authorization_endpoint: `${urls.oauth}/authorize`,
  token_endpoint: `${urls.oauth}/token`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  scopes_supported: [SCOPE],
})
const protectedResourceMetadata = urls => ({
  resource: urls.mcp,
  authorization_servers: [urls.issuer],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Edge CMS',
})
// The WWW-Authenticate value for a 401 from cms-agentMcp. Without sign-in set
// up it stays the plain invalid_token challenge.
const bearerChallenge = (urls = oauthUrls(), { tokenSent = true } = {}) => {
  if (!urls.issuer)
    return 'Bearer error="invalid_token"'
  return `Bearer ${[...(tokenSent ? ['error="invalid_token"'] : []), `resource_metadata="${urls.resourceMetadata}"`, `scope="${SCOPE}"`].join(', ')}`
}

// Codes may go only to the exact redirect URIs of the client; loopback ones
// (Claude Code) match on any port, as RFC 8252 7.3 asks.
const redirectAllowed = (client, value) => {
  let url
  try {
    url = new URL(value)
  }
  catch {
    return false
  }
  if (url.hash || url.username || url.password)
    return false
  return client.redirectUris.some((allowed) => {
    if (value === allowed)
      return true
    const expected = new URL(allowed)
    return LOOPBACK_HOSTS.includes(expected.hostname) && url.protocol === 'http:' && url.hostname === expected.hostname && url.pathname === expected.pathname && !url.search
  })
}
const isLoopback = redirectUri => LOOPBACK_HOSTS.includes(new URL(redirectUri).hostname)

class AuthorizeError extends Error {
  constructor(error, message, request = null) {
    super(message)
    this.error = error
    // Set once the client and redirect URI are trusted, so the error can be
    // sent back to the client instead of shown here.
    this.request = request
  }
}
const readAuthorizeRequest = (params = {}, urls = oauthUrls()) => {
  if (!urls.issuer)
    throw new AuthorizeError('server_error', 'Agent sign-in is not set up for this Hub.')
  const clientId = str(params.client_id)
  const client = Object.hasOwn(CLIENTS, clientId) ? CLIENTS[clientId] : null
  if (!client)
    throw new AuthorizeError('invalid_client', 'This app is not allowed to sign in to this Hub.')
  const redirectUri = str(params.redirect_uri)
  if (!redirectAllowed(client, redirectUri))
    throw new AuthorizeError('invalid_request', 'The return address does not belong to this app.')
  const request = { clientId, client, redirectUri, state: str(params.state) }
  const fail = (error, message) => {
    throw new AuthorizeError(error, message, request)
  }
  if (str(params.response_type) !== 'code')
    fail('unsupported_response_type', 'Only response_type=code is supported.')
  const codeChallenge = str(params.code_challenge)
  if (str(params.code_challenge_method) !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))
    fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.')
  if (!resourceMatches(params.resource, urls.mcp))
    fail('invalid_target', 'resource must be this Hub\'s CMS MCP URL.')
  // offline_access is accepted and ignored: a refresh token always comes.
  if (str(params.scope).split(/\s+/).filter(Boolean).some(scope => scope !== SCOPE && scope !== 'offline_access'))
    fail('invalid_scope', `Only the ${SCOPE} scope is available.`)
  return { ...request, codeChallenge, resource: urls.mcp }
}
const redirectWith = (request, params, urls) => {
  const url = new URL(request.redirectUri)
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value)
  if (request.state)
    url.searchParams.set('state', request.state)
  url.searchParams.set('iss', urls.issuer)
  return url.toString()
}

const userChecks = new Map()
// The Hub user still exists and the Auth account isn't disabled. Cached per
// instance for 5 minutes unless fresh.
const userIsActive = async (uid, { fresh = false, now = Date.now() } = {}) => {
  const cached = userChecks.get(uid)
  if (!fresh && cached && now - cached.at < USER_CHECK_MS)
    return cached.active
  let active = (await db.collection('users').doc(uid).get()).exists
  if (active) {
    try {
      active = !(await admin.auth().getUser(uid)).disabled
    }
    catch (error) {
      if (error?.code !== 'auth/user-not-found')
        throw error
      active = false
    }
  }
  userChecks.set(uid, { active, at: now })
  return active
}

// Organizations the person can build in, across pages of the org list.
const editableOrganizations = async (uid) => {
  const found = []
  let startAfter = ''
  for (let page = 0; page < 10; page++) {
    const result = await organizationPage(uid, { startAfter, limit: 100 })
    found.push(...result.organizations)
    if (!result.nextStartAfter)
      break
    startAfter = result.nextStartAfter
  }
  return found
}

const assertCaller = (request) => {
  if (!request.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  return request.auth.uid
}
const callableRequest = (data, urls) => {
  try {
    return readAuthorizeRequest(data?.request || {}, urls)
  }
  catch (error) {
    if (error instanceof AuthorizeError)
      throw new HttpsError('invalid-argument', error.message)
    throw error
  }
}

// What the consent screen shows. Validates the request again; writes nothing.
exports.describeAgentAuthorization = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  const authorization = callableRequest(request.data, oauthUrls())
  const organizations = await editableOrganizations(uid)
  return {
    client: { id: authorization.clientId, name: authorization.client.name, host: new URL(authorization.clientId).host },
    redirectHost: new URL(authorization.redirectUri).host,
    loopback: isLoopback(authorization.redirectUri),
    organizations: organizations.map(org => org.name),
    idleDays: IDLE_MS / DAY_MS,
    maxDays: MAX_MS / DAY_MS,
  }
})

// Allow or cancel. Allow stores a single-use, 5-minute code; both return the
// URL the page sends the browser to.
exports.decideAgentAuthorization = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  const urls = oauthUrls()
  const authorization = callableRequest(request.data, urls)
  if (request.data.allow !== true)
    return { redirectUrl: redirectWith(authorization, { error: 'access_denied', error_description: 'The request was cancelled.' }, urls) }
  if (!await userIsActive(uid, { fresh: true }) || !(await editableOrganizations(uid)).length)
    throw new HttpsError('permission-denied', 'CMS edit access in at least one organization is required to connect an agent.')
  const code = newCredential('cmsoc')
  const now = Date.now()
  await codes().doc(code.id).set({
    keyHash: hash(code.secret),
    uid,
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    codeChallenge: authorization.codeChallenge,
    resource: authorization.resource,
    scope: SCOPE,
    createdAt: iso(now),
    expiresAt: iso(now + CODE_MS),
    expiresAtTimestamp: Timestamp.fromMillis(now + CODE_MS),
    usedAt: null,
    grantId: null,
  })
  return { redirectUrl: redirectWith(authorization, { code: code.token }, urls) }
})

class GrantError extends Error {
  constructor(error, message, status = 400) {
    super(message)
    this.error = error
    this.status = status
  }
}

// A new access token and refresh token for a grant, written in transaction.
const issueTokens = (transaction, grantRef, grant, now) => {
  const access = newCredential('cmsat')
  const refresh = newCredential('cmsrt')
  const accessExpires = Math.min(now + ACCESS_MS, Date.parse(grant.expiresAt))
  transaction.set(tokens().doc(access.id), {
    keyHash: hash(access.secret),
    connectionId: grantRef.id,
    createdBy: grant.createdBy,
    resource: grant.resource,
    createdAt: iso(now),
    expiresAt: iso(accessExpires),
    expiresAtTimestamp: Timestamp.fromMillis(accessExpires),
  })
  return {
    refreshHash: hash(refresh.secret),
    body: {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: Math.max(1, Math.floor((accessExpires - now) / 1000)),
      // The refresh token names its grant, so a refresh is one document read.
      refresh_token: `cmsrt.${grantRef.id}.${refresh.secret}`,
      scope: SCOPE,
    },
  }
}
const revoke = (transaction, ref, reason, now) => transaction.update(ref, { revokedAt: iso(now), revokedBy: reason })

const exchangeCode = async (body, clientId, urls) => {
  const parsed = parseCredential('cmsoc', body.code)
  const verifier = str(body.code_verifier)
  if (!parsed)
    throw new GrantError('invalid_grant', 'Unknown authorization code.')
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
    throw new GrantError('invalid_request', 'code_verifier is required.')
  if (!resourceMatches(body.resource, urls.mcp))
    throw new GrantError('invalid_target', 'resource must be this Hub\'s CMS MCP URL.')
  const codeRef = codes().doc(parsed.id)
  const first = (await codeRef.get()).data()
  if (first?.uid && !await userIsActive(first.uid, { fresh: true }))
    throw new GrantError('invalid_grant', 'The Hub account is disabled or removed.')
  const result = await db.runTransaction(async (transaction) => {
    const now = Date.now()
    const snap = await transaction.get(codeRef)
    const code = snap.exists ? snap.data() : null
    if (!code || !secretMatches(code.keyHash, parsed.secret))
      throw new GrantError('invalid_grant', 'Unknown authorization code.')
    if (code.usedAt) {
      // A code redeemed twice was intercepted: stop what it already granted.
      if (code.grantId)
        revoke(transaction, connections().doc(code.grantId), 'oauth-code-reuse', now)
      return { reused: true }
    }
    if (!(Date.parse(code.expiresAt) > now))
      throw new GrantError('invalid_grant', 'The authorization code expired. Sign in again.')
    if (code.clientId !== clientId || code.redirectUri !== str(body.redirect_uri))
      throw new GrantError('invalid_grant', 'The authorization code was issued to another client or redirect URI.')
    if (pkceChallenge(verifier) !== code.codeChallenge)
      throw new GrantError('invalid_grant', 'code_verifier does not match.')
    const client = CLIENTS[clientId]
    const grantRef = connections().doc(randomBytes(20).toString('hex'))
    const grant = {
      kind: 'oauth',
      scope: SCOPE,
      name: client.label,
      createdBy: code.uid,
      createdAt: iso(now),
      expiresAt: iso(now + IDLE_MS),
      maxExpiresAt: iso(now + MAX_MS),
      renewedAt: null,
      revokedAt: null,
      lastUsedAt: iso(now),
      hint: '',
      client: { id: clientId, name: client.name, host: new URL(clientId).host },
      redirectHost: new URL(code.redirectUri).hostname,
      resource: code.resource,
      retiredRefreshHashes: [],
    }
    const issued = issueTokens(transaction, grantRef, grant, now)
    transaction.set(grantRef, { ...grant, refreshHash: issued.refreshHash })
    transaction.update(codeRef, { usedAt: iso(now), grantId: grantRef.id })
    return issued.body
  })
  if (result.reused)
    throw new GrantError('invalid_grant', 'The authorization code was already used.')
  return result
}

const refreshGrant = async (body, clientId, urls) => {
  const parsed = parseCredential('cmsrt', body.refresh_token)
  if (!parsed)
    throw new GrantError('invalid_grant', 'Unknown refresh token.')
  if (!resourceMatches(body.resource, urls.mcp))
    throw new GrantError('invalid_target', 'resource must be this Hub\'s CMS MCP URL.')
  const grantRef = connections().doc(parsed.id)
  const first = (await grantRef.get()).data()
  const userActive = first?.kind === 'oauth' ? await userIsActive(first.createdBy, { fresh: true }) : true
  const result = await db.runTransaction(async (transaction) => {
    const now = Date.now()
    const snap = await transaction.get(grantRef)
    const grant = snap.exists ? snap.data() : null
    if (!grant || grant.kind !== 'oauth' || grant.client?.id !== clientId)
      throw new GrantError('invalid_grant', 'Unknown refresh token.')
    if (grant.revokedAt)
      throw new GrantError('invalid_grant', 'This sign-in was revoked. Sign in again.')
    if (!(Date.parse(grant.expiresAt) > now))
      throw new GrantError('invalid_grant', 'This sign-in expired. Sign in again.')
    const presented = hash(parsed.secret)
    if (!secretMatches(grant.refreshHash, parsed.secret)) {
      // An old refresh token came back after rotation: treat it as leaked.
      if ((grant.retiredRefreshHashes || []).includes(presented)) {
        revoke(transaction, grantRef, 'oauth-refresh-reuse', now)
        return { reused: true }
      }
      throw new GrantError('invalid_grant', 'Unknown refresh token.')
    }
    if (!userActive) {
      revoke(transaction, grantRef, 'oauth-user-inactive', now)
      return { inactive: true }
    }
    const expiresAt = iso(Math.min(now + IDLE_MS, Date.parse(grant.maxExpiresAt)))
    const issued = issueTokens(transaction, grantRef, { ...grant, expiresAt }, now)
    transaction.update(grantRef, {
      refreshHash: issued.refreshHash,
      retiredRefreshHashes: [grant.refreshHash, ...(grant.retiredRefreshHashes || [])].slice(0, RETIRED_REFRESH_KEPT),
      expiresAt,
      renewedAt: iso(now),
      lastUsedAt: iso(now),
    })
    return issued.body
  })
  if (result.reused)
    throw new GrantError('invalid_grant', 'This refresh token was already used, so the sign-in was revoked. Sign in again.')
  if (result.inactive)
    throw new GrantError('invalid_grant', 'The Hub account is disabled or removed.')
  return result
}

// The client id from the form body, or from HTTP Basic with an empty secret.
const tokenClientId = (req) => {
  const fromBody = str(req.body?.client_id)
  if (fromBody)
    return fromBody
  const header = str(req.get ? req.get('authorization') : req.headers?.authorization)
  const basic = /^Basic\s+(\S+)$/i.exec(header)
  if (!basic)
    return ''
  const [id] = Buffer.from(basic[1], 'base64').toString('utf8').split(':')
  return decodeURIComponent(id || '')
}

const sendJson = (res, status, body, cache = 'no-store') => {
  res.status(status)
  res.set('Cache-Control', cache)
  res.json(body)
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
const errorPage = (res, status, message) => {
  res.status(status)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.set('Cache-Control', 'no-store')
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">Sign-in failed</h1><p>${escapeHtml(message)}</p></body></html>`)
}
const redirect = (res, url) => {
  res.status(302)
  res.set('Location', url)
  res.set('Cache-Control', 'no-store')
  res.send('')
}

const authorize = (req, res, urls) => {
  try {
    readAuthorizeRequest(req.query || {}, urls)
    const target = new URL(`${urls.issuer}/app/agent-authorize`)
    for (const name of AUTHORIZE_PARAMS) {
      if (str(req.query?.[name]))
        target.searchParams.set(name, str(req.query[name]))
    }
    redirect(res, target.toString())
  }
  catch (error) {
    if (!(error instanceof AuthorizeError))
      throw error
    if (error.request)
      redirect(res, redirectWith(error.request, { error: error.error, error_description: error.message }, urls))
    else
      errorPage(res, 400, error.message)
  }
}

const token = async (req, res, urls) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST')
    sendJson(res, 405, { error: 'invalid_request', error_description: 'Use POST.' })
    return
  }
  try {
    const clientId = tokenClientId(req)
    if (!Object.hasOwn(CLIENTS, clientId))
      throw new GrantError('invalid_client', 'Unknown client.', 401)
    const body = req.body || {}
    const grantType = str(body.grant_type)
    if (grantType === 'authorization_code')
      sendJson(res, 200, await exchangeCode(body, clientId, urls))
    else if (grantType === 'refresh_token')
      sendJson(res, 200, await refreshGrant(body, clientId, urls))
    else
      throw new GrantError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.')
  }
  catch (error) {
    if (!(error instanceof GrantError))
      throw error
    sendJson(res, error.status, { error: error.error, error_description: error.message })
  }
}

// Serves one request. Exported for tests.
const serveOAuth = async (req, res, urls = oauthUrls()) => {
  const route = String(req.path || new URL(req.url || '/', 'https://hub.invalid').pathname).replace(/\/+$/, '')
  if (!urls.issuer) {
    sendJson(res, 404, { error: 'not_found', error_description: 'Agent sign-in is not set up for this Hub.' })
    return
  }
  if (route.endsWith('/.well-known/oauth-authorization-server')) {
    res.set('Access-Control-Allow-Origin', '*')
    sendJson(res, 200, authorizationServerMetadata(urls), 'public, max-age=300')
  }
  else if (route.endsWith('/authorize')) {
    authorize(req, res, urls)
  }
  else if (route.endsWith('/token')) {
    await token(req, res, urls)
  }
  else {
    sendJson(res, 404, { error: 'not_found' })
  }
}

// An OAuth access token for cms-agentMcp, resolved to its grant (an
// agent-connections document shaped like a Hub connection). The token must be
// for this MCP URL, its grant active, and the person's account active.
const verifyAccessToken = async (header, urls = oauthUrls()) => {
  const parsed = parseCredential('cmsat', String(header || '').replace(/^Bearer\s+/i, ''))
  if (!parsed)
    throw new HttpsError('unauthenticated', 'A valid Hub-issued credential is required.')
  const snap = await tokens().doc(parsed.id).get()
  const accessToken = snap.exists ? snap.data() : null
  if (!accessToken || !secretMatches(accessToken.keyHash, parsed.secret))
    throw new HttpsError('unauthenticated', 'Invalid access token.')
  if (!(Date.parse(accessToken.expiresAt) > Date.now()))
    throw new HttpsError('unauthenticated', 'Access token expired.')
  if (canonicalUrl(accessToken.resource) !== canonicalUrl(urls.mcp))
    throw new HttpsError('unauthenticated', 'This access token is for a different server.')
  const grantSnap = await connections().doc(String(accessToken.connectionId)).get()
  const grant = grantSnap.exists ? grantSnap.data() : null
  if (!grant || grant.kind !== 'oauth' || grant.scope !== SCOPE || grant.createdBy !== accessToken.createdBy)
    throw new HttpsError('unauthenticated', 'This sign-in no longer exists. Sign in again.')
  if (grant.revokedAt)
    throw new HttpsError('unauthenticated', 'This sign-in was revoked. Sign in again.')
  if (!(Date.parse(grant.expiresAt) > Date.now()))
    throw new HttpsError('unauthenticated', 'This sign-in expired. Sign in again.')
  if (!await userIsActive(grant.createdBy))
    throw new HttpsError('unauthenticated', 'The Hub account is disabled or removed.')
  return { id: grantSnap.id, ref: grantSnap.ref, data: grant }
}

exports.agentOAuth = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  try {
    await serveOAuth(req, res)
  }
  catch (error) {
    logger.error('Agent OAuth request failed', { error: error?.message })
    if (!res.headersSent)
      sendJson(res, 500, { error: 'server_error', error_description: 'Sign-in failed.' })
  }
})

exports.CMS_AGENT_OAUTH_CLIENTS = CLIENTS
exports.CMS_AGENT_OAUTH_SCOPE = SCOPE
exports.oauthUrls = oauthUrls
exports.bearerChallenge = bearerChallenge
exports.protectedResourceMetadata = protectedResourceMetadata
exports.verifyAccessToken = verifyAccessToken
// For tests.
exports.serveOAuth = serveOAuth
exports.readAuthorizeRequest = readAuthorizeRequest
exports.resetUserChecks = () => userChecks.clear()
