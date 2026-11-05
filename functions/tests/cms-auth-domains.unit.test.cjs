const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const { reconcileMembershipAuthDomains, LEASE_MS, REQUEST_TIMEOUT_MS } = require('../helpers/cmsAuthDomains')
const { createFakeDb } = require('./support/fakeFirestore.cjs')

const statePath = 'cms-auth-domain-sync/test-project'
const baseDomains = ['localhost', 'test-project.firebaseapp.com', 'test-project.web.app', 'hub.example.com', 'manual.example.net']
const expandDomains = domains => [...new Set(domains.filter(Boolean).flatMap(value => {
  const domain = value.trim().toLowerCase().replace(/^www\./, '')
  return !domain || domain === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(domain) ? [] : [domain, `www.${domain}`]
}))]
function fixture(seed = {}, initial = baseDomains) {
  const fake = createFakeDb(seed)
  // Serialize mock transactions to model Firestore's compare-and-retry behavior.
  const transaction = fake.db.runTransaction.bind(fake.db)
  let tail = Promise.resolve()
  fake.db.runTransaction = callback => {
    const run = tail.then(() => transaction(callback))
    tail = run.catch(() => {})
    return run
  }
  let clock = 1000000
  let current = [...initial]
  const calls = []
  const logs = []
  const hooks = {}
  const axios = {
    async get(url, options) {
      calls.push(['GET', url]); assert.equal(options.timeout, REQUEST_TIMEOUT_MS)
      if (hooks.get) await hooks.get()
      return { data: hooks.invalidResponse ? {} : { authorizedDomains: [...current] } }
    },
    async patch(url, value, options) {
      calls.push(['PATCH', url]); assert.equal(options.timeout, REQUEST_TIMEOUT_MS)
      if (hooks.patch) await hooks.patch()
      current = [...value.authorizedDomains]
      return { data: {} }
    },
  }
  const run = options => reconcileMembershipAuthDomains({ db: fake.db, axios, projectId: 'test-project', getAccessToken: async () => 'mock-token', expandDomains, logger: { log: (...args) => logs.push(args) }, now: () => clock, touchedDomains: ['www.example.com'], ...options })
  return { ...fake, calls, logs, hooks, run, current: () => current, setClock: value => { clock = value } }
}

test('deleting the redundant www entry preserves Auth domains needed by the enabled canonical entry', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } }, [...baseDomains, 'example.com', 'www.example.com'])
  const result = await f.run()
  assert.deepEqual(result.removed, [])
  assert.equal(f.calls.filter(([method]) => method === 'PATCH').length, 0)
  assert.ok(f.current().includes('example.com'))
  assert.ok(f.current().includes('www.example.com'))
  assert.deepEqual(f.docs.get(statePath).managedDomains, ['example.com', 'www.example.com'])
  assert.equal(f.docs.get(statePath).leaseOwner, '')
})

test('enabled-to-enabled events restore missing domains without a membership toggle', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  const result = await f.run()
  assert.deepEqual(result.added, ['example.com', 'www.example.com'])
  assert.equal(f.calls.filter(([method]) => method === 'PATCH').length, 1)
  assert.ok(baseDomains.every(domain => f.current().includes(domain)))
})

test('disabling the final owner removes both hosts while preserving unrelated manual/provider domains', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: false } }, [...baseDomains, 'example.com', 'www.example.com'])
  assert.deepEqual((await f.run()).removed, ['example.com', 'www.example.com'])
  assert.deepEqual(f.current(), [...baseDomains].sort())
})

test('another enabled registry entry, even from another organization, keeps the shared hosts authorized', async () => {
  const f = fixture({
    'domain-registry/example.com': { domain: 'example.com', authEnabled: false, orgId: 'first' },
    'domain-registry/www.example.com': { domain: 'www.example.com', authEnabled: true, orgId: 'second' },
  }, [...baseDomains, 'example.com', 'www.example.com'])
  assert.deepEqual((await f.run()).removed, [])
  assert.equal(f.calls.length, 1)
})

test('old create/enable events do not re-add a domain whose current registry has been removed', async () => {
  const f = fixture({}, [...baseDomains, 'example.com', 'www.example.com'])
  await f.run({ context: { beforeAuthEnabled: false, afterAuthEnabled: true } })
  assert.deepEqual(f.current(), [...baseDomains].sort())
})

test('late deletion events do not remove a host which has already been re-enabled', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  await f.run({ context: { beforeAuthEnabled: true, afterAuthEnabled: false } })
  assert.ok(f.current().includes('www.example.com'))
})

test('previously managed inactive hosts are cleaned up when a different registry event arrives', async () => {
  const f = fixture({ [statePath]: { managedDomains: ['old.example', 'www.old.example'] }, 'domain-registry/new.example': { domain: 'new.example', authEnabled: true } }, [...baseDomains, 'old.example', 'www.old.example'])
  const result = await f.run({ touchedDomains: ['new.example'] })
  assert.deepEqual(result.removed, ['old.example', 'www.old.example'])
  assert.deepEqual(result.added, ['new.example', 'www.new.example'])
  assert.ok(baseDomains.every(domain => f.current().includes(domain)))
})

