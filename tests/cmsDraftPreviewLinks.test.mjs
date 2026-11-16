import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { buildCmsPublishedPageUrl, buildCmsSitePreviewUrl, findCmsPageRoute } from '../lib/cmsPublishedSitePreview.js'

const base = 'https://cmp-cms-front.pages.dev/'
const read = name => readFileSync(new URL(`../components/cms/${name}.vue`, import.meta.url), 'utf8')
const menus = { 'Site Root': [
  { name: 'home', item: 'home-id' },
  { name: 'contact-us', item: 'contact-id' },
  { name: 'Outside', item: { type: 'external', url: 'https://outside.example' } },
  { name: 'about', item: { about: [{ name: 'our-story', item: 'story-id' }, { item: { team: [{ name: 'leadership', item: 'team-id' }] } }] } },
], 'Not In Menu': [{ name: 'hidden-page', item: 'hidden-id' }] }

test('site and page URL examples include the organization and explicit draft mode', () => {
  assert.equal(buildCmsSitePreviewUrl(base, 'site', 'org'), `${base}?siteId=org-site`)
  assert.equal(buildCmsSitePreviewUrl(base, 'site', 'org', { draft: true }), `${base}?siteId=org-site&preview=true`)
  assert.equal(buildCmsSitePreviewUrl(base, 'site', 'org', { route: 'contact-us' }), `${base}?siteId=org-site&route=contact-us`)
  assert.equal(buildCmsSitePreviewUrl(base, 'site', 'org', { draft: true, route: 'about/our-story' }), `${base}?siteId=org-site&preview=true&route=about%2Four-story`)
  assert.equal(new URL(buildCmsSitePreviewUrl(base, 'site', 'org', { route: '/' })).searchParams.get('route'), '/')
})

test('old route and preview parameters never leak into a new link', () => {
  const url = buildCmsSitePreviewUrl(`${base}?preview=true&route=wrong&siteId=old&keep=1#old`, 'site', 'org')
  assert.equal(url, `${base}?siteId=org-site&keep=1`)
})

test('invalid configuration, template sites and unsafe routes fail closed', () => {
  for (const host of ['', 'bad', 'javascript:alert(1)', 'https://user:password@example.com'])
    assert.equal(buildCmsSitePreviewUrl(host, 'site', 'org', { draft: true }), '')
  for (const id of ['', 'new', 'templates'])
    assert.equal(buildCmsSitePreviewUrl(base, id, 'org', { draft: true }), '')
  assert.equal(buildCmsSitePreviewUrl(base, 'site', ''), '')
  for (const route of ['', '//external', '../secret', 'a/../b', 'a?x=1', 'a#fragment', 'https://evil.example', 'a\\b', 'a%2Fb', 'a b', 'a\n'])
    assert.equal(buildCmsSitePreviewUrl(base, 'site', 'org', { route }), '', route)
})

test('saved menu routing handles home, hidden pages, nested folders and missing routes', () => {
  assert.equal(findCmsPageRoute(menus, 'home-id'), '/')
  assert.equal(findCmsPageRoute(menus, 'contact-id'), 'contact-us')
  assert.equal(findCmsPageRoute(menus, 'story-id'), 'about/our-story')
  assert.equal(findCmsPageRoute(menus, 'team-id'), 'about/team/leadership')
  assert.equal(findCmsPageRoute(menus, 'hidden-id'), 'hidden-page')
  assert.equal(findCmsPageRoute(menus, 'missing'), null)
  assert.equal(findCmsPageRoute(null, 'contact-id'), null)
  assert.equal(findCmsPageRoute(menus, ''), null)
})

test('page editor uses published routes on a ready domain, while draft routes stay on the renderer', () => {
  const source = read('page')
  const computed = fn => ({ get value() { return fn() } })
  const context = {
    computed, buildCmsPublishedPageUrl, buildCmsSitePreviewUrl, findCmsPageRoute,
    publishedSiteOrigin: { value: '' },
    props: { site: 'site', page: 'contact-id', isTemplateSite: false },
    publishedPage: { value: { docId: 'contact-id' } },
    currentPage: { value: { docId: 'contact-id' } },
    publishedSiteSettingsDoc: { value: { menus } },
    siteDoc: { value: { menus: { 'Site Root': [{ name: 'get-in-touch', item: 'contact-id' }] } } },
    runtimeConfig: { public: { cmsFrontendUrl: base } },
    edgeGlobal: { edgeState: { currentOrganization: 'org' } },
  }
  const from = source.indexOf('const currentPageLiveUrl =')
  const to = source.indexOf('const currentMenuPageEntry =', from)
  const links = runInNewContext(`${source.slice(from, to)}\n;({live:currentPageLiveUrl, draft:currentPageDraftUrl})`, context)
  assert.equal(new URL(links.live.value).searchParams.get('route'), 'contact-us')
  assert.equal(new URL(links.draft.value).searchParams.get('route'), 'get-in-touch')
  assert.equal(new URL(links.draft.value).searchParams.get('preview'), 'true')
  context.publishedSiteOrigin.value = 'https://www.published.example'
  assert.equal(links.live.value, 'https://www.published.example/contact-us/')
  assert.equal(new URL(links.draft.value).hostname, 'cmp-cms-front.pages.dev')
  context.runtimeConfig.public.cmsFrontendUrl = ''
  assert.equal(links.live.value, 'https://www.published.example/contact-us/', 'a ready domain does not need renderer configuration')
  context.runtimeConfig.public.cmsFrontendUrl = base
  context.publishedPage.value = null
  assert.equal(links.live.value, '', 'never-published pages cannot open a live link')
  assert.notEqual(links.draft.value, '', 'never-published pages can preview saved drafts')
  context.siteDoc.value = { menus: {} }
  assert.equal(links.draft.value, '', 'orphaned pages have no invented route')
  context.props.isTemplateSite = true
  assert.equal(links.live.value, '')
  assert.equal(links.draft.value, '')
})

