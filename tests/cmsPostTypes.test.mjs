import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { renderTemplateAsync } from '@edgedev/template-engine'
import { buildPostTypeFields, buildTypedPost, collectPostFields, getPostTypes, postTypeKey, postTypeSchema, preparePostTypePage, postProjection, setPostPath, validateTypedPostMetadata, withPostProjection } from '../lib/cmsPostTypes.js'
import { postSitemapOptions, reconcilePostSitemaps } from '../lib/cmsSitemapSettings.js'
const require = createRequire(import.meta.url)
const noPostTypeSeed = !existsSync(new URL('../../scripts/emulator/seed-post-types.mjs', import.meta.url)) && 'needs the Hub\'s scripts/emulator/seed-post-types.mjs'
const { buildPostKvMetadata } = require('../../functions/helpers/cmsPostKvMetadata.js')
const { refreshPostTypeMetadata } = require('../../functions/helpers/cmsPostTypeRefresh.js')

const block = (template, extra = {}) => ({ id: 'hero', templateVersion: 2, template, dataSources: { entries: { type: 'collection', path: 'posts' } }, ...extra })
const page = () => ({ name: 'Stories', post: true, postType: { enabled: true, icon: 'BookOpen' }, content: [block('{{#for entry in source("entries")}}<h2>{{ entry.headline }}</h2>{{{#if {"cond":"entry.featured"}}}}<img src="{{ entry.photo }}">{{{/if}}}{{/for}}')], postContent: [{ id: 'hero', useForCustomPost: true, templateVersion: 2, template: '<h1>{{headline}}</h1><div>{{{body}}}</div>', schema: { headline: { type: 'text', required: true }, body: { type: 'richtext' }, featured: { type: 'boolean', default: false }, photo: { type: 'image' } }, values: { headline: 'Template default' } }], postStructure: [{ id: 'row', columns: [{ id: 'col', span: 12, blocks: ['hero'] }] }] })
const post = () => ({ name: 'example', title: 'Example', blurb: 'Preview', headline: 'Actual headline', body: '<p>Actual body</p>', featured: false, photo: '' })

