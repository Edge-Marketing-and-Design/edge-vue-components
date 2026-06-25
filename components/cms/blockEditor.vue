<script setup>
import { Code2, Download, HelpCircle, History, Loader2, Maximize2, Monitor, Plus, RotateCcw, Smartphone, Tablet, Trash2, Wand2 } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  blockId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])

const edgeFirebase = inject('edgeFirebase')
const { saveJsonFile } = useJsonFileSave()
const { convertLegacyBlockToTemplateV2 } = useCmsTemplateV2Conversion()
const { blocks: blockNewDocSchema } = useCmsNewDocs()
const blockEditorPostPreviewCache = useState('edge-cms-block-editor-post-preview-cache', () => ({}))
const BLOCK_INSTRUCTIONS_FIELD_KEY = 'Instructions'
const BLOCK_AI_INSTRUCTIONS_FIELD_KEY = 'aiInstructions'

const state = reactive({
  filter: '',
  newDocs: {
    blocks: blockNewDocSchema.value,
  },
  mounted: false,
  workingDoc: {},
  loading: false,
  jsonEditorOpen: false,
  jsonEditorContent: '',
  jsonEditorError: '',
  helpOpen: false,
  editingContext: null,
  renderSite: '',
  initialBlocksSeeded: false,
  seedingInitialBlocks: false,
  previewViewport: 'full',
  previewScale: '100',
  previewAuthLoggedIn: true,
  previewBlock: null,
  previewSourceValues: {},
  previewRenderContext: null,
  editorWorkingDoc: null,
  themeDefaultAppliedForBlockId: '',
  editorKey: 0,
  editorHasUnsavedChanges: false,
  historyDialogOpen: false,
  historyLoading: false,
  historyRestoring: false,
  historyError: '',
  historyItems: [],
  historySelectedId: '',
  historyPreviewBlock: null,
  showHistoryDiffDialog: false,
  instructionsDialogOpen: false,
  aiInstructionsDialogOpen: false,
  templateEditorTab: 'template',
  templateJsonErrors: {},
  templateRawJsonOpen: {
    schema: false,
    dataSources: false,
  },
  templateDeleteDialogOpen: false,
  templateDeleteTarget: null,
  dataSourceWizardOpen: false,
  dataSourceWizardStep: 1,
  dataSourceWizardError: '',
  dataSourceWizardDraft: null,
  dataSourceWizardMode: 'add',
  dataSourceWizardOriginalName: '',
  dataSourceWizardActiveControlIndex: -1,
  dataSourceWizardKey: 0,
  schemaWizardOpen: false,
  schemaWizardStep: 1,
  schemaWizardError: '',
  schemaWizardDraft: null,
  schemaWizardMode: 'add',
  schemaWizardOriginalField: '',
  schemaWizardActiveItemFieldIndex: -1,
  schemaWizardActiveDefaultItemIndex: -1,
  v2DynamicContentDialogOpen: false,
  v2DynamicField: {
    selectedKey: '',
    useParentArrayLookup: false,
    parentArrayLookupMode: 'canonical',
    parentArrayField: '',
    indexedLookupField: '',
    canonicalLookupLimit: '0',
  },
})
const isGlobalAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const instructionsEnabledToggles = computed(() => {
  const baseToggles = ['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline', 'link']
  if (isGlobalAdmin.value)
    return [...baseToggles, 'source']
  return baseToggles
})

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

const previewViewportOptions = [
  { id: 'full', label: 'Wild Width', width: '100%', icon: Maximize2 },
  { id: 'large', label: 'Large Screen', width: '1280px', icon: Monitor },
  { id: 'medium', label: 'Medium', width: '992px', icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: '420px', icon: Smartphone },
]
const previewScaleOptions = [
  { name: '100', title: '100%' },
  { name: '75', title: '75%' },
  { name: '50', title: '50%' },
  { name: '25', title: '25%' },
]
const previewTypeOptions = [
  { name: 'light', title: 'Light Preview' },
  { name: 'dark', title: 'Dark Preview' },
]
const blockTypeOptions = [
  { name: 'Page', title: 'Page' },
  { name: 'Post', title: 'Post' },
]
const v2SchemaTypeOptions = [
  { name: 'text', title: 'Text' },
  { name: 'textarea', title: 'Textarea' },
  { name: 'richtext', title: 'Rich Text' },
  { name: 'image', title: 'Image' },
  { name: 'number', title: 'Number' },
  { name: 'array', title: 'Array' },
  { name: 'option', title: 'Select' },
  { name: 'publication', title: 'Publication' },
]
const v2ArrayItemSchemaTypeOptions = [
  { name: 'text', title: 'Text' },
  { name: 'textarea', title: 'Textarea' },
  { name: 'richtext', title: 'Rich Text' },
  { name: 'image', title: 'Image' },
  { name: 'number', title: 'Number' },
  { name: 'option', title: 'Select' },
]
const v2ImageVariantOptions = [
  { name: 'public', title: 'Public' },
  { name: 'thumbnail', title: 'Thumbnail' },
]
const v2PublicationEffectOptions = [
  { name: 'flip', title: 'Flip' },
  { name: 'slide', title: 'Slide' },
]
const v2TemplateFormatterOptions = [
  { name: 'money', title: 'Money' },
  { name: 'number', title: 'Number' },
  { name: 'integer', title: 'Integer' },
  { name: 'date', title: 'Date' },
  { name: 'datetime', title: 'Date & Time' },
  { name: 'lower', title: 'Lowercase Text' },
  { name: 'upper', title: 'Uppercase Text' },
  { name: 'trim', title: 'Trimmed Text' },
  { name: 'slug', title: 'Slug' },
  { name: 'title', title: 'Title Case' },
  { name: 'deslug', title: 'Deslug' },
  { name: 'default', title: 'Default' },
  { name: 'richtext', title: 'Rich Text' },
]
const v2DataSourceTypeOptions = [
  { name: 'collection', title: 'Collection' },
  { name: 'api', title: 'API' },
]

const normalizePreviewType = (value) => {
  return value === 'dark' ? 'dark' : 'light'
}

const normalizeTemplateVersion = (value) => {
  return Number(value) === 2 ? 2 : 1
}

const blocks = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || null
})

const currentBlock = computed(() => blocks.value?.[props.blockId] || null)

const hasExplicitTemplateVersion = (doc) => {
  return !!doc && Object.prototype.hasOwnProperty.call(doc, 'templateVersion')
}

const isSavedTemplateV2Block = computed(() => {
  if (props.blockId === 'new')
    return false
  return hasExplicitTemplateVersion(currentBlock.value) && normalizeTemplateVersion(currentBlock.value?.templateVersion) === 2
})

const isWorkingTemplateV2Doc = (doc) => {
  if (!doc)
    return false
  if (doc.templateConversion)
    return true
  if (normalizeTemplateVersion(doc.templateVersion) === 2)
    return true
  return isSavedTemplateV2Block.value
}

const getWorkingTemplateVersion = (doc) => {
  return isWorkingTemplateV2Doc(doc) ? 2 : 1
}

const hasLegacyInlineTags = (content) => {
  return /\{\{\{#[A-Za-z0-9_-]+\s*\{/.test(String(content || ''))
}

const hasLegacyInlineTagsInDoc = (doc) => {
  return hasLegacyInlineTags(doc?.content) || hasLegacyInlineTags(doc?.template)
}

const hasTemplateV2Definitions = (doc) => {
  const schemaKeys = (doc?.schema && typeof doc.schema === 'object' && !Array.isArray(doc.schema)) ? Object.keys(doc.schema) : []
  const dataSourceKeys = (doc?.dataSources && typeof doc.dataSources === 'object' && !Array.isArray(doc.dataSources)) ? Object.keys(doc.dataSources) : []
  return schemaKeys.length > 0 || dataSourceKeys.length > 0
}

const shouldAutoConvertTemplateV2Doc = (doc) => {
  if (!doc || doc.templateConversion || !hasLegacyInlineTagsInDoc(doc))
    return false
  if (props.blockId === 'new')
    return true
  return normalizeTemplateVersion(doc.templateVersion) === 2 && !hasTemplateV2Definitions(doc)
}

const ensureTemplateV2Fields = (doc) => {
  if (!doc || !isWorkingTemplateV2Doc(doc))
    return
  if (typeof doc.template !== 'string')
    doc.template = typeof doc.content === 'string' ? doc.content : ''
  if (!doc.schema || typeof doc.schema !== 'object' || Array.isArray(doc.schema))
    doc.schema = {}
  if (!doc.dataSources || typeof doc.dataSources !== 'object' || Array.isArray(doc.dataSources))
    doc.dataSources = {}
}

const formatJson = (value) => {
  try {
    return JSON.stringify(value || {}, null, 2)
  }
  catch {
    return '{}'
  }
}

const updateJsonDocField = (workingDoc, field, value) => {
  try {
    const parsed = value ? JSON.parse(value) : {}
    const parsedIsObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    workingDoc[field] = parsedIsObject ? parsed : {}
    if (state.templateJsonErrors[field])
      delete state.templateJsonErrors[field]
  }
  catch (error) {
    state.templateJsonErrors[field] = error?.message || 'Invalid JSON.'
  }
}

const titleFromKey = (value) => {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

const handleGuideShortcutClick = (event) => {
  const link = event.target?.closest?.('a[href^="#"]')
  if (!link)
    return
  const targetId = String(link.getAttribute('href') || '').slice(1)
  if (!targetId)
    return
  const target = document.getElementById(targetId)
  if (!target)
    return
  event.preventDefault()
  event.stopPropagation()
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function sanitizeV2FieldName(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .replace(/\s+([A-Za-z0-9_$])/g, (_, char) => char.toUpperCase())
    .replace(/^[^A-Za-z_$]+/, '')
}

const notifyTemplateV2EditorError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

const createTemplateV2DataSourceWizardDraft = () => ({
  sourceName: '',
  type: 'collection',
  api: '',
  apiField: 'data',
  apiQuery: '',
  path: '',
  baseKey: '',
  uniqueKey: '{orgId}',
  canonicalLookupKey: '',
  limit: '',
  queryItems: [
    { key: '', value: '' },
  ],
  previewQueryItems: [],
  filters: [],
  sort: [],
  valueJson: '[]',
  controls: [],
})

const v2DataSourceScopeOptions = [
  { name: '{orgId}', title: 'Organization level' },
  { name: '{orgId}:{siteId}', title: 'Site level' },
]

const v2DataSourceFilterOperatorOptions = [
  { name: '==', title: 'Equals' },
  { name: '!=', title: 'Does Not Equal' },
  { name: '>', title: 'Greater Than' },
  { name: '>=', title: 'Greater Than Or Equal' },
  { name: '<', title: 'Less Than' },
  { name: '<=', title: 'Less Than Or Equal' },
  { name: 'array-contains', title: 'Array Contains' },
  { name: 'in', title: 'In List' },
  { name: 'not-in', title: 'Not In List' },
  { name: 'array-contains-any', title: 'Array Contains Any' },
  { name: 'array-contains-all', title: 'Array Contains All' },
]

const v2DynamicParentArrayLookupModeOptions = [
  { name: 'canonical', title: 'Exact Record Key' },
  { name: 'queryItems', title: 'Indexed Field' },
]

const v2DataSourceFilterArrayValueOperators = new Set([
  'in',
  'not-in',
  'array-contains-any',
  'array-contains-all',
])

const getV2DataSourceFilterValueLabel = (operator) => {
  return v2DataSourceFilterArrayValueOperators.has(String(operator || '').trim().toLowerCase()) ? 'Values' : 'Value'
}

const getV2DataSourceFilterValuePlaceholder = (operator) => {
  return v2DataSourceFilterArrayValueOperators.has(String(operator || '').trim().toLowerCase()) ? 'Add values' : 'published'
}

const getV2DataSourceFilterValueHelper = (operator) => {
  const normalizedOperator = String(operator || '').trim().toLowerCase()
  if (v2DataSourceFilterArrayValueOperators.has(normalizedOperator))
    return 'Add each value separately. These are saved as an array.'
  if (normalizedOperator === 'array-contains')
    return 'Enter one value to match inside an array field.'
  return ''
}

const isV2DataSourceFilterArrayOperator = (operator) => {
  return v2DataSourceFilterArrayValueOperators.has(String(operator || '').trim().toLowerCase())
}

const v2DataSourceSortDirectionOptions = [
  { name: 'asc', title: 'Ascending' },
  { name: 'desc', title: 'Descending' },
]

const v2DataSourceControlTypeOptions = [
  { name: 'text', title: 'Text Input' },
  { name: 'select', title: 'Select' },
]

const v2DataSourceControlOptionModeOptions = [
  { name: 'manual', title: 'Manual Options' },
  { name: 'collection', title: 'Collection Options' },
]

const normalizeSelectModelValue = (value) => {
  return (typeof value === 'object' && value !== null) ? String(value.name || '').trim() : String(value || '').trim()
}

const updateV2DataSourceControlInput = (control, value) => {
  if (!control)
    return
  const input = normalizeSelectModelValue(value) || 'text'
  control.input = input === 'select' ? 'select' : 'text'
  if (control.input !== 'select')
    control.optionMode = 'manual'
}

const updateV2DataSourceControlOptionMode = (control, value) => {
  if (!control)
    return
  const mode = normalizeSelectModelValue(value) === 'collection' ? 'collection' : 'manual'
  control.optionMode = mode
  if (mode === 'collection')
    control.input = 'select'
}

const getV2DataSourceControlKeyLabel = (type) => {
  if (type === 'api')
    return 'Query String Key'
  if (type === 'collection')
    return 'Indexed Lookup Field'
  return 'Control Key'
}

const getV2DataSourceControlKeyPlaceholder = (type) => {
  if (type === 'api')
    return 'filter[status]'
  if (type === 'collection')
    return 'status'
  return 'filterKey'
}

const getV2DataSourceControlKeyHelper = (type) => {
  if (type === 'api')
    return 'This becomes the query string parameter sent to the API when the page editor sets this control.'
  if (type === 'collection')
    return 'Choose a field that is indexed for fast filtering. This narrows the list before records are returned.'
  return 'This is the key used to store the editor control value for this manual source.'
}

const dataSourceWizardStepItems = [
  { step: 1, title: 'Source' },
  { step: 2, title: 'Location' },
  { step: 3, title: 'Filtering' },
  { step: 4, title: 'Controls' },
  { step: 5, title: 'Review' },
]
const getTemplateV2SchemaWizardSteps = (entry) => {
  const type = String(entry?.type || 'text').trim() || 'text'
  const steps = [{ step: 1, title: 'Field' }]
  if (!['array', 'publication'].includes(type))
    steps.push({ step: 2, title: 'Default' })
  if (['array', 'image', 'richtext', 'publication', 'option'].includes(type))
    steps.push({ step: 3, title: 'Settings' })
  steps.push({ step: 4, title: 'Review' })
  return steps
}

const activeSchemaWizardStepItems = computed(() => getTemplateV2SchemaWizardSteps(state.schemaWizardDraft?.entry))

const resetTemplateV2DataSourceWizard = () => {
  state.dataSourceWizardStep = 1
  state.dataSourceWizardError = ''
  state.dataSourceWizardDraft = createTemplateV2DataSourceWizardDraft()
  state.dataSourceWizardMode = 'add'
  state.dataSourceWizardOriginalName = ''
  state.dataSourceWizardActiveControlIndex = -1
  state.dataSourceWizardKey += 1
}

const openTemplateV2DataSourceWizard = async () => {
  state.dataSourceWizardOpen = false
  state.dataSourceWizardDraft = null
  state.dataSourceWizardKey += 1
  await nextTick()
  resetTemplateV2DataSourceWizard()
  state.dataSourceWizardOpen = true
}

const objectToMapRows = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return []
  return Object.entries(value).map(([key, itemValue]) => ({
    key,
    value: typeof itemValue === 'string' ? itemValue : JSON.stringify(itemValue),
  }))
}

const stringifyWizardValue = (value) => {
  if (value === undefined || value === null)
    return ''
  if (typeof value === 'string')
    return value
  return JSON.stringify(value)
}

const parseWizardValue = (value) => {
  if (Array.isArray(value))
    return value
  const trimmedValue = String(value ?? '').trim()
  if (!trimmedValue)
    return ''
  try {
    return JSON.parse(trimmedValue)
  }
  catch {
    return trimmedValue
  }
}

const queryArrayToFilterRows = (value) => {
  if (!Array.isArray(value))
    return []
  return value.map(item => ({
    field: String(item?.field || '').trim(),
    operator: String(item?.operator || '==').trim() || '==',
    value: (isV2DataSourceFilterArrayOperator(item?.operator) && Array.isArray(item?.value)) ? item.value : stringifyWizardValue(item?.value),
  }))
}

const getV2DataSourceFilterArrayValues = (value) => {
  if (Array.isArray(value))
    return value.map(item => String(item || '').trim()).filter(Boolean)
  const trimmedValue = String(value ?? '').trim()
  if (!trimmedValue)
    return []
  try {
    const parsed = JSON.parse(trimmedValue)
    if (Array.isArray(parsed))
      return parsed.map(item => String(item || '').trim()).filter(Boolean)
  }
  catch {}
  return trimmedValue.split(',').map(item => item.trim()).filter(Boolean)
}

const updateV2DataSourceFilterArrayValues = (row, value) => {
  if (!row)
    return
  row.value = Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
}

const orderArrayToSortRows = (value) => {
  if (!Array.isArray(value))
    return []
  return value.map(item => ({
    field: String(item?.field || '').trim(),
    direction: String(item?.direction || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
  }))
}

const controlsObjectToRows = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return []
  return Object.entries(value).map(([key, control]) => {
    const normalizedControl = (control && typeof control === 'object' && !Array.isArray(control)) ? control : {}
    const manualOptions = Array.isArray(normalizedControl.options) ? normalizedControl.options : []
    const hasCollectionOptions = typeof normalizedControl.options === 'string' || normalizedControl.sourceType === 'collection' || !!normalizedControl.collection
    return {
      key,
      title: normalizedControl.title || normalizedControl.label || titleFromKey(key),
      input: normalizedControl.input || normalizedControl.type || ((hasCollectionOptions || manualOptions.length) ? 'select' : 'text'),
      placeholder: normalizedControl.placeholder || '',
      optionMode: hasCollectionOptions ? 'collection' : 'manual',
      options: manualOptions.map(option => ({
        label: String(option?.label ?? option?.title ?? ''),
        value: String(option?.value ?? option?.name ?? ''),
      })),
      optionsCollection: typeof normalizedControl.options === 'string' ? normalizedControl.options : (normalizedControl.collection || ''),
      optionsKey: normalizedControl.optionsKey || 'label',
      optionsValue: normalizedControl.optionsValue || 'value',
      extra: edgeGlobal.dupObject(normalizedControl),
    }
  })
}

const inferTemplateV2DataSourceType = (source) => {
  if (source?.type)
    return source.type
  if (source?.api)
    return 'api'
  if (source?.path || source?.collection)
    return 'collection'
  return 'manual'
}

const createTemplateV2DataSourceWizardDraftFromSource = (sourceName, source = {}) => {
  const sourceType = inferTemplateV2DataSourceType(source)
  const canonicalLookupKey = source.canonicalLookup?.key || source.collection?.canonicalLookup?.key || ''
  return {
    sourceName,
    type: sourceType,
    api: source.api || '',
    apiField: source.apiField || 'data',
    apiQuery: source.apiQuery || '',
    path: source.path || source.collection?.path || '',
    baseKey: source.baseKey || source.collection?.baseKey || '',
    uniqueKey: source.uniqueKey || source.collection?.uniqueKey || '{orgId}',
    canonicalLookupKey,
    limit: source.limit == null ? '' : String(source.limit),
    queryItems: objectToMapRows(source.queryItems).length ? objectToMapRows(source.queryItems) : [{ key: '', value: '' }],
    previewQueryItems: objectToMapRows(source.previewQueryItems),
    filters: queryArrayToFilterRows(source.query || source.collection?.query || []),
    sort: orderArrayToSortRows(source.order || source.collection?.order || []),
    valueJson: JSON.stringify(source.value ?? [], null, 2),
    controls: controlsObjectToRows(source.controls || {}),
  }
}

const openTemplateV2DataSourceWizardForEdit = (sourceName, source) => {
  state.dataSourceWizardStep = 1
  state.dataSourceWizardError = ''
  state.dataSourceWizardDraft = null
  state.dataSourceWizardMode = 'edit'
  state.dataSourceWizardOriginalName = sourceName
  state.dataSourceWizardDraft = createTemplateV2DataSourceWizardDraftFromSource(sourceName, source)
  state.dataSourceWizardActiveControlIndex = -1
  state.dataSourceWizardKey += 1
  state.dataSourceWizardOpen = true
}

const closeTemplateV2DataSourceWizard = () => {
  state.dataSourceWizardOpen = false
  state.dataSourceWizardError = ''
  state.dataSourceWizardDraft = null
  state.dataSourceWizardOriginalName = ''
  state.dataSourceWizardActiveControlIndex = -1
}

const addTemplateV2WizardMapRow = (field) => {
  if (!state.dataSourceWizardDraft)
    resetTemplateV2DataSourceWizard()
  state.dataSourceWizardDraft[field].push({ key: '', value: '' })
}

const removeTemplateV2WizardMapRow = (field, index) => {
  if (!Array.isArray(state.dataSourceWizardDraft?.[field]))
    return
  state.dataSourceWizardDraft[field].splice(index, 1)
}

const addTemplateV2WizardFilterRow = () => {
  if (!state.dataSourceWizardDraft)
    resetTemplateV2DataSourceWizard()
  state.dataSourceWizardDraft.filters.push({ field: '', operator: '==', value: '' })
}

const removeTemplateV2WizardFilterRow = (index) => {
  if (!Array.isArray(state.dataSourceWizardDraft?.filters))
    return
  state.dataSourceWizardDraft.filters.splice(index, 1)
}

const addTemplateV2WizardSortRow = () => {
  if (!state.dataSourceWizardDraft)
    resetTemplateV2DataSourceWizard()
  state.dataSourceWizardDraft.sort.push({ field: '', direction: 'asc' })
}

const removeTemplateV2WizardSortRow = (index) => {
  if (!Array.isArray(state.dataSourceWizardDraft?.sort))
    return
  state.dataSourceWizardDraft.sort.splice(index, 1)
}

const addTemplateV2WizardControlRow = () => {
  if (!state.dataSourceWizardDraft)
    resetTemplateV2DataSourceWizard()
  state.dataSourceWizardDraft.controls.push({
    key: '',
    title: '',
    input: 'text',
    placeholder: '',
    optionMode: 'manual',
    options: [],
    optionsCollection: '',
    optionsKey: 'label',
    optionsValue: 'value',
  })
  state.dataSourceWizardActiveControlIndex = state.dataSourceWizardDraft.controls.length - 1
}

const removeTemplateV2WizardControlRow = (index) => {
  if (!Array.isArray(state.dataSourceWizardDraft?.controls))
    return
  state.dataSourceWizardDraft.controls.splice(index, 1)
  if (state.dataSourceWizardActiveControlIndex === index)
    state.dataSourceWizardActiveControlIndex = -1
  else if (state.dataSourceWizardActiveControlIndex > index)
    state.dataSourceWizardActiveControlIndex -= 1
}

const addTemplateV2WizardControlOptionRow = (control) => {
  if (!Array.isArray(control.options))
    control.options = []
  control.options.push({ label: '', value: '' })
}

const removeTemplateV2WizardControlOptionRow = (control, index) => {
  if (!Array.isArray(control?.options))
    return
  control.options.splice(index, 1)
}

const mapRowsToObject = (rows = []) => {
  return rows.reduce((acc, row) => {
    const key = String(row?.key || '').trim()
    if (!key)
      return acc
    acc[key] = String(row?.value ?? '')
    return acc
  }, {})
}

const filterRowsToQueryArray = (rows = []) => {
  return rows.reduce((acc, row) => {
    const field = String(row?.field || '').trim()
    if (!field)
      return acc
    acc.push({
      field,
      operator: String(row?.operator || '==').trim() || '==',
      value: parseWizardValue(row?.value),
    })
    return acc
  }, [])
}

const sortRowsToOrderArray = (rows = []) => {
  return rows.reduce((acc, row) => {
    const field = String(row?.field || '').trim()
    if (!field)
      return acc
    acc.push({
      field,
      direction: String(row?.direction || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
    })
    return acc
  }, [])
}

const controlRowsToObject = (rows = [], sourceType = '') => {
  return rows.reduce((acc, row) => {
    const rawKey = String(row?.key || '').trim()
    const key = sourceType === 'api' ? rawKey : sanitizeV2FieldName(rawKey)
    if (!key)
      return acc
    const control = (row?.extra && typeof row.extra === 'object' && !Array.isArray(row.extra))
      ? edgeGlobal.dupObject(row.extra)
      : {}
    Object.assign(control, {
      field: key,
      title: String(row?.title || '').trim() || titleFromKey(key),
    })
    const input = String(row?.input || '').trim()
    if (input)
      control.type = input
    const placeholder = String(row?.placeholder || '').trim()
    if (placeholder)
      control.placeholder = placeholder
    if (control.type === 'select') {
      control.optionsKey = String(row?.optionsKey || 'label').trim() || 'label'
      control.optionsValue = String(row?.optionsValue || 'value').trim() || 'value'
      if (row?.optionMode === 'collection') {
        const optionsCollection = String(row?.optionsCollection || '').trim()
        if (optionsCollection)
          control.options = optionsCollection
      }
      else {
        const options = (Array.isArray(row?.options) ? row.options : []).reduce((optionAcc, option) => {
          const label = String(option?.label || '').trim()
          const value = String(option?.value || '').trim()
          if (!label && !value)
            return optionAcc
          optionAcc.push({
            label: label || value,
            value: value || label,
          })
          return optionAcc
        }, [])
        if (options.length)
          control.options = options
      }
    }
    acc[key] = control
    return acc
  }, {})
}

const parseWizardJsonField = (field, fallback) => {
  const raw = String(state.dataSourceWizardDraft?.[field] || '').trim()
  if (!raw)
    return fallback
  return JSON.parse(raw)
}

const buildTemplateV2WizardDataSource = () => {
  const draft = state.dataSourceWizardDraft || createTemplateV2DataSourceWizardDraft()
  const source = {
    type: draft.type || 'collection',
  }

  if (source.type === 'api') {
    source.api = String(draft.api || '').trim()
    source.apiField = String(draft.apiField || '').trim()
    if (String(draft.apiQuery || '').trim())
      source.apiQuery = String(draft.apiQuery || '').trim()
  }
  else if (source.type === 'collection') {
    source.path = String(draft.path || '').trim()
    if (String(draft.baseKey || '').trim())
      source.baseKey = String(draft.baseKey || '').trim()
    source.uniqueKey = String(draft.uniqueKey || '').trim() || '{orgId}'
    const canonicalLookupKey = String(draft.canonicalLookupKey || '').trim()
    if (canonicalLookupKey)
      source.canonicalLookup = { key: canonicalLookupKey }
    const query = filterRowsToQueryArray(draft.filters)
    if (Array.isArray(query) && query.length)
      source.query = query
    const order = sortRowsToOrderArray(draft.sort)
    if (Array.isArray(order) && order.length)
      source.order = order
  }

  const queryItems = mapRowsToObject(draft.queryItems)
  if (Object.keys(queryItems).length)
    source.queryItems = queryItems
  const previewQueryItems = mapRowsToObject(draft.previewQueryItems)
  if (Object.keys(previewQueryItems).length)
    source.previewQueryItems = previewQueryItems

  const limit = Number(draft.limit)
  if (Number.isFinite(limit) && limit > 0)
    source.limit = Math.floor(limit)

  const value = parseWizardJsonField('valueJson', [])
  source.value = value

  const controls = controlRowsToObject(draft.controls, source.type)
  if (controls && typeof controls === 'object' && !Array.isArray(controls) && Object.keys(controls).length)
    source.controls = controls

  return source
}

const previewTemplateV2WizardDataSourceJson = computed(() => {
  try {
    return JSON.stringify(buildTemplateV2WizardDataSource(), null, 2)
  }
  catch {
    return '{}'
  }
})

const validateTemplateV2WizardStep = () => {
  const draft = state.dataSourceWizardDraft || {}
  state.dataSourceWizardError = ''
  if (state.dataSourceWizardStep === 1) {
    const sourceName = sanitizeV2FieldName(draft.sourceName)
    if (!sourceName) {
      state.dataSourceWizardError = 'Enter a source name.'
      return false
    }
    return true
  }
  if (state.dataSourceWizardStep === 2) {
    if (draft.type === 'api' && !String(draft.api || '').trim()) {
      state.dataSourceWizardError = 'Enter the API URL.'
      return false
    }
    if (draft.type === 'collection' && !String(draft.path || '').trim()) {
      state.dataSourceWizardError = 'Enter the collection path.'
      return false
    }
  }
  return true
}

const goTemplateV2WizardStep = (step) => {
  if (state.dataSourceWizardMode === 'edit') {
    state.dataSourceWizardStep = step
    state.dataSourceWizardError = ''
    return
  }
  if (step > state.dataSourceWizardStep && !validateTemplateV2WizardStep())
    return
  state.dataSourceWizardStep = step
}

const addTemplateV2DataSourceFromWizard = (workingDoc) => {
  if (!validateTemplateV2WizardStep())
    return
  ensureTemplateV2Fields(workingDoc)
  const sourceName = sanitizeV2FieldName(state.dataSourceWizardDraft?.sourceName)
  if (!sourceName) {
    state.dataSourceWizardError = 'Enter a source name.'
    return
  }
  const originalName = String(state.dataSourceWizardOriginalName || '').trim()
  const isRename = state.dataSourceWizardMode === 'edit' && originalName && originalName !== sourceName
  const sourceNameExists = Object.prototype.hasOwnProperty.call(workingDoc.dataSources || {}, sourceName)
  if ((state.dataSourceWizardMode === 'add' || isRename) && sourceNameExists) {
    state.dataSourceWizardError = `A data source named "${sourceName}" already exists.`
    return
  }
  try {
    if (isRename)
      delete workingDoc.dataSources[originalName]
    workingDoc.dataSources[sourceName] = buildTemplateV2WizardDataSource()
    closeTemplateV2DataSourceWizard()
  }
  catch (error) {
    state.dataSourceWizardError = error?.message || 'Unable to build data source.'
  }
}

const templateV2DataSourceList = (workingDoc) => {
  const dataSources = workingDoc?.dataSources || {}
  if (!dataSources || typeof dataSources !== 'object' || Array.isArray(dataSources))
    return []
  return Object.entries(dataSources).map(([name, source]) => {
    const hasSourceObject = !!source && typeof source === 'object' && !Array.isArray(source)
    const normalizedSource = hasSourceObject ? source : { type: 'manual', value: source }
    return {
      name,
      source: normalizedSource,
      type: inferTemplateV2DataSourceType(normalizedSource),
    }
  })
}

const getUniqueTemplateV2Key = (container, baseKey) => {
  const base = sanitizeV2FieldName(baseKey) || 'field'
  if (!Object.prototype.hasOwnProperty.call(container || {}, base))
    return base
  let index = 2
  for (;;) {
    const candidate = `${base}${index}`
    if (!Object.prototype.hasOwnProperty.call(container || {}, candidate))
      return candidate
    index += 1
  }
}

const normalizeTemplateV2PublicationEffect = (effect) => {
  const normalized = String(effect || '').trim().toLowerCase()
  return v2PublicationEffectOptions.some(option => option.name === normalized) ? normalized : 'flip'
}

const ensureTemplateV2SchemaOption = (entry) => {
  if (!entry || typeof entry !== 'object')
    return {}
  if (!entry.option || typeof entry.option !== 'object' || Array.isArray(entry.option))
    entry.option = {}
  if (!Array.isArray(entry.option.options))
    entry.option.options = Array.isArray(entry.options) ? entry.options : []
  if (!entry.option.optionsKey)
    entry.option.optionsKey = 'label'
  if (!entry.option.optionsValue)
    entry.option.optionsValue = 'value'
  delete entry.options
  return entry.option
}

const normalizeTemplateV2SchemaEntry = (schema, field) => {
  if (!schema || !field)
    return {}
  const current = schema[field]
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    const hasCurrentStringType = typeof current === 'string' && !!current
    const currentType = hasCurrentStringType ? current : 'text'
    schema[field] = {
      type: currentType,
      label: titleFromKey(field),
    }
  }
  else {
    if (!schema[field].type)
      schema[field].type = 'text'
    if (!schema[field].label)
      schema[field].label = titleFromKey(field)
  }
  if (schema[field].type === 'select')
    schema[field].type = 'option'
  if (schema[field].type === 'option')
    ensureTemplateV2SchemaOption(schema[field])
  if (schema[field].type === 'publication') {
    schema[field].effect = normalizeTemplateV2PublicationEffect(schema[field].effect)
    delete schema[field].height
  }
  return schema[field]
}

const getTemplateV2SchemaEntries = (workingDoc) => {
  const schema = workingDoc?.schema || {}
  return Object.keys(schema).map(field => ({
    field,
    entry: normalizeTemplateV2SchemaEntry(schema, field),
  }))
}

const normalizeTemplateV2SchemaConfig = (field, config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      type: (typeof config === 'string' && config) ? config : 'text',
      label: titleFromKey(field),
    }
  }
  const normalized = config
  if (!normalized.type)
    normalized.type = 'text'
  if (normalized.type === 'select')
    normalized.type = 'option'
  if (!normalized.label && !normalized.title)
    normalized.label = titleFromKey(field)
  if (normalized.type === 'option')
    ensureTemplateV2SchemaOption(normalized)
  return normalized
}

const createTemplateV2SchemaWizardDraft = (field = 'field', entry = null) => {
  const normalizedField = sanitizeV2FieldName(field) || 'field'
  const normalizedEntry = normalizeTemplateV2SchemaConfig(normalizedField, entry || {
    type: 'text',
    label: titleFromKey(normalizedField),
  })
  return {
    field: normalizedField,
    entry: edgeGlobal.dupObject(normalizedEntry),
  }
}

const openTemplateV2SchemaWizard = (workingDoc) => {
  ensureTemplateV2Fields(workingDoc)
  const field = getUniqueTemplateV2Key(workingDoc.schema, 'field')
  state.schemaWizardStep = 1
  state.schemaWizardError = ''
  state.schemaWizardMode = 'add'
  state.schemaWizardOriginalField = ''
  state.schemaWizardActiveItemFieldIndex = -1
  state.schemaWizardActiveDefaultItemIndex = -1
  state.schemaWizardDraft = createTemplateV2SchemaWizardDraft(field)
  state.schemaWizardOpen = true
}

const openTemplateV2SchemaWizardForEdit = (field, entry) => {
  state.schemaWizardStep = 1
  state.schemaWizardError = ''
  state.schemaWizardMode = 'edit'
  state.schemaWizardOriginalField = field
  state.schemaWizardActiveItemFieldIndex = -1
  state.schemaWizardActiveDefaultItemIndex = -1
  state.schemaWizardDraft = createTemplateV2SchemaWizardDraft(field, entry)
  state.schemaWizardOpen = true
}

const closeTemplateV2SchemaWizard = () => {
  state.schemaWizardOpen = false
  state.schemaWizardError = ''
  state.schemaWizardActiveItemFieldIndex = -1
  state.schemaWizardActiveDefaultItemIndex = -1
}

const validateTemplateV2SchemaWizardStep = () => {
  state.schemaWizardError = ''
  const field = sanitizeV2FieldName(state.schemaWizardDraft?.field)
  if (!field) {
    state.schemaWizardError = 'Enter a field key.'
    return false
  }
  return true
}

const goTemplateV2SchemaWizardStep = (step) => {
  const allowedSteps = activeSchemaWizardStepItems.value.map(item => item.step)
  const targetStep = allowedSteps.includes(step) ? step : allowedSteps[allowedSteps.length - 1]
  if (state.schemaWizardMode === 'edit') {
    state.schemaWizardStep = targetStep
    state.schemaWizardError = ''
    return
  }
  if (targetStep > state.schemaWizardStep && !validateTemplateV2SchemaWizardStep())
    return
  state.schemaWizardStep = targetStep
}

const getAdjacentTemplateV2SchemaWizardStep = (direction) => {
  const steps = activeSchemaWizardStepItems.value.map(item => item.step)
  const currentIndex = steps.indexOf(state.schemaWizardStep)
  const safeIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex = Math.min(Math.max(safeIndex + direction, 0), steps.length - 1)
  return steps[nextIndex] || 1
}

const hasPreviousTemplateV2SchemaWizardStep = computed(() => {
  return activeSchemaWizardStepItems.value.map(item => item.step).indexOf(state.schemaWizardStep) > 0
})

const hasNextTemplateV2SchemaWizardStep = computed(() => {
  const steps = activeSchemaWizardStepItems.value.map(item => item.step)
  const currentIndex = steps.indexOf(state.schemaWizardStep)
  return currentIndex !== -1 && currentIndex < steps.length - 1
})

const buildTemplateV2WizardSchemaEntry = () => {
  const draft = state.schemaWizardDraft || createTemplateV2SchemaWizardDraft()
  return normalizeTemplateV2SchemaConfig(draft.field, edgeGlobal.dupObject(draft.entry || {}))
}

const previewTemplateV2WizardSchemaJson = computed(() => {
  try {
    return JSON.stringify(buildTemplateV2WizardSchemaEntry(), null, 2)
  }
  catch {
    return '{}'
  }
})

const saveTemplateV2SchemaFromWizard = (workingDoc) => {
  if (!validateTemplateV2SchemaWizardStep())
    return
  ensureTemplateV2Fields(workingDoc)
  const field = sanitizeV2FieldName(state.schemaWizardDraft?.field)
  const originalField = String(state.schemaWizardOriginalField || '').trim()
  const isRename = state.schemaWizardMode === 'edit' && originalField && originalField !== field
  const fieldExists = Object.prototype.hasOwnProperty.call(workingDoc.schema || {}, field)
  if ((state.schemaWizardMode === 'add' || isRename) && fieldExists) {
    state.schemaWizardError = `An input named "${field}" already exists.`
    return
  }
  if (isRename)
    delete workingDoc.schema[originalField]
  workingDoc.schema[field] = buildTemplateV2WizardSchemaEntry()
  closeTemplateV2SchemaWizard()
}

const ensureTemplateV2ArraySchemaObject = (entry) => {
  if (!entry || typeof entry !== 'object')
    return {}
  if (Array.isArray(entry.schema)) {
    entry.schema = entry.schema.reduce((acc, item) => {
      const field = sanitizeV2FieldName(item?.field)
      if (!field)
        return acc
      const { field: _field, ...rest } = item
      acc[field] = normalizeTemplateV2SchemaConfig(field, rest)
      return acc
    }, {})
  }
  else if (!entry.schema || typeof entry.schema !== 'object') {
    entry.schema = {}
  }
  else {
    Object.keys(entry.schema).forEach((field) => {
      entry.schema[field] = normalizeTemplateV2SchemaConfig(field, entry.schema[field])
    })
  }
  return entry.schema
}

const getTemplateV2ArraySchemaEntries = (entry) => {
  const schema = (entry?.schema && typeof entry.schema === 'object' && !Array.isArray(entry.schema)) ? entry.schema : {}
  return Object.entries(schema).map(([field, itemEntry]) => ({
    field,
    entry: itemEntry,
  }))
}

const addTemplateV2ArraySchemaField = (entry) => {
  const schema = ensureTemplateV2ArraySchemaObject(entry)
  const field = getUniqueTemplateV2Key(schema, 'field')
  schema[field] = {
    type: 'text',
    label: titleFromKey(field),
  }
  state.schemaWizardActiveItemFieldIndex = Object.keys(schema).indexOf(field)
}

const renameTemplateV2ArraySchemaField = (entry, oldField, nextValue) => {
  const schema = ensureTemplateV2ArraySchemaObject(entry)
  const nextField = sanitizeV2FieldName(nextValue)
  if (!oldField || !nextField || nextField === oldField)
    return
  if (Object.prototype.hasOwnProperty.call(schema, nextField)) {
    notifyTemplateV2EditorError(`"${nextField}" already exists in this item schema.`)
    return
  }
  schema[nextField] = schema[oldField]
  delete schema[oldField]
  if (Array.isArray(entry.value)) {
    entry.value.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return
      item[nextField] = item[oldField]
      delete item[oldField]
    })
  }
}

