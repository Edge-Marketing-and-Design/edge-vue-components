<script setup>
import { CheckCircle2, Loader2, RefreshCw, Rocket, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { groupedReleaseIssues, releaseCanExecute, releaseComparisonRevision, revisionMatch, RELEASE_BADGE_CLASSES } from '../../lib/cmsBlockReleasePresentation'
import {
  RELEASE_STATUS_LABELS,
  canRetryRelease,
  canaryRollbackPlan,
  describeRelease,
  describeScope,
  dryRunBlockRelease,
  executeBlockRelease,
  isReleaseFinished,
  loadBlockReleaseHistory,
  loadBlockRevisionUsage,
  readBlockRelease,
  releasableRevisionItems,
  releaseProgress,
  retryBlockRelease,
  rollbackRevision,
} from '../../lib/cmsBlockReleaseClient'

// Releases a library block revision to pages: dry run and checks, then a
// tracked release with progress, plus history, per-site revisions, retry and
// rollback. The server enforces every permission; the UI only hides actions
// the viewer can't take.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  blockId: { type: String, required: true },
  // Opens the release tab with this revision selected; otherwise History.
  initialRevision: { type: Number, default: null },
})
const emit = defineEmits(['update:modelValue', 'released'])

const edgeFirebase = inject('edgeFirebase')
const POLL_MS = 2000

const state = reactive({
  tab: 'release',
  history: null,
  usage: null,
  loading: false,
  error: '',
  revision: '',
  scopeMode: 'all',
  siteIds: [],
  plan: null,
  planning: false,
  confirmBreaking: false,
  executing: false,
  release: null,
  retrying: false,
})

const orgId = computed(() => edgeGlobal.edgeState.currentOrganization)
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const siteItems = computed(() => Object.values(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {})
  .filter(site => site?.docId)
  .map(site => ({ title: site.name || site.docId, name: site.docId })))
const siteName = siteId => siteItems.value.find(site => site.name === siteId)?.title || siteId
const revisionItems = computed(() => releasableRevisionItems(state.history))
const scopeItems = [{ title: 'All sites', name: 'all' }, { title: 'Selected sites (canary)', name: 'sites' }]
const issueGroups = computed(() => groupedReleaseIssues(state.plan?.checks))
const comparisonRevision = computed(() => state.revision === '' ? releaseComparisonRevision(state.history) : Number(state.revision))
const usageSites = computed(() => {
  const used = new Map((state.usage?.sites || []).map(site => [site.siteId, site]))
  for (const site of siteItems.value)
    if (!used.has(site.name)) used.set(site.name, { siteId: site.name, drafts: {}, published: {}, documents: [] })
  return [...used.values()].sort((a, b) => siteName(a.siteId).localeCompare(siteName(b.siteId)))
})
const sitesAtRevision = computed(() => usageSites.value.filter(site => {
  const total = {}
  for (const bucket of [site.drafts, site.published])
    for (const [key, count] of Object.entries(bucket || {})) total[key] = (total[key] || 0) + count
  return revisionMatch(total, comparisonRevision.value).status === 'current'
}).length)
const usageCount = bucket => Object.values(bucket || {}).reduce((total, count) => total + count, 0)
const plannedDocuments = siteId => (state.plan?.targets?.documents || []).filter(doc => doc.siteId === siteId)
const documentLabel = collection => ({ pages: 'Draft page', published: 'Published page', posts: 'Draft post', published_posts: 'Published post' }[collection] || collection)
const checksTruncated = computed(() => {
  const checks = state.plan?.checks
  return checks && (checks.detailsTruncated || ['errors', 'warnings', 'instanceFailures', 'breaking'].some(key => (checks.counts?.[key] || 0) > (checks[key]?.length || 0)))
})
const progress = computed(() => releaseProgress(state.release))
const rollbackTo = computed(() => rollbackRevision(state.history))
const canaryRollback = computed(() => canaryRollbackPlan(state.history))
const selectedSiteIds = computed(() => (state.scopeMode === 'sites' ? state.siteIds : null))
const canExecute = computed(() => releaseCanExecute(state.plan, { isAdmin: isAdmin.value, confirmBreaking: state.confirmBreaking, executing: state.executing }))
const checkStatusLabel = computed(() => {
  const plan = state.plan
  if (plan?.checks.status === 'passed') return 'Checks passed'
  if (plan?.checks.status === 'blocked') return plan.blocked ? 'Release blocked' : 'Validation issues reported'
  if (plan?.checks.status === 'breaking') return plan.breakingConfirmationRequired ? 'Breaking changes need confirmation' : 'Breaking changes reported'
  return 'Checks passed with warnings'
})

