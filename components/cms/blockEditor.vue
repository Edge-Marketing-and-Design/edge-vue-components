<script setup>
import { HelpCircle, Maximize2, Monitor, Smartphone, Tablet } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  blockId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])

const edgeFirebase = inject('edgeFirebase')

const route = useRoute()

const state = reactive({
  filter: '',
  newDocs: {
    blocks: {
      name: { value: '' },
      content: { value: '' },
      tags: { value: [] },
      themes: { value: [] },
      synced: { value: false },
      version: 1,
    },
  },
  mounted: false,
  workingDoc: {},
  loading: false,
  jsonEditorOpen: false,
  jsonEditorContent: '',
  jsonEditorError: '',
  helpOpen: false,
  editingContext: null,
  renderSite: '',
  initialBlocksSeeded: false,
  seedingInitialBlocks: false,
  previewViewport: 'full',
  previewBlock: null,
})

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

const previewViewportOptions = [
  { id: 'full', label: 'Wild Width', width: '100%', icon: Maximize2 },
  { id: 'large', label: 'Large Screen', width: '1280px', icon: Monitor },
  { id: 'medium', label: 'Medium', width: '992px', icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: '420px', icon: Smartphone },
]

const selectedPreviewViewport = computed(() => previewViewportOptions.find(option => option.id === state.previewViewport) || previewViewportOptions[0])

const previewViewportStyle = computed(() => {
  const selected = selectedPreviewViewport.value
  if (!selected || selected.id === 'full')
    return { maxWidth: '100%' }
  return {
    width: '100%',
    maxWidth: selected.width,
    marginLeft: 'auto',
    marginRight: 'auto',
  }
})

const setPreviewViewport = (viewportId) => {
  state.previewViewport = viewportId
}

const previewViewportMode = computed(() => {
  if (state.previewViewport === 'full')
    return 'auto'
  return state.previewViewport
})