const removeTemplateV2ArraySchemaField = (entry, field) => {
  const schema = ensureTemplateV2ArraySchemaObject(entry)
  const removedIndex = Object.keys(schema).indexOf(field)
  delete schema[field]
  if (Array.isArray(entry.value)) {
    entry.value.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item))
        delete item[field]
    })
  }
  if (state.schemaWizardActiveItemFieldIndex === removedIndex)
    state.schemaWizardActiveItemFieldIndex = -1
  else if (state.schemaWizardActiveItemFieldIndex > removedIndex)
    state.schemaWizardActiveItemFieldIndex -= 1
}

const getTemplateV2ArraySchemaFieldSummary = (arraySchemaItem) => {
  const type = arraySchemaItem?.entry?.type || 'text'
  const label = arraySchemaItem?.entry?.label || titleFromKey(arraySchemaItem?.field)
  return `${label} - ${type === 'option' ? 'select' : type}`
}

const getTemplateV2SchemaOption = (entry) => {
  const option = (entry?.option && typeof entry.option === 'object' && !Array.isArray(entry.option))
    ? entry.option
    : {}
  return {
    ...option,
    options: Array.isArray(option.options) ? option.options : [],
    optionsKey: option.optionsKey || 'label',
    optionsValue: option.optionsValue || 'value',
  }
}

const slugOptionValue = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const getTemplateV2SchemaSelectOptions = (entry) => {
  const option = getTemplateV2SchemaOption(entry)
  const options = option.options
    .map((row) => {
      if (typeof row === 'string') {
        const value = row.trim()
        return value ? { [option.optionsKey]: value, [option.optionsValue]: value } : null
      }
      if (!row || typeof row !== 'object')
        return null
      const label = row[option.optionsKey] ?? row.label ?? row.title ?? row.name ?? row[option.optionsValue] ?? row.value ?? ''
      const value = row[option.optionsValue] ?? row.value ?? row.name ?? row.id ?? label
      if (String(label || '').trim() === '' && String(value || '').trim() === '')
        return null
      return {
        [option.optionsKey]: String(label || value).trim(),
        [option.optionsValue]: String(value || label).trim(),
      }
    })
    .filter(row => row && String(row[option.optionsValue] || '').trim() !== '')
  return {
    ...option,
    options,
  }
}

const addTemplateV2SchemaOptionRow = (entry) => {
  const option = ensureTemplateV2SchemaOption(entry)
  option.options.push({
    label: '',
    value: '',
  })
}

const removeTemplateV2SchemaOptionRow = (entry, index) => {
  const option = ensureTemplateV2SchemaOption(entry)
  option.options.splice(index, 1)
}

const updateTemplateV2SchemaOptionField = (entry, field, value) => {
  const option = ensureTemplateV2SchemaOption(entry)
  option[field] = String(value || '').trim() || (field === 'optionsKey' ? 'label' : 'value')
}

const getTemplateV2SchemaOptionRowField = (entry, row, field) => {
  if (!row || typeof row !== 'object')
    return ''
  const option = getTemplateV2SchemaOption(entry)
  if (field === 'label')
    return row.label ?? row[option.optionsKey] ?? row.title ?? row.name ?? ''
  return row.value ?? row[option.optionsValue] ?? row.name ?? row.id ?? row.label ?? row[option.optionsKey] ?? ''
}

const updateTemplateV2SchemaOptionRowField = (entry, index, field, value) => {
  const option = ensureTemplateV2SchemaOption(entry)
  const row = option.options[index]
  if (!row || typeof row !== 'object')
    return
  row[field] = value
  if (field === 'label' && option.optionsKey && option.optionsKey !== 'label')
    row[option.optionsKey] = value
  if (field === 'value' && option.optionsValue && option.optionsValue !== 'value')
    row[option.optionsValue] = value
  if (field === 'label' && !String(row.value || '').trim())
    row.value = slugOptionValue(value)
  if (field === 'label' && option.optionsValue && option.optionsValue !== 'value' && !String(row[option.optionsValue] || '').trim())
    row[option.optionsValue] = row.value
}

const updateTemplateV2SchemaType = (entry, value) => {
  if (!entry || typeof entry !== 'object')
    return
  const type = String(value || 'text').trim() || 'text'
  entry.type = type === 'select' ? 'option' : type
  if (entry.type === 'option')
    ensureTemplateV2SchemaOption(entry)
  else
    delete entry.option
  if (entry.type !== 'array')
    delete entry.schema
  if (entry.type !== 'publication')
    delete entry.effect
  if (!['image', 'richtext'].includes(entry.type)) {
    delete entry.tags
    delete entry.variant
  }
  if (entry.type === 'publication')
    entry.effect = normalizeTemplateV2PublicationEffect(entry.effect)
  if (state.schemaWizardDraft?.entry === entry) {
    const allowedSteps = getTemplateV2SchemaWizardSteps(entry).map(item => item.step)
    if (!allowedSteps.includes(state.schemaWizardStep))
      state.schemaWizardStep = allowedSteps[0] || 1
  }
}

const updateTemplateV2ArraySchemaType = (entry, value) => {
  if (!entry || typeof entry !== 'object')
    return
  const type = String(value || 'text').trim() || 'text'
  entry.type = type === 'select' ? 'option' : type
  if (entry.type === 'option')
    ensureTemplateV2SchemaOption(entry)
  else
    delete entry.option
  if (!['image', 'richtext'].includes(entry.type)) {
    delete entry.tags
    delete entry.variant
  }
}

const updateTemplateV2SchemaArrayField = (entry, field, value) => {
  if (!entry || typeof entry !== 'object')
    return
  const normalized = Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
  if (normalized.length)
    entry[field] = normalized
  else
    delete entry[field]
}

const updateTemplateV2SchemaVariant = (entry, value) => {
  if (!entry || typeof entry !== 'object')
    return
  const variant = String(value || 'public').trim() || 'public'
  entry.variant = variant
}

const getTemplateV2ArrayDefaultItems = (entry) => {
  if (!Array.isArray(entry?.value))
    return []
  return entry.value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
}

const getTemplateV2ArrayDefaultFieldValue = (item, field) => {
  if (!item || typeof item !== 'object')
    return ''
  return item[field] ?? ''
}

const updateTemplateV2ArrayDefaultFieldValue = (item, field, value, type = 'text') => {
  if (!item || typeof item !== 'object')
    return
  if (type === 'number') {
    const numberValue = Number(value)
    item[field] = Number.isFinite(numberValue) ? numberValue : 0
    return
  }
  item[field] = value
}

const addTemplateV2ArrayDefaultItem = (entry) => {
  if (!entry || typeof entry !== 'object')
    return
  if (!Array.isArray(entry.value))
    entry.value = []
  entry.value = entry.value.map(item => (item && typeof item === 'object' && !Array.isArray(item)) ? item : {})
  const item = {}
  getTemplateV2ArraySchemaEntries(entry).forEach((schemaItem) => {
    item[schemaItem.field] = schemaItem.entry.type === 'number' ? 0 : ''
  })
  entry.value.push(item)
  state.schemaWizardActiveDefaultItemIndex = entry.value.length - 1
}

const removeTemplateV2ArrayDefaultItem = (entry, index) => {
  if (!Array.isArray(entry?.value))
    return
  entry.value.splice(index, 1)
  if (state.schemaWizardActiveDefaultItemIndex === index)
    state.schemaWizardActiveDefaultItemIndex = -1
  else if (state.schemaWizardActiveDefaultItemIndex > index)
    state.schemaWizardActiveDefaultItemIndex -= 1
}

const getTemplateV2ArrayDefaultItemSummary = (entry, item) => {
  const filledFields = getTemplateV2ArraySchemaEntries(entry).filter((schemaItem) => {
    const value = item?.[schemaItem.field]
    if (Array.isArray(value))
      return value.length > 0
    return value !== undefined && value !== null && String(value).trim() !== ''
  })
  return filledFields.length ? `${filledFields.length} field${filledFields.length === 1 ? '' : 's'} filled` : 'Empty item'
}

const renameTemplateV2SchemaField = (workingDoc, oldField, nextValue) => {
  const nextField = sanitizeV2FieldName(nextValue)
  if (!workingDoc?.schema || !oldField || !nextField || nextField === oldField)
    return
  if (Object.prototype.hasOwnProperty.call(workingDoc.schema, nextField)) {
    notifyTemplateV2EditorError(`"${nextField}" already exists in this schema.`)
    return
  }
  workingDoc.schema[nextField] = workingDoc.schema[oldField]
  delete workingDoc.schema[oldField]
}

const removeTemplateV2SchemaField = (workingDoc, field) => {
  if (!workingDoc?.schema || !field)
    return
  delete workingDoc.schema[field]
}

const isTemplateV2JsonDefaultType = (type) => {
  return false
}

const getTemplateV2SchemaDefaultFallback = (entry) => {
  if (entry?.type === 'array')
    return []
  if (entry?.type === 'publication')
    return {}
  return ''
}

const formatTemplateV2SchemaDefault = (entry) => {
  const fallback = getTemplateV2SchemaDefaultFallback(entry)
  const hasValue = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')
  return formatJson(hasValue ? entry.value : fallback)
}

const openTemplateV2DeleteDialog = (target) => {
  state.templateDeleteTarget = target
  state.templateDeleteDialogOpen = true
}

const closeTemplateV2DeleteDialog = () => {
  state.templateDeleteDialogOpen = false
  state.templateDeleteTarget = null
}

const templateV2DeleteDialogTitle = computed(() => {
  const type = state.templateDeleteTarget?.type
  if (type === 'schema')
    return 'Delete input?'
  if (type === 'dataSource')
    return 'Delete data source?'
  if (type === 'queryItem')
    return 'Delete query item?'
  if (type === 'previewQueryItem')
    return 'Delete preview query item?'
  if (type === 'control')
    return 'Delete control?'
  return 'Delete item?'
})

const templateV2DeleteDialogDescription = computed(() => {
  const target = state.templateDeleteTarget || {}
  const label = target.label || target.field || target.sourceName || target.key || 'this item'
  if (target.type === 'schema')
    return `This removes "${label}" from the block inputs. Template markup using that field will not be changed automatically.`
  if (target.type === 'dataSource')
    return `This removes "${label}" and any template source loops that depend on it will stop rendering data.`
  if (target.type === 'control')
    return `This removes the "${label}" block-click control from this data source.`
  return `This removes "${label}" from this data source.`
})

const confirmTemplateV2Delete = () => {
  const target = state.templateDeleteTarget
  if (!target)
    return
  if (target.type === 'schema')
    removeTemplateV2SchemaField(target.workingDoc, target.field)
  else if (target.type === 'dataSource' && target.workingDoc?.dataSources && target.sourceName)
    delete target.workingDoc.dataSources[target.sourceName]
  else if (target.type === 'queryItem' && target.source?.queryItems && target.key)
    delete target.source.queryItems[target.key]
  else if (target.type === 'previewQueryItem' && target.source?.previewQueryItems && target.key)
    delete target.source.previewQueryItems[target.key]
  else if (target.type === 'control' && target.source?.controls && target.key)
    delete target.source.controls[target.key]
  closeTemplateV2DeleteDialog()
}

const updateTemplateV2JsonSubfield = (target, field, value, errorKey, fallbackValue) => {
  try {
    const parsed = value ? JSON.parse(value) : fallbackValue
    if (parsed === undefined)
      delete target[field]
    else
      target[field] = parsed
    if (state.templateJsonErrors[errorKey])
      delete state.templateJsonErrors[errorKey]
  }
  catch (error) {
    state.templateJsonErrors[errorKey] = error?.message || 'Invalid JSON.'
  }
}

function normalizeForCompare(value) {
  if (Array.isArray(value))
    return value.map(normalizeForCompare)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForCompare(value[key])
      return acc
    }, {})
  }
  return value
}

function stableSerialize(value) {
  return JSON.stringify(normalizeForCompare(value))
}

function areEqualNormalized(a, b) {
  return stableSerialize(a) === stableSerialize(b)
}

const normalizeBlockTypes = (value, { fallbackToPage = true } = {}) => {
  const hasExplicitTypeValue = !(
    value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0)
  )
  const rawTypes = Array.isArray(value) ? value : [value]
  const normalized = rawTypes
    .map((typeValue) => {
      if (typeValue && typeof typeValue === 'object') {
        const objectValue = typeValue.name ?? typeValue.value ?? typeValue.title ?? typeValue.label ?? ''
        return String(objectValue || '')
      }
      return String(typeValue || '')
    })
    .map(typeValue => typeValue.trim().toLowerCase())
    .map((typeValue) => {
      if (typeValue === 'page')
        return 'Page'
      if (typeValue === 'post')
        return 'Post'
      return ''
    })
    .filter(Boolean)
  const uniqueNormalized = [...new Set(normalized)]
  if (!uniqueNormalized.length && fallbackToPage && !hasExplicitTypeValue)
    return ['Page']
  return uniqueNormalized
}

const areTypeArraysEqual = (left, right) => {
  const a = normalizeBlockTypes(left, { fallbackToPage: false })
  const b = normalizeBlockTypes(right, { fallbackToPage: false })
  if (a.length !== b.length)
    return false
  return a.every(type => b.includes(type))
}

const selectedPreviewViewport = computed(() => previewViewportOptions.find(option => option.id === state.previewViewport) || previewViewportOptions[0])
const previewScaleValue = computed(() => {
  const parsed = Number.parseInt(String(state.previewScale || '100'), 10)
  if (!Number.isFinite(parsed) || parsed <= 0)
    return 100
  return parsed
})
const previewScaleMultiplier = computed(() => previewScaleValue.value / 100)
const previewAuthClass = computed(() => state.previewAuthLoggedIn ? 'cms-auth-preview-logged-in' : 'cms-auth-preview-logged-out')

const previewViewportStyle = computed(() => {
  const selected = selectedPreviewViewport.value
  if (!selected || selected.id === 'full')
    return { maxWidth: '100%' }
  return {
    width: '100%',
    maxWidth: selected.width,
    marginLeft: 'auto',
    marginRight: 'auto',
  }
})

const previewViewportContainStyle = computed(() => {
  return {
    ...(previewViewportStyle.value || {}),
    zoom: previewScaleMultiplier.value,
  }
})

const setPreviewViewport = (viewportId) => {
  state.previewViewport = viewportId
}

const setPreviewAuthMode = (loggedIn) => {
  state.previewAuthLoggedIn = loggedIn === true
}

const previewViewportMode = computed(() => {
  if (state.previewViewport === 'full')
    return 'auto'
  return state.previewViewport
})

const getPreviewSurfaceClass = (block) => {
  const previewType = normalizePreviewType(block?.previewType)
  return previewType === 'light'
    ? 'bg-white text-black'
    : 'bg-neutral-950 text-neutral-50'
}

const previewSurfaceClass = computed(() => getPreviewSurfaceClass(state.previewBlock))

const previewBlockTypes = computed(() => normalizeBlockTypes(state.editorWorkingDoc?.type))
const previewNeedsPostContext = computed(() => previewBlockTypes.value.includes('Post'))
const editorWorkingDocOverrides = computed(() => {
  return state.editorWorkingDoc ? edgeGlobal.dupObject(state.editorWorkingDoc) : null
})
const getSelectedPreviewSiteContext = () => {
  const siteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (!siteId)
    return null

  const siteDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[siteId]
  if (!siteDoc || typeof siteDoc !== 'object' || Array.isArray(siteDoc))
    return {
      siteId,
      docId: siteId,
      id: siteId,
    }

  return {
    ...edgeGlobal.dupObject(siteDoc),
    siteId,
    docId: siteDoc.docId || siteId,
    id: siteDoc.id || siteId,
  }
}

