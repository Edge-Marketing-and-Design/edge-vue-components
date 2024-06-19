<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: false,
    default: 'text',
  },
  defaultValue: {
    type: [String, Number],
    required: false,
  },
  modelValue: {
    type: [String, Number],
    required: false,
  },
  class: {
    type: null,
    required: false,
  },
  placeholder: {
    type: String,
    required: false,
  },
  label: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  maskOptions: {
    type: [Object],
    required: false,
    default: null,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  min: {
    type: Number,
    required: false,
  },
  max: {
    type: Number,
    required: false,
  },
  formatOptions: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  step: {
    type: Number,
    required: false,
    default: 1,
  },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  showPassword: false,
  type: '',
})

onBeforeMount(() => {
  state.type = props.type
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <div>
    <FormField :name="props.name">
      <FormItem>
        <FormLabel class="flex">
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <NumberField
          v-model="modelValue"
          :default-value="modelValue"
          :class="props.class"
          :min="props.min"
          :max="props.max"
          :format-options="props.formatOptions"
          :step="props.step"
        >
          <NumberFieldContent>
            <NumberFieldDecrement />
            <FormControl>
              <NumberFieldInput />
            </FormControl>
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
        <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
          <slot name="icon" />
        </span>
        <FormDescription>
          {{ props.description }}
          <slot name="description" />
        </FormDescription>
        <FormMessage />
      </FormItem>
    </FormField>
  </div>
</template>

<style lang="scss" scoped>

</style>
