<script setup>
import { useVModel } from '@vueuse/core'
import { ImagePlus, Loader2, Plus, Sparkles } from 'lucide-vue-next'
const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  blockId: {
    type: String,
    required: true,
  },
  editMode: {
    type: Boolean,
    default: true,
  },
  theme: {
    type: Object,
    default: null,
  },
  siteId: {
    type: String,
    default: '',
  },
  viewportMode: {
    type: String,
    default: 'auto',
  },
  allowDelete: {
    type: Boolean,
    default: true,
  },
  containFixed: {
    type: Boolean,
    default: false,
  },
  disableInteractivePreviewInEdit: {
    type: Boolean,
    default: true,
  },
  overrideClicksInEditMode: {
    type: Boolean,
    default: false,
  },
  allowPreviewContentEdit: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:modelValue', 'delete'])
const edgeFirebase = inject('edgeFirebase')

function normalizeConfigLiteral(str) {
  return str
    .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
}

function safeParseTagConfig(raw) {
  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}

function findMatchingBrace(str, startIdx) {
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

function extractFieldsInOrder(template) {
  if (!template || typeof template !== 'string')
    return []

  const fields = []
  const seen = new Set()

  const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g
  TAG_START_RE.lastIndex = 0

  for (;;) {
    const m = TAG_START_RE.exec(template)
    if (!m)
      break

    const configStart = TAG_START_RE.lastIndex - 1
    if (configStart < 0 || template[configStart] !== '{')
      continue

    const configEnd = findMatchingBrace(template, configStart)
    if (configEnd === -1)
      continue

    const rawCfg = template.slice(configStart, configEnd + 1)
    const parsedCfg = safeParseTagConfig(rawCfg)

    let field = typeof parsedCfg?.field === 'string'
      ? parsedCfg.field.trim()
      : ''

    if (!field) {
      const fm = rawCfg.match(/["']?field["']?\s*:\s*["']([^"']+)["']/)
      field = fm?.[1]?.trim() || ''
    }

    if (field && !seen.has(field)) {
      fields.push(field)
      seen.add(field)
    }

    const closeTriple = template.indexOf('}}}', configEnd)
    TAG_START_RE.lastIndex = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1
  }

  return fields
}

const modelValue = useVModel(props, 'modelValue', emit)
const blockFormRef = ref(null)
const previewContentEditorRef = ref(null)

const state = reactive({
  open: false,
  editorMode: 'fields',
  draft: {},
  delete: false,
  meta: {},
  arrayItems: {},
  reload: false,
  metaUpdate: {},
  loading: true,
  afterLoad: false,
  imageOpen: false,
  imageOpenByField: {},
  aiDialogOpen: false,
  aiInstructions: '',
  aiSelectedFields: {},
  aiGenerating: false,
  aiError: '',
  validationErrors: [],
  blockContentDraft: '',
  blockContentDocId: '',
  blockContentUpdating: false,
  blockContentError: '',
})

const INTERACTIVE_CLICK_SELECTOR = [
  '[data-cms-interactive]',
  '.cms-block-interactive',
  '.cms-nav-toggle',
  '.cms-nav-overlay',
  '.cms-nav-panel',
  '.cms-nav-close',
  '.cms-nav-link',
  '.cms-nav-folder-toggle',
  '.cms-nav-folder-menu',
  '[data-cms-nav-folder-toggle]',
  '[data-cms-nav-folder-menu]',
].join(', ')
const EDITOR_CONTROL_CLICK_SELECTOR = [
  '[data-cms-block-control]',
  '[data-cms-block-ignore-editor-click]',
].join(', ')

const hasFixedPositionInContent = computed(() => {
  const content = String(modelValue.value?.content || '')
  return /\bfixed\b/.test(content)
})

const normalizePreviewType = (value) => {
  return value === 'dark' ? 'dark' : 'light'
}

const resolvedPreviewType = computed(() => normalizePreviewType(modelValue.value?.previewType))
const sourceBlockDocId = computed(() => {
  const direct = String(modelValue.value?.blockId || '').trim()
  if (direct)
    return direct
  return String(props.blockId || '').trim()
})

const inheritedPreviewType = computed(() => {
  const explicit = modelValue.value?.previewType
  if (explicit === 'light' || explicit === 'dark')
    return explicit
  const docId = sourceBlockDocId.value
  if (!docId)
    return null
  const blockDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[docId]
  const inherited = blockDoc?.previewType
  return (inherited === 'light' || inherited === 'dark') ? inherited : null
})

const effectivePreviewType = computed(() => {
  return normalizePreviewType(inheritedPreviewType.value ?? resolvedPreviewType.value)
})

const canOpenFieldEditor = computed(() => props.editMode)
const canOpenPreviewContentEditor = computed(() => !props.editMode && props.allowPreviewContentEdit)
const canOpenEditor = computed(() => canOpenFieldEditor.value || canOpenPreviewContentEditor.value)

const shouldContainFixedPreview = computed(() => {
  return (props.editMode || props.containFixed) && hasFixedPositionInContent.value
})

const shouldDisableInteractivePreview = computed(() => {
  return props.editMode && props.disableInteractivePreviewInEdit
})

const blockWrapperClass = computed(() => ({
  'overflow-visible': shouldContainFixedPreview.value,
  'min-h-[88px]': props.editMode && shouldContainFixedPreview.value && shouldDisableInteractivePreview.value,
  'min-h-[calc(100vh-360px)]': props.editMode && shouldContainFixedPreview.value && !shouldDisableInteractivePreview.value,
  'z-30': shouldContainFixedPreview.value,
  'bg-white text-black': props.editMode && effectivePreviewType.value === 'light',
  'bg-neutral-950 text-neutral-50': props.editMode && effectivePreviewType.value === 'dark',
  'cms-nav-edit-static': shouldDisableInteractivePreview.value,
}))

const blockWrapperStyle = computed(() => {
  if (!shouldContainFixedPreview.value || !props.editMode)
    return null
  return {
    transform: 'translateZ(0)',
  }
})

const isLightName = (value) => {
  if (!value)
    return false
  return String(value).toLowerCase().includes('light')
}

const previewBackgroundClass = value => (isLightName(value) ? 'bg-neutral-900/90' : 'bg-neutral-100')

const PLACEHOLDERS = {
  text: 'Lorem ipsum dolor sit amet.',
  textarea: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  richtext: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>',
  arrayItem: [
    'Lorem ipsum dolor sit amet.',
    'Consectetur adipiscing elit.',
    'Sed do eiusmod tempor incididunt.',
  ],
  image: 'https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/f1f7f610-dfa9-4011-08a3-7a98d95e7500/thumbnail',
}

const BLOCK_CONTENT_SNIPPETS = [
  {
    label: 'Text Field',
    snippet: '{{{#text {"field": "fieldName", "value": "" }}}}',
    description: 'Simple text field placeholder',
  },
  {
    label: 'Text with Options',
    snippet: '{{{#text {"field":"fieldName","title":"Field Label","option":{"field":"fieldName","options":[{"title":"Option 1","name":"option1"},{"title":"Option 2","name":"option2"}],"optionsKey":"title","optionsValue":"name"},"value":"option1"}}}}',
    description: 'Text field with selectable options',
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
    snippet: '{{{#image {"field": "imageField", "value": "", "tags": ["Backgrounds"] }}}}',
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

const insertPreviewSnippet = (snippet) => {
  if (!snippet)
    return
  const editor = previewContentEditorRef.value
  if (!editor || typeof editor.insertSnippet !== 'function')
    return
  editor.insertSnippet(snippet)
}

const previewBlockDisplayName = computed(() => {
  const blockDocId = String(state.blockContentDocId || sourceBlockDocId.value || '').trim()
  const blockDoc = blockDocId
    ? edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[blockDocId]
    : null

  const candidates = [
    blockDoc?.name,
    modelValue.value?.name,
    state.blockContentDocId,
    sourceBlockDocId.value,
  ]
  const found = candidates.find(value => String(value || '').trim())
  return String(found || '').trim() || 'Block'
})

const ensureQueryItemsDefaults = (meta) => {
  Object.keys(meta || {}).forEach((key) => {
    const cfg = meta[key]
    if (!cfg?.queryOptions || cfg.queryOptions.length === 0)
      return

    if (!cfg.queryItems)
      cfg.queryItems = {}

    for (const option of cfg.queryOptions) {
      const hasField = Object.prototype.hasOwnProperty.call(cfg.queryItems, option.field)
      if (!hasField) {
        cfg.queryItems[option.field] = (cfg.collection?.path === 'posts' && option.field === 'tags') ? [] : null
      }
      else if (cfg.queryItems[option.field] === '') {
        // Normalize empty strings from older saves so "(none)" stays unset
        cfg.queryItems[option.field] = null
      }
    }
  })
}

const sanitizeQueryItems = (meta) => {
  const cleaned = JSON.parse(JSON.stringify(meta || {}))
  for (const key of Object.keys(cleaned)) {
    const cfg = cleaned[key]
    if (!cfg?.queryItems || typeof cfg.queryItems !== 'object')
      continue

    for (const field of Object.keys(cfg.queryItems)) {
      const value = cfg.queryItems[field]
      const isEmptyArray = Array.isArray(value) && value.length === 0
      if (value === null || value === '' || isEmptyArray) {
        delete cfg.queryItems[field]
      }
    }

    if (cfg.queryItems && Object.keys(cfg.queryItems).length === 0)
      delete cfg.queryItems
  }
  return cleaned
}

const resetArrayItems = (field, metaSource = null) => {
  const meta = metaSource || modelValue.value?.meta || {}
  const fieldMeta = meta?.[field]
  if (!state.arrayItems?.[field]) {
    state.arrayItems[field] = {}
  }
  for (const schemaItem of (fieldMeta?.schema || [])) {
    if (schemaItem.type === 'text') {
      state.arrayItems[field][schemaItem.field] = ''
    }
    else if (schemaItem.type === 'number') {
      state.arrayItems[field][schemaItem.field] = 0
    }
    else if (schemaItem.type === 'richtext') {
      state.arrayItems[field][schemaItem.field] = ''
    }
    else if (schemaItem.type === 'textarea') {
      state.arrayItems[field][schemaItem.field] = ''
    }
    else if (schemaItem.type === 'image') {
      state.arrayItems[field][schemaItem.field] = ''
    }
  }
}

const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g

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
    const closeTriple = html.indexOf('}}}', configEnd)
    const tagEnd = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1

    yield { type, rawCfg, tagEnd }

    TAG_START_RE.lastIndex = tagEnd
  }
}

const parseBlockContentModel = (html) => {
  const values = {}
  const meta = {}
  if (!html)
    return { values, meta }

  for (const { type, rawCfg } of iterateTags(html)) {
    const cfg = safeParseTagConfig(rawCfg)
    if (!cfg || !cfg.field)
      continue

    const field = String(cfg.field)
    const title = cfg.title != null ? String(cfg.title) : ''
    const { value: _omitValue, field: _omitField, ...rest } = cfg
    meta[field] = { type, ...rest, title }

    let val = cfg.value
    if (type === 'image')
      val = !val ? PLACEHOLDERS.image : String(val)
    else if (type === 'text')
      val = !val ? PLACEHOLDERS.text : String(val)
    else if (type === 'array') {
      if (meta[field]?.limit > 0) {
        val = Array(meta[field].limit).fill('placeholder')
      }
      else {
        if (Array.isArray(val)) {
          if (val.length === 0)
            val = PLACEHOLDERS.arrayItem
        }
        else {
          val = PLACEHOLDERS.arrayItem
        }
      }
    }
    else if (type === 'textarea')
      val = !val ? PLACEHOLDERS.textarea : String(val)
    else if (type === 'richtext')
      val = !val ? PLACEHOLDERS.richtext : String(val)

    values[field] = val
  }

  return { values, meta }
}

const buildUpdatedBlockDocFromContent = (content, sourceDoc = {}) => {
  const parsed = parseBlockContentModel(content)
  const previousValues = sourceDoc?.values || {}
  const previousMeta = sourceDoc?.meta || {}
  const nextValues = {}
  const nextMeta = {}

  Object.keys(parsed.values || {}).forEach((field) => {
    if (previousValues[field] !== undefined)
      nextValues[field] = previousValues[field]
    else
      nextValues[field] = parsed.values[field]
  })

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

  return { values: nextValues, meta: nextMeta }
}

const blockContentSourceDoc = computed(() => {
  const blockDocId = String(state.blockContentDocId || sourceBlockDocId.value || '').trim()
  if (!blockDocId)
    return null
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[blockDocId] || null
})

const blockContentPreviewBlock = computed(() => {
  const content = String(state.blockContentDraft ?? '')
  const sourceDoc = modelValue.value || blockContentSourceDoc.value || {}
  const { values, meta } = buildUpdatedBlockDocFromContent(content, sourceDoc)
  const previewType = modelValue.value?.previewType ?? blockContentSourceDoc.value?.previewType
  return {
    id: modelValue.value?.id || 'preview-content',
    blockId: String(state.blockContentDocId || sourceBlockDocId.value || '').trim(),
    name: previewBlockDisplayName.value,
    previewType: normalizePreviewType(previewType),
    content,
    values,
    meta,
    synced: !!sourceDoc?.synced,
  }
})

const previewContentSurfaceClass = computed(() => {
  const previewType = normalizePreviewType(blockContentPreviewBlock.value?.previewType)
  return previewType === 'light'
    ? 'bg-white text-black'
    : 'bg-neutral-950 text-neutral-50'
})

const previewContentCanvasClass = computed(() => {
  const content = String(blockContentPreviewBlock.value?.content || '')
  const hasFixedContent = /\bfixed\b/.test(content)
  return hasFixedContent ? 'min-h-[calc(100vh-380px)]' : 'min-h-[220px]'
})

const openPreviewContentEditor = async () => {
  const blockDocId = sourceBlockDocId.value
  if (!blockDocId)
    return

  const blocksPath = `${edgeGlobal.edgeState.organizationDocPath}/blocks`
  if (!edgeFirebase.data?.[blocksPath])
    await edgeFirebase.startSnapshot(blocksPath)

  const blockData = edgeFirebase.data?.[blocksPath]?.[blockDocId]
  if (!blockData) {
    state.blockContentError = 'Unable to load block content.'
    edgeFirebase?.toast?.error?.('Unable to load block content.')
    return
  }

  state.editorMode = 'content'
  state.blockContentDocId = blockDocId
  state.blockContentDraft = String(modelValue.value?.content || blockData.content || '')
  state.blockContentError = ''
  state.blockContentUpdating = false
  state.validationErrors = []
  state.open = true
  state.afterLoad = true
}

const updateBlockContent = async () => {
  if (state.blockContentUpdating)
    return
  const blockDocId = String(state.blockContentDocId || sourceBlockDocId.value || '').trim()
  if (!blockDocId)
    return

  const blocksPath = `${edgeGlobal.edgeState.organizationDocPath}/blocks`
  const blockData = edgeFirebase.data?.[blocksPath]?.[blockDocId] || {}
  const nextContent = String(state.blockContentDraft || '')
  // Update shared block defaults from the source block doc.
  const { values: blockValues, meta: blockMeta } = buildUpdatedBlockDocFromContent(nextContent, blockData)
  // Preserve page/block-instance values when editing block content from preview mode.
  const { values: instanceValues, meta: instanceMeta } = buildUpdatedBlockDocFromContent(nextContent, modelValue.value || {})
  const blockUpdatedAt = new Date().toISOString()

  const previousModelValue = edgeGlobal.dupObject(modelValue.value || {})
  modelValue.value = {
    ...(modelValue.value || {}),
    content: nextContent,
    values: instanceValues,
    meta: instanceMeta,
    blockUpdatedAt,
    blockId: blockData?.docId || blockDocId,
  }

  state.blockContentError = ''
  state.blockContentUpdating = true
  try {
    const results = await edgeFirebase.changeDoc(blocksPath, blockDocId, {
      content: nextContent,
      values: blockValues,
      meta: blockMeta,
      blockUpdatedAt,
    })
    if (results?.success === false) {
      throw new Error(results?.error || 'Failed to update block content.')
    }
    edgeFirebase?.toast?.success?.('Block content updated.')
    state.open = false
  }
  catch (error) {
    modelValue.value = previousModelValue
    state.blockContentError = error?.message || 'Unable to save block content.'
    edgeFirebase?.toast?.error?.(state.blockContentError)
  }
  finally {
    state.blockContentUpdating = false
  }
}

const openEditor = async (event) => {
  if (!canOpenEditor.value)
    return
  const target = event?.target
  if (target?.closest?.(EDITOR_CONTROL_CLICK_SELECTOR))
    return
  const shouldOverrideEditClicks = props.editMode && props.overrideClicksInEditMode
  if (shouldOverrideEditClicks) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
  }
  if (canOpenPreviewContentEditor.value) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    await openPreviewContentEditor()
    return
  }
  if (!shouldOverrideEditClicks && target?.closest?.(INTERACTIVE_CLICK_SELECTOR))
    return
  const blockData = edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]?.[modelValue.value.blockId]
  const templateMeta = blockData?.meta || modelValue.value?.meta || {}
  const storedMeta = modelValue.value?.meta || {}
  const mergedMeta = edgeGlobal.dupObject(templateMeta) || {}

  for (const key of Object.keys(mergedMeta)) {
    const storedField = storedMeta?.[key]
    if (!storedField || typeof storedField !== 'object')
      continue
    if (storedField.queryItems && typeof storedField.queryItems === 'object') {
      mergedMeta[key].queryItems = edgeGlobal.dupObject(storedField.queryItems)
    }
    if (storedField.limit !== undefined) {
      mergedMeta[key].limit = storedField.limit
    }
  }

  for (const key of Object.keys(mergedMeta || {})) {
    if (mergedMeta[key]?.type === 'array' && mergedMeta[key]?.schema) {
      if (!mergedMeta[key]?.api) {
        resetArrayItems(key, mergedMeta)
      }
    }
  }

  state.draft = JSON.parse(JSON.stringify(modelValue.value?.values || {}))
  state.meta = JSON.parse(JSON.stringify(mergedMeta || {}))
  ensureQueryItemsDefaults(state.meta)
  state.metaUpdate = edgeGlobal.dupObject(mergedMeta) || {}
  if (blockData?.values) {
    for (const key of Object.keys(blockData.values)) {
      if (!(key in state.draft)) {
        state.draft[key] = blockData.values[key]
      }
    }
  }
  modelValue.value.blockUpdatedAt = new Date().toISOString()
  state.validationErrors = []
  state.editorMode = 'fields'
  state.open = true
  state.afterLoad = true
}

const isLimitOne = (field) => {
  const limit = Number(state.meta?.[field]?.limit)
  return Number.isFinite(limit) && limit === 1
}

const normalizeValidationNumber = (value) => {
  if (value === null || value === undefined || value === '')
    return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

const stringLength = (value) => {
  if (value === null || value === undefined)
    return 0
  return String(value).trim().length
}

const validateValueAgainstRules = (value, rules, label, typeHint) => {
  if (!rules || typeof rules !== 'object')
    return []

  const errors = []
  if (rules.required) {
    const isEmptyArray = Array.isArray(value) && value.length === 0
    const isEmptyString = typeof value === 'string' && stringLength(value) === 0
    if (value === null || value === undefined || isEmptyArray || isEmptyString) {
      errors.push(`${label} is required.`)
      return errors
    }
  }

  if (typeHint === 'number') {
    const numericValue = normalizeValidationNumber(value)
    if (numericValue !== null) {
      if (rules.min !== undefined && numericValue < rules.min)
        errors.push(`${label} must be at least ${rules.min}.`)
      if (rules.max !== undefined && numericValue > rules.max)
        errors.push(`${label} must be ${rules.max} or less.`)
    }
    return errors
  }

  const length = Array.isArray(value) ? value.length : stringLength(value)
  if (rules.min !== undefined && length < rules.min) {
    errors.push(`${label} must be at least ${rules.min} ${Array.isArray(value) ? 'items' : 'characters'}.`)
  }
  if (rules.max !== undefined && length > rules.max) {
    errors.push(`${label} must be ${rules.max} ${Array.isArray(value) ? 'items' : 'characters'} or less.`)
  }
  return errors
}

const orderedMeta = computed(() => {
  const metaObj = state.metaUpdate || {}
  const tpl = modelValue.value?.content || ''
  const orderedFields = extractFieldsInOrder(tpl)

  const out = []
  const picked = new Set()

  for (const f of orderedFields) {
    if (f in metaObj) {
      out.push({ field: f, meta: metaObj[f] })
      picked.add(f)
    }
  }

  for (const f of Object.keys(metaObj)) {
    if (!picked.has(f)) {
      out.push({ field: f, meta: metaObj[f] })
    }
  }

  return out
})

const hasEditableArrayControls = (entry) => {
  if (!entry?.meta)
    return false

  // Manual arrays are editable through the schema/list UI.
  if (!entry.meta?.api && !entry.meta?.collection)
    return true

  const collectionPath = entry.meta?.collection?.path
  const supportsQueryControls = collectionPath !== 'post'
  const queryOptions = Array.isArray(entry.meta?.queryOptions) ? entry.meta.queryOptions : []
  const hasQueryOptions = supportsQueryControls && queryOptions.length > 0
  const hasLimitControl = supportsQueryControls && !isLimitOne(entry.field)

  return hasQueryOptions || hasLimitControl
}

const editableMetaEntries = computed(() => {
  return orderedMeta.value.filter((entry) => {
    if (entry?.meta?.type === 'array')
      return hasEditableArrayControls(entry)
    return true
  })
})

const genTitleFromField = (field) => {
  if (field?.title)
    return field.title
  if (field?.meta?.title)
    return field.meta.title
  // Insert space before a capital only if it's followed by a lowercase
  return field.field
    // Insert space before a capital only if it's followed by a lowercase
    .replace('_', ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, str => str.toUpperCase())
}

const collectValidationErrors = () => {
  const errors = []
  for (const entry of orderedMeta.value) {
    const label = genTitleFromField(entry)
    const value = state.draft?.[entry.field]

    if (entry.meta?.type === 'array' && !entry.meta?.api && !entry.meta?.collection) {
      const itemCount = Array.isArray(value) ? value.length : 0
      if (itemCount < 1) {
        errors.push(`${label} requires at least one item.`)
      }

      if (Array.isArray(value) && entry.meta?.schema) {
        value.forEach((item, index) => {
          for (const schemaItem of entry.meta.schema) {
            const itemLabel = `${label} ${index + 1} · ${genTitleFromField(schemaItem)}`
            const itemValue = item?.[schemaItem.field]
            errors.push(...validateValueAgainstRules(itemValue, schemaItem.validation, itemLabel, schemaItem.type))
          }
        })
      }
    }

    const topLevelErrors = validateValueAgainstRules(value, entry.meta?.validation, label, entry.meta?.type)
    errors.push(...topLevelErrors)
  }
  return errors
}

const save = () => {
  const validationErrors = collectValidationErrors()
  if (validationErrors.length) {
    state.validationErrors = validationErrors
    return
  }
  state.validationErrors = []
  const updated = {
    ...modelValue.value,
    values: JSON.parse(JSON.stringify(state.draft)),
    meta: sanitizeQueryItems(state.meta),
  }
  modelValue.value = updated
  state.open = false
}

const aiFieldOptions = computed(() => {
  return editableMetaEntries.value
    .map(entry => ({
      id: entry.field,
      label: genTitleFromField(entry),
      type: entry.meta?.type || 'text',
    }))
    .filter(option => option.type !== 'image' && option.type !== 'color' && !/url/i.test(option.id) && !/color/i.test(option.id))
})

const selectedAiFieldIds = computed(() => {
  return aiFieldOptions.value
    .filter(option => state.aiSelectedFields?.[option.id])
    .map(option => option.id)
})

const allAiFieldsSelected = computed({
  get: () => {
    if (!aiFieldOptions.value.length)
      return false
    return aiFieldOptions.value.every(option => state.aiSelectedFields?.[option.id])
  },
  set: (value) => {
    const next = {}
    aiFieldOptions.value.forEach((option) => {
      next[option.id] = value
    })
    state.aiSelectedFields = next
  },
})

const resetAiSelections = () => {
  const next = {}
  aiFieldOptions.value.forEach((option) => {
    next[option.id] = true
  })
  state.aiSelectedFields = next
}

const openAiDialog = () => {
  state.aiError = ''
  state.aiInstructions = ''
  resetAiSelections()
  state.aiDialogOpen = true
}

const closeAiDialog = () => {
  state.aiDialogOpen = false
}

const generateWithAi = async () => {
  if (state.aiGenerating)
    return
  const selectedFields = selectedAiFieldIds.value
  if (!selectedFields.length) {
    state.aiError = 'Select at least one field for AI generation.'
    return
  }

  state.aiGenerating = true
  state.aiError = ''

  try {
    const fields = aiFieldOptions.value.filter(option => selectedFields.includes(option.id))
    const currentValues = selectedFields.reduce((acc, field) => {
      acc[field] = state.draft?.[field]
      return acc
    }, {})
    const meta = selectedFields.reduce((acc, field) => {
      acc[field] = state.meta?.[field]
      return acc
    }, {})

    const response = await edgeFirebase.runFunction('cms-generateBlockFields', {
      orgId: edgeGlobal.edgeState.currentOrganization,
      uid: edgeFirebase?.user?.uid || '',
      blockId: modelValue.value?.blockId || props.blockId,
      blockName: modelValue.value?.name || '',
      content: modelValue.value?.content || '',
      instructions: state.aiInstructions || '',
      fields,
      currentValues,
      meta,
    })

    const aiFields = response?.data?.fields || {}
    Object.keys(aiFields).forEach((field) => {
      if (selectedFields.includes(field)) {
        state.draft[field] = aiFields[field]
        blockFormRef.value?.setFieldValue?.(field, aiFields[field])
      }
    })

    const missingFields = selectedFields.filter(field => !(field in aiFields))
    if (missingFields.length) {
      state.aiError = `AI skipped: ${missingFields.join(', ')}`
      return
    }

    closeAiDialog()
  }
  catch (error) {
    console.error('Failed to generate block fields with AI', error)
    state.aiError = 'AI generation failed. Try again.'
  }
  finally {
    state.aiGenerating = false
  }
}
const addToArray = async (field) => {
  state.reload = true
  state.draft[field].push(JSON.parse(JSON.stringify(state.arrayItems[field])))
  resetArrayItems(field)
  await nextTick()
  state.reload = false
}

const loadingRender = (content) => {
  if (state.loading) {
    content = content.replaceAll('{{loading}}', '')
    content = content.replaceAll('{{loaded}}', 'hidden')
  }
  else {
    content = content.replaceAll('{{loading}}', 'hidden')
    content = content.replaceAll('{{loaded}}', '')
  }
  return content
}

const postsList = computed(() => {
  const postsCollectionPath = `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/posts`
  return Object.values(edgeFirebase.data[postsCollectionPath] || {}).sort((a, b) => {
    if (a.publishDate && b.publishDate) {
      return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime()
    }
    return 0
  })
})
const getTagsFromPosts = computed(() => {
  const tagMap = new Map()
  postsList.value.forEach((post) => {
    if (Array.isArray(post.tags)) {
      post.tags.forEach((tag) => {
        if (tag && typeof tag === 'string' && !tagMap.has(tag)) {
          tagMap.set(tag, { name: tag, title: tag })
        }
      })
    }
  })
  return Array.from(tagMap.values()).sort((a, b) => a.title.localeCompare(b.title))
})
</script>

<template>
  <div>
    <div
      :class="[{ 'cursor-pointer': canOpenEditor }, blockWrapperClass]"
      :style="blockWrapperStyle"
      class="relative group"
      @click.capture="openEditor($event)"
    >
      <!-- Content -->
      <div :class="props.editMode && props.overrideClicksInEditMode ? 'pointer-events-none' : ''">
        <edge-cms-block-api :site-id="props.siteId" :theme="props.theme" :content="modelValue?.content" :values="modelValue?.values" :meta="modelValue?.meta" :viewport-mode="props.viewportMode" @pending="state.loading = $event" />
        <edge-cms-block-render
          v-if="state.loading"
          :content="loadingRender(modelValue?.content)"
          :values="modelValue?.values"
          :meta="modelValue?.meta"
          :theme="props.theme"
          :viewport-mode="props.viewportMode"
        />
      </div>
      <!-- Darken overlay on hover -->
      <div v-if="props.editMode" class="pointer-events-none absolute inset-0 bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-[10000]" />

      <!-- Hover controls -->
      <div
        v-if="props.editMode"
        class="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[10001]"
      >
        <!-- Delete button top right -->
        <div v-if="props.allowDelete" data-cms-block-control class="pointer-events-auto absolute top-2 right-2">
          <edge-shad-button
            variant="destructive"
            size="icon"
            @click.stop.prevent="state.delete = true"
          >
            <Trash class="h-4 w-4" />
          </edge-shad-button>
        </div>

        <!-- Edit button centered -->
        <div class="flex items-center justify-center h-full">
          <!-- <edge-shad-button class="text-xl py-6 px-8" @click.stop.prevent="openEditor">
            <Pencil class="w-4 h-4 mr-1" />
            Edit
          </edge-shad-button> -->
        </div>
      </div>
    </div>
    <edge-shad-dialog v-model="state.delete">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Block</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Are you sure you want to delete this block?
        </DialogDescription>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.delete = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="destructive" class="text-white w-full" @click="emit('delete', props.blockId); state.delete = false">
            Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <Sheet v-model:open="state.open">
      <edge-cms-block-sheet-content
        v-if="state.afterLoad"
        :side="state.editorMode === 'content' ? 'left' : 'right'"
        :class="state.editorMode === 'content'
          ? 'w-full max-w-none sm:max-w-none md:max-w-none'
          : 'w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl'"
      >
        <template v-if="state.editorMode === 'content'">
          <SheetHeader>
            <div class="flex flex-col gap-2 pr-10">
              <div class="min-w-0">
                <SheetTitle>Edit Block Content: {{ previewBlockDisplayName }}</SheetTitle>
                <SheetDescription class="text-sm text-muted-foreground">
                  Update this block template and save it globally. Changes will sync to every page using this block.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div class="px-6 pb-1 pt-3 flex h-[calc(100vh-116px)] flex-col gap-2 overflow-hidden">
            <div class="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div class="min-h-0">
                <edge-cms-code-editor
                  ref="previewContentEditorRef"
                  v-model="state.blockContentDraft"
                  title="Block Content"
                  language="handlebars"
                  name="preview-block-content"
                  :enable-formatting="false"
                  height="calc(100vh - 295px)"
                  class="h-full min-h-0"
                >
                  <template #end-actions>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <edge-shad-button
                          type="button"
                          size="sm"
                          variant="outline"
                          class="h-8 px-2 text-[11px] uppercase tracking-wide"
                        >
                          Dynamic Content
                        </edge-shad-button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-72">
                        <DropdownMenuItem
                          v-for="snippet in BLOCK_CONTENT_SNIPPETS"
                          :key="snippet.label"
                          class="cursor-pointer flex-col items-start gap-0.5"
                          @click="insertPreviewSnippet(snippet.snippet)"
                        >
                          <span class="text-sm font-medium">{{ snippet.label }}</span>
                          <span class="text-xs text-muted-foreground whitespace-normal">{{ snippet.description }}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </template>
                </edge-cms-code-editor>
              </div>
              <div class="min-h-0 rounded-md border border-border bg-card overflow-hidden flex flex-col">
                <div class="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
                  Live Preview
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-3">
                  <div class="relative overflow-visible rounded-none" :class="[previewContentSurfaceClass, previewContentCanvasClass]" style="transform: translateZ(0);">
                    <edge-cms-block-api
                      :site-id="props.siteId"
                      :theme="props.theme"
                      :content="blockContentPreviewBlock.content"
                      :values="blockContentPreviewBlock.values"
                      :meta="blockContentPreviewBlock.meta"
                      :viewport-mode="props.viewportMode"
                    />
                  </div>
                </div>
              </div>
            </div>
            <Alert v-if="state.blockContentError" variant="destructive" class="mb-2">
              <AlertTitle>Save failed</AlertTitle>
              <AlertDescription class="text-sm">
                {{ state.blockContentError }}
              </AlertDescription>
            </Alert>
            <SheetFooter class="flex justify-between pt-1 pb-0">
              <edge-shad-button
                variant="destructive"
                class="text-white"
                :disabled="state.blockContentUpdating"
                @click="state.open = false"
              >
                Cancel
              </edge-shad-button>
              <edge-shad-button
                class="bg-slate-800 hover:bg-slate-400 w-full"
                :disabled="state.blockContentUpdating"
                @click="updateBlockContent"
              >
                <Loader2 v-if="state.blockContentUpdating" class="w-4 h-4 mr-2 animate-spin" />
                Update
              </edge-shad-button>
            </SheetFooter>
          </div>
        </template>
        <template v-else>
          <SheetHeader>
            <div class="flex flex-col gap-3 pr-10 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0">
                <SheetTitle>Edit Block</SheetTitle>
                <SheetDescription v-if="modelValue.synced" class="text-sm text-red-500">
                  This is a synced block. Changes made here will be reflected across all instances of this block on your site.
                </SheetDescription>
              </div>
              <edge-shad-button
                type="button"
                size="sm"
                class="h-8 gap-2 md:self-start"
                variant="outline"
                :disabled="!aiFieldOptions.length"
                @click="openAiDialog"
              >
                <Sparkles class="w-4 h-4" />
                Generate with AI
              </edge-shad-button>
            </div>
          </SheetHeader>

          <edge-shad-form ref="blockFormRef">
            <div v-if="editableMetaEntries.length === 0">
              <Alert variant="info" class="mt-4 mb-4">
                <AlertTitle>No editable fields found</AlertTitle>
                <AlertDescription class="text-sm">
                  This block does not have any editable fields defined.
                </AlertDescription>
              </Alert>
            </div>
            <div :class="modelValue.synced ? 'h-[calc(100vh-160px)]' : 'h-[calc(100vh-130px)]'" class="p-6 space-y-4   overflow-y-auto">
              <template v-for="entry in editableMetaEntries" :key="entry.field">
                <div v-if="entry.meta.type === 'array'">
                  <div v-if="!entry.meta?.api && !entry.meta?.collection">
                    <div v-if="entry.meta?.schema">
                      <Card v-if="!state.reload" class="mb-4 bg-white shadow-sm border border-gray-200 p-4">
                        <CardHeader class="p-0 mb-2">
                          <div class="relative flex items-center bg-secondary p-2 justify-between sticky top-0 z-10 bg-primary rounded">
                            <span class="text-lg font-semibold whitespace-nowrap pr-1"> {{ genTitleFromField(entry) }}</span>
                            <div class="flex w-full items-center">
                              <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />
                              <edge-shad-button variant="text" class="hover:text-primary/50 text-xs h-[26px] text-primary" @click="state.editMode = !state.editMode">
                                <Popover>
                                  <PopoverTrigger as-child>
                                    <edge-shad-button
                                      variant="text"
                                      type="submit"
                                      class="bg-secondary hover:text-primary/50 text-xs h-[26px] text-primary"
                                    >
                                      <Plus class="w-4 h-4" />
                                    </edge-shad-button>
                                  </PopoverTrigger>
                                  <PopoverContent class="!w-80 mr-20">
                                    <Card class="border-none shadow-none p-4">
                                      <template v-for="schemaItem in entry.meta.schema" :key="schemaItem.field">
                                        <edge-cms-block-input
                                          v-model="state.arrayItems[entry.field][schemaItem.field]"
                                          :type="schemaItem.type"
                                          :field="schemaItem.field"
                                          :schema="schemaItem"
                                          :label="genTitleFromField(schemaItem)"
                                        />
                                      </template>
                                      <CardFooter class="mt-2 flex justify-end">
                                        <edge-shad-button
                                          class="bg-secondary hover:text-white text-xs h-[26px] text-primary"
                                          @click="addToArray(entry.field)"
                                        >
                                          Add Entry
                                        </edge-shad-button>
                                      </CardFooter>
                                    </Card>
                                  </PopoverContent>
                                </Popover>
                              </edge-shad-button>
                            </div>
                          </div>
                        </CardHeader>
                        <draggable
                          v-if="state.draft?.[entry.field] && state.draft[entry.field].length > 0"
                          v-model="state.draft[entry.field]"
                          handle=".handle"
                          item-key="index"
                        >
                          <template #item="{ element, index }">
                            <div :key="index" class="">
                              <div class="flex gap-2 w-full items-center w-full border-1 border-dotted py-1 mb-1">
                                <div class="text-left px-2">
                                  <Grip class="handle pointer" />
                                </div>
                                <div class="px-2 py-2 w-[98%] flex gap-1">
                                  <template v-for="schemaItem in entry.meta.schema" :key="schemaItem.field">
                                    <Popover>
                                      <PopoverTrigger as-child>
                                        <Alert class="w-[200px] text-xs py-1 px-2 cursor-pointer hover:bg-primary hover:text-white">
                                          <AlertTitle> {{ genTitleFromField(schemaItem) }}</AlertTitle>
                                          <AlertDescription class="text-sm truncate max-w-[200px]">
                                            {{ element[schemaItem.field] }}
                                          </AlertDescription>
                                        </Alert>
                                      </PopoverTrigger>
                                      <PopoverContent class="!w-80 mr-20">
                                        <Card class="border-none shadow-none p-4">
                                          <edge-cms-block-input
                                            v-model="element[schemaItem.field]"
                                            :type="schemaItem.type"
                                            :schema="schemaItem"
                                            :field="`${schemaItem.field}-${index}-entry`"
                                            :label="genTitleFromField(schemaItem)"
                                          />
                                        </Card>
                                      </PopoverContent>
                                    </Popover>
                                  </template>
                                </div>
                                <div class="pr-2">
                                  <edge-shad-button
                                    variant="destructive"
                                    size="icon"
                                    @click="state.draft[entry.field].splice(index, 1)"
                                  >
                                    <Trash class="h-4 w-4" />
                                  </edge-shad-button>
                                </div>
                              </div>
                            </div>
                          </template>
                        </draggable>
                      </Card>
                    </div>
                    <edge-cms-block-input
                      v-else
                      v-model="state.draft[entry.field]"
                      :type="entry.meta.type"
                      :field="entry.field"
                      :label="genTitleFromField(entry)"
                    />
                  </div>
                  <div v-else>
                    <template v-if="entry.meta?.queryOptions">
                      <div v-for="option in entry.meta.queryOptions" :key="option.field" class="mb-2">
                        <edge-shad-select-tags
                          v-if="entry.meta?.collection?.path === 'posts' && option.field === 'tags'"
                          v-model="state.meta[entry.field].queryItems[option.field]"
                          :items="getTagsFromPosts"
                          :label="`${genTitleFromField(option)}`"
                          :name="option.field"
                          :placeholder="`Select ${genTitleFromField(option)}`"
                        />
                        <edge-cms-options-select
                          v-else-if="entry.meta?.collection?.path !== 'post'"
                          v-model="state.meta[entry.field].queryItems[option.field]"
                          :option="option"
                          :label="genTitleFromField(option)"
                          :multiple="option?.multiple || false"
                        />
                      </div>
                    </template>
                    <edge-shad-number
                      v-if="entry.meta?.collection?.path !== 'post' && !isLimitOne(entry.field)"
                      v-model="state.meta[entry.field].limit"
                      name="limit"
                      label="Limit"
                    />
                  </div>
                </div>
                <div v-else-if="entry.meta?.type === 'image'" class="w-full">
                  <div class="mb-2 text-sm font-medium text-foreground">
                    {{ genTitleFromField(entry) }}
                  </div>
                  <div class="relative py-2 rounded-md flex items-center justify-center" :class="previewBackgroundClass(state.draft[entry.field])">
                    <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer">
                      <Dialog v-model:open="state.imageOpenByField[entry.field]">
                        <DialogTrigger as-child>
                          <edge-shad-button variant="outline" class="bg-white text-black hover:bg-gray-200">
                            <ImagePlus class="h-5 w-5 mr-2" />
                            Select Image
                          </edge-shad-button>
                        </DialogTrigger>
                        <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Select Image</DialogTitle>
                            <DialogDescription />
                          </DialogHeader>
                          <edge-cms-media-manager
                            v-if="entry.meta?.tags && entry.meta.tags.length > 0"
                            :site="props.siteId"
                            :select-mode="true"
                            :default-tags="entry.meta.tags"
                            @select="(url) => { state.draft[entry.field] = url; state.imageOpenByField[entry.field] = false }"
                          />
                          <edge-cms-media-manager
                            v-else
                            :site="props.siteId"
                            :select-mode="true"
                            @select="(url) => { state.draft[entry.field] = url; state.imageOpenByField[entry.field] = false }"
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                    <img
                      v-if="state.draft[entry.field]"
                      :src="state.draft[entry.field]"
                      class="max-h-40 max-w-full h-auto w-auto object-contain"
                    >
                  </div>
                </div>
                <div v-else-if="entry.meta?.option">
                  <edge-cms-options-select
                    v-model="state.draft[entry.field]"
                    :option="entry.meta.option"
                    :label="genTitleFromField(entry)"
                  />
                </div>
                <div v-else>
                  <edge-cms-block-input
                    v-model="state.draft[entry.field]"
                    :type="entry.meta.type"
                    :field="entry.field"
                    :label="genTitleFromField(entry)"
                  />
                </div>
              </template>
            </div>

            <div class="sticky bottom-0 bg-background px-6 pb-4 pt-2">
              <Alert v-if="state.validationErrors.length" variant="destructive" class="mb-3">
                <AlertTitle>Fix the highlighted fields</AlertTitle>
                <AlertDescription class="text-sm">
                  <div v-for="(error, index) in state.validationErrors" :key="`${error}-${index}`">
                    {{ error }}
                  </div>
                </AlertDescription>
              </Alert>
              <SheetFooter class="flex justify-between">
                <edge-shad-button variant="destructive" class="text-white" @click="state.open = false">
                  Cancel
                </edge-shad-button>
                <edge-shad-button class=" bg-slate-800 hover:bg-slate-400 w-full" @click="save">
                  Save changes
                </edge-shad-button>
              </SheetFooter>
            </div>
          </edge-shad-form>

          <edge-shad-dialog v-model="state.aiDialogOpen">
            <DialogContent class="max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Generate with AI</DialogTitle>
                <DialogDescription>
                  Choose which fields the AI should fill and add any optional instructions.
                </DialogDescription>
              </DialogHeader>
              <div class="space-y-4">
                <edge-shad-textarea
                  v-model="state.aiInstructions"
                  name="aiInstructions"
                  label="Instructions (Optional)"
                  placeholder="Share tone, audience, and any details the AI should include."
                />
                <div class="space-y-2">
                  <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Fields</span>
                    <span>{{ selectedAiFieldIds.length }} selected</span>
                  </div>
                  <edge-shad-checkbox v-model="allAiFieldsSelected" name="aiSelectAll">
                    Select all fields
                  </edge-shad-checkbox>
                  <div v-if="aiFieldOptions.length" class="grid gap-2 md:grid-cols-2">
                    <edge-shad-checkbox
                      v-for="option in aiFieldOptions"
                      :key="option.id"
                      v-model="state.aiSelectedFields[option.id]"
                      :name="`ai-field-${option.id}`"
                    >
                      {{ option.label }}
                      <span class="ml-2 text-xs text-muted-foreground">({{ option.type }})</span>
                    </edge-shad-checkbox>
                  </div>
                  <Alert v-else variant="info">
                    <AlertTitle>No editable fields</AlertTitle>
                    <AlertDescription class="text-sm">
                      Add editable fields to this block to enable AI generation.
                    </AlertDescription>
                  </Alert>
                </div>
                <Alert v-if="state.aiError" variant="destructive">
                  <AlertTitle>AI generation failed</AlertTitle>
                  <AlertDescription class="text-sm">
                    {{ state.aiError }}
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter class="pt-4 flex justify-between">
                <edge-shad-button type="button" variant="destructive" class="text-white" @click="closeAiDialog">
                  Cancel
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  class="w-full"
                  :disabled="state.aiGenerating || !selectedAiFieldIds.length"
                  @click="generateWithAi"
                >
                  <Loader2 v-if="state.aiGenerating" class="w-4 h-4 mr-2 animate-spin" />
                  Generate
                </edge-shad-button>
              </DialogFooter>
            </DialogContent>
          </edge-shad-dialog>
        </template>
      </edge-cms-block-sheet-content>
    </Sheet>
  </div>
</template>

<style scoped>
.cms-nav-edit-static :deep([data-cms-nav-root] .cms-nav-toggle),
.cms-nav-edit-static :deep([data-cms-nav-root] .cms-nav-close),
.cms-nav-edit-static :deep([data-cms-nav-root] .cms-nav-link) {
  pointer-events: none !important;
}

.cms-nav-edit-static :deep([data-cms-nav-root] .cms-nav-overlay),
.cms-nav-edit-static :deep([data-cms-nav-root] .cms-nav-panel) {
  display: none !important;
  pointer-events: none !important;
}
</style>
