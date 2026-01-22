<script setup>
import { Maximize2, Monitor, Smartphone, Tablet } from 'lucide-vue-next'
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

  return {
    id: state.previewBlock?.id || 'preview',
    blockId: props.blockId,
    name: workingDoc?.name || state.previewBlock?.name || '',
    content,
    values: nextValues,
    meta: parsed.meta || {},
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
                  <div class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Dynamic Content
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
