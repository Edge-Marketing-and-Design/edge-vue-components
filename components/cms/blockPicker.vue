<script setup>
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
  emit('pick', blockModel(block.content))
  state.keyMenu = false
}
</script>

<template>
  <div>
    <button
      type="button"
      class="px-3 py-2 border rounded hover:bg-gray-100"
      @click="state.keyMenu = true"
    >
      Pick a Block
    </button>
    <edge-shad-dialog v-model="state.keyMenu">
      <DialogContent class="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Pick a Block
          </DialogTitle>
        </DialogHeader>
        <DialogDescription />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 items-stretch">
          <button
            v-for="block in blocks"
            :key="block.docId"
            type="button"
            class="col-span-1 p-4 text-left hover:bg-gray-100 border border-dashed cursor-pointer h-full"
            @click="chooseBlock(block)"
          >
            <edge-cms-block-render :content="block.content" :values="blockModel(block.content).values" />
          </button>
        </div>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style lang="scss">
</style>
