import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const blockApiSource = readFileSync(new URL('../components/cms/blockApi.vue', import.meta.url), 'utf8')
const blockRenderSource = readFileSync(new URL('../components/cms/blockRender.vue', import.meta.url), 'utf8')

const arrowFunctionSource = (source, name) => {
  const start = source.indexOf(`const ${name} =`)
  const end = source.indexOf('\n}\n', start)

  assert.notEqual(start, -1, `${name} should exist`)
  assert.notEqual(end, -1, `${name} should close`)

  return source.slice(start, end + 2)
}

test('nested collection source calls resolve scoped query items through a fresh lookup', () => {
  assert.match(blockRenderSource, /collectionSourceResolver:\s*\{\s*type: Function/)
  assert.match(blockRenderSource, /await props\.collectionSourceResolver\(sourceCall\.name, sourceConfig, scopedOverrides\)/)
  assert.match(blockRenderSource, /return applyTemplateV2SourceOverrides\(resolvedItems, sourceConfig, scopedOverrides, scope, \{ filtered: true \}\)/)
})

test('scoped preview lookups infer array-contains from the loaded record shape', () => {
  assert.match(blockApiSource, /const arrayFields = getScopedCollectionArrayFields\(sourceConfig\)/)
  assert.match(blockApiSource, /\.map\(field => \(\{ field, operator: 'array-contains' \}\)\)/)
  assert.match(blockApiSource, /queryItems: overrideQueryItems/)
  assert.match(blockApiSource, /edgeGlobal\.cmsCollectionData\(edgeFirebase, \{\}, \{ \[sourceName\]: cfg \}, props\.siteId\)/)
})

test('API prefetch reacts to value content instead of equivalent object identities', () => {
  const source = arrowFunctionSource(blockApiSource, 'serializePreviewRequestInput')
  const serializePreviewRequestInput = runInNewContext(`${source}\nserializePreviewRequestInput`)

  assert.equal(
    serializePreviewRequestInput({
      agents: [{ name: 'Yvonne Hanson' }],
      properties: [],
    }),
    serializePreviewRequestInput({
      agents: [{ name: 'Yvonne Hanson' }],
      properties: [],
    }),
  )
  assert.notEqual(
    serializePreviewRequestInput({ agents: [{ name: 'Yvonne Hanson' }] }),
    serializePreviewRequestInput({ agents: [{ name: 'Seth Fischer' }] }),
  )
  assert.match(blockApiSource, /watch: \[runtimeMetaRequestSignature, valuesRequestSignature\]/)
  assert.doesNotMatch(blockApiSource, /watch: \[runtimeMeta, \(\) => props\.values\]/)
})

test('collection previews refetch only when their request content changes', () => {
  assert.match(blockApiSource, /const collectionRequestSignature = computed\(\(\) => serializePreviewRequestInput\(\{\s*siteId: props\.siteId,\s*meta: collectionMetaToFetch\.value,\s*values: mergedValues\.value,/)
  assert.match(blockApiSource, /watch\(collectionRequestSignature, async \(\) => \{/)
  assert.match(blockApiSource, /if \(requestId === collectionRequestId\)\s*collectionValues\.value = result \|\| \{\}/)
  assert.doesNotMatch(blockApiSource, /computedAsync\(/)
})

test('scoped API requests are reused across equivalent Template v2 preview renders', () => {
  assert.match(blockRenderSource, /const templateV2ApiRequestCache = new Map\(\)/)
  assert.match(blockRenderSource, /templateV2ApiRequestCache,\s*\}\s*,?\s*\)/)
  assert.match(blockRenderSource, /watch\(\s*templateV2RenderSignature,/)
  assert.doesNotMatch(blockRenderSource, /watch\(\s*templateV2Block,[\s\S]*?\{ immediate: true, deep: true \}/)
})

test('Template v2 loop aliases win over records with matching field names', () => {
  const source = arrowFunctionSource(blockRenderSource, 'createTemplateV2ChildScope')
  const createTemplateV2ChildScope = runInNewContext(`${source}\ncreateTemplateV2ChildScope`)
  const agent = {
    agent: true,
    item: 'record item field',
    name: 'Seth Fischer',
    offices: ['office-1'],
    userId: 'user-1',
  }

  const agentScope = createTemplateV2ChildScope({}, 'agent', agent)
  assert.equal(agentScope.agent, agent)
  assert.equal(agentScope.item, agent)
  assert.equal(agentScope.name, 'Seth Fischer')
  assert.deepEqual(agentScope.offices, ['office-1'])

  const property = {
    name: 'Property',
    property: 'record property field',
  }
  const propertyScope = createTemplateV2ChildScope({}, 'property', property)
  assert.equal(propertyScope.property, property)
  assert.equal(propertyScope.item, property)
})
