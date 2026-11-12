const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createFakeDb } = require('./support/fakeFirestore.cjs')
const { reconcileSiteResolution, loadPublication, normalizeHostname, servedHosts, statePath, LOCK_PATH, LEASE_MS, REQUEST_TIMEOUT_MS } = require('../kv/siteResolution')
const { enqueueSiteResolution, drainPendingSiteResolutions, PENDING_COLLECTION, QUIET_MS } = require('../kv/siteResolutionQueue')
const site = (org = 'org', id = 'site') => `organizations/${org}/published-site-settings/${id}`
const pages = (org = 'org', id = 'site') => `organizations/${org}/sites/${id}/published`
const registry = (host, org = 'org', id = 'site') => ({ domain: host, orgId: org, siteId: id, sitePath: site(org, id) })
const record = host => `site-resolution:v1:${host}`
const base = () => ({ [site()]: { domains: ['example.com'], menus: { 'Site Root': [] }, version: 1 }, 'domain-registry/example.com': registry('example.com') })
function fixture(seed = base()) {
  const fake = createFakeDb(seed)
  const transact = fake.db.runTransaction.bind(fake.db)
  let tail = Promise.resolve()
  fake.db.runTransaction = callback => {
    const next = tail.then(() => transact(callback)); tail = next.catch(() => {}); return next
  }
  const stored = new Map()
  const calls = []
  const hooks = {}
  let clock = Date.parse('2026-11-08T12:00:00Z')
  const kv = {
    async get(key, type, options) { assert.equal(type, 'json'); assert.equal(options.timeoutMs, REQUEST_TIMEOUT_MS); return stored.get(key) || null },
    async put(key, value, options) {
      assert.equal(options.timeoutMs, REQUEST_TIMEOUT_MS); assert.equal(options.maxRetries, 0)
      if (hooks.put) await hooks.put(key, value)
      calls.push(['put', key]); stored.set(key, typeof value === 'string' && value !== '1' ? JSON.parse(value) : structuredClone(value))
    },
    async del(key, options) { assert.equal(options.maxRetries, 0); calls.push(['del', key]); stored.delete(key) },
  }
  const run = (options = {}) => reconcileSiteResolution({ db: fake.db, kv, orgId: 'org', siteId: 'site', now: () => clock, ...options })
  return { ...fake, stored, calls, hooks, run, now: () => clock, advance: (ms = LEASE_MS + 1) => { clock += ms } }
}

test('normalization is exact, internationalized, and never a slug', () => {
  assert.equal(normalizeHostname(' HTTPS://WWW.Example.COM.:443/path?q=1 '), 'www.example.com')
  assert.equal(normalizeHostname('BÜCHER.example'), 'xn--bcher-kva.example')
  assert.equal(normalizeHostname('bad domain'), '')
  assert.equal(normalizeHostname('https://user:pass@example.com'), '')
  assert.notEqual(normalizeHostname('a-b.example'), normalizeHostname('a.b.example'))
  assert.deepEqual(servedHosts('www.example.com'), ['example.com', 'www.example.com'])
  assert.deepEqual(servedHosts('localhost:3000'), ['localhost'])
  assert.deepEqual(servedHosts('127.0.0.1'), ['127.0.0.1'])
})

test('site writes precede both exact host records and preserve legacy lookups and versions', async () => {
  const f = fixture(); await f.run()
  const document = f.stored.get('sites:org:site')
  assert.match(document.revision, /^sha256:[a-f0-9]{64}$/)
  for (const host of ['example.com', 'www.example.com']) {
    const value = f.stored.get(record(host))
    assert.equal(value.revision, document.revision)
    assert.equal(value.publishedAt, document.publishedAt)
    assert.equal(value.status, 'active'); assert.equal(value.siteKey, 'sites:org:site')
    assert.ok(f.calls.findIndex(([, key]) => key === 'sites:org:site') < f.calls.findIndex(([, key]) => key === record(host)))
  }
  assert.ok(f.stored.has('idx:sites:domains:example-com'))
  assert.ok(f.stored.has('idx:sites:docId:org:site:site'))
  assert.ok([...f.stored.keys()].some(key => key.startsWith('kv-version:sites:org:shard:')))
  assert.equal(f.docs.get(LOCK_PATH).owner, '')
})