onMounted(() => {
  // state.mounted = true
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

const contentEditorRef = ref(null)

const ignorePreviewDelete = () => {}

const BLOCK_CONTENT_SNIPPETS = [
  {
    label: 'Text Field',
    snippet: '{{{#text {"field": "fieldName", "value": "" }}}}',
    description: 'Simple text field placeholder',
  },
  {
    label: 'Text Area',
    snippet: '{{{#textarea {"field": "fieldName", "value": "" }}}}',
    description: 'Textarea field placeholder',
  },
  {
    label: 'Rich Text',
    snippet: '{{{#richtext {"field": "content", "value": "" }}}}',
    description: 'Rich text field placeholder',
  },
  {
    label: 'Image',
    snippet: '{{{#image {"field": "imageField", "value": "",   "tags": ["Backgrounds"] }}}}',
    description: 'Image field placeholder',
  },
  {
    label: 'Array (Basic)',
    snippet: `{{{#array {"field": "items", "value": [] }}}}
  <!-- iterate with {{item}} -->
{{{/array}}}`,
    description: 'Basic repeating array block',
  },
  {
    label: 'Array (API)',
    snippet: `{{{#array {"field":"List","schema":{"listing_price":"money","square_feet":"number","acres":"number"},"api":"https://api.clearwaterproperties.com/api/front/properties","apiField":"data","apiQuery":"?limit=20&filter_scope[agent][]=mt_nmar-mt.545000478","queryOptions":[{"field":"sort","optionsKey":"label","optionsValue":"value","options":[{"label":"Highest Price","value":"listing_price"},{"label":"Lowest Price","value":"-listing_price"},{"label":"Newest","value":"-list_date"}]},{"field":"filter_scope[agent][]","title":"Agent","optionsKey":"name","optionsValue":"mls.primary","options":"users"}],"limit":10,"value":[]}}}}
  <!-- iterate with {{item}} -->
{{{/array}}}`,
    description: 'Array pulling data from an API',
  },
  {
    label: 'Array (Collection)',
    snippet: `{{{#array {"field":"list","schema":[{"field":"name","value":"text"}],"collection":{"path":"users","query":[{"field":"name","operator":">","value":""}],"order":[{"field":"name","direction":"asc"}]},"queryOptions":[{"field":"office_id","title":"Office","optionsKey":"label","optionsValue":"value","options":[{"label":"Office 1","value":"7"},{"label":"Office 2","value":"39"},{"label":"Office 3","value":"32"}]},{"field":"userId","title":"Agent","optionsKey":"name","optionsValue":"userId","options":"users"}],"limit":100,"value":[]}}}}
    <h1 class="text-4xl">
        {{item.name}}
    </h1>
{{{/array}}}`,
    description: 'Array pulling data from a collection',
  },
  {
    label: 'Subarray',
    snippet: `{{{#subarray:child {"field": "item.children", "limit": 0 }}}}
  {{child}}
{{{/subarray}}}`,
    description: 'Nested array inside an array item',
  },
  {
    label: 'If / Else',
    snippet: `{{{#if {"cond": "condition" }}}}
  <!-- content when condition is true -->
{{{#else}}}
  <!-- content when condition is false -->
{{{/if}}}`,
    description: 'Conditional block with optional else',
  },
]

function insertBlockContentSnippet(snippet) {
  if (!snippet)
    return
  const editor = contentEditorRef.value
  if (!editor || typeof editor.insertSnippet !== 'function') {
    console.warn('Block content editor is not ready for snippet insertion')
    return
  }
  editor.insertSnippet(snippet)
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
    const configStart = TAG_START_RE.lastIndex - 1
    if (configStart < 0 || html[configStart] !== '{')
      continue

    const configEnd = findMatchingBrace(html, configStart)
    if (configEnd === -1)
      continue

    const rawCfg = html.slice(configStart, configEnd + 1)
    const tagStart = m.index
    const closeTriple = html.indexOf('}}}', configEnd)
    const tagEnd = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1

    yield { type, rawCfg, tagStart, tagEnd, configStart, configEnd }

    TAG_START_RE.lastIndex = tagEnd
  }
}

function findTagAtOffset(html, offset) {
  for (const tag of iterateTags(html)) {
    if (offset >= tag.tagStart && offset <= tag.tagEnd)
      return tag
  }
  return null
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
      if (meta[field]?.limit > 0) {
        val = Array(meta[field].limit).fill('placeholder')
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

function resetJsonEditorState() {
  state.jsonEditorContent = ''
  state.jsonEditorError = ''
  state.editingContext = null
}

function closeJsonEditor() {
  state.jsonEditorOpen = false
  resetJsonEditorState()
}

function handleEditorLineClick(payload, workingDoc) {
  if (!workingDoc || !workingDoc.content)
    return

  const offset = typeof payload?.offset === 'number' ? payload.offset : null
  if (offset == null)
    return

  const tag = findTagAtOffset(workingDoc.content, offset)
  if (!tag)
    return
  if (tag.type === 'if')
    return

  const parsedCfg = safeParseConfig(tag.rawCfg)
  state.jsonEditorError = ''
  state.jsonEditorContent = parsedCfg ? JSON.stringify(parsedCfg, null, 2) : tag.rawCfg
  state.jsonEditorOpen = true
  state.editingContext = {
    type: tag.type,
    field: parsedCfg?.field != null ? String(parsedCfg.field) : null,
    workingDoc,
    originalTag: workingDoc.content.slice(tag.tagStart, tag.tagEnd),
    configStartOffset: tag.configStart - tag.tagStart,
    configEndOffset: tag.configEnd - tag.tagStart,
  }
}

function handleJsonEditorSave() {
  if (!state.editingContext)
    return

  let parsed
  try {
    parsed = JSON.parse(state.jsonEditorContent)
  }
  catch (error) {
    state.jsonEditorError = `Unable to parse JSON: ${error.message}`
    return
  }

  const serialized = JSON.stringify(parsed)
  const { workingDoc, type, field, originalTag, configStartOffset, configEndOffset } = state.editingContext
  const content = workingDoc?.content ?? ''
  if (!content) {
    state.jsonEditorError = 'Block content is empty.'
    return
  }

  let target = null
  for (const tag of iterateTags(content)) {
    if (tag.type !== type)
      continue
    if (!field) {
      target = tag
      break
    }
    const cfg = safeParseConfig(tag.rawCfg)
    if (cfg && String(cfg.field) === field) {
      target = tag
      break
    }
  }

  if (!target && originalTag) {
    const idx = content.indexOf(originalTag)
    if (idx !== -1) {
      const startOffset = typeof configStartOffset === 'number' ? configStartOffset : originalTag.indexOf('{')
      const endOffset = typeof configEndOffset === 'number' ? configEndOffset : originalTag.lastIndexOf('}')
      if (startOffset != null && endOffset != null && startOffset >= 0 && endOffset >= startOffset) {
        target = {
          configStart: idx + startOffset,
          configEnd: idx + endOffset,
        }
      }
    }
  }

  if (!target) {
    state.jsonEditorError = 'Unable to locate the original block field in the current content.'
    return
  }

  const prefix = content.slice(0, target.configStart)
  const suffix = content.slice(target.configEnd + 1)
  workingDoc.content = `${prefix}${serialized}${suffix}`

  closeJsonEditor()
}

const buildPreviewBlock = (workingDoc, parsed) => {
  const content = workingDoc?.content || ''
  const nextValues = {}
  const previousValues = state.previewBlock?.values || {}
  Object.keys(parsed.values || {}).forEach((field) => {
    if (previousValues[field] !== undefined)
      nextValues[field] = previousValues[field]
    else
      nextValues[field] = parsed.values[field]
  })

  const previousMeta = state.previewBlock?.meta || {}
  const nextMeta = {}
  Object.keys(parsed.meta || {}).forEach((field) => {
    if (previousMeta[field]) {
      nextMeta[field] = {
        ...previousMeta[field],
        ...parsed.meta[field],
      }
    }
    else {
      nextMeta[field] = parsed.meta[field]
    }
  })

  return {
    id: state.previewBlock?.id || 'preview',
    blockId: props.blockId,
    name: workingDoc?.name || state.previewBlock?.name || '',
    content,
    values: nextValues,
    meta: nextMeta,
    synced: !!workingDoc?.synced,
  }
}

const theme = computed(() => {
  const theme = edgeGlobal.edgeState.blockEditorTheme || ''
  let themeContents = null
  if (theme) {
    themeContents = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.theme || null
  }
  if (themeContents) {
    return JSON.parse(themeContents)
  }
  return null
})

const headObject = computed(() => {
  const theme = edgeGlobal.edgeState.blockEditorTheme || ''
  try {
    return JSON.parse(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.headJSON || '{}')
  }
  catch (e) {
    return {}
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const editorDocUpdates = (workingDoc) => {
  const parsed = blockModel(workingDoc.content)
  state.workingDoc = parsed
  state.previewBlock = buildPreviewBlock(workingDoc, parsed)
  console.log('Editor workingDoc update:', state.workingDoc)
}

onBeforeMount(async () => {
  console.log('Block Editor mounting - starting snapshots if needed')
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`]) {
    console.log('Starting sites snapshot for block editor')
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`)
  }
  else {
    console.log('Themes and Sites snapshots already started')
  }
  state.mounted = true
})

const themes = computed(() => {
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {})
})

watch (themes, async (newThemes) => {
  state.loading = true
  if (!edgeGlobal.edgeState.blockEditorTheme && newThemes.length > 0) {
    edgeGlobal.edgeState.blockEditorTheme = newThemes[0].docId
  }
  await nextTick()
  state.loading = false
}, { immediate: true, deep: true })

watch(() => state.jsonEditorOpen, (open) => {
  if (!open)
    resetJsonEditorState()
})
const sites = computed(() => {
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {})
})

watch (sites, async (newSites) => {
  state.loading = true
  if (!edgeGlobal.edgeState.blockEditorSite && newSites.length > 0) {
    edgeGlobal.edgeState.blockEditorSite = newSites[0].docId
  }
  await nextTick()
  state.loading = false
}, { immediate: true, deep: true })

const blocks = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || null
})

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
      <template #header-center>
        <div class="w-full flex gap-1 px-4">
          <div class="w-1/2">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorTheme"
              label="Theme Viewer Select"
              name="theme"
              :items="themes.map(t => ({ title: t.name, name: t.docId }))"
              placeholder="Theme Viewer Select"
              class="w-full"
            />
          </div>
          <div class="w-1/2">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorSite"
              label="Site"
              name="site"
              :items="sites.map(s => ({ title: s.name, name: s.docId }))"
              placeholder="Select Site"
              class="w-full"
            />
          </div>
        </div>
      </template>
      <template #main="slotProps">
        <div class="pt-4">
          <div class="flex w-full gap-2">
            <div class="flex-auto">
              <edge-shad-input
                v-model="slotProps.workingDoc.name"
                label="Block Name"
                class="flex-auto"
                name="name"
              />
            </div>
            <div class="flex-auto">
              <edge-shad-select-tags
                v-model="slotProps.workingDoc.tags"
                :items="getTagsFromBlocks"
                name="tags"
                placeholder="Select tags"
                label="Tags"
                :allow-additions="true"
                class="w-full max-w-[800px] mx-auto mb-5 text-black"
              />
            </div>
            <div class="flex-auto">
              <edge-shad-select
                v-model="slotProps.workingDoc.themes"
                label="Allowed Themes"
                name="themes"
                :multiple="true"
                :items="themes.map(t => ({ title: t.name, name: t.docId }))"
                placeholder="Allowed Themes"
                class="flex-auto"
              />
            </div>
            <div class="flex-auto pt-2">
              <edge-shad-checkbox
                v-model="slotProps.workingDoc.synced"
                name="synced"
                label="Synced Block"
              >
                Synced Block
              </edge-shad-checkbox>
            </div>
          </div>
          <div class="flex gap-4">
            <div class="w-1/2">
              <div class="flex gap-2">
                <div class="w-2/12 mb-3 rounded-md border border-slate-200 bg-white/80 p-3 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900/60">
                  <div class="flex flex-col gap-2">
                    <edge-shad-button
                      type="button"
                      size="sm"
                      variant="secondary"
                      class="w-full h-8 px-2 text-[11px] uppercase tracking-wide gap-2"
                      @click="state.helpOpen = true"
                    >
                      <HelpCircle class="w-4 h-4" />
                      Block Help
                    </edge-shad-button>
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      Dynamic Content
                    </div>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <edge-tooltip
                      v-for="snippet in BLOCK_CONTENT_SNIPPETS"
                      :key="snippet.label"
                    >
                      <edge-shad-button
                        size="sm"
                        variant="outline"
                        class="text-xs w-full"
                        @click="insertBlockContentSnippet(snippet.snippet)"
                      >
                        {{ snippet.label }}
                      </edge-shad-button>
                      <template #content>
                        <pre class="max-w-[320px] whitespace-pre-wrap break-words text-left text-xs font-mono leading-tight">{{ snippet.snippet }}</pre>
                      </template>
                    </edge-tooltip>
                  </div>
                </div>
                <div class="w-10/12">
                  <edge-cms-code-editor
                    ref="contentEditorRef"
                    v-model="slotProps.workingDoc.content"
                    title="Block Content"
                    language="html"
                    name="content"
                    height="calc(100vh - 300px)"
                    class="mb-4 flex-1"
                    @line-click="payload => handleEditorLineClick(payload, slotProps.workingDoc)"
                  />
                </div>
              </div>
            </div>
            <div class="w-1/2 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Viewport</span>
                <div class="flex items-center gap-1">
                  <edge-shad-button
                    v-for="option in previewViewportOptions"
                    :key="option.id"
                    type="button"
                    size="icon"
                    variant="ghost"
                    class="h-[28px] w-[28px] text-xs border transition-colors"
                    :class="state.previewViewport === option.id ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-muted text-foreground border-border hover:bg-muted/80'"
                    @click="setPreviewViewport(option.id)"
                  >
                    <component :is="option.icon" class="w-3.5 h-3.5" />
                  </edge-shad-button>
                </div>
              </div>
              <div
                class="w-full mx-auto bg-card border border-border rounded-lg shadow-sm md:shadow-md"
                :style="previewViewportStyle"
              >
                <edge-cms-block
                  v-if="state.previewBlock"
                  v-model="state.previewBlock"
                  :site-id="edgeGlobal.edgeState.blockEditorSite"
                  :theme="theme"
                  :edit-mode="true"
                  :viewport-mode="previewViewportMode"
                  :block-id="state.previewBlock.id"
                  @delete="ignorePreviewDelete"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
    <Sheet v-model:open="state.helpOpen">
      <SheetContent side="right" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle class="text-left">
            Block Editor Guide
          </SheetTitle>
          <SheetDescription class="text-left text-sm text-muted-foreground">
            Everything about blocks: how fields are built, how data loads, which options exist, and how the editor renders.
          </SheetDescription>
        </SheetHeader>
        <div class="p-6 space-y-8 overflow-y-auto h-[calc(100vh-120px)]">
          <div class="rounded-md border border-border/60 bg-muted/30 p-3">
            <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Menu</div>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <a href="#block-overview" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Overview</a>
              <a href="#fields-built" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Fields</a>
              <a href="#basic-tags" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Basic Tags</a>
              <a href="#tag-format" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Tag Format</a>
              <a href="#block-settings" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Settings</a>
              <a href="#input-types" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Inputs</a>
              <a href="#image-fields" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Images</a>
              <a href="#select-options" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Selects</a>
              <a href="#arrays-manual" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Arrays</a>
              <a href="#arrays-firestore" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Firestore</a>
              <a href="#arrays-api" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">API</a>
              <a href="#arrays-filters" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Filters</a>
              <a href="#conditionals" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Conditionals</a>
              <a href="#subarrays" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Subarrays</a>
              <a href="#rendering-rules" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Rendering</a>
              <a href="#loading-tokens" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Loading</a>
              <a href="#validation" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Validation</a>
              <a href="#stored-data" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Stored Data</a>
              <a href="#preview-placeholders" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Preview</a>
              <a href="#json-editor" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">JSON Editor</a>
              <a href="#common-mistakes" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Mistakes</a>
              <a href="#indexes-kv" class="px-2 py-1 rounded border border-border bg-background hover:bg-muted transition">Indexes + KV</a>
            </div>
          </div>
          <section id="block-overview" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">What A Block Is</h3>
            <p class="text-sm text-foreground">
              A block is HTML plus special tags. The editor scans those tags and builds the form for CMS users.
              Any tag with a <code>field</code> becomes an editable input.
            </p>
            <p class="text-sm text-foreground">
              Your HTML is the template. The CMS form is the data. The preview renders the data inside the template.
            </p>
          </section>

          <section id="fields-built" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">How The CMS Builds Fields</h3>
            <div class="text-sm text-foreground space-y-1">
              <div>The editor scans the HTML for triple‑brace tags like <code v-pre>{{{#text ...}}}</code>.</div>
              <div>The <code>field</code> key becomes the saved data key.</div>
              <div>Fields appear in the order they are first found in the HTML.</div>
              <div>Only triple‑brace tags create inputs. Plain <code v-pre>{{...}}</code> does not.</div>
              <div>When you edit a block, template meta + stored meta are merged. Filters and limits persist.</div>
            </div>
          </section>

          <section id="basic-tags" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Basic Field Tags</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {"field":"headline","value":"Hello","title":"Headline"}}}}
{{{#textarea {"field":"intro","value":""}}}}
{{{#richtext {"field":"body","value":""}}}}
{{{#image {"field":"heroImage","value":"https://example.com/hero.jpg"}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>field</code> is the key stored in the block.</div>
              <div><code>value</code> is the default value when nothing is saved yet.</div>
              <div><code>title</code> sets the label shown to CMS users. If missing, the field name is used.</div>
            </div>
          </section>

          <section id="tag-format" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tag Format (Be Exact)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {"field":"title","value":"My Title","title":"Title"}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div>Tags start with <code v-pre>{{{#</code> and end with <code v-pre>}}}</code>.</div>
              <div>Config inside the tag is JSON. Use double quotes around keys and strings.</div>
              <div>Commas are required between fields in the config object.</div>
            </div>
          </section>

          <section id="block-settings" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Block Settings (Top Row)</h3>
            <div class="text-sm text-foreground space-y-1">
              <div><strong>Name</strong> is the library name of the block.</div>
              <div><strong>Tags</strong> are for filtering blocks in the picker.</div>
              <div><strong>Allowed Themes</strong> limits where this block can be used.</div>
              <div><strong>Synced Block</strong> means edits are shared across all instances.</div>
            </div>
          </section>

          <section id="input-types" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Input Types (What CMS Users See)</h3>
            <div class="text-sm text-foreground space-y-1">
              <div><code>text</code> → single‑line input (HTML is escaped on render).</div>
              <div><code>textarea</code> → multi‑line input (HTML is escaped on render).</div>
              <div><code>richtext</code> → WYSIWYG editor (HTML is rendered as‑is).</div>
              <div><code>number</code> → number input.</div>
              <div><code>image</code> → image picker + preview.</div>
              <div><code>array</code> → list editor (manual items) or data loader (API/collection).</div>
            </div>
            <p class="text-sm text-foreground">
              Rich text image controls include size buttons, float left/none/right, and a width slider (10–100%).
            </p>
          </section>

          <section id="image-fields" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Image Fields (Media Picker)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#image {"field":"heroImage","value":"","tags":["Backgrounds"]}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>tags</code> filters the media manager to specific tag groups.</div>
              <div>The stored value is the image URL.</div>
            </div>
          </section>

          <section id="select-options" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Select / Options Fields</h3>
            <p class="text-sm text-foreground">
              Add an <code>option</code> object to a field to show a select. Options can be static or pulled from a collection.
            </p>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {
  "field":"layout",
  "title":"Layout",
  "option":{
    "field":"layout",
    "options":[{"title":"Left","name":"left"},{"title":"Right","name":"right"}],
    "optionsKey":"title",
    "optionsValue":"name"
  }
}}}</code></pre>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {
  "field":"agentId",
  "title":"Agent",
  "option":{
    "field":"agentId",
    "options":"users",
    "optionsKey":"name",
    "optionsValue":"userId",
    "multiple":true
  }
}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>options</code> can be a static array or a collection name.</div>
              <div><code>optionsKey</code> is the label shown in the dropdown.</div>
              <div><code>optionsValue</code> is the stored value.</div>
              <div><code>multiple: true</code> saves an array of values.</div>
            </div>
          </section>

          <section id="arrays-manual" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Arrays (Manual Lists)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {"field":"list","value":[]}}}}
  {{item}}
{{{/array}}}</code></pre>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {
  "field":"cards",
  "schema":[
    {"field":"title","type":"text"},
    {"field":"body","type":"richtext"},
    {"field":"image","type":"image"}
  ],
  "value":[]
}}}}
  <h3>{{item.title}}</h3>
  <div>{{item.body}}</div>
  <img :src="item.image" />
{{{/array}}}</code></pre>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {
  "field":"statics",
  "value":[
    "First item",
    "Second item",
    "Third item"
  ]
}}}}
  <li>{{item}}</li>
{{{/array}}}</code></pre>
            <p class="text-sm text-foreground">
              Use <code>schema</code> to define fields on each array item.
              Supported item UI types: <code>text</code>, <code>textarea</code>, <code>richtext</code>, <code>image</code>, <code>number</code>, <code>option</code>.
            </p>
            <div class="text-sm text-foreground space-y-1">
              <div>Manual arrays show an “Add Entry” form, drag handles to reorder, and delete buttons.</div>
              <div>Use <code>number</code> for numeric input. <code>integer</code>/<code>money</code> only affect display formatting.</div>
              <div><code>limit</code> trims output to the first N items when rendering.</div>
            </div>
            <p class="text-sm text-foreground">
              Inside an array block you render <code v-pre>{{item}}</code> or <code v-pre>{{item.fieldName}}</code>.
            </p>
            <p class="text-sm text-foreground">
              For schema formatting only, you can also use <code>integer</code> or <code>money</code> types.
            </p>
          </section>

          <section id="arrays-firestore" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Arrays from Firestore</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {
  "field":"list",
  "schema":[{"field":"name","type":"text"},{"field":"role","type":"text"}],
  "collection":{
    "path":"team",
    "uniqueKey":"{orgId}",
    "query":[{"field":"active","operator":"==","value":true}],
    "order":[{"field":"name","direction":"asc"}]
  },
  "limit":6,
  "value":[]
}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>path</code> is under <code>organizations/{orgId}</code>.</div>
              <div><code>uniqueKey</code> supports <code>{orgId}</code> and <code>{siteId}</code>.</div>
              <div><code>query</code> and <code>order</code> map to Firestore filters and sort.</div>
              <div><code>limit</code> caps the results.</div>
            </div>
          </section>

          <section id="arrays-api" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Arrays from an API</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {
  "field":"list",
  "api":"https://api.example.com/items",
  "apiField":"data",
  "apiQuery":"?limit=4",
  "limit":4,
  "value":[]
}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>api</code> is the base URL without query string.</div>
              <div><code>apiQuery</code> is appended to the URL.</div>
              <div><code>apiField</code> is the array field in the response.</div>
            </div>
            <p class="text-sm text-foreground">
              Filters from <code>queryOptions</code> become query string parameters at runtime.
            </p>
          </section>

          <section id="arrays-filters" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Filters for Arrays (queryOptions)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>"queryOptions":[
  {
    "field":"users",
    "operator":"array-contains-any",
    "options":"users",
    "optionsKey":"name",
    "optionsValue":"userId",
    "multiple":true
  }
]</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>queryOptions</code> creates filter inputs for CMS users.</div>
              <div>Selections are stored in <code>meta.queryItems</code> and used in the API/collection query.</div>
              <div><code>options</code> can be a collection name or static array.</div>
              <div><code>multiple: true</code> saves an array.</div>
            </div>
          </section>

          <section id="conditionals" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Conditionals (Inside Arrays)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#if {"cond":"item.price > 0"} }}}
  <div>Price: {{item.price}}</div>
{{{#else}}}
  <div>Contact for pricing</div>
{{{/if}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>cond</code> works on <code>item.*</code> inside array/subarray templates.</div>
              <div>Supported operators: <code>==</code>, <code>!=</code>, <code>&gt;</code>, <code>&lt;</code>, <code>&gt;=</code>, <code>&lt;=</code>.</div>
            </div>
          </section>

          <section id="subarrays" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Subarrays (Nested Lists)</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {"field":"items","value":[],"as":"card"}}}}
  <h3>{{card.title}}</h3>
  {{{#subarray:child {"field":"item.children","limit":0 }}}}
    <div>{{child}}</div>
  {{{/subarray}}}
{{{/array}}}</code></pre>
            <p class="text-sm text-foreground">
              Use <code>as</code> to set an alias (like <code v-pre>{{card.title}}</code>). Use <code>subarray</code> to loop nested lists.
            </p>
          </section>

          <section id="rendering-rules" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rendering Rules</h3>
            <div class="text-sm text-foreground space-y-1">
              <div><code>text</code> and <code>textarea</code> output is HTML‑escaped.</div>
              <div><code>richtext</code> output is inserted as HTML.</div>
              <div>Array schema types format output (e.g. <code>money</code> formats USD, <code>integer</code> truncates).</div>
            </div>
          </section>

          <section id="loading-tokens" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Loading Tokens</h3>
            <div class="text-sm text-foreground space-y-1">
              <div><code v-pre>{{loading}}</code> is empty while loading and <code>hidden</code> when loaded.</div>
              <div><code v-pre>{{loaded}}</code> is <code>hidden</code> while loading and empty when loaded.</div>
              <div>These tokens only change when the block is waiting on API or collection data.</div>
            </div>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#array {"field":"list","api":"https://api.example.com/items","apiField":"data","value":[]}}}}
  &lt;div class="skeleton {{loading}}"&gt;Loading items...&lt;/div&gt;
  &lt;div class="{{loaded}}"&gt;
    &lt;div&gt;{{item.title}}&lt;/div&gt;
  &lt;/div&gt;
{{{/array}}}</code></pre>
          </section>

          <section id="validation" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Validation Rules</h3>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{{{#text {"field":"title","validation":{"required":true,"min":5,"max":80}}}}}
{{{#array {"field":"items","schema":[{"field":"name","type":"text","validation":{"required":true}}]}}}}</code></pre>
            <div class="text-sm text-foreground space-y-1">
              <div><code>required</code>, <code>min</code>, <code>max</code> are supported.</div>
              <div>For numbers, <code>min</code>/<code>max</code> are numeric. For text/arrays they are length or item count.</div>
            </div>
          </section>

          <section id="stored-data" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Editor vs Stored Data</h3>
            <p class="text-sm text-foreground">
              The editor only shows fields in the current template. If a field is removed, it disappears,
              but stored data stays. Add the field back later and the old data returns.
            </p>
          </section>

          <section id="preview-placeholders" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preview + Placeholders</h3>
            <div class="text-sm text-foreground space-y-1">
              <div>Empty fields show placeholder text or images in the preview.</div>
              <div>Array previews show sample items if the list is empty.</div>
              <div>Use the viewport buttons to test different screen sizes.</div>
            </div>
          </section>

          <section id="json-editor" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">JSON Field Editor</h3>
            <p class="text-sm text-foreground">
              Click a line inside the code editor to open the JSON Field Editor for that tag.
              Fix JSON errors there and save to update the tag.
            </p>
          </section>

          <section id="common-mistakes" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Common Mistakes</h3>
            <div class="text-sm text-foreground space-y-1">
              <div>Missing a <code>field</code> key in a tag.</div>
              <div>Invalid JSON (missing commas or quotes).</div>
              <div>Using a schema object instead of a schema array (the editor expects an array).</div>
              <div>Using <code>order</code> without the right Firestore index.</div>
            </div>
          </section>

          <section id="indexes-kv" class="space-y-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Firestore Indexes + KV Sync (Required)</h3>
            <p class="text-sm text-foreground">
              If you add a Firestore query (like <code>array-contains</code> + <code>order</code>), you must add the
              matching composite index in <code>firestore.indexes.json</code>.
            </p>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>{
  "collectionGroup": "listings",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "status",
      "arrayConfig": "CONTAINS"
    },
    {
      "fieldPath": "doc_created_at",
      "order": "DESCENDING"
    }
  ]
},</code></pre>
            <p class="text-sm text-foreground">
              If you want fast search/filtering in the CMS, you also need a KV mirror in Firebase Functions.
              Example (use your collection + fields):
            </p>
            <pre v-pre class="rounded-md bg-muted p-3 text-xs overflow-auto"><code>exports.onListingWritten = createKvMirrorHandlerFromFields({
  documentPath: 'organizations/{orgId}/listings',
  uniqueKey: '{orgId}',
  indexKeys: ['name', 'city', 'state', 'status'],
  metadataKeys: ['name', 'city', 'state', 'status', 'price', 'doc_created_at'],
})</code></pre>
          </section>
        </div>
      </SheetContent>
    </Sheet>
    <Sheet
      v-model:open="state.jsonEditorOpen"
    >
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle class="text-left">
            Field Editor
          </SheetTitle>
          <SheetDescription v-if="state.jsonEditorError" class="text-left text-sm text-gray-500">
            <Alert variant="destructive" class="mt-2">
              <AlertCircle class="w-4 h-4" />
              <AlertTitle>
                JSON Error
              </AlertTitle>
              <AlertDescription>
                {{ state.jsonEditorError }}
              </AlertDescription>
            </Alert>
          </SheetDescription>
        </SheetHeader>
        <div :class="state.jsonEditorError ? 'h-[calc(100vh-200px)]' : 'h-[calc(100vh-120px)]'" class="p-6 space-y-4   overflow-y-auto">
          <edge-cms-code-editor
            v-model="state.jsonEditorContent"
            title="Fields Configuration (JSON)"
            language="json"
            name="content"
            height="calc(100vh - 200px)"
          />
        </div>
        <SheetFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="destructive" class="text-white " @click="closeJsonEditor">
            Cancel
          </edge-shad-button>
          <edge-shad-button class=" bg-slate-800 hover:bg-slate-400text-white w-full" @click="handleJsonEditorSave">
            Save
          </edge-shad-button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
