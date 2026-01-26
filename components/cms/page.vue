<script setup>
import { AlertTriangle, ArrowDown, ArrowUp, Maximize2, Monitor, Smartphone, Sparkles, Tablet, UploadCloud } from 'lucide-vue-next'
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
const { buildPageStructuredData } = useStructuredDataTemplates()

const state = reactive({
  newDocs: {
    pages: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Name' }, cols: '12', value: '' },
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
  seoAiLoading: false,
  seoAiError: '',
  previewViewport: 'full',
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
})

const schemas = {
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const previewViewportOptions = [
  { id: 'full', label: 'Wild Width', width: '100%', icon: Maximize2 },
  { id: 'large', label: 'Large Screen', width: '1280px', icon: Monitor },
  { id: 'medium', label: 'Medium', width: '992px', icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: '420px', icon: Smartphone },
]

const selectedPreviewViewport = computed(() => previewViewportOptions.find(option => option.id === state.previewViewport) || previewViewportOptions[0])

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

const setPreviewViewport = (viewportId) => {
  state.previewViewport = viewportId
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

  let mutated = false
  for (const row of workingDoc[structureKey]) {
    if (!Array.isArray(row.columns)) {
      row.columns = createRow(1).columns
      mutated = true
    }

    for (const col of row.columns) {
      if (!col.id) {
        col.id = edgeGlobal.generateShortId()
        mutated = true
      }
      if (!Array.isArray(col.blocks)) {
        col.blocks = []
        mutated = true
      }
      if (col.span == null)
        col.span = null
    }

    if (!row.width) {
      row.width = 'full'
      mutated = true
    }
    if (!row.gap) {
      row.gap = '4'
      mutated = true
    }
    if (!row.mobileOrder) {
      row.mobileOrder = 'normal'
      mutated = true
    }
    if (!row.verticalAlign) {
      row.verticalAlign = 'start'
      mutated = true
    }
    if (typeof row.background !== 'string' || row.background === '') {
      row.background = 'transparent'
      mutated = true
    }
    refreshRowTailwindClasses(row)
  }

  const contentIds = new Set((workingDoc[contentKey] || []).map(block => block.id))
  for (const row of workingDoc[structureKey]) {
    for (const col of row.columns) {
      const filtered = col.blocks.filter(blockId => contentIds.has(blockId))
      if (filtered.length !== col.blocks.length) {
        col.blocks = filtered
        mutated = true
      }
    }
  }

  // If nothing needed normalization, leave as-is to avoid reactive churn
  if (!mutated)
    return
}

const addRow = (workingDoc, layoutValue = '6', isPost = false) => {
  ensureStructureDefaults(workingDoc, isPost)
  const structureKey = isPost ? 'postStructure' : 'structure'
  workingDoc[structureKey].push(createRowFromLayout(layoutValue))
}

const adjustRowColumns = (row, newCount) => {
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

const blockPick = (block, index, slotProps, post = false) => {
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

const applyCollectionUniqueKeys = (workingDoc) => {
  const resolveUniqueKey = (template) => {
    if (!template || typeof template !== 'string')
      return ''
    let resolved = template
    const orgId = edgeGlobal.edgeState.currentOrganization || ''
    const siteId = props.site || ''
    if (resolved.includes('{orgId}') && orgId)
      resolved = resolved.replaceAll('{orgId}', orgId)
    if (resolved.includes('{siteId}') && siteId)
      resolved = resolved.replaceAll('{siteId}', siteId)
    return resolved
  }

  const applyToBlocks = (blocks) => {
    if (!Array.isArray(blocks))
      return
    blocks.forEach((block) => {
      const meta = block?.meta
      if (!meta || typeof meta !== 'object')
        return
      Object.keys(meta).forEach((fieldKey) => {
        const cfg = meta[fieldKey]
        if (!cfg?.collection?.uniqueKey)
          return
        const resolved = resolveUniqueKey(cfg.collection.uniqueKey)
        if (!resolved)
          return
        if (cfg.queryItems && !Object.prototype.hasOwnProperty.call(cfg, 'uniqueKey')) {
          const reordered = {}
          Object.keys(cfg).forEach((key) => {
            reordered[key] = cfg[key]
            if (key === 'queryItems')
              reordered.uniqueKey = resolved
          })
          block.meta[fieldKey] = reordered
        }
        else {
          cfg.uniqueKey = resolved
        }
      })
    })
  }

  applyToBlocks(workingDoc?.content)
  applyToBlocks(workingDoc?.postContent)
}

onMounted(() => {
  if (props.page === 'new') {
    state.editMode = true
  }
})

const editorDocUpdates = (workingDoc) => {
  ensureStructureDefaults(workingDoc, false)
  if (workingDoc?.post || (Array.isArray(workingDoc?.postContent) && workingDoc.postContent.length > 0) || Array.isArray(workingDoc?.postStructure))
    ensureStructureDefaults(workingDoc, true)
  applyCollectionUniqueKeys(workingDoc)
  const blockIds = (workingDoc.content || []).map(block => block.blockId).filter(id => id)
  const postBlockIds = workingDoc.postContent ? workingDoc.postContent.map(block => block.blockId).filter(id => id) : []
  blockIds.push(...postBlockIds)
  const uniqueBlockIds = [...new Set(blockIds)]
  state.workingDoc.blockIds = uniqueBlockIds
}

const pageName = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page]?.name || ''
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

const theme = computed(() => {
  const themeId = selectedThemeId.value
  if (!themeId)
    return null
  const themeContents = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[themeId]?.theme || null
  if (!themeContents)
    return null
  try {
    return typeof themeContents === 'string' ? JSON.parse(themeContents) : themeContents
  }
  catch (e) {
    return null
  }
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
  const allowed = new Set([0, 2, 4, 6, 8])
  const safeGap = allowed.has(gap) ? gap : 4
  if (safeGap === 0)
    return 'gap-0'
  return ['gap-0', `sm:gap-${safeGap}`].join(' ')
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

const refreshRowTailwindClasses = (row) => {
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

const createRowFromLayout = (spans) => {
  const safeSpans = layoutSpansFromString(spans, [6])
  const row = {
    id: edgeGlobal.generateShortId(),
    width: 'full',
    gap: '4',
    background: 'transparent',
    verticalAlign: 'start',
    mobileOrder: 'normal',
    columns: buildColumnsFromSpans(safeSpans),
  }
  refreshRowTailwindClasses(row)
  return row
}

const addRowAt = (workingDoc, layoutValue = '6', insertIndex = 0, isPost = false) => {
  ensureStructureDefaults(workingDoc, isPost)
  const structureKey = isPost ? 'postStructure' : 'structure'
  const count = workingDoc[structureKey]?.length || 0
  const safeIndex = Math.min(Math.max(insertIndex, 0), count)
  workingDoc[structureKey].splice(safeIndex, 0, createRowFromLayout(layoutValue))
}

const headObject = computed(() => {
  const themeId = selectedThemeId.value
  if (!themeId)
    return {}
  try {
    return JSON.parse(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[themeId]?.headJSON || '{}')
  }
  catch (e) {
    return {}
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
      },
      {
        content: draftPage.content,
        postContent: draftPage.postContent,
        structure: draftPage.structure,
        postStructure: draftPage.postStructure,
        metaTitle: draftPage.metaTitle,
        metaDescription: draftPage.metaDescription,
        structuredData: draftPage.structuredData,
      },
    )
  }
  return false
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

watch (currentPage, (newPage) => {
  state.workingDoc.last_updated = newPage?.last_updated
  state.workingDoc.metaTitle = newPage?.metaTitle
  state.workingDoc.metaDescription = newPage?.metaDescription
  state.workingDoc.structuredData = newPage?.structuredData
}, { immediate: true, deep: true })

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
  const names = blocks
    .map(block => block?.type || block?.component || block?.layout || block?.name)
    .filter(Boolean)
  const sample = Array.from(new Set(names)).slice(0, 3).join(', ')
  const suffix = names.length > 3 ? ', ...' : ''
  return `${count} block${count === 1 ? '' : 's'}${sample ? ` (${sample}${suffix})` : ''}`
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
  const title = block.title || block.heading || block.label || block.name || ''
  const summary = block.text || block.content || block.body || ''
  const parts = [type]
  if (title)
    parts.push(`“${String(title)}”`)
  if (summary && String(summary).length < 80)
    parts.push(String(summary))
  return parts.filter(Boolean).join(' - ')
}

const diffBlockFields = (publishedBlock, draftBlock) => {
  const keys = new Set([
    ...Object.keys(publishedBlock || {}),
    ...Object.keys(draftBlock || {}),
  ])
  const changes = []
  for (const key of keys) {
    if (key === 'id' || key === 'blockId')
      continue
    const prevVal = publishedBlock?.[key]
    const nextVal = draftBlock?.[key]
    if (!areEqualNormalized(prevVal, nextVal)) {
      changes.push(`${key}: ${summarizeChangeValue(prevVal, true)} → ${summarizeChangeValue(nextVal, true)}`)
    }
  }
  return changes
}

const buildBlockChangeDetails = (publishedBlocks = [], draftBlocks = []) => {
  const details = []
  const publishedMap = new Map()
  const draftMap = new Map()

  publishedBlocks.forEach((block, index) => {
    const key = block?.id || block?.blockId || `pub-${index}`
    publishedMap.set(key, block)
  })
  draftBlocks.forEach((block, index) => {
    const key = block?.id || block?.blockId || `draft-${index}`
    draftMap.set(key, block)
  })

  for (const [key, draftBlock] of draftMap.entries()) {
    if (!publishedMap.has(key)) {
      details.push(`Added ${describeBlock(draftBlock)}`)
      continue
    }
    const publishedBlock = publishedMap.get(key)
    if (!areEqualNormalized(publishedBlock, draftBlock)) {
      const fieldChanges = diffBlockFields(publishedBlock, draftBlock)
      if (fieldChanges.length)
        details.push(`Updated ${describeBlock(draftBlock)} (${fieldChanges.join('; ')})`)
      else
        details.push(`Updated ${describeBlock(draftBlock)}`)
    }
  }

  for (const [key, publishedBlock] of publishedMap.entries()) {
    if (!draftMap.has(key)) {
      details.push(`Removed ${describeBlock(publishedBlock)}`)
    }
  }

  return details
}

const unpublishedChangeDetails = computed(() => {
  const changes = []
  const draft = currentPage.value
  const published = publishedPage.value

  if (!draft && !published)
    return changes

  const compareField = (key, label, formatter = v => summarizeChangeValue(v, false), options = {}) => {
    const publishedVal = published?.[key]
    const draftVal = draft?.[key]
    if (areEqualNormalized(publishedVal, draftVal))
      return
    const change = {
      key,
      label,
      published: formatter(publishedVal),
      draft: formatter(draftVal),
    }
    if (options.details)
      change.details = options.details(publishedVal, draftVal)
    changes.push(change)
  }

  if (!published && draft) {
    changes.push({
      key: 'unpublished',
      label: 'Not yet published',
      published: 'No published version',
      draft: 'Draft ready to publish',
    })
  }
  if (published && !draft) {
    changes.push({
      key: 'draft-missing',
      label: 'Draft missing',
      published: 'Published version exists',
      draft: 'No draft available',
    })
  }

  compareField('content', 'Index content', summarizeBlocks, { details: (pubVal, draftVal) => buildBlockChangeDetails(pubVal, draftVal) })
  compareField('postContent', 'Post content', summarizeBlocks, { details: (pubVal, draftVal) => buildBlockChangeDetails(pubVal, draftVal) })
  compareField('structure', 'Index structure', summarizeStructure)
  compareField('postStructure', 'Post structure', summarizeStructure)
  compareField('metaTitle', 'Meta title', val => summarizeChangeValue(val, true))
  compareField('metaDescription', 'Meta description', val => summarizeChangeValue(val, true))
  compareField('structuredData', 'Structured data', val => summarizeChangeValue(val, true))

  return changes
})

const publishPage = async (pageId) => {
  if (state.publishLoading)
    return
  const pageData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  if (!pageData[pageId])
    return
  state.publishLoading = true
  try {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageData[pageId])
  }
  finally {
    state.publishLoading = false
  }
}

const hasUnsavedChanges = (changes) => {
  console.log('Unsaved changes:', changes)
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
    :collection="`sites/${site}/pages`"
    :doc-id="page"
    :schema="schemas.pages"
    :new-doc-schema="state.newDocs.pages"
    class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
    :show-footer="false"
    :save-redirect-override="`/app/dashboard/sites/${site}`"
    :no-close-after-save="true"
    :working-doc-overrides="state.workingDoc"
    @working-doc="editorDocUpdates"
    @unsaved-changes="hasUnsavedChanges"
  >
    <template #header="slotProps">
      <div class="relative flex items-center bg-secondary p-2 justify-between sticky top-0 z-50 bg-primary rounded h-[50px]">
        <span class="text-lg font-semibold whitespace-nowrap pr-1">{{ pageName }}</span>

        <div class="flex w-full items-center">
          <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />
          <div v-if="!props.isTemplateSite" class="px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap text-center flex flex-col items-center gap-1">
            <template v-if="isPublishedPageDiff(page)">
              <div class="flex items-center gap-2">
                <edge-shad-button
                  variant="outline"
                  class="bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100 hover:text-yellow-900 text-xs h-[32px] gap-1"
                  @click="state.showUnpublishedChangesDialog = true"
                >
                  <AlertTriangle class="w-4 h-4" />
                  Unpublished Changes
                </edge-shad-button>
                <edge-shad-button
                  class="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-[32px] gap-1 shadow-sm"
                  :disabled="state.publishLoading"
                  @click="publishPage(page)"
                >
                  <Loader2 v-if="state.publishLoading" class="w-4 h-4 animate-spin" />
                  <UploadCloud v-else class="w-4 h-4" />
                  Publish
                </edge-shad-button>
              </div>
            </template>
            <template v-else>
              <edge-chip class="bg-green-100 text-green-800">
                <div class="w-full">
                  Published
                </div>
              </edge-chip>
            </template>
            <span class="text-[10px] leading-tight">Last Published: {{ lastPublishedTime(page) }}</span>
          </div>
          <div v-else class="px-4 w-full max-w-xs">
            <edge-shad-select
              v-model="edgeGlobal.edgeState.blockEditorTheme"
              name="theme"
              :items="themes.map(t => ({ title: t.name, name: t.docId }))"
              placeholder="Select Theme"
              class="w-full text-xs h-[32px]"
            />
          </div>
          <div class="w-full border-t border-border" aria-hidden="true" />

          <div class="flex items-center gap-1 pr-3">
            <span class="text-[11px] uppercase tracking-wide text-muted-foreground">Viewport</span>
            <edge-shad-button
              v-for="option in previewViewportOptions"
              :key="option.id"
              type="button"
              variant="ghost"
              size="icon"
              class="h-[26px] w-[26px] text-xs gap-1 border transition-colors"
              :class="state.previewViewport === option.id ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-muted text-foreground border-border hover:bg-muted/80'"
              @click="setPreviewViewport(option.id)"
            >
              <component :is="option.icon" class="w-3.5 h-3.5" />
            </edge-shad-button>
          </div>

          <edge-shad-button variant="text" class="hover:text-primary/50 text-xs h-[26px] text-primary" @click="state.editMode = !state.editMode">
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
            class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            variant="text"
            class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Cancel
          </edge-shad-button>
          <edge-shad-button
            v-if="state.editMode || slotProps.unsavedChanges"
            variant="text"
            type="submit"
            class="bg-secondary hover:text-primary/50 text-xs h-[26px] text-primary"
            :disabled="slotProps.submitting"
          >
            <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
            <Save v-else class="w-4 h-4" />
            <span>Save</span>
          </edge-shad-button>
        </div>
      </div>
    </template>
    <template #success-alert>
      <div v-if="!props.isTemplateSite" class="mt-2 flex flex-wrap items-center gap-2">
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
      <Tabs class="w-full" default-value="list">
        <TabsList v-if="slotProps.workingDoc?.post" class="w-full mt-3 bg-primary rounded-sm">
          <TabsTrigger value="list">
            Index Page
          </TabsTrigger>
          <TabsTrigger value="post">
            Detail Page
          </TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Separator class="my-4" />
          <div
            :key="selectedThemeId"
            class="w-full mx-auto bg-card border border-border rounded-lg shadow-sm md:shadow-md p-0 space-y-6"
            :class="{ 'transition-all duration-300': !state.editMode }"
            :style="previewViewportStyle"
          >
            <edge-button-divider v-if="state.editMode" class="my-2">
              <Popover v-model:open="state.addRowPopoverOpen.listTop">
                <PopoverTrigger as-child>
                  <edge-shad-button class="bg-secondary text-primary hover:bg-primary/10 hover:text-primary text-xs h-[32px]">
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
                  <edge-shad-button class="bg-secondary text-primary hover:bg-primary/10 hover:text-primary text-xs h-[32px]">
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
                    :style="rowBackgroundStyle(row.background)"
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
                          <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, 0, block, slotProps, false)" />
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
                                  v-model="slotProps.workingDoc.content[blockIndex(slotProps.workingDoc, blockId, false)]"
                                  :site-id="props.site"
                                  :edit-mode="state.editMode"
                                  :viewport-mode="previewViewportMode"
                                  :block-id="blockId"
                                  :theme="theme"
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
                                  <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, blockPosition + 1, block, slotProps, false)" />
                                </edge-button-divider>
                              </div>
                            </div>
                          </template>
                        </draggable>
                        <edge-button-divider v-if="state.editMode && column.blocks.length > 0" class="my-1">
                          <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, column.blocks.length, block, slotProps, false)" />
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
                        <edge-shad-button class="bg-secondary text-primary hover:bg-primary/10 hover:text-primary text-xs h-[32px]">
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
                  <edge-shad-button class="bg-secondary text-primary hover:bg-primary/10 hover:text-primary text-xs h-[32px]">
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
        <TabsContent value="post">
          <Separator class="my-4" />
          <div
            :key="`${selectedThemeId}-post`"
            class="w-full mx-auto bg-card border border-border rounded-lg shadow-sm md:shadow-md p-4 space-y-6"
            :class="{ 'transition-all duration-300': !state.editMode }"
            :style="previewViewportStyle"
          >
            <edge-button-divider v-if="state.editMode" class="my-2">
              <Popover v-model:open="state.addRowPopoverOpen.postTop">
                <PopoverTrigger as-child>
                  <edge-shad-button class="bg-secondary hover:text-primary/50 text-xs h-[32px] text-primary">
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
                  <edge-shad-button class="bg-secondary hover:text-primary/50 text-xs h-[32px] text-primary">
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
                    :style="rowBackgroundStyle(row.background)"
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
                          <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, 0, block, slotProps, true)" />
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
                                  v-model="slotProps.workingDoc.postContent[blockIndex(slotProps.workingDoc, blockId, true)]"
                                  :edit-mode="state.editMode"
                                  :viewport-mode="previewViewportMode"
                                  :block-id="blockId"
                                  :theme="theme"
                                  :site-id="props.site"
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
                                  <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, blockPosition + 1, block, slotProps, true)" />
                                </edge-button-divider>
                              </div>
                            </div>
                          </template>
                        </draggable>
                        <edge-button-divider v-if="state.editMode && column.blocks.length > 0" class="my-1">
                          <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => addBlockToColumn(rowIndex, colIndex, column.blocks.length, block, slotProps, true)" />
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
                        <edge-shad-button class="bg-secondary hover:text-primary/50 text-xs h-[32px] text-primary">
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
                  <edge-shad-button class="bg-secondary text-primary hover:bg-primary/10 hover:text-primary text-xs h-[32px]">
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
  <edge-shad-dialog v-model="state.showUnpublishedChangesDialog">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle class="text-left">
          Unpublished Changes
        </DialogTitle>
        <DialogDescription class="text-left">
          Review what changed since the last publish. Last Published: {{ lastPublishedTime(page) }}
        </DialogDescription>
      </DialogHeader>
      <div v-if="unpublishedChangeDetails.length" class="space-y-3 mt-2">
        <div
          v-for="change in unpublishedChangeDetails"
          :key="change.key"
          class="rounded-md border border-gray-200 dark:border-white/10 bg-secondary p-3 text-left"
        >
          <div class="text-sm font-semibold text-primary mb-2">
            {{ change.label }}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                Published
              </div>
              <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                {{ change.published }}
              </div>
            </div>
            <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                Draft
              </div>
              <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                {{ change.draft }}
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
        No unpublished differences detected.
      </div>
      <DialogFooter class="pt-4">
        <edge-shad-button class="w-full" variant="outline" @click="state.showUnpublishedChangesDialog = false">
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
</style>
