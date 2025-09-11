<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  blockId: {
    type: String,
    required: true,
  },
})

const route = useRoute()

const state = reactive({
  filter: '',
  newDocs: {
    blocks: {
      name: { value: '' },
      content: { value: '' },
      version: 1,
    },
  },
  mounted: false,
  workingDoc: {},
})

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

definePageMeta({
  middleware: 'auth',
})

onMounted(() => {
  state.mounted = true
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
  return { values, meta }
}

const editorDocUpdates = (workingDoc) => {
  state.workingDoc = blockModel(workingDoc.content)
  console.log('Editor workingDoc update:', state.workingDoc)
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-editor
      collection="blocks"
      :doc-id="props.blockId"
      :schema="blockSchema"
      :new-doc-schema="state.newDocs.blocks"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none"
      :show-footer="false"
      :no-close-after-save="true"
      :working-doc-overrides="state.workingDoc"
      @working-doc="editorDocUpdates"
    >
      <template #header-start="slotProps">
        <FilePenLine class="mr-2" />
        {{ slotProps.title }}
      </template>
      <template #main="slotProps">
        <div class="pt-4">
          <edge-shad-input
            v-model="slotProps.workingDoc.name"
            label="Block Name"
            name="name"
          />
          <div class="flex gap-4">
            <edge-cms-code-editor
              v-model="slotProps.workingDoc.content"
              title="Block Content"
              language="html"
              name="content"
              height="calc(100vh - 300px)"
              class="mb-4 w-1/2"
            />
            <div class="w-1/2">
              <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
                <edge-cms-block-picker
                  :block-override="{ content: slotProps.workingDoc.content, values: state.workingDoc.values, meta: state.workingDoc.meta }"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
  </div>
</template>
