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
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)
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

const shouldIncludeItemByMode = (item) => {
  if (props.filesOnly)
    return isAllowedFileItem(item)
  if (props.includeFiles)
    return isImageMediaItem(item) || isAllowedFileItem(item)
  return isImageMediaItem(item)
}

const getModeFilteredItems = (items) => {
  return (items || []).filter(item => shouldIncludeItemByMode(item))
}
const hasModeFilteredItems = items => getModeFilteredItems(items).length > 0
const modeFilteredFiles = computed(() => {
  const list = Object.values(files.value || {})
  return getModeFilteredItems(list)
})

const filteredFiles = computed(() => {
  const list = Object.values(files.value || {})
  return list
    .filter(item => shouldIncludeItemByMode(item))
    .filter(m =>
      !state.filter || m.name?.toLowerCase().includes(state.filter.toLowerCase()),
    )
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

const mediaPickerShellClass = computed(() => {
  if (!props.selectMode)
    return 'w-full mx-auto bg-background text-foreground rounded-[9.96px] px-0 border border-border/70 shadow-sm'
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

watch(selectAll, (newValue) => {
  if (newValue) {
    state.selected = filteredFiles.value.map(item => item.docId)
  }
  else {
    state.selected = []
  }
})

const handleCheckboxChange = (checked, docId) => {
  console.log('Checkbox changed:', checked, docId)
  if (checked && !state.selected.includes(docId)) {
    state.selected.push(docId)
  }
  else if (!checked) {
    state.selected = state.selected.filter(id => id !== docId)
  }
}

const deleteSelected = async () => {
  console.log('Deleting selected files:', state.selected)
  state.deleting = true
  for (const docId of state.selected) {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/files`, docId)
  }
  state.selected = []
  state.selectAll = false
  state.deleting = false
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
  console.log('Default tags prop:', props.defaultTags)
  if (props.defaultTags && Array.isArray(props.defaultTags) && props.defaultTags.length > 0) {
    state.filterTags = [...props.defaultTags]
    state.tags = [...props.defaultTags]
  }
})

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

const canDeleteMedia = (item) => {
  if (!props.site)
    return true
  if (item?.meta?.cmssite && Array.isArray(item.meta.cmssite)) {
    return item.meta.cmssite.includes(props.site)
  }
  return false
}

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
const hasPdfPageNav = computed(() => workingDocPdfPages.value.length > 1)
const canGoPrevPdfPage = computed(() => normalizedPdfPageIndex.value > 0)
const canGoNextPdfPage = computed(() => normalizedPdfPageIndex.value < workingDocPdfPages.value.length - 1)
const goPrevPdfPage = () => {
  if (!canGoPrevPdfPage.value)
    return
  pdfPageIndex.value = normalizedPdfPageIndex.value - 1
}
const goNextPdfPage = () => {
  if (!canGoNextPdfPage.value)
    return
  pdfPageIndex.value = normalizedPdfPageIndex.value + 1
}
const workingDocPreviewUrl = computed(() => {
  if (workingDocIsImage.value)
    return String(edgeGlobal.getImage(state.workingDoc, 'public') || '')
  if (workingDocIsPdf.value)
    return String(currentPdfPage.value?.preview || currentPdfPage.value?.thumbnail || '')
  return ''
})
watch(
  () => state.workingDoc?.docId,
  () => {
    pdfPageIndex.value = 0
  },
)

const siteQueryValue = computed(() => {
  if (!props.site)
    return []
  return props.includeCmsAll ? ['all', props.site] : [props.site]
})
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
      sort-direction="desc" class="w-full flex-1 border-none shadow-none bg-background min-h-0"
      collection="files"
    >
      <template #header>
        <edge-menu class="bg-transparent text-foreground border-none shadow-none px-2 rounded-none gap-1">
          <template #start>
            <div />
          </template>
          <template #center>
            <div class="w-full px-0">
              <edge-shad-form>
                <div class="flex flex-col md:flex-row md:items-center gap-2 w-full">
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
                </div>
              </edge-shad-form>
            </div>
          </template>
          <template #end>
            <div />
          </template>
        </edge-menu>
        <div v-if="!selectMode" class="flex flex-wrap items-center justify-between gap-2 mt-2 px-3">
          <div class="text-xs text-slate-600 dark:text-slate-300">
            {{ state.selected.length }} selected
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
              :disabled="state.deleting || state.selected.length === 0"
              class="h-[30px]"
              @click="deleteSelected"
            >
              <Loader2 v-if="state.deleting" class="animate-spin h-5 w-5 mr-2" />
              Delete Selected
            </edge-shad-button>
          </div>
        </div>
      </template>
      <template #list="slotProps">
        <div class="w-full h-full min-h-full">
          <div v-if="mediaLoading" :class="mediaPlaceholderClass">
            <Loader2 class="h-7 w-7 animate-spin" />
            <div class="text-sm font-medium">
              Loading media...
            </div>
          </div>
          <div v-else-if="showEmptyMediaState || !hasModeFilteredItems(slotProps.filtered)" :class="mediaPlaceholderClass">
            <div class="text-sm font-medium">
              No media found
            </div>
            <div class="text-xs">
              {{ emptyStateHint }}
            </div>
          </div>
          <div v-else class="mx-auto px-0 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <div v-for="item in getModeFilteredItems(slotProps.filtered)" :key="item.docId" class="w-full cursor-pointer" @click="itemClick(item)">
              <edge-cms-media-card
                :item="item"
                :selected="state.selected.includes(item.docId)"
                class="block w-full h-full"
                :select-mode="props.selectMode"
                :can-delete="canDeleteMedia(item)"
                @select="(checked, docId) => handleCheckboxChange(checked, docId)"
                @delete="(docId) => slotProps.deleteItem(docId)"
              />
            </div>
          </div>
        </div>
      </template>
    </edge-dashboard>
    <Sheet v-model:open="state.editMedia">
      <SheetContent class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl bg-card text-foreground border border-border">
        <SheetHeader>
          <SheetTitle>{{ state.workingDoc?.fileName }}</SheetTitle>
          <SheetDescription>
            <div class="h-[450px] rounded-lg mb-4 flex items-center justify-center overflow-hidden relative" :class="previewBackgroundClass">
              <img
                v-if="workingDocPreviewUrl"
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
                <div class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-white">
                  Page {{ normalizedPdfPageIndex + 1 }} / {{ workingDocPdfPages.length }}
                </div>
              </template>
            </div>
            Original Name: <span class="font-semibold">{{ state.workingDoc?.fileName }}</span>, Size: <span class="font-semibold">{{ (state.workingDoc?.fileSize / 1024).toFixed(2) }} KB</span>
          </SheetDescription>
        </SheetHeader>

        <edge-editor
          v-if="state.workingDoc"
          :doc-id="state.workingDoc.docId"
          collection="files"
          :new-doc-schema="state.newDocs.media"
          :schema="schemas.media"
          :show-footer="false"
          :show-header="false"
          class="w-full px-0 mx-0 bg-transparent"
          :save-function-override="onSubmit"
          card-content-class="mx-0 px-0"
        >
          <template #main="slotProps">
            <div class="p-6 space-y-4  h-[calc(100vh-628px)] overflow-y-auto">
              <edge-shad-input
                v-model="slotProps.workingDoc.name"
                name="name"
                label="Display Name"
                class="w-full mb-4"
                placeholder="File name"
              />
              <edge-shad-select-tags
                v-model="slotProps.workingDoc.meta.tags"
                :items="getTagsFromMedia"
                label="Tags"
                name="tags"
                placeholder="Select tags"
                :allow-additions="true"
                class="w-full max-w-[800px] mx-auto mb-5 text-foreground"
              />
            </div>
            <SheetFooter class="pt-2 flex justify-between gap-3">
              <edge-shad-button variant="destructive" class="text-white" @click="state.editMedia = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button
                :disabled="slotProps.submitting"
                type="submit"
                class="w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
                Update
              </edge-shad-button>
            </SheetFooter>
          </template>
        </edge-editor>
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
