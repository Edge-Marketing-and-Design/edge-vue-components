import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { createSitemapSettings, normalizeSitemapSettings, prepareSitemapSettings, postSitemapChoices, postSitemapOwner, reconcilePostSitemaps, validateSitemapSettings } from '../lib/cmsSitemapSettings.js'
import { normalizeAnalyticsEvents, normalizeSiteDomainSettings, siteSettingsDefaults } from '../lib/cmsOperations.js'

const example = () => ({
  collections: [
    { collection: 'agents', fileName: 'agents_sitemap.xml', routePrefix: 'agents', scope: 'org', indexField: 'agent', indexValue: true },
    { collection: 'posts', fileName: 'posts_sitemap.xml', routePrefix: 'blog', pathField: 'name', scope: 'site', indexField: 'type', indexValue: 'post' },
  ],
  apis: [
    { fileName: 'mt_properties_sitemap.xml', sourceUrl: 'https://api.example.com/sitemap?state=MT&page=1' },
    { fileName: 'id_properties_sitemap.xml', sourceUrl: 'https://api.example.com/sitemap?state=ID&page=1' },
  ],
})

test('normalization keeps typed filters and data scope without org-level config or site IDs', () => {
  const input = example()
  input.collections[0].siteIds = ['other-site']
  const config = prepareSitemapSettings(input)
  assert.equal(config.collections[0].indexValue, true)
  assert.equal(config.collections[1].scope, 'site')
  assert.equal(config.collections[1].indexValue, 'post')
  assert.equal('siteIds' in config.collections[0], false)
  assert.deepEqual(config.apis, input.apis)
  assert.equal('property' in config, false)
  for (const value of [false, 0, 3, 'post']) {
    input.collections[0].indexValue = value
    assert.equal(prepareSitemapSettings(input).collections[0].indexValue, value)
  }
})

test('absent settings remain unconfigured, while an explicit empty config stays explicit', () => {
  assert.equal(prepareSitemapSettings(undefined), null)
  assert.equal(prepareSitemapSettings(null), null)
  assert.deepEqual(prepareSitemapSettings({}), createSitemapSettings())
  assert.deepEqual(validateSitemapSettings(createSitemapSettings()), [])
})

test('incomplete entries, reserved or duplicate names and invalid paths cannot be saved', () => {
  for (const patch of [
    { collection: '' }, { collection: 'sites/other' }, { fileName: '../map.xml' },
    { fileName: 'sitemap.xml' }, { fileName: 'pages_sitemap.xml' },
    { routePrefix: '', pathField: '' }, { routePrefix: 'https://other.test' }, { routePrefix: 'a//b' },
    { scope: 'other-site' }, { indexField: 'bad field' }, { indexValue: {} }, { indexValue: Number.NaN },
  ]) {
    const input = example()
    Object.assign(input.collections[0], patch)
    assert.throws(() => prepareSitemapSettings(input), Error, JSON.stringify(patch))
  }
  const duplicate = example()
  duplicate.collections[1].fileName = 'AGENTS_sitemap.xml'
  assert.throws(() => prepareSitemapSettings(duplicate), /unique filename/)
  const empty = { collections: [{}] }
  assert.equal(normalizeSitemapSettings(empty).collections.length, 1)
  assert.ok(validateSitemapSettings(empty).length > 0)
})

test('multiple API sources preserve query strings and validate filenames across both source types', () => {
  const input = example()
  input.apis[0].sourceUrl = ' https://api.example.com/sitemap?state=MT&page=1&tag=a%2Fb&tag=c '
  const config = prepareSitemapSettings(input)
  assert.equal(config.apis.length, 2)
  assert.equal(config.apis[0].sourceUrl, input.apis[0].sourceUrl.trim())
  assert.equal(config.apis[1].sourceUrl, input.apis[1].sourceUrl)
  for (const url of ['', 'http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com/#fragment']) {
    const invalid = example()
    invalid.apis[0].sourceUrl = url
    assert.throws(() => prepareSitemapSettings(invalid), /HTTPS API URL/)
  }
  for (const filename of ['AGENTS_sitemap.xml', 'ID_properties_sitemap.xml', 'sitemap.xml', 'pages_sitemap.xml', '../other.xml', '']) {
    const invalid = example()
    invalid.apis[0].fileName = filename
    assert.throws(() => prepareSitemapSettings(invalid), /filename/)
  }
  assert.throws(() => prepareSitemapSettings({ apis: {} }), /must be a list/)
  assert.throws(() => prepareSitemapSettings({ apis: [null] }), /API sitemap 1/)
})

