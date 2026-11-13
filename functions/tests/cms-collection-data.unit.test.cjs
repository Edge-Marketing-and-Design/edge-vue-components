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

// cms-collectionData against a fake config: saved drafts in a fake Firestore
// (`docs`), a KV REST API served from `kvKeys` (the canvas must not read it),
// and the denied "action:path" rights refused.
const load = (t, { docs = {}, kvKeys = [], denied = [] } = {}) => {
  const { db } = createFakeDb(docs)
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

const draft = (orgId, docId, title, tags, created) => [`organizations/${orgId}/sites/${SITE}/posts/${docId}`, { title, tags, doc_created_at: created }]
const call = (collectionData, data, uid = 'editor') => collectionData({ auth: uid ? { uid } : null, data: { uid, ...data } })
const trainings = {
  collection: { path: 'posts', uniqueKey: `${ORG}:${SITE}`, query: [{ field: 'tags', operator: 'array-contains', value: 'Trainings' }], order: [{ field: 'title', direction: 'asc' }] },
  limit: 20,
}

test('loads the canvas\'s collection records from saved Firestore drafts with the source\'s query', async (t) => {
  const docs = Object.fromEntries([
    draft(ORG, 'b', 'Bravo', ['Trainings'], 2),
    draft(ORG, 'a', 'Alpha', ['Trainings'], 1),
    draft(ORG, 'n', 'News', ['News'], 3),
    draft('org2', 'x', 'Other org', ['Trainings'], 4),
  ])
  const kvKeys = [{ name: `posts:${ORG}:${SITE}:kv`, metadata: { canonical: `posts:${ORG}:${SITE}:kv`, title: 'Published only', tags: ['Trainings'], doc_created_at: 5 } }]
  const { collectionData, calls } = load(t, { docs, kvKeys })
  const result = await call(collectionData, { orgId: ORG, siteId: SITE, sources: { trainings } })
  assert.deepEqual(result.values.trainings.map(item => item.title), ['Alpha', 'Bravo'])
  assert.deepEqual(result.sources.map(source => [source.name, source.loadedFrom, source.records]), [['trainings', 'firestore', 2]])
  assert.deepEqual(calls, [], 'the canvas reads no KV')
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

test('another organization\'s records and API sources are not read', async (t) => {
  const docs = Object.fromEntries([draft(ORG, 'a', 'Own draft', ['Trainings'], 1), draft('org2', 'x', 'Other org', ['Trainings'], 2)])
  const { collectionData, calls } = load(t, { docs })
  const result = await call(collectionData, {
    orgId: ORG,
    siteId: SITE,
    sources: {
      foreign: { collection: { path: 'posts', uniqueKey: `org2:${SITE}` } },
      remote: { collection: { path: 'posts', uniqueKey: `${ORG}:${SITE}` }, api: 'http://169.254.169.254/latest', value: [] },
    },
  })
  // Reads are always under the caller's organization, whatever key a source names.
  assert.ok(!JSON.stringify(result.values).includes('Other org'), 'another organization\'s records stay out')
  assert.deepEqual(calls, [], 'no API or KV request is made')
})
