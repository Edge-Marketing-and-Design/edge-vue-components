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
  modelValue: {
    type: [String, Number],
    required: false,
    default: '',
  },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  showPassword: false,
  type: '',
  editMode: false,
})

onBeforeMount(() => {
  state.type = props.type
})

// Initialize useVModel
const modelValue = useVModel(props, 'modelValue', emits, {
  prop: 'modelValue',
})

watch(modelValue, (val) => {
  const stringValue = String(val || '')
  const newVal = parseFloat(stringValue.replace(/[$,]/g, ''))
  if (isNaN(newVal)) {
    modelValue.value = 0
    return
  }
  emits('update:modelValue', newVal)
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

const moneyMask = {
  preProcess: val => val.replace(/[$,]/g, ''),
  postProcess: (val) => {
    if (!val)
      return ''
    const sub = 3 - (val.includes('.') ? val.length - val.indexOf('.') : 0)
    return Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    })
      .format(val)
      .slice(0, sub ? -sub : undefined)
  },
}
const formatDecimal = (event) => {
  const el = event.target
  const cleaned = el.value.replace(/[$,]/g, '')
  const num = parseFloat(cleaned)

  if (!isNaN(num)) {
    const fixed = num.toFixed(2)
    modelValue.value = parseFloat(fixed)

    // Force input's displayed value to update
    el.value = fixed
    el.dispatchEvent(new Event('input')) // triggers v-model update
  }
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
          <Input
            :id="props.name"
            v-model="modelValue"
            v-maska:[moneyMask]
            :default-value="props.modelValue"
            :class="classComputed"
            :type="state.type"
            v-bind="componentField"
            :placeholder="props.placeholder"
            :disabled="props.disabled"
            @keydown="handleKeydown"
            @blur="formatDecimal"
          />
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
