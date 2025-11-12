<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { Plus, Trash2 } from 'lucide-vue-next'
import Popover from '~/components/ui/popover/Popover.vue'
import PopoverTrigger from '~/components/ui/popover/PopoverTrigger.vue'
import PopoverContent from '~/components/ui/popover/PopoverContent.vue'
const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])
const edgeFirebase = inject('edgeFirebase')
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
      "danger": "#EF4444"
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
    },
  },
  mounted: false,
  loading: false,
  defaultPageToAdd: '',
  showTemplatePicker: false,
})

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

onMounted(() => {
  // state.mounted = true
})

const editorDocUpdates = (workingDoc) => {
  state.workingDoc = workingDoc
  ensureDefaultPagesArray(state.workingDoc)
}

const headObject = computed(() => {
  try {
    return JSON.parse(state.workingDoc.headJSON || '{}')
  }
  catch (e) {
    return {}
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const sites = computed(() => {
  return Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {})
})

const templatePages = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`] || {}
})

const ensureDefaultPagesArray = (doc = state.workingDoc) => {
  if (!doc)
    return []
  if (!Array.isArray(doc.defaultPages))
    doc.defaultPages = []
  return doc.defaultPages
}

const currentDefaultPageIds = computed(() => {
  return new Set(ensureDefaultPagesArray().map(page => page.pageId))
})

const templatePageOptions = computed(() => {
  const selected = currentDefaultPageIds.value
  return Object.entries(templatePages.value)
    .map(([value, doc]) => ({
      value,
      label: doc?.name || 'Untitled Page',
    }))
    .filter(option => !selected.has(option.value))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const templatePageName = (pageId, fallback) => {
  return templatePages.value?.[pageId]?.name || fallback || 'Untitled Page'
}

const addDefaultPage = (pageIdParam) => {
  const pageId = pageIdParam || state.defaultPageToAdd
  if (!pageId)
    return
  const selected = ensureDefaultPagesArray()
  if (selected.some(page => page.pageId === pageId)) {
    state.defaultPageToAdd = ''
    state.showTemplatePicker = false
    return
  }
  selected.push({
    pageId,
    name: templatePageName(pageId),
  })
  state.defaultPageToAdd = ''
  state.showTemplatePicker = false
}

const removeDefaultPage = (index) => {
  const selected = ensureDefaultPagesArray()
  if (index < 0 || index >= selected.length)
    return
  selected.splice(index, 1)
}

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

watch(templatePageOptions, (options) => {
  if (!options.some(option => option.value === state.defaultPageToAdd))
    state.defaultPageToAdd = ''
  if (!options.length)
    state.showTemplatePicker = false
})

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
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle class="text-base">
                      Default Template Pages
                    </CardTitle>
                    <CardDescription class="text-xs">
                      Pages that will be automatically added when creating a new site using this theme.
                    </CardDescription>
                  </div>
                  <Popover v-model:open="state.showTemplatePicker">
                    <PopoverTrigger as-child>
                      <edge-shad-button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        :disabled="!templatePageOptions.length"
                      >
                        <Plus class="w-4 h-4" />
                      </edge-shad-button>
                    </PopoverTrigger>
                    <PopoverContent class="w-64 p-0" align="end" side-offset="8">
                      <div v-if="templatePageOptions.length" class="divide-y">
                        <button
                          v-for="option in templatePageOptions"
                          :key="option.value"
                          type="button"
                          class="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/80 transition text-left"
                          @click="addDefaultPage(option.value)"
                        >
                          <span class="truncate pr-2">{{ option.label }}</span>
                          <Plus class="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                      <div v-else class="px-3 py-2 text-xs text-muted-foreground">
                        No templates available.
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </CardHeader>
              <CardContent class="space-y-3">
                <div v-if="ensureDefaultPagesArray(slotProps.workingDoc).length" class="space-y-2">
                  <draggable
                    v-model="slotProps.workingDoc.defaultPages"
                    handle=".handle"
                    item-key="pageId"
                  >
                    <template #item="{ element, index }">
                      <div class="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 mb-1 text-sm">
                        <Grip class="handle cursor-grab text-muted-foreground w-4 h-4" />
                        <div class="flex flex-col flex-1 min-w-0 leading-tight">
                          <span class="font-medium truncate">{{ templatePageName(element.pageId, element.name) }}</span>
                          <!-- <span class="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{{ element.pageId }}</span> -->
                        </div>
                        <edge-shad-button
                          variant="ghost"
                          size="icon"
                          class="text-destructive h-6 w-6"
                          @click="removeDefaultPage(index)"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </edge-shad-button>
                      </div>
                    </template>
                  </draggable>
                  <p class="text-[11px] text-muted-foreground">
                    Drag to reorder; first items insert highest.
                  </p>
                </div>
                <div v-else class="text-xs text-muted-foreground">
                  No default pages yet. Use the + button to add one.
                </div>
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
                    :theme="JSON.parse(slotProps.workingDoc.theme)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
  </div>
</template>
