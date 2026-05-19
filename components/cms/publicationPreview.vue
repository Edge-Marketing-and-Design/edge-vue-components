<script setup>
import { ChevronLeftCircle, ChevronRightCircle, Fullscreen } from 'lucide-vue-next'
import { Magazine } from '../../lib/edgeMagazine'

const props = defineProps({
  pages: {
    type: [Object, Array],
    required: true,
  },
  effect: {
    type: String,
    default: 'flip',
  },
  instanceKey: {
    type: String,
    default: '',
  },
})

const localInstanceKey = `publication-preview-${Math.random().toString(36).slice(2, 10)}`

const normalizedEffect = computed(() => {
  const value = String(props.effect || '').trim()
  return value || 'flip'
})

const safeInstanceKey = computed(() => {
  const source = String(props.instanceKey || 'publication').trim()
  return source.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'publication'
})

const controlsId = computed(() => `edge-cms-publication-controls-${safeInstanceKey.value}-${localInstanceKey}`)
const publicationShellRef = ref(null)
const containerWidth = ref(0)
const pageAspectRatio = ref(0)
let resizeObserver = null
let imageLoadToken = 0

const fallbackPublicationHeight = 560
const defaultPageAspectRatio = 11 / 8.5

const pageNumber = page => Number(page?.page || String(page?.pageKey || '').replace(/\D/g, ''))

const sortedOutputs = computed(() => {
  const input = props.pages
  if (!input || typeof input !== 'object')
    return []

  const entries = Array.isArray(input)
    ? input.map((page, index) => [`page-${String(index + 1).padStart(3, '0')}`, page])
    : Object.entries(input)

  return entries
    .map(([pageKey, page]) => ({
      pageKey,
      ...((page && typeof page === 'object') ? page : {}),
    }))
    .sort((left, right) => {
      const leftPage = pageNumber(left)
      const rightPage = pageNumber(right)
      return (Number.isFinite(leftPage) ? leftPage : 0) - (Number.isFinite(rightPage) ? rightPage : 0)
    })
})

const variantUrl = (page, preferred) => {
  const variants = page?.variants || {}
  if (Array.isArray(variants)) {
    const urls = variants.map(url => String(url || '').trim()).filter(Boolean)
    return urls.find(url => url.includes(`/${preferred}`))
      || urls.find(url => url.includes('/public'))
      || urls.find(url => url.includes('/highres'))
      || urls.find(url => url.includes('/thumbnail'))
      || urls[0]
      || ''
  }
  if (variants && typeof variants === 'object') {
    return String(variants[preferred] || variants.public || variants.highres || variants.thumbnail || Object.values(variants).find(Boolean) || '').trim()
  }
  return ''
}

const pageUrl = page => variantUrl(page, 'public')

const highResUrl = page => variantUrl(page, 'highres')

const firstPageImageUrls = computed(() => {
  const firstPage = sortedOutputs.value[0]
  if (!firstPage)
    return []

  return [
    pageUrl(firstPage),
    highResUrl(firstPage),
    variantUrl(firstPage, 'thumbnail'),
  ].filter((url, index, urls) => url && urls.indexOf(url) === index)
})

const publicationHeight = computed(() => {
  if (!containerWidth.value)
    return fallbackPublicationHeight

  const aspectRatio = pageAspectRatio.value || defaultPageAspectRatio
  const horizontalPadding = 32
  const pageGap = normalizedEffect.value === 'slide' ? 30 : 0
  const verticalPadding = normalizedEffect.value === 'flip' ? 88 : 0
  const availableWidth = Math.max(1, containerWidth.value - horizontalPadding - pageGap)
  const pageWidth = availableWidth / 2
  const calculatedHeight = Math.round((pageWidth * aspectRatio) + verticalPadding)
  return Math.min(Math.max(calculatedHeight, 240), 2400)
})

const shellStyle = computed(() => ({
  minHeight: `${publicationHeight.value + 56}px`,
}))

const magazineStyle = computed(() => ({
  height: `${publicationHeight.value}px`,
}))

const magazineRenderKey = computed(() => `${controlsId.value}-${normalizedEffect.value}-${publicationHeight.value}`)

const updateContainerWidth = () => {
  const width = publicationShellRef.value?.clientWidth || 0
  containerWidth.value = Math.round(width)
}

