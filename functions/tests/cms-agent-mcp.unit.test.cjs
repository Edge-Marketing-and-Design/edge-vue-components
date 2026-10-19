const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const path = require('node:path')
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

const REMOTE_TOOLS = ['cms_agent_organizations', 'cms_open_session', 'cms_check_operation', 'cms_run_operation', 'cms_preview_url', 'cms_site_readiness', 'cms_list_pages', 'cms_get_page', 'cms_list_posts', 'cms_get_post']

const setup = async (t) => {
  const fake = createFakeDb({
    'organizations/a': { name: 'Org A' },
    'organizations/b': { name: 'Org B' },
    'organizations/a/sites/s': { name: 'Site A', menus: {} },
    'organizations/a/sites/t': { name: 'Other Site', menus: {} },
    'organizations/b/sites/s': { name: 'Site B', menus: {} },
    'organizations/a/sites/s/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
    'organizations/a/sites/t/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
    'organizations/b/sites/s/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
  })
  const allowed = new Set(['a'])
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const original = require.cache[configPath]
  const modulePaths = ['cmsAgentMcp.js', 'cmsAgentConnections.js', 'cmsAgentKeys.js', 'cmsOperations.js', 'cmsBlockRevisions.js'].map(file => require.resolve(path.join(functionRoot, file)))
  require.cache[configPath] = {
    id: configPath,
    loaded: true,
    exports: {
      admin: { firestore: { Timestamp } },
      db: fake.db,
      HttpsError,
      logger: { log() {}, error() {}, warn() {} },
      onCall: (_, handler) => handler,
      onRequest: (_, handler) => handler,
      permissionCheck: async (uid, action, path) => uid === 'admin' || (uid === 'owner' && action !== 'assign' && allowed.has(path.split('/')[1])),
    },
  }
  modulePaths.forEach(file => delete require.cache[file])
  const connections = require(path.join(functionRoot, 'cmsAgentConnections.js'))
  const keys = require(path.join(functionRoot, 'cmsAgentKeys.js'))
  const mcp = require(path.join(functionRoot, 'cmsAgentMcp.js'))
  modulePaths.forEach(file => delete require.cache[file])
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]

  const clock = { now: Date.now() }
  const remote = mcp.createRemoteCms({ now: () => clock.now })
  // An Express-like request/response around node:http, as Cloud Functions passes.
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req)
      raw += chunk
    const shimReq = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined, get: name => req.headers[name.toLowerCase()] }
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
      send(body) {
        res.end(body)
      },
    }
    await mcp.serveMcp(shimReq, shimRes, remote)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/`
  const created = await connections.createAgentConnection({ auth: { uid: 'owner' }, data: { uid: 'owner', orgId: 'a', name: 'Remote laptop' } })
  return { ...fake, allowed, connections, keys, mcp, remote, clock, url, created }
}

const connect = async (t, env, token = env.created.token) => {
  const client = new Client({ name: 'cms-agent-mcp-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(env.url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  t.after(() => client.close())
  return client
}
const callTool = async (client, name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text)
const initialize = (env, headers) => fetch(env.url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
})
const sessionCount = env => [...env.docs.keys()].filter(key => key.startsWith('agent-sessions/')).length
const pageOperation = { type: 'page.update', siteId: 's', pageId: 'home', fields: { metaTitle: 'Remote draft title' } }

test('missing, invalid, revoked, expired and non-connection credentials are refused before MCP', async (t) => {
  const env = await setup(t)
  const missing = await initialize(env, {})
  assert.equal(missing.status, 401)
  assert.match(missing.headers.get('www-authenticate'), /^Bearer /)
  assert.equal((await missing.json()).error.code, -32000)
  assert.equal((await initialize(env, { authorization: 'Bearer cmsac.nope' })).status, 401)
  const tampered = env.created.token.slice(0, -1) + (env.created.token.endsWith('A') ? 'B' : 'A')
  assert.equal((await initialize(env, { authorization: `Bearer ${tampered}` })).status, 401)
  const session = await env.connections.issueAgentSession(await env.connections.verifyConnection(`Bearer ${env.created.token}`), { orgId: 'a', scope: 'site', siteId: 's' })
  assert.equal((await initialize(env, { authorization: `Bearer ${session.token}` })).status, 401, 'a session credential is not a connection')
  assert.equal((await initialize(env, { authorization: `Bearer ${env.created.token}` })).status, 200)

  const docPath = `agent-connections/${env.created.connectionId}`
  const stored = env.docs.get(docPath)
  env.docs.set(docPath, { ...stored, expiresAt: '2000-01-01T00:00:00.000Z' })
  const expired = await initialize(env, { authorization: `Bearer ${env.created.token}` })
  assert.equal(expired.status, 401)
  assert.match((await expired.json()).error.message, /expired/)
  env.docs.set(docPath, stored)
  await env.connections.revokeAgentConnection({ auth: { uid: 'owner' }, data: { uid: 'owner', connectionId: env.created.connectionId } })
  const revoked = await initialize(env, { authorization: `Bearer ${env.created.token}` })
  assert.equal(revoked.status, 401)
  assert.match((await revoked.json()).error.message, /revoked/)
  assert.equal((await fetch(env.url)).status, 405, 'stateless: no GET stream')
})

test('a connection lists only the remote tools and reads and drafts through the Hub checks', async (t) => {
  const env = await setup(t)
  const client = await connect(t, env)
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), REMOTE_TOOLS)

  const orgs = await callTool(client, 'cms_agent_organizations', {})
  assert.deepEqual(orgs.organizations.map(org => org.orgId), ['a'])
  const pages = await callTool(client, 'cms_list_pages', { orgId: 'a', siteId: 's' })
  assert.equal(pages.ok, true)
  assert.equal(pages.siteName, 'Site A')
  const page = await callTool(client, 'cms_get_page', { orgId: 'a', siteId: 's', pageId: 'home' })
  assert.equal(page.pageId, 'home')

  const check = await callTool(client, 'cms_check_operation', { orgId: 'a', operation: pageOperation })
  assert.equal(check.ok, true)
  assert.ok(check.checksum)
  const run = await callTool(client, 'cms_run_operation', { orgId: 'a', operation: pageOperation, checksum: check.checksum })
  assert.equal(run.ok, true)
  assert.equal(env.docs.get('organizations/a/sites/s/pages/home').metaTitle, 'Remote draft title')
  const audit = env.docs.get(`cms-operations/${run.operationId}`)
  assert.equal(audit.agentConnectionId, env.created.connectionId)
  assert.equal(audit.runBy, 'owner')
  assert.equal(audit.client, 'edge-cms-remote-mcp')
  const posts = await callTool(client, 'cms_list_posts', { orgId: 'a', siteId: 's' })
  assert.equal(posts.ok, true, posts.message)
  assert.deepEqual(posts.posts, [])
  const missingPost = await callTool(client, 'cms_get_post', { orgId: 'a', siteId: 's', postId: 'absent' })
  assert.equal(missingPost.code, 'not-found')
  assert.equal(sessionCount(env), 1, 'one site session serves the page and post reads, the check and the run')
  assert.ok(!JSON.stringify([pages, page, check, run]).includes('cmsas.'), 'no session credential reaches the client')
})

test('organization and site scope are enforced on every call', async (t) => {
  const env = await setup(t)
  const client = await connect(t, env)
  const otherOrg = await callTool(client, 'cms_list_pages', { orgId: 'b', siteId: 's' })
  assert.equal(otherOrg.ok, false)
  assert.equal(otherOrg.code, 'permission-denied')
  assert.equal((await callTool(client, 'cms_get_page', { orgId: 'a', siteId: 'missing', pageId: 'home' })).code, 'not-found')
  assert.equal((await callTool(client, 'cms_list_pages', { siteId: 's' })).code, 'invalid-argument', 'orgId or sessionId is required')
  const publish = await callTool(client, 'cms_check_operation', { orgId: 'a', operation: { type: 'theme.update', themeId: 'x' } })
  assert.notEqual(publish.code, 'permission-denied', 'theme work runs as an organization session')

  const opened = await callTool(client, 'cms_open_session', { orgId: 'a', scope: 'site', siteId: 's' })
  assert.equal(opened.ok, true)
  assert.equal(opened.token, undefined)
  assert.match(opened.sessionId, /^[a-f0-9]{40}$/)
  const own = await callTool(client, 'cms_list_pages', { sessionId: opened.sessionId, siteId: 's' })
  assert.equal(own.siteName, 'Site A')
  const otherSite = await callTool(client, 'cms_list_pages', { sessionId: opened.sessionId, orgId: 'a', siteId: 't' })
  assert.equal(otherSite.code, 'permission-denied')
  assert.match(otherSite.message, /different site/)
  assert.equal((await callTool(client, 'cms_list_pages', { sessionId: opened.sessionId, orgId: 'b', siteId: 's' })).code, 'permission-denied')
  const blocked = await callTool(client, 'cms_check_operation', { sessionId: opened.sessionId, orgId: 'a', operation: { type: 'theme.update', themeId: 'x' } })
  assert.equal(blocked.code, 'permission-denied', 'a site session cannot do theme work')
  assert.equal((await callTool(client, 'cms_list_posts', { sessionId: opened.sessionId, orgId: 'a', siteId: 't' })).code, 'permission-denied', 'post reads stay on the session\'s site')

  const second = await env.connections.createAgentConnection({ auth: { uid: 'owner' }, data: { uid: 'owner', orgId: 'a', name: 'Second device' } })
  const other = await connect(t, env, second.token)
  const foreign = await callTool(other, 'cms_list_pages', { sessionId: opened.sessionId, orgId: 'a', siteId: 's' })
  assert.equal(foreign.code, 'permission-denied', 'another connection cannot use this handle')

  env.allowed.delete('a')
  const lost = await callTool(client, 'cms_list_pages', { orgId: 'a', siteId: 's' })
  assert.equal(lost.code, 'permission-denied', 'lost Hub access stops a cached session')
})

test('sessions are reused, renewed before expiry and reissued when the Hub stops accepting them', async (t) => {
  const env = await setup(t)
  const client = await connect(t, env)
  const read = () => callTool(client, 'cms_list_pages', { orgId: 'a', siteId: 's' })
  assert.equal((await read()).ok, true)
  assert.equal((await read()).ok, true)
  assert.equal(sessionCount(env), 1)
  env.clock.now += 14.5 * 60 * 1000
  assert.equal((await read()).ok, true)
  assert.equal(sessionCount(env), 2, 'renewed within a minute of expiry')
  const [latest] = [...env.remote.sessions.values()]
  env.docs.set(`agent-sessions/${latest.sessionId}`, { ...env.docs.get(`agent-sessions/${latest.sessionId}`), expiresAt: '2000-01-01T00:00:00.000Z' })
  assert.equal((await read()).ok, true)
  assert.equal(sessionCount(env), 3, 'a session the Hub refuses is replaced once')
  assert.equal((await callTool(client, 'cms_check_operation', { orgId: 'a', operation: { type: 'block.draft', docId: 'missing' } })).ok, false)
  assert.equal(sessionCount(env), 4, 'organization work uses its own session')

  await env.connections.revokeAgentConnection({ auth: { uid: 'owner' }, data: { uid: 'owner', connectionId: env.created.connectionId } })
  const connection = { id: env.created.connectionId, ref: env.db.collection('agent-connections').doc(env.created.connectionId), data: env.docs.get(`agent-connections/${env.created.connectionId}`) }
  const stale = await env.remote.handlers({ ...connection, data: { ...connection.data, revokedAt: null } }).cms_list_pages({ orgId: 'a', siteId: 's' })
  assert.equal(JSON.parse(stale.content[0].text).code, 'unauthenticated', 'a revoked parent stops cached sessions')
})
