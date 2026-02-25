<script setup>
import { Plus } from 'lucide-vue-next'

const SHARED_PICKER_STATE = reactive({
  hostId: null,
  open: false,
  activeInstance: null,
  activeProps: {
    siteId: '',
    theme: null,
    viewportMode: 'auto',
  },
  blocksLoaded: [],
  selectedTags: ['Quick Picks'],
})

const HANDLERS = new Map()
let blocksSnapshotStarted = false

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
  viewportMode: {
    type: String,
    default: 'auto',
  },
})

const emit = defineEmits(['pick'])

const localState = reactive({
  open: false,
  blocksLoaded: [],
  selectedTags: ['Quick Picks'],
})

const isSharedMode = computed(() => !props.blockOverride && !props.listOnly)
const instanceId = Symbol('blockPicker')

const edgeFirebase = inject('edgeFirebase')

const activeState = computed(() => isSharedMode.value ? SHARED_PICKER_STATE : localState)
const pickerState = activeState

const sheetOpen = computed({
  get: () => isSharedMode.value ? SHARED_PICKER_STATE.open : localState.open,
  set: (val) => {
    if (isSharedMode.value)
      SHARED_PICKER_STATE.open = val
    else
      localState.open = val
  },
})

const isSharedHost = computed(() => isSharedMode.value && SHARED_PICKER_STATE.hostId === instanceId)

const activeProps = computed(() => isSharedMode.value ? SHARED_PICKER_STATE.activeProps : {
  siteId: props.siteId,
  theme: props.theme,
  viewportMode: props.viewportMode,
})

const themeId = computed(() => {
  const siteId = activeProps.value.siteId
  if (!siteId)
    return null
  const site = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`][siteId]
  return site?.theme || null
})

const activeSiteId = computed(() => activeProps.value.siteId || '')
const pickerTheme = computed(() => activeProps.value.theme || null)
const pickerViewport = computed(() => activeProps.value.viewportMode || 'auto')

const normalizePreviewType = (value) => {
  return value === 'dark' ? 'dark' : 'light'
}

const previewSurfaceClass = (value) => {
  return normalizePreviewType(value) === 'light'
    ? 'bg-white text-black'
    : 'bg-neutral-950 text-neutral-50'
}

const blockOverridePreviewType = computed(() => {
  const directPreviewType = normalizePreviewType(props.blockOverride?.previewType)
  if (props.blockOverride?.previewType === 'light' || props.blockOverride?.previewType === 'dark')
    return directPreviewType

  const blockId = String(props.blockOverride?.blockId || '').trim()
  if (!blockId)
    return 'light'

  const savedPreviewType = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[blockId]?.previewType
  return normalizePreviewType(savedPreviewType)
})

const blocks = computed(() => {
  let blocks = []
  if (edgeFirebase?.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]) {
    blocks = Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/blocks`])
  }
  if (themeId.value) {
    blocks = blocks.filter(block => block.themes && block.themes.includes(themeId.value))
  }
  return blocks
})

const filteredBlocks = computed(() => {
  const selected = pickerState.value.selectedTags
  if (!selected.length)
    return blocks.value

  return blocks.value.filter((block) => {
    const blockTags = Array.isArray(block.tags) ? block.tags : []
    return selected.some(tag => blockTags.includes(tag))
  })
})

async function ensureBlocksSnapshot() {
  if (blocksSnapshotStarted)
    return
  blocksSnapshotStarted = true
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/blocks`)
}

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

onBeforeUnmount(() => {
  ro?.disconnect()
})
// --- End: auto-size buttons to visual (scaled) height ---

// Make object-literal-ish configs JSON-parseable (handles: title: "Main Header")

// --- End robust tag parsing ---

watch(sheetOpen, async (open) => {
  if (open) {
    await nextTick()
    syncAllHeights()
  }
})

onBeforeMount(async () => {
  await ensureBlocksSnapshot()
})

onMounted(() => {
  HANDLERS.set(instanceId, block => emit('pick', block))
  if (isSharedMode.value && !SHARED_PICKER_STATE.hostId)
    SHARED_PICKER_STATE.hostId = instanceId
})

onBeforeUnmount(() => {
  HANDLERS.delete(instanceId)
  if (SHARED_PICKER_STATE.hostId === instanceId) {
    const next = HANDLERS.keys().next().value || null
    SHARED_PICKER_STATE.hostId = next
    if (!next)
      SHARED_PICKER_STATE.open = false
  }
})

const openPicker = () => {
  if (isSharedMode.value) {
    SHARED_PICKER_STATE.activeInstance = instanceId
    SHARED_PICKER_STATE.activeProps = {
      siteId: props.siteId,
      theme: props.theme,
      viewportMode: props.viewportMode,
    }
    if (!SHARED_PICKER_STATE.hostId)
      SHARED_PICKER_STATE.hostId = instanceId
    sheetOpen.value = true
  }
  else {
    sheetOpen.value = true
  }
}

const chooseBlock = (block) => {
  let blockModelData = edgeGlobal.dupObject(block)

  if (blockModelData?.synced && activeSiteId.value) {
    console.log('Original block data:', blockModelData)
    const pages = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${activeSiteId.value}/pages`] || {}
    const pageEntries = Object.entries(pages)
    for (const [pageId, pageData] of pageEntries) {
      console.log('Checking page for synced block data:', pageId, pageData)
      if (pageData.content && Array.isArray(pageData.content)) {
        for (const pageBlock of pageData.content) {
          if (pageBlock.blockId === block.docId) {
            blockModelData = edgeGlobal.dupObject(pageBlock)
            break
          }
        }
      }
      if (pageData.postContent && Array.isArray(pageData.postContent)) {
        for (const pageBlock of pageData.postContent) {
          if (pageBlock.blockId === block.docId) {
            blockModelData = edgeGlobal.dupObject(pageBlock)
            break
          }
        }
      }
    }
  }
  blockModelData.name = block.name
  blockModelData.blockId = block.docId
  delete blockModelData.previewType
  console.log('Chosen block:', blockModelData)
  if (isSharedMode.value) {
    const handler = HANDLERS.get(SHARED_PICKER_STATE.activeInstance)
    handler?.(blockModelData)
    sheetOpen.value = false
  }
  else {
    emit('pick', blockModelData)
    sheetOpen.value = false
  }
}
const loadingRender = (content) => {
  content = content.replaceAll('{{loading}}', '')
  content = content.replaceAll('{{loaded}}', 'hidden')
  return content
}

