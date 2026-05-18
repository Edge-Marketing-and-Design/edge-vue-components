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
  <div class="edge-cms-publication-preview flex min-h-[560px] w-full flex-col items-center bg-white text-slate-900">
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
      <Magazine
        v-if="magazine"
        :teleport-flipbook-controls="controlsId"
        :effect="normalizedEffect"
        :magazine="magazine"
        class="!h-[560px] !w-full !bg-white"
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
