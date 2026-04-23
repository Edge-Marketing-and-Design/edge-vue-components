<script setup>
import { ChevronLeft, ChevronRight, FileText, ImagePlus, Loader2, Square, SquareCheckBig } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  site: {
    type: String,
    required: false,
    default: 'all',
  },
  includeCmsAll: {
    type: Boolean,
    required: false,
    default: true,
  },
  selectMode: {
    type: Boolean,
    required: false,
    default: false,
  },
  defaultTags: {
    type: Array,
    required: false,
    default: () => [],
  },
  includeFiles: {
    type: Boolean,
    required: false,
    default: false,
  },
  filesOnly: {
    type: Boolean,
    required: false,
    default: false,
  },
  mediaTypeDefault: {
    type: String,
    required: false,
    default: 'both',
  },
  fileTypeDefault: {
    type: String,
    required: false,
    default: 'all',
  },
  cmsSiteFilterDefault: {
    type: String,
    required: false,
    default: 'all',
  },
  markPdfAsFlipbook: {
    type: Boolean,
    required: false,
    default: false,
  },
})

// const edgeGlobal = inject('edgeGlobal')

const emits = defineEmits(['select'])

const edgeFirebase = inject('edgeFirebase')
const allowedFileExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', 'zip', 'odt', 'ods', 'odp']
const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif']
const allowedFileMimeTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/rtf',
  'text/rtf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]
const imageMimeTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']
const isPdfUpload = (file) => {
  const mimeType = String(file?.type || file?.file?.type || '').toLowerCase()
  if (mimeType === 'application/pdf')
    return true

  const fileName = String(file?.name || file?.file?.name || '').toLowerCase()
  return fileName.endsWith('.pdf')
}
const resolveUploadExtraMeta = (file) => {
  if (!props.markPdfAsFlipbook)
    return {}
  return isPdfUpload(file) ? { flipbook: true } : {}
}
const getMediaExtension = (item) => {
  const fileName = String(item?.fileName || item?.name || '').toLowerCase()
  const fileNameMatch = fileName.match(/\.([a-z0-9]+)$/i)
  if (fileNameMatch?.[1])
    return fileNameMatch[1].toLowerCase()
  const r2Url = String(item?.r2URL || item?.r2Url || '').toLowerCase()
  const sanitizedPath = r2Url.split('?')[0]
  const pathMatch = sanitizedPath.match(/\.([a-z0-9]+)$/i)
  return pathMatch?.[1] ? pathMatch[1].toLowerCase() : ''
}
const isImageMediaItem = (item) => {
  const contentType = String(item?.contentType || '').toLowerCase()
  if (contentType.startsWith('image/'))
    return true
  const ext = getMediaExtension(item)
  return imageExtensions.includes(ext)
}
const isAllowedFileItem = (item) => {
  if (isImageMediaItem(item))
    return false
  const contentType = String(item?.contentType || '').toLowerCase()
  const ext = getMediaExtension(item)
  return allowedFileMimeTypes.includes(contentType) || allowedFileExtensions.includes(ext)
}

const state = reactive({
  filter: '',
  file: [],
  view: 'list',
  selected: [],
  selectAll: false,
  publishing: false,
  unpublishing: false,
  deleting: false,
  tags: [],
  workingDoc: null,
  editMedia: false,
  filterTags: [],
  newDocs: {
    media: {
      name: { value: '' },
      meta: { tags: [] },
    },
  },
  clearingTags: false,
  showUpload: false,
  initialMediaLoadDone: false,
  loaderHold: true,
  mediaTypeFilter: 'both',
  fileTypeFilter: 'all',
  cmsSiteFilter: 'all',
  deleteConfirmOpen: false,
  deleteConfirmMode: 'single',
  deleteConfirmDocId: '',
  deleteConfirmAcknowledge: false,
})

let mediaEmptyFallbackTimer = null
let mediaLoaderHoldTimer = null

const startInitialMediaFallbackTimer = (delay = 2500) => {
  if (mediaEmptyFallbackTimer)
    return
  mediaEmptyFallbackTimer = setTimeout(() => {
    state.initialMediaLoadDone = true
    mediaEmptyFallbackTimer = null
  }, delay)
}

const resetMediaLoadState = () => {
  state.initialMediaLoadDone = false
  state.loaderHold = true
  if (mediaLoaderHoldTimer) {
    clearTimeout(mediaLoaderHoldTimer)
    mediaLoaderHoldTimer = null
  }
  mediaLoaderHoldTimer = setTimeout(() => {
    state.loaderHold = false
    mediaLoaderHoldTimer = null
  }, 450)
}

const filesPath = computed(() => {
  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  if (!orgPath)
    return ''
  return `${orgPath}/files`
})

const files = computed(() => {
  if (!filesPath.value)
    return undefined
  return edgeFirebase.data?.[filesPath.value]
})

const mediaSnapshotReady = computed(() => {
  if (!filesPath.value)
    return false
  return Object.prototype.hasOwnProperty.call(edgeFirebase.data || {}, filesPath.value)
})

const normalizeMediaTypeFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (['both', 'images', 'files'].includes(normalized))
    return normalized
  return 'both'
}
const normalizeFileTypeFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'all')
    return 'all'
  if ([...imageExtensions, ...allowedFileExtensions].includes(normalized))
    return normalized
  return 'all'
}
const showMediaTypeFilter = computed(() => props.includeFiles && !props.filesOnly)
const mediaTypeFilterItems = [
  { title: 'IMAGES & FILES', name: 'both' },
  { title: 'Images Only', name: 'images' },
  { title: 'Files Only', name: 'files' },
]
const activeMediaScope = computed(() => {
  if (props.filesOnly)
    return 'files'
  if (!props.includeFiles)
    return 'images'
  const mediaTypeFilter = normalizeMediaTypeFilter(state.mediaTypeFilter)
  if (mediaTypeFilter === 'images')
    return 'images'
  if (mediaTypeFilter === 'files')
    return 'files'
  return 'both'
})
const fileTypeExtensionsForScope = computed(() => {
  const allowedByScope = activeMediaScope.value === 'images'
    ? new Set(imageExtensions)
    : (activeMediaScope.value === 'files'
        ? new Set(allowedFileExtensions)
        : new Set([...imageExtensions, ...allowedFileExtensions]))

  const query = String(state.filter || '').toLowerCase().trim()
  const activeTags = Array.isArray(state.filterTags)
    ? state.filterTags.map(tag => String(tag || '').trim()).filter(Boolean)
    : []

  const present = new Set()
  Object.values(files.value || {}).forEach((item) => {
    const includeByScope = activeMediaScope.value === 'images'
      ? isImageMediaItem(item)
      : (activeMediaScope.value === 'files' ? isAllowedFileItem(item) : (isImageMediaItem(item) || isAllowedFileItem(item)))
    if (!includeByScope)
      return

    if (query) {
      const name = String(item?.name || '').toLowerCase()
      const fileName = String(item?.fileName || '').toLowerCase()
      if (!name.includes(query) && !fileName.includes(query))
        return
    }

    if (activeTags.length) {
      const itemTags = Array.isArray(item?.meta?.tags)
        ? item.meta.tags.map(tag => String(tag || '').trim())
        : []
      const hasAnyTag = activeTags.some(tag => itemTags.includes(tag))
      if (!hasAnyTag)
        return
    }

    const ext = getMediaExtension(item)
    if (allowedByScope.has(ext))
      present.add(ext)
  })

  const ordered = [...allowedByScope].filter(ext => present.has(ext))
  return ordered
})
const fileTypeFilterItems = computed(() => [
  { title: 'All Types', name: 'all' },
  ...fileTypeExtensionsForScope.value.map(ext => ({
    title: ext.toUpperCase(),
    name: ext,
  })),
])
const resolveCmsSiteScopeValues = () => {
  if (!props.site)
    return []
  const raw = props.includeCmsAll ? ['all', props.site] : [props.site]
  return Array.from(new Set(raw.map(item => String(item || '').trim()).filter(Boolean)))
}
const resolveCmsSiteFilterDefault = () => {
  const normalized = String(props.cmsSiteFilterDefault || '').trim().toLowerCase()
  const currentSite = String(props.site || '').trim()
  if (normalized === 'current' || normalized === 'site' || normalized === 'current-site')
    return currentSite || '__all__'
  if (normalized === 'shared')
    return 'all'
  return '__all__'
}
const showCmsSiteFilter = computed(() => {
  const siteId = String(props.site || '').trim()
  if (!siteId || siteId === 'all')
    return false
  return resolveCmsSiteScopeValues().length > 1
})
const cmsSiteFilterItems = computed(() => {
  const siteId = String(props.site || '').trim()
  if (!siteId || siteId === 'all')
    return [{ title: 'All Sources', name: '__all__' }]
  const items = [
    { title: 'All Sources', name: '__all__' },
    { title: 'Current Site', name: siteId },
  ]
  if (resolveCmsSiteScopeValues().includes('all'))
    items.push({ title: 'Shared Media', name: 'all' })
  return items
})
const shouldIncludeItemByCmsSiteFilter = (item) => {
  if (!showCmsSiteFilter.value)
    return true
  const selected = String(state.cmsSiteFilter || 'all').trim()
  if (!selected || selected === '__all__')
    return true
  const cmsSites = Array.isArray(item?.meta?.cmssite)
    ? item.meta.cmssite.map(entry => String(entry || '').trim()).filter(Boolean)
    : []
  return cmsSites.includes(selected)
}

const shouldIncludeItemByMode = (item) => {
  if (props.filesOnly)
    return isAllowedFileItem(item)
  if (props.includeFiles) {
    const mediaTypeFilter = normalizeMediaTypeFilter(state.mediaTypeFilter)
    if (mediaTypeFilter === 'images')
      return isImageMediaItem(item)
    if (mediaTypeFilter === 'files')
      return isAllowedFileItem(item)
    return isImageMediaItem(item) || isAllowedFileItem(item)
  }
  return isImageMediaItem(item)
}
const shouldIncludeItemByFileType = (item) => {
  const fileTypeFilter = normalizeFileTypeFilter(state.fileTypeFilter)
  if (fileTypeFilter === 'all')
    return true
  return getMediaExtension(item) === fileTypeFilter
}
const shouldIncludeItemBySearchAndTags = (item) => {
  const query = String(state.filter || '').toLowerCase().trim()
  if (query) {
    const name = String(item?.name || '').toLowerCase()
    const fileName = String(item?.fileName || '').toLowerCase()
    if (!name.includes(query) && !fileName.includes(query))
      return false
  }

  if (Array.isArray(state.filterTags) && state.filterTags.length) {
    const itemTags = Array.isArray(item?.meta?.tags)
      ? item.meta.tags.map(tag => String(tag || '').trim())
      : []
    const hasAnyTag = state.filterTags.some(tag => itemTags.includes(String(tag || '').trim()))
    if (!hasAnyTag)
      return false
  }

  return true
}
const getModeFilteredItems = (items) => {
  return (items || [])
    .filter(item => shouldIncludeItemByCmsSiteFilter(item))
    .filter(item => shouldIncludeItemByMode(item))
    .filter(item => shouldIncludeItemByFileType(item))
}
const hasModeFilteredItems = items => getModeFilteredItems(items).length > 0
const showFileTypeFilter = computed(() => true)
const modeFilteredFiles = computed(() => {
  const list = Object.values(files.value || {})
  return getModeFilteredItems(list)
})

