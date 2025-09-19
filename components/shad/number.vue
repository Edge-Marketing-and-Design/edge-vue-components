<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  name: { type: String, required: true },
  type: { type: String, default: 'text' },
  defaultValue: { type: [String, Number], required: false },
  modelValue: { type: [String, Number], required: false },
  class: { type: null, required: false },
  placeholder: { type: String, required: false },
  label: { type: String, required: false },
  description: { type: String, required: false },
  maskOptions: { type: Object, required: false, default: null },
  disabled: { type: Boolean, default: false },
  min: { type: Number, required: false },
  max: { type: Number, required: false },
  formatOptions: { type: Object, required: false, default: () => ({}) },
  step: { type: Number, default: 1 },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  showPassword: false,
  type: '',
})

onBeforeMount(() => {
  state.type = props.type
})

// Base v-model (can be string or number)
const rawModel = useVModel(props, 'modelValue', emits, {
  passive: false,
  defaultValue: props.defaultValue,
})

// Coercion helper: returns number | null
function toNumberOrNull(v) {
  if (v === '' || v === undefined || v === null)
    return null
  if (typeof v === 'number')
    return Number.isNaN(v) ? null : v
  // Strip common formatting (e.g., "1,234.56")
  const cleaned = String(v).replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isNaN(n) ? null : n
}

// Internal numeric ref exposed to NumberField
const numericValue = computed({
  get() {
    // Prefer current raw value; fall back to default
    const base = rawModel.value ?? props.defaultValue ?? null
    return toNumberOrNull(base)
  },
  set(val) {
    // NumberField may pass string or number; normalize to number | null
    const n = toNumberOrNull(val)
    emits('update:modelValue', n)
  },
})
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

        <NumberField
          v-model="numericValue"
          :default-value="numericValue ?? undefined"
          :class="props.class"
          :min="props.min"
          :max="props.max"
          :format-options="props.formatOptions"
          :step="props.step"
          :disabled="props.disabled"
        >
          <NumberFieldContent>
            <NumberFieldDecrement class="mt-5" />
            <FormControl>
              <NumberFieldInput />
            </FormControl>
            <NumberFieldIncrement class="mt-5" />
          </NumberFieldContent>
        </NumberField>

        <!-- keep validation/form integration without polluting NumberField props -->
        <input type="hidden" v-bind="componentField" :value="numericValue ?? ''">

        <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
          <slot name="icon" />
        </span>

        <FormDescription>
          {{ props.description }} <slot name="description" />
        </FormDescription>
        <FormMessage />
      </FormItem>
    </FormField>
  </div>
</template>
