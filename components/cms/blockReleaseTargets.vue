<script setup>
import { Loader2, RefreshCw } from 'lucide-vue-next'
import { groupReleaseTargets, readReleaseTargets, RELEASE_BADGE_CLASSES } from '../../lib/cmsBlockReleasePresentation'

const props = defineProps({
  releaseId: { type: String, required: true },
  sites: { type: Array, default: () => [] },
  refreshKey: { type: String, default: '' },
})
const edgeFirebase = inject('edgeFirebase')
const state = reactive({ open: false, loading: false, error: '', targets: [], truncated: false })
const rows = computed(() => groupReleaseTargets(state.targets))
const siteName = id => props.sites.find(site => site.name === id)?.title || id
let request = 0
const load = async () => {
  const token = ++request
  state.loading = true
  state.error = ''
  try {
    const result = await readReleaseTargets({ edgeFirebase, organizationDocPath: edgeGlobal.edgeState.organizationDocPath, releaseId: props.releaseId })
    if (token !== request) return
    state.targets = result.targets
    state.truncated = result.truncated
  }
  catch (error) {
    if (token === request) state.error = error?.message || 'Could not load propagation details.'
  }
  finally {
    if (token === request) state.loading = false
  }
}
const toggle = event => {
  state.open = event.target.open
  if (state.open) void load()
}
watch(() => [props.releaseId, props.refreshKey], () => {
  if (state.open) void load()
})
onBeforeUnmount(() => request++)
</script>

<template>
  <details class="rounded-lg border bg-background" @toggle="toggle">
    <summary class="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      Propagation details by site
    </summary>
    <div class="space-y-3 border-t p-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-muted-foreground">
          Document outcomes in Firestore; this does not confirm public-cache delivery.
        </p>
        <edge-shad-button type="button" size="sm" variant="outline" :disabled="state.loading" @click="load">
          <Loader2 v-if="state.loading" class="mr-2 h-3.5 w-3.5 animate-spin" />
          <RefreshCw v-else class="mr-2 h-3.5 w-3.5" /> Refresh
        </edge-shad-button>
      </div>
      <p v-if="state.error" class="text-sm text-destructive" role="alert">{{ state.error }}</p>
      <p v-if="state.loading && !rows.length" class="text-sm text-muted-foreground" role="status">Loading document outcomes…</p>
      <p v-else-if="!rows.length && !state.error" class="text-sm text-muted-foreground">No target records are available yet.</p>
      <p v-if="state.truncated" class="text-sm text-muted-foreground">Showing the first 2,000 target records. Counts below cover only these records; use the release totals for the full outcome.</p>
      <details v-for="site in rows" :key="site.siteId" class="rounded-md border">
        <summary class="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <span class="font-medium">{{ siteName(site.siteId) }}</span>
          <span class="rounded-full border px-2 py-0.5 text-xs" :class="RELEASE_BADGE_CLASSES[site.failed ? 'failed' : site.pending ? 'mixed' : 'current']">
            {{ site.updated }} updated · {{ site.skipped }} skipped · {{ site.failed }} failed · {{ site.pending }} pending
          </span>
        </summary>
        <ul class="max-h-64 divide-y overflow-y-auto border-t">
          <li v-for="target in site.documents" :key="target.path" class="px-3 py-2 text-xs">
            <div class="flex flex-wrap justify-between gap-2">
              <span>{{ target.docId }} · {{ target.collection }}</span>
              <span class="font-medium" :class="target.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'">{{ target.status === 'done' ? 'Updated' : target.status === 'skipped' ? 'Skipped' : target.status === 'failed' ? 'Failed' : 'Pending' }}</span>
            </div>
            <p v-if="target.error" class="mt-1 break-words text-destructive">{{ target.error }}</p>
          </li>
        </ul>
      </details>
    </div>
  </details>
</template>
