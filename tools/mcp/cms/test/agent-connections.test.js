import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createConnectionClient, resolveConnectionKey } from '../src/agent-connections.js'
import { createAgentOperationClient } from '../src/agent-operations.js'

const token = `cmsas.${'a'.repeat(40)}.${'b'.repeat(43)}`
const setup = () => {
  let time = 1000000
  const requests = []
  let denied = false
  const client = createConnectionClient({
    endpoint: 'https://hub/connection',
    getConnectionKey: async () => 'private-connection',
    now: () => time,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      requests.push({ url, body })
      if (denied)
        return { status: 401, json: async () => ({ ok: false, code: 'unauthenticated', message: 'Connection revoked.' }) }
      return { status: 200, json: async () => body.action === 'organizations' ? ({ ok: true, organizations: [{ orgId: 'a' }] }) : ({ ok: true, token, sessionId: 'server-secret-handle', ...body, siteId: body.siteId || null, expiresAt: new Date(time + 900000).toISOString() }) }
    },
  })
  return {
    client,
    requests,
    advance: () => {
      time += 880000
    },
    deny: () => {
      denied = true
    },
  }
}

test('a connection file is reread for rotation and missing credentials fail closed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cms-connection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'credential')
  const config = { agentConnectionFile: file }
  assert.equal(await resolveConnectionKey({ config, env: {} }), null)
  await writeFile(file, ' first\n', { mode: 0o600 })
  assert.equal(await resolveConnectionKey({ config, env: {} }), 'first')
  await writeFile(file, 'second')
  assert.equal(await resolveConnectionKey({ config, env: {} }), 'second')
  assert.equal(await resolveConnectionKey({ config, env: { EDGE_CMS_AGENT_CONNECTION: 'env' } }), 'env')
})
test('sessions have independent opaque handles, never expose secrets, and refuse wrong org/site before requests', async () => {
  const { client, requests } = setup()
  const a = await client.open({ orgId: 'a', scope: 'site', siteId: 's' })
  const b = await client.open({ orgId: 'b', scope: 'site', siteId: 's' })
  assert.notEqual(a.sessionId, b.sessionId)
  assert.equal(a.token, undefined)
  assert.ok(!JSON.stringify(a).includes(token))
  const body = { orgId: 'a', action: 'check', operation: { type: 'page.update', siteId: 's' } }
  assert.equal((await client.credential(a.sessionId, body)).token, token)
  assert.equal((await client.credential(b.sessionId, body)).code, 'session-target-mismatch')
  assert.equal((await client.credential(a.sessionId, { ...body, operation: { type: 'page.update', siteId: 'other' } })).code, 'session-target-mismatch')
  assert.equal((await client.credential('', body)).code, 'session-required')
  assert.equal(requests.length, 2)
})
test('credentials refresh only for the original target, and a revoked connection blocks refresh', async () => {
  const env = setup()
  const session = await env.client.open({ orgId: 'a', scope: 'site', siteId: 's' })
  const body = { orgId: 'a', action: 'readiness', siteId: 's' }
  env.advance()
  assert.equal((await env.client.credential(session.sessionId, body)).ok, true)
  assert.deepEqual(env.requests[1].body, { action: 'session', orgId: 'a', scope: 'site', siteId: 's' })
  env.advance()
  env.deny()
  assert.equal((await env.client.credential(session.sessionId, body)).code, 'unauthenticated')
})
test('all operation actions use the requested handle; connection mode never falls back to a legacy key', async () => {
  const env = setup()
  const session = await env.client.open({ orgId: 'a', scope: 'site', siteId: 's' })
  const requests = []
  const operations = createAgentOperationClient({
    endpoint: 'https://hub/operation',
    connections: env.client,
    getKey: async () => assert.fail('no legacy fallback'),
    fetchImpl: async (url, init) => {
      requests.push(init)
      return { status: 200, json: async () => ({ ok: true }) }
    },
  })
  assert.equal((await operations.check('a', { type: 'page.update', siteId: 's' })).code, 'session-required')
  assert.equal((await operations.check('b', { type: 'page.update', siteId: 's' }, session.sessionId)).code, 'session-target-mismatch')
  await operations.check('a', { type: 'page.update', siteId: 's' }, session.sessionId)
  await operations.run('a', { type: 'page.update', siteId: 's' }, 'hash', session.sessionId)
  await operations.preview('a', 's', 'home', 'draft', true, { sessionId: session.sessionId })
  await operations.readiness('a', 's', session.sessionId)
  assert.deepEqual(requests.map(init => JSON.parse(init.body).action), ['check', 'run', 'preview', 'readiness'])
  assert.ok(requests.every(init => init.headers.authorization === `Bearer ${token}`))
})
test('missing credentials, invalid targets, server target mismatches and non-JSON responses are safe refusals', async () => {
  const noCredential = createConnectionClient({ endpoint: 'x', getConnectionKey: async () => null, fetchImpl: () => assert.fail('no request') })
  assert.equal((await noCredential.organizations()).code, 'no-agent-connection')
  const env = setup()
  assert.equal((await env.client.open({ orgId: 'a' })).code, 'invalid-target')
  assert.equal((await env.client.open({ orgId: 'a', scope: 'organization', siteId: 's' })).code, 'invalid-target')
  const mismatch = createConnectionClient({ endpoint: 'x', getConnectionKey: async () => 'secret', fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, orgId: 'wrong', token }) }) })
  assert.equal((await mismatch.open({ orgId: 'a', scope: 'site', siteId: 's' })).code, 'invalid-session')
  const badJson = createConnectionClient({
    endpoint: 'x',
    getConnectionKey: async () => 'secret',
    fetchImpl: async () => ({
      status: 500,
      json: async () => {
        throw new Error('secret')
      },
    }),
  })
  assert.equal((await badJson.organizations()).code, 'bad-response')
})