test('types are site-local, use page names/icons, and have case-sensitive stable identities', () => {
  assert.equal(getPostTypes({ a: page(), other: { ...page(), post: false } }).length, 1)
  assert.equal(getPostTypes({ a: page() })[0].icon, 'BookOpen')
  assert.notEqual(postTypeKey('ABC'), postTypeKey('abc'))
})
test('index dependencies include loop aliases, conditionals and function arguments', () => {
  assert.deepEqual(collectPostFields(page().content), ['featured', 'headline', 'photo'])
  assert.deepEqual(collectPostFields([block('{{#for p in source("entries")}}{{ default(p.name,p.title) }}{{#for child in p.children}}{{ child.title }}{{/for}}{{/for}}')]), ['children', 'name', 'title'])
})
test('non-post sources and shadowed aliases do not become post metadata', () => {
  const item = block('{{#for p in source("entries")}}{{p.title}}{{#for p in source("offices")}}{{p.private}}{{/for}}{{p.name}}{{/for}}', { dataSources: { entries: { type: 'collection', path: 'posts' }, offices: { type: 'collection', path: 'offices' } } })
  assert.deepEqual(collectPostFields([item]), ['name', 'title'])
})
test('computed post field names fail explicitly and private dependencies cannot publish', () => {
  assert.throws(() => collectPostFields([block('{{#for p in source("entries")}}{{p[key]}}{{/for}}')]), /explicit schema/)
  const definition = page(); definition.postContent[0].schema.headline.private = true
  assert.throws(() => postProjection(definition), /private post field/)
})
test('values-only records carry no copied layout, definitions, sources or arbitrary access fields', () => {
  const result = buildTypedPost({ page: page(), pageId: 'a', post: { ...post(), roles: ['admin'], content: [{ template: 'bad' }], structure: [], uid: 'other', arbitrary: 'not allowed' } })
  assert.equal(result.headline, 'Actual headline')
  assert.equal(result.featured, false)
  for (const key of ['roles', 'content', 'structure', 'uid', 'arbitrary', 'schema', 'dataSources']) assert.ok(!Object.hasOwn(result, key), key)
  assert.equal(result.type, postTypeKey('a'))
  assert.equal(result.postTypeId, 'a')
  assert.match(result.postTypeSchema, /^v1:[0-9a-f]{16}$/)
  assert.ok(!result.postTypeSchema.includes('headline'))
})
test('prototype paths and required/type errors are rejected', () => {
  assert.throws(() => setPostPath({}, '__proto__.polluted', true), /Unsupported/)
  assert.throws(() => buildTypedPost({ page: page(), pageId: 'a', post: { ...post(), headline: '' } }), /required/)
  assert.throws(() => buildTypedPost({ page: page(), pageId: 'a', post: { ...post(), featured: 'false' } }), /true or false/)
})
test('row reordering preserves schema identity, while incompatible fields block stale editors', () => {
  const definition = page(), before = postTypeSchema(definition)
  definition.postStructure.reverse()
  assert.equal(postTypeSchema(definition), before)
  const saved = buildTypedPost({ page: definition, pageId: 'a', post: post() })
  definition.postContent[0].schema.headline.type = 'richtext'
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'a', post: saved }), /fields changed/)
})
test('the installed renderer renders a values-only post with its page template unchanged', async () => {
  const definition = preparePostTypePage(page(), 'a')
  const saved = buildTypedPost({ page: definition, pageId: 'a', post: post() })
  const detail = definition.postContent[0]
  const html = await renderTemplateAsync(detail.template, detail.values, detail.meta, { templateVersion: 2, schema: detail.schema, dataSources: { ...detail.dataSources, cmsPost: { value: [saved] } } })
  assert.match(html, /Actual headline/)
  assert.match(html, /Actual body/)
  assert.ok(!html.includes('Template default'))
  assert.deepEqual(preparePostTypePage(definition, 'a'), definition, 'preparation is idempotent')
  assert.equal(definition.postContent[0].meta.cmsPost.queryItems.type, saved.type)
})
test('publishing projection adds required dynamic fields using the existing metadata contract', () => {
  const definition = preparePostTypePage(page(), 'a')
  const result = withPostProjection(buildTypedPost({ page: definition, pageId: 'a', post: post() }), definition)
  const params = { orgId: 'org', siteId: 'site', postId: 'one' }
  const metadata = buildPostKvMetadata(result, params)
  assert.equal(metadata.headline, post().headline)
  assert.equal(metadata.featured, false)
  assert.ok(!Object.hasOwn(metadata, 'body'))
  assert.deepEqual(validateTypedPostMetadata(result, params), { ...metadata, canonical: 'posts:org:site:one' })
  result.headline = 'é'.repeat(1000)
  assert.throws(() => buildPostKvMetadata(result, params), /1,024/)
  assert.throws(() => validateTypedPostMetadata(result, params), /1,024/)
})
const legacyPage = kind => ({ post: true, postContent: [block('{{#for p in source("entries")}}{{p.title}}{{/for}}', { dataSources: { entries: { type: 'collection', path: 'posts', queryItems: { type: kind } } } })] })
const manual = { collection: 'offices', fileName: 'offices.xml', routePrefix: 'offices', pathField: 'name', scope: 'org', indexField: 'name' }
const sitemap = () => ({ posts: { post: true, event: true, 'page:a': true }, collections: [manual], apis: [] })
const menus = { 'Site Root': [{ name: 'news', item: 'second' }, { name: 'blog', item: 'first' }, { name: 'events', item: 'event' }, { name: 'stories', item: 'a' }] }
const pages = () => ({ first: legacyPage('post'), second: legacyPage('post'), event: legacyPage('event'), a: page() })

