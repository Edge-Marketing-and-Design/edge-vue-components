<script setup>
import { Plus } from 'lucide-vue-next'
const props = defineProps({
  blockContentOverride: {
    type: String,
    default: null,
  },
})

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
  textarea: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  richtext: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>',
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

// --- Robust tag parsing: supports nested objects/arrays in the config ---
// Matches `{{{#<type> { ... }}}}` and extracts a *balanced* `{ ... }` blob.
const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g

function findMatchingBrace(str, startIdx) {
  // startIdx points at the opening '{' of the config
  let depth = 0
  let inString = false
  let quote = null
  let escape = false
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) {
        inString = false
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === '\'') {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{')
      depth++
    else if (ch === '}') {
      depth--
      if (depth === 0)
        return i
    }
  }
  return -1
}

function* iterateTags(html) {
  TAG_START_RE.lastIndex = 0
  for (;;) {
    const m = TAG_START_RE.exec(html)
    if (!m)
      break

    const type = m[1]
    // The regex cursor ends *right after* the config's opening '{'
    const openIdx = TAG_START_RE.lastIndex - 1
    if (openIdx < 0 || html[openIdx] !== '{')
      continue

    const closeIdx = findMatchingBrace(html, openIdx)
    if (closeIdx === -1)
      continue

    const rawCfg = html.slice(openIdx, closeIdx + 1)
    yield { type, rawCfg }

    // Jump past the closing braces and any trailing '}}}'
    const afterCfg = html.indexOf('}}}', closeIdx)
    TAG_START_RE.lastIndex = afterCfg !== -1 ? afterCfg + 3 : closeIdx + 1
  }
}

const blockModel = (html) => {
  const values = {}
  const meta = {}

  if (!html)
    return { values, meta }

  for (const { type, rawCfg } of iterateTags(html)) {
    const cfg = safeParseConfig(rawCfg)
    if (!cfg || !cfg.field)
      continue

    const field = String(cfg.field)
    const title = cfg.title != null ? String(cfg.title) : ''

    const { value: _omitValue, field: _omitField, ...rest } = cfg
    meta[field] = { type, ...rest, title }

    let val = cfg.value

    if (type === 'image') {
      val = !val ? PLACEHOLDERS.image : String(val)
    }
    else if (type === 'text') {
      val = !val ? PLACEHOLDERS.text : String(val)
    }
    else if (type === 'array') {
      if (meta[field]?.apiLimit > 0) {
        val = Array(meta[field].apiLimit).fill('placeholder')
      }
      else {
        if (Array.isArray(val)) {
          console.log('Array value detected for field:', field, 'with value:', val)
          if (val.length === 0) {
            val = PLACEHOLDERS.arrayItem
          }
        }
        else {
          val = PLACEHOLDERS.arrayItem
        }
      }
    }
    else if (type === 'textarea') {
      val = !val ? PLACEHOLDERS.textarea : String(val)
    }
    else if (type === 'richtext') {
      val = !val ? PLACEHOLDERS.richtext : String(val)
    }

    values[field] = val
  }

  return { values, meta, blockTemplate: html }
}
// --- End robust tag parsing ---

const chooseBlock = (block) => {
  const blockModelData = blockModel(block.content)
  blockModelData.name = block.name
  emit('pick', blockModelData)
  state.keyMenu = false
}
</script>

<template>
  <div v-if="props.blockContentOverride">
    <edge-cms-block-render
      :content="props.blockContentOverride"
      :values="blockModel(props.blockContentOverride).values"
      :meta="blockModel(props.blockContentOverride).meta"
    />
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
                    <edge-cms-block-render :content="block.content" :values="blockModel(block.content).values" :meta="blockModel(block.content).meta" />
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
