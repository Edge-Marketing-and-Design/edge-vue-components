<script setup>
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'
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

const state = reactive({
  width: 255,
})

const open = ref(false)

const computedItems = computed(() => {
  return props.items.map((item) => {
    if (typeof item === 'string') {
      return { [props.itemTitle]: item, [props.itemValue]: item }
    }
    return item
  })
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const triggerButton = ref(null)

onMounted(() => {
  nextTick(() => {
    if (triggerButton.value) {
      state.width = triggerButton.value.$el.offsetWidth
    }
  })
})

const updateCheck = ref(true)
watch(() => modelValue.value, () => {
  updateCheck.value = false
  nextTick(() => {
    updateCheck.value = true
  })
})

const handleItemSelect = (item) => {
  if (item[props.itemValue]) {
    modelValue.value = item[props.itemValue]
  }
  else {
    modelValue.value = ''
  }
  open.value = false
  console.log('modelValue', modelValue.value)
}

const triggerTitle = computed(() => {
  let triggerTitle = 'Make a selection'
  if (modelValue.value) {
    const item = computedItems.value.find(item => item[props.itemValue] === modelValue.value)
    if (item) {
      if (edgeGlobal.objHas(item, props.itemTitle)) {
        triggerTitle = item[props.itemTitle]
      }
    }
  }
  return triggerTitle
})
</script>

<template>
  <FormField v-if="updateCheck" v-slot="{ componentField }" :name="props.name">
    <FormItem class="flex flex-col space-y-1">
      <Input
        :id="props.name"
        v-model="modelValue"
        :default-value="modelValue"
        v-bind="componentField"
        type="hidden"
      />
      <FormLabel>{{ props.label }}</FormLabel>
      <Popover v-model:open="open">
        <PopoverTrigger as-child>
          <FormControl>
            <Button
              ref="triggerButton"
              variant="outline"
              role="combobox"
              :aria-expanded="open"
              class="w-[200px] justify-between"
              :class="props.class"
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
                  {{ item[props.itemTitle] }}
                  <Check
                    :class="cn(
                      'ml-auto h-4 w-4',
                      modelValue === item[props.itemValue] ? 'opacity-100' : 'opacity-0',
                    )"
                  />
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
