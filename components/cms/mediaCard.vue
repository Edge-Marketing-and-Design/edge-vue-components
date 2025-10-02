<script setup>
import { ImagePlus, Loader2, Trash } from 'lucide-vue-next'
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
    <!-- Full-width top media area (no aspect plugin) -->
    <div class="relative w-full h-48 sm:h-56 bg-muted">
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
    <edge-shad-form>
      <CardFooter class="flex justify-end gap-1 sm:gap-3 p-3 sm:p-4 border-t">
        <div>
          <edge-shad-select-tags
            :model-value="state.tags"
            :items="[]"
            item-title="title"
            item-value="value"
            placeholder="Tags"
            class="w-full"
            name="tags"
            :allow-additions="true"
          />
        </div>
        <!-- Delete -->
        <edge-shad-button
          size="icon"
          class="bg-muted text-foreground/90 hover:bg-muted/80 h-9 w-9 sm:h-10 sm:w-10 rounded-xl ring-1 ring-border"
          :aria-label="`Delete ${item.name}`"
          @click.stop="emits('delete', item.docId)"
        >
          <Trash class="h-4 w-4 sm:h-5 sm:w-5" />
        </edge-shad-button>

        <!-- Select -->
        <label class="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-xl ring-1 ring-border bg-background hover:bg-accent/50 cursor-pointer">
          <input
            type="checkbox"
            :checked="props.selected"
            class="peer sr-only"
            :aria-label="`Select ${item.name}`"
            @click.stop
            @change.stop="emits('select', $event.target.checked, item.docId)"
          >
          <div
            class="h-4 w-4 sm:h-5 sm:w-5 rounded-[6px] ring-1 ring-border grid place-items-center
                 peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:ring-primary"
          >
            <svg
              v-if="props.selected"
              xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
              class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
        </label>
      </CardFooter>
    </edge-shad-form>
  </Card>
</template>