test('identical retries do not rewrite KV and ignore mirror bookkeeping', async () => {
  const f = fixture(); await f.run(); const count = f.calls.length
  f.docs.get(site()).cacheVerification = { checkedAt: 9 }
  await f.run(); assert.equal(f.calls.length, count)
})

test('draft-only edits have no effect; every public settings change changes revision', async () => {
  const f = fixture(); await f.run(); const revision = f.stored.get(record('example.com')).revision
  f.docs.set('organizations/org/sites/site', { title: 'draft', menus: {} })
  f.docs.set(`${pages().replace('/published', '/pages')}/draft`, { title: 'draft' })
  await f.run(); assert.equal(f.stored.get(record('example.com')).revision, revision)
  for (const update of [{ title: 'published' }, { pageVersions: { gone: 9 } }, { menus: { 'Site Root': [{ name: 'new' }] } }, { restrictedContent: { enabled: true } }, { version: 2 }, { sitemap: { enabled: true } }]) {
    const old = f.stored.get(record('example.com')).revision
    Object.assign(f.docs.get(site()), update); await f.run()
    assert.notEqual(f.stored.get(record('example.com')).revision, old)
  }
})

test('page publishing, content updates with unchanged numeric version, and unpublishing all advance resolution', async () => {
  const f = fixture(); await f.run(); let old = f.stored.get(record('example.com')).revision
  for (const page of [{ version: 1, title: 'one' }, { version: 1, title: 'synced' }, { version: 2, title: 'release' }, null]) {
    if (page) f.docs.set(`${pages()}/home`, page); else f.docs.delete(`${pages()}/home`)
    await f.run(); const doc = f.stored.get('sites:org:site')
    assert.notEqual(doc.revision, old); old = doc.revision
    assert.deepEqual(doc.pageVersions, page ? { home: page.version } : {})
  }
})

test('pageVersions are reconciled from actual published pages, including stale deletion entries', async () => {
  const f = fixture(); f.docs.get(site()).pageVersions = { gone: 4, home: 1 }
  f.docs.set(`${pages()}/home`, { version: 7 }); await f.run()
  assert.deepEqual(f.stored.get('sites:org:site').pageVersions, { home: 7 })
})

test('aliases and www identify the same site without changing redirect settings', async () => {
  const f = fixture(); Object.assign(f.docs.get(site()), { domains: ['example.com', 'alias.example.net'], canonicalDomain: 'example.com', forwardApex: true })
  f.docs.set('domain-registry/alias.example.net', registry('alias.example.net'))
  await f.run()
  for (const host of ['example.com', 'www.example.com', 'alias.example.net', 'www.alias.example.net']) assert.equal(f.stored.get(record(host)).siteId, 'site')
  assert.equal(f.stored.get('sites:org:site').forwardApex, true)
})

test('unpublish and deletion retain disabled tombstones and remove canonical and old indexes', async () => {
  const f = fixture(); await f.run(); f.docs.delete(site()); await f.run()
  assert.equal(f.stored.has('sites:org:site'), false)
  assert.equal(f.stored.has('idx:sites:domains:example-com'), false)
  assert.equal(f.stored.get(record('example.com')).status, 'disabled')
  assert.equal(f.stored.get(record('www.example.com')).revision, null)
  await f.run(); assert.equal(f.stored.get(record('example.com')).status, 'disabled')
})

test('domain removal disables both hosts while other aliases stay active', async () => {
  const f = fixture(); await f.run()
  f.docs.get(site()).domains = ['other.example']; f.docs.set('domain-registry/other.example', registry('other.example')); f.docs.delete('domain-registry/example.com')
  await f.run()
  assert.equal(f.stored.get(record('example.com')).status, 'disabled')
  assert.equal(f.stored.get(record('other.example')).status, 'active')
})

