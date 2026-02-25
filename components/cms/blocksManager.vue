<script setup>
const edgeFirebase = inject('edgeFirebase')
const { blocks: blockNewDocSchema } = useCmsNewDocs()
const state = reactive({
  filter: '',
  mounted: false,
  picksFilter: [],
  themesFilter: [],
  selectedBlockDocIds: [],
  bulkDeleteDialogOpen: false,
  bulkDeleting: false,
  importingJson: false,
  importDocIdDialogOpen: false,
  importDocIdValue: '',
  importConflictDialogOpen: false,
  importConflictDocId: '',
  importErrorDialogOpen: false,
  importErrorMessage: '',
})

const rawInitBlockFiles = import.meta.glob('./init_blocks/*.html', {
  as: 'raw',
  eager: true,
})

const INITIAL_BLOCKS = Object.entries(rawInitBlockFiles).map(([path, content]) => {
  const fileName = path.split('/').pop() || ''
  const baseName = fileName.replace(/\.html$/i, '')
  const formattedName = baseName
    .split('_')
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
  return {
    docId: baseName,
    name: formattedName,
    content,
  }
})

const router = useRouter()
const blockImportInputRef = ref(null)
const blockImportDocIdResolver = ref(null)
const blockImportConflictResolver = ref(null)
const INVALID_BLOCK_IMPORT_MESSAGE = 'Invalid file. Please import a valid block file.'

const seedInitialBlocks = async () => {
  console.log('Seeding initial blocks...')
  console.log(`Found ${INITIAL_BLOCKS.length} initial blocks to seed.`)
  if (!INITIAL_BLOCKS.length)
    return 0

  const organizationPath = edgeGlobal.edgeState.organizationDocPath
  if (!organizationPath)
    return 0

  const collectionPath = `${organizationPath}/blocks`
  let created = 0

  for (const block of INITIAL_BLOCKS) {
    if (!block.docId)
      continue
    try {
      await edgeFirebase.storeDoc(collectionPath, {
        docId: block.docId,
        name: block.name,
        content: block.content,
        previewType: 'light',
        tags: [],
        themes: [],
        synced: false,
        version: 1,
      })
      created++
      console.log(`Seeded block "${block.docId}"`)
    }
    catch (error) {
      console.error(`Failed to seed block "${block.docId}"`, error)
    }
  }

  return created
}

const getThemeFromId = (themeId) => {
  const theme = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]?.[themeId]
  return theme?.name || 'Unknown'
}

const normalizePreviewType = (value) => {
  return value === 'dark' ? 'dark' : 'light'
}

const previewSurfaceClass = (value) => {
  return normalizePreviewType(value) === 'dark'
    ? 'preview-surface-dark'
    : 'preview-surface-light'
}

const loadingRender = (content) => {
  const safeContent = typeof content === 'string' ? content : ''
  return safeContent.replaceAll('{{loading}}', '').replaceAll('{{loaded}}', 'hidden')
}

const FILTER_STORAGE_KEY = 'edge.blocks.filters'
const NO_TAGS_FILTER_VALUE = '__no_tags__'

const restoreFilters = () => {
  if (typeof localStorage === 'undefined')
    return
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw)
      return
    const parsed = JSON.parse(raw)
    state.filter = parsed.filter ?? ''
    state.picksFilter = Array.isArray(parsed.picksFilter) ? parsed.picksFilter : []
    state.themesFilter = Array.isArray(parsed.themesFilter) ? parsed.themesFilter : []
  }
  catch (err) {
    console.warn('Failed to restore block filters', err)
  }
}

const persistFilters = () => {
  if (typeof localStorage === 'undefined')
    return
  const payload = {
    filter: state.filter,
    picksFilter: state.picksFilter,
    themesFilter: state.themesFilter,
  }
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload))
}

watch(
  () => [state.filter, state.picksFilter, state.themesFilter],
  persistFilters,
  { deep: true },
)

onBeforeMount(async () => {
  restoreFilters()
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  state.mounted = true
})

const tagOptions = computed(() => {
  const tagsSet = new Set()
  const blocks = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {}
  Object.values(blocks).forEach((block) => {
    if (Array.isArray(block.tags))
      block.tags.forEach(tag => tagsSet.add(tag))
  })
  const tagItems = Array.from(tagsSet).sort((a, b) => a.localeCompare(b)).map(tag => ({ name: tag, title: tag }))
  return [{ name: NO_TAGS_FILTER_VALUE, title: 'No Tags' }, ...tagItems]
})