const source = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const names = ['normalizeForCompare', 'stableSerialize', 'areEqualNormalized', 'isSiteDiff', 'saveSiteSettingsDocument', 'publishSiteSettings', 'discardSiteSettings']
const declarations = names.map((name) => {
  const start = script.indexOf(`const ${name} =`)
  assert.ok(start >= 0, name)
  const end = script.indexOf('\nconst ', start + 1)
  return script.slice(start, end < 0 ? script.length : end)
}).join('\n')
function fixture() {
  const published = { docId: 'site' }
  const draft = { ...published }
  const writes = []
  const context = {
    console: { log() {} }, computed: fn => ({ get value() { return fn() } }),
    props: { site: 'site' }, siteData: { value: draft },
    createSiteSettingsDefaults: siteSettingsDefaults, normalizeAnalyticsEvents, normalizeSiteDomainSettings, prepareSitemapSettings, reconcilePostSitemaps, publishedPages: { value: {} }, publishedSiteSettings: { value: {} },
    contactSpamDiffValue: doc => doc.contactSpam || null, getNextVersion: () => 'v2',
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    edgeFirebase: {
      data: { 'organizations/org/published-site-settings': { site: published } },
      storeDoc: async (path, data) => { writes.push({ path, data }); return { success: true } },
      changeDoc: async (path, id, data) => { writes.push({ path, id, data }); return { success: true } },
    },
  }
  const actions = runInNewContext(`${declarations};({isSiteDiff,save:saveSiteSettingsDocument,publish:publishSiteSettings,discard:discardSiteSettings})`, context)
  return { draft, published, writes, ...actions }
}

test('real settings save writes draft only, detects sitemap changes, and publishes through existing projection', async () => {
  const f = fixture()
  assert.equal(f.isSiteDiff.value, false)
  f.draft.sitemap = example()
  assert.equal(f.isSiteDiff.value, true)
  await f.save(f.draft)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].path, 'organizations/org/sites')
  assert.deepEqual(f.writes[0].data.sitemap.apis, example().apis)
  await f.publish()
  assert.equal(f.writes.at(-1).path, 'organizations/org/published-site-settings')
  assert.deepEqual(f.writes.at(-1).data.sitemap, prepareSitemapSettings(example()))
  assert.equal(f.writes.some(w => w.path === 'organizations/org'), false)
})

test('invalid sitemap drafts never write, and discard restores published or unconfigured state', async () => {
  const f = fixture()
  f.draft.sitemap = { collections: [{}] }
  await assert.rejects(f.save(f.draft), /Collection sitemap/)
  await assert.rejects(f.publish(), /Collection sitemap/)
  assert.equal(f.writes.length, 0)
  f.published.sitemap = example()
  await f.discard()
  assert.equal(f.writes.at(-1).data.sitemap, f.published.sitemap)
  delete f.published.sitemap
  await f.discard()
  assert.equal(f.writes.at(-1).data.sitemap, null)
})

