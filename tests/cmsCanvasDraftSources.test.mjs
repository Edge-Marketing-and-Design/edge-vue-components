import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import * as records from '../../functions/helpers/cmsDataSourceRecords.mjs'

const source = readFileSync(new URL('../../functions/cmsCollectionData.js', import.meta.url), 'utf8')
const draft = { name: 'Draft footer', menus: { main: [{ name: 'Unpublished page' }] } }

test('canvas callable loads saved drafts even with KV credentials configured', async () => {
  const paths = []
  const db = { doc: (path) => { paths.push(path); return { get: async () => ({ exists: true, id: 'site', data: () => draft }) } } }
  const exports = {}
  runInNewContext(source.replace(/const loadModules = \(\) => \{[\s\S]*?\n\}/, 'const loadModules = async () => modules'), {
    exports, Buffer, modules: [records, { resolveDataSource: () => { throw Error('Must not read KV') } }, { PERSONAL_DATA_COLLECTION: /^users$/ }],
    process: { env: { KV_ACCOUNT_ID: 'configured', KV_API_TOKEN: 'configured' } },
    require: () => ({ db, HttpsError: Error, onCall: (_options, handler) => handler, permissionCheck: async (_uid, _action, path) => path === 'organizations/org/sites' }),
  })
  const sources = Object.fromEntries(['sites', 'published-site-settings'].map(path => [path, { collection: { path, canonicalLookup: { key: 'org:site' } } }]))
  const result = await exports.collectionData({ auth: { uid: 'editor' }, data: { uid: 'editor', orgId: 'org', siteId: 'site', sources } })
  assert.deepEqual(paths, ['organizations/org/sites/site', 'organizations/org/sites/site'])
  for (const value of Object.values(result.values)) assert.equal(value[0].name, 'Draft footer')
  assert.ok(result.sources.every(item => item.loadedFrom === 'firestore'))
  assert.equal(sources['published-site-settings'].collection.path, 'published-site-settings')
})

test('draft post loading is opt-in; other consumers keep published posts', async () => {
  const paths = []
  const db = { collection: path => { paths.push(path); return { limit: () => ({ get: async () => ({ docs: [] }) }) } } }
  const options = { db, orgId: 'org', siteId: 'site', block: { templateVersion: 1, meta: { posts: { collection: { path: 'posts' } } } } }
  await records.loadBlockSources({ ...options, draftPreview: true })
  await records.loadBlockSources(options)
  assert.deepEqual(paths, ['organizations/org/sites/site/posts', 'organizations/org/sites/site/published_posts'])
})

test('shared and deployed canvas callables stay identical', () => {
  assert.equal(source, readFileSync(new URL('../functions/cmsCollectionData.js', import.meta.url), 'utf8'))
})

test('missing draft site stays empty rather than falling back to a published record', async () => {
  const result = await records.loadBlockSources({
    orgId: 'org', siteId: 'site', draftPreview: true,
    block: { templateVersion: 1, meta: { settings: { collection: { path: 'sites', canonicalLookup: { key: 'org:site' } } } } },
    db: { doc: path => { assert.equal(path, 'organizations/org/sites/site'); return { get: async () => ({ exists: false }) } } },
  })
  assert.deepEqual(result.values.settings, [])
})

test('canvas refuses unauthorized draft reads before accessing Firestore', async () => {
  const exports = {}
  runInNewContext(source.replace(/const loadModules = \(\) => \{[\s\S]*?\n\}/, 'const loadModules = async () => modules'), {
    exports, Buffer, modules: [records, null, { PERSONAL_DATA_COLLECTION: /^users$/ }],
    require: () => ({ db: { doc: () => { throw Error('Unauthorized read') } }, HttpsError: Error, onCall: (_options, handler) => handler, permissionCheck: async () => false }),
  })
  const result = await exports.collectionData({ auth: { uid: 'editor' }, data: {
    uid: 'editor', orgId: 'org', siteId: 'site', sources: { settings: { collection: { path: 'sites', canonicalLookup: { key: 'org:site' } } } },
  } })
  assert.equal(result.values.settings.length, 0)
  assert.match(result.sources[0].problem, /Not allowed/)
})
