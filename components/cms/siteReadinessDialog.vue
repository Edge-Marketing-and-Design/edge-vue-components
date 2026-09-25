<script setup>
// Lists what stands between a site and going live (first-release plan,
// phase 6): missing theme or blocks, block values that fail their schema,
// failed block checks, override blocks, and unpublished or outdated pages.
// The same report the agent endpoint and the MCP return. Read-only.
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from 'lucide-vue-next'

const props = defineProps({
  siteId: {
    type: String,
    default: '',
  },
  siteName: {
    type: String,
    default: '',
  },
})

const open = defineModel({ type: Boolean, default: false })
const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  loading: false,
  error: '',
  report: null,
})

const SEVERITY = {
  error: { label: 'Must fix', icon: CircleAlert, tone: 'text-red-700 dark:text-red-400' },
  warning: { label: 'Check', icon: TriangleAlert, tone: 'text-yellow-700 dark:text-yellow-400' },
  info: { label: 'Note', icon: Info, tone: 'text-slate-600 dark:text-slate-400' },
}

const groups = computed(() => {
  const items = state.report?.items || []
  return ['error', 'warning', 'info']
    .map(severity => ({ severity, ...SEVERITY[severity], items: items.filter(item => item.severity === severity) }))
    .filter(group => group.items.length)
})

const summary = computed(() => {
  const counts = state.report?.counts
  if (!counts)
    return ''
  if (counts.error)
    return `Not ready: ${counts.error} ${counts.error === 1 ? 'problem' : 'problems'} to fix.`
  if (counts.warning)
    return `No blocking problems. ${counts.warning} ${counts.warning === 1 ? 'item' : 'items'} to check.`
  return 'Ready: nothing to fix or check.'
})

const load = async () => {
  if (!props.siteId)
    return
  state.loading = true
  state.error = ''
  state.report = null
  try {
    const response = await edgeFirebase.runFunction('cms-siteReadiness', {
      orgId: edgeGlobal.edgeState.currentOrganization,
      uid: edgeFirebase?.user?.uid || '',
      siteId: props.siteId,
    })
    state.report = response?.data || null
  }
  catch (error) {
    state.error = error?.message || 'The readiness check failed.'
  }
  finally {
    state.loading = false
  }
}

watch(open, (value) => {
  if (value)
    load()
}, { immediate: true })
</script>

<template>
  <edge-shad-dialog v-model="open">
    <DialogContent class="pt-8 max-w-2xl max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="text-left">
          Readiness: {{ props.siteName || props.siteId }}
        </DialogTitle>
        <DialogDescription class="text-left">
          Checks the site's theme, pages and blocks before it goes live. Nothing is changed.
        </DialogDescription>
      </DialogHeader>
      <div class="flex-1 overflow-y-auto space-y-4 pr-1" aria-live="polite">
        <div v-if="state.loading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" /> Checking the site…
        </div>
        <p v-else-if="state.error" class="text-sm text-red-700 dark:text-red-400" role="alert">
          {{ state.error }}
        </p>
        <template v-else-if="state.report">
          <p class="flex items-center gap-2 text-sm font-medium" :class="state.report.ready ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'">
            <CircleCheck v-if="state.report.ready" class="h-4 w-4" />
            <CircleAlert v-else class="h-4 w-4" />
            {{ summary }}
          </p>
          <section v-for="group in groups" :key="group.severity" class="space-y-1">
            <h3 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" :class="group.tone">
              <component :is="group.icon" class="h-3.5 w-3.5" />
              {{ group.label }} ({{ group.items.length }})
            </h3>
            <ul class="space-y-1 text-sm">
              <li v-for="(item, index) in group.items" :key="`${item.code}-${index}`" class="rounded border px-3 py-2">
                {{ item.message }}
              </li>
            </ul>
          </section>
        </template>
      </div>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" :disabled="state.loading" @click="load">
          Check again
        </edge-shad-button>
        <edge-shad-button @click="open = false">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
