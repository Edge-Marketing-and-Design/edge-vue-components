<script setup>
import { FileText, Search } from 'lucide-vue-next'

const props = defineProps({
  files: {
    type: [Array, Object],
    required: false,
    default: () => [],
  },
  selectMode: {
    type: Boolean,
    required: false,
    default: false,
  },
  selectedValue: {
    type: [String, Number, null],
    required: false,
    default: null,
  },
})

const emits = defineEmits(['select'])
const edgeFirebase = inject('edgeFirebase')
const {
  getPublicationProgressLabel,
  getPublicationThumbnailUrl,
} = usePublicationMedia()

const state = reactive({
  filter: '',
  files: [],
  loading: false,
})

const normalizeText = value => String(value || '').trim().toLowerCase()

const isPublicationFile = (file) => {
  return file?.meta?.flipbook === true
}

const hasProvidedFiles = computed(() => {
  if (Array.isArray(props.files))
    return props.files.length > 0
  return !!(props.files && typeof props.files === 'object' && Object.keys(props.files).length > 0)
})

const normalizedFiles = computed(() => {
  const sourceFiles = hasProvidedFiles.value ? props.files : state.files
  if (Array.isArray(sourceFiles))
    return sourceFiles.map((item) => {
      return {
        ...(item || {}),
        docId: String(item?.docId || '').trim(),
      }
    })
  if (sourceFiles && typeof sourceFiles === 'object') {
    return Object.entries(sourceFiles).map(([docId, item]) => ({
      ...(item || {}),
      docId: String(item?.docId || docId || '').trim(),
    }))
  }
  return []
})

const publicationFiles = computed(() => {
  return normalizedFiles.value
    .filter(isPublicationFile)
    .sort((a, b) => (b.uploadTime || 0) - (a.uploadTime || 0))
})

const filteredPublications = computed(() => {
  const query = normalizeText(state.filter)
  if (!query)
    return publicationFiles.value

  return publicationFiles.value.filter((item) => {
    const name = normalizeText(item?.name)
    const fileName = normalizeText(item?.fileName)
    const docId = normalizeText(item?.docId)
    return name.includes(query) || fileName.includes(query) || docId.includes(query)
  })
})

const getPreviewUrl = (item) => {
  const publicationThumbnail = getPublicationThumbnailUrl(item)
  if (publicationThumbnail)
    return publicationThumbnail
  const firstPage = Array.isArray(item?.pages) ? item.pages[0] : null
  if (typeof firstPage === 'string')
    return firstPage

  if (firstPage && typeof firstPage === 'object') {
    return firstPage.thumbnail || firstPage.preview || firstPage.url || ''
  }

  return ''
}

const getDisplayName = (item) => {
  return String(item?.name || item?.fileName || item?.docId || 'Untitled publication').trim()
}

const isSelected = (item) => {
  const selected = String(props.selectedValue || '').trim()
  if (!selected)
    return false
  return selected === String(item?.docId || '').trim() || selected === String(item?.slug || '').trim()
}

const getProgressLabel = item => getPublicationProgressLabel(item)

const selectPublication = (item) => {
  if (!props.selectMode)
    return

  emits('select', String(item?.docId || ''), item)
}

onBeforeMount(async () => {
  if (hasProvidedFiles.value || !edgeFirebase || !edgeGlobal.edgeState.organizationDocPath)
    return

  state.loading = true
  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    await staticSearch.getData(`${edgeGlobal.edgeState.organizationDocPath}/files`)
    state.files = Object.values(staticSearch.results?.data || {})
  }
  finally {
    state.loading = false
  }
})
</script>

<template>
  <div class="w-full space-y-4">
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <edge-shad-input
        v-model="state.filter"
        name="publicationFilter"
        class="w-full pl-9"
        placeholder="Search publications by name"
      />
    </div>

    <div
      v-if="state.loading"
      class="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground"
    >
      Loading publications...
    </div>

    <div
      v-else-if="filteredPublications.length > 0"
      class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <Card
        v-for="item in filteredPublications"
        :key="item.docId"
        class="overflow-hidden border transition-colors"
        :class="isSelected(item) ? 'border-primary ring-1 ring-primary/50' : 'border-border hover:border-primary/40'"
      >
        <button
          type="button"
          class="block w-full text-left"
          @click="selectPublication(item)"
        >
          <div class="relative flex h-40 items-center justify-center bg-muted/50 px-3">
            <img
              v-if="getPreviewUrl(item)"
              :src="getPreviewUrl(item)"
              class="max-h-full w-auto max-w-full object-contain"
              alt=""
            >
            <div v-else class="flex flex-col items-center justify-center text-muted-foreground">
              <FileText class="h-9 w-9" />
              <span class="mt-1 text-xs font-medium uppercase tracking-wide">PDF</span>
            </div>
          </div>
          <CardContent class="space-y-1 p-3">
            <div class="line-clamp-1 text-sm font-semibold text-foreground" :title="getDisplayName(item)">
              {{ getDisplayName(item) }}
            </div>
            <div class="line-clamp-1 text-xs text-muted-foreground" :title="item.fileName || item.docId">
              {{ item.fileName || item.docId }}
            </div>
            <div
              v-if="getProgressLabel(item) && getProgressLabel(item) !== 'Complete'"
              class="line-clamp-1 text-xs font-medium text-sky-700 dark:text-sky-300"
            >
              {{ getProgressLabel(item) }}
            </div>
          </CardContent>
        </button>
      </Card>
    </div>

    <Card v-else class="border-dashed">
      <CardContent class="py-8 text-center text-sm text-muted-foreground">
        No publications match your search.
      </CardContent>
    </Card>
  </div>
</template>
