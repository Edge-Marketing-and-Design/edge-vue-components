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

// Initialize useVModel
const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const classComputed = computed(() => {
  if (props.type === 'password') {
    return `${props.class} pr-10`
  }
  return props.class
})

const handleKeydown = (event) => {
  const allowedKeys = [
    'Backspace',
    'ArrowLeft',
    'ArrowRight',
    'Delete',
    'Tab',
  ]
  const key = event.key
  const value = event.target.value
  const selectionStart = event.target.selectionStart

  // Allow valid keys
  if (
    allowedKeys.includes(key) // Allow navigation/control keys
    || (key >= '0' && key <= '9') // Allow numbers
    || (key === '.' && !value.includes('.')) // Allow one decimal point
    || (key === '-' && selectionStart === 0) // Allow minus sign only at the start
  ) {
    // Check for two decimal places
    if (value.includes('.') && key >= '0' && key <= '9') {
      const decimalPart = value.split('.')[1]
      if (
        decimalPart.length >= 2
        && selectionStart > value.indexOf('.')
      ) {
        event.preventDefault()
        return
      }
    }
    return // Valid key, do nothing
  }

  // Prevent any other key
  event.preventDefault()
}
</script>

<template>
  <div>
    <FormField v-slot="{ componentField }" :name="props.name">
      <FormItem>
        <FormLabel class="flex">
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <FormControl>
          <div class="relative w-full items-center">
            <Input
              :id="props.name"
              v-model="modelValue"
              v-maska:[props.maskOptions]
              :default-value="props.modelValue"
              :class="classComputed"
              :type="state.type"
              v-bind="componentField"
              :placeholder="props.placeholder"
              :disabled="props.disabled"
              @keydown="handleKeydown"
            />
            <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
              <slot name="icon">
                <DollarSign class="size-6 text-muted-foreground cursor-pointer" />
              </slot>
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
