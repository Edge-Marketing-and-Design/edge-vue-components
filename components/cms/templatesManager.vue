<script setup>
import { Download, File, FilePenLine, FileStack, Loader2, MoreHorizontal, Plus, Trash2, Upload } from 'lucide-vue-next'

const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
const { saveJsonFiles } = useJsonFileSave()
const router = useRouter()
const { buildPageStructuredData } = useStructuredDataTemplates()

const state = reactive({
  mounted: false,
  templatePageFilter: '',
  templatePageTypeFilter: 'all',
  templatePageTags: [],
  templatePageThemes: [],
  selectedTemplateDocIds: [],
  bulkDeleteDialogOpen: false,
  bulkDeleting: false,
  exportingTemplates: false,
  exportDialogOpen: false,
  exportDialogStatus: 'idle',
  exportDialogProcessed: 0,
  exportDialogTotal: 0,
  exportDialogCurrentItem: '',
  exportCancelRequested: false,
  templatePageRenderContext: null,
  newTemplateDialogOpen: false,
  addTemplateTab: 'blank',
  selectedExistingTemplateId: '',
  creatingTemplateFromExisting: false,
  importingPages: false,
  importPageDocIdDialogOpen: false,
  importPageDocIdValue: '',
  importPageConflictDialogOpen: false,
  importPageConflictDocId: '',
  importPageErrorDialogOpen: false,
  importPageErrorMessage: '',
})

const pageImportInputRef = ref(null)
const pageImportDocIdResolver = ref(null)
const pageImportConflictResolver = ref(null)

const pageNewDocSchema = {
  name: { value: '' },
  content: { value: [] },
  postContent: { value: [] },
  structure: { value: [] },
  postStructure: { value: [] },
  metaTitle: { value: '' },
  metaDescription: { value: '' },
  postMetaTitle: { value: '' },
  postMetaDescription: { value: '' },
  structuredData: { value: buildPageStructuredData() },
  postStructuredData: { value: '' },
  post: { value: false },
  tags: { value: [] },
  allowedThemes: { value: [] },
}

const TEMPLATE_PAGE_TYPE_OPTIONS = [
  { name: 'all', title: 'All Types' },
  { name: 'Page', title: 'Page' },
  { name: 'Post', title: 'Post' },
]
const NO_TAGS_FILTER_VALUE = '__no_tags__'

const INVALID_PAGE_IMPORT_MESSAGE = 'Invalid file. Please import a valid page file.'

const themeCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {}
})

const parseThemeDoc = (themeDoc) => {
  const rawTheme = themeDoc?.theme
  if (!rawTheme)
    return null
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  try {
    const parsed = typeof rawTheme === 'string' ? JSON.parse(rawTheme) : rawTheme
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    return { ...parsed, extraCSS }
  }
  catch {
    return null
  }
}

const getThemePreviewVersion = (themeDoc) => {
  if (!themeDoc)
    return 'no-theme-data'
  const rawTheme = typeof themeDoc?.theme === 'string'
    ? themeDoc.theme
    : JSON.stringify(themeDoc?.theme || {})
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  return `${rawTheme.length}:${extraCSS.length}`
}

