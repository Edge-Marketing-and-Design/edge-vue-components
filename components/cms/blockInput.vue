<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  field: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  modelValue: {
    type: [Object, String, Array, Number, Boolean],
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue', 'delete'])

const modelValue = useVModel(props, 'modelValue', emit)

const state = reactive({
  arrayItems: [],
})
</script>

<template>
  <div>
    <div v-if="props.type === 'richtext'">
      <edge-shad-html v-model="modelValue" :enabled-toggles="['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline']" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'textarea'">
      <edge-shad-textarea v-model="modelValue" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'array'">
      <edge-shad-tags v-model="modelValue" :label="label" :name="field" />
    </div>
    <div v-else-if="props.type === 'number'">
      <edge-shad-number v-model="modelValue" :name="field" :label="label" />
    </div>
    <div v-else>
      <edge-shad-input v-model="modelValue" :name="field" :label="label" />
    </div>
  </div>
</template>
