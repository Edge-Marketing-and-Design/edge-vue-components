import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { normalizeAnalyticsEvents, normalizeSiteDomainSettings, siteSettingsDefaults } from '../lib/cmsOperations.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const site = read('../components/cms/site.vue')
const off = { enabled: false, forms: false, contactClicks: false, accountSignUps: false, shares: false }
const slice = (start, end) => {
  const from = site.indexOf(start)
  const to = site.indexOf(end, from + 1)
  assert.ok(from >= 0 && to > from, `${start} is in site.vue`)
  return site.slice(from, to)
}

const baseContext = (published, draft) => ({
  console: { log: () => {} },
  computed: fn => ({ get value() { return fn() } }),
  edgeFirebase: { data: { 'organizations/org/published-site-settings': { site: published } } },
  edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
  props: { site: 'site' },
  siteData: { value: draft },
  publishedSiteSettings: { value: published },
  createSiteSettingsDefaults: siteSettingsDefaults,
  normalizeAnalyticsEvents,
  normalizeSiteDomainSettings,
  contactSpamDiffValue: value => value.contactSpam || {},
  areEqualNormalized: (a, b) => JSON.stringify(a) === JSON.stringify(b),
})

test('new sites and the creation form start with every analytics event switch off', () => {
  assert.deepEqual(siteSettingsDefaults().analyticsEvents, off)
  assert.match(read('../composables/siteSettingsTemplate.js'), /analyticsEvents: \{ value: defaults.analyticsEvents \}/)
  assert.match(site, /analyticsEvents: z\.object\(\{\s+enabled: z\.boolean\(\)\.optional\(\),\s+forms: z\.boolean\(\)\.optional\(\),\s+contactClicks: z\.boolean\(\)\.optional\(\),\s+accountSignUps: z\.boolean\(\)\.optional\(\),\s+shares: z\.boolean\(\)\.optional\(\),\s+\}\)\.optional\(\)/)
})

test('a switch change is an unpublished change; a missing object equals all off', () => {
  const published = { trackingGoogleAnalytics: 'G-TEST' }
  const draft = { trackingGoogleAnalytics: 'G-TEST' }
  const context = baseContext(published, draft)
  const isSiteDiff = runInNewContext(`${slice('const isSiteDiff = computed(', 'const SITE_SETTINGS_DIFF_FIELDS =')}\n;isSiteDiff`, context)
  const details = runInNewContext(`${slice('const SITE_SETTINGS_DIFF_FIELDS =', 'const publishSiteSettings = async')}\n;siteSettingsDiffDetails`, context)

  assert.equal(isSiteDiff.value, false, 'neither side has the object')
  draft.analyticsEvents = { ...off }
  assert.equal(isSiteDiff.value, false, 'saved all-off equals a published site without the object')
  assert.equal(details.value.length, 0)

  draft.analyticsEvents = { enabled: true, forms: true }
  assert.equal(isSiteDiff.value, true)
  assert.deepEqual(JSON.parse(JSON.stringify(details.value.map(({ key, published, current }) => ({ key, published, current })))), [
    { key: 'analyticsEvents', published: 'Off', current: 'On (Form submissions)' },
  ])

  published.analyticsEvents = { enabled: true, forms: true, contactClicks: false, accountSignUps: false, shares: false }
  assert.equal(isSiteDiff.value, false, 'a partial draft equals its normalized published copy')
})

test('publish writes the normalized switches and discard restores them', async () => {
  const writes = []
  const published = { trackingGoogleAnalytics: 'G-TEST', analyticsEvents: { enabled: true, forms: false, contactClicks: true, accountSignUps: false, shares: false } }
  const context = {
    ...baseContext(published, { docId: 'site', trackingGoogleAnalytics: 'G-TEST', analyticsEvents: { enabled: false, forms: true }, version: 1 }),
    getNextVersion: value => value + 1,
  }
  context.edgeFirebase.storeDoc = async (path, data) => writes.push({ path, data })
  context.edgeFirebase.changeDoc = async (path, id, data) => writes.push({ path, id, data })
  const actions = runInNewContext(`${slice('const publishSiteSettings = async', 'const unPublishSite = async')}\n;({publish:publishSiteSettings, discard:discardSiteSettings})`, context)

  await actions.publish({ bumpVersion: false })
  assert.equal(writes[0].path, 'organizations/org/published-site-settings')
  assert.deepEqual({ ...writes[0].data.analyticsEvents }, { ...off, forms: true }, 'master off keeps the category values')

  writes.length = 0
  await actions.discard()
  assert.deepEqual(writes[0].data.analyticsEvents, published.analyticsEvents)

  delete published.analyticsEvents
  await actions.discard()
  assert.deepEqual(writes[1].data.analyticsEvents, off, 'a published site without the object restores all off')

  context.siteData.value = { docId: 'site', version: 1 }
  writes.length = 0
  await actions.publish({ bumpVersion: false })
  assert.deepEqual(writes[0].data.analyticsEvents, off, 'publishing a site without the object writes all off')
})

test('the Tracking tab category switches need the master switch and a GA ID', () => {
  const form = read('../components/cms/siteSettingsForm.vue')
  assert.match(form, /analyticsEventCategoriesDisabled = computed\(\(\) => !analyticsEventsEnabled.value \|\| !hasGoogleAnalyticsId.value\)/)
  for (const [model, label] of [['analyticsEventForms', 'Form submissions'], ['analyticsEventContactClicks', 'Phone and email clicks'], ['analyticsEventAccountSignUps', 'Account sign-ups'], ['analyticsEventShares', 'Share clicks']])
    assert.match(form, new RegExp(`v-model="${model}"[^>]*label="${label}"\\s+:disabled="analyticsEventCategoriesDisabled"`))
  assert.match(form, /label="Send events to Google Analytics"/)
})