test('sitemap options include Default, Event and only this site’s custom definitions', () => {
  assert.deepEqual(postSitemapOptions({ a: page() }).map(({ id, name }) => [id, name]), [['post', 'Default'], ['event', 'Event'], ['page:a', 'Stories']])
})
test('sitemap publication uses first matching page in menu order and supports custom type filters', () => {
  const result = reconcilePostSitemaps({ settings: sitemap(), pages: pages(), menus })
  assert.equal(result.collections.length, 4)
  assert.equal(result.collections.find(row => row.managedPostType === 'post').routePrefix, 'news')
  assert.equal(result.collections.find(row => row.managedPostType === 'page:a').indexValue, postTypeKey('a'))
  assert.deepEqual(result.collections[0], manual)
  assert.deepEqual(reconcilePostSitemaps({ settings: result, pages: pages(), menus }), result)
})
test('disabled or missing published types remove only managed rows and never guess routes', () => {
  const first = reconcilePostSitemaps({ settings: sitemap(), pages: pages(), menus })
  first.posts.post = false
  const current = pages(); delete current.a
  const result = reconcilePostSitemaps({ settings: first, pages: current, menus })
  assert.deepEqual(result.collections.filter(row => row.managedPostType).map(row => row.managedPostType), ['event'])
  assert.deepEqual(result.collections[0], manual)
})
test('an equivalent post sitemap is adopted without duplicates or changing its destination', () => {
  const settings = sitemap()
  settings.collections.push({ collection: 'posts', scope: 'site', routePrefix: 'news', pathField: 'name', indexField: 'type', indexValue: 'post', fileName: 'manual-news.xml' })
  const result = reconcilePostSitemaps({ settings, pages: pages(), menus })
  assert.equal(result.collections.filter(row => row.indexValue === 'post').length, 1)
  assert.equal(result.collections.find(row => row.fileName === 'manual-news.xml').managedPostType, 'post')
  assert.equal(result.collections.find(row => row.fileName === 'manual-news.xml').routePrefix, 'news')
  assert.deepEqual(reconcilePostSitemaps({ settings: result, pages: pages(), menus }), result)
})
test('no preferences means existing sitemap configurations remain unchanged', () => {
  const config = { collections: [manual], apis: [] }
  assert.deepEqual(reconcilePostSitemaps({ settings: config, pages: pages(), menus }), config)
})
test('sitemap controls hide managed entries and field editor has no structural controls', () => {
  const sitemapSource = readFileSync(new URL('../components/cms/sitemapSettings.vue', import.meta.url), 'utf8')
  assert.match(sitemapSource, /filter\(row => !postSitemapOwner\(row, props.pages\)\)/)
  const editorSource = readFileSync(new URL('../components/cms/typedPosts.vue', import.meta.url), 'utf8')
  assert.ok(!editorSource.includes('<draggable'))
  assert.ok(!editorSource.includes('<edge-cms-block-picker'))
})
test('shared and deployable model, metadata and refresh helpers match byte-for-byte', () => {
  for (const file of ['cmsPostTypes.mjs', 'cmsPostTypeRefresh.js', 'cmsPostKvMetadata.js']) assert.equal(readFileSync(new URL(`../../functions/helpers/${file}`, import.meta.url), 'utf8'), readFileSync(new URL(`../functions/helpers/${file}`, import.meta.url), 'utf8'))
  assert.equal(readFileSync(new URL('../lib/cmsPostTypes.js', import.meta.url), 'utf8'), readFileSync(new URL('../../functions/helpers/cmsPostTypes.mjs', import.meta.url), 'utf8'))
})

// Exercise transactional refresh with the same mutable source/state boundaries as
// Firestore: late events reread the current page, deleted posts are not recreated.
const refreshFixture = () => {
  let currentPage = page()
  const docs = new Map([['one', withPostProjection(buildTypedPost({ page: currentPage, pageId: 'a', post: post() }), currentPage)], ['other', { postTypeId: 'different', title: 'Untouched' }]])
  let writes = 0
  const pageRef = { get: () => ({ exists: !!currentPage, data: () => currentPage }) }
  const query = { where() { return this }, orderBy() { return this }, limit() { return this }, startAfter() { return { get: async () => ({ empty: true, docs: [] }) } }, async get() { return { empty: false, docs: [...docs.entries()].filter(([, doc]) => doc.postTypeId === 'a').map(([id]) => ({ id, ref: { id } })) } } }
  const siteRef = { id: 'site', parent: { parent: { id: 'org' } }, collection: name => name === 'published' ? { doc: () => pageRef } : query }
  const db = { runTransaction: async callback => callback({ get: async ref => ref === pageRef ? pageRef.get() : ({ exists: docs.has(ref.id), data: () => docs.get(ref.id) }), update: (ref, data) => { writes++; docs.set(ref.id, { ...docs.get(ref.id), ...data }) } }) }
  return { docs, setPage: page => { currentPage = page }, get writes() { return writes }, run: () => refreshPostTypeMetadata({ db, siteRef, pageId: 'a', documentId: '__name__' }) }
}
test('metadata refresh is type-scoped, idempotent and reads the newest published projection', async () => {
  const f = refreshFixture()
  assert.deepEqual(await f.run(), { updated: 0, skipped: 1 })
  const current = page(); current.content[0].template = '{{#for p in source("entries")}}{{p.body}}{{/for}}'
  f.setPage(current)
  assert.deepEqual(await f.run(), { updated: 1, skipped: 0 })
  assert.deepEqual(f.docs.get('one').postTypeProjection.fields, ['body'])
  assert.equal(f.docs.get('other').title, 'Untouched')
  await f.run()
  assert.equal(f.writes, 1)
  f.setPage(null)
  await f.run()
  assert.equal(f.writes, 1)
})

