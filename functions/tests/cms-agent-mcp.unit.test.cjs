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

const REMOTE_TOOLS = ['cms_find_block', 'cms_audit_blocks', 'cms_find_usage', 'cms_validate', 'cms_render_block', 'cms_find_theme', 'cms_get_theme', 'cms_contract', 'cms_schema', 'cms_guide', 'cms_agent_organizations', 'cms_list_sites', 'cms_open_session', 'cms_check_operation', 'cms_run_operation', 'cms_preview_url', 'cms_site_readiness', 'cms_list_pages', 'cms_get_page', 'cms_list_posts', 'cms_get_post', 'cms_block_base']

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
    'organizations/a/blocks/hero': { name: 'Hero', content: '<section>{{{#text {"field":"headline","value":"Welcome"}}}}</section>', values: { headline: 'Welcome' }, tags: ['Hero'], themes: ['main'], synced: false, version: 1, templateVersion: 1 },
    'organizations/a/blocks/footer': { name: 'Footer', content: '<footer>Footer</footer>', values: {}, tags: ['Footer'], themes: ['main'], synced: false, version: 1 },
    'organizations/a/themes/main': { name: 'Main theme', theme: '{"colors":{"primary":"#123456"}}', headJSON: '{}', extraCSS: '.x{}' },
    'organizations/a/sites/s/pages/about': { name: 'About', content: { main: [{ id: 'instance-1', blockId: 'hero', name: 'Hero' }] }, structure: [], version: 1 },
  })
  const allowed = new Set(['a'])
  // Rights withheld from the owner, as "action:path".
  const denied = new Set()
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const original = require.cache[configPath]
  const modulePaths = ['cmsAgentMcp.js', 'cmsAgentConnections.js', 'cmsAgentKeys.js', 'cmsAgentLibraryReads.js', 'cmsAgentRender.js', 'cmsAgentContractNotes.js', 'cmsOperations.js', 'cmsBlockRevisions.js'].map(file => require.resolve(path.join(functionRoot, file)))
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
      permissionCheck: async (uid, action, path) => !denied.has(`${action}:${path}`) && (uid === 'admin' || (uid === 'owner' && action !== 'assign' && allowed.has(path.split('/')[1]))),
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
  return { ...fake, allowed, denied, connections, keys, mcp, remote, clock, url, created }
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

test('the endpoint deploys in the cms group as cms-agentMcp', () => {
  const { readFileSync } = require('node:fs')
  const cms = readFileSync(path.join(functionRoot, 'cms.js'), 'utf8')
  assert.match(cms, /^const cmsAgentMcp = require\('\.\/cmsAgentMcp'\)$/m)
  assert.match(cms, /^exports\.agentMcp = cmsAgentMcp\.agentMcp$/m)
  assert.match(readFileSync(path.join(functionRoot, 'index.js'), 'utf8'), /^exports\.cms = require\('\.\/cms'\)$/m)
  assert.doesNotMatch(readFileSync(path.join(functionRoot, 'index.js'), 'utf8'), /cmsAgentMcp/, 'exported once, from cms.js')
})

