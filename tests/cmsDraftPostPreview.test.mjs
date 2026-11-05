import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { draftPostPreviewContext, isDraftPostPreviewSource, resolveDraftPostPreviewSource } from '../lib/cmsDraftPostPreview.js'

const context = { orgId: 'org', siteId: 'site', postTypeId: 'persons' }
const source = { collection: { path: 'posts', uniqueKey: 'org:site', order: [{ field: 'title', direction: 'asc' }] }, queryItems: { type: 'custom-persons' } }
const posts = {
  beta: { postTypeId: 'persons', type: 'custom-persons', title: 'Beta draft', rank: 2, tags: ['Design'] },
  alpha: { postTypeId: 'persons', type: 'custom-persons', title: 'Alpha updated draft', rank: 1, publishedAt: '2026-01-01', tags: ['Writing'] },
  other: { postTypeId: 'articles', type: 'custom-articles', title: 'Other type' },
}

test('only enabled custom index/detail pages enable draft preview, never template sites', () => {
  assert.deepEqual(draftPostPreviewContext({ post: true, postType: { enabled: true } }, 'persons', 'org', 'site'), context)
  for (const page of [{}, { post: true }, { postType: { enabled: true } }, { post: true, postType: { enabled: false } }])
    assert.equal(draftPostPreviewContext(page, 'persons', 'org', 'site'), null)
  assert.equal(draftPostPreviewContext({ post: true, postType: { enabled: true } }, 'persons', 'org', 'templates'), null)
  assert.equal(isDraftPostPreviewSource(source, null), false)
  assert.equal(isDraftPostPreviewSource({ collection: { path: 'sites' } }, context), false)
})

test('index preview uses current saved drafts of this type, including changed published entries', async () => {
  const original = JSON.stringify({ source, posts })
  const records = await resolveDraftPostPreviewSource('persons', source, context, posts)
  assert.deepEqual(records.map(record => record.title), ['Alpha updated draft', 'Beta draft'])
  assert.equal(JSON.stringify({ source, posts }), original, 'Preview never changes the source or stored drafts')
  assert.deepEqual(await resolveDraftPostPreviewSource('persons', { ...source, value: [{ title: 'Published fallback' }] }, context, {}), [], 'Empty drafts must not fall back to published or inline records')
})

test('engine query filters, order and limit remain active over draft records', async () => {
  const records = await resolveDraftPostPreviewSource('persons', { ...source, collection: { ...source.collection, query: [{ field: 'rank', operator: '>=', value: 2 }] }, limit: 1 }, context, posts)
  assert.deepEqual(records.map(record => record.docId), ['beta'])
  const tags = await resolveDraftPostPreviewSource('persons', { collection: { path: 'posts' }, queryItems: { tags: 'Design' } }, context, posts)
  assert.deepEqual(tags.map(record => record.docId), ['beta'])
})

test('index lookups retain union and deduplication before final filtering', async () => {
  const records = await resolveDraftPostPreviewSource('persons', { collection: { path: 'posts' }, queryItems: { type: 'custom-persons', tags: 'Design' } }, context, posts)
  assert.equal(records.length, 2)
  assert.equal(new Set(records.map(record => record.docId)).size, 2)
})

test('canonical lookups remain within the active site and selected type', async () => {
  const records = await resolveDraftPostPreviewSource('persons', { collection: { path: 'posts', canonicalLookup: { key: 'alpha' } } }, context, posts)
  assert.deepEqual(records.map(record => record.title), ['Alpha updated draft'])
  assert.deepEqual(await resolveDraftPostPreviewSource('persons', { collection: { path: 'posts', uniqueKey: 'org:another-site' } }, context, posts), [])
  assert.deepEqual(await resolveDraftPostPreviewSource('persons', { collection: { path: 'posts', canonicalLookup: { key: 'posts:another-org:site:alpha' } } }, context, posts), [])
  assert.equal(await resolveDraftPostPreviewSource('sites', { collection: { path: 'sites' } }, context, posts), null)
  const prepared = await resolveDraftPostPreviewSource('persons', { path: 'posts', uniqueKey: '{orgId}:{siteId}', collection: { path: 'posts', uniqueKey: 'org:site' }, queryItems: { type: 'custom-persons' } }, context, posts)
  assert.equal(prepared.length, 2, 'Resolved runtime collection settings take priority over authored token values')
})

