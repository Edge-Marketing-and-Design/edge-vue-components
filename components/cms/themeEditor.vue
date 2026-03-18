<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { Download, FolderCog, History, Loader2, RotateCcw } from 'lucide-vue-next'
import * as z from 'zod'
const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
const { saveJsonFile } = useJsonFileSave()
const { themes: themeNewDocSchema } = useCmsNewDocs()
const { createDefaults: createSiteSettingsDefaults } = useSiteSettingsTemplate()
const state = reactive({
  filter: '',
  workingDoc: {},
  newDocs: {
    themes: themeNewDocSchema.value,
  },
  mounted: false,
  loading: false,
  defaultSettingsOpen: false,
  editorKey: 0,
  editorHasUnsavedChanges: false,
  historyDialogOpen: false,
  historyLoading: false,
  historyRestoring: false,
  historyError: '',
  historyItems: [],
  historySelectedId: '',
  historyPreviewDoc: null,
  showHistoryDiffDialog: false,
})

const editorViewportHeight = 'calc(100vh - 420px)'

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

onMounted(() => {
  // state.mounted = true
})

const lastValidHead = ref({})
const lastValidTheme = ref({})

const parseJsonSafe = (value, fallback) => {
  try {
    return JSON.parse(value || '{}')
  }
  catch (error) {
    return fallback
  }
}

const normalizeForCompare = (value) => {
  if (Array.isArray(value))
    return value.map(normalizeForCompare)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForCompare(value[key])
      return acc
    }, {})
  }
  return value
}

const stableSerialize = value => JSON.stringify(normalizeForCompare(value))
const areEqualNormalized = (a, b) => stableSerialize(a) === stableSerialize(b)

