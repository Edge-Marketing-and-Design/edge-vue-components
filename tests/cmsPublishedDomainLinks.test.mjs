import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { getCmsDomainConnectionStatus } from '../lib/cmsDomainConnectionStatus.js'
import { buildCmsPublishedPageUrl, getCmsPublishedSiteOrigin } from '../lib/cmsPublishedSitePreview.js'

const context = { orgId: 'org', siteId: 'site' }
const ready = { ...context, connectionStatus: 'active', dnsSyncSucceeded: true, wwwAdded: true, apexAdded: true }
const settings = { domains: ['first.example', 'second.example'], canonicalDomain: 'second.example', forwardApex: true }
const registry = { 'first.example': { ...ready }, 'second.example': { ...ready } }
const base = 'https://renderer.example/'

test('published domains respect canonical choice and www/apex forwarding', () => {
  assert.equal(getCmsPublishedSiteOrigin(settings, registry, context), 'https://www.second.example')
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, forwardApex: false }, registry, context), 'https://second.example')
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, canonicalDomain: 'www.second.example', forwardApex: false }, registry, context), 'https://www.second.example')
  assert.equal(getCmsPublishedSiteOrigin({ domains: ['www.second.example'], forwardApex: true }, { 'www.second.example': ready }, context), 'https://www.second.example')
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, canonicalDomain: '' }, registry, context), 'https://www.first.example')
})

test('missing, unknown, failed and foreign domain setup keeps the renderer fallback', () => {
  for (const record of [
    undefined, {}, ...['pending', 'failed', 'unknown', undefined].map(connectionStatus => ({ ...ready, connectionStatus })), { ...ready, dnsSyncSucceeded: undefined }, { ...ready, dnsSyncSucceeded: false },
    { ...ready, wwwAdded: false }, { ...ready, dnsSyncError: 'DNS failed' },
    { ...ready, wwwError: 'Connection failed' }, { ...ready, dnsRecords: { www: { error: 'DNS failed' } } },
    { ...ready, orgId: 'other' }, { ...ready, siteId: 'other' },
  ]) {
    const origin = getCmsPublishedSiteOrigin(settings, { ...registry, 'second.example': record }, context)
    assert.equal(origin, '', 'a failed canonical domain cannot silently select a redirecting alternative')
    assert.equal(buildCmsPublishedPageUrl(base, 'site', 'org', { origin, route: 'contact-us' }), `${base}?siteId=org-site&route=contact-us`)
  }
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, forwardApex: false }, { ...registry, 'second.example': { ...ready, apexAdded: false } }, context), '')
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, canonicalDomain: '' }, { ...registry, 'first.example': {} }, context), 'https://www.second.example')
  assert.equal(getCmsPublishedSiteOrigin({ domains: [] }, registry, context), '')
  assert.equal(getCmsPublishedSiteOrigin({ ...settings, canonicalDomain: 'not-listed.example' }, registry, context), '')
})

test('domain and direct route builders reject unsafe destinations', () => {
  for (const domain of ['https://evil.example', 'good.example/path', 'user@good.example', 'good.example:443', 'good.example?x=1'])
    assert.equal(getCmsPublishedSiteOrigin({ domains: [domain] }, { [domain]: ready }, context), '')
  for (const route of [null, undefined, '', '//evil.example', '../private', 'one/../two', 'one?x=1', 'one#x', 'https://evil.example', 'one%2Ftwo'])
    assert.equal(buildCmsPublishedPageUrl(base, 'site', 'org', { origin: 'https://www.second.example', route }), '')
  for (const origin of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?query=1'])
    assert.equal(buildCmsPublishedPageUrl(base, 'site', 'org', { origin, route: '/' }), `${base}?siteId=org-site&route=%2F`)
  assert.equal(buildCmsPublishedPageUrl('', 'site', 'org', { origin: 'https://www.second.example', route: '/' }), 'https://www.second.example/')
  assert.equal(buildCmsPublishedPageUrl(base, 'site', 'org', { origin: 'https://www.second.example', route: 'about/our-story' }), 'https://www.second.example/about/our-story/')
  assert.equal(buildCmsPublishedPageUrl(base, 'templates', 'org', { origin: 'https://www.second.example', route: '/' }), '')
})

test('header lookup includes published domains, shares its origin, and discards out-of-order responses', async () => {
  const source = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
  const computed = fn => ({ get value() { return fn() } })
  const pending = []
  const calls = []
  const provided = {}
  const vm = {
    computed, ref: value => ({ value }), getCmsPublishedSiteOrigin, getCmsDomainConnectionStatus,
    provide: (key, value) => { provided[key] = value },
    watch: () => {},
    props: { site: 'site' },
    isSiteSettingPublished: { value: true },
    domainError: { value: '' },
    siteData: { value: { domains: ['draft.example'] } },
    publishedSiteSettings: { value: settings },
    edgeGlobal: { edgeState: { currentOrganization: 'org' } },
    edgeFirebase: { runFunction: (name, payload) => {
      calls.push({ name, payload })
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    } },
  }
  const from = source.indexOf("const domainRegistryHeaderError = ref('')")
  const to = source.indexOf('const submissionsCollection =', from)
  const state = runInNewContext(`${source.slice(from, to)}\n;({fetch:fetchHeaderDomainRegistryError, origin:publishedSiteOrigin, status:headerDomainState, error:activeDomainError})`, vm)
  const first = state.fetch()
  assert.deepEqual(Array.from(calls[0].payload.domains), ['draft.example', 'first.example', 'second.example'])
  assert.equal(calls[0].name, 'cms-getCloudflarePagesProject')
  pending[0].resolve({ data: { domainRegistry: registry } })
  await first
  assert.equal(state.origin.value, 'https://www.second.example')
  assert.equal(provided.cmsPublishedSiteOrigin, state.origin)
  assert.equal(state.status.value, 'active', 'verified connections are active')
  vm.domainError.value = 'historical DNS error'
  assert.equal(state.error.value, '', 'historical site errors do not override current status')
  vm.isSiteSettingPublished.value = false
  assert.equal(state.origin.value, '')
  vm.isSiteSettingPublished.value = true
  const older = state.fetch()
  vm.edgeGlobal.edgeState.currentOrganization = 'other'
  assert.equal(state.origin.value, '', 'old organization origin disappears immediately')
  const newer = state.fetch()
  pending[2].resolve({ data: { domainRegistry: { 'second.example': { ...ready, orgId: 'other' } } } })
  await newer
  pending[1].resolve({ data: { domainRegistry: registry } })
  await older
  assert.equal(state.origin.value, 'https://www.second.example', 'late response cannot replace current ownership')
  const failed = state.fetch()
  pending[3].reject(new Error('unavailable'))
  await failed
  assert.equal(state.origin.value, '')
  assert.equal(state.status.value, 'unknown', 'a failed lookup is not pending verification')
  const legacy = state.fetch()
  pending[4].resolve({ data: { domainRegistry: { 'first.example': { wwwAdded: true, apexAdded: true }, 'second.example': { wwwAdded: true, apexAdded: true } } } })
  await legacy
  assert.equal(state.status.value, 'unknown', 'older API responses do not imply pending verification')
  assert.match(source, /v-if="!isTemplateSite && publishedSiteOrigin"/)
  assert.match(source, /:href="publishedSiteOrigin"/)
  assert.match(source, /View Published Site/)
  assert.match(source, /v-else-if="!isTemplateSite"[^>]*publishedSitePreviewUnavailableReason/)
})