test('late events for an old owner resolve the current owner across organizations', async () => {
  const f = fixture(); await f.run()
  f.docs.set(site('new-org', 'new-site'), { domains: ['example.com', 'another.example'], version: 1 })
  f.docs.set('domain-registry/example.com', registry('example.com', 'new-org', 'new-site'))
  f.docs.set('domain-registry/another.example', registry('another.example', 'new-org', 'new-site'))
  f.docs.get(site()).domains = []; await f.run()
  assert.equal(f.stored.get(record('example.com')).orgId, 'new-org')
  assert.equal(f.stored.get(record('another.example')).orgId, 'new-org')
  assert.equal(f.stored.has('sites:new-org:new-site'), true)
  assert.equal(f.stored.has('idx:sites:domains:example-com'), true)
  await f.run({ touchedHosts: ['example.com'] })
  assert.equal(f.stored.get(record('www.example.com')).siteId, 'new-site')
})

test('conflicting and malformed registry ownership fails closed', async () => {
  const f = fixture(); f.docs.set('domain-registry/www.example.com', registry('www.example.com', 'other', 'other'))
  await f.run(); assert.equal(f.stored.get(record('example.com')).status, 'disabled')
  f.docs.delete('domain-registry/www.example.com'); f.docs.get('domain-registry/example.com').orgId = 'mismatch'; await f.run()
  assert.equal(f.stored.get(record('example.com')).status, 'disabled')
})

test('registry reservations alone cannot make an unpublished or unrelated hostname active', async () => {
  const f = fixture(); f.docs.set('domain-registry/unrelated.example', registry('unrelated.example')); await f.run()
  assert.equal(f.stored.get(record('unrelated.example')).status, 'disabled')
})

test('a failed site PUT never advertises its new revision and retries current state after lease expiry', async () => {
  const f = fixture(); await f.run(); const old = f.stored.get(record('example.com')).revision
  f.docs.get(site()).version = 2; f.hooks.put = async key => { if (key === 'sites:org:site') throw new Error('timeout') }
  await assert.rejects(f.run(), /timeout/)
  assert.equal(f.stored.get(record('example.com')).revision, old)
  assert.notEqual(f.docs.get(LOCK_PATH).owner, '')
  await assert.rejects(f.run(), /busy/)
  f.advance(); delete f.hooks.put; f.docs.get(site()).version = 3; await f.run()
  assert.equal(f.stored.get('sites:org:site').version, 3)
  assert.notEqual(f.stored.get(record('example.com')).revision, old)
})

test('partial host-write failure retains cleanup intent and retries idempotently', async () => {
  const f = fixture(); f.hooks.put = async key => { if (key === record('www.example.com')) throw new Error('host failure') }
  await assert.rejects(f.run(), /host failure/)
  assert.ok(f.docs.get(statePath('sites:org:site')).pendingHosts.includes('example.com'))
  f.docs.get(site()).domains = []; f.docs.delete('domain-registry/example.com')
  f.advance(); delete f.hooks.put; await f.run()
  assert.equal(f.stored.get(record('example.com')).status, 'disabled')
  assert.deepEqual(f.docs.get(statePath('sites:org:site')).pendingHosts, [])
})

test('concurrent invocations cannot overtake the active writer', async () => {
  const f = fixture(); let enter; const entered = new Promise(resolve => { enter = resolve }); let release; const wait = new Promise(resolve => { release = resolve })
  f.hooks.put = async key => { if (key === 'sites:org:site') { enter(); await wait } }
  const first = f.run(); await entered
  await assert.rejects(f.run(), /busy/)
  release(); await first
  f.docs.get(site()).version = 2; delete f.hooks.put; await f.run()
  assert.equal(f.stored.get('sites:org:site').version, 2)
})

test('source changes preserve pending intent but release the lease for an immediate retry', async () => {
  const f = fixture(); f.hooks.put = async key => { if (key === 'sites:org:site') f.docs.get(site()).version = 2 }
  await assert.rejects(f.run(), /changed during/)
  assert.equal(f.stored.has(record('example.com')), false)
  assert.ok(f.docs.get(statePath('sites:org:site')).pendingHosts.length)
  assert.equal(f.docs.get(LOCK_PATH).owner, '')
  delete f.hooks.put; await f.run(); assert.equal(f.stored.get('sites:org:site').version, 2)
})

