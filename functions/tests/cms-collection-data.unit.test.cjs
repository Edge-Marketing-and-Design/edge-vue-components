const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { existsSync } = require('node:fs')
const { HttpsError } = require('./support/loadFunctions.cjs')
const { createFakeDb } = require('./support/fakeFirestore.cjs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')

const ORG = 'org1'
const SITE = 'site1'

// cms-collectionData against a fake config, with the KV REST API served from
// `kvKeys` and the denied "action:path" rights refused.
const load = (t, { kvKeys = [], denied = [] } = {}) => {
  const { db } = createFakeDb({})
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const modulePath = require.resolve(path.join(functionRoot, 'cmsCollectionData.js'))
  const original = require.cache[configPath]
  require.cache[configPath] = {
    id: configPath,
    loaded: true,
    exports: { db, HttpsError, onCall: (_options, handler) => handler, permissionCheck: async (_uid, action, target) => !denied.includes(`${action}:${target}`) },
  }
  delete require.cache[modulePath]
  const { collectionData } = require(modulePath)
  delete require.cache[modulePath]
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]

  const savedEnv = { ...process.env }
  const realFetch = globalThis.fetch
  Object.assign(process.env, { CF_ACCOUNT_ID: 'acct', CLOUDFLARE_NAMESPACE_ID: 'ns', CLOUDFLARE_API_KEY: 'kv-token' })
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url.toString())
    if (url.pathname.endsWith('/keys'))
      return new Response(JSON.stringify({ result: kvKeys.filter(key => key.name.startsWith(url.searchParams.get('prefix'))) }), { status: 200 })
    const found = kvKeys.find(entry => entry.name === decodeURIComponent(url.pathname.split('/values/')[1]))
    return found ? new Response(JSON.stringify(found.metadata), { status: 200 }) : new Response('', { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = realFetch
    process.env = savedEnv
  })
  return { collectionData, calls }
}

const post = (orgId, docId, title, tags) => ({ name: `posts:${orgId}:${SITE}:${docId}`, metadata: { canonical: `posts:${orgId}:${SITE}:${docId}`, title, tags } })
const call = (collectionData, data, uid = 'editor') => collectionData({ auth: uid ? { uid } : null, data: { uid, ...data } })
const trainings = {
  collection: { path: 'posts', uniqueKey: `${ORG}:${SITE}`, query: [{ field: 'doc_created_at', operator: '>', value: 0 }, { field: 'tags', operator: 'array-contains', value: 'Trainings' }], order: [{ field: 'title', direction: 'asc' }] },
  limit: 20,
}

test('loads the canvas\'s collection fields from KV with the public site\'s query model', async (t) => {
  const kvKeys = [
    { ...post(ORG, 'b', 'Bravo', ['Trainings']), metadata: { ...post(ORG, 'b', 'Bravo', ['Trainings']).metadata, doc_created_at: 2 } },
    { ...post(ORG, 'a', 'Alpha', ['Trainings']), metadata: { ...post(ORG, 'a', 'Alpha', ['Trainings']).metadata, doc_created_at: 1 } },
    { ...post(ORG, 'n', 'News', ['News']), metadata: { ...post(ORG, 'n', 'News', ['News']).metadata, doc_created_at: 3 } },
    { ...post('org2', 'x', 'Other org', ['Trainings']), metadata: { ...post('org2', 'x', 'Other org', ['Trainings']).metadata, doc_created_at: 4 } },
  ]
  const { collectionData, calls } = load(t, { kvKeys })
  const result = await call(collectionData, { orgId: ORG, siteId: SITE, sources: { trainings } })
  assert.deepEqual(result.values.trainings.map(item => item.title), ['Alpha', 'Bravo'])
  assert.deepEqual(result.sources.map(source => [source.name, source.loadedFrom, source.records]), [['trainings', 'kv', 2]])
  assert.ok(calls.every(url => !url.includes('org2')))
})

test('needs a signed-in caller whose uid matches, and read rights per collection', async (t) => {
  const { collectionData } = load(t, { denied: ['read:organizations/org1/sites', 'read:organizations/org1/listings'] })
  await assert.rejects(call(collectionData, { orgId: ORG, sources: {} }, null), { code: 'unauthenticated' })
  await assert.rejects(collectionData({ auth: { uid: 'editor' }, data: { uid: 'someone-else', orgId: ORG, sources: {} } }), { code: 'permission-denied' })
  await assert.rejects(call(collectionData, { orgId: 'bad/id', sources: {} }), { code: 'invalid-argument' })
  const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`s${index}`, trainings]))
  await assert.rejects(call(collectionData, { orgId: ORG, sources: tooMany }), { code: 'invalid-argument' })

  const result = await call(collectionData, {
    orgId: ORG,
    siteId: SITE,
    sources: {
      trainings,
      listings: { collection: { path: 'listings', uniqueKey: ORG } },
      people: { collection: { path: 'users', uniqueKey: ORG } },
    },
  })
  assert.deepEqual(result.values, { trainings: [], listings: [], people: [] })
  assert.match(result.sources.find(source => source.name === 'trainings').problem, /Not allowed to read sites/)
  assert.match(result.sources.find(source => source.name === 'listings').problem, /Not allowed to read listings/)
  assert.match(result.sources.find(source => source.name === 'people').problem, /personal data/)
})

test('keys outside the organization and API sources are not read', async (t) => {
  const { collectionData, calls } = load(t, { kvKeys: [post('org2', 'x', 'Other org', ['Trainings'])] })
  const result = await call(collectionData, {
    orgId: ORG,
    siteId: SITE,
    sources: {
      foreign: { collection: { path: 'posts', uniqueKey: `org2:${SITE}` } },
      remote: { collection: { path: 'posts', uniqueKey: `${ORG}:${SITE}` }, api: 'http://169.254.169.254/latest', value: [] },
    },
  })
  assert.deepEqual(result.values.foreign, [])
  assert.match(result.sources.find(source => source.name === 'foreign').problem, /outside organization/)
  assert.ok(calls.every(url => !url.includes('169.254') && !url.includes('org2')))
})
