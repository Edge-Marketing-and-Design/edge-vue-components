<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'
import { Download, MoreHorizontal } from 'lucide-vue-next'

const edgeFirebase = inject('edgeFirebase')
const { saveJsonFiles } = useJsonFileSave()
const { themes: themeNewDocSchema } = useCmsNewDocs()
const state = reactive({
  filter: '',
  exportingThemes: false,
  exportDialogOpen: false,
  exportDialogStatus: 'idle',
  exportDialogProcessed: 0,
  exportDialogTotal: 0,
  exportDialogCurrentItem: '',
  exportCancelRequested: false,
  importingJson: false,
  importDocIdDialogOpen: false,
  importDocIdValue: '',
  importConflictDialogOpen: false,
  importConflictDocId: '',
  importErrorDialogOpen: false,
  importErrorMessage: '',
})
const themeImportInputRef = ref(null)
const themeImportDocIdResolver = ref(null)
const themeImportConflictResolver = ref(null)
const INVALID_THEME_IMPORT_MESSAGE = 'Invalid file. Please import a valid theme file.'

useEdgeCmsDialogPositionFix()

useEdgeCmsDialogPositionFix()

definePageMeta({
  middleware: 'auth',
})

const themesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/themes`)
const themesCollection = computed(() => edgeFirebase.data?.[themesCollectionPath.value] || {})

const openThemesExportDialog = (total) => {
  state.exportDialogOpen = true
  state.exportDialogStatus = 'running'
  state.exportDialogProcessed = 0
  state.exportDialogTotal = total
  state.exportDialogCurrentItem = ''
  state.exportCancelRequested = false
}

const syncThemesExportProgress = ({ completed = 0, total = 0, suggestedName = '' } = {}) => {
  state.exportDialogOpen = true
  state.exportDialogProcessed = completed
  state.exportDialogTotal = total || state.exportDialogTotal
  state.exportDialogCurrentItem = suggestedName || ''
}

const finishThemesExportDialog = (savedCount) => {
  state.exportDialogProcessed = savedCount
  state.exportDialogStatus = savedCount === state.exportDialogTotal ? 'complete' : 'canceled'
  state.exportCancelRequested = false
}

const cancelThemesExport = () => {
  if (!state.exportingThemes)
    return
  state.exportCancelRequested = true
}

const closeThemesExportDialog = () => {
  if (state.exportingThemes)
    return
  state.exportDialogOpen = false
}

const exportAllThemes = async () => {
  if (state.exportingThemes)
    return
  const files = Object.entries(themesCollection.value || {})
    .sort(([leftId], [rightId]) => String(leftId).localeCompare(String(rightId)))
    .map(([docId, doc]) => ({
      suggestedName: `theme-${docId}.json`,
      payload: {
        ...edgeGlobal.dupObject(doc || {}),
        docId,
      },
    }))

  if (!files.length) {
    edgeFirebase?.toast?.error?.('No themes available to export.')
    return
  }

  openThemesExportDialog(files.length)
  state.exportingThemes = true
  try {
    const savedCount = await saveJsonFiles(files, {
      onProgress: syncThemesExportProgress,
      shouldCancel: () => state.exportCancelRequested,
    })
    finishThemesExportDialog(savedCount)
    if (savedCount === files.length)
      edgeFirebase?.toast?.success?.(`Exported ${files.length} theme${files.length === 1 ? '' : 's'}.`)
    else if (savedCount > 0)
      edgeFirebase?.toast?.success?.(`Exported ${savedCount} of ${files.length} themes.`)
  }
  finally {
    state.exportingThemes = false
    if (state.exportDialogStatus === 'running') {
      state.exportDialogStatus = 'canceled'
      state.exportCancelRequested = false
    }
  }
}

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
    throw new Error(INVALID_THEME_IMPORT_MESSAGE)

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

const getThemeDocDefaults = () => getDocDefaultsFromSchema(themeNewDocSchema.value || {})

const validateImportedThemeDoc = (doc) => {
  if (!isPlainObject(doc))
    throw new Error(INVALID_THEME_IMPORT_MESSAGE)

  const requiredKeys = Object.keys(themeNewDocSchema.value || {})
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(INVALID_THEME_IMPORT_MESSAGE)

  return doc
}

const makeUniqueDocId = (baseDocId, docsMap = {}) => {
  const cleanBase = String(baseDocId || '').trim() || 'theme'
  let nextDocId = `${cleanBase}-copy`
  let suffix = 2
  while (docsMap[nextDocId]) {
    nextDocId = `${cleanBase}-copy-${suffix}`
    suffix += 1
  }
  return nextDocId
}

const requestThemeImportDocId = (initialValue = '') => {
  state.importDocIdValue = String(initialValue || '')
  state.importDocIdDialogOpen = true
  return new Promise((resolve) => {
    themeImportDocIdResolver.value = resolve
  })
}

const resolveThemeImportDocId = (value = '') => {
  const resolver = themeImportDocIdResolver.value
  themeImportDocIdResolver.value = null
  state.importDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestThemeImportConflict = (docId) => {
  state.importConflictDocId = String(docId || '')
  state.importConflictDialogOpen = true
  return new Promise((resolve) => {
    themeImportConflictResolver.value = resolve
  })
}

const resolveThemeImportConflict = (action = 'cancel') => {
  const resolver = themeImportConflictResolver.value
  themeImportConflictResolver.value = null
  state.importConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

watch(() => state.importDocIdDialogOpen, (open) => {
  if (!open && themeImportDocIdResolver.value) {
    const resolver = themeImportDocIdResolver.value
    themeImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importConflictDialogOpen, (open) => {
  if (!open && themeImportConflictResolver.value) {
    const resolver = themeImportConflictResolver.value
    themeImportConflictResolver.value = null
    resolver('cancel')
  }
})

const getImportDocId = async (incomingDoc, fallbackDocId = '') => {
  let nextDocId = String(incomingDoc?.docId || '').trim()
  if (!nextDocId)
    nextDocId = await requestThemeImportDocId(fallbackDocId)
  if (!nextDocId)
    throw new Error('Import canceled. A docId is required.')
  if (nextDocId.includes('/'))
    throw new Error('docId cannot include "/".')
  return nextDocId
}

const openImportErrorDialog = (message) => {
  state.importErrorMessage = String(message || 'Failed to import theme JSON.')
  state.importErrorDialogOpen = true
}

const triggerThemeImport = () => {
  themeImportInputRef.value?.click()
}

const importSingleThemeFile = async (file, existingThemes = {}) => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = validateImportedThemeDoc(normalizeImportedDoc(parsed, ''))
  const incomingDocId = await getImportDocId(importedDoc, '')
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingThemes[targetDocId]) {
    const decision = await requestThemeImportConflict(targetDocId)
    if (decision === 'cancel')
      return
    if (decision === 'new') {
      targetDocId = makeUniqueDocId(targetDocId, existingThemes)
      if (typeof importedDoc.name === 'string' && importedDoc.name.trim() && !/\(Copy\)$/i.test(importedDoc.name.trim()))
        importedDoc.name = `${importedDoc.name} (Copy)`
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const payload = { ...getThemeDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(themesCollectionPath.value, payload, targetDocId)
  existingThemes[targetDocId] = payload

  if (importDecision === 'overwrite')
    edgeFirebase?.toast?.success?.(`Overwrote theme "${targetDocId}".`)
  else if (importDecision === 'new')
    edgeFirebase?.toast?.success?.(`Imported theme as new "${targetDocId}".`)
  else
    edgeFirebase?.toast?.success?.(`Imported theme "${targetDocId}".`)
}

const handleThemeImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingJson = true
  const existingThemes = { ...(themesCollection.value || {}) }
  try {
    for (const file of files) {
      try {
        await importSingleThemeFile(file, existingThemes)
      }
      catch (error) {
        console.error('Failed to import theme JSON', error)
        const message = error?.message || 'Failed to import theme JSON.'
        if (/^Import canceled\./i.test(message))
          continue
        if (error instanceof SyntaxError || message === INVALID_THEME_IMPORT_MESSAGE)
          openImportErrorDialog(INVALID_THEME_IMPORT_MESSAGE)
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
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-dashboard
      :filter="state.filter"
      collection="themes"
      class="pt-0 flex-1"
      header-class="py-2 border-b border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <template #header-end>
        <div class="flex items-center gap-2">
          <input
            ref="themeImportInputRef"
            type="file"
            multiple
            accept=".json,application/json"
            class="hidden"
            @change="handleThemeImport"
          >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <edge-shad-button
                type="button"
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Theme Actions"
                aria-label="Theme Actions"
              >
                <MoreHorizontal class="h-4 w-4" />
              </edge-shad-button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem :disabled="state.importingJson" @click="triggerThemeImport">
                <Loader2 v-if="state.importingJson" class="h-4 w-4 animate-spin" />
                <Upload v-else class="h-4 w-4" />
                <span>Import Themes</span>
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="state.exportingThemes || !Object.keys(themesCollection || {}).length" @click="exportAllThemes">
                <Loader2 v-if="state.exportingThemes" class="h-4 w-4 animate-spin" />
                <Download v-else class="h-4 w-4" />
                <span>{{ state.exportingThemes ? 'Exporting...' : 'Export All' }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <edge-shad-button class="uppercase bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300" to="/app/dashboard/themes/new">
            Add Theme
          </edge-shad-button>
        </div>
      </template>
      <template #list="slotProps">
        <template v-for="item in slotProps.filtered" :key="item.docId">
          <edge-shad-button variant="text" class="cursor-pointer w-full flex justify-between items-center py-2 gap-3" :to="`/app/dashboard/themes/${item.docId}`">
            <div>
              <Avatar class="cursor-pointer p-0 h-8 w-8 mr-2 border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                <FilePenLine class="h-4 w-4" />
              </Avatar>
            </div>
            <div class="grow text-left">
              <div class="text-lg">
                {{ item.name }}
              </div>
            </div>
            <div>
              <edge-shad-button
                size="icon"
                class="bg-slate-600 h-7 w-7"
                @click.stop="slotProps.deleteItem(item.docId)"
              >
                <Trash class="h-5 w-5" />
              </edge-shad-button>
            </div>
          </edge-shad-button>
          <Separator class="dark:bg-slate-600" />
        </template>
      </template>
    </edge-dashboard>
    <edge-cms-json-export-progress-dialog
      v-model="state.exportDialogOpen"
      title="Exporting Themes"
      :status="state.exportDialogStatus"
      :processed="state.exportDialogProcessed"
      :total="state.exportDialogTotal"
      :current-item="state.exportDialogCurrentItem"
      @cancel="cancelThemesExport"
      @update:model-value="closeThemesExportDialog"
    />
    <edge-shad-dialog v-model="state.importDocIdDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Enter Theme Doc ID
          </DialogTitle>
          <DialogDescription>
            This JSON file does not include a <code>docId</code>. Enter the doc ID you want to import into.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input
          v-model="state.importDocIdValue"
          name="theme-import-doc-id"
          label="Doc ID"
          placeholder="example-theme-id"
        />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveThemeImportDocId('')">
            Cancel
          </edge-shad-button>
          <edge-shad-button @click="resolveThemeImportDocId(state.importDocIdValue)">
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importConflictDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Theme Already Exists
          </DialogTitle>
          <DialogDescription>
            <code>{{ state.importConflictDocId }}</code> already exists. Choose to overwrite it or import as a new theme.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolveThemeImportConflict('cancel')">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="outline" @click="resolveThemeImportConflict('new')">
            Add As New
          </edge-shad-button>
          <edge-shad-button @click="resolveThemeImportConflict('overwrite')">
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
  </div>
</template>
