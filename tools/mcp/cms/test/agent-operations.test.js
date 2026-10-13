import assert from 'node:assert/strict'
import test from 'node:test'
import { agentEndpoint, createAgentOperationClient, resolveAgentKey } from '../src/agent-operations.js'

test('the agent key comes from EDGE_CMS_AGENT_KEY, else the configured key file', async () => {
  assert.equal(await resolveAgentKey({ env: { EDGE_CMS_AGENT_KEY: ' cmsak.a.b ' }, config: { agentKeyFile: '~/k' } }), 'cmsak.a.b')
  const read = async (file) => {
    assert.equal(file, '/home/dev/.config/hub/key')
    return 'cmsak.from.file\n'
  }
  assert.equal(await resolveAgentKey({ env: {}, config: { agentKeyFile: '~/.config/hub/key' }, homeDir: '/home/dev', readFileImpl: read }), 'cmsak.from.file')
  const missing = async () => {
    const error = new Error('missing')
    error.code = 'ENOENT'
    throw error
  }
  assert.equal(await resolveAgentKey({ env: {}, config: { agentKeyFile: '~/k' }, readFileImpl: missing }), null)
  assert.equal(await resolveAgentKey({ env: {}, config: {} }), null)
})

test('the endpoint defaults to the project\'s cms-agentOperation function', () => {
  assert.equal(agentEndpoint({ env: {}, config: { projectId: 'clearwater-hub' } }), 'https://us-central1-clearwater-hub.cloudfunctions.net/cms-agentOperation')
  assert.equal(agentEndpoint({ env: {}, config: { projectId: 'p', agentEndpoint: 'http://127.0.0.1:5001/p/us-central1/cms-agentOperation' } }), 'http://127.0.0.1:5001/p/us-central1/cms-agentOperation')
  assert.equal(agentEndpoint({ env: { EDGE_CMS_AGENT_ENDPOINT: 'http://x' }, config: { projectId: 'p' } }), 'http://x')
})

test('check and run post the operation with the key and return the Hub\'s answer, refusals included', async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    const body = JSON.parse(init.body)
    if (body.action === 'run')
      return { status: 409, json: async () => ({ ok: false, code: 'failed-precondition', message: 'changed since it was checked' }) }
    return { status: 200, json: async () => ({ ok: true, blocked: false, checksum: 'abc' }) }
  }
  const client = createAgentOperationClient({ endpoint: 'https://hub/fn', getKey: async () => 'cmsak.k.s', fetchImpl })
  const operation = { type: 'page.update', siteId: 's', pageId: 'p', fields: { metaTitle: 'x' } }
  assert.deepEqual(await client.check('org1', operation), { httpStatus: 200, ok: true, blocked: false, checksum: 'abc' })
  assert.deepEqual(await client.run('org1', operation, 'abc'), { httpStatus: 409, ok: false, code: 'failed-precondition', message: 'changed since it was checked' })
  assert.equal(requests[0].url, 'https://hub/fn')
  assert.equal(requests[0].init.headers.authorization, 'Bearer cmsak.k.s')
  assert.deepEqual(JSON.parse(requests[0].init.body), { orgId: 'org1', action: 'check', operation, client: 'edge-cms-mcp' })
  assert.deepEqual(JSON.parse(requests[1].init.body), { orgId: 'org1', action: 'run', operation, checksum: 'abc', client: 'edge-cms-mcp' })
  await client.preview('org1', 'site1', 'home')
  assert.deepEqual(JSON.parse(requests[2].init.body), { orgId: 'org1', action: 'preview', siteId: 'site1', pageId: 'home', source: 'draft', blockDrafts: true, client: 'edge-cms-mcp' })
  await client.readiness('org1', 'site1')
  assert.deepEqual(JSON.parse(requests[3].init.body), { orgId: 'org1', action: 'readiness', siteId: 'site1', client: 'edge-cms-mcp' })
  await client.preview('org1', 'site1', 'home', 'draft', true, { viewport: 'mobile' })
  assert.equal(JSON.parse(requests[4].init.body).viewport, 'mobile')
  await client.preview('org1', 'site1', 'home', 'draft', true, { width: 768 })
  assert.equal(JSON.parse(requests[5].init.body).width, 768)
  await client.pages('org1', 'site1')
  assert.deepEqual(JSON.parse(requests[6].init.body), { orgId: 'org1', action: 'pages', siteId: 'site1', client: 'edge-cms-mcp' })
  await client.page('org1', 'site1', 'home')
  assert.deepEqual(JSON.parse(requests[7].init.body), { orgId: 'org1', action: 'page', siteId: 'site1', pageId: 'home', source: 'draft', includeValues: true, includeSchema: false, client: 'edge-cms-mcp' })
  await client.page('org1', 'site1', 'home', { source: 'published', includeValues: false, includeSchema: true })
  assert.deepEqual(JSON.parse(requests[8].init.body), { orgId: 'org1', action: 'page', siteId: 'site1', pageId: 'home', source: 'published', includeValues: false, includeSchema: true, client: 'edge-cms-mcp' })
  await client.posts('org1', 'site1')
  assert.deepEqual(JSON.parse(requests[9].init.body), { orgId: 'org1', action: 'posts', siteId: 'site1', client: 'edge-cms-mcp' })
  await client.posts('org1', 'site1', { type: 'event', tag: 'Training', limit: 10, startAfter: 'p9' })
  assert.deepEqual(JSON.parse(requests[10].init.body), { orgId: 'org1', action: 'posts', siteId: 'site1', type: 'event', tag: 'Training', limit: 10, startAfter: 'p9', client: 'edge-cms-mcp' })
  await client.post('org1', 'site1', 'p1')
  assert.deepEqual(JSON.parse(requests[11].init.body), { orgId: 'org1', action: 'post', siteId: 'site1', postId: 'p1', source: 'draft', includeValues: true, includeSchema: false, client: 'edge-cms-mcp' })
  await client.post('org1', 'site1', 'p1', { source: 'published', includeValues: false, includeSchema: true })
  assert.deepEqual(JSON.parse(requests[12].init.body), { orgId: 'org1', action: 'post', siteId: 'site1', postId: 'p1', source: 'published', includeValues: false, includeSchema: true, client: 'edge-cms-mcp' })
  assert.ok(requests.every(request => request.init.headers.authorization === 'Bearer cmsak.k.s'))
})

