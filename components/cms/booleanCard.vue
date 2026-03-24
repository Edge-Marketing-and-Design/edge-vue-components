<script setup>
import { useVModel } from '@vueuse/core'
import { Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: Boolean,
    default: false,
  },
  label: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  checkedLabel: {
    type: String,
    default: 'Enabled',
  },
  uncheckedLabel: {
    type: String,
    default: 'Disabled',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  stretch: {
    type: Boolean,
    default: false,
  },
  class: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emit, {
  passive: true,
  defaultValue: props.modelValue,
})

const normalizeChecked = value => value === true || value === 'indeterminate'

const applyValue = (value, handleChange) => {
  const checked = normalizeChecked(value)
  modelValue.value = checked
  handleChange(checked)
}

const toggleValue = (handleChange) => {
  if (props.disabled)
    return
  applyValue(!modelValue.value, handleChange)
}
</script>

<template>
  <FormField v-slot="{ handleChange }" type="checkbox" :name="props.name">
    <FormItem :class="props.stretch ? 'h-full space-y-2' : 'space-y-2'">
      <div
        role="button"
        tabindex="0"
        :class="cn(
          props.stretch
            ? 'group flex h-full flex-col justify-between rounded-xl border p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            : 'group rounded-xl border p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          props.disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-slate-400 hover:bg-slate-50 dark:hover:border-slate-500 dark:hover:bg-slate-900/60',
          modelValue
            ? 'border-slate-900 bg-slate-100 shadow-sm dark:border-slate-200 dark:bg-slate-800/80'
            : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950',
          props.class,
        )"
        @click="toggleValue(handleChange)"
        @keyup.enter.prevent="toggleValue(handleChange)"
        @keyup.space.prevent="toggleValue(handleChange)"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 space-y-1 text-left">
            <FormLabel class="text-sm font-semibold leading-none text-foreground">
              {{ props.label }}
            </FormLabel>
            <FormDescription v-if="$slots.default || props.description" class="text-sm text-muted-foreground">
              <slot>
                {{ props.description }}
              </slot>
            </FormDescription>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <span
              class="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              :class="modelValue
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'"
            >
              {{ modelValue ? props.checkedLabel : props.uncheckedLabel }}
            </span>
            <FormControl>
              <Checkbox
                :model-value="modelValue"
                :disabled="props.disabled"
                class="h-6 w-6 rounded-md border-2 border-slate-400 bg-white data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white dark:border-slate-500 dark:bg-slate-950 dark:data-[state=checked]:border-slate-100 dark:data-[state=checked]:bg-slate-100 dark:data-[state=checked]:text-slate-900"
                @click.stop
                @update:model-value="value => applyValue(value, handleChange)"
              >
                <Check class="h-4 w-4" />
              </Checkbox>
            </FormControl>
          </div>
        </div>
      </div>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
