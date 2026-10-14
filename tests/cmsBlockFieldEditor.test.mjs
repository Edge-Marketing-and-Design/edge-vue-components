import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const filename = new URL('../components/cms/block.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const { descriptor } = parse(source)

test('field editor has a side preview from page preview and edit layout', () => {
  const declaration = source.match(/^const showFieldEditorPreview = computed\(.+\)$/m)?.[0]
  assert.ok(declaration)
  const props = reactive({ editMode: false, standalonePreview: false })
  const preview = runInNewContext(`${declaration}; showFieldEditorPreview`, { computed, props })
  assert.equal(preview.value, true, 'Page Preview opens the split editor')
  props.editMode = true
  assert.equal(preview.value, true, 'Edit Layout retains the split editor')
  props.standalonePreview = true
  assert.equal(preview.value, true, 'Developer editing retains the split editor')
  props.editMode = false
  assert.equal(preview.value, false, 'Standalone non-editing previews remain unchanged')
})

test('sheet layout, resizing and highlights use the editor presentation flag', () => {
  const sheet = source.slice(source.indexOf('<Sheet v-model:open="state.open">'))
  assert.doesNotMatch(sheet, /props\.editMode/)
  assert.match(sheet, /state\.editorMode === 'content' \|\| showFieldEditorPreview/)
  assert.match(sheet, /v-if="showFieldEditorPreview"/)
  assert.match(sheet, /:values="fieldEditorPreviewBlock\.values"/)
  assert.match(source, /const startEditorPanelResize = \(event\) => \{\s+if \(!showFieldEditorPreview\.value\)/)
  assert.match(source, /if \(!showFieldEditorPreview\.value \|\| !state\.open \|\| state\.editorMode !== 'fields'\)/)
  assert.match(source, /const canOpenFieldEditor = computed\(\(\) => props\.editMode\)/)
})

test('field editor inherits collection loading mode instead of forcing sample data', () => {
  const preview = source.slice(source.indexOf('ref="fieldEditorPreviewRef"'))
    .split('</edge-cms-block-api>')[0].split('@loaded="handleFieldEditorPreviewLoaded"')[0]
  assert.match(preview, /:standalone-preview="props\.standalonePreview"/)
  assert.doesNotMatch(preview, /:standalone-preview="true"/)

  const apiSource = readFileSync(new URL('../components/cms/blockApi.vue', import.meta.url), 'utf8')
  const declaration = apiSource.slice(apiSource.indexOf('const collectionMetaToFetch = computed('), apiSource.indexOf('const hasCollectionMetaToFetch = computed('))
  const props = reactive({ standalonePreview: false })
  const runtimeMeta = { value: { siteDoc: { collection: { path: 'sites', canonicalLookup: { key: '{orgId}:{siteId}' } } } } }
  const mergedValues = { value: { siteDoc: [{ name: 'stale sample without menus' }] } }
  const meta = runInNewContext(`${declaration}; collectionMetaToFetch`, { computed, props, runtimeMeta, mergedValues })
  assert.equal(meta.value, runtimeMeta.value, 'Page editor fetches current site data even with an existing sample')
  props.standalonePreview = true
  assert.equal(Object.keys(meta.value).length, 0, 'Standalone developer preview still preserves supplied samples')
})

test('block component script and template compile', () => {
  const script = compileScript(descriptor, { id: 'block-field-editor-test' })
  const result = compileTemplate({
    source: descriptor.template.content,
    filename: filename.pathname,
    id: 'block-field-editor-test',
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(result.errors, [])
})