test('menu live and draft actions use separate saved routes and follow organization changes', () => {
  const source = read('menu')
  const context = {
    buildCmsPublishedPageUrl, buildCmsSitePreviewUrl, findCmsPageRoute,
    publishedSiteOrigin: { value: '' },
    props: { site: 'site', isTemplateSite: false },
    runtimeConfig: { public: { cmsFrontendUrl: base } },
    edgeGlobal: { edgeState: { currentOrganization: 'org', organizationDocPath: 'organizations/org' } },
    edgeFirebase: { data: { 'organizations/org/published-site-settings': { site: { menus } } } },
    siteDoc: { value: { menus: { 'Site Root': [{ name: 'renamed', item: 'contact-id' }] } } },
    isPublished: id => id === 'contact-id',
  }
  const from = source.indexOf('const buildLivePageUrl =')
  const to = source.indexOf('const pageRouteBase =', from)
  const links = runInNewContext(`${source.slice(from, to)}\n({live:buildLivePageUrl, draft:buildDraftPageUrl})`, context)
  const entry = { item: 'contact-id', name: 'unsaved-name' }
  assert.equal(new URL(links.live('Site Root', entry)).searchParams.get('route'), 'contact-us')
  assert.equal(new URL(links.draft('Site Root', entry)).searchParams.get('route'), 'renamed')
  assert.equal(links.live('Site Root', { item: 'new-page' }), '')
  context.publishedSiteOrigin.value = 'https://www.published.example'
  assert.equal(links.live('Site Root', entry), 'https://www.published.example/contact-us/')
  assert.equal(new URL(links.draft('Site Root', entry)).hostname, 'cmp-cms-front.pages.dev')
  context.edgeGlobal.edgeState.currentOrganization = 'other'
  assert.equal(new URL(links.draft('Site Root', entry)).searchParams.get('siteId'), 'other-site')
})

test('all three CMS components compile and retain comparison actions', () => {
  for (const name of ['site', 'page', 'menu']) {
    const source = read(name)
    const filename = `${name}.vue`
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: `draft-preview-${name}` })
    const template = compileTemplate({ source: descriptor.template.content, filename, id: `draft-preview-${name}`, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
    assert.match(source, /Preview Changes/)
    assert.match(source, /View Published Page/)
    assert.doesNotMatch(source, /View Live Page/)
    assert.match(source, /target="_blank" rel="noopener noreferrer"/)
  }
  const page = read('page')
  assert.match(page, /@click="openPageStatusCompareDialog"/)
  assert.match(page, /Save to include your latest edits in the external preview/)
  const site = read('site')
  const unpublishedHeader = site.slice(site.indexOf('<div v-if="isSiteDiff || isAnyPagesDiff" key="unpublished"'), site.indexOf('<div v-else key="published"'))
  assert.match(unpublishedHeader, /:href="draftSitePreviewUrl"/)
  assert.match(unpublishedHeader, /class="flex flex-col items-center gap-1" data-cms-unpublished-preview/)
  const badgeColumn = unpublishedHeader.slice(unpublishedHeader.indexOf('data-cms-unpublished-preview'), unpublishedHeader.indexOf('</a>') + 4)
  assert.match(badgeColumn, /Unpublished Pages/)
  assert.match(badgeColumn, /:href="draftSitePreviewUrl"/)
  assert.ok(unpublishedHeader.indexOf('Unpublished Pages') < unpublishedHeader.indexOf(':href="draftSitePreviewUrl"'))
  assert.ok(unpublishedHeader.indexOf(':href="draftSitePreviewUrl"') < unpublishedHeader.indexOf('@click="publishSiteAndSettings"'))
  // The title column ends where the header's action column starts.
  const titleStart = site.indexOf(':title="siteData.name')
  const titleEnd = site.indexOf('<div class="relative flex items-center gap-3 justify-end">', titleStart)
  assert.ok(titleStart >= 0 && titleEnd > titleStart, 'the site header title and action columns are found')
  const titleHeader = site.slice(titleStart, titleEnd)
  assert.doesNotMatch(titleHeader, /:href="draftSitePreviewUrl"/)
  assert.match(site, /@click="state.showSiteSettingsDiffDialog = true"/)
  assert.match(site, /:href="getSitePageStatusPreviewUrl\(item\)"/)
})
