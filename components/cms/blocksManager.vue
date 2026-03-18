<script setup>
import { Download, MoreHorizontal } from 'lucide-vue-next'
const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
const { saveJsonFiles } = useJsonFileSave()
const { blocks: blockNewDocSchema } = useCmsNewDocs()
const BLANK_BLOCK_TEMPLATE_ID = '__blank__'
const state = reactive({
  filter: '',
  mounted: false,
  blockTypeFilter: 'all',
  picksFilter: [],
  themesFilter: [],
  selectedBlockDocIds: [],
  bulkDeleteDialogOpen: false,
  bulkDeleting: false,
  exportingBlocks: false,
  exportDialogOpen: false,
  exportDialogStatus: 'idle',
  exportDialogProcessed: 0,
  exportDialogTotal: 0,
  exportDialogCurrentItem: '',
  exportCancelRequested: false,
  importingJson: false,
  importDocIdDialogOpen: false,
  importDocIdValue: '',
  importConflictDialogOpen: false,
  importConflictDocId: '',
  importErrorDialogOpen: false,
  importErrorMessage: '',
  addBlockDialogOpen: false,
  addBlockTab: 'templates',
  selectedInitBlockDocId: BLANK_BLOCK_TEMPLATE_ID,
  selectedExistingBlockDocId: '',
  newBlockName: '',
  creatingBlock: false,
  previewRenderContext: null,
  blocksLoaded: [],
})

const rawInitBlockFiles = import.meta.glob('./init_blocks/*.html', {
  as: 'raw',
  eager: true,
})

const TEMPLATE_PREVIEW_PLACEHOLDERS = {
  text: 'Lorem ipsum dolor sit amet.',
  textarea: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  richtext: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>',
  image: 'https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/f1f7f610-dfa9-4011-08a3-7a98d95e7500/thumbnail',
}

function normalizeConfigLiteral(str) {
  return str
    .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
}

function safeParseConfig(raw) {
  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}

const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g

function findMatchingBrace(str, startIdx) {
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
    const match = TAG_START_RE.exec(html)
    if (!match)
      break

    const type = match[1]
    const configStart = TAG_START_RE.lastIndex - 1
    if (configStart < 0 || html[configStart] !== '{')
      continue

    const configEnd = findMatchingBrace(html, configStart)
    if (configEnd === -1)
      continue

    const rawCfg = html.slice(configStart, configEnd + 1)
    const closeTriple = html.indexOf('}}}', configEnd)
    TAG_START_RE.lastIndex = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1

    yield { type, rawCfg }
  }
}

const parseBlockTemplateModel = (html) => {
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

    let value = cfg.value
    if (type === 'image')
      value = !value ? TEMPLATE_PREVIEW_PLACEHOLDERS.image : String(value)
    else if (type === 'text')
      value = !value ? TEMPLATE_PREVIEW_PLACEHOLDERS.text : String(value)
    else if (type === 'array')
      value = Array.isArray(value) ? edgeGlobal.dupObject(value) : []
    else if (type === 'textarea')
      value = !value ? TEMPLATE_PREVIEW_PLACEHOLDERS.textarea : String(value)
    else if (type === 'richtext')
      value = !value ? TEMPLATE_PREVIEW_PLACEHOLDERS.richtext : String(value)

    values[field] = value
  }

  return { values, meta }
}

const INITIAL_BLOCK_TEMPLATES = Object.entries(rawInitBlockFiles)
  .map(([path, content]) => {
    const fileName = path.split('/').pop() || ''
    const baseName = fileName.replace(/\.html$/i, '')
    const formattedName = baseName
      .split('_')
      .filter(Boolean)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')
    const parsed = parseBlockTemplateModel(content)
    return {
      docId: baseName,
      name: formattedName,
      content,
      values: parsed.values,
      meta: parsed.meta,
      previewType: 'light',
    }
  })
  .sort((left, right) => left.name.localeCompare(right.name))

const blankBlockTemplate = {
  docId: BLANK_BLOCK_TEMPLATE_ID,
  name: 'Blank',
  content: '',
  previewType: 'light',
}

const resetAddBlockDialogState = () => {
  state.addBlockTab = 'templates'
  state.selectedInitBlockDocId = BLANK_BLOCK_TEMPLATE_ID
  state.selectedExistingBlockDocId = ''
  state.newBlockName = ''
  state.creatingBlock = false
}

watch(() => state.addBlockDialogOpen, (open) => {
  if (!open)
    resetAddBlockDialogState()
})

const router = useRouter()
const blockImportInputRef = ref(null)
const blockImportDocIdResolver = ref(null)
const blockImportConflictResolver = ref(null)
const DEFAULT_BLOCK_IMPORT_ERROR_MESSAGE = 'Failed to import block JSON.'
const OPTIONAL_BLOCK_IMPORT_KEYS = new Set(['previewType', 'type'])

const openAddBlockDialog = () => {
  resetAddBlockDialogState()
  state.addBlockDialogOpen = true
}

const getThemeFromId = (themeId) => {
  const theme = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]?.[themeId]
  return theme?.name || 'Unknown'
}

const normalizePreviewType = (value) => {
  return value === 'dark' ? 'dark' : 'light'
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

const previewSurfaceClass = (value) => {
  return normalizePreviewType(value) === 'dark'
    ? 'preview-surface-dark'
    : 'preview-surface-light'
}

const loadingRender = (content) => {
  const safeContent = typeof content === 'string' ? content : ''
  return safeContent.replaceAll('{{loading}}', '').replaceAll('{{loaded}}', 'hidden')
}

const getTemplatePreviewKey = docId => `template:${String(docId || '')}`

const blockLoaded = (isLoading, docId) => {
  if (!isLoading && !state.blocksLoaded.includes(docId))
    state.blocksLoaded.push(docId)
}

const FILTER_STORAGE_KEY = 'edge.blocks.filters'
const NO_TAGS_FILTER_VALUE = '__no_tags__'
const BLOCK_TYPE_FILTER_OPTIONS = [
  { name: 'all', title: 'All Types' },
  { name: 'Page', title: 'Page' },
  { name: 'Post', title: 'Post' },
]

const restoreFilters = () => {
  if (typeof localStorage === 'undefined')
    return
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw)
      return
    const parsed = JSON.parse(raw)
    state.filter = parsed.filter ?? ''
    const savedTypeFilter = String(parsed.blockTypeFilter || 'all')
    state.blockTypeFilter = BLOCK_TYPE_FILTER_OPTIONS.some(option => option.name === savedTypeFilter)
      ? savedTypeFilter
      : 'all'
    state.picksFilter = Array.isArray(parsed.picksFilter) ? parsed.picksFilter : []
    state.themesFilter = Array.isArray(parsed.themesFilter) ? parsed.themesFilter : []
  }
  catch (err) {
    console.warn('Failed to restore block filters', err)
  }
}