const errorMessage = error => String(error?.message || error || 'Something went wrong.')

const loadHistory = async () => {
  state.loading = true
  state.error = ''
  try {
    const [history, usage] = await Promise.all([
      loadBlockReleaseHistory({ edgeFirebase, orgId: orgId.value, blockId: props.blockId }),
      loadBlockRevisionUsage({ edgeFirebase, orgId: orgId.value, blockId: props.blockId }),
    ])
    state.history = history
    state.usage = usage
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.loading = false
  }
}

const resetPlan = () => {
  state.plan = null
  state.confirmBreaking = false
}

watch(() => [state.revision, state.scopeMode, state.siteIds.join(',')], resetPlan)

const runDryRun = async () => {
  resetPlan()
  state.planning = true
  state.error = ''
  try {
    state.plan = await dryRunBlockRelease({
      edgeFirebase,
      orgId: orgId.value,
      blockId: props.blockId,
      revisionNumber: Number(state.revision),
      siteIds: selectedSiteIds.value,
    })
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.planning = false
  }
}

let pollTimer = null
const stopPolling = () => {
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = null
}
const pollRelease = async (releaseId) => {
  stopPolling()
  const release = await readBlockRelease({ edgeFirebase, organizationDocPath: edgeGlobal.edgeState.organizationDocPath, releaseId })
  if (release)
    state.release = { ...release, releaseId }
  if (release && isReleaseFinished(release)) {
    emit('released', { releaseId, status: release.status })
    await loadHistory()
    return
  }
  if (props.modelValue)
    pollTimer = setTimeout(() => pollRelease(releaseId), POLL_MS)
}

const runRelease = async () => {
  if (!canExecute.value)
    return
  state.executing = true
  state.error = ''
  try {
    const result = await executeBlockRelease({
      edgeFirebase,
      orgId: orgId.value,
      blockId: props.blockId,
      revisionNumber: Number(state.revision),
      siteIds: selectedSiteIds.value,
      checksum: state.plan.checksum,
      confirmBreaking: state.confirmBreaking,
    })
    state.release = { releaseId: result.releaseId, status: result.status, counts: { planned: result.targets?.total || 0 } }
    resetPlan()
    await pollRelease(result.releaseId)
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.executing = false
  }
}

const retry = async (releaseId) => {
  state.retrying = true
  state.error = ''
  try {
    await retryBlockRelease({ edgeFirebase, orgId: orgId.value, releaseId })
    state.tab = 'release'
    await pollRelease(releaseId)
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.retrying = false
  }
}

const startRollback = () => {
  if (rollbackTo.value === null)
    return
  state.release = null
  state.revision = String(rollbackTo.value)
  state.scopeMode = 'all'
  state.tab = 'release'
}

// Sets up the release that undoes the live canary; it still runs through
// Check release.
const startCanaryRollback = () => {
  const plan = canaryRollback.value
  if (!plan)
    return
  state.release = null
  state.revision = String(plan.revisionNumber)
  state.scopeMode = 'sites'
  state.siteIds = plan.siteIds
  state.tab = 'release'
}

const startCanaryPromotion = () => {
  if (!state.history?.canary) return
  state.release = null
  state.revision = String(state.history.canary.revisionNumber)
  state.scopeMode = 'all'
  state.siteIds = []
  resetPlan()
  state.tab = 'release'
}

const usageLabel = (bucket) => {
  const entries = Object.entries(bucket || {})
  if (!entries.length)
    return 'none'
  return entries
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([revision, count]) => `${revision === 'unversioned' ? 'unversioned' : `rev ${revision}`}: ${count}`)
    .join(', ')
}

watch(() => props.modelValue, async (open) => {
  if (!open) {
    stopPolling()
    return
  }
  resetPlan()
  state.release = null
  state.error = ''
  state.scopeMode = 'all'
  state.siteIds = []
  state.tab = props.initialRevision === null ? 'history' : 'release'
  await loadHistory()
  const preferred = releaseComparisonRevision(state.history)
  const fallback = revisionItems.value.find(item => item.name === String(preferred))?.name || revisionItems.value[0]?.name || ''
  state.revision = props.initialRevision === null ? fallback : String(props.initialRevision)
}, { immediate: true })