const filteredFiles = computed(() => {
  const list = Object.values(files.value || {})
  return getModeFilteredItems(list)
    .filter(m => shouldIncludeItemBySearchAndTags(m))
    .sort((a, b) => (b.uploadTime || 0) - (a.uploadTime || 0))
})

const uploadAcceptTypes = computed(() => {
  if (props.filesOnly)
    return [...allowedFileMimeTypes]
  if (props.includeFiles)
    return [...imageMimeTypes, ...allowedFileMimeTypes]
  return [...imageMimeTypes]
})

const mediaLoading = computed(() => {
  if (state.loaderHold)
    return true
  if (!edgeGlobal.edgeState.organizationDocPath)
    return true
  return !state.initialMediaLoadDone
})

const showEmptyMediaState = computed(() => {
  return mediaSnapshotReady.value
    && state.initialMediaLoadDone
    && filteredFiles.value.length === 0
})
const isDialogOpen = computed(() => state.showUpload || state.editMedia)

const mediaPickerShellClass = computed(() => {
  if (!props.selectMode)
    return 'w-full h-full min-h-0 flex flex-col mx-auto bg-background text-foreground rounded-[9.96px] px-0 border border-border/70 shadow-sm overflow-hidden'
  return 'w-full mx-auto bg-background text-foreground rounded-[9.96px] px-0 border border-border/70 shadow-sm flex flex-col h-[calc(80vh-3.5rem)] min-h-[520px]'
})

const mediaPlaceholderClass = computed(() => {
  const base = 'w-full rounded-lg border border-dashed border-border/70 bg-background/60 flex flex-col items-center justify-center gap-3 text-muted-foreground px-6 text-center'
  if (props.selectMode)
    return `${base} min-h-[calc(80vh-17rem)]`
  return `${base} min-h-[360px]`
})
const uploadActionLabel = computed(() => {
  if (props.filesOnly)
    return 'Upload Files'
  if (props.includeFiles)
    return 'Upload Media'
  return 'Upload Images'
})
const emptyStateHint = computed(() => {
  if (props.filesOnly)
    return 'Upload files to get started.'
  if (props.includeFiles)
    return 'Upload media to get started.'
  return 'Upload images to get started.'
})