test('explicit semantic fields separate repeated placements without copying the layout', async () => {
  const definition = page()
  definition.postContent = ['hero', 'footer'].map(id => ({ id, useForCustomPost: true, templateVersion: 2, template: '<h2>{{heading}}</h2>', schema: { heading: { type: 'text', postField: `${id}.heading` } }, values: {} }))
  const prepared = preparePostTypePage(definition, 'a')
  const saved = buildTypedPost({ page: prepared, pageId: 'a', post: { ...post(), hero: { heading: 'Hero value' }, footer: { heading: 'Footer value' } } })
  for (const detail of prepared.postContent) {
    const html = await renderTemplateAsync(detail.template, detail.values, detail.meta, { templateVersion: 2, schema: detail.schema, dataSources: { cmsPost: { value: [saved] } } })
    assert.match(html, new RegExp(saved[detail.id].heading))
  }
  assert.equal(saved.postContent, undefined)
})
test('repeated values validate nested fields and preserve false and zero', () => {
  const definition = page()
  definition.postContent[0].schema.items = { type: 'array', schema: [{ field: 'title', type: 'text', validation: { required: true } }, { field: 'visible', type: 'boolean' }, { field: 'count', type: 'number' }] }
  const record = buildTypedPost({ page: definition, pageId: 'a', post: { ...post(), items: [{ title: 'Entry', visible: false, count: 0 }] } })
  assert.deepEqual(record.items, [{ title: 'Entry', visible: false, count: 0 }])
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'a', post: { ...post(), items: [{ title: '', visible: false, count: 0 }] } }), /required/)
})
test('legacy array directives contribute post fields to the metadata projection', () => {
  assert.deepEqual(collectPostFields([block('{{{#array {"field":"entries"}}}}{{ item.title }}{{{/array}}}')]), ['title'])
})

test('empty entry previews show editable content without storing placeholder values', { skip: noPostTypeSeed }, async () => {
  const { buildPostTypeFixtures } = await import('../../scripts/emulator/seed-post-types.mjs')
  const { buildPostEntryPreviewBlock, postEntryPreviewRows } = await import('../lib/cmsPostEntryPreview.js')
  const definition = buildPostTypeFixtures('testorg').find(doc => doc.path.endsWith('/posttypeqa/pages/stories')).data
  const empty = { title: '', name: '', blurb: '', headline: '', photo: '', body: '', featured: false, highlights: [] }
  const original = structuredClone(empty)
  const rows = postEntryPreviewRows(definition)
  // The shared editorial note belongs to the detail page, not the entry.
  assert.equal(rows.length, 4)
  const body = buildPostEntryPreviewBlock(definition, 'storyBody', empty)
  const html = await renderTemplateAsync(body.template, body.values, body.meta, { templateVersion: 2, schema: body.schema, dataSources: body.dataSources })
  assert.match(html, /Article body goes here/)
  assert.match(html, /<p>/)
  assert.doesNotMatch(html, /&lt;p|\{<p|<\/p>\}/)
  assert.deepEqual(empty, original)
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'stories', post: empty }), /required/)
  const highlights = buildPostEntryPreviewBlock(definition, 'storyHighlights', empty)
  const cards = await renderTemplateAsync(highlights.template, highlights.values, highlights.meta, { templateVersion: 2, schema: highlights.schema, dataSources: highlights.dataSources })
  assert.match(cards, /title/)
  assert.match(cards, /description/)
})

test('the review fixtures contain distinct editable blocks and render real rich text cleanly', { skip: noPostTypeSeed }, async () => {
  const { buildPostTypeFixtures } = await import('../../scripts/emulator/seed-post-types.mjs')
  const { buildPostEntryPreviewBlock } = await import('../lib/cmsPostEntryPreview.js')
  const docs = buildPostTypeFixtures('testorg')
  const definition = docs.find(doc => doc.path.endsWith('/posttypeqa/pages/stories')).data
  const saved = docs.find(doc => doc.path.endsWith('/posttypeqa/posts/publishedstory')).data
  assert.equal(definition.postContent.length, 5)
  for (const row of definition.postStructure) for (const column of row.columns) for (const id of column.blocks) assert.ok(definition.postContent.some(block => block.id === id))
  const body = buildPostEntryPreviewBlock(definition, 'storyBody', saved)
  const html = await renderTemplateAsync(body.template, body.values, body.meta, { templateVersion: 2, schema: body.schema, dataSources: body.dataSources })
  assert.match(html, /<p>Edit this rich text/)
  assert.doesNotMatch(html, /&lt;p|\{<p|<\/p>\}/)
  assert.equal(saved.content, undefined)
  assert.equal(saved.structure, undefined)
})