test('a second concurrent invocation retries instead of overwriting the first configuration update', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  let release, started
  const entered = new Promise(resolve => { started = resolve })
  const wait = new Promise(resolve => { release = resolve })
  f.hooks.get = async () => { started(); await wait }
  const first = f.run({ owner: 'first' })
  await entered
  await assert.rejects(f.run({ owner: 'second' }), /busy/)
  assert.equal(f.docs.get(statePath).leaseOwner, 'first')
  f.docs.set('domain-registry/another.example', { domain: 'another.example', authEnabled: true })
  release(); await first
  f.hooks.get = null
  await f.run({ owner: 'second', touchedDomains: ['another.example'] })
  assert.ok(['example.com', 'www.example.com', 'another.example', 'www.another.example'].every(domain => f.current().includes(domain)))
  assert.equal(f.calls.filter(([method]) => method === 'PATCH').length, 1)
})

for (const method of ['get', 'patch']) test(`provider ${method} failure releases the lease and does not checkpoint a successful reconciliation`, async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  f.hooks[method] = async () => { throw new Error('provider unavailable') }
  await assert.rejects(f.run(), /provider unavailable/)
  assert.equal(f.docs.get(statePath).leaseOwner, '')
  assert.equal(f.docs.get(statePath).managedDomains, undefined)
  f.hooks[method] = null
  await f.run()
  assert.ok(f.current().includes('www.example.com'))
})

test('uncertain PATCH success is safe to retry without another API write', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  f.hooks.patch = async () => { f.docs.set(statePath, { ...f.docs.get(statePath), leaseOwner: 'new-owner', leaseExpiresAt: 9999999 }) }
  await assert.rejects(f.run(), /lease expired or changed/)
  assert.equal(f.docs.get(statePath).leaseOwner, 'new-owner')
  assert.equal(f.docs.get(statePath).managedDomains, undefined)
  f.docs.set(statePath, { ...f.docs.get(statePath), leaseExpiresAt: 0 })
  f.hooks.patch = null
  await f.run()
  assert.equal(f.calls.filter(([method]) => method === 'PATCH').length, 1)
})

test('an expired crashed lease is reclaimable, but a near-expired lease cannot start an API write', async () => {
  const f = fixture({ [statePath]: { leaseOwner: 'crashed', leaseExpiresAt: 5 }, 'domain-registry/example.com': { domain: 'example.com', authEnabled: true } })
  f.hooks.get = async () => f.setClock(1000000 + LEASE_MS - REQUEST_TIMEOUT_MS)
  await assert.rejects(f.run(), /lease expired or changed/)
  assert.equal(f.calls.some(([method]) => method === 'PATCH'), false)
  assert.equal(f.docs.get(statePath).leaseOwner, '')
  f.hooks.get = null
  await f.run()
  assert.ok(f.current().includes('www.example.com'))
})

test('registry or malformed provider reads fail closed without replacing the Auth list', async () => {
  for (const mode of ['registry', 'provider']) {
    const f = fixture()
    if (mode === 'provider') f.hooks.invalidResponse = true
    else {
      const collection = f.db.collection
      f.db.collection = name => name === 'domain-registry' ? { get: async () => { throw new Error('registry unavailable') } } : collection(name)
    }
    await assert.rejects(f.run(), mode === 'provider' ? /invalid authorizedDomains/ : /registry unavailable/)
    assert.equal(f.calls.some(([method]) => method === 'PATCH'), false)
    assert.equal(f.docs.get(statePath).leaseOwner, '')
  }
})

test('set comparison prevents sort-only API writes and duplicate aliases collapse to one host pair', async () => {
  const f = fixture({ 'domain-registry/example.com': { domain: 'example.com', authEnabled: true }, 'domain-registry/www.example.com': { domain: 'www.example.com', authEnabled: true } }, ['www.example.com', ...baseDomains, 'example.com'])
  await f.run()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.docs.get(statePath).managedDomains, ['example.com', 'www.example.com'])
})

test('trigger retries and forwards enabled-to-enabled events rather than skipping drift repair', async () => {
  const source = fs.readFileSync(require.resolve('../cms.js'), 'utf8')
  const triggerSource = source.slice(source.indexOf('exports.syncFirebaseAuthDomainsFromDomainRegistry ='), source.indexOf('exports.syncCorsAllowedFromDomainRegistry ='))
  let options, forwarded
  const context = { exports: {}, DOMAIN_REGISTRY_COLLECTION: 'domain-registry', onDocumentWritten: (value, fn) => { options = value; return fn }, syncFirebaseAuthorizedDomainsForMembership: async input => { forwarded = input }, logger: { error() {} } }
  vm.runInNewContext(triggerSource, context)
  await context.exports.syncFirebaseAuthDomainsFromDomainRegistry({ params: { domain: 'example.com' }, data: { before: { data: () => ({ domain: 'example.com', authEnabled: true }) }, after: { data: () => ({ domain: 'example.com', authEnabled: true }) } } })
  assert.equal(options.retry, true)
  assert.equal(options.timeoutSeconds, 180)
  assert.deepEqual([...forwarded.touchedDomains], ['example.com', 'example.com', 'example.com'])
  context.syncFirebaseAuthorizedDomainsForMembership = async () => { throw Error('busy') }
  await assert.rejects(context.exports.syncFirebaseAuthDomainsFromDomainRegistry({ params: { domain: 'example.com' } }), /busy/)
})

