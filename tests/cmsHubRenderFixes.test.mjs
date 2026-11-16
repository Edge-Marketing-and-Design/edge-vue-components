import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { renderTemplateAsync } from '@edgedev/template-engine'

import { distinctSourceRecords } from '../lib/cmsDataSourceRecords.js'
import { prepareCmsCollectionPreview } from '../lib/cmsCollectionPreview.js'

import { safeParseTagConfig } from '../lib/cmsTagConfig.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const blockRenderSource = read('../components/cms/blockRender.vue')

const arrowFunctionSource = (source, name) => {
  const start = source.indexOf(`const ${name} =`)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(start, -1, `${name} should exist`)
  return source.slice(start, end + 2)
}

// hub-render-fixes-plan.md, fix 1 (X21).
test('tag configs parse as JSON first, so quoted values inside a condition survive', () => {
  assert.deepEqual(safeParseTagConfig('{"cond":"photo.size == \'large\'"}'), { cond: 'photo.size == \'large\'' })
  assert.deepEqual(safeParseTagConfig('{ field: \'title\', type: "text" }'), { field: 'title', type: 'text' }, 'the loose legacy form still parses')
  assert.equal(safeParseTagConfig('{not config'), null)
})

test('every Hub component uses the one tag config parser', () => {
  for (const file of ['blockRender.vue', 'block.vue', 'blockEditor.vue', 'blocksManager.vue']) {
    const source = read(`../components/cms/${file}`)
    assert.match(source, /import \{ safeParseTagConfig \} from '\.\.\/\.\.\/lib\/cmsTagConfig'/, file)
    assert.doesNotMatch(source, /function (normalizeConfigLiteral|safeParseTagConfig|safeParseConfig)\(/, `${file} has no local copy`)
  }
})

const createHubRenderer = (collectionSourceResolver) => runInNewContext(
  `${blockRenderSource.slice(blockRenderSource.indexOf('const getTemplateV2ValueByPath ='), blockRenderSource.indexOf('const templateV2Block ='))}\nrenderTemplateV2CmsSection`,
  { renderTemplateAsync, prepareCmsCollectionPreview, distinctSourceRecords, props: { collectionSourceResolver }, URLSearchParams },
)

test('a quoted comparison inside a loop matches in the Hub renderer', async () => {
  const renderHub = createHubRenderer()
  const tile = '{{{#if {"cond":"photo.size == \'large\'"}}}}LARGE{{{#else}}}SMALL{{{/if}}}'
  const unquoted = '{{{#if {"cond":"photo.size == large"}}}}LARGE{{{#else}}}SMALL{{{/if}}}'
  const render = (template, entry) => renderHub(`{{#for photo in photos}}${template}{{/for}}`, { photos: [entry] }, {}, {}, {})
  assert.equal(await render(tile, { size: 'large' }), 'LARGE')
  assert.equal(await render(tile, { size: 'small' }), 'SMALL')
  assert.equal(await render(unquoted, { size: 'large' }), 'LARGE', 'the unquoted form keeps working')
})

test('navigation renders pages, external links and folder children with native aliases', async () => {
  const renderHub = createHubRenderer()
  const template = `{{#for item in source("siteDoc")}}
    {{#for menuItem in item.menus.Site Root, { limit: 4 }}}
      {{{#if {"cond":"menuItem.item.type == 'external'"}}}}<a href="{{ menuItem.item.url }}">{{ menuItem.menuTitle }}</a>
      {{{#else}}}
        {{{#if {"cond":"menuItem.item == '[object Object]'"}}}}
          {{{#entries:folderEntry {"field":"menuItem.item","value":{}}}}}
            <a href="/{{ folderEntry.key }}">{{ menuItem.menuTitle }}</a>
            {{#for folderChild in folderEntry.value}}<a href="/{{ folderChild.name }}">{{ folderChild.menuTitle }}</a>{{/for}}
          {{{/entries}}}
        {{{#else}}}<a href="/{{ menuItem.name }}">{{ menuItem.menuTitle }}</a>{{{/if}}}
      {{{/if}}}
    {{/for}}
  {{/for}}`
  const site = { menus: { 'Site Root': [
    { name: 'sell-with-us', menuTitle: 'Sell With Us', item: 'page-id' },
    { name: 'phone', menuTitle: '800.577.3013', item: { type: 'external', url: 'tel:18005773013' } },
    { name: 'locations', menuTitle: 'Locations', item: { locations: [{ name: 'montana', menuTitle: 'Montana', item: 'mt-page' }] } },
  ] } }
  const sources = { siteDoc: { value: [site] } }
  const html = await renderHub(template, {}, sources, {}, {})
  assert.match(html, /href="\/sell-with-us">Sell With Us/)
  assert.match(html, /href="tel:\+18005773013">800\.577\.3013/)
  assert.match(html, /href="\/locations">Locations/)
  assert.match(html, /href="\/montana">Montana/)
  assert.doesNotMatch(html, /href="\/(url|type)"/)
  assert.equal(html, await renderTemplateAsync(template, {}, {}, { templateVersion: 2, dataSources: sources }))
  assert.deepEqual(Object.keys(sources), ['siteDoc'], 'temporary sources never mutate input or persisted sources')
})

test('parent-scoped collection queries still resolve before native nested rendering', async () => {
  const lookups = []
  const renderHub = createHubRenderer(async (name, config, overrides) => {
    lookups.push(overrides.queryItems.office)
    return [{ name: `${overrides.queryItems.office} agent`, office: overrides.queryItems.office }]
  })
  const template = `{{#for office in offices}}{{#for agent in source("agents", { queryItems: { office: office.id } })}}{{{#if {"cond":"office.active"}}}}{{ office.name }}:{{ agent.name }};{{{/if}}}{{/for}}{{/for}}`
  const html = await renderHub(template, { offices: [{ id: 'one', name: 'One', active: true }, { id: 'two', name: 'Two', active: true }] }, { agents: { type: 'collection', path: 'agents', value: [] } }, {}, {})
  assert.deepEqual(lookups, ['one', 'two'])
  assert.equal(html, 'One:one agent;Two:two agent;')
})

test('loop limits, empty loops and colliding temporary source names remain safe', async () => {
  const renderHub = createHubRenderer()
  const sources = { __cmsPreviewLoop0: { value: ['original'] } }
  const html = await renderHub('{{#for photo in photos, { limit: 1 }}}{{ photo.name }}{{/for}}{{#for absent in missing}}BAD{{/for}}', { photos: [{ name: 'First' }, { name: 'Second' }] }, sources, {}, {})
  assert.equal(html, 'First')
  assert.deepEqual(sources.__cmsPreviewLoop0.value, ['original'])
})

// Loaded records are never re-filtered by the source's own queryItems or
// canonicalLookup: the loader used them to fetch, as the template engine does.
test('a v1 leftover queryItems value does not empty a loaded Navigation source', async () => {
  const renderHub = createHubRenderer()
  const site = { docId: 'site-1', menus: { 'Site Root': [{ name: 'about', menuTitle: 'About', item: 'page-id' }] } }
  // The Dillon Binstock instance: canonical lookup plus a leftover docId filter.
  const sources = { siteDoc: { type: 'collection', path: 'sites', canonicalLookup: { key: 'org-1:site-1' }, queryItems: { docId: 'templates' }, limit: 1, value: [site] } }
  const template = '{{#for site in source("siteDoc")}}{{#for menuItem in site.menus.Site Root}}<a href="/{{ menuItem.name }}">{{ menuItem.menuTitle }}</a>{{/for}}{{/for}}'
  const html = await renderHub(template, { siteDoc: ['placeholder'] }, sources, {}, {})
  assert.equal(html, '<a href="/about">About</a>')
  assert.equal(html, await renderTemplateAsync(template, {}, {}, { templateVersion: 2, dataSources: sources }))
})

test('agent-filtered testimonials render when the filter field is not in the record body', async () => {
  const renderHub = createHubRenderer()
  // KV records fetched through the users index; their bodies carry no users field.
  const records = [{ name: 'John B.', comments: 'Great.' }, { name: 'Ann C.', comments: 'Superb.' }]
  const sources = { list: { type: 'collection', path: 'testimonials', queryItems: { users: ['agent-uid'] }, queryOptions: [{ field: 'users', operator: 'array-contains-any' }], limit: 10, value: records } }
  const template = '{{#for t in source("list")}}{{ t.name }};{{/for}}'
  const html = await renderHub(template, { list: [] }, sources, {}, {})
  assert.equal(html, 'John B.;Ann C.;')
  assert.equal(html, await renderTemplateAsync(template, {}, {}, { templateVersion: 2, dataSources: sources }))
})

test('records a scoped lookup loaded are not filtered again by the lookup fields', async () => {
  const renderHub = createHubRenderer(async () => [{ name: 'Agent' }])
  const html = await renderHub('{{#for office in offices}}{{#for agent in source("agents", { queryItems: { offices: office.id } })}}{{ agent.name }}{{/for}}{{/for}}', { offices: [{ id: 'one' }] }, { agents: { type: 'collection', path: 'agents', value: [] } }, {}, {})
  assert.equal(html, 'Agent')
})

test('a loop\'s own queryItems still filter inline records when no loader applied them', async () => {
  const renderHub = createHubRenderer()
  const html = await renderHub('{{#for agent in source("agents", { limit: 5, queryItems: { office: "two" } })}}{{ agent.name }}{{/for}}', {}, { agents: { value: [{ name: 'A', office: 'one' }, { name: 'B', office: 'two' }] } }, {}, {})
  assert.equal(html, 'B')
})

test('a content-fit canvas pins viewport-height units to a fixed screen height', () => {
  const canvasLib = read('../lib/cmsCanvas.js')
  const start = canvasLib.indexOf('const VIEWPORT_UNIT_RE')
  const end = canvasLib.indexOf('\n}\n', start)
  const pin = runInNewContext(`${canvasLib.slice(start, end + 2).replace(/export /g, '')}\npinCanvasViewportUnits`)
  const css = '.h-\\[60dvh\\]{height:60dvh;}.min-h-screen{min-height:100vh}.x{height:calc(100svh - 2rem);margin:-10lvh 0}.w-\\[50vw\\]{width:50vw}'
  assert.equal(pin(css, 800), '.h-\\[60dvh\\]{height:480px;}.min-h-screen{min-height:800px}.x{height:calc(800px - 2rem);margin:-80px 0}.w-\\[50vw\\]{width:50vw}')
  assert.equal(pin(css, 0), css)
  const pageCanvas = read('../components/cms/pageCanvas.vue')
  assert.match(pageCanvas, /if \(props\.fit === 'content'\)\s*css = pinCanvasViewportUnits\(css,/)
})

// Fix 2 (X20), X29, X30 and the theme color mapping were Hub-side CSS
// rewrites (breakpoint classes, block-content scoping, theme variables).
// Since the iframe canvas (edge 43dc9200, 2026-10-14) the Hub builds block CSS
// with the template engine's generator, as the public renderer does, at the
// canvas's real width, so those rewrites and their modules were removed.
test('the canvas builds site CSS with the public renderer\'s generator', () => {
  const canvasLib = read('../lib/cmsCanvas.js')
  assert.match(canvasLib, /import \{[^}]*unoCssFromHtml[^}]*\} from '@edgedev\/template-engine'/)
  assert.match(canvasLib, /export const buildCanvasSiteCss = async/)
  assert.match(read('../components/cms/pageCanvas.vue'), /buildCanvasSiteCss\(/)
})

// Fix 3 (X22). Since the remote MCP port (c8389ab8, 2026-10-28) token
// previews load Data Sources the way the public site does
// (helpers/cmsDataSourceRecords.mjs), replacing cmsPreviewDataSourceConfigs.
test('token previews resolve Template v2 dataSources on the server, as the public site does', async () => {
  const cmsSource = read('../../functions/cms.js')
  assert.equal(read('../functions/cms.js'), cmsSource, 'the Functions copies stay identical')
  assert.match(cmsSource, /import\('\.\/helpers\/cmsDataSourceRecords\.mjs'\)/)
  const { blockDataSources } = await import('../../functions/helpers/cmsDataSourceRecords.mjs')
  const block = {
    templateVersion: 2,
    dataSources: {
      siteDoc: { type: 'collection', path: 'sites', canonicalLookup: { key: '{orgId}:{siteId}' } },
      agents: { path: 'agents', query: [{ field: 'active', operator: '==', value: true }], queryItems: { office: '' } },
      heading: { type: 'text', value: 'Not a collection' },
    },
    meta: { agents: { queryItems: { office: 'helena' }, limit: 6 } },
  }
  const sources = JSON.parse(JSON.stringify(blockDataSources(block, { orgId: 'org1', siteId: 'site1' })))
  assert.deepEqual(sources.map(entry => entry.name), ['siteDoc', 'agents'], 'only collection sources are fetched')
  assert.equal(sources[0].source.canonicalLookup.key, 'org1:site1', 'tokens are resolved')
  assert.deepEqual(sources[1].source.queryItems, { office: 'helena' }, 'the instance query items win')
  assert.equal(sources[1].source.limit, 6)
})

// Fix 4 (X23).
test('preview links can render a phone, tablet or custom width; thumbnails keep their layout', () => {
  const route = read('../routes/cms/preview-render/[siteId]/[pageId].vue')
  assert.match(route, /const PREVIEW_VIEWPORT_WIDTHS = \{ mobile: 420, medium: 992, large: 1280 \}/)
  assert.match(route, /return !isThumbnailMode\.value && PREVIEW_VIEWPORT_WIDTHS\[viewport\] \? viewport : ''/)
  assert.match(route, /:viewport-mode="previewViewport \|\| 'auto'"/)
  assert.match(route, /:style="isThumbnailMode \? null : previewPageStyle"/)
  assert.match(route, /width: 1600px;/, 'the default and thumbnail width is unchanged')
})

// X28: theme `apply` rules are not applied (the public renderer ignores them).
test('the Hub no longer applies theme apply rules, and the theme editor still names them', () => {
  const htmlContent = read('../components/cms/htmlContent.vue')
  assert.doesNotMatch(htmlContent, /apply\.(root|link|heading|button|badge)/)
  // Blocks render in the iframe canvas; the inline fallback keeps the scope
  // class the theme CSS relies on.
  assert.match(htmlContent, /<div v-else ref="hostEl" class="block-content"/, 'the inline fallback keeps the scope class')

  const themeEditor = read('../components/cms/themeEditor.vue')
  const helper = themeEditor.slice(themeEditor.indexOf('const themeApplyRuleNames ='), themeEditor.indexOf('\n}\n', themeEditor.indexOf('const themeApplyRuleNames =')) + 2)
  const names = runInNewContext(`const parseJsonSafe = (v, f) => { try { return JSON.parse(v) } catch { return f } }\n${helper}\nthemeApplyRuleNames`)
  assert.deepEqual([...names('{"apply":{"root":"font-sans","heading":""},"variants":{"dark":{"apply":{"link":"text-link"}}}}')], ['root', 'dark.link'])
  assert.deepEqual([...names('{"apply":{}}')], [])
  assert.deepEqual([...names('{not json')], [])
})

test('canvas keeps paired collection-result loops in their native result scope', async () => {
  const renderHub = createHubRenderer()
  const template = '<select>{{{#collectionOptions {"source":"offices","label":"name","value":"docId"} }}}</select>{{{#collectionResults {"source":"agents"} }}}{{#for agent in items}}<p>{{ agent.name }}</p>{{/for}}{{{#if {"cond":"item.total == 0"} }}}Empty{{{/if}}}{{{/collectionResults}}}'
  const sources = {
    offices: { value: [{ name: 'Main Office', docId: 'main' }] },
    agents: { value: [{ name: 'Sample Agent' }], interactive: { fields: ['name'], filters: {} } },
  }
  const html = await renderHub(template, {}, sources, {}, {})
  assert.match(html, /<option value="main">Main Office<\/option>/)
  assert.match(html, /<p>Sample Agent<\/p>/)
  assert.doesNotMatch(html, /Empty|aria-busy="true"|#collectionResults/)
})

test('local canvas projects raw records returned by the older deployed collectionData function', async () => {
  const renderHub = createHubRenderer()
  const template = '{{#for state in source("stateOptions")}}<label>{{ state }}</label>{{/for}}'
  const sources = { stateOptions: { path: 'agents', distinct: 'officeStates', value: [
    { name: 'First Agent', officeStates: ['Montana', 'Idaho'] },
    { name: 'Second Agent', officeStates: ['Montana'] },
  ] } }
  assert.equal(await renderHub(template, {}, sources, {}, {}), '<label>Idaho</label><label>Montana</label>')
})

test('local canvas retains every already-projected choice from newer deployed loaders', async () => {
  const renderHub = createHubRenderer()
  const template = '{{#for choice in source("specialtyOptions")}}<label>{{ choice }}</label>{{/for}}'
  const source = { distinct: 'specialties', limit: 1, value: ['Land', 'Ranch', 'Waterfront'] }
  assert.equal(await renderHub(template, {}, { specialtyOptions: source }, {}, {}), '<label>Land</label><label>Ranch</label><label>Waterfront</label>')
  source.value = [{ specialties: ['Land', 'Ranch', 'Waterfront'] }]
  assert.equal(await renderHub(template, {}, { specialtyOptions: source }, {}, {}), '<label>Land</label><label>Ranch</label><label>Waterfront</label>')
})
