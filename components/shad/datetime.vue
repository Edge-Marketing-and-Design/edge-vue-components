<script setup>
import { useVModel } from '@vueuse/core'
import { CalendarDate, parseDate } from '@internationalized/date'
import { Calendar as CalendarIcon, Clock3 } from 'lucide-vue-next'
import { useField } from 'vee-validate'
import { cn } from '@/lib/utils'

const props = defineProps({
  label: {
    type: String,
    required: false,
    default: '',
  },
  description: {
    type: String,
    required: false,
    default: '',
  },
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: String,
    required: false,
    default: '',
  },
  placeholder: {
    type: String,
    required: false,
    default: 'Pick date and time',
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  minuteStep: {
    type: Number,
    required: false,
    default: 5,
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
  triggerClass: {
    type: String,
    required: false,
    default: '',
  },
  meridiemActiveClass: {
    type: String,
    required: false,
    default: '',
  },
  meridiemInactiveClass: {
    type: String,
    required: false,
    default: '',
  },
  nowButtonClass: {
    type: String,
    required: false,
    default: '',
  },
  doneButtonClass: {
    type: String,
    required: false,
    default: '',
  },
  calendarClass: {
    type: String,
    required: false,
    default: '',
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const { setValue } = useField(props.name)

const state = reactive({
  open: false,
  date: null,
  hour12: '12',
  minute: '00',
  meridiem: 'AM',
  syncingFromModel: false,
})

const minuteStepSafe = computed(() => {
  const step = Number(props.minuteStep)
  if (!Number.isFinite(step) || step < 1)
    return 5
  return Math.min(30, Math.floor(step))
})

const hourOptions = Array.from({ length: 12 }, (_, i) => String(i + 1))

const minuteOptions = computed(() => {
  const values = []
  for (let i = 0; i < 60; i += minuteStepSafe.value)
    values.push(String(i).padStart(2, '0'))
  if (!values.includes(state.minute))
    values.push(state.minute)
  return values.sort((a, b) => Number(a) - Number(b))
})

const getCalendarDate = (dateString) => {
  if (!dateString)
    return null
  const [year, month, day] = dateString.split('-').map(Number)
  if (!year || !month || !day)
    return null
  return new CalendarDate(year, month, day)
}

const toDateKey = date => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`

const buildModelFromParts = () => {
  if (!state.date)
    return ''
  let hour = Number(state.hour12) % 12
  if (state.meridiem === 'PM')
    hour += 12
  return `${toDateKey(state.date)}T${String(hour).padStart(2, '0')}:${state.minute}`
}

const syncFromModel = (value) => {
  state.syncingFromModel = true
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  if (!match) {
    state.date = null
    state.hour12 = '12'
    state.minute = '00'
    state.meridiem = 'AM'
    state.syncingFromModel = false
    return
  }

  const [, datePart, hourPart, minutePart] = match
  const hour24 = Number(hourPart)
  const minute = Number(minutePart)
  try {
    state.date = parseDate(datePart)
  }
  catch {
    state.date = null
  }
  state.meridiem = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12
  state.hour12 = String(hour12)
  state.minute = String(minute).padStart(2, '0')
  state.syncingFromModel = false
}

watch(() => modelValue.value, (value) => {
  syncFromModel(value)
}, { immediate: true })

watch(
  [() => state.date, () => state.hour12, () => state.minute, () => state.meridiem],
  () => {
    if (state.syncingFromModel)
      return
    const next = buildModelFromParts()
    if (modelValue.value !== next)
      modelValue.value = next
    setValue(next)
  },
)

const displayValue = computed(() => {
  if (!state.date)
    return props.placeholder
  const [year, month, day] = toDateKey(state.date).split('-').map(Number)
  let hour = Number(state.hour12) % 12
  if (state.meridiem === 'PM')
    hour += 12
  const minute = Number(state.minute)
  const dt = new Date(year, month - 1, day, hour, minute, 0, 0)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(dt)
})

const setNow = () => {
  const now = new Date()
  const mins = now.getMinutes()
  const roundedMinutes = Math.round(mins / minuteStepSafe.value) * minuteStepSafe.value
  const adjusted = new Date(now)
  adjusted.setSeconds(0, 0)
  adjusted.setMinutes(roundedMinutes)
  state.date = parseDate(
    `${adjusted.getFullYear()}-${String(adjusted.getMonth() + 1).padStart(2, '0')}-${String(adjusted.getDate()).padStart(2, '0')}`,
  )
  const hour24 = adjusted.getHours()
  state.meridiem = hour24 >= 12 ? 'PM' : 'AM'
  state.hour12 = String(hour24 % 12 || 12)
  state.minute = String(adjusted.getMinutes()).padStart(2, '0')
}

onMounted(() => {
  setValue(modelValue.value || '')
})
</script>

<template>
  <FormField v-slot="{ componentField }" :name="props.name">
    <FormItem class="flex flex-col space-y-1">
      <FormLabel>{{ props.label }}</FormLabel>
      <Popover v-model:open="state.open">
        <PopoverTrigger as-child>
          <FormControl>
            <Button
              type="button"
              variant="outline"
              :disabled="props.disabled"
              :class="cn(
                'w-full justify-between text-left font-normal',
                !state.date && 'text-muted-foreground',
                props.triggerClass,
              )"
            >
              <span class="truncate">{{ displayValue }}</span>
              <CalendarIcon class="h-4 w-4 shrink-0 opacity-60" />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent class="w-auto max-w-[calc(100vw-1rem)] p-3 space-y-3">
          <div class="grid w-fit gap-3 md:grid-cols-[auto_220px] md:items-stretch">
            <Calendar
              v-model="state.date"
              :class="props.calendarClass"
              :disabled="props.disabled"
              initial-focus
              :min-value="getCalendarDate(props.minValue)"
              :max-value="getCalendarDate(props.maxValue)"
            />

            <div class="rounded-md border p-3 space-y-3 h-full md:flex md:flex-col md:justify-center">
              <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock3 class="h-3.5 w-3.5" />
                <span>Time</span>
              </div>

              <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <Select v-model="state.hour12" :disabled="props.disabled">
                  <SelectTrigger class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="hour in hourOptions" :key="hour" :value="hour">
                      {{ hour }}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <span class="text-center text-muted-foreground">:</span>

                <Select v-model="state.minute" :disabled="props.disabled">
                  <SelectTrigger class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="minute in minuteOptions" :key="minute" :value="minute">
                      {{ minute }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  :variant="state.meridiem === 'AM' ? 'default' : 'outline'"
                  :disabled="props.disabled"
                  :class="state.meridiem === 'AM' ? props.meridiemActiveClass : props.meridiemInactiveClass"
                  @click="state.meridiem = 'AM'"
                >
                  AM
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="state.meridiem === 'PM' ? 'default' : 'outline'"
                  :disabled="props.disabled"
                  :class="state.meridiem === 'PM' ? props.meridiemActiveClass : props.meridiemInactiveClass"
                  @click="state.meridiem = 'PM'"
                >
                  PM
                </Button>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="props.disabled"
              :class="props.nowButtonClass"
              @click="setNow"
            >
              Now
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :class="props.doneButtonClass"
              @click="state.open = false"
            >
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <input type="hidden" v-bind="componentField" :value="modelValue || ''">

      <FormDescription>{{ props.description }}</FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>

<style scoped>
:deep(.edge-cms-calendar-slate [data-selected]) {
  background-color: rgb(51 65 85) !important;
  color: rgb(248 250 252) !important;
}

:deep(.edge-cms-calendar-slate [data-selected]:hover),
:deep(.edge-cms-calendar-slate [data-selected]:focus-visible) {
  background-color: rgb(71 85 105) !important;
  color: rgb(248 250 252) !important;
}

:deep(.dark .edge-cms-calendar-slate [data-selected]) {
  background-color: rgb(226 232 240) !important;
  color: rgb(15 23 42) !important;
}

:deep(.dark .edge-cms-calendar-slate [data-selected]:hover),
:deep(.dark .edge-cms-calendar-slate [data-selected]:focus-visible) {
  background-color: rgb(203 213 225) !important;
  color: rgb(15 23 42) !important;
}
</style>
