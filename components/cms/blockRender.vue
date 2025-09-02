<script setup>
import { useVModel } from '@vueuse/core'
// Renders a single block payload with provided values.
// Clicking the rendered block (or optional button) opens a dialog to edit values.
// Emits: 'update:block' with the updated block payload.

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
    // {
    //   blockId: string,
    //   values: Record<string, any>,
    //   blockTemplate: string
    // }
  },
  title: {
    type: String,
    default: 'Edit Block',
  },
  // If set, shows a button instead of making the rendered block clickable.
  buttonText: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:modelValue'])
const model = useVModel(props, 'modelValue', emit)

const state = reactive({
  open: false,
  draft: {},
})

/* ---------------- Parsing & rendering helpers (aligned with your picker) ---------------- */

const PLACEHOLDER_RE = /(?<!\{)\{\{\s*({[\s\S]*?})\s*\}\}(?!\})/g
const ARRAY_BLOCK_RE = /\{\{\{\s*#array\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)\{\{\{\s*\/array\s*\}\}\}/g
const SIMPLE_BLOCK_RE = /\{\{\{\s*#(text|image)\s*({[\s\S]*?})\s*\}\}\}/g

const parseConfig = (raw) => {
  if (typeof raw !== 'string')
    return null
  const s = raw.trim()
  if (/^\{\s*#/.test(s) || /^\{\s*\//.test(s))
    return null
  try {
    return JSON.parse(s)
  }
  catch {
    let fixed = s
    fixed = fixed.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    try {
      return JSON.parse(fixed)
    }
    catch {
      return null
    }
  }
}

const analyzeFields = (content) => {
  const fieldKind = new Map()
  content.replace(SIMPLE_BLOCK_RE, (_m, kind, json) => {
    const cfg = parseConfig(json)
    const f = cfg?.field && String(cfg.field).trim()
    if (f)
      fieldKind.set(f, kind) // text | image
    return ''
  })
  content.replace(ARRAY_BLOCK_RE, (_m, json) => {
    const cfg = parseConfig(json)
    const f = cfg?.field && String(cfg.field).trim()
    if (f)
      fieldKind.set(f, 'array')
    return ''
  })
  return { fieldKind }
}

const escapeHtml = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const renderWithValues = (content, values) => {
  if (!content || typeof content !== 'string')
    return ''
  // Simple (#text/#image)
  content = content.replace(SIMPLE_BLOCK_RE, (_match, kind, json) => {
    const cfg = parseConfig(json) || {}
    const f = cfg.field
    const raw = f in values ? values[f] : cfg.value
    const val = raw == null ? '' : raw
    if (kind === 'text')
      return escapeHtml(String(val))
    // image → raw string; typically used inside src={}
    return String(val)
  })
  // Arrays
  content = content.replace(ARRAY_BLOCK_RE, (_m, json, innerTpl) => {
    const cfg = parseConfig(json) || {}
    const f = cfg.field
    let list = Array.isArray(values?.[f]) ? values[f] : (Array.isArray(cfg.value) ? cfg.value : [])
    list = Array.isArray(list) ? list : []
    const getByPath = (obj, path) => {
      if (obj == null)
        return ''
      if (!path || typeof path !== 'string')
        return obj
      return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : ''), obj)
    }
    const renderSection = (tpl, data) => {
      if (!tpl)
        return ''
      // {{item.some.path}}
      let out = tpl.replace(/\{\{\s*item\.([a-zA-Z0-9_.$]+)\s*\}\}/g, (_m2, p1) => {
        const v = getByPath(data, p1)
        return typeof v === 'string' ? escapeHtml(v) : (v ?? '')
      })
      // bare {{item}}
      out = out.replace(/\{\{\s*item\s*\}\}/g, () => {
        if (typeof data === 'string')
          return escapeHtml(data)
        if (data == null)
          return ''
        return escapeHtml(String(data))
      })
      return out
    }
    return list.map(it => renderSection(innerTpl, it)).join('')
  })
  // Double-brace placeholders (if present)
  return content.replace(PLACEHOLDER_RE, (_m, json) => {
    const obj = parseConfig(json) || {}
    const f = obj.field
    const type = obj.type
    const raw = f in values ? values[f] : obj.value
    const val = raw == null ? '' : raw
    if (type === 'text')
      return escapeHtml(String(val))
    return String(val)
  })
}

/* ---------------- state & events ---------------- */

const rendered = computed(() =>
  renderWithValues(model.value?.blockTemplate || '', model.value?.values || {}),
)

const openEditor = () => {
  state.draft = JSON.parse(JSON.stringify(model.value?.values || {}))
  state.open = true
}

const { fieldKind } = computed(() => analyzeFields(model.value?.blockTemplate || '')).value
const fields = computed(() => Array.from(fieldKind.keys()))

const save = () => {
  const updated = {
    ...model.value,
    values: JSON.parse(JSON.stringify(state.draft)),
  }
  model.value = updated
  state.open = false
}
</script>

<template>
  <div>
    <!-- If buttonText is provided, show a button. Otherwise the rendered block is clickable -->
    <button
      v-if="buttonText"
      type="button"
      class="px-3 py-2 border rounded hover:bg-gray-100"
      @click="openEditor"
    >
      {{ buttonText }}
    </button>

    <div
      v-else
      class="cursor-pointer"
      @click="openEditor"
    >
      <edge-cms-html-content :html="rendered" />
    </div>

    <edge-shad-dialog v-model="state.open">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
        </DialogHeader>
        <DialogDescription />

        <div class="mt-4 space-y-4">
          <edge-shad-form>
            <template v-for="f in fields" :key="f">
              <div v-if="fieldKind.get(f) === 'array'">
                <label class="block text-sm font-medium mb-1">{{ f }}</label>
                <edge-shad-tags v-model="state.draft[f]" :name="f" />
              </div>
              <div v-else>
                <!-- Treat text and image as plain strings; image expected to be URL -->
                <edge-shad-input v-model="state.draft[f]" :name="f" :label="f" />
              </div>
            </template>
          </edge-shad-form>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button type="button" class="px-3 py-2 border rounded" @click="state.open = false">
            Cancel
          </button>
          <button type="button" class="px-3 py-2 border rounded" @click="save">
            Save
          </button>
        </div>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
