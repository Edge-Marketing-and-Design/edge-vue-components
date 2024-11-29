<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: String,
    required: false,
  },
  class: {
    type: null,
    required: false,
    default: 'w-full',
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
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  items: {
    type: Array,
    required: false,
    default: () => [],
  },
  itemTitle: {
    type: String,
    required: false,
    default: 'title',
  },
  itemValue: {
    type: String,
    required: false,
    default: 'name',
  },
})

const emits = defineEmits(['update:modelValue'])

const computedItems = computed(() => {
  return props.items.map((item) => {
    if (typeof item === 'string') {
      return { [props.itemTitle]: item, [props.itemValue]: item }
    }
    else {
      const titleParts = props.itemTitle.split('.')
      let value = { ...item }
      titleParts.forEach((part) => {
        if (value && typeof value === 'object' && part in value) {
          value = value[part]
        }
        else {
          value = null
        }
      })
      return { [props.itemTitle]: value, [props.itemValue]: item[props.itemValue] }
    }
  })
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})
</script>

<template>
  <FormField v-slot="{ componentField }" :name="props.name">
    <FormItem>
      <FormLabel class="flex">
        {{ props.label }}
      </FormLabel>
      <div class="relative w-full items-center">
        <Select v-model="modelValue" :disabled="props.disabled" :default-value="modelValue" v-bind="componentField">
          <FormControl>
            <SelectTrigger :class="[$slots.icon ? 'pr-8' : '', props.class]">
              <SelectValue />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="item in computedItems"
                :key="item[props.itemTitle]"
                :value="item[props.itemValue]"
              >
                {{ item[props.itemTitle] }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <span class="absolute end-0 inset-y-0 flex items-center justify-center pl-2 pr-2">
          <slot name="icon" />
        </span>
      </div>
      <FormDescription>
        {{ props.description }}
      </FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>

<style lang="scss" scoped>
</style>
