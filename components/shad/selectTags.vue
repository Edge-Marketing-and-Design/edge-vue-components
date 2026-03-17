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
    default: () => [],
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
  allowAdditions: {
    type: Boolean,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue', 'add'])

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
const selectedValues = computed({
  get: () => (Array.isArray(modelValue.value) ? modelValue.value : []),
  set: value => (modelValue.value = Array.isArray(value) ? value : []),
})
const open = ref(false)
const searchTerm = ref('')

const { contains } = useFilter({ sensitivity: 'base' })

const forceOpen = () => {
  if (!props.disabled)
    open.value = true
}

const filteredItems = computed(() => {
  const options = computedItems.value.filter(i => !selectedValues.value.includes(i[props.itemValue]))
  return searchTerm.value ? options.filter(option => contains(option[props.itemTitle], searchTerm.value)) : options
})

const valueToTitle = computed(() => {
  const map = {}
  for (const it of computedItems.value) {
    map[it[props.itemValue]] = it[props.itemTitle]
  }
  return map
})

const existingValueMap = computed(() => {
  const map = {}
  for (const item of computedItems.value) {
    const value = String(item[props.itemValue])
    map[value.toLowerCase()] = value
  }
  return map
})

const normalize = value => String(value || '').trim()

const addValueToModel = (value) => {
  const normalized = normalize(value)
  if (!normalized)
    return
  if (!selectedValues.value.includes(normalized))
    selectedValues.value = [...selectedValues.value, normalized]
}

const addFromSearch = () => {
  if (!props.allowAdditions)
    return
  const raw = normalize(searchTerm.value)
  if (!raw)
    return

  const existingValue = existingValueMap.value[raw.toLowerCase()]
  if (existingValue) {
    addValueToModel(existingValue)
    searchTerm.value = ''
    open.value = false
    return
  }

  addValueToModel(raw)
  emits('add', raw)
  searchTerm.value = ''
  open.value = false
}

const onEnter = () => {
  if (!props.allowAdditions)
    return
  addFromSearch()
}

const onSelectItem = (ev) => {
  const value = ev?.detail?.value
  if (typeof value === 'string') {
    searchTerm.value = ''
    addValueToModel(value)
  }
  if (filteredItems.value.length === 0)
    open.value = false
}
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
            <Combobox v-model="selectedValues" v-model:open="open" :ignore-filter="true" :disabled="props.disabled">
              <ComboboxAnchor as-child>
                <TagsInput
                  v-model="selectedValues"
                  :class="cn('relative flex w-80 max-w-full min-w-0 items-center gap-1 overflow-hidden pl-2 pr-1 pt-[7px] pb-[7px] rounded-md border border-slate-300 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100', props.class)"
                  :disabled="props.disabled"
                  @click="forceOpen"
                >
                  <!-- Wrapping area for tags + input -->
                  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden">
                    <TagsInputItem v-for="val in selectedValues" :key="val" class="h-6 max-w-full min-w-0 border border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100" :value="val">
                      <span class="block max-w-[12rem] truncate px-1" :title="valueToTitle[val] ?? val">{{ valueToTitle[val] ?? val }}</span>
                      <TagsInputItemDelete v-if="!props.disabled" />
                    </TagsInputItem>

                    <ComboboxInput v-model="searchTerm" as-child>
                      <TagsInputInput
                        :disabled="props.disabled"
                        :placeholder="props.placeholder"
                        class="h-auto min-w-[5rem] max-w-full grow border-none p-0 shadow-none focus-visible:ring-0"
                        @input="forceOpen"
                        @keydown.enter.prevent="onEnter"
                      />
                    </ComboboxInput>
                  </div>

                  <!-- Non-wrapping trigger -->
                  <ComboboxTrigger as-child>
                    <Button variant="ghost" size="icon" class="h-6 w-6 z-10">
                      <ChevronsUpDown class="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </ComboboxTrigger>
                </TagsInput>

                <ComboboxList class="w-[--reka-popper-anchor-width]">
                  <ComboboxEmpty>
                    <button
                      v-if="props.allowAdditions && searchTerm && searchTerm.trim() && !computedItems.some(item => String(item[props.itemValue]).toLowerCase() === searchTerm.trim().toLowerCase())"
                      type="button"
                      class="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                      @click.prevent="addFromSearch()"
                    >
                      Create "{{ searchTerm.trim() }}"
                    </button>
                    <span v-else-if="searchTerm && searchTerm.trim()" class="block px-2 py-1 text-sm text-slate-500 dark:text-slate-400">
                      No results found
                    </span>
                    <span v-else class="block px-2 py-1 text-sm text-slate-500 dark:text-slate-400">
                      Start typing to search
                    </span>
                  </ComboboxEmpty>
                  <ComboboxGroup>
                    <ComboboxItem
                      v-for="item in filteredItems" :key="item[props.itemValue]" :value="item[props.itemValue]"
                      @select.prevent="onSelectItem"
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
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
        {{ props.description }}
      </p>
    </div>
  </template>
</template>

<style lang="scss" scoped>
</style>
