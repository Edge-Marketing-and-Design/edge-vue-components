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
    default: 'w-100',
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
  itemKey: {
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
      return { [props.itemKey]: item, [props.itemValue]: item }
    }
    return item
  })
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <FormField v-slot="{ componentField }" :name="name">
    <FormItem>
      <FormLabel>{{ props.label }}</FormLabel>
      <div class="relative w-full items-center">
        <Select v-model="modelValue" :default-value="modelValue" v-bind="componentField">
          <FormControl>
            <SelectTrigger :class="props.class">
              <SelectValue>
                {{ modelValue }}
              </SelectValue>
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="item in computedItems"
                :key="item[props.itemKey]"
                :value="item[props.itemValue]"
              >
                {{ item[props.itemValue] }}
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
