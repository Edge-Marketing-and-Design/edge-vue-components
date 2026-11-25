import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { normalizeAnalyticsEvents, normalizeSiteDomainSettings, siteSettingsDefaults } from '../lib/cmsOperations.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const site = read('../components/cms/site.vue')

test('new site defaults and creation form keep advertiser and pixel IDs separate', () => {
  const defaults = siteSettingsDefaults()
  assert.equal(defaults.trackingAdroll, '')
  assert.equal(defaults.trackingAdrollPixelId, '')
  const template = read('../composables/siteSettingsTemplate.js')
  assert.match(template, /trackingAdroll:.*'label': 'AdRoll Advertiser ID'.*value: defaults.trackingAdroll/)
  assert.match(template, /trackingAdrollPixelId:.*'label': 'AdRoll Pixel ID'.*value: defaults.trackingAdrollPixelId/)
  assert.match(site, /trackingAdrollPixelId: z.string\(\).optional\(\)/)
})

test('pixel-only changes participate in saved draft comparison, with legacy absence equal to blank', () => {
  const published = { trackingAdroll: 'existing-advertiser' }
  const draft = { ...published, trackingAdrollPixelId: '' }
  const context = {
    computed: fn => ({ get value() { return fn() } }),
    edgeFirebase: { data: { 'organizations/org/published-site-settings': { site: published } } },
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    props: { site: 'site' }, siteData: { value: draft },
    createSiteSettingsDefaults: siteSettingsDefaults,
    normalizeAnalyticsEvents, normalizeSiteDomainSettings,
    contactSpamDiffValue: value => value.contactSpam || {},
    areEqualNormalized: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }
  const from = site.indexOf('const isSiteDiff = computed(')
  const to = site.indexOf('const SITE_SETTINGS_DIFF_FIELDS =', from)
  const diff = runInNewContext(`${site.slice(from, to)}\n;isSiteDiff`, context)
  assert.equal(diff.value, false)
  draft.trackingAdrollPixelId = 'new-pixel'
  assert.equal(diff.value, true)
  published.trackingAdrollPixelId = 'new-pixel'
  assert.equal(diff.value, false)
  draft.trackingAdrollPixelId = ''
  assert.equal(diff.value, true, 'clearing the published pixel is also a change')
  assert.match(site, /\{ key: 'trackingAdrollPixelId', label: 'AdRoll Pixel ID' \}/)
})

test('publish carries both IDs and discard restores the published pixel without changing the advertiser', async () => {
  const writes = []
  const published = { trackingAdroll: 'old-advertiser', trackingAdrollPixelId: 'old-pixel' }
  const context = {
    console: { log: () => {} },
    edgeFirebase: {
      data: { 'organizations/org/published-site-settings': { site: published } },
      storeDoc: async (path, data) => writes.push({ path, data }),
      changeDoc: async (path, id, data) => writes.push({ path, id, data }),
    },
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    props: { site: 'site' },
    siteData: { value: { docId: 'site', trackingAdroll: 'new-advertiser', trackingAdrollPixelId: 'new-pixel', version: 1 } },
    createSiteSettingsDefaults: siteSettingsDefaults,
    normalizeAnalyticsEvents, normalizeSiteDomainSettings,
    getNextVersion: value => value + 1,
  }
  const from = site.indexOf('const publishSiteSettings = async')
  const discard = site.indexOf('const discardSiteSettings = async', from)
  const discardEnd = site.indexOf('\nconst ', discard + 1)
  const actions = runInNewContext(`${site.slice(from, discardEnd)}\n;({publish:publishSiteSettings, discard:discardSiteSettings})`, context)
  await actions.publish({ bumpVersion: false })
  assert.equal(writes[0].path, 'organizations/org/published-site-settings')
  assert.equal(writes[0].data.trackingAdroll, 'new-advertiser')
  assert.equal(writes[0].data.trackingAdrollPixelId, 'new-pixel')
  writes.length = 0
  await actions.discard()
  assert.equal(writes[0].data.trackingAdroll, 'old-advertiser')
  assert.equal(writes[0].data.trackingAdrollPixelId, 'old-pixel')
  delete published.trackingAdrollPixelId
  await actions.discard()
  assert.equal(writes[1].data.trackingAdrollPixelId, '')
})

test('site settings components compile with separate labeled tracking controls', () => {
  const form = read('../components/cms/siteSettingsForm.vue')
  assert.match(form, /v-model="props.settings.trackingAdroll"\s+label="AdRoll Advertiser ID"/)
  assert.match(form, /v-model="props.settings.trackingAdrollPixelId"\s+label="AdRoll Pixel ID"\s+name="trackingAdrollPixelId"/)
  for (const [filename, source] of [['site.vue', site], ['siteSettingsForm.vue', form]]) {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})
