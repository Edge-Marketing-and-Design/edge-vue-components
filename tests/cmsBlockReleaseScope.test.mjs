import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as client from '../lib/cmsBlockReleaseClient.js'
import * as presentation from '../lib/cmsBlockReleasePresentation.js'

const source = readFileSync(new URL('../components/cms/blockReleaseDialog.vue', import.meta.url), 'utf8')
const sites = {
  templates: { docId: 'templates', name: 'Templates' },
  main: { docId: 'main', name: 'Main Website' },
}

test('only real sites are offered, independent of the site name', () => {
  assert.deepEqual(client.selectableReleaseSites(sites), [{ name: 'main', title: 'Main Website' }])
  assert.deepEqual(client.selectableReleaseSites({ templates: sites.templates }), [])
  assert.deepEqual(client.selectableReleaseSites(), [])
  assert.deepEqual(client.selectableReleaseSites({ real: { docId: 'real', name: 'Templates' } }), [{ name: 'real', title: 'Templates' }])
})

test('one real site remains a full release, while multiple sites support canaries', () => {
  const one = client.selectableReleaseSites(sites)
  const two = [...one, { name: 'second', title: 'Second Website' }]
  assert.equal(client.releaseScopeSiteIds({ sites: one, scopeMode: 'sites', siteIds: ['main'] }), null)
  assert.equal(client.releaseScopeSiteIds({ sites: one, scopeMode: 'all', siteIds: [] }), null)
  assert.deepEqual(client.releaseScopeSiteIds({ sites: two, scopeMode: 'sites', siteIds: ['templates', 'main', 'removed'] }), ['main'])
  assert.equal(client.releaseScopeSiteIds({ sites: two, scopeMode: 'all', siteIds: ['main'] }), null)
  assert.deepEqual(client.releaseScopeSiteIds({ sites: one, scopeMode: 'sites', siteIds: ['main'], canaryRollback: true }), ['main'])
})

const dialogState = () => {
  const calls = []
  const context = {
    ...client, ...presentation, computed,
    props: { blockId: 'block' },
    state: reactive({ revision: '2', scopeMode: 'all', siteIds: [], canaryRollbackScope: false, plan: null, planning: false, error: '', confirmBreaking: false, executing: false, history: null, usage: null }),
    edgeFirebase: { data: reactive({ 'organizations/org/sites': { ...sites }, 'organizations/org': { name: 'Organization One' } }), runFunction: async (name, payload) => { calls.push({ name, payload }); return { data: { checksum: 'checked' } } } },
    edgeGlobal: { edgeState: reactive({ currentOrganization: 'org', organizationDocPath: 'organizations/org' }), isAdminGlobal: () => computed(() => true) },
  }
  const start = source.indexOf('const orgId = computed(')
  const end = source.indexOf('const errorMessage =', start)
  const values = runInNewContext(`${source.slice(start, end)}\n;({siteItems, sitesLoaded, organizationName, selectedSiteIds, canCheck, canExecute, fullReleaseLabel, scopeLabel, hasMultipleSites})`, context)
  const actionStart = source.indexOf('const runDryRun = async')
  const actionEnd = source.indexOf('let pollTimer =', actionStart)
  context.resetPlan = () => { context.state.plan = null }
  context.canCheck = values.canCheck
  context.orgId = computed(() => context.edgeGlobal.edgeState.currentOrganization)
  context.selectedSiteIds = values.selectedSiteIds
  context.errorMessage = error => error.message
  const run = runInNewContext(`${source.slice(actionStart, actionEnd)}\n;runDryRun`, context)
  return { context, values, run, calls }
}

test('single-site Check release sends no siteIds and shows the site name', async () => {
  const { context, values, run, calls } = dialogState()
  assert.equal(values.organizationName.value, 'Organization One')
  assert.equal(values.hasMultipleSites.value, false)
  assert.equal(values.scopeLabel('all'), 'Main Website')
  assert.equal(values.fullReleaseLabel.value, 'Release to Main Website…')
  context.state.scopeMode = 'sites'
  context.state.siteIds = ['main']
  await run()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].payload.orgId, 'org')
  assert.equal(Object.hasOwn(calls[0].payload, 'siteIds'), false, 'full promotion semantics are preserved')
  context.state.canaryRollbackScope = true
  await run()
  assert.deepEqual(Array.from(calls[1].payload.siteIds), ['main'], 'existing rollback remains site scoped')
})

test('loading, template-only organizations and empty canaries cannot check or execute', async () => {
  const { context, values, run, calls } = dialogState()
  delete context.edgeFirebase.data['organizations/org/sites']
  assert.equal(values.sitesLoaded.value, false)
  assert.equal(values.canCheck.value, false)
  await run()
  context.edgeFirebase.data['organizations/org/sites'] = { templates: sites.templates }
  assert.equal(values.sitesLoaded.value, true)
  assert.equal(values.canCheck.value, false)
  context.state.plan = { checks: {}, checksum: 'stale' }
  assert.equal(values.canExecute.value, false)
  await run()
  assert.equal(calls.length, 0)
  context.edgeFirebase.data['organizations/org/sites'] = { ...sites, second: { docId: 'second', name: 'Second' } }
  context.state.scopeMode = 'sites'
  context.state.siteIds = ['templates']
  assert.equal(values.canCheck.value, false)
  await run()
  assert.equal(calls.length, 0, 'empty scope must not become a full release')
  context.state.siteIds = ['second']
  await run()
  assert.deepEqual(Array.from(calls[0].payload.siteIds), ['second'])
  context.edgeGlobal.edgeState.currentOrganization = 'other'
  context.edgeGlobal.edgeState.organizationDocPath = 'organizations/other'
  assert.equal(values.canCheck.value, false)
  assert.equal(values.siteItems.value.length, 0)
})

test('release controls compile and conditional selectors retain template reporting', () => {
  const { descriptor, errors } = parse(source, { filename: 'blockReleaseDialog.vue' })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'release-scope' })
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'blockReleaseDialog.vue', id: 'release-scope', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(compiled.errors, [])
  assert.match(source, /v-if="hasMultipleSites && !state.canaryRollbackScope"[^>]*label="Where"/)
  assert.match(source, /No sites in this organization/)
  assert.match(source, /Organization: \{\{ organizationName \}\}/)
  assert.match(source, /:sites="reportSiteItems"/)
  assert.match(source, /Templates \(library\)/)
  assert.match(source, /canaryRollbackScope: false/)
  assert.match(source, /contentChecksSkipped === 'override'\) return 'Override block: content checks skipped'/)
  assert.match(source, /The Vue component is not validated here\./)
})