const disconnectResizeObserver = () => {
  if (resizeObserver)
    resizeObserver.disconnect()
  resizeObserver = null
}

const startResizeObserver = async () => {
  disconnectResizeObserver()
  await nextTick()
  updateContainerWidth()
  if (typeof ResizeObserver === 'undefined' || !publicationShellRef.value)
    return

  resizeObserver = new ResizeObserver(updateContainerWidth)
  resizeObserver.observe(publicationShellRef.value)
}

const loadPageAspectRatio = (urls, token, index = 0) => {
  const url = urls[index]
  if (!url || token !== imageLoadToken || typeof Image === 'undefined')
    return

  const image = new Image()
  image.onload = () => {
    if (token !== imageLoadToken)
      return
    if (image.naturalWidth > 0 && image.naturalHeight > 0)
      pageAspectRatio.value = image.naturalHeight / image.naturalWidth
  }
  image.onerror = () => loadPageAspectRatio(urls, token, index + 1)
  image.src = url
}

watch(firstPageImageUrls, (urls) => {
  imageLoadToken += 1
  pageAspectRatio.value = 0
  if (!urls.length)
    return

  loadPageAspectRatio(urls, imageLoadToken)
}, { immediate: true })

onMounted(() => {
  startResizeObserver()
})

watch(magazineRenderKey, () => {
  startResizeObserver()
}, { flush: 'post' })

onBeforeUnmount(() => {
  disconnectResizeObserver()
})

const magazine = computed(() => {
  const pages = sortedOutputs.value
    .map(pageUrl)
    .filter(Boolean)

  if (!pages.length)
    return null

  return {
    id: safeInstanceKey.value,
    title: safeInstanceKey.value,
    pageEffect: normalizedEffect.value,
    pages,
    thumbnailImages: sortedOutputs.value
      .map((page) => {
        const url = variantUrl(page, 'thumbnail')
        return url
          ? {
              pageName: page.pageKey || `page-${page.page}`,
              url,
            }
          : null
      })
      .filter(Boolean),
    highResImages: sortedOutputs.value
      .map((page) => {
        const url = highResUrl(page)
        return url
          ? {
              pageName: page.pageKey || `page-${page.page}`,
              url,
            }
          : null
      })
      .filter(Boolean),
  }
})
</script>

<template>
  <div ref="publicationShellRef" class="edge-cms-publication-preview flex w-full flex-col items-center bg-white text-slate-900" :style="shellStyle">
    <div class="relative h-14 w-full border-b border-slate-200 bg-white">
      <div
        :id="controlsId"
        class="absolute inset-0 z-0 flex items-center justify-center"
      />
    </div>

    <div v-if="!magazine" class="w-full px-4 py-8 text-center text-sm font-medium text-red-700">
      Publication has no pages.
    </div>

    <ClientOnly>
      <div v-if="magazine" class="w-full" :style="magazineStyle">
        <Magazine
          :key="magazineRenderKey"
          :teleport-flipbook-controls="controlsId"
          :effect="normalizedEffect"
          :magazine="magazine"
          class="h-full w-full bg-white"
          @click.stop.prevent
        >
          <template #controls="flipbook">
            <div class="flex w-full items-center justify-center gap-1">
              <button
                class="edge-cms-publication-control-button"
                type="button"
                :disabled="!flipbook.canFlipLeft"
                aria-label="Previous page"
                @click="flipbook.flipLeft"
              >
                <ChevronLeftCircle class="m-1" :size="24" />
              </button>

              <div class="mx-2 min-w-[6.5rem] text-center text-sm font-medium text-slate-900">
                Page {{ flipbook.page }} of {{ flipbook.numPages }}
              </div>

              <button
                class="edge-cms-publication-control-button"
                type="button"
                :disabled="!flipbook.canFlipRight"
                aria-label="Next page"
                @click="flipbook.flipRight"
              >
                <ChevronRightCircle class="m-1" :size="24" />
              </button>
              <button
                class="edge-cms-publication-control-button"
                type="button"
                aria-label="Open fullscreen"
                @click="flipbook.openFullscreen(flipbook.viewport)"
              >
                <Fullscreen class="m-1" :size="24" />
              </button>
            </div>
          </template>
        </Magazine>
      </div>
    </ClientOnly>
  </div>
</template>

<style scoped>
.edge-cms-publication-control-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  background: #ffffff;
  color: #0f172a;
}

.edge-cms-publication-control-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