test('preview loader keeps post drafts local while other sources retain their callable path', async () => {
  const api = readFileSync(new URL('../components/cms/blockApi.vue', import.meta.url), 'utf8')
  const declarations = api.slice(api.indexOf('const draftPostContext ='), api.indexOf('const collectionRequestSignature ='))
  const props = reactive({ draftPostPreview: context, siteId: 'site' })
  const calls = []
  const edgeGlobal = {
    edgeState: { currentOrganization: 'org', organizationDocPath: 'organizations/org' },
    cmsCollectionData: async (_, values, meta) => {
      calls.push(Object.keys(meta))
      return { ...values, siteDoc: [{ title: 'Site settings' }] }
    },
  }
  const loader = runInNewContext(`${declarations}; ({ loadPreviewCollections })`, { props, computed, edgeGlobal, edgeFirebase: { data: { 'organizations/org/sites/site/posts': posts } }, isDraftPostPreviewSource, resolveDraftPostPreviewSource })
  const loaded = await loader.loadPreviewCollections({ people: [{ title: 'Old published fallback' }] }, { people: source, siteDoc: { collection: { path: 'sites' } } }, 'site')
  assert.equal(loaded.people[0].title, 'Alpha updated draft')
  assert.deepEqual(Array.from(calls[0]), ['siteDoc'])
  calls.length = 0
  await loader.loadPreviewCollections({}, { people: source }, 'site')
  assert.equal(calls.length, 0, 'Post-only previews do not request published collection data')
  props.draftPostPreview = null
  await loader.loadPreviewCollections({}, { people: source }, 'site')
  assert.deepEqual(Array.from(calls[0]), ['people'], 'Ordinary previews keep the existing published path')
})

test('custom index preview context is wired only to the main area and site thumbnails', () => {
  const page = readFileSync(new URL('../components/cms/page.vue', import.meta.url), 'utf8')
  const mainStart = page.indexOf('<TabsContent value="list" class="mt-0">')
  const main = page.slice(mainStart, page.indexOf('<TabsContent value="post"', mainStart))
  assert.match(main, /:draft-post-preview="draftPostPreviewContext\(slotProps.workingDoc/)
  assert.equal((page.match(/:draft-post-preview=/g) || []).length, 1, 'Detail previews keep their existing single-entry behavior')
  const site = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
  assert.equal((site.match(/:draft-post-preview=/g) || []).length, 2)
  assert.equal((site.match(/draftPosts: draftPostPreviewContext/g) || []).length, 2, 'Both thumbnail cache signatures track draft changes')
  const api = readFileSync(new URL('../components/cms/blockApi.vue', import.meta.url), 'utf8')
  assert.match(api, /draftPostPreview\?\.orgId !== edgeGlobal.edgeState.currentOrganization/)
  assert.match(api, /draftPostPreview\?\.siteId !== props.siteId/)
  assert.match(api, /draftPosts: draftPosts.value/)
  assert.match(api, /if \(isDraftPostPreviewSource\(cfg, draftPostContext.value\)\) \{/)
  assert.match(api, /resolveDraftPostPreviewSource\(sourceName, prepared/)
})

for (const component of ['page', 'site', 'block', 'blockApi']) {
  test(`${component} script and template compile with preview-only draft context`, () => {
    const filename = new URL(`../components/cms/${component}.vue`, import.meta.url)
    const { descriptor } = parse(readFileSync(filename, 'utf8'))
    const script = compileScript(descriptor, { id: `draft-post-${component}` })
    const result = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: `draft-post-${component}`, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [])
  })
}
