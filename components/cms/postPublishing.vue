<script setup>
import { FileCheck, FilePen, FileWarning, FileX, X } from 'lucide-vue-next'
defineProps({
  modelValue: { type: String, default: '' },
  status: { type: Object, required: true },
  lastPublished: { type: String, default: 'Never' },
  scheduledAt: { type: String, default: '' },
  scheduledLabel: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  unsaved: { type: Boolean, default: false },
  isNew: { type: Boolean, default: false },
  scheduleBlockedReason: { type: String, default: '' },
  error: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'publish', 'schedule', 'unpublish', 'clear'])
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 text-sm">
      <FileWarning v-if="status.icon === 'changes'" class="h-4 w-4 text-yellow-600" />
      <FileCheck v-else-if="status.icon === 'published'" class="h-4 w-4 text-green-700" />
      <FileX v-else class="h-4 w-4 text-slate-500 dark:text-slate-300" />
      <span :class="status.badgeClass">{{ status.label }}</span>
    </div>
    <div class="text-xs text-muted-foreground">
      Last published: {{ lastPublished }}
    </div>
    <div v-if="scheduledAt" class="space-y-1 text-xs text-muted-foreground">
      <div>Scheduled publish: {{ scheduledLabel }}</div>
      <edge-shad-button
        type="button"
        size="sm"
        variant="ghost"
        class="h-6 px-2 text-[10px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        :disabled="busy || unsaved || isNew"
        @click="emit('clear')"
      >
        <X class="h-3 w-3" />
        Clear
      </edge-shad-button>
    </div>
    <div v-if="isNew" class="text-xs text-amber-700 dark:text-amber-300">
      Save this post before <strong>Publish Now</strong> and <strong>Schedule Publish</strong> are available.
    </div>
    <div v-if="unsaved" class="text-xs text-amber-700 dark:text-amber-300">
      Save changes before publishing.
    </div>
    <div v-if="status.publishBlockedReason" class="text-xs text-amber-700 dark:text-amber-300">
      {{ status.publishBlockedReason }}
    </div>
    <edge-shad-datetime
      :model-value="modelValue"
      name="publish-at"
      label="Publish At"
      trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
      meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
      calendar-class="edge-cms-calendar-slate"
      :disabled="busy || unsaved || isNew"
      @update:model-value="value => emit('update:modelValue', value)"
    />
    <div class="text-xs text-muted-foreground">
      Pick date/time for scheduled publish. Use Publish Now to publish immediately.
    </div>
    <div v-if="scheduleBlockedReason" class="text-xs text-amber-700 dark:text-amber-300">
      {{ scheduleBlockedReason }}
    </div>
    <div class="flex flex-wrap gap-2">
      <edge-shad-button
        v-if="status.canPublish || status.publishBlockedReason"
        type="button"
        size="sm"
        class="w-full bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
        :disabled="busy || unsaved || isNew || Boolean(status.publishBlockedReason)"
        @click="emit('publish')"
      >
        <FileCheck class="h-4 w-4" />
        Publish Now
      </edge-shad-button>
      <edge-shad-button
        v-if="status.canPublish || status.publishBlockedReason"
        type="button"
        size="sm"
        variant="outline"
        class="w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        :disabled="busy || unsaved || isNew || Boolean(status.publishBlockedReason) || Boolean(scheduleBlockedReason)"
        @click="emit('schedule')"
      >
        <FilePen class="h-4 w-4" />
        Schedule Publish
      </edge-shad-button>
      <edge-shad-button
        v-if="status.canUnpublish"
        type="button"
        size="sm"
        variant="outline"
        class="w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        :disabled="busy || isNew"
        @click="emit('unpublish')"
      >
        <FileWarning class="h-4 w-4" />
        Unpublish
      </edge-shad-button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>
  </div>
</template>