const loadPreviewRenderContext = async () => {
  if (!previewNeedsPostContext.value) {
    state.previewRenderContext = getSelectedPreviewSiteContext()
    return
  }

  const siteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (!siteId) {
    state.previewRenderContext = null
    return
  }

  const cacheKey = `${edgeGlobal.edgeState.currentOrganization}:${siteId}`
  const cached = blockEditorPostPreviewCache.value?.[cacheKey]
  if (cached && typeof cached === 'object') {
    state.previewRenderContext = edgeGlobal.dupObject(cached)
    return
  }

  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/sites/${siteId}/published_posts`
    await staticSearch.getData(collectionPath, [], [], 1)
    const firstPost = Object.values(staticSearch.results?.data || {})[0] || null
    if (firstPost && typeof firstPost === 'object') {
      blockEditorPostPreviewCache.value[cacheKey] = edgeGlobal.dupObject(firstPost)
      state.previewRenderContext = edgeGlobal.dupObject(firstPost)
      return
    }
  }
  catch {
    state.previewRenderContext = getSelectedPreviewSiteContext()
  }

  state.previewRenderContext = getSelectedPreviewSiteContext()
}

onMounted(() => {
  // state.mounted = true
})

const PLACEHOLDERS = {
  text: 'Lorem ipsum dolor sit amet.',
  textarea: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  richtext: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>',
  image: 'https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/f1f7f610-dfa9-4011-08a3-7a98d95e7500/thumbnail',
}

const isLegacyPlaceholderValue = (value) => {
  return value === PLACEHOLDERS.text || value === PLACEHOLDERS.textarea || value === PLACEHOLDERS.richtext
}

const contentEditorRef = ref(null)

const ignorePreviewDelete = () => {}

const BLOCK_CONTENT_SNIPPETS = [
  {
    label: 'Text Field',
    snippet: '{{{#text {"field": "fieldName", "value": "" }}}}',
    description: 'Simple text field placeholder',
  },
  {
    label: 'Text with Options',
    snippet: '{{{#text {"field":"fieldName","title":"Field Label","option":{"field":"fieldName","options":[{"title":"Option 1","name":"option1"},{"title":"Option 2","name":"option2"}],"optionsKey":"title","optionsValue":"name"},"value":"option1"}}}}',
    description: 'Text field with selectable options',
  },
  {
    label: 'Text Area',
    snippet: '{{{#textarea {"field": "fieldName", "value": "" }}}}',
    description: 'Textarea field placeholder',
  },
  {
    label: 'Rich Text',
    snippet: '{{{#richtext {"field": "content", "value": "" }}}}',
    description: 'Rich text field placeholder',
  },
  {
    label: 'Image',
    snippet: '{{{#image {"field": "imageField", "value": "",   "tags": ["Backgrounds"] }}}}',
    description: 'Image field placeholder',
  },
  {
    label: 'Publication',
    snippet: '{{{#publication {"field":"publicationPages","effect":"flip","value":{}}}}}',
    description: 'Publication picker that stores selected page image data',
  },
  {
    label: 'Array (Basic)',
    snippet: `{{{#array {"field": "items", "value": [] }}}}
  <!-- iterate with {{item}} -->
{{{/array}}}`,
    description: 'Basic repeating array block',
  },
  {
    label: 'Array (API)',
    snippet: `{{{#array {"field":"List","schema":{"listing_price":"money","square_feet":"number","acres":"number"},"api":"https://api.clearwaterproperties.com/api/front/properties","apiField":"data","apiQuery":"?limit=20&filter_scope[agent][]=mt_nmar-mt.545000478","queryOptions":[{"field":"sort","optionsKey":"label","optionsValue":"value","options":[{"label":"Highest Price","value":"listing_price"},{"label":"Lowest Price","value":"-listing_price"},{"label":"Newest","value":"-list_date"}]},{"field":"filter_scope[agent][]","title":"Agent","optionsKey":"name","optionsValue":"mls.primary","options":"users"}],"limit":10,"value":[]}}}}
  <!-- iterate with {{item}} -->
{{{/array}}}`,
    description: 'Array pulling data from an API',
  },
  {
    label: 'Array (Collection)',
    snippet: `{{{#array {"field":"list","schema":[{"field":"name","value":"text"}],"collection":{"path":"users","query":[{"field":"name","operator":">","value":""}],"order":[{"field":"name","direction":"asc"}]},"queryOptions":[{"field":"office_id","title":"Office","optionsKey":"label","optionsValue":"value","options":[{"label":"Office 1","value":"7"},{"label":"Office 2","value":"39"},{"label":"Office 3","value":"32"}]},{"field":"userId","title":"Agent","optionsKey":"name","optionsValue":"userId","options":"users"}],"limit":100,"value":[]}}}}
    <h1 class="text-4xl">
        {{item.name}}
    </h1>
{{{/array}}}`,
    description: 'Array pulling data from a collection',
  },
  {
    label: 'Subarray',
    snippet: `{{{#subarray:child {"field": "item.children", "limit": 0 }}}}
  {{child}}
{{{/subarray}}}`,
    description: 'Nested array inside an array item',
  },
  {
    label: 'Render Blocks',
    snippet: '{{{#renderBlocks {"field":"item"}}}}',
    description: 'Render block content from an object field',
  },
  {
    label: 'Post Content Example',
    snippet: `{{{#array {"field":"list","collection":{"path":"posts","uniqueKey":"{orgId}:{siteId}","order":[]},"queryOptions":[],"queryItems":{"name":"{routeLastSegment}"},"limit":1,"value":[]}}}}
  <article>
    <h2>{{item.name}}</h2>
    {{{#renderBlocks {"field":"item"}}}}
  </article>
{{{/array}}}`,
    description: 'Example loop for posts with rendered post blocks',
  },
  {
    label: 'If / Else',
    snippet: `{{{#if {"cond": "condition" }}}}
  <!-- content when condition is true -->
{{{#else}}}
  <!-- content when condition is false -->
{{{/if}}}`,
    description: 'Conditional block with optional else',
  },
]

function insertBlockContentSnippet(snippet) {
  if (!snippet)
    return
  const editor = contentEditorRef.value
  if (!editor || typeof editor.insertSnippet !== 'function') {
    edgeFirebase?.toast?.error?.('Block content editor is not ready.')
    return
  }
  editor.insertSnippet(snippet)
}

const applyTemplateInlineFormatter = (formatter) => {
  const editor = contentEditorRef.value
  if (!editor || typeof editor.applyInlineFormatter !== 'function') {
    edgeFirebase?.toast?.error?.('Template editor is not ready.')
    return
  }
  editor.applyInlineFormatter(formatter)
}

const resetV2DynamicField = () => {
  state.v2DynamicField = {
    selectedKey: '',
    useParentArrayLookup: false,
    parentArrayLookupMode: 'canonical',
    parentArrayField: '',
    indexedLookupField: '',
    canonicalLookupLimit: '0',
  }
}

const getV2DynamicContentItems = (workingDoc) => {
  const schemaItems = Object.entries(workingDoc?.schema || {})
    .map(([field, entry]) => {
      const normalizedEntry = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry : { type: entry || 'text' }
      const type = String(normalizedEntry.type || 'text').trim().toLowerCase()
      return {
        name: `schema:${field}`,
        title: `${normalizedEntry.label || titleFromKey(field)} (${field})`,
        description: 'Input',
        field,
        sourceType: 'schema',
        type,
      }
    })

  const sourceItems = Object.entries(workingDoc?.dataSources || {})
    .map(([field, source]) => ({
      name: `source:${field}`,
      title: `${titleFromKey(field)} (${field})`,
      description: `${inferTemplateV2DataSourceType(source)} data source`,
      field,
      sourceType: 'dataSource',
      type: 'array',
    }))

  return [...schemaItems, ...sourceItems]
}

const getSelectedV2DynamicContentItem = (workingDoc) => {
  const items = getV2DynamicContentItems(workingDoc)
  return items.find(item => item.name === state.v2DynamicField.selectedKey) || items[0] || null
}

const getWorkingTemplateText = (workingDoc) => {
  return String(workingDoc?.content || workingDoc?.template || '')
}

const getTemplateEditorContext = (workingDoc) => {
  const editor = contentEditorRef.value
  const template = typeof editor?.getEditorValue === 'function'
    ? String(editor.getEditorValue() || '')
    : getWorkingTemplateText(workingDoc)
  const cursorOffset = typeof editor?.getCursorOffset === 'function'
    ? editor.getCursorOffset()
    : null
  return {
    template,
    cursorOffset: Number.isFinite(cursorOffset) ? cursorOffset : template.length,
  }
}

const getActiveV2LoopAliases = (workingDoc) => {
  const { template, cursorOffset } = getTemplateEditorContext(workingDoc)
  const stack = []
  const pattern = /\{\{#for\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+in\b|\{\{\/for\}\}/g
  let match = pattern.exec(template)
  while (match && match.index < cursorOffset) {
    if (match[1])
      stack.push(match[1])
    else
      stack.pop()
    match = pattern.exec(template)
  }
  return stack
}

const getNextV2LoopAlias = (workingDoc, extraAliases = []) => {
  const aliases = getActiveV2LoopAliases(workingDoc)
  const used = new Set([...aliases, ...extraAliases])
  if (!used.has('item'))
    return 'item'

  let index = 2
  while (used.has(`item${index}`))
    index += 1
  return `item${index}`
}

const getV2ParentLoopAlias = (workingDoc) => {
  const aliases = getActiveV2LoopAliases(workingDoc)
  return aliases[aliases.length - 1] || ''
}

const isSelectedV2DynamicDataSource = (workingDoc) => {
  return getSelectedV2DynamicContentItem(workingDoc)?.sourceType === 'dataSource'
}

const isSelectedV2DynamicNestedDataSource = (workingDoc) => {
  return isSelectedV2DynamicDataSource(workingDoc) && !!getV2ParentLoopAlias(workingDoc)
}

const applyV2DynamicFieldDefaults = () => {
  state.v2DynamicField.useParentArrayLookup = false
  state.v2DynamicField.parentArrayLookupMode = 'canonical'
  state.v2DynamicField.parentArrayField = ''
  state.v2DynamicField.indexedLookupField = ''
  state.v2DynamicField.canonicalLookupLimit = '0'
}

const openV2DynamicContentDialog = (workingDoc) => {
  resetV2DynamicField()
  state.v2DynamicField.selectedKey = getV2DynamicContentItems(workingDoc)[0]?.name || ''
  applyV2DynamicFieldDefaults()
  state.v2DynamicContentDialogOpen = true
}

const handleV2DynamicFieldSelected = (value) => {
  state.v2DynamicField.selectedKey = value
  applyV2DynamicFieldDefaults()
}

const handleV2DynamicLookupModeSelected = (value) => {
  const mode = (typeof value === 'object' && value !== null) ? value.name : value
  state.v2DynamicField.parentArrayLookupMode = mode === 'queryItems' ? 'queryItems' : 'canonical'
}

const goToTemplateV2SchemaFromDynamicContent = () => {
  state.v2DynamicContentDialogOpen = false
  state.templateEditorTab = 'schema'
}

const goToTemplateV2DataSourcesFromDynamicContent = () => {
  state.v2DynamicContentDialogOpen = false
  state.templateEditorTab = 'dataSources'
  openTemplateV2DataSourceWizard()
}

const buildV2DynamicFieldToken = (fieldConfig) => {
  const field = sanitizeV2FieldName(fieldConfig.field)
  return `{{ ${field} }}`
}

const normalizeV2ParentLookupField = (workingDoc) => {
  const parentAlias = getV2ParentLoopAlias(workingDoc)
  let field = String(state.v2DynamicField.parentArrayField || '')
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/^\{parent\./, '')
    .replace(/\}$/, '')
    .replace(/^parent\./, '')
  if (parentAlias && field.startsWith(`${parentAlias}.`))
    field = field.slice(parentAlias.length + 1)
  return field
}

const normalizeV2IndexedLookupField = () => {
  return String(state.v2DynamicField.indexedLookupField || '').trim()
}

const getV2CanonicalLookupLimit = () => {
  const limit = Number(state.v2DynamicField.canonicalLookupLimit)
  if (!Number.isFinite(limit) || limit <= 0)
    return 0
  return Math.floor(limit)
}

const buildV2SourceOptionsLines = (lookupConfig, limit) => {
  const lines = [`  ${lookupConfig}`]
  if (limit > 0)
    lines.push(`  limit: ${limit}`)
  return lines.join(',\n')
}

const buildV2NestedParentLookupSnippet = (field, workingDoc) => {
  const parentAlias = getV2ParentLoopAlias(workingDoc)
  const parentLookupField = normalizeV2ParentLookupField(workingDoc)
  const parentLookupExpression = `${parentAlias}.${parentLookupField}`
  const itemAlias = getNextV2LoopAlias(workingDoc)
  const limit = getV2CanonicalLookupLimit()
  const lookupMode = state.v2DynamicField.parentArrayLookupMode === 'queryItems' ? 'queryItems' : 'canonical'
  const lookupConfig = lookupMode === 'queryItems'
    ? `queryItems: { ${JSON.stringify(normalizeV2IndexedLookupField())}: ${parentLookupExpression} }`
    : `canonicalLookup: { key: ${parentLookupExpression} }`
  return `{{#for ${itemAlias} in source("${field}", {\n${buildV2SourceOptionsLines(lookupConfig, limit)}\n})}}\n  {{ ${itemAlias}.name }}\n{{/for}}`
}

const canInsertV2DynamicContent = (workingDoc) => {
  if (!getV2DynamicContentItems(workingDoc).length)
    return false
  const selectedItem = getSelectedV2DynamicContentItem(workingDoc)
  if (!selectedItem)
    return false
  if (selectedItem.sourceType !== 'dataSource' || !state.v2DynamicField.useParentArrayLookup)
    return true
  if (!normalizeV2ParentLookupField(workingDoc))
    return false
  if (state.v2DynamicField.parentArrayLookupMode === 'queryItems' && !normalizeV2IndexedLookupField())
    return false
  return true
}

const buildV2DynamicSnippet = (fieldConfig, workingDoc) => {
  const field = sanitizeV2FieldName(fieldConfig.field)
  const alias = getNextV2LoopAlias(workingDoc)
  if (fieldConfig.sourceType === 'dataSource') {
    if (state.v2DynamicField.useParentArrayLookup && getV2ParentLoopAlias(workingDoc))
      return buildV2NestedParentLookupSnippet(field, workingDoc)
    return `{{#for ${alias} in source("${field}")}}\n  {{ ${alias}.name }}\n{{/for}}`
  }
  if (fieldConfig.type === 'publication')
    return `{{{#publication {"field":"${field}"}}}}`
  if (fieldConfig.type === 'array')
    return `{{#for ${alias} in ${field}}}\n  {{ ${alias} }}\n{{/for}}`
  return buildV2DynamicFieldToken({ ...fieldConfig, field })
}

const addV2DynamicContent = (workingDoc) => {
  if (!workingDoc)
    return

  const selectedItem = getSelectedV2DynamicContentItem(workingDoc)
  if (!selectedItem) {
    edgeFirebase?.toast?.error?.('Add an input or data source first.')
    return
  }
  if (selectedItem.sourceType === 'dataSource' && state.v2DynamicField.useParentArrayLookup && !normalizeV2ParentLookupField(workingDoc)) {
    edgeFirebase?.toast?.error?.('Enter the parent lookup field.')
    return
  }
  if (selectedItem.sourceType === 'dataSource' && state.v2DynamicField.useParentArrayLookup && state.v2DynamicField.parentArrayLookupMode === 'queryItems' && !normalizeV2IndexedLookupField()) {
    edgeFirebase?.toast?.error?.('Enter the indexed field.')
    return
  }

  const snippet = buildV2DynamicSnippet(selectedItem, workingDoc)
  state.templateEditorTab = 'template'
  state.v2DynamicContentDialogOpen = false
  nextTick(() => {
    const editor = contentEditorRef.value
    if (editor && typeof editor.insertSnippet === 'function') {
      editor.insertSnippet(snippet)
      return
    }
    const currentContent = String(workingDoc.content || workingDoc.template || '')
    const nextContent = currentContent
      ? `${currentContent}\n${snippet}`
      : snippet
    syncWorkingTemplateContent(workingDoc, nextContent)
    Object.assign(state.workingDoc, {
      content: nextContent,
      template: nextContent,
    })
  })
  resetV2DynamicField()
}

const updateWorkingPreviewType = (nextValue) => {
  const normalized = normalizePreviewType(nextValue)
  if (state.editorWorkingDoc)
    state.editorWorkingDoc.previewType = normalized
  if (state.previewBlock)
    state.previewBlock.previewType = normalized
}

function normalizeConfigLiteral(str) {
  // ensure keys are quoted: { title: "x", field: "y" } -> { "title": "x", "field": "y" }
  return str
    .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    // allow single quotes too
    .replace(/'/g, '"')
}

function safeParseConfig(raw) {
  try {
    return JSON.parse(raw)
  }
  catch {
    // Fall back to legacy loose config support below.
  }

  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}

// --- Robust tag parsing: supports nested objects/arrays in the config ---
// Matches `{{{#<type> { ... }}}}` and extracts a *balanced* `{ ... }` blob.
const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g

function findMatchingBrace(str, startIdx) {
  // startIdx points at the opening '{' of the config
  let depth = 0
  let inString = false
  let quote = null
  let escape = false
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) {
        inString = false
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === '\'') {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{')
      depth++
    else if (ch === '}') {
      depth--
      if (depth === 0)
        return i
    }
  }
  return -1
}

function* iterateTags(html) {
  TAG_START_RE.lastIndex = 0
  for (;;) {
    const m = TAG_START_RE.exec(html)
    if (!m)
      break

    const type = m[1]
    const configStart = TAG_START_RE.lastIndex - 1
    if (configStart < 0 || html[configStart] !== '{')
      continue

    const configEnd = findMatchingBrace(html, configStart)
    if (configEnd === -1)
      continue

    const rawCfg = html.slice(configStart, configEnd + 1)
    const tagStart = m.index
    const closeTriple = html.indexOf('}}}', configEnd + 1)
    const tagEnd = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1

    yield { type, rawCfg, tagStart, tagEnd, configStart, configEnd }

    TAG_START_RE.lastIndex = tagEnd
  }
}

function findTagAtOffset(html, offset) {
  for (const tag of iterateTags(html)) {
    if (offset >= tag.tagStart && offset <= tag.tagEnd)
      return tag
  }
  return null
}

const blockModel = (html) => {
  const values = {}
  const meta = {}

  if (!html)
    return { values, meta }

  for (const { type, rawCfg } of iterateTags(html)) {
    const cfg = safeParseConfig(rawCfg)
    if (!cfg || !cfg.field)
      continue

    const field = String(cfg.field)
    const title = cfg.title != null ? String(cfg.title) : ''

    const { value: _omitValue, field: _omitField, ...rest } = cfg
    meta[field] = { type, ...rest, title }

    let val = cfg.value

    if (type === 'image') {
      val = !val ? PLACEHOLDERS.image : String(val)
    }
    else if (type === 'publication') {
      val = (val && typeof val === 'object') ? JSON.parse(JSON.stringify(val)) : String(val || '')
    }
    else if (type === 'text') {
      val = !val ? PLACEHOLDERS.text : String(val)
    }
    else if (type === 'array') {
      // Keep array fields empty by default instead of injecting placeholder items.
      val = Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : []
    }
    else if (type === 'textarea') {
      val = !val ? PLACEHOLDERS.textarea : String(val)
    }
    else if (type === 'richtext') {
      val = !val ? PLACEHOLDERS.richtext : String(val)
    }

    values[field] = val
  }
  return { values, meta }
}

function resetJsonEditorState() {
  state.jsonEditorContent = ''
  state.jsonEditorError = ''
  state.editingContext = null
}

function closeJsonEditor() {
  state.jsonEditorOpen = false
  resetJsonEditorState()
}

function handleEditorLineClick(payload, workingDoc) {
  if (!workingDoc || !workingDoc.content)
    return

  const offset = typeof payload?.offset === 'number' ? payload.offset : null
  if (offset == null)
    return

  const tag = findTagAtOffset(workingDoc.content, offset)
  if (!tag)
    return
  if (tag.type === 'if')
    return

  const parsedCfg = safeParseConfig(tag.rawCfg)
  state.jsonEditorError = ''
  state.jsonEditorContent = parsedCfg ? JSON.stringify(parsedCfg, null, 2) : tag.rawCfg
  state.jsonEditorOpen = true
  state.editingContext = {
    type: tag.type,
    field: parsedCfg?.field != null ? String(parsedCfg.field) : null,
    workingDoc,
    tagStart: tag.tagStart,
    tagEnd: tag.tagEnd,
    configStart: tag.configStart,
    configEnd: tag.configEnd,
    originalRawCfg: tag.rawCfg,
    originalTag: workingDoc.content.slice(tag.tagStart, tag.tagEnd),
    configStartOffset: tag.configStart - tag.tagStart,
    configEndOffset: tag.configEnd - tag.tagStart,
  }
}

function handleJsonEditorSave() {
  if (!state.editingContext)
    return

  let parsed
  try {
    parsed = JSON.parse(state.jsonEditorContent)
  }
  catch (error) {
    state.jsonEditorError = `Unable to parse JSON: ${error.message}`
    return
  }

  const serialized = JSON.stringify(parsed)
  const { workingDoc, type, field, originalTag, originalRawCfg, configStartOffset, configEndOffset } = state.editingContext
  const content = workingDoc?.content ?? ''
  if (!content) {
    state.jsonEditorError = 'Block content is empty.'
    return
  }

  let target = null
  const exactConfigStart = state.editingContext.configStart
  const exactConfigEnd = state.editingContext.configEnd
  if (
    typeof exactConfigStart === 'number'
    && typeof exactConfigEnd === 'number'
    && exactConfigStart >= 0
    && exactConfigEnd >= exactConfigStart
    && content.slice(exactConfigStart, exactConfigEnd + 1) === originalRawCfg
  ) {
    target = {
      configStart: exactConfigStart,
      configEnd: exactConfigEnd,
    }
  }

  if (!target && originalTag) {
    const idx = content.indexOf(originalTag)
    if (idx !== -1) {
      const startOffset = typeof configStartOffset === 'number' ? configStartOffset : originalTag.indexOf('{')
      const endOffset = typeof configEndOffset === 'number' ? configEndOffset : originalTag.lastIndexOf('}')
      if (startOffset != null && endOffset != null && startOffset >= 0 && endOffset >= startOffset) {
        target = {
          configStart: idx + startOffset,
          configEnd: idx + endOffset,
        }
      }
    }
  }

  for (const tag of iterateTags(content)) {
    if (target)
      break
    if (tag.type !== type)
      continue
    if (!field) {
      target = tag
      break
    }
    const cfg = safeParseConfig(tag.rawCfg)
    if (cfg && String(cfg.field) === field) {
      target = tag
      break
    }
  }

  if (!target) {
    state.jsonEditorError = 'Unable to locate the original block field in the current content.'
    return
  }

  const prefix = content.slice(0, target.configStart)
  const suffix = content.slice(target.configEnd + 1)
  workingDoc.content = `${prefix}${serialized}${suffix}`

  closeJsonEditor()
}

const buildPreviewBlock = (workingDoc, parsed) => {
  const content = workingDoc?.content || ''
  const clonePreviewValue = (value) => {
    if (Array.isArray(value) || (value && typeof value === 'object'))
      return edgeGlobal.dupObject(value)
    return value
  }
  const valuesMatch = (a, b) => {
    if (a === b)
      return true
    if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
      try {
        return JSON.stringify(a) === JSON.stringify(b)
      }
      catch {
        return false
      }
    }
    return false
  }
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)
  const isSameBlockContext = state.previewBlock?.blockId === props.blockId
  const nextValues = {}
  const previousValues = isSameBlockContext ? (state.previewBlock?.values || {}) : {}
  const previousSourceValues = isSameBlockContext ? (state.previewSourceValues || {}) : {}
  Object.keys(parsed.values || {}).forEach((field) => {
    const hasPreviousValue = hasOwn(previousValues, field)
    const hadSourceValue = hasOwn(previousSourceValues, field)
    if (!hasPreviousValue) {
      nextValues[field] = clonePreviewValue(parsed.values[field])
      return
    }

    const previousValue = previousValues[field]
    const previousSourceValue = previousSourceValues[field]
    const followsSource = hadSourceValue && valuesMatch(previousValue, previousSourceValue)
    if (followsSource)
      nextValues[field] = clonePreviewValue(parsed.values[field])
    else
      nextValues[field] = clonePreviewValue(previousValues[field])
  })

  const templateV2PreviewValues = isSameBlockContext
    ? edgeGlobal.dupObject(previousValues || {})
    : {}

  const previousMeta = state.previewBlock?.meta || {}
  const nextMeta = {}
  Object.keys(parsed.meta || {}).forEach((field) => {
    if (previousMeta[field]) {
      nextMeta[field] = {
        ...clonePreviewValue(previousMeta[field]),
        ...clonePreviewValue(parsed.meta[field]),
      }
    }
    else {
      nextMeta[field] = clonePreviewValue(parsed.meta[field])
    }
  })

  return {
    id: 'preview',
    blockId: props.blockId,
    name: workingDoc?.name || state.previewBlock?.name || '',
    previewType: normalizePreviewType(workingDoc?.previewType),
    content,
    templateVersion: getWorkingTemplateVersion(workingDoc),
    template: workingDoc?.template || '',
    schema: edgeGlobal.dupObject(workingDoc?.schema || {}),
    dataSources: edgeGlobal.dupObject(workingDoc?.dataSources || {}),
    values: isWorkingTemplateV2Doc(workingDoc) ? templateV2PreviewValues : nextValues,
    meta: nextMeta,
    synced: !!workingDoc?.synced,
  }
}

function syncWorkingTemplateContent(workingDoc, value) {
  if (!workingDoc)
    return
  workingDoc.content = value
  if (isWorkingTemplateV2Doc(workingDoc))
    workingDoc.template = value

  const parsed = blockModel(value || '')
  state.previewBlock = buildPreviewBlock(workingDoc, parsed)
  state.previewSourceValues = edgeGlobal.dupObject(isWorkingTemplateV2Doc(workingDoc) ? {} : (parsed.values || {}))
}

const theme = computed(() => {
  const selectedThemeId = String(edgeGlobal.edgeState.blockEditorTheme || '').trim()
  if (!selectedThemeId)
    return null
  const themeDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[selectedThemeId] || null
  const themeContents = themeDoc?.theme || null
  if (!themeContents)
    return null
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  if (typeof themeContents === 'object' && !Array.isArray(themeContents))
    return { ...themeContents, extraCSS }
  try {
    const parsedTheme = JSON.parse(themeContents)
    if (!parsedTheme || typeof parsedTheme !== 'object' || Array.isArray(parsedTheme))
      return null
    return { ...parsedTheme, extraCSS }
  }
  catch {
    return null
  }
})

const previewThemeRenderKey = computed(() => {
  const themeId = String(edgeGlobal.edgeState.blockEditorTheme || 'no-theme')
  const siteId = String(edgeGlobal.edgeState.blockEditorSite || 'no-site')
  const previewType = normalizePreviewType(state.previewBlock?.previewType)
  return `${themeId}:${siteId}:${state.previewViewport}:${previewType}`
})

const headObject = computed(() => {
  const theme = edgeGlobal.edgeState.blockEditorTheme || ''
  try {
    return JSON.parse(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.headJSON || '{}')
  }
  catch (e) {
    return {}
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const editorDocUpdates = (workingDoc) => {
  if (workingDoc && props.blockId === 'new' && workingDoc.templateVersion === undefined)
    workingDoc.templateVersion = 2
  if (
    shouldAutoConvertTemplateV2Doc(workingDoc)
  ) {
    convertWorkingDocToTemplateV2(workingDoc, { notify: false })
  }
  ensureTemplateV2Fields(workingDoc)
  let normalizedTypes = normalizeBlockTypes(workingDoc?.type)
  if (!normalizedTypes.length)
    normalizedTypes = ['Page']
  if (workingDoc && !areTypeArraysEqual(workingDoc.type, normalizedTypes))
    workingDoc.type = normalizedTypes
  state.editorWorkingDoc = workingDoc || null
  const parsed = blockModel(workingDoc?.content || '')
  state.workingDoc = {
    ...parsed,
    type: normalizedTypes,
    templateVersion: workingDoc?.templateVersion,
    template: workingDoc?.template,
    schema: workingDoc?.schema,
    dataSources: workingDoc?.dataSources,
    values: isWorkingTemplateV2Doc(workingDoc) ? undefined : parsed.values,
  }
  state.previewBlock = buildPreviewBlock(workingDoc, parsed)
  state.previewSourceValues = edgeGlobal.dupObject(isWorkingTemplateV2Doc(workingDoc) ? {} : (parsed.values || {}))
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const syncEditorStateFromBlockDoc = (doc) => {
  if (!isPlainObject(doc))
    return

  const restoredDoc = edgeGlobal.dupObject(doc)
  if (shouldAutoConvertTemplateV2Doc(restoredDoc)) {
    const converted = convertLegacyBlockToTemplateV2(restoredDoc)
    restoredDoc.templateVersion = 2
    restoredDoc.template = converted.template
    restoredDoc.content = converted.template
    restoredDoc.schema = converted.schema
    restoredDoc.dataSources = converted.dataSources
    restoredDoc.values = undefined
    restoredDoc.templateConversion = converted.conversion
  }
  let normalizedTypes = normalizeBlockTypes(restoredDoc.type)
  if (!normalizedTypes.length)
    normalizedTypes = ['Page']
  restoredDoc.type = normalizedTypes
  ensureTemplateV2Fields(restoredDoc)
  if (!restoredDoc.docId)
    restoredDoc.docId = props.blockId

  state.editorWorkingDoc = restoredDoc
  const parsed = blockModel(restoredDoc.content || '')
  state.workingDoc = {
    ...parsed,
    type: normalizedTypes,
    templateVersion: restoredDoc.templateVersion,
    template: restoredDoc.template,
    schema: restoredDoc.schema,
    dataSources: restoredDoc.dataSources,
    values: isWorkingTemplateV2Doc(restoredDoc) ? undefined : parsed.values,
  }
  state.previewBlock = buildPreviewBlock(restoredDoc, parsed)
  state.previewSourceValues = edgeGlobal.dupObject(isWorkingTemplateV2Doc(restoredDoc) ? {} : (parsed.values || {}))
  state.editorHasUnsavedChanges = false

  const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/blocks`
  if (!edgeFirebase.data?.[collectionPath])
    edgeFirebase.data[collectionPath] = {}
  edgeFirebase.data[collectionPath][props.blockId] = edgeGlobal.dupObject(restoredDoc)
}

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`)
  }
  state.mounted = true
})

const themes = computed(() => {
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {})
})

const availableThemeIds = computed(() => {
  return themes.value
    .map(themeDoc => String(themeDoc?.docId || '').trim())
    .filter(Boolean)
})

const currentBlockAllowedThemeIds = computed(() => {
  const currentBlockDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[props.blockId]
  if (!Array.isArray(currentBlockDoc?.themes))
    return []
  return currentBlockDoc.themes.map(themeId => String(themeId || '').trim()).filter(Boolean)
})

const preferredThemeDefaultForBlock = computed(() => {
  const firstAllowedAvailable = currentBlockAllowedThemeIds.value.find(themeId => availableThemeIds.value.includes(themeId))
  if (firstAllowedAvailable)
    return firstAllowedAvailable
  return availableThemeIds.value[0] || ''
})

const applyThemeDefaultForBlock = () => {
  const blockId = String(props.blockId || '').trim()
  if (!blockId)
    return
  if (state.themeDefaultAppliedForBlockId === blockId)
    return

  const preferredThemeId = preferredThemeDefaultForBlock.value
  if (!preferredThemeId) {
    if (!availableThemeIds.value.length)
      edgeGlobal.edgeState.blockEditorTheme = ''
    return
  }

  edgeGlobal.edgeState.blockEditorTheme = preferredThemeId
  state.themeDefaultAppliedForBlockId = blockId
}

watch(() => props.blockId, () => {
  state.themeDefaultAppliedForBlockId = ''
}, { immediate: true })

watch([availableThemeIds, currentBlockAllowedThemeIds, () => props.blockId], async () => {
  state.loading = true
  applyThemeDefaultForBlock()
  await nextTick()
  state.loading = false
}, { immediate: true, deep: true })

watch(
  [previewNeedsPostContext, () => edgeGlobal.edgeState.blockEditorSite, () => edgeGlobal.edgeState.currentOrganization],
  async () => {
    await loadPreviewRenderContext()
  },
  { immediate: true },
)

watch(() => state.jsonEditorOpen, (open) => {
  if (!open)
    resetJsonEditorState()
})
const sites = computed(() => {
  const sitesMap = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {}
  return Object.entries(sitesMap)
    .map(([docId, data]) => ({ docId, ...(data || {}) }))
    .filter(site => site.docId && site.docId !== 'templates')
})

const previewAuthToggleVisible = computed(() => {
  const siteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (!siteId)
    return false
  const siteDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[siteId] || {}
  return Boolean(siteDoc?.restrictedContent?.enabled)
})

watch (sites, async (newSites) => {
  state.loading = true
  const selectedSite = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  const hasSelectedSite = newSites.some(site => site.docId === selectedSite)
  if ((!selectedSite || !hasSelectedSite) && newSites.length > 0)
    edgeGlobal.edgeState.blockEditorSite = newSites[0].docId
  else if (!newSites.length)
    edgeGlobal.edgeState.blockEditorSite = ''
  await loadPreviewRenderContext()
  await nextTick()
  state.loading = false
}, { immediate: true, deep: true })

const currentBlockPath = computed(() => {
  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  const blockId = String(props.blockId || '').trim()
  if (!orgPath || !blockId || blockId === 'new')
    return ''
  return `${orgPath}/blocks/${blockId}`
})

const getTagsFromBlocks = computed(() => {
  const tagsSet = new Set()

  Object.values(blocks.value || {}).forEach((block) => {
    if (block.tags && Array.isArray(block.tags)) {
      block.tags.forEach(tag => tagsSet.add(tag))
    }
  })

  // Convert to array of objects
  const tagsArray = Array.from(tagsSet).map(tag => ({ name: tag, title: tag }))

  // Sort alphabetically
  tagsArray.sort((a, b) => a.title.localeCompare(b.title))

  // Remove "Quick Picks" if it exists
  const filtered = tagsArray.filter(tag => tag.name !== 'Quick Picks')

  // Always prepend it
  return [{ name: 'Quick Picks', title: 'Quick Picks' }, ...filtered]
})

const cloneSchemaValue = (value) => {
  if (isPlainObject(value) || Array.isArray(value))
    return edgeGlobal.dupObject(value)
  return value
}

const getDocDefaultsFromSchema = (schema = {}) => {
  const defaults = {}
  for (const [key, schemaEntry] of Object.entries(schema || {})) {
    const hasValueProp = isPlainObject(schemaEntry) && Object.prototype.hasOwnProperty.call(schemaEntry, 'value')
    const baseValue = hasValueProp ? schemaEntry.value : schemaEntry
    defaults[key] = cloneSchemaValue(baseValue)
  }
  return defaults
}

const getBlockDocDefaults = () => getDocDefaultsFromSchema(blockNewDocSchema.value || {})

const notifySuccess = (message) => {
  edgeFirebase?.toast?.success?.(message)
}

const notifyError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

function convertWorkingDocToTemplateV2(workingDoc, options = {}) {
  if (!workingDoc)
    return

  const parsed = blockModel(workingDoc.content || '')
  const existingValues = {
    ...(parsed.values || {}),
    ...(state.previewBlock?.values || {}),
    ...(workingDoc.values || {}),
  }
  const converted = convertLegacyBlockToTemplateV2({
    ...workingDoc,
    values: Object.entries(existingValues).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null && !isLegacyPlaceholderValue(value))
        acc[key] = value
      return acc
    }, {}),
  })
  workingDoc.templateVersion = 2
  workingDoc.template = converted.template
  workingDoc.content = converted.template
  workingDoc.schema = converted.schema
  workingDoc.dataSources = converted.dataSources
  workingDoc.values = undefined
  workingDoc.templateConversion = converted.conversion
  ensureTemplateV2Fields(workingDoc)
  Object.assign(state.workingDoc, {
    templateVersion: 2,
    template: converted.template,
    content: converted.template,
    schema: converted.schema,
    dataSources: converted.dataSources,
    values: undefined,
  })
  state.previewBlock = buildPreviewBlock(workingDoc, parsed)
  if (state.previewBlock)
    state.previewBlock.values = {}
  state.previewSourceValues = {}
  state.templateEditorTab = 'template'

  const warningCount = converted.conversion?.warnings?.length || 0
  if (warningCount)
    notifyError(`Converted to Template v2 with ${warningCount} item${warningCount === 1 ? '' : 's'} to review.`)
  else if (options.notify !== false)
    notifySuccess('Converted to Template v2 draft.')
}

const getHistoryTimestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value?.millis === 'number' && Number.isFinite(value.millis))
    return value.millis
  const isoValue = String(value?.iso || value || '').trim()
  if (!isoValue)
    return null
  const parsed = Date.parse(isoValue)
  return Number.isFinite(parsed) ? parsed : null
}

const formatHistoryDate = (value) => {
  const millis = getHistoryTimestampMs(value)
  if (!millis)
    return 'Unknown date'
  return new Date(millis).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatHistoryEntryLabel(item, index = 0) {
  const dateLabel = formatHistoryDate(item?.createdAt)
  const fallbackLabel = `Entry ${index + 1}`
  if (dateLabel)
    return dateLabel
  return fallbackLabel
}

const getHistorySnapshotState = (item) => {
  if (isPlainObject(item?.afterData))
    return 'afterData'
  if (isPlainObject(item?.beforeData))
    return 'beforeData'
  return ''
}

const getHistorySnapshotDoc = item => item?.[getHistorySnapshotState(item)] || null

const buildComparableBlockDiffDoc = (doc) => {
  if (!doc || typeof doc !== 'object')
    return null
  return {
    name: doc.name ?? '',
    content: doc.content ?? '',
    templateVersion: doc.templateVersion ?? 1,
    template: doc.template ?? '',
    schema: doc.schema ?? {},
    dataSources: doc.dataSources ?? {},
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    type: normalizeBlockTypes(doc.type, { fallbackToPage: false }),
    themes: Array.isArray(doc.themes) ? doc.themes : [],
    synced: !!doc.synced,
    previewType: normalizePreviewType(doc.previewType),
  }
}

const blockDocsMatchForDiff = (baseDoc, compareDoc) => {
  return areTypeArraysEqual(baseDoc?.type, compareDoc?.type) && areEqualNormalized(
    buildComparableBlockDiffDoc(baseDoc),
    buildComparableBlockDiffDoc(compareDoc),
  )
}

const buildHistoryPreviewBlock = (doc) => {
  if (!isPlainObject(doc))
    return null
  const parsed = blockModel(doc.content || '')
  return {
    id: 'history-preview',
    blockId: props.blockId,
    name: doc.name || '',
    previewType: normalizePreviewType(doc.previewType),
    content: doc.content || '',
    templateVersion: getWorkingTemplateVersion(doc),
    template: doc.template || '',
    schema: edgeGlobal.dupObject(doc.schema || {}),
    dataSources: edgeGlobal.dupObject(doc.dataSources || {}),
    values: isWorkingTemplateV2Doc(doc) ? edgeGlobal.dupObject(doc.values || {}) : edgeGlobal.dupObject(parsed.values || {}),
    meta: edgeGlobal.dupObject(parsed.meta || {}),
    synced: !!doc.synced,
  }
}

const isHistoryItemArray = (value) => {
  if (!Array.isArray(value) || !value.length)
    return false
  return value.every((item) => {
    return item && typeof item === 'object' && (
      typeof item.historyId === 'string'
      || typeof item.path === 'string'
      || typeof item.relativePath === 'string'
    )
  })
}

const extractHistoryItemsFromResponse = (value, visited = new Set()) => {
  if (!value || typeof value !== 'object')
    return []
  if (visited.has(value))
    return []
  visited.add(value)

  if (isHistoryItemArray(value))
    return value

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nestedItems = extractHistoryItemsFromResponse(entry, visited)
      if (nestedItems.length)
        return nestedItems
    }
    return []
  }

  const priorityKeys = ['items', 'data', 'result']
  for (const key of priorityKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      continue
    const nestedItems = extractHistoryItemsFromResponse(value[key], visited)
    if (nestedItems.length)
      return nestedItems
  }

  for (const nestedValue of Object.values(value)) {
    const nestedItems = extractHistoryItemsFromResponse(nestedValue, visited)
    if (nestedItems.length)
      return nestedItems
  }

  return []
}

const historyPreviewItems = computed(() => {
  return (state.historyItems || []).filter((item) => {
    const historyDoc = getHistorySnapshotDoc(item)
    if (!historyDoc)
      return false
    return !blockDocsMatchForDiff(historyDoc, currentBlock.value)
  })
})

const selectedHistoryEntry = computed(() => {
  return historyPreviewItems.value.find(item => item.historyId === state.historySelectedId) || null
})

const historyVersionItems = computed(() => {
  return historyPreviewItems.value.map((item, index) => ({
    name: item.historyId,
    title: formatHistoryEntryLabel(item, index),
  }))
})

const syncHistoryPreviewBlock = (entry) => {
  state.historyPreviewBlock = buildHistoryPreviewBlock(getHistorySnapshotDoc(entry))
}

watch(selectedHistoryEntry, (entry) => {
  syncHistoryPreviewBlock(entry)
}, { immediate: false })

const summarizeBlockChangeValue = (value) => {
  if (value == null || value === '')
    return '—'
  if (typeof value === 'boolean')
    return value ? 'Yes' : 'No'
  if (Array.isArray(value))
    return value.length ? value.map(item => String(item || '').trim()).filter(Boolean).join(', ') : '—'
  if (typeof value === 'object') {
    try {
      const stringValue = JSON.stringify(value, null, 2)
      return stringValue.length > 600 ? `${stringValue.slice(0, 600)}...` : stringValue
    }
    catch {
      return '—'
    }
  }
  const stringValue = String(value).trim()
  return stringValue.length > 600 ? `${stringValue.slice(0, 600)}...` : stringValue
}

const escapeDiffHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const tokenizeDiffValue = (value) => {
  return String(value ?? '').match(/([A-Za-z0-9._:-]+|\s+|.)/g) || []
}

const buildHighlightedDiffHtml = (sourceValue, compareValue) => {
  const sourceTokens = tokenizeDiffValue(sourceValue)
  const compareTokens = tokenizeDiffValue(compareValue)
  const sourceCount = sourceTokens.length
  const compareCount = compareTokens.length

  if (!sourceCount)
    return ''

  if ((sourceCount * compareCount) > 120000) {
    const escaped = escapeDiffHtml(sourceValue)
    return escaped
      ? `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${escaped}</span>`
      : '—'
  }

  const lcs = Array.from({ length: sourceCount + 1 }, () => Array(compareCount + 1).fill(0))

  for (let i = sourceCount - 1; i >= 0; i--) {
    for (let j = compareCount - 1; j >= 0; j--) {
      if (sourceTokens[i] === compareTokens[j])
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      else
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const changedIndexes = new Set()
  let i = 0
  let j = 0

  while (i < sourceCount && j < compareCount) {
    if (sourceTokens[i] === compareTokens[j]) {
      i++
      j++
      continue
    }

    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changedIndexes.add(i)
      i++
      continue
    }

    j++
  }

  while (i < sourceCount) {
    changedIndexes.add(i)
    i++
  }

  let html = ''
  let pendingChanged = ''

  const flushPendingChanged = () => {
    if (!pendingChanged)
      return
    html += `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${pendingChanged}</span>`
    pendingChanged = ''
  }

  sourceTokens.forEach((token, index) => {
    const escapedToken = escapeDiffHtml(token)
    if (changedIndexes.has(index)) {
      pendingChanged += escapedToken
      return
    }
    flushPendingChanged()
    html += escapedToken
  })

  flushPendingChanged()
  return html || '—'
}

const buildBlockChangeDetails = (baseDoc, compareDoc, { baseLabel, compareLabel } = {}) => {
  const changes = []
  const base = baseDoc || {}
  const compare = compareDoc || {}
  const fields = [
    { key: 'name', label: 'Block Name' },
    { key: 'tags', label: 'Tags' },
    { key: 'type', label: 'Block Type', transform: value => normalizeBlockTypes(value, { fallbackToPage: false }) },
    { key: 'themes', label: 'Allowed Themes' },
    { key: 'synced', label: 'Synced Block' },
    { key: 'previewType', label: 'Preview Surface', transform: value => normalizePreviewType(value) },
    { key: 'templateVersion', label: 'Template Version', transform: value => normalizeTemplateVersion(value) },
    { key: 'content', label: 'Block Content' },
    { key: 'template', label: 'Template v2 Markup' },
    { key: 'schema', label: 'Template v2 Inputs' },
    { key: 'dataSources', label: 'Template v2 Data Sources' },
  ]

  fields.forEach((field) => {
    const baseValue = field.transform ? field.transform(base?.[field.key]) : base?.[field.key]
    const compareValue = field.transform ? field.transform(compare?.[field.key]) : compare?.[field.key]
    if (areEqualNormalized(baseValue, compareValue))
      return
    changes.push({
      key: field.key,
      label: field.label,
      baseLabel,
      compareLabel,
      base: summarizeBlockChangeValue(baseValue),
      compare: summarizeBlockChangeValue(compareValue),
      baseHtml: buildHighlightedDiffHtml(baseValue, compareValue),
      compareHtml: buildHighlightedDiffHtml(compareValue, baseValue),
    })
  })

  return changes
}

const historyDiffDetails = computed(() => {
  return buildBlockChangeDetails(getHistorySnapshotDoc(selectedHistoryEntry.value), currentBlock.value, {
    baseLabel: 'Selected History',
    compareLabel: 'Current',
  })
})

const historyDiffBasePreviewBlock = computed(() => {
  return buildHistoryPreviewBlock(getHistorySnapshotDoc(selectedHistoryEntry.value))
})

const historyDiffComparePreviewBlock = computed(() => {
  return buildHistoryPreviewBlock(currentBlock.value)
})

const historyDiffCountLabel = computed(() => {
  if (!selectedHistoryEntry.value)
    return 'Select an entry'
  const count = historyDiffDetails.value.length
  if (count === 0)
    return 'No differences'
  if (count === 1)
    return '1 difference'
  return `${count} differences`
})

const hasHistoryDiff = computed(() => historyDiffDetails.value.length > 0)

watch(hasHistoryDiff, (nextValue) => {
  if (!nextValue)
    state.showHistoryDiffDialog = false
})

const loadBlockHistory = async () => {
  if (!edgeFirebase?.user?.uid || !currentBlockPath.value)
    return

  state.historyLoading = true
  state.historyError = ''
  try {
    const response = await edgeFirebase.runFunction('history-listHistory', {
      uid: edgeFirebase.user.uid,
      path: currentBlockPath.value,
      limit: 50,
    })

    state.historyItems = extractHistoryItemsFromResponse(response)
    const nextSelectedId = historyPreviewItems.value.find(item => item.historyId === state.historySelectedId)?.historyId
      || historyPreviewItems.value[0]?.historyId
      || ''
    state.historySelectedId = nextSelectedId
    syncHistoryPreviewBlock(selectedHistoryEntry.value)
  }
  catch {
    state.historyItems = []
    state.historySelectedId = ''
    state.historyPreviewBlock = null
    state.historyError = 'Failed to load block history.'
  }
  finally {
    state.historyLoading = false
  }
}

const openHistoryDialog = async () => {
  if (!currentBlock.value || !currentBlockPath.value || !edgeFirebase?.user?.uid)
    return
  state.historySelectedId = ''
  state.historyDialogOpen = true
  await loadBlockHistory()
}

const closeHistoryDialog = () => {
  if (state.historyRestoring)
    return
  state.showHistoryDiffDialog = false
  state.historyDialogOpen = false
}

const restoreHistoryVersion = async () => {
  const historyEntry = selectedHistoryEntry.value
  if (!historyEntry?.historyId || !edgeFirebase?.user?.uid)
    return

  state.historyRestoring = true
  state.historyError = ''
  try {
    const targetState = getHistorySnapshotState(historyEntry)
    await edgeFirebase.runFunction('history-restoreHistory', {
      uid: edgeFirebase.user.uid,
      historyId: historyEntry.historyId,
      targetState,
    })
    syncEditorStateFromBlockDoc(getHistorySnapshotDoc(historyEntry))
    state.showHistoryDiffDialog = false
    state.historyDialogOpen = false
    state.editorKey += 1
    notifySuccess(`Restored block from ${formatHistoryEntryLabel(historyEntry)}.`)
  }
  catch {
    state.historyError = 'Failed to restore this version.'
    notifyError('Failed to restore block history.')
  }
  finally {
    state.historyRestoring = false
  }
}

const handleUnsavedChanges = (changes) => {
  state.editorHasUnsavedChanges = changes === true
}

const clearTemplateConversionAfterSave = async (payload) => {
  const savedDoc = payload?.data
  const docId = String(payload?.docId || savedDoc?.docId || '').trim()
  if (!docId || !savedDoc?.templateConversion)
    return

  const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/blocks`
  const currentStoredDoc = edgeFirebase.data?.[collectionPath]?.[docId] || {}
  const cleanedDoc = edgeGlobal.dupObject({
    ...currentStoredDoc,
    ...(savedDoc || {}),
    ...(state.workingDoc || {}),
    ...(state.editorWorkingDoc || {}),
  })
  delete cleanedDoc.templateConversion
  cleanedDoc.docId = docId

  try {
    await edgeFirebase.storeDoc(collectionPath, cleanedDoc)
    if (state.editorWorkingDoc?.docId === docId) {
      Object.assign(state.editorWorkingDoc, edgeGlobal.dupObject(cleanedDoc))
      delete state.editorWorkingDoc.templateConversion
    }
    if (state.workingDoc?.docId === docId) {
      Object.assign(state.workingDoc, edgeGlobal.dupObject(cleanedDoc))
      delete state.workingDoc.templateConversion
    }
    if (state.previewBlock?.blockId === docId || state.previewBlock?.id === docId)
      delete state.previewBlock.templateConversion
    if (edgeFirebase.data?.[collectionPath]?.[docId])
      edgeFirebase.data[collectionPath][docId] = edgeGlobal.dupObject(cleanedDoc)
  }
  catch {
    notifyError('Saved block, but could not clear conversion notes.')
  }
}

const exportCurrentBlock = async () => {
  const doc = blocks.value?.[props.blockId]
  if (!doc || !doc.docId) {
    notifyError('Save this block before exporting.')
    return
  }
  const exportPayload = { ...getBlockDocDefaults(), ...doc }
  const saved = await saveJsonFile(exportPayload, `block-${doc.docId}.json`)
  if (saved)
    notifySuccess(`Exported block "${doc.docId}".`)
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-editor
      :key="state.editorKey"
      collection="blocks"
      :doc-id="props.blockId"
      :schema="blockSchema"
      :new-doc-schema="state.newDocs.blocks"
      header-class="py-2 rounded-none sticky top-0 border-b border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
      card-content-class="px-0 pb-0"
      :show-footer="false"
      :no-close-after-save="true"
      :working-doc-overrides="editorWorkingDocOverrides"
      @working-doc="editorDocUpdates"
      @unsaved-changes="handleUnsavedChanges"
      @saved="clearTemplateConversionAfterSave"
    >
      <template #header-start="slotProps">
        <FilePenLine class="mr-2" />
        {{ slotProps.title }}
      </template>
      <template #header-center>
        <div class="w-full flex gap-2 px-4 items-center">
          <div class="flex-1">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorTheme"
              name="theme"
              :items="themes.map(t => ({ title: t.name, name: t.docId }))"
              placeholder="Theme Viewer Select"
              class="w-full"
            />
          </div>
          <div class="flex-1">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorSite"
              name="site"
              :items="sites.map(s => ({ title: s.name, name: s.docId }))"
              placeholder="Select Site"
              class="w-full"
            />
          </div>
          <div class="flex-1">
            <edge-shad-select
              v-if="!state.loading"
              :model-value="state.editorWorkingDoc?.previewType || 'light'"
              name="previewType"
              :items="previewTypeOptions"
              placeholder="Preview Surface"
              class="w-full"
              @update:model-value="updateWorkingPreviewType($event)"
            />
          </div>
          <div class="flex items-center gap-2">
            <edge-shad-button
              type="button"
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :disabled="props.blockId === 'new' || !currentBlock"
              title="View Block History"
              aria-label="View Block History"
              @click="openHistoryDialog"
            >
              <History class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button
              type="button"
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :disabled="props.blockId === 'new' || !blocks?.[props.blockId]"
              title="Export Block"
              aria-label="Export Block"
              @click="exportCurrentBlock"
            >
              <Download class="h-4 w-4" />
            </edge-shad-button>
          </div>
        </div>
      </template>
      <template #main="slotProps">
        <div class="pt-4">
          <div class="flex w-full gap-2">
            <div class="flex-auto">
              <edge-shad-input
                v-model="slotProps.workingDoc.name"
                label="Block Name"
                class="flex-auto"
                name="name"
              />
            </div>
            <div class="flex-auto">
              <edge-shad-select-tags
                v-model="slotProps.workingDoc.tags"
                :items="getTagsFromBlocks"
                name="tags"
                placeholder="Select tags"
                label="Tags"
                :allow-additions="true"
                class="w-full max-w-[800px] mx-auto mb-5 text-black"
              />
            </div>
            <div class="flex-auto">
              <edge-shad-select-tags
                v-model="slotProps.workingDoc.type"
                label="Block Type"
                name="type"
                :items="blockTypeOptions"
                item-title="title"
                item-value="name"
                :allow-additions="false"
                placeholder="Block Type"
                class="w-full max-w-[800px] mx-auto mb-5 text-black"
              />
            </div>
            <div class="flex-auto">
              <edge-shad-select
                v-model="slotProps.workingDoc.themes"
                label="Allowed Themes"
                name="themes"
                :multiple="true"
                :items="themes.map(t => ({ title: t.name, name: t.docId }))"
                placeholder="Allowed Themes"
                class="flex-auto"
              />
            </div>
            <div class="flex-auto pt-2 text-slate-900 dark:text-slate-100">
              <edge-shad-checkbox
                v-model="slotProps.workingDoc.synced"
                name="synced"
                label="Synced Block"
                class="border-slate-400 bg-white text-slate-900 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
              >
                <span class="text-slate-900">Synced Block</span>
              </edge-shad-checkbox>
            </div>
          </div>
          <div class="flex gap-4">
            <div class="w-1/2">
              <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
                <edge-shad-button
                  v-if="!isWorkingTemplateV2Doc(slotProps.workingDoc)"
                  type="button"
                  size="sm"
                  variant="outline"
                  class="h-8 gap-2 px-3 text-[11px] uppercase tracking-wide"
                  :disabled="isWorkingTemplateV2Doc(slotProps.workingDoc) || !slotProps.workingDoc.content"
                  @click="convertWorkingDocToTemplateV2(slotProps.workingDoc)"
                >
                  <Wand2 class="h-4 w-4" />
                  Convert to Template v2
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="h-8 px-3 text-[11px] uppercase tracking-wide rounded border border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                  @click="state.instructionsDialogOpen = true"
                >
                  <HelpCircle class="mr-1 h-3.5 w-3.5" />
                  Instructions
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="h-8 px-3 text-[11px] uppercase tracking-wide rounded border border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                  @click="state.aiInstructionsDialogOpen = true"
                >
                  <HelpCircle class="mr-1 h-3.5 w-3.5" />
                  AI Instructions
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="h-8 px-3 text-[11px] uppercase tracking-wide rounded border border-slate-300 bg-slate-900 text-white dark:border-slate-700 dark:bg-slate-200 dark:text-slate-900 gap-2"
                  @click="state.helpOpen = true"
                >
                  <HelpCircle class="w-4 h-4" />
                  Block Help
                </edge-shad-button>
              </div>
              <Tabs v-if="isWorkingTemplateV2Doc(slotProps.workingDoc)" v-model="state.templateEditorTab" class="mb-3 w-full">
                <TabsList class="grid w-full grid-cols-3 rounded-sm border border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800">
                  <TabsTrigger value="template" class="w-full text-xs text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Template
                  </TabsTrigger>
                  <TabsTrigger value="dataSources" class="w-full text-xs text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Data Sources
                  </TabsTrigger>
                  <TabsTrigger value="schema" class="w-full text-xs text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Inputs
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="dataSources" class="mt-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      Data Sources
                    </div>
                    <div class="flex items-center gap-2">
                      <edge-shad-button
                        type="button"
                        size="sm"
                        variant="outline"
                        class="h-8 gap-2 px-3 text-[11px] uppercase tracking-wide"
                        @click="openTemplateV2DataSourceWizard"
                      >
                        <Plus class="h-3.5 w-3.5" />
                        Add Data Source
                      </edge-shad-button>
                      <edge-shad-button
                        type="button"
                        size="sm"
                        variant="ghost"
                        class="h-8 gap-2 rounded border border-slate-300 bg-white px-3 text-[11px] uppercase tracking-wide text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                        @click="state.templateRawJsonOpen.dataSources = !state.templateRawJsonOpen.dataSources"
                      >
                        <Code2 class="h-3.5 w-3.5" />
                        {{ state.templateRawJsonOpen.dataSources ? 'Use List' : 'Show JSON' }}
                      </edge-shad-button>
                    </div>
                  </div>
                  <edge-cms-code-editor
                    v-if="state.templateRawJsonOpen.dataSources"
                    :model-value="formatJson(slotProps.workingDoc.dataSources)"
                    title="Data Sources (JSON)"
                    language="json"
                    name="dataSources"
                    validate-json
                    height="calc(100vh - 356px)"
                    @update:model-value="updateJsonDocField(slotProps.workingDoc, 'dataSources', $event)"
                  />
                  <div v-else class="max-h-[calc(100vh_-_356px)] space-y-3 overflow-auto pr-1">
                    <div
                      v-if="!templateV2DataSourceList(slotProps.workingDoc).length"
                      class="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                    >
                      No data sources yet.
                    </div>
                    <button
                      v-for="sourceItem in templateV2DataSourceList(slotProps.workingDoc)"
                      :key="sourceItem.name"
                      type="button"
                      class="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                      @click="openTemplateV2DataSourceWizardForEdit(sourceItem.name, sourceItem.source)"
                    >
                      <span>
                        <span class="block text-sm font-semibold text-slate-900 dark:text-slate-100">{{ sourceItem.name }}</span>
                        <span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                          {{ sourceItem.type === 'api' ? sourceItem.source.api || 'API source' : sourceItem.type === 'collection' ? sourceItem.source.path || 'Collection source' : 'Manual source' }}
                        </span>
                      </span>
                      <span class="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                        {{ sourceItem.type }}
                      </span>
                    </button>
                  </div>
                  <p v-if="state.templateJsonErrors.dataSources" class="mt-2 text-xs text-red-600">
                    {{ state.templateJsonErrors.dataSources }}
                  </p>
                </TabsContent>
                <TabsContent value="schema" class="mt-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      Block Inputs
                    </div>
                    <div class="flex items-center gap-2">
                      <edge-shad-button
                        type="button"
                        size="sm"
                        variant="outline"
                        class="h-8 gap-2 px-3 text-[11px] uppercase tracking-wide"
                        @click="openTemplateV2SchemaWizard(slotProps.workingDoc)"
                      >
                        <Plus class="h-3.5 w-3.5" />
                        Add Input
                      </edge-shad-button>
                      <edge-shad-button
                        type="button"
                        size="sm"
                        variant="ghost"
                        class="h-8 gap-2 rounded border border-slate-300 bg-white px-3 text-[11px] uppercase tracking-wide text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                        @click="state.templateRawJsonOpen.schema = !state.templateRawJsonOpen.schema"
                      >
                        <Code2 class="h-3.5 w-3.5" />
                        {{ state.templateRawJsonOpen.schema ? 'Use Inputs' : 'Show JSON' }}
                      </edge-shad-button>
                    </div>
                  </div>
                  <edge-cms-code-editor
                    v-if="state.templateRawJsonOpen.schema"
                    :model-value="formatJson(slotProps.workingDoc.schema)"
                    title="Inputs (Schema JSON)"
                    language="json"
                    name="schema"
                    validate-json
                    height="calc(100vh - 356px)"
                    @update:model-value="updateJsonDocField(slotProps.workingDoc, 'schema', $event)"
                  />
                  <div v-else class="max-h-[calc(100vh_-_356px)] space-y-3 overflow-auto pr-1">
                    <div
                      v-if="!getTemplateV2SchemaEntries(slotProps.workingDoc).length"
                      class="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                    >
                      No inputs yet.
                    </div>
                    <details
                      v-for="schemaItem in getTemplateV2SchemaEntries(slotProps.workingDoc)"
                      :key="schemaItem.field"
                      class="rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
                    >
                      <summary
                        class="flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100"
                        @click.prevent="openTemplateV2SchemaWizardForEdit(schemaItem.field, schemaItem.entry)"
                        @keydown.enter.prevent="openTemplateV2SchemaWizardForEdit(schemaItem.field, schemaItem.entry)"
                        @keydown.space.prevent="openTemplateV2SchemaWizardForEdit(schemaItem.field, schemaItem.entry)"
                      >
                        <span>{{ schemaItem.entry.label || schemaItem.field }}</span>
                        <span class="rounded border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-700">
                          {{ schemaItem.entry.type || 'text' }}
                        </span>
                      </summary>
                      <div class="space-y-3 p-3">
                      <div class="grid gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                        <edge-shad-input
                          :model-value="schemaItem.field"
                          :name="`schemaField-${schemaItem.field}`"
                          label="Field Key"
                          placeholder="heading"
                          @blur="renameTemplateV2SchemaField(slotProps.workingDoc, schemaItem.field, $event.target.value)"
                        />
                        <edge-shad-input
                          v-model="schemaItem.entry.label"
                          :name="`schemaLabel-${schemaItem.field}`"
                          label="Label"
                          placeholder="Heading"
                        />
                        <edge-shad-select
                          :model-value="schemaItem.entry.type"
                          :name="`schemaType-${schemaItem.field}`"
                          label="Type"
                          :items="v2SchemaTypeOptions"
                          @update:model-value="updateTemplateV2SchemaType(schemaItem.entry, $event)"
                        />
                        <edge-shad-button
                          type="button"
                          size="icon"
                          variant="ghost"
                          class="mt-7 h-9 w-9 rounded border border-red-200 text-red-600 hover:bg-red-50"
                          aria-label="Remove schema field"
                          @click="openTemplateV2DeleteDialog({ type: 'schema', workingDoc: slotProps.workingDoc, field: schemaItem.field, label: schemaItem.entry.label || schemaItem.field })"
                        >
                          <Trash2 class="h-4 w-4" />
                        </edge-shad-button>
                      </div>
                      <div class="grid gap-3 md:grid-cols-2">
                        <edge-shad-textarea
                          v-if="isTemplateV2JsonDefaultType(schemaItem.entry.type)"
                          :model-value="formatTemplateV2SchemaDefault(schemaItem.entry)"
                          :name="`schemaDefault-${schemaItem.field}`"
                          label="Default Value JSON"
                          class="min-h-[90px] font-mono text-xs"
                          :placeholder="schemaItem.entry.type === 'array' ? '[]' : '{}'"
                          @update:model-value="updateTemplateV2JsonSubfield(schemaItem.entry, 'value', $event, `schemaDefault-${schemaItem.field}`, getTemplateV2SchemaDefaultFallback(schemaItem.entry))"
                        />
                        <edge-shad-input
                          v-else-if="schemaItem.entry.type !== 'array'"
                          v-model="schemaItem.entry.value"
                          :name="`schemaDefault-${schemaItem.field}`"
                          label="Default Value"
                          placeholder="Optional default"
                        />
                      </div>
                      <div v-if="schemaItem.entry.type === 'array'" class="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                        <div class="flex items-center justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              Item Fields
                            </div>
                            <p class="text-xs text-slate-500 dark:text-slate-400">
                              These fields define each item a user can add to this array.
                            </p>
                          </div>
                          <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2ArraySchemaField(schemaItem.entry)">
                            <Plus class="h-3.5 w-3.5" />
                            Add Item Field
                          </edge-shad-button>
                        </div>
                        <div
                          v-if="!getTemplateV2ArraySchemaEntries(schemaItem.entry).length"
                          class="rounded border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                        >
                          Add item fields before creating default items.
                        </div>
                        <div class="space-y-3">
                          <div
                            v-for="arraySchemaItem in getTemplateV2ArraySchemaEntries(schemaItem.entry)"
                            :key="`array-schema-${schemaItem.field}-${arraySchemaItem.field}`"
                            class="space-y-3 rounded border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                          >
                            <div class="grid gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                              <edge-shad-input
                                :model-value="arraySchemaItem.field"
                                :name="`arraySchemaField-${schemaItem.field}-${arraySchemaItem.field}`"
                                label="Field Key"
                                placeholder="heading"
                                @blur="renameTemplateV2ArraySchemaField(schemaItem.entry, arraySchemaItem.field, $event.target.value)"
                              />
                              <edge-shad-input
                                v-model="arraySchemaItem.entry.label"
                                :name="`arraySchemaLabel-${schemaItem.field}-${arraySchemaItem.field}`"
                                label="Label"
                                placeholder="Heading"
                              />
                              <edge-shad-select
                                :model-value="arraySchemaItem.entry.type"
                                :name="`arraySchemaType-${schemaItem.field}-${arraySchemaItem.field}`"
                                label="Type"
                                :items="v2ArrayItemSchemaTypeOptions"
                                @update:model-value="updateTemplateV2ArraySchemaType(arraySchemaItem.entry, $event)"
                              />
                              <edge-shad-button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="mt-7 h-9 w-9 text-red-600"
                                aria-label="Remove item field"
                                @click="removeTemplateV2ArraySchemaField(schemaItem.entry, arraySchemaItem.field)"
                              >
                                <Trash2 class="h-4 w-4" />
                              </edge-shad-button>
                            </div>
                            <div v-if="['image', 'richtext'].includes(arraySchemaItem.entry.type)" class="grid gap-3 md:grid-cols-2">
                              <edge-shad-tags
                                :model-value="arraySchemaItem.entry.tags || []"
                                :name="`arraySchemaTags-${schemaItem.field}-${arraySchemaItem.field}`"
                                label="Default Media Tags"
                                placeholder="Backgrounds"
                                value-as="array"
                                @update:model-value="updateTemplateV2SchemaArrayField(arraySchemaItem.entry, 'tags', $event)"
                              />
                              <edge-shad-select
                                :model-value="arraySchemaItem.entry.variant || 'public'"
                                :name="`arraySchemaVariant-${schemaItem.field}-${arraySchemaItem.field}`"
                                label="Image Variant"
                                :items="v2ImageVariantOptions"
                                @update:model-value="updateTemplateV2SchemaVariant(arraySchemaItem.entry, $event)"
                              />
                            </div>
                            <div v-if="arraySchemaItem.entry.type === 'option'" class="space-y-3 rounded border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                              <div
                                v-for="(optionRow, optionIndex) in getTemplateV2SchemaOption(arraySchemaItem.entry).options"
                                :key="`array-schema-option-${schemaItem.field}-${arraySchemaItem.field}-${optionIndex}`"
                                class="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                              >
                                <edge-shad-input
                                  :model-value="getTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionRow, 'label')"
                                  :name="`arraySchemaOptionLabel-${schemaItem.field}-${arraySchemaItem.field}-${optionIndex}`"
                                  label="Label"
                                  placeholder="Featured"
                                  @update:model-value="updateTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionIndex, 'label', $event)"
                                />
                                <edge-shad-input
                                  :model-value="getTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionRow, 'value')"
                                  :name="`arraySchemaOptionValue-${schemaItem.field}-${arraySchemaItem.field}-${optionIndex}`"
                                  label="Value"
                                  placeholder="featured"
                                  @update:model-value="updateTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionIndex, 'value', $event)"
                                />
                                <edge-shad-button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  class="mt-7 h-9 w-9 text-red-600"
                                  aria-label="Remove option"
                                  @click="removeTemplateV2SchemaOptionRow(arraySchemaItem.entry, optionIndex)"
                                >
                                  <Trash2 class="h-4 w-4" />
                                </edge-shad-button>
                              </div>
                              <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2SchemaOptionRow(arraySchemaItem.entry)">
                                <Plus class="h-3.5 w-3.5" />
                                Add Option
                              </edge-shad-button>
                            </div>
                          </div>
                        </div>
                        <div class="border-t border-slate-200 pt-4 dark:border-slate-800">
                          <div class="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                Default Items
                              </div>
                              <p class="text-xs text-slate-500 dark:text-slate-400">
                                These optional rows become the array's default value.
                              </p>
                            </div>
                            <edge-shad-button
                              type="button"
                              size="sm"
                              variant="outline"
                              class="h-8 gap-2"
                              :disabled="!getTemplateV2ArraySchemaEntries(schemaItem.entry).length"
                              @click="addTemplateV2ArrayDefaultItem(schemaItem.entry)"
                            >
                              <Plus class="h-3.5 w-3.5" />
                              Add Default Item
                            </edge-shad-button>
                          </div>
                          <div
                            v-if="!getTemplateV2ArrayDefaultItems(schemaItem.entry).length"
                            class="rounded border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                          >
                            No default items.
                          </div>
                          <div class="space-y-3">
                            <div
                              v-for="(defaultItem, defaultIndex) in getTemplateV2ArrayDefaultItems(schemaItem.entry)"
                              :key="`array-default-${schemaItem.field}-${defaultIndex}`"
                              class="space-y-3 rounded border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                            >
                              <div class="flex items-center justify-between">
                                <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Item {{ defaultIndex + 1 }}
                                </div>
                                <edge-shad-button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  class="h-8 w-8 text-red-600"
                                  aria-label="Remove default item"
                                  @click="removeTemplateV2ArrayDefaultItem(schemaItem.entry, defaultIndex)"
                                >
                                  <Trash2 class="h-4 w-4" />
                                </edge-shad-button>
                              </div>
                              <div class="grid gap-3 md:grid-cols-2">
                                <template
                                  v-for="arraySchemaItem in getTemplateV2ArraySchemaEntries(schemaItem.entry)"
                                  :key="`array-default-field-${schemaItem.field}-${defaultIndex}-${arraySchemaItem.field}`"
                                >
                                  <edge-shad-textarea
                                    v-if="['textarea', 'richtext'].includes(arraySchemaItem.entry.type)"
                                    :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                    :name="`arrayDefault-${schemaItem.field}-${defaultIndex}-${arraySchemaItem.field}`"
                                    :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                    @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                  />
                                  <edge-shad-select
                                    v-else-if="arraySchemaItem.entry.type === 'option'"
                                    :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                    :name="`arrayDefault-${schemaItem.field}-${defaultIndex}-${arraySchemaItem.field}`"
                                    :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                    :items="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).options"
                                    :item-title="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).optionsKey"
                                    :item-value="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).optionsValue"
                                    @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                  />
                                  <edge-shad-input
                                    v-else
                                    :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                    :name="`arrayDefault-${schemaItem.field}-${defaultIndex}-${arraySchemaItem.field}`"
                                    :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                    :type="arraySchemaItem.entry.type === 'number' ? 'number' : 'text'"
                                    @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                  />
                                </template>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div v-if="['image', 'richtext'].includes(schemaItem.entry.type)" class="grid gap-3 md:grid-cols-2">
                        <edge-shad-tags
                          :model-value="schemaItem.entry.tags || []"
                          :name="`schemaTags-${schemaItem.field}`"
                          label="Default Media Tags"
                          placeholder="Backgrounds"
                          value-as="array"
                          @update:model-value="updateTemplateV2SchemaArrayField(schemaItem.entry, 'tags', $event)"
                        />
                        <edge-shad-select
                          :model-value="schemaItem.entry.variant || 'public'"
                          :name="`schemaVariant-${schemaItem.field}`"
                          label="Image Variant"
                          :items="v2ImageVariantOptions"
                          @update:model-value="updateTemplateV2SchemaVariant(schemaItem.entry, $event)"
                        />
                      </div>
                      <div v-if="schemaItem.entry.type === 'publication'" class="grid gap-3 md:grid-cols-2">
                        <edge-shad-select
                          v-model="schemaItem.entry.effect"
                          :name="`schemaPublicationEffect-${schemaItem.field}`"
                          label="Publication Effect"
                          :items="v2PublicationEffectOptions"
                        />
                        <p class="self-end pb-2 text-xs text-slate-500 dark:text-slate-400">
                          Publication fields open the publication picker and store selected page image data.
                        </p>
                      </div>
                      <div v-if="schemaItem.entry.type === 'option'" class="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                        <div class="space-y-2">
                          <div
                            v-for="(optionRow, optionIndex) in getTemplateV2SchemaOption(schemaItem.entry).options"
                            :key="`schema-option-${schemaItem.field}-${optionIndex}`"
                            class="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                          >
                            <edge-shad-input
                              :model-value="getTemplateV2SchemaOptionRowField(schemaItem.entry, optionRow, 'label')"
                              :name="`schemaOptionLabel-${schemaItem.field}-${optionIndex}`"
                              label="Label"
                              placeholder="Featured"
                              @update:model-value="updateTemplateV2SchemaOptionRowField(schemaItem.entry, optionIndex, 'label', $event)"
                            />
                            <edge-shad-input
                              :model-value="getTemplateV2SchemaOptionRowField(schemaItem.entry, optionRow, 'value')"
                              :name="`schemaOptionValue-${schemaItem.field}-${optionIndex}`"
                              label="Value"
                              placeholder="featured"
                              @update:model-value="updateTemplateV2SchemaOptionRowField(schemaItem.entry, optionIndex, 'value', $event)"
                            />
                            <edge-shad-button
                              type="button"
                              size="icon"
                              variant="ghost"
                              class="mt-7 h-9 w-9 text-red-600"
                              aria-label="Remove option"
                              @click="removeTemplateV2SchemaOptionRow(schemaItem.entry, optionIndex)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2SchemaOptionRow(schemaItem.entry)">
                          <Plus class="h-3.5 w-3.5" />
                          Add Option
                        </edge-shad-button>
                      </div>
                      <p v-if="state.templateJsonErrors[`schemaDefault-${schemaItem.field}`]" class="mt-2 text-xs text-red-600">
                        {{ state.templateJsonErrors[`schemaDefault-${schemaItem.field}`] }}
                      </p>
                      <p v-if="state.templateJsonErrors[`schemaNested-${schemaItem.field}`]" class="mt-2 text-xs text-red-600">
                        {{ state.templateJsonErrors[`schemaNested-${schemaItem.field}`] }}
                      </p>
                      </div>
                    </details>
                  </div>
                  <p v-if="state.templateJsonErrors.schema" class="mt-2 text-xs text-red-600">
                    {{ state.templateJsonErrors.schema }}
                  </p>
                </TabsContent>
              </Tabs>
              <edge-shad-dialog v-model="state.schemaWizardOpen">
                <DialogContent v-if="state.schemaWizardDraft" class="max-w-[860px]">
                  <DialogHeader>
                    <DialogTitle>{{ state.schemaWizardMode === 'edit' ? 'Edit Input' : 'Add Input' }}</DialogTitle>
                    <DialogDescription>
                      {{ state.schemaWizardMode === 'edit' ? 'Edit any section, then save it back to the inputs JSON for this block.' : 'Build an input step by step, then insert it into the inputs JSON for this block.' }}
                    </DialogDescription>
                  </DialogHeader>

                  <div class="mb-4 grid gap-2" :class="activeSchemaWizardStepItems.length === 4 ? 'grid-cols-4' : activeSchemaWizardStepItems.length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
                    <button
                      v-for="stepItem in activeSchemaWizardStepItems"
                      :key="stepItem.step"
                      type="button"
                      class="rounded border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                      :class="state.schemaWizardStep === stepItem.step ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'"
                      @click="goTemplateV2SchemaWizardStep(stepItem.step)"
                    >
                      {{ stepItem.step }}. {{ stepItem.title }}
                    </button>
                  </div>

                  <div v-if="state.schemaWizardStep === 1" class="space-y-4">
                    <div class="grid gap-3 md:grid-cols-[1fr_1fr_160px]">
                      <edge-shad-input
                        v-model="state.schemaWizardDraft.field"
                        name="schemaWizardField"
                        label="Field Key"
                        placeholder="heading"
                      />
                      <edge-shad-input
                        v-model="state.schemaWizardDraft.entry.label"
                        name="schemaWizardLabel"
                        label="Label"
                        placeholder="Heading"
                      />
                      <edge-shad-select
                        :model-value="state.schemaWizardDraft.entry.type"
                        name="schemaWizardType"
                        label="Type"
                        :items="v2SchemaTypeOptions"
                        @update:model-value="updateTemplateV2SchemaType(state.schemaWizardDraft.entry, $event)"
                      />
                    </div>
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      The field key is the token name used in the template, for example <code>{{ state.schemaWizardDraft.field || 'heading' }}</code>.
                    </div>
                    <edge-shad-button
                      v-if="state.schemaWizardMode === 'edit'"
                      type="button"
                      size="sm"
                      variant="outline"
                      class="h-8 gap-2 border-red-200 text-red-600 hover:bg-red-50"
                      @click="openTemplateV2DeleteDialog({ type: 'schema', workingDoc: slotProps.workingDoc, field: state.schemaWizardOriginalField, label: state.schemaWizardDraft.entry.label || state.schemaWizardOriginalField }); closeTemplateV2SchemaWizard()"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                      Delete Input
                    </edge-shad-button>
                  </div>

                  <div v-else-if="state.schemaWizardStep === 2" class="space-y-4">
                    <div class="grid gap-3 md:grid-cols-2">
                      <edge-shad-textarea
                        v-if="isTemplateV2JsonDefaultType(state.schemaWizardDraft.entry.type)"
                        :model-value="formatTemplateV2SchemaDefault(state.schemaWizardDraft.entry)"
                        name="schemaWizardDefaultJson"
                        label="Default Value JSON"
                        class="min-h-[120px] font-mono text-xs"
                        :placeholder="state.schemaWizardDraft.entry.type === 'array' ? '[]' : '{}'"
                        @update:model-value="updateTemplateV2JsonSubfield(state.schemaWizardDraft.entry, 'value', $event, 'schemaWizardDefaultJson', getTemplateV2SchemaDefaultFallback(state.schemaWizardDraft.entry))"
                      />
                      <edge-shad-input
                        v-else-if="state.schemaWizardDraft.entry.type !== 'array'"
                        v-model="state.schemaWizardDraft.entry.value"
                        name="schemaWizardDefault"
                        label="Default Value"
                        placeholder="Optional default"
                      />
                    </div>
                    <div
                      v-if="state.schemaWizardDraft.entry.type === 'array'"
                      class="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      Array defaults are edited in Settings after item fields are defined.
                    </div>
                  </div>

                  <div v-else-if="state.schemaWizardStep === 3" class="space-y-4">
                    <div v-if="state.schemaWizardDraft.entry.type === 'array'" class="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Item Fields
                          </div>
                          <p class="text-xs text-slate-500 dark:text-slate-400">
                            These fields define each item a user can add to this array.
                          </p>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2ArraySchemaField(state.schemaWizardDraft.entry)">
                          <Plus class="h-3.5 w-3.5" />
                          Add Item Field
                        </edge-shad-button>
                      </div>
                      <div
                        v-if="!getTemplateV2ArraySchemaEntries(state.schemaWizardDraft.entry).length"
                        class="rounded border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                      >
                        Add item fields before creating default items.
                      </div>
                      <div class="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                        <div
                          v-for="(arraySchemaItem, arraySchemaIndex) in getTemplateV2ArraySchemaEntries(state.schemaWizardDraft.entry)"
                          :key="`schema-wizard-array-${arraySchemaItem.field}`"
                          class="overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              class="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:hover:bg-slate-900"
                              @click="state.schemaWizardActiveItemFieldIndex = state.schemaWizardActiveItemFieldIndex === arraySchemaIndex ? -1 : arraySchemaIndex"
                            >
                              <span class="min-w-0">
                                <span class="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {{ arraySchemaItem.field }}
                                </span>
                                <span class="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                                  {{ getTemplateV2ArraySchemaFieldSummary(arraySchemaItem) }}
                                </span>
                              </span>
                              <span class="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {{ state.schemaWizardActiveItemFieldIndex === arraySchemaIndex ? 'Open' : 'Edit' }}
                              </span>
                            </button>
                            <edge-shad-button
                              type="button"
                              size="icon"
                              variant="ghost"
                              class="mr-2 h-8 w-8 shrink-0 text-red-600"
                              aria-label="Remove item field"
                              @click="removeTemplateV2ArraySchemaField(state.schemaWizardDraft.entry, arraySchemaItem.field)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                          <div
                            v-if="state.schemaWizardActiveItemFieldIndex === arraySchemaIndex"
                            class="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800"
                          >
                            <div class="grid gap-3 md:grid-cols-[1fr_1fr_150px]">
                              <edge-shad-input
                                :model-value="arraySchemaItem.field"
                                :name="`schemaWizardArrayField-${arraySchemaItem.field}`"
                                label="Field Key"
                                placeholder="heading"
                                @blur="renameTemplateV2ArraySchemaField(state.schemaWizardDraft.entry, arraySchemaItem.field, $event.target.value)"
                              />
                              <edge-shad-input
                                v-model="arraySchemaItem.entry.label"
                                :name="`schemaWizardArrayLabel-${arraySchemaItem.field}`"
                                label="Label"
                                placeholder="Heading"
                              />
                              <edge-shad-select
                                :model-value="arraySchemaItem.entry.type"
                                :name="`schemaWizardArrayType-${arraySchemaItem.field}`"
                                label="Type"
                                :items="v2ArrayItemSchemaTypeOptions"
                                @update:model-value="updateTemplateV2ArraySchemaType(arraySchemaItem.entry, $event)"
                              />
                            </div>
                            <div v-if="['image', 'richtext'].includes(arraySchemaItem.entry.type)" class="grid gap-3 md:grid-cols-2">
                              <edge-shad-tags
                                :model-value="arraySchemaItem.entry.tags || []"
                                :name="`schemaWizardArrayTags-${arraySchemaItem.field}`"
                                label="Default Media Tags"
                                placeholder="Backgrounds"
                                value-as="array"
                                @update:model-value="updateTemplateV2SchemaArrayField(arraySchemaItem.entry, 'tags', $event)"
                              />
                              <edge-shad-select
                                :model-value="arraySchemaItem.entry.variant || 'public'"
                                :name="`schemaWizardArrayVariant-${arraySchemaItem.field}`"
                                label="Image Variant"
                                :items="v2ImageVariantOptions"
                                @update:model-value="updateTemplateV2SchemaVariant(arraySchemaItem.entry, $event)"
                              />
                            </div>
                            <div v-if="arraySchemaItem.entry.type === 'option'" class="space-y-3 rounded border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                              <div
                                v-for="(optionRow, optionIndex) in getTemplateV2SchemaOption(arraySchemaItem.entry).options"
                                :key="`schema-wizard-array-option-${arraySchemaItem.field}-${optionIndex}`"
                                class="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                              >
                                <edge-shad-input
                                  :model-value="getTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionRow, 'label')"
                                  :name="`schemaWizardArrayOptionLabel-${arraySchemaItem.field}-${optionIndex}`"
                                  label="Label"
                                  placeholder="Featured"
                                  @update:model-value="updateTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionIndex, 'label', $event)"
                                />
                                <edge-shad-input
                                  :model-value="getTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionRow, 'value')"
                                  :name="`schemaWizardArrayOptionValue-${arraySchemaItem.field}-${optionIndex}`"
                                  label="Value"
                                  placeholder="featured"
                                  @update:model-value="updateTemplateV2SchemaOptionRowField(arraySchemaItem.entry, optionIndex, 'value', $event)"
                                />
                                <edge-shad-button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  class="mt-7 h-9 w-9 text-red-600"
                                  aria-label="Remove option"
                                  @click="removeTemplateV2SchemaOptionRow(arraySchemaItem.entry, optionIndex)"
                                >
                                  <Trash2 class="h-4 w-4" />
                                </edge-shad-button>
                              </div>
                              <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2SchemaOptionRow(arraySchemaItem.entry)">
                                <Plus class="h-3.5 w-3.5" />
                                Add Option
                              </edge-shad-button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div class="border-t border-slate-200 pt-4 dark:border-slate-800">
                        <div class="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              Default Items
                            </div>
                            <p class="text-xs text-slate-500 dark:text-slate-400">
                              These optional rows become the array's default value.
                            </p>
                          </div>
                          <edge-shad-button
                            type="button"
                            size="sm"
                            variant="outline"
                            class="h-8 gap-2"
                            :disabled="!getTemplateV2ArraySchemaEntries(state.schemaWizardDraft.entry).length"
                            @click="addTemplateV2ArrayDefaultItem(state.schemaWizardDraft.entry)"
                          >
                            <Plus class="h-3.5 w-3.5" />
                            Add Default Item
                          </edge-shad-button>
                        </div>
                        <div
                          v-if="!getTemplateV2ArrayDefaultItems(state.schemaWizardDraft.entry).length"
                          class="rounded border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
                        >
                          No default items.
                        </div>
                        <div class="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                          <div
                            v-for="(defaultItem, defaultIndex) in getTemplateV2ArrayDefaultItems(state.schemaWizardDraft.entry)"
                            :key="`schema-wizard-array-default-${defaultIndex}`"
                            class="overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                          >
                            <div class="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                class="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:hover:bg-slate-900"
                                @click="state.schemaWizardActiveDefaultItemIndex = state.schemaWizardActiveDefaultItemIndex === defaultIndex ? -1 : defaultIndex"
                              >
                                <span class="min-w-0">
                                  <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Item {{ defaultIndex + 1 }}
                                  </span>
                                  <span class="mt-1 block truncate text-xs text-slate-400">
                                    {{ getTemplateV2ArrayDefaultItemSummary(state.schemaWizardDraft.entry, defaultItem) }}
                                  </span>
                                </span>
                                <span class="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  {{ state.schemaWizardActiveDefaultItemIndex === defaultIndex ? 'Open' : 'Edit' }}
                                </span>
                              </button>
                              <edge-shad-button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="mr-2 h-8 w-8 shrink-0 text-red-600"
                                aria-label="Remove default item"
                                @click="removeTemplateV2ArrayDefaultItem(state.schemaWizardDraft.entry, defaultIndex)"
                              >
                                <Trash2 class="h-4 w-4" />
                              </edge-shad-button>
                            </div>
                            <div
                              v-if="state.schemaWizardActiveDefaultItemIndex === defaultIndex"
                              class="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2 dark:border-slate-800"
                            >
                              <template
                                v-for="arraySchemaItem in getTemplateV2ArraySchemaEntries(state.schemaWizardDraft.entry)"
                                :key="`schema-wizard-array-default-field-${defaultIndex}-${arraySchemaItem.field}`"
                              >
                                <edge-shad-textarea
                                  v-if="['textarea', 'richtext'].includes(arraySchemaItem.entry.type)"
                                  :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                  :name="`schemaWizardArrayDefault-${defaultIndex}-${arraySchemaItem.field}`"
                                  :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                  @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                />
                                <edge-shad-select
                                  v-else-if="arraySchemaItem.entry.type === 'option'"
                                  :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                  :name="`schemaWizardArrayDefault-${defaultIndex}-${arraySchemaItem.field}`"
                                  :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                  :items="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).options"
                                  :item-title="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).optionsKey"
                                  :item-value="getTemplateV2SchemaSelectOptions(arraySchemaItem.entry).optionsValue"
                                  @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                />
                                <edge-shad-input
                                  v-else
                                  :model-value="getTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field)"
                                  :name="`schemaWizardArrayDefault-${defaultIndex}-${arraySchemaItem.field}`"
                                  :label="arraySchemaItem.entry.label || titleFromKey(arraySchemaItem.field)"
                                  :type="arraySchemaItem.entry.type === 'number' ? 'number' : 'text'"
                                  @update:model-value="updateTemplateV2ArrayDefaultFieldValue(defaultItem, arraySchemaItem.field, $event, arraySchemaItem.entry.type)"
                                />
                              </template>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div v-else-if="['image', 'richtext'].includes(state.schemaWizardDraft.entry.type)" class="grid gap-3 md:grid-cols-2">
                      <edge-shad-tags
                        :model-value="state.schemaWizardDraft.entry.tags || []"
                        name="schemaWizardTags"
                        label="Default Media Tags"
                        placeholder="Backgrounds"
                        value-as="array"
                        @update:model-value="updateTemplateV2SchemaArrayField(state.schemaWizardDraft.entry, 'tags', $event)"
                      />
                      <edge-shad-select
                        :model-value="state.schemaWizardDraft.entry.variant || 'public'"
                        name="schemaWizardVariant"
                        label="Image Variant"
                        :items="v2ImageVariantOptions"
                        @update:model-value="updateTemplateV2SchemaVariant(state.schemaWizardDraft.entry, $event)"
                      />
                    </div>

                    <div v-else-if="state.schemaWizardDraft.entry.type === 'publication'" class="grid gap-3 md:grid-cols-2">
                      <edge-shad-select
                        v-model="state.schemaWizardDraft.entry.effect"
                        name="schemaWizardPublicationEffect"
                        label="Publication Effect"
                        :items="v2PublicationEffectOptions"
                      />
                      <p class="self-end pb-2 text-xs text-slate-500 dark:text-slate-400">
                        Publication fields open the publication picker and store selected page image data.
                      </p>
                    </div>

                    <div v-else-if="state.schemaWizardDraft.entry.type === 'option'" class="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                      <div class="space-y-2">
                        <div
                          v-for="(optionRow, optionIndex) in getTemplateV2SchemaOption(state.schemaWizardDraft.entry).options"
                          :key="`schema-wizard-option-${optionIndex}`"
                          class="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                        >
                          <edge-shad-input
                            :model-value="getTemplateV2SchemaOptionRowField(state.schemaWizardDraft.entry, optionRow, 'label')"
                            :name="`schemaWizardOptionLabel-${optionIndex}`"
                            label="Label"
                            placeholder="Featured"
                            @update:model-value="updateTemplateV2SchemaOptionRowField(state.schemaWizardDraft.entry, optionIndex, 'label', $event)"
                          />
                          <edge-shad-input
                            :model-value="getTemplateV2SchemaOptionRowField(state.schemaWizardDraft.entry, optionRow, 'value')"
                            :name="`schemaWizardOptionValue-${optionIndex}`"
                            label="Value"
                            placeholder="featured"
                            @update:model-value="updateTemplateV2SchemaOptionRowField(state.schemaWizardDraft.entry, optionIndex, 'value', $event)"
                          />
                          <edge-shad-button
                            type="button"
                            size="icon"
                            variant="ghost"
                            class="mt-7 h-9 w-9 text-red-600"
                            aria-label="Remove option"
                            @click="removeTemplateV2SchemaOptionRow(state.schemaWizardDraft.entry, optionIndex)"
                          >
                            <Trash2 class="h-4 w-4" />
                          </edge-shad-button>
                        </div>
                      </div>
                      <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2SchemaOptionRow(state.schemaWizardDraft.entry)">
                        <Plus class="h-3.5 w-3.5" />
                        Add Option
                      </edge-shad-button>
                    </div>

                    <div
                      v-if="!getV2DynamicContentItems(slotProps.workingDoc).length"
                      class="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      This field type has no additional settings.
                    </div>
                  </div>

                  <div v-else class="space-y-4">
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      Review the input JSON that will be inserted. Use the main JSON editor for advanced field shapes.
                    </div>
                    <div>
                      <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        JSON to insert
                      </div>
                      <pre class="max-h-[240px] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50"><code>{{ previewTemplateV2WizardSchemaJson }}</code></pre>
                    </div>
                  </div>

                  <p v-if="state.schemaWizardError" class="text-sm text-red-600">
                    {{ state.schemaWizardError }}
                  </p>

                  <DialogFooter>
                    <edge-shad-button type="button" variant="outline" @click="closeTemplateV2SchemaWizard">
                      Cancel
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.schemaWizardMode === 'add' && hasPreviousTemplateV2SchemaWizardStep"
                      type="button"
                      variant="outline"
                      @click="state.schemaWizardStep = getAdjacentTemplateV2SchemaWizardStep(-1)"
                    >
                      Back
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.schemaWizardMode === 'add' && hasNextTemplateV2SchemaWizardStep"
                      type="button"
                      @click="goTemplateV2SchemaWizardStep(getAdjacentTemplateV2SchemaWizardStep(1))"
                    >
                      Next
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.schemaWizardMode === 'edit' || !hasNextTemplateV2SchemaWizardStep"
                      type="button"
                      class="bg-slate-900 text-white hover:bg-slate-700"
                      @click="saveTemplateV2SchemaFromWizard(slotProps.workingDoc)"
                    >
                      {{ state.schemaWizardMode === 'edit' ? 'Save' : 'Add' }}
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
              <edge-shad-dialog :key="`data-source-dialog-${state.dataSourceWizardKey}`" v-model="state.dataSourceWizardOpen">
                <DialogContent v-if="state.dataSourceWizardDraft" :key="state.dataSourceWizardKey" class="max-w-[860px]">
                  <DialogHeader>
                    <DialogTitle>{{ state.dataSourceWizardMode === 'edit' ? 'Edit Data Source' : 'Add Data Source' }}</DialogTitle>
                    <DialogDescription>
                      {{ state.dataSourceWizardMode === 'edit' ? 'Edit any section, then save it back to the JSON for this block.' : 'Build a data source step by step, then insert it into the JSON for this block.' }}
                    </DialogDescription>
                  </DialogHeader>

                  <div class="mb-4 grid grid-cols-5 gap-2">
                    <button
                      v-for="stepItem in dataSourceWizardStepItems"
                      :key="stepItem.step"
                      type="button"
                      class="rounded border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                      :class="state.dataSourceWizardStep === stepItem.step ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'"
                      @click="goTemplateV2WizardStep(stepItem.step)"
                    >
                      {{ stepItem.step }}. {{ stepItem.title }}
                    </button>
                  </div>

                  <div v-if="state.dataSourceWizardStep === 1" class="space-y-4">
                    <div class="grid gap-3 md:grid-cols-2">
                      <edge-shad-input
                        :key="`data-source-name-${state.dataSourceWizardKey}`"
                        v-model="state.dataSourceWizardDraft.sourceName"
                        :name="`dataSourceWizardSourceName-${state.dataSourceWizardKey}`"
                        label="Source Name"
                        placeholder="items"
                      />
                      <edge-shad-select
                        :key="`data-source-type-${state.dataSourceWizardKey}`"
                        v-model="state.dataSourceWizardDraft.type"
                        :name="`dataSourceWizardType-${state.dataSourceWizardKey}`"
                        label="Source Type"
                        :items="v2DataSourceTypeOptions"
                      />
                    </div>
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      Use a source name that matches the template loop, for example <code>source("items")</code>. API data comes from an HTTP endpoint. Collection data comes from the site KV index.
                    </div>
                    <edge-shad-button
                      v-if="state.dataSourceWizardMode === 'edit'"
                      type="button"
                      size="sm"
                      variant="outline"
                      class="h-8 gap-2 border-red-200 text-red-600 hover:bg-red-50"
                      @click="openTemplateV2DeleteDialog({ type: 'dataSource', workingDoc: slotProps.workingDoc, sourceName: state.dataSourceWizardOriginalName, label: state.dataSourceWizardDraft.sourceName || state.dataSourceWizardOriginalName }); closeTemplateV2DataSourceWizard()"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                      Delete Data Source
                    </edge-shad-button>
                  </div>

                  <div v-else-if="state.dataSourceWizardStep === 2" class="space-y-4">
                    <div v-if="state.dataSourceWizardDraft.type === 'api'" class="grid gap-3 md:grid-cols-2">
                      <edge-shad-input
                        v-model="state.dataSourceWizardDraft.api"
                        name="dataSourceWizardApi"
                        label="API URL"
                        placeholder="https://api.example.com/items"
                      />
                      <edge-shad-input
                        v-model="state.dataSourceWizardDraft.apiField"
                        name="dataSourceWizardApiField"
                        label="Response Field"
                        placeholder="data"
                      />
                      <edge-shad-input
                        v-model="state.dataSourceWizardDraft.apiQuery"
                        name="dataSourceWizardApiQuery"
                        label="Static API Query"
                        placeholder="?limit=6"
                      />
                      <edge-shad-input
                        v-model="state.dataSourceWizardDraft.limit"
                        name="dataSourceWizardApiLimit"
                        type="number"
                        label="Limit"
                        placeholder="6"
                      />
                    </div>

                    <div v-else-if="state.dataSourceWizardDraft.type === 'collection'" class="space-y-4">
                      <div class="grid gap-3 md:grid-cols-2">
                        <edge-shad-input
                          v-model="state.dataSourceWizardDraft.path"
                          name="dataSourceWizardPath"
                          label="Collection Path"
                          placeholder="items"
                        />
                        <edge-shad-input
                          v-model="state.dataSourceWizardDraft.baseKey"
                          name="dataSourceWizardBaseKey"
                          label="Base Key Override"
                          placeholder="Optional index key"
                        />
                        <edge-shad-select
                          v-model="state.dataSourceWizardDraft.uniqueKey"
                          name="dataSourceWizardUniqueKey"
                          label="Where is the collection located?"
                          :items="v2DataSourceScopeOptions"
                        />
                        <edge-shad-input
                          v-model="state.dataSourceWizardDraft.limit"
                          name="dataSourceWizardCollectionLimit"
                          type="number"
                          label="Limit"
                          placeholder="80"
                        />
                      </div>
                      <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                        Choose organization level for data shared across the org. Choose site level for data that belongs to the selected site. Use the JSON editor for custom index keys.
                      </div>
                      <edge-shad-input
                        v-model="state.dataSourceWizardDraft.canonicalLookupKey"
                        name="dataSourceWizardCanonicalLookup"
                        label="Fetch Exact Record Key"
                        placeholder="{orgId}:{siteId}"
                      />
                      <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                        Leave this blank for normal list queries. Use Fetch Exact Record Key only when this source always loads one known record. For parent-based lookups, insert the relationship in the Template with Dynamic Fields so the queried field is visible.
                      </div>
                    </div>

                    <div
                      v-else
                      class="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      Manual data sources are advanced and can be edited in the JSON editor.
                    </div>
                  </div>

                  <div v-else-if="state.dataSourceWizardStep === 3" class="space-y-4">
                    <div v-if="state.dataSourceWizardDraft.type !== 'manual'" class="grid gap-4 xl:grid-cols-2">
                      <div class="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div class="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Indexed Lookup Values
                        </div>
                        <p class="mb-3 text-xs text-slate-600 dark:text-slate-400">
                          Use these when the field is indexed, like category = Featured or slug = route segment. This narrows the fetch before records are returned.
                        </p>
                        <div class="space-y-2">
                          <div v-for="(row, index) in state.dataSourceWizardDraft.queryItems" :key="`wizard-query-${index}`" class="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                            <edge-shad-input v-model="row.key" :name="`wizardQueryKey-${index}`" label="Field" placeholder="category" />
                            <edge-shad-input v-model="row.value" :name="`wizardQueryValue-${index}`" label="Value" placeholder="Featured" />
                            <edge-shad-button type="button" size="icon" variant="ghost" class="mt-7 h-9 w-9 text-red-600" aria-label="Remove query item" @click="removeTemplateV2WizardMapRow('queryItems', index)">
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="mt-3 h-8 gap-2" @click="addTemplateV2WizardMapRow('queryItems')">
                          <Plus class="h-3.5 w-3.5" />
                          Add Indexed Lookup
                        </edge-shad-button>
                      </div>

                      <div class="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div class="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Preview Lookup Values
                        </div>
                        <p class="mb-3 text-xs text-slate-600 dark:text-slate-400">
                          Use these only to make editor previews work when a route token like <code>{routeLastSegment}</code> does not exist in the block editor.
                        </p>
                        <div class="space-y-2">
                          <div v-for="(row, index) in state.dataSourceWizardDraft.previewQueryItems" :key="`wizard-preview-query-${index}`" class="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                            <edge-shad-input v-model="row.key" :name="`wizardPreviewQueryKey-${index}`" label="Field" placeholder="slug" />
                            <edge-shad-input v-model="row.value" :name="`wizardPreviewQueryValue-${index}`" label="Preview Value" placeholder="sample-item" />
                            <edge-shad-button type="button" size="icon" variant="ghost" class="mt-7 h-9 w-9 text-red-600" aria-label="Remove preview query item" @click="removeTemplateV2WizardMapRow('previewQueryItems', index)">
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="mt-3 h-8 gap-2" @click="addTemplateV2WizardMapRow('previewQueryItems')">
                          <Plus class="h-3.5 w-3.5" />
                          Add Preview Value
                        </edge-shad-button>
                      </div>
                    </div>

                    <div v-if="state.dataSourceWizardDraft.type === 'collection'" class="grid gap-4 md:grid-cols-2">
                      <div class="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div class="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          After-Fetch Filters
                        </div>
                        <p class="mb-3 text-xs text-slate-600 dark:text-slate-400">
                          These filter records after the fetch. Use indexed lookup values above when the field is indexed.
                        </p>
                        <div class="space-y-2">
                          <div
                            v-for="(row, index) in state.dataSourceWizardDraft.filters"
                            :key="`wizard-filter-${index}`"
                            class="grid gap-2 rounded border border-slate-100 p-2 md:grid-cols-[1fr_180px_auto] dark:border-slate-800"
                          >
                            <edge-shad-input
                              v-model="row.field"
                              :name="`wizardFilterField-${index}`"
                              label="Field"
                              placeholder="status"
                            />
                            <edge-shad-select
                              v-model="row.operator"
                              :name="`wizardFilterOperator-${index}`"
                              label="Operator"
                              :items="v2DataSourceFilterOperatorOptions"
                            />
                            <edge-shad-button
                              type="button"
                              size="icon"
                              variant="ghost"
                              class="mt-7 h-9 w-9 text-red-600"
                              aria-label="Remove after-fetch filter"
                              @click="removeTemplateV2WizardFilterRow(index)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                            <div class="md:col-span-3">
                              <edge-shad-select-tags
                                v-if="isV2DataSourceFilterArrayOperator(row.operator)"
                                :model-value="getV2DataSourceFilterArrayValues(row.value)"
                                :name="`wizardFilterValues-${index}`"
                                :label="getV2DataSourceFilterValueLabel(row.operator)"
                                :placeholder="getV2DataSourceFilterValuePlaceholder(row.operator)"
                                :items="[]"
                                value-as="array"
                                :allow-additions="true"
                                @update:model-value="updateV2DataSourceFilterArrayValues(row, $event)"
                              />
                              <edge-shad-input
                                v-else
                                v-model="row.value"
                                :name="`wizardFilterValue-${index}`"
                                :label="getV2DataSourceFilterValueLabel(row.operator)"
                                :placeholder="getV2DataSourceFilterValuePlaceholder(row.operator)"
                              />
                              <p
                                v-if="getV2DataSourceFilterValueHelper(row.operator)"
                                class="mt-1 text-xs text-slate-600 dark:text-slate-400"
                              >
                                {{ getV2DataSourceFilterValueHelper(row.operator) }}
                              </p>
                            </div>
                          </div>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="mt-3 h-8 gap-2" @click="addTemplateV2WizardFilterRow">
                          <Plus class="h-3.5 w-3.5" />
                          Add Filter
                        </edge-shad-button>
                      </div>

                      <div class="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div class="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Sort
                        </div>
                        <p class="mb-3 text-xs text-slate-600 dark:text-slate-400">
                          Choose the field order returned to the template.
                        </p>
                        <div class="space-y-2">
                          <div
                            v-for="(row, index) in state.dataSourceWizardDraft.sort"
                            :key="`wizard-sort-${index}`"
                            class="grid gap-2 md:grid-cols-[1fr_160px_auto]"
                          >
                            <edge-shad-input
                              v-model="row.field"
                              :name="`wizardSortField-${index}`"
                              label="Field"
                              placeholder="name"
                            />
                            <edge-shad-select
                              v-model="row.direction"
                              :name="`wizardSortDirection-${index}`"
                              label="Direction"
                              :items="v2DataSourceSortDirectionOptions"
                            />
                            <edge-shad-button
                              type="button"
                              size="icon"
                              variant="ghost"
                              class="mt-7 h-9 w-9 text-red-600"
                              aria-label="Remove sort"
                              @click="removeTemplateV2WizardSortRow(index)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                        </div>
                        <edge-shad-button type="button" size="sm" variant="outline" class="mt-3 h-8 gap-2" @click="addTemplateV2WizardSortRow">
                          <Plus class="h-3.5 w-3.5" />
                          Add Sort
                        </edge-shad-button>
                      </div>
                    </div>
                  </div>

                  <div v-else-if="state.dataSourceWizardStep === 4" class="space-y-4">
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      Controls appear when someone clicks the block in the page editor. For API sources they become query string values. For collection sources they should usually map to indexed lookup fields.
                    </div>
                    <div class="space-y-3">
                      <div
                        v-for="(control, controlIndex) in state.dataSourceWizardDraft.controls"
                        :key="`wizard-control-${controlIndex}`"
                        class="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                      >
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:hover:bg-slate-900"
                          @click="state.dataSourceWizardActiveControlIndex = state.dataSourceWizardActiveControlIndex === controlIndex ? -1 : controlIndex"
                        >
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {{ control.title || control.key || `Control ${controlIndex + 1}` }}
                            </span>
                            <span class="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                              {{ control.key || 'No key set' }}
                              <span v-if="control.input === 'select'">
                                - {{ control.optionMode === 'collection' ? control.optionsCollection || 'Collection options' : `${Array.isArray(control.options) ? control.options.length : 0} manual options` }}
                              </span>
                            </span>
                          </span>
                          <span class="flex shrink-0 items-center gap-2">
                            <span class="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                              {{ control.input || 'text' }}
                            </span>
                            <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {{ state.dataSourceWizardActiveControlIndex === controlIndex ? 'Open' : 'Edit' }}
                            </span>
                          </span>
                        </button>
                        <div v-if="state.dataSourceWizardActiveControlIndex === controlIndex" class="border-t border-slate-200 p-3 dark:border-slate-800">
                          <div class="grid gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                            <edge-shad-input
                              v-model="control.key"
                              :name="`wizardControlKey-${controlIndex}`"
                              :label="getV2DataSourceControlKeyLabel(state.dataSourceWizardDraft.type)"
                              :placeholder="getV2DataSourceControlKeyPlaceholder(state.dataSourceWizardDraft.type)"
                            />
                            <edge-shad-input
                              v-model="control.title"
                              :name="`wizardControlTitle-${controlIndex}`"
                              label="Label"
                              placeholder="Category"
                            />
                            <edge-shad-select
                              v-model="control.input"
                              :name="`wizardControlInput-${controlIndex}`"
                              label="Type"
                              :items="v2DataSourceControlTypeOptions"
                              @update:model-value="updateV2DataSourceControlInput(control, $event)"
                            />
                            <edge-shad-button
                              type="button"
                              size="icon"
                              variant="ghost"
                              class="mt-7 h-9 w-9 text-red-600"
                              aria-label="Remove control"
                              @click="removeTemplateV2WizardControlRow(controlIndex)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </edge-shad-button>
                          </div>
                          <p class="mt-2 text-xs text-slate-600 dark:text-slate-400">
                            {{ getV2DataSourceControlKeyHelper(state.dataSourceWizardDraft.type) }}
                          </p>
                          <div class="mt-3 grid gap-3 md:grid-cols-2">
                            <edge-shad-input
                              v-model="control.placeholder"
                              :name="`wizardControlPlaceholder-${controlIndex}`"
                              label="Placeholder"
                              placeholder="Optional placeholder"
                            />
                            <edge-shad-select
                              v-if="control.input === 'select'"
                              v-model="control.optionMode"
                              :name="`wizardControlOptionMode-${controlIndex}`"
                              label="Select Options"
                              :items="v2DataSourceControlOptionModeOptions"
                              @update:model-value="updateV2DataSourceControlOptionMode(control, $event)"
                            />
                          </div>
                          <div v-if="control.input === 'select' && control.optionMode === 'collection'" class="mt-3 grid gap-3 md:grid-cols-3">
                            <edge-shad-input
                              v-model="control.optionsCollection"
                              :name="`wizardControlOptionsCollection-${controlIndex}`"
                              label="Options Collection"
                              placeholder="categories"
                            />
                            <div class="space-y-1">
                              <edge-shad-input
                                v-model="control.optionsKey"
                                :name="`wizardControlOptionsKey-${controlIndex}`"
                                label="Label Field"
                                placeholder="label"
                              />
                              <p class="text-xs text-slate-500 dark:text-slate-400">
                                Field name from each record in the options collection to show as the dropdown label.
                              </p>
                            </div>
                            <div class="space-y-1">
                              <edge-shad-input
                                v-model="control.optionsValue"
                                :name="`wizardControlOptionsValue-${controlIndex}`"
                                label="Value Field"
                                placeholder="value"
                              />
                              <p class="text-xs text-slate-500 dark:text-slate-400">
                                Field name from each record in the options collection to save as the selected value.
                              </p>
                            </div>
                          </div>
                          <div v-else-if="control.input === 'select'" class="mt-3 space-y-2">
                            <div
                              v-for="(option, optionIndex) in control.options"
                              :key="`wizard-control-${controlIndex}-option-${optionIndex}`"
                              class="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                            >
                              <edge-shad-input
                                v-model="option.label"
                                :name="`wizardControlOptionLabel-${controlIndex}-${optionIndex}`"
                                label="Option Label"
                                placeholder="Featured"
                              />
                              <edge-shad-input
                                v-model="option.value"
                                :name="`wizardControlOptionValue-${controlIndex}-${optionIndex}`"
                                label="Option Value"
                                placeholder="featured"
                              />
                              <edge-shad-button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="mt-7 h-9 w-9 text-red-600"
                                aria-label="Remove option"
                                @click="removeTemplateV2WizardControlOptionRow(control, optionIndex)"
                              >
                                <Trash2 class="h-4 w-4" />
                              </edge-shad-button>
                            </div>
                            <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2WizardControlOptionRow(control)">
                              <Plus class="h-3.5 w-3.5" />
                              Add Option
                            </edge-shad-button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <edge-shad-button type="button" size="sm" variant="outline" class="h-8 gap-2" @click="addTemplateV2WizardControlRow">
                      <Plus class="h-3.5 w-3.5" />
                      Add Control
                    </edge-shad-button>
                  </div>

                  <div v-else class="space-y-4">
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      Review the data source JSON that will be inserted. Use the main JSON editor for advanced fields such as a custom fallback value.
                    </div>
                    <div>
                      <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        JSON to insert
                      </div>
                      <pre class="max-h-[240px] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50"><code>{{ previewTemplateV2WizardDataSourceJson }}</code></pre>
                    </div>
                  </div>

                  <p v-if="state.dataSourceWizardError" class="text-sm text-red-600">
                    {{ state.dataSourceWizardError }}
                  </p>

                  <DialogFooter>
                    <edge-shad-button type="button" variant="outline" @click="closeTemplateV2DataSourceWizard">
                      Cancel
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.dataSourceWizardMode === 'add' && state.dataSourceWizardStep > 1"
                      type="button"
                      variant="outline"
                      @click="state.dataSourceWizardStep -= 1"
                    >
                      Back
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.dataSourceWizardMode === 'add' && state.dataSourceWizardStep < 5"
                      type="button"
                      @click="goTemplateV2WizardStep(state.dataSourceWizardStep + 1)"
                    >
                      Next
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="state.dataSourceWizardMode === 'edit' || state.dataSourceWizardStep === 5"
                      type="button"
                      class="bg-slate-900 text-white hover:bg-slate-700"
                      @click="addTemplateV2DataSourceFromWizard(slotProps.workingDoc)"
                    >
                      {{ state.dataSourceWizardMode === 'edit' ? 'Save' : 'Add' }}
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
              <edge-shad-dialog v-model="state.templateDeleteDialogOpen">
                <DialogContent class="max-w-[460px]">
                  <DialogHeader>
                    <DialogTitle>{{ templateV2DeleteDialogTitle }}</DialogTitle>
                    <DialogDescription>
                      {{ templateV2DeleteDialogDescription }}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <edge-shad-button type="button" variant="outline" @click="closeTemplateV2DeleteDialog">
                      Cancel
                    </edge-shad-button>
                    <edge-shad-button type="button" class="bg-red-700 text-white hover:bg-red-600" @click="confirmTemplateV2Delete">
                      Delete
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
              <edge-cms-code-editor
                v-if="!isWorkingTemplateV2Doc(slotProps.workingDoc) || state.templateEditorTab === 'template'"
                ref="contentEditorRef"
                :model-value="slotProps.workingDoc.content"
                :title="isWorkingTemplateV2Doc(slotProps.workingDoc) ? 'Template' : 'Block Content'"
                :title-class="isWorkingTemplateV2Doc(slotProps.workingDoc) ? 'text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300' : undefined"
                :menu-class="isWorkingTemplateV2Doc(slotProps.workingDoc) ? 'px-0 pt-0 pb-3 bg-transparent dark:bg-transparent border-b-0 rounded-none' : undefined"
                language="handlebars"
                name="content"
                :enable-formatting="!isWorkingTemplateV2Doc(slotProps.workingDoc)"
                height="calc(100vh - 316px)"
                class="mb-0 flex-1"
                @update:model-value="syncWorkingTemplateContent(slotProps.workingDoc, $event)"
                @line-click="payload => handleEditorLineClick(payload, slotProps.workingDoc)"
              >
                <template #end-actions>
                  <DropdownMenu v-if="!isWorkingTemplateV2Doc(slotProps.workingDoc)">
                    <DropdownMenuTrigger as-child>
                      <edge-shad-button
                        type="button"
                        size="sm"
                        variant="ghost"
                        class="h-8 px-3 text-[11px] uppercase tracking-wide rounded border border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                      >
                        Insert Field
                      </edge-shad-button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-72">
                      <DropdownMenuItem
                        v-for="snippet in BLOCK_CONTENT_SNIPPETS"
                        :key="snippet.label"
                        class="cursor-pointer flex-col items-start gap-0.5"
                        @click="insertBlockContentSnippet(snippet.snippet)"
                      >
                        <span class="text-sm font-medium">{{ snippet.label }}</span>
                        <span class="text-xs text-muted-foreground whitespace-normal">{{ snippet.description }}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <template v-else>
                    <edge-shad-button
                      type="button"
                      size="sm"
                      variant="ghost"
                      class="h-8 gap-2 rounded border border-slate-300 bg-white px-3 text-[11px] uppercase tracking-wide text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                      @click="openV2DynamicContentDialog(slotProps.workingDoc)"
                    >
                      Insert Field
                    </edge-shad-button>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <edge-shad-button
                          type="button"
                          size="sm"
                          variant="ghost"
                          class="h-8 gap-2 rounded border border-slate-300 bg-white px-3 text-[11px] uppercase tracking-wide text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100"
                        >
                          Formatter
                        </edge-shad-button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-56">
                        <DropdownMenuItem
                          v-for="formatter in v2TemplateFormatterOptions"
                          :key="formatter.name"
                          class="cursor-pointer"
                          @click="applyTemplateInlineFormatter(formatter.name)"
                        >
                          {{ formatter.title }}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </template>
                </template>
              </edge-cms-code-editor>
              <div v-if="isWorkingTemplateV2Doc(slotProps.workingDoc) && slotProps.workingDoc.templateConversion?.warnings?.length" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div class="mb-1 font-semibold uppercase tracking-wide">
                  Conversion Notes
                </div>
                <ul class="list-disc space-y-1 pl-4">
                  <li v-for="warning in slotProps.workingDoc.templateConversion.warnings" :key="warning">
                    {{ warning }}
                  </li>
                </ul>
              </div>
              <edge-shad-dialog v-model="state.v2DynamicContentDialogOpen">
                <DialogContent class="max-w-[680px]">
                  <DialogHeader>
                    <DialogTitle>Add Dynamic Field</DialogTitle>
                    <DialogDescription>
                      Insert a token or loop for a field that already exists in this block.
                    </DialogDescription>
                  </DialogHeader>
                  <div class="space-y-4">
                    <edge-shad-select
                      v-if="getV2DynamicContentItems(slotProps.workingDoc).length"
                      v-model="state.v2DynamicField.selectedKey"
                      name="v2DynamicContentField"
                      label="Field"
                      :items="getV2DynamicContentItems(slotProps.workingDoc)"
                      @update:model-value="handleV2DynamicFieldSelected"
                    />
                    <div
                      v-if="isSelectedV2DynamicNestedDataSource(slotProps.workingDoc)"
                      class="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                    >
                      <edge-shad-checkbox
                        v-model="state.v2DynamicField.useParentArrayLookup"
                        name="v2DynamicUseParentArrayLookup"
                        label="Use parent lookup?"
                        class="border-slate-400 bg-white text-slate-900 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                      >
                        <span class="text-sm text-slate-900 dark:text-slate-100">Build a nested lookup from the parent item</span>
                      </edge-shad-checkbox>
                      <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Use this when the nested source should load records from a field on the current parent item.
                      </p>
                      <div v-if="state.v2DynamicField.useParentArrayLookup" class="mt-3 grid gap-3">
                        <div class="grid gap-3 md:grid-cols-[1fr_96px]">
                          <edge-shad-select
                            v-model="state.v2DynamicField.parentArrayLookupMode"
                            name="v2DynamicParentArrayLookupMode"
                            label="Lookup Type"
                            :items="v2DynamicParentArrayLookupModeOptions"
                            @update:model-value="handleV2DynamicLookupModeSelected"
                          />
                          <edge-shad-input
                            v-model="state.v2DynamicField.canonicalLookupLimit"
                            name="v2DynamicCanonicalLookupLimit"
                            type="number"
                            label="Limit"
                            placeholder="0"
                          />
                        </div>
                        <div class="space-y-1 md:col-span-2">
                          <edge-shad-input
                            v-model="state.v2DynamicField.parentArrayField"
                            name="v2DynamicParentArrayField"
                            label="Parent Lookup Field"
                            placeholder="relatedIds"
                          />
                          <p class="text-xs text-slate-500 dark:text-slate-400">
                            The field on the current parent item that provides the lookup value. If the parent loop is <code>agent</code> and this is <code>credentials</code>, the inserted Template uses <code>agent.credentials</code>.
                          </p>
                        </div>
                        <template v-if="state.v2DynamicField.parentArrayLookupMode === 'queryItems'">
                          <div class="space-y-1 md:col-span-2">
                            <edge-shad-input
                              v-model="state.v2DynamicField.indexedLookupField"
                              name="v2DynamicIndexedLookupField"
                              label="Indexed Field"
                              placeholder="categoryId"
                            />
                            <p class="text-xs text-slate-500 dark:text-slate-400">
                              The indexed field on the records being loaded. The generated query matches this field against the parent lookup field above.
                            </p>
                          </div>
                        </template>
                        <p class="text-xs text-slate-500 md:col-span-2 dark:text-slate-400">
                          The inserted Template calls <code>source(...)</code> with either <code>canonicalLookup</code> or <code>queryItems</code>, using the current parent item for the lookup value.
                        </p>
                      </div>
                    </div>
                    <div
                      v-if="!getV2DynamicContentItems(slotProps.workingDoc).length"
                      class="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      Add an input or data source first, then return here to insert it.
                    </div>
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      To add new fields, use the Inputs tab or add a Data Source first. Dynamic Fields only inserts fields that already exist in this block.
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <edge-shad-button type="button" size="sm" variant="outline" @click="goToTemplateV2SchemaFromDynamicContent">
                        Add Input
                      </edge-shad-button>
                      <edge-shad-button type="button" size="sm" variant="outline" @click="goToTemplateV2DataSourcesFromDynamicContent">
                        Add Data Source
                      </edge-shad-button>
                    </div>
                  </div>
                  <DialogFooter class="pt-4 flex justify-between">
                    <edge-shad-button type="button" variant="outline" @click="state.v2DynamicContentDialogOpen = false">
                      Cancel
                    </edge-shad-button>
                    <edge-shad-button
                      type="button"
                      class="bg-slate-800 text-white hover:bg-slate-700"
                      :disabled="!canInsertV2DynamicContent(slotProps.workingDoc)"
                      @click.stop.prevent="addV2DynamicContent(slotProps.workingDoc)"
                    >
                      Insert
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
              <edge-shad-dialog v-model="state.instructionsDialogOpen">
                <DialogContent class="max-w-[760px]">
                  <DialogHeader>
                    <DialogTitle>Block Instructions</DialogTitle>
                    <DialogDescription>
                      Add usage guidance for this block. This helps users understand how to use the block and appears in the Edit Block screen above the field inputs.
                    </DialogDescription>
                  </DialogHeader>
                  <edge-shad-html
                    v-model="slotProps.workingDoc[BLOCK_INSTRUCTIONS_FIELD_KEY]"
                    :enabled-toggles="instructionsEnabledToggles"
                    :enable-links="true"
                    name="blockInstructions"
                    label="Instructions"
                  />
                  <DialogFooter class="pt-4 flex justify-between">
                    <edge-shad-button type="button" variant="destructive" class="text-white" @click="state.instructionsDialogOpen = false">
                      Close
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
              <edge-shad-dialog v-model="state.aiInstructionsDialogOpen">
                <DialogContent class="max-w-[760px]">
                  <DialogHeader>
                    <DialogTitle>AI Instructions</DialogTitle>
                    <DialogDescription>
                      Add private guidance used only for block AI generation. This is not shown in the block edit UI for end users.
                    </DialogDescription>
                  </DialogHeader>
                  <edge-shad-textarea
                    v-model="slotProps.workingDoc[BLOCK_AI_INSTRUCTIONS_FIELD_KEY]"
                    name="blockAiInstructions"
                    label="AI Instructions"
                    placeholder="Share tone, audience, and generation constraints for this block."
                  />
                  <DialogFooter class="pt-4 flex justify-between">
                    <edge-shad-button type="button" variant="destructive" class="text-white" @click="state.aiInstructionsDialogOpen = false">
                      Close
                    </edge-shad-button>
                  </DialogFooter>
                </DialogContent>
              </edge-shad-dialog>
            </div>
            <div class="w-1/2 space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Viewport</span>
                <div class="ml-auto flex shrink-0 items-center gap-2">
                  <div class="flex shrink-0 items-center gap-1 flex-nowrap">
                    <edge-shad-select
                      v-model="state.previewScale"
                      :items="previewScaleOptions"
                      placeholder="%"
                      class="w-[84px] shrink-0"
                      trigger-class="!h-7 min-h-7 px-2 py-1 text-xs"
                    />
                    <edge-shad-button
                      v-for="option in previewViewportOptions"
                      :key="option.id"
                      type="button"
                      size="icon"
                      variant="ghost"
                      class="h-[28px] w-[28px] shrink-0 text-xs border transition-colors"
                      :class="state.previewViewport === option.id ? 'bg-slate-700 text-white border-slate-700 shadow-sm dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'"
                      @click="setPreviewViewport(option.id)"
                    >
                      <component :is="option.icon" class="w-3.5 h-3.5" />
                    </edge-shad-button>
                  </div>
                  <label v-if="previewAuthToggleVisible" class="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800">
                    <Checkbox
                      :model-value="!state.previewAuthLoggedIn"
                      aria-label="Block preview logged out"
                      @update:model-value="setPreviewAuthMode(!Boolean($event))"
                    />
                    Preview logged out
                  </label>
                </div>
              </div>
              <div
                class="w-full mx-auto rounded-none overflow-visible"
                :style="previewViewportContainStyle"
              >
                <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30" :class="[previewSurfaceClass, previewAuthClass]" style="transform: translateZ(0);">
                  <edge-cms-block
                    v-if="state.previewBlock"
                    :key="previewThemeRenderKey"
                    v-model="state.previewBlock"
                    class="!h-[calc(100vh-300px)] overflow-y-auto"
                    :site-id="edgeGlobal.edgeState.blockEditorSite"
                    :render-context="state.previewRenderContext"
                    :theme="theme"
                    :edit-mode="true"
                    :contain-fixed="true"
                    :disable-interactive-preview-in-edit="false"
                    :suppress-interactive-clicks-except-allowed="true"
                    :allow-delete="false"
                    :standalone-preview="true"
                    :viewport-mode="previewViewportMode"
                    :block-id="state.previewBlock.id"
                    @delete="ignorePreviewDelete"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
    <edge-shad-dialog v-model="state.historyDialogOpen">
      <DialogContent class="max-w-[96vw] max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="text-left">
            Block History
          </DialogTitle>
          <DialogDescription class="text-left">
            Select a saved version, preview it, and restore it if needed.
          </DialogDescription>
        </DialogHeader>
        <div class="min-w-0 space-y-4">
          <div class="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
            <div class="flex min-w-0 flex-col justify-end">
              <edge-shad-combobox
                v-model="state.historySelectedId"
                name="blockHistoryVersion"
                label="History Entry"
                :items="historyVersionItems"
                placeholder="Select a history entry"
                class="w-full"
                :disabled="state.historyLoading || state.historyRestoring || historyVersionItems.length === 0"
              />
            </div>
            <div class="mb-2 flex min-w-0 flex-col justify-end">
              <edge-shad-button
                v-if="hasHistoryDiff"
                type="button"
                variant="outline"
                class="h-10 justify-between gap-3 px-3 text-left"
                :disabled="!selectedHistoryEntry || state.historyLoading"
                @click="state.showHistoryDiffDialog = true"
              >
                <span class="truncate">View Diff</span>
                <span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {{ historyDiffCountLabel }}
                </span>
              </edge-shad-button>
              <div
                v-else-if="!selectedHistoryEntry && !state.historyLoading"
                class="rounded-md border border-slate-300/70 bg-slate-50 mb-1 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
              >
                No older saved versions differ from the current block.
              </div>
            </div>
          </div>

          <div v-if="state.historyError" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {{ state.historyError }}
          </div>

          <div
            v-if="state.editorHasUnsavedChanges"
            class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            There are unsaved changes. History compares saved versions of this block.
          </div>

          <div class="min-w-0 rounded-md border border-slate-300 bg-card dark:border-slate-700">
            <div
              v-if="state.historyLoading"
              class="flex h-[70vh] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              Loading history preview...
            </div>
            <div
              v-else-if="!state.historyPreviewBlock"
              class="flex h-[70vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              No older saved versions are available to preview.
            </div>
            <div
              v-else
              class="w-full mx-auto rounded-none overflow-visible"
              :style="previewViewportContainStyle"
            >
              <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30" :class="[previewSurfaceClass, previewAuthClass]" style="transform: translateZ(0);">
                <edge-cms-block
                  v-model="state.historyPreviewBlock"
                  class="!h-[70vh] overflow-y-auto"
                  :site-id="edgeGlobal.edgeState.blockEditorSite"
                  :render-context="state.previewRenderContext"
                  :theme="theme"
                  :edit-mode="false"
                  :contain-fixed="true"
                  :disable-interactive-preview-in-edit="false"
                  :suppress-interactive-clicks-except-allowed="true"
                  :allow-delete="false"
                  :standalone-preview="true"
                  :viewport-mode="previewViewportMode"
                  :block-id="state.historyPreviewBlock.id"
                  @delete="ignorePreviewDelete"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" :disabled="state.historyRestoring" @click="closeHistoryDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            :disabled="state.historyLoading || state.historyRestoring || !selectedHistoryEntry"
            @click="restoreHistoryVersion"
          >
            <Loader2 v-if="state.historyRestoring" class="mr-2 h-4 w-4 animate-spin" />
            <RotateCcw v-else class="mr-2 h-4 w-4" />
            Restore
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.showHistoryDiffDialog">
      <DialogContent class="max-w-[96vw] max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="text-left">
            History Diff
          </DialogTitle>
          <DialogDescription class="text-left">
            Review differences between the selected history entry and the current block.
          </DialogDescription>
        </DialogHeader>
        <div class="mt-2 flex-1 overflow-y-auto pr-1">
          <div v-if="historyDiffDetails.length" class="space-y-3">
            <div
              v-for="change in historyDiffDetails"
              :key="change.key"
              class="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 p-3 text-left"
            >
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                {{ change.label }}
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                  <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                    {{ change.baseLabel || 'Selected History' }}
                  </div>
                  <div
                    class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100"
                    :class="change.key === 'content' ? 'font-mono text-xs leading-5' : ''"
                    v-html="change.baseHtml || change.base"
                  />
                  <div
                    v-if="change.key === 'content' && historyDiffBasePreviewBlock"
                    class="mt-3 rounded-md border border-slate-300 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div
                      class="w-full mx-auto overflow-hidden drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30"
                      :class="[previewAuthClass, getPreviewSurfaceClass(historyDiffBasePreviewBlock)]"
                      :style="previewViewportContainStyle"
                    >
                      <edge-cms-block
                        :model-value="historyDiffBasePreviewBlock"
                        class="max-h-[32vh] overflow-y-auto"
                        :site-id="edgeGlobal.edgeState.blockEditorSite"
                        :render-context="state.previewRenderContext"
                        :theme="theme"
                        :edit-mode="false"
                        :contain-fixed="true"
                        :disable-interactive-preview-in-edit="false"
                        :suppress-interactive-clicks-except-allowed="true"
                        :allow-delete="false"
                        :viewport-mode="previewViewportMode"
                        :block-id="historyDiffBasePreviewBlock.id"
                        @delete="ignorePreviewDelete"
                      />
                    </div>
                  </div>
                </div>
                <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                  <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                    {{ change.compareLabel || 'Current' }}
                  </div>
                  <div
                    class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100"
                    :class="change.key === 'content' ? 'font-mono text-xs leading-5' : ''"
                    v-html="change.compareHtml || change.compare"
                  />
                  <div
                    v-if="change.key === 'content' && historyDiffComparePreviewBlock"
                    class="mt-3 rounded-md border border-slate-300 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div
                      class="w-full mx-auto overflow-hidden drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30"
                      :class="[previewAuthClass, getPreviewSurfaceClass(historyDiffComparePreviewBlock)]"
                      :style="previewViewportContainStyle"
                    >
                      <edge-cms-block
                        :model-value="historyDiffComparePreviewBlock"
                        class="max-h-[32vh] overflow-y-auto"
                        :site-id="edgeGlobal.edgeState.blockEditorSite"
                        :render-context="state.previewRenderContext"
                        :theme="theme"
                        :edit-mode="false"
                        :contain-fixed="true"
                        :disable-interactive-preview-in-edit="false"
                        :suppress-interactive-clicks-except-allowed="true"
                        :allow-delete="false"
                        :viewport-mode="previewViewportMode"
                        :block-id="historyDiffComparePreviewBlock.id"
                        @delete="ignorePreviewDelete"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-4">
          <edge-shad-button class="w-full" variant="outline" @click="state.showHistoryDiffDialog = false">
            Close
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <Sheet v-model:open="state.helpOpen">
      <SheetContent side="right" class="!w-screen !max-w-none sm:!max-w-none md:!max-w-none">
        <SheetHeader>
          <SheetTitle class="text-left">
            Block Editor Guide
          </SheetTitle>
          <SheetDescription class="text-left text-sm text-muted-foreground">
            Everything about blocks: how fields are built, how data loads, which options exist, and how the editor renders.
          </SheetDescription>
        </SheetHeader>
        <div class="px-6 pb-6" @click="handleGuideShortcutClick">
          <Tabs class="w-full" default-value="guide">
            <TabsList class="w-full mt-3 rounded-sm grid grid-cols-8 border border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800">
              <TabsTrigger value="guide" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Block Guide
              </TabsTrigger>
              <TabsTrigger value="arrays" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Arrays
              </TabsTrigger>
              <TabsTrigger value="carousel" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Carousels
              </TabsTrigger>
              <TabsTrigger value="form-helpers" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Forms
              </TabsTrigger>
              <TabsTrigger value="publications" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Publications
              </TabsTrigger>
              <TabsTrigger value="auth-helpers" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Auth
              </TabsTrigger>
              <TabsTrigger value="nav-bar" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Nav
              </TabsTrigger>
              <TabsTrigger value="scroll-reveals" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                Scroll Reveals
              </TabsTrigger>
            </TabsList>

            <TabsContent value="guide">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-8">
                  <div class="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick Menu
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2 text-xs">
                      <a href="#block-overview" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Overview</a>
                      <a href="#v2-workflow" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Template v2 Flow</a>
                      <a href="#v2-template" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Template</a>
                      <a href="#v2-inputs" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Inputs</a>
                      <a href="#v2-data-sources" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Data Sources</a>
                      <a href="#v2-dynamic-fields" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Dynamic Fields</a>
                      <a href="#legacy-tags" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Legacy Tags</a>
                      <a href="#block-settings" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Settings</a>
                      <a href="#input-types" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Inputs</a>
                      <a href="#image-fields" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Images</a>
                      <a href="#select-options" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Selects</a>
                      <a href="#rendering-rules" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Rendering</a>
                      <a href="#loading-tokens" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Loading</a>
                      <a href="#validation" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Validation</a>
                      <a href="#stored-data" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Stored Data</a>
                      <a href="#preview-placeholders" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Preview</a>
                      <a href="#json-editor" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">JSON Editor</a>
                      <a href="#common-mistakes" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Mistakes</a>
                      <a href="#indexes-kv" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Indexes + KV</a>
                    </div>
                  </div>
                  <section id="block-overview" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What A Block Is
                    </h3>
                    <p class="text-sm text-foreground">
                      A block is a reusable piece of page markup. In Template v2, the block has three main parts:
                      the Template, Inputs, and Data Sources.
                    </p>
                    <p class="text-sm text-foreground">
                      The Template controls the HTML that renders. Inputs are the fields a page editor can fill out.
                      Data Sources load lists or records from an API or collection. The preview renders all of that together.
                    </p>
                  </section>

                  <section id="v2-workflow" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Template v2 Workflow
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><strong>1. Template:</strong> Write the HTML and place tokens where values should render.</div>
                      <div><strong>2. Inputs:</strong> Add fields the page editor can fill out, such as text, image, select, array, or publication.</div>
                      <div><strong>3. Data Sources:</strong> Add API or collection data when the block needs a list or record from outside the page editor.</div>
                      <div><strong>4. Dynamic Fields:</strong> Insert existing Inputs or Data Sources into the template without typing tokens by hand.</div>
                      <div><strong>5. Formatter:</strong> Apply display formatting such as money, number, date, integer, or rich text where the value is used.</div>
                    </div>
                    <div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      For Template v2 blocks, do not create editable fields by adding old triple-brace tags. Add fields in the Inputs tab, then insert them into the Template with Dynamic Fields.
                    </div>
                  </section>

                  <section id="v2-template" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Template Tab
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>The Template tab is where the block's HTML lives.</div>
                      <div>Use <code v-pre>{{ heading }}</code> for an Input named <code>heading</code>.</div>
                      <div>Use <code v-pre>{{ money(price) }}</code>, <code v-pre>{{ number(count) }}</code>, or <code v-pre>{{ richtext(body) }}</code> when a value needs display formatting.</div>
                      <div>When looping over a Data Source, use the alias in the loop and on the values inside the loop.</div>
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;section class="space-y-4"&gt;
  &lt;h2&gt;{{ heading }}&lt;/h2&gt;
  &lt;div&gt;{{ richtext(body) }}&lt;/div&gt;

  {{#for property in source("featuredProperties")}}
    &lt;article&gt;
      &lt;h3&gt;{{ property.display_address }}&lt;/h3&gt;
      &lt;p&gt;{{ money(property.listing_price) }}&lt;/p&gt;
    &lt;/article&gt;
  {{/for}}
&lt;/section&gt;</code></pre>
                  </section>

                  <section id="v2-inputs" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Inputs Tab
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Inputs are the fields a page editor sees when they click the block on a page.</div>
                      <div>Use <strong>Add Input</strong> to create a new field. Click an existing input row to edit it.</div>
                      <div>The Field Key is the token name used in the Template. Keep it short and predictable, such as <code>heading</code>, <code>buttonText</code>, or <code>heroImage</code>.</div>
                      <div>The Label is what the page editor sees.</div>
                      <div>The Default tab appears only when that input type supports a useful default value.</div>
                      <div>The Settings tab appears only when the input type has extra settings, such as image tags, select options, array item fields, or publication effect.</div>
                    </div>
                  </section>

                  <section id="v2-data-sources" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Data Sources Tab
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Data Sources load information that the page editor should not type manually.</div>
                      <div>Use an API source for an outside URL that returns JSON.</div>
                      <div>Use a Collection source for records in the site or organization data store.</div>
                      <div>Use Indexed Lookup Values when a field is indexed and can narrow the fetch before records are returned.</div>
                      <div>Use After-Fetch Filters only when the index is missing or when the filter cannot be done as an indexed lookup.</div>
                      <div>Controls are optional fields shown when someone edits the block on a page. They can change API query string values or collection lookup values.</div>
                    </div>
                  </section>

                  <section id="v2-dynamic-fields" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Dynamic Fields And Formatter
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><strong>Dynamic Fields</strong> inserts an existing Input or Data Source into the Template.</div>
                      <div>Dynamic Fields does not create new fields. Add the Input or Data Source first, then insert it.</div>
                      <div><strong>Formatter</strong> wraps the selected token or value with a display formatter.</div>
                      <div>If the cursor is inside <code v-pre>{{ price }}</code> and you choose Money, the editor changes it to <code v-pre>{{ money(price) }}</code>.</div>
                    </div>
                  </section>

                  <section id="legacy-tags" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Legacy Tags
                    </h3>
                    <div class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      These triple-brace tags are the older block format. They are still useful when reading or converting older blocks, but Template v2 blocks should use Inputs and Data Sources instead.
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {"field":"headline","value":"Hello","title":"Headline"}}}}
{{{#textarea {"field":"intro","value":""}}}}
{{{#richtext {"field":"body","value":""}}}}
{{{#image {"field":"heroImage","value":"https://example.com/hero.jpg"}}}}</code></pre>
                  </section>

                  <section id="block-settings" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Block Settings (Top Row)
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><strong>Name</strong> is the library name of the block.</div>
                      <div><strong>Tags</strong> are for filtering blocks in the picker.</div>
                      <div><strong>Allowed Themes</strong> limits where this block can be used.</div>
                      <div><strong>Synced Block</strong> means edits are shared across all instances.</div>
                    </div>
                  </section>

                  <section id="input-types" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Input Types (What CMS Users See)
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>text</code> → single‑line input (HTML is escaped on render).</div>
                      <div><code>textarea</code> → multi‑line input (HTML is escaped on render).</div>
                      <div><code>richtext</code> → WYSIWYG editor (HTML is rendered as‑is).</div>
                      <div><code>number</code> → number input.</div>
                      <div><code>image</code> → image picker + preview.</div>
                      <div><code>publication</code> → publication picker that stores selected page image data.</div>
                      <div><code>array</code> → list editor (manual items) or data loader (API/collection).</div>
                    </div>
                    <p class="text-sm text-foreground">
                      Rich text image controls include size buttons, float left/none/right, and a width slider (10–100%).
                    </p>
                  </section>

                    <section id="image-fields" class="space-y-3">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Image Fields (Media Picker)
                      </h3>
                      <p class="text-sm text-foreground">
                        Add image fields from the Inputs tab. The Template uses the field key like any other Input.
                      </p>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;img src="{{ heroImage }}" alt="{{ heroAlt }}" class="w-full object-cover" /&gt;</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "heroImage": {
    "type": "image",
    "label": "Hero Image",
    "value": "",
    "tags": ["Backgrounds"],
    "variant": "public"
  },
  "cardImage": {
    "type": "image",
    "label": "Card Image",
    "value": "",
    "tags": ["Cards"],
    "variant": "thumbnail"
  }
}</code></pre>
                      <div class="text-sm text-foreground space-y-1">
                        <div><code>tags</code> filters the media manager to specific tag groups.</div>
                        <div><code>variant</code> chooses the Cloudflare Images variant saved into the block when the image is selected.</div>
                        <div>Current named Cloudflare variants used by this CMS are <code>public</code>, <code>thumbnail</code>, and <code>highres</code>. If <code>variant</code> is omitted, the media picker uses <code>public</code>.</div>
                        <div>Flexible variants are enabled. You can pass a Cloudflare flexible variant string such as <code>width=320,height=180,fit=cover,quality=85</code>; the CMS will replace the final variant segment of the selected Cloudflare Images URL.</div>
                      <div>The stored value is the image URL.</div>
                    </div>
                  </section>

                    <section id="select-options" class="space-y-3">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Select / Options Fields
                      </h3>
                      <p class="text-sm text-foreground">
                        Choose Select in the Inputs editor when a page editor should pick from a fixed list. The friendly editor writes <code>type: "option"</code> in the schema JSON.
                      </p>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;section class="{{ layout }}"&gt;
  {{ heading }}
&lt;/section&gt;</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "layout": {
    "type": "option",
    "label": "Layout",
    "value": "left",
    "option": {
      "options": [
        { "label": "Left", "value": "left" },
        { "label": "Right", "value": "right" }
      ],
      "optionsKey": "label",
      "optionsValue": "value"
    }
  }
}</code></pre>
                      <div class="text-sm text-foreground space-y-1">
                        <div>The friendly editor shows Label and Value for each option.</div>
                        <div>Advanced option shapes such as custom label/value keys can still be edited in JSON.</div>
                        <div>For options loaded from a collection, use Data Source Controls instead of a fixed Input option list.</div>
                      </div>
                    </section>

                  <section id="rendering-rules" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Rendering Rules
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>text</code> and <code>textarea</code> output is HTML‑escaped.</div>
                      <div><code>richtext</code> output is inserted as HTML.</div>
                      <div>Inline formatter output is HTML‑escaped by default (same safety behavior as normal text placeholders).</div>
                    </div>
                  </section>

                  <section id="inline-formatters" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Inline Formatters
                    </h3>
                    <p class="text-sm text-foreground">
                      You can now format values directly where they are used:
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{ date(post.publishDate) }}
{{ datetime(post.publishDate, "short") }}
{{ money(post.budget) }}
{{ number(post.squareFeet) }}
{{ integer(post.bedrooms) }}
{{ lower(menuItem.menuTitle) }}
{{ trim(site.tagline) }}
{{ slug(post.title) }}
{{ title(post.slug) }}
{{ richtext(post.body) }}
{{ default(post.summary, "Summary coming soon") }}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Supported formatter names: <code>date(value, options?)</code>, <code>datetime(value, options?)</code>, <code>money(value, options?)</code>, <code>number(value)</code>, <code>integer(value)</code>, <code>lower(value)</code>, <code>upper(value)</code>, <code>trim(value)</code>, <code>slug(value)</code>, <code>title(value)</code>, <code>deslug(value)</code>, <code>richtext(value)</code>, <code>default(value, fallback)</code>.</div>
                      <div>Existing schema/meta formatting (<code>number</code>, <code>money</code>, <code>richtext</code>, etc.) still works unchanged.</div>
                      <div>Inline formatter output is HTML-escaped by default; <code>richtext(value)</code> inserts trusted HTML.</div>
                    </div>

                    <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Basic Examples
                    </h4>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;h2&gt;{{ upper(post.title) }}&lt;/h2&gt;
&lt;p&gt;Published {{ date(post.publishDate, "long") }}&lt;/p&gt;
&lt;p&gt;Author handle: {{ slug(post.authorName) }}&lt;/p&gt;
&lt;p&gt;Slug label: {{ title(post.slug) }}&lt;/p&gt;
&lt;p&gt;Budget: {{ money(post.budget) }}&lt;/p&gt;
&lt;p&gt;{{ default(post.summary, "No summary available.") }}&lt;/p&gt;</code></pre>

                    <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Complex Examples
                    </h4>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;time datetime="{{ post.publishDate }}"&gt;
  {{ datetime(post.publishDate, {
    locale: "en-US",
    dateStyle: "full",
    timeStyle: "short"
  }) }}
&lt;/time&gt;

&lt;p&gt;
  {{ money(post.budget, {
    locale: "en-US",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) }}
&lt;/p&gt;</code></pre>

                      <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Arrays / Subarrays Example
                      </h4>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for event in events}}
  &lt;article&gt;
    &lt;h3&gt;{{ trim(event.title) }}&lt;/h3&gt;
    &lt;p&gt;{{ date(event.startAt, { locale: "en-US", month: "long", day: "numeric", year: "numeric" }) }}&lt;/p&gt;
    &lt;a href="/events/{{ slug(event.title) }}"&gt;Read more&lt;/a&gt;
  &lt;/article&gt;
{{/for}}</code></pre>
                    </section>

                  <section id="loading-tokens" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Loading Tokens
                    </h3>
                      <div class="text-sm text-foreground space-y-1">
                        <div><code v-pre>{{loading}}</code> is empty while loading and <code>hidden</code> when loaded.</div>
                        <div><code v-pre>{{loaded}}</code> is <code>hidden</code> while loading and empty when loaded.</div>
                        <div>These tokens only change when the block is waiting on API or collection data.</div>
                      </div>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div class="skeleton {{ loading }}"&gt;Loading items...&lt;/div&gt;
&lt;div class="{{ loaded }}"&gt;
  {{#for item in source("items")}}
    &lt;div&gt;{{ item.title }}&lt;/div&gt;
  {{/for}}
&lt;/div&gt;</code></pre>
                    </section>

                    <section id="validation" class="space-y-2">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Validation Rules
                      </h3>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "title": {
    "type": "text",
    "label": "Title",
    "validation": { "required": true, "min": 5, "max": 80 }
  },
  "items": {
    "type": "array",
    "label": "Items",
    "schema": {
      "name": {
        "type": "text",
        "label": "Name",
        "validation": { "required": true }
      }
    },
    "value": []
  }
}</code></pre>
                      <div class="text-sm text-foreground space-y-1">
                        <div><code>required</code>, <code>min</code>, <code>max</code> are supported.</div>
                        <div>For numbers, <code>min</code>/<code>max</code> are numeric. For text/arrays they are length or item count.</div>
                    </div>
                  </section>

                  <section id="stored-data" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Editor vs Stored Data
                    </h3>
                    <p class="text-sm text-foreground">
                      The editor only shows fields in the current template. If a field is removed, it disappears,
                      but stored data stays. Add the field back later and the old data returns.
                    </p>
                  </section>

                  <section id="preview-placeholders" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Preview + Placeholders
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Empty fields show placeholder text or images in the preview.</div>
                      <div>Array previews show sample items if the list is empty.</div>
                      <div>Use the viewport buttons to test different screen sizes.</div>
                    </div>
                  </section>

                  <section id="json-editor" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      JSON Editors
                    </h3>
                    <p class="text-sm text-foreground">
                      Template v2 keeps the friendly controls and the raw JSON connected. Use <strong>Show JSON</strong>
                      on Inputs or Data Sources only when you need an advanced setting that the guided editor does not show.
                    </p>
                    <p class="text-sm text-foreground">
                      For older triple-brace blocks, clicking a line inside the code editor can still open the JSON Field Editor for that tag.
                    </p>
                  </section>

                  <section id="common-mistakes" class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Common Mistakes
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Typing a token in the Template before adding the matching Input or Data Source.</div>
                      <div>Using an unqualified value inside a Data Source loop. Prefer <code v-pre>{{ item.title }}</code> or the loop alias, such as <code v-pre>{{ property.title }}</code>.</div>
                      <div>Using After-Fetch Filters when an Indexed Lookup Value would narrow the fetch earlier.</div>
                      <div>Editing raw JSON and leaving invalid JSON, such as missing commas or quotes.</div>
                      <div>Using collection sort/order without confirming the matching index exists.</div>
                    </div>
                  </section>

                  <section id="indexes-kv" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Firestore Indexes + KV Sync (Required)
                    </h3>
                    <p class="text-sm text-foreground">
                      If you add a Firestore query (like <code>array-contains</code> + <code>order</code>), you must add the
                      matching composite index in <code>firestore.indexes.json</code>.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "collectionGroup": "listings",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "status",
      "arrayConfig": "CONTAINS"
    },
    {
      "fieldPath": "doc_created_at",
      "order": "DESCENDING"
    }
  ]
},</code></pre>
                    <p class="text-sm text-foreground">
                      If you want fast search/filtering in the CMS, you also need a KV mirror in Firebase Functions.
                      Example (use your collection + fields):
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>exports.onListingWritten = createKvMirrorHandlerFromFields({
  documentPath: 'organizations/{orgId}/listings',
  uniqueKey: '{orgId}',
  indexKeys: ['name', 'city', 'state', 'status'],
  metadataKeys: ['name', 'city', 'state', 'status', 'price', 'doc_created_at'],
})</code></pre>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="arrays">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-8">
                  <div class="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick Menu
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2 text-xs">
                      <a href="#arrays-manual" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Manual Arrays</a>
                      <a href="#arrays-firestore" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Firestore Arrays</a>
                      <a href="#arrays-api" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">API Arrays</a>
                      <a href="#arrays-filters" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Filters</a>
                      <a href="#arrays-query-flow" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Query Strategy</a>
                      <a href="#conditionals" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Conditionals</a>
                      <a href="#subarrays" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Subarrays</a>
                      <a href="#plain-array-limits" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Array Limits</a>
                      <a href="#nested-data-sources" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Nested Data Sources</a>
                      <a href="#render-blocks" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Render Blocks</a>
                      <a href="#entries" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Entries</a>
                    </div>
                  </div>

                  <section id="arrays-manual" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Arrays (Editable Lists)
                    </h3>
                    <p class="text-sm text-foreground">
                      Use an Array Input when a page editor should manually manage a repeatable list. Add the array from the Inputs tab, define Item Fields in Settings, and add optional Default Items there.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for card in cards}}
  &lt;article class="space-y-2"&gt;
    &lt;img src="{{ card.image }}" alt="{{ card.title }}" /&gt;
    &lt;h3&gt;{{ card.title }}&lt;/h3&gt;
    &lt;div&gt;{{ richtext(card.body) }}&lt;/div&gt;
  &lt;/article&gt;
{{/for}}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "cards": {
    "type": "array",
    "label": "Cards",
    "schema": {
      "title": { "type": "text", "label": "Title" },
      "body": { "type": "richtext", "label": "Body" },
      "image": { "type": "image", "label": "Image", "variant": "public" }
    },
    "value": [
      { "title": "First Card", "body": "", "image": "" }
    ]
  }
}</code></pre>
                    <p class="text-sm text-foreground">
                      Use <code>schema</code> when each item needs its own fields.
                      Supported item inputs are <code>text</code>, <code>textarea</code>, <code>richtext</code>, <code>image</code>, <code>number</code>, and <code>option</code>.
                    </p>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Manual arrays show an Add Entry form, drag handles for sorting, and delete buttons.</div>
                      <div>Default Items are saved on the array input as <code>value</code>. They seed new uses of the block but are not the same as page-specific edited values.</div>
                      <div>Inside the loop, use the alias you chose in the Template, such as <code v-pre>{{ card.title }}</code>.</div>
                      <div>Use an inline loop limit when only the first few items should render.</div>
                    </div>
                  </section>

                  <section id="arrays-firestore" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Collection Data Sources
                    </h3>
                    <p class="text-sm text-foreground">
                      Use a Collection Data Source when records come from the site or organization data store. Add it from the Data Sources tab, then loop with <code>source("name")</code>.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for person in source("teamMembers")}}
  &lt;article&gt;
    &lt;h3&gt;{{ person.name }}&lt;/h3&gt;
    &lt;p&gt;{{ person.role }}&lt;/p&gt;
  &lt;/article&gt;
{{/for}}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "teamMembers": {
    "type": "collection",
    "path": "team",
    "uniqueKey": "{orgId}:{siteId}",
    "queryItems": {
      "active": true
    },
    "query": [
      { "field": "department", "operator": "==", "value": "sales" }
    ],
    "order": [
      { "field": "name", "direction": "asc" }
    ],
    "limit": 6,
    "value": []
  },
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>path</code> is under <code>organizations/{orgId}</code>.</div>
                      <div><code>queryItems</code> should be the first choice for indexed lookups so the candidate list is narrowed before records are returned.</div>
                      <div><code>query</code> is an after-fetch filter. Use it only when the index is missing or the condition cannot be expressed as a lookup value.</div>
                      <div><code>uniqueKey</code> supports runtime tokens such as <code>{orgId}</code> and <code>{siteId}</code>. It is resolved in memory for runtime fetches and does not need to be persisted as a concrete value in the saved block.</div>
                      <div><code>collection.canonicalLookup.key</code> is optional. It also supports runtime tokens and CMS preview resolves them in memory before fetching the matching document directly.</div>
                      <div><code>order</code> controls the final sort order.</div>
                      <div><code>limit</code> caps the results.</div>
                    </div>
                  </section>

                  <section id="arrays-api" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      API Data Sources
                    </h3>
                    <p class="text-sm text-foreground">
                      Use an API Data Source when records come from a JSON endpoint. Add it from the Data Sources tab and loop it with <code>source("name")</code>.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for article in source("articles")}}
  &lt;article&gt;
    &lt;h3&gt;{{ article.title }}&lt;/h3&gt;
    &lt;p&gt;{{ article.summary }}&lt;/p&gt;
  &lt;/article&gt;
{{/for}}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "articles": {
    "type": "api",
    "api": "https://api.example.com/items",
    "apiField": "data",
    "apiQuery": "?limit=4",
    "limit": 4,
    "value": []
  }
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>api</code> is the base URL without the query string.</div>
                      <div><code>apiQuery</code> is appended to the URL.</div>
                      <div><code>apiField</code> tells the block which array to read from the response.</div>
                    </div>
                    <p class="text-sm text-foreground">
                      Data Source Controls can become query string parameters at runtime.
                    </p>
                  </section>

                  <section id="arrays-filters" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Data Source Controls
                    </h3>
                    <p class="text-sm text-foreground">
                      Controls are optional fields shown when someone edits the block on a page. For API sources, the control key is a query string key. For collection sources, the control key should usually match an indexed lookup field.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "properties": {
    "type": "api",
    "api": "https://api.example.com/properties",
    "apiField": "data",
    "controls": {
      "sort": {
        "type": "select",
        "label": "Sort",
        "options": [
          { "label": "Newest", "value": "-createdAt" },
          { "label": "Price", "value": "price" }
        ],
        "optionsKey": "label",
        "optionsValue": "value"
      },
      "city": {
        "type": "text",
        "label": "City",
        "placeholder": "Enter city"
      }
    },
    "value": []
  }
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Use the Data Source wizard to add controls instead of hand-writing JSON.</div>
                      <div>For collection sources, prefer controls that map to indexed lookup fields.</div>
                      <div>For API sources, controls become query string values.</div>
                      <div>Manual option lists use Label and Value. Collection-backed options can be set in the Controls tab.</div>
                    </div>
                  </section>

                  <section id="arrays-query-flow" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      How Array Queries Work
                    </h3>
                    <ol class="list-decimal pl-5 text-sm text-foreground space-y-1">
                      <li>Before runtime fetches, tokens in <code>query</code>, <code>queryItems</code>, <code>uniqueKey</code>, and <code>canonicalLookup.key</code> are resolved in memory only. Supported tokens include <code>{orgId}</code>, <code>{siteId}</code>, and <code>{routeLastSegment}</code>. The saved block keeps the original tokens.</li>
                      <li>Each entry in <code>queryItems</code> makes an indexed lookup through the KV index.</li>
                      <li>For a query key to work, that field must be included in your KV mirror config (in <code>indexKeys</code> and in <code>metadataKeys</code> for list rendering).</li>
                      <li>If you have more than one <code>queryItems</code> field, the runtime unions those matches into one candidate list (OR behavior at this stage).</li>
                      <li>Duplicate records are removed by <code>canonical</code>, so the same item only shows up once.</li>
                      <li>Only use <code>query</code> when a needed filter cannot use <code>queryItems</code>, usually because the field is not indexed yet or the condition cannot be represented as a KV indexed lookup.</li>
                      <li>After that, <code>query</code> filters candidates in JavaScript; all query clauses must pass for a record to survive.</li>
                      <li>Finally, <code>order</code> sorts the remaining records.</li>
                      <li>The finished list is available in the Template through <code>source("dataSourceName")</code>.</li>
                      <li>If the source cannot be loaded, the block falls back to the source <code>value</code>, or to an empty array if there is no fallback value.</li>
                    </ol>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>exports.onListingWritten = createKvMirrorHandlerFromFields({
  documentPath: 'organizations/{orgId}/listings',
  uniqueKey: '{orgId}',
  indexKeys: ['name', 'city', 'state', 'status'],
  metadataKeys: ['name', 'city', 'state', 'status', 'price', 'doc_created_at'],
})</code></pre>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Query Strategy
                    </h3>
                    <p class="text-sm text-foreground">
                      Use this setup when you want array queries to stay fast and predictable.
                    </p>
                    <div class="text-sm text-foreground space-y-1">
                      <div>1. Put every possible list-limiting indexed filter in <code>queryItems</code>. These should cut the candidate list down before KV returns records.</div>
                      <div>2. Use <code>collection.query</code> only for fields missing from the KV index or for conditions <code>queryItems</code> cannot express. Think of this as an exception path, not the default.</div>
                      <div>3. Use <code>collection.canonicalLookup.key</code> when you already know the exact document to fetch.</div>
                      <div>4. Put final sorting in <code>collection.order</code>.</div>
                      <div>5. Treat <code>queryOptions</code> as the editor UI for choosing filters. At runtime, the actual filtering is driven by <code>collection.query</code> and <code>queryItems</code>.</div>
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "eventsList": {
    "type": "collection",
    "path": "posts",
    "uniqueKey": "{orgId}:{siteId}",
    "queryItems": {
      "tags": ["program-spotlight"]
    },
    "query": [
      { "field": "type", "operator": "==", "value": "event" },
      { "field": "event.isPast", "operator": "==", "value": true }
    ],
    "order": [{ "field": "event.startAt", "direction": "asc" }],
    "value": []
  }
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>queryItems.tags</code> does the indexed lookup first.</div>
                      <div><code>collection.query</code> then keeps only records that are actually events and already in the past.</div>
                      <div><code>collection.order</code> sorts those remaining records by start date.</div>
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "siteDoc": {
    "type": "collection",
    "path": "sites",
    "canonicalLookup": {
      "key": "{orgId}:{siteId}"
    },
    "order": [],
    "value": []
  }
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Use <code>canonicalLookup.key</code> when the exact document key is already known.</div>
                      <div>For canonical-only fetches, <code>uniqueKey</code> and <code>limit</code> are not required.</div>
                    </div>
                  </section>

                  <section id="conditionals" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Conditionals (Inside Arrays)
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for property in source("properties")}}
  {{#if property.price}}
    &lt;div&gt;Price: {{ money(property.price) }}&lt;/div&gt;
  {{#else}}
    &lt;div&gt;Contact for pricing&lt;/div&gt;
  {{/if}}
{{/for}}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Prefer simple Template v2 conditionals around the field that controls the display.</div>
                      <div>Inside loops, qualify values with the loop alias, such as <code v-pre>{{ property.price }}</code>.</div>
                    </div>
                  </section>

                  <section id="subarrays" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Subarrays (Nested Lists)
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for card in cards}}
  &lt;h3&gt;{{ card.title }}&lt;/h3&gt;
  {{#for child in card.children}}
    &lt;div&gt;{{ child.title }}&lt;/div&gt;
  {{/for}}
{{/for}}</code></pre>
                    <p class="text-sm text-foreground">
                      Use clear aliases in each loop so nested values are unambiguous, such as <code v-pre>{{ card.title }}</code> and <code v-pre>{{ child.title }}</code>.
                    </p>
                  </section>

                  <section id="plain-array-limits" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Plain Array Limits
                    </h3>
                    <p class="text-sm text-foreground">
                      Use an inline limit when the list is already on the current item or Input value and you only want to render the first few rows.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for child in card.children, { limit: 3 }}}
  &lt;div&gt;{{ child.title }}&lt;/div&gt;
{{/for}}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for menuItem in site.menuItems, { limit: 5 }}}
  &lt;a href="{{ menuItem.url }}"&gt;{{ menuItem.name }}&lt;/a&gt;
{{/for}}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>This is for plain arrays already available in the current Template scope.</div>
                      <div>Data Source loops can also use limits, but those limits usually belong on the Data Source itself or in the <code>source(...)</code> override.</div>
                    </div>
                  </section>

                  <section id="nested-data-sources" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Nested Data Sources
                    </h3>
                    <p class="text-sm text-foreground">
                      Use a nested Data Source when the inner list needs a separate API or collection fetch. Pass the value from the outer loop into the nested <code>source(...)</code> call, and put normal result limits on the nested Data Source or source override.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for author in source("authors")}}
  &lt;article&gt;
    &lt;h3&gt;{{ author.name }}&lt;/h3&gt;

    {{#for post in source("authorPosts", {
      queryItems: { authorId: author.id }
    })}}
      &lt;a href="/posts/{{ post.slug }}"&gt;{{ post.title }}&lt;/a&gt;
    {{/for}}
  &lt;/article&gt;
{{/for}}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "authors": {
    "type": "collection",
    "path": "authors",
    "uniqueKey": "{orgId}:{siteId}",
    "queryItems": {
      "active": true
    },
    "order": [{ "field": "name", "direction": "asc" }],
    "limit": 12,
    "value": []
  },
  "authorPosts": {
    "type": "collection",
    "path": "posts",
    "uniqueKey": "{orgId}:{siteId}",
    "order": [{ "field": "publishedAt", "direction": "desc" }],
    "limit": 3,
    "value": []
  }
}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Use normal subarray loops when the nested list is already on the current item, such as <code>author.links</code>.</div>
                      <div>Use nested Data Sources when the nested list must be fetched separately.</div>
                      <div>The scoped <code>queryItems</code> passed in the Template narrows the nested source for the current outer item.</div>
                      <div>The nested source <code>limit</code> can stay in <code>dataSources</code>, or be passed inline when the limit depends on the loop context.</div>
                    </div>
                  </section>

                  <section id="render-blocks" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Render Blocks (Post/Page Block Content)
                    </h3>
                    <p class="text-sm text-foreground">
                      Use rendered block content only when an object inside the source contains CMS block content, such as a post body.
                    </p>
                    <p class="text-sm text-foreground">
                      This is still a specialized/advanced path. For normal lists, render fields directly inside the <code>#for</code> loop.
                    </p>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for post in source("posts")}}
  &lt;article&gt;
    &lt;h2&gt;{{ post.name }}&lt;/h2&gt;
    &lt;div&gt;{{ richtext(post.summary) }}&lt;/div&gt;
  &lt;/article&gt;
{{/for}}</code></pre>
                  </section>

                  <section id="entries" class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Entries (Object Key/Value Loops)
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{#for setting in entries(settings)}}
  &lt;div&gt;&lt;strong&gt;{{ setting.key }}&lt;/strong&gt;: {{ setting.value }}&lt;/div&gt;
{{/for}}</code></pre>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Use entries-style loops only when a value is an object and you need its keys as labels.</div>
                      <div>Each row should expose a key and value. If the value is an array, use a normal nested <code>#for</code> loop over that value.</div>
                      <div>If the object shape is predictable, an Array Input is usually easier for page editors.</div>
                    </div>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="carousel">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-6">
                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What This Does
                    </h3>
                    <p class="text-sm text-foreground">
                      Add <code>data-carousel</code> markup to any CMS block and the runtime auto-initializes Embla on the client.
                    </p>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick Start
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div
  data-carousel
  class="relative overflow-hidden"
  data-carousel-autoplay
  data-carousel-interval="4000"
  data-carousel-loop
  data-carousel-slides-to-scroll="1"
    data-carousel-slides-to-scroll-lg="3"
  &gt;
    &lt;div data-carousel-track class="flex"&gt;
      {{#for slide in slides}}
        &lt;div class="shrink-0 min-w-0 flex-[0_0_100%] lg:flex-[0_0_33.333%] p-4"&gt;
          &lt;div class="bg-white shadow rounded p-6 h-40 flex items-center justify-center"&gt;
            {{ slide.header }}
          &lt;/div&gt;
        &lt;/div&gt;
      {{/for}}
    &lt;/div&gt;

  &lt;button type="button" data-carousel-prev class="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 text-white rounded-full"&gt;‹&lt;/button&gt;
  &lt;button type="button" data-carousel-next class="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 text-white rounded-full"&gt;›&lt;/button&gt;
  &lt;div data-carousel-dots class="mt-3 flex justify-center gap-2"&gt;&lt;/div&gt;
  &lt;/div&gt;</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "slides": {
    "type": "array",
    "label": "Slides",
    "schema": {
      "header": { "type": "text", "label": "Header" }
    },
    "value": [
      { "header": "One" },
      { "header": "Two" },
      { "header": "Three" }
    ]
  }
}</code></pre>
                    </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Required Markup
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>[data-carousel]</code> is the root element.</div>
                      <div><code>[data-carousel-track]</code> is the Embla container and should be <code>display:flex</code>.</div>
                      <div>Each slide should be <code>shrink-0</code> with an explicit basis (for example <code>flex-[0_0_100%]</code>).</div>
                      <div>Keep <code>overflow-hidden</code> on the root, not the track.</div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Supported Data Attributes
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>data-carousel-autoplay</code> enables autoplay (off by default).</div>
                      <div><code>data-carousel-interval="MS"</code> autoplay delay in ms (default <code>5000</code>).</div>
                      <div><code>data-carousel-loop</code> enables looping.</div>
                      <div><code>data-carousel-transition="fade"</code> uses Embla Fade plugin.</div>
                      <div><code>data-carousel-fade-duration="MS"</code> fade duration in ms (default <code>200</code>).</div>
                      <div><code>data-carousel-no-pause</code> keeps autoplay running through hover/interaction.</div>
                      <div><code>data-carousel-slides-to-scroll="N"</code> base slidesToScroll (default <code>1</code>).</div>
                      <div><code>data-carousel-slides-to-scroll-md="N"</code> at <code>min-width: 768px</code>.</div>
                      <div><code>data-carousel-slides-to-scroll-lg="N"</code> at <code>min-width: 1024px</code>.</div>
                      <div><code>data-carousel-slides-to-scroll-xl="N"</code> at <code>min-width: 1280px</code>.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Behavior Notes
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>When <code>loop</code> is off, runtime uses <code>containScroll: "trimSnaps"</code>.</div>
                      <div>Prev/next controls are optional; in loop mode edge clicks wrap manually.</div>
                      <div>Dots are generated from Embla snap points, not raw slide count.</div>
                      <div>Breakpoints can change snap count, so dots/buttons are rebuilt on <code>reInit</code>.</div>
                      <div>Carousels are initialized once per root and tagged with <code>data-embla="true"</code>.</div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Common Patterns
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;!-- Single-slide fade --&gt;
&lt;div data-carousel data-carousel-transition="fade" data-carousel-fade-duration="800"&gt;...&lt;/div&gt;

&lt;!-- Multi-up desktop paging by 3 --&gt;
&lt;div data-carousel data-carousel-slides-to-scroll="1" data-carousel-slides-to-scroll-lg="3"&gt;...&lt;/div&gt;</code></pre>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="nav-bar">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-6">
                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What This Does
                    </h3>
                    <p class="text-sm text-foreground">
                      Use helper classes to make a CMS nav block interactive: hamburger toggle, right slide-out menu, close actions, and contained preview behavior.
                    </p>
                    <p class="text-sm text-foreground">
                      The runtime in <code>htmlContent.vue</code> auto-wires these helpers and marks them as interactive so they do not open the block editor when clicked.
                    </p>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Helper Class Contract
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>cms-nav-root</code>: nav behavior root (required).</div>
                      <div><code>cms-nav-item</code>: nav entry wrapper used for current-route detection (recommended for every route item).</div>
                      <div><code>cms-nav-toggle</code>: button that toggles open/closed (required).</div>
                      <div><code>cms-nav-panel</code>: right slide-out panel (required).</div>
                      <div><code>cms-nav-overlay</code>: backdrop click-to-close (optional but recommended).</div>
                      <div><code>cms-nav-close</code>: explicit close button in panel (optional).</div>
                      <div><code>cms-nav-link</code>: clickable route link; also closes panel on click and participates in current-route detection.</div>
                      <div><code>cms-nav-folder</code>: desktop folder wrapper for dropdown behavior (recommended).</div>
                      <div><code>cms-nav-folder-toggle</code>: desktop folder trigger link/button (recommended).</div>
                      <div><code>cms-nav-folder-menu</code>: desktop dropdown menu panel for folder items (recommended).</div>
                      <div><code>cms-nav-main</code>: optional hook for scroll/sticky/hide classes (defaults to first <code>&lt;nav&gt;</code>).</div>
                      <div><code>cms-nav-pos-right</code>, <code>cms-nav-pos-left</code>, <code>cms-nav-pos-center</code>: helper classes for menu position behavior.</div>
                      <div><code>cms-nav-layout</code>, <code>cms-nav-logo</code>, <code>cms-nav-desktop</code>: optional structure hooks for precise layout mapping.</div>
                      <div><code>cms-nav-sticky</code>: force sticky top behavior even if your nav did not include fixed classes.</div>
                      <div><code>cms-nav-hide-on-down</code>: hide nav on scroll down, show on scroll up.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Optional Root Attributes
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>data-cms-nav-open="true"</code> to start open.</div>
                      <div><code>data-cms-nav-open-class="your-class"</code> to change the root open class (default <code>is-open</code>).</div>
                      <div><code>data-cms-nav-close-on-link="false"</code> to keep panel open after link clicks.</div>
                      <div><code>data-cms-nav-position="right|left|center"</code> as an alternative to helper classes.</div>
                      <div><code>data-cms-nav-scrolled-class</code> / <code>data-cms-nav-top-class</code>: classes toggled on nav main target.</div>
                      <div><code>data-cms-nav-scrolled-row-class</code> / <code>data-cms-nav-top-row-class</code>: classes toggled on <code>cms-nav-layout</code> for shrink/expand.</div>
                      <div><code>data-cms-nav-scroll-threshold</code>: px before “scrolled” classes apply (default 10).</div>
                      <div><code>data-cms-nav-hide-on-down="true"</code>, <code>data-cms-nav-hide-threshold</code> (default 80), <code>data-cms-nav-hide-delta</code> (default 6).</div>
                      <div><code>data-cms-nav-hidden-class</code> / <code>data-cms-nav-visible-class</code> / <code>data-cms-nav-transition-class</code> for hide/show animation control.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Current Route Styling
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Mark each nav entry wrapper with <code>.cms-nav-item</code> or <code>data-cms-nav-item</code>.</div>
                      <div>Mark the actual clickable route link with <code>.cms-nav-link</code> or <code>data-cms-nav-link</code>.</div>
                      <div>Add <code>data-cms-nav-current-class="..."</code> to any element inside that item that should receive active-route classes.</div>
                      <div>Exact matches are current, and parent paths are also current. For example, <code>/services</code> matches both <code>/services</code> and <code>/services/estate-planning</code>.</div>
                      <div>External links and hash links are ignored by the current-route helper.</div>
                      <div>The runtime sets <code>data-cms-nav-current="true"</code> on the active item, the matching link, and any element using <code>data-cms-nav-current-class</code>.</div>
                      <div>Exact matches get <code>aria-current="page"</code>; parent-path matches get <code>aria-current="true"</code>.</div>
                      <div>Keep hover styles in your normal classes like <code>hover:text-navActive</code>; <code>data-cms-nav-current-class</code> is only for current-route styling.</div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Current Route Example
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;nav class="cms-nav-root" data-cms-nav-root&gt;
  &lt;div class="cms-nav-item"&gt;
    &lt;a
      href="/about"
      class="cms-nav-link hover:text-navActive"
      data-cms-nav-current-class="!text-navActive"
    &gt;
      About
    &lt;/a&gt;
  &lt;/div&gt;

  &lt;div
    class="cms-nav-item"
    data-cms-nav-current-class="border-b-2 border-navActive"
  &gt;
    &lt;a
      href="/services"
      class="cms-nav-link hover:text-navActive"
      data-cms-nav-current-class="!text-navActive"
    &gt;
      Services
    &lt;/a&gt;
  &lt;/div&gt;

  &lt;div class="cms-nav-item"&gt;
    &lt;div
      class="rounded-full px-4 py-2 transition"
      data-cms-nav-current-class="bg-navActive/10"
    &gt;
      &lt;a
        href="/services/estate-planning"
        class="cms-nav-link uppercase tracking-widest hover:text-navActive"
        data-cms-nav-current-class="!text-navActive"
      &gt;
        Estate Planning
      &lt;/a&gt;
    &lt;/div&gt;
  &lt;/div&gt;
&lt;/nav&gt;</code></pre>
                  </section>

                    <section class="space-y-3">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Nav Block Template (Copy / Paste)
                      </h3>
                      <p class="text-sm text-foreground">
                        This is a compact Template v2 example. Keep larger nav builds in reusable starter blocks instead of pasting a giant template into the guide.
                      </p>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div
  class="cms-nav-root cms-nav-sticky"
  data-cms-nav-root
  data-cms-nav-position="{{ navPosition }}"
  data-cms-nav-close-on-link="true"
&gt;
  {{#for site in source("siteDoc")}}
    &lt;nav class="cms-nav-main fixed inset-x-0 top-0 z-30 w-full bg-transparent text-navText"&gt;
      &lt;div class="cms-nav-layout flex h-[64px] items-center justify-between px-6"&gt;
        &lt;a href="/" class="cms-nav-logo"&gt;
          &lt;img src="{{ default(site.logoLight, site.logo) }}" alt="{{ site.name }}" class="h-12" /&gt;
        &lt;/a&gt;

        &lt;ul class="cms-nav-desktop hidden items-center gap-5 lg:flex"&gt;
          {{#for menuItem in site.menuItems}}
            &lt;li class="cms-nav-item"&gt;
              &lt;a
                href="{{ menuItem.url }}"
                class="cms-nav-link"
                data-cms-nav-current-class="!text-navActive"
              &gt;
                {{ default(menuItem.menuTitle, menuItem.name) }}
              &lt;/a&gt;
            &lt;/li&gt;
          {{/for}}
        &lt;/ul&gt;

        &lt;button class="cms-nav-toggle" type="button" aria-label="Open Menu"&gt;Menu&lt;/button&gt;
      &lt;/div&gt;
    &lt;/nav&gt;

    &lt;div class="cms-nav-overlay fixed inset-0 z-[110] bg-black/50 opacity-0 pointer-events-none"&gt;&lt;/div&gt;
    &lt;aside class="cms-nav-panel fixed inset-y-0 right-0 z-[120] w-full max-w-md translate-x-full bg-sideNavBg"&gt;
      &lt;button type="button" class="cms-nav-close"&gt;Close&lt;/button&gt;
      {{#for menuItem in site.menuItems}}
        &lt;a href="{{ menuItem.url }}" class="cms-nav-link block"&gt;
          {{ default(menuItem.menuTitle, menuItem.name) }}
        &lt;/a&gt;
      {{/for}}
    &lt;/aside&gt;
  {{/for}}
&lt;/div&gt;</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "navPosition": {
    "type": "option",
    "label": "Menu Position",
    "value": "right",
    "option": {
      "options": [
        { "label": "Right", "value": "right" },
        { "label": "Left", "value": "left" },
        { "label": "Center", "value": "center" }
      ],
      "optionsKey": "label",
      "optionsValue": "value"
    }
  }
}</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "siteDoc": {
    "type": "collection",
    "path": "sites",
    "canonicalLookup": { "key": "{orgId}:{siteId}" },
    "order": [],
    "value": []
  }
}</code></pre>
                    </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Preview + Edit Behavior
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Clicking the nav button opens the slide-out in Block Editor preview and Page Preview mode.</div>
                      <div>Interactive nav elements do not trigger “Edit Block”. Clicking outside them still opens the editor in edit mode.</div>
                      <div>In CMS preview, fixed nav and panel are contained to the preview surface by the block wrapper.</div>
                      <div><code>cms-nav-pos-left</code> also switches the slide-out panel to the left side.</div>
                    </div>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="form-helpers">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-6">
                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What This Does
                    </h3>
                    <p class="text-sm text-foreground">
                      Add helper classes or data attributes to a CMS block form, and the client runtime will submit a
                      <code>Contact Form</code> history event with anti-bot checks and submit history tracking.
                    </p>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      CMS Preview Scope
                    </h3>
                    <p class="text-sm text-foreground">
                      In Block Editor, this is for structure and messaging preview only. Use it to verify markup and required-state UX,
                      not to validate end-to-end delivery.
                    </p>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Helper Contract
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>form.cms-form</code> or <code>form[data-cms-form]</code>: form root.</div>
                      <div><code>.cms-form-required</code> or <code>[data-cms-required=&quot;true&quot;]</code>: required field markers.</div>
                      <div><code>.cms-form-submit</code> or <code>[data-cms-form-submit]</code>: submit button.</div>
                      <div><code>.cms-form-message</code> or <code>[data-cms-form-message]</code>: status/error message container.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Defaults + Messages
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Default flow: <code>Contact Form</code> history event.</div>
                      <div><code>data-cms-success-message</code>: override success copy.</div>
                      <div><code>data-cms-error-message</code>: override error copy.</div>
                      <div><code>data-cms-required-message</code>: override required-field copy.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Context IDs
                    </h3>
                    <p class="text-sm text-foreground">
                      Block/Page/Site/Org IDs are inherited from the CMS HTML wrapper automatically, so forms in blocks
                      do not need manual context wiring.
                    </p>
                  </section>

                    <section class="space-y-3">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Contact Form Example (Block HTML)
                      </h3>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;section
  class="relative cms-block cms-block-contact-form-placeholder rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 sm:px-6 sm:py-8"
  data-block-type="contact-form-placeholder"
&gt;
  &lt;div class="mx-auto max-w-3xl pt-6"&gt;
      &lt;div class="mb-6 space-y-2 text-center sm:text-left"&gt;
        &lt;h2 class="text-xl font-semibold text-slate-900"&gt;
          {{ formHeader }}
        &lt;/h2&gt;
        &lt;p class="text-sm text-slate-600"&gt;
          {{ formSubheader }}
        &lt;/p&gt;
      &lt;/div&gt;

    &lt;form
      class="cms-form space-y-4"
      data-cms-form
      data-cms-required-message="Please complete all required fields."
      data-cms-success-message="Thanks! Your message has been sent."
      data-cms-error-message="Sorry, we could not send your message. Please try again."
      data-cms-success-class="cms-form-message cms-form-message-success"
      data-cms-error-class="cms-form-message cms-form-message-error"
      data-cms-invalid-class="cms-form-field-invalid"
      data-cms-working-class="cms-form-submitting"
    &gt;
      &lt;!-- Honeypot (optional, used by helper if present) --&gt;
      &lt;div class="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0" aria-hidden="true"&gt;
        &lt;label for="cms-company"&gt;Company&lt;/label&gt;
        &lt;input id="cms-company" name="company" type="text" tabindex="-1" autocomplete="off" /&gt;
      &lt;/div&gt;
      &lt;input type="hidden" name="subject" value="New Website Contact Form Submission" /&gt;

        &lt;div class="space-y-4"&gt;
          {{#for field in formFields}}
            &lt;div class="space-y-1"&gt;
              &lt;label class="text-xs font-medium uppercase tracking-wide text-slate-600"&gt;
                {{ field.fieldName }}
              &lt;/label&gt;

              {{#if field.isTextarea}}
                &lt;textarea
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  data-cms-required="{{ field.fieldRequired }}"
                  name="{{ field.fieldName }}"
                  placeholder="{{ field.fieldName }}"
                  rows="6"
                &gt;&lt;/textarea&gt;
              {{#else}}
                &lt;input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  data-cms-required="{{ field.fieldRequired }}"
                  type="{{ field.fieldType }}"
                  name="{{ field.fieldName }}"
                  placeholder="{{ field.fieldName }}"
                /&gt;
              {{/if}}
            &lt;/div&gt;
          {{/for}}
        &lt;/div&gt;

      &lt;div class="mt-6"&gt;
        &lt;button
          type="submit"
          class="cms-form-submit inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            data-cms-form-submit
          &gt;
            {{ buttonText }}
          &lt;/button&gt;
        &lt;/div&gt;

        &lt;p class="cms-form-message hidden text-sm" data-cms-form-message&gt;&lt;/p&gt;
      &lt;/form&gt;
    &lt;/div&gt;
  &lt;/section&gt;</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "formHeader": { "type": "text", "label": "Form Header", "value": "Contact Us" },
  "formSubheader": { "type": "text", "label": "Form Subheader", "value": "Subheader content" },
  "buttonText": { "type": "text", "label": "Button Text", "value": "Send Message" },
  "formFields": {
    "type": "array",
    "label": "Form Fields",
    "schema": {
      "fieldName": { "type": "text", "label": "Field Label" },
      "fieldType": {
        "type": "option",
        "label": "Field Type",
        "option": {
          "options": [
            { "label": "Text", "value": "text" },
            { "label": "Email", "value": "email" },
            { "label": "Phone", "value": "tel" }
          ],
          "optionsKey": "label",
          "optionsValue": "value"
        }
      },
      "isTextarea": {
        "type": "option",
        "label": "Textarea",
        "option": {
          "options": [
            { "label": "No", "value": "" },
            { "label": "Yes", "value": "true" }
          ],
          "optionsKey": "label",
          "optionsValue": "value"
        }
      },
      "fieldRequired": {
        "type": "option",
        "label": "Required",
        "option": {
          "options": [
            { "label": "Yes", "value": "true" },
            { "label": "No", "value": "false" }
          ],
          "optionsKey": "label",
          "optionsValue": "value"
        }
      }
    },
    "value": [
      { "fieldName": "Name", "fieldType": "text", "isTextarea": "", "fieldRequired": "true" },
      { "fieldName": "Email", "fieldType": "email", "isTextarea": "", "fieldRequired": "true" },
      { "fieldName": "Message", "fieldType": "text", "isTextarea": "true", "fieldRequired": "true" }
    ]
  }
}</code></pre>
                    </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="publications">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-8">
                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Publication Fields
                    </h3>
                      <p class="text-sm text-foreground">
                        Use a publication field when the CMS user should select an already processed PDF publication.
                        The picker opens the media manager filtered to publications and saves the selected publication's
                        page output map as the field value.
                      </p>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#publication {"field":"publicationPages"}}}}</code></pre>
                      <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "publicationPages": {
    "type": "publication",
    "label": "Publication",
    "effect": "flip"
  }
}</code></pre>
                      <div class="text-sm text-foreground space-y-1">
                        <div>The field key is the saved data key for the selected publication pages object.</div>
                        <div>Publication inputs do not need a default selection. The page editor chooses the publication.</div>
                        <div>The publication preview is rendered by the special <code>#publication</code> tag. Dynamic Fields inserts this tag with only the field name.</div>
                        <div><code>effect</code> belongs on the Input settings, not in the Template marker. Page editors can save either <code>flip</code> or <code>slide</code>.</div>
                      </div>
                    </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="auth-helpers">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-6">
                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What This Does
                    </h3>
                    <p class="text-sm text-foreground">
                      Add helper classes in block HTML so runtime can mark login CTAs and toggle visibility based on auth state.
                    </p>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Login / Logout Helpers
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>.cms-login-button</code> or <code>[data-cms-login-button]</code>: marks a login CTA.</div>
                      <div><code>.cms-logout-button</code> or <code>[data-cms-logout-button]</code>: marks a logout CTA.</div>
                      <div><code>.cms-account-button</code> or <code>[data-cms-account-button]</code>: marks a My Account CTA so frontend can open a My Account dialog.</div>
                      <div>Runtime adds <code>data-cms-auth-action="login|logout"</code> plus <code>data-cms-interactive="true"</code> so frontend can open login UI or trigger logout.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Visibility Helpers
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>.cms-show-logged-in</code> or <code>[data-cms-show-logged-in]</code>: only visible when logged in.</div>
                      <div><code>.cms-show-logged-out</code> or <code>[data-cms-show-logged-out]</code>: only visible when logged out.</div>
                      <div><code>.cms-hide-logged-in</code> or <code>[data-cms-hide-logged-in]</code>: hidden when logged in.</div>
                      <div><code>.cms-hide-logged-out</code> or <code>[data-cms-hide-logged-out]</code>: hidden when logged out.</div>
                      <div>Runtime writes <code>data-cms-auth-state="logged-in|logged-out"</code> on the block HTML root.</div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Plan / Price Button Helpers
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>[data-cms-plan-button]</code>: marks a CTA that selects a restricted-content Stripe product and price.</div>
                      <div><code>data-cms-stripe-product-id</code>: Stripe product id to select.</div>
                      <div><code>data-cms-stripe-price-id</code>: Stripe price id to select.</div>
                      <div>Use these on pricing buttons so the frontend can open registration or checkout with the selected plan already chosen.</div>
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;a
  href="#"
  data-cms-plan-button
  data-cms-stripe-product-id="prod_123"
  data-cms-stripe-price-id="price_123"
&gt;
  Choose Plan A
&lt;/a&gt;</code></pre>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Example
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div class="flex items-center gap-3"&gt;
  &lt;button type="button" class="cms-login-button cms-show-logged-out inline-flex items-center rounded-md bg-black px-4 py-2 text-white"&gt;
    Log In
  &lt;/button&gt;

  &lt;button type="button" class="cms-account-button cms-show-logged-in inline-flex items-center rounded-md border px-4 py-2"&gt;
    My Account
  &lt;/button&gt;

  &lt;button type="button" class="cms-logout-button cms-show-logged-in inline-flex items-center rounded-md border px-4 py-2"&gt;
    Log Out
  &lt;/button&gt;
&lt;/div&gt;</code></pre>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="scroll-reveals">
              <div class="h-[calc(100vh-190px)] overflow-y-auto pr-1 pb-6">
                <div class="space-y-6">
                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      What This Does
                    </h3>
                    <p class="text-sm text-foreground">
                      Add classes to HTML elements in CMS blocks to trigger scroll reveal animations automatically.
                    </p>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick Start
                    </h3>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div class="sr sr-up sr-delay-150 sr-dur-800 sr-dist-30"&gt;
  I animate on scroll
&lt;/div&gt;</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div class="sr-group sr-up sr-interval-120 sr-dur-700"&gt;
  &lt;div class="sr-item"&gt;Item 1&lt;/div&gt;
  &lt;div class="sr-item"&gt;Item 2&lt;/div&gt;
  &lt;div class="sr-item"&gt;Item 3&lt;/div&gt;
&lt;/div&gt;</code></pre>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Required Base Classes
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr</code>: reveal this element.</div>
                      <div><code>sr-group</code>: reveal/stagger a group of children with shared options.</div>
                      <div><code>sr-item</code>: child element inside <code>sr-group</code>.</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Direction / Origin
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-up</code>, <code>sr-down</code>, <code>sr-left</code>, <code>sr-right</code></div>
                      <div><code>sr-origin-top</code>, <code>sr-origin-right</code>, <code>sr-origin-bottom</code>, <code>sr-origin-left</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Timing
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-delay-200</code> (ms)</div>
                      <div><code>sr-dur-700</code> or <code>sr-duration-700</code> (ms)</div>
                      <div><code>sr-interval-120</code> or <code>sr-stagger-120</code> (ms between items)</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Movement / Transform
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-dist-24</code> or <code>sr-distance-24</code> (px when numeric)</div>
                      <div><code>sr-opacity-0.2</code></div>
                      <div><code>sr-scale-0.9</code></div>
                      <div><code>sr-rotate-10</code>, <code>sr-rotate-x-15</code>, <code>sr-rotate-y-15</code>, <code>sr-rotate-z-15</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      View Trigger
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-view-factor-0.2</code> or <code>sr-viewfactor-0.2</code></div>
                      <div><code>sr-view-offset-top-80</code>, <code>sr-view-offset-right-40</code>, <code>sr-view-offset-bottom-80</code>, <code>sr-view-offset-left-40</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Behavior
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-reset</code>, <code>sr-no-reset</code></div>
                      <div><code>sr-cleanup</code>, <code>sr-no-cleanup</code></div>
                      <div><code>sr-use-delay-always</code>, <code>sr-use-delay-once</code>, <code>sr-use-delay-onload</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Device Targeting
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-no-mobile</code>, <code>sr-no-desktop</code></div>
                      <div><code>sr-mobile-true</code>, <code>sr-mobile-false</code></div>
                      <div><code>sr-desktop-true</code>, <code>sr-desktop-false</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Easing
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-ease-linear</code>, <code>sr-ease-in</code>, <code>sr-ease-out</code>, <code>sr-ease-in-out</code></div>
                      <div><code>sr-easing-...</code> for advanced raw tokens</div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Container Targeting (Advanced)
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-container-id-main</code></div>
                      <div><code>sr-container-class-scroll-area</code></div>
                      <div><code>sr-container-tag-main</code></div>
                    </div>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Defaults
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>origin: bottom</code></div>
                      <div><code>distance: 24px</code></div>
                      <div><code>duration: 700</code></div>
                      <div><code>easing: cubic-bezier(0.5, 0, 0, 1)</code></div>
                      <div><code>viewFactor: 0.15</code></div>
                      <div><code>reset: false</code></div>
                      <div><code>cleanup: false</code></div>
                      <div><code>mobile: true</code></div>
                      <div><code>desktop: true</code></div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Callback Hooks (Advanced)
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div><code>sr-before-reveal-{key}</code></div>
                      <div><code>sr-after-reveal-{key}</code></div>
                      <div><code>sr-before-reset-{key}</code></div>
                      <div><code>sr-after-reset-{key}</code></div>
                    </div>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>window.__srCallbacks = {
  myHook: (el) => { console.log('revealed', el) },
}</code></pre>
                    <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>&lt;div class="sr sr-up sr-after-reveal-myHook"&gt;...&lt;/div&gt;</code></pre>
                  </section>

                  <section class="space-y-2">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Best Practices
                    </h3>
                    <div class="text-sm text-foreground space-y-1">
                      <div>Always include <code>sr</code> for single elements.</div>
                      <div>For staggered lists, use <code>sr-group</code> on parent and <code>sr-item</code> on children.</div>
                      <div>Keep class names lowercase.</div>
                      <div>Prefer <code>sr-ease-*</code> presets unless you need advanced easing.</div>
                    </div>
                  </section>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
    <Sheet
      v-model:open="state.jsonEditorOpen"
    >
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle class="text-left">
            Field Editor
          </SheetTitle>
          <SheetDescription v-if="state.jsonEditorError" class="text-left text-sm text-gray-500">
            <Alert variant="destructive" class="mt-2">
              <AlertCircle class="w-4 h-4" />
              <AlertTitle>
                JSON Error
              </AlertTitle>
              <AlertDescription>
                {{ state.jsonEditorError }}
              </AlertDescription>
            </Alert>
          </SheetDescription>
        </SheetHeader>
        <div :class="state.jsonEditorError ? 'h-[calc(100vh-200px)]' : 'h-[calc(100vh-120px)]'" class="p-6 space-y-4   overflow-y-auto">
          <edge-cms-code-editor
            v-model="state.jsonEditorContent"
            title="Fields Configuration (JSON)"
            language="json"
            name="content"
            height="calc(100vh - 200px)"
          />
        </div>
        <SheetFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="destructive" class="text-white " @click="closeJsonEditor">
            Cancel
          </edge-shad-button>
          <edge-shad-button class=" bg-slate-800 hover:bg-slate-400text-white w-full" @click="handleJsonEditorSave">
            Save
          </edge-shad-button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style scoped>
.cms-auth-preview-logged-in :deep(.cms-show-logged-out),
.cms-auth-preview-logged-in :deep([data-cms-show-logged-out]),
.cms-auth-preview-logged-in :deep(.cms-hide-logged-in),
.cms-auth-preview-logged-in :deep([data-cms-hide-logged-in]) {
  display: none !important;
}

.cms-auth-preview-logged-out :deep(.cms-show-logged-in),
.cms-auth-preview-logged-out :deep([data-cms-show-logged-in]),
.cms-auth-preview-logged-out :deep(.cms-hide-logged-out),
.cms-auth-preview-logged-out :deep([data-cms-hide-logged-out]) {
  display: none !important;
}
</style>
