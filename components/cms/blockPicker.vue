<script setup>
import { Plus } from 'lucide-vue-next'

const props = defineProps({
  blockOverride: {
    type: Object,
    default: null,
  },
  theme: {
    type: Object,
    default: null,
  },
  listOnly: {
    type: Boolean,
    default: false,
  },
  siteId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['pick'])

const state = reactive({
  keyMenu: false,
  blocksLoaded: [],
  selectedTags: ['Quick Picks'],
})

const edgeFirebase = inject('edgeFirebase')

const themeId = computed(() => {
  if (!props.siteId)
    return null
  const site = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`][props.siteId]
  console.log(site)
  return site?.theme || null
})

const blocks = computed(() => {
  let blocks = []
  if (edgeFirebase?.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]) {
    blocks = Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/blocks`])
  }
  console.log(props.theme)
  if (themeId.value) {
    console.log('Filtering blocks by theme:', themeId.value)
    blocks = blocks.filter(block => block.themes && block.themes.includes(themeId.value))
  }
  return blocks
})

const filteredBlocks = computed(() => {
  const selected = state.selectedTags
  if (!selected.length)
    return blocks.value

  return blocks.value.filter((block) => {
    const blockTags = Array.isArray(block.tags) ? block.tags : []
    return selected.some(tag => blockTags.includes(tag))
  })
})