test('publication timestamps use committed sources rather than worker invocation time', async () => {
  const f = fixture(); const original = f.db.doc.bind(f.db)
  f.db.doc = path => { const ref = original(path); const get = ref.get; ref.get = async () => ({ ...await get(), updateTime: { toMillis: () => Date.parse('2026-11-08T10:00:00Z') } }); return ref }
  const publication = await loadPublication(f.db, 'org', 'site')
  assert.equal(publication.publishedAt, '2026-11-08T10:00:00.000Z')
})

test('old queued site payloads are redirected to current-state reconciliation', async () => {
  const source = fs.readFileSync(require.resolve('../kv/kvRetryWorker'), 'utf8')
  const calls = []; const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, process: { env: {} }, require: name => {
    if (name === '../config.js') return { onMessagePublished: (_options, handler) => handler, db: {}, logger: { log() {} } }
    if (name === './siteResolution') return { runSiteResolution: async value => calls.push(value) }
    if (name === './kvClient') return new Proxy({}, { get() { throw new Error('Must not replay old KV payload') } })
    return {}
  } })
  for (const payload of [
    { op: 'put', key: 'sites:org:site', value: { version: -10 } },
    { op: 'finalizeMirror', key: 'kv-version:sites:org:shard:000', sourceState: { path: site(), exists: true }, phases: [] },
    { op: 'reconcileSiteResolution', key: 'sites:org:site', orgId: 'org', siteId: 'site' },
  ]) await module.exports.kvMirrorRetryWorker({ data: { message: { json: payload } } })
  assert.equal(calls.length, 3)
  assert.ok(calls.every(value => value.orgId === 'org' && value.siteId === 'site'))
})

test('completed unpublish retries do not keep writing KV generation markers', async () => {
  const f = fixture(); await f.run(); f.docs.delete(site()); await f.run()
  const count = f.calls.length; await f.run({ touchedHosts: ['example.com'] }); assert.equal(f.calls.length, count)
})

test('a host-write timeout after upstream success is repaired without replaying stale data', async () => {
  const f = fixture();
  let fail = true
  f.hooks.put = async (key, value) => {
    if (key === record('example.com') && fail) { fail = false; f.stored.set(key, structuredClone(value)); throw new Error('lost response') }
  }
  await assert.rejects(f.run(), /lost response/)
  f.docs.get(site()).title = 'Newest'; f.advance(); await f.run()
  assert.equal(f.stored.get('sites:org:site').title, 'Newest')
  assert.equal(f.stored.get(record('example.com')).revision, f.stored.get('sites:org:site').revision)
})

test('same-content publication has a deterministic revision independent of property insertion order', async () => {
  const f = fixture(); const before = await loadPublication(f.db, 'org', 'site')
  f.docs.set(site(), { version: 1, menus: { 'Site Root': [] }, domains: ['example.com'] })
  assert.equal((await loadPublication(f.db, 'org', 'site')).revision, before.revision)
})

test('a registry deletion/recreation for the same owner restores both records', async () => {
  const f = fixture(); await f.run(); f.docs.delete('domain-registry/example.com')
  await f.run({ touchedHosts: ['example.com'] }); assert.equal(f.stored.get(record('example.com')).status, 'disabled')
  f.docs.set('domain-registry/example.com', registry('example.com')); await f.run()
  assert.equal(f.stored.get(record('www.example.com')).status, 'active')
})

test('an unexpired abandoned lease blocks writes; an expired one can be reclaimed', async () => {
  const f = fixture(); f.docs.set(LOCK_PATH, { owner: 'other', expiresAt: Date.parse('2026-11-08T12:01:00Z') })
  await assert.rejects(f.run(), /busy/); assert.equal(f.calls.length, 0)
  f.advance(); await f.run(); assert.equal(f.stored.get(record('example.com')).status, 'active')
})

