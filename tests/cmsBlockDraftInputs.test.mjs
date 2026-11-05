import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive, ref } from 'vue'
import { buildCmsBlockEditorDraftValues, orderCmsBlockEditorMeta } from '../composables/useCmsBlockEditorModel.js'
import { safeParseTagConfig } from '../lib/cmsTagConfig.js'

const source = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end))
const clone = value => JSON.parse(JSON.stringify(value))
const released = { templateVersion: 2, content: '<h1>{{ oldHeading }}</h1>', template: '<h1>{{ oldHeading }}</h1>', schema: { oldHeading: { type: 'text', label: 'Released heading', value: 'Released default' } }, values: {}, dataSources: {} }
const draft = { id: 'preview', blockId: 'library', templateVersion: 2, content: '<p>{{ addedInput }}</p>', template: '<p>{{ addedInput }}</p>', schema: { addedInput: { type: 'text', label: 'New input', value: 'Draft default' } }, values: {}, dataSources: {} }

const setup = (model = draft, standalonePreview = true) => {
  const state = reactive({})
  const modelValue = ref(clone(model))
  const props = reactive({ standalonePreview, editMode: true })
  const library = clone(released)
  const snapshots = []
  const orderedTemplates = []
  const context = {
    computed,
    props,
    state,
    modelValue,
    sourceBlockDocId: ref('library'),
    sourceBlocksCollectionPath: ref('organizations/org/blocks'),
    edgeFirebase: { data: { 'organizations/org/blocks': { library } }, startSnapshot: path => snapshots.push(path) },
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' }, dupObject: clone },
    canShowPreviewContentControl: ref(false),
    canOpenFieldEditor: ref(true),
    EDITOR_CONTROL_CLICK_SELECTOR: '[data-cms-block-control]',
    isTemplateV2BlockDoc: doc => doc?.templateVersion === 2,
    isMalformedLegacyTemplateV2Doc: () => false,
    buildMetaFromTemplateV2DataSourceControls: () => ({}),
    buildCmsBlockEditorDraftValues,
    orderCmsBlockEditorMeta,
    hasObjectEntries: value => Boolean(value && Object.keys(value).length),
    getBlockRenderMeta: (_, sourceMeta, instanceMeta) => ({ ...sourceMeta, ...instanceMeta }),
    extractTemplateV2FieldsInOrder: (template, fields) => {
      orderedTemplates.push(template)
      return fields
    },
    shouldIgnoreMeta: () => false,
    safeParseTagConfig,
    PLACEHOLDERS: { text: 'Text', textarea: 'Text', image: '', richtext: '<p>Text</p>' },
    BLOCK_EDITOR_IGNORED_TAG_TYPES: new Set(['renderblocks']),
    isPublicationFieldMeta: () => false,
    ensureQueryItemsDefaults() {},
    removeIgnoredMetaEntries() {},
    normalizeBlockProtection: () => ({ enabled: false }),
    siteAllowsSelfRegistration: ref(false),
    collectValidationErrors: () => [],
    customPostFieldsOwnedByEntry: ref(false),
    sanitizeQueryItems: clone,
    applyDataSourceControlDraftMeta: clone,
  }
  const declarations = [
    section('function findMatchingBrace(', 'const BLOCK_EDITOR_IGNORED_TAG_TYPES ='),
    section('\nconst TAG_START_RE =', 'const isTemplateV2BlockDoc ='),
    section('const OWN_DEFINITION_PREVIEW_IDS =', 'const inheritedPreviewType ='),
    section('const normalizeTemplateV2SchemaItem =', 'const buildMetaFromTemplateV2DataSourceControls ='),
    section('const collectTemplateV2SchemaDefaults =', 'const buildUpdatedBlockDocFromContent ='),
    section('const blockContentSourceDoc =', '// Display-only data for a custom type'),
    section('const openEditor =', 'const getAuthoredFieldMeta ='),
    section('const orderedMeta =', 'const hasEditableArrayControls ='),
    section('const save = () =>', 'watch(siteAllowsSelfRegistration,'),
  ].join('\n')
  const editor = runInNewContext(`${declarations}; ({ openEditor, save, orderedMeta, resolvedRenderBlock, loadSourceBlockDoc })`, context)
  return { editor, state, modelValue, props, library, snapshots, orderedTemplates }
}

test('unreleased inputs open from the exact Block Editor preview definition', async () => {
  const { editor, state, modelValue, library, snapshots, orderedTemplates } = setup()
  await editor.openEditor(null)
  assert.equal(state.meta.addedInput.title, 'New input')
  assert.equal(state.meta.oldHeading, undefined)
  assert.equal(state.draft.addedInput, 'Draft default')
  assert.equal(editor.orderedMeta.value[0].field, 'addedInput')
  assert.equal(orderedTemplates[0], draft.template)
  state.draft.addedInput = 'Preview-only test value'
  editor.save()
  assert.equal(modelValue.value.values.addedInput, 'Preview-only test value')
  assert.deepEqual(library, released, 'Trying an input does not write or release the library block')
  assert.deepEqual(snapshots, [], 'Own-definition previews do not fetch released schema')
})

test('Cancel and reopen use the draft schema, including newly added or removed inputs', async () => {
  const { editor, state, modelValue } = setup()
  await editor.openEditor(null)
  state.draft.addedInput = 'Discard this'
  state.open = false
  await editor.openEditor(null)
  assert.equal(state.draft.addedInput, 'Draft default')
  modelValue.value.schema = {}
  modelValue.value.template = '<p>No editable inputs now</p>'
  await editor.openEditor(null)
  assert.equal(Object.keys(state.meta).length, 0)
  assert.equal(Object.keys(editor.resolvedRenderBlock.value.schema).length, 0, 'Empty draft schema must not revive released inputs')
})

test('history previews use snapshot inputs rather than the current release', async () => {
  const { editor, state } = setup({ ...draft, id: 'history-preview' })
  await editor.openEditor(null)
  assert.equal(state.meta.addedInput.title, 'New input')
  assert.equal(state.meta.oldHeading, undefined)
})

test('page instances still open released inputs, not their stale inline schema', async () => {
  const { editor, state } = setup({ ...draft, id: 'page-instance' }, false)
  await editor.openEditor(null)
  assert.equal(state.meta.oldHeading.title, 'Released heading')
  assert.equal(state.meta.addedInput, undefined)
})

test('standalone page instances are not mistaken for draft-authoring previews', async () => {
  const { editor } = setup({ ...draft, id: 'page-instance' }, true)
  assert.equal((await editor.loadSourceBlockDoc()).schema.oldHeading.label, 'Released heading')
})

test('new legacy triple-brace inputs also use the current unreleased markup', async () => {
  const { editor, state } = setup({ id: 'preview', blockId: 'library', templateVersion: 1, content: '<p>{{{#text {"field":"newLegacyField","title":"New legacy input","value":"Try me"}}}}</p>', values: {}, meta: {} })
  await editor.openEditor(null)
  assert.equal(state.meta.newLegacyField.title, 'New legacy input')
  assert.equal(state.draft.newLegacyField, 'Try me')
  assert.equal(state.meta.oldHeading, undefined)
})
