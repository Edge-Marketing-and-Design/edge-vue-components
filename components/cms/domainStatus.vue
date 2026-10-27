<script setup>
import { CircleAlert, Check, Info, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  status: { type: String, default: 'unknown' },
  error: { type: String, default: '' },
  checkedAt: { type: String, default: '' },
  checking: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
})
const label = computed(() => props.checking ? 'Checking domain status' : props.status === 'unknown' ? 'Domain verification status unavailable' : props.status === 'failed' ? 'Domain setup needs attention' : props.status === 'active' ? 'Domains active' : 'Domains connecting / awaiting verification')
const emit = defineEmits(['open', 'check', 'settings'])
</script>

<template>
  <Popover @update:open="emit('open', $event)">
    <PopoverTrigger as-child>
      <button
        type="button"
        @click.stop
        data-cms-domain-status-trigger
        class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="status === 'unknown' ? 'border-border bg-muted text-muted-foreground hover:bg-accent' : status === 'failed' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300' : status === 'active' ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900 dark:bg-green-950 dark:text-green-300' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'"
        :aria-label="label"
        :title="label"
      >
        <Loader2 v-if="checking" class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <Info v-else-if="status === 'unknown'" class="h-3.5 w-3.5" aria-hidden="true" />
        <CircleAlert v-else-if="status !== 'active'" class="h-3.5 w-3.5" aria-hidden="true" />
        <Check v-else class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent @click.stop @pointerdown.stop align="start" side="bottom" :side-offset="8" class="w-80 max-w-[calc(100vw-2rem)] space-y-3" data-cms-domain-status-details>
      <p class="text-sm font-semibold">{{ label }}</p>
      <p v-if="error" class="break-words text-sm text-destructive">{{ error }}</p>
      <p v-else class="text-sm text-muted-foreground">{{ checking ? 'Checking the current domain connections…' : status === 'active' ? 'Cloudflare has verified the domain connections.' : status === 'unknown' ? 'The status response does not confirm whether verification is needed. This does not mean the site is offline or awaiting verification.' : 'Cloudflare is still verifying the domain connections. Check again to refresh their status.' }}</p>
      <p v-if="checkedAt" class="text-xs text-muted-foreground">Last checked {{ new Date(checkedAt).toLocaleString() }}</p>
      <div v-if="canEdit" class="flex flex-wrap items-center gap-2 border-t pt-3">
        <edge-shad-button type="button" size="sm" variant="outline" :disabled="checking" @click="emit('check')">
          <Loader2 v-if="checking" class="h-3 w-3 animate-spin" />
          {{ checking ? 'Checking…' : 'Check again' }}
        </edge-shad-button>
        <edge-shad-button type="button" size="sm" variant="ghost" @click="emit('settings')">Domain settings</edge-shad-button>
      </div>
    </PopoverContent>
  </Popover>
</template>
