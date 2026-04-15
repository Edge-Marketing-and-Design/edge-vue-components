<script setup>
import { ArrowDown, ArrowLeft, ArrowUp, Download, ExternalLink, FileCheck, FileCog, FileDown, FileMinus2, FilePen, FileUp, FileWarning, FileX, History, Loader2, Maximize2, Monitor, MoreHorizontal, RotateCcw, Smartphone, Sparkles, Tablet, UploadCloud } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: true,
  },
  isTemplateSite: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['head'])

const edgeFirebase = inject('edgeFirebase')
const { saveJsonFile } = useJsonFileSave()
const route = useRoute()
const router = useRouter()
const { buildPageStructuredData } = useStructuredDataTemplates()
const cmsMultiOrg = useState('cmsMultiOrg', () => true)
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const currentOrgRoleName = computed(() => {
  return String(edgeGlobal.getRoleName(edgeFirebase?.user?.roles || [], edgeGlobal.edgeState.currentOrganization) || '').toLowerCase()
})
const canManageRestrictionAssignments = computed(() => {
  if (!cmsMultiOrg.value)
    return currentOrgRoleName.value === 'admin'
  return currentOrgRoleName.value === 'admin' || currentOrgRoleName.value === 'site admin'
})
const isDevModeEnabled = computed(() => process.dev || Boolean(edgeGlobal.edgeState.devOverride))
const canOpenPreviewBlockContentEditor = computed(() => {
  if (!isAdmin.value)
    return false
  if (cmsMultiOrg.value)
    return true
  return isDevModeEnabled.value
})

const state = reactive({
  newDocs: {
    pages: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Name' }, cols: '12', value: '' },
      type: { value: ['Page'] },
      content: { value: [] },
      postContent: { value: [] },
      structure: { value: [] },
      postStructure: { value: [] },
      metaTitle: { value: '' },
      metaDescription: { value: '' },
      structuredData: { value: buildPageStructuredData() },
    },
  },
  editMode: false,
  showUnpublishedChangesDialog: false,
  publishLoading: false,
  workingDoc: {},
  editorWorkingDoc: null,
  editorHasUnsavedChanges: false,
  seoAiLoading: false,
  seoAiError: '',
  importingJson: false,
  importDocIdDialogOpen: false,
  importDocIdValue: '',
  importConflictDialogOpen: false,
  importConflictDocId: '',
  importErrorDialogOpen: false,
  importErrorMessage: '',
  previewViewport: 'full',
  previewScale: '100',
  previewAuthLoggedIn: true,
  previewPageView: 'list',
  newRowLayout: '6',
  newPostRowLayout: '6',
  rowSettings: {
    open: false,
    rowId: null,
    rowRef: null,
    isPost: false,
    draft: {
      width: 'full',
      gap: '4',
      verticalAlign: 'start',
      background: 'transparent',
      mobileOrder: 'normal',
      marginXMode: 'auto',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
    },
  },
  addRowPopoverOpen: {
    listTop: false,
    listEmpty: false,
    listBottom: false,
    listBetween: {},
    postTop: false,
    postEmpty: false,
    postBottom: false,
    postBetween: {},
  },
  routeLastSegmentDialogOpen: false,
  routeLastSegmentDraft: '',
  routeLastSegment: '',
  templateManualTags: [],
  editorKey: 0,
  historyDialogOpen: false,
  historyLoading: false,
  historyRestoring: false,
  historyError: '',
  historyItems: [],
  historySelectedId: '',
  historyPreviewDoc: null,
  historyPreviewView: 'list',
  showHistoryDiffDialog: false,
  pageSettingsOpen: false,
  renamePageDialogOpen: false,
  renamePageValue: '',
  renamePageSubmitting: false,
  deletePageDialogOpen: false,
  deletePageSubmitting: false,
  pageSettingsRestrictionRuleId: '',
  pageSettingsPostRestrictionRuleId: '',
  savingPageRuleAssignments: false,
})

const pageImportInputRef = ref(null)
const pageImportDocIdResolver = ref(null)
const pageImportConflictResolver = ref(null)
const listPreviewSurfaceRef = ref(null)
const postPreviewSurfaceRef = ref(null)
const historyListPreviewSurfaceRef = ref(null)
const historyPostPreviewSurfaceRef = ref(null)
const pagePreviewRenderContext = ref(null)

const schemas = {
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const renamePageSchema = toTypedSchema(z.object({
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

const buildScaledPreviewSurfaceStyle = (baseHeight) => {
  const normalizedHeight = String(baseHeight || '').trim()
  if (!normalizedHeight) {
    return {
      ...(previewViewportContainStyle.value || {}),
    }
  }
  return {
    ...(previewViewportContainStyle.value || {}),
    height: previewScaleMultiplier.value === 1
      ? normalizedHeight
      : `calc((${normalizedHeight}) / ${previewScaleMultiplier.value})`,
  }
}

const normalizeSiteRestrictionRules = (value = []) => {
  if (!Array.isArray(value))
    return []
  return value
    .map((item, index) => {
      const normalizedItem = (item && typeof item === 'object') ? item : {}
      const id = String(normalizedItem.id || normalizedItem.docId || `rule-${index + 1}`).trim()
      return {
        id,
        name: String(normalizedItem.name || '').trim(),
      }
    })
    .filter(item => item.id)
}

const normalizeRestrictedPageRuleAssignments = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}
  return Object.entries(value).reduce((acc, [key, ruleId]) => {
    const normalizedKey = String(key || '').trim()
    const normalizedRuleId = String(ruleId || '').trim()
    if (normalizedKey && normalizedRuleId)
      acc[normalizedKey] = normalizedRuleId
    return acc
  }, {})
}

const restrictedRules = computed(() => {
  return normalizeSiteRestrictionRules(siteDoc.value?.restrictedContent?.rules)
})
const restrictedPageRuleAssignments = computed(() => {
  return normalizeRestrictedPageRuleAssignments(siteDoc.value?.restrictedContent?.pageRuleAssignments)
})
const NO_RESTRICTION_RULE_VALUE = '__no_restriction_rule__'
const restrictionRuleOptions = computed(() => {
  const options = restrictedRules.value
    .map(item => ({
      value: item.id,
      label: item.name || item.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return [{ value: NO_RESTRICTION_RULE_VALUE, label: 'No rule selected' }, ...options]
})
const availableRestrictionRuleCount = computed(() => Math.max(0, restrictionRuleOptions.value.length - 1))
const isRestrictedContentEnabled = computed(() => Boolean(siteDoc.value?.restrictedContent?.enabled))
const showRestrictionRulePicker = computed(() => {
  return false
})

const getRestrictionRuleLabel = (ruleId) => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return 'No rule selected'
  return restrictedRules.value.find(item => item.id === normalizedRuleId)?.name || normalizedRuleId
}

const getPageRestrictionAssignmentKey = (pageId, isDetail = false) => {
  const normalizedPageId = String(pageId || '').trim()
  if (!normalizedPageId)
    return ''
  return isDetail ? `${normalizedPageId}-details` : normalizedPageId
}

const getPageRestrictionAssignment = (pageId, isDetail = false) => {
  const key = getPageRestrictionAssignmentKey(pageId, isDetail)
  if (!key)
    return ''
  return String(restrictedPageRuleAssignments.value?.[key] || '').trim()
}

const previewSurfaceRefEntries = computed(() => ([
  ['list', listPreviewSurfaceRef.value],
  ['post', postPreviewSurfaceRef.value],
  ['historyList', historyListPreviewSurfaceRef.value],
  ['historyPost', historyPostPreviewSurfaceRef.value],
]))

const capturePreviewScrollPositions = () => {
  const positions = {}
  for (const [key, element] of previewSurfaceRefEntries.value) {
    if (!element || typeof element.scrollTop !== 'number')
      continue
    positions[key] = {
      top: Number(element.scrollTop || 0),
      left: Number(element.scrollLeft || 0),
    }
    element.scrollTop = 0
    element.scrollLeft = 0
  }
  return positions
}

const restorePreviewScrollPositions = (positions) => {
  const previewSurfaceMap = Object.fromEntries(previewSurfaceRefEntries.value)
  for (const [key, scrollState] of Object.entries(positions || {})) {
    const element = previewSurfaceMap?.[key]
    if (!element || typeof element.scrollTop !== 'number')
      continue
    element.scrollTop = Number(scrollState?.top || 0)
    element.scrollLeft = Number(scrollState?.left || 0)
  }
}

const setPreviewViewport = (viewportId) => {
  state.previewViewport = viewportId
}

const hasPostView = (workingDoc) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return false
  return Boolean(workingDoc.post)
    || (Array.isArray(workingDoc.postContent) && workingDoc.postContent.length > 0)
    || (Array.isArray(workingDoc.postStructure) && workingDoc.postStructure.length > 0)
}

const setPreviewPageView = (view) => {
  state.previewPageView = view === 'post' ? 'post' : 'list'
}

const setPreviewAuthMode = (loggedIn) => {
  state.previewAuthLoggedIn = loggedIn === true
}

const previewViewportMode = computed(() => {
  if (state.previewViewport === 'full')
    return 'auto'
  return state.previewViewport
})

const isMobilePreview = computed(() => previewViewportMode.value === 'mobile')

const GRID_CLASSES = {
  1: 'grid grid-cols-1 gap-4',
  2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
  3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
  4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
  5: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4',
  6: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4',
}

const ROW_WIDTH_OPTIONS = [
  { name: 'full', title: 'Full width (100%)', class: 'w-full' },
  { name: 'max-w-screen-2xl', title: 'Max width 2XL', class: 'w-full max-w-screen-2xl' },
  { name: 'max-w-screen-xl', title: 'Max width XL', class: 'w-full max-w-screen-xl' },
  { name: 'max-w-screen-lg', title: 'Max width LG', class: 'w-full max-w-screen-lg' },
  { name: 'max-w-screen-md', title: 'Max width MD', class: 'w-full max-w-screen-md' },
  { name: 'max-w-screen-sm', title: 'Max width SM', class: 'w-full max-w-screen-sm' },
]

const ROW_GAP_OPTIONS = [
  { name: '0', title: 'No gap' },
  { name: '2', title: 'Small' },
  { name: '4', title: 'Medium' },
  { name: '6', title: 'Large' },
  { name: '8', title: 'X-Large' },
]

const ROW_GAP_CLASS_MAP = {
  0: 'gap-0 sm:gap-0',
  2: 'gap-0 sm:gap-2',
  4: 'gap-0 sm:gap-4',
  6: 'gap-0 sm:gap-6',
  8: 'gap-0 sm:gap-8',
}

const ROW_MOBILE_STACK_OPTIONS = [
  { name: 'normal', title: 'Left first' },
  { name: 'reverse', title: 'Right first' },
]

const ROW_VERTICAL_ALIGN_OPTIONS = [
  { name: 'start', title: 'Top' },
  { name: 'center', title: 'Middle' },
  { name: 'end', title: 'Bottom' },
  { name: 'stretch', title: 'Stretch' },
]

const ROW_MARGIN_X_MODE_OPTIONS = [
  { name: 'auto', title: 'Auto (recommended)' },
  { name: 'custom', title: 'Custom' },
]

const normalizeForCompare = (value) => {
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

const stableSerialize = value => JSON.stringify(normalizeForCompare(value))
const areEqualNormalized = (a, b) => stableSerialize(a) === stableSerialize(b)

const layoutLabel = (spans) => {
  const key = spans.join('-')
  const map = {
    '6': 'Single column',
    '1-5': 'Narrow left, wide right',
    '2-4': 'Slim left, large right',
    '3-3': 'Two equal columns',
    '4-2': 'Large left, slim right',
    '5-1': 'Wide left, narrow right',
  }
  return map[key] || spans.join(' / ')
}

const LAYOUT_OPTIONS = [
  { spans: [6] },
  { spans: [1, 5] },
  { spans: [2, 4] },
  { spans: [3, 3] },
  { spans: [4, 2] },
  { spans: [5, 1] },
]
  .map(option => ({
    id: option.spans.join('-'),
    spans: option.spans,
    label: layoutLabel(option.spans),
  }))

const LAYOUT_MAP = {}
for (const option of LAYOUT_OPTIONS)
  LAYOUT_MAP[option.id] = option.spans

const rowWidthClass = (width) => {
  const found = ROW_WIDTH_OPTIONS.find(option => option.name === width)
  return found?.class || ROW_WIDTH_OPTIONS[0].class
}

const ensureBlocksArray = (workingDoc, key) => {
  if (!Array.isArray(workingDoc[key]))
    workingDoc[key] = []
  for (const block of workingDoc[key]) {
    if (!block.id)
      block.id = edgeGlobal.generateShortId()
  }
}

const applySeoAiResults = (payload) => {
  if (!payload || typeof payload !== 'object')
    return
  if (payload.metaTitle)
    state.workingDoc.metaTitle = payload.metaTitle
  if (payload.metaDescription)
    state.workingDoc.metaDescription = payload.metaDescription
  if (payload.structuredData)
    state.workingDoc.structuredData = payload.structuredData
}

const buildPageWorkingDocOverrides = (doc) => {
  return {
    last_updated: doc?.last_updated,
    metaTitle: doc?.metaTitle,
    metaDescription: doc?.metaDescription,
    structuredData: doc?.structuredData,
    postMetaTitle: doc?.postMetaTitle,
    postMetaDescription: doc?.postMetaDescription,
    postStructuredData: doc?.postStructuredData,
  }
}

const updateSeoWithAi = async () => {
  if (!edgeFirebase?.user?.uid)
    return
  state.seoAiLoading = true
  state.seoAiError = ''
  try {
    const results = await edgeFirebase.runFunction('cms-updateSeoFromAi', {
      orgId: edgeGlobal.edgeState.currentOrganization,
      siteId: props.site,
      pageId: props.page,
      uid: edgeFirebase.user.uid,
    })
    applySeoAiResults(results?.data || {})
  }
  catch (error) {
    console.error('Failed to update SEO with AI', error)
    state.seoAiError = 'Failed to update SEO. Try again.'
  }
  finally {
    state.seoAiLoading = false
  }
}

const createRow = (columns = 1) => {
  const row = {
    id: edgeGlobal.generateShortId(),
    width: 'full',
    gap: '4',
    background: 'transparent',
    verticalAlign: 'start',
    mobileOrder: 'normal',
    columns: Array.from({ length: Math.min(Math.max(Number(columns) || 1, 1), 6) }, () => ({
      id: edgeGlobal.generateShortId(),
      blocks: [],
      span: null,
    })),
  }
  refreshRowTailwindClasses(row)
  return row
}

const ensureStructureDefaults = (workingDoc, isPost = false) => {
  if (!workingDoc)
    return

  const contentKey = isPost ? 'postContent' : 'content'
  const structureKey = isPost ? 'postStructure' : 'structure'
  ensureBlocksArray(workingDoc, contentKey)

  if (!Array.isArray(workingDoc[structureKey])) {
    if (workingDoc[contentKey].length > 0) {
      const row = createRow(1)
      row.columns[0].blocks = workingDoc[contentKey].map(block => block.id)
      workingDoc[structureKey] = [row]
    }
    else {
      workingDoc[structureKey] = []
    }
    return
  }

  let _mutated = false
  for (const row of workingDoc[structureKey]) {
    if (!Array.isArray(row.columns)) {
      row.columns = createRow(1).columns
      _mutated = true
    }

    for (const col of row.columns) {
      if (!col.id) {
        col.id = edgeGlobal.generateShortId()
        _mutated = true
      }
      if (!Array.isArray(col.blocks)) {
        col.blocks = []
        _mutated = true
      }
      if (col.span == null)
        col.span = null
    }

    if (!row.width) {
      row.width = 'full'
      _mutated = true
    }
    if (!row.gap) {
      row.gap = '4'
      _mutated = true
    }
    if (!row.mobileOrder) {
      row.mobileOrder = 'normal'
      _mutated = true
    }
    if (!row.verticalAlign) {
      row.verticalAlign = 'start'
      _mutated = true
    }
    if (typeof row.background !== 'string' || row.background === '') {
      row.background = 'transparent'
      _mutated = true
    }
    refreshRowTailwindClasses(row)
  }

  const contentIds = new Set((workingDoc[contentKey] || []).map(block => block.id))
  for (const row of workingDoc[structureKey]) {
    for (const col of row.columns) {
      const filtered = col.blocks.filter(blockId => contentIds.has(blockId))
      if (filtered.length !== col.blocks.length) {
        col.blocks = filtered
        _mutated = true
      }
    }
  }

  // If nothing needed normalization, leave as-is to avoid reactive churn
}

const _addRow = (workingDoc, layoutValue = '6', isPost = false) => {
  ensureStructureDefaults(workingDoc, isPost)
  const structureKey = isPost ? 'postStructure' : 'structure'
  workingDoc[structureKey].push(createRowFromLayout(layoutValue))
}

const _adjustRowColumns = (row, newCount) => {
  const count = Math.min(Math.max(Number(newCount) || 1, 1), 6)
  if (row.columns.length === count)
    return

  if (row.columns.length > count) {
    const removed = row.columns.splice(count)
    const target = row.columns[count - 1]
    for (const col of removed) {
      if (Array.isArray(col.blocks))
        target.blocks.push(...col.blocks)
    }
  }
  else {
    const toAdd = count - row.columns.length
    for (let i = 0; i < toAdd; i++)
      row.columns.push({ id: edgeGlobal.generateShortId(), blocks: [] })
  }
}

const blockIndex = (workingDoc, blockId, isPost = false) => {
  if (!workingDoc)
    return -1
  const contentKey = isPost ? 'postContent' : 'content'
  return (workingDoc[contentKey] || []).findIndex(block => block.id === blockId)
}

const removeBlockFromStructure = (workingDoc, blockId, isPost = false) => {
  const structureKey = isPost ? 'postStructure' : 'structure'
  for (const row of workingDoc[structureKey] || []) {
    for (const col of row.columns || [])
      col.blocks = col.blocks.filter(id => id !== blockId)
  }
}

const cleanupOrphanBlocks = (workingDoc, isPost = false) => {
  const contentKey = isPost ? 'postContent' : 'content'
  const structureKey = isPost ? 'postStructure' : 'structure'
  const used = new Set()
  for (const row of workingDoc[structureKey] || []) {
    for (const col of row.columns || []) {
      for (const blockId of col.blocks || [])
        used.add(blockId)
    }
  }
  workingDoc[contentKey] = (workingDoc[contentKey] || []).filter(block => used.has(block.id))
}

const addBlockToColumn = (rowIndex, colIndex, insertIndex, block, slotProps, isPost = false) => {
  const workingDoc = slotProps.workingDoc
  ensureStructureDefaults(workingDoc, isPost)
  const contentKey = isPost ? 'postContent' : 'content'
  const structureKey = isPost ? 'postStructure' : 'structure'
  const row = workingDoc[structureKey]?.[rowIndex]
  if (!row?.columns?.[colIndex])
    return

  const preparedBlock = edgeGlobal.dupObject(block)
  preparedBlock.id = edgeGlobal.generateShortId()
  workingDoc[contentKey].push(preparedBlock)
  row.columns[colIndex].blocks.splice(insertIndex, 0, preparedBlock.id)
}

const blockKey = blockId => blockId

const deleteBlock = (blockId, slotProps, post = false) => {
  console.log('Deleting block with ID:', blockId)
  if (post) {
    const index = slotProps.workingDoc.postContent.findIndex(block => block.id === blockId)
    if (index !== -1) {
      slotProps.workingDoc.postContent.splice(index, 1)
    }
    removeBlockFromStructure(slotProps.workingDoc, blockId, true)
    return
  }
  const index = slotProps.workingDoc.content.findIndex(block => block.id === blockId)
  if (index !== -1) {
    slotProps.workingDoc.content.splice(index, 1)
  }
  removeBlockFromStructure(slotProps.workingDoc, blockId, false)
}

const _blockPick = (block, index, slotProps, post = false) => {
  const generatedId = edgeGlobal.generateShortId()
  block.id = generatedId
  if (index === 0 || index) {
    if (post) {
      slotProps.workingDoc.postContent.splice(index, 0, block)
    }
    else {
      slotProps.workingDoc.content.splice(index, 0, block)
    }
  }
}

onMounted(() => {
  if (props.page === 'new') {
    state.editMode = true
  }
})

const previewSnapshotsBootstrapping = ref(false)

const ensurePreviewSnapshots = async () => {
  const orgId = String(edgeGlobal.edgeState.currentOrganization || '').trim()
  if (!orgId)
    return

  if (previewSnapshotsBootstrapping.value)
    return
  previewSnapshotsBootstrapping.value = true

  const themesPath = `organizations/${orgId}/themes`
  const sitesPath = `organizations/${orgId}/sites`
  const blocksPath = `organizations/${orgId}/blocks`
  const publishedSiteSettingsPath = `organizations/${orgId}/published-site-settings`
  // Non-blocking bootstrap: never hold page render on snapshot latency.
  try {
    if (!edgeFirebase.data?.[themesPath]) {
      await edgeFirebase.startSnapshot(themesPath)
    }
    if (!edgeFirebase.data?.[sitesPath]) {
      await edgeFirebase.startSnapshot(sitesPath)
    }
    if (!edgeFirebase.data?.[blocksPath]) {
      await edgeFirebase.startSnapshot(blocksPath)
    }
    if (!edgeFirebase.data?.[publishedSiteSettingsPath]) {
      await edgeFirebase.startSnapshot(publishedSiteSettingsPath)
    }
  }
  catch (error) {
    console.error('Failed to start page preview snapshots', error)
  }
  finally {
    previewSnapshotsBootstrapping.value = false
  }
}

onBeforeMount(() => {
  ensurePreviewSnapshots()
})

const getNextVersion = (value) => {
  const numericVersion = Number(value)
  if (!Number.isFinite(numericVersion))
    return 1
  return Math.max(0, Math.trunc(numericVersion)) + 1
}

const editorDocUpdates = (workingDoc) => {
  if (workingDoc && Object.prototype.hasOwnProperty.call(workingDoc, 'restrictionRuleId'))
    delete workingDoc.restrictionRuleId
  if (workingDoc && Object.prototype.hasOwnProperty.call(workingDoc, 'postRestrictionRuleId'))
    delete workingDoc.postRestrictionRuleId
  ensureStructureDefaults(workingDoc, false)
  if (workingDoc?.post || (Array.isArray(workingDoc?.postContent) && workingDoc.postContent.length > 0) || Array.isArray(workingDoc?.postStructure))
    ensureStructureDefaults(workingDoc, true)
  Object.assign(state.workingDoc, buildPageWorkingDocOverrides(workingDoc))
  if (props.isTemplateSite) {
    const normalizedTypes = normalizeTemplatePageTypeSelections(workingDoc?.type, { fallback: ['Page'], excludePost: Boolean(workingDoc?.post) })
    if (JSON.stringify(workingDoc?.type || []) !== JSON.stringify(normalizedTypes))
      workingDoc.type = normalizedTypes
    if (JSON.stringify(state.workingDoc?.type || []) !== JSON.stringify(normalizedTypes))
      state.workingDoc.type = normalizedTypes
  }
  if (!hasPostView(workingDoc) && state.previewPageView === 'post')
    state.previewPageView = 'list'
  const blockIds = (workingDoc.content || []).map(block => block.blockId).filter(id => id)
  const postBlockIds = workingDoc.postContent ? workingDoc.postContent.map(block => block.blockId).filter(id => id) : []
  blockIds.push(...postBlockIds)
  const uniqueBlockIds = [...new Set(blockIds)]
  state.workingDoc.blockIds = uniqueBlockIds
  const storedVersion = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page]?.version
  const nextVersion = getNextVersion(storedVersion)
  if (state.workingDoc.version !== nextVersion)
    state.workingDoc.version = nextVersion
  state.editorWorkingDoc = edgeGlobal.dupObject(workingDoc)
}

const previewRouteLastSegment = computed(() => String(state.routeLastSegment || '').trim())

const openRouteLastSegmentDialog = () => {
  state.routeLastSegmentDraft = previewRouteLastSegment.value
  state.routeLastSegmentDialogOpen = true
}

const applyRouteLastSegment = () => {
  state.routeLastSegment = String(state.routeLastSegmentDraft || '').trim()
  state.routeLastSegmentDialogOpen = false
}

const clearRouteLastSegment = () => {
  state.routeLastSegment = ''
  state.routeLastSegmentDraft = ''
  state.routeLastSegmentDialogOpen = false
}

const pageName = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page]?.name || ''
})

