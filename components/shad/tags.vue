<script setup>
import { useVModel } from '@vueuse/core'
import { useField } from 'vee-validate'

const props = defineProps({
  name: { type: String, required: true },
  // Accept either String (CSV) or Array depending on valueAs
  modelValue: { type: [String, Array], default: '' },
  class: { type: null, default: '' },
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  // NEW: controls how the component reads/emits the value
  valueAs: { type: String, default: 'string', validator: v => ['string', 'array'].includes(v) },
})

const emit = defineEmits(['update:modelValue', 'blur'])

// raw v-model that mirrors props.modelValue directly
const rawModel = useVModel(props, 'modelValue', emit, {
  passive: false,
  prop: 'modelValue',
})

const normalize = arr =>
  Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean)))

const parseCsv = str => normalize(String(str || '').split(','))

const { setValue, setTouched } = useField(props.name)

// Public array model used by the Tags UI regardless of underlying type
const arrayModel = computed({
  get: () => {
    if (props.valueAs === 'array') {
      return normalize(Array.isArray(rawModel.value) ? rawModel.value : [])
    }
    // 'string' mode -> parse CSV
    return parseCsv(rawModel.value)
  },
  set: (arr) => {
    const cleaned = normalize(arr)
    if (props.valueAs === 'array') {
      rawModel.value = cleaned
      setValue(cleaned)
      emit('update:modelValue', cleaned)
    }
    else {
      const csv = cleaned.join(',')
      rawModel.value = csv
      setValue(csv)
      emit('update:modelValue', csv)
    }
    setTouched(true)
  },
})

// Keep vee-validate synced with external changes (resets, programmatic updates)
watch(
  () => rawModel.value,
  (v) => {
    if (props.valueAs === 'array') {
      setValue(Array.isArray(v) ? v : [])
    }
    else {
      setValue(String(v ?? ''))
    }
  },
  { immediate: true },
)

function commitPendingFromInput(el) {
  if (!el)
    return
  const raw = (el.value || '').trim()
  if (!raw)
    return
  arrayModel.value = [...arrayModel.value, raw]
  el.value = ''
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function onInputBlur(e) {
  commitPendingFromInput(e?.target)
  setTouched(true)
  emit('blur', e)
}
</script>

<template>
  <FormField :name="props.name">
    <FormItem class="flex flex-col gap-2 p-3 mt-3">
      <div class="flex items-center justify-between">
        <FormLabel v-if="props.label">
          {{ props.label }}
          {{ props.valueAs }}
        </FormLabel>
        <slot name="icon" />
      </div>

      <FormControl>
        <TagsInput
          :id="props.name"
          v-model="arrayModel"
          :class="props.class"
          :disabled="props.disabled"
        >
          <TagsInputItem
            v-for="item in arrayModel"
            :key="item"
            :value="item"
            class="bg-primary"
          >
            <TagsInputItemText />
            <TagsInputItemDelete />
          </TagsInputItem>

          <!-- Let Enter be handled by the component; commit on blur -->
          <TagsInputInput
            :placeholder="props.placeholder || 'Add…'"
            @blur="onInputBlur"
          />
        </TagsInput>
      </FormControl>

      <FormDescription v-if="props.description">
        {{ props.description }}
      </FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