onBeforeMount(async () => {
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/blocks`)
})

// --- Begin: auto-size buttons to visual (scaled) height ---
const btnRefs = {}
const innerRefs = {}
let ro

function ensureObserver() {
  if (!ro) {
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-block-id')
        const h = entry.target.getBoundingClientRect().height
        const btn = btnRefs[id]
        if (btn)
          btn.style.height = `${Math.ceil(h)}px`
      }
    })
  }
}

function setBtnRef(id, el) {
  if (el)
    btnRefs[id] = el
  else delete btnRefs[id]
}

function setInnerRef(id, el) {
  if (el) {
    innerRefs[id] = el
    ensureObserver()
    el.setAttribute('data-block-id', id)
    ro.observe(el)
  }
  else if (innerRefs[id]) {
    ro?.unobserve(innerRefs[id])
    delete innerRefs[id]
  }
}

function syncAllHeights() {
  for (const id in innerRefs) {
    const el = innerRefs[id]
    const h = el.getBoundingClientRect().height
    const btn = btnRefs[id]
    if (btn)
      btn.style.height = `${Math.ceil(h)}px`
  }
}

watch(() => state.keyMenu, async (open) => {
  if (open) {
    await nextTick()
    syncAllHeights()
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
})
// --- End: auto-size buttons to visual (scaled) height ---

// Make object-literal-ish configs JSON-parseable (handles: title: "Main Header")

// --- End robust tag parsing ---

const chooseBlock = (block) => {
  const blockModelData = edgeGlobal.dupObject(block)
  blockModelData.name = block.name
  blockModelData.blockId = block.docId
  console.log('Chosen block:', blockModelData)
  emit('pick', blockModelData)
  state.keyMenu = false
}
const loadingRender = (content) => {
  content = content.replaceAll('{{loading}}', '')
  content = content.replaceAll('{{loaded}}', 'hidden')
  return content
}

const blockLoaded = (isLoading, index) => {
  if (!isLoading && !state.blocksLoaded.includes(index)) {
    state.blocksLoaded.push(index)
  }
}

const getTagsFromBlocks = computed(() => {
  const tagsSet = new Set()

  Object.values(blocks.value || {}).forEach((block) => {
    if (block.tags && Array.isArray(block.tags)) {
      block.tags.forEach(tag => tagsSet.add(tag))
    }
  })

  // Convert to array of objects
  const tagsArray = Array.from(tagsSet).map(tag => ({ name: tag, title: tag }))

  // Sort alphabetically
  tagsArray.sort((a, b) => a.title.localeCompare(b.title))

  // Remove "Quick Picks" if it exists
  const filtered = tagsArray.filter(tag => tag.name !== 'Quick Picks')

  // Always prepend it
  return [{ name: 'Quick Picks', title: 'Quick Picks' }, ...filtered]
})

const hasActiveFilters = computed(() => state.selectedTags.length > 0)

watch(getTagsFromBlocks, (tags) => {
  const available = new Set(tags.map(tag => tag.name))
  const filtered = state.selectedTags.filter(tag => available.has(tag))
  if (filtered.length !== state.selectedTags.length)
    state.selectedTags = filtered
})

const toggleTag = (tag) => {
  state.selectedTags = []
  state.selectedTags.push(tag)
}

const clearTagFilters = () => {
  state.selectedTags = []
}
</script>

<template>
  <div v-if="props.blockOverride">
    <edge-cms-block-api
      :content="props.blockOverride.content"
      :values="props.blockOverride.values"
      :meta="props.blockOverride.meta"
      :theme="props.theme"
      :site-id="props.siteId"
      @pending="blockLoaded($event, 'block')"
    />
    <edge-cms-block-render
      v-if="!state.blocksLoaded.includes('block')"
      :content="loadingRender(props.blockOverride.content)"
      :values="props.blockOverride.values"
      :meta="props.blockOverride.meta"
      :theme="props.theme"
      :site-id="props.siteId"
    />
  </div>
  <div v-else-if="props.listOnly" class="p-6 h-[calc(100vh-50px)] overflow-hidden flex flex-col gap-4">
    <div v-if="getTagsFromBlocks.length" class="flex flex-wrap items-center gap-2 text-sm">
      <button
        v-for="tagOption in getTagsFromBlocks"
        :key="tagOption.name"
        type="button"
        class="px-3 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        :class="state.selectedTags.includes(tagOption.name) ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground hover:bg-muted border-border'"
        @click="toggleTag(tagOption.name)"
      >
        {{ tagOption.title }}
      </button>
      <button
        v-if="hasActiveFilters"
        type="button"
        class="ml-auto px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border border-transparent hover:text-primary hover:border-primary/30 rounded-full transition-colors"
        @click="clearTagFilters"
      >
        Clear filters
      </button>
    </div>
    <div class="space-y-4 overflow-y-auto pr-1">
      <template v-if="filteredBlocks.length">
        <template v-for="block in filteredBlocks" :key="block.docId">
          <button
            :ref="el => setBtnRef(block.docId, el)"
            type="button"
            class="p-0 text-left hover:bg-primary text-slate-500  border !hover:text-white   border-dashed cursor-pointer w-full overflow-hidden relative"
          >
            <div class="scale-wrapper">
              <div
                :ref="el => setInnerRef(block.docId, el)"
                class="scale-inner scale p-4"
                :data-block-id="block.docId"
              >
                <div class="text-4xl relative text-inherit text-center">
                  {{ block.name }}
                </div>
                <edge-cms-block-api :site-id="props.siteId" :content="block.content" :theme="props.theme" :values="block.values" :meta="block.meta" @pending="blockLoaded($event, block.docId)" />
                <edge-cms-block-render
                  v-if="!state.blocksLoaded.includes(block.docId)"
                  :content="loadingRender(block.content)"
                  :values="block.values"
                  :meta="block.meta"
                  :theme="props.theme"
                />
              </div>
            </div>
          </button>
        </template>
      </template>
      <p v-else class="text-sm text-muted-foreground">
        No blocks match the selected tags yet.
      </p>
    </div>
  </div>
  <div v-else>
    <div class="flex justify-center items-center">
      <edge-shad-button
        class="!my-1  px-2 h-[24px] bg-secondary text-secondary-foreground hover:text-white"
        @click="state.keyMenu = true"
      >
        <Plus class="w-4 h-4" />
      </edge-shad-button>
    </div>
    <Sheet v-model:open="state.keyMenu">
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>Pick a Block</SheetTitle>
          <SheetDescription />
        </SheetHeader>

        <edge-shad-form>
          <div class="p-6 h-[calc(100vh-50px)] overflow-hidden flex flex-col gap-4">
            <span class="text-xs text-muted-foreground">Block Filter</span>
            <div v-if="getTagsFromBlocks.length" class="flex flex-wrap items-center gap-2 text-sm">
              <button
                v-for="tagOption in getTagsFromBlocks"
                :key="tagOption.name"
                type="button"
                class="px-3 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                :class="state.selectedTags.includes(tagOption.name) ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground hover:bg-muted border-border'"
                @click="toggleTag(tagOption.name)"
              >
                {{ tagOption.title }}
              </button>
              <button
                v-if="hasActiveFilters"
                type="button"
                class="ml-auto px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border border-transparent hover:text-primary hover:border-primary/30 rounded-full transition-colors"
                @click="clearTagFilters"
              >
                Clear filters
              </button>
            </div>
            <div class="space-y-4 overflow-y-auto pr-1">
              <template v-if="filteredBlocks.length">
                <template v-for="block in filteredBlocks" :key="block.docId">
                  <button
                    :ref="el => setBtnRef(block.docId, el)"
                    type="button"
                    class="p-0 text-left hover:bg-primary text-slate-500  border !hover:text-white   border-dashed cursor-pointer w-full overflow-hidden relative"
                    @click="chooseBlock(block)"
                  >
                    <div class="scale-wrapper">
                      <div
                        :ref="el => setInnerRef(block.docId, el)"
                        class="scale-inner scale p-4"
                        :data-block-id="block.docId"
                      >
                        <div class="text-4xl relative text-inherit text-center">
                          {{ block.name }}
                        </div>
                        <edge-cms-block-api :site-id="props.siteId" :content="block.content" :theme="props.theme" :values="block.values" :meta="block.meta" @pending="blockLoaded($event, block.docId)" />
                        <edge-cms-block-render
                          v-if="!state.blocksLoaded.includes(block.docId)"
                          :content="loadingRender(block.content)"
                          :values="block.values"
                          :meta="block.meta"
                          :theme="props.theme"
                        />
                      </div>
                    </div>
                  </button>
                </template>
              </template>
              <p v-else class="text-sm text-muted-foreground">
                No blocks match the selected tags yet.
              </p>
            </div>
          </div>
        </edge-shad-form>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style lang="scss">
.scale-wrapper {
  width: 100%;
  overflow: hidden;
  position: relative;
}
.scale-inner {
  transform-origin: top left;
  display: inline-block;
}
.scale {
  transform: scale(0.5);
  width: 200%; /* 100 / 0.25 */
}
</style>
