const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { existsSync } = require('node:fs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')
const { Timestamp } = require(require.resolve('firebase-admin/firestore', { paths: [functionRoot] }))
const { createFakeDb } = require('./support/fakeFirestore.cjs')
class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
const setup = () => {
  const fake = createFakeDb({
    'organizations/a': { name: 'Org A' },
    'organizations/b': { name: 'Org B' },
    'organizations/a/sites/s': { name: 'Site A', menus: {} },
    'organizations/a/sites/t': { name: 'Other Site' },
    'organizations/b/sites/s': { name: 'Site B', menus: {} },
    'organizations/a/sites/s/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
    'organizations/b/sites/s/pages/home': { name: 'Home', content: [], structure: [], version: 1 },
  })
  const allowed = new Set(['a'])
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const original = require.cache[configPath]
  const modulePaths = ['cmsAgentConnections.js', 'cmsAgentKeys.js', 'cmsOperations.js', 'cmsBlockRevisions.js'].map(file => require.resolve(path.join(functionRoot, file)))
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
  modulePaths.forEach(file => delete require.cache[file])
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]
  return { ...fake, allowed, connections, keys }
}
const call = (handler, data = {}, uid = 'owner') => handler({ auth: { uid }, data: { uid, orgId: 'a', ...data } })
const post = async (handler, token, body, method = 'POST') => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.body = data
      return this
    },
  }
  await handler({ method, body, headers: { authorization: `Bearer ${token || ''}` } }, res)
  return res
}
const create = env => call(env.connections.createAgentConnection, { name: 'Owner laptop' })
const session = (env, token, args = {}) => post(env.connections.agentConnection, token, { action: 'session', orgId: 'a', scope: 'site', siteId: 's', ...args })
const operation = { type: 'page.update', siteId: 's', pageId: 'home', fields: { metaTitle: 'Draft title' } }
const op = (env, token, args = {}) => post(env.keys.agentOperation, token, { orgId: 'a', action: 'check', operation, ...args })

test('sessions persist a TTL Timestamp matching the ISO expiry, capped by the parent lifetime', async () => {
  const env = setup()
  const created = await create(env)
  const parentPath = `agent-connections/${created.connectionId}`
  const parentExpiry = new Date(Date.now() + 60000).toISOString()
  env.docs.set(parentPath, { ...env.docs.get(parentPath), expiresAt: parentExpiry })
  const collection = env.db.collection.bind(env.db)
  const issued = []
  env.db.collection = (name) => {
    const result = collection(name)
    if (name === 'agent-sessions') {
      const doc = result.doc
      result.doc = (id) => {
        const ref = doc(id)
        const set = ref.set
        ref.set = async (data) => {
          issued.push(data)
          return set(data)
        }
        return ref
      }
    }
    return result
  }
  const scoped = (await session(env, created.token)).body
  assert.equal(scoped.ok, true)
  assert.equal(scoped.expiresAt, parentExpiry)
  assert.ok(issued[0].expiresAtTimestamp instanceof Timestamp, 'write a native Firestore Timestamp, not a serialized object')
  assert.equal(issued[0].expiresAtTimestamp.toMillis(), Date.parse(scoped.expiresAt))
  assert.deepEqual(env.docs.get(`agent-sessions/${scoped.sessionId}`).expiresAtTimestamp, JSON.parse(JSON.stringify(issued[0].expiresAtTimestamp)))
  assert.equal(scoped.expiresAtTimestamp, undefined, 'keep the API expiry as an ISO string')
})

