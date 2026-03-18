<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Exporting',
  },
  status: {
    type: String,
    default: 'running',
  },
  processed: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    default: 0,
  },
  currentItem: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'cancel'])

const progressValue = computed(() => {
  if (!props.total)
    return 0
  return Math.min(100, Math.max(0, (props.processed / props.total) * 100))
})

const statusCopy = computed(() => {
  if (props.status === 'complete')
    return 'Export complete.'
  if (props.status === 'canceled')
    return 'Export canceled.'
  return 'Export in progress.'
})

const progressCopy = computed(() => {
  if (!props.total)
    return 'Preparing export...'
  if (props.status === 'complete')
    return `${props.processed} of ${props.total} files exported.`
  if (props.status === 'canceled')
    return `${props.processed} of ${props.total} files exported before stopping.`
  return `${props.processed} of ${props.total} files exported.`
})

const currentItemCopy = computed(() => {
  if (props.currentItem)
    return props.currentItem
  if (props.status === 'complete')
    return 'All files exported.'
  if (props.status === 'canceled')
    return 'Export stopped before completion.'
  return 'Waiting for save location...'
})

const openProxy = computed({
  get: () => props.modelValue,
  set: (value) => {
    if (props.status === 'running')
      return
    emit('update:modelValue', value)
  },
})

const handleClose = () => emit('update:modelValue', false)
const handleCancel = () => emit('cancel')
</script>

<template>
  <edge-shad-dialog v-model="openProxy">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="text-left">
          {{ title }}
        </DialogTitle>
        <DialogDescription class="text-left">
          {{ statusCopy }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-w-0 space-y-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between text-sm text-muted-foreground">
            <span>{{ progressCopy }}</span>
            <span>{{ Math.round(progressValue) }}%</span>
          </div>
          <Progress :model-value="progressValue" class="h-2" />
        </div>

        <div class="min-w-0 rounded-md border border-slate-300/70 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
          <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current File
          </div>
          <div class="mt-1 w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm" :title="currentItemCopy">
            {{ currentItemCopy }}
          </div>
        </div>
      </div>

      <DialogFooter class="pt-2">
        <edge-shad-button v-if="status === 'running'" variant="outline" @click="handleCancel">
          Stop Export
        </edge-shad-button>
        <edge-shad-button v-else @click="handleClose">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
