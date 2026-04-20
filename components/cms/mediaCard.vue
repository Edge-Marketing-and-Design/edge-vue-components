<script setup>
import { File, FileArchive, FileSpreadsheet, FileText, ImagePlus, Loader2, Square, SquareCheckBig, Trash } from 'lucide-vue-next'
const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  selectMode: {
    type: Boolean,
    default: false,
  },
  canDelete: {
    type: Boolean,
    default: true,
  },
})
const emits = defineEmits(['select', 'delete'])

const timeAgo = (timestamp) => {
  if (!timestamp)
    return ''

  const now = Date.now()
  const difference = now - timestamp
  const seconds = Math.floor(difference / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return `${seconds} second${seconds > 1 ? 's' : ''} ago`
}

const isLightName = (name) => {
  if (!name)
    return false
  return String(name).toLowerCase().includes('light')
}

const previewBackgroundClass = computed(() => {
  const displayName = props.item?.name
  return isLightName(displayName) ? 'bg-neutral-900/90' : 'bg-neutral-100'
})

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif']
const getMediaExtension = () => {
  const fileName = String(props.item?.fileName || props.item?.name || '').toLowerCase()
  const fileNameMatch = fileName.match(/\.([a-z0-9]+)$/i)
  if (fileNameMatch?.[1])
    return fileNameMatch[1].toLowerCase()
  const r2Url = String(props.item?.r2URL || props.item?.r2Url || '').toLowerCase()
  const sanitizedPath = r2Url.split('?')[0]
  const pathMatch = sanitizedPath.match(/\.([a-z0-9]+)$/i)
  return pathMatch?.[1] ? pathMatch[1].toLowerCase() : ''
}
const isImageItem = computed(() => {
  const contentType = String(props.item?.contentType || '').toLowerCase()
  if (contentType.startsWith('image/'))
    return true
  return imageExtensions.includes(getMediaExtension())
})
const isFileItem = computed(() => !isImageItem.value)
const fileTypeLabel = computed(() => {
  const ext = getMediaExtension()
  if (!ext)
    return 'FILE'
  return ext.toUpperCase()
})
const fileIconComponent = computed(() => {
  const ext = getMediaExtension()
  if (ext === 'pdf')
    return FileText
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext))
    return FileText
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext))
    return FileSpreadsheet
  if (['zip'].includes(ext))
    return FileArchive
  if (['ppt', 'pptx', 'odp'].includes(ext))
    return FileText
  return File
})
const thumbnailUrl = computed(() => {
  if (!isImageItem.value)
    return ''
  return edgeGlobal.getImage(props.item, 'thumbnail') || ''
})
const mediaCopyUrl = computed(() => {
  if (isFileItem.value)
    return String(props.item?.r2URL || props.item?.r2Url || '')
  return String(edgeGlobal.getImage(props.item, 'public') || '')
})
</script>

<template>
  <Card
    class="w-full group overflow-hidden rounded-2xl border bg-card hover:shadow-md hover:border-muted-foreground/20 transition-all"
  >
    <div class="relative w-full h-[200px] flex items-center justify-center" :class="previewBackgroundClass">
      <div class="z-10 absolute w-full flex inset-0 bg-black/10 dark:bg-black/30 justify-between items-start p-2">
        <edge-shad-button
          v-if="!props.selectMode"
          size="icon"
          class="bg-slate-900 text-white hover:bg-slate-800 shadow-sm dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
          @click.stop="emits('select', !props.selected, item.docId)"
        >
          <Square v-if="!props.selected" class="!w-5 !h-5" />
          <SquareCheckBig v-else class="!w-5 !h-5" />
        </edge-shad-button>
        <div v-else class="w-5 h-5" />
        <edge-shad-button
          v-if="props.canDelete"
          size="icon"
          class="bg-destructive/80 text-destructive-foreground hover:bg-destructive h-9 w-9 sm:h-10 sm:w-10 rounded-xl border border-destructive/40 shadow-sm"
          @click.stop="emits('delete', item.docId)"
        >
          <Trash class="!h-5 !w-5" />
        </edge-shad-button>
      </div>
      <div v-if="isFileItem" class="absolute inset-0 m-auto flex h-full w-full items-center justify-center">
        <component :is="fileIconComponent" class="h-24 w-24 text-slate-600 dark:text-slate-300" />
        <div class="absolute bottom-3 right-3 rounded-md bg-red-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
          {{ fileTypeLabel }}
        </div>
      </div>
      <Loader2
        v-else-if="!thumbnailUrl"
        class="absolute inset-0 m-auto animate-spin h-6 w-6 text-muted-foreground"
      />
      <img
        v-else
        :src="thumbnailUrl"
        alt=""
        class="max-h-full max-w-full h-auto w-auto object-contain transition-transform duration-200 group-hover:scale-[1.02]"
      >
    </div>

    <!-- Main Content -->
    <CardContent class="p-2.5 sm:p-3">
      <div class="min-w-0 text-left">
        <div class="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground font-light italic">
          <ImagePlus class="w-4 h-4 shrink-0" />
          <span class="truncate">Uploaded {{ timeAgo(item.uploadTime) }}</span>
        </div>

        <div
          class="mt-1 text-base sm:text-sm font-semibold tracking-wide uppercase text-foreground line-clamp-1"
          :title="item.name"
        >
          {{ item.name }}
        </div>

        <div
          v-if="mediaCopyUrl"
          class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
          @click.stop
        >
          <span class="min-w-0 flex-1 truncate whitespace-nowrap" :title="mediaCopyUrl">
            {{ mediaCopyUrl }}
          </span>
          <edge-clipboard-button :text="mediaCopyUrl" class="shrink-0" />
        </div>
      </div>
    </CardContent>

    <!-- Footer with actions -->
  </Card>
</template>
