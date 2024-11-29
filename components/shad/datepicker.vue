<script setup>
import { useVModel } from '@vueuse/core'
import { CalendarDate, getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { Calendar as CalendarIcon } from 'lucide-vue-next'
import { ref } from 'vue'
import { useField } from 'vee-validate'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: false,
  },
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: String,
    required: false,
    default: undefined,
  },
})
const emits = defineEmits(['update:modelValue'])
const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const { setValue } = useField(props.name)

const value = ref()

const formatDate = (date) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', // Explicitly set to UTC
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date(date)).replace(/-/g, '-') // Output: YYYY-MM-DD
}
watch(() => value.value, (value) => {
  modelValue.value = formatDate (value)
  setValue(`${value.year}-${value.month}-${value.day}`)
})

const placeholder = ref()

onMounted(() => {
  console.log('modelValue', props.modelValue)
  if (props.modelValue) {
    value.value = props.modelValue ? parseDate(props.modelValue) : undefined
  }
})
</script>

<template>
  <FormField :name="props.name">
    <FormItem class="flex flex-col space-y-1">
      <FormLabel>{{ props.label }}</FormLabel>
      <Popover>
        <PopoverTrigger as-child>
          <FormControl>
            <Button
              variant="outline" :class="cn(
                'w-[240px] ps-3 text-start font-normal',
                !value && 'text-muted-foreground',
              )"
            >
              <span>{{ value ? value : "Pick a date" }}</span>
              <CalendarIcon class="ms-auto h-4 w-4 opacity-50" />
            </Button>
            <input hidden>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0">
          <Calendar
            v-model:placeholder="placeholder"
            v-model="value"
            :calendar-label="props.label"
            initial-focus
            :min-value="new CalendarDate(1900, 1, 1)"
            :max-value="today(getLocalTimeZone())"
          />
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
,
