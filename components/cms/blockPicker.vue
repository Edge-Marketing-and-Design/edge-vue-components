<script setup>
import { Plus } from 'lucide-vue-next'
const emit = defineEmits(['pick'])

const state = reactive({
  keyMenu: false,
})

const edgeFirebase = inject('edgeFirebase')
const blocks = computed(() => {
  if (edgeFirebase?.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]) {
    return Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/blocks`])
  }
  return []
})

onBeforeMount(async () => {
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/blocks`)
})

const PLACEHOLDERS = {
  text: 'Lorem ipsum dolor sit amet.',
  arrayItem: [
    'Lorem ipsum dolor sit amet.',
    'Consectetur adipiscing elit.',
    'Sed do eiusmod tempor incididunt.',
  ],
  image: '/images/filler.png',
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
function normalizeConfigLiteral(str) {
  // ensure keys are quoted: { title: "x", field: "y" } -> { "title": "x", "field": "y" }
  return str
    .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    // allow single quotes too
    .replace(/'/g, '"')
}

function safeParseConfig(raw) {
  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}

// Finds {{{#type { ... }}}} for any tag type (future-proof)
const TAG_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s+(\{[\s\S]*?\})\s*\}\}\}/g

const blockModel = (html) => {
  const values = {}
  const meta = {}

  if (!html)
    return { values, meta }

  TAG_RE.lastIndex = 0
  let m
  for (const m of html.matchAll(TAG_RE)) {
    const type = m[1]
    const rawCfg = m[2]
    const cfg = safeParseConfig(rawCfg)
    if (!cfg || !cfg.field)
      continue

    const field = String(cfg.field)
    const title = cfg.title != null ? String(cfg.title) : ''
    let val = cfg.value

    if (type === 'image') {
      val = !val ? PLACEHOLDERS.image : String(val)
    }
    else if (type === 'text') {
      val = !val ? PLACEHOLDERS.text : String(val)
    }
    else if (type === 'array') {
      val = PLACEHOLDERS.arrayItem
    }

    values[field] = val
    // Place type, ...rest, then title (preserve computed title/type, add all other config keys except field/value)
    const { value: _omitValue, field: _omitField, ...rest } = cfg
    meta[field] = { type, ...rest, title }
  }

  return { values, meta, blockTemplate: html }
}

const chooseBlock = (block) => {
  const blockModelData = blockModel(block.content)
  blockModelData.name = block.name
  emit('pick', blockModelData)
  state.keyMenu = false
}
</script>

<template>
  <div>
    <div class="flex justify-center items-center">
      <edge-shad-button
        class="!my-1  px-2 h-[24px] bg-secondary text-secondary-foreground hover:text-white"
        @click="state.keyMenu = true"
      >
        <Plus class="w-4 h-4" />
      </edge-shad-button>
    </div>
    <edge-shad-dialog v-model="state.keyMenu">
      <DialogScrollContent class="max-w-3xl w-full">
        <DialogHeader>
          <DialogTitle>
            Pick a Block
          </DialogTitle>
        </DialogHeader>
        <DialogDescription />
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
                <edge-cms-block-render :content="block.content" :values="blockModel(block.content).values" />
              </div>
            </div>
          </button>
        </template>
      </DialogScrollContent>
    </edge-shad-dialog>
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