const persistFilters = () => {
  if (typeof localStorage === 'undefined')
    return
  const payload = {
    filter: state.filter,
    blockTypeFilter: state.blockTypeFilter,
    picksFilter: state.picksFilter,
    themesFilter: state.themesFilter,
  }
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload))
}

watch(
  () => [state.filter, state.blockTypeFilter, state.picksFilter, state.themesFilter],
  persistFilters,
  { deep: true },
)

onBeforeMount(async () => {
  restoreFilters()
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/sites`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  state.mounted = true
})

const blockListPreviewCache = useState('edge-cms-block-list-post-preview-cache', () => ({}))

const sitesCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {}
})

const siteOptions = computed(() => {
  return Object.entries(sitesCollection.value)
    .filter(([siteId]) => String(siteId || '').trim() && siteId !== 'templates')
    .map(([siteId, siteDoc]) => ({ name: siteId, title: siteDoc?.name || siteId }))
    .sort((a, b) => a.title.localeCompare(b.title))
})

const blockPreviewSiteId = computed(() => {
  const selectedSite = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (selectedSite)
    return selectedSite

  return String(siteOptions.value?.[0]?.name || '').trim()
})

const loadPreviewRenderContext = async () => {
  const siteId = blockPreviewSiteId.value
  if (!siteId) {
    state.previewRenderContext = null
    return
  }

  const cacheKey = `${edgeGlobal.edgeState.currentOrganization}:${siteId}`
  const cached = blockListPreviewCache.value?.[cacheKey]
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
      blockListPreviewCache.value[cacheKey] = edgeGlobal.dupObject(firstPost)
      state.previewRenderContext = edgeGlobal.dupObject(firstPost)
      return
    }
  }
  catch (error) {
    console.error('Failed to load block list post preview context', error)
  }

  state.previewRenderContext = null
}

watch(
  [() => edgeGlobal.edgeState.currentOrganization, blockPreviewSiteId],
  async () => {
    state.blocksLoaded = []
    await loadPreviewRenderContext()
  },
  { immediate: true },
)

const tagOptions = computed(() => {
  const tagsSet = new Set()
  const blocks = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {}
  Object.values(blocks).forEach((block) => {
    if (Array.isArray(block.tags))
      block.tags.forEach(tag => tagsSet.add(tag))
  })
  const tagItems = Array.from(tagsSet).sort((a, b) => a.localeCompare(b)).map(tag => ({ name: tag, title: tag }))
  return [{ name: NO_TAGS_FILTER_VALUE, title: 'No Tags' }, ...tagItems]
})

const themeOptions = computed(() => {
  const themes = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
  return Object.entries(themes)
    .map(([id, theme]) => ({ name: id, title: theme.name || id }))
    .sort((a, b) => a.title.localeCompare(b.title))
})

watch(siteOptions, (options) => {
  const selectedSite = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  const hasSelectedSite = options.some(option => option.name === selectedSite)
  if (!selectedSite || !hasSelectedSite)
    edgeGlobal.edgeState.blockEditorSite = options?.[0]?.name || ''
}, { immediate: true, deep: true })

watch(themeOptions, (options) => {
  const selectedTheme = String(edgeGlobal.edgeState.blockEditorTheme || '').trim()
  const hasSelectedTheme = options.some(option => option.name === selectedTheme)
  if (!selectedTheme || !hasSelectedTheme)
    edgeGlobal.edgeState.blockEditorTheme = options?.[0]?.name || ''
}, { immediate: true, deep: true })

const themesCollection = computed(() => {
  return edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
})

const openBlocksExportDialog = (total) => {
  state.exportDialogOpen = true
  state.exportDialogStatus = 'running'
  state.exportDialogProcessed = 0
  state.exportDialogTotal = total
  state.exportDialogCurrentItem = ''
  state.exportCancelRequested = false
}

const syncBlocksExportProgress = ({ completed = 0, total = 0, suggestedName = '' } = {}) => {
  state.exportDialogOpen = true
  state.exportDialogProcessed = completed
  state.exportDialogTotal = total || state.exportDialogTotal
  state.exportDialogCurrentItem = suggestedName || ''
}

const finishBlocksExportDialog = (savedCount) => {
  state.exportDialogProcessed = savedCount
  state.exportDialogStatus = savedCount === state.exportDialogTotal ? 'complete' : 'canceled'
  state.exportCancelRequested = false
}

const cancelBlocksExport = () => {
  if (!state.exportingBlocks)
    return
  state.exportCancelRequested = true
}

const closeBlocksExportDialog = () => {
  if (state.exportingBlocks)
    return
  state.exportDialogOpen = false
}

const exportAllBlocks = async () => {
  if (state.exportingBlocks)
    return
  const selectedDocIds = [...state.selectedBlockDocIds].filter(docId => blocksCollection.value?.[docId])
  const files = selectedDocIds
    .sort((leftId, rightId) => String(leftId).localeCompare(String(rightId)))
    .map((docId) => ({
      suggestedName: `block-${docId}.json`,
      payload: {
        ...edgeGlobal.dupObject(blocksCollection.value?.[docId] || {}),
        docId,
      },
    }))

  if (!files.length) {
    edgeFirebase?.toast?.error?.('Select at least one block to export.')
    return
  }

  openBlocksExportDialog(files.length)
  state.exportingBlocks = true
  try {
    const savedCount = await saveJsonFiles(files, {
      onProgress: syncBlocksExportProgress,
      shouldCancel: () => state.exportCancelRequested,
    })
    finishBlocksExportDialog(savedCount)
    if (savedCount === files.length)
      edgeFirebase?.toast?.success?.(`Exported ${files.length} block${files.length === 1 ? '' : 's'}.`)
    else if (savedCount > 0)
      edgeFirebase?.toast?.success?.(`Exported ${savedCount} of ${files.length} blocks.`)
  }
  finally {
    state.exportingBlocks = false
    if (state.exportDialogStatus === 'running') {
      state.exportDialogStatus = 'canceled'
      state.exportCancelRequested = false
    }
  }
}

const parseHeadJson = (raw) => {
  if (!raw)
    return {}
  if (typeof raw === 'object' && !Array.isArray(raw))
    return raw
  if (typeof raw !== 'string')
    return {}
  try {
    return JSON.parse(raw)
  }
  catch {
    return {}
  }
}

const dedupeHeadEntries = (entries) => {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = JSON.stringify(entry || {})
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

const mergedThemeHeadObject = computed(() => {
  const themes = Object.values(themesCollection.value || {})
  const link = []
  const script = []
  const style = []
  const meta = []

  themes.forEach((themeDoc) => {
    const parsedHead = parseHeadJson(themeDoc?.headJSON)
    if (Array.isArray(parsedHead?.link))
      link.push(...parsedHead.link)
    if (Array.isArray(parsedHead?.script))
      script.push(...parsedHead.script)
    if (Array.isArray(parsedHead?.style))
      style.push(...parsedHead.style)
    if (Array.isArray(parsedHead?.meta))
      meta.push(...parsedHead.meta)
  })

  return {
    link: dedupeHeadEntries(link),
    script: dedupeHeadEntries(script),
    style: dedupeHeadEntries(style),
    meta: dedupeHeadEntries(meta),
  }
})

watch(mergedThemeHeadObject, (newHeadElements) => {
  emit('head', newHeadElements || {})
}, { immediate: true, deep: true })

const parsedThemesById = computed(() => {
  const parsed = {}
  for (const [themeId, themeDoc] of Object.entries(themesCollection.value || {})) {
    const rawTheme = themeDoc?.theme
    if (!rawTheme)
      continue
    const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
    if (typeof rawTheme === 'string') {
      try {
        const parsedTheme = JSON.parse(rawTheme)
        if (!parsedTheme || typeof parsedTheme !== 'object' || Array.isArray(parsedTheme))
          continue
        parsed[themeId] = { ...parsedTheme, extraCSS }
      }
      catch {
        continue
      }
      continue
    }
    if (typeof rawTheme === 'object' && !Array.isArray(rawTheme))
      parsed[themeId] = { ...rawTheme, extraCSS }
  }
  return parsed
})

const firstThemeId = computed(() => themeOptions.value?.[0]?.name || '')
const selectedPreviewThemeId = computed(() => String(
  edgeGlobal.edgeState.blockEditorTheme || firstThemeId.value || '',
).trim())
const selectedPreviewTheme = computed(() => {
  const selectedThemeId = selectedPreviewThemeId.value
  return parsedThemesById.value?.[selectedThemeId] || parsedThemesById.value?.[firstThemeId.value] || null
})
const getPreviewSelectionKey = (docId) => {
  const themeId = String(selectedPreviewThemeId.value || 'no-theme')
  const siteId = String(blockPreviewSiteId.value || 'no-site')
  return `${String(docId || 'preview')}:${siteId}:${themeId}`
}

const listFilters = computed(() => {
  const filters = []
  if (state.themesFilter.length)
    filters.push({ filterFields: ['themes'], value: state.themesFilter })
  return filters
})

const applyTagSelectionFilter = (items = []) => {
  const selectedFilters = Array.isArray(state.picksFilter) ? state.picksFilter : []
  if (!selectedFilters.length)
    return items

  const includeNoTags = selectedFilters.includes(NO_TAGS_FILTER_VALUE)
  const selectedTags = selectedFilters.filter(value => value !== NO_TAGS_FILTER_VALUE)

  return items.filter((item) => {
    const tags = Array.isArray(item?.tags) ? item.tags : []
    const hasNoTags = tags.length === 0
    const hasSelectedTag = selectedTags.length > 0
      ? tags.some(tag => selectedTags.includes(tag))
      : false

    if (includeNoTags && selectedTags.length > 0)
      return hasNoTags || hasSelectedTag
    if (includeNoTags)
      return hasNoTags
    return hasSelectedTag
  })
}

const applyTypeSelectionFilter = (items = []) => {
  const selectedType = String(state.blockTypeFilter || 'all')
  if (selectedType === 'all')
    return items

  return items.filter((item) => {
    const blockTypes = normalizeBlockTypes(item?.type)
    return blockTypes.includes(selectedType)
  })
}

const applyListSelectionFilters = (items = []) => {
  return applyTagSelectionFilter(applyTypeSelectionFilter(items))
}

const blockCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/blocks`)
const blocksCollection = computed(() => edgeFirebase.data?.[blockCollectionPath.value] || {})
const visibleBlockItems = computed(() => {
  const query = String(state.filter || '').trim().toLowerCase()
  const items = Object.entries(blocksCollection.value || {}).map(([docId, doc]) => ({
    docId,
    ...(doc || {}),
  }))
  const filteredByQuery = !query
    ? items
    : items.filter(item => [item?.name, item?.docId].some(value => String(value || '').toLowerCase().includes(query)))
  return applyListSelectionFilters(filteredByQuery)
})
const selectedBlockSet = computed(() => new Set(state.selectedBlockDocIds))
const selectedBlockCount = computed(() => state.selectedBlockDocIds.length)
const addBlockTemplateItems = computed(() => [blankBlockTemplate, ...INITIAL_BLOCK_TEMPLATES])
const addExistingBlockItems = computed(() => {
  return Object.entries(blocksCollection.value || {})
    .map(([docId, doc]) => ({ docId, ...(doc || {}) }))
    .sort((left, right) => {
      const leftName = String(left?.name || left?.docId || '').trim()
      const rightName = String(right?.name || right?.docId || '').trim()
      return leftName.localeCompare(rightName)
    })
})
const selectedInitBlockTemplate = computed(() => {
  return addBlockTemplateItems.value.find(template => template.docId === state.selectedInitBlockDocId) || blankBlockTemplate
})
const selectedExistingBlock = computed(() => {
  return addExistingBlockItems.value.find(block => block.docId === state.selectedExistingBlockDocId) || null
})
const normalizedNewBlockName = computed(() => String(state.newBlockName || '').trim())
const canCreateBlock = computed(() => {
  if (!normalizedNewBlockName.value || state.creatingBlock)
    return false
  if (state.addBlockTab === 'existing')
    return !!selectedExistingBlock.value
  return true
})

const normalizeDocId = value => String(value || '').trim()

const isBlockSelected = docId => selectedBlockSet.value.has(normalizeDocId(docId))

const isAddBlockTemplateSelected = docId => state.selectedInitBlockDocId === docId

const selectAddBlockTemplate = (docId) => {
  state.selectedInitBlockDocId = String(docId || BLANK_BLOCK_TEMPLATE_ID)
}

const isAddExistingBlockSelected = docId => state.selectedExistingBlockDocId === docId

const selectAddExistingBlock = (docId) => {
  state.selectedExistingBlockDocId = String(docId || '')
}

const setBlockSelection = (docId, checked) => {
  const normalizedDocId = normalizeDocId(docId)
  if (!normalizedDocId)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  if (shouldSelect) {
    if (!selectedBlockSet.value.has(normalizedDocId))
      state.selectedBlockDocIds = [...state.selectedBlockDocIds, normalizedDocId]
    return
  }
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(id => id !== normalizedDocId)
}

const getVisibleSelectionState = (visibleItems = []) => {
  if (!visibleItems.length)
    return false
  let selectedVisibleCount = 0
  for (const item of visibleItems) {
    if (isBlockSelected(item?.docId))
      selectedVisibleCount += 1
  }
  if (selectedVisibleCount === 0)
    return false
  if (selectedVisibleCount === visibleItems.length)
    return true
  return 'indeterminate'
}

const toggleVisibleBlockSelection = (visibleItems = [], checked) => {
  if (!visibleItems.length)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  const visibleDocIds = visibleItems.map(item => normalizeDocId(item?.docId)).filter(Boolean)
  if (shouldSelect) {
    state.selectedBlockDocIds = [...new Set([...state.selectedBlockDocIds, ...visibleDocIds])]
    return
  }
  const visibleDocIdSet = new Set(visibleDocIds)
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(id => !visibleDocIdSet.has(id))
}

const clearSelectedBlocks = () => {
  state.selectedBlockDocIds = []
}

const openBulkDeleteDialog = () => {
  if (!selectedBlockCount.value)
    return
  state.bulkDeleteDialogOpen = true
}

const bulkDeleteAction = async () => {
  if (state.bulkDeleting || !selectedBlockCount.value) {
    state.bulkDeleteDialogOpen = false
    return
  }

  state.bulkDeleting = true
  const selectedDocIds = [...state.selectedBlockDocIds]
  const blocks = blocksCollection.value || {}
  const failedDocIds = []
  let deletedCount = 0

  try {
    for (const docId of selectedDocIds) {
      if (!blocks[docId])
        continue
      try {
        await edgeFirebase.removeDoc(blockCollectionPath.value, docId)
        deletedCount += 1
      }
      catch (error) {
        failedDocIds.push(docId)
        console.error(`Failed to delete block "${docId}"`, error)
      }
    }

    state.selectedBlockDocIds = failedDocIds
    state.bulkDeleteDialogOpen = false

    if (deletedCount)
      edgeFirebase?.toast?.success?.(`Deleted ${deletedCount} block${deletedCount === 1 ? '' : 's'}.`)
    if (failedDocIds.length)
      edgeFirebase?.toast?.error?.(`Failed to delete ${failedDocIds.length} block${failedDocIds.length === 1 ? '' : 's'}.`)
  }
  finally {
    state.bulkDeleting = false
  }
}

watch(blocksCollection, (collection) => {
  const validDocIds = new Set(Object.keys(collection || {}))
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(docId => validDocIds.has(docId))
}, { deep: true })

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
    throw new Error('Invalid JSON payload. Expected an object.')

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

const getBlockDocDefaults = () => getDocDefaultsFromSchema(blockNewDocSchema.value || {})

const slugifyBlockDocId = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const makeUniqueBlockDocIdFromName = (name, docsMap = {}) => {
  const baseDocId = slugifyBlockDocId(name) || 'block'
  let nextDocId = baseDocId
  let suffix = 2
  while (docsMap[nextDocId]) {
    nextDocId = `${baseDocId}-${suffix}`
    suffix += 1
  }
  return nextDocId
}

watch(addExistingBlockItems, (items) => {
  const selectedDocId = String(state.selectedExistingBlockDocId || '').trim()
  const hasSelectedDocId = items.some(item => item.docId === selectedDocId)
  if (!selectedDocId || !hasSelectedDocId)
    state.selectedExistingBlockDocId = items?.[0]?.docId || ''
}, { immediate: true, deep: true })

const createBlockFromTemplate = async () => {
  if (!canCreateBlock.value)
    return

  state.creatingBlock = true
  const nextBlockName = normalizedNewBlockName.value
  const nextDocId = makeUniqueBlockDocIdFromName(nextBlockName, blocksCollection.value || {})
  const shouldDuplicateExistingBlock = state.addBlockTab === 'existing' && !!selectedExistingBlock.value
  const payload = shouldDuplicateExistingBlock
    ? {
        ...getBlockDocDefaults(),
        ...edgeGlobal.dupObject(selectedExistingBlock.value),
        docId: nextDocId,
        name: nextBlockName,
      }
    : {
        ...getBlockDocDefaults(),
        docId: nextDocId,
        name: nextBlockName,
        content: typeof selectedInitBlockTemplate.value?.content === 'string' ? selectedInitBlockTemplate.value.content : '',
      }

  try {
    await edgeFirebase.storeDoc(blockCollectionPath.value, payload, nextDocId)
    state.addBlockDialogOpen = false
    await router.push(`/app/dashboard/blocks/${nextDocId}`)
  }
  catch (error) {
    console.error(`Failed to create block "${nextDocId}"`, error)
    edgeFirebase?.toast?.error?.('Failed to create block.')
  }
  finally {
    state.creatingBlock = false
  }
}

const validateImportedBlockDoc = (doc) => {
  if (!isPlainObject(doc))
    throw new Error('Invalid block document. Expected an object.')

  const requiredKeys = Object.keys(blockNewDocSchema.value || {})
    .filter(key => !OPTIONAL_BLOCK_IMPORT_KEYS.has(key))
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(`Missing required block key(s): ${missing.join(', ')}`)

  return doc
}

const validateImportedBlockTypes = (doc) => {
  if (!Object.prototype.hasOwnProperty.call(doc || {}, 'type')) {
    doc.type = ['Page']
    return doc
  }

  const normalizedTypes = normalizeBlockTypes(doc.type, { fallbackToPage: false })
  if (!normalizedTypes.length)
    throw new Error('Invalid "type" value. Use "Page", "Post", or both.')

  doc.type = normalizedTypes
  return doc
}

const validateImportedBlockThemes = (doc) => {
  if (Object.prototype.hasOwnProperty.call(doc || {}, 'themes') && !Array.isArray(doc?.themes)) {
    throw new Error('Invalid "themes" value. Expected an array of theme docIds.')
  }

  const importedThemes = Array.isArray(doc?.themes) ? doc.themes : []
  if (!importedThemes.length)
    return doc

  const orgThemes = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
  const missingThemeIds = []
  let hasEmptyThemeId = false
  const normalizedThemes = []
  for (const themeId of importedThemes) {
    const normalizedThemeId = String(themeId || '').trim()
    if (!normalizedThemeId) {
      hasEmptyThemeId = true
      continue
    }
    if (!orgThemes[normalizedThemeId]) {
      missingThemeIds.push(normalizedThemeId)
      continue
    }
    normalizedThemes.push(normalizedThemeId)
  }

  if (hasEmptyThemeId || missingThemeIds.length) {
    const uniqueMissingThemeIds = [...new Set(missingThemeIds)]
    console.warn('[BlocksManager] Imported block contains unavailable theme ids. Importing with no theme.', {
      docId: String(doc?.docId || ''),
      missingThemeIds: uniqueMissingThemeIds,
      hasEmptyThemeId,
    })
    doc.themes = []
    return doc
  }
  doc.themes = [...new Set(normalizedThemes)]
  return doc
}

const makeUniqueDocId = (baseDocId, docsMap = {}) => {
  const cleanBase = String(baseDocId || '').trim() || 'block'
  let nextDocId = `${cleanBase}-copy`
  let suffix = 2
  while (docsMap[nextDocId]) {
    nextDocId = `${cleanBase}-copy-${suffix}`
    suffix += 1
  }
  return nextDocId
}

const requestBlockImportDocId = (initialValue = '') => {
  state.importDocIdValue = String(initialValue || '')
  state.importDocIdDialogOpen = true
  return new Promise((resolve) => {
    blockImportDocIdResolver.value = resolve
  })
}

const resolveBlockImportDocId = (value = '') => {
  const resolver = blockImportDocIdResolver.value
  blockImportDocIdResolver.value = null
  state.importDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestBlockImportConflict = (docId) => {
  state.importConflictDocId = String(docId || '')
  state.importConflictDialogOpen = true
  return new Promise((resolve) => {
    blockImportConflictResolver.value = resolve
  })
}

const resolveBlockImportConflict = (action = 'cancel') => {
  const resolver = blockImportConflictResolver.value
  blockImportConflictResolver.value = null
  state.importConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

watch(() => state.importDocIdDialogOpen, (open) => {
  if (!open && blockImportDocIdResolver.value) {
    const resolver = blockImportDocIdResolver.value
    blockImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importConflictDialogOpen, (open) => {
  if (!open && blockImportConflictResolver.value) {
    const resolver = blockImportConflictResolver.value
    blockImportConflictResolver.value = null
    resolver('cancel')
  }
})

const getImportDocId = async (incomingDoc, fallbackDocId = '') => {
  let nextDocId = String(incomingDoc?.docId || '').trim()
  if (!nextDocId)
    nextDocId = await requestBlockImportDocId(fallbackDocId)
  if (!nextDocId)
    throw new Error('Import canceled. A docId is required.')
  if (nextDocId.includes('/'))
    throw new Error('docId cannot include "/".')
  return nextDocId
}

const openImportErrorDialog = (message) => {
  state.importErrorMessage = String(message || DEFAULT_BLOCK_IMPORT_ERROR_MESSAGE)
  state.importErrorDialogOpen = true
}

const getBlockImportFailureReason = (error, message) => {
  if (error instanceof SyntaxError)
    return `Invalid JSON syntax: ${String(error?.message || 'Unable to parse JSON.')}`
  if (/^Import canceled\./i.test(message))
    return message
  return message
}

const logBlockImportFailure = (file, error, message) => {
  const fileName = String(file?.name || 'unknown-file')
  const reason = getBlockImportFailureReason(error, message)
  console.error(`[BlocksManager] Block import failed for "${fileName}". Reason: ${reason}`, {
    fileName,
    reason,
    errorMessage: message,
    error,
  })
}

const triggerBlockImport = () => {
  blockImportInputRef.value?.click()
}

const importSingleBlockFile = async (file, existingBlocks = {}) => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = validateImportedBlockThemes(validateImportedBlockTypes(validateImportedBlockDoc(normalizeImportedDoc(parsed, ''))))
  const incomingDocId = await getImportDocId(importedDoc, '')
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingBlocks[targetDocId]) {
    const decision = await requestBlockImportConflict(targetDocId)
    if (decision === 'cancel')
      return
    if (decision === 'new') {
      targetDocId = makeUniqueDocId(targetDocId, existingBlocks)
      if (typeof importedDoc.name === 'string' && importedDoc.name.trim() && !/\(Copy\)$/i.test(importedDoc.name.trim()))
        importedDoc.name = `${importedDoc.name} (Copy)`
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const payload = { ...getBlockDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(blockCollectionPath.value, payload, targetDocId)
  existingBlocks[targetDocId] = payload

  if (importDecision === 'overwrite')
    edgeFirebase?.toast?.success?.(`Overwrote block "${targetDocId}".`)
  else if (importDecision === 'new')
    edgeFirebase?.toast?.success?.(`Imported block as new "${targetDocId}".`)
  else
    edgeFirebase?.toast?.success?.(`Imported block "${targetDocId}".`)
}

const handleBlockImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingJson = true
  const existingBlocks = { ...(blocksCollection.value || {}) }
  try {
    const themesCollectionPath = `organizations/${edgeGlobal.edgeState.currentOrganization}/themes`
    if (!edgeFirebase.data?.[themesCollectionPath])
      await edgeFirebase.startSnapshot(themesCollectionPath)

    for (const file of files) {
      try {
        await importSingleBlockFile(file, existingBlocks)
      }
      catch (error) {
        const message = error?.message || DEFAULT_BLOCK_IMPORT_ERROR_MESSAGE
        logBlockImportFailure(file, error, message)
        if (/^Import canceled\./i.test(message))
          continue
        openImportErrorDialog(getBlockImportFailureReason(error, message))
      }
    }
  }
  finally {
    state.importingJson = false
    if (input)
      input.value = ''
  }
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-dashboard
      :filter="state.filter"
      :filters="listFilters"
      collection="blocks"
      class="pt-0 flex-1"
    >
      <template #header-start="slotProps">
        <component :is="slotProps.icon" class="mr-2" />
        Blocks
      </template>
      <template #header-center>
        <edge-shad-form class="w-full">
          <div class="w-full px-4 md:px-6 flex flex-col gap-2 md:flex-row md:items-center">
            <div class="md:flex-1 md:min-w-0">
              <edge-shad-select
                v-model="edgeGlobal.edgeState.blockEditorTheme"
                name="previewTheme"
                :items="themeOptions"
                placeholder="Preview theme"
                class="w-full"
              />
            </div>
            <div class="md:flex-1 md:min-w-0">
              <edge-shad-select
                v-model="edgeGlobal.edgeState.blockEditorSite"
                name="previewSite"
                :items="siteOptions"
                placeholder="Preview site"
                class="w-full"
              />
            </div>
          </div>
        </edge-shad-form>
      </template>
      <template #header-end>
        <div class="flex items-center gap-2">
          <input
            ref="blockImportInputRef"
            type="file"
            multiple
            accept=".json,application/json"
            class="hidden"
            @change="handleBlockImport"
          >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <edge-shad-button
                type="button"
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Block Actions"
                aria-label="Block Actions"
              >
                <MoreHorizontal class="h-4 w-4" />
              </edge-shad-button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem :disabled="state.importingJson" @click="triggerBlockImport">
                <Loader2 v-if="state.importingJson" class="h-4 w-4 animate-spin" />
                <Upload v-else class="h-4 w-4" />
                <span>Import Blocks</span>
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="state.exportingBlocks || selectedBlockCount === 0" @click="exportAllBlocks">
                <Loader2 v-if="state.exportingBlocks" class="h-4 w-4 animate-spin" />
                <Download v-else class="h-4 w-4" />
                <span>{{ state.exportingBlocks ? 'Exporting Selected...' : 'Export Selected' }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <edge-shad-button
            class="uppercase bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            @click="openAddBlockDialog"
          >
            Add Block
          </edge-shad-button>
        </div>
      </template>
      <template #list-header>
        <div class="w-full mt-4 mx-0 rounded-md border border-slate-300/70 bg-slate-100/95 dark:border-slate-700 dark:bg-slate-900/95 px-3 py-2 space-y-2 backdrop-blur-sm shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Checkbox
                :model-value="getVisibleSelectionState(visibleBlockItems)"
                aria-label="Select visible blocks"
                class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                @click.stop
                @update:model-value="toggleVisibleBlockSelection(visibleBlockItems, $event)"
              />
              <span class="text-xs text-slate-600 dark:text-slate-300">
                Select visible ({{ visibleBlockItems.length }})
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-600 dark:text-slate-300">{{ selectedBlockCount }} selected</span>
              <edge-shad-button
                variant="outline"
                class="h-8 text-xs"
                :disabled="selectedBlockCount === 0"
                @click="clearSelectedBlocks"
              >
                Clear
              </edge-shad-button>
              <edge-shad-button
                variant="destructive"
                class="h-8 text-xs text-white"
                :disabled="selectedBlockCount === 0"
                @click="openBulkDeleteDialog"
              >
                Delete selected
              </edge-shad-button>
            </div>
          </div>
          <div class="flex flex-col gap-2 md:flex-row md:items-center">
            <div class="grow">
              <edge-shad-input
                v-model="state.filter"
                name="filter"
                placeholder="Search blocks..."
                class="w-full"
              />
            </div>
            <div class="md:w-[150px]">
              <edge-shad-select
                v-model="state.blockTypeFilter"
                name="blockTypeFilter"
                :items="BLOCK_TYPE_FILTER_OPTIONS"
                placeholder="Type"
                class="w-full"
              />
            </div>
            <div class="md:min-w-[170px]">
              <edge-shad-select-tags
                v-model="state.picksFilter"
                :items="tagOptions"
                name="tags"
                placeholder="Filter tags"
              />
            </div>
            <div class="md:min-w-[170px]">
              <edge-shad-select-tags
                v-model="state.themesFilter"
                :items="themeOptions"
                name="themes"
                placeholder="Filter themes"
              />
            </div>
          </div>
        </div>
      </template>
      <template #list>
        <div class="w-full pt-2 space-y-3 h-[calc(100vh-310px)]">
          <div
            class="grid gap-4 w-full"
            style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));"
          >
            <div
              v-for="item in visibleBlockItems"
              :key="item.docId"
              role="button"
              tabindex="0"
              class="w-full h-full"
              @click="router.push(`/app/dashboard/blocks/${item.docId}`)"
              @keyup.enter="router.push(`/app/dashboard/blocks/${item.docId}`)"
            >
              <Card
                class="h-full cursor-pointer border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50 hover:border-slate-500 hover:shadow-[0_22px_55px_-24px_rgba(0,0,0,0.4)] transition"
                :class="isBlockSelected(item.docId) ? 'border-slate-700 ring-2 ring-slate-500/60 dark:border-slate-200 dark:ring-slate-300/50' : 'border-slate-200/60 dark:border-slate-800'"
              >
                <CardContent class="flex flex-col gap-1 p-4 sm:p-5">
                  <div class="flex items-start gap-3">
                    <div class="pt-1" @click.stop>
                      <Checkbox
                        :model-value="isBlockSelected(item.docId)"
                        :aria-label="`Select block ${item.name || item.docId}`"
                        class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                        @click.stop
                        @update:model-value="setBlockSelection(item.docId, $event)"
                      />
                    </div>
                    <p class="text-lg font-semibold leading-snug line-clamp-2 text-slate-900 dark:text-slate-100 flex-1">
                      {{ item.name }}
                    </p>
                    <edge-shad-button
                      size="icon"
                      variant="ghost"
                      class="h-8 w-8 text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                      @click.stop="slotProps.deleteItem(item.docId)"
                    >
                      <Trash class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                  <div v-if="item.content" class="block-preview" :class="previewSurfaceClass(item.previewType)">
                    <div class="scale-wrapper">
                      <div class="scale-inner scale p-4 block-list-preview-content">
                        <edge-cms-block-api
                          :key="getPreviewSelectionKey(item.docId)"
                          :site-id="blockPreviewSiteId"
                          :content="item.content"
                          :values="item.values"
                          :meta="item.meta"
                          :theme="selectedPreviewTheme"
                          :render-context="state.previewRenderContext"
                          @pending="blockLoaded($event, item.docId)"
                        />
                        <edge-cms-block-render
                          v-if="!state.blocksLoaded.includes(item.docId)"
                          :key="`${getPreviewSelectionKey(item.docId)}:fallback`"
                          :content="loadingRender(item.content)"
                          :values="item.values"
                          :meta="item.meta"
                          :theme="selectedPreviewTheme"
                          :render-context="state.previewRenderContext"
                        />
                      </div>
                    </div>
                    <div class="preview-overlay" />
                  </div>
                  <div v-else class="block-preview-empty" :class="previewSurfaceClass(item.previewType)">
                    Preview unavailable for this block.
                  </div>
                  <div class="flex flex-wrap items-center gap-1 text-[11px] text-slate-300 uppercase tracking-wide overflow-hidden">
                    <edge-chip
                      v-for="tag in item.tags?.slice(0, 3) ?? []"
                      :key="tag"
                      class="bg-slate-700 text-white px-2 py-0.5 text-[10px] dark:bg-slate-200 dark:text-slate-900"
                    >
                      {{ tag }}
                    </edge-chip>
                    <span v-if="item.tags?.length > 3" class="text-white/60">+{{ item.tags.length - 3 }}</span>
                    <edge-chip
                      v-for="theme in item.themes?.slice(0, 2) ?? []"
                      :key="theme"
                      class="bg-slate-800 text-white px-2 py-0.5 text-[10px]"
                    >
                      {{ getThemeFromId(theme) }}
                    </edge-chip>
                    <span v-if="item.themes?.length > 2" class="text-white/60">+{{ item.themes.length - 2 }}</span>
                    <span
                      v-if="!(item.tags?.length) && !(item.themes?.length)"
                      class="text-slate-500 lowercase"
                    >
                      none
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </template>
    </edge-dashboard>
    <edge-cms-json-export-progress-dialog
      v-model="state.exportDialogOpen"
      title="Exporting Blocks"
      :status="state.exportDialogStatus"
      :processed="state.exportDialogProcessed"
      :total="state.exportDialogTotal"
      :current-item="state.exportDialogCurrentItem"
      @cancel="cancelBlocksExport"
      @update:model-value="closeBlocksExportDialog"
    />
    <edge-shad-dialog v-model="state.importDocIdDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Enter Block Doc ID
          </DialogTitle>
          <DialogDescription>
            This JSON file does not include a <code>docId</code>. Enter the doc ID you want to import into.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input
          v-model="state.importDocIdValue"
          name="block-import-doc-id"
          label="Doc ID"
          placeholder="example-block-id"
        />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveBlockImportDocId('')">
            Cancel
          </edge-shad-button>
          <edge-shad-button @click="resolveBlockImportDocId(state.importDocIdValue)">
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importConflictDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Block Already Exists
          </DialogTitle>
          <DialogDescription>
            <code>{{ state.importConflictDocId }}</code> already exists. Choose to overwrite it or import as a new block.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveBlockImportConflict('cancel')">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="outline" @click="resolveBlockImportConflict('new')">
            Add As New
          </edge-shad-button>
          <edge-shad-button @click="resolveBlockImportConflict('overwrite')">
            Overwrite
          </edge-shad-button>
        </DialogFooter>
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
    <edge-shad-dialog v-model="state.addBlockDialogOpen">
      <DialogContent class="pt-6 w-full max-w-6xl h-[90vh] flex flex-col">
        <form class="flex h-full flex-col" @submit.prevent="createBlockFromTemplate">
          <DialogHeader class="pb-2">
            <DialogTitle class="text-left">
              Add Block
            </DialogTitle>
            <DialogDescription>
              Choose a starter block or begin blank, then give it a name to create it.
            </DialogDescription>
          </DialogHeader>
          <div class="flex flex-1 flex-col overflow-hidden">
            <div class="space-y-4">
              <edge-shad-input
                v-model="state.newBlockName"
                name="name"
                label="Block Name"
                placeholder="Enter block name"
              />
            </div>
            <Tabs v-model="state.addBlockTab" class="mt-4 flex min-h-0 flex-1 flex-col">
              <TabsList class="grid w-full grid-cols-2 rounded-sm border border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800">
                <TabsTrigger value="templates" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                  Templates
                </TabsTrigger>
                <TabsTrigger value="existing" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                  Existing
                </TabsTrigger>
              </TabsList>

              <TabsContent value="templates" class="mt-4 flex min-h-0 flex-1 flex-col">
                <edge-button-divider class="mb-4">
                  <span class="text-xs text-muted-foreground !nowrap text-center">Select Template</span>
                </edge-button-divider>
                <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div class="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
                    <button
                      v-for="template in addBlockTemplateItems"
                      :key="template.docId"
                      type="button"
                      class="rounded-lg border bg-card p-3 text-left transition focus:outline-none focus-visible:ring-2"
                      :class="isAddBlockTemplateSelected(template.docId) ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
                      :aria-pressed="isAddBlockTemplateSelected(template.docId)"
                      @click="selectAddBlockTemplate(template.docId)"
                    >
                      <div class="flex items-center justify-between gap-2 pb-3">
                        <span class="truncate font-semibold">{{ template.name }}</span>
                        <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {{ template.docId === BLANK_BLOCK_TEMPLATE_ID ? 'Blank' : 'Template' }}
                        </span>
                      </div>
                      <div v-if="template.content" class="block-preview" :class="previewSurfaceClass(template.previewType)">
                        <div class="scale-wrapper">
                          <div class="scale-inner scale p-4 block-list-preview-content">
                            <edge-cms-block-api
                              :key="getPreviewSelectionKey(getTemplatePreviewKey(template.docId))"
                              :site-id="blockPreviewSiteId"
                              :content="template.content"
                              :values="template.values"
                              :meta="template.meta"
                              :theme="selectedPreviewTheme"
                              :render-context="state.previewRenderContext"
                              @pending="blockLoaded($event, getTemplatePreviewKey(template.docId))"
                            />
                            <edge-cms-block-render
                              v-if="!state.blocksLoaded.includes(getTemplatePreviewKey(template.docId))"
                              :key="`${getPreviewSelectionKey(getTemplatePreviewKey(template.docId))}:fallback`"
                              :content="loadingRender(template.content)"
                              :values="template.values"
                              :meta="template.meta"
                              :theme="selectedPreviewTheme"
                              :render-context="state.previewRenderContext"
                            />
                          </div>
                        </div>
                        <div class="preview-overlay" />
                      </div>
                      <div v-else class="block-preview-empty" :class="previewSurfaceClass(template.previewType)">
                        Start from scratch.
                      </div>
                    </button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="existing" class="mt-4 flex min-h-0 flex-1 flex-col">
                <edge-button-divider class="mb-4">
                  <span class="text-xs text-muted-foreground !nowrap text-center">Duplicate Existing Block</span>
                </edge-button-divider>
                <div v-if="addExistingBlockItems.length" class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div class="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
                    <button
                      v-for="block in addExistingBlockItems"
                      :key="`existing-${block.docId}`"
                      type="button"
                      class="rounded-lg border bg-card p-3 text-left transition focus:outline-none focus-visible:ring-2"
                      :class="isAddExistingBlockSelected(block.docId) ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
                      :aria-pressed="isAddExistingBlockSelected(block.docId)"
                      @click="selectAddExistingBlock(block.docId)"
                    >
                      <div class="flex items-center justify-between gap-2 pb-3">
                        <span class="truncate font-semibold">{{ block.name || block.docId }}</span>
                        <span class="text-[10px] uppercase tracking-wide text-muted-foreground">Duplicate</span>
                      </div>
                      <div v-if="block.content" class="block-preview" :class="previewSurfaceClass(block.previewType)">
                        <div class="scale-wrapper">
                          <div class="scale-inner scale p-4 block-list-preview-content">
                            <edge-cms-block-api
                              :key="`${getPreviewSelectionKey(block.docId)}:existing-picker`"
                              :site-id="blockPreviewSiteId"
                              :content="block.content"
                              :values="block.values"
                              :meta="block.meta"
                              :theme="selectedPreviewTheme"
                              :render-context="state.previewRenderContext"
                              @pending="blockLoaded($event, `existing:${block.docId}`)"
                            />
                            <edge-cms-block-render
                              v-if="!state.blocksLoaded.includes(`existing:${block.docId}`)"
                              :key="`${getPreviewSelectionKey(block.docId)}:existing-picker:fallback`"
                              :content="loadingRender(block.content)"
                              :values="block.values"
                              :meta="block.meta"
                              :theme="selectedPreviewTheme"
                              :render-context="state.previewRenderContext"
                            />
                          </div>
                        </div>
                        <div class="preview-overlay" />
                      </div>
                      <div v-else class="block-preview-empty" :class="previewSurfaceClass(block.previewType)">
                        Preview unavailable for this block.
                      </div>
                    </button>
                  </div>
                </div>
                <div v-else class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  No existing blocks yet. Create one from Templates first.
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter class="pt-4">
            <edge-shad-button type="button" variant="destructive" @click="state.addBlockDialogOpen = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button type="submit" class="bg-slate-800 text-white hover:bg-slate-400" :disabled="!canCreateBlock">
              <Loader2 v-if="state.creatingBlock" class="mr-2 h-4 w-4 animate-spin" />
              Create Block
            </edge-shad-button>
          </DialogFooter>
        </form>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.bulkDeleteDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Delete Selected Blocks?
          </DialogTitle>
          <DialogDescription class="text-left">
            This action cannot be undone. {{ selectedBlockCount }} block{{ selectedBlockCount === 1 ? '' : 's' }} will be permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button
            class="text-white bg-slate-800 hover:bg-slate-400"
            :disabled="state.bulkDeleting"
            @click="state.bulkDeleteDialogOpen = false"
          >
            Cancel
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            class="text-white w-full"
            :disabled="state.bulkDeleting || selectedBlockCount === 0"
            @click="bulkDeleteAction"
          >
            <Loader2 v-if="state.bulkDeleting" class="h-4 w-4 animate-spin" />
            <span v-else>Delete Selected</span>
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style scoped>
.block-preview {
  position: relative;
  height: 220px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: transparent;
  overflow: hidden;
  box-shadow: none;
}

.block-preview.preview-surface-light {
  background: #ffffff;
  color: #0f172a;
  border-color: rgba(15, 23, 42, 0.15);
}

.block-preview.preview-surface-dark {
  background: #020617;
  color: #f8fafc;
  border-color: rgba(248, 250, 252, 0.18);
}

.block-preview-empty {
  height: 220px;
  border-radius: 14px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  background: linear-gradient(135deg, rgba(10, 14, 26, 0.65), rgba(17, 24, 39, 0.5));
  color: rgba(255, 255, 255, 0.6);
  display: grid;
  place-items: center;
  font-size: 13px;
  letter-spacing: 0.01em;
}

.block-preview-empty.preview-surface-light {
  border-color: rgba(15, 23, 42, 0.18);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(241, 245, 249, 0.95));
  color: rgba(15, 23, 42, 0.72);
}

.block-preview-empty.preview-surface-dark {
  border-color: rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(10, 14, 26, 0.65), rgba(17, 24, 39, 0.5));
  color: rgba(255, 255, 255, 0.6);
}

.preview-overlay {
  display: none;
}

.scale-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.scale-inner {
  transform-origin: top left;
  display: inline-block;
  min-width: 100%;
}

.block-list-preview-content {
  pointer-events: none;
}

.scale {
  transform: scale(0.25);
  width: 400%;
}
</style>