test('all three trigger entrypoints queue site work, including deleted pages and old domain owners', async () => {
  const text = fs.readFileSync(require.resolve('../cms'), 'utf8')
  const source = text.slice(text.indexOf('exports.onSiteWritten ='), text.indexOf('exports.onUserWritten ='))
  const entries = {}; const calls = []; const exports = {}
  vm.runInNewContext(source, { exports, db: { collection: () => ({ get: async () => ({ docs: [] }) }) }, onDocumentWritten: (options, handler) => { entries[options.document] = { options, handler }; return handler }, onSchedule: (_options, handler) => handler, require: () => ({ servedHosts, siteResolutionDisabled: () => false, requestSiteResolution: async args => calls.push(args), runPendingSiteResolutions: async () => calls.push('drain') }) })
  assert.equal(Object.keys(entries).length, 3)
  for (const { options } of Object.values(entries)) { assert.equal(options.retry, true); assert.equal(options.timeoutSeconds, 180) }
  await exports.onSiteWritten({ params: { orgId: 'org', siteId: 'site' }, data: { before: { data: () => ({ domains: ['old.example'] }) }, after: { data: () => ({ domains: ['new.example'] }) } } })
  assert.equal(calls[0].touchedHosts.join(','), 'old.example,new.example')
  await exports.syncSiteResolutionFromPublishedPage({ params: { orgId: 'org', siteId: 'site', pageId: 'deleted' }, data: { after: { exists: false } } })
  await exports.syncSiteResolutionFromDomainRegistry({ params: { domain: 'example.com' }, data: { before: { data: () => registry('example.com') }, after: { data: () => registry('example.com', 'next', 'next') } } })
  assert.equal(calls.length, 4); assert.equal(calls[3].orgId, 'next')
  await exports.drainSiteResolution()
  assert.equal(calls.at(-1), 'drain')
})

test('KV client applies bounded requests and disables internal retries only when requested', async () => {
  const source = fs.readFileSync(require.resolve('../kv/kvClient'), 'utf8')
  const requests = []; const module = { exports: {} }; let fail = false
  const axios = Object.fromEntries(['get', 'put', 'delete'].map(method => [method, async (...args) => {
    requests.push([method, args.at(-1)])
    if (fail) throw Object.assign(new Error('network'), { code: 'ECONNRESET' })
    return { status: 200, data: '{}' }
  }]))
  vm.runInNewContext(source, { module, exports: module.exports, URL, Buffer, console, process: { env: { CF_ACCOUNT_ID: 'test', CLOUDFLARE_NAMESPACE_ID: 'test', CLOUDFLARE_API_KEY: 'dummy' } }, require: name => {
    if (name === 'axios') return axios
    if (name === 'form-data') return class { append() {} getHeaders() { return {} } }
    throw new Error(name)
  } })
  const options = { timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: 0 }
  await module.exports.put('test', { value: 1 }, options)
  await module.exports.put('test', { value: 1 }, { ...options, metadata: { canonical: 'test' } })
  await module.exports.get('test', 'json', options)
  await module.exports.del('test', options)
  assert.ok(requests.every(([, config]) => config.timeout === REQUEST_TIMEOUT_MS))
  fail = true; const count = requests.length
  await assert.rejects(module.exports.put('test', 'value', options), /network/)
  assert.equal(requests.length, count + 1)
  fail = false; await module.exports.put('legacy', 'value')
  assert.equal(requests.at(-1)[1].timeout, undefined)
})

function queueFixture() {
  const f = fixture()
  const collection = f.db.collection.bind(f.db)
  const doc = f.db.doc.bind(f.db)
  const transact = f.db.runTransaction.bind(f.db)
  const pending = () => [...f.docs.keys()].filter(path => path.startsWith(`${PENDING_COLLECTION}/`))
  f.db.doc = (path) => {
    const ref = doc(path)
    if (!path.startsWith(`${PENDING_COLLECTION}/`)) return ref
    const set = ref.set
    ref.set = (value, options) => {
      if (value.touchedHosts) {
        value = { ...value, touchedHosts: [...new Set([...(f.docs.get(path)?.touchedHosts || []), ...value.touchedHosts.union])] }
      }
      return set(value, options)
    }
    return ref
  }
  f.db.collection = (name) => {
    if (name !== PENDING_COLLECTION) return collection(name)
    return { where: (_field, _op, until) => ({ orderBy: () => ({ limit: count => ({
      get: async () => ({
        docs: pending().filter(path => f.docs.get(path).readyAt <= until)
          .sort((a, b) => f.docs.get(a).readyAt - f.docs.get(b).readyAt)
          .slice(0, count).map(path => ({ ref: f.db.doc(path) })),
      }),
    }) }) }) }
  }
  f.db.runTransaction = callback => transact(async (tx) => {
    const deletions = []
    const result = await callback({ ...tx, delete: ref => deletions.push(ref.path) })
    for (const path of deletions) f.docs.delete(path)
    return result
  })
  const errors = []
  const enqueue = options => enqueueSiteResolution({ db: f.db, now: f.now, arrayUnion: (...union) => ({ union }), orgId: 'org', siteId: 'site', ...options })
  const drain = (reconcile = f.run) => drainPendingSiteResolutions({ db: f.db, now: f.now, reconcile, logger: { error: (...args) => errors.push(args) } })
  return { ...f, pending, enqueue, drain, errors }
}