test('page and post reads send the session credential for their sessionId', async () => {
  const seen = []
  const connections = {
    credential: async (sessionId, body) => {
      seen.push({ sessionId, action: body.action, siteId: body.siteId })
      return sessionId === 'site-handle' ? { ok: true, token: 'cmsas.session' } : { ok: false, code: 'session-required', message: 'open one' }
    },
  }
  const requests = []
  const client = createAgentOperationClient({
    endpoint: 'https://hub/fn',
    connections,
    getKey: async () => assert.fail('connection mode never uses a key'),
    fetchImpl: async (url, init) => {
      requests.push(init)
      return { status: 200, json: async () => ({ ok: true }) }
    },
  })
  await client.pages('org1', 'site1', 'site-handle')
  await client.page('org1', 'site1', 'home', { sessionId: 'site-handle' })
  assert.deepEqual(seen, [{ sessionId: 'site-handle', action: 'pages', siteId: 'site1' }, { sessionId: 'site-handle', action: 'page', siteId: 'site1' }])
  assert.ok(requests.every(init => init.headers.authorization === 'Bearer cmsas.session'))
  assert.equal((await client.pages('org1', 'site1')).code, 'session-required')
  assert.equal(requests.length, 2)
  await client.posts('org1', 'site1', { sessionId: 'site-handle' })
  await client.post('org1', 'site1', 'p1', { sessionId: 'site-handle' })
  assert.deepEqual(seen.slice(-2), [{ sessionId: 'site-handle', action: 'posts', siteId: 'site1' }, { sessionId: 'site-handle', action: 'post', siteId: 'site1' }])
  assert.equal((await client.posts('org1', 'site1')).code, 'session-required')
  assert.equal(requests.length, 4)
})

test('a missing key, an unreachable endpoint and a non-JSON reply are explained, not thrown', async () => {
  const noKey = createAgentOperationClient({ endpoint: 'x', getKey: async () => null, fetchImpl: async () => assert.fail('no request without a key') })
  const noKeyResult = await noKey.check('org1', { type: 'page.update' })
  assert.equal(noKeyResult.code, 'no-agent-key')
  assert.match(noKeyResult.message, /Dev Mode > Agent Keys/)
  const refuse = async () => {
    throw new Error('ECONNREFUSED')
  }
  const down = createAgentOperationClient({ endpoint: 'http://down', getKey: async () => 'k', fetchImpl: refuse })
  assert.equal((await down.check('org1', { type: 'page.update' })).code, 'unreachable')
  const notJson = async () => {
    throw new Error('not json')
  }
  const html = createAgentOperationClient({ endpoint: 'x', getKey: async () => 'k', fetchImpl: async () => ({ status: 502, json: notJson }) })
  assert.deepEqual(await html.check('org1', { type: 'page.update' }), { httpStatus: 502, ok: false, code: 'bad-response', message: 'The endpoint returned HTTP 502 without JSON.' })
})
