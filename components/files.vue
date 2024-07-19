<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  title: {
    type: String,
    default: 'Upload Files',
  },
  description: {
    type: String,
    default: 'Drag and drop files here or click to upload.',
  },
  modelValue: {
    type: Array,
    default: () => [],
  },
  accept: {
    type: String,
    default: '',
  },
  name: {
    type: String,
    default: '',
  },
  multiple: {
    type: Boolean,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})
</script>

<template>
  <Card color="secondary" class="px-0 py-2 my-2 drop-active text-center sticky z-10 top-0 cursor-pointer">
    <file-upload
      v-model="modelValue"
      :accept="props.accept"
      :name="props.name"
      :multiple="props.multiple"
      drop
      class="w-full"
    >
      <Card-title class="pt-6">
        {{ props.title }}
      </Card-title>
      <CardContent style="width:100%;" class="pb-3">
        <p>{{ props.description }}</p>
      </CardContent>
    </file-upload>
    <div v-if="modelValue.length > 0" class="mt-0">
      <div v-if="props.multiple" class="mb-2">
        {{ modelValue.length }} file(s) selected for upload.
      </div>
      <div v-else class="mt-0">
        {{ modelValue[0].name }} selected for upload.
      </div>
    </div>
  </Card>
</template>
