<script setup>
import { CheckCircle2, ChevronDown, ExternalLink, History, Loader2, RefreshCw, Rocket, SearchCheck, TriangleAlert } from 'lucide-vue-next'
import { RELEASE_STATUS_LABELS, describeRelease, describeScope, dryRunBlockRelease, executeBlockRelease, readBlockRelease } from '../../lib/cmsBlockReleaseClient'
import { RELEASE_BADGE_CLASSES, groupedReleaseIssues } from '../../lib/cmsBlockReleasePresentation'
import { ROW_STATUS_LABELS, isReadyStatus, pendingReleaseBlocks, pendingSignature, rowProgress, rowStatus, runLimited, summarizeRows } from '../../lib/cmsBlockReleaseBatch'

// Every library block with a pending revision on one screen: check them and
// release them together or one at a time. Each block still has its own dry
// run and checksum-checked release on the server.
const edgeFirebase = inject('edgeFirebase')
const router = useRouter()

const CHECK_CONCURRENCY = 4
const RELEASE_CONCURRENCY = 3
const POLL_MS = 2000

const state = reactive({
  rows: {},
  selected: [],
  expanded: [],
  checking: false,
  releasing: false,
  dialogBlockId: '',
  dialogOpen: false,
})

const orgId = computed(() => edgeGlobal.edgeState.currentOrganization)
const blocksPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/blocks`)
const blocks = computed(() => edgeFirebase.data?.[blocksPath.value] || {})
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)

const rowOf = (docId) => {
  if (!state.rows[docId])
    state.rows[docId] = { plan: null, planning: false, error: '', confirmBreaking: false, executing: false, release: null, signature: '' }
  return state.rows[docId]
}

// Pending blocks plus any released from this screen, so their outcome stays
// visible until the list is cleared.
const items = computed(() => {
  const pending = pendingReleaseBlocks(blocks.value)
  const listed = new Set(pending.map(item => item.docId))
  const released = Object.entries(state.rows)
    .filter(([docId, row]) => row.release && !listed.has(docId) && blocks.value[docId])
    .map(([docId, row]) => ({ docId, name: blocks.value[docId]?.name || docId, kind: 'done', revisionNumber: row.release.revisionNumber ?? null, releasedRevision: blocks.value[docId]?.releasedRevision ?? 0, label: 'Released from this screen' }))
  return [...pending, ...released]
})

const statusOf = docId => rowStatus(state.rows[docId] || {}, { isAdmin: isAdmin.value })
const statuses = computed(() => items.value.map(item => statusOf(item.docId)))
const summary = computed(() => summarizeRows(statuses.value))

const checkable = item => item.kind === 'draft' || item.kind === 'canary'
const selectableItems = computed(() => items.value.filter(item => checkable(item) && !['checking', 'releasing'].includes(statusOf(item.docId))))
const selectedItems = computed(() => selectableItems.value.filter(item => state.selected.includes(item.docId)))
const readySelected = computed(() => selectedItems.value.filter(item => isReadyStatus(statusOf(item.docId))))
const allSelected = computed(() => selectableItems.value.length > 0 && selectedItems.value.length === selectableItems.value.length)

const toggleAll = (checked) => {
  state.selected = checked ? selectableItems.value.map(item => item.docId) : []
}
const toggleOne = (docId, checked) => {
  state.selected = checked ? [...new Set([...state.selected, docId])] : state.selected.filter(id => id !== docId)
}
const toggleExpanded = (docId) => {
  state.expanded = state.expanded.includes(docId) ? state.expanded.filter(id => id !== docId) : [...state.expanded, docId]
}

// A check made before the block moved on (a new draft, another release) is
// stale; drop it rather than release the old plan.
watch(() => Object.entries(blocks.value).map(([docId, block]) => `${docId}:${pendingSignature(block)}`).join('|'), () => {
  for (const [docId, row] of Object.entries(state.rows)) {
    if (row.plan && row.signature !== pendingSignature(blocks.value[docId])) {
      row.plan = null
      row.confirmBreaking = false
    }
  }
})

const errorMessage = error => String(error?.message || error || 'Something went wrong.')

const checkOne = async (item) => {
  const row = rowOf(item.docId)
  row.planning = true
  row.error = ''
  row.plan = null
  row.confirmBreaking = false
  row.release = null
  try {
    const signature = pendingSignature(blocks.value[item.docId])
    row.plan = await dryRunBlockRelease({ edgeFirebase, orgId: orgId.value, blockId: item.docId, revisionNumber: item.revisionNumber })
    row.signature = signature
  }
  catch (error) {
    row.error = errorMessage(error)
  }
  finally {
    row.planning = false
  }
}

const checkSelected = async () => {
  if (state.checking || !selectedItems.value.length)
    return
  state.checking = true
  try {
    await runLimited(selectedItems.value, CHECK_CONCURRENCY, checkOne)
  }
  finally {
    state.checking = false
  }
}

let pollTimer = null
const stopPolling = () => {
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = null
}
const pollReleases = async () => {
  stopPolling()
  const running = Object.values(state.rows).filter(row => row.release && rowStatus(row) === 'releasing')
  await Promise.all(running.map(async (row) => {
    const release = await readBlockRelease({ edgeFirebase, organizationDocPath: edgeGlobal.edgeState.organizationDocPath, releaseId: row.release.releaseId })
    if (release)
      row.release = { ...release, releaseId: row.release.releaseId }
  }))
  if (Object.values(state.rows).some(row => row.release && rowStatus(row) === 'releasing'))
    pollTimer = setTimeout(pollReleases, POLL_MS)
}

const releaseOne = async (item) => {
  const row = rowOf(item.docId)
  if (!isAdmin.value || !isReadyStatus(statusOf(item.docId)))
    return
  const revisionNumber = row.plan.revisionNumber
  row.executing = true
  row.error = ''
  try {
    const result = await executeBlockRelease({
      edgeFirebase,
      orgId: orgId.value,
      blockId: item.docId,
      revisionNumber,
      checksum: row.plan.checksum,
      confirmBreaking: row.confirmBreaking,
    })
    row.release = { releaseId: result.releaseId, status: result.status, revisionNumber, counts: { planned: result.targets?.total || 0 } }
    row.plan = null
    state.selected = state.selected.filter(id => id !== item.docId)
  }
  catch (error) {
    // The server refuses a stale check; ask for a new one.
    row.error = errorMessage(error)
    row.plan = null
  }
  finally {
    row.executing = false
  }
}

const startReleases = async (list) => {
  if (state.releasing || !list.length)
    return
  state.releasing = true
  try {
    await runLimited(list, RELEASE_CONCURRENCY, releaseOne)
    await pollReleases()
  }
  finally {
    state.releasing = false
  }
}

const releaseSelected = () => startReleases(readySelected.value)
const releaseSingle = item => startReleases([item])

const clearFinished = () => {
  for (const [docId, row] of Object.entries(state.rows)) {
    if (row.release && rowStatus(row) !== 'releasing')
      delete state.rows[docId]
  }
}
const hasFinished = computed(() => Object.values(state.rows).some(row => row.release && rowStatus(row) !== 'releasing'))

const openHistory = (docId) => {
  state.dialogBlockId = docId
  state.dialogOpen = true
}

const STATUS_CLASSES = {
  'ready': RELEASE_BADGE_CLASSES.current,
  'released': RELEASE_BADGE_CLASSES.current,
  'ready-with-warnings': RELEASE_BADGE_CLASSES.mixed,
  'needs-confirmation': RELEASE_BADGE_CLASSES.mixed,
  'busy': RELEASE_BADGE_CLASSES.mixed,
  'checked': RELEASE_BADGE_CLASSES.mixed,
  'blocked': RELEASE_BADGE_CLASSES.failed,
  'error': RELEASE_BADGE_CLASSES.failed,
  'release-problem': RELEASE_BADGE_CLASSES.failed,
}
const statusClass = status => STATUS_CLASSES[status] || RELEASE_BADGE_CLASSES.unused
const issueGroupsOf = docId => groupedReleaseIssues(state.rows[docId]?.plan?.checks)
const progressOf = docId => rowProgress(state.rows[docId])

onMounted(async () => {
  await edgeFirebase.startSnapshot(blocksPath.value)
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/sites`)
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4 md:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          Block revisions
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
          Library blocks with changes that aren't on pages yet. Check them, then release them together or one at a time. Each block is checked and released on its own, so one problem never holds up the rest.
        </p>
      </div>
      <edge-shad-button type="button" variant="outline" @click="router.push('/app/dashboard/blocks')">
        All blocks
      </edge-shad-button>
    </div>

    <div v-if="!items.length" class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <CheckCircle2 class="h-8 w-8 text-emerald-600" />
      <p class="font-medium">
        Nothing to release
      </p>
      <p class="text-sm text-muted-foreground">
        Every library block's latest revision is released.
      </p>
    </div>

    <template v-else>
      <div class="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 p-3 backdrop-blur" aria-live="polite">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox :model-value="allSelected" :disabled="!selectableItems.length" aria-label="Select all pending blocks" @update:model-value="toggleAll($event === true)" />
          {{ selectedItems.length }} of {{ selectableItems.length }} selected
        </label>
        <span class="text-sm text-muted-foreground">
          {{ items.length }} pending<template v-if="summary.ready"> · {{ summary.ready }} ready</template><template v-if="summary.attention"> · {{ summary.attention }} need attention</template>
        </span>
        <div class="ml-auto flex flex-wrap gap-2">
          <edge-shad-button v-if="hasFinished" type="button" size="sm" variant="ghost" @click="clearFinished">
            Clear released
          </edge-shad-button>
          <edge-shad-button type="button" size="sm" variant="outline" :disabled="state.checking || state.releasing || !selectedItems.length" @click="checkSelected">
            <Loader2 v-if="state.checking" class="mr-2 h-4 w-4 animate-spin" />
            <SearchCheck v-else class="mr-2 h-4 w-4" />
            Check selected
          </edge-shad-button>
          <edge-shad-button v-if="isAdmin" type="button" size="sm" :disabled="state.checking || state.releasing || !readySelected.length" @click="releaseSelected">
            <Loader2 v-if="state.releasing" class="mr-2 h-4 w-4 animate-spin" />
            <Rocket v-else class="mr-2 h-4 w-4" />
            Release {{ readySelected.length || '' }} ready
          </edge-shad-button>
        </div>
      </div>
      <p v-if="!isAdmin" class="text-sm text-muted-foreground">
        You can check revisions. Only organization admins can release blocks.
      </p>

      <ul class="space-y-2">
        <li v-for="item in items" :key="item.docId" class="rounded-lg border">
          <div class="flex flex-wrap items-center gap-3 p-3">
            <Checkbox
              :model-value="state.selected.includes(item.docId)"
              :disabled="!selectableItems.some(entry => entry.docId === item.docId)"
              :aria-label="`Select ${item.name}`"
              @update:model-value="toggleOne(item.docId, $event === true)"
            />
            <button type="button" class="min-w-0 flex-1 text-left" :aria-expanded="state.expanded.includes(item.docId)" @click="toggleExpanded(item.docId)">
              <span class="flex items-center gap-2">
                <ChevronDown class="h-4 w-4 shrink-0 transition-transform" :class="state.expanded.includes(item.docId) ? '' : '-rotate-90'" />
                <span class="truncate font-medium">{{ item.name }}</span>
              </span>
              <span class="mt-0.5 block pl-6 text-xs text-muted-foreground">
                {{ item.label }}<template v-if="item.revisionNumber !== null"> · revision {{ item.revisionNumber }}</template> · released: revision {{ item.releasedRevision }}<template v-if="state.rows[item.docId]?.plan"> · {{ state.rows[item.docId].plan.targets.total }} documents on {{ state.rows[item.docId].plan.targets.sites.length }} site(s)</template>
              </span>
            </button>
            <span class="rounded-full border px-2 py-0.5 text-xs font-medium" :class="statusClass(statusOf(item.docId))">
              <Loader2 v-if="['checking', 'releasing'].includes(statusOf(item.docId))" class="mr-1 inline h-3 w-3 animate-spin" />
              {{ item.kind === 'release' && !state.rows[item.docId]?.release ? item.label : ROW_STATUS_LABELS[statusOf(item.docId)] }}
            </span>
            <div class="flex gap-1">
              <edge-shad-button
                v-if="checkable(item)"
                type="button"
                size="sm"
                variant="ghost"
                :disabled="state.releasing || ['checking', 'releasing'].includes(statusOf(item.docId))"
                @click="checkOne(item)"
              >
                {{ state.rows[item.docId]?.plan ? 'Recheck' : 'Check' }}
              </edge-shad-button>
              <edge-shad-button
                v-if="isAdmin && isReadyStatus(statusOf(item.docId))"
                type="button"
                size="sm"
                :disabled="state.releasing || state.checking"
                @click="releaseSingle(item)"
              >
                Release
              </edge-shad-button>
              <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" title="Release history and sites" :aria-label="`Release history for ${item.name}`" @click="openHistory(item.docId)">
                <History class="h-4 w-4" />
              </edge-shad-button>
              <edge-shad-button type="button" size="icon" variant="ghost" class="h-8 w-8" title="Open in Block Editor" :aria-label="`Open ${item.name} in the Block Editor`" @click="router.push(`/app/dashboard/blocks/${item.docId}`)">
                <ExternalLink class="h-4 w-4" />
              </edge-shad-button>
            </div>
          </div>

          <div v-if="progressOf(item.docId)" class="space-y-1 border-t px-3 py-2 text-xs">
            <div class="flex justify-between gap-2">
              <span class="font-medium">{{ RELEASE_STATUS_LABELS[state.rows[item.docId].release.status] || state.rows[item.docId].release.status }}</span>
              <span class="text-muted-foreground">{{ progressOf(item.docId).processed }} of {{ progressOf(item.docId).planned }} documents · {{ progressOf(item.docId).done }} updated<template v-if="progressOf(item.docId).failed">, {{ progressOf(item.docId).failed }} failed</template></span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" :aria-valuenow="progressOf(item.docId).percent" aria-valuemin="0" aria-valuemax="100">
              <div class="h-full bg-primary transition-all" :style="{ width: `${progressOf(item.docId).percent}%` }" />
            </div>
            <p v-if="statusOf(item.docId) === 'release-problem'" class="text-destructive">
              Open the release history to see failed documents and retry.
            </p>
          </div>

          <p v-if="state.rows[item.docId]?.error" class="border-t px-3 py-2 text-sm text-destructive" role="alert">
            {{ state.rows[item.docId].error }}
          </p>

          <label v-if="state.rows[item.docId]?.plan?.breakingConfirmationRequired" class="flex cursor-pointer items-start gap-3 border-t px-3 py-2 text-sm">
            <input v-model="state.rows[item.docId].confirmBreaking" type="checkbox" class="mt-1 accent-current">
            I understand this block's breaking schema changes and want to release it anyway.
          </label>

          <div v-if="state.expanded.includes(item.docId)" class="space-y-2 border-t p-3 text-sm">
            <p v-if="item.kind === 'release' && !state.rows[item.docId]?.release" class="text-muted-foreground">
              A release of this block is still running or needs attention. Use the release history to follow or retry it.
            </p>
            <p v-else-if="!state.rows[item.docId]?.plan" class="text-muted-foreground">
              Check this block to see the pages it updates and any issues.
            </p>
            <template v-else>
              <p>
                <span class="font-medium">{{ describeRelease(state.rows[item.docId].plan) }}</span>: {{ describeScope(state.rows[item.docId].plan.scope, state.rows[item.docId].plan.kind) }}.
                {{ state.rows[item.docId].plan.checks.counts.instances }} instances · {{ state.rows[item.docId].plan.targets.pages ?? '—' }} pages · {{ state.rows[item.docId].plan.targets.posts ?? '—' }} posts.
              </p>
              <p v-if="state.rows[item.docId].plan.blocked && !state.rows[item.docId].plan.breakingConfirmationRequired" class="flex items-start gap-2 text-destructive">
                <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" /> {{ state.rows[item.docId].plan.blocked }}
              </p>
              <p v-if="!issueGroupsOf(item.docId).length" class="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 class="h-4 w-4" /> Checks passed.
              </p>
              <ul v-else class="space-y-1">
                <li v-for="group in issueGroupsOf(item.docId)" :key="group.key" class="flex items-start gap-2">
                  <span class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium" :class="RELEASE_BADGE_CLASSES[group.severity === 'error' ? 'failed' : 'mixed']">{{ group.severity === 'error' ? 'Blocking' : group.severity === 'breaking' ? 'Breaking' : 'Warning' }}</span>
                  <span>{{ group.message }}<span v-if="group.instanceCount" class="text-muted-foreground"> · {{ group.instanceCount }} instance(s)</span></span>
                </li>
              </ul>
              <edge-shad-button type="button" size="sm" variant="link" class="h-auto p-0" @click="openHistory(item.docId)">
                Full report, sites and history
              </edge-shad-button>
            </template>
          </div>
        </li>
      </ul>

      <p class="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw class="h-3 w-3" /> The list updates live. A check is discarded if its block changes before it's released.
      </p>
    </template>

    <edge-cms-block-release-dialog
      v-if="state.dialogBlockId"
      v-model="state.dialogOpen"
      :block-id="state.dialogBlockId"
    />
  </div>
</template>
