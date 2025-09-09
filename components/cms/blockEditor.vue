<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  blockId: {
    type: String,
    required: true,
  },
})

const route = useRoute()

const state = reactive({
  filter: '',
  newDocs: {
    blocks: {
      name: { value: '' },
      content: { value: '' },
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

const docId = computed(() => {
  if (route.params.block) {
    return route.params.block
  }
  return ''
})

definePageMeta({
  middleware: 'auth',
})

onMounted(() => {
  state.mounted = true
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
            <edge-cms-code-editor
              v-model="slotProps.workingDoc.content"
              title="Block Content"
              language="html"
              name="content"
              height="calc(100vh - 300px)"
              class="mb-4 w-1/2"
            />
            <div class="w-1/2">
              <div class="w-full mx-auto bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
                <edge-cms-block-picker
                  :block-content-override="slotProps.workingDoc.content"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
  </div>
</template>
