<script setup>
import { useVModel } from '@vueuse/core'
import { CalendarDate, parseDate } from '@internationalized/date'
import { Calendar as CalendarIcon } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
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
    required: false,
    default: '',
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
    type: [String, Array],
    required: false,
    default: undefined,
  },
  multiple: {
    type: Boolean,
    required: false,
    default: false,
  },
  minValue: {
    type: String,
    required: false,
    default: '1900-01-01',
  },
  maxValue: {
    type: String,
    required: false,
    default: '2099-01-14',
  },
})

const emits = defineEmits(['update:modelValue'])

const getCalendarDate = (dateString) => {
  if (!dateString)
    return null // Handle cases where the date string is not provided
  const [year, month, day] = dateString.split('-').map(Number)
  return new CalendarDate(year, month, day)
}

const minCalendarDate = computed(() => getCalendarDate(props.minValue))
const maxCalendarDate = computed(() => getCalendarDate(props.maxValue))

const monthOptions = [
  { label: 'January', value: 1 },
  { label: 'February', value: 2 },
  { label: 'March', value: 3 },
  { label: 'April', value: 4 },
  { label: 'May', value: 5 },
  { label: 'June', value: 6 },
  { label: 'July', value: 7 },
  { label: 'August', value: 8 },
  { label: 'September', value: 9 },
  { label: 'October', value: 10 },
  { label: 'November', value: 11 },
  { label: 'December', value: 12 },
]

const yearOptions = computed(() => {
  const startYear = minCalendarDate.value?.year || 1900
  const endYear = maxCalendarDate.value?.year || 2099
  const years = []

  for (let year = endYear; year >= startYear; year--)
    years.push(year)

  return years
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const { setValue } = useField(props.name)

const value = ref(props.multiple ? [] : null)
const placeholder = ref()

const todayCalendarDate = () => {
  const now = new Date()
  return new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

const compareCalendarDates = (firstDate, secondDate) => {
  if (!firstDate || !secondDate)
    return 0
  const first = new Date(firstDate.year, firstDate.month - 1, firstDate.day)
  const second = new Date(secondDate.year, secondDate.month - 1, secondDate.day)
  return first - second
}

const clampCalendarDate = (date) => {
  if (!date)
    return date
  if (minCalendarDate.value && compareCalendarDates(date, minCalendarDate.value) < 0)
    return minCalendarDate.value
  if (maxCalendarDate.value && compareCalendarDates(date, maxCalendarDate.value) > 0)
    return maxCalendarDate.value
  return date
}

const firstSelectedDate = computed(() => {
  if (props.multiple && Array.isArray(value.value))
    return value.value[0] || null
  return value.value || null
})

const visibleCalendarDate = computed(() => {
  return placeholder.value || firstSelectedDate.value || clampCalendarDate(todayCalendarDate())
})

const visibleMonth = computed(() => visibleCalendarDate.value?.month || 1)
const visibleYear = computed(() => visibleCalendarDate.value?.year || new Date().getFullYear())

const setVisibleCalendarDate = ({ year = visibleYear.value, month = visibleMonth.value }) => {
  const sourceDate = visibleCalendarDate.value || todayCalendarDate()
  const nextDate = new CalendarDate(Number(year), Number(month), Math.min(sourceDate.day || 1, 28))
  placeholder.value = clampCalendarDate(nextDate)
}

const setVisibleMonth = event => setVisibleCalendarDate({ month: event.target.value })
const setVisibleYear = event => setVisibleCalendarDate({ year: event.target.value })

const formatDate = (dates) => {
  const pad = num => String(num).padStart(2, '0')

  if (Array.isArray(dates)) {
    return dates
      .map(date => `${date.year}-${pad(date.month)}-${pad(date.day)}`)
      .join(', ')
  }
  else if (dates) {
    return `${dates.year}-${pad(dates.month)}-${pad(dates.day)}`
  }
  return ''
}

watch(() => value.value, (newValue) => {
  if (props.multiple && Array.isArray(newValue)) {
    // Sort dates in ascending order
    newValue.sort((a, b) => {
      const dateA = new Date(a.year, a.month - 1, a.day)
      const dateB = new Date(b.year, b.month - 1, b.day)
      return dateA - dateB
    })
  }

  modelValue.value = props.multiple
    ? newValue.map(date => formatDate(date))
    : formatDate(newValue)
  setValue(
    props.multiple
      ? newValue.map(date => `${date.year}-${date.month}-${date.day}`).join(', ')
      : `${newValue?.year}-${newValue?.month}-${newValue?.day}`,
  )
})

onMounted(() => {
  if (props.multiple) {
    if (Array.isArray(props.modelValue) && props.modelValue.length > 0) {
      value.value = props.modelValue.map(date => parseDate(date))
    }
    else {
      value.value = [] // Set to an empty array if modelValue is empty or invalid
    }
  }
  else {
    if (typeof props.modelValue === 'string' && props.modelValue.trim() !== '') {
      value.value = parseDate(props.modelValue)
    }
    else {
      value.value = null // Set to null if modelValue is empty or invalid
    }
  }

  placeholder.value = clampCalendarDate(firstSelectedDate.value || todayCalendarDate())
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
              :class="cn(
                'w-full border border-solid ps-3 text-start font-normal items-start h-auto', // Added 'items-start'
                (!value || (Array.isArray(value) && value.length === 0)) && 'text-muted-foreground',
              )"
            >
              <div class="flex flex-wrap gap-1 overflow-hidden">
                <template v-if="Array.isArray(value)">
                  <edge-chip v-for="date in value" :key="date" class="mr-1">
                    {{ date }}
                  </edge-chip>
                </template>
                <span v-else-if="value">
                  {{ value }}
                </span>
              </div>
              <CalendarIcon class="ms-auto h-4 w-4 opacity-50" />
            </Button>
            <input hidden>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0">
          <div class="flex items-center gap-2 border-b border-slate-200 p-2">
            <label class="sr-only" :for="`${props.name}-calendar-month`">Calendar month</label>
            <select
              :id="`${props.name}-calendar-month`"
              class="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              :value="visibleMonth"
              @change="setVisibleMonth"
            >
              <option v-for="month in monthOptions" :key="month.value" :value="month.value">
                {{ month.label }}
              </option>
            </select>

            <label class="sr-only" :for="`${props.name}-calendar-year`">Calendar year</label>
            <select
              :id="`${props.name}-calendar-year`"
              class="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              :value="visibleYear"
              @change="setVisibleYear"
            >
              <option v-for="year in yearOptions" :key="year" :value="year">
                {{ year }}
              </option>
            </select>
          </div>
          <Calendar
            v-model:placeholder="placeholder"
            v-model="value"
            :multiple="props.multiple"
            :calendar-label="props.label"
            initial-focus
            :min-value="getCalendarDate(props.minValue)"
            :max-value="getCalendarDate(props.maxValue)"
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
