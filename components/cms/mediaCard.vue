<script setup>
import { ImagePlus, Loader2, Square, SquareCheckBig, Trash } from 'lucide-vue-next'
const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
})
const emits = defineEmits(['select', 'delete'])

const getThumbnail = (file) => {
  const images = file.cloudflareImageVariants
  if (images) {
    for (const img of images) {
      if (img.endsWith('thumbnail')) {
        return img
      }
    }
  }
  return null
}

const state = reactive({
  tags: [],
})

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
</script>

<template>
  <Card
    class="w-full group overflow-hidden rounded-2xl border bg-card hover:shadow-md hover:border-muted-foreground/20 transition-all"
  >
    <div class="relative w-full h-48 sm:h-56 bg-muted">
      <div class="z-10 absolute w-full flex inset-0 bg-black/20 justify-between items-start p-2">
        <edge-shad-button
          size="icon"
          class="bg-primary/60"
          @click="emits('select', !props.selected, item.docId)"
        >
          <Square v-if="!props.selected" class="!w-5 !h-5" />
          <SquareCheckBig v-else class="!w-5 !h-5" />
        </edge-shad-button>

        <edge-shad-button
          size="icon"
          class="bg-red-700/50 text-foreground/90 hover:bg-muted/80 h-9 w-9 sm:h-10 sm:w-10 rounded-xl"
          @click.stop="emits('delete', item.docId)"
        >
          <Trash class="!h-5 !w-5" />
        </edge-shad-button>
      </div>
      <Loader2
        v-if="!getThumbnail(item)"
        class="absolute inset-0 m-auto animate-spin h-6 w-6 text-muted-foreground"
      />
      <img
        v-else
        :src="getThumbnail(item)"
        alt=""
        class="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      >
    </div>

    <!-- Main Content -->
    <CardContent class="p-3 sm:p-4">
      <div class="min-w-0 text-left">
        <div class="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground font-light italic">
          <ImagePlus class="w-4 h-4 shrink-0" />
          <span class="truncate">Uploaded {{ timeAgo(item.uploadTime) }}</span>
        </div>

        <div
          class="mt-1.5 sm:mt-2 text-base sm:text-sm font-semibold tracking-wide uppercase text-foreground line-clamp-1"
          :title="item.name"
        >
          {{ item.name }}
        </div>
      </div>
    </CardContent>

    <!-- Footer with actions -->
  </Card>
</template>