test('all connection callables enforce authentication and matching uid before access', async () => {
  const env = setup()
  for (const name of ['createAgentConnection', 'listAgentConnections', 'renewAgentConnection', 'revokeAgentConnection']) {
    await assert.rejects(env.connections[name]({ data: {} }), { code: 'unauthenticated' })
    await assert.rejects(env.connections[name]({ auth: { uid: 'owner' }, data: { uid: 'other' } }), { code: 'permission-denied' })
  }
  assert.equal(env.writes.length, 0)
})
test('connections store only a hash; list does not expose credentials; signed-in creator renews without replacing secret', async () => {
  const env = setup()
  const created = await create(env)
  assert.match(created.token, /^cmsac\.[a-f0-9]{40}\.[A-Za-z0-9_-]{43}$/)
  const stored = env.docs.get(`agent-connections/${created.connectionId}`)
  assert.ok(!JSON.stringify(stored).includes(created.token.split('.')[2]))
  const listed = await call(env.connections.listAgentConnections)
  assert.equal(listed.connections.length, 1)
  assert.equal(listed.connections[0].keyHash, undefined)
  assert.equal(listed.connections[0].token, undefined)
  env.docs.set(`agent-connections/${created.connectionId}`, { ...stored, expiresAt: '2000-01-01' })
  assert.equal((await session(env, created.token)).statusCode, 401)
  await call(env.connections.renewAgentConnection, { connectionId: created.connectionId, expiresInDays: 90 })
  const renewedExpiry = env.docs.get(`agent-connections/${created.connectionId}`).expiresAt
  await call(env.connections.renewAgentConnection, { connectionId: created.connectionId, expiresInDays: 7 })
  assert.equal(env.docs.get(`agent-connections/${created.connectionId}`).expiresAt, renewedExpiry, 'renew never shortens an existing lifetime')
  assert.equal(env.docs.get(`agent-connections/${created.connectionId}`).keyHash, stored.keyHash)
  assert.equal((await session(env, created.token)).statusCode, 200)
})
test('ownership controls listing, renewal and revocation; a revoked connection cannot be renewed', async () => {
  const env = setup()
  const created = await create(env)
  assert.equal((await call(env.connections.listAgentConnections, {}, 'other')).connections.length, 0)
  await assert.rejects(call(env.connections.renewAgentConnection, { connectionId: created.connectionId }, 'admin'), { code: 'permission-denied' })
  await assert.rejects(call(env.connections.revokeAgentConnection, { connectionId: created.connectionId }, 'other'), { code: 'permission-denied' })
  await call(env.connections.revokeAgentConnection, { connectionId: created.connectionId }, 'admin')
  await assert.rejects(call(env.connections.renewAgentConnection, { connectionId: created.connectionId }), { code: 'failed-precondition' })
  assert.equal((await session(env, created.token)).statusCode, 401)
})
test('new organizations and changed permissions are discovered without reissuing the connection; filtered pages have a cursor', async () => {
  const env = setup()
  const created = await create(env)
  const list = args => post(env.connections.agentConnection, created.token, { action: 'organizations', ...args })
  assert.deepEqual((await list()).body.organizations.map(org => org.orgId), ['a'])
  env.docs.set('organizations/c', { name: 'New org' })
  env.allowed.add('c')
  assert.deepEqual((await list()).body.organizations.map(org => org.orgId), ['a', 'c'])
  env.allowed.delete('a')
  const first = (await list({ limit: 1 })).body
  assert.deepEqual(first.organizations, [])
  assert.equal(first.nextStartAfter, 'a')
  const next = (await list({ startAfter: 'b', limit: 1 })).body
  assert.deepEqual(next.organizations.map(org => org.orgId), ['c'])
  assert.equal((await session(env, created.token)).statusCode, 403)
})
test('session credentials isolate organizations and same-id sites, and cannot escalate scope', async () => {
  const env = setup()
  const created = await create(env)
  env.allowed.add('b')
  const a = await session(env, created.token)
  assert.equal(a.statusCode, 200)
  assert.equal((await op(env, a.body.token)).statusCode, 200)
  assert.equal((await op(env, a.body.token, { orgId: 'b' })).statusCode, 403)
  assert.equal((await op(env, a.body.token, { operation: { ...operation, siteId: 't' } })).statusCode, 403)
  assert.equal((await op(env, a.body.token, { operation: { type: 'theme.update' } })).statusCode, 403)
  const org = await session(env, created.token, { scope: 'organization', siteId: undefined })
  assert.equal(org.statusCode, 200)
  assert.equal((await op(env, org.body.token)).statusCode, 403)
  assert.equal((await session(env, created.token, { scope: 'organization' })).statusCode, 400)
  assert.equal((await session(env, created.token, { siteId: 'missing' })).statusCode, 404)
  assert.equal((await session(env, created.token, { orgId: 'missing' })).statusCode, 403)
  assert.equal((await op(env, created.token)).statusCode, 401, 'parent credential cannot execute directly')
})
test('revoked/expired parents and lost current permissions stop already issued sessions', async () => {
  const env = setup()
  const created = await create(env)
  const scoped = (await session(env, created.token)).body
  env.allowed.delete('a')
  assert.equal((await op(env, scoped.token)).statusCode, 403)
  env.allowed.add('a')
  const path = `agent-connections/${created.connectionId}`
  const stored = env.docs.get(path)
  env.docs.set(path, { ...stored, expiresAt: 'bad-date' })
  assert.equal((await op(env, scoped.token)).statusCode, 401)
  env.docs.set(path, stored)
  await call(env.connections.revokeAgentConnection, { connectionId: created.connectionId })
  assert.equal((await op(env, scoped.token)).statusCode, 401)
})
test('checked run updates only the selected draft and records a scoped credential; changed data is refused', async () => {
  const env = setup()
  const created = await create(env)
  const scoped = (await session(env, created.token)).body
  const check = await op(env, scoped.token)
  const run = await op(env, scoped.token, { action: 'run', checksum: check.body.checksum, agentConnectionId: 'forged-connection' })
  assert.equal(run.statusCode, 200)
  assert.equal(env.docs.get('organizations/a/sites/s/pages/home').metaTitle, 'Draft title')
  assert.equal(env.docs.get('organizations/b/sites/s/pages/home').metaTitle, undefined)
  const audit = env.docs.get(`cms-operations/${run.body.operationId}`)
  assert.equal(audit.agentKeyId, scoped.sessionId)
  assert.equal(audit.agentConnectionId, created.connectionId)
  assert.equal(audit.runBy, 'owner')
  assert.equal((await op(env, scoped.token, { action: 'run', checksum: check.body.checksum })).statusCode, 409)
  assert.equal((await op(env, scoped.token, { operation: { type: 'page.publish', siteId: 's' } })).statusCode, 400)
})
test('invalid, tampered, expired and foreign-Hub sessions fail closed', async () => {
  const env = setup()
  const created = await create(env)
  const scoped = (await session(env, created.token)).body
  assert.equal((await op(setup(), scoped.token)).statusCode, 401)
  assert.equal((await op(env, 'cmsas.invalid')).statusCode, 401)
  const tampered = scoped.token.slice(0, -1) + (scoped.token.endsWith('A') ? 'B' : 'A')
  assert.equal((await op(env, tampered)).statusCode, 401)
  const path = `agent-sessions/${scoped.sessionId}`
  env.docs.set(path, { ...env.docs.get(path), expiresAt: '2000-01-01' })
  assert.equal((await op(env, scoped.token)).statusCode, 401)
  assert.equal((await post(env.connections.agentConnection, '', {}, 'GET')).statusCode, 405)
})
test('issuance refuses viewers, invalid lifetimes and unnamed devices without storing anything', async () => {
  const env = setup()
  await assert.rejects(call(env.connections.createAgentConnection, { name: 'Device' }, 'other'), { code: 'permission-denied' })
  await assert.rejects(call(env.connections.createAgentConnection, { name: '' }), { code: 'invalid-argument' })
  await assert.rejects(call(env.connections.createAgentConnection, { name: 'Device', expiresInDays: 91 }), { code: 'invalid-argument' })
  assert.equal(env.writes.length, 0)
})
