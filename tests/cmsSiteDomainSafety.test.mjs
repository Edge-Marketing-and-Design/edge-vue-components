import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'acorn'

const source = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module' })
const names = ['organizationId', 'unpublishSiteName', 'canConfirmUnpublish', 'openUnpublishDialog', 'unPublishSite']
const declarations = names.map(name => {
  const node = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name))
  assert.ok(node, name)
  return script.slice(node.start, node.end)
}).join('\n')

function fixture({ allowed = true, remove = async () => ({ success: true }) } = {}) {
  const calls = []
  const state = { unpublishDialogOpen: false, unpublishConfirmation: '', unpublishing: false }
  const context = {
    state, props: { site: 'site' }, canEditSiteSettings: { value: allowed },
    computed: fn => ({ get value() { return fn() } }),
    siteData: { value: { name: 'Clearwater Main' } },
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org', currentOrganization: 'org' } },
    edgeFirebase: {
      data: { 'organizations/org/sites/site/pages': { home: {}, contact: {} } },
      removeDoc: async (...args) => { calls.push(args); return remove(...args) },
      toast: { success() {} },
    },
  }
  const actions = runInNewContext(`${declarations}\n;({open: openUnpublishDialog, confirm: unPublishSite, canConfirm: canConfirmUnpublish})`, context)
  return { ...context, calls, ...actions }
}

test('unpublish performs no writes until the exact current site name is confirmed', async () => {
  const f = fixture()
  await f.confirm()
  f.open()
  assert.equal(f.state.unpublishDialogOpen, true)
  for (const text of ['', 'clearwater main', 'Other Site']) {
    f.state.unpublishConfirmation = text
    assert.equal(f.canConfirm.value, false)
    await f.confirm()
  }
  assert.equal(f.calls.length, 0)
  f.state.unpublishConfirmation = 'Clearwater Main'
  await f.confirm()
  assert.deepEqual(f.calls, [
    ['organizations/org/sites/site/published', 'home'],
    ['organizations/org/sites/site/published', 'contact'],
    ['organizations/org/published-site-settings', 'site'],
  ])
  assert.equal(f.state.unpublishDialogOpen, false)
})

test('permissions, site changes and organization changes invalidate confirmation', async () => {
  for (const change of [f => { f.canEditSiteSettings.value = false }, f => { f.props.site = 'other' }, f => { f.edgeGlobal.edgeState.currentOrganization = 'other' }, f => { f.siteData.value.name = 'Renamed Site' }]) {
    const f = fixture()
    f.open()
    f.state.unpublishConfirmation = 'Clearwater Main'
    change(f)
    await f.confirm()
    assert.equal(f.calls.length, 0)
  }
})

test('failed page removal stops before removing settings and reports partial-operation risk', async () => {
  const f = fixture({ remove: async () => ({ success: false, message: 'Permission denied' }) })
  f.open()
  f.state.unpublishConfirmation = 'Clearwater Main'
  await f.confirm()
  assert.equal(f.calls.length, 1)
  assert.equal(f.state.unpublishDialogOpen, true)
  assert.equal(f.state.unpublishing, false)
  assert.match(f.state.unpublishError, /Permission denied.*Some pages may already be offline/)
})

test('a second confirmation while unpublishing cannot start another operation', async () => {
  let release
  const held = new Promise(resolve => { release = resolve })
  const f = fixture({ remove: async () => { await held; return { success: true } } })
  f.open()
  f.state.unpublishConfirmation = 'Clearwater Main'
  const first = f.confirm()
  await f.confirm()
  assert.equal(f.calls.length, 1)
  release()
  await first
  assert.equal(f.calls.length, 3)
})

test('destructive menu opens the confirmation; status and revalidation are visible', () => {
  assert.match(source, /@click="openUnpublishDialog"/)
  assert.doesNotMatch(source, /DropdownMenuItem[^>]*@click="unPublishSite"/)
  assert.match(source, /Type <strong>\{\{ unpublishSiteName \}\}<\/strong> to confirm/)
  assert.match(source, /:disabled="!canConfirmUnpublish"/)
  const status = readFileSync(new URL('../components/cms/domainStatus.vue', import.meta.url), 'utf8')
  assert.match(source, /edge-cms-domain-status/)
  assert.match(status, /Domains connecting \/ awaiting verification/)
  assert.match(status, /Last checked/)
  assert.match(source, /cms-retrySiteDomainSync/)
  const settings = readFileSync(new URL('../components/cms/siteSettingsForm.vue', import.meta.url), 'utf8')
  assert.match(settings, /Awaiting Cloudflare verification/)
  assert.match(settings, /domainRegistryPollCount >= 10/)
  assert.match(settings, /Check again/)
})
