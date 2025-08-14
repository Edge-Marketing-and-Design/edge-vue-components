<script setup>
import { useFilter } from 'reka-ui'
import { useVModel } from '@vueuse/core'
import { cn } from '~/lib/utils'
const props = defineProps({
  name: {
    type: String,
    required: false,
  },
  modelValue: {
    type: Array,
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
    const getNestedValue = (obj, path) => path.split('.').reduce((acc, key) => acc && acc[key], obj)
    return {
      [props.itemTitle]: getNestedValue(item, props.itemTitle),
      [props.itemValue]: getNestedValue(item, props.itemValue),
    }
  })
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})
const open = ref(false)
const searchTerm = ref('')

const { contains } = useFilter({ sensitivity: 'base' })

const filteredItems = computed(() => {
  const options = computedItems.value.filter(i => !modelValue.value.includes(i[props.itemValue]))
  return searchTerm.value ? options.filter(option => contains(option[props.itemTitle], searchTerm.value)) : options
})

const valueToTitle = computed(() => {
  const map = {}
  for (const it of computedItems.value) {
    map[it[props.itemValue]] = it[props.itemTitle]
  }
  return map
})
</script>

<template>
  <template v-if="props.name">
    <FormField :name="props.name">
      <FormItem>
        <FormLabel class="flex">
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <div class="relative w-full items-center">
          <FormControl>
            <Combobox v-model="modelValue" v-model:open="open" :ignore-filter="true" :disabled="props.disabled">
              <ComboboxAnchor as-child>
                <TagsInput v-model="modelValue" :class="cn('px-2 gap-2 w-80', props.class)" :disabled="props.disabled">
                  <div class="flex gap-2 flex-wrap items-center">
                    <TagsInputItem v-for="val in modelValue" :key="val" :value="val">
                      <span class="px-1">{{ valueToTitle[val] ?? val }}</span>
                      <TagsInputItemDelete v-if="!props.disabled" />
                    </TagsInputItem>
                  </div>

                  <ComboboxInput v-model="searchTerm" as-child>
                    <TagsInputInput :disabled="props.disabled" :placeholder="props.placeholder" class="min-w-[200px] w-full p-0 border-none focus-visible:ring-0 h-auto" @keydown.enter.prevent />
                  </ComboboxInput>
                </TagsInput>

                <ComboboxList class="w-[--reka-popper-anchor-width]">
                  <ComboboxEmpty />
                  <ComboboxGroup>
                    <ComboboxItem
                      v-for="item in filteredItems" :key="item[props.itemValue]" :value="item[props.itemValue]"
                      @select.prevent="(ev) => {
                        if (typeof ev.detail.value === 'string') {
                          searchTerm = ''
                          modelValue.push(ev.detail.value)
                        }
                        if (filteredItems.length === 0) {
                          open = false
                        }
                      }"
                    >
                      {{ item[props.itemTitle] }}
                    </ComboboxItem>
                  </ComboboxGroup>
                </ComboboxList>
              </ComboboxAnchor>
            </Combobox>
          </FormControl>

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

  <template v-else>
    <div class="w-full">
      <label class="flex mb-1">
        {{ props.label }}
      </label>
      <div class="relative w-full items-center">
        <Select v-model="modelValue" :disabled="props.disabled" :default-value="modelValue">
          <SelectTrigger class="text-foreground" :class="[$slots.icon ? 'pr-8' : '', props.class]">
            <SelectValue />
          </SelectTrigger>
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
      <p class="text-sm text-muted-foreground mt-1">
        {{ props.description }}
      </p>
    </div>
  </template>
</template>

<style lang="scss" scoped>
</style>
