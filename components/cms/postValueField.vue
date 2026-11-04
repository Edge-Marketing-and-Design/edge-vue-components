<script setup>
import { Plus, Trash2 } from 'lucide-vue-next'
const props = defineProps({ modelValue: { default: '' }, field: { type: Object, required: true }, site: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
const inputName = `typed-content-${edgeGlobal.generateShortId()}`
const rows = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])
const children = computed(() => Array.isArray(props.field.schema) ? props.field.schema : Object.entries(props.field.schema || {}).map(([field, value]) => ({ ...value, field })))
const setRow = (index, field, value) => emit('update:modelValue', rows.value.map((row, i) => i === index ? { ...row, [field]: value } : row))
const addRow = () => emit('update:modelValue', [...rows.value, Object.fromEntries(children.value.map(field => [field.field, field.default ?? field.value ?? (field.type === 'boolean' ? false : field.type === 'number' ? 0 : '')]))])
</script>

<template>
  <div v-if="field.type === 'array' && children.length" class="space-y-3">
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium">{{ field.label }}</label><edge-shad-button type="button" variant="outline" size="sm" @click="addRow">
        <Plus class="mr-1 h-3 w-3" />Add item
      </edge-shad-button>
    </div>
    <div v-for="(row, index) in rows" :key="index" class="space-y-3 rounded-md border border-border p-3">
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span>Item {{ index + 1 }}</span><edge-shad-button type="button" variant="ghost" size="icon" aria-label="Remove item" @click="emit('update:modelValue', rows.filter((_, i) => i !== index))">
          <Trash2 class="h-3 w-3" />
        </edge-shad-button>
      </div>
      <edge-cms-post-value-field v-for="child in children" :key="child.field" :model-value="row[child.field]" :field="{ ...child, label: child.label || child.field }" :site="site" @update:model-value="value => setRow(index, child.field, value)" />
    </div>
    <p v-if="!rows.length" class="text-xs text-muted-foreground">
      No items yet.
    </p>
  </div>
  <edge-shad-checkbox v-else-if="field.type === 'boolean'" :model-value="modelValue === true" :name="inputName" item-class="!mt-0" @update:model-value="value => emit('update:modelValue', value === true)">
    {{ field.label }}
  </edge-shad-checkbox>
  <edge-cms-block-input v-else :model-value="modelValue" :type="field.type || 'text'" :field="inputName" :schema="field" :site="site" :label="field.label" :show-richtext-image-toggle="true" :show-richtext-article-tools="true" @update:model-value="value => emit('update:modelValue', field.type === 'number' ? Number(value) : value)" />
</template>
