const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { existsSync } = require('node:fs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')
const fromFunctions = name => require(require.resolve(name, { paths: [functionRoot] }))
const { Timestamp } = fromFunctions('firebase-admin/firestore')
const { Client } = fromFunctions('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = fromFunctions('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { createFakeDb } = require('./support/fakeFirestore.cjs')

class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const HUB = 'https://hub.example.com'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const DAY_MS = 86400000

const setup = async (t) => {
  const fake = createFakeDb({
    'users/owner': { roles: [] },
    'users/viewer': { roles: [] },
    'organizations/a': { name: 'Org A' },
    'organizations/b': { name: 'Org B' },
    'organizations/a/sites/s': { name: 'Site A', menus: {} },
    'organizations/a/sites/s/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
  })
  const allowed = new Set(['a'])
  const disabled = new Set()
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const original = require.cache[configPath]
  const modulePaths = ['cmsAgentMcp.js', 'cmsAgentOAuth.js', 'cmsAgentConnections.js', 'cmsAgentKeys.js', 'cmsAgentLibraryReads.js', 'cmsAgentContractNotes.js', 'cmsOperations.js', 'cmsBlockRevisions.js'].map(file => require.resolve(path.join(functionRoot, file)))
  require.cache[configPath] = {
    id: configPath,
    loaded: true,
    exports: {
      admin: {
        firestore: { Timestamp },
        auth: () => ({
          async getUser(uid) {
            if (!fake.docs.has(`users/${uid}`)) {
              const error = new Error('no user')
              error.code = 'auth/user-not-found'
              throw error
            }
            return { uid, disabled: disabled.has(uid) }
          },
        }),
      },
      db: fake.db,
      HttpsError,
      logger: { log() {}, error() {}, warn() {} },
      onCall: (_, handler) => handler,
      onRequest: (_, handler) => handler,
      permissionCheck: async (uid, action, docPath) => uid === 'owner' && action !== 'assign' && allowed.has(docPath.split('/')[1]),
    },
  }
  modulePaths.forEach(file => delete require.cache[file])
  const connections = require(path.join(functionRoot, 'cmsAgentConnections.js'))
  const oauth = require(path.join(functionRoot, 'cmsAgentOAuth.js'))
  const mcp = require(path.join(functionRoot, 'cmsAgentMcp.js'))
  modulePaths.forEach(file => delete require.cache[file])
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]

  const remote = mcp.createRemoteCms()
  // /oauth/* goes to cms-agentOAuth, /mcp* to cms-agentMcp, as Express-like
  // request/response objects around node:http.
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req)
      raw += chunk
    const url = new URL(req.url, 'http://local')
    const form = String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')
    const body = !raw ? undefined : form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)
    const shimReq = { method: req.method, url: req.url, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body, get: name => req.headers[name.toLowerCase()] }
    const shimRes = {
      get headersSent() {
        return res.headersSent
      },
      status(code) {
        res.statusCode = code
        return this
      },
      set(name, value) {
        res.setHeader(name, value)
        return this
      },
      json(data) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(data))
      },
      send(data) {
        res.end(data)
      },
    }
    if (url.pathname.startsWith('/oauth'))
      await oauth.serveOAuth(shimReq, shimRes)
    else
      await mcp.serveMcp(shimReq, shimRes, remote)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const saved = { hub: process.env.CMS_AGENT_HUB_URL, mcp: process.env.CMS_AGENT_MCP_URL, oauth: process.env.CMS_AGENT_OAUTH_URL }
  process.env.CMS_AGENT_HUB_URL = HUB
  process.env.CMS_AGENT_MCP_URL = `${base}/mcp`
  process.env.CMS_AGENT_OAUTH_URL = `${base}/oauth`
  t.after(async () => {
    for (const [name, value] of [['CMS_AGENT_HUB_URL', saved.hub], ['CMS_AGENT_MCP_URL', saved.mcp], ['CMS_AGENT_OAUTH_URL', saved.oauth]]) {
      if (value === undefined)
        delete process.env[name]
      else
        process.env[name] = value
    }
    await new Promise(resolve => server.close(resolve))
  })
  oauth.resetUserChecks()
  return { ...fake, allowed, disabled, connections, oauth, mcp, base, mcpUrl: `${base}/mcp` }
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}
const authorizeParams = (env, overrides = {}) => ({
  response_type: 'code',
  client_id: CLAUDE,
  redirect_uri: CALLBACK,
  state: 'state-123',
  code_challenge: overrides.challenge || pkce().challenge,
  code_challenge_method: 'S256',
  resource: env.mcpUrl,
  scope: 'cms-drafts',
  ...overrides,
})
const authorize = (env, params) => fetch(`${env.base}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: 'manual' })
const caller = (uid, data) => ({ auth: { uid }, data: { uid, ...data } })
const approve = async (env, params, uid = 'owner') => new URL((await env.oauth.decideAgentAuthorization(caller(uid, { request: params, allow: true }))).redirectUrl)
const tokenRequest = (env, fields) => fetch(`${env.base}/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
})
// The whole sign-in: authorize, approve, exchange. Returns the token response.
const signIn = async (env, { clientId = CLAUDE, redirectUri = CALLBACK } = {}) => {
  const { verifier, challenge } = pkce()
  const params = authorizeParams(env, { client_id: clientId, redirect_uri: redirectUri, challenge, code_challenge: challenge })
  const code = (await approve(env, params)).searchParams.get('code')
  const response = await tokenRequest(env, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: env.mcpUrl })
  assert.equal(response.status, 200)
  return response.json()
}
const initialize = (env, token) => fetch(env.mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
})
const grantOf = (env, accessToken) => {
  const id = accessToken.split('.')[1]
  const connectionId = env.docs.get(`agent-oauth-tokens/${id}`).connectionId
  return { connectionId, path: `agent-connections/${connectionId}` }
}