const previewSiteOptions = computed(() => {
  return Object.entries(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {})
    .filter(([siteId]) => String(siteId || '').trim() && siteId !== 'templates')
    .map(([siteId, siteDoc]) => ({
      name: siteId,
      title: siteDoc?.name || siteId,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
})

const selectedPreviewContextSiteId = computed(() => {
  if (!props.isTemplateSite)
    return String(props.site || '').trim()

  const selectedSiteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (selectedSiteId)
    return selectedSiteId

  return String(previewSiteOptions.value?.[0]?.name || '').trim()
})

const previewContextCache = useState('edge-cms-template-page-preview-context-cache', () => ({}))

const fetchPreviewContextForSite = async (siteId) => {
  const normalizedSiteId = String(siteId || '').trim()
  if (!normalizedSiteId)
    return null

  const cacheKey = `${edgeGlobal.edgeState.currentOrganization}:${normalizedSiteId}`
  const cached = previewContextCache.value?.[cacheKey]
  if (cached && typeof cached === 'object')
    return edgeGlobal.dupObject(cached)

  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/sites/${normalizedSiteId}/published_posts`
    await staticSearch.getData(collectionPath, [], [], 1)
    const firstPost = Object.values(staticSearch.results?.data || {})[0] || null
    if (firstPost && typeof firstPost === 'object') {
      previewContextCache.value[cacheKey] = edgeGlobal.dupObject(firstPost)
      return edgeGlobal.dupObject(firstPost)
    }
  }
  catch (error) {
    console.error('Failed to load page preview context', error)
  }

  return null
}

const loadPagePreviewRenderContext = async () => {
  pagePreviewRenderContext.value = await fetchPreviewContextForSite(selectedPreviewContextSiteId.value)
}

const currentPagePath = computed(() => {
  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  const siteId = String(props.site || '').trim()
  const pageId = String(props.page || '').trim()
  if (!orgPath || !siteId || !pageId || pageId === 'new')
    return ''
  return `${orgPath}/sites/${siteId}/pages/${pageId}`
})

const currentPageRelativePath = computed(() => {
  const siteId = String(props.site || '').trim()
  const pageId = String(props.page || '').trim()
  if (!siteId || !pageId || pageId === 'new')
    return ''
  return `sites/${siteId}/pages/${pageId}`
})

const themes = computed(() => {
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {})
})

watch([themes, () => props.isTemplateSite], ([newThemes, isTemplate]) => {
  if (!isTemplate)
    return
  const hasSelection = newThemes.some(themeDoc => themeDoc.docId === edgeGlobal.edgeState.blockEditorTheme)
  if ((!edgeGlobal.edgeState.blockEditorTheme || !hasSelection) && newThemes.length > 0)
    edgeGlobal.edgeState.blockEditorTheme = newThemes[0].docId
}, { immediate: true, deep: true })

const selectedThemeId = computed(() => {
  if (props.isTemplateSite) {
    return edgeGlobal.edgeState.blockEditorTheme || ''
  }
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site]?.theme || ''
})

const themePreviewCache = useState('edge-cms-page-theme-preview-cache', () => ({}))
const themeCacheKey = computed(() => {
  const orgId = String(edgeGlobal.edgeState.currentOrganization || 'no-org').trim() || 'no-org'
  const siteKey = props.isTemplateSite ? 'templates' : (String(props.site || 'no-site').trim() || 'no-site')
  return `${orgId}:${siteKey}`
})

const hydrateThemeCache = () => {
  const cache = themePreviewCache.value?.[themeCacheKey.value] || {}
  return {
    themeId: typeof cache?.themeId === 'string' ? cache.themeId : '',
    theme: (cache?.theme && typeof cache.theme === 'object') ? cache.theme : null,
    head: (cache?.head && typeof cache.head === 'object') ? cache.head : {},
  }
}

const writeThemeCache = (patch = {}) => {
  const current = themePreviewCache.value?.[themeCacheKey.value] || {}
  themePreviewCache.value = {
    ...(themePreviewCache.value || {}),
    [themeCacheKey.value]: {
      ...current,
      ...patch,
    },
  }
}

const initialThemeCache = hydrateThemeCache()
const lastStableThemeId = ref(initialThemeCache.themeId)
const lastResolvedTheme = ref(initialThemeCache.theme)
const lastResolvedHead = ref(initialThemeCache.head)

const parseThemeDoc = (themeDoc) => {
  const themeContents = themeDoc?.theme || null
  if (!themeContents)
    return null
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  try {
    const parsed = typeof themeContents === 'string' ? JSON.parse(themeContents) : themeContents
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    return { ...parsed, extraCSS }
  }
  catch {
    return null
  }
}

const parseHeadDoc = (themeDoc) => {
  try {
    const parsed = JSON.parse(themeDoc?.headJSON || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed
  }
  catch {}
  return {}
}

const applyResolvedTheme = (themeDoc, themeId = '') => {
  const normalizedThemeId = String(themeId || themeDoc?.docId || '').trim()
  if (normalizedThemeId)
    lastStableThemeId.value = normalizedThemeId

  const parsedTheme = parseThemeDoc(themeDoc)
  if (parsedTheme && typeof parsedTheme === 'object') {
    lastResolvedTheme.value = parsedTheme
    writeThemeCache({ theme: parsedTheme })
  }

  const parsedHead = parseHeadDoc(themeDoc)
  if (parsedHead && typeof parsedHead === 'object') {
    lastResolvedHead.value = parsedHead
    writeThemeCache({ head: parsedHead })
  }

  if (normalizedThemeId)
    writeThemeCache({ themeId: normalizedThemeId })
}

const themeFallbackLoading = ref(false)
const loadSiteThemeFallback = async () => {
  if (themeFallbackLoading.value)
    return

  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  if (!orgPath)
    return

  const selectedId = String(selectedThemeId.value || '').trim()
  if (props.isTemplateSite) {
    if (!selectedId)
      return
    const fromSnapshot = edgeFirebase.data?.[`${orgPath}/themes`]?.[selectedId] || null
    if (fromSnapshot)
      applyResolvedTheme(fromSnapshot, selectedId)
    return
  }

  const siteId = String(props.site || '').trim()
  if (!siteId || siteId === 'new')
    return

  themeFallbackLoading.value = true
  try {
    let themeId = selectedId
    if (!themeId) {
      const siteDoc = await edgeFirebase.getDocData(`${orgPath}/sites`, siteId)
      themeId = String(siteDoc?.theme || '').trim()
    }
    if (!themeId)
      return

    writeThemeCache({ themeId })
    lastStableThemeId.value = themeId

    const fromSnapshot = edgeFirebase.data?.[`${orgPath}/themes`]?.[themeId] || null
    if (fromSnapshot) {
      applyResolvedTheme(fromSnapshot, themeId)
      if (lastResolvedTheme.value)
        return
    }

    const themeDoc = await edgeFirebase.getDocData(`${orgPath}/themes`, themeId)
    if (themeDoc)
      applyResolvedTheme(themeDoc, themeId)
  }
  catch (error) {
    console.error('Failed to load fallback theme for page preview', error)
  }
  finally {
    themeFallbackLoading.value = false
  }
}

watch(
  () => edgeGlobal.edgeState.currentOrganization,
  () => {
    ensurePreviewSnapshots()
    loadSiteThemeFallback()
  },
  { immediate: true },
)

watch(
  () => [props.site, props.page, props.isTemplateSite],
  () => {
    loadSiteThemeFallback()
  },
  { immediate: true },
)

watch(
  themeCacheKey,
  () => {
    const hydrated = hydrateThemeCache()
    if (hydrated.themeId)
      lastStableThemeId.value = hydrated.themeId
    if (hydrated.theme && typeof hydrated.theme === 'object')
      lastResolvedTheme.value = hydrated.theme
    if (hydrated.head && typeof hydrated.head === 'object')
      lastResolvedHead.value = hydrated.head
  },
  { immediate: true },
)

watch(selectedThemeId, (themeId) => {
  const normalized = String(themeId || '').trim()
  if (normalized) {
    lastStableThemeId.value = normalized
    writeThemeCache({ themeId: normalized })
  }
  loadSiteThemeFallback()
}, { immediate: true })

watch(
  [() => edgeGlobal.edgeState.currentOrganization, selectedPreviewContextSiteId],
  async () => {
    await loadPagePreviewRenderContext()
  },
  { immediate: true },
)

const effectiveThemeId = computed(() => {
  const normalized = String(selectedThemeId.value || '').trim()
  if (normalized)
    return normalized
  return lastStableThemeId.value
})

const pagePreviewRenderKey = computed(() => {
  const siteKey = String(props.site || '')
  const pageKey = String(props.page || '')
  const themeKey = String((effectiveThemeId.value || selectedThemeId.value || 'no-theme'))
  const modeKey = state.editMode ? 'edit' : 'preview'
  return `${siteKey}:${pageKey}:${themeKey}:${modeKey}`
})

const parsedTheme = computed(() => {
  const themeId = effectiveThemeId.value
  if (!themeId)
    return null
  const themeDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[themeId] || null
  return parseThemeDoc(themeDoc)
})

watch(parsedTheme, (nextTheme) => {
  if (nextTheme && typeof nextTheme === 'object') {
    lastResolvedTheme.value = nextTheme
    writeThemeCache({ theme: nextTheme })
  }
}, { immediate: true, deep: true })

const theme = computed(() => {
  return parsedTheme.value || lastResolvedTheme.value || null
})

const themeColorMap = computed(() => {
  const map = {}
  const colors = theme.value?.extend?.colors
  if (!colors || typeof colors !== 'object')
    return map

  for (const [key, val] of Object.entries(colors)) {
    if (typeof val === 'string' && val !== '')
      map[key] = val
  }
  return map
})

const themeColorOptions = computed(() => {
  const colors = themeColorMap.value
  const options = Object.keys(colors || {}).map(color => ({ name: color, title: color.charAt(0).toUpperCase() + color.slice(1) }))
  return [{ name: 'transparent', title: 'Transparent' }, ...options]
})

const normalizeSpacingValue = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0)
    return 0
  return Math.round(parsed)
}

const normalizeMarginXMode = (value) => {
  return value === 'custom' ? 'custom' : 'auto'
}

const resolveMarginXMode = (row) => {
  const explicitMode = normalizeMarginXMode(String(row?.marginXMode || '').trim())
  if (String(row?.marginXMode || '').trim())
    return explicitMode
  const legacyX = normalizeSpacingValue(row?.marginX)
  const left = normalizeSpacingValue(row?.marginLeft)
  const right = normalizeSpacingValue(row?.marginRight)
  if (legacyX > 0 || left > 0 || right > 0)
    return 'custom'
  return 'auto'
}

const getOptionTitle = (options = [], value, fallback = '—') => {
  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue)
    return fallback
  return options.find(option => option.name === normalizedValue)?.title || normalizedValue
}

const getRowLayoutValueLabel = (field, value) => {
  if (field === 'width')
    return getOptionTitle(ROW_WIDTH_OPTIONS, value, 'Full width (100%)')
  if (field === 'gap')
    return getOptionTitle(ROW_GAP_OPTIONS, value, 'Medium')
  if (field === 'verticalAlign')
    return getOptionTitle(ROW_VERTICAL_ALIGN_OPTIONS, value, 'Top')
  if (field === 'mobileOrder')
    return getOptionTitle(ROW_MOBILE_STACK_OPTIONS, value, 'Left first')
  if (field === 'marginXMode')
    return getOptionTitle(ROW_MARGIN_X_MODE_OPTIONS, value, 'Auto (recommended)')
  if (field === 'background')
    return getOptionTitle(themeColorOptions.value, value || 'transparent', 'Transparent')
  if (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'].includes(field))
    return `${normalizeSpacingValue(value)}px`
  return String(value ?? '—')
}

const getRowColumnLayoutLabel = (row) => {
  const spans = (row?.columns || [])
    .map(col => Number.isFinite(col?.span) ? col.span : null)
    .filter(Number.isFinite)
  if (spans.length)
    return layoutLabel(spans)
  const count = row?.columns?.length || 0
  if (!count)
    return 'No columns'
  return `${count} column${count === 1 ? '' : 's'}`
}

const buildLayoutRowMap = (rows = []) => {
  const rowMap = new Map()
  if (!Array.isArray(rows))
    return rowMap

  rows.forEach((row, index) => {
    const rowId = String(row?.id || `row-${index}`)
    rowMap.set(rowId, {
      id: rowId,
      index,
      row,
    })
  })

  return rowMap
}

const buildLayoutChangeDetails = (baseRows = [], compareRows = []) => {
  const details = []
  const baseMap = buildLayoutRowMap(baseRows)
  const compareMap = buildLayoutRowMap(compareRows)
  const allRowIds = new Set([...baseMap.keys(), ...compareMap.keys()])

  for (const rowId of allRowIds) {
    const baseEntry = baseMap.get(rowId) || null
    const compareEntry = compareMap.get(rowId) || null

    if (!baseEntry && compareEntry) {
      details.push({
        key: `${rowId}:added`,
        label: `Row ${compareEntry.index + 1}`,
        base: 'Not present',
        compare: `Added (${getRowColumnLayoutLabel(compareEntry.row)})`,
      })
      continue
    }

    if (baseEntry && !compareEntry) {
      details.push({
        key: `${rowId}:removed`,
        label: `Row ${baseEntry.index + 1}`,
        base: `Removed (${getRowColumnLayoutLabel(baseEntry.row)})`,
        compare: 'Not present',
      })
      continue
    }

    if (baseEntry.index !== compareEntry.index) {
      details.push({
        key: `${rowId}:moved`,
        label: 'Row Order',
        base: `Row ${baseEntry.index + 1}`,
        compare: `Row ${compareEntry.index + 1}`,
      })
    }

    const rowLabel = `Row ${compareEntry.index + 1}`
    const fieldPairs = [
      ['width', 'Width'],
      ['gap', 'Gap'],
      ['verticalAlign', 'Vertical Alignment'],
      ['mobileOrder', 'Stack Order'],
      ['background', 'Background'],
      ['marginXMode', 'Margin X Mode'],
      ['paddingTop', 'Padding Top'],
      ['paddingRight', 'Padding Right'],
      ['paddingBottom', 'Padding Bottom'],
      ['paddingLeft', 'Padding Left'],
      ['marginTop', 'Margin Top'],
      ['marginRight', 'Margin Right'],
      ['marginBottom', 'Margin Bottom'],
      ['marginLeft', 'Margin Left'],
    ]

    fieldPairs.forEach(([field, label]) => {
      const baseValue = baseEntry.row?.[field]
      const compareValue = compareEntry.row?.[field]
      if (areEqualNormalized(baseValue, compareValue))
        return
      details.push({
        key: `${rowId}:${field}`,
        label: `${rowLabel}: ${label}`,
        base: getRowLayoutValueLabel(field, baseValue),
        compare: getRowLayoutValueLabel(field, compareValue),
      })
    })

    const baseColumnLayout = getRowColumnLayoutLabel(baseEntry.row)
    const compareColumnLayout = getRowColumnLayoutLabel(compareEntry.row)
    if (baseColumnLayout !== compareColumnLayout) {
      details.push({
        key: `${rowId}:columns`,
        label: `${rowLabel}: Columns`,
        base: baseColumnLayout,
        compare: compareColumnLayout,
      })
    }
  }

  return details
}

const backgroundClass = (bgKey) => {
  if (!bgKey)
    return ''
  if (bgKey === 'transparent')
    return 'bg-transparent'
  return `bg-${bgKey}`
}

const rowBackgroundStyle = (bgKey) => {
  if (!bgKey)
    return {}
  if (bgKey === 'transparent')
    return { backgroundColor: 'transparent' }
  let color = themeColorMap.value?.[bgKey]
  if (!color)
    return {}
  if (/^[0-9A-Fa-f]{6}$/.test(color))
    color = `#${color}`
  return { backgroundColor: color }
}

const rowSpacingStyle = (row) => {
  const marginXMode = resolveMarginXMode(row)
  const paddingLeft = normalizeSpacingValue(row?.paddingLeft ?? row?.paddingX)
  const paddingRight = normalizeSpacingValue(row?.paddingRight ?? row?.paddingX)
  const paddingTop = normalizeSpacingValue(row?.paddingTop ?? row?.paddingY)
  const paddingBottom = normalizeSpacingValue(row?.paddingBottom ?? row?.paddingY)
  const marginLeft = normalizeSpacingValue(row?.marginLeft ?? row?.marginX)
  const marginRight = normalizeSpacingValue(row?.marginRight ?? row?.marginX)
  const marginTop = normalizeSpacingValue(row?.marginTop ?? row?.marginY)
  const marginBottom = normalizeSpacingValue(row?.marginBottom ?? row?.marginY)

  return {
    paddingLeft: `${paddingLeft}px`,
    paddingRight: `${paddingRight}px`,
    paddingTop: `${paddingTop}px`,
    paddingBottom: `${paddingBottom}px`,
    marginLeft: marginXMode === 'auto' ? 'auto' : `${marginLeft}px`,
    marginRight: marginXMode === 'auto' ? 'auto' : `${marginRight}px`,
    marginTop: `${marginTop}px`,
    marginBottom: `${marginBottom}px`,
  }
}

const layoutSpansFromString = (value, fallback = [6]) => {
  if (Array.isArray(value))
    return value
  if (value && LAYOUT_MAP[String(value)])
    return LAYOUT_MAP[String(value)]
  const str = String(value || '').trim()
  if (!str)
    return fallback
  if (!str.includes('-')) {
    const count = Number(str)
    if (Number.isFinite(count) && count > 0) {
      const base = Math.floor(6 / count)
      const remainder = 6 - (base * count)
      const spans = Array.from({ length: count }, (_, idx) => base + (idx < remainder ? 1 : 0))
      return spans
    }
    return fallback
  }
  const spans = str.split('-').map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0)
  const total = spans.reduce((a, b) => a + b, 0)
  if (total !== 6 || spans.length === 0)
    return fallback
  return spans
}

const rowUsesSpans = row => (row?.columns || []).some(col => Number.isFinite(col?.span))

const rowGapClass = (row) => {
  const gap = Number(row?.gap)
  return ROW_GAP_CLASS_MAP[gap] || ROW_GAP_CLASS_MAP[4]
}

const rowGridClass = (row) => {
  const base = isMobilePreview.value
    ? 'grid grid-cols-1'
    : (rowUsesSpans(row) ? 'grid grid-cols-1 sm:grid-cols-6' : (GRID_CLASSES[row.columns?.length] || GRID_CLASSES[1]))
  return [base, rowGapClass(row)].filter(Boolean).join(' ')
}

const rowGridClassForData = (row) => {
  const base = rowUsesSpans(row) ? 'grid grid-cols-1 sm:grid-cols-6' : (GRID_CLASSES[row.columns?.length] || GRID_CLASSES[1])
  return [base, rowGapClass(row)].filter(Boolean).join(' ')
}

const rowVerticalAlignClass = (row) => {
  const map = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  }
  return map[row?.verticalAlign] || map.start
}

const rowGridStyle = (row) => {
  if (isMobilePreview.value)
    return {}
  if (!rowUsesSpans(row))
    return {}
  return { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }
}

const columnSpanStyle = (col) => {
  if (isMobilePreview.value)
    return {}
  if (!Number.isFinite(col?.span))
    return {}
  const span = Math.min(Math.max(col.span, 1), 6)
  return { gridColumn: `span ${span} / span ${span}` }
}

const columnSpanClass = (col) => {
  if (!Number.isFinite(col?.span))
    return ''
  const span = Math.min(Math.max(col.span, 1), 6)
  return `col-span-${span}`
}

const columnMobileOrderClass = (row, idx) => {
  const len = row?.columns?.length || 0
  if (!len)
    return ''
  const order = row?.mobileOrder === 'reverse' ? (len - idx) : (idx + 1)
  return [`order-${order}`, 'sm:order-none'].join(' ')
}

const columnMobileOrderStyle = (row, idx) => {
  if (!isMobilePreview.value)
    return {}
  const len = row?.columns?.length || 0
  if (!len)
    return {}
  const order = row?.mobileOrder === 'reverse' ? (len - idx) : (idx + 1)
  return { order, gridRowStart: order }
}

const computeRowTailwindClasses = (row) => {
  const classes = [
    rowWidthClass(row?.width),
    backgroundClass(row?.background),
    rowGridClassForData(row),
    rowVerticalAlignClass(row),
    rowGapClass(row),
  ]
  return classes.filter(Boolean).join(' ').trim()
}

const computeColumnTailwindClasses = (row, idx) => {
  const classes = [
    columnSpanClass(row?.columns?.[idx]),
    columnMobileOrderClass(row, idx),
  ]
  return classes.filter(Boolean).join(' ').trim()
}

function refreshRowTailwindClasses(row) {
  if (!row)
    return
  row.tailwindClasses = computeRowTailwindClasses(row)
  if (Array.isArray(row.columns)) {
    row.columns.forEach((col, idx) => {
      col.tailwindClasses = computeColumnTailwindClasses(row, idx)
    })
  }
}

const activeRowSettingsRow = computed(() => {
  if (state.rowSettings.rowRef)
    return state.rowSettings.rowRef
  const key = state.rowSettings.isPost ? 'postStructure' : 'structure'
  const rows = state.workingDoc?.[key] || []
  return rows.find(row => row.id === state.rowSettings.rowId) || null
})

const resetRowSettingsDraft = (row) => {
  state.rowSettings.draft = {
    width: row?.width || 'full',
    gap: row?.gap || '4',
    verticalAlign: row?.verticalAlign || 'start',
    background: row?.background || 'transparent',
    mobileOrder: row?.mobileOrder || 'normal',
    marginXMode: resolveMarginXMode(row),
    paddingTop: normalizeSpacingValue(row?.paddingTop ?? row?.paddingY),
    paddingRight: normalizeSpacingValue(row?.paddingRight ?? row?.paddingX),
    paddingBottom: normalizeSpacingValue(row?.paddingBottom ?? row?.paddingY),
    paddingLeft: normalizeSpacingValue(row?.paddingLeft ?? row?.paddingX),
    marginTop: normalizeSpacingValue(row?.marginTop ?? row?.marginY),
    marginRight: normalizeSpacingValue(row?.marginRight ?? row?.marginX),
    marginBottom: normalizeSpacingValue(row?.marginBottom ?? row?.marginY),
    marginLeft: normalizeSpacingValue(row?.marginLeft ?? row?.marginX),
  }
}

const openRowSettings = (row, isPost = false) => {
  state.rowSettings.rowId = row?.id || null
  state.rowSettings.rowRef = row || null
  state.rowSettings.isPost = isPost
  resetRowSettingsDraft(row)
  state.rowSettings.open = true
}

const saveRowSettings = () => {
  const row = activeRowSettingsRow.value
  if (!row) {
    state.rowSettings.open = false
    return
  }
  const draft = state.rowSettings.draft || {}
  row.width = draft.width || 'full'
  row.gap = draft.gap || '4'
  row.verticalAlign = draft.verticalAlign || 'start'
  row.background = draft.background || 'transparent'
  row.mobileOrder = draft.mobileOrder || 'normal'
  row.marginXMode = normalizeMarginXMode(draft.marginXMode)
  row.paddingTop = normalizeSpacingValue(draft.paddingTop)
  row.paddingRight = normalizeSpacingValue(draft.paddingRight)
  row.paddingBottom = normalizeSpacingValue(draft.paddingBottom)
  row.paddingLeft = normalizeSpacingValue(draft.paddingLeft)
  row.marginTop = normalizeSpacingValue(draft.marginTop)
  row.marginRight = normalizeSpacingValue(draft.marginRight)
  row.marginBottom = normalizeSpacingValue(draft.marginBottom)
  row.marginLeft = normalizeSpacingValue(draft.marginLeft)
  refreshRowTailwindClasses(row)
  state.rowSettings.open = false
}

const closeAddRowPopover = (isPost = false, position = 'top', rowId = null) => {
  const pop = state.addRowPopoverOpen
  if (position === 'top') {
    if (isPost)
      pop.postTop = false
    else
      pop.listTop = false
    return
  }
  if (position === 'empty') {
    if (isPost)
      pop.postEmpty = false
    else
      pop.listEmpty = false
    return
  }
  if (position === 'bottom') {
    if (isPost)
      pop.postBottom = false
    else
      pop.listBottom = false
    return
  }
  if (position === 'between' && rowId) {
    const target = isPost ? pop.postBetween : pop.listBetween
    target[rowId] = false
  }
}

const addRowAndClose = (workingDoc, layoutValue, insertIndex, isPost = false, position = 'top', rowId = null) => {
  addRowAt(workingDoc, layoutValue, insertIndex, isPost)
  closeAddRowPopover(isPost, position, rowId)
}

const moveRow = (workingDoc, index, delta, isPost = false) => {
  if (!workingDoc)
    return
  const key = isPost ? 'postStructure' : 'structure'
  const rows = workingDoc[key]
  if (!Array.isArray(rows))
    return
  const targetIndex = index + delta
  if (targetIndex < 0 || targetIndex >= rows.length)
    return
  const [row] = rows.splice(index, 1)
  rows.splice(targetIndex, 0, row)
}

const isLayoutSelected = (layoutId, isPost = false) => {
  return (isPost ? state.newPostRowLayout : state.newRowLayout) === layoutId
}

const selectLayout = (spans, isPost = false) => {
  const id = spans.join('-')
  if (isPost)
    state.newPostRowLayout = id
  else
    state.newRowLayout = id
}

const buildColumnsFromSpans = (spans) => {
  return spans.map(span => ({
    id: edgeGlobal.generateShortId(),
    blocks: [],
    span,
  }))
}

function createRowFromLayout(spans) {
  const safeSpans = layoutSpansFromString(spans, [6])
  const row = {
    id: edgeGlobal.generateShortId(),
    width: 'full',
    gap: '4',
    background: 'transparent',
    verticalAlign: 'start',
    mobileOrder: 'normal',
    marginXMode: 'auto',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    columns: buildColumnsFromSpans(safeSpans),
  }
  refreshRowTailwindClasses(row)
  return row
}

function addRowAt(workingDoc, layoutValue = '6', insertIndex = 0, isPost = false) {
  ensureStructureDefaults(workingDoc, isPost)
  const structureKey = isPost ? 'postStructure' : 'structure'
  const count = workingDoc[structureKey]?.length || 0
  const safeIndex = Math.min(Math.max(insertIndex, 0), count)
  workingDoc[structureKey].splice(safeIndex, 0, createRowFromLayout(layoutValue))
}

const headObject = computed(() => {
  const themeId = effectiveThemeId.value
  if (!themeId)
    return lastResolvedHead.value || {}
  try {
    const parsedHead = parseHeadDoc(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[themeId] || null)
    if (parsedHead && typeof parsedHead === 'object') {
      lastResolvedHead.value = parsedHead
      writeThemeCache({ head: parsedHead })
      return parsedHead
    }
    return lastResolvedHead.value || {}
  }
  catch (e) {
    return lastResolvedHead.value || {}
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const isPublishedPageDiff = (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  const draftPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[pageId]
  if (!publishedPage && draftPage) {
    return true
  }
  if (publishedPage && !draftPage) {
    return true
  }
  if (publishedPage && draftPage) {
    return !areEqualNormalized(
      {
        content: publishedPage.content,
        postContent: publishedPage.postContent,
        structure: publishedPage.structure,
        postStructure: publishedPage.postStructure,
        metaTitle: publishedPage.metaTitle,
        metaDescription: publishedPage.metaDescription,
        structuredData: publishedPage.structuredData,
        postMetaTitle: publishedPage.postMetaTitle,
        postMetaDescription: publishedPage.postMetaDescription,
        postStructuredData: publishedPage.postStructuredData,
      },
      {
        content: draftPage.content,
        postContent: draftPage.postContent,
        structure: draftPage.structure,
        postStructure: draftPage.postStructure,
        metaTitle: draftPage.metaTitle,
        metaDescription: draftPage.metaDescription,
        structuredData: draftPage.structuredData,
        postMetaTitle: draftPage.postMetaTitle,
        postMetaDescription: draftPage.postMetaDescription,
        postStructuredData: draftPage.postStructuredData,
      },
    )
  }
  return false
}

const isPagePublished = (pageId) => {
  const publishedDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  return !!publishedDoc
}

const getPagePublishStatus = (pageId) => {
  const published = isPagePublished(pageId)
  if (!published) {
    return {
      key: 'unpublished',
      label: 'Unpublished',
      icon: 'unpublished',
      canPublish: true,
      canUnpublish: false,
      badgeClass: 'text-slate-600 dark:text-slate-300',
    }
  }

  if (isPublishedPageDiff(pageId)) {
    return {
      key: 'publishedWithChanges',
      label: 'Published (Unpublished Changes)',
      icon: 'changes',
      canPublish: true,
      canUnpublish: true,
      badgeClass: 'text-amber-700 dark:text-amber-300',
    }
  }

  return {
    key: 'published',
    label: 'Published',
    icon: 'published',
    canPublish: false,
    canUnpublish: true,
    badgeClass: 'text-emerald-700 dark:text-emerald-300',
  }
}

const lastPublishedTime = (pageId) => {
  const timestamp = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]?.last_updated
  if (!timestamp)
    return 'Never'
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const publishedPage = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[props.page] || null
})

const currentPage = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page] || null
})