test('22 page events and settings events coalesce into one latest-state reconciliation', async () => {
  const f = queueFixture()
  await f.enqueue({ touchedHosts: ['old.example'] })
  for (let index = 0; index < 22; index++) {
    f.advance(700)
    f.docs.set(`${pages()}/${index}`, { version: index + 1 })
    await f.enqueue()
  }
  await f.enqueue({ touchedHosts: ['example.com'] })
  assert.equal(f.pending().length, 1)
  assert.equal((await f.drain()).completed, 0, 'wait for the publication burst to settle')
  f.advance(QUIET_MS)
  assert.deepEqual(await f.drain(), { completed: 1, deferred: 0, failed: 0 })
  assert.equal(f.pending().length, 0)
  assert.equal(Object.keys(f.stored.get('sites:org:site').pageVersions).length, 22)
  assert.equal(f.stored.get(record('www.old.example')).status, 'disabled')
  assert.equal(f.calls.filter(([op, key]) => op === 'put' && key === 'sites:org:site').length, 1)
})

test('events arriving during a successful sync survive acknowledgement with all cleanup hints', async () => {
  const f = queueFixture()
  await f.enqueue({ touchedHosts: ['old.example'] })
  f.advance(QUIET_MS)
  await f.drain(async (request) => {
    await f.run(request)
    f.docs.set(`${pages()}/home`, { version: 2 })
    await f.enqueue({ touchedHosts: ['another.example'] })
  })
  assert.equal(f.pending().length, 1)
  const request = f.docs.get(f.pending()[0])
  assert.ok(request.touchedHosts.includes('www.old.example'))
  assert.ok(request.touchedHosts.includes('another.example'))
  f.advance(QUIET_MS)
  await f.drain()
  assert.equal(f.pending().length, 0)
  assert.equal(f.stored.get('sites:org:site').pageVersions.home, 2)
  assert.equal(f.stored.get(record('another.example')).status, 'disabled')
})

test('busy and superseded runs keep durable work without logging errors', async () => {
  const f = queueFixture()
  await f.enqueue()
  f.advance(QUIET_MS)
  f.docs.set(LOCK_PATH, { owner: 'other', expiresAt: f.now() + LEASE_MS })
  assert.equal((await f.drain()).deferred, 1)
  assert.equal(f.pending().length, 1)
  f.advance()
  f.hooks.put = async (key) => { if (key === 'sites:org:site') f.docs.get(site()).version = 2 }
  assert.equal((await f.drain()).deferred, 1)
  assert.equal(f.pending().length, 1)
  assert.equal(f.docs.get(LOCK_PATH).owner, '')
  delete f.hooks.put
  assert.equal((await f.drain()).completed, 1)
  assert.equal(f.pending().length, 0)
  assert.equal(f.errors.length, 0)
})

test('a lost KV write response preserves the lease and queued work until a safe retry', async () => {
  const f = queueFixture()
  await f.enqueue()
  f.advance(QUIET_MS)
  f.hooks.put = async () => { throw new Error('lost response') }
  assert.equal((await f.drain()).failed, 1)
  assert.equal(f.errors.length, 1)
  assert.notEqual(f.docs.get(LOCK_PATH).owner, '')
  assert.equal(f.pending().length, 1)
  assert.equal((await f.drain()).failed, 0, 'failed work is deferred')
  f.advance()
  delete f.hooks.put
  assert.equal((await f.drain()).completed, 1)
  assert.equal(f.pending().length, 0)
})
