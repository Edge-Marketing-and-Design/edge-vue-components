<script setup>
import { Loader2, Rocket, RotateCcw } from 'lucide-vue-next'
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
  releaseCheckIssues,
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
const planIssues = computed(() => releaseCheckIssues(state.plan?.checks))
const progress = computed(() => releaseProgress(state.release))
const rollbackTo = computed(() => rollbackRevision(state.history))
const canaryRollback = computed(() => canaryRollbackPlan(state.history))
const selectedSiteIds = computed(() => (state.scopeMode === 'sites' ? state.siteIds : null))
const canExecute = computed(() => isAdmin.value
  && state.plan
  && !state.plan.blocked
  && !state.plan.activeReleaseRunning
  && (state.plan.checks?.status !== 'breaking' || state.confirmBreaking)
  && !state.executing)

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
  const fallback = revisionItems.value[0]?.name || ''
  state.revision = props.initialRevision === null ? fallback : String(props.initialRevision)
}, { immediate: true })

onBeforeUnmount(stopPolling)

const close = () => emit('update:modelValue', false)
</script>

<template>
  <edge-shad-dialog :model-value="props.modelValue" @update:model-value="emit('update:modelValue', $event)">
    <DialogContent class="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="text-left">
          Block releases
        </DialogTitle>
        <DialogDescription class="text-left">
          Releasing applies a revision to every page that uses this block. Check it first; nothing changes until you release.
        </DialogDescription>
      </DialogHeader>

      <div class="flex gap-2 border-b pb-2" role="tablist">
        <edge-shad-button
          v-for="tab in [{ id: 'release', label: 'Release' }, { id: 'history', label: 'History and sites' }]"
          :key="tab.id"
          type="button"
          size="sm"
          role="tab"
          :aria-selected="state.tab === tab.id"
          :variant="state.tab === tab.id ? 'default' : 'ghost'"
          @click="state.tab = tab.id"
        >
          {{ tab.label }}
        </edge-shad-button>
      </div>

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
              <edge-shad-select v-model="state.revision" name="releaseRevision" label="Revision" :items="revisionItems" placeholder="Choose a revision" />
              <edge-shad-select v-model="state.scopeMode" name="releaseScope" label="Where" :items="scopeItems" />
            </div>
            <edge-shad-select-tags
              v-if="state.scopeMode === 'sites'"
              v-model="state.siteIds"
              name="releaseSites"
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
            <p class="text-sm">
              {{ state.plan.targets.total }} document(s) will be updated:
              <span v-for="(site, index) in state.plan.targets.sites" :key="site.siteId">{{ index ? ', ' : '' }}{{ siteName(site.siteId) }} ({{ site.total }})</span>
            </p>
            <p v-if="state.plan.canary && state.plan.kind !== 'promote'" class="text-sm text-muted-foreground">
              Revision {{ state.plan.canary.revisionNumber }} is in a canary on {{ state.plan.canary.siteIds.map(siteName).join(', ') }}.
            </p>
            <p class="text-sm">
              Checks: <span class="font-medium">{{ state.plan.checks.status }}</span>
              · {{ state.plan.checks.counts.instances }} instance(s), {{ state.plan.checks.counts.rendered }} distinct render(s)
            </p>
            <edge-cms-block-validation-issues v-if="planIssues.length" :issues="planIssues" />
            <Alert v-if="state.plan.activeReleaseRunning" variant="destructive">
              <AlertDescription class="text-sm">
                Another release of this block is still running. Wait for it to finish.
              </AlertDescription>
            </Alert>
            <Alert v-if="state.plan.blocked && state.plan.checks.status !== 'breaking'" variant="destructive">
              <AlertDescription class="text-sm">
                {{ state.plan.blocked }}
              </AlertDescription>
            </Alert>
            <edge-shad-checkbox v-if="state.plan.checks.status === 'breaking'" v-model="state.confirmBreaking" name="confirmBreaking">
              I understand these breaking schema changes and want to release anyway.
            </edge-shad-checkbox>
            <p v-if="!isAdmin" class="text-sm text-muted-foreground">
              Only organization admins can release blocks.
            </p>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="space-y-4 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span>
              Released: <span class="font-medium">revision {{ state.history?.releasedRevision ?? 0 }}</span>
              <template v-if="state.history?.draftRevision !== null && state.history?.draftRevision !== undefined"> · Unreleased draft: revision {{ state.history.draftRevision }}</template>
              <template v-if="state.history?.canary"> · Canary: revision {{ state.history.canary.revisionNumber }} on {{ state.history.canary.siteIds.map(siteName).join(', ') }}</template>
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
            <p v-if="!state.usage?.sites?.length" class="text-muted-foreground">
              No page uses this block yet.
            </p>
            <table v-else class="w-full text-left">
              <thead class="text-xs text-muted-foreground">
                <tr>
                  <th class="py-1">
                    Site
                  </th><th>Drafts</th><th>Published</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="site in state.usage.sites" :key="site.siteId" class="border-t">
                  <td class="py-1">
                    {{ siteName(site.siteId) }}
                  </td>
                  <td>{{ usageLabel(site.drafts) }}</td>
                  <td>{{ usageLabel(site.published) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 class="mb-1 font-medium">
              Recent releases
            </h3>
            <p v-if="!state.history?.releases?.length" class="text-muted-foreground">
              This block hasn't been released through the Hub yet.
            </p>
            <ul v-else class="space-y-2">
              <li v-for="item in state.history.releases" :key="item.releaseId" class="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span>
                  <span class="font-medium">{{ describeRelease(item) }}</span>
                  · {{ describeScope(item.scope, item.kind) }}
                  · {{ RELEASE_STATUS_LABELS[item.status] || item.status }}<template v-if="item.implicit"> (direct edit, unchecked)</template>
                  <span class="block text-xs text-muted-foreground">{{ item.createdAt }} · {{ releaseProgress(item).done }} updated, {{ releaseProgress(item).failed }} failed</span>
                </span>
                <edge-shad-button v-if="isAdmin && canRetryRelease(item)" type="button" size="sm" variant="outline" :disabled="state.retrying" @click="retry(item.releaseId)">
                  Retry
                </edge-shad-button>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button type="button" variant="outline" @click="close">
          Close
        </edge-shad-button>
        <edge-shad-button v-if="state.tab === 'release' && !state.release && isAdmin" type="button" :disabled="!canExecute" @click="runRelease">
          <Loader2 v-if="state.executing" class="mr-2 h-4 w-4 animate-spin" />
          <Rocket v-else class="mr-2 h-4 w-4" />
          Release
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>