const headObject = computed(() => lastValidHead.value)
const previewTheme = computed(() => {
  const isObjectTheme = !!lastValidTheme.value
    && typeof lastValidTheme.value === 'object'
    && !Array.isArray(lastValidTheme.value)
  const baseTheme = isObjectTheme ? lastValidTheme.value : {}
  return {
    ...baseTheme,
    extraCSS: typeof state.workingDoc?.extraCSS === 'string' ? state.workingDoc.extraCSS : '',
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const sites = computed(() => {
  const sitesMap = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {}
  return Object.entries(sitesMap)
    .map(([docId, data]) => ({ docId, ...(data || {}) }))
    .filter(site => site.docId && site.docId !== 'templates')
})

const templatePages = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`] || {}
})

const templatePageName = (pageId, fallback) => {
  return templatePages.value?.[pageId]?.name || fallback || 'Untitled Page'
}

const normalizeTemplatePageTypes = (value) => {
  const rawTypes = Array.isArray(value) ? value : [value]
  const normalized = rawTypes
    .map((typeValue) => {
      if (typeValue && typeof typeValue === 'object') {
        const objectValue = typeValue.name ?? typeValue.value ?? typeValue.title ?? typeValue.label ?? ''
        return String(objectValue || '')
      }
      return String(typeValue || '')
    })
    .map(typeValue => typeValue.trim().toLowerCase())
    .flatMap((typeValue) => {
      if (typeValue === 'page')
        return ['Page']
      if (typeValue === 'post')
        return ['Post']
      if (typeValue === 'both')
        return ['Page', 'Post']
      return []
    })

  const uniqueNormalized = [...new Set(normalized)]
  return uniqueNormalized.length ? uniqueNormalized : ['Page']
}

const DEFAULT_MENU_KEYS = ['Site Root', 'Not In Menu']

const ensureDefaultPagesArray = (doc = state.workingDoc) => {
  if (!doc)
    return []
  if (!Array.isArray(doc.defaultPages))
    doc.defaultPages = []
  return doc.defaultPages
}

const ensureDefaultMenusObject = (doc = state.workingDoc) => {
  if (!doc)
    return {}
  if (!doc.defaultMenus || typeof doc.defaultMenus !== 'object' || Array.isArray(doc.defaultMenus))
    doc.defaultMenus = {}
  for (const key of DEFAULT_MENU_KEYS) {
    if (!Array.isArray(doc.defaultMenus[key]))
      doc.defaultMenus[key] = []
  }
  return doc.defaultMenus
}

const ensureDefaultSiteSettings = (doc = state.workingDoc) => {
  if (!doc)
    return {}
  if (!doc.defaultSiteSettings || typeof doc.defaultSiteSettings !== 'object' || Array.isArray(doc.defaultSiteSettings))
    doc.defaultSiteSettings = createSiteSettingsDefaults()
  const defaults = createSiteSettingsDefaults()
  for (const key of Object.keys(defaults)) {
    if (doc.defaultSiteSettings[key] === undefined)
      doc.defaultSiteSettings[key] = defaults[key]
  }
  return doc.defaultSiteSettings
}

const _collectTemplateIdsFromMenus = (menus = {}) => {
  const ids = new Set()
  const traverse = (items = []) => {
    if (!Array.isArray(items))
      return
    for (const entry of items) {
      if (!entry || entry.item === undefined || entry.item === null)
        continue
      if (typeof entry.item === 'string' && entry.item)
        ids.add(entry.item)
      else if (typeof entry.item === 'object') {
        for (const nested of Object.values(entry.item || {}))
          traverse(nested)
      }
    }
  }
  for (const key of Object.keys(menus))
    traverse(menus[key])
  return ids
}

const collectMenuSlugs = (menus = {}) => {
  const slugs = new Set()
  const traverse = (items = []) => {
    if (!Array.isArray(items))
      return
    for (const entry of items) {
      if (!entry || entry.item === undefined || entry.item === null)
        continue
      if (typeof entry.item === 'string' && entry.name)
        slugs.add(entry.name)
      else if (typeof entry.item === 'object') {
        for (const nested of Object.values(entry.item || {}))
          traverse(nested)
      }
    }
  }
  for (const key of Object.keys(menus))
    traverse(menus[key])
  return slugs
}

const slugify = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'page'
}

const makeUniqueSlug = (value, existing = new Set()) => {
  const base = slugify(value)
  let candidate = base || 'page'
  let suffix = 1
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const hydrateMenusFromDefaultPages = (doc = state.workingDoc) => {
  const menus = ensureDefaultMenusObject(doc)
  const hasExistingMenus = Object.values(menus).some(items => Array.isArray(items) && items.length)
  if (hasExistingMenus)
    return
  const defaults = ensureDefaultPagesArray(doc)
  if (!defaults.length)
    return
  const existingSlugs = collectMenuSlugs(menus)
  menus['Site Root'] = defaults.map((entry) => {
    const slug = makeUniqueSlug(entry?.name || templatePageName(entry.pageId), existingSlugs)
    existingSlugs.add(slug)
    return {
      name: slug,
      item: entry.pageId,
      disableRename: !!entry?.disableRename,
      disableDelete: !!entry?.disableDelete,
    }
  })
}

const flattenMenusToDefaultPages = (menus = {}) => {
  const collected = []
  const traverse = (items = []) => {
    if (!Array.isArray(items))
      return
    for (const entry of items) {
      if (!entry || entry.item === undefined || entry.item === null)
        continue
      if (typeof entry.item === 'string' && entry.item) {
        collected.push({
          pageId: entry.item,
          name: templatePageName(entry.item, entry.name),
          disableRename: !!entry?.disableRename,
          disableDelete: !!entry?.disableDelete,
        })
      }
      else if (typeof entry.item === 'object') {
        for (const nested of Object.values(entry.item || {}))
          traverse(nested)
      }
    }
  }
  for (const key of DEFAULT_MENU_KEYS)
    traverse(menus[key])
  return collected
}

const syncDefaultPagesFromMenus = () => {
  if (!state.workingDoc)
    return
  const menus = ensureDefaultMenusObject()
  const normalized = flattenMenusToDefaultPages(menus)
  const defaults = ensureDefaultPagesArray()
  const sameLength = defaults.length === normalized.length
  const sameOrder = sameLength && defaults.every((entry, index) => entry.pageId === normalized[index].pageId)
  const sameFlags = sameLength && defaults.every((entry, index) => (
    !!entry.disableRename === !!normalized[index]?.disableRename
    && !!entry.disableDelete === !!normalized[index]?.disableDelete
  ))
  if (sameLength && sameOrder && sameFlags)
    return
  defaults.splice(0, defaults.length, ...normalized)
}

const editorDocUpdates = (workingDoc) => {
  state.workingDoc = workingDoc
  ensureDefaultPagesArray(state.workingDoc)
  ensureDefaultMenusObject(state.workingDoc)
  ensureDefaultSiteSettings(state.workingDoc)
  hydrateMenusFromDefaultPages(state.workingDoc)
  syncDefaultPagesFromMenus()
}

const templatePageOptions = computed(() => {
  return Object.entries(templatePages.value)
    .filter(([, doc]) => normalizeTemplatePageTypes(doc?.type).includes('Page'))
    .map(([value, doc]) => ({
      value,
      label: doc?.name || 'Untitled Page',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const themesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/themes`)
const themesCollection = computed(() => edgeFirebase.data?.[themesCollectionPath.value] || {})
const currentTheme = computed(() => themesCollection.value?.[props.themeId] || null)
const currentThemePath = computed(() => {
  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  const themeId = String(props.themeId || '').trim()
  if (!orgPath || !themeId || themeId === 'new')
    return ''
  return `${orgPath}/themes/${themeId}`
})

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const cloneSchemaValue = (value) => {
  if (isPlainObject(value) || Array.isArray(value))
    return edgeGlobal.dupObject(value)
  return value
}

const getDocDefaultsFromSchema = (schema = {}) => {
  const defaults = {}
  for (const [key, schemaEntry] of Object.entries(schema || {})) {
    const hasValueProp = isPlainObject(schemaEntry) && Object.prototype.hasOwnProperty.call(schemaEntry, 'value')
    const baseValue = hasValueProp ? schemaEntry.value : schemaEntry
    defaults[key] = cloneSchemaValue(baseValue)
  }
  return defaults
}

const getThemeDocDefaults = () => getDocDefaultsFromSchema(themeNewDocSchema.value || {})

const getHistoryTimestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value?.millis === 'number' && Number.isFinite(value.millis))
    return value.millis
  const isoValue = String(value?.iso || value || '').trim()
  if (!isoValue)
    return null
  const parsed = Date.parse(isoValue)
  return Number.isFinite(parsed) ? parsed : null
}

