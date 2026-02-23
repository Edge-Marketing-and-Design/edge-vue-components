<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { Download, FolderCog } from 'lucide-vue-next'
import * as z from 'zod'
const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
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

const headObject = computed(() => lastValidHead.value)

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

const collectTemplateIdsFromMenus = (menus = {}) => {
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
    .map(([value, doc]) => ({
      value,
      label: doc?.name || 'Untitled Page',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const themesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/themes`)
const themesCollection = computed(() => edgeFirebase.data?.[themesCollectionPath.value] || {})

const downloadJsonFile = (payload, filename) => {
  if (typeof window === 'undefined')
    return
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
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

const notifySuccess = (message) => {
  edgeFirebase?.toast?.success?.(message)
}

const notifyError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

const exportCurrentTheme = () => {
  const doc = themesCollection.value?.[props.themeId]
  if (!doc || !doc.docId) {
    notifyError('Save this theme before exporting.')
    return
  }
  const exportPayload = { ...getThemeDocDefaults(), ...doc }
  downloadJsonFile(exportPayload, `theme-${doc.docId}.json`)
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
      collection="themes"
      :doc-id="props.themeId"
      :schema="blockSchema"
      :new-doc-schema="state.newDocs.themes"
      header-class="py-2 bg-secondary text-foreground rounded-none sticky top-0 border"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
      card-content-class="px-0"
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
                <TabsList class="w-full mt-3 bg-secondary rounded-sm grid grid-cols-2 xl:grid-cols-5">
                  <TabsTrigger value="theme-json" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
                    Theme JSON
                  </TabsTrigger>
                  <TabsTrigger value="head-json" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
                    Head JSON
                  </TabsTrigger>
                  <TabsTrigger value="custom-fonts" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
                    Custom Fonts
                  </TabsTrigger>
                  <TabsTrigger value="extra-css" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
                    Extra CSS
                  </TabsTrigger>
                  <TabsTrigger value="default-templates" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
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
                  class="!h-[calc(100vh-220px)] overflow-y-auto"
                  list-only
                  :theme="lastValidTheme"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
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
