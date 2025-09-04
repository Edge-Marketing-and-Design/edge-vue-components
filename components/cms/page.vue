<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
})
const emit = defineEmits(['update:modelValue'])
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
    <Separator class="my-4" />
    <edge-cms-block-picker @pick="(block) => blockPick(block, 0)" />
    <draggable
      v-if="modelValue && modelValue.length > 0"
      v-model="modelValue"
      handle=".handle"
      item-key="id"
    >
      <template #item="{ element, index }">
        <div :key="element.id" class="">
          <div class="flex w-full items-center w-full rounded-sm py-1 border-1 border-dotted mb-1">
            <div class="text-left px-2">
              <Grip class="handle pointer" />
            </div>
            <div class="grow  text-white px-2">
              <edge-cms-block
                v-model="modelValue[index]"
                :block-id="element.id" class="my-2"
                @delete="deleteBlock"
              />
            </div>
          </div>
          <div class="w-full">
            <edge-cms-block-picker @pick="(block) => blockPick(block, index + 1)" />
          </div>
        </div>
      </template>
    </draggable>
  </div>
</template>