const formatHistoryDate = (value) => {
  const millis = getHistoryTimestampMs(value)
  if (!millis)
    return 'Unknown date'
  return new Date(millis).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatHistoryEntryLabel(item, index = 0) {
  const dateLabel = formatHistoryDate(item?.createdAt)
  const fallbackLabel = `Entry ${index + 1}`
  if (dateLabel)
    return dateLabel
  return fallbackLabel
}

const getHistorySnapshotState = (item) => {
  if (isPlainObject(item?.afterData))
    return 'afterData'
  if (isPlainObject(item?.beforeData))
    return 'beforeData'
  return ''
}

const getHistorySnapshotDoc = item => item?.[getHistorySnapshotState(item)] || null

const getResolvedHistorySnapshotState = (item) => {
  if (!item || typeof item !== 'object')
    return ''

  const afterDoc = isPlainObject(item.afterData) ? item.afterData : null
  const beforeDoc = isPlainObject(item.beforeData) ? item.beforeData : null

  if (afterDoc && themeDocsMatchForDiff(afterDoc, currentTheme.value) && beforeDoc && !themeDocsMatchForDiff(beforeDoc, currentTheme.value))
    return 'beforeData'
  if (afterDoc)
    return 'afterData'
  if (beforeDoc)
    return 'beforeData'
  return ''
}

const getResolvedHistorySnapshotDoc = item => item?.[getResolvedHistorySnapshotState(item)] || null

const cloneThemeDocWithDefaults = (doc) => {
  if (!isPlainObject(doc))
    return null
  const cloned = edgeGlobal.dupObject(doc)
  ensureDefaultPagesArray(cloned)
  ensureDefaultMenusObject(cloned)
  ensureDefaultSiteSettings(cloned)
  hydrateMenusFromDefaultPages(cloned)
  return cloned
}

const buildComparableThemeDoc = (doc) => {
  if (!isPlainObject(doc))
    return null
  const normalizedDoc = cloneThemeDocWithDefaults(doc) || {}
  return {
    name: normalizedDoc.name ?? '',
    theme: normalizedDoc.theme ?? '',
    headJSON: normalizedDoc.headJSON ?? '',
    extraCSS: normalizedDoc.extraCSS ?? '',
    defaultPages: Array.isArray(normalizedDoc.defaultPages) ? normalizedDoc.defaultPages : [],
    defaultMenus: isPlainObject(normalizedDoc.defaultMenus) ? normalizedDoc.defaultMenus : {},
    defaultSiteSettings: isPlainObject(normalizedDoc.defaultSiteSettings) ? normalizedDoc.defaultSiteSettings : {},
  }
}

const themeDocsMatchForDiff = (baseDoc, compareDoc) => {
  return areEqualNormalized(
    buildComparableThemeDoc(baseDoc),
    buildComparableThemeDoc(compareDoc),
  )
}

const THEME_DIFF_FIELD_KEYS = ['name', 'theme', 'headJSON', 'extraCSS', 'defaultPages', 'defaultMenus', 'defaultSiteSettings']

const resolveHistoryThemeFieldValue = (item, key, currentDoc) => {
  const afterDoc = isPlainObject(item?.afterData) ? item.afterData : null
  const beforeDoc = isPlainObject(item?.beforeData) ? item.beforeData : null
  const currentValue = currentDoc?.[key]

  const hasAfterValue = !!afterDoc && Object.prototype.hasOwnProperty.call(afterDoc, key)
  const hasBeforeValue = !!beforeDoc && Object.prototype.hasOwnProperty.call(beforeDoc, key)
  const afterValue = hasAfterValue ? afterDoc[key] : undefined
  const beforeValue = hasBeforeValue ? beforeDoc[key] : undefined

  if (hasAfterValue && areEqualNormalized(afterValue, currentValue) && hasBeforeValue && !areEqualNormalized(beforeValue, currentValue))
    return cloneSchemaValue(beforeValue)
  if (hasAfterValue)
    return cloneSchemaValue(afterValue)
  if (hasBeforeValue)
    return cloneSchemaValue(beforeValue)
  return undefined
}

const buildThemeDiffBaseDocFromHistory = (item, currentDoc) => {
  if (!item || typeof item !== 'object')
    return null

  const nextDoc = {}
  THEME_DIFF_FIELD_KEYS.forEach((key) => {
    const value = resolveHistoryThemeFieldValue(item, key, currentDoc)
    if (value !== undefined)
      nextDoc[key] = value
  })
  return cloneThemeDocWithDefaults(nextDoc)
}

const isHistoryItemArray = (value) => {
  if (!Array.isArray(value) || !value.length)
    return false
  return value.every((item) => {
    return item && typeof item === 'object' && (
      typeof item.historyId === 'string'
      || typeof item.path === 'string'
      || typeof item.relativePath === 'string'
    )
  })
}

const extractHistoryItemsFromResponse = (value, visited = new Set()) => {
  if (!value || typeof value !== 'object')
    return []
  if (visited.has(value))
    return []
  visited.add(value)

  if (isHistoryItemArray(value))
    return value

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nestedItems = extractHistoryItemsFromResponse(entry, visited)
      if (nestedItems.length)
        return nestedItems
    }
    return []
  }

  const priorityKeys = ['items', 'data', 'result']
  for (const key of priorityKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      continue
    const nestedItems = extractHistoryItemsFromResponse(value[key], visited)
    if (nestedItems.length)
      return nestedItems
  }

  for (const nestedValue of Object.values(value)) {
    const nestedItems = extractHistoryItemsFromResponse(nestedValue, visited)
    if (nestedItems.length)
      return nestedItems
  }

  return []
}

const rawHistoryPreviewItems = computed(() => {
  return (state.historyItems || []).filter(item => !!getResolvedHistorySnapshotDoc(item))
})

const historyPreviewItems = computed(() => {
  return rawHistoryPreviewItems.value
})

const selectedHistoryEntry = computed(() => {
  return historyPreviewItems.value.find(item => item.historyId === state.historySelectedId) || null
})

