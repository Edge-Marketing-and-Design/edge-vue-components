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
  schema: {
    type: Object,
    required: false,
    default: () => ({}),
  },
})

const emit = defineEmits(['update:modelValue', 'delete'])

const modelValue = useVModel(props, 'modelValue', emit)

const state = reactive({
  mounted: false,
})

onBeforeMount(async () => {
  if (props.type === 'option' && !modelValue.value) {
    modelValue.value = props.schema.value
  }
  await nextTick()
  state.mounted = true
})
</script>

<template>
  <div v-if="state.mounted">
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
    <div v-else-if="props.type === 'option'">
      <edge-shad-select v-model="modelValue" :name="field" :label="label" :item-title="props.schema.option.optionsKey" :item-value="props.schema.option.optionsValue" :items="props.schema.option.options" />
    </div>
    <div v-else>
      <edge-shad-input v-model="modelValue" :name="field" :label="label" />
    </div>
  </div>
</template>
