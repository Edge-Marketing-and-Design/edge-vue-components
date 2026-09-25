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