const selectAll = computed(() => {
  return state.selectAll
})
const getDeletableSelectedIds = () => {
  return state.selected.filter((docId) => {
    const item = files.value?.[docId]
    return canDeleteMedia(item)
  })
}
const deleteConfirmCount = computed(() => {
  if (state.deleteConfirmMode === 'bulk')
    return getDeletableSelectedIds().length
  if (!state.deleteConfirmDocId)
    return 0
  const item = files.value?.[state.deleteConfirmDocId]
  return canDeleteMedia(item) ? 1 : 0
})
const canConfirmDelete = computed(() => {
  return Boolean(
    deleteConfirmCount.value > 0
    && state.deleteConfirmAcknowledge,
  )
})
const resetDeleteConfirmationState = () => {
  state.deleteConfirmAcknowledge = false
  state.deleteConfirmDocId = ''
  state.deleteConfirmMode = 'single'
}
const openDeleteConfirmSingle = (docId) => {
  const normalizedDocId = String(docId || '').trim()
  if (!normalizedDocId)
    return
  const item = files.value?.[normalizedDocId]
  if (!canDeleteMedia(item))
    return
  resetDeleteConfirmationState()
  state.deleteConfirmMode = 'single'
  state.deleteConfirmDocId = normalizedDocId
  state.deleteConfirmOpen = true
}
const openDeleteConfirmBulk = () => {
  if (!getDeletableSelectedIds().length)
    return
  resetDeleteConfirmationState()
  state.deleteConfirmMode = 'bulk'
  state.deleteConfirmOpen = true
}
const closeDeleteConfirm = () => {
  if (state.deleting)
    return
  state.deleteConfirmOpen = false
  resetDeleteConfirmationState()
}
const confirmDelete = async () => {
  if (state.deleting || !canConfirmDelete.value)
    return

  state.deleting = true
  const docIds = state.deleteConfirmMode === 'bulk'
    ? getDeletableSelectedIds()
    : (state.deleteConfirmDocId ? [state.deleteConfirmDocId] : [])

  try {
    for (const docId of docIds) {
      await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/files`, docId)
    }
    state.selected = state.selected.filter(docId => !docIds.includes(docId))
    if (state.deleteConfirmMode === 'single' && docIds.includes(String(state.workingDoc?.docId || '').trim())) {
      state.editMedia = false
      state.workingDoc = null
    }
    state.selectAll = false
    state.deleteConfirmOpen = false
    resetDeleteConfirmationState()
  }
  finally {
    state.deleting = false
  }
}

watch(selectAll, (newValue) => {
  if (newValue) {
    state.selected = filteredFiles.value
      .filter(item => canDeleteMedia(item))
      .map(item => item.docId)
  }
  else {
    state.selected = []
  }
})

const handleCheckboxChange = (checked, docId) => {
  console.log('Checkbox changed:', checked, docId)
  const item = files.value?.[docId]
  if (!canDeleteMedia(item))
    return
  if (checked && !state.selected.includes(docId)) {
    state.selected.push(docId)
  }
  else if (!checked) {
    state.selected = state.selected.filter(id => id !== docId)
  }
}

const getTagsFromMedia = computed(() => {
  const tagsSet = new Set()
  modeFilteredFiles.value.forEach((file) => {
    if (file.meta?.tags && Array.isArray(file.meta.tags)) {
      file.meta.tags.forEach(tag => tagsSet.add(tag))
    }
  })
  return Array.from(tagsSet).map(tag => ({ name: tag, title: tag }))
})
const schemas = {
  media: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}
const onSubmit = () => {
  state.workingDoc = null
  state.editMedia = false
}
const filters = computed(() => {
  const filters = [{ filterFields: ['name'], value: state.filter }]
  if (state.filterTags) {
    filters.push({ filterFields: ['meta.tags'], value: state.filterTags })
  }
  return filters
})
const clearTags = async () => {
  state.clearingTags = true
  console.log('Clearing tags')
  state.filterTags = []
  await nextTick()
  state.clearingTags = false
}
onBeforeMount(() => {
  state.mediaTypeFilter = normalizeMediaTypeFilter(props.mediaTypeDefault)
  state.fileTypeFilter = normalizeFileTypeFilter(props.fileTypeDefault)
  state.cmsSiteFilter = showCmsSiteFilter.value ? resolveCmsSiteFilterDefault() : '__all__'
  console.log('Default tags prop:', props.defaultTags)
  if (props.defaultTags && Array.isArray(props.defaultTags) && props.defaultTags.length > 0) {
    state.filterTags = [...props.defaultTags]
    state.tags = [...props.defaultTags]
  }
})
watch(
  () => [showCmsSiteFilter.value, props.site, props.cmsSiteFilterDefault],
  () => {
    state.cmsSiteFilter = showCmsSiteFilter.value ? resolveCmsSiteFilterDefault() : '__all__'
  },
  { immediate: false },
)
watch(fileTypeExtensionsForScope, (extensions) => {
  const normalized = normalizeFileTypeFilter(state.fileTypeFilter)
  if (normalized === 'all')
    return
  if (!extensions.length)
    return
  if (!extensions.includes(normalized))
    state.fileTypeFilter = 'all'
}, { immediate: true })

watch(
  () => [mediaSnapshotReady.value, filteredFiles.value.length],
  ([ready, count]) => {
    if (count > 0) {
      state.initialMediaLoadDone = true
      if (mediaEmptyFallbackTimer) {
        clearTimeout(mediaEmptyFallbackTimer)
        mediaEmptyFallbackTimer = null
      }
      return
    }
    if (state.initialMediaLoadDone || mediaEmptyFallbackTimer || !ready)
      return
    startInitialMediaFallbackTimer(2500)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (mediaEmptyFallbackTimer) {
    clearTimeout(mediaEmptyFallbackTimer)
    mediaEmptyFallbackTimer = null
  }
  if (mediaLoaderHoldTimer) {
    clearTimeout(mediaLoaderHoldTimer)
    mediaLoaderHoldTimer = null
  }
})

onMounted(() => {
  resetMediaLoadState()
  startInitialMediaFallbackTimer(8000)
})

onActivated(() => {
  resetMediaLoadState()
  startInitialMediaFallbackTimer(8000)
})

function canDeleteMedia(item) {
  if (!props.site)
    return true
  if (item?.meta?.cmssite && Array.isArray(item.meta.cmssite)) {
    return item.meta.cmssite.includes(props.site)
  }
  return false
}
const canEditWorkingDoc = computed(() => canDeleteMedia(state.workingDoc))

const itemClick = (item) => {
  if (props.selectMode) {
    const selectedUrl = isImageMediaItem(item)
      ? (edgeGlobal.getImage(item, 'public') || item?.r2URL || item?.r2Url || '')
      : (item?.r2URL || item?.r2Url || edgeGlobal.getImage(item, 'public') || '')
    emits('select', selectedUrl)
  }
  else {
    state.editMedia = true
    state.workingDoc = item
  }
}

const isLightName = (name) => {
  if (!name)
    return false
  return String(name).toLowerCase().includes('light')
}

const previewBackgroundClass = computed(() => (isLightName(state.workingDoc?.name) ? 'bg-neutral-900/90' : 'bg-neutral-100'))
const workingDocIsImage = computed(() => isImageMediaItem(state.workingDoc))
const workingDocIsPdf = computed(() => {
  const contentType = String(state.workingDoc?.contentType || '').toLowerCase()
  if (contentType === 'application/pdf')
    return true
  return getMediaExtension(state.workingDoc) === 'pdf'
})
const parsePageNumber = (key) => {
  const match = String(key || '').match(/^page-(\d+)$/i)
  return match?.[1] ? Number(match[1]) : Number.POSITIVE_INFINITY
}
const resolvePageVariants = (pageData = {}) => {
  const variants = Array.isArray(pageData?.variants) ? pageData.variants : []
  const thumbnail = variants.find(variant => String(variant || '').includes('/thumbnail')) || variants[0] || ''
  const highres = variants.find(variant => String(variant || '').includes('/highres')) || ''
  const publicVariant = variants.find(variant => String(variant || '').includes('/public')) || ''
  return {
    thumbnail: String(thumbnail || ''),
    highres: String(highres || ''),
    public: String(publicVariant || ''),
  }
}
const workingDocPdfPages = computed(() => {
  if (!workingDocIsPdf.value)
    return []
  const pageImages = state.workingDoc?.ccState?.cFImages || state.workingDoc?.ccState?.cfImages || {}
  return Object.entries(pageImages)
    .filter(([key]) => /^page-\d+$/i.test(String(key || '')))
    .sort((a, b) => parsePageNumber(a[0]) - parsePageNumber(b[0]))
    .map(([key, value]) => {
      const variants = resolvePageVariants(value || {})
      return {
        key: String(key),
        thumbnail: variants.thumbnail,
        preview: variants.highres || variants.public || variants.thumbnail,
      }
    })
})
const pdfPageIndex = ref(0)
const pdfThumbnailVisible = ref(false)
const loadedPdfThumbnailUrls = reactive({})
const preloadingPdfThumbnailUrls = new Set()
const loadedPdfPreviewUrls = reactive({})
const pdfPreviewLoadState = reactive({
  activeUrl: '',
  loading: false,
})
const normalizedPdfPageIndex = computed(() => {
  if (!workingDocPdfPages.value.length)
    return 0
  return Math.min(Math.max(pdfPageIndex.value, 0), workingDocPdfPages.value.length - 1)
})
const currentPdfPage = computed(() => {
  if (!workingDocPdfPages.value.length)
    return null
  return workingDocPdfPages.value[normalizedPdfPageIndex.value] || null
})
const pdfPagePickerItems = computed(() => {
  return workingDocPdfPages.value.map((_, index) => ({
    name: `Page ${index + 1}`,
    docId: String(index),
  }))
})
const pdfPagePickerValue = computed({
  get: () => String(normalizedPdfPageIndex.value),
  set: (value) => {
    const next = Number(value)
    if (!Number.isFinite(next))
      return
    if (!workingDocPdfPages.value.length) {
      pdfPageIndex.value = 0
      return
    }
    const clamped = Math.min(Math.max(Math.trunc(next), 0), workingDocPdfPages.value.length - 1)
    pdfThumbnailVisible.value = false
    pdfPageIndex.value = clamped
  },
})
const hasPdfPageNav = computed(() => workingDocPdfPages.value.length > 1)
const canGoPrevPdfPage = computed(() => normalizedPdfPageIndex.value > 0)
const canGoNextPdfPage = computed(() => normalizedPdfPageIndex.value < workingDocPdfPages.value.length - 1)
const hidePdfThumbnail = () => {
  pdfThumbnailVisible.value = false
}
const onPdfThumbnailLoaded = () => {
  const thumbnailUrl = String(currentPdfPage.value?.thumbnail || '')
  if (thumbnailUrl)
    loadedPdfThumbnailUrls[thumbnailUrl] = true
  pdfThumbnailVisible.value = true
}
const onPdfThumbnailErrored = () => {
  pdfThumbnailVisible.value = false
}
const preloadPdfThumbnails = () => {
  if (typeof window === 'undefined')
    return
  if (!state.editMedia || !workingDocIsPdf.value || !workingDocPdfPages.value.length)
    return
  workingDocPdfPages.value.forEach((page) => {
    const url = String(page?.thumbnail || '')
    if (!url || loadedPdfThumbnailUrls[url] || preloadingPdfThumbnailUrls.has(url))
      return
    preloadingPdfThumbnailUrls.add(url)
    const img = new window.Image()
    img.onload = () => {
      loadedPdfThumbnailUrls[url] = true
      preloadingPdfThumbnailUrls.delete(url)
    }
    img.onerror = () => {
      preloadingPdfThumbnailUrls.delete(url)
    }
    img.src = url
  })
}
const goPrevPdfPage = () => {
  if (!canGoPrevPdfPage.value)
    return
  hidePdfThumbnail()
  pdfPageIndex.value = normalizedPdfPageIndex.value - 1
}
const goNextPdfPage = () => {
  if (!canGoNextPdfPage.value)
    return
  hidePdfThumbnail()
  pdfPageIndex.value = normalizedPdfPageIndex.value + 1
}
const currentPdfPreviewLoaded = computed(() => {
  const previewUrl = String(currentPdfPage.value?.preview || '')
  if (!previewUrl)
    return true
  return Boolean(loadedPdfPreviewUrls[previewUrl])
})
const showPdfPreviewLoading = computed(() => {
  if (!workingDocIsPdf.value)
    return false
  const previewUrl = String(currentPdfPage.value?.preview || '')
  if (!previewUrl)
    return false
  return !currentPdfPreviewLoaded.value && pdfPreviewLoadState.activeUrl === previewUrl && pdfPreviewLoadState.loading
})
const markPdfPreviewLoaded = (url) => {
  const normalized = String(url || '').trim()
  if (!normalized)
    return
  loadedPdfPreviewUrls[normalized] = true
  if (pdfPreviewLoadState.activeUrl === normalized)
    pdfPreviewLoadState.loading = false
}
const normalizePreviewEventUrl = (event) => {
  const raw = event?.target?.currentSrc || event?.target?.src || ''
  return String(raw || '').trim()
}
const onPdfPreviewLoaded = (event, expectedUrl = '') => {
  const normalizedExpected = String(expectedUrl || '').trim()
  const normalizedFromEvent = normalizePreviewEventUrl(event)
  if (normalizedExpected)
    markPdfPreviewLoaded(normalizedExpected)
  if (normalizedFromEvent && normalizedFromEvent !== normalizedExpected)
    markPdfPreviewLoaded(normalizedFromEvent)
}
const onPdfPreviewErrored = (event, expectedUrl = '') => {
  const normalizedExpected = String(expectedUrl || '').trim()
  const normalizedFromEvent = normalizePreviewEventUrl(event)
  const normalized = normalizedExpected || normalizedFromEvent
  if (!normalized)
    return
  if (pdfPreviewLoadState.activeUrl === normalized)
    pdfPreviewLoadState.loading = false
}
const workingDocPreviewUrl = computed(() => {
  if (workingDocIsImage.value)
    return String(edgeGlobal.getImage(state.workingDoc, 'public') || '')
  if (workingDocIsPdf.value)
    return String(currentPdfPage.value?.preview || currentPdfPage.value?.thumbnail || '')
  return ''
})
watch(
  () => currentPdfPage.value?.preview,
  (nextPreview) => {
    const nextUrl = String(nextPreview || '')
    pdfPreviewLoadState.activeUrl = nextUrl
    if (!nextUrl) {
      pdfPreviewLoadState.loading = false
      return
    }
    pdfPreviewLoadState.loading = !loadedPdfPreviewUrls[nextUrl]
  },
  { immediate: true },
)
watch(
  () => currentPdfPage.value?.key,
  () => {
    hidePdfThumbnail()
    const thumbnailUrl = String(currentPdfPage.value?.thumbnail || '')
    if (thumbnailUrl && loadedPdfThumbnailUrls[thumbnailUrl])
      pdfThumbnailVisible.value = true
  },
  { immediate: true },
)
watch(
  () => [state.editMedia, state.workingDoc?.docId, workingDocPdfPages.value.length],
  () => {
    preloadPdfThumbnails()
  },
  { immediate: true },
)
watch(
  () => state.workingDoc?.docId,
  () => {
    pdfPageIndex.value = 0
    pdfThumbnailVisible.value = false
    pdfPreviewLoadState.activeUrl = ''
    pdfPreviewLoadState.loading = false
  },
)

const siteQueryValue = computed(() => resolveCmsSiteScopeValues())
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
    :class="mediaPickerShellClass"
  >
    <Sheet v-model:open="state.showUpload">
      <SheetContent side="top" class="w-full max-w-none sm:max-w-none max-w-2xl bg-card text-foreground border border-border">
        <SheetHeader>
          <SheetTitle />
          <SheetDescription />
        </SheetHeader>
        <edge-shad-form class="px-2 sm:px-4">
          <edge-shad-select-tags
            v-model="state.tags"
            :items="getTagsFromMedia"
            name="tags"
            placeholder="Select tags"
            :allow-additions="true"
            class="w-full max-w-[800px] mx-auto mb-4 text-foreground"
          />
        </edge-shad-form>
        <div class="relative">
          <edge-auto-file-upload
            v-model="state.file"
            name="file"
            :multiple="true"
            :accept="uploadAcceptTypes"
            file-path="images"
            :r2="true"
            :disabled="state.tags.length === 0"
            disabled-text="Tags are required"
            class="w-full mx-auto border-dashed border-slate-300/70 bg-gradient-to-br from-slate-900/90 via-slate-800/70 to-slate-700/50 dark:from-slate-900/70 dark:via-slate-800/70 dark:to-slate-700/70 border text-white dark:text-white/90 py-10 rounded-[20px] my-3 shadow-lg shadow-slate-900/30"
            :extra-meta="{ tags: state.tags, cmsmedia: true, cmssite: [props.site] }"
            :extra-meta-resolver="resolveUploadExtraMeta"
          >
            <template #title>
              <div class="flex items-center gap-2 justify-center gap-5 text-white dark:text-slate-100 drop-shadow">
                <div>
                  <ImagePlus class="h-10 w-10" />
                </div>
                <div>
                  <h1 class="text-4xl font-[700] leading-none">
                    Drag & Drop
                  </h1>
                </div>
                <div class="text-xl pt-2 font-sans font-semibold">
                  OR
                </div>
              </div>
            </template>
            <template #description>
              <edge-shad-button class="bg-secondary mt-3 text-primary shadow-sm">
                {{ uploadActionLabel }}
              </edge-shad-button>
              <div class="hidden" />
            </template>
          </edge-auto-file-upload>
          <div
            v-if="state.tags.length === 0"
            class="pointer-events-auto absolute inset-0 z-20 space-y-2 rounded-[20px] border border-dashed border-border/70 bg-background/85 dark:bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6 text-foreground"
          >
            <div class="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Tags are required
            </div>
            <div class="text-sm text-slate-600 dark:text-slate-300">
              Add tags above to enable upload
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
    <edge-dashboard
      :filter="state.filter"
      sort-field="uploadTime"
      query-field="meta.cmssite"
      :filters="filters"
      :query-value="siteQueryValue"
      query-operator="array-contains-any"
      header-class=""
      sort-direction="desc"
      class="w-full h-full flex-1 min-h-0 overflow-hidden flex flex-col border-none shadow-none bg-background"
      collection="files"
    >
      <template #header>
        <div class="sticky top-0 z-20 border-b border-border/70 bg-background/95 backdrop-blur-sm pb-2">
          <edge-menu class="bg-transparent text-foreground border-none shadow-none px-2 rounded-none gap-1">
            <template #start>
              <div />
            </template>
            <template #center>
              <div class="w-full px-0">
                <edge-shad-form>
                  <div class="flex flex-col md:flex-row md:items-center gap-2 w-full">
                    <div v-if="showCmsSiteFilter" class="md:w-[190px] md:min-w-[190px]">
                      <edge-shad-select
                        v-model="state.cmsSiteFilter"
                        :items="cmsSiteFilterItems"
                        item-title="title"
                        item-value="name"
                        name="cmsSiteFilter"
                        class="text-foreground w-full"
                        placeholder="Source"
                      />
                    </div>
                    <div class="shrink-0">
                      <edge-shad-button
                        class="bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                        @click="state.showUpload = true"
                      >
                        <ImagePlus class="h-5 w-5 mr-2" />
                        {{ uploadActionLabel }}
                      </edge-shad-button>
                    </div>
                    <div class="md:flex-1 md:min-w-[220px]">
                      <edge-shad-select
                        v-if="!state.clearingTags"
                        v-model="state.filterTags"
                        :multiple="true"
                        name="tags"
                        class="text-foreground w-full"
                        :items="getTagsFromMedia"
                        placeholder="Filter Tags"
                      >
                        <template v-if="state.filterTags.length > 0" #icon>
                          <X class="h-5 w-5 text-muted-foreground cursor-pointer" @click="clearTags" />
                        </template>
                      </edge-shad-select>
                    </div>
                    <div class="md:flex-1 md:min-w-[220px]">
                      <edge-shad-input
                        v-model="state.filter"
                        label=""
                        name="filter"
                        class="text-foreground w-full"
                        placeholder="Search"
                      />
                    </div>
                    <div v-if="showMediaTypeFilter" class="md:w-[170px] md:min-w-[170px]">
                      <edge-shad-select
                        v-model="state.mediaTypeFilter"
                        :items="mediaTypeFilterItems"
                        item-title="title"
                        item-value="name"
                        name="mediaTypeFilter"
                        class="text-foreground w-full"
                        placeholder="Media type"
                      />
                    </div>
                    <div v-if="showFileTypeFilter" class="md:w-[170px] md:min-w-[170px]">
                      <edge-shad-select
                        v-model="state.fileTypeFilter"
                        :items="fileTypeFilterItems"
                        item-title="title"
                        item-value="name"
                        class="text-foreground w-full"
                        placeholder="File type"
                      />
                    </div>
                  </div>
                </edge-shad-form>
              </div>
            </template>
            <template #end>
              <div />
            </template>
          </edge-menu>
          <div v-if="!selectMode" class="flex flex-wrap items-center justify-between gap-2 mt-2 px-3">
            <div class="flex items-center gap-2">
              <div class="text-xs text-slate-600 dark:text-slate-300">
                {{ state.selected.length }} selected
              </div>
            </div>
            <div class="flex items-center gap-2">
              <edge-shad-button
                class="w-[140px] h-[30px] rounded bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-500 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                @click="state.selectAll = !state.selectAll"
              >
                <Square v-if="!state.selectAll" class="h-5 w-5" />
                <SquareCheckBig v-else class="h-5 w-5" />
                {{ state.selectAll ? 'Deselect All' : 'Select All' }}
              </edge-shad-button>
              <edge-shad-button
                variant="destructive"
                :disabled="state.deleting || getDeletableSelectedIds().length === 0"
                class="h-[30px]"
                @click="openDeleteConfirmBulk"
              >
                <Loader2 v-if="state.deleting" class="animate-spin h-5 w-5 mr-2" />
                Delete Selected
              </edge-shad-button>
            </div>
          </div>
        </div>
      </template>
      <template #list="slotProps">
        <div class="w-full h-full min-h-0 pt-3 flex flex-col overflow-hidden">
          <div v-if="mediaLoading" :class="mediaPlaceholderClass">
            <Loader2 class="h-7 w-7 animate-spin" />
            <div class="text-sm font-medium">
              Loading media...
            </div>
          </div>

          <div
            v-else-if="showEmptyMediaState || !hasModeFilteredItems(slotProps.filtered)"
            :class="mediaPlaceholderClass"
          >
            <div class="text-sm font-medium">
              No media found
            </div>
            <div class="text-xs">
              {{ emptyStateHint }}
            </div>
          </div>

          <div
            v-else
            class="flex-1 min-h-0"
            :class="isDialogOpen ? 'overflow-hidden' : 'overflow-y-auto'"
          >
            <div
              class="mx-auto px-0 pb-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            >
              <div
                v-for="item in getModeFilteredItems(slotProps.filtered)"
                :key="item.docId"
                class="w-full cursor-pointer"
                @click="itemClick(item)"
              >
                <edge-cms-media-card
                  :item="item"
                  :selected="state.selected.includes(item.docId)"
                  class="block w-full h-full"
                  :select-mode="props.selectMode"
                  :can-delete="canDeleteMedia(item)"
                  @select="(checked, docId) => handleCheckboxChange(checked, docId)"
                  @delete="(docId) => openDeleteConfirmSingle(docId)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-dashboard>
    <edge-shad-dialog v-model="state.deleteConfirmOpen">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle class="text-left">
            Confirm Permanent Media Deletion
          </DialogTitle>
          <DialogDescription class="text-left">
            This action permanently deletes media and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100">
            Deleting media that is currently used in pages, posts, blocks, or settings can break layouts and content.
            Proceed only if you are sure.
          </div>
          <div class="text-sm text-foreground">
            You are about to delete
            <span class="font-semibold">{{ deleteConfirmCount }}</span>
            {{ deleteConfirmCount === 1 ? 'item' : 'items' }}.
          </div>
          <label class="flex items-start gap-2 text-sm text-foreground">
            <input
              v-model="state.deleteConfirmAcknowledge"
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-border"
            >
            <span>I understand this may break content where this media is in use.</span>
          </label>
        </div>
        <DialogFooter class="pt-4 flex gap-2">
          <edge-shad-button variant="outline" :disabled="state.deleting" @click="closeDeleteConfirm">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            class="text-white"
            :disabled="state.deleting || !canConfirmDelete"
            @click="confirmDelete"
          >
            <Loader2 v-if="state.deleting" class="mr-2 h-4 w-4 animate-spin" />
            Permanently Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <Sheet v-model:open="state.editMedia">
      <SheetContent
        side="right"
        class="!w-screen !max-w-none sm:!max-w-none md:!max-w-none lg:!max-w-none !h-screen p-0 bg-card text-foreground border-0"
      >
        <div class="h-full w-full grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div class="relative h-[46vh] md:h-full border-b md:border-b-0 md:border-r border-border bg-background">
            <div class="absolute inset-0 flex items-center justify-center overflow-hidden p-4" :class="previewBackgroundClass">
              <template v-if="workingDocIsPdf && currentPdfPage">
                <img
                  v-if="currentPdfPage.thumbnail"
                  :key="`${currentPdfPage.key}-${currentPdfPage.thumbnail}`"
                  :src="currentPdfPage.thumbnail"
                  alt=""
                  class="absolute inset-0 h-full w-full object-contain transition-opacity duration-150"
                  :class="pdfThumbnailVisible ? 'opacity-100' : 'opacity-0'"
                  @load="onPdfThumbnailLoaded"
                  @error="onPdfThumbnailErrored"
                >
                <img
                  v-if="currentPdfPage.preview"
                  :key="`${currentPdfPage.key}-${currentPdfPage.preview}`"
                  :src="currentPdfPage.preview"
                  alt=""
                  class="absolute inset-0 h-full w-full object-contain transition-opacity duration-200"
                  :class="currentPdfPreviewLoaded ? 'opacity-100' : 'opacity-0'"
                  @load="onPdfPreviewLoaded($event, currentPdfPage.preview)"
                  @error="onPdfPreviewErrored($event, currentPdfPage.preview)"
                >
                <div v-if="showPdfPreviewLoading" class="absolute inset-0 flex items-center justify-center bg-black/10">
                  <div class="rounded-md bg-black/65 px-3 py-2 text-white flex items-center gap-2 text-xs">
                    <Loader2 class="h-4 w-4 animate-spin" />
                    Loading page…
                  </div>
                </div>
              </template>
              <img
                v-else-if="workingDocPreviewUrl"
                :src="workingDocPreviewUrl"
                alt=""
                class="max-h-full max-w-full h-auto w-auto object-contain"
              >
              <FileText v-else class="h-20 w-20 text-slate-500 dark:text-slate-300" />
              <template v-if="workingDocIsPdf && workingDocPdfPages.length">
                <edge-shad-button
                  v-if="hasPdfPageNav"
                  size="icon"
                  variant="secondary"
                  class="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9"
                  :disabled="!canGoPrevPdfPage"
                  @click="goPrevPdfPage"
                >
                  <ChevronLeft class="h-4 w-4" />
                </edge-shad-button>
                <edge-shad-button
                  v-if="hasPdfPageNav"
                  size="icon"
                  variant="secondary"
                  class="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9"
                  :disabled="!canGoNextPdfPage"
                  @click="goNextPdfPage"
                >
                  <ChevronRight class="h-4 w-4" />
                </edge-shad-button>
                <div class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-[11px] flex items-center gap-2">
                  <edge-shad-select
                    v-if="hasPdfPageNav"
                    v-model="pdfPagePickerValue"
                    :items="pdfPagePickerItems"
                    item-title="name"
                    item-value="docId"
                    class="w-[122px]"
                    placeholder="Page"
                    trigger-class="h-7 min-h-7 px-2 py-1 text-[11px] bg-white/10 border-white/25 text-white"
                  />
                  <span class="text-white">Page {{ normalizedPdfPageIndex + 1 }} / {{ workingDocPdfPages.length }}</span>
                </div>
              </template>
            </div>
            <div class="absolute left-4 top-4 max-w-[calc(100%-5rem)] rounded-md bg-black/65 px-3 py-2 text-xs text-white">
              <div class="truncate">
                Original: <span class="font-semibold">{{ state.workingDoc?.fileName }}</span>
              </div>
              <div>Size: <span class="font-semibold">{{ (state.workingDoc?.fileSize / 1024).toFixed(2) }} KB</span></div>
            </div>
          </div>

          <div class="h-[54vh] md:h-full flex flex-col bg-card">
            <div class="shrink-0 border-b border-border px-4 py-3 pr-14">
              <h3 class="text-sm font-semibold truncate">
                {{ state.workingDoc?.fileName }}
              </h3>
            </div>
            <edge-editor
              v-if="state.workingDoc"
              :doc-id="state.workingDoc.docId"
              collection="files"
              :new-doc-schema="state.newDocs.media"
              :schema="schemas.media"
              :show-footer="false"
              :show-header="false"
              class="w-full px-0 mx-0 bg-transparent flex-1 min-h-0"
              :save-function-override="onSubmit"
              card-content-class="mx-0 px-0 h-full"
            >
              <template #main="slotProps">
                <div class="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
                  <div
                    v-if="!canEditWorkingDoc"
                    class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                  >
                    View only: this media item is not owned by this site.
                  </div>
                  <edge-shad-input
                    v-model="slotProps.workingDoc.name"
                    name="name"
                    label="Display Name"
                    class="w-full"
                    placeholder="File name"
                    :disabled="!canEditWorkingDoc"
                  />
                  <edge-shad-select-tags
                    v-model="slotProps.workingDoc.meta.tags"
                    :items="getTagsFromMedia"
                    label="Tags"
                    name="tags"
                    placeholder="Select tags"
                    :allow-additions="true"
                    class="w-full text-foreground"
                    :disabled="!canEditWorkingDoc"
                  />
                </div>
                <SheetFooter class="shrink-0 border-t border-border p-4 flex justify-between gap-3">
                  <edge-shad-button variant="destructive" class="text-white" @click="state.editMedia = false">
                    Cancel
                  </edge-shad-button>
                  <edge-shad-button
                    :disabled="slotProps.submitting || !canEditWorkingDoc"
                    :type="canEditWorkingDoc ? 'submit' : 'button'"
                    class="w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                  >
                    <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
                    {{ canEditWorkingDoc ? 'Update' : 'Read Only' }}
                  </edge-shad-button>
                </SheetFooter>
              </template>
            </edge-editor>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style>
.data-\[state\=on\]\:bg-accent[data-state="on"] {
  background-color: #0f172a;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
</style>
