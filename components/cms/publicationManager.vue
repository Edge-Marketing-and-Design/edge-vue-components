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

const state = reactive({
  filter: '',
})

const normalizeText = value => String(value || '').trim().toLowerCase()

const hasImageExtension = (value) => {
  const normalized = normalizeText(value)
  return normalized.endsWith('.jpg')
    || normalized.endsWith('.jpeg')
    || normalized.endsWith('.png')
    || normalized.endsWith('.gif')
    || normalized.endsWith('.webp')
    || normalized.endsWith('.svg')
    || normalized.endsWith('.avif')
}

const isImageMimeType = value => normalizeText(value).startsWith('image/')

const isPublicationFile = (file) => {
  if (!file)
    return false

  if (file?.meta?.flipbook === true)
    return true

  const contentType = normalizeText(file?.contentType)
  const fileName = normalizeText(file?.fileName)
  const filePath = normalizeText(file?.filePath)
  const r2Url = normalizeText(file?.r2URL || file?.r2Url)
  const hasCcState = !!file?.ccState
  const looksLikePdf = contentType.includes('pdf')
    || fileName.endsWith('.pdf')
    || filePath.includes('/pdfs/')
    || filePath.startsWith('pdfs/')
    || r2Url.endsWith('.pdf')

  if (hasCcState || looksLikePdf)
    return true

  if (isImageMimeType(contentType))
    return false

  if (filePath.includes('/images/') || filePath.startsWith('images/'))
    return false

  if (hasImageExtension(fileName) || hasImageExtension(r2Url))
    return false

  return false
}

const normalizedFiles = computed(() => {
  if (Array.isArray(props.files))
    return props.files.map((item) => {
      return {
        ...(item || {}),
        docId: String(item?.docId || '').trim(),
      }
    })
  if (props.files && typeof props.files === 'object') {
    return Object.entries(props.files).map(([docId, item]) => ({
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
  const variants = item?.ccState?.cfImages?.['page-001']?.variants
  if (Array.isArray(variants) && variants.length > 0) {
    const thumbnail = variants.find(url => String(url || '').includes('/thumbnail'))
    return thumbnail || variants[0] || ''
  }

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

const isSelected = item => String(props.selectedValue || '') === String(item?.docId || '')

const selectPublication = (item) => {
  if (!props.selectMode)
    return

  emits('select', String(item?.docId || ''), item)
}
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
      v-if="filteredPublications.length > 0"
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