const siteDoc = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site] || null
})

const publishedSiteSettingsDoc = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site] || null
})

const isExternalMenuLink = entry => entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'

const normalizeDomain = (value) => {
  if (!value)
    return ''
  let normalized = String(value).trim().toLowerCase()
  if (!normalized)
    return ''
  if (normalized.includes('://')) {
    try {
      normalized = new URL(normalized).host
    }
    catch {
      normalized = normalized.split('://').pop() || normalized
    }
  }
  normalized = normalized.split('/')[0] || ''
  return normalized.replace(/\.+$/g, '')
}

const firstValidDomain = (domains) => {
  if (!Array.isArray(domains))
    return ''
  for (const domain of domains) {
    const normalized = normalizeDomain(domain)
    if (normalized)
      return normalized
  }
  return ''
}

const normalizePathSlug = value => String(value || '').trim().toLowerCase()

const currentPageLiveOrigin = computed(() => {
  if (props.isTemplateSite)
    return ''
  const host = firstValidDomain(publishedSiteSettingsDoc.value?.domains) || firstValidDomain(siteDoc.value?.domains)
  return host ? `https://${host}` : ''
})

const findPageRouteSegments = (menus, pageId, folderSlugs = []) => {
  for (const menuItems of Object.values(menus || {})) {
    if (!Array.isArray(menuItems))
      continue
    for (const entry of menuItems) {
      if (isExternalMenuLink(entry))
        continue
      if (typeof entry?.item === 'string' && entry.item === pageId) {
        const pageSlug = normalizePathSlug(entry?.name)
        if (!pageSlug)
          return []
        return [...folderSlugs, pageSlug]
      }
      if (entry?.item && typeof entry.item === 'object') {
        const folderSlug = Object.keys(entry.item || {})[0]
        if (!folderSlug)
          continue
        const nested = findPageRouteSegments(entry.item[folderSlug], pageId, [...folderSlugs, normalizePathSlug(folderSlug)])
        if (nested.length)
          return nested
      }
    }
  }
  return []
}

const currentPageLiveUrl = computed(() => {
  const origin = currentPageLiveOrigin.value
  if (!origin || props.isTemplateSite)
    return ''

  const routeSegments = findPageRouteSegments(siteDoc.value?.menus || {}, props.page, [])
  if (!routeSegments.length)
    return ''

  if (routeSegments.length === 1 && routeSegments[0] === 'home')
    return `${origin}/`

  return `${origin}/${routeSegments.map(segment => encodeURIComponent(segment)).join('/')}`
})

const currentMenuPageEntry = computed(() => {
  if (props.isTemplateSite)
    return null
  let found = null
  const visitItems = (items) => {
    if (found || !Array.isArray(items))
      return
    for (const entry of items) {
      if (!entry || typeof entry !== 'object')
        continue
      if (typeof entry?.item === 'string' && entry.item === props.page) {
        found = edgeGlobal.dupObject(entry)
        return
      }
      if (entry?.item && typeof entry.item === 'object') {
        for (const nested of Object.values(entry.item)) {
          if (Array.isArray(nested))
            visitItems(nested)
          if (found)
            return
        }
      }
    }
  }
  for (const menuItems of Object.values(siteDoc.value?.menus || {})) {
    visitItems(menuItems)
    if (found)
      break
  }
  return found
})

const currentPageRenameLabel = computed(() => {
  if (props.isTemplateSite)
    return String(currentPage.value?.name || props.page || '').trim() || 'Template'
  return String(
    currentMenuPageEntry.value?.menuTitle
    || currentMenuPageEntry.value?.name
    || currentPage.value?.name
    || props.page
    || '',
  ).trim() || 'Page'
})

const blocksCollection = computed(() => edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {})

function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeSyncedBlockMeta(currentMeta, existingMeta) {
  const nextMeta = edgeGlobal.dupObject(currentMeta || {})
  if (!isObjectRecord(existingMeta))
    return nextMeta

  Object.entries(existingMeta).forEach(([key, value]) => {
    if (!isObjectRecord(value) || !isObjectRecord(value.queryItems))
      return
    if (!isObjectRecord(nextMeta[key]))
      nextMeta[key] = {}
    nextMeta[key].queryItems = edgeGlobal.dupObject(value.queryItems)
  })

  return nextMeta
}

function resolveSyncedPageBlock(block) {
  if (!isObjectRecord(block))
    return block

  const resolvedBlock = edgeGlobal.dupObject(block)
  const blockId = String(resolvedBlock.blockId || '').trim()
  if (!blockId)
    return resolvedBlock

  const currentBlockDoc = blocksCollection.value?.[blockId]
  if (!isObjectRecord(currentBlockDoc))
    return resolvedBlock

  const instanceProtection = isObjectRecord(resolvedBlock.protection)
    ? edgeGlobal.dupObject(resolvedBlock.protection)
    : null

  return {
    ...edgeGlobal.dupObject(currentBlockDoc),
    id: resolvedBlock.id,
    blockId,
    synced: resolvedBlock.synced ?? currentBlockDoc.synced ?? false,
    values: edgeGlobal.dupObject(resolvedBlock.values || {}),
    meta: mergeSyncedBlockMeta(currentBlockDoc.meta, resolvedBlock.meta),
    ...(instanceProtection ? { protection: instanceProtection } : {}),
  }
}

function resolveSyncedBlocks(blocks = []) {
  if (!Array.isArray(blocks))
    return []
  return blocks.map(block => resolveSyncedPageBlock(block))
}

function resolveSyncedPageDoc(doc) {
  if (!isObjectRecord(doc))
    return doc

  const nextDoc = edgeGlobal.dupObject(doc)
  nextDoc.content = resolveSyncedBlocks(nextDoc.content)
  nextDoc.postContent = resolveSyncedBlocks(nextDoc.postContent)

  const blockIds = [
    ...(Array.isArray(nextDoc.content) ? nextDoc.content.map(block => block?.blockId).filter(Boolean) : []),
    ...(Array.isArray(nextDoc.postContent) ? nextDoc.postContent.map(block => block?.blockId).filter(Boolean) : []),
  ]
  nextDoc.blockIds = [...new Set(blockIds)]
  return nextDoc
}

function buildComparablePageBlock(block) {
  if (!isObjectRecord(block))
    return block

  const blockId = String(block.blockId || '').trim()
  const currentBlockDoc = blockId ? blocksCollection.value?.[blockId] : null
  if (blockId && isObjectRecord(currentBlockDoc)) {
    const comparableMeta = {}
    Object.entries(block.meta || {}).forEach(([key, value]) => {
      if (isObjectRecord(value) && isObjectRecord(value.queryItems))
        comparableMeta[key] = { queryItems: edgeGlobal.dupObject(value.queryItems) }
    })
    return {
      id: String(block.id || ''),
      blockId,
      synced: block.synced ?? currentBlockDoc.synced ?? false,
      values: edgeGlobal.dupObject(block.values || {}),
      meta: comparableMeta,
      protection: isObjectRecord(block.protection) ? edgeGlobal.dupObject(block.protection) : {},
    }
  }

  return edgeGlobal.dupObject(block)
}

const currentHistoryCompareDoc = computed(() => resolveSyncedPageDoc(currentPage.value))

const buildComparablePageDiffDoc = (doc) => {
  if (!doc || typeof doc !== 'object')
    return null

  return {
    content: Array.isArray(doc.content) ? doc.content.map(buildComparablePageBlock) : [],
    postContent: Array.isArray(doc.postContent) ? doc.postContent.map(buildComparablePageBlock) : [],
    structure: Array.isArray(doc.structure) ? doc.structure : [],
    postStructure: Array.isArray(doc.postStructure) ? doc.postStructure : [],
    metaTitle: doc.metaTitle ?? '',
    metaDescription: doc.metaDescription ?? '',
    structuredData: doc.structuredData ?? null,
    postMetaTitle: doc.postMetaTitle ?? '',
    postMetaDescription: doc.postMetaDescription ?? '',
    postStructuredData: doc.postStructuredData ?? null,
  }
}

const pageDocsMatchForDiff = (baseDoc, compareDoc) => {
  return areEqualNormalized(
    buildComparablePageDiffDoc(baseDoc),
    buildComparablePageDiffDoc(compareDoc),
  )
}

const getHistorySnapshotState = (item) => {
  if (isPlainObject(item?.afterData))
    return 'afterData'
  if (isPlainObject(item?.beforeData))
    return 'beforeData'
  return ''
}

