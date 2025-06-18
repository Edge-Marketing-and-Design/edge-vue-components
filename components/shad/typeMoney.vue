<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  name: { type: String, required: true },
  type: { type: String, default: 'text' },
  defaultValue: { type: [String, Number], required: false },
  class: { type: null, required: false },
  placeholder: { type: String, required: false },
  label: { type: String, required: false },
  description: { type: String, required: false },
  maskOptions: { type: [Object], default: null },
  disabled: { type: Boolean, default: false },
  modelValue: { type: [String, Number], default: '' },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  showPassword: false,
  type: '',
  editMode: false,
  isDebit: false, // false = credit, true = debit
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
  emits('update:modelValue', state.isDebit ? -Math.abs(newVal) : Math.abs(newVal))
})

const toggleDebit = () => {
  state.isDebit = !state.isDebit
  if (modelValue.value !== '') {
    modelValue.value = state.isDebit
      ? -Math.abs(modelValue.value)
      : Math.abs(modelValue.value)
  }
}

const classComputed = computed(() => {
  return props.type === 'password' ? `${props.class} pr-10` : props.class
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

  if (
    allowedKeys.includes(key)
    || (key >= '0' && key <= '9')
    || (key === '.' && !value.includes('.'))
  ) {
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
    return
  }

  // Disallow minus and any other invalid input
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
    }).format(val).slice(0, sub ? -sub : undefined)
  },
}

const formatDecimal = (event) => {
  const el = event.target
  const cleaned = el.value.replace(/[$,]/g, '')
  const num = parseFloat(cleaned)

  if (!isNaN(num)) {
    const fixed = num.toFixed(2)
    modelValue.value = state.isDebit
      ? -Math.abs(parseFloat(fixed))
      : Math.abs(parseFloat(fixed))

    // Force input's displayed value to update
    el.value = fixed
    el.dispatchEvent(new Event('input'))
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

        <div class="flex items-center mb-2">
          <button
            type="button"
            class="border px-2 py-2 rounded text-sm w-[100px] bg-primary text-primary-foreground"
            @click="toggleDebit"
          >
            {{ state.isDebit ? 'Debit (−)' : 'Credit (+)' }}
          </button>
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
        </div>

        <FormDescription>
          {{ props.description }}
          <slot name="description" />
        </FormDescription>
        <FormMessage />
      </FormItem>
    </FormField>
  </div>
</template>
