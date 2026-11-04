import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { compareComponentFields, describeOverrideComponent, extractComponentReads } from '../src/override-component.js'

// A fixture emd-cms-front checkout: app/blocks with a top-level component, an
// organization folder, and a theme-prefixed component in it.
const ORG = 'nSyJmnm6i2xLMPQ1PCX2'
const repo = mkdtempSync(path.join(os.tmpdir(), 'edge-cms-override-'))
after(() => rmSync(repo, { recursive: true, force: true }))
const write = (relative, source) => {
  const file = path.join(repo, 'app/blocks', relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}
write('navbar.vue', '<script setup>\nconst props = defineProps({ block: Object })\n</script>\n<template><nav>{{ block.values.title }}</nav></template>\n')
write(`clearwater-${ORG}/propertyResults.vue`, `<script setup>
import { useThing } from './useThing'
const props = defineProps({ block: Object })
const values = computed(() => props.block?.values || {})
const mode = computed(() => values.value?.queryMode)
const offices = props.block?.dataSources?.offices
</script>
<template><div>{{ values.label }} {{ block.meta.property }}</div></template>
`)
write(`clearwater-${ORG}/useThing.js`, 'export const useThing = block => block?.values?.queryString\n')
write(`clearwater-${ORG}/agentThemePropertyResults.vue`, '<template><div>{{ block.values.title }}</div></template>\n')

const components = async () => {
  const { readdirSync } = await import('node:fs')
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  return walk(path.join(repo, 'app/blocks')).filter(file => file.endsWith('.vue')).map(file => path.relative(path.join(repo, 'app/blocks'), file))
}
const manifest = list => async () => ({ ok: true, json: async () => ({ commit: 'abc123', builtAt: '2026-11-04T00:00:00Z', components: list }) })
const git = changed => async (_cwd, args) => {
  if (args[0] === 'rev-parse')
    return 'def456'
  if (args[0] === 'status')
    return ''
  if (args[0] === 'cat-file')
    return ''
  if (args[0] === 'diff')
    return changed ? 'app/blocks/x.vue' : ''
  return ''
}
const describe = input => describeOverrideComponent({ rendererRepoPath: repo, orgId: ORG, listComponents: components, manifestUrl: 'https://front.example/_edge/block-overrides.json', fetchImpl: manifest([]), git: git(false), ...input })

test('a plain top-level component', async () => {
  const result = await describe({ blockName: 'Navbar', fetchImpl: manifest(['navbar.vue']) })
  assert.equal(result.status, 'vue-override')
  assert.equal(result.component.file, 'navbar.vue')
  assert.match(result.component.source, /<nav>/)
  assert.equal(result.deployedSite.status, 'vue-override')
  assert.equal(result.deployment.deployed, true)
  assert.equal(result.deployment.sameAsDeployed, true)
})

test('the organization folder component, with the field comparison', async () => {
  const block = { name: 'Property Results', isOverrideBlock: true, templateVersion: 2, schema: { queryMode: {}, label: {}, pageSize: {} }, dataSources: { listings: {} } }
  const result = await describe({ block, blockName: block.name, fetchImpl: manifest([`clearwater-${ORG}/propertyResults.vue`]) })
  assert.equal(result.component.file, `clearwater-${ORG}/propertyResults.vue`)
  assert.equal(result.component.scope, 'organization')
  assert.deepEqual(result.component.importsRead, [`clearwater-${ORG}/useThing.js`])
  assert.deepEqual(result.fields.componentReads, { values: ['label', 'queryMode', 'queryString'], meta: ['property'], dataSources: ['offices'] })
  assert.deepEqual(result.fields.missingInBlock, { values: ['queryString'], sources: ['offices', 'property'] })
  assert.deepEqual(result.fields.unusedByComponent, { values: ['pageSize'], sources: ['listings'] })
})

test('a theme-prefixed component wins for its theme', async () => {
  const result = await describe({ blockName: 'Property Results', themeName: 'agentTheme' })
  assert.equal(result.component.file, `clearwater-${ORG}/agentThemePropertyResults.vue`)
  // Not in the deployed manifest.
  assert.equal(result.deployment.deployed, false)
  assert.equal(result.deployment.sameAsDeployed, false)
  assert.equal(result.deployedSite.status, 'cms-html')
})

test('a missing component means the public site shows the CMS markup', async () => {
  const result = await describe({ blockName: 'Nothing Like This' })
  assert.equal(result.status, 'cms-html')
  assert.equal(result.component, undefined)
  assert.match(result.message, /CMS HTML/)
})

test('a local file changed since the deployed commit is not the deployed one', async () => {
  const result = await describe({ blockName: 'Navbar', fetchImpl: manifest(['navbar.vue']), git: git(true) })
  assert.equal(result.deployment.sameAsDeployed, false)
  assert.match(result.deployment.reason, /not deployed/)
})

test('no checkout and no manifest are reported', async () => {
  const missing = await describe({ blockName: 'Navbar', listComponents: async () => null })
  assert.equal(missing.status, 'renderer-repo-unavailable')
  const unreachable = await describe({ blockName: 'Navbar', fetchImpl: async () => ({ ok: false, status: 503 }) })
  assert.equal(unreachable.deployedSite.status, 'renderer-manifest-unavailable')
})

test('field extraction: aliases, template use, v1 blocks and computed access', () => {
  const reads = extractComponentReads(['const v = computed(() => props.block.values)\nv.value.a; v.value?.b\n<template>{{ v.c }}</template> block.values[name]'])
  assert.deepEqual(reads, { values: ['a', 'b', 'c'], meta: [], dataSources: [], dynamic: true })
  const v1 = compareComponentFields({ values: ['title'], meta: ['property'], dataSources: [], dynamic: false }, { values: { title: '', extra: '' }, meta: { property: { collection: { path: 'listings' } } } })
  assert.equal(v1.templateVersion, 1)
  assert.deepEqual(v1.missingInBlock, { values: [], sources: [] })
  assert.deepEqual(v1.unusedByComponent, { values: ['extra'], sources: [] })
})
