// Hub-side access to library block releases. The Firestore wrapper
// (`edgeFirebase`) is passed in, so the logic stays testable without Vue.

const callableData = response => ((response && typeof response === 'object' && 'data' in response) ? response.data : response) || {}

const scopeArgs = siteIds => ((Array.isArray(siteIds) && siteIds.length) ? { siteIds } : {})

export const dryRunBlockRelease = async ({ edgeFirebase, orgId, blockId, revisionNumber, siteIds = null }) =>
  callableData(await edgeFirebase.runFunction('cms-dryRunBlockRelease', { orgId, blockId, revisionNumber, ...scopeArgs(siteIds) }))

export const executeBlockRelease = async ({ edgeFirebase, orgId, blockId, revisionNumber, siteIds = null, checksum, confirmBreaking = false }) =>
  callableData(await edgeFirebase.runFunction('cms-executeBlockRelease', {
    orgId,
    blockId,
    revisionNumber,
    checksum,
    confirmBreaking: confirmBreaking === true,
    ...scopeArgs(siteIds),
  }))

export const retryBlockRelease = async ({ edgeFirebase, orgId, releaseId }) =>
  callableData(await edgeFirebase.runFunction('cms-retryBlockRelease', { orgId, releaseId }))

export const loadBlockReleaseHistory = async ({ edgeFirebase, orgId, blockId }) =>
  callableData(await edgeFirebase.runFunction('cms-blockReleaseHistory', { orgId, blockId }))

export const loadBlockRevisionUsage = async ({ edgeFirebase, orgId, blockId }) =>
  callableData(await edgeFirebase.runFunction('cms-blockRevisionUsage', { orgId, blockId }))

// The release record, for progress. Returns null if it can't be read.
export const readBlockRelease = async ({ edgeFirebase, organizationDocPath, releaseId }) => {
  try {
    const doc = await edgeFirebase.getDocData(`${organizationDocPath}/blockReleases`, releaseId)
    return (doc && doc.success !== false) ? doc : null
  }
  catch {
    return null
  }
}

export const RELEASE_KIND_LABELS = Object.freeze({
  release: 'Release',
  promote: 'Promote canary',
  reapply: 'Reapply released revision',
  rollback: 'Roll back',
})

export const RELEASE_STATUS_LABELS = Object.freeze({
  planned: 'Starting',
  running: 'Running',
  completed: 'Completed',
  partial: 'Finished with failures',
  failed: 'Failed',
  superseded: 'Stopped by a newer release',
})

const FINISHED_STATUSES = new Set(['completed', 'partial', 'failed', 'superseded'])
const RETRYABLE_STATUSES = new Set(['partial', 'failed'])
const RELEASABLE_STATUSES = new Set(['draft', 'canary', 'released', 'superseded'])

export const isReleaseFinished = release => FINISHED_STATUSES.has(release?.status)
export const canRetryRelease = release => RETRYABLE_STATUSES.has(release?.status)

export const releaseProgress = (release) => {
  const counts = { planned: 0, done: 0, skipped: 0, failed: 0, ...(release?.counts || {}) }
  const processed = counts.done + counts.skipped + counts.failed
  const percent = counts.planned ? Math.min(100, Math.round((processed / counts.planned) * 100)) : (isReleaseFinished(release) ? 100 : 0)
  return { ...counts, processed, percent, finished: isReleaseFinished(release) }
}

export const describeScope = (scope) => {
  if (!scope || scope === 'all')
    return 'All sites'
  const count = scope.siteIds?.length || 0
  return `${count} site${count === 1 ? '' : 's'} (canary)`
}

const REVISION_STATUS_LABELS = {
  draft: 'unreleased draft',
  canary: 'in canary',
  released: 'released',
  superseded: 'previous',
}

// Revisions a release can start from, newest first.
export const releasableRevisionItems = history => (history?.revisions || [])
  .filter(revision => RELEASABLE_STATUSES.has(revision.status))
  .map(revision => ({
    name: String(revision.number),
    title: `Revision ${revision.number} (${REVISION_STATUS_LABELS[revision.status] || revision.status})`,
  }))

// The revision a rollback returns to: the one the current release replaced,
// or else the newest earlier revision that is no longer live.
export const rollbackRevision = (history) => {
  const released = history?.releasedRevision ?? 0
  const current = (history?.releases || []).find(release => release.revisionNumber === released
    && (!release.scope || release.scope === 'all')
    && (release.status === 'completed' || release.status === 'partial'))
  if (current && Number.isInteger(current.previousRevisionNumber) && current.previousRevisionNumber !== released)
    return current.previousRevisionNumber
  const candidate = (history?.revisions || [])
    .filter(revision => revision.number < released && revision.status === 'superseded')
    .sort((a, b) => b.number - a.number)[0]
  return candidate ? candidate.number : null
}

// Everything the checks found, in the shape blockValidationIssues shows.
export const releaseCheckIssues = (checks) => {
  if (!checks)
    return []
  const issues = [
    ...(checks.errors || []).map(issue => ({ ...issue, severity: 'error' })),
    ...(checks.instanceFailures || []).flatMap(failure => (failure.findings || []).map(finding => ({
      code: finding.code,
      severity: 'error',
      path: `${failure.path}${failure.instanceId ? ` #${failure.instanceId}` : ''}`,
      message: `An instance fails to render: ${finding.message}`,
    }))),
    ...(checks.breaking || []).map(change => ({
      code: `schema.${change.change}`,
      severity: 'warning',
      path: change.path,
      message: change.change === 'removed'
        ? `Breaking: "${change.path}" is removed; ${change.instances?.length || 0} instance(s) hold a value in it. The values stay on the instances but no longer render.`
        : `Breaking: "${change.path}" changes type from ${change.from || 'none'} to ${change.to || 'none'}; ${change.instances?.length || 0} instance(s) hold a value in it.`,
    })),
    ...(checks.warnings || []).map(issue => ({ ...issue, severity: 'warning' })),
  ]
  return issues
}