const themeOptions = computed(() => {
  const themes = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
  return Object.entries(themes)
    .map(([id, theme]) => ({ name: id, title: theme.name || id }))
    .sort((a, b) => a.title.localeCompare(b.title))
})

const themesCollection = computed(() => {
  return edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
})

const parsedThemesById = computed(() => {
  const parsed = {}
  for (const [themeId, themeDoc] of Object.entries(themesCollection.value || {})) {
    const rawTheme = themeDoc?.theme
    if (!rawTheme)
      continue
    if (typeof rawTheme === 'string') {
      try {
        parsed[themeId] = JSON.parse(rawTheme)
      }
      catch {
        continue
      }
      continue
    }
    if (typeof rawTheme === 'object' && !Array.isArray(rawTheme))
      parsed[themeId] = rawTheme
  }
  return parsed
})

const firstThemeId = computed(() => themeOptions.value?.[0]?.name || '')

const getPreviewThemeForBlock = (block) => {
  const allowedThemeIds = Array.isArray(block?.themes)
    ? block.themes.map(themeId => String(themeId || '').trim()).filter(Boolean)
    : []

  let preferredThemeId = allowedThemeIds.find(themeId => !!parsedThemesById.value?.[themeId]) || ''
  if (!preferredThemeId)
    preferredThemeId = firstThemeId.value
  if (!preferredThemeId)
    return null

  return parsedThemesById.value?.[preferredThemeId] || null
}

const listFilters = computed(() => {
  const filters = []
  if (state.themesFilter.length)
    filters.push({ filterFields: ['themes'], value: state.themesFilter })
  return filters
})

const applyTagSelectionFilter = (items = []) => {
  const selectedFilters = Array.isArray(state.picksFilter) ? state.picksFilter : []
  if (!selectedFilters.length)
    return items

  const includeNoTags = selectedFilters.includes(NO_TAGS_FILTER_VALUE)
  const selectedTags = selectedFilters.filter(value => value !== NO_TAGS_FILTER_VALUE)

  return items.filter((item) => {
    const tags = Array.isArray(item?.tags) ? item.tags : []
    const hasNoTags = tags.length === 0
    const hasSelectedTag = selectedTags.length > 0
      ? tags.some(tag => selectedTags.includes(tag))
      : false

    if (includeNoTags && selectedTags.length > 0)
      return hasNoTags || hasSelectedTag
    if (includeNoTags)
      return hasNoTags
    return hasSelectedTag
  })
}

const blockCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/blocks`)
const blocksCollection = computed(() => edgeFirebase.data?.[blockCollectionPath.value] || {})
const selectedBlockSet = computed(() => new Set(state.selectedBlockDocIds))
const selectedBlockCount = computed(() => state.selectedBlockDocIds.length)

const normalizeDocId = value => String(value || '').trim()

const isBlockSelected = docId => selectedBlockSet.value.has(normalizeDocId(docId))

const setBlockSelection = (docId, checked) => {
  const normalizedDocId = normalizeDocId(docId)
  if (!normalizedDocId)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  if (shouldSelect) {
    if (!selectedBlockSet.value.has(normalizedDocId))
      state.selectedBlockDocIds = [...state.selectedBlockDocIds, normalizedDocId]
    return
  }
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(id => id !== normalizedDocId)
}

const getVisibleSelectionState = (visibleItems = []) => {
  if (!visibleItems.length)
    return false
  let selectedVisibleCount = 0
  for (const item of visibleItems) {
    if (isBlockSelected(item?.docId))
      selectedVisibleCount += 1
  }
  if (selectedVisibleCount === 0)
    return false
  if (selectedVisibleCount === visibleItems.length)
    return true
  return 'indeterminate'
}

const toggleVisibleBlockSelection = (visibleItems = [], checked) => {
  if (!visibleItems.length)
    return
  const shouldSelect = checked === true || checked === 'indeterminate'
  const visibleDocIds = visibleItems.map(item => normalizeDocId(item?.docId)).filter(Boolean)
  if (shouldSelect) {
    state.selectedBlockDocIds = [...new Set([...state.selectedBlockDocIds, ...visibleDocIds])]
    return
  }
  const visibleDocIdSet = new Set(visibleDocIds)
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(id => !visibleDocIdSet.has(id))
}

const clearSelectedBlocks = () => {
  state.selectedBlockDocIds = []
}

const openBulkDeleteDialog = () => {
  if (!selectedBlockCount.value)
    return
  state.bulkDeleteDialogOpen = true
}

const bulkDeleteAction = async () => {
  if (state.bulkDeleting || !selectedBlockCount.value) {
    state.bulkDeleteDialogOpen = false
    return
  }

  state.bulkDeleting = true
  const selectedDocIds = [...state.selectedBlockDocIds]
  const blocks = blocksCollection.value || {}
  const failedDocIds = []
  let deletedCount = 0

  try {
    for (const docId of selectedDocIds) {
      if (!blocks[docId])
        continue
      try {
        await edgeFirebase.removeDoc(blockCollectionPath.value, docId)
        deletedCount += 1
      }
      catch (error) {
        failedDocIds.push(docId)
        console.error(`Failed to delete block "${docId}"`, error)
      }
    }

    state.selectedBlockDocIds = failedDocIds
    state.bulkDeleteDialogOpen = false

    if (deletedCount)
      edgeFirebase?.toast?.success?.(`Deleted ${deletedCount} block${deletedCount === 1 ? '' : 's'}.`)
    if (failedDocIds.length)
      edgeFirebase?.toast?.error?.(`Failed to delete ${failedDocIds.length} block${failedDocIds.length === 1 ? '' : 's'}.`)
  }
  finally {
    state.bulkDeleting = false
  }
}

watch(blocksCollection, (collection) => {
  const validDocIds = new Set(Object.keys(collection || {}))
  state.selectedBlockDocIds = state.selectedBlockDocIds.filter(docId => validDocIds.has(docId))
}, { deep: true })

const readTextFile = file => new Promise((resolve, reject) => {
  if (typeof FileReader === 'undefined') {
    reject(new Error('File import is only available in the browser.'))
    return
  }
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Could not read the selected file.'))
  reader.readAsText(file)
})

const normalizeImportedDoc = (payload, fallbackDocId = '') => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(INVALID_BLOCK_IMPORT_MESSAGE)

  if (payload.document && typeof payload.document === 'object' && !Array.isArray(payload.document)) {
    const normalized = { ...payload.document }
    if (!normalized.docId && payload.docId)
      normalized.docId = payload.docId
    if (!normalized.docId && fallbackDocId)
      normalized.docId = fallbackDocId
    return normalized
  }

  const normalized = { ...payload }
  if (!normalized.docId && fallbackDocId)
    normalized.docId = fallbackDocId
  return normalized
}

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

const getBlockDocDefaults = () => getDocDefaultsFromSchema(blockNewDocSchema.value || {})

const validateImportedBlockDoc = (doc) => {
  if (!isPlainObject(doc))
    throw new Error(INVALID_BLOCK_IMPORT_MESSAGE)

  const requiredKeys = Object.keys(blockNewDocSchema.value || {})
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(INVALID_BLOCK_IMPORT_MESSAGE)

  return doc
}

const validateImportedBlockThemes = (doc) => {
  const importedThemes = Array.isArray(doc?.themes) ? doc.themes : []
  if (!importedThemes.length)
    return doc

  const orgThemes = edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`] || {}
  const normalizedThemes = []
  for (const themeId of importedThemes) {
    const normalizedThemeId = String(themeId || '').trim()
    if (!normalizedThemeId || !orgThemes[normalizedThemeId])
      throw new Error(INVALID_BLOCK_IMPORT_MESSAGE)
    normalizedThemes.push(normalizedThemeId)
  }

  doc.themes = [...new Set(normalizedThemes)]
  return doc
}

const makeUniqueDocId = (baseDocId, docsMap = {}) => {
  const cleanBase = String(baseDocId || '').trim() || 'block'
  let nextDocId = `${cleanBase}-copy`
  let suffix = 2
  while (docsMap[nextDocId]) {
    nextDocId = `${cleanBase}-copy-${suffix}`
    suffix += 1
  }
  return nextDocId
}

const requestBlockImportDocId = (initialValue = '') => {
  state.importDocIdValue = String(initialValue || '')
  state.importDocIdDialogOpen = true
  return new Promise((resolve) => {
    blockImportDocIdResolver.value = resolve
  })
}