const themeOptions = computed(() => {
  return Object.entries(themeCollection.value)
    .map(([name, doc]) => ({
      name,
      title: doc?.name || name,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
})

const themeOptionsMap = computed(() => {
  const map = new Map()
  for (const option of themeOptions.value)
    map.set(option.name, option)
  return map
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

const selectedTemplatePreviewSiteId = computed(() => {
  const selectedSiteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  if (selectedSiteId)
    return selectedSiteId
  return String(previewSiteOptions.value?.[0]?.name || '').trim()
})

const selectedTemplatePreviewThemeId = computed(() => {
  const selectedThemeId = String(edgeGlobal.edgeState.blockEditorTheme || '').trim()
  if (selectedThemeId)
    return selectedThemeId
  return String(themeOptions.value?.[0]?.name || '').trim()
})

const selectedTemplatePreviewTheme = computed(() => {
  const themeId = selectedTemplatePreviewThemeId.value
  if (!themeId)
    return null
  return parseThemeDoc(themeCollection.value?.[themeId]) || null
})
const selectedTemplatePreviewThemeReady = computed(() => {
  return !selectedTemplatePreviewThemeId.value || !!selectedTemplatePreviewTheme.value
})

const templatePagesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)
const templatePagesCollection = computed(() => edgeFirebase.data?.[templatePagesCollectionPath.value] || {})
const blocksCollection = computed(() => edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {})

const openTemplatesExportDialog = (total) => {
  state.exportDialogOpen = true
  state.exportDialogStatus = 'running'
  state.exportDialogProcessed = 0
  state.exportDialogTotal = total
  state.exportDialogCurrentItem = ''
  state.exportCancelRequested = false
}

const syncTemplatesExportProgress = ({ completed = 0, total = 0, suggestedName = '' } = {}) => {
  state.exportDialogOpen = true
  state.exportDialogProcessed = completed
  state.exportDialogTotal = total || state.exportDialogTotal
  state.exportDialogCurrentItem = suggestedName || ''
}

const finishTemplatesExportDialog = (savedCount) => {
  state.exportDialogProcessed = savedCount
  state.exportDialogStatus = savedCount === state.exportDialogTotal ? 'complete' : 'canceled'
  state.exportCancelRequested = false
}

const cancelTemplatesExport = () => {
  if (!state.exportingTemplates)
    return
  state.exportCancelRequested = true
}

const closeTemplatesExportDialog = () => {
  if (state.exportingTemplates)
    return
  state.exportDialogOpen = false
}

const exportAllTemplates = async () => {
  if (state.exportingTemplates)
    return
  const selectedDocIds = [...state.selectedTemplateDocIds].filter(docId => templatePagesCollection.value?.[docId])
  const files = selectedDocIds
    .sort((leftId, rightId) => String(leftId).localeCompare(String(rightId)))
    .map((docId) => ({
      suggestedName: `template-${docId}.json`,
      payload: {
        ...edgeGlobal.dupObject(templatePagesCollection.value?.[docId] || {}),
        docId,
      },
    }))

  if (!files.length) {
    edgeFirebase?.toast?.error?.('Select at least one template to export.')
    return
  }

  openTemplatesExportDialog(files.length)
  state.exportingTemplates = true
  try {
    const savedCount = await saveJsonFiles(files, {
      onProgress: syncTemplatesExportProgress,
      shouldCancel: () => state.exportCancelRequested,
    })
    finishTemplatesExportDialog(savedCount)
    if (savedCount === files.length)
      edgeFirebase?.toast?.success?.(`Exported ${files.length} template${files.length === 1 ? '' : 's'}.`)
    else if (savedCount > 0)
      edgeFirebase?.toast?.success?.(`Exported ${savedCount} of ${files.length} templates.`)
  }
  finally {
    state.exportingTemplates = false
    if (state.exportDialogStatus === 'running') {
      state.exportDialogStatus = 'canceled'
      state.exportCancelRequested = false
    }
  }
}

const templatePagePreviewContextCache = useState('edge-cms-template-page-preview-context-cache', () => ({}))

const loadTemplatePagePreviewContext = async () => {
  const siteId = selectedTemplatePreviewSiteId.value
  if (!siteId) {
    state.templatePageRenderContext = null
    return
  }

  const cacheKey = `${edgeGlobal.edgeState.currentOrganization}:${siteId}`
  const cached = templatePagePreviewContextCache.value?.[cacheKey]
  if (cached && typeof cached === 'object') {
    state.templatePageRenderContext = edgeGlobal.dupObject(cached)
    return
  }

  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/sites/${siteId}/published_posts`
    await staticSearch.getData(collectionPath, [], [], 1)
    const firstPost = Object.values(staticSearch.results?.data || {})[0] || null
    if (firstPost && typeof firstPost === 'object') {
      templatePagePreviewContextCache.value[cacheKey] = edgeGlobal.dupObject(firstPost)
      state.templatePageRenderContext = edgeGlobal.dupObject(firstPost)
      return
    }
  }
  catch (error) {
    console.error('Failed to load template page preview context', error)
  }

  state.templatePageRenderContext = null
}

const normalizePreviewColumns = (row) => {
  if (!Array.isArray(row?.columns) || !row.columns.length)
    return []
  return row.columns.map((column, idx) => ({
    id: column?.id || `${row?.id || 'row'}-col-${idx}`,
    span: Number(column?.span) || null,
    blocks: Array.isArray(column?.blocks) ? column.blocks.filter(Boolean) : [],
  }))
}

const templatePreviewRows = (pageDoc) => {
  const structureRows = Array.isArray(pageDoc?.structure) ? pageDoc.structure : []
  if (structureRows.length) {
    return structureRows
      .map((row, rowIndex) => ({
        id: row?.id || `${pageDoc?.docId || 'template-page'}-row-${rowIndex}`,
        columns: normalizePreviewColumns(row),
      }))
      .filter(row => row.columns.length > 0)
  }

  const legacyBlocks = Array.isArray(pageDoc?.content) ? pageDoc.content.filter(Boolean) : []
  if (!legacyBlocks.length)
    return []
  return [{
    id: `${pageDoc?.docId || 'template-page'}-legacy-row`,
    columns: [{
      id: `${pageDoc?.docId || 'template-page'}-legacy-col`,
      span: null,
      blocks: legacyBlocks,
    }],
  }]
}

const templatePageHasPreview = pageDoc => templatePreviewRows(pageDoc).length > 0

const resolveTemplateBlockSource = (pageDoc, blockRef) => {
  if (!blockRef)
    return null
  if (typeof blockRef === 'object')
    return blockRef
  const lookupId = String(blockRef).trim()
  if (!lookupId)
    return null
  const templateBlocks = Array.isArray(pageDoc?.content) ? pageDoc.content : []
  return templateBlocks.find(block => block?.id === lookupId || block?.blockId === lookupId) || null
}

const resolveBlockForPreview = (block) => {
  if (!block)
    return null
  if (block.content) {
    return {
      content: block.content,
      values: block.values || {},
      meta: block.meta || {},
    }
  }
  if (block.blockId && blocksCollection.value?.[block.blockId]) {
    const libraryBlock = blocksCollection.value[block.blockId]
    return {
      content: libraryBlock.content,
      values: block.values || libraryBlock.values || {},
      meta: block.meta || libraryBlock.meta || {},
    }
  }
  return null
}

const resolveTemplateBlockForPreview = (pageDoc, blockRef) => {
  const source = resolveTemplateBlockSource(pageDoc, blockRef)
  return resolveBlockForPreview(source)
}

const hasPreviewSpans = row => (row?.columns || []).some(column => Number.isFinite(Number(column?.span)))

const previewGridClass = (row) => {
  if (hasPreviewSpans(row))
    return 'grid grid-cols-1 sm:grid-cols-6 gap-4'
  const count = row?.columns?.length || 1
  const map = {
    1: 'grid grid-cols-1 gap-4',
    2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
    3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
    4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
    5: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4',
    6: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4',
  }
  return map[count] || map[1]
}

const previewColumnStyle = (column) => {
  const span = Number(column?.span)
  if (!Number.isFinite(span))
    return {}
  const safeSpan = Math.min(Math.max(span, 1), 6)
  return { gridColumn: `span ${safeSpan} / span ${safeSpan}` }
}

const getTemplatePagePreviewKey = (docId) => {
  const themeId = String(selectedTemplatePreviewThemeId.value || 'no-theme')
  const siteId = String(selectedTemplatePreviewSiteId.value || 'no-site')
  const themeVersion = getThemePreviewVersion(themeCollection.value?.[themeId] || null)
  return `${String(docId || 'template-page')}:${siteId}:${themeId}:${themeVersion}`
}

const getTemplatePageAllowedThemes = item => (Array.isArray(item?.allowedThemes) ? item.allowedThemes : [])
const getTemplatePageTags = item => (Array.isArray(item?.tags) ? item.tags : [])
const getTemplatePageDescription = item => String(item?.description || item?.metaDescription || '').trim()
const getTemplatePageName = item => String(item?.name || 'Untitled Template').trim() || 'Untitled Template'
const getTemplatePageLastUpdated = item => item?.lastUpdated || item?.last_updated || item?.doc_created_at || 0

const templateTagOptions = computed(() => {
  const tagsSet = new Set()
  for (const templatePage of Object.values(templatePagesCollection.value || {})) {
    if (Array.isArray(templatePage?.tags))
      templatePage.tags.forEach(tag => tagsSet.add(tag))
  }
  const tagItems = Array.from(tagsSet).sort((a, b) => a.localeCompare(b)).map(tag => ({ name: tag, title: tag }))
  return [{ name: NO_TAGS_FILTER_VALUE, title: 'No Tags' }, ...tagItems]
})

const listFilters = computed(() => {
  const filters = []
  if (state.templatePageThemes.length)
    filters.push({ filterFields: ['allowedThemes'], value: state.templatePageThemes })
  return filters
})

function normalizeTemplatePageTypes(item) {
  const value = item?.type
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
    .flatMap((typeValue) => {
      if (typeValue === 'page')
        return ['Page']
      if (typeValue === 'post')
        return ['Post']
      if (typeValue === 'both')
        return ['Page', 'Post']
      return []
    })

  const uniqueNormalized = [...new Set(normalized)]
  if (!uniqueNormalized.length && !hasExplicitTypeValue)
    return item?.post ? ['Post'] : ['Page']
  return uniqueNormalized
}

const applyTemplateTagSelectionFilter = (items = []) => {
  const selectedFilters = Array.isArray(state.templatePageTags) ? state.templatePageTags : []
  if (!selectedFilters.length)
    return items

  const includeNoTags = selectedFilters.includes(NO_TAGS_FILTER_VALUE)
  const selectedTags = selectedFilters.filter(value => value !== NO_TAGS_FILTER_VALUE)

  return items.filter((item) => {
    const tags = getTemplatePageTags(item)
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

const applyTemplateTypeSelectionFilter = (items = []) => {
  const selectedType = String(state.templatePageTypeFilter || 'all')
  if (selectedType === 'all')
    return items

  return items.filter(item => normalizeTemplatePageTypes(item).includes(selectedType))
}

const applyTemplateSelectionFilters = (items = []) => {
  return applyTemplateTagSelectionFilter(applyTemplateTypeSelectionFilter(items))
}

const visibleTemplateItems = computed(() => {
  const query = String(state.templatePageFilter || '').trim().toLowerCase()
  const items = Object.entries(templatePagesCollection.value || {}).map(([docId, doc]) => ({
    docId,
    ...(doc || {}),
  }))
  const filteredByQuery = !query
    ? items
    : items.filter(item => [item?.name, item?.docId].some(value => String(value || '').toLowerCase().includes(query)))
  return applyTemplateSelectionFilters(filteredByQuery)
})

const selectedTemplateSet = computed(() => new Set(state.selectedTemplateDocIds))
const selectedTemplateCount = computed(() => state.selectedTemplateDocIds.length)
const normalizeDocId = value => String(value || '').trim()
const isTemplateSelected = docId => selectedTemplateSet.value.has(normalizeDocId(docId))
const existingTemplateItems = computed(() => {
  return Object.entries(templatePagesCollection.value || {})
    .map(([docId, doc]) => ({
      docId,
      ...(doc || {}),
      name: getTemplatePageName({ docId, ...(doc || {}) }),
      description: getTemplatePageDescription({ docId, ...(doc || {}) }),
    }))
    .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
})
const selectedExistingTemplate = computed(() => {
  return existingTemplateItems.value.find(template => template.docId === state.selectedExistingTemplateId) || null
})
const isExistingTemplateSelected = docId => state.selectedExistingTemplateId === docId

const setTemplateSelection = (docId, checked) => {
  const normalizedDocId = normalizeDocId(docId)
  if (!normalizedDocId)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  if (shouldSelect) {
    if (!selectedTemplateSet.value.has(normalizedDocId))
      state.selectedTemplateDocIds = [...state.selectedTemplateDocIds, normalizedDocId]
    return
  }
  state.selectedTemplateDocIds = state.selectedTemplateDocIds.filter(id => id !== normalizedDocId)
}

const getVisibleSelectionState = (visibleItems = []) => {
  if (!visibleItems.length)
    return false
  let selectedVisibleCount = 0
  for (const item of visibleItems) {
    if (isTemplateSelected(item?.docId))
      selectedVisibleCount += 1
  }
  if (selectedVisibleCount === 0)
    return false
  if (selectedVisibleCount === visibleItems.length)
    return true
  return 'indeterminate'
}

const toggleVisibleTemplateSelection = (visibleItems = [], checked) => {
  if (!visibleItems.length)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  const visibleDocIds = visibleItems.map(item => normalizeDocId(item?.docId)).filter(Boolean)
  if (shouldSelect) {
    state.selectedTemplateDocIds = [...new Set([...state.selectedTemplateDocIds, ...visibleDocIds])]
    return
  }
  const visibleDocIdSet = new Set(visibleDocIds)
  state.selectedTemplateDocIds = state.selectedTemplateDocIds.filter(id => !visibleDocIdSet.has(id))
}

const clearSelectedTemplates = () => {
  state.selectedTemplateDocIds = []
}

const openBulkDeleteDialog = () => {
  if (!selectedTemplateCount.value)
    return
  state.bulkDeleteDialogOpen = true
}

const bulkDeleteAction = async () => {
  if (state.bulkDeleting || !selectedTemplateCount.value) {
    state.bulkDeleteDialogOpen = false
    return
  }

  state.bulkDeleting = true
  const selectedDocIds = [...state.selectedTemplateDocIds]
  const templates = templatePagesCollection.value || {}
  const failedDocIds = []
  let deletedCount = 0

  try {
    for (const docId of selectedDocIds) {
      if (!templates[docId])
        continue
      try {
        await edgeFirebase.removeDoc(templatePagesCollectionPath.value, docId)
        deletedCount += 1
      }
      catch (error) {
        failedDocIds.push(docId)
        console.error(`Failed to delete template "${docId}"`, error)
      }
    }

    state.selectedTemplateDocIds = failedDocIds
    state.bulkDeleteDialogOpen = false

    if (deletedCount)
      edgeFirebase?.toast?.success?.(`Deleted ${deletedCount} template${deletedCount === 1 ? '' : 's'}.`)
    if (failedDocIds.length)
      edgeFirebase?.toast?.error?.(`Failed to delete ${failedDocIds.length} template${failedDocIds.length === 1 ? '' : 's'}.`)
  }
  finally {
    state.bulkDeleting = false
  }
}

const formatTemplatePageDate = (value) => {
  if (!value)
    return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return ''
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const openTemplatePage = (docId) => {
  const nextDocId = String(docId || '').trim()
  if (!nextDocId)
    return
  router.push(`/app/dashboard/templates/${nextDocId}`)
}

const resetNewTemplateDialog = () => {
  state.addTemplateTab = 'blank'
  state.selectedExistingTemplateId = existingTemplateItems.value?.[0]?.docId || ''
  state.creatingTemplateFromExisting = false
}

const closeNewTemplateDialog = () => {
  state.newTemplateDialogOpen = false
  resetNewTemplateDialog()
}

const openNewTemplatePage = () => {
  resetNewTemplateDialog()
  state.newTemplateDialogOpen = true
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

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const normalizeImportedPageDoc = (payload, fallbackDocId = '') => {
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

const getPageDocDefaults = () => getDocDefaultsFromSchema(pageNewDocSchema)

const isBlankString = value => String(value || '').trim() === ''

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

  const requiredKeys = Object.keys(pageNewDocSchema)
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  return doc
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

const buildDuplicatedTemplatePayload = (sourceDoc, targetDocId, docsMap = {}) => {
  const sourceName = String(sourceDoc?.name || sourceDoc?.docId || '').trim()
  const fallbackName = sourceName || 'Template'
  const nextName = makeImportedPageNameForNew(fallbackName, docsMap)
  const duplicatedSource = edgeGlobal.dupObject(sourceDoc || {})
  delete duplicatedSource.docId
  delete duplicatedSource.doc_created_at
  delete duplicatedSource.last_updated

  return applyImportedPageSeoDefaults({
    ...getPageDocDefaults(),
    ...duplicatedSource,
    docId: targetDocId,
    name: nextName,
  })
}

const createTemplateFromSelection = async () => {
  if (state.creatingTemplateFromExisting)
    return

  if (state.addTemplateTab === 'blank') {
    closeNewTemplateDialog()
    router.push('/app/dashboard/templates/new')
    return
  }

  const sourceTemplate = selectedExistingTemplate.value
  if (!sourceTemplate)
    return

  state.creatingTemplateFromExisting = true
  try {
    const existingTemplates = { ...(templatePagesCollection.value || {}) }
    const targetDocId = makeRandomPageDocId(existingTemplates)
    const payload = buildDuplicatedTemplatePayload(sourceTemplate, targetDocId, existingTemplates)
    await edgeFirebase.storeDoc(templatePagesCollectionPath.value, payload, targetDocId)
    closeNewTemplateDialog()
    edgeFirebase?.toast?.success?.(`Duplicated template "${sourceTemplate.name || sourceTemplate.docId}" as "${targetDocId}".`)
    router.push(`/app/dashboard/templates/${targetDocId}`)
  }
  catch (error) {
    console.error('Failed to duplicate template', error)
    edgeFirebase?.toast?.error?.('Failed to duplicate template.')
  }
  finally {
    state.creatingTemplateFromExisting = false
  }
}

const requestPageImportDocId = (initialValue = '') => {
  state.importPageDocIdValue = String(initialValue || '')
  state.importPageDocIdDialogOpen = true
  return new Promise((resolve) => {
    pageImportDocIdResolver.value = resolve
  })
}

const resolvePageImportDocId = (value = '') => {
  const resolver = pageImportDocIdResolver.value
  pageImportDocIdResolver.value = null
  state.importPageDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestPageImportConflict = (docId) => {
  state.importPageConflictDocId = String(docId || '')
  state.importPageConflictDialogOpen = true
  return new Promise((resolve) => {
    pageImportConflictResolver.value = resolve
  })
}

const resolvePageImportConflict = (action = 'cancel') => {
  const resolver = pageImportConflictResolver.value
  pageImportConflictResolver.value = null
  state.importPageConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

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

const openImportErrorDialog = (message) => {
  state.importPageErrorMessage = String(message || 'Failed to import page.')
  state.importPageErrorDialogOpen = true
}

const triggerPageImport = () => {
  pageImportInputRef.value?.click()
}

const importSinglePageFile = async (file, existingPages = {}) => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = applyImportedPageSeoDefaults(validateImportedPageDoc(normalizeImportedPageDoc(parsed, '')))
  const incomingDocId = await getImportDocId(importedDoc, '')
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingPages[targetDocId]) {
    const decision = await requestPageImportConflict(targetDocId)
    if (decision === 'cancel')
      return
    if (decision === 'new') {
      targetDocId = makeRandomPageDocId(existingPages)
      importedDoc.name = makeImportedPageNameForNew(importedDoc.name || incomingDocId, existingPages)
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const payload = { ...getPageDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(templatePagesCollectionPath.value, payload, targetDocId)
  existingPages[targetDocId] = payload

  if (importDecision === 'overwrite')
    edgeFirebase?.toast?.success?.(`Overwrote template "${targetDocId}".`)
  else if (importDecision === 'new')
    edgeFirebase?.toast?.success?.(`Imported template as new "${targetDocId}".`)
  else
    edgeFirebase?.toast?.success?.(`Imported template "${targetDocId}".`)
}

const handlePageImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingPages = true
  const existingPages = { ...(templatePagesCollection.value || {}) }
  try {
    if (!edgeFirebase.data?.[templatePagesCollectionPath.value])
      await edgeFirebase.startSnapshot(templatePagesCollectionPath.value)

    for (const file of files) {
      try {
        await importSinglePageFile(file, existingPages)
      }
      catch (error) {
        console.error('Failed to import template page file', error)
        const message = error?.message || 'Failed to import template page file.'
        if (/^Import canceled\./i.test(message))
          continue
        if (error instanceof SyntaxError || message === INVALID_PAGE_IMPORT_MESSAGE)
          openImportErrorDialog(INVALID_PAGE_IMPORT_MESSAGE)
        else
          openImportErrorDialog(message)
      }
    }
  }
  finally {
    state.importingPages = false
    if (input)
      input.value = ''
  }
}

watch(() => state.importPageDocIdDialogOpen, (open) => {
  if (!open && pageImportDocIdResolver.value) {
    const resolver = pageImportDocIdResolver.value
    pageImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importPageConflictDialogOpen, (open) => {
  if (!open && pageImportConflictResolver.value) {
    const resolver = pageImportConflictResolver.value
    pageImportConflictResolver.value = null
    resolver('cancel')
  }
})

watch(previewSiteOptions, (options) => {
  const selectedSiteId = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  const hasSelectedSite = options.some(option => option.name === selectedSiteId)
  if (!selectedSiteId || !hasSelectedSite)
    edgeGlobal.edgeState.blockEditorSite = options?.[0]?.name || ''
}, { immediate: true, deep: true })

watch(themeOptions, (options) => {
  const selectedThemeId = String(edgeGlobal.edgeState.blockEditorTheme || '').trim()
  const hasSelectedTheme = options.some(option => option.name === selectedThemeId)
  if (!selectedThemeId || !hasSelectedTheme)
    edgeGlobal.edgeState.blockEditorTheme = options?.[0]?.name || ''
}, { immediate: true, deep: true })

watch(templatePagesCollection, (collection) => {
  const validDocIds = new Set(Object.keys(collection || {}))
  state.selectedTemplateDocIds = state.selectedTemplateDocIds.filter(docId => validDocIds.has(docId))
}, { deep: true })

watch(existingTemplateItems, (items) => {
  const selectedDocId = String(state.selectedExistingTemplateId || '').trim()
  const hasSelectedDocId = items.some(item => item.docId === selectedDocId)
  if (!selectedDocId || !hasSelectedDocId)
    state.selectedExistingTemplateId = items?.[0]?.docId || ''
}, { immediate: true, deep: true })

watch(
  [() => edgeGlobal.edgeState.currentOrganization, selectedTemplatePreviewSiteId],
  async () => {
    await loadTemplatePagePreviewContext()
  },
  { immediate: true },
)

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`])
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/sites`)
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`])
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/themes`)
  if (!edgeFirebase.data?.[templatePagesCollectionPath.value])
    await edgeFirebase.startSnapshot(templatePagesCollectionPath.value)
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`])
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/blocks`)
  state.mounted = true
})

watch(themeCollection, () => {
  emit('head', {})
}, { immediate: true, deep: true })
</script>

<template>
  <div v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted">
    <edge-dashboard
      :filter="state.templatePageFilter"
      :filter-fields="['name', 'docId']"
      :filters="listFilters"
      collection="sites/templates/pages"
      sort-field="last_updated"
      sort-direction="desc"
      class="pt-0 flex-1"
    >
      <template #header-start="slotProps">
        <component :is="slotProps.icon" class="mr-2" />
        Templates
      </template>
      <template #header-center>
        <edge-shad-form class="w-full">
          <div class="w-full px-4 md:px-6 flex flex-col gap-2 md:flex-row md:items-center">
            <div class="md:flex-1 md:min-w-0">
              <edge-shad-select
                v-model="edgeGlobal.edgeState.blockEditorTheme"
                name="templatePreviewTheme"
                :items="themeOptions"
                placeholder="Preview theme"
                class="w-full"
              />
            </div>
            <div class="md:flex-1 md:min-w-0">
              <edge-shad-select
                v-model="edgeGlobal.edgeState.blockEditorSite"
                name="templatePreviewSite"
                :items="previewSiteOptions"
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
            ref="pageImportInputRef"
            type="file"
            multiple
            accept=".json,application/json"
            class="hidden"
            @change="handlePageImport"
          >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <edge-shad-button
                type="button"
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Template Actions"
                aria-label="Template Actions"
              >
                <MoreHorizontal class="h-4 w-4" />
              </edge-shad-button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem :disabled="state.importingPages" @click="triggerPageImport">
                <Loader2 v-if="state.importingPages" class="h-4 w-4 animate-spin" />
                <Upload v-else class="h-4 w-4" />
                <span>Import Templates</span>
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="state.exportingTemplates || selectedTemplateCount === 0" @click="exportAllTemplates">
                <Loader2 v-if="state.exportingTemplates" class="h-4 w-4 animate-spin" />
                <Download v-else class="h-4 w-4" />
                <span>{{ state.exportingTemplates ? 'Exporting Selected...' : 'Export Selected' }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <edge-shad-button
            class="uppercase bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            @click="openNewTemplatePage"
          >
            <Plus class="mr-2 h-4 w-4" />
            Add Template
          </edge-shad-button>
        </div>
      </template>
      <template #list-header>
        <div class="w-full mt-4 mx-0 rounded-md border border-slate-300/70 bg-slate-100/95 dark:border-slate-700 dark:bg-slate-900/95 px-3 py-2 space-y-2 backdrop-blur-sm shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Checkbox
                :model-value="getVisibleSelectionState(visibleTemplateItems)"
                aria-label="Select visible templates"
                class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                @click.stop
                @update:model-value="toggleVisibleTemplateSelection(visibleTemplateItems, $event)"
              />
              <span class="text-xs text-slate-600 dark:text-slate-300">
                Select visible ({{ visibleTemplateItems.length }})
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-600 dark:text-slate-300">{{ selectedTemplateCount }} selected</span>
              <edge-shad-button
                variant="outline"
                class="h-8 text-xs"
                :disabled="selectedTemplateCount === 0"
                @click="clearSelectedTemplates"
              >
                Clear
              </edge-shad-button>
              <edge-shad-button
                variant="destructive"
                class="h-8 text-xs text-white"
                :disabled="selectedTemplateCount === 0"
                @click="openBulkDeleteDialog"
              >
                Delete selected
              </edge-shad-button>
            </div>
          </div>
          <edge-shad-form>
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <div class="grow">
                <edge-shad-input
                  v-model="state.templatePageFilter"
                  name="templatePageFilter"
                  placeholder="Search templates..."
                  class="w-full"
                />
              </div>
              <div class="md:w-[150px]">
                <edge-shad-select
                  v-model="state.templatePageTypeFilter"
                  name="templatePageTypeFilter"
                  :items="TEMPLATE_PAGE_TYPE_OPTIONS"
                  placeholder="Type"
                  class="w-full"
                />
              </div>
              <div class="md:min-w-[170px]">
                <edge-shad-select-tags
                  v-model="state.templatePageTags"
                  :items="templateTagOptions"
                  name="tags"
                  placeholder="Filter tags"
                />
              </div>
              <div class="md:min-w-[170px]">
                <edge-shad-select-tags
                  v-model="state.templatePageThemes"
                  :items="themeOptions"
                  name="themes"
                  placeholder="Filter themes"
                />
              </div>
            </div>
          </edge-shad-form>
        </div>
      </template>
      <template #list>
        <div class="w-full pt-2 space-y-3 h-[calc(100vh-310px)]">
          <div
            v-if="visibleTemplateItems.length"
            class="grid gap-4 w-full pb-2"
            style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));"
          >
            <div
              v-for="item in visibleTemplateItems"
              :key="item.docId"
              role="button"
              tabindex="0"
              class="w-full h-full"
              @click="openTemplatePage(item.docId)"
              @keyup.enter="openTemplatePage(item.docId)"
            >
              <Card class="h-full cursor-pointer border border-slate-300/70 bg-white/70 transition hover:border-slate-500 hover:shadow-[0_22px_55px_-24px_rgba(0,0,0,0.4)] dark:border-slate-700 dark:bg-slate-900/50">
                <CardContent class="flex h-full flex-col gap-4 p-4 sm:p-5">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="mb-1" @click.stop>
                        <Checkbox
                          :model-value="isTemplateSelected(item.docId)"
                          :aria-label="`Select template ${getTemplatePageName(item)}`"
                          class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                          @click.stop
                          @update:model-value="setTemplateSelection(item.docId, $event)"
                        />
                      </div>
                      <p class="text-lg font-semibold leading-snug line-clamp-2 text-slate-900 dark:text-slate-100">
                        {{ getTemplatePageName(item) }}
                      </p>
                      <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span
                          v-if="item.post"
                          class="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                        >
                          Post Template
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      <edge-shad-button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        @click.stop="openTemplatePage(item.docId)"
                      >
                        <FilePenLine class="h-4 w-4" />
                      </edge-shad-button>
                      <edge-shad-button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 text-slate-600 hover:bg-slate-200 hover:text-red-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-red-300"
                        @click.stop="slotProps.deleteItem(item.docId)"
                      >
                        <Trash2 class="h-4 w-4" />
                      </edge-shad-button>
                    </div>
                  </div>
                  <div class="template-scale-wrapper border border-dashed border-border/60 rounded-md bg-background/80">
                    <div class="template-scale-inner">
                      <div class="template-scale-content space-y-4">
                        <template v-if="templatePageHasPreview(item) && selectedTemplatePreviewThemeReady">
                          <div
                            v-for="(row, rowIndex) in templatePreviewRows(item)"
                            :key="`${item.docId}-row-${row.id || rowIndex}`"
                            class="w-full"
                          >
                            <div :class="previewGridClass(row)">
                              <div
                                v-for="(column, colIndex) in row.columns"
                                :key="`${item.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}`"
                                class="min-w-0"
                                :style="previewColumnStyle(column)"
                              >
                                <div
                                  v-for="(blockRef, blockIdx) in column.blocks || []"
                                  :key="`${item.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}-block-${blockIdx}`"
                                >
                                  <edge-cms-block-api
                                    v-if="resolveTemplateBlockForPreview(item, blockRef)"
                                    :key="`${getTemplatePagePreviewKey(item.docId)}:${blockIdx}`"
                                    :site-id="selectedTemplatePreviewSiteId"
                                    :content="resolveTemplateBlockForPreview(item, blockRef).content"
                                    :values="resolveTemplateBlockForPreview(item, blockRef).values"
                                    :meta="resolveTemplateBlockForPreview(item, blockRef).meta"
                                    :theme="selectedTemplatePreviewTheme"
                                    :render-context="state.templatePageRenderContext"
                                    :isolated="true"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </template>
                        <template v-else>
                          <div class="flex h-32 items-center justify-center text-[100px] mt-[100px] text-muted-foreground">
                            No blocks yet
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                  <div class="mt-auto space-y-2 text-xs text-slate-500 dark:text-slate-400">
                    <div v-if="getTemplatePageDescription(item)" class="line-clamp-2">
                      {{ getTemplatePageDescription(item) }}
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          v-for="themeId in getTemplatePageAllowedThemes(item).slice(0, 2)"
                          :key="themeId"
                          class="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800"
                        >
                          {{ themeOptionsMap.get(themeId)?.title || themeId }}
                        </span>
                        <span
                          v-if="getTemplatePageAllowedThemes(item).length > 2"
                          class="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                        >
                          +{{ getTemplatePageAllowedThemes(item).length - 2 }} themes
                        </span>
                      </div>
                      <span v-if="getTemplatePageLastUpdated(item)">
                        {{ formatTemplatePageDate(getTemplatePageLastUpdated(item)) }}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          <div
            v-else
            class="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 px-6 py-10 text-center"
          >
            <FileStack class="h-8 w-8 text-muted-foreground/60" />
            <div class="space-y-1">
              <h3 class="text-base font-medium">
                No templates found
              </h3>
              <p class="text-sm text-muted-foreground">
                Adjust search or create a new page template.
              </p>
            </div>
            <edge-shad-button variant="outline" class="gap-2" @click="openNewTemplatePage">
              <Plus class="h-4 w-4" />
              Add Template
            </edge-shad-button>
          </div>
        </div>
      </template>
    </edge-dashboard>

    <edge-shad-dialog v-model="state.newTemplateDialogOpen">
      <DialogContent class="pt-6 w-full max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader class="pb-2">
          <DialogTitle class="text-left">
            Create New Template
          </DialogTitle>
          <DialogDescription>
            Start from a blank template or duplicate an existing template.
          </DialogDescription>
        </DialogHeader>

        <div class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <p class="text-xs text-muted-foreground">
              Start a new template from scratch, or duplicate an existing template below.
            </p>
            <edge-button-divider class="my-4">
              <span class="text-xs text-muted-foreground !nowrap text-center">Blank Template</span>
            </edge-button-divider>
            <div class="grid grid-cols-1 gap-3 auto-rows-fr pb-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                class="rounded-lg border bg-card p-3 text-left transition focus:outline-none focus-visible:ring-2 flex flex-col gap-3"
                :class="state.addTemplateTab === 'blank' ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
                :aria-pressed="state.addTemplateTab === 'blank'"
                @click="state.addTemplateTab = 'blank'"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-semibold">Blank</span>
                  <File class="h-4 w-4 text-muted-foreground" />
                </div>
                <div class="template-scale-wrapper border border-dashed border-border/60 rounded-md bg-background/80">
                  <div class="template-scale-inner">
                    <div class="template-scale-content space-y-4">
                      <div class="flex h-32 items-center justify-center text-[100px] mt-[100px] text-muted-foreground">
                        Blank page
                      </div>
                    </div>
                  </div>
                </div>
                <p class="line-clamp-2 text-xs text-muted-foreground">
                  Create a new template without any blocks.
                </p>
              </button>
            </div>

            <edge-button-divider class="my-4">
              <span class="text-xs text-muted-foreground !nowrap text-center">Duplicate Existing Template</span>
            </edge-button-divider>
            <div v-if="existingTemplateItems.length" class="pb-2">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-fr">
                <button
                  v-for="template in existingTemplateItems"
                  :key="template.docId"
                  type="button"
                  class="rounded-lg border bg-card text-left p-3 flex flex-col gap-3 transition focus:outline-none focus-visible:ring-2"
                  :class="state.addTemplateTab === 'existing' && isExistingTemplateSelected(template.docId) ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
                  :aria-pressed="state.addTemplateTab === 'existing' && isExistingTemplateSelected(template.docId)"
                  @click="state.addTemplateTab = 'existing'; state.selectedExistingTemplateId = template.docId"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold truncate">{{ template.name }}</span>
                    <File class="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div class="template-scale-wrapper border border-dashed border-border/60 rounded-md bg-background/80">
                    <div class="template-scale-inner">
                      <div class="template-scale-content space-y-4">
                        <template v-if="templatePageHasPreview(template) && selectedTemplatePreviewThemeReady">
                          <div
                            v-for="(row, rowIndex) in templatePreviewRows(template)"
                            :key="`${template.docId}-row-${row.id || rowIndex}`"
                            class="w-full"
                          >
                            <div :class="previewGridClass(row)">
                              <div
                                v-for="(column, colIndex) in row.columns"
                                :key="`${template.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}`"
                                class="min-w-0"
                                :style="previewColumnStyle(column)"
                              >
                                <div
                                  v-for="(blockRef, blockIdx) in column.blocks || []"
                                  :key="`${template.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}-block-${blockIdx}`"
                                >
                                  <edge-cms-block-api
                                    v-if="resolveTemplateBlockForPreview(template, blockRef)"
                                    :key="`${getTemplatePagePreviewKey(template.docId)}:${blockIdx}`"
                                    :site-id="selectedTemplatePreviewSiteId"
                                    :content="resolveTemplateBlockForPreview(template, blockRef).content"
                                    :values="resolveTemplateBlockForPreview(template, blockRef).values"
                                    :meta="resolveTemplateBlockForPreview(template, blockRef).meta"
                                    :theme="selectedTemplatePreviewTheme"
                                    :render-context="state.templatePageRenderContext"
                                    :isolated="true"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </template>
                        <template v-else>
                          <div class="flex h-32 items-center justify-center text-[100px] mt-[100px] text-muted-foreground">
                            No blocks yet
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                  <p v-if="template.description" class="line-clamp-2 text-xs text-muted-foreground">
                    {{ template.description }}
                  </p>
                </button>
              </div>
            </div>
            <div
              v-else
              class="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 px-6 py-10 text-center text-sm text-muted-foreground"
            >
              No existing templates yet. Start with Blank first.
            </div>
          </div>
        </div>

        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeNewTemplateDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            class="w-full bg-slate-800 text-white hover:bg-slate-400"
            :disabled="state.creatingTemplateFromExisting || (state.addTemplateTab === 'existing' && !selectedExistingTemplate)"
            @click="createTemplateFromSelection"
          >
            <Loader2 v-if="state.creatingTemplateFromExisting" class="mr-2 h-4 w-4 animate-spin" />
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-cms-json-export-progress-dialog
      v-model="state.exportDialogOpen"
      title="Exporting Templates"
      :status="state.exportDialogStatus"
      :processed="state.exportDialogProcessed"
      :total="state.exportDialogTotal"
      :current-item="state.exportDialogCurrentItem"
      @cancel="cancelTemplatesExport"
      @update:model-value="closeTemplatesExportDialog"
    />
    <edge-shad-dialog v-model="state.importPageDocIdDialogOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Template docId</DialogTitle>
          <DialogDescription>
            Enter the docId to store this imported template under.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <edge-shad-input v-model="state.importPageDocIdValue" name="templateImportDocId" label="docId" placeholder="template-doc-id" />
        </div>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolvePageImportDocId('')">
            Cancel
          </edge-shad-button>
          <edge-shad-button @click="resolvePageImportDocId(state.importPageDocIdValue)">
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.importPageConflictDialogOpen">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Template already exists</DialogTitle>
          <DialogDescription>
            <code>{{ state.importPageConflictDocId }}</code> already exists in templates. Choose how to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolvePageImportConflict('cancel')">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="outline" @click="resolvePageImportConflict('new')">
            Import as New
          </edge-shad-button>
          <edge-shad-button @click="resolvePageImportConflict('overwrite')">
            Overwrite
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.importPageErrorDialogOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Template import failed</DialogTitle>
          <DialogDescription>
            {{ state.importPageErrorMessage || INVALID_PAGE_IMPORT_MESSAGE }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 justify-end">
          <edge-shad-button @click="state.importPageErrorDialogOpen = false">
            Close
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.bulkDeleteDialogOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete selected templates?</DialogTitle>
          <DialogDescription>
            This will permanently delete {{ selectedTemplateCount }} template{{ selectedTemplateCount === 1 ? '' : 's' }}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="state.bulkDeleteDialogOpen = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            class="text-white"
            :disabled="state.bulkDeleting"
            @click="bulkDeleteAction"
          >
            <Loader2 v-if="state.bulkDeleting" class="mr-2 h-4 w-4 animate-spin" />
            Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style scoped>
.template-scale-wrapper {
  width: 100%;
  overflow: hidden;
  position: relative;
  border-radius: 0.5rem;
  height: 400px;
}

.template-scale-wrapper :deep(*) {
  pointer-events: none !important;
  user-select: none;
}

.template-scale-inner {
  transform-origin: top left;
  display: inline-block;
  width: 100%;
  height: 400px;
  overflow: hidden;
}

.template-scale-content {
  transform: scale(0.2);
  transform-origin: top left;
  width: 500%;
}
</style>
