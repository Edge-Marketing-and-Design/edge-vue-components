<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({ modelValue: { type: Object, required: true }, disabled: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
const event = useVModel(props, 'modelValue', emit, { passive: true, deep: true, clone: true })
const TIMEZONE_OPTIONS = computed(() => [...new Set([
  'UTC', event.value.timezone,
  ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
])].filter(Boolean).map(value => ({ value, label: value })))
const EVENT_STATUS_OPTIONS = ['scheduled', 'cancelled', 'completed'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="event.isPast"
      class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      This event is in the past.
    </div>
    <edge-shad-datetime
      v-model="event.startAt"
      name="event.startAt"
      label="Start At"
      trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
      meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
      calendar-class="edge-cms-calendar-slate"
      :disabled="disabled"
    />
    <edge-shad-datetime
      v-model="event.endAt"
      name="event.endAt"
      label="End At"
      trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
      meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
      calendar-class="edge-cms-calendar-slate"
      :disabled="disabled"
    />
    <edge-shad-select
      v-model="event.timezone"
      :items="TIMEZONE_OPTIONS"
      item-title="label"
      item-value="value"
      name="event-timezone"
      label="Timezone"
      placeholder="Select timezone"
      :disabled="disabled"
    />
    <edge-shad-checkbox
      v-model="event.isVirtual"
      name="event.isVirtual"
      label="Virtual Event"
      class="!bg-slate-200 !border-slate-400 data-[state=checked]:!bg-slate-700 data-[state=checked]:!text-slate-100 dark:!bg-slate-700 dark:!border-slate-500 dark:data-[state=checked]:!bg-slate-200 dark:data-[state=checked]:!text-slate-900"
      :disabled="disabled"
    >
      This event is virtual (no physical location required).
    </edge-shad-checkbox>
    <edge-shad-checkbox
      v-model="event.unpublishPastEvent"
      name="event.unpublishPastEvent"
      label="Unpublish Past Event"
      class="!bg-slate-200 !border-slate-400 data-[state=checked]:!bg-slate-700 data-[state=checked]:!text-slate-100 dark:!bg-slate-700 dark:!border-slate-500 dark:data-[state=checked]:!bg-slate-200 dark:data-[state=checked]:!text-slate-900"
      :disabled="disabled"
    >
      Unpublish Past Event
    </edge-shad-checkbox>
    <edge-shad-input
      v-if="!event.isVirtual"
      v-model="event.locationName"
      name="event.locationName"
      label="Location Name"
      :disabled="disabled"
    />
    <edge-shad-textarea
      v-if="!event.isVirtual"
      v-model="event.locationAddress"
      name="event.locationAddress"
      label="Location Address"
      :disabled="disabled"
      rows="3"
    />
    <div class="grid gap-4 md:grid-cols-2">
      <edge-shad-input
        v-model="event.meetingUrl"
        name="event-meeting-url"
        label="Meeting URL"
        type="url"
        :disabled="disabled"
      />
      <edge-shad-input
        v-model="event.registrationUrl"
        name="event-registration-url"
        label="Registration URL"
        type="url"
        :disabled="disabled"
      />
    </div>
    <div class="grid gap-4 md:grid-cols-2 items-center">
      <edge-shad-input
        v-model.number="event.capacity"
        name="event-capacity"
        label="Capacity"
        type="number"
        :disabled="disabled"
      />
      <edge-shad-select
        v-model="event.status"
        :items="EVENT_STATUS_OPTIONS"
        item-title="label"
        item-value="value"
        name="event-status"
        label="Event Status"
        :disabled="disabled"
      />
    </div>
  </div>
</template>