const blockLoaded = (isLoading, index) => {
  if (!isLoading && !pickerState.value.blocksLoaded.includes(index)) {
    pickerState.value.blocksLoaded.push(index)
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

const hasActiveFilters = computed(() => pickerState.value.selectedTags.length > 0)

watch(getTagsFromBlocks, (tags) => {
  const available = new Set(tags.map(tag => tag.name))
  const filtered = pickerState.value.selectedTags.filter(tag => available.has(tag))
  if (filtered.length !== pickerState.value.selectedTags.length)
    pickerState.value.selectedTags = filtered
})

const toggleTag = (tag) => {
  pickerState.value.selectedTags = []
  pickerState.value.selectedTags.push(tag)
}

const clearTagFilters = () => {
  pickerState.value.selectedTags = []
}
</script>

<template>
  <div v-if="props.blockOverride" :class="previewSurfaceClass(blockOverridePreviewType)">
    <edge-cms-block-api
      :content="props.blockOverride.content"
      :values="props.blockOverride.values"
      :meta="props.blockOverride.meta"
      :theme="pickerTheme"
      :site-id="activeSiteId"
      :viewport-mode="pickerViewport"
      @pending="blockLoaded($event, 'block')"
    />
      <edge-cms-block-render
        v-if="!pickerState.blocksLoaded.includes('block')"
        :content="loadingRender(props.blockOverride.content)"
        :values="props.blockOverride.values"
        :meta="props.blockOverride.meta"
        :theme="pickerTheme"
        :site-id="activeSiteId"
        :viewport-mode="pickerViewport"
      />
  </div>
  <div v-else-if="props.listOnly" class="p-6 h-[calc(100vh-50px)] overflow-hidden flex flex-col gap-4">
    <div v-if="getTagsFromBlocks.length" class="flex flex-wrap items-center gap-2 text-sm">
      <button
        v-for="tagOption in getTagsFromBlocks"
        :key="tagOption.name"
        type="button"
        class="px-3 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        :class="pickerState.selectedTags.includes(tagOption.name) ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground hover:bg-muted border-border'"
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
            class="p-0 text-left text-slate-500 border border-dashed border-border/70 hover:border-primary hover:ring-1 hover:ring-primary/40 cursor-pointer w-full overflow-hidden relative transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <div class="scale-wrapper">
              <div
                :ref="el => setInnerRef(block.docId, el)"
                class="scale-inner scale p-4"
                :class="previewSurfaceClass(block.previewType)"
                :data-block-id="block.docId"
              >
                <div class="text-4xl relative text-inherit text-center">
                  {{ block.name }}
                </div>
                <edge-cms-block-api :site-id="activeSiteId" :content="block.content" :theme="pickerTheme" :values="block.values" :meta="block.meta" :viewport-mode="pickerViewport" @pending="blockLoaded($event, block.docId)" />
                <edge-cms-block-render
                  v-if="!pickerState.blocksLoaded.includes(block.docId)"
                  :content="loadingRender(block.content)"
                  :values="block.values"
                  :meta="block.meta"
                  :theme="pickerTheme"
                  :viewport-mode="pickerViewport"
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
        @click="openPicker"
      >
        <Plus class="w-4 h-4" />
      </edge-shad-button>
    </div>
    <Sheet v-if="!isSharedMode || isSharedHost" v-model:open="sheetOpen">
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
                :class="pickerState.selectedTags.includes(tagOption.name) ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground hover:bg-muted border-border'"
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
                    class="p-0 text-left text-slate-500 border border-dashed border-border/70 hover:border-primary hover:ring-1 hover:ring-primary/40 cursor-pointer w-full overflow-hidden relative transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    @click="chooseBlock(block)"
                  >
                    <div class="scale-wrapper">
                      <div
                :ref="el => setInnerRef(block.docId, el)"
                class="scale-inner scale p-4"
                :class="previewSurfaceClass(block.previewType)"
                :data-block-id="block.docId"
              >
                <div class="text-4xl relative text-inherit text-center">
                  {{ block.name }}
                </div>
                <edge-cms-block-api :site-id="activeSiteId" :content="block.content" :theme="pickerTheme" :values="block.values" :meta="block.meta" :viewport-mode="pickerViewport" @pending="blockLoaded($event, block.docId)" />
                <edge-cms-block-render
                  v-if="!pickerState.blocksLoaded.includes(block.docId)"
                  :content="loadingRender(block.content)"
                  :values="block.values"
                  :meta="block.meta"
                  :theme="pickerTheme"
                  :viewport-mode="pickerViewport"
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