const resolveBlockImportDocId = (value = '') => {
  const resolver = blockImportDocIdResolver.value
  blockImportDocIdResolver.value = null
  state.importDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestBlockImportConflict = (docId) => {
  state.importConflictDocId = String(docId || '')
  state.importConflictDialogOpen = true
  return new Promise((resolve) => {
    blockImportConflictResolver.value = resolve
  })
}

const resolveBlockImportConflict = (action = 'cancel') => {
  const resolver = blockImportConflictResolver.value
  blockImportConflictResolver.value = null
  state.importConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

watch(() => state.importDocIdDialogOpen, (open) => {
  if (!open && blockImportDocIdResolver.value) {
    const resolver = blockImportDocIdResolver.value
    blockImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importConflictDialogOpen, (open) => {
  if (!open && blockImportConflictResolver.value) {
    const resolver = blockImportConflictResolver.value
    blockImportConflictResolver.value = null
    resolver('cancel')
  }
})

const getImportDocId = async (incomingDoc, fallbackDocId = '') => {
  let nextDocId = String(incomingDoc?.docId || '').trim()
  if (!nextDocId)
    nextDocId = await requestBlockImportDocId(fallbackDocId)
  if (!nextDocId)
    throw new Error('Import canceled. A docId is required.')
  if (nextDocId.includes('/'))
    throw new Error('docId cannot include "/".')
  return nextDocId
}

const openImportErrorDialog = (message) => {
  state.importErrorMessage = String(message || 'Failed to import block JSON.')
  state.importErrorDialogOpen = true
}

const triggerBlockImport = () => {
  blockImportInputRef.value?.click()
}

const importSingleBlockFile = async (file, existingBlocks = {}) => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = validateImportedBlockThemes(validateImportedBlockDoc(normalizeImportedDoc(parsed, '')))
  const incomingDocId = await getImportDocId(importedDoc, '')
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingBlocks[targetDocId]) {
    const decision = await requestBlockImportConflict(targetDocId)
    if (decision === 'cancel')
      return
    if (decision === 'new') {
      targetDocId = makeUniqueDocId(targetDocId, existingBlocks)
      if (typeof importedDoc.name === 'string' && importedDoc.name.trim() && !/\(Copy\)$/i.test(importedDoc.name.trim()))
        importedDoc.name = `${importedDoc.name} (Copy)`
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const payload = { ...getBlockDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(blockCollectionPath.value, payload, targetDocId)
  existingBlocks[targetDocId] = payload

  if (importDecision === 'overwrite')
    edgeFirebase?.toast?.success?.(`Overwrote block "${targetDocId}".`)
  else if (importDecision === 'new')
    edgeFirebase?.toast?.success?.(`Imported block as new "${targetDocId}".`)
  else
    edgeFirebase?.toast?.success?.(`Imported block "${targetDocId}".`)
}

const handleBlockImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingJson = true
  const existingBlocks = { ...(blocksCollection.value || {}) }
  try {
    const themesCollectionPath = `organizations/${edgeGlobal.edgeState.currentOrganization}/themes`
    if (!edgeFirebase.data?.[themesCollectionPath])
      await edgeFirebase.startSnapshot(themesCollectionPath)

    for (const file of files) {
      try {
        await importSingleBlockFile(file, existingBlocks)
      }
      catch (error) {
        console.error('Failed to import block JSON', error)
        const message = error?.message || 'Failed to import block JSON.'
        if (/^Import canceled\./i.test(message))
          continue
        if (error instanceof SyntaxError || message === INVALID_BLOCK_IMPORT_MESSAGE)
          openImportErrorDialog(INVALID_BLOCK_IMPORT_MESSAGE)
        else
          openImportErrorDialog(message)
      }
    }
  }
  finally {
    state.importingJson = false
    if (input)
      input.value = ''
  }
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-dashboard
      :filter="state.filter"
      :filters="listFilters"
      collection="blocks"
      class="pt-0 flex-1"
    >
      <template #header-start="slotProps">
        <component :is="slotProps.icon" class="mr-2" />
        Blocks
        <edge-shad-button
          v-if="slotProps.recordCount === 0"
          variant="outline"
          class="ml-4 h-8 text-xs"
          @click="seedInitialBlocks"
        >
          Seed Blocks
        </edge-shad-button>
      </template>
      <template #header-center>
        <edge-shad-form class="w-full">
          <div class="w-full px-4 md:px-6 flex flex-col gap-2 md:flex-row md:items-center">
            <div class="grow">
              <edge-shad-input
                v-model="state.filter"
                name="filter"
                placeholder="Search blocks..."
                class="w-full"
              />
            </div>
            <div>
              <edge-shad-select-tags
                v-model="state.picksFilter"
                :items="tagOptions"
                name="tags"
                placeholder="Filter tags"
              />
            </div>
            <div>
              <edge-shad-select-tags
                v-model="state.themesFilter"
                :items="themeOptions"
                name="themes"
                placeholder="Filter themes"
              />
            </div>
          </div>
        </edge-shad-form>
      </template>
      <template #header-end>
        <div class="flex items-center gap-2">
          <input
            ref="blockImportInputRef"
            type="file"
            multiple
            accept=".json,application/json"
            class="hidden"
            @change="handleBlockImport"
          >
          <edge-shad-button
            type="button"
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :disabled="state.importingJson"
            title="Import Blocks"
            aria-label="Import Blocks"
            @click="triggerBlockImport"
          >
            <Loader2 v-if="state.importingJson" class="h-4 w-4 animate-spin" />
            <Upload v-else class="h-4 w-4" />
          </edge-shad-button>
          <edge-shad-button class="uppercase bg-primary" to="/app/dashboard/blocks/new">
            Add Block
          </edge-shad-button>
        </div>
      </template>
      <template #list="slotProps">
        <div class="w-full pt-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2">
            <div class="flex items-center gap-2">
              <Checkbox
                :model-value="getVisibleSelectionState(applyTagSelectionFilter(slotProps.filtered))"
                aria-label="Select visible blocks"
                class="border-border bg-background/90 shadow-sm data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                @click.stop
                @update:model-value="toggleVisibleBlockSelection(applyTagSelectionFilter(slotProps.filtered), $event)"
              />
              <span class="text-xs text-muted-foreground">
                Select visible ({{ applyTagSelectionFilter(slotProps.filtered).length }})
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ selectedBlockCount }} selected</span>
              <edge-shad-button
                variant="outline"
                class="h-8 text-xs"
                :disabled="selectedBlockCount === 0"
                @click="clearSelectedBlocks"
              >
                Clear
              </edge-shad-button>
              <edge-shad-button
                variant="destructive"
                class="h-8 text-xs text-white"
                :disabled="selectedBlockCount === 0"
                @click="openBulkDeleteDialog"
              >
                Delete selected
              </edge-shad-button>
            </div>
          </div>
          <div
            class="grid gap-4 w-full"
            style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));"
          >
            <div
              v-for="item in applyTagSelectionFilter(slotProps.filtered)"
              :key="item.docId"
              role="button"
              tabindex="0"
              class="w-full h-full"
              @click="router.push(`/app/dashboard/blocks/${item.docId}`)"
              @keyup.enter="router.push(`/app/dashboard/blocks/${item.docId}`)"
            >
              <Card
                class="h-full cursor-pointer border border-border/60 bg-card/40 hover:border-primary/50 hover:shadow-[0_22px_55px_-24px_rgba(0,0,0,0.4)] transition"
                :class="isBlockSelected(item.docId) ? 'border-primary/70 ring-2 ring-primary/50' : 'border-white/5'"
              >
                <CardContent class="flex flex-col gap-1 p-4 sm:p-5">
                  <div class="flex items-start gap-3">
                    <div class="pt-1" @click.stop>
                      <Checkbox
                        :model-value="isBlockSelected(item.docId)"
                        :aria-label="`Select block ${item.name || item.docId}`"
                        class="border-border bg-background/90 shadow-sm data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                        @click.stop
                        @update:model-value="setBlockSelection(item.docId, $event)"
                      />
                    </div>
                    <p class="text-lg font-semibold leading-snug line-clamp-2 text-foreground flex-1">
                      {{ item.name }}
                    </p>
                    <edge-shad-button
                      size="icon"
                      variant="ghost"
                      class="h-8 w-8 text-foreground/75 hover:text-foreground hover:bg-muted/80"
                      @click.stop="slotProps.deleteItem(item.docId)"
                    >
                      <Trash class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                  <div v-if="item.content" class="block-preview" :class="previewSurfaceClass(item.previewType)">
                    <div class="scale-wrapper">
                      <div class="scale-inner scale p-4">
                        <edge-cms-block-render
                          :content="loadingRender(item.content)"
                          :values="item.values"
                          :meta="item.meta"
                          :theme="getPreviewThemeForBlock(item)"
                        />
                      </div>
                    </div>
                    <div class="preview-overlay" />
                  </div>
                  <div v-else class="block-preview-empty" :class="previewSurfaceClass(item.previewType)">
                    Preview unavailable for this block.
                  </div>
                  <div class="flex flex-wrap items-center gap-1 text-[11px] text-slate-300 uppercase tracking-wide overflow-hidden">
                    <edge-chip
                      v-for="tag in item.tags?.slice(0, 3) ?? []"
                      :key="tag"
                      class="bg-primary/40 text-white px-2 py-0.5 text-[10px]"
                    >
                      {{ tag }}
                    </edge-chip>
                    <span v-if="item.tags?.length > 3" class="text-white/60">+{{ item.tags.length - 3 }}</span>
                    <edge-chip
                      v-for="theme in item.themes?.slice(0, 2) ?? []"
                      :key="theme"
                      class="bg-slate-800 text-white px-2 py-0.5 text-[10px]"
                    >
                      {{ getThemeFromId(theme) }}
                    </edge-chip>
                    <span v-if="item.themes?.length > 2" class="text-white/60">+{{ item.themes.length - 2 }}</span>
                    <span
                      v-if="!(item.tags?.length) && !(item.themes?.length)"
                      class="text-slate-500 lowercase"
                    >
                      none
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </template>
    </edge-dashboard>
    <edge-shad-dialog v-model="state.importDocIdDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Enter Block Doc ID
          </DialogTitle>
          <DialogDescription>
            This JSON file does not include a <code>docId</code>. Enter the doc ID you want to import into.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input
          v-model="state.importDocIdValue"
          name="block-import-doc-id"
          label="Doc ID"
          placeholder="example-block-id"
        />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveBlockImportDocId('')">
            Cancel
          </edge-shad-button>
          <edge-shad-button @click="resolveBlockImportDocId(state.importDocIdValue)">
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importConflictDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Block Already Exists
          </DialogTitle>
          <DialogDescription>
            <code>{{ state.importConflictDocId }}</code> already exists. Choose to overwrite it or import as a new block.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveBlockImportConflict('cancel')">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="outline" @click="resolveBlockImportConflict('new')">
            Add As New
          </edge-shad-button>
          <edge-shad-button @click="resolveBlockImportConflict('overwrite')">
            Overwrite
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importErrorDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Import Failed
          </DialogTitle>
          <DialogDescription class="text-left">
            {{ state.importErrorMessage }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2">
          <edge-shad-button @click="state.importErrorDialogOpen = false">
            Close
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.bulkDeleteDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Delete Selected Blocks?
          </DialogTitle>
          <DialogDescription class="text-left">
            This action cannot be undone. {{ selectedBlockCount }} block{{ selectedBlockCount === 1 ? '' : 's' }} will be permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button
            class="text-white bg-slate-800 hover:bg-slate-400"
            :disabled="state.bulkDeleting"
            @click="state.bulkDeleteDialogOpen = false"
          >
            Cancel
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            class="text-white w-full"
            :disabled="state.bulkDeleting || selectedBlockCount === 0"
            @click="bulkDeleteAction"
          >
            <Loader2 v-if="state.bulkDeleting" class="h-4 w-4 animate-spin" />
            <span v-else>Delete Selected</span>
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style scoped>
.block-preview {
  position: relative;
  height: 220px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: transparent;
  overflow: hidden;
  box-shadow: none;
}

.block-preview.preview-surface-light {
  background: #ffffff;
  color: #0f172a;
  border-color: rgba(15, 23, 42, 0.15);
}

.block-preview.preview-surface-dark {
  background: #020617;
  color: #f8fafc;
  border-color: rgba(248, 250, 252, 0.18);
}

.block-preview-empty {
  height: 220px;
  border-radius: 14px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  background: linear-gradient(135deg, rgba(10, 14, 26, 0.65), rgba(17, 24, 39, 0.5));
  color: rgba(255, 255, 255, 0.6);
  display: grid;
  place-items: center;
  font-size: 13px;
  letter-spacing: 0.01em;
}

.block-preview-empty.preview-surface-light {
  border-color: rgba(15, 23, 42, 0.18);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(241, 245, 249, 0.95));
  color: rgba(15, 23, 42, 0.72);
}

.block-preview-empty.preview-surface-dark {
  border-color: rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(10, 14, 26, 0.65), rgba(17, 24, 39, 0.5));
  color: rgba(255, 255, 255, 0.6);
}

.preview-overlay {
  display: none;
}

.scale-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.scale-inner {
  transform-origin: top left;
  display: inline-block;
  min-width: 100%;
}

.scale {
  transform: scale(0.25);
  width: 400%;
}
</style>
