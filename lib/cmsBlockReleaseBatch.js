// Batch checks and releases for library blocks with pending revisions. Pure
// helpers only; each block still goes through its own dry run and checksum
// checked release on the server.
import { isReleaseFinished, releaseProgress } from './cmsBlockReleaseClient.js'
import { releaseCanExecute } from './cmsBlockReleasePresentation.js'

const isRevision = value => Number.isInteger(value) && value >= 0

// What a block has pending: an unreleased draft, a canary to finish, or a
// release that still owns the block. Null when there is nothing to do.
export const pendingBlockRevision = (block) => {
  if (!block)
    return null
  const releasedRevision = isRevision(block.releasedRevision) ? block.releasedRevision : 0
  const base = { releasedRevision, activeReleaseId: block.activeReleaseId || null }
  if (isRevision(block.draftRevision))
    return { ...base, kind: 'draft', revisionNumber: block.draftRevision, label: 'Unreleased draft' }
  if (block.canary && isRevision(block.canary.revisionNumber)) {
    const count = Array.isArray(block.canary.siteIds) ? block.canary.siteIds.length : 0
    return { ...base, kind: 'canary', revisionNumber: block.canary.revisionNumber, label: `Canary on ${count} site${count === 1 ? '' : 's'}` }
  }
  if (block.activeReleaseId)
    return { ...base, kind: 'release', revisionNumber: null, label: 'Release not finished' }
  return null
}

// Library blocks with pending revisions, by name. `blocks` is the snapshot
// map keyed by document id.
export const pendingReleaseBlocks = blocks => Object.entries(blocks || {})
  .map(([docId, block]) => {
    const pending = pendingBlockRevision(block)
    return pending ? { docId, name: block?.name || docId, ...pending } : null
  })
  .filter(Boolean)
  .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.docId.localeCompare(b.docId))

// Changes whenever the block moves on (new draft, release, canary), so a
// check made before that is discarded. The server's checksum still decides.
export const pendingSignature = (block) => {
  const pending = pendingBlockRevision(block)
  return JSON.stringify([
    pending?.kind || null,
    pending?.revisionNumber ?? null,
    isRevision(block?.releasedRevision) ? block.releasedRevision : 0,
    block?.activeReleaseId || null,
  ])
}

// One row's state, from its dry run and release.
export const rowStatus = (row = {}, { isAdmin = false } = {}) => {
  if (row.release) {
    if (!isReleaseFinished(row.release))
      return 'releasing'
    return row.release.status === 'completed' ? 'released' : 'release-problem'
  }
  if (row.executing)
    return 'releasing'
  if (row.planning)
    return 'checking'
  if (row.error)
    return 'error'
  if (!row.plan)
    return 'unchecked'
  if (row.plan.activeReleaseRunning)
    return 'busy'
  if (row.plan.breakingConfirmationRequired && !row.confirmBreaking)
    return 'needs-confirmation'
  if (!releaseCanExecute(row.plan, { isAdmin: true, confirmBreaking: row.confirmBreaking }))
    return 'blocked'
  if (!isAdmin)
    return 'checked'
  return row.plan.checks?.status === 'passed' ? 'ready' : 'ready-with-warnings'
}

export const ROW_STATUS_LABELS = Object.freeze({
  'unchecked': 'Not checked',
  'checking': 'Checking…',
  'error': 'Check failed',
  'busy': 'Another release is running',
  'needs-confirmation': 'Breaking changes need confirmation',
  'blocked': 'Blocked',
  'checked': 'Checked',
  'ready': 'Ready to release',
  'ready-with-warnings': 'Ready (warnings)',
  'releasing': 'Releasing…',
  'released': 'Released',
  'release-problem': 'Release needs attention',
})

export const isReadyStatus = status => status === 'ready' || status === 'ready-with-warnings'

// Totals for the summary bar.
export const summarizeRows = (statuses) => {
  const counts = {}
  for (const status of statuses)
    counts[status] = (counts[status] || 0) + 1
  return {
    counts,
    ready: (counts.ready || 0) + (counts['ready-with-warnings'] || 0),
    attention: (counts.blocked || 0) + (counts.error || 0) + (counts['needs-confirmation'] || 0) + (counts['release-problem'] || 0),
    running: (counts.checking || 0) + (counts.releasing || 0),
  }
}

export const rowProgress = row => (row?.release ? releaseProgress(row.release) : null)

// Runs `task` over `items`, at most `limit` at a time. Each result is
// { item, value } or { item, error }; one failure never stops the others.
export const runLimited = async (items, limit, task) => {
  const list = [...items]
  const results = new Array(list.length)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const index = next++
      try {
        results[index] = { item: list[index], value: await task(list[index], index) }
      }
      catch (error) {
        results[index] = { item: list[index], error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker))
  return results
}
