<script setup>
// TODO: block template can also accept arrays (entry on back end)... those blocks will have beginning and end tags..
// TODO:  need to add coded Editor, blockPcker, htmlContent to edge.. basically need to be able to turn off/on CMS per project
const props = defineProps({
  helper: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    default: null,
  },
  defaultBlocks: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['pick'])

const state = reactive({
  keyMenu: false,
})

// Default fallback items used when arrays/api return empty or missing
const LOREM_LIST = [
  'Lorem ipsum dolor sit amet.',
  'Consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt.',
]

// Match double-brace placeholders like {{ { field: "x", value: "..." } }}
// but DO NOT match triple-brace blocks like {{{#text ...}}}
const PLACEHOLDER_RE = /(?<!\{)\{\{\s*({[\s\S]*?})\s*\}\}(?!\})/g

// Matches triple-brace array blocks like: {{{#array { ... }}} ... {{{/array}}}
// Inside the block, items are exposed as `item` (no custom alias support)
const ARRAY_BLOCK_RE = /\{\{\{\s*#array\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)\{\{\{\s*\/array\s*\}\}\}/g

// Matches triple-brace self-closing simple blocks like: {{{#text { ... }}}} or {{{#image { ... }}}}
const SIMPLE_BLOCK_RE = /\{\{\{\s*#(text|image)\s*({[\s\S]*?})\s*\}\}\}/g

// Lenient parser for block config JSON: accepts unquoted keys and single quotes
const parseConfig = (raw) => {
  if (typeof raw !== 'string')
    return null
  const s = raw.trim()

  // If this chunk still contains template markers, ignore it silently.
  // This prevents noisy console spam during payload scanning.
  if (/^\{\s*#/.test(s) || /^\{\s*\//.test(s)) {
    return null
  }

  try {
    return JSON.parse(s)
  }
  catch (_e) {
    // Try to coerce: quote bare keys and normalize single quotes
    let fixed = s
    fixed = fixed.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    try {
      return JSON.parse(fixed)
    }
    catch (_e2) {
      // Only warn if it doesn't look like a template marker at all
      if (!/[{]#|[{]\//.test(raw)) {
        console.warn('parseConfig failed for:', raw)
      }
      return null
    }
  }
}
// Build quick lookups for field -> kind (text|image|array) and array defaults
const analyzeFields = (content) => {
  const fieldKind = new Map()
  const arrayDefaults = new Map()

  // Simple blocks (text/image)
  content.replace(SIMPLE_BLOCK_RE, (_m, kind, json) => {
    const cfg = parseConfig(json)
    const f = cfg?.field && String(cfg.field).trim()
    if (f)
      fieldKind.set(f, kind)
    return ''
  })

  // Array blocks: mark kind and capture defaults from template
  content.replace(ARRAY_BLOCK_RE, (_m, json, _innerTpl) => {
    const cfg = parseConfig(json)
    const f = cfg?.field && String(cfg.field).trim()
    if (f) {
      fieldKind.set(f, 'array')
      arrayDefaults.set(f, Array.isArray(cfg?.value) ? cfg.value : [])
    }
    return ''
  })

  return { fieldKind, arrayDefaults }
}
// Extract unique field names from block content (supports simple blocks, placeholders, and fields inside array sections)
const collectFields = (content) => {
  if (!content || typeof content !== 'string')
    return []
  const fields = new Set()

  // 1) Simple self-closing blocks: {{{#text {...}}}} / {{{#image {...}}}}
  content.replace(SIMPLE_BLOCK_RE, (_m, _kind, json) => {
    const cfg = parseConfig(json)
    if (cfg && typeof cfg.field === 'string' && cfg.field.trim()) {
      fields.add(cfg.field.trim())
    }
    return ''
  })

  // 3) Array blocks: add the array field itself and recurse into inner template
  content.replace(ARRAY_BLOCK_RE, (_m, json, innerTpl) => {
    const cfg = parseConfig(json)
    if (cfg && typeof cfg.field === 'string' && cfg.field.trim()) {
      fields.add(cfg.field.trim())
    }
    collectFields(innerTpl).forEach(f => fields.add(f))
    return ''
  })

  return Array.from(fields)
}

const makeBlockPayload = (block) => {
  const id = block?.docId
  const content = block?.content || ''

  const fieldList = collectFields(content)
  const { fieldKind, arrayDefaults } = analyzeFields(content)

  const values = {}

  fieldList.forEach((k) => {
    // 1) Try to pull explicit template value from simple blocks or placeholders
    let found = false
    let val = ''

    // Simple blocks first (text/image)
    content.replace(SIMPLE_BLOCK_RE, (_m, _kind, json) => {
      const cfg = parseConfig(json)
      if (!found && cfg && cfg.field === k && 'value' in cfg) {
        const rv = cfg.value
        if (Array.isArray(rv)) {
          if (rv.length > 0) {
            val = rv
            found = true
          }
        }
        else if (typeof rv === 'string') {
          if (rv.trim().length > 0) {
            val = rv
            found = true
          }
        }
        else if (rv != null) {
          val = rv
          found = true
        }
      }
      return ''
    })

    // Array blocks
    if (!found && fieldKind.get(k) === 'array') {
      const arr = arrayDefaults.get(k)
      if (Array.isArray(arr) && arr.length > 0) {
        val = arr
        found = true
      }
    }

    // 2) Apply renderer-equivalent fallbacks when no explicit value
    if (!found) {
      const kind = fieldKind.get(k)
      if (kind === 'text') {
        val = 'Lorem ipsum dolor sit amet.'
      }
      else if (kind === 'image') {
        val = '/images/filler.png'
      }
      else if (kind === 'array') {
        val = LOREM_LIST.slice(0, 3)
      }
      else {
        // Unknown kind: default to empty string
        val = ''
      }
    }

    values[k] = val
  })

  return { blockId: id, values, blockTemplate: content }
}

const chooseBlock = (block) => {
  emit('pick', makeBlockPayload(block))
  state.keyMenu = false
}

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

// Safely get nested values using dot notation (e.g., "a.b.c")
const getByPath = (obj, path) => {
  if (obj == null)
    return ''
  if (!path || typeof path !== 'string')
    return obj
  return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : ''), obj)
}

const escapeHtml = (s) => {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Render the inner template for a single item
// Replaces {{item}} and {{item.some.path}} occurrences
const renderSection = (tpl, data) => {
  if (!tpl)
    return ''
  // Replace {{item.something}} first (dot paths)
  let out = tpl.replace(/\{\{\s*item\.([a-zA-Z0-9_.$]+)\s*\}\}/g, (_m, p1) => {
    const v = getByPath(data, p1)
    return typeof v === 'string' ? escapeHtml(v) : (v ?? '')
  })
  // Replace bare {{item}}
  out = out.replace(/\{\{\s*item\s*\}\}/g, () => {
    if (typeof data === 'string')
      return escapeHtml(data)
    if (data == null)
      return ''
    return escapeHtml(String(data))
  })
  return out
}

const renderBlock = (content) => {
  if (!content || typeof content !== 'string')
    return ''
  console.log('rendering', content)

  // First, expand simple self-closing blocks (#text, #image)
  content = content.replace(SIMPLE_BLOCK_RE, (_match, kind, json) => {
    const cfg = parseConfig(json)
    if (!cfg)
      return ''
    const rawVal = cfg?.value
    const strVal = typeof rawVal === 'string' ? rawVal.trim() : (rawVal ?? '')
    const hasValue = typeof rawVal === 'string' ? strVal.length > 0 : !!rawVal

    let value
    if (hasValue) {
      value = strVal
    }
    else {
      value = (kind === 'text') ? 'Lorem ipsum dolor sit amet.' : '/images/filler.png'
    }

    // For text, escape HTML; for image, return raw string (URL)
    if (kind === 'text')
      return escapeHtml(String(value))
    return String(value)
  })

  // First, expand any array blocks
  content = content.replace(ARRAY_BLOCK_RE, (_match, json, innerTpl) => {
    const cfg = parseConfig(json)
    if (!cfg)
      return ''
    let list = Array.isArray(cfg?.value) ? cfg.value : []

    // If missing or empty, fall back to 3 Lorem Ipsums (strings)
    if (!Array.isArray(list) || list.length === 0) {
      list = LOREM_LIST.slice(0, 3)
    }

    // Render each item into the inner template
    return list.map(it => renderSection(innerTpl, it)).join('')
  })

  return content.replace(PLACEHOLDER_RE, (_match, json) => {
    console.log('found placeholder', json)
    const obj = parseConfig(json)
    if (!obj)
      return ''
    console.log(obj)

    const type = obj?.type
    const rawVal = obj?.value
    const strVal = typeof rawVal === 'string' ? rawVal.trim() : (rawVal ?? '')
    const hasValue = typeof rawVal === 'string' ? strVal.length > 0 : !!rawVal

    let value
    if (hasValue) {
      value = strVal
    }
    else {
      if (type === 'text') {
        value = 'Lorem ipsum dolor sit amet.'
      }
      else if (type === 'image') {
        value = '/images/filler.png'
      }
      else {
        value = ''
      }
    }

    // For text, escape HTML so user input doesn't inject markup.
    if (type === 'text')
      return escapeHtml(String(value))
    // For images (or anything else), return raw string (e.g., a URL)
    return String(value)
  })
}
</script>

<template>
  <div>
    <button
      type="button"
      class="px-3 py-2 border rounded hover:bg-gray-100"
      @click="state.keyMenu = true"
    >
      {{ props.title || 'Pick a Block' }}
    </button>
    <edge-shad-dialog v-model="state.keyMenu">
      <DialogContent class="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {{ props.title || 'Pick a Block' }}
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
            <edge-cms-html-content :html="renderBlock(block.content)" />
          </button>
        </div>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style lang="scss">
</style>
