<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { FolderCog } from 'lucide-vue-next'
import * as z from 'zod'
const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
const { createDefaults: createSiteSettingsDefaults } = useSiteSettingsTemplate()
const state = reactive({
  filter: '',
  workingDoc: {},
  newDocs: {
    themes: {
      name: { value: '' },
      headJSON: {
        value: `{
  "link": [
    {
      "rel": "preconnect",
      "href": "https://fonts.googleapis.com"
    },
    {
      "rel": "preconnect",
      "href": "https://fonts.gstatic.com",
      "crossorigin": ""
    },
    {
      "rel": "stylesheet",
      "href": "https://fonts.googleapis.com/css2?family=Overpass:wght@400;700&family=Kode+Mono:wght@400;700&display=swap"
    }
  ]
}`,
      },
      theme: {
        value: `{
  "extend": {
    "colors": {
      "brand": "#3B82F6",
      "accent": "#F59E0B",
      "surface": "#FAFAFA",
      "subtle": "#F3F4F6",
      "text": "#1F2937",
      "muted": "#9CA3AF",
      "success": "#22C55E",
      "danger": "#EF4444",
      "border": "#E5E7EB",
      "ring": "#93C5FD",
      "link": "#3B82F6",
      "linkHover": "#1D4ED8",
      "navBg": "#000000",
      "navText": "#FFFFFF",
      "navMuted": "#6B7280",
      "navBorder": "",
      "navActive": "#3B82F6",
      "navHoverBg": "",
      "navActiveBg": "",
      "sideNavBg": "#FFFFFF",
      "sideNavText": "#000000",
      "sideNavActive": "#AFBD23"
    },
    "fontFamily": {
      "sans": ["Overpass", "sans-serif"],
      "serif": ["Kode Mono", "monospace"],
      "mono": ["Overpass", "sans-serif"],
      "brand": ["Kode Mono", "monospace"]
    }
  },
  "apply": {},
  "slots": {},
  "variants": {
    "light": {
      "apply": {}
    },
    "dark": {
      "apply": {},
      "slots": {}
    }
  }
}`,
      },
      version: 1,
      defaultPages: { value: [] },
      defaultMenus: {
        value: {
          'Site Root': [],
          'Not In Menu': [],
        },
      },
      defaultSiteSettings: { value: createSiteSettingsDefaults() },
    },
  },
  mounted: false,
  loading: false,
  defaultSettingsOpen: false,
})

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
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {})
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
  if (sameLength && sameOrder)
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

watch (sites, async (newSites) => {
  state.loading = true
  if (!edgeGlobal.edgeState.blockEditorSite && newSites.length > 0) {
    edgeGlobal.edgeState.blockEditorSite = newSites[0].docId
  }
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
          <div class="w-full">
            <edge-shad-select
              v-if="!state.loading"
              v-model="edgeGlobal.edgeState.blockEditorSite"
              label="Preview Site"
              name="site"
              :items="sites.map(s => ({ title: s.name, name: s.docId }))"
              placeholder="Select Site"
              class="w-full"
            />
          </div>
        </div>
      </template>
      <template #main="slotProps">
        <div class="pt-4 flex flex-col gap-6 lg:flex-row">
          <div class="lg:w-1/3 lg:max-w-sm w-full space-y-4">
            <Card class="h-full">
              <CardHeader class="pb-2">
                <div class="flex items-center justify-between gap-2">
                  <CardTitle class="text-base">
                    Default Template Pages
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
          </div>
          <div class="flex-1 space-y-4">
            <edge-shad-input
              v-model="slotProps.workingDoc.name"
              label="Theme Name"
              name="name"
            />
            <div class="flex flex-col gap-4 xl:flex-row">
              <div class="w-1/2">
                <edge-cms-code-editor
                  v-model="slotProps.workingDoc.theme"
                  title="Theme JSON"
                  language="json"
                  name="content"
                  height="400px"
                  class="mb-4 w-full"
                />
                <edge-cms-font-upload
                  v-if="slotProps.workingDoc"
                  v-model:head-json="slotProps.workingDoc.headJSON"
                  :theme-id="props.themeId"
                  class="mb-4"
                />
                <edge-cms-code-editor
                  v-model="slotProps.workingDoc.headJSON"
                  title="Head JSON"
                  language="json"
                  name="headJSON"
                  height="400px"
                  class="mb-4 w-full"
                />
              </div>
              <div class="w-1/2">
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
