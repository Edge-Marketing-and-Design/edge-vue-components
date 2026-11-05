import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { buildCmsBlockEditorDraftValues } from '../composables/useCmsBlockEditorModel.js'

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

test('shared editor opens an adapter draft without loading or modifying the page block', async () => {
  const clone = value => JSON.parse(JSON.stringify(value))
  const modelValue = { value: { templateVersion: 2, template: '<h1>{{ pageHeading }}</h1>', values: { pageHeading: 'Page-owned default' }, blockUpdatedAt: 'unchanged' } }
  const state = reactive({})
  const props = {
    editMode: false,
    contentEditorAdapter: {
      schema: { 'person.headline': { type: 'text', label: 'Headline', value: '' } },
      values: { 'person.headline': 'Entry-owned heading' },
      preview: values => ({ values: { cmsPost: [{ headline: values['person.headline'] }] }, renderContext: { headline: values['person.headline'] } }),
    },
  }
  const normalizers = source.slice(source.indexOf('const normalizeTemplateV2SchemaItem ='), source.indexOf('const buildMetaFromTemplateV2DataSourceControls ='))
  const defaults = source.slice(source.indexOf('const collectTemplateV2SchemaDefaults ='), source.indexOf('const buildUpdatedBlockDocFromContent ='))
  const opening = source.slice(source.indexOf('const openEditor ='), source.indexOf('const getAuthoredFieldMeta ='))
  const saving = source.slice(source.indexOf('const save = () =>'), source.indexOf('watch(siteAllowsSelfRegistration,'))
  const preview = source.slice(source.indexOf('const fieldEditorPreviewBlock ='), source.indexOf('const isSingleRichtextOnlyFieldEditor ='))
  const editor = runInNewContext(`${normalizers}; ${defaults}; ${opening}; ${saving}; ${preview}; ({ openEditor, save, fieldEditorPreviewBlock })`, {
    computed,
    props,
    state,
    modelValue,
    canShowPreviewContentControl: { value: true },
    canOpenFieldEditor: { value: false },
    EDITOR_CONTROL_CLICK_SELECTOR: '[data-cms-block-control]',
    isTemplateV2BlockDoc: block => block.templateVersion === 2,
    isMalformedLegacyTemplateV2Doc: () => false,
    loadSourceBlockDoc: () => { throw new Error('Adapter must not load page/library values') },
    buildMetaFromTemplateV2DataSourceControls: () => ({}),
    buildCmsBlockEditorDraftValues,
    edgeGlobal: { dupObject: clone },
    isPublicationFieldMeta: () => false,
    ensureQueryItemsDefaults() {},
    removeIgnoredMetaEntries() {},
    normalizeBlockProtection: () => ({ enabled: false }),
    siteAllowsSelfRegistration: { value: false },
    collectValidationErrors: () => [],
    customPostFieldsOwnedByEntry: { value: false },
    sanitizeQueryItems: clone,
    applyDataSourceControlDraftMeta: clone,
  })
  const original = clone(modelValue.value)
  await editor.openEditor(null, { allowPreviewFieldEditor: true })
  assert.equal(state.open, true)
  assert.equal(state.editorMode, 'fields')
  assert.equal(state.draft['person.headline'], 'Entry-owned heading')
  assert.equal(state.draft.pageHeading, undefined)
  assert.equal(state.meta['person.headline'].title, 'Headline')
  state.draft['person.headline'] = 'Live entry edit'
  assert.equal(editor.fieldEditorPreviewBlock.value.renderContext.headline, 'Live entry edit')
  assert.equal(editor.fieldEditorPreviewBlock.value.meta['person.headline'].type, 'text', 'Shared focus highlighting receives the editable field metadata')
  state.open = false
  assert.deepEqual(modelValue.value, original, 'Cancel never modifies the page block or post')
  await editor.openEditor(null, { allowPreviewFieldEditor: true })
  assert.equal(state.draft['person.headline'], 'Entry-owned heading')
  state.draft['person.headline'] = 'Save this entry value'
  editor.save()
  assert.equal(state.open, false)
  assert.equal(modelValue.value.values['person.headline'], 'Save this entry value')
  assert.equal(props.contentEditorAdapter.values['person.headline'], 'Entry-owned heading', 'Save emits detached values rather than mutating adapter input')
})
