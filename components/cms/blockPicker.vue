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
})

const edgeFirebase = inject('edgeFirebase')

const themeId = computed(() => {
  const site = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`][props.siteId]
  console.log(site)
  return site?.theme || null
})

const blocks = computed(() => {
  const blocks = []
  if (edgeFirebase?.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]) {
    blocks.push(...Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]))
  }
  if (props.theme) {
    console.log('Filtering blocks by theme:', themeId.value)
    return blocks.filter(block => block.themes && block.themes.includes(themeId.value))
  }
  return blocks
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
  console.log('blocks:', blocks.value)
  Object.values(blocks.value || {}).forEach((block) => {
    console.log('block:', block)
    if (block.tags && Array.isArray(block.tags)) {
      block.tags.forEach(tag => tagsSet.add(tag))
    }
  })
  return Array.from(tagsSet).map(tag => ({ name: tag, title: tag }))
})
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
  <div v-else-if="props.listOnly" class="p-6 space-y-4  h-[calc(100vh-50px)] overflow-y-auto">
    <template v-for="block in blocks" :key="block.docId">
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
          <div class="p-6 space-y-4  h-[calc(100vh-50px)] overflow-y-auto">
            <template v-for="block in blocks" :key="block.docId">
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