test('custom event entries retain type identity, compute timezone dates and validate required event details', async () => {
  const { postEventPublishProblem } = await import('../lib/cmsPostEvents.mjs')
  const definition = page()
  definition.postType.event = true
  const input = { ...post(), event: { startAt: '2026-12-10T10:00', endAt: '2026-12-10T11:00', timezone: 'America/Denver', isVirtual: true } }
  const saved = buildTypedPost({ page: definition, pageId: 'workshop', post: input })
  assert.equal(saved.type, postTypeKey('workshop'))
  assert.equal(saved.postTypeId, 'workshop')
  assert.equal(saved.event.startAtUtc, '2026-12-10T17:00:00.000Z')
  assert.equal(saved.event.endAtUtc, '2026-12-10T18:00:00.000Z')
  assert.equal(saved.event.unpublishPastEvent, true)
  assert.equal(postEventPublishProblem(saved, Date.parse('2026-12-10T17:30Z')), '')
  assert.match(postEventPublishProblem(saved, Date.parse('2026-12-10T18:00Z')), /Event End At/)
  assert.equal(postEventPublishProblem({ ...saved, event: { ...saved.event, unpublishPastEvent: false } }, Date.parse('2027-01-01')), '')
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'workshop', post: post() }), /Start At is required/)
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'workshop', post: { ...input, event: { ...input.event, endAt: '2026-12-10T09:00' } } }), /must be after/)
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'workshop', post: { ...input, event: { ...input.event, timezone: 'invalid' } } }), /timezone|time zone/)
  assert.throws(() => buildTypedPost({ page: definition, pageId: 'workshop', post: { ...input, event: { ...input.event, isVirtual: false } } }), /Location Name/)
  assert.equal(buildTypedPost({ page: page(), pageId: 'story', post: input }).event, undefined)
  assert.equal(postTypeSchema(definition), postTypeSchema(page()))
  assert.equal(input.event.startAtUtc, undefined)
})

test('shared event module stays identical in both Functions copies', () => {
  const source = readFileSync(new URL('../lib/cmsPostEvents.mjs', import.meta.url), 'utf8')
  for (const path of ['../../functions/helpers/cmsPostEvents.mjs', '../functions/helpers/cmsPostEvents.mjs'])
    assert.equal(readFileSync(new URL(path, import.meta.url), 'utf8'), source)
})

test('custom event template values are managed by event details rather than inferred text fields', () => {
  const definition = page()
  definition.postType.event = true
  definition.postContent.push({ id: 'eventSummary', templateVersion: 2, template: '{{ post.event.startAt }} · {{ post.event.locationName }}', schema: {}, values: {} })
  assert.ok(!buildPostTypeFields(definition).some(field => field.field === 'event' || field.field.startsWith('event.')))
})

test('scheduled publication guard applies to custom events as well as regular events', async () => {
  const { runInNewContext } = await import('node:vm')
  const source = readFileSync(new URL('../../functions/cms.js', import.meta.url), 'utf8')
  const guardSource = source.slice(source.indexOf('const toBool ='), source.indexOf('const yyyyMM ='))
  const guard = runInNewContext(`${guardSource}; canPublishEventAt`, { Date })
  const event = { endAtUtc: '2026-12-10T18:00:00.000Z', unpublishPastEvent: true }
  for (const envelope of [{ type: 'event' }, { type: 'custom-workshop', postTypeId: 'workshop' }]) {
    assert.equal(guard({ ...envelope, event }, Date.parse('2026-12-10T18:30Z')).allowed, false)
    assert.equal(guard({ ...envelope, event }, Date.parse('2026-12-10T17:30Z')).allowed, true)
    assert.equal(guard({ ...envelope, event: { ...event, unpublishPastEvent: false } }, Date.parse('2026-12-10T18:30Z')).allowed, true)
  }
  assert.equal(guard({ type: 'post', event }, Date.parse('2026-12-10T18:30Z')).allowed, true)
})
