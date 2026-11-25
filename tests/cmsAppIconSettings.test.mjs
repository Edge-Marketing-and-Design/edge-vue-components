import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'acorn'
import { normalizeAnalyticsEvents, normalizeSiteDomainSettings, siteSettingsDefaults } from '../lib/cmsOperations.js'

const source = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module' })
const names = ['normalizeForCompare', 'stableSerialize', 'areEqualNormalized', 'isSiteDiff', 'saveSiteSettingsDocument', 'publishSiteSettings', 'discardSiteSettings']
const declarations = names.map(name => {
  const node = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name))
  assert.ok(node, name)
  return script.slice(node.start, node.end)
}).join('\n')
const fixture = () => {
  const published = { docId: 'site', logo: 'https://example.com/logo.png', favicon: 'https://example.com/favicon.png' }
  const draft = { ...published }
  const writes = []
  const context = {
    console: { log() {} }, computed: fn => ({ get value() { return fn() } }),
    props: { site: 'site' }, siteData: { value: draft },
    createSiteSettingsDefaults: siteSettingsDefaults,
    normalizeAnalyticsEvents, normalizeSiteDomainSettings,
    contactSpamDiffValue: doc => doc.contactSpam || null,
    getNextVersion: () => 'v2',
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    edgeFirebase: {
      data: { 'organizations/org/published-site-settings': { site: published } },
      storeDoc: async (path, data) => { writes.push({ path, data }); return { success: true } },
      changeDoc: async (path, id, data) => { writes.push({ path, id, data }); return { success: true } },
    },
  }
  const actions = runInNewContext(`${declarations};({isSiteDiff, save:saveSiteSettingsDocument, publish:publishSiteSettings, discard:discardSiteSettings})`, context)
  return { draft, published, writes, ...actions }
}

test('missing and empty app icons on older sites are equal; changes require publishing', () => {
  const f = fixture()
  f.draft.appIcon = ''
  assert.equal(f.isSiteDiff.value, false)
  f.draft.appIcon = 'https://example.com/app.png'
  assert.equal(f.isSiteDiff.value, true)
  f.published.appIcon = f.draft.appIcon
  assert.equal(f.isSiteDiff.value, false)
  f.draft.appIcon = ''
  assert.equal(f.isSiteDiff.value, true)
})
test('saving app artwork writes the draft only; publication carries it with unchanged branding', async () => {
  const f = fixture()
  f.draft.appIcon = 'https://example.com/app.png'
  await f.save(f.draft)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].path, 'organizations/org/sites')
  assert.equal(f.writes[0].data.appIcon, f.draft.appIcon)
  await f.publish()
  const saved = f.writes.at(-1)
  assert.equal(saved.path, 'organizations/org/published-site-settings')
  for (const field of ['appIcon', 'logo', 'favicon']) assert.equal(saved.data[field], f.draft[field])
})
test('discard restores published app artwork or clears it for a legacy published site', async () => {
  const f = fixture()
  f.draft.appIcon = 'https://example.com/new.png'
  f.published.appIcon = 'https://example.com/original.png'
  await f.discard()
  assert.equal(f.writes.at(-1).data.appIcon, f.published.appIcon)
  delete f.published.appIcon
  await f.discard()
  assert.equal(f.writes.at(-1).data.appIcon, '')
})

for (const field of ['splashImage', 'splashBackgroundColor']) {
  test(`${field} participates in draft-only save, publish, compare and discard`, async () => {
    const f = fixture()
    f.draft[field] = ''
    assert.equal(f.isSiteDiff.value, false, 'legacy absence equals empty')
    f.draft[field] = field === 'splashImage' ? 'https://example.com/splash.png' : 'primary'
    assert.equal(f.isSiteDiff.value, true)
    await f.save(f.draft)
    assert.equal(f.writes.at(-1).path, 'organizations/org/sites')
    assert.equal(f.writes.at(-1).data[field], f.draft[field])
    await f.publish()
    assert.equal(f.writes.at(-1).path, 'organizations/org/published-site-settings')
    assert.equal(f.writes.at(-1).data[field], f.draft[field])
    f.published[field] = f.draft[field]
    assert.equal(f.isSiteDiff.value, false)
    f.draft[field] = ''
    assert.equal(f.isSiteDiff.value, true)
    await f.discard()
    assert.equal(f.writes.at(-1).data[field], f.published[field])
    delete f.published[field]
    await f.discard()
    assert.equal(f.writes.at(-1).data[field], '')
  })
}