const readAudits = env => [...env.docs.entries()].filter(([key]) => /^organizations\/a\/cmsAgentReads\//.test(key)).map(([, value]) => value)

test('library reads run as the operator through an organization session and are audited without content', async (t) => {
  const env = await setup(t)
  const added = []
  env.hooks.beforeAdd = (path, data) => added.push({ path, data })
  const client = await connect(t, env)

  const blocks = await callTool(client, 'cms_find_block', { orgId: 'a', query: 'hero' })
  assert.equal(blocks.ok, true, blocks.message)
  assert.deepEqual(blocks.matches.map(match => match.docId), ['hero'])
  const base = await callTool(client, 'cms_block_base', { orgId: 'a', docId: 'hero' })
  assert.equal(base.startsFrom, 'released')
  assert.match(base.baseHash, /^[0-9a-f]+$/)
  assert.match(base.definition.content, /headline/)
  assert.equal((await callTool(client, 'cms_block_base', { orgId: 'a', docId: 'missing' })).code, 'not-found')
  const themes = await callTool(client, 'cms_find_theme', { orgId: 'a' })
  assert.deepEqual(themes.matches.map(match => match.themeId), ['main'])
  const theme = await callTool(client, 'cms_get_theme', { orgId: 'a', themeId: 'main' })
  assert.equal(theme.themeJSON.parsed.colors.primary, '#123456')
  assert.equal(theme.extraCSS, '.x{}')
  assert.equal((await callTool(client, 'cms_get_theme', { orgId: 'a', themeId: 'missing' })).code, 'not-found')
  const usage = await callTool(client, 'cms_find_usage', { orgId: 'a', docId: 'hero' })
  assert.deepEqual(usage.usages.map(item => [item.siteId, item.pageId, item.instanceId]), [['s', 'about', 'instance-1']])
  const audit = await callTool(client, 'cms_audit_blocks', { orgId: 'a', includeRender: false })
  assert.equal(audit.ok, true, audit.message)
  assert.equal(audit.summary.blocks, 2)
  assert.equal(audit.reportPath, undefined, 'no local report file remotely')
  assert.ok(Array.isArray(audit.blocksWithErrors))
  assert.equal(sessionCount(env), 1, 'one organization session serves every library read')

  const records = added.filter(entry => entry.path === 'organizations/a/cmsAgentReads')
  assert.deepEqual(records.map(entry => entry.data.tool), ['blocks', 'block', 'themes', 'theme', 'usage', 'audit'], 'refused reads are not recorded')
  for (const { data } of records) {
    assert.equal(data.runBy, 'owner')
    assert.equal(data.connectionId, env.created.connectionId)
    assert.ok(data.expiresAt instanceof Timestamp)
    assert.ok(Math.abs(data.expiresAt.toMillis() - Date.parse(data.at) - 90 * 86400000) < 1000)
    assert.ok(!/headline|Welcome|#123456|<section>/.test(JSON.stringify(data)), 'no content or values in the audit')
  }
  assert.deepEqual(records[0].data.docIds, ['hero'])
  assert.equal(records[4].data.resultCount, 1)
})

test('library reads need current read rights and an organization session', async (t) => {
  const env = await setup(t)
  const client = await connect(t, env)
  env.denied.add('read:organizations/a/themes')
  const theme = await callTool(client, 'cms_get_theme', { orgId: 'a', themeId: 'main' })
  assert.equal(theme.code, 'permission-denied')
  assert.equal((await callTool(client, 'cms_audit_blocks', { orgId: 'a', includeRender: false })).code, 'permission-denied', 'the audit reads themes too')
  assert.equal((await callTool(client, 'cms_find_block', { orgId: 'a' })).ok, true, 'block reads are a separate right')
  env.denied.add('read:organizations/a/sites')
  assert.equal((await callTool(client, 'cms_find_usage', { orgId: 'a', docId: 'hero' })).code, 'permission-denied', 'usage scans pages')
  assert.equal(readAudits(env).length, 1, 'only the allowed read was recorded')

  // The Hub refuses library reads on a site session, whoever sends it.
  const connection = await env.connections.verifyConnection(`Bearer ${env.created.token}`)
  const site = await env.connections.issueAgentSession(connection, { orgId: 'a', scope: 'site', siteId: 's' })
  await assert.rejects(env.keys.handleAgentRequest({ header: `Bearer ${site.token}`, body: { orgId: 'a', action: 'blocks' } }), { code: 'permission-denied' })
  const org = await env.connections.issueAgentSession(connection, { orgId: 'a', scope: 'organization' })
  assert.equal((await env.keys.handleAgentRequest({ header: `Bearer ${org.token}`, body: { orgId: 'a', action: 'blocks' } })).returnedDocuments, 2)
  assert.equal((await callTool(client, 'cms_find_block', { orgId: 'b' })).code, 'permission-denied', 'no rights in another organization')
})

test('cms_list_sites lists the organization\'s sites without the templates site, with read rights', async (t) => {
  const env = await setup(t)
  env.docs.set('organizations/a/sites/templates', { name: 'Templates' })
  env.docs.get('organizations/a/sites/s').domains = ['a.example.com']
  env.docs.get('organizations/a/sites/s').theme = 'main'
  const client = await connect(t, env)
  const listed = await callTool(client, 'cms_list_sites', { orgId: 'a' })
  assert.equal(listed.ok, true, listed.message)
  assert.deepEqual(listed.sites, [
    { siteId: 's', name: 'Site A', domains: ['a.example.com'], canonicalDomain: '', theme: 'main' },
    { siteId: 't', name: 'Other Site', domains: [], canonicalDomain: '', theme: '' },
  ])
  assert.equal(listed.scanTruncated, false)
  assert.deepEqual(readAudits(env).map(record => [record.tool, record.docIds]), [['sites', ['s', 't']]])
  env.denied.add('read:organizations/a/sites')
  assert.equal((await callTool(client, 'cms_list_sites', { orgId: 'a' })).code, 'permission-denied')
  assert.equal((await callTool(client, 'cms_list_sites', { orgId: 'b' })).code, 'permission-denied', 'no rights in another organization')
})

test('a failed audit write never fails the read', async (t) => {
  const env = await setup(t)
  env.hooks.beforeAdd = () => {
    throw new Error('audit write failed')
  }
  const client = await connect(t, env)
  const blocks = await callTool(client, 'cms_find_block', { orgId: 'a' })
  assert.equal(blocks.ok, true)
  assert.equal(blocks.returnedDocuments, 2)
  assert.equal(readAudits(env).length, 0)
})

test('cms_validate checks an inline definition or a library block\'s current definition', async (t) => {
  const env = await setup(t)
  const added = []
  env.hooks.beforeAdd = (path, data) => added.push({ path, data })
  const client = await connect(t, env)

  const inline = await callTool(client, 'cms_validate', { orgId: 'a', definition: { name: 'Card', content: '<div>{{{#text {"field":"title","value":"Hi"}}}}</div>', values: {} } })
  assert.equal(inline.ok, true, inline.message)
  assert.equal(inline.source, 'definition')
  assert.equal(inline.valid, true, JSON.stringify(inline.errors))
  assert.equal(inline.renderingOwner, 'unchecked')
  assert.ok(!inline.info.some(line => /falls back to CMS HTML/.test(line)), 'no renderer claim it cannot check')

  const broken = await callTool(client, 'cms_validate', { orgId: 'a', definition: { name: 'Broken', templateVersion: 2, content: '<div><span>a</div>', template: '<div><span>a</div>' } })
  assert.equal(broken.ok, true)
  assert.equal(broken.valid, false)
  assert.ok(broken.errors.length > 0)
  assert.ok(broken.issues.some(issue => issue.code === 'grammar.unbalanced-html'))

  const released = await callTool(client, 'cms_validate', { orgId: 'a', docId: 'hero' })
  assert.equal(released.source, 'released')
  assert.equal(released.docId, 'hero')
  env.docs.set('organizations/a/blocks/hero', { ...env.docs.get('organizations/a/blocks/hero'), draftRevision: 2 })
  env.docs.set('organizations/a/blocks/hero/revisions/2', { status: 'draft', definition: { templateVersion: 2, content: '<section><div>x</section>', template: '<section><div>x</section>' } })
  const draft = await callTool(client, 'cms_validate', { orgId: 'a', docId: 'hero' })
  assert.equal(draft.source, 'draft')
  assert.equal(draft.valid, false, 'the open draft is what gets validated')

  assert.equal((await callTool(client, 'cms_validate', { orgId: 'a', docId: 'missing' })).code, 'not-found')
  assert.equal((await callTool(client, 'cms_validate', { orgId: 'a' })).code, 'invalid-argument')
  const oversized = await callTool(client, 'cms_validate', { orgId: 'a', definition: { name: 'Big', content: 'x'.repeat(1024 * 1024 + 1) } })
  assert.equal(oversized.code, 'invalid-argument')

  const records = added.filter(entry => entry.path === 'organizations/a/cmsAgentReads').map(entry => entry.data)
  assert.deepEqual(records.map(entry => entry.tool), ['validate', 'validate', 'validate', 'validate'])
  assert.deepEqual(records.map(entry => entry.docIds), [[], [], ['hero'], ['hero']], 'inline definitions are not named in the audit')
  assert.ok(!JSON.stringify(records).includes('Card'), 'no content in the audit')
  env.denied.add('read:organizations/a/blocks')
  assert.equal((await callTool(client, 'cms_validate', { orgId: 'a', docId: 'hero' })).code, 'permission-denied')
})

test('the remote server sends its rules on initialize and serves the guide and this Hub\'s contracts', async (t) => {
  const env = await setup(t)
  const client = await connect(t, env)
  assert.match(client.getInstructions(), /draft/)
  assert.match(client.getInstructions(), /cms_guide/)

  const guide = await callTool(client, 'cms_guide', {})
  assert.equal(guide.ok, true)
  assert.ok(guide.sections.includes('Rules'))
  const rules = await callTool(client, 'cms_guide', { section: 'rules' })
  assert.equal(rules.section, 'Rules')
  assert.match(rules.markdown, /^## Rules/)
  assert.equal((await callTool(client, 'cms_guide', { section: 'nope' })).code, 'unknown-section')

  const { readFileSync } = require('node:fs')
  const index = JSON.parse(readFileSync(path.join(functionRoot, 'agent-contracts/index.json'), 'utf8')).contracts
  const note = { 'problem:theme.live': 'Propose it; a person applies it in the theme editor.' }
  env.docs.set('agent-contract-notes/problem:theme.live', { text: note['problem:theme.live'] })
  const contract = await callTool(client, 'cms_contract', { kind: ' Operations ' })
  assert.equal(contract.ok, true, contract.message)
  assert.equal(contract.kind, 'operations')
  assert.equal(contract.path, index.operations)
  const { withGeneratedOperations, OPERATIONS_CONTRACT_MARKER } = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  assert.equal(contract.markdown, withGeneratedOperations(readFileSync(path.join(functionRoot, 'agent-contracts/operations.md'), 'utf8'), note))
  assert.ok(contract.markdown.includes('| `theme.live` | Propose it; a person applies it in the theme editor. |'), 'explanation overrides are served')
  assert.ok(!contract.markdown.includes(OPERATIONS_CONTRACT_MARKER), 'the operations section is generated')
  assert.match(contract.markdown, /### `page\.setValues`/)
  const renderer = await callTool(client, 'cms_contract', { kind: 'renderer', section: 'agent quick contract' })
  assert.equal(renderer.ok, true, renderer.message)
  assert.equal(renderer.path, index.renderer)
  assert.equal(renderer.section, 'Agent quick contract')
  assert.match(renderer.markdown, /^## Agent quick contract/)
  assert.ok(renderer.sections.includes('Data Sources'))
  assert.equal((await callTool(client, 'cms_contract', { kind: 'renderer', section: 'nope' })).code, 'unknown-section')
  const unknown = await callTool(client, 'cms_contract', { kind: 'nope' })
  assert.equal(unknown.code, 'unknown-kind')
  assert.deepEqual(unknown.kinds, Object.keys(index))
  const description = (await client.listTools()).tools.find(tool => tool.name === 'cms_contract').description
  assert.ok(Object.keys(index).every(kind => description.includes(kind)), 'the tool lists the bundled kinds')

  const empty = env.mcp.createRemoteCms({ contractsDir: path.join(require('node:os').tmpdir(), 'no-agent-contracts') })
  const missing = JSON.parse((await empty.handlers({ id: 'c', data: {} }).cms_contract({ kind: 'operations' })).content[0].text)
  assert.match(missing.message, /has not bundled its data contracts/)
})

test('cms_schema describes what a collection stores, without values, for the operator', async (t) => {
  const env = await setup(t)
  for (const [docPath, data] of Object.entries({
    'organizations/a/sites/s/published/about': { name: 'About', content: { main: [] }, structure: [], publishedAt: '2026-10-01' },
    'organizations/a/blocks/listing-grid': { name: 'Listing grid', content: '<div>{{ loading }}</div>', dataSources: { listings: { path: 'listings' }, people: { path: 'users' } }, tags: [], themes: ['main'], synced: false, version: 1 },
    'organizations/a/listings/l1': { name: 'Lake house', price: 450000, city: 'Polson', photos: ['a.jpg'] },
    'organizations/a/listings/l2': { name: 'Cabin', price: 210000, city: 'Bigfork' },
    'organizations/a/users/u1': { email: 'person@example.com' },
  }))
    env.docs.set(docPath, data)
  const added = []
  env.hooks.beforeAdd = (path, data) => added.push({ path, data })
  const client = await connect(t, env)

  const blocks = await callTool(client, 'cms_schema', { orgId: 'a', collection: 'blocks' })
  assert.equal(blocks.ok, true, blocks.message)
  assert.equal(blocks.sampled, 3)
  const field = name => blocks.fields.find(item => item.path === name)
  assert.deepEqual(field('name'), { path: 'name', types: ['string'], presence: 100 })
  assert.equal(field('dataSources').presence, 33)
  assert.ok(!/Welcome|<section>|Lake house/.test(JSON.stringify(blocks)), 'no values')

  const pages = await callTool(client, 'cms_schema', { orgId: 'a', collection: 'pages', siteId: 's' })
  assert.equal(pages.collectionPath, 'organizations/a/sites/s/pages')
  assert.equal(pages.comparison.with, 'published-pages')
  assert.ok(pages.comparison.onlyThere.includes('publishedAt'))
  assert.ok(pages.comparison.onlyHere.includes('version'))
  assert.equal((await callTool(client, 'cms_schema', { orgId: 'a', collection: 'pages' })).code, 'invalid-argument', 'pages need a site')

  const listings = await callTool(client, 'cms_schema', { orgId: 'a', collection: 'listings' })
  assert.equal(listings.ok, true, listings.message)
  assert.deepEqual(listings.dataSource.usedBy, ['listing-grid'])
  assert.equal(listings.fields.find(item => item.path === 'photos').presence, 50)
  assert.deepEqual(listings.fields.find(item => item.path === 'price').types, ['number'])

  assert.equal((await callTool(client, 'cms_schema', { orgId: 'a', collection: 'users' })).code, 'permission-denied', 'personal data is never described, even when a block reads it')
  const unknown = await callTool(client, 'cms_schema', { orgId: 'a', collection: 'webcams' })
  assert.equal(unknown.code, 'invalid-argument', 'only collections the library reads')
  assert.match(unknown.message, /listings/)

  const again = await callTool(client, 'cms_schema', { orgId: 'a', collection: 'listings' })
  assert.ok(again.cachedAt, 'a recent shape is reused')
  env.denied.add('read:organizations/a/listings')
  assert.equal((await callTool(client, 'cms_schema', { orgId: 'a', collection: 'listings' })).code, 'permission-denied', 'rights are checked even when cached')

  const records = added.filter(entry => entry.path === 'organizations/a/cmsAgentReads').map(entry => entry.data)
  assert.deepEqual(records.map(entry => entry.tool), ['schema', 'schema', 'schema', 'schema'])
  assert.ok(records.every(entry => entry.docIds.length === 0))
  assert.ok(!/Lake house|Polson/.test(JSON.stringify(records)))
})

// Serves the KV REST API and the override manifest in place of Cloudflare;
// everything else (the MCP client's own requests) goes to the real fetch.
const stubNetwork = (t, { kvKeys = [], manifest = null } = {}) => {
  const realFetch = globalThis.fetch
  const saved = { ...process.env }
  Object.assign(process.env, { CF_ACCOUNT_ID: 'acct', CLOUDFLARE_NAMESPACE_ID: 'ns', CLOUDFLARE_API_KEY: 'kv-token', CMS_RENDERER_MANIFEST_URL: 'https://front.example/_edge/block-overrides.json' })
  const calls = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://front.example/')) {
      calls.push(url)
      return manifest ? new Response(JSON.stringify(manifest), { status: 200 }) : new Response('missing', { status: 404 })
    }
    if (!url.startsWith('https://api.cloudflare.com/'))
      return realFetch(input, init)
    calls.push(url)
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/keys')) {
      const prefix = parsed.searchParams.get('prefix')
      return new Response(JSON.stringify({ result: kvKeys.filter(key => key.name.startsWith(prefix)) }), { status: 200 })
    }
    const key = decodeURIComponent(parsed.pathname.split('/values/')[1])
    const found = kvKeys.find(entry => entry.name === key)
    return found ? new Response(JSON.stringify(found.metadata), { status: 200 }) : new Response('', { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = realFetch
    process.env = saved
  })
  return calls
}

const postKey = (orgId, docId, title, tags) => ({ name: `posts:${orgId}:s:${docId}`, metadata: { canonical: `posts:${orgId}:s:${docId}`, title, tags, name: docId } })
const postList = {
  name: 'Post List',
  templateVersion: 2,
  template: '<ul>{{#for post in source("posts")}}<li class="text-primary">{{ post.title }}</li>{{/for}}</ul><p>{{ heading }}</p>',
  content: '<ul></ul>',
  schema: { heading: { type: 'text', label: 'Heading', value: 'Latest' } },
  dataSources: { posts: { type: 'collection', path: 'posts', uniqueKey: '{orgId}:{siteId}', query: [{ field: 'tags', operator: 'array-contains', value: 'News' }], order: [{ field: 'title', direction: 'asc' }], limit: 200 } },
  values: {},
}

test('cms_render_block renders a definition with the site theme and live KV records, and audits without content', async (t) => {
  const env = await setup(t)
  env.docs.get('organizations/a/sites/s').theme = 'main'
  const calls = stubNetwork(t, {
    kvKeys: [postKey('a', 'p2', 'Second', ['News']), postKey('a', 'p1', 'First', ['News']), postKey('a', 'p3', 'Other', ['Events']), postKey('b', 'x', 'Org B post', ['News'])],
    manifest: { version: 1, commit: 'abc123', builtAt: '2026-10-28T00:00:00Z', components: ['auth.vue'] },
  })
  const added = []
  env.hooks.beforeAdd = (path, data) => added.push({ path, data })
  const client = await connect(t, env)

  const live = await callTool(client, 'cms_render_block', { orgId: 'a', siteId: 's', definition: postList })
  assert.equal(live.ok, true, live.message)
  assert.match(live.html, /<li class="text-primary">First<\/li><li class="text-primary">Second<\/li><\/ul><p>Latest<\/p>/)
  assert.ok(!live.html.includes('Org B'), 'another organization\'s records stay out')
  assert.deepEqual(live.sources.map(source => [source.name, source.loadedFrom, source.records]), [['posts', 'kv', 2]])
  assert.ok(live.problems.some(problem => /lowered to 50/.test(problem)), 'the limit is capped')
  assert.equal(live.themeId, 'main')
  assert.match(live.document, /^<!doctype html>/)
  assert.match(live.document, /--color-primary|\.x\{\}/)
  assert.equal(live.renderingOwner, 'cms')
  assert.equal(live.override.commit, 'abc123')
  assert.ok(calls.every(url => !url.includes(':b:') && !url.includes('%3Ab%3A')))

  const sample = await callTool(client, 'cms_render_block', { orgId: 'a', definition: postList, data: 'sample', values: { heading: 'Given' } })
  assert.equal(sample.sources[0].loadedFrom, 'sample')
  assert.match(sample.html, /<p>Given<\/p>/)
  assert.ok(sample.problems.some(problem => /unthemed/.test(problem)))
  const empty = await callTool(client, 'cms_render_block', { orgId: 'a', siteId: 's', docId: 'hero', data: 'empty' })
  assert.equal(empty.source, 'released')
  assert.match(empty.html, /Welcome/)

  const records = added.filter(entry => entry.path === 'organizations/a/cmsAgentReads').map(entry => entry.data)
  assert.deepEqual(records.map(entry => [entry.tool, entry.docIds]), [['render', []], ['render', []], ['render', ['hero']]])
  assert.equal(records[0].resultCount, 2)
  assert.ok(!/First|Second|Latest|Given|<li/.test(JSON.stringify(records)), 'no records, values or HTML in the audit')
})

test('cms_render_block reads only what the operator may read', async (t) => {
  const env = await setup(t)
  stubNetwork(t, { kvKeys: [postKey('a', 'p1', 'First', ['News'])] })
  const client = await connect(t, env)
  env.denied.add('read:organizations/a/sites')
  assert.equal((await callTool(client, 'cms_render_block', { orgId: 'a', siteId: 's', definition: postList })).code, 'permission-denied', 'a site needs read rights on sites')
  env.denied.delete('read:organizations/a/sites')
  env.denied.add('read:organizations/a/themes')
  assert.equal((await callTool(client, 'cms_render_block', { orgId: 'a', siteId: 's', themeId: 'main', definition: postList })).code, 'permission-denied')
  env.denied.delete('read:organizations/a/themes')

  const people = { ...postList, dataSources: { posts: { type: 'collection', path: 'users', value: [] } } }
  const refused = await callTool(client, 'cms_render_block', { orgId: 'a', definition: people })
  assert.match(refused.sources[0].problem, /personal data/)
  assert.equal(refused.sources[0].records, 0)
  const api = { ...postList, dataSources: { posts: { api: 'http://169.254.169.254/latest', value: [{ title: 'Inline' }] } } }
  const notFetched = await callTool(client, 'cms_render_block', { orgId: 'a', definition: api })
  assert.match(notFetched.sources[0].problem, /not loaded by the Hub/)
  assert.match(notFetched.html, /Inline/)
  const foreign = { ...postList, dataSources: { posts: { ...postList.dataSources.posts, uniqueKey: 'b:s' } } }
  const scoped = await callTool(client, 'cms_render_block', { orgId: 'a', siteId: 's', definition: foreign })
  assert.match(scoped.sources[0].problem, /outside organization/)
  assert.equal((await callTool(client, 'cms_render_block', { orgId: 'a' })).code, 'invalid-argument')
  assert.equal((await callTool(client, 'cms_render_block', { orgId: 'b', definition: postList })).code, 'permission-denied')
})

test('validate, the audit and readiness check overrides against the deployed manifest', async (t) => {
  const env = await setup(t)
  const calls = stubNetwork(t, { manifest: { version: 1, commit: 'front123', builtAt: '2026-10-28T00:00:00Z', components: ['auth.vue', 'project-a/muleCalculator.vue', 'heroBanner.vue'] } })
  env.docs.set('organizations/a/blocks/calc', { name: 'Mule Calculator', content: '<div>Calculator</div>', values: {}, tags: [], themes: ['main'], synced: false, version: 1, isOverrideBlock: true })
  env.docs.set('organizations/a/sites/s/pages/tools', { name: 'Tools', content: [{ id: 'i1', blockId: 'calc', name: 'Mule Calculator', content: '<div>Calculator</div>', isOverrideBlock: true }], structure: [{ id: 'r', columns: [{ id: 'c', blocks: ['i1'] }] }], version: 1 })
  const client = await connect(t, env)

  const flagged = await callTool(client, 'cms_validate', { orgId: 'a', docId: 'calc' })
  assert.equal(flagged.renderingOwner, 'public-frontend-vue-override')
  assert.match(flagged.renderer, /front123/)
  const unflagged = await callTool(client, 'cms_validate', { orgId: 'a', definition: { name: 'Hero Banner', content: '<div>x</div>' } })
  assert.equal(unflagged.renderingOwner, 'cms')
  assert.ok(unflagged.info.some(line => /isn't marked isOverrideBlock/.test(line)))

  const audit = await callTool(client, 'cms_audit_blocks', { orgId: 'a', includeRender: false })
  assert.equal(audit.summary.vueOverrideBlocks, 1)
  assert.match(audit.renderer, /front123/)

  env.docs.delete('organizations/a/sites/s/pages/about')
  const readiness = await callTool(client, 'cms_site_readiness', { orgId: 'a', siteId: 's' })
  assert.equal(readiness.ok, true, readiness.message)
  const item = readiness.items.find(entry => entry.code === 'block.override')
  assert.deepEqual([item.deployedRenderer.status, item.deployedRenderer.file, item.deployedRenderer.commit], ['vue-override', 'project-a/muleCalculator.vue', 'front123'])
  assert.equal(calls.filter(url => url.startsWith('https://front.example/')).length, 1, 'the manifest is cached')
})

test('an unreadable manifest reports overrides as unverified', async (t) => {
  const env = await setup(t)
  stubNetwork(t, { manifest: null })
  env.docs.set('organizations/a/blocks/calc', { name: 'Mule Calculator', content: '<div>Calculator</div>', values: {}, tags: [], themes: [], synced: false, version: 1, isOverrideBlock: true })
  const client = await connect(t, env)
  const result = await callTool(client, 'cms_validate', { orgId: 'a', docId: 'calc' })
  assert.equal(result.renderingOwner, 'unverified')
  assert.match(result.renderer, /could not be read: HTTP 404/)
})
