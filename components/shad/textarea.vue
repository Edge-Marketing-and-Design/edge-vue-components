<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  name: {
    type: String,
    required: true,
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

const classComputed = computed(() => {
  return props.class
})
</script>

<template>
  <div>
    <FormField v-slot="{ componentField }" :name="props.name">
      <FormItem>
        <FormLabel>
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <FormControl>
          <div class="relative w-full  items-center">
            <Textarea
              v-model="modelValue"
              :class="classComputed"
              :placeholder="props.placeholder"
              :disabled="props.disabled"
              :default-value="modelValue"
              v-bind="componentField"
            />
            <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
              <slot name="icon" />
            </span>
          </div>
        </FormControl>
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