const historyVersionItems = computed(() => {
  return historyPreviewItems.value.map((item, index) => ({
    name: item.historyId,
    title: formatHistoryEntryLabel(item, index),
  }))
})

const syncHistoryPreviewDoc = (entry) => {
  state.historyPreviewDoc = cloneThemeDocWithDefaults(getResolvedHistorySnapshotDoc(entry))
}

const historyPreviewThemeObject = computed(() => {
  const baseTheme = parseJsonSafe(state.historyPreviewDoc?.theme, {})
  const isObjectTheme = !!baseTheme && typeof baseTheme === 'object' && !Array.isArray(baseTheme)
  return {
    ...(isObjectTheme ? baseTheme : {}),
    extraCSS: typeof state.historyPreviewDoc?.extraCSS === 'string' ? state.historyPreviewDoc.extraCSS : '',
  }
})

const historyPreviewRenderKey = computed(() => {
  const historyId = String(state.historySelectedId || '')
  const themeValue = String(state.historyPreviewDoc?.theme || '')
  const extraCssValue = String(state.historyPreviewDoc?.extraCSS || '')
  return `${historyId}:${themeValue.length}:${extraCssValue.length}`
})

const escapeDiffHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const tokenizeDiffValue = (value) => {
  return String(value ?? '').match(/([A-Za-z0-9._:-]+|\s+|.)/g) || []
}

const buildLineHighlightedDiffHtml = (sourceValue, compareValue) => {
  const sourceLines = String(sourceValue ?? '').split('\n')
  const compareLineSet = new Set(String(compareValue ?? '').split('\n'))
  if (!sourceLines.length)
    return ''

  return sourceLines.map((line) => {
    const escapedLine = escapeDiffHtml(line)
    if (compareLineSet.has(line))
      return escapedLine
    return `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${escapedLine}</span>`
  }).join('\n') || '—'
}

