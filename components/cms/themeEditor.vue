<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  themeId: {
    type: String,
    required: true,
  },
})
const emit = defineEmits(['head'])
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
    },
  },
  mounted: false,
})

const blockSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

onMounted(() => {
  state.mounted = true
})

const editorDocUpdates = (workingDoc) => {
  state.workingDoc = workingDoc
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
      <template #main="slotProps">
        <div class="pt-4">
          <edge-shad-input
            v-model="slotProps.workingDoc.name"
            label="Block Name"
            name="name"
          />
          <div class="flex gap-4">
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
                  class="!h-[calc(100vh-220px)] overflow-y-auto"
                  list-only
                  :theme="JSON.parse(slotProps.workingDoc.theme)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
  </div>
</template>
