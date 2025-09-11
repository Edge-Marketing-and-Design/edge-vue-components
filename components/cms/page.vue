<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: true,
  },
})

const state = reactive({
  newDocs: {
    pages: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Name' }, cols: '12', value: '' },
      content: { value: [] },
    },
  },
  editMode: false,
  workingDoc: {},
})

const schemas = {
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const deleteBlock = (blockId, slotProps) => {
  console.log('Deleting block with ID:', blockId)
  const index = slotProps.workingDoc.content.findIndex(block => block.id === blockId)
  if (index !== -1) {
    slotProps.workingDoc.content.splice(index, 1)
  }
}

const blockPick = (block, index, slotProps) => {
  console.log('Block picked:', block, 'at index:', index)
  console.log(slotProps)
  const generatedId = edgeGlobal.generateShortId()
  block.id = generatedId
  if (index === 0 || index) {
    slotProps.workingDoc.content.splice(index, 0, block)
  }
  console.log('Updated content:', slotProps.workingDoc.content)
}

onMounted(() => {
  if (props.page === 'new') {
    state.editMode = true
  }
})

const editorDocUpdates = (workingDoc) => {
  const blockIds = workingDoc.content.map(block => block.blockId).filter(id => id)
  const uniqueBlockIds = [...new Set(blockIds)]
  state.workingDoc.blockIds = uniqueBlockIds
}
</script>

<template>
  <edge-editor
    :collection="`sites/${site}/pages`"
    :doc-id="page"
    :schema="schemas.pages"
    :new-doc-schema="state.newDocs.pages"
    class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0"
    :show-footer="false"
    :save-redirect-override="`/app/dashboard/sites/${site}`"
    :no-close-after-save="true"
    :working-doc-overrides="state.workingDoc"
    @working-doc="editorDocUpdates"
  >
    <template #header="slotProps">
      <div class="relative flex items-center bg-secondary p-2 justify-between sticky top-0 z-10 bg-primary rounded">
        <span v-if="!state.editMode" class="text-lg font-semibold whitespace-nowrap pr-1">{{ slotProps.workingDoc?.name }}</span>
        <edge-shad-input
          v-else
          v-model="slotProps.workingDoc.name"
          name="name"
          placeholder="Enter page name"
          class="w-full my-0"
        />
        <div class="flex w-full items-center">
          <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />
          <edge-shad-button variant="text" class="hover:text-primary/50 text-xs h-[26px] text-primary" @click="state.editMode = !state.editMode">
            <template v-if="state.editMode">
              <Eye class="w-4 h-4" />
              Preview Mode
            </template>
            <template v-else>
              <Pencil class="w-4 h-4" />
              Edit Mode
            </template>
          </edge-shad-button>
          <edge-shad-button
            v-if="!slotProps.unsavedChanges"
            variant="text"
            class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            variant="text"
            class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Cancel
          </edge-shad-button>
          <edge-shad-button
            v-if="state.editMode || slotProps.unsavedChanges"
            variant="text"
            type="submit"
            class="bg-secondary hover:text-primary/50 text-xs h-[26px] text-primary"
            :disabled="slotProps.submitting"
          >
            <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
            <Save v-else class="w-4 h-4" />
            <span>Save</span>
          </edge-shad-button>
        </div>
      </div>
    </template>
    <template #main="slotProps">
      <Separator class="my-4" />
      <edge-button-divider v-if="state.editMode" class="my-2">
        <edge-cms-block-picker @pick="(block) => blockPick(block, 0, slotProps)" />
      </edge-button-divider>
      <div class="w-full mx-auto  bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
        <draggable
          v-if="slotProps.workingDoc?.content && slotProps.workingDoc.content.length > 0"
          v-model="slotProps.workingDoc.content"
          handle=".handle"
          item-key="id"
        >
          <template #item="{ element, index }">
            <div :key="element.id" class="">
              <div :class="{ 'border-1 border-dotted py-1 mb-1': state.editMode }" class="flex w-full items-center w-full">
                <div v-if="state.editMode" class="text-left px-2">
                  <Grip class="handle pointer" />
                </div>
                <div :class="state.editMode ? 'px-2 py-2 w-[98%]' : 'w-[100%]'">
                  <edge-cms-block
                    v-model="slotProps.workingDoc.content[index]"
                    :edit-mode="state.editMode"
                    :block-id="element.id" class=""
                    @delete="(block) => deleteBlock(block, slotProps)"
                  />
                </div>
              </div>
              <div v-if="state.editMode" class="w-full">
                <edge-button-divider class="my-2">
                  <edge-cms-block-picker @pick="(block) => blockPick(block, index + 1, slotProps)" />
                </edge-button-divider>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </template>
  </edge-editor>
</template>