test('discovery: the 401 points to the protected resource document, which points to the Hub issuer', async (t) => {
  const env = await setup(t)
  const missing = await initialize(env)
  assert.equal(missing.status, 401)
  assert.equal(missing.headers.get('www-authenticate'), `Bearer resource_metadata="${env.mcpUrl}/.well-known/oauth-protected-resource", scope="cms-drafts"`)
  const invalid = await initialize(env, 'cmsat.nope')
  assert.match(invalid.headers.get('www-authenticate'), /^Bearer error="invalid_token", resource_metadata="/)

  const resource = await (await fetch(`${env.mcpUrl}/.well-known/oauth-protected-resource`)).json()
  assert.deepEqual(resource, { resource: env.mcpUrl, authorization_servers: [HUB], scopes_supported: ['cms-drafts'], bearer_methods_supported: ['header'], resource_name: 'Edge CMS' })
  const metadata = await (await fetch(`${env.base}/oauth/.well-known/oauth-authorization-server`)).json()
  assert.equal(metadata.issuer, HUB)
  assert.equal(metadata.authorization_endpoint, `${env.base}/oauth/authorize`)
  assert.equal(metadata.token_endpoint, `${env.base}/oauth/token`)
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none'])
  assert.equal(metadata.client_id_metadata_document_supported, true)
  assert.equal(metadata.registration_endpoint, undefined, 'no dynamic registration')
})

test('without CMS_AGENT_HUB_URL sign-in is off and the MCP answers as before', async (t) => {
  const env = await setup(t)
  delete process.env.CMS_AGENT_HUB_URL
  const missing = await initialize(env)
  assert.equal(missing.status, 401)
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer error="invalid_token"')
  assert.equal((await fetch(`${env.mcpUrl}/.well-known/oauth-protected-resource`)).status, 405)
  assert.equal((await fetch(`${env.base}/oauth/.well-known/oauth-authorization-server`)).status, 404)
})

test('authorize: untrusted clients and return addresses get an error page; other problems go back to the client', async (t) => {
  const env = await setup(t)
  const page = async (params) => {
    const response = await authorize(env, params)
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('location'), null, 'never redirected')
    return response.text()
  }
  assert.match(await page(authorizeParams(env, { client_id: 'https://evil.example/client.json' })), /not allowed/)
  assert.match(await page(authorizeParams(env, { redirect_uri: 'https://evil.example/callback' })), /return address/)
  assert.match(await page(authorizeParams(env, { redirect_uri: `${CALLBACK}?x=1` })), /return address/)
  assert.match(await page(authorizeParams(env, { client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:4000/other' })), /return address/)
  assert.match(await page(authorizeParams(env, { client_id: CLAUDE, redirect_uri: 'http://localhost:4000/callback' })), /return address/, 'loopback only for Claude Code')

  const back = async (params, error) => {
    const response = await authorize(env, params)
    assert.equal(response.status, 302)
    const location = new URL(response.headers.get('location'))
    assert.equal(`${location.origin}${location.pathname}`, CALLBACK)
    assert.equal(location.searchParams.get('error'), error)
    assert.equal(location.searchParams.get('state'), 'state-123')
    assert.equal(location.searchParams.get('iss'), HUB)
  }
  await back(authorizeParams(env, { code_challenge: '' }), 'invalid_request')
  await back(authorizeParams(env, { code_challenge_method: 'plain' }), 'invalid_request')
  await back(authorizeParams(env, { resource: 'https://other.example/mcp' }), 'invalid_target')
  await back(authorizeParams(env, { scope: 'cms-drafts admin' }), 'invalid_scope')
  await back(authorizeParams(env, { response_type: 'token' }), 'unsupported_response_type')

  const ok = await authorize(env, authorizeParams(env, { client_id: CLAUDE_CODE, redirect_uri: 'http://127.0.0.1:53111/callback', scope: 'cms-drafts offline_access' }))
  assert.equal(ok.status, 302)
  const consent = new URL(ok.headers.get('location'))
  assert.equal(`${consent.origin}${consent.pathname}`, `${HUB}/app/agent-authorize`)
  assert.equal(consent.searchParams.get('client_id'), CLAUDE_CODE)
  assert.equal(consent.searchParams.get('redirect_uri'), 'http://127.0.0.1:53111/callback')
  assert.equal([...env.docs.keys()].filter(key => key.startsWith('agent-oauth')).length, 0, 'nothing stored before sign-in')
})

test('the consent calls check the caller, describe the request, and only store a code on Allow', async (t) => {
  const env = await setup(t)
  const params = authorizeParams(env)
  await assert.rejects(env.oauth.describeAgentAuthorization({ data: { uid: 'owner', request: params } }), { code: 'unauthenticated' })
  await assert.rejects(env.oauth.describeAgentAuthorization({ auth: { uid: 'owner' }, data: { uid: 'other', request: params } }), { code: 'permission-denied' })
  await assert.rejects(env.oauth.describeAgentAuthorization(caller('owner', { request: { ...params, client_id: 'https://evil.example/c' } })), { code: 'invalid-argument' })

  const described = await env.oauth.describeAgentAuthorization(caller('owner', { request: params }))
  assert.deepEqual(described, { client: { id: CLAUDE, name: 'Claude', host: 'claude.ai' }, redirectHost: 'claude.ai', loopback: false, organizations: ['Org A'], idleDays: 30, maxDays: 90 })
  const loopback = await env.oauth.describeAgentAuthorization(caller('owner', { request: authorizeParams(env, { client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:3118/callback' }) }))
  assert.equal(loopback.loopback, true)
  assert.equal(loopback.redirectHost, 'localhost:3118')

  const cancelled = new URL((await env.oauth.decideAgentAuthorization(caller('owner', { request: params, allow: false }))).redirectUrl)
  assert.equal(cancelled.searchParams.get('error'), 'access_denied')
  assert.equal(cancelled.searchParams.get('state'), 'state-123')
  await assert.rejects(env.oauth.decideAgentAuthorization(caller('viewer', { request: params, allow: true })), { code: 'permission-denied' }, 'no CMS edit rights anywhere')
  assert.equal([...env.docs.keys()].filter(key => key.startsWith('agent-oauth-codes/')).length, 0)

  const approved = await approve(env, params)
  assert.equal(`${approved.origin}${approved.pathname}`, CALLBACK)
  assert.equal(approved.searchParams.get('state'), 'state-123')
  assert.equal(approved.searchParams.get('iss'), HUB)
  const code = approved.searchParams.get('code')
  assert.match(code, /^cmsoc\.[a-f0-9]{40}\.[\w-]{43}$/)
  const stored = env.docs.get(`agent-oauth-codes/${code.split('.')[1]}`)
  assert.equal(stored.uid, 'owner')
  assert.ok(!JSON.stringify(stored).includes(code.split('.')[2]), 'only the hash is stored')
})

test('code exchange checks the verifier, client, return address and expiry, and a reused code revokes its grant', async (t) => {
  const env = await setup(t)
  const { verifier, challenge } = pkce()
  const params = authorizeParams(env, { challenge, code_challenge: challenge })
  const code = (await approve(env, params)).searchParams.get('code')
  const exchange = fields => tokenRequest(env, { grant_type: 'authorization_code', client_id: CLAUDE, code, code_verifier: verifier, redirect_uri: CALLBACK, ...fields })
  const error = async (response, status, expected) => {
    assert.equal(response.status, status)
    assert.equal((await response.json()).error, expected)
  }
  await error(await exchange({ client_id: 'https://evil.example/c' }), 401, 'invalid_client')
  await error(await exchange({ code_verifier: pkce().verifier }), 400, 'invalid_grant')
  await error(await exchange({ redirect_uri: 'https://claude.ai/other' }), 400, 'invalid_grant')
  await error(await exchange({ client_id: CLAUDE_CODE }), 400, 'invalid_grant')
  await error(await exchange({ resource: 'https://other.example/mcp' }), 400, 'invalid_target')
  await error(await exchange({ grant_type: 'password' }), 400, 'unsupported_grant_type')

  const response = await exchange({})
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const tokens = await response.json()
  assert.equal(tokens.token_type, 'Bearer')
  assert.equal(tokens.expires_in, 3600)
  assert.equal(tokens.scope, 'cms-drafts')
  assert.match(tokens.access_token, /^cmsat\./)
  assert.match(tokens.refresh_token, /^cmsrt\./)
  const { path: grantPath } = grantOf(env, tokens.access_token)
  const grant = env.docs.get(grantPath)
  assert.equal(grant.kind, 'oauth')
  assert.equal(grant.createdBy, 'owner')
  assert.equal(grant.name, 'Claude (claude.ai)')
  assert.deepEqual(grant.client, { id: CLAUDE, name: 'Claude', host: 'claude.ai' })
  assert.equal(Date.parse(grant.maxExpiresAt) - Date.parse(grant.createdAt), 90 * DAY_MS)
  assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.createdAt), 30 * DAY_MS)

  await error(await exchange({}), 400, 'invalid_grant')
  assert.ok(env.docs.get(grantPath).revokedAt, 'the reused code revoked the grant')
  assert.equal((await initialize(env, tokens.access_token)).status, 401)

  const late = authorizeParams(env, { challenge, code_challenge: challenge })
  const lateCode = (await approve(env, late)).searchParams.get('code')
  const codePath = `agent-oauth-codes/${lateCode.split('.')[1]}`
  env.docs.set(codePath, { ...env.docs.get(codePath), expiresAt: '2000-01-01T00:00:00.000Z' })
  await error(await tokenRequest(env, { grant_type: 'authorization_code', client_id: CLAUDE, code: lateCode, code_verifier: verifier, redirect_uri: CALLBACK }), 400, 'invalid_grant')
})

test('refresh rotates the token, a rotated-away token revokes the grant, and grants expire', async (t) => {
  const env = await setup(t)
  const first = await signIn(env)
  const { path: grantPath } = grantOf(env, first.access_token)
  const refresh = (token, clientId = CLAUDE) => tokenRequest(env, { grant_type: 'refresh_token', client_id: clientId, refresh_token: token, resource: env.mcpUrl })

  assert.equal((await (await refresh(first.refresh_token, CLAUDE_CODE)).json()).error, 'invalid_grant', 'refresh is bound to its client')
  const second = await (await refresh(first.refresh_token)).json()
  assert.match(second.access_token, /^cmsat\./)
  assert.notEqual(second.refresh_token, first.refresh_token)
  assert.equal(grantOf(env, second.access_token).path, grantPath, 'same grant')
  const third = await (await refresh(second.refresh_token)).json()
  assert.ok(third.refresh_token)

  const reused = await refresh(first.refresh_token)
  assert.equal(reused.status, 400)
  assert.equal((await reused.json()).error, 'invalid_grant')
  assert.ok(env.docs.get(grantPath).revokedAt, 'replaying an old refresh token revokes the grant')
  assert.equal((await (await refresh(third.refresh_token)).json()).error, 'invalid_grant')
  assert.equal((await initialize(env, third.access_token)).status, 401)

  const idle = await signIn(env)
  const idlePath = grantOf(env, idle.access_token).path
  env.docs.set(idlePath, { ...env.docs.get(idlePath), expiresAt: '2000-01-01T00:00:00.000Z' })
  assert.equal((await (await refresh(idle.refresh_token)).json()).error, 'invalid_grant', 'idle for 30 days')

  const capped = await signIn(env)
  const cappedPath = grantOf(env, capped.access_token).path
  const soon = new Date(Date.now() + DAY_MS).toISOString()
  env.docs.set(cappedPath, { ...env.docs.get(cappedPath), maxExpiresAt: soon })
  const renewed = await (await refresh(capped.refresh_token)).json()
  assert.equal(env.docs.get(cappedPath).expiresAt, soon, 'never past 90 days from sign-in')
  assert.ok(renewed.expires_in <= 3600)
})

test('Codex signs in with its published client id and a loopback return address', async (t) => {
  const env = await setup(t)
  const codex = 'https://chatgpt.com/oauth/codex/client.json'
  const tokens = await signIn(env, { clientId: codex, redirectUri: 'http://127.0.0.1:1455/callback' })
  assert.equal((await initialize(env, tokens.access_token)).status, 200)
  assert.equal(env.docs.get(grantOf(env, tokens.access_token).path).name, 'Codex')
  assert.equal((await authorize(env, authorizeParams(env, { client_id: codex, redirect_uri: 'http://127.0.0.1:1455/callback/abc' }))).status, 400, 'per-server callback paths are not registered')
})

test('an OAuth access token gets the remote tools with the person\'s current Hub rights', async (t) => {
  const env = await setup(t)
  const tokens = await signIn(env, { clientId: CLAUDE_CODE, redirectUri: 'http://localhost:3118/callback' })
  const client = new Client({ name: 'oauth-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }))
  t.after(() => client.close())
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text)
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'cms_agent_organizations'))
  assert.deepEqual((await call('cms_agent_organizations', {})).organizations.map(org => org.orgId), ['a'])
  const pages = await call('cms_list_pages', { orgId: 'a', siteId: 's' })
  assert.equal(pages.ok, true, pages.message)
  const { connectionId } = grantOf(env, tokens.access_token)
  const session = [...env.docs.entries()].find(([key]) => key.startsWith('agent-sessions/'))[1]
  assert.equal(session.connectionId, connectionId, 'sessions hang off the grant')
  assert.equal(session.createdBy, 'owner')

  env.allowed.delete('a')
  assert.deepEqual((await call('cms_agent_organizations', {})).organizations, [], 'a removed role applies to the next call')
  assert.equal((await call('cms_list_pages', { orgId: 'a', siteId: 's' })).code, 'permission-denied')
})

test('access tokens are refused when expired, for another server, revoked, or the account is disabled', async (t) => {
  const env = await setup(t)
  const tokens = await signIn(env)
  assert.equal((await initialize(env, tokens.access_token)).status, 200)
  const tokenPath = `agent-oauth-tokens/${tokens.access_token.split('.')[1]}`
  const stored = env.docs.get(tokenPath)
  env.docs.set(tokenPath, { ...stored, expiresAt: '2000-01-01T00:00:00.000Z' })
  assert.equal((await initialize(env, tokens.access_token)).status, 401)
  env.docs.set(tokenPath, { ...stored, resource: 'https://other.example/cms-agentMcp' })
  assert.match((await (await initialize(env, tokens.access_token)).json()).error.message, /different server/)
  env.docs.set(tokenPath, stored)
  const tampered = tokens.access_token.slice(0, -1) + (tokens.access_token.endsWith('A') ? 'B' : 'A')
  assert.equal((await initialize(env, tampered)).status, 401)

  env.disabled.add('owner')
  assert.equal((await initialize(env, tokens.access_token)).status, 200, 'the account check is cached for 5 minutes')
  env.oauth.resetUserChecks()
  const disabled = await initialize(env, tokens.access_token)
  assert.equal(disabled.status, 401)
  assert.match((await disabled.json()).error.message, /disabled or removed/)
  env.disabled.delete('owner')
  env.oauth.resetUserChecks()

  const { connectionId } = grantOf(env, tokens.access_token)
  await assert.rejects(env.connections.renewAgentConnection(caller('owner', { orgId: 'a', connectionId })), { code: 'failed-precondition' })
  const listed = await env.connections.listAgentConnections(caller('owner', {}))
  assert.deepEqual(listed.connections.map(({ kind, client, name }) => ({ kind, client, name })), [{ kind: 'oauth', client: { id: CLAUDE, name: 'Claude', host: 'claude.ai' }, name: 'Claude (claude.ai)' }])
  assert.ok(!JSON.stringify(listed).includes('refreshHash'))
  await env.connections.revokeAgentConnection(caller('owner', { connectionId }))
  const revoked = await initialize(env, tokens.access_token)
  assert.equal(revoked.status, 401)
  assert.match((await revoked.json()).error.message, /revoked/)
})

test('OAuth tokens and grants never pass as Hub connection credentials', async (t) => {
  const env = await setup(t)
  const tokens = await signIn(env)
  const { connectionId } = grantOf(env, tokens.access_token)
  await assert.rejects(env.connections.verifyConnection(`Bearer ${tokens.access_token}`), { code: 'unauthenticated' })
  await assert.rejects(env.connections.verifyConnection(`Bearer cmsac.${connectionId}.${tokens.refresh_token.split('.')[2]}`), { code: 'unauthenticated' })
  await assert.rejects(env.oauth.verifyAccessToken(`Bearer ${tokens.refresh_token}`), { code: 'unauthenticated' })
})
