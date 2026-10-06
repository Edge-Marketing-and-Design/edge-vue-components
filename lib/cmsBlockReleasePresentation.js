// Read-only reporting for release checks and revision usage. No delivery or
// propagation decisions live here; those remain in the release service.
const siteOf = path => String(path || '').match(/\/sites\/([^/]+)\//)?.[1] || null

export const releaseComparisonRevision = history => history?.draftRevision
  ?? history?.canary?.revisionNumber ?? history?.releasedRevision ?? 0

export const releaseCanExecute = (plan, { isAdmin, confirmBreaking = false, executing = false }) => Boolean(isAdmin && plan
  && !plan.activeReleaseRunning && !executing
  && (!plan.blocked || (plan.breakingConfirmationRequired && confirmBreaking))
  && (!plan.breakingConfirmationRequired || confirmBreaking))

export const revisionMatch = (bucket, revision) => {
  const entries = Object.entries(bucket || {}).filter(([, count]) => count > 0)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  const matched = Number(bucket?.[String(revision)] || 0)
  if (!total) return { status: 'unused', label: 'Not used', total, matched }
  if (matched === total) return { status: 'current', label: 'Up to date', total, matched }
  if (matched) return { status: 'mixed', label: 'Mixed revisions', total, matched }
  if (entries.every(([key]) => key === 'unversioned')) return { status: 'unknown', label: 'Unversioned', total, matched }
  const newer = entries.some(([key]) => key !== 'unversioned' && Number(key) > Number(revision))
  return { status: 'different', label: newer ? 'Different revision' : 'Older revision', total, matched }
}

export const RELEASE_BADGE_CLASSES = {
  current: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  different: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  mixed: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  unknown: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  unused: 'border-border bg-muted text-muted-foreground',
}

export const groupedReleaseIssues = (checks) => {
  const groups = new Map()
  const add = (issue, severity, location = null) => {
    const key = JSON.stringify([severity, issue.code, issue.message])
    const group = groups.get(key) || { key, severity, code: issue.code, message: issue.message, occurrences: 0, locations: [], sites: new Set(), instances: new Set() }
    group.occurrences++
    if (location) {
      const siteId = siteOf(location.path)
      if (siteId) group.sites.add(siteId)
      const identity = `${location.path}#${location.instanceId || ''}`
      if (!group.instances.has(identity)) {
        group.instances.add(identity)
        group.locations.push({ ...location, siteId })
      }
    }
    else if (issue.path && !group.locations.some(item => item.path === issue.path))
      group.locations.push({ path: issue.path })
    groups.set(key, group)
  }
  for (const issue of checks?.errors || []) add(issue, 'error')
  for (const failure of checks?.instanceFailures || [])
    for (const finding of failure.findings || []) add(finding, 'error', { path: failure.path, instanceId: failure.instanceId, field: finding.path })
  for (const change of checks?.breaking || []) {
    const issue = { code: `schema.${change.change}`, path: change.path,
      message: change.change === 'removed' ? `“${change.path}” is removed. Existing values remain stored but no longer render.`
        : `“${change.path}” changes type from ${change.from || 'none'} to ${change.to || 'none'}.` }
    if (change.instances?.length) for (const instance of change.instances) add(issue, 'breaking', instance)
    else add(issue, 'breaking')
  }
  for (const issue of checks?.warnings || []) add(issue, 'warning')
  return [...groups.values()].map(({ sites, instances, ...group }) => ({ ...group, siteCount: sites.size, instanceCount: instances.size }))
    .sort((a, b) => ({ error: 0, breaking: 1, warning: 2 }[a.severity] - { error: 0, breaking: 1, warning: 2 }[b.severity]))
}

export const groupReleaseTargets = targets => {
  const sites = new Map()
  for (const target of targets || []) {
    const site = sites.get(target.siteId) || { siteId: target.siteId, total: 0, updated: 0, skipped: 0, failed: 0, pending: 0, documents: [] }
    site.total++
    if (target.status === 'failed') site.failed++
    else if (target.status === 'skipped') site.skipped++
    else if (target.status === 'done') site.updated++
    else site.pending++
    site.documents.push(target)
    sites.set(target.siteId, site)
  }
  return [...sites.values()]
}

export const readReleaseTargets = async ({ edgeFirebase, organizationDocPath, releaseId }) => {
  const search = new edgeFirebase.SearchStaticData()
  const response = await search.getData(`${organizationDocPath}/blockReleases/${releaseId}/targets`, [], [], 2001)
  if (response?.success === false) throw new Error(response.message || 'Could not read release targets.')
  // SearchStaticData replaces docId with the target-record ID. The actual
  // page/post ID is the final segment of the immutable target path.
  const targets = Object.values(search.results?.data || {}).map(target => ({ ...target, targetId: target.docId, docId: String(target.path || '').split('/').pop() || target.docId }))
  // staticIsLastPage is false for every nonempty first page in this wrapper;
  // it does not prove that the result was truncated. total is its exact count.
  return { targets: targets.slice(0, 2000), truncated: targets.length > 2000 || Number(search.results?.total || 0) > 2000 }
}