const buildTokenDiffOnlyHtml = (sourceValue, compareValue) => {
  const sourceTokens = tokenizeDiffValue(sourceValue)
  const compareTokens = tokenizeDiffValue(compareValue)
  const sourceCount = sourceTokens.length
  const compareCount = compareTokens.length

  if (!sourceCount)
    return '—'

  if ((sourceCount * compareCount) > 120000) {
    const compareTokenSet = new Set(compareTokens)
    const changedTokens = sourceTokens.filter(token => !compareTokenSet.has(token))
    if (!changedTokens.length)
      return '—'
    return `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${escapeDiffHtml(changedTokens.join(''))}</span>`
  }

  const lcs = Array.from({ length: sourceCount + 1 }, () => Array(compareCount + 1).fill(0))
  for (let i = sourceCount - 1; i >= 0; i--) {
    for (let j = compareCount - 1; j >= 0; j--) {
      if (sourceTokens[i] === compareTokens[j])
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      else
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const groups = []
  let currentGroup = ''
  const flushGroup = () => {
    const normalized = currentGroup.trim()
    if (!normalized) {
      currentGroup = ''
      return
    }
    groups.push(normalized)
    currentGroup = ''
  }

  let i = 0
  let j = 0
  while (i < sourceCount && j < compareCount) {
    if (sourceTokens[i] === compareTokens[j]) {
      flushGroup()
      i++
      j++
      continue
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      currentGroup += sourceTokens[i]
      i++
      continue
    }
    j++
  }

  while (i < sourceCount) {
    currentGroup += sourceTokens[i]
    i++
  }
  flushGroup()

  if (!groups.length)
    return '—'

  return groups.map(group => `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${escapeDiffHtml(group)}</span>`).join('<span class="px-1 text-slate-400">...</span>')
}

const buildDiffOnlyHtml = (sourceValue, compareValue) => {
  const sourceText = String(sourceValue ?? '')
  const compareText = String(compareValue ?? '')
  const sourceLines = String(sourceValue ?? '').split('\n')
  const compareLines = String(compareValue ?? '').split('\n')
  const sourceCount = sourceLines.length
  const compareCount = compareLines.length

  if (!sourceCount)
    return '—'

  const lcs = Array.from({ length: sourceCount + 1 }, () => Array(compareCount + 1).fill(0))
  for (let i = sourceCount - 1; i >= 0; i--) {
    for (let j = compareCount - 1; j >= 0; j--) {
      if (sourceLines[i] === compareLines[j])
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      else
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const changedLines = []
  let i = 0
  let j = 0
  while (i < sourceCount && j < compareCount) {
    if (sourceLines[i] === compareLines[j]) {
      i++
      j++
      continue
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changedLines.push(sourceLines[i])
      i++
      continue
    }
    j++
  }
  while (i < sourceCount) {
    changedLines.push(sourceLines[i])
    i++
  }

  if (!changedLines.length) {
    if (sourceText.trim() && sourceText !== compareText)
      return buildTokenDiffOnlyHtml(sourceText, compareText)
    return '—'
  }

  return changedLines.map((line) => {
    const escapedLine = escapeDiffHtml(line)
    return `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${escapedLine}</span>`
  }).join('\n')
}

const buildHighlightedDiffHtml = (sourceValue, compareValue) => {
  const sourceTokens = tokenizeDiffValue(sourceValue)
  const compareTokens = tokenizeDiffValue(compareValue)
  const sourceCount = sourceTokens.length
  const compareCount = compareTokens.length

  if (!sourceCount)
    return ''

  if ((sourceCount * compareCount) > 120000) {
    return buildLineHighlightedDiffHtml(sourceValue, compareValue)
  }

  const lcs = Array.from({ length: sourceCount + 1 }, () => Array(compareCount + 1).fill(0))
  for (let i = sourceCount - 1; i >= 0; i--) {
    for (let j = compareCount - 1; j >= 0; j--) {
      if (sourceTokens[i] === compareTokens[j])
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      else
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const changedIndexes = new Set()
  let i = 0
  let j = 0
  while (i < sourceCount && j < compareCount) {
    if (sourceTokens[i] === compareTokens[j]) {
      i++
      j++
      continue
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changedIndexes.add(i)
      i++
      continue
    }
    j++
  }
  while (i < sourceCount) {
    changedIndexes.add(i)
    i++
  }

  let html = ''
  let pendingChanged = ''
  const flushPendingChanged = () => {
    if (!pendingChanged)
      return
    html += `<span class="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/40 dark:text-yellow-50">${pendingChanged}</span>`
    pendingChanged = ''
  }

  sourceTokens.forEach((token, index) => {
    const escapedToken = escapeDiffHtml(token)
    if (changedIndexes.has(index)) {
      pendingChanged += escapedToken
      return
    }
    flushPendingChanged()
    html += escapedToken
  })

  flushPendingChanged()
  return html || '—'
}

const summarizeThemeChangeValue = (value) => {
  if (value == null || value === '')
    return '—'
  if (typeof value === 'boolean')
    return value ? 'Yes' : 'No'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    }
    catch {
      return '—'
    }
  }
  return String(value)
}

const buildThemeChangeDetails = (baseDoc, compareDoc, { baseLabel, compareLabel } = {}) => {
  const changes = []
  const base = cloneThemeDocWithDefaults(baseDoc) || {}
  const compare = cloneThemeDocWithDefaults(compareDoc) || {}
  const fields = [
    { key: 'name', label: 'Theme Name' },
    { key: 'theme', label: 'Theme JSON', diffOnly: true },
    { key: 'headJSON', label: 'Head JSON' },
    { key: 'extraCSS', label: 'Extra CSS', diffOnly: true },
    { key: 'defaultMenus', label: 'Default Templates' },
    { key: 'defaultSiteSettings', label: 'Default Site Settings' },
  ]

  fields.forEach((field) => {
    const baseValue = base?.[field.key]
    const compareValue = compare?.[field.key]
    if (areEqualNormalized(baseValue, compareValue))
      return
    const baseSummary = summarizeThemeChangeValue(baseValue)
    const compareSummary = summarizeThemeChangeValue(compareValue)
    changes.push({
      key: field.key,
      label: field.label,
      baseLabel,
      compareLabel,
      base: baseSummary,
      compare: compareSummary,
      baseHtml: field.diffOnly ? buildDiffOnlyHtml(baseSummary, compareSummary) : buildHighlightedDiffHtml(baseSummary, compareSummary),
      compareHtml: field.diffOnly ? buildDiffOnlyHtml(compareSummary, baseSummary) : buildHighlightedDiffHtml(compareSummary, baseSummary),
      monospace: field.key !== 'name',
    })
  })

  return changes
}

const getThemeHistoryFieldDiffPair = (item, key, currentDoc) => {
  const afterDoc = isPlainObject(item?.afterData) ? item.afterData : null
  const beforeDoc = isPlainObject(item?.beforeData) ? item.beforeData : null
  const hasAfterValue = !!afterDoc && Object.prototype.hasOwnProperty.call(afterDoc, key)
  const hasBeforeValue = !!beforeDoc && Object.prototype.hasOwnProperty.call(beforeDoc, key)
  const afterValue = hasAfterValue ? afterDoc[key] : undefined
  const beforeValue = hasBeforeValue ? beforeDoc[key] : undefined
  const currentValue = currentDoc?.[key]

  if (hasAfterValue && areEqualNormalized(afterValue, currentValue)) {
    return {
      include: hasBeforeValue && !areEqualNormalized(beforeValue, currentValue),
      baseValue: hasBeforeValue ? beforeValue : currentValue,
      compareValue: currentValue,
    }
  }

  if (hasBeforeValue && areEqualNormalized(beforeValue, currentValue)) {
    return {
      include: hasAfterValue && !areEqualNormalized(afterValue, currentValue),
      baseValue: hasAfterValue ? afterValue : currentValue,
      compareValue: currentValue,
    }
  }

  if (hasBeforeValue && hasAfterValue) {
    return {
      include: !areEqualNormalized(beforeValue, currentValue) || !areEqualNormalized(afterValue, currentValue),
      baseValue: !areEqualNormalized(beforeValue, currentValue) ? beforeValue : afterValue,
      compareValue: currentValue,
    }
  }

  if (hasBeforeValue) {
    return {
      include: !areEqualNormalized(beforeValue, currentValue),
      baseValue: beforeValue,
      compareValue: currentValue,
    }
  }

  if (hasAfterValue) {
    return {
      include: !areEqualNormalized(afterValue, currentValue),
      baseValue: afterValue,
      compareValue: currentValue,
    }
  }

  return {
    include: false,
    baseValue: currentValue,
    compareValue: currentValue,
  }
}

const buildThemeHistoryChangeDetails = (item, compareDoc, { baseLabel, compareLabel } = {}) => {
  if (!item || typeof item !== 'object')
    return []

  const changes = []
  const compare = cloneThemeDocWithDefaults(compareDoc) || {}
  const fields = [
    { key: 'name', label: 'Theme Name' },
    { key: 'theme', label: 'Theme JSON', diffOnly: true },
    { key: 'headJSON', label: 'Head JSON' },
    { key: 'extraCSS', label: 'Extra CSS', diffOnly: true },
    { key: 'defaultMenus', label: 'Default Templates' },
    { key: 'defaultSiteSettings', label: 'Default Site Settings' },
  ]

  fields.forEach((field) => {
    const { include, baseValue, compareValue } = getThemeHistoryFieldDiffPair(item, field.key, compare)
    if (!include || areEqualNormalized(baseValue, compareValue))
      return
    const baseSummary = summarizeThemeChangeValue(baseValue)
    const compareSummary = summarizeThemeChangeValue(compareValue)
    changes.push({
      key: field.key,
      label: field.label,
      baseLabel,
      compareLabel,
      base: baseSummary,
      compare: compareSummary,
      baseHtml: field.diffOnly ? buildDiffOnlyHtml(baseSummary, compareSummary) : buildHighlightedDiffHtml(baseSummary, compareSummary),
      compareHtml: field.diffOnly ? buildDiffOnlyHtml(compareSummary, baseSummary) : buildHighlightedDiffHtml(compareSummary, baseSummary),
      monospace: field.key !== 'name',
    })
  })

  return changes
}

const historyDiffDetails = computed(() => {
  return buildThemeHistoryChangeDetails(selectedHistoryEntry.value, currentTheme.value, {
    baseLabel: 'Selected History',
    compareLabel: 'Current',
  })
})

const historyDiffCountLabel = computed(() => {
  if (!selectedHistoryEntry.value)
    return 'Select an entry'
  const count = historyDiffDetails.value.length
  if (count === 0)
    return 'No differences'
  if (count === 1)
    return '1 difference'
  return `${count} differences`
})

const hasHistoryDiff = computed(() => historyDiffDetails.value.length > 0)

const notifySuccess = (message) => {
  edgeFirebase?.toast?.success?.(message)
}

const notifyError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

watch(selectedHistoryEntry, (entry) => {
  syncHistoryPreviewDoc(entry)
}, { immediate: false })

watch(hasHistoryDiff, (nextValue) => {
  if (!nextValue)
    state.showHistoryDiffDialog = false
})

const handleUnsavedChanges = (changes) => {
  state.editorHasUnsavedChanges = changes === true
}

const loadThemeHistory = async () => {
  if (!edgeFirebase?.user?.uid || !currentThemePath.value)
    return

  state.historyLoading = true
  state.historyError = ''
  try {
    const response = await edgeFirebase.runFunction('history-listHistory', {
      uid: edgeFirebase.user.uid,
      path: currentThemePath.value,
      limit: 50,
    })

    state.historyItems = extractHistoryItemsFromResponse(response)
    const nextSelectedId = historyPreviewItems.value.find(item => item.historyId === state.historySelectedId)?.historyId
      || historyPreviewItems.value[0]?.historyId
      || ''
    state.historySelectedId = nextSelectedId
    syncHistoryPreviewDoc(selectedHistoryEntry.value)
  }
  catch (error) {
    console.error('Failed to load theme history', error)
    state.historyItems = []
    state.historySelectedId = ''
    state.historyPreviewDoc = null
    state.historyError = 'Failed to load theme history.'
  }
  finally {
    state.historyLoading = false
  }
}

const openHistoryDialog = async () => {
  if (!currentTheme.value || !currentThemePath.value || !edgeFirebase?.user?.uid)
    return
  state.historySelectedId = ''
  state.historyDialogOpen = true
  await loadThemeHistory()
}

const closeHistoryDialog = () => {
  if (state.historyRestoring)
    return
  state.showHistoryDiffDialog = false
  state.historyDialogOpen = false
}

const restoreHistoryVersion = async () => {
  const historyEntry = selectedHistoryEntry.value
  if (!historyEntry?.historyId || !edgeFirebase?.user?.uid)
    return

  state.historyRestoring = true
  state.historyError = ''
  try {
    const targetState = getHistorySnapshotState(historyEntry)
    await edgeFirebase.runFunction('history-restoreHistory', {
      uid: edgeFirebase.user.uid,
      historyId: historyEntry.historyId,
      targetState: getResolvedHistorySnapshotState(historyEntry) || targetState,
    })
    const restoredDoc = cloneThemeDocWithDefaults(getResolvedHistorySnapshotDoc(historyEntry))
    if (restoredDoc && props.themeId && props.themeId !== 'new')
      await edgeFirebase.storeDoc(themesCollectionPath.value, restoredDoc, props.themeId)
    if (restoredDoc && themesCollection.value)
      themesCollection.value[props.themeId] = edgeGlobal.dupObject(restoredDoc)
    state.workingDoc = restoredDoc || {}
    state.editorHasUnsavedChanges = false
    lastValidHead.value = parseJsonSafe(restoredDoc?.headJSON, {})
    lastValidTheme.value = parseJsonSafe(restoredDoc?.theme, {})
    state.showHistoryDiffDialog = false
    state.historyDialogOpen = false
    state.editorKey += 1
    notifySuccess(`Restored theme from ${formatHistoryEntryLabel(historyEntry)}.`)
  }
  catch (error) {
    console.error('Failed to restore theme history', error)
    state.historyError = 'Failed to restore this version.'
    notifyError('Failed to restore theme history.')
  }
  finally {
    state.historyRestoring = false
  }
}

const exportCurrentTheme = async () => {
  const doc = themesCollection.value?.[props.themeId]
  if (!doc || !doc.docId) {
    notifyError('Save this theme before exporting.')
    return
  }
  const exportPayload = { ...getThemeDocDefaults(), ...doc }
  const saved = await saveJsonFile(exportPayload, `theme-${doc.docId}.json`)
  if (saved)
    notifySuccess(`Exported theme "${doc.docId}".`)
}

watch (sites, async (newSites) => {
  state.loading = true
  const selectedSite = String(edgeGlobal.edgeState.blockEditorSite || '').trim()
  const hasSelectedSite = newSites.some(site => site.docId === selectedSite)
  if ((!selectedSite || !hasSelectedSite) && newSites.length > 0)
    edgeGlobal.edgeState.blockEditorSite = newSites[0].docId
  else if (!newSites.length)
    edgeGlobal.edgeState.blockEditorSite = ''
  await nextTick()
  state.loading = false
}, { immediate: true, deep: true })

watch(templatePages, (pages) => {
  const selected = ensureDefaultPagesArray()
  for (const entry of selected) {
    const latestName = pages?.[entry.pageId]?.name
    if (latestName && entry.name !== latestName)
      entry.name = latestName
  }
}, { deep: true })

watch(() => state.workingDoc?.defaultMenus, () => {
  if (!state.workingDoc)
    return
  syncDefaultPagesFromMenus()
}, { deep: true })

watch(() => state.workingDoc?.headJSON, (value) => {
  lastValidHead.value = parseJsonSafe(value, lastValidHead.value)
}, { immediate: true })

watch(() => state.workingDoc?.theme, (value) => {
  lastValidTheme.value = parseJsonSafe(value, lastValidTheme.value)
}, { immediate: true })

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/templates/pages`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/templates/pages`)
  }
  state.mounted = true
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-editor
      :key="state.editorKey"
      collection="themes"
      :doc-id="props.themeId"
      :schema="blockSchema"
      :new-doc-schema="state.newDocs.themes"
      header-class="py-2 rounded-none sticky top-0 border-b border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
      card-content-class="px-0"
      :show-footer="false"
      :no-close-after-save="true"
      :working-doc-overrides="state.workingDoc"
      @working-doc="editorDocUpdates"
      @unsaved-changes="handleUnsavedChanges"
    >
      <template #header-start="slotProps">
        <FilePenLine class="mr-2" />
        {{ slotProps.title }}
      </template>
      <template #header-center>
        <div class="w-full flex gap-2 px-4 items-center">
          <div class="w-full">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorSite"
              name="site"
              :items="sites.map(s => ({ title: s.name, name: s.docId }))"
              placeholder="Select Site"
              class="w-full"
            />
          </div>
          <div class="flex items-center gap-2">
            <edge-shad-button
              type="button"
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :disabled="props.themeId === 'new' || !currentTheme"
              title="View Theme History"
              aria-label="View Theme History"
              @click="openHistoryDialog"
            >
              <History class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button
              type="button"
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :disabled="props.themeId === 'new' || !themesCollection?.[props.themeId]"
              title="Export Theme"
              aria-label="Export Theme"
              @click="exportCurrentTheme"
            >
              <Download class="h-4 w-4" />
            </edge-shad-button>
          </div>
        </div>
      </template>
      <template #main="slotProps">
        <div class="pt-4 space-y-4">
          <edge-shad-input
            v-model="slotProps.workingDoc.name"
            label="Theme Name"
            name="name"
          />
          <div class="flex flex-col gap-4 xl:flex-row">
            <div class="w-full xl:w-1/2">
              <Tabs class="w-full" default-value="theme-json">
                <TabsList class="w-full mt-3 rounded-sm grid grid-cols-2 xl:grid-cols-5 border border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800">
                  <TabsTrigger value="theme-json" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Theme JSON
                  </TabsTrigger>
                  <TabsTrigger value="head-json" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Head JSON
                  </TabsTrigger>
                  <TabsTrigger value="custom-fonts" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Custom Fonts
                  </TabsTrigger>
                  <TabsTrigger value="extra-css" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Extra CSS
                  </TabsTrigger>
                  <TabsTrigger value="default-templates" class="w-full text-slate-700 dark:text-slate-200 data-[state=active]:bg-slate-700 data-[state=active]:text-white dark:data-[state=active]:bg-slate-200 dark:data-[state=active]:text-slate-900">
                    Default Templates
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="theme-json" class="mt-4">
                  <edge-cms-code-editor
                    v-model="slotProps.workingDoc.theme"
                    title="Theme JSON"
                    language="json"
                    name="content"
                    :height="editorViewportHeight"
                    class="w-full"
                  />
                </TabsContent>

                <TabsContent value="head-json" class="mt-4">
                  <edge-cms-code-editor
                    v-model="slotProps.workingDoc.headJSON"
                    title="Head JSON"
                    language="json"
                    name="headJSON"
                    :height="editorViewportHeight"
                    class="w-full"
                  />
                </TabsContent>

                <TabsContent value="custom-fonts" class="mt-4">
                  <edge-cms-font-upload
                    v-if="slotProps.workingDoc"
                    v-model:head-json="slotProps.workingDoc.headJSON"
                    :theme-id="props.themeId"
                    class="w-full"
                  />
                </TabsContent>

                <TabsContent value="extra-css" class="mt-4">
                  <edge-cms-code-editor
                    v-model="slotProps.workingDoc.extraCSS"
                    title="Extra CSS"
                    language="css"
                    name="extraCSS"
                    :height="editorViewportHeight"
                    class="w-full"
                  />
                </TabsContent>

                <TabsContent value="default-templates" class="mt-4">
                  <Card class="h-full">
                    <CardHeader class="pb-2">
                      <div class="flex items-center justify-between gap-2">
                        <CardTitle class="text-base">
                          Default Templates
                        </CardTitle>
                        <edge-shad-button
                          size="icon"
                          type="text"
                          @click="state.defaultSettingsOpen = true"
                        >
                          <FolderCog class="h-4 w-4" />
                        </edge-shad-button>
                      </div>
                      <CardDescription class="text-xs">
                        Choose which template pages are created for new sites and organize them into Site Menu or Not In Menu.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <edge-cms-theme-default-menu
                        v-if="slotProps.workingDoc"
                        v-model="slotProps.workingDoc.defaultMenus"
                        :template-options="templatePageOptions"
                        :template-pages="templatePages"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
            <div class="w-full xl:w-1/2">
              <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
                <edge-cms-block-picker
                  :site-id="edgeGlobal.edgeState.blockEditorSite"
                  class="!h-[calc(100vh-270px)] overflow-y-auto"
                  list-only
                  :theme="previewTheme"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
    <edge-shad-dialog v-model="state.historyDialogOpen">
      <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="text-left">
            Theme History
          </DialogTitle>
          <DialogDescription class="text-left">
            Select a saved version, preview it, and restore it if needed.
          </DialogDescription>
        </DialogHeader>
        <div class="min-w-0 space-y-4">
          <div class="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
            <div class="flex min-w-0 flex-col justify-end">
              <edge-shad-combobox
                v-model="state.historySelectedId"
                name="themeHistoryVersion"
                label="History Entry"
                :items="historyVersionItems"
                placeholder="Select a history entry"
                class="w-full"
                :disabled="state.historyLoading || state.historyRestoring || historyVersionItems.length === 0"
              />
            </div>
            <div class="flex min-w-0 flex-col justify-end">
              <edge-shad-button
                type="button"
                variant="outline"
                class="h-10 justify-between gap-3 px-3 text-left"
                :disabled="!selectedHistoryEntry || state.historyLoading || !hasHistoryDiff"
                @click="state.showHistoryDiffDialog = true"
              >
                <span class="truncate">{{ hasHistoryDiff ? 'View Diff' : 'No Differences' }}</span>
                <span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {{ historyDiffCountLabel }}
                </span>
              </edge-shad-button>
            </div>
          </div>

          <div v-if="state.historyError" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {{ state.historyError }}
          </div>

          <div
            v-if="state.editorHasUnsavedChanges"
            class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            There are unsaved changes. History compares saved versions of this theme.
          </div>

          <div class="min-w-0 rounded-md border border-slate-300 bg-card dark:border-slate-700">
            <div
              v-if="state.historyLoading"
              class="flex h-[65vh] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              Loading history preview...
            </div>
            <div
              v-else-if="!state.historyPreviewDoc"
              class="flex h-[65vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              No older saved versions are available to preview.
            </div>
            <div v-else class="p-3">
              <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
                <edge-cms-block-picker
                  :key="historyPreviewRenderKey"
                  :site-id="edgeGlobal.edgeState.blockEditorSite"
                  class="!h-[60vh] overflow-y-auto"
                  list-only
                  :theme="historyPreviewThemeObject"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" :disabled="state.historyRestoring" @click="closeHistoryDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            :disabled="state.historyLoading || state.historyRestoring || !selectedHistoryEntry"
            @click="restoreHistoryVersion"
          >
            <Loader2 v-if="state.historyRestoring" class="mr-2 h-4 w-4 animate-spin" />
            <RotateCcw v-else class="mr-2 h-4 w-4" />
            Restore
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.showHistoryDiffDialog">
      <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="text-left">
            Theme Diff
          </DialogTitle>
          <DialogDescription class="text-left">
            Review differences between the selected history entry and the current theme.
          </DialogDescription>
        </DialogHeader>
        <div class="mt-2 flex-1 overflow-y-auto pr-1">
          <div v-if="historyDiffDetails.length" class="space-y-3">
            <div
              v-for="change in historyDiffDetails"
              :key="change.key"
              class="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 p-3 text-left"
            >
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                {{ change.label }}
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                  <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                    {{ change.baseLabel || 'Selected History' }}
                  </div>
                  <div
                    class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100"
                    :class="change.monospace ? 'font-mono text-xs leading-5' : ''"
                    v-html="change.baseHtml || change.base"
                  />
                </div>
                <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                  <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                    {{ change.compareLabel || 'Current' }}
                  </div>
                  <div
                    class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100"
                    :class="change.monospace ? 'font-mono text-xs leading-5' : ''"
                    v-html="change.compareHtml || change.compare"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-4">
          <edge-shad-button class="w-full" variant="outline" @click="state.showHistoryDiffDialog = false">
            Close
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <Sheet v-model:open="state.defaultSettingsOpen">
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>Default Site Settings</SheetTitle>
          <SheetDescription>
            These values seed new sites created with this theme.
          </SheetDescription>
        </SheetHeader>
        <div class="p-6 h-[calc(100vh-140px)] overflow-y-auto">
          <edge-cms-site-settings-form
            v-if="state.workingDoc"
            :settings="state.workingDoc.defaultSiteSettings"
            :show-users="false"
            :show-theme-fields="false"
            :is-admin="true"
            :enable-media-picker="false"
          />
        </div>
        <SheetFooter class="pt-2">
          <edge-shad-button class="w-full" @click="state.defaultSettingsOpen = false">
            Done
          </edge-shad-button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