const getHistorySnapshotDoc = item => item?.[getHistorySnapshotState(item)] || null

const rawHistoryPreviewItems = computed(() => {
  return (state.historyItems || []).filter((item) => {
    return !!getHistorySnapshotDoc(item)
  })
})

const historyPreviewItems = computed(() => {
  const items = rawHistoryPreviewItems.value
  if (!items.length)
    return []

  const [firstItem, ...restItems] = items
  const firstHistoryDoc = getHistorySnapshotDoc(firstItem)
  if (firstHistoryDoc && pageDocsMatchForDiff(firstHistoryDoc, currentPage.value))
    return restItems

  return items
})

const selectedHistoryEntry = computed(() => {
  return historyPreviewItems.value.find(item => item.historyId === state.historySelectedId) || null
})

const historyPreviewHasPostView = computed(() => {
  return hasPostView(renderedHistoryPreviewDoc.value)
})

const historyPreviewRenderKey = computed(() => {
  const historyId = String(state.historySelectedId || 'none')
  const themeKey = String((effectiveThemeId.value || selectedThemeId.value || 'no-theme'))
  const previewMode = String(state.historyPreviewView || 'list')
  return `${historyId}:${themeKey}:${previewMode}:${previewRouteLastSegment.value || 'auto'}`
})

const historyVersionItems = computed(() => {
  return historyPreviewItems.value.map((item, index) => ({
    name: item.historyId,
    title: formatHistoryEntryLabel(item, index),
  }))
})

const renderedHistoryPreviewDoc = computed(() => resolveSyncedPageDoc(state.historyPreviewDoc))

const pagePublishStatus = computed(() => getPagePublishStatus(props.page))

const pagesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`)
const pagesCollection = computed(() => edgeFirebase.data?.[pagesCollectionPath.value] || {})
const pageEditorBasePath = computed(() => (props.isTemplateSite ? '/app/dashboard/templates' : `/app/dashboard/sites/${props.site}`))
const INVALID_PAGE_IMPORT_MESSAGE = 'Invalid file. Please import a valid page file.'
const TEMPLATE_PAGE_TYPE_ITEMS = [
  { name: 'Page', title: 'Page' },
  { name: 'Post', title: 'Post' },
]

function coerceTemplatePageTypes(value) {
  const rawValues = Array.isArray(value) ? value : [value]
  const normalized = rawValues
    .map((typeValue) => {
      if (typeValue && typeof typeValue === 'object') {
        const objectValue = typeValue.name ?? typeValue.value ?? typeValue.title ?? typeValue.label ?? ''
        return String(objectValue || '')
      }
      return String(typeValue || '')
    })
    .map(typeValue => typeValue.trim().toLowerCase())
    .flatMap((typeValue) => {
      if (typeValue === 'page')
        return ['Page']
      if (typeValue === 'post')
        return ['Post']
      if (typeValue === 'both')
        return ['Page', 'Post']
      return []
    })

  return [...new Set(normalized)]
}

function normalizeTemplatePageTypeSelections(value, { fallback = ['Page'], excludePost = false } = {}) {
  const filtered = coerceTemplatePageTypes(value).filter(typeValue => !(excludePost && typeValue === 'Post'))
  if (filtered.length)
    return filtered

  const fallbackTypes = coerceTemplatePageTypes(fallback).filter(typeValue => !(excludePost && typeValue === 'Post'))
  return fallbackTypes.length ? fallbackTypes : ['Page']
}

const templateTypeItems = (workingDoc) => {
  if (workingDoc?.post)
    return TEMPLATE_PAGE_TYPE_ITEMS.filter(item => item.name === 'Page')
  return TEMPLATE_PAGE_TYPE_ITEMS
}

const templateTypeIncludesPost = (workingDoc) => {
  return normalizeTemplatePageTypeSelections(workingDoc?.type, { fallback: ['Page'] }).includes('Post')
}

const templateAllowedBlockTypes = (workingDoc) => {
  if (!props.isTemplateSite)
    return ['Page']
  return normalizeTemplatePageTypeSelections(workingDoc?.type, { fallback: ['Page'], excludePost: Boolean(workingDoc?.post) })
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

const cloneHistoryPreviewDoc = (doc) => {
  if (!isPlainObject(doc))
    return null
  const previewDoc = edgeGlobal.dupObject(doc)
  ensureStructureDefaults(previewDoc, false)
  if (hasPostView(previewDoc))
    ensureStructureDefaults(previewDoc, true)
  return previewDoc
}

const syncHistoryPreviewDoc = (entry) => {
  state.historyPreviewDoc = cloneHistoryPreviewDoc(getHistorySnapshotDoc(entry))
  state.historyPreviewView = hasPostView(state.historyPreviewDoc) ? state.historyPreviewView : 'list'
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

const loadPageHistory = async () => {
  if (!edgeFirebase?.user?.uid || !currentPagePath.value)
    return

  state.historyLoading = true
  state.historyError = ''
  try {
    const response = await edgeFirebase.runFunction('history-listHistory', {
      uid: edgeFirebase.user.uid,
      path: currentPagePath.value,
      limit: 50,
    })
    let items = extractHistoryItemsFromResponse(response)

    if (!items.length && edgeGlobal.edgeState.currentOrganization) {
      const fallbackResponse = await edgeFirebase.runFunction('history-listHistory', {
        uid: edgeFirebase.user.uid,
        orgId: edgeGlobal.edgeState.currentOrganization,
        limit: 200,
      })
      const fallbackItems = extractHistoryItemsFromResponse(fallbackResponse)
      items = fallbackItems.filter((item) => {
        const itemPath = String(item?.path || '').trim()
        const itemRelativePath = String(item?.relativePath || '').trim()
        return itemPath === currentPagePath.value || itemRelativePath === currentPageRelativePath.value
      })
    }

    state.historyItems = items
    const nextSelectedId = historyPreviewItems.value.find(item => item.historyId === state.historySelectedId)?.historyId
      || historyPreviewItems.value[0]?.historyId
      || ''
    state.historySelectedId = nextSelectedId
    syncHistoryPreviewDoc(selectedHistoryEntry.value)
  }
  catch (error) {
    console.error('Failed to load page history', error)
    state.historyItems = []
    state.historySelectedId = ''
    state.historyPreviewDoc = null
    state.historyError = 'Failed to load page history.'
  }
  finally {
    state.historyLoading = false
  }
}

const openHistoryDialog = async () => {
  if (!currentPage.value || !currentPagePath.value || !edgeFirebase?.user?.uid)
    return
  state.historySelectedId = ''
  state.historyDialogOpen = true
  await loadPageHistory()
}

const closeHistoryDialog = () => {
  if (state.historyRestoring)
    return
  state.showHistoryDiffDialog = false
  state.historyDialogOpen = false
}

const openHistoryFromRoute = async () => {
  if (!route.query.history || state.historyDialogOpen || !currentPage.value || !currentPagePath.value || !edgeFirebase?.user?.uid)
    return
  await openHistoryDialog()
  const nextQuery = { ...route.query }
  delete nextQuery.history
  await router.replace({ query: nextQuery })
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
    const restoredDoc = cloneHistoryPreviewDoc(getHistorySnapshotDoc(historyEntry))
    const syncedRestoredDoc = resolveSyncedPageDoc(restoredDoc)
    if (syncedRestoredDoc && props.page && props.page !== 'new')
      await edgeFirebase.storeDoc(pagesCollectionPath.value, syncedRestoredDoc, props.page)
    if (syncedRestoredDoc && pagesCollection.value)
      pagesCollection.value[props.page] = edgeGlobal.dupObject(syncedRestoredDoc)
    state.workingDoc = buildPageWorkingDocOverrides(syncedRestoredDoc)
    state.editorWorkingDoc = syncedRestoredDoc ? edgeGlobal.dupObject(syncedRestoredDoc) : null
    state.editorHasUnsavedChanges = false
    state.previewPageView = hasPostView(syncedRestoredDoc) ? state.historyPreviewView : 'list'
    state.editMode = false
    state.showHistoryDiffDialog = false
    state.historyDialogOpen = false
    state.editorKey += 1
    notifySuccess(`Restored ${props.isTemplateSite ? 'template' : 'page'} from ${formatHistoryEntryLabel(historyEntry)}.`)
  }
  catch (error) {
    console.error('Failed to restore history version', error)
    state.historyError = 'Failed to restore this version.'
    notifyError(`Failed to restore ${props.isTemplateSite ? 'template' : 'page'} history.`)
  }
  finally {
    state.historyRestoring = false
  }
}

const templateTagItems = computed(() => {
  if (!props.isTemplateSite)
    return []
  const tags = new Set()
  for (const doc of Object.values(pagesCollection.value || {})) {
    if (!Array.isArray(doc?.tags))
      continue
    for (const tag of doc.tags) {
      const normalized = typeof tag === 'string' ? tag.trim() : ''
      if (normalized && normalized.toLowerCase() !== 'quick picks')
        tags.add(normalized)
    }
  }
  for (const tag of state.templateManualTags) {
    const normalized = typeof tag === 'string' ? tag.trim() : ''
    if (normalized && normalized.toLowerCase() !== 'quick picks')
      tags.add(normalized)
  }
  const tagList = Array.from(tags)
    .sort((a, b) => a.localeCompare(b))
    .map(tag => ({ name: tag, title: tag }))
  return [{ name: 'Quick Picks', title: 'Quick Picks' }, ...tagList]
})

const addTemplateTagOption = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized)
    return
  if (!state.templateManualTags.includes(normalized))
    state.templateManualTags.push(normalized)
}

const readTextFile = file => new Promise((resolve, reject) => {
  if (typeof FileReader === 'undefined') {
    reject(new Error('File import is only available in the browser.'))
    return
  }
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Could not read the selected file.'))
  reader.readAsText(file)
})

const normalizeImportedDoc = (payload, fallbackDocId = '') => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  if (payload.document && typeof payload.document === 'object' && !Array.isArray(payload.document)) {
    const normalized = { ...payload.document }
    if (!normalized.docId && payload.docId)
      normalized.docId = payload.docId
    if (!normalized.docId && fallbackDocId)
      normalized.docId = fallbackDocId
    return normalized
  }

  const normalized = { ...payload }
  if (!normalized.docId && fallbackDocId)
    normalized.docId = fallbackDocId
  return normalized
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

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

const getPageDocDefaults = () => getDocDefaultsFromSchema(state.newDocs?.pages || {})

const isBlankString = value => String(value || '').trim() === ''
const isJsonInvalid = (value) => {
  if (value === null || value === undefined)
    return false
  if (typeof value === 'object')
    return false
  const text = String(value).trim()
  if (!text)
    return false
  try {
    JSON.parse(text)
    return false
  }
  catch {
    return true
  }
}

const hasStructuredDataErrors = (doc) => {
  if (!doc)
    return false
  if (isJsonInvalid(doc.structuredData))
    return true
  if (doc.post && isJsonInvalid(doc.postStructuredData))
    return true
  return false
}

const applyImportedPageSeoDefaults = (doc) => {
  if (!isPlainObject(doc))
    return doc

  if (isBlankString(doc.structuredData))
    doc.structuredData = buildPageStructuredData()

  if (doc.post && isBlankString(doc.postStructuredData))
    doc.postStructuredData = doc.structuredData || buildPageStructuredData()

  return doc
}

const validateImportedPageDoc = (doc) => {
  if (!isPlainObject(doc))
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  const requiredKeys = Object.keys(state.newDocs?.pages || {})
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  return doc
}

const normalizeMenusForImport = (menus) => {
  const normalized = isPlainObject(menus) ? edgeGlobal.dupObject(menus) : {}
  if (!Array.isArray(normalized['Site Root']))
    normalized['Site Root'] = []
  if (!Array.isArray(normalized['Not In Menu']))
    normalized['Not In Menu'] = []
  return normalized
}

const walkMenuEntries = (items, callback) => {
  if (!Array.isArray(items))
    return
  for (const entry of items) {
    if (!entry || typeof entry !== 'object')
      continue
    callback(entry)
    if (isPlainObject(entry.item)) {
      for (const nested of Object.values(entry.item)) {
        if (Array.isArray(nested))
          walkMenuEntries(nested, callback)
      }
    }
  }
}

const menuIncludesDocId = (menus, docId) => {
  let found = false
  const checkEntry = (entry) => {
    if (found)
      return
    if (typeof entry?.item === 'string' && entry.item === docId)
      found = true
  }
  for (const menuItems of Object.values(menus || {})) {
    walkMenuEntries(menuItems, checkEntry)
    if (found)
      return true
  }
  return false
}

const collectMenuPageNames = (menus) => {
  const names = new Set()
  const collectEntry = (entry) => {
    if (typeof entry?.item !== 'string')
      return
    const name = String(entry?.name || '').trim()
    if (name)
      names.add(name)
  }
  for (const menuItems of Object.values(menus || {}))
    walkMenuEntries(menuItems, collectEntry)
  return names
}

const slugifyMenuPageName = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'page'
}
const titleFromSlug = (slug) => {
  if (!slug)
    return ''
  return String(slug).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

const makeUniqueMenuPageName = (value, existingNames = new Set()) => {
  const base = slugifyMenuPageName(value)
  let candidate = base
  let suffix = 2
  while (existingNames.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const addImportedPageToSiteMenu = async (docId, pageName = '') => {
  const nextDocId = String(docId || '').trim()
  if (!nextDocId)
    return
  const siteId = String(props.site || '').trim()
  if (!siteId)
    return

  const sitesCollectionPath = `${edgeGlobal.edgeState.organizationDocPath}/sites`
  const siteDoc = edgeFirebase.data?.[sitesCollectionPath]?.[siteId] || {}
  const menus = normalizeMenusForImport(siteDoc?.menus)
  if (menuIncludesDocId(menus, nextDocId))
    return

  const existingNames = collectMenuPageNames(menus)
  const menuName = makeUniqueMenuPageName(pageName || nextDocId, existingNames)
  const menuTitle = String(pageName || '').trim() || titleFromSlug(menuName)
  menus['Site Root'].push({ name: menuName, menuTitle, item: nextDocId })

  const results = await edgeFirebase.changeDoc(sitesCollectionPath, siteId, { menus })
  if (results?.success === false)
    throw new Error('Could not save updated site menu.')
}

const makeRandomPageDocId = (docsMap = {}) => {
  let nextDocId = String(edgeGlobal.generateShortId() || '').trim()
  while (!nextDocId || docsMap[nextDocId])
    nextDocId = String(edgeGlobal.generateShortId() || '').trim()
  return nextDocId
}

const makeImportedPageNameForNew = (baseName, docsMap = {}) => {
  const normalizedBase = String(baseName || '').trim() || 'page'
  const existingNames = new Set(
    Object.values(docsMap || {})
      .map(doc => String(doc?.name || '').trim().toLowerCase())
      .filter(Boolean),
  )

  let suffix = 1
  let candidate = `${normalizedBase}-${suffix}`
  while (existingNames.has(candidate.toLowerCase())) {
    suffix += 1
    candidate = `${normalizedBase}-${suffix}`
  }
  return candidate
}

const openRenamePageDialog = () => {
  if (!props.page || props.page === 'new')
    return
  state.renamePageValue = currentPageRenameLabel.value
  state.renamePageSubmitting = false
  state.renamePageDialogOpen = true
}

const openCurrentPageSettings = async () => {
  if (!currentPage.value || !props.page || props.page === 'new')
    return
  state.pageSettingsRestrictionRuleId = getPageRestrictionAssignment(props.page, false)
  state.pageSettingsPostRestrictionRuleId = getPageRestrictionAssignment(props.page, true)
  state.pageSettingsOpen = true
}

const removePageFromMenuItems = (items, pageId) => {
  if (!Array.isArray(items))
    return []

  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object')
        return entry

      if (typeof entry.item === 'string')
        return entry.item === pageId ? null : entry

      if (entry.item && typeof entry.item === 'object') {
        const nextEntry = edgeGlobal.dupObject(entry)
        for (const [folderSlug, nestedItems] of Object.entries(nextEntry.item || {})) {
          nextEntry.item[folderSlug] = removePageFromMenuItems(nestedItems, pageId)
        }
        return nextEntry
      }

      return entry
    })
    .filter(Boolean)
}

const removePageFromMenus = (menus, pageId) => {
  const nextMenus = normalizeMenusForImport(menus)
  for (const [menuName, items] of Object.entries(nextMenus))
    nextMenus[menuName] = removePageFromMenuItems(items, pageId)
  return nextMenus
}

const renameCurrentPageAction = async () => {
  const nextName = String(state.renamePageValue || '').trim()
  if (!nextName || state.renamePageSubmitting || !props.page || props.page === 'new')
    return

  state.renamePageSubmitting = true
  try {
    if (props.isTemplateSite) {
      await edgeFirebase.changeDoc(pagesCollectionPath.value, props.page, { name: nextName })
      notifySuccess(`Renamed template "${props.page}".`)
      state.renamePageDialogOpen = false
      return
    }

    const menus = normalizeMenusForImport(siteDoc.value?.menus)
    const currentEntry = currentMenuPageEntry.value
    const existingNames = collectMenuPageNames(menus)
    if (currentEntry?.name)
      existingNames.delete(String(currentEntry.name || '').trim())

    const nextSlug = makeUniqueMenuPageName(nextName, existingNames)
    const nextMenuTitle = nextName || titleFromSlug(nextSlug)
    const menuResults = edgeGlobal.dupObject(menus)

    walkMenuEntries(Object.values(menuResults).flat(), (entry) => {
      if (typeof entry?.item !== 'string' || entry.item !== props.page)
        return
      entry.name = nextSlug
      entry.menuTitle = nextMenuTitle
    })

    await edgeFirebase.changeDoc(pagesCollectionPath.value, props.page, { name: nextSlug })
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { menus: menuResults })
    notifySuccess(`Renamed page "${props.page}".`)
    state.renamePageDialogOpen = false
  }
  catch (error) {
    console.error('Failed to rename page', error)
    notifyError(`Failed to rename ${props.isTemplateSite ? 'template' : 'page'}.`)
  }
  finally {
    state.renamePageSubmitting = false
  }
}

const deleteCurrentPage = async () => {
  if (state.deletePageSubmitting || !props.page || props.page === 'new')
    return

  state.deletePageSubmitting = true
  try {
    if (!props.isTemplateSite) {
      const nextMenus = removePageFromMenus(siteDoc.value?.menus, props.page)
      const nextAssignments = { ...normalizeRestrictedPageRuleAssignments(siteDoc.value?.restrictedContent?.pageRuleAssignments) }
      delete nextAssignments[getPageRestrictionAssignmentKey(props.page, false)]
      delete nextAssignments[getPageRestrictionAssignmentKey(props.page, true)]
      const nextRestrictedContent = {
        ...((siteDoc.value?.restrictedContent && typeof siteDoc.value.restrictedContent === 'object') ? siteDoc.value.restrictedContent : {}),
        pageRuleAssignments: nextAssignments,
      }
      await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, {
        menus: nextMenus,
        restrictedContent: nextRestrictedContent,
      })
      if (isPagePublished(props.page))
        await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, props.page)
    }

    await edgeFirebase.removeDoc(pagesCollectionPath.value, props.page)
    state.deletePageDialogOpen = false
    notifySuccess(`Deleted ${props.isTemplateSite ? 'template' : 'page'} "${props.page}".`)
    await router.push(pageEditorBasePath.value)
  }
  catch (error) {
    console.error('Failed to delete page', error)
    notifyError(`Failed to delete ${props.isTemplateSite ? 'template' : 'page'}.`)
  }
  finally {
    state.deletePageSubmitting = false
  }
}

const requestPageImportDocId = (initialValue = '') => {
  state.importDocIdValue = String(initialValue || '')
  state.importDocIdDialogOpen = true
  return new Promise((resolve) => {
    pageImportDocIdResolver.value = resolve
  })
}

const resolvePageImportDocId = (value = '') => {
  const resolver = pageImportDocIdResolver.value
  pageImportDocIdResolver.value = null
  state.importDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestPageImportConflict = (docId) => {
  state.importConflictDocId = String(docId || '')
  state.importConflictDialogOpen = true
  return new Promise((resolve) => {
    pageImportConflictResolver.value = resolve
  })
}

const resolvePageImportConflict = (action = 'cancel') => {
  const resolver = pageImportConflictResolver.value
  pageImportConflictResolver.value = null
  state.importConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

watch(() => state.importDocIdDialogOpen, (open) => {
  if (!open && pageImportDocIdResolver.value) {
    const resolver = pageImportDocIdResolver.value
    pageImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importConflictDialogOpen, (open) => {
  if (!open && pageImportConflictResolver.value) {
    const resolver = pageImportConflictResolver.value
    pageImportConflictResolver.value = null
    resolver('cancel')
  }
})

const getImportDocId = async (incomingDoc, fallbackDocId = '') => {
  let nextDocId = String(incomingDoc?.docId || '').trim()
  if (!nextDocId)
    nextDocId = await requestPageImportDocId(fallbackDocId)
  if (!nextDocId)
    throw new Error('Import canceled. A docId is required.')
  if (nextDocId.includes('/'))
    throw new Error('docId cannot include "/".')
  return nextDocId
}

const notifySuccess = (message) => {
  edgeFirebase?.toast?.success?.(message)
}

const notifyError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

const openImportErrorDialog = (message) => {
  state.importErrorMessage = String(message || 'Failed to import page JSON.')
  state.importErrorDialogOpen = true
}

const exportCurrentPage = async () => {
  const doc = currentPage.value
  if (!doc || !props.page || props.page === 'new') {
    notifyError(`Save this ${props.isTemplateSite ? 'template' : 'page'} before exporting.`)
    return
  }
  const docId = String(doc.docId || props.page).trim()
  const exportPayload = { ...getPageDocDefaults(), ...doc, docId }
  const filePrefix = props.isTemplateSite ? 'template' : 'page'
  const itemLabel = props.isTemplateSite ? 'template' : 'page'
  const saved = await saveJsonFile(exportPayload, `${filePrefix}-${docId}.json`)
  if (saved)
    notifySuccess(`Exported ${itemLabel} "${docId}".`)
}

const discardCurrentPageChanges = async () => {
  if (props.isTemplateSite || !publishedPage.value || !props.page || props.page === 'new')
    return
  try {
    const discardedDoc = resolveSyncedPageDoc(edgeGlobal.dupObject(publishedPage.value))
    await edgeFirebase.storeDoc(pagesCollectionPath.value, discardedDoc, props.page)
    if (pagesCollection.value)
      pagesCollection.value[props.page] = edgeGlobal.dupObject(discardedDoc)
    state.workingDoc = buildPageWorkingDocOverrides(discardedDoc)
    state.editorWorkingDoc = discardedDoc ? edgeGlobal.dupObject(discardedDoc) : null
    state.editorHasUnsavedChanges = false
    state.previewPageView = hasPostView(discardedDoc) ? state.previewPageView : 'list'
    state.showUnpublishedChangesDialog = false
    state.editorKey += 1
    notifySuccess(`Discarded unpublished changes for "${props.page}".`)
  }
  catch (error) {
    console.error('Failed to discard page changes', error)
    notifyError('Failed to discard unpublished changes.')
  }
}

const unPublishCurrentPage = async () => {
  if (props.isTemplateSite || !props.page || props.page === 'new' || !isPagePublished(props.page))
    return
  try {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, props.page)
    notifySuccess(`Unpublished page "${props.page}".`)
  }
  catch (error) {
    console.error('Failed to unpublish page', error)
    notifyError('Failed to unpublish page.')
  }
}

const persistPageRestrictionAssignments = async (pageId = props.page) => {
  const normalizedPageId = String(pageId || '').trim()
  if (!normalizedPageId || props.isTemplateSite)
    return

  const currentAssignments = normalizeRestrictedPageRuleAssignments(siteDoc.value?.restrictedContent?.pageRuleAssignments)
  const nextAssignments = { ...currentAssignments }
  const listAssignment = String(state.pageSettingsRestrictionRuleId || '').trim()
  const detailAssignment = String(state.pageSettingsPostRestrictionRuleId || '').trim()
  const listKey = getPageRestrictionAssignmentKey(normalizedPageId, false)
  const detailKey = getPageRestrictionAssignmentKey(normalizedPageId, true)

  if (listAssignment)
    nextAssignments[listKey] = listAssignment
  else
    delete nextAssignments[listKey]

  if (detailAssignment)
    nextAssignments[detailKey] = detailAssignment
  else
    delete nextAssignments[detailKey]

  if (JSON.stringify(currentAssignments) === JSON.stringify(nextAssignments))
    return

  state.savingPageRuleAssignments = true
  try {
    const nextRestrictedContent = {
      ...((siteDoc.value?.restrictedContent && typeof siteDoc.value.restrictedContent === 'object') ? siteDoc.value.restrictedContent : {}),
      pageRuleAssignments: nextAssignments,
    }
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, {
      restrictedContent: nextRestrictedContent,
    })
  }
  finally {
    state.savingPageRuleAssignments = false
  }
}

const handlePageSettingsUpdate = async (submit) => {
  if (state.savingPageRuleAssignments)
    return

  try {
    if (!props.isTemplateSite && props.page && props.page !== 'new')
      await persistPageRestrictionAssignments(props.page)
    await submit()
    state.pageSettingsOpen = false
  }
  catch (error) {
    console.error('Failed to update page settings', error)
    notifyError('Failed to update page settings.')
  }
}

const handlePageSaved = async ({ docId }) => {
  try {
    await persistPageRestrictionAssignments(docId || props.page)
  }
  catch (error) {
    console.error('Failed to save page restriction assignments', error)
    edgeFirebase?.toast?.error?.('Page saved, but the restriction setting could not be updated.')
  }
}

const _triggerPageImport = () => {
  pageImportInputRef.value?.click()
}

const importSinglePageFile = async (file, existingPages = {}, fallbackDocId = '') => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = applyImportedPageSeoDefaults(validateImportedPageDoc(normalizeImportedDoc(parsed, fallbackDocId)))
  const incomingDocId = await getImportDocId(importedDoc, fallbackDocId)
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingPages[targetDocId]) {
    const decision = await requestPageImportConflict(targetDocId)
    if (decision === 'cancel')
      return ''
    if (decision === 'new') {
      targetDocId = makeRandomPageDocId(existingPages)
      importedDoc.name = makeImportedPageNameForNew(importedDoc.name || incomingDocId, existingPages)
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const isCreatingNewPage = !existingPages[targetDocId]
  const payload = { ...getPageDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(pagesCollectionPath.value, payload, targetDocId)
  existingPages[targetDocId] = payload

  if (isCreatingNewPage) {
    try {
      await addImportedPageToSiteMenu(targetDocId, importedDoc.name)
    }
    catch (menuError) {
      console.error('Imported page but failed to update site menu', menuError)
      openImportErrorDialog('Imported page, but could not add it to Site Menu automatically.')
    }
  }

  if (importDecision === 'overwrite')
    notifySuccess(`Overwrote page "${targetDocId}".`)
  else if (importDecision === 'new')
    notifySuccess(`Imported page as new "${targetDocId}".`)
  else
    notifySuccess(`Imported page "${targetDocId}".`)

  return targetDocId
}

const _handlePageImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingJson = true
  const fallbackDocId = props.page !== 'new' ? props.page : ''
  const existingPages = { ...(pagesCollection.value || {}) }
  let lastImportedDocId = ''
  try {
    for (const file of files) {
      try {
        const importedDocId = await importSinglePageFile(file, existingPages, fallbackDocId)
        if (importedDocId)
          lastImportedDocId = importedDocId
      }
      catch (error) {
        console.error('Failed to import page JSON', error)
        const message = error?.message || 'Failed to import page JSON.'
        if (/^Import canceled\./i.test(message))
          continue
        if (error instanceof SyntaxError || message === INVALID_PAGE_IMPORT_MESSAGE)
          openImportErrorDialog(INVALID_PAGE_IMPORT_MESSAGE)
        else
          openImportErrorDialog(message)
      }
    }

    if (files.length === 1 && lastImportedDocId && lastImportedDocId !== props.page)
      await router.push(`${pageEditorBasePath.value}/${lastImportedDocId}`)
  }
  finally {
    state.importingJson = false
    if (input)
      input.value = ''
  }
}

watch (currentPage, (newPage) => {
  state.workingDoc.last_updated = newPage?.last_updated
  state.workingDoc.metaTitle = newPage?.metaTitle
  state.workingDoc.metaDescription = newPage?.metaDescription
  state.workingDoc.structuredData = newPage?.structuredData
}, { immediate: true, deep: true })

watch([() => props.page, restrictedPageRuleAssignments], () => {
  if (!state.pageSettingsOpen) {
    state.pageSettingsRestrictionRuleId = getPageRestrictionAssignment(props.page, false)
    state.pageSettingsPostRestrictionRuleId = getPageRestrictionAssignment(props.page, true)
  }
}, { immediate: true, deep: true })

watch(selectedHistoryEntry, (entry) => {
  syncHistoryPreviewDoc(entry)
}, { immediate: false })

watch(
  [() => state.previewViewport, () => state.previewScale],
  async () => {
    const savedScrollPositions = capturePreviewScrollPositions()
    await nextTick()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restorePreviewScrollPositions(savedScrollPositions)
      })
    })
  },
)

watch(
  [() => route.query.history, currentPage, currentPagePath, () => edgeFirebase?.user?.uid],
  async () => {
    await openHistoryFromRoute()
  },
  { immediate: true },
)

const stringifyLimited = (value, limit = 600) => {
  if (value == null)
    return '—'
  try {
    const stringVal = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return stringVal.length > limit ? `${stringVal.slice(0, limit)}...` : stringVal
  }
  catch {
    return '—'
  }
}

const summarizeBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0)
    return 'No blocks'
  const count = blocks.length
  return `${count} block${count === 1 ? '' : 's'}`
}

const summarizeStructure = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0)
    return 'No rows'
  const count = rows.length
  const columnCounts = rows
    .map(row => row?.columns?.length)
    .filter(val => typeof val === 'number')
  const sample = columnCounts.slice(0, 3).join(', ')
  const suffix = columnCounts.length > 3 ? ', ...' : ''
  const layout = sample ? ` (cols: ${sample}${suffix})` : ''
  return `${count} row${count === 1 ? '' : 's'}${layout}`
}

const summarizeChangeValue = (value, detailed = false) => {
  if (value == null || value === '')
    return '—'
  if (Array.isArray(value)) {
    return detailed ? stringifyLimited(value) : summarizeBlocks(value)
  }
  if (typeof value === 'object') {
    return stringifyLimited(value, detailed ? 900 : 180)
  }
  const stringVal = String(value).trim()
  return stringVal.length > (detailed ? 320 : 180) ? `${stringVal.slice(0, detailed ? 317 : 177)}...` : stringVal
}

const describeBlock = (block) => {
  if (!block)
    return 'Block'
  const type = block.component || block.type || block.layout || 'Block'
  const title = block?.values?.title || block?.values?.heading || block?.values?.label || block.title || block.heading || block.label || block.name || ''
  const parts = [type]
  if (title)
    parts.push(`“${String(title)}”`)
  return parts.filter(Boolean).join(' - ')
}

const getBlockChangeTypeLabel = (changeType) => {
  if (changeType === 'added')
    return 'Added'
  if (changeType === 'removed')
    return 'Removed'
  if (changeType === 'moved')
    return 'Moved'
  if (changeType === 'movedChanged')
    return 'Moved and Changed'
  return 'Changed'
}

const getBlockPositionLabel = (position) => {
  if (!position)
    return 'Not placed'
  const parts = [
    `Row ${position.rowIndex + 1}`,
    `Column ${position.colIndex + 1}`,
  ]
  if (position.columnBlockCount > 1)
    parts.push(`Position ${position.blockIndex + 1}`)
  return parts.join(', ')
}

const normalizeBlockPositionForDiff = (position) => {
  if (!position)
    return null
  return {
    rowIndex: Number.isFinite(position.rowIndex) ? position.rowIndex : null,
    colIndex: Number.isFinite(position.colIndex) ? position.colIndex : null,
    blockIndex: Number.isFinite(position.blockIndex) ? position.blockIndex : null,
  }
}

const buildBlockMap = (blocks = [], prefix = 'block') => {
  const map = new Map()
  blocks.forEach((block, index) => {
    const key = String(block?.id || `${prefix}-${index}`)
    map.set(key, block)
  })
  return map
}

const buildBlockPositionMap = (rows = []) => {
  const positions = new Map()
  if (!Array.isArray(rows))
    return positions

  rows.forEach((row, rowIndex) => {
    const columns = Array.isArray(row?.columns) ? row.columns : []
    columns.forEach((column, colIndex) => {
      const blockIds = Array.isArray(column?.blocks) ? column.blocks : []
      blockIds.forEach((blockId, blockIndex) => {
        const normalizedBlockId = String(blockId || '').trim()
        if (!normalizedBlockId || positions.has(normalizedBlockId))
          return
        positions.set(normalizedBlockId, {
          rowIndex,
          colIndex,
          blockIndex,
          columnBlockCount: blockIds.length,
        })
      })
    })
  })

  return positions
}

const stripStructureBlocks = (rows = []) => {
  if (!Array.isArray(rows))
    return []

  return rows.map((row) => {
    const normalizedRow = {
      ...(row || {}),
      columns: Array.isArray(row?.columns)
        ? row.columns.map((column) => {
          const nextColumn = { ...(column || {}) }
          delete nextColumn.blocks
          return nextColumn
        })
        : [],
    }
    return normalizedRow
  })
}

const buildBlockChangeDetails = (baseBlocks = [], compareBlocks = [], baseStructure = [], compareStructure = [], keyPrefix = 'blocks') => {
  const details = []
  const baseMap = buildBlockMap(baseBlocks, `${keyPrefix}-base`)
  const compareMap = buildBlockMap(compareBlocks, `${keyPrefix}-compare`)
  const basePositions = buildBlockPositionMap(baseStructure)
  const comparePositions = buildBlockPositionMap(compareStructure)
  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...compareMap.keys(),
    ...basePositions.keys(),
    ...comparePositions.keys(),
  ])

  for (const blockId of allBlockIds) {
    const baseBlock = baseMap.get(blockId) || null
    const compareBlock = compareMap.get(blockId) || null
    const basePosition = basePositions.get(blockId) || null
    const comparePosition = comparePositions.get(blockId) || null
    const baseComparableBlock = buildComparablePageBlock(baseBlock)
    const compareComparableBlock = buildComparablePageBlock(compareBlock)
    const baseRenderBlock = resolveSyncedPageBlock(baseBlock)
    const compareRenderBlock = resolveSyncedPageBlock(compareBlock)

    if (!baseBlock && compareBlock) {
      details.push({
        key: `${keyPrefix}:added:${blockId}`,
        changeType: 'added',
        label: getBlockChangeTypeLabel('added'),
        blockLabel: describeBlock(compareBlock),
        baseBlock: null,
        compareBlock: compareRenderBlock,
        basePositionLabel: 'Not present',
        comparePositionLabel: getBlockPositionLabel(comparePosition),
        showPreview: true,
        sortPosition: comparePosition || basePosition || null,
      })
      continue
    }

    if (baseBlock && !compareBlock) {
      details.push({
        key: `${keyPrefix}:removed:${blockId}`,
        changeType: 'removed',
        label: getBlockChangeTypeLabel('removed'),
        blockLabel: describeBlock(baseBlock),
        baseBlock: baseRenderBlock,
        compareBlock: null,
        basePositionLabel: getBlockPositionLabel(basePosition),
        comparePositionLabel: 'Not present',
        showPreview: true,
        sortPosition: basePosition || comparePosition || null,
      })
      continue
    }

    const moved = !areEqualNormalized(
      normalizeBlockPositionForDiff(basePosition),
      normalizeBlockPositionForDiff(comparePosition),
    )
    const changed = !areEqualNormalized(baseComparableBlock, compareComparableBlock)
    if (!moved && !changed)
      continue

    const changeType = moved && changed ? 'movedChanged' : (moved ? 'moved' : 'changed')
    details.push({
      key: `${keyPrefix}:${changeType}:${blockId}`,
      changeType,
      label: getBlockChangeTypeLabel(changeType),
      blockLabel: describeBlock(compareBlock || baseBlock),
      baseBlock: baseRenderBlock,
      compareBlock: compareRenderBlock,
      basePositionLabel: getBlockPositionLabel(basePosition),
      comparePositionLabel: getBlockPositionLabel(comparePosition),
      showPreview: changeType !== 'moved',
      sortPosition: comparePosition || basePosition || null,
    })
  }

  return details.sort((a, b) => {
    const aPos = a.sortPosition || {}
    const bPos = b.sortPosition || {}
    const aRow = Number.isFinite(aPos.rowIndex) ? aPos.rowIndex : Number.MAX_SAFE_INTEGER
    const bRow = Number.isFinite(bPos.rowIndex) ? bPos.rowIndex : Number.MAX_SAFE_INTEGER
    if (aRow !== bRow)
      return aRow - bRow
    const aCol = Number.isFinite(aPos.colIndex) ? aPos.colIndex : Number.MAX_SAFE_INTEGER
    const bCol = Number.isFinite(bPos.colIndex) ? bPos.colIndex : Number.MAX_SAFE_INTEGER
    if (aCol !== bCol)
      return aCol - bCol
    const aBlock = Number.isFinite(aPos.blockIndex) ? aPos.blockIndex : Number.MAX_SAFE_INTEGER
    const bBlock = Number.isFinite(bPos.blockIndex) ? bPos.blockIndex : Number.MAX_SAFE_INTEGER
    if (aBlock !== bBlock)
      return aBlock - bBlock
    return String(a.blockLabel || '').localeCompare(String(b.blockLabel || ''))
  })
}

const buildPageChangeDetails = (baseDoc, compareDoc, { baseLabel, compareLabel } = {}) => {
  const changes = []
  const base = baseDoc
  const compare = compareDoc

  if (!base && !compare)
    return changes

  const compareField = (key, label, formatter = v => summarizeChangeValue(v, false), options = {}) => {
    const baseVal = base?.[key]
    const compareVal = compare?.[key]
    if (areEqualNormalized(baseVal, compareVal))
      return
    const change = {
      key,
      label,
      baseLabel,
      compareLabel,
      base: formatter(baseVal),
      compare: formatter(compareVal),
      viewScope: options.viewScope || 'shared',
    }
    if (options.details)
      change.details = options.details(baseVal, compareVal)
    changes.push(change)
  }

  if (!base && compare) {
    changes.push({
      key: 'compare-only',
      label: compareLabel || 'Current',
      baseLabel,
      compareLabel,
      base: `No ${String(baseLabel || 'base').toLowerCase()} available`,
      compare: `${compareLabel || 'Current'} available`,
      viewScope: 'shared',
    })
  }
  if (base && !compare) {
    changes.push({
      key: 'base-only',
      label: baseLabel || 'Selected',
      baseLabel,
      compareLabel,
      base: `${baseLabel || 'Selected'} available`,
      compare: `No ${String(compareLabel || 'current').toLowerCase()} available`,
      viewScope: 'shared',
    })
  }

  const compareBlockArea = (keyPrefix, label, contentKey, structureKey, layoutLabel) => {
    const baseBlocks = Array.isArray(base?.[contentKey]) ? base[contentKey] : []
    const compareBlocks = Array.isArray(compare?.[contentKey]) ? compare[contentKey] : []
    const baseStructure = Array.isArray(base?.[structureKey]) ? base[structureKey] : []
    const compareStructure = Array.isArray(compare?.[structureKey]) ? compare[structureKey] : []
    const blockChanges = buildBlockChangeDetails(baseBlocks, compareBlocks, baseStructure, compareStructure, keyPrefix)

    if (blockChanges.length) {
      changes.push({
        key: `${keyPrefix}-blocks`,
        label,
        baseLabel,
        compareLabel,
        base: summarizeBlocks(baseBlocks),
        compare: summarizeBlocks(compareBlocks),
        blockChanges,
        viewScope: keyPrefix === 'detail' ? 'post' : 'list',
      })
    }

    const baseLayout = stripStructureBlocks(baseStructure)
    const compareLayout = stripStructureBlocks(compareStructure)
    if (!areEqualNormalized(baseLayout, compareLayout)) {
      changes.push({
        key: `${keyPrefix}-layout`,
        label: layoutLabel,
        baseLabel,
        compareLabel,
        layoutChanges: buildLayoutChangeDetails(baseStructure, compareStructure),
        viewScope: keyPrefix === 'detail' ? 'post' : 'list',
      })
    }
  }

  compareBlockArea('index', 'Blocks', 'content', 'structure', 'Layout')
  compareBlockArea('detail', 'Detail Blocks', 'postContent', 'postStructure', 'Detail Layout')
  compareField('metaTitle', 'Meta title', val => summarizeChangeValue(val, true), { viewScope: 'list' })
  compareField('metaDescription', 'Meta description', val => summarizeChangeValue(val, true), { viewScope: 'list' })
  compareField('structuredData', 'Structured data', val => summarizeChangeValue(val, true), { viewScope: 'list' })
  compareField('postMetaTitle', 'Detail meta title', val => summarizeChangeValue(val, true), { viewScope: 'post' })
  compareField('postMetaDescription', 'Detail meta description', val => summarizeChangeValue(val, true), { viewScope: 'post' })
  compareField('postStructuredData', 'Detail structured data', val => summarizeChangeValue(val, true), { viewScope: 'post' })

  return changes
}

const filterPageChangeDetailsForView = (changes, view = 'list') => {
  const normalizedView = view === 'post' ? 'post' : 'list'
  return (Array.isArray(changes) ? changes : []).filter((change) => {
    const scope = String(change?.viewScope || 'shared')
    return scope === 'shared' || scope === normalizedView
  })
}

const unpublishedChangeDetails = computed(() => {
  return buildPageChangeDetails(publishedPage.value, currentPage.value, {
    baseLabel: 'Published',
    compareLabel: 'Draft',
  })
})

const unsavedChangeDetails = computed(() => {
  return buildPageChangeDetails(currentPage.value, state.editorWorkingDoc, {
    baseLabel: 'Saved',
    compareLabel: 'Current',
  })
})

const showingUnsavedChanges = computed(() => {
  return state.editorHasUnsavedChanges && unsavedChangeDetails.value.length > 0
})

const activePageChangeDetails = computed(() => {
  if (showingUnsavedChanges.value)
    return unsavedChangeDetails.value
  return unpublishedChangeDetails.value
})

const pageChangesDialogTitle = computed(() => {
  return showingUnsavedChanges.value ? 'Unsaved Changes' : 'Unpublished Changes'
})

const pageChangesDialogDescription = computed(() => {
  if (showingUnsavedChanges.value)
    return `Review what changed in memory versus the saved ${props.isTemplateSite ? 'template' : 'page'}.`
  return `Review what changed since the last publish. Last Published: ${lastPublishedTime(props.page)}`
})

const showStatusCompareLink = computed(() => {
  if (props.isTemplateSite)
    return showingUnsavedChanges.value
  return showingUnsavedChanges.value || pagePublishStatus.value.key === 'publishedWithChanges'
})

const pageStatusDisplayLabel = computed(() => {
  if (!showingUnsavedChanges.value)
    return pagePublishStatus.value.label
  return pagePublishStatus.value.key === 'unpublished'
    ? 'Unpublished (Unsaved Changes)'
    : 'Published (Unsaved Changes)'
})

const openPageStatusCompareDialog = () => {
  if (!showStatusCompareLink.value)
    return
  state.showUnpublishedChangesDialog = true
}

const historyDiffDetails = computed(() => {
  const allChanges = buildPageChangeDetails(getHistorySnapshotDoc(selectedHistoryEntry.value), currentHistoryCompareDoc.value, {
    baseLabel: 'Selected History',
    compareLabel: 'Current',
  })
  return filterPageChangeDetailsForView(allChanges, state.historyPreviewView)
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

const publishPage = async (pageId) => {
  if (state.publishLoading)
    return
  const pageData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const pageDoc = pageData[pageId]
  if (!pageDoc)
    return
  state.publishLoading = true
  try {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageDoc)

    const normalizedVersion = Number(pageDoc?.version)
    const pageVersion = Number.isFinite(normalizedVersion) ? Math.max(0, Math.trunc(normalizedVersion)) : 1
    const publishedSettingsPath = `${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`
    try {
      await edgeFirebase.changeDoc(publishedSettingsPath, props.site, {
        [`pageVersions.${pageId}`]: pageVersion,
      })
    }
    catch {
      await edgeFirebase.storeDoc(publishedSettingsPath, {
        docId: props.site,
        pageVersions: {
          [pageId]: pageVersion,
        },
      })
    }

    const siteSettingsPath = `${edgeGlobal.edgeState.organizationDocPath}/sites`
    await edgeFirebase.changeDoc(siteSettingsPath, props.site, {
      [`pageVersions.${pageId}`]: pageVersion,
    })
  }
  finally {
    state.publishLoading = false
  }
}

const hasUnsavedChanges = (changes) => {
  console.log('Unsaved changes:', changes)
  state.editorHasUnsavedChanges = changes === true
  if (changes === true) {
    edgeGlobal.edgeState.cmsPageWithUnsavedChanges = props.page
  }
  else {
    edgeGlobal.edgeState.cmsPageWithUnsavedChanges = null
  }
}
</script>

<template>
  <edge-editor
    :key="state.editorKey"
    :collection="`sites/${site}/pages`"
    :doc-id="page"
    :schema="schemas.pages"
    :new-doc-schema="state.newDocs.pages"
    class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0" :class="[!state.editMode ? 'cms-page-preview-mode' : '']"
    :show-footer="false"
    :save-redirect-override="pageEditorBasePath"
    :no-close-after-save="true"
    :working-doc-overrides="state.workingDoc"
    @working-doc="editorDocUpdates"
    @unsaved-changes="hasUnsavedChanges"
    @saved="handlePageSaved"
  >
    <template #header="slotProps">
      <div class="rounded-none relative flex flex-col gap-2 p-2 top-0 z-50 rounded border border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <edge-shad-button
              type="button"
              variant="text"
              class="text-xs h-[26px] text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
              @click="slotProps.onCancel"
            >
              <ArrowLeft class="w-4 h-4" />
              Back
            </edge-shad-button>
            <span class="min-w-0 truncate pr-1 text-sm font-bold whitespace-nowrap sm:text-base">{{ slotProps.workingDoc?.name || pageName || 'Untitled Page' }}</span>
          </div>
          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <edge-shad-button variant="text" class="h-[26px] shrink-0 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white" @click="state.editMode = !state.editMode">
              <template v-if="state.editMode">
                <Eye class="w-4 h-4" />
                Preview Mode
              </template>
              <template v-else>
                <Pencil class="w-4 h-4" />
                Edit Mode
              </template>
            </edge-shad-button>
            <edge-shad-button
              v-if="!slotProps.unsavedChanges"
              variant="text"
              class="h-[26px] shrink-0 text-xs text-red-700 hover:text-red-700/50"
              @click="slotProps.onCancel"
            >
              <X class="w-4 h-4" />
              Close
            </edge-shad-button>
            <edge-shad-button
              v-else
              variant="text"
              class="h-[26px] shrink-0 text-xs text-red-700 hover:text-red-700/50"
              @click="slotProps.onCancel"
            >
              <X class="w-4 h-4" />
              Cancel
            </edge-shad-button>
            <edge-shad-button
              v-if="state.editMode || slotProps.unsavedChanges"
              variant="text"
              type="submit"
              class="h-[26px] shrink-0 bg-slate-300 text-xs text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
              :disabled="slotProps.submitting"
            >
              <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              <span>Save</span>
            </edge-shad-button>
          </div>
        </div>

        <div class="flex w-full min-w-0 flex-wrap items-center justify-between gap-1 border border-stone-300/80 bg-stone-200/70 px-2 py-0.5 text-stone-700 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-200">
          <div v-if="!props.isTemplateSite" class="flex flex-wrap items-center gap-1.5 text-gray-600 dark:text-gray-300 sm:px-1 sm:whitespace-nowrap">
            <button
              v-if="showStatusCompareLink"
              type="button"
              class="inline-flex items-center gap-1 text-[11px] font-medium leading-none text-amber-700 underline decoration-dashed underline-offset-4 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:text-xs"
              @click="openPageStatusCompareDialog"
            >
              <FileWarning v-if="showingUnsavedChanges || pagePublishStatus.icon === 'changes'" class="h-3.5 w-3.5 shrink-0 text-yellow-600" />
              <FileCheck v-else-if="pagePublishStatus.icon === 'published'" class="h-3.5 w-3.5 shrink-0 text-green-700" />
              <FileX v-else class="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-300" />
              <span>{{ pageStatusDisplayLabel }}</span>
            </button>
            <div
              v-else
              class="inline-flex items-center gap-1 text-[11px] font-medium leading-none sm:text-xs"
              :class="showingUnsavedChanges ? 'text-amber-700 dark:text-amber-300' : pagePublishStatus.badgeClass"
            >
              <FileWarning v-if="showingUnsavedChanges || pagePublishStatus.icon === 'changes'" class="h-3.5 w-3.5 shrink-0 text-yellow-600" />
              <FileCheck v-else-if="pagePublishStatus.icon === 'published'" class="h-3.5 w-3.5 shrink-0 text-green-700" />
              <FileX v-else class="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-300" />
              <span>{{ pageStatusDisplayLabel }}</span>
            </div>
            <span class="text-[11px] leading-none text-gray-500 dark:text-gray-400">Last Published: {{ lastPublishedTime(page) }}</span>
            <edge-shad-button
              v-if="pagePublishStatus.canPublish"
              class="text-xs h-[28px] gap-1 shadow-sm bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              :disabled="state.publishLoading"
              @click="publishPage(page)"
            >
              <Loader2 v-if="state.publishLoading" class="w-4 h-4 animate-spin" />
              <UploadCloud v-else class="w-4 h-4" />
              Publish
            </edge-shad-button>
          </div>
          <div v-else class="w-full sm:w-auto sm:max-w-md sm:px-1">
            <div class="flex w-full items-center gap-1.5 sm:max-w-md">
              <edge-shad-select
                v-model="edgeGlobal.edgeState.blockEditorTheme"
                :items="themes.map(t => ({ title: t.name, name: t.docId }))"
                placeholder="Select Theme"
                class="w-full"
                trigger-class="!h-7 min-h-7 px-2 py-1 text-xs"
              />
              <edge-shad-button
                type="button"
                variant="outline"
                class="h-7 gap-1 whitespace-nowrap"
                :disabled="!currentPage || !props.page || props.page === 'new'"
                title="Export Template"
                aria-label="Export Template"
                @click="exportCurrentPage"
              >
                <Download class="w-4 h-4" />
                Export
              </edge-shad-button>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-1 sm:flex-1">
            <div class="w-[88px] shrink-0">
              <edge-shad-select
                v-model="state.previewScale"
                :items="previewScaleOptions"
                placeholder="%"
                class="w-full"
                trigger-class="!h-7 min-h-7 px-2 py-1 text-xs"
              />
            </div>
            <div class="flex shrink-0 items-center gap-1 px-1">
              <edge-shad-button
                v-for="option in previewViewportOptions"
                :key="option.id"
                type="button"
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-xs gap-1 border transition-colors"
                :class="state.previewViewport === option.id ? 'bg-slate-700 text-white border-slate-700 shadow-sm dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'"
                @click="setPreviewViewport(option.id)"
              >
                <component :is="option.icon" class="w-3.5 h-3.5" />
              </edge-shad-button>
            </div>
            <div v-if="!state.editMode && isRestrictedContentEnabled" class="flex shrink-0 items-center gap-2 px-1">
              <label class="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800">
                <Checkbox
                  :model-value="!state.previewAuthLoggedIn"
                  aria-label="Page preview logged out"
                  @update:model-value="setPreviewAuthMode(!Boolean($event))"
                />
                Preview logged out
              </label>
            </div>
            <div v-if="hasPostView(slotProps.workingDoc)" class="flex shrink-0 items-center gap-1 px-1">
              <edge-shad-button
                type="button"
                variant="ghost"
                class="h-6 px-2 text-xs border transition-colors"
                :class="state.previewPageView === 'list' ? 'bg-slate-700 text-white border-slate-700 shadow-sm dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'"
                @click="setPreviewPageView('list')"
              >
                Index
              </edge-shad-button>
              <edge-shad-button
                type="button"
                variant="ghost"
                class="h-6 px-2 text-xs border transition-colors"
                :class="state.previewPageView === 'post' ? 'bg-slate-700 text-white border-slate-700 shadow-sm dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'"
                @click="setPreviewPageView('post')"
              >
                Detail
              </edge-shad-button>
            </div>
            <div v-if="hasPostView(slotProps.workingDoc) && state.previewPageView === 'post'" class="flex shrink-0 items-center gap-1 px-1">
              <edge-shad-button
                type="button"
                variant="outline"
                class="h-6 px-2 text-xs"
                @click="openRouteLastSegmentDialog"
              >
                Test URL
              </edge-shad-button>
            </div>
            <div class="flex shrink-0 items-center gap-1 px-1">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <edge-shad-button
                    type="button"
                    variant="outline"
                    size="icon"
                    class="h-6 w-6"
                  >
                    <MoreHorizontal class="w-4 h-4" />
                  </edge-shad-button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end">
                  <DropdownMenuLabel>
                    {{ props.isTemplateSite ? 'Template Actions' : 'Page Actions' }}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-if="slotProps.unsavedChanges"
                    disabled
                    class="pointer-events-none min-h-0 py-1 text-[11px] text-amber-700 focus:text-amber-700 dark:text-amber-300 dark:focus:text-amber-300"
                  >
                    <FileWarning class="w-3.5 h-3.5 shrink-0" />
                    <span>Save or cancel changes to enable disabled actions.</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    v-if="!props.isTemplateSite && currentPageLiveUrl"
                    as-child
                  >
                    <a :href="currentPageLiveUrl" target="_blank" rel="noopener noreferrer">
                      <ExternalLink class="w-4 h-4" />
                      <span>View Live Page</span>
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem v-else-if="!props.isTemplateSite" disabled>
                    <ExternalLink class="w-4 h-4" />
                    <span>View Live Page</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="slotProps.unsavedChanges || !currentPage || !props.page || props.page === 'new'"
                    @click="openCurrentPageSettings"
                  >
                    <FileCog class="w-4 h-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="!currentPage || !props.page || props.page === 'new'"
                    @click="openHistoryDialog"
                  >
                    <History class="w-4 h-4" />
                    <span>Versions</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="!currentPage || !props.page || props.page === 'new'"
                    @click="exportCurrentPage"
                  >
                    <Download class="w-4 h-4" />
                    <span>Export {{ props.isTemplateSite ? 'Template' : 'Page' }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="slotProps.unsavedChanges || state.renamePageSubmitting || !currentPage || !props.page || props.page === 'new'"
                    @click="openRenamePageDialog"
                  >
                    <FilePen class="w-4 h-4" />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="!props.isTemplateSite && pagePublishStatus.canPublish"
                    :disabled="slotProps.unsavedChanges || state.publishLoading"
                    @click="publishPage(page)"
                  >
                    <FileUp class="w-4 h-4" />
                    <span>Publish</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="!props.isTemplateSite && isPublishedPageDiff(page) && isPagePublished(page)"
                    :disabled="slotProps.unsavedChanges"
                    @click="discardCurrentPageChanges"
                  >
                    <RotateCcw class="w-4 h-4" />
                    <span>Discard Changes</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="!props.isTemplateSite && pagePublishStatus.canUnpublish"
                    :disabled="slotProps.unsavedChanges"
                    @click="unPublishCurrentPage"
                  >
                    <FileDown class="w-4 h-4" />
                    <span>Unpublish</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive"
                    :disabled="slotProps.unsavedChanges || state.deletePageSubmitting || !currentPage || !props.page || props.page === 'new'"
                    @click="state.deletePageDialogOpen = true"
                  >
                    <FileMinus2 class="w-4 h-4" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #success-alert>
      <div v-if="state.editMode && !props.isTemplateSite" class="mt-2 flex flex-wrap items-center gap-2">
        <edge-shad-button
          variant="outline"
          class="text-xs h-[28px] gap-1"
          :disabled="state.seoAiLoading"
          @click="updateSeoWithAi"
        >
          <Loader2 v-if="state.seoAiLoading" class="w-3.5 h-3.5 animate-spin" />
          <Sparkles v-else class="w-3.5 h-3.5" />
          Update SEO with AI
        </edge-shad-button>
        <span v-if="state.seoAiError" class="text-xs text-destructive">
          {{ state.seoAiError }}
        </span>
      </div>
    </template>
    <template #main="slotProps">
      <div :class="props.isTemplateSite ? 'mt-2 flex min-h-0 gap-4' : ''">
        <div
          v-if="props.isTemplateSite"
          class="w-full max-w-md shrink-0 overflow-y-auto rounded-lg border border-slate-300 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-900"
        >
          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">
                {{ slotProps.workingDoc?.name || pageName || 'Template Page' }}
              </h2>
              <p class="text-sm text-slate-600 dark:text-slate-300">
                Template page settings
              </p>
            </div>
            <edge-shad-button
              type="submit"
              class="w-full bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              :disabled="slotProps.submitting"
            >
              <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              Save Template
            </edge-shad-button>
            <edge-shad-input
              v-model="slotProps.workingDoc.name"
              name="name"
              label="Name"
              placeholder="Enter page name"
            />
            <edge-shad-checkbox
              v-if="!templateTypeIncludesPost(slotProps.workingDoc)"
              v-model="slotProps.workingDoc.post"
              label="Is a Post Template"
              name="post"
            >
              Creates both an Index Page and a Detail Page for this section.
              The Index Page lists all items (e.g., /{{ slotProps.workingDoc.name }}), while the Detail Page displays a single item (e.g., /{{ slotProps.workingDoc.name }}/:slug).
            </edge-shad-checkbox>
            <edge-shad-select-tags
              :model-value="normalizeTemplatePageTypeSelections(slotProps.workingDoc.type, { fallback: ['Page'], excludePost: Boolean(slotProps.workingDoc.post) })"
              name="type"
              label="Type"
              placeholder="Select types"
              :items="templateTypeItems(slotProps.workingDoc)"
              item-title="title"
              item-value="name"
              :allow-additions="false"
              @update:model-value="(value) => {
                slotProps.workingDoc.type = normalizeTemplatePageTypeSelections(value, { fallback: ['Page'], excludePost: Boolean(slotProps.workingDoc.post) })
              }"
            />
            <edge-shad-select-tags
              v-model="slotProps.workingDoc.tags"
              name="tags"
              label="Tags"
              placeholder="Add tags"
              :items="templateTagItems"
              :allow-additions="true"
              @add="addTemplateTagOption"
            />
          </div>
        </div>
        <div :class="props.isTemplateSite ? 'min-w-0 flex-1' : ''">
          <Sheet v-model:open="state.pageSettingsOpen">
            <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
              <SheetHeader>
                <SheetTitle>{{ slotProps.workingDoc?.name || pageName || (props.isTemplateSite ? 'Template' : 'Page') }}</SheetTitle>
                <SheetDescription />
              </SheetHeader>
              <div class="p-6 space-y-4 h-[calc(100vh-142px)] overflow-y-auto">
                <edge-shad-checkbox
                  v-if="props.isTemplateSite && !templateTypeIncludesPost(slotProps.workingDoc)"
                  v-model="slotProps.workingDoc.post"
                  label="Is a Post Template"
                  name="page-settings-post"
                >
                  Creates both an Index Page and a Detail Page for this section.
                  The Index Page lists all items (e.g., /{{ slotProps.workingDoc.name }}), while the Detail Page displays a single item (e.g., /{{ slotProps.workingDoc.name }}/:slug).
                </edge-shad-checkbox>
                <edge-shad-select-tags
                  v-if="props.isTemplateSite"
                  :model-value="normalizeTemplatePageTypeSelections(slotProps.workingDoc.type, { fallback: ['Page'], excludePost: Boolean(slotProps.workingDoc.post) })"
                  name="page-settings-type"
                  label="Type"
                  placeholder="Select types"
                  :items="templateTypeItems(slotProps.workingDoc)"
                  item-title="title"
                  item-value="name"
                  :allow-additions="false"
                  @update:model-value="(value) => {
                    slotProps.workingDoc.type = normalizeTemplatePageTypeSelections(value, { fallback: ['Page'], excludePost: Boolean(slotProps.workingDoc.post) })
                  }"
                />
                <edge-shad-select-tags
                  v-if="props.isTemplateSite"
                  v-model="slotProps.workingDoc.tags"
                  name="page-settings-tags"
                  label="Tags"
                  placeholder="Add tags"
                  :items="templateTagItems"
                  :allow-additions="true"
                  @add="addTemplateTagOption"
                />
                <Card>
                  <CardHeader>
                    <CardTitle>SEO</CardTitle>
                    <CardDescription>Meta tags for the page.</CardDescription>
                  </CardHeader>
                  <CardContent class="pt-0">
                    <Tabs class="w-full" default-value="list">
                      <TabsList v-if="slotProps.workingDoc?.post" class="w-full grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
                        <TabsTrigger
                          value="list"
                          class="text-xs font-semibold uppercase tracking-wide transition-all data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                          Index Page
                        </TabsTrigger>
                        <TabsTrigger
                          value="post"
                          class="text-xs font-semibold uppercase tracking-wide transition-all data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                          Detail Page
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="list" class="mt-4 space-y-4">
                        <edge-shad-input
                          v-model="slotProps.workingDoc.metaTitle"
                          label="Meta Title"
                          name="page-settings-metaTitle"
                        />
                        <edge-shad-textarea
                          v-model="slotProps.workingDoc.metaDescription"
                          label="Meta Description"
                          name="page-settings-metaDescription"
                        />
                        <edge-shad-select
                          v-if="showRestrictionRulePicker"
                          :model-value="state.pageSettingsRestrictionRuleId || NO_RESTRICTION_RULE_VALUE"
                          :items="restrictionRuleOptions"
                          item-title="label"
                          item-value="value"
                          label="Restriction Rule"
                          name="page-settings-restrictionRuleId"
                          description="Choose which access rule should protect this page."
                          @update:model-value="value => state.pageSettingsRestrictionRuleId = value === NO_RESTRICTION_RULE_VALUE ? '' : value"
                        />
                        <div class="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          CMS tokens in double curly braces are replaced on the front end.
                          Example: <span v-pre class="font-semibold text-foreground">"{{cms-site}}"</span> for the site URL,
                          <span v-pre class="font-semibold text-foreground">"{{cms-url}}"</span> for the page URL, and
                          <span v-pre class="font-semibold text-foreground">"{{cms-logo}}"</span> for the logo URL. Keep the tokens intact.
                        </div>
                        <edge-cms-code-editor
                          v-model="slotProps.workingDoc.structuredData"
                          title="Structured Data (JSON-LD)"
                          language="json"
                          name="page-settings-structuredData"
                          validate-json
                          height="300px"
                          class="mb-4 w-full"
                        />
                      </TabsContent>
                      <TabsContent value="post" class="mt-4 space-y-4">
                        <div class="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          You can use template keys in double curly braces to pull data from the detail record.
                          Example: <span v-pre class="font-semibold text-foreground">"{{name}}"</span> will be replaced with the record’s name.
                          Dot notation is supported for nested objects, e.g. <span v-pre class="font-semibold text-foreground">"{{data.name}}"</span>.
                          These keys work in the Title, Description, and Structured Data fields.
                        </div>
                        <edge-shad-input
                          v-model="slotProps.workingDoc.postMetaTitle"
                          label="Meta Title"
                          name="page-settings-postMetaTitle"
                        />
                        <edge-shad-textarea
                          v-model="slotProps.workingDoc.postMetaDescription"
                          label="Meta Description"
                          name="page-settings-postMetaDescription"
                        />
                        <edge-shad-select
                          v-if="showRestrictionRulePicker"
                          :model-value="state.pageSettingsPostRestrictionRuleId || NO_RESTRICTION_RULE_VALUE"
                          :items="restrictionRuleOptions"
                          item-title="label"
                          item-value="value"
                          label="Restriction Rule"
                          name="page-settings-postRestrictionRuleId"
                          description="Choose which access rule should protect each detail page."
                          @update:model-value="value => state.pageSettingsPostRestrictionRuleId = value === NO_RESTRICTION_RULE_VALUE ? '' : value"
                        />
                        <div class="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          CMS tokens in double curly braces are replaced on the front end.
                          Example: <span v-pre class="font-semibold text-foreground">"{{cms-site}}"</span> for the site URL,
                          <span v-pre class="font-semibold text-foreground">"{{cms-url}}"</span> for the page URL, and
                          <span v-pre class="font-semibold text-foreground">"{{cms-logo}}"</span> for the logo URL. Keep the tokens intact.
                        </div>
                        <edge-cms-code-editor
                          v-model="slotProps.workingDoc.postStructuredData"
                          title="Structured Data (JSON-LD)"
                          language="json"
                          name="page-settings-postStructuredData"
                          validate-json
                          height="300px"
                          class="mb-4 w-full"
                        />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
              <SheetFooter class="pt-2 flex justify-between">
                <edge-shad-button variant="destructive" class="text-white" @click="state.pageSettingsOpen = false">
                  Cancel
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  class="bg-slate-800 hover:bg-slate-400 w-full"
                  :disabled="slotProps.submitting || state.savingPageRuleAssignments || hasStructuredDataErrors(slotProps.workingDoc)"
                  @click="handlePageSettingsUpdate(slotProps.onSubmit)"
                >
                  <Loader2 v-if="slotProps.submitting" class="h-4 w-4 animate-spin" />
                  <span v-else>Update</span>
                </edge-shad-button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          <Tabs class="w-full" :model-value="hasPostView(slotProps.workingDoc) ? state.previewPageView : 'list'">
            <TabsContent value="list" class="mt-0">
              <div
                :key="`${pagePreviewRenderKey}:list`"
                ref="listPreviewSurfaceRef"
                data-cms-preview-surface="page"
                :data-cms-preview-mode="state.editMode ? 'edit' : 'preview'"
                class="w-full h-[calc(100vh-220px)]  mt-2 overflow-y-auto mx-auto bg-card border border-border shadow-sm md:shadow-md p-0 space-y-6"
                :class="[{ 'transition-all duration-300': !state.editMode }, state.editMode ? 'rounded-lg' : 'rounded-none', !state.editMode ? previewAuthClass : '']"
                :style="buildScaledPreviewSurfaceStyle('calc(100vh - 220px)')"
              >
                <edge-button-divider v-if="state.editMode" class="my-2">
                  <Popover v-model:open="state.addRowPopoverOpen.listTop">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, false) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, false); addRowAndClose(slotProps.workingDoc, option.id, 0, false, 'top')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </edge-button-divider>
                <div
                  v-if="(!slotProps.workingDoc?.structure || slotProps.workingDoc.structure.length === 0)"
                  class="flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50"
                >
                  <div class="text-sm text-gray-700">
                    No rows yet. Add your first row to start building.
                  </div>
                  <Popover v-if="state.editMode" v-model:open="state.addRowPopoverOpen.listEmpty">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, false) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, false); addRowAndClose(slotProps.workingDoc, option.id, 0, false, 'empty')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <draggable
                  v-if="slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0"
                  v-model="slotProps.workingDoc.structure"
                  item-key="id"
                  :disabled="true"
                >
                  <template #item="{ element: row, index: rowIndex }">
                    <div class="space-y-2">
                      <div v-if="state.editMode" class="flex px-4 flex-wrap items-center gap-2 justify-between">
                        <div class="flex flex-wrap items-center gap-2">
                          <edge-shad-button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === 0"
                            @click="moveRow(slotProps.workingDoc, rowIndex, -1, false)"
                          >
                            <ArrowUp class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === (slotProps.workingDoc?.structure?.length || 0) - 1"
                            @click="moveRow(slotProps.workingDoc, rowIndex, 1, false)"
                          >
                            <ArrowDown class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button variant="outline" size="icon" class="h-8 w-8" @click="openRowSettings(row, false)">
                            <Settings class="h-4 w-4" />
                          </edge-shad-button>
                        </div>
                        <edge-shad-button variant="destructive" size="icon" class="text-white" @click="slotProps.workingDoc.structure.splice(rowIndex, 1); cleanupOrphanBlocks(slotProps.workingDoc, false)">
                          <Trash class="h-4 w-4" />
                        </edge-shad-button>
                      </div>
                      <div
                        class="mx-auto"
                        :class="[rowWidthClass(row.width), backgroundClass(row.background), state.editMode ? 'shadow-sm border border-gray-200/70 p-4' : 'shadow-none border-0 p-0']"
                        :style="{ ...rowBackgroundStyle(row.background), ...rowSpacingStyle(row) }"
                      >
                        <div :class="[rowGridClass(row), rowVerticalAlignClass(row)]" :style="rowGridStyle(row)">
                          <div
                            v-for="(column, colIndex) in row.columns"
                            :key="column.id || colIndex"
                            class="space-y-2"
                            :class="[state.editMode ? 'rounded-md bg-white/80 p-3 border border-dashed border-gray-200' : '', columnMobileOrderClass(row, colIndex)]"
                            :style="{ ...columnSpanStyle(column), ...columnMobileOrderStyle(row, colIndex) }"
                          >
                            <edge-button-divider v-if="state.editMode" class="my-1">
                              <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, 0, block, slotProps, false)" />
                            </edge-button-divider>
                            <draggable
                              v-model="column.blocks"
                              :group="{ name: 'page-blocks', pull: true, put: true }"
                              :item-key="blockKey"
                              handle=".block-drag-handle"
                              ghost-class="block-ghost"
                              chosen-class="block-dragging"
                              drag-class="block-dragging"
                            >
                              <template #item="{ element: blockId, index: blockPosition }">
                                <div class="space-y-2">
                                  <div :key="blockId" class="relative group">
                                    <edge-cms-block
                                      v-if="blockIndex(slotProps.workingDoc, blockId, false) !== -1"
                                      :key="`${pagePreviewRenderKey}:${blockId}:${effectiveThemeId}:list`"
                                      v-model="slotProps.workingDoc.content[blockIndex(slotProps.workingDoc, blockId, false)]"
                                      :site-id="selectedPreviewContextSiteId"
                                      :render-context="pagePreviewRenderContext"
                                      :edit-mode="state.editMode"
                                      :override-clicks-in-edit-mode="state.editMode"
                                      :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                                      :contain-fixed="state.editMode"
                                      :viewport-mode="previewViewportMode"
                                      :preview-auth-logged-in="state.previewAuthLoggedIn"
                                      :block-id="blockId"
                                      :theme="theme"
                                      :allow-protection-editor="isRestrictedContentEnabled"
                                      @delete="(block) => deleteBlock(block, slotProps)"
                                    />
                                    <div
                                      v-if="state.editMode"
                                      class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30"
                                    >
                                      <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                                        <Grip class="w-4 h-4" />
                                      </div>
                                    </div>
                                  </div>
                                  <div v-if="state.editMode && column.blocks.length > blockPosition + 1" class="w-full">
                                    <edge-button-divider class="my-2">
                                      <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, blockPosition + 1, block, slotProps, false)" />
                                    </edge-button-divider>
                                  </div>
                                </div>
                              </template>
                            </draggable>
                            <edge-button-divider v-if="state.editMode && column.blocks.length > 0" class="my-1">
                              <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, column.blocks.length, block, slotProps, false)" />
                            </edge-button-divider>
                          </div>
                        </div>
                      </div>
                      <edge-button-divider
                        v-if="state.editMode && rowIndex < (slotProps.workingDoc?.structure?.length || 0) - 1"
                        class="my-2"
                      >
                        <Popover v-model:open="state.addRowPopoverOpen.listBetween[row.id]">
                          <PopoverTrigger as-child>
                            <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                              Add Row
                            </edge-shad-button>
                          </PopoverTrigger>
                          <PopoverContent class="w-[360px]">
                            <div class="grid grid-cols-2 gap-2">
                              <button
                                v-for="option in LAYOUT_OPTIONS"
                                :key="option.id"
                                type="button"
                                class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                                :class="isLayoutSelected(option.id, false) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                                @click="selectLayout(option.spans, false); addRowAndClose(slotProps.workingDoc, option.id, rowIndex + 1, false, 'between', row.id)"
                              >
                                <div class="text-[11px] font-medium mb-1">
                                  {{ option.label }}
                                </div>
                                <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                                  <div
                                    v-for="(span, idx) in option.spans"
                                    :key="idx"
                                    class="bg-gray-200 rounded-sm"
                                    :style="{ gridColumn: `span ${span} / span ${span}` }"
                                  />
                                </div>
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </edge-button-divider>
                    </div>
                  </template>
                </draggable>
                <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0" class="my-2">
                  <Popover v-model:open="state.addRowPopoverOpen.listBottom">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, false) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, false); addRowAndClose(slotProps.workingDoc, option.id, slotProps.workingDoc.structure.length, false, 'bottom')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </edge-button-divider>
              </div>
            </TabsContent>
            <TabsContent v-if="hasPostView(slotProps.workingDoc)" value="post" class="mt-0">
              <div
                :key="`${pagePreviewRenderKey}:post`"
                ref="postPreviewSurfaceRef"
                data-cms-preview-surface="page"
                :data-cms-preview-mode="state.editMode ? 'edit' : 'preview'"
                class="w-full  h-[calc(100vh-180px)]  mt-2 overflow-y-auto mx-auto bg-card border border-border shadow-sm md:shadow-md p-0 space-y-6"
                :class="[{ 'transition-all duration-300': !state.editMode }, state.editMode ? 'rounded-lg' : 'rounded-none', !state.editMode ? previewAuthClass : '']"
                :style="buildScaledPreviewSurfaceStyle('calc(100vh - 180px)')"
              >
                <edge-button-divider v-if="state.editMode" class="my-2">
                  <Popover v-model:open="state.addRowPopoverOpen.postTop">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, true) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, true); addRowAndClose(slotProps.workingDoc, option.id, 0, true, 'top')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </edge-button-divider>
                <div
                  v-if="(!slotProps.workingDoc?.postStructure || slotProps.workingDoc.postStructure.length === 0)"
                  class="flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50"
                >
                  <div class="text-sm text-gray-700">
                    No rows yet. Add your first row to start building.
                  </div>
                  <Popover v-if="state.editMode" v-model:open="state.addRowPopoverOpen.postEmpty">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, true) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, true); addRowAndClose(slotProps.workingDoc, option.id, 0, true, 'empty')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <draggable
                  v-if="slotProps.workingDoc?.postStructure && slotProps.workingDoc.postStructure.length > 0"
                  v-model="slotProps.workingDoc.postStructure"
                  item-key="id"
                  :disabled="true"
                >
                  <template #item="{ element: row, index: rowIndex }">
                    <div class="space-y-2">
                      <div v-if="state.editMode" class="flex flex-wrap items-center gap-2 justify-between">
                        <div class="flex flex-wrap items-center gap-2">
                          <edge-shad-button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === 0"
                            @click="moveRow(slotProps.workingDoc, rowIndex, -1, true)"
                          >
                            <ArrowUp class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === (slotProps.workingDoc?.postStructure?.length || 0) - 1"
                            @click="moveRow(slotProps.workingDoc, rowIndex, 1, true)"
                          >
                            <ArrowDown class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button variant="outline" size="icon" class="h-8 w-8" @click="openRowSettings(row, true)">
                            <Settings class="h-4 w-4" />
                          </edge-shad-button>
                        </div>
                        <edge-shad-button variant="destructive" size="icon" class="text-white" @click="slotProps.workingDoc.postStructure.splice(rowIndex, 1); cleanupOrphanBlocks(slotProps.workingDoc, true)">
                          <Trash class="h-4 w-4" />
                        </edge-shad-button>
                      </div>
                      <div
                        class="mx-auto"
                        :class="[rowWidthClass(row.width), backgroundClass(row.background), state.editMode ? 'shadow-sm border border-gray-200/70 p-4' : 'shadow-none border-0 p-0']"
                        :style="{ ...rowBackgroundStyle(row.background), ...rowSpacingStyle(row) }"
                      >
                        <div :class="[rowGridClass(row), rowVerticalAlignClass(row)]" :style="rowGridStyle(row)">
                          <div
                            v-for="(column, colIndex) in row.columns"
                            :key="column.id || colIndex"
                            class="space-y-2"
                            :class="[state.editMode ? 'rounded-md bg-white/80 p-3 border border-dashed border-gray-200' : '', columnMobileOrderClass(row, colIndex)]"
                            :style="{ ...columnSpanStyle(column), ...columnMobileOrderStyle(row, colIndex) }"
                          >
                            <edge-button-divider v-if="state.editMode" class="my-1">
                              <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, 0, block, slotProps, true)" />
                            </edge-button-divider>
                            <draggable
                              v-model="column.blocks"
                              :group="{ name: 'post-blocks', pull: true, put: true }"
                              :item-key="blockKey"
                              handle=".block-drag-handle"
                              ghost-class="block-ghost"
                              chosen-class="block-dragging"
                              drag-class="block-dragging"
                            >
                              <template #item="{ element: blockId, index: blockPosition }">
                                <div class="space-y-2">
                                  <div :key="blockId" class="relative group">
                                    <edge-cms-block
                                      v-if="blockIndex(slotProps.workingDoc, blockId, true) !== -1"
                                      :key="`${pagePreviewRenderKey}:${blockId}:${effectiveThemeId}:post:${previewRouteLastSegment || 'auto'}`"
                                      v-model="slotProps.workingDoc.postContent[blockIndex(slotProps.workingDoc, blockId, true)]"
                                      :render-context="pagePreviewRenderContext"
                                      :edit-mode="state.editMode"
                                      :override-clicks-in-edit-mode="state.editMode"
                                      :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                                      :contain-fixed="state.editMode"
                                      :viewport-mode="previewViewportMode"
                                      :preview-auth-logged-in="state.previewAuthLoggedIn"
                                      :block-id="blockId"
                                      :theme="theme"
                                      :site-id="selectedPreviewContextSiteId"
                                      :route-last-segment="previewRouteLastSegment"
                                      :allow-protection-editor="isRestrictedContentEnabled"
                                      @delete="(block) => deleteBlock(block, slotProps, true)"
                                    />
                                    <div
                                      v-if="state.editMode"
                                      class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30"
                                    >
                                      <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                                        <Grip class="w-4 h-4" />
                                      </div>
                                    </div>
                                  </div>
                                  <div v-if="state.editMode && column.blocks.length > blockPosition + 1" class="w-full">
                                    <edge-button-divider class="my-2">
                                      <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, blockPosition + 1, block, slotProps, true)" />
                                    </edge-button-divider>
                                  </div>
                                </div>
                              </template>
                            </draggable>
                            <edge-button-divider v-if="state.editMode && column.blocks.length > 0" class="my-1">
                              <edge-cms-block-picker :site-id="props.site" :theme="theme" :allowed-types="templateAllowedBlockTypes(slotProps.workingDoc)" @pick="(block) => addBlockToColumn(rowIndex, colIndex, column.blocks.length, block, slotProps, true)" />
                            </edge-button-divider>
                          </div>
                        </div>
                      </div>
                      <edge-button-divider
                        v-if="state.editMode && rowIndex < (slotProps.workingDoc?.postStructure?.length || 0) - 1"
                        class="my-2"
                      >
                        <Popover v-model:open="state.addRowPopoverOpen.postBetween[row.id]">
                          <PopoverTrigger as-child>
                            <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                              Add Row
                            </edge-shad-button>
                          </PopoverTrigger>
                          <PopoverContent class="w-[360px]">
                            <div class="grid grid-cols-2 gap-2">
                              <button
                                v-for="option in LAYOUT_OPTIONS"
                                :key="option.id"
                                type="button"
                                class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                                :class="isLayoutSelected(option.id, true) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                                @click="selectLayout(option.spans, true); addRowAndClose(slotProps.workingDoc, option.id, rowIndex + 1, true, 'between', row.id)"
                              >
                                <div class="text-[11px] font-medium mb-1">
                                  {{ option.label }}
                                </div>
                                <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                                  <div
                                    v-for="(span, idx) in option.spans"
                                    :key="idx"
                                    class="bg-gray-200 rounded-sm"
                                    :style="{ gridColumn: `span ${span} / span ${span}` }"
                                  />
                                </div>
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </edge-button-divider>
                    </div>
                  </template>
                </draggable>
                <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.postStructure && slotProps.workingDoc.postStructure.length > 0" class="my-2">
                  <Popover v-model:open="state.addRowPopoverOpen.postBottom">
                    <PopoverTrigger as-child>
                      <edge-shad-button class="bg-slate-300 text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 text-xs h-[32px]">
                        Add Row
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[360px]">
                      <div class="grid grid-cols-2 gap-2">
                        <button
                          v-for="option in LAYOUT_OPTIONS"
                          :key="option.id"
                          type="button"
                          class="border rounded-md p-2 transition bg-white hover:border-primary text-left w-full"
                          :class="isLayoutSelected(option.id, true) ? 'border-primary ring-1 ring-primary/40' : 'border-gray-200'"
                          @click="selectLayout(option.spans, true); addRowAndClose(slotProps.workingDoc, option.id, slotProps.workingDoc.postStructure.length, true, 'bottom')"
                        >
                          <div class="text-[11px] font-medium mb-1">
                            {{ option.label }}
                          </div>
                          <div class="w-full h-8 grid gap-[2px]" style="grid-template-columns: repeat(6, minmax(0, 1fr));">
                            <div
                              v-for="(span, idx) in option.spans"
                              :key="idx"
                              class="bg-gray-200 rounded-sm"
                              :style="{ gridColumn: `span ${span} / span ${span}` }"
                            />
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </edge-button-divider>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <Sheet v-model:open="state.rowSettings.open">
        <SheetContent side="right" class="w-full sm:max-w-md flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Row Settings</SheetTitle>
            <SheetDescription>Adjust layout and spacing for this row.</SheetDescription>
          </SheetHeader>
          <div v-if="activeRowSettingsRow" class="mt-6 space-y-5 flex-1 overflow-y-auto">
            <div class="space-y-2">
              <edge-shad-select
                v-model="state.rowSettings.draft.width"
                label="Width"
                name="row-width-setting"
                :items="ROW_WIDTH_OPTIONS"
                class="w-full"
                placeholder="Row width"
              />
            </div>
            <div class="space-y-2">
              <edge-shad-select
                v-model="state.rowSettings.draft.gap"
                label="Gap"
                name="row-gap-setting"
                :items="ROW_GAP_OPTIONS"
                class="w-full"
                placeholder="Row gap"
              />
            </div>
            <div class="space-y-2">
              <edge-shad-select
                v-model="state.rowSettings.draft.verticalAlign"
                label="Vertical Alignment"
                name="row-vertical-align-setting"
                :items="ROW_VERTICAL_ALIGN_OPTIONS"
                class="w-full"
                placeholder="Vertical align"
              />
            </div>
            <div class="space-y-2">
              <edge-shad-select
                v-model="state.rowSettings.draft.mobileOrder"
                label="Mobile Stack Order"
                name="row-mobile-order-setting"
                :items="ROW_MOBILE_STACK_OPTIONS"
                class="w-full"
                placeholder="Mobile stack order"
              />
            </div>
            <div v-if="themeColorOptions.length" class="space-y-2">
              <edge-shad-select
                v-model="state.rowSettings.draft.background"
                label="Background"
                name="row-background-setting"
                :items="themeColorOptions"
                class="w-full"
                placeholder="Background"
              />
            </div>
            <details class="rounded-md border border-gray-200 bg-white/70 p-3">
              <summary class="cursor-pointer text-sm font-medium text-slate-900">
                Padding
              </summary>
              <div class="mt-3 space-y-2">
                <edge-shad-number
                  v-model="state.rowSettings.draft.paddingTop"
                  label="Padding Top"
                  name="row-padding-top-setting"
                  :min="0"
                  :step="1"
                />
                <edge-shad-number
                  v-model="state.rowSettings.draft.paddingRight"
                  label="Padding Right"
                  name="row-padding-right-setting"
                  :min="0"
                  :step="1"
                />
                <edge-shad-number
                  v-model="state.rowSettings.draft.paddingBottom"
                  label="Padding Bottom"
                  name="row-padding-bottom-setting"
                  :min="0"
                  :step="1"
                />
                <edge-shad-number
                  v-model="state.rowSettings.draft.paddingLeft"
                  label="Padding Left"
                  name="row-padding-left-setting"
                  :min="0"
                  :step="1"
                />
              </div>
            </details>
            <details class="rounded-md border border-gray-200 bg-white/70 p-3">
              <summary class="cursor-pointer text-sm font-medium text-slate-900">
                Margin
              </summary>
              <div class="mt-3 space-y-2">
                <edge-shad-select
                  v-model="state.rowSettings.draft.marginXMode"
                  label="Horizontal Margin"
                  name="row-margin-x-mode-setting"
                  :items="ROW_MARGIN_X_MODE_OPTIONS"
                  class="w-full"
                  placeholder="Horizontal margin mode"
                />
                <edge-shad-number
                  v-model="state.rowSettings.draft.marginTop"
                  label="Margin Top"
                  name="row-margin-top-setting"
                  :min="0"
                  :step="1"
                />
                <edge-shad-number
                  v-model="state.rowSettings.draft.marginBottom"
                  label="Margin Bottom"
                  name="row-margin-bottom-setting"
                  :min="0"
                  :step="1"
                />
                <template v-if="state.rowSettings.draft.marginXMode === 'custom'">
                  <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Custom horizontal margins can produce undesired layout results, especially with responsive row widths.
                  </div>
                  <edge-shad-number
                    v-model="state.rowSettings.draft.marginRight"
                    label="Margin Right"
                    name="row-margin-right-setting"
                    :min="0"
                    :step="1"
                  />
                  <edge-shad-number
                    v-model="state.rowSettings.draft.marginLeft"
                    label="Margin Left"
                    name="row-margin-left-setting"
                    :min="0"
                    :step="1"
                  />
                </template>
              </div>
            </details>
          </div>
          <SheetFooter class="pt-2 flex justify-between mt-auto">
            <edge-shad-button variant="destructive" class="text-white" @click="state.rowSettings.open = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button class=" bg-slate-800 hover:bg-slate-400 w-full" @click="saveRowSettings">
              Save changes
            </edge-shad-button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </template>
  </edge-editor>
  <edge-shad-dialog v-model="state.renamePageDialogOpen">
    <DialogContent class="max-w-md">
      <edge-shad-form :schema="renamePageSchema" @submit="renameCurrentPageAction">
        <DialogHeader>
          <DialogTitle>Rename {{ props.isTemplateSite ? 'Template' : 'Page' }}</DialogTitle>
          <DialogDescription>
            {{ props.isTemplateSite ? 'Update the template name.' : 'Update the page name used in the site menu and route.' }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <edge-shad-input v-model="state.renamePageValue" name="name" label="Name" placeholder="Enter name" />
        </div>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="state.renamePageDialogOpen = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="submit" :disabled="state.renamePageSubmitting">
            <Loader2 v-if="state.renamePageSubmitting" class="h-4 w-4 animate-spin" />
            <span v-else>Rename</span>
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.deletePageDialogOpen">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle class="text-left">
          Delete {{ props.isTemplateSite ? 'Template' : 'Page' }} "{{ currentPageRenameLabel }}"
        </DialogTitle>
        <DialogDescription />
      </DialogHeader>
      <div class="text-left px-1">
        Are you sure you want to delete "{{ currentPageRenameLabel }}"? This action cannot be undone.
      </div>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" @click="state.deletePageDialogOpen = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button variant="destructive" :disabled="state.deletePageSubmitting" @click="deleteCurrentPage">
          <Loader2 v-if="state.deletePageSubmitting" class="h-4 w-4 animate-spin" />
          <span v-else>Delete</span>
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.historyDialogOpen">
    <DialogContent class="w-full max-w-6xl">
      <DialogHeader>
        <DialogTitle class="text-left">
          {{ props.isTemplateSite ? 'Template History' : 'Page History' }}
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
              name="pageHistoryVersion"
              label="History Entry"
              :items="historyVersionItems"
              placeholder="Select a history entry"
              class="w-full"
              :disabled="state.historyLoading || state.historyRestoring || historyVersionItems.length === 0"
            />
          </div>
          <div class="flex min-w-0 flex-col justify-end">
            <edge-shad-button
              type="button"
              variant="outline"
              class="h-10 justify-between gap-3 px-3 text-left mb-1"
              :disabled="!selectedHistoryEntry || state.historyLoading || !hasHistoryDiff"
              @click="state.showHistoryDiffDialog = true"
            >
              <span class="truncate">{{ hasHistoryDiff ? 'View Diff' : 'No Differences' }}</span>
              <span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {{ historyDiffCountLabel }}
              </span>
            </edge-shad-button>
          </div>
        </div>

        <div v-if="state.historyError" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {{ state.historyError }}
        </div>

        <div
          v-if="state.editorHasUnsavedChanges"
          class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          There are unsaved changes. History compares saved versions of this {{ props.isTemplateSite ? 'template' : 'page' }}. For unsaved changes, use the <strong>Unsaved Changes</strong> button in the page header.
        </div>

        <div v-if="historyPreviewHasPostView" class="flex items-center gap-2">
          <edge-shad-button
            type="button"
            variant="outline"
            class="h-8 px-3 text-xs"
            :class="state.historyPreviewView === 'list' ? 'bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : ''"
            @click="state.historyPreviewView = 'list'"
          >
            Index Preview
          </edge-shad-button>
          <edge-shad-button
            type="button"
            variant="outline"
            class="h-8 px-3 text-xs"
            :class="state.historyPreviewView === 'post' ? 'bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200' : ''"
            @click="state.historyPreviewView = 'post'"
          >
            Detail Preview
          </edge-shad-button>
        </div>

        <div class="min-w-0 rounded-md border border-slate-300 bg-card dark:border-slate-700">
          <div
            v-if="state.historyLoading"
            class="flex h-[60vh] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"
          >
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading history preview...
          </div>
          <div
            v-else-if="!state.historyPreviewDoc"
            class="flex h-[60vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
          >
            No older saved versions are available to preview.
          </div>
          <div
            v-else-if="state.historyPreviewView !== 'post'"
            :key="`${historyPreviewRenderKey}:list`"
            ref="historyListPreviewSurfaceRef"
            data-cms-preview-surface="page"
            data-cms-preview-mode="history"
            class="relative isolate h-[60vh] overflow-y-auto overflow-x-hidden bg-card p-0"
            :style="buildScaledPreviewSurfaceStyle('60vh')"
          >
            <div
              v-if="!renderedHistoryPreviewDoc?.structure?.length"
              class="flex min-h-[50vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              No rows in this version.
            </div>
            <div v-else>
              <div
                v-for="(row, rowIndex) in renderedHistoryPreviewDoc.structure"
                :key="row.id || `history-list-row-${rowIndex}`"
              >
                <div
                  class="mx-auto shadow-none border-0 p-0"
                  :class="[rowWidthClass(row.width), backgroundClass(row.background)]"
                  :style="{ ...rowBackgroundStyle(row.background), ...rowSpacingStyle(row) }"
                >
                  <div :class="[rowGridClass(row), rowVerticalAlignClass(row)]" :style="rowGridStyle(row)">
                    <div
                      v-for="(column, colIndex) in row.columns || []"
                      :key="column.id || colIndex"
                      :class="columnMobileOrderClass(row, colIndex)"
                      :style="{ ...columnSpanStyle(column), ...columnMobileOrderStyle(row, colIndex) }"
                    >
                      <div
                        v-for="(blockId, blockPosition) in column.blocks || []"
                        :key="`${historyPreviewRenderKey}:list:${blockId}:${blockPosition}`"
                      >
                        <edge-cms-block-api
                          v-if="blockIndex(renderedHistoryPreviewDoc, blockId, false) !== -1"
                          :site-id="selectedPreviewContextSiteId"
                          :content="renderedHistoryPreviewDoc.content[blockIndex(renderedHistoryPreviewDoc, blockId, false)]?.content"
                          :values="renderedHistoryPreviewDoc.content[blockIndex(renderedHistoryPreviewDoc, blockId, false)]?.values"
                          :meta="renderedHistoryPreviewDoc.content[blockIndex(renderedHistoryPreviewDoc, blockId, false)]?.meta"
                          :viewport-mode="previewViewportMode"
                          :theme="theme"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            v-else
            :key="`${historyPreviewRenderKey}:post`"
            ref="historyPostPreviewSurfaceRef"
            data-cms-preview-surface="page"
            data-cms-preview-mode="history"
            class="relative isolate h-[60vh] overflow-y-auto overflow-x-hidden bg-card p-0"
            :style="buildScaledPreviewSurfaceStyle('60vh')"
          >
            <div
              v-if="!renderedHistoryPreviewDoc?.postStructure?.length"
              class="flex min-h-[50vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              No detail rows in this version.
            </div>
            <div v-else>
              <div
                v-for="(row, rowIndex) in renderedHistoryPreviewDoc.postStructure"
                :key="row.id || `history-post-row-${rowIndex}`"
              >
                <div
                  class="mx-auto shadow-none border-0 p-0"
                  :class="[rowWidthClass(row.width), backgroundClass(row.background)]"
                  :style="{ ...rowBackgroundStyle(row.background), ...rowSpacingStyle(row) }"
                >
                  <div :class="[rowGridClass(row), rowVerticalAlignClass(row)]" :style="rowGridStyle(row)">
                    <div
                      v-for="(column, colIndex) in row.columns || []"
                      :key="column.id || colIndex"
                      :class="columnMobileOrderClass(row, colIndex)"
                      :style="{ ...columnSpanStyle(column), ...columnMobileOrderStyle(row, colIndex) }"
                    >
                      <div
                        v-for="(blockId, blockPosition) in column.blocks || []"
                        :key="`${historyPreviewRenderKey}:post:${blockId}:${blockPosition}`"
                      >
                        <edge-cms-block-api
                          v-if="blockIndex(renderedHistoryPreviewDoc, blockId, true) !== -1"
                          :site-id="selectedPreviewContextSiteId"
                          :content="renderedHistoryPreviewDoc.postContent[blockIndex(renderedHistoryPreviewDoc, blockId, true)]?.content"
                          :values="renderedHistoryPreviewDoc.postContent[blockIndex(renderedHistoryPreviewDoc, blockId, true)]?.values"
                          :meta="renderedHistoryPreviewDoc.postContent[blockIndex(renderedHistoryPreviewDoc, blockId, true)]?.meta"
                          :viewport-mode="previewViewportMode"
                          :theme="theme"
                          :route-last-segment="previewRouteLastSegment"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
  <edge-shad-dialog v-model="state.importDocIdDialogOpen">
    <DialogContent class="pt-8">
      <DialogHeader>
        <DialogTitle class="text-left">
          Enter Page Doc ID
        </DialogTitle>
        <DialogDescription>
          This JSON file does not include a <code>docId</code>. Enter the doc ID you want to import into this site.
        </DialogDescription>
      </DialogHeader>
      <edge-shad-input
        v-model="state.importDocIdValue"
        name="page-import-doc-id"
        label="Doc ID"
        placeholder="example-page-id"
      />
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" @click="resolvePageImportDocId('')">
          Cancel
        </edge-shad-button>
        <edge-shad-button @click="resolvePageImportDocId(state.importDocIdValue)">
          Continue
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.importConflictDialogOpen">
    <DialogContent class="pt-8">
      <DialogHeader>
        <DialogTitle class="text-left">
          Page Already Exists
        </DialogTitle>
        <DialogDescription>
          <code>{{ state.importConflictDocId }}</code> already exists in this site. Choose to overwrite it or import as a new page.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" @click="resolvePageImportConflict('cancel')">
          Cancel
        </edge-shad-button>
        <edge-shad-button variant="outline" @click="resolvePageImportConflict('new')">
          Add As New
        </edge-shad-button>
        <edge-shad-button @click="resolvePageImportConflict('overwrite')">
          Overwrite
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.routeLastSegmentDialogOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Test URL</DialogTitle>
        <DialogDescription>
          Set the preview value used for <code>{routeLastSegment}</code> on the detail page.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-3">
        <div class="space-y-2">
          <label for="route-last-segment-preview" class="text-sm font-medium text-foreground">
            Route Last Segment
          </label>
          <Input
            id="route-last-segment-preview"
            v-model="state.routeLastSegmentDraft"
            placeholder="example-post-name"
          />
        </div>
        <div class="flex items-center justify-end gap-2">
          <edge-shad-button type="button" variant="outline" @click="clearRouteLastSegment">
            Auto
          </edge-shad-button>
          <edge-shad-button type="button" variant="outline" @click="state.routeLastSegmentDialogOpen = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="button" @click="applyRouteLastSegment">
            Go
          </edge-shad-button>
        </div>
      </div>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.importErrorDialogOpen">
    <DialogContent class="pt-8">
      <DialogHeader>
        <DialogTitle class="text-left">
          Import Failed
        </DialogTitle>
        <DialogDescription class="text-left">
          {{ state.importErrorMessage }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="pt-2">
        <edge-shad-button @click="state.importErrorDialogOpen = false">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.showUnpublishedChangesDialog">
    <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="text-left">
          {{ pageChangesDialogTitle }}
        </DialogTitle>
        <DialogDescription class="text-left">
          {{ pageChangesDialogDescription }}
        </DialogDescription>
      </DialogHeader>
      <div class="mt-2 flex-1 overflow-y-auto pr-1">
        <div v-if="activePageChangeDetails.length" class="space-y-3">
          <div
            v-for="change in activePageChangeDetails"
            :key="change.key"
            class="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 p-3 text-left"
          >
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {{ change.label }}
            </div>
            <div v-if="!change.layoutChanges?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.baseLabel || 'Published' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.base }}
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.compareLabel || 'Draft' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.compare }}
                </div>
              </div>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.baseLabel || 'Published' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:base`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.base }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.compareLabel || 'Draft' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:compare`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.compare }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.blockChanges?.length" class="mt-3 space-y-3">
              <div
                v-for="blockChange in change.blockChanges"
                :key="blockChange.key"
                class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    {{ blockChange.label }}
                  </span>
                  <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ blockChange.blockLabel }}</span>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <div><strong>{{ change.baseLabel || 'Published' }}:</strong> {{ blockChange.basePositionLabel }}</div>
                  <div><strong>{{ change.compareLabel || 'Draft' }}:</strong> {{ blockChange.comparePositionLabel }}</div>
                </div>
                <div v-if="blockChange.showPreview" class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.baseLabel || 'Published' }}
                    </div>
                    <div
                      data-cms-preview-surface="page"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.baseBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:base`"
                          :content="blockChange.baseBlock?.content"
                          :values="blockChange.baseBlock?.values"
                          :meta="blockChange.baseBlock?.meta"
                          :theme="theme"
                          :site-id="selectedPreviewContextSiteId"
                          :route-last-segment="previewRouteLastSegment"
                          :viewport-mode="previewViewportMode"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.compareLabel || 'Draft' }}
                    </div>
                    <div
                      data-cms-preview-surface="page"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.compareBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:compare`"
                          :content="blockChange.compareBlock?.content"
                          :values="blockChange.compareBlock?.values"
                          :meta="blockChange.compareBlock?.meta"
                          :theme="theme"
                          :site-id="selectedPreviewContextSiteId"
                          :route-last-segment="previewRouteLastSegment"
                          :viewport-mode="previewViewportMode"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.details?.length" class="mt-2 text-sm text-gray-700 dark:text-gray-300">
              <ul class="list-disc pl-5 space-y-1">
                <li v-for="(detail, detailIndex) in change.details" :key="`${change.key}-${detailIndex}`">
                  {{ detail }}
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-gray-600 dark:text-gray-300 text-left">
          No {{ showingUnsavedChanges ? 'unsaved' : 'unpublished' }} differences detected.
        </div>
      </div>
      <DialogFooter class="pt-4">
        <edge-shad-button class="w-full" variant="outline" @click="state.showUnpublishedChangesDialog = false">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.showHistoryDiffDialog">
    <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="text-left">
          History Diff
        </DialogTitle>
        <DialogDescription class="text-left">
          Review differences between the selected history entry and the current {{ props.isTemplateSite ? 'template' : 'page' }}.
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
            <div v-if="!change.layoutChanges?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.baseLabel || 'Selected History' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.base }}
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.compareLabel || 'Current' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.compare }}
                </div>
              </div>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.baseLabel || 'Selected History' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:base`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.base }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.compareLabel || 'Current' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:compare`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.compare }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.blockChanges?.length" class="mt-3 space-y-3">
              <div
                v-for="blockChange in change.blockChanges"
                :key="blockChange.key"
                class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    {{ blockChange.label }}
                  </span>
                  <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ blockChange.blockLabel }}</span>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <div><strong>{{ change.baseLabel || 'Selected History' }}:</strong> {{ blockChange.basePositionLabel }}</div>
                  <div><strong>{{ change.compareLabel || 'Current' }}:</strong> {{ blockChange.comparePositionLabel }}</div>
                </div>
                <div v-if="blockChange.showPreview" class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.baseLabel || 'Selected History' }}
                    </div>
                    <div
                      data-cms-preview-surface="page"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.baseBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:base`"
                          :content="blockChange.baseBlock?.content"
                          :values="blockChange.baseBlock?.values"
                          :meta="blockChange.baseBlock?.meta"
                          :theme="theme"
                          :site-id="selectedPreviewContextSiteId"
                          :route-last-segment="previewRouteLastSegment"
                          :viewport-mode="previewViewportMode"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.compareLabel || 'Current' }}
                    </div>
                    <div
                      data-cms-preview-surface="page"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.compareBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:compare`"
                          :content="blockChange.compareBlock?.content"
                          :values="blockChange.compareBlock?.values"
                          :meta="blockChange.compareBlock?.meta"
                          :theme="theme"
                          :site-id="selectedPreviewContextSiteId"
                          :route-last-segment="previewRouteLastSegment"
                          :viewport-mode="previewViewportMode"
                          :render-context="pagePreviewRenderContext"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.details?.length" class="mt-2 text-sm text-gray-700 dark:text-gray-300">
              <ul class="list-disc pl-5 space-y-1">
                <li v-for="(detail, detailIndex) in change.details" :key="`${change.key}-${detailIndex}`">
                  {{ detail }}
                </li>
              </ul>
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
</template>

<style scoped>
.block-ghost {
  opacity: 0.35;
  pointer-events: none;
  filter: grayscale(0.4);
}

.block-dragging,
.block-dragging * {
  user-select: none !important;
  cursor: grabbing !important;
}

.block-drag-handle {
  cursor: grab;
}

.block-drag-handle:active {
  cursor: grabbing;
}

.cms-page-preview-mode :deep(.border-emerald-200.bg-emerald-50) {
  display: none !important;
}

.cms-page-preview-mode :deep(.border-emerald-300.bg-emerald-50) {
  display: none !important;
}

.cms-page-preview-mode :deep([data-cms-preview-surface]) {
  color: initial !important;
}

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
