<script setup>
import { useVModel } from '@vueuse/core'
import { useField } from 'vee-validate'
import { cn } from '@/lib/utils'
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: [String, Array],
    required: false,
  },
  class: {
    type: null,
    required: false,
    default: 'w-100',
  },
  placeholder: {
    type: String,
    default: 'Make a selection',
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
  multiple: {
    type: Boolean,
    required: false,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  width: 255,
})

const open = ref(false)

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

// Ensure model is an array when multiple
if (props.multiple && !Array.isArray(modelValue.value)) {
  modelValue.value = modelValue.value ? [modelValue.value] : []
}

const triggerButton = ref(null)

watch(open, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      if (triggerButton.value) {
        state.width = triggerButton.value.$el.offsetWidth
      }
    })
  }
})

const updateCheck = ref(true)
watch(() => modelValue.value, () => {
  updateCheck.value = false
  nextTick(() => {
    updateCheck.value = true
  })
})

const { setValue } = useField(props.name)

const handleItemSelect = (item) => {
  const selectedValue = item[props.itemValue] ?? ''

  if (props.multiple) {
    // Start from an array
    const current = Array.isArray(modelValue.value) ? [...modelValue.value] : []
    const idx = current.indexOf(selectedValue)
    if (idx === -1) {
      current.push(selectedValue)
    }
    else {
      current.splice(idx, 1)
    }
    modelValue.value = current
    emits('update:modelValue', current)
    setValue(current)
    // keep popover open for multi-select
  }
  else {
    modelValue.value = selectedValue
    emits('update:modelValue', selectedValue)
    setValue(selectedValue)
    open.value = false
  }
}

watch(() => modelValue.value, (newValue) => {
  emits('update:modelValue', newValue)
})

const isSelected = (item) => {
  const val = item[props.itemValue] ?? ''
  if (props.multiple) {
    return Array.isArray(modelValue.value) && modelValue.value.includes(val)
  }
  return modelValue.value === val
}

const triggerTitle = computed(() => {
  const placeholder = props.placeholder
  const items = computedItems.value

  if (props.multiple) {
    const values = Array.isArray(modelValue.value) ? modelValue.value : []
    if (values.length === 0)
      return placeholder
    const titles = values
      .map(v => items.find(i => (i[props.itemValue] ?? '') === v))
      .filter(Boolean)
      .map(i => i[props.itemTitle])
    if (titles.length === 0)
      return placeholder
    if (titles.length <= 3)
      return titles.join(', ')
    return `${titles.length} selected`
  }
  else {
    if (modelValue.value) {
      const item = items.find(i => (i[props.itemValue] ?? '') === modelValue.value)
      if (item && edgeGlobal.objHas(item, props.itemTitle))
        return item[props.itemTitle]
    }
    return placeholder
  }
})
</script>

<template>
  <FormField :name="props.name">
    <FormItem class="flex flex-col space-y-1">
      <FormLabel>{{ props.label }}</FormLabel>
      <Popover v-model:open="open">
        <PopoverTrigger as-child>
          <FormControl>
            <Button
              ref="triggerButton"
              variant="outline"
              role="combobox"
              :aria-expanded="open"
              class="w-[200px] justify-between text-foreground"
              :class="props.class"
              :disabled="props.disabled"
            >
              {{ triggerTitle }}
              <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent class="p-0" :style="`width: ${state.width}px !important;`">
          <Command>
            <CommandInput class="h-9" placeholder="Search..." />
            <CommandEmpty>Not found.</CommandEmpty>
            <CommandList>
              <CommandGroup>
                <CommandItem
                  v-for="item in computedItems"
                  :key="item[props.itemTitle]"
                  :value="item[props.itemTitle]"
                  @select="() => handleItemSelect(item)"
                >
                  <Check
                    :class="cn(
                      'h-4 w-4',
                      isSelected(item) ? 'opacity-100' : 'opacity-0',
                    )"
                  />
                  {{ item[props.itemTitle] }}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FormDescription>
        {{ props.description }}
      </FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>

<style lang="scss" scoped>
.PopoverContent {
  width: 100vw;
  max-height: var(--radix-popover-content-available-height);
}
</style>
