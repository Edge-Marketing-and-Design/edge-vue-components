<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue'])

const state = reactive({
  editMode: false,
})

const modelValue = useVModel(props, 'modelValue', emit)

const deleteBlock = (blockId) => {
  console.log('Deleting block with ID:', blockId)
  const index = modelValue.value.findIndex(block => block.id === blockId)
  if (index !== -1) {
    modelValue.value.splice(index, 1)
  }
}

const blockPick = (block, index) => {
  const generatedId = edgeGlobal.generateShortId()
  block.id = generatedId
  modelValue.value ??= []
  if (index === 0 || index) {
    modelValue.value.splice(index, 0, block)
  }
}
</script>

<template>
  <div>
    <edge-shad-button class="bg-secondary hover:text-secondary text-primary" @click="state.editMode = !state.editMode">
      <template v-if="state.editMode">
        <Eye class="w-4 h-4" />
        Switch to Preview Mode
      </template>
      <template v-else>
        <Pencil class="w-4 h-4" />
        Switch to Edit Mode
      </template>
    </edge-shad-button>
    <Separator class="my-4" />
    <edge-button-divider v-if="state.editMode" class="my-2">
      <edge-cms-block-picker @pick="(block) => blockPick(block, 0)" />
    </edge-button-divider>
    <draggable
      v-if="modelValue && modelValue.length > 0"
      v-model="modelValue"
      handle=".handle"
      item-key="id"
    >
      <template #item="{ element, index }">
        <div :key="element.id" class="">
          <div :class="{ 'border-1 border-dotted py-1 mb-1': state.editMode }" class="flex w-full items-center w-full rounded-sm ">
            <div v-if="state.editMode" class="text-left px-2">
              <Grip class="handle pointer" />
            </div>
            <div :class="{ 'px-2 py-2': state.editMode }" class="grow">
              <edge-cms-block
                v-model="modelValue[index]"
                :edit-mode="state.editMode"
                :block-id="element.id" class=""
                @delete="deleteBlock"
              />
            </div>
          </div>
          <div v-if="state.editMode" class="w-full">
            <edge-button-divider class="my-2">
              <edge-cms-block-picker @pick="(block) => blockPick(block, index + 1)" />
            </edge-button-divider>
          </div>
        </div>
      </template>
    </draggable>
  </div>
</template>