onBeforeUnmount(stopPolling)

const close = () => emit('update:modelValue', false)
</script>

<template>
  <edge-shad-dialog :model-value="props.modelValue" @update:model-value="emit('update:modelValue', $event)">
    <DialogContent class="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle class="text-left">
          Block releases
        </DialogTitle>
        <DialogDescription class="text-left">
          Releasing applies a revision to every page that uses this block. Check it first; nothing changes until you release.
        </DialogDescription>
      </DialogHeader>

      <div class="flex shrink-0 gap-2 border-b pb-2" aria-label="Release views">
        <edge-shad-button
          v-for="tab in [{ id: 'release', label: 'Release' }, { id: 'history', label: 'History and sites' }]"
          :key="tab.id"
          type="button"
          size="sm"
          :aria-pressed="state.tab === tab.id"
          :variant="state.tab === tab.id ? 'default' : 'ghost'"
          @click="state.tab = tab.id"
        >
          {{ tab.label }}
        </edge-shad-button>
      </div>

      <div class="min-h-0 space-y-4 overflow-y-auto px-1" tabindex="0" aria-label="Release report">
      <Alert v-if="state.error" variant="destructive" role="alert">
        <AlertTitle>That didn't work</AlertTitle>
        <AlertDescription class="text-sm">
          {{ state.error }}
        </AlertDescription>
      </Alert>

      <div v-if="state.loading && !state.history" class="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 class="h-4 w-4 animate-spin" /> Loading releases...
      </div>

      <template v-else-if="state.tab === 'release'">
        <div v-if="state.release" class="space-y-3" aria-live="polite">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium">{{ RELEASE_STATUS_LABELS[state.release.status] || state.release.status }}</span>
            <span class="text-muted-foreground">
              {{ progress.processed }} of {{ progress.planned }} documents · {{ progress.done }} updated, {{ progress.skipped }} already current<template v-if="progress.failed">, {{ progress.failed }} failed</template>
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full bg-primary transition-all" :style="{ width: `${progress.percent}%` }" />
          </div>
          <p v-if="state.release.status === 'superseded'" class="text-sm text-muted-foreground">
            A newer release of this block took over, so this one stopped. Pages hold the newer revision.
          </p>
          <div v-if="progress.finished && state.history?.canary" class="rounded-lg border p-4" :class="RELEASE_BADGE_CLASSES.mixed">
            <p class="font-medium">Canary—not released everywhere</p>
            <p class="mt-1 text-sm">Revision {{ state.history.canary.revisionNumber }} is assigned to {{ state.history.canary.siteIds.length }} canary site(s). Other sites keep their previous revision. Check site outcomes below for any failed documents.</p>
            <edge-shad-button v-if="isAdmin" type="button" size="sm" class="mt-3" @click="startCanaryPromotion">Release to all sites…</edge-shad-button>
          </div>
          <edge-cms-block-release-targets :key="state.release.releaseId" :release-id="state.release.releaseId" :sites="siteItems" :refresh-key="String(state.release.updatedAt || state.release.status)" />
          <div v-if="isAdmin && canRetryRelease(state.release)" class="flex justify-end">
            <edge-shad-button type="button" :disabled="state.retrying" @click="retry(state.release.releaseId)">
              <Loader2 v-if="state.retrying" class="mr-2 h-4 w-4 animate-spin" />
              Retry failed documents
            </edge-shad-button>
          </div>
          <div v-if="progress.finished" class="flex justify-end">
            <edge-shad-button type="button" variant="outline" @click="state.release = null">
              Start another release
            </edge-shad-button>
          </div>
        </div>

        <div v-else class="space-y-4">
          <p v-if="!revisionItems.length" class="text-sm text-muted-foreground">
            This block has no revisions to release yet. Save a change in the Block Editor first.
          </p>
          <template v-else>
            <div class="grid gap-3 md:grid-cols-2">
              <edge-shad-select v-model="state.revision" label="Revision" :items="revisionItems" placeholder="Choose a revision" />
              <edge-shad-select v-model="state.scopeMode" label="Where" :items="scopeItems" />
            </div>
            <edge-shad-select-tags
              v-if="state.scopeMode === 'sites'"
              v-model="state.siteIds"
              label="Canary sites"
              :items="siteItems"
              item-title="title"
              item-value="name"
              :allow-additions="false"
              placeholder="Choose sites"
            />
            <div class="flex justify-end">
              <edge-shad-button
                type="button"
                variant="outline"
                :disabled="state.planning || !state.revision || (state.scopeMode === 'sites' && !state.siteIds.length)"
                @click="runDryRun"
              >
                <Loader2 v-if="state.planning" class="mr-2 h-4 w-4 animate-spin" />
                Check release
              </edge-shad-button>
            </div>
          </template>

          <div v-if="state.plan" class="space-y-3 rounded-md border p-3" aria-live="polite">
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="font-medium">{{ describeRelease(state.plan) }}: {{ describeScope(state.plan.scope, state.plan.kind) }}</span>
              <span class="text-muted-foreground">Released now: revision {{ state.plan.releasedRevision }}</span>
            </div>
            <dl class="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 sm:grid-cols-4">
              <div><dt class="text-xs text-muted-foreground">Affected sites</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{{ state.plan.targets.sites.length }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">Unique pages</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{{ state.plan.targets.pages ?? '—' }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">Unique posts</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{{ state.plan.targets.posts ?? '—' }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">Documents</dt><dd class="mt-1 text-2xl font-semibold tabular-nums">{{ state.plan.targets.total }}</dd></div>
            </dl>
            <p class="text-xs text-muted-foreground">A page or post can have both a draft and a published document. Documents are the propagation targets.</p>
            <details class="rounded-lg border">
              <summary class="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">View affected sites and pages</summary>
              <div class="space-y-2 border-t p-3">
                <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-3 text-xs text-muted-foreground"><span>Site · unique pages/posts</span><span>Draft docs</span><span>Published docs</span></div>
                <details v-for="site in state.plan.targets.sites" :key="site.siteId" class="rounded-md border">
                  <summary class="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <span class="min-w-0"><span class="block truncate font-medium">{{ siteName(site.siteId) }}</span><span class="text-xs text-muted-foreground">{{ site.pages ?? '—' }} pages · {{ site.posts ?? '—' }} posts</span></span>
                    <span class="tabular-nums">{{ (site.collections.pages || 0) + (site.collections.posts || 0) }}</span><span class="tabular-nums">{{ (site.collections.published || 0) + (site.collections.published_posts || 0) }}</span>
                  </summary>
                  <ul class="max-h-56 divide-y overflow-y-auto border-t text-xs">
                    <li v-for="doc in plannedDocuments(site.siteId)" :key="doc.path" class="flex flex-wrap justify-between gap-2 px-3 py-2"><span>{{ doc.docId }}</span><span class="text-muted-foreground">{{ documentLabel(doc.collection) }}</span></li>
                    <li v-if="!plannedDocuments(site.siteId).length" class="px-3 py-2 text-muted-foreground">Document details are unavailable in this report.</li>
                  </ul>
                </details>
                <p v-if="state.plan.targets.detailsTruncated" class="text-xs text-muted-foreground">Document details show the first 2,000 targets. Summary counts include all targets.</p>
              </div>
            </details>
            <p v-if="state.plan.canary && state.plan.kind !== 'promote'" class="text-sm text-muted-foreground">
              Revision {{ state.plan.canary.revisionNumber }} is assigned to {{ state.plan.canary.siteIds.length }} canary site(s). See History / sites for their revisions.
            </p>
            <div class="flex items-start gap-3 rounded-lg border p-3" :class="RELEASE_BADGE_CLASSES[state.plan.checks.status === 'passed' ? 'current' : state.plan.checks.status === 'blocked' ? 'failed' : 'mixed']">
              <CheckCircle2 v-if="state.plan.checks.status === 'passed'" class="mt-0.5 h-5 w-5 shrink-0" />
              <TriangleAlert v-else class="mt-0.5 h-5 w-5 shrink-0" />
              <div><p class="text-sm font-medium">{{ checkStatusLabel }}</p><p class="mt-1 text-xs">{{ state.plan.checks.counts.instances }} instances · {{ state.plan.checks.counts.rendered }} distinct renders<template v-if="issueGroups.length"> · {{ issueGroups.length }} reported issue types</template></p></div>
            </div>
            <div v-if="issueGroups.length" class="space-y-2">
              <details v-for="group in issueGroups" :key="group.key" class="rounded-lg border">
                <summary class="flex cursor-pointer items-start gap-3 px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium" :class="RELEASE_BADGE_CLASSES[group.severity === 'error' ? 'failed' : 'mixed']">{{ group.severity === 'error' ? 'Blocking' : group.severity === 'breaking' ? 'Breaking' : 'Warning' }}</span>
                  <span class="min-w-0 text-sm"><span class="block font-medium">{{ group.message }}</span><span class="mt-1 block text-xs text-muted-foreground">{{ group.instanceCount ? `${group.instanceCount} reported instances across ${group.siteCount} sites` : 'Block definition' }} · Show details</span></span>
                </summary>
                <div class="border-t p-3 text-xs"><code class="text-muted-foreground">{{ group.code }}</code><ul class="mt-2 max-h-52 space-y-2 overflow-y-auto"><li v-for="(location, index) in group.locations" :key="index" class="break-words"><span v-if="location.siteId" class="font-medium">{{ siteName(location.siteId) }} · </span>{{ location.path.split('/sites/')[1]?.split('/').slice(1).join('/') || location.path }}<template v-if="location.instanceId"> · instance {{ location.instanceId }}</template><template v-if="location.field"> · {{ location.field }}</template></li></ul></div>
              </details>
              <p v-if="checksTruncated" class="text-xs text-muted-foreground">The server caps detailed findings. Issue groups show the reported sample; the check totals above cover the full check.</p>
            </div>
            <Alert v-if="state.plan.activeReleaseRunning" variant="destructive">
              <AlertDescription class="text-sm">
                Another release of this block is still running. Wait for it to finish.
              </AlertDescription>
            </Alert>
            <Alert v-if="state.plan.blocked && !state.plan.breakingConfirmationRequired" variant="destructive">
              <AlertDescription class="text-sm">
                {{ state.plan.blocked }}
              </AlertDescription>
            </Alert>
            <label v-if="state.plan.breakingConfirmationRequired" class="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"><input v-model="state.confirmBreaking" type="checkbox" class="mt-1 accent-current">I understand these breaking schema changes and want to release anyway.</label>
            <p v-if="!isAdmin" class="text-sm text-muted-foreground">
              Only organization admins can release blocks.
            </p>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="space-y-4 text-sm">
          <div v-if="state.history?.canary" class="rounded-lg border p-4" :class="RELEASE_BADGE_CLASSES.mixed">
            <p class="flex items-center gap-2 font-medium"><TriangleAlert class="h-4 w-4" />Canary—not released everywhere</p>
            <p class="mt-1">Revision {{ state.history.canary.revisionNumber }} is assigned to {{ state.history.canary.siteIds.length }} canary site(s). The global release remains revision {{ state.history.releasedRevision }}.</p>
            <edge-shad-button v-if="isAdmin" type="button" size="sm" class="mt-3" @click="startCanaryPromotion">Release to all sites…</edge-shad-button>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span>
              Released: <span class="font-medium">revision {{ state.history?.releasedRevision ?? 0 }}</span>
              <template v-if="state.history?.draftRevision !== null && state.history?.draftRevision !== undefined"> · Unreleased draft: revision {{ state.history.draftRevision }}</template>
            </span>
            <div class="flex flex-wrap gap-2">
              <edge-shad-button v-if="isAdmin && canaryRollback" type="button" size="sm" variant="outline" @click="startCanaryRollback">
                <RotateCcw class="mr-2 h-4 w-4" /> Roll back canary
              </edge-shad-button>
              <edge-shad-button v-if="isAdmin && rollbackTo !== null" type="button" size="sm" variant="outline" @click="startRollback">
                <RotateCcw class="mr-2 h-4 w-4" /> Roll back to revision {{ rollbackTo }}
              </edge-shad-button>
            </div>
          </div>

          <div>
            <h3 class="mb-1 font-medium">
              Revisions on each site
            </h3>
            <div class="my-3 flex flex-wrap items-end justify-between gap-3">
              <div class="min-w-52"><edge-shad-select v-model="state.revision" label="Compare against" :items="revisionItems" placeholder="Choose a revision" /></div>
              <div class="flex items-center gap-3"><span class="text-xs text-muted-foreground">{{ sitesAtRevision }} sites fully match revision {{ comparisonRevision }}</span><edge-shad-button type="button" size="sm" variant="outline" :disabled="state.loading" @click="loadHistory"><RefreshCw class="mr-2 h-3.5 w-3.5" />Refresh</edge-shad-button></div>
            </div>
            <p class="mb-3 text-xs text-muted-foreground">Counts are block instances, split between draft and published documents. Green matches the selected revision; amber means different, mixed or unversioned.</p>
            <p v-if="!usageSites.length" class="text-muted-foreground">
              No page uses this block yet.
            </p>
            <div v-else class="space-y-2">
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 text-xs text-muted-foreground"><span>Site</span><span>Draft instances</span><span>Published instances</span></div>
              <details v-for="site in usageSites" :key="site.siteId" class="rounded-lg border">
                <summary class="grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span class="min-w-0 font-medium">{{ siteName(site.siteId) }}</span>
                  <span v-for="bucket in [site.drafts, site.published]" :key="bucket === site.drafts ? 'draft' : 'published'" class="min-w-0"><span class="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium" :class="RELEASE_BADGE_CLASSES[revisionMatch(bucket, comparisonRevision).status]">{{ revisionMatch(bucket, comparisonRevision).label }}</span><span class="mt-1 block text-xs text-muted-foreground">{{ revisionMatch(bucket, comparisonRevision).matched }}/{{ usageCount(bucket) }} match · {{ usageLabel(bucket) }}</span></span>
                </summary>
                <div class="max-h-64 space-y-2 overflow-y-auto border-t p-3">
                  <p v-if="!site.documents?.length" class="text-xs text-muted-foreground">{{ usageCount(site.drafts) + usageCount(site.published) ? 'Page details are unavailable in this report.' : 'This block is not used on this site.' }}</p>
                  <div v-for="doc in site.documents || []" :key="doc.path" class="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{{ doc.name || doc.docId }} · {{ documentLabel(doc.collection) }}</span><span class="rounded-full border px-2 py-0.5" :class="RELEASE_BADGE_CLASSES[revisionMatch(doc.revisions, comparisonRevision).status]">{{ usageLabel(doc.revisions) }}</span></div>
                  <p v-if="site.detailsTruncated" class="text-xs text-muted-foreground">Showing the first 200 documents for this site. Revision totals above include every instance.</p>
                </div>
              </details>
            </div>
          </div>

          <div>
            <h3 class="mb-1 font-medium">
              Recent releases
            </h3>
            <p v-if="!state.history?.releases?.length" class="text-muted-foreground">
              This block hasn't been released through the Hub yet.
            </p>
            <ul v-else class="space-y-2">
              <li v-for="item in state.history.releases" :key="item.releaseId" class="space-y-3 rounded-lg border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span class="font-medium">{{ describeRelease(item) }}</span>
                  · {{ describeScope(item.scope, item.kind) }}
                  · {{ RELEASE_STATUS_LABELS[item.status] || item.status }}<template v-if="item.implicit"> (direct edit, unchecked)</template>
                  <span class="block text-xs text-muted-foreground">{{ item.createdAt }} · {{ releaseProgress(item).done }} updated, {{ releaseProgress(item).failed }} failed</span>
                </span>
                <edge-shad-button v-if="isAdmin && canRetryRelease(item)" type="button" size="sm" variant="outline" :disabled="state.retrying" @click="retry(item.releaseId)">
                  Retry
                </edge-shad-button>
                </div>
                <edge-cms-block-release-targets :release-id="item.releaseId" :sites="siteItems" />
              </li>
            </ul>
          </div>
        </div>
      </template>
      </div>

      <DialogFooter class="flex shrink-0 justify-between border-t pt-4">
        <edge-shad-button type="button" variant="outline" @click="close">
          Close
        </edge-shad-button>
        <edge-shad-button v-if="state.tab === 'release' && !state.release && isAdmin" type="button" :disabled="!canExecute" @click="runRelease">
          <Loader2 v-if="state.executing" class="mr-2 h-4 w-4 animate-spin" />
          <Rocket v-else class="mr-2 h-4 w-4" />
          {{ state.plan?.kind === 'promote' ? 'Release to all sites' : 'Release' }}
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