test('editor controls update only this draft, preserve typed values, and do not initialize on open', () => {
  const editor = readFileSync(new URL('../components/cms/sitemapSettings.vue', import.meta.url), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const props = { modelValue: null }
  const writes = []
  const context = {
    defineProps: () => props,
    defineEmits: () => (event, value) => { writes.push({ event, value }); props.modelValue = value },
    computed: fn => ({ get value() { return fn() } }),
    createSitemapSettings, postSitemapChoices, postSitemapOwner, validateSitemapSettings,
  }
  const actions = runInNewContext(`${editor};({config,errors,addRow,updateRow,removeRow,changeFilterType,updateFilterValue,filterType,addApi,updateApi,removeApi,setPostEnabled})`, context)
  assert.equal(actions.config.value.collections.length, 0)
  assert.equal(writes.length, 0)
  actions.addRow()
  assert.ok(actions.errors.value.length > 0)
  actions.updateRow(0, { collection: 'agents', fileName: 'agents_sitemap.xml', routePrefix: 'agents', indexField: 'agent' })
  actions.changeFilterType(0, 'Boolean')
  assert.equal(props.modelValue.collections[0].indexValue, true)
  actions.updateRow(0, { indexValue: false })
  assert.equal(prepareSitemapSettings(props.modelValue).collections[0].indexValue, false)
  actions.changeFilterType(0, 'Number')
  actions.updateFilterValue(0, props.modelValue.collections[0], '0')
  assert.equal(prepareSitemapSettings(props.modelValue).collections[0].indexValue, 0)
  actions.updateFilterValue(0, props.modelValue.collections[0], '')
  assert.ok(actions.errors.value.some(message => message.includes('finite number')))
  actions.changeFilterType(0, 'All values')
  assert.equal('indexValue' in prepareSitemapSettings(props.modelValue).collections[0], false)
  actions.addApi()
  assert.ok(actions.errors.value.some(message => message.includes('API sitemap 1')))
  actions.updateApi(0, { fileName: 'first.xml', sourceUrl: 'https://api.test/sitemap?category=one&page=1' })
  actions.addApi()
  actions.updateApi(1, { fileName: 'second.xml', sourceUrl: 'https://api.test/sitemap?category=two&page=1' })
  assert.equal(actions.errors.value.length, 0)
  actions.removeRow(0)
  assert.equal(props.modelValue.collections.length, 0)
  assert.equal(props.modelValue.apis.length, 2)
  actions.removeApi(0)
  assert.equal(props.modelValue.apis.length, 1)
  assert.equal(props.modelValue.apis[0].fileName, 'second.xml')
  assert.equal(actions.errors.value.length, 0)
  const existingSources = JSON.stringify({ collections: props.modelValue.collections, apis: props.modelValue.apis })
  actions.setPostEnabled('post', true)
  assert.equal(props.modelValue.posts.post, true)
  assert.equal(JSON.stringify({ collections: props.modelValue.collections, apis: props.modelValue.apis }), existingSources)
  props.modelValue = example()
  actions.setPostEnabled('event', true)
  assert.equal(props.modelValue.posts.post, true)
  assert.equal(props.modelValue.posts.event, true)
  actions.setPostEnabled('post', false)
  assert.equal(props.modelValue.posts.post, false)
})

test('sitemap tab remains available outside Dev Mode, with advanced sources gated separately', () => {
  const form = readFileSync(new URL('../components/cms/siteSettingsForm.vue', import.meta.url), 'utf8')
  const script = form.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const start = script.indexOf('const activeSettingsTab =')
  const end = script.indexOf('\nconst normalizeContactSpamSettings', start)
  let onToggle
  const props = { showSitemaps: true }
  const edgeGlobal = { edgeState: { devOverride: false } }
  const result = runInNewContext(`${script.slice(start, end)};({activeSettingsTab,showSitemapsTab})`, {
    props, edgeGlobal, ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch: (_, fn) => { onToggle = fn },
  })
  assert.equal(result.showSitemapsTab.value, true)
  result.activeSettingsTab.value = 'sitemaps'
  edgeGlobal.edgeState.devOverride = true
  assert.equal(result.showSitemapsTab.value, true)
  edgeGlobal.edgeState.devOverride = false
  assert.equal(result.showSitemapsTab.value, true)
  assert.equal(result.activeSettingsTab.value, 'sitemaps')
  props.showSitemaps = false
  onToggle(false)
  assert.equal(result.showSitemapsTab.value, false)
  assert.equal(result.activeSettingsTab.value, 'seo')
  const editor = readFileSync(new URL('../components/cms/sitemapSettings.vue', import.meta.url), 'utf8')
  const visibilityExpression = editor.match(/const showDeveloperSources = computed\(\(\) => ([^\n]+)\)/)[1]
  assert.equal(runInNewContext(visibilityExpression, { edgeGlobal }), false)
  edgeGlobal.edgeState.devOverride = true
  assert.equal(runInNewContext(visibilityExpression, { edgeGlobal }), true)
  assert.match(editor, /<section v-if="showDeveloperSources"[^>]+aria-label="Collection sitemaps"/)
  assert.match(editor, /<section v-if="showDeveloperSources"[^>]+aria-label="API sitemaps"/)
  assert.match(editor, /<section class="space-y-3" aria-label="Post sitemaps"/)
  assert.match(form, /<TabsContent v-if="showSitemapsTab" value="sitemaps"/)
  assert.match(source, /:show-sitemaps="isPersistedSiteRoute"/)
})

test('existing post sitemaps check Default without changing saved settings; explicit off wins', () => {
  const settings = example()
  const before = JSON.stringify(settings)
  assert.deepEqual(postSitemapChoices(settings), { post: true })
  assert.equal(postSitemapOwner(settings.collections[0]), '')
  assert.equal(postSitemapOwner(settings.collections[1]), 'post')
  assert.equal(JSON.stringify(settings), before)
  settings.posts = { post: false }
  assert.equal(postSitemapChoices(settings).post, false)
  assert.equal(postSitemapChoices({ collections: [{ ...settings.collections[1], scope: 'org' }] }).post, undefined)
  assert.equal(postSitemapChoices({ collections: [{ ...settings.collections[1], pathField: 'customUrl' }] }).post, undefined)
})

test('publishing adopts a legacy post sitemap and disabling Default actually removes it', () => {
  const pages = { blog: { post: true, content: [{ dataSources: { posts: { path: 'posts', queryItems: { type: 'post' } } } }] } }
  const menus = { 'Site Root': [{ item: 'blog', name: 'blog' }] }
  const settings = { ...example(), posts: { event: false } }
  const published = reconcilePostSitemaps({ settings, pages, menus })
  const postRows = published.collections.filter(row => row.collection === 'posts')
  assert.equal(published.posts.post, true)
  assert.equal(postRows.length, 1)
  assert.equal(postRows[0].fileName, 'posts_sitemap.xml')
  assert.equal(postRows[0].routePrefix, 'blog')
  assert.equal(postRows[0].managedPostType, 'post')
  const disabled = reconcilePostSitemaps({ settings: { ...settings, posts: { post: false } }, pages, menus })
  assert.equal(disabled.collections.some(row => row.collection === 'posts'), false)
  assert.deepEqual(disabled.collections[0], prepareSitemapSettings(example()).collections[0])
  assert.deepEqual(disabled.apis, settings.apis)
  assert.deepEqual(reconcilePostSitemaps({ settings: example(), pages, menus }), prepareSitemapSettings(example()))
})
