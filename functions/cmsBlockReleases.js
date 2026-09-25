// Library block releases: the only way a block definition reaches pages.
// A release applies one revision to every document that holds the block, one
// transaction per document, through a resumable Pub/Sub worker. See
// docs/features/cms/block-revisions-and-releases-plan.md. Keep identical to
// edge/functions/cmsBlockReleases.js.
const { createHash } = require('crypto')
const {
  logger,
  db,
  pubsub,
  onCall,
  onMessagePublished,
  HttpsError,
  Firestore,
  permissionCheck,
} = require('./config.js')
const { applyBlockToDocument, planBlockTargets } = require('./helpers/cmsBlockPropagation')

const corePromise = import('./helpers/cmsBlockRevisions.mjs')
// Loaded only when a dry run or execute runs its checks.
const loadCheckModules = () => Promise.all([
  import('./helpers/cmsBlockReleaseChecks.mjs'),
  import('./helpers/cmsBlockValidation.mjs'),
  import('@edgedev/template-engine'),
])

const BLOCK_RELEASE_TOPIC = 'cms-block-release'
// Documents per worker message. Sized from production usage on 2026-09-24:
// the most-placed Clearwater block (the main navigation) touches about 44
// documents, and the expected agent-site scale is a few hundred.
const BLOCK_RELEASE_CHUNK_SIZE = 50
// Consecutive failed or timed-out worker runs on one release before it stops.
const BLOCK_RELEASE_MAX_CHUNK_ATTEMPTS = 5
const TARGET_WRITE_BATCH_SIZE = 400
const RUNNING_STATUSES = new Set(['planned', 'running'])
// Revision statuses a release can start from.
const RELEASABLE_STATUSES = ['draft', 'canary', 'released', 'superseded']
const MAX_SCOPE_SITES = 100

const DOC_ID_PATTERN = /^[^/]{1,1500}$/

class ReleaseSuperseded extends Error {}

const requireDocId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !DOC_ID_PATTERN.test(id) || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

const orgRefOf = orgId => db.collection('organizations').doc(orgId)
const blockRefOf = (orgId, blockId) => orgRefOf(orgId).collection('blocks').doc(blockId)
const releaseRefOf = (orgId, releaseId) => orgRefOf(orgId).collection('blockReleases').doc(releaseId)
const revisionRefOf = (blockRef, number) => blockRef.collection('revisions').doc(String(number))
const targetIdOf = path => createHash('sha1').update(path).digest('hex')

const nowIso = () => new Date().toISOString()

// Callers of every release callable must be signed in with a matching uid.
// Dry runs need block write access; starting or retrying a release needs
// organization admin (the `assign` permission).
const assertReleaseCaller = async (request, action) => {
  const uid = request?.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  const orgId = requireDocId(request.data.orgId, 'organization id')
  if (!await permissionCheck(uid, action, `organizations/${orgId}/blocks`)) {
    throw new HttpsError('permission-denied', action === 'assign'
      ? 'Only organization admins can release blocks.'
      : 'Not allowed to edit blocks in this organization.')
  }
  return { uid, orgId }
}

const releasedNumberOf = (core, block) => (core.isRevisionNumber(block.releasedRevision) ? block.releasedRevision : 0)

const summarizeTargets = (targets) => {
  const bySite = {}
  for (const target of targets) {
    const site = bySite[target.siteId] || (bySite[target.siteId] = { siteId: target.siteId, total: 0, collections: {} })
    site.total += 1
    site.collections[target.collection] = (site.collections[target.collection] || 0) + 1
  }
  return { total: targets.length, sites: Object.values(bySite) }
}

const releaseChecksum = ({ blockId, revisionNumber, releasedRevision, scope, targets }) =>
  createHash('sha256')
    .update(JSON.stringify({ blockId, revisionNumber, releasedRevision, scope, targets: targets.map(target => target.path) }))
    .digest('hex')

// - release: a new revision (a draft), to all sites or as a canary;
// - promote: a canary revision to all sites;
// - reapply: the released revision again (for example, rolling a canary back);
// - rollback: an older revision.
const releaseKind = (revision, revisionNumber, releasedRevision, scope) => {
  if (revision.status === 'draft')
    return 'release'
  if (revision.status === 'canary')
    return scope === 'all' ? 'promote' : 'release'
  if (revisionNumber === releasedRevision)
    return 'reapply'
  return 'rollback'
}

const isScoped = scope => scope !== 'all'

// Runs the release checks (R4): the shared validator on the revision, a
// render of every instance with its own values, and schema compatibility.
const checkRelease = async ({ orgId, blockId, block, revision, targets }) => {
  const [checks, validation, engine] = await loadCheckModules()
  const themes = await orgRefOf(orgId).collection('themes').get()
  const core = await corePromise
  return checks.runReleaseChecks({
    blockId,
    blockDoc: block,
    definition: revision.definition || {},
    beforeDefinition: core.pickBlockDefinition(block),
    targets,
    validateBlock: validation.validateBlock,
    validateBlockRender: validation.validateBlockRender,
    renderTemplate: engine.renderTemplateAsync,
    knownThemeIds: themes.docs.map(doc => doc.id),
  })
}

// Reads the block and the revision to release, plans every target and runs
// the checks.
const planRelease = async (core, { orgId, blockId, revisionNumber, scope }) => {
  const blockRef = blockRefOf(orgId, blockId)
  const blockSnap = await blockRef.get()
  if (!blockSnap.exists)
    throw new HttpsError('not-found', `Block "${blockId}" does not exist.`)
  const block = blockSnap.data() || {}
  const revisionSnap = await revisionRefOf(blockRef, revisionNumber).get()
  if (!revisionSnap.exists)
    throw new HttpsError('not-found', `Block "${blockId}" has no revision ${revisionNumber}.`)
  const revision = revisionSnap.data() || {}
  if (!RELEASABLE_STATUSES.includes(revision.status))
    throw new HttpsError('failed-precondition', `Revision ${revisionNumber} is ${revision.status} and can't be released.`)

  const releasedRevision = releasedNumberOf(core, block)
  const targetsWithData = await planBlockTargets(db, orgId, blockId, {
    includeData: true,
    siteIds: isScoped(scope) ? scope.siteIds : null,
  })
  const targets = targetsWithData.map(({ path, siteId, collection, docId }) => ({ path, siteId, collection, docId }))
  const checks = await checkRelease({ orgId, blockId, block, revision, targets: targetsWithData })
  return {
    blockRef,
    block,
    revision,
    releasedRevision,
    targets,
    checks,
    kind: releaseKind(revision, revisionNumber, releasedRevision, scope),
    checksum: releaseChecksum({ blockId, revisionNumber, releasedRevision, scope, targets }),
  }
}

// One canary at a time: a canary of another revision must be promoted or
// rolled back first.
const canaryConflict = (block, { revisionNumber, scope, releasedRevision }) => {
  const canary = block.canary
  if (!canary || !isScoped(scope) || canary.revisionNumber === revisionNumber || revisionNumber === releasedRevision)
    return ''
  return `Revision ${canary.revisionNumber} is already in a canary on ${canary.siteIds.length} site(s). Promote it or roll it back first.`
}

// Only a new revision can be blocked. Rollback and reapply release a
// definition that was live before, so their findings are reported but never
// block them.
const releaseBlockedReason = (plan, { confirmBreaking }) => {
  if (plan.kind !== 'release' && plan.kind !== 'promote')
    return ''
  if (plan.checks.status === 'blocked')
    return `The release checks found ${plan.checks.counts.errors} error(s) and ${plan.checks.counts.instanceFailures} instance render failure(s). Fix the revision before releasing.`
  if (plan.checks.status === 'breaking' && confirmBreaking !== true)
    return `This revision makes ${plan.checks.counts.breaking} breaking schema change(s). Confirm them to release.`
  return ''
}

const parseReleaseRequest = (core, data) => {
  const blockId = requireDocId(data.blockId, 'block id')
  const revisionNumber = data.revisionNumber
  if (!core.isRevisionNumber(revisionNumber))
    throw new HttpsError('invalid-argument', 'revisionNumber must be a revision number.')
  let scope = 'all'
  if (data.siteIds !== undefined && data.siteIds !== null) {
    if (!Array.isArray(data.siteIds) || !data.siteIds.length || data.siteIds.length > MAX_SCOPE_SITES)
      throw new HttpsError('invalid-argument', `siteIds must list 1 to ${MAX_SCOPE_SITES} sites.`)
    const siteIds = [...new Set(data.siteIds.map(siteId => requireDocId(siteId, 'site id')))].sort()
    scope = { siteIds }
  }
  return { blockId, revisionNumber, scope }
}

const writeTargets = async (releaseRef, targets) => {
  for (let index = 0; index < targets.length; index += TARGET_WRITE_BATCH_SIZE) {
    const batch = db.batch()
    for (const target of targets.slice(index, index + TARGET_WRITE_BATCH_SIZE)) {
      batch.set(releaseRef.collection('targets').doc(targetIdOf(target.path)), {
        path: target.path,
        siteId: target.siteId,
        collection: target.collection,
        docId: target.docId,
        status: 'pending',
        attempts: 0,
        error: null,
      })
    }
    await batch.commit()
  }
}

const publishRelease = (orgId, releaseId) =>
  pubsub.topic(BLOCK_RELEASE_TOPIC).publishMessage({ json: { orgId, releaseId } })

const activeReleaseIsRunning = async (orgId, block) => {
  if (!block.activeReleaseId)
    return false
  const activeSnap = await releaseRefOf(orgId, block.activeReleaseId).get()
  return activeSnap.exists && RUNNING_STATUSES.has(activeSnap.data()?.status)
}

// Reports what releasing a revision would touch. Writes nothing.
exports.dryRunBlockRelease = onCall({ timeoutSeconds: 120 }, async (request) => {
  const core = await corePromise
  const { orgId } = await assertReleaseCaller(request, 'write')
  const { blockId, revisionNumber, scope } = parseReleaseRequest(core, request.data)
  const plan = await planRelease(core, { orgId, blockId, revisionNumber, scope })
  return {
    blockId,
    revisionNumber,
    scope,
    releasedRevision: plan.releasedRevision,
    kind: plan.kind,
    canary: plan.block.canary || null,
    activeReleaseRunning: await activeReleaseIsRunning(orgId, plan.block),
    targets: summarizeTargets(plan.targets),
    checks: (await loadCheckModules())[0].summarizeReleaseChecks(plan.checks),
    blocked: canaryConflict(plan.block, { revisionNumber, scope, releasedRevision: plan.releasedRevision })
      || releaseBlockedReason(plan, { confirmBreaking: false }),
    checksum: plan.checksum,
  }
})

// Starts a release. The checksum must match a dry run of the same revision
// against the same released revision and the same documents.
exports.executeBlockRelease = onCall({ timeoutSeconds: 300 }, async (request) => {
  const core = await corePromise
  const { uid, orgId } = await assertReleaseCaller(request, 'assign')
  const { blockId, revisionNumber, scope } = parseReleaseRequest(core, request.data)
  const plan = await planRelease(core, { orgId, blockId, revisionNumber, scope })
  if (request.data.checksum !== plan.checksum)
    throw new HttpsError('failed-precondition', 'The block or its pages changed since the dry run. Run it again before releasing.')
  const blocked = releaseBlockedReason(plan, { confirmBreaking: request.data.confirmBreaking })
  if (blocked)
    throw new HttpsError('failed-precondition', blocked)
  const checks = (await loadCheckModules())[0].summarizeReleaseChecks(plan.checks)

  const releaseRef = orgRefOf(orgId).collection('blockReleases').doc()
  const releaseId = releaseRef.id
  const now = nowIso()
  await releaseRef.set({
    blockId,
    revisionNumber,
    previousRevisionNumber: plan.releasedRevision,
    kind: plan.kind,
    scope,
    implicit: false,
    status: 'planned',
    definition: plan.revision.definition,
    counts: { planned: plan.targets.length, done: 0, skipped: 0, failed: 0 },
    checks,
    confirmedBreaking: plan.checks.status === 'breaking' && request.data.confirmBreaking === true,
    checksum: plan.checksum,
    startedBy: uid,
    createdAt: now,
    updatedAt: now,
    chunkAttempts: 0,
  })
  await writeTargets(releaseRef, plan.targets)

  // Claim the block last, so a failed plan never leaves it locked.
  try {
    await db.runTransaction(async (transaction) => {
      const blockSnap = await transaction.get(plan.blockRef)
      const block = blockSnap.data() || {}
      const revisionSnap = await transaction.get(revisionRefOf(plan.blockRef, revisionNumber))
      const activeSnap = block.activeReleaseId ? await transaction.get(releaseRefOf(orgId, block.activeReleaseId)) : null
      if (releasedNumberOf(core, block) !== plan.releasedRevision)
        throw new HttpsError('failed-precondition', 'The block was released again since the dry run. Run it again before releasing.')
      if (activeSnap?.exists && RUNNING_STATUSES.has(activeSnap.data()?.status))
        throw new HttpsError('failed-precondition', 'Another release of this block is still running.')
      const conflict = canaryConflict(block, { revisionNumber, scope, releasedRevision: plan.releasedRevision })
      if (conflict)
        throw new HttpsError('failed-precondition', conflict)
      const revision = revisionSnap.data() || {}
      if (!RELEASABLE_STATUSES.includes(revision.status))
        throw new HttpsError('failed-precondition', `Revision ${revisionNumber} changed since the dry run.`)

      const startedAt = nowIso()
      // The definition is frozen in the release. Later edits start a new draft.
      transaction.update(revisionSnap.ref, { status: 'releasing', releaseId, checks, updatedAt: startedAt })
      const blockUpdate = { activeReleaseId: releaseId }
      if (block.draftRevision === revisionNumber)
        blockUpdate.draftRevision = null
      transaction.update(plan.blockRef, blockUpdate)
      transaction.update(releaseRef, {
        status: 'running',
        beforeDefinition: core.pickBlockDefinition(block),
        blockUpdatedAt: startedAt,
        startedAt,
        updatedAt: startedAt,
        revisionStatusBefore: revision.status,
      })
    })
  }
  catch (error) {
    await releaseRef.update({ status: 'failed', error: String(error?.message || error), updatedAt: nowIso() })
    throw error
  }

  await publishRelease(orgId, releaseId)
  logger.log(`Block ${blockId} release ${releaseId} of revision ${revisionNumber} started by ${uid}`, { targets: plan.targets.length })
  return { releaseId, status: 'running', kind: plan.kind, targets: summarizeTargets(plan.targets) }
})

// Puts failed targets back in the queue and resumes a partial, failed or
// stalled release. It only resumes the release that still owns the block.
exports.retryBlockRelease = onCall({ timeoutSeconds: 300 }, async (request) => {
  const { uid, orgId } = await assertReleaseCaller(request, 'assign')
  const releaseId = requireDocId(request.data.releaseId, 'release id')
  const releaseRef = releaseRefOf(orgId, releaseId)
  const releaseSnap = await releaseRef.get()
  if (!releaseSnap.exists)
    throw new HttpsError('not-found', `Release "${releaseId}" does not exist.`)
  const release = releaseSnap.data() || {}
  if (!['partial', 'failed', 'running'].includes(release.status))
    throw new HttpsError('failed-precondition', `A ${release.status} release can't be retried.`)

  // Ownership is checked before anything is re-queued, so a refused retry
  // leaves the release as it was.
  const blockRef = blockRefOf(orgId, release.blockId)
  await db.runTransaction(async (transaction) => {
    const blockSnap = await transaction.get(blockRef)
    const block = blockSnap.data() || {}
    const ownsBlock = block.activeReleaseId === releaseId
      || (!block.activeReleaseId && block.lastReleaseId === releaseId)
    if (!ownsBlock)
      throw new HttpsError('failed-precondition', 'A newer release of this block exists, so this one can no longer be retried.')
    const current = (await transaction.get(releaseRef)).data() || {}
    transaction.update(blockRef, { activeReleaseId: releaseId })
    transaction.update(releaseRef, {
      status: 'running',
      chunkAttempts: 0,
      error: null,
      counts: { ...current.counts, failed: 0 },
      retriedBy: uid,
      updatedAt: nowIso(),
    })
  })

  const failed = await releaseRef.collection('targets').where('status', '==', 'failed').get()
  for (let index = 0; index < failed.docs.length; index += TARGET_WRITE_BATCH_SIZE) {
    const batch = db.batch()
    for (const doc of failed.docs.slice(index, index + TARGET_WRITE_BATCH_SIZE))
      batch.update(doc.ref, { status: 'pending', error: null })
    await batch.commit()
  }

  await publishRelease(orgId, releaseId)
  logger.log(`Block release ${releaseId} retried by ${uid}`, { requeued: failed.size })
  return { releaseId, status: 'running', requeued: failed.size }
})

// Which revision each site's instances hold, split into drafts and published
// copies. Instances released before revisions existed count as
// `unversioned`. Needs block write access.
exports.blockRevisionUsage = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { orgId } = await assertReleaseCaller(request, 'write')
  const blockId = requireDocId(request.data.blockId, 'block id')
  const blockSnap = await blockRefOf(orgId, blockId).get()
  if (!blockSnap.exists)
    throw new HttpsError('not-found', `Block "${blockId}" does not exist.`)
  const targets = await planBlockTargets(db, orgId, blockId, { includeData: true })
  const sites = {}
  for (const target of targets) {
    const site = sites[target.siteId] || (sites[target.siteId] = { siteId: target.siteId, drafts: {}, published: {} })
    const bucket = target.collection.startsWith('published') ? site.published : site.drafts
    for (const listName of ['content', 'postContent']) {
      for (const block of Array.isArray(target.data[listName]) ? target.data[listName] : []) {
        if (block?.blockId !== blockId)
          continue
        const key = Number.isInteger(block.blockRevision) ? String(block.blockRevision) : 'unversioned'
        bucket[key] = (bucket[key] || 0) + 1
      }
    }
  }
  const block = blockSnap.data() || {}
  return {
    blockId,
    releasedRevision: Number.isInteger(block.releasedRevision) ? block.releasedRevision : 0,
    canary: block.canary || null,
    sites: Object.values(sites).sort((a, b) => (a.siteId < b.siteId ? -1 : 1)),
  }
})

const HISTORY_LIMIT = 25

// The block's revisions and its most recent releases, newest first, without
// definitions. Needs block write access.
exports.blockReleaseHistory = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { orgId } = await assertReleaseCaller(request, 'write')
  const blockId = requireDocId(request.data.blockId, 'block id')
  const blockRef = blockRefOf(orgId, blockId)
  const blockSnap = await blockRef.get()
  if (!blockSnap.exists)
    throw new HttpsError('not-found', `Block "${blockId}" does not exist.`)
  const block = blockSnap.data() || {}

  const revisionsSnap = await blockRef.collection('revisions').get()
  const revisions = revisionsSnap.docs
    .map((doc) => {
      const { definition: _definition, checks, ...revision } = doc.data() || {}
      return { ...revision, checksStatus: checks?.status || null }
    })
    .sort((a, b) => b.number - a.number)

  const releasesSnap = await orgRefOf(orgId).collection('blockReleases').where('blockId', '==', blockId).get()
  const releases = releasesSnap.docs
    .map((doc) => {
      const { definition: _definition, beforeDefinition: _beforeDefinition, checks, ...release } = doc.data() || {}
      return { releaseId: doc.id, ...release, checksStatus: checks?.status || null }
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, HISTORY_LIMIT)

  return {
    blockId,
    releasedRevision: Number.isInteger(block.releasedRevision) ? block.releasedRevision : 0,
    draftRevision: Number.isInteger(block.draftRevision) ? block.draftRevision : null,
    activeReleaseId: block.activeReleaseId || null,
    canary: block.canary || null,
    revisions,
    releases,
  }
})

const markSuperseded = async (orgId, releaseId, release) => {
  const blockRef = blockRefOf(orgId, release.blockId)
  await db.runTransaction(async (transaction) => {
    const releaseRef = releaseRefOf(orgId, releaseId)
    const current = (await transaction.get(releaseRef)).data() || {}
    const revisionSnap = await transaction.get(revisionRefOf(blockRef, release.revisionNumber))
    if (!RUNNING_STATUSES.has(current.status))
      return
    const now = nowIso()
    transaction.update(releaseRef, { status: 'superseded', updatedAt: now, completedAt: now })
    // A revision that was live before this release (a reapply) stays live.
    if (revisionSnap.exists && revisionSnap.data()?.status === 'releasing' && revisionSnap.data()?.releaseId === releaseId) {
      const before = current.revisionStatusBefore
      const wasLive = before === 'released' || before === 'canary'
      transaction.update(revisionSnap.ref, { status: wasLive ? before : 'superseded', updatedAt: now })
    }
  })
}

// Applies one target. Each runs in its own transaction and re-reads the block,
// so a newer release that has taken over the block always wins.
const processTarget = async ({ orgId, releaseId, release, targetDoc }) => {
  const blockRef = blockRefOf(orgId, release.blockId)
  return db.runTransaction(async (transaction) => {
    const targetSnap = await transaction.get(targetDoc.ref)
    const target = targetSnap.data() || {}
    if (target.status !== 'pending')
      return null
    const blockSnap = await transaction.get(blockRef)
    if (!blockSnap.exists || blockSnap.data()?.activeReleaseId !== releaseId)
      throw new ReleaseSuperseded(releaseId)
    const outcome = await applyBlockToDocument(transaction, db, {
      orgId,
      target,
      blockId: release.blockId,
      beforeData: release.beforeDefinition || {},
      afterData: { ...release.definition, blockUpdatedAt: release.blockUpdatedAt },
      blockRevision: release.revisionNumber,
      warn: message => logger.warn(message),
    })
    const status = outcome === 'updated' ? 'done' : 'skipped'
    transaction.update(targetDoc.ref, { status, outcome, attempts: (target.attempts || 0) + 1, error: null, updatedAt: nowIso() })
    return status
  })
}

const countTargets = async (releaseRef) => {
  const counts = {}
  for (const status of ['done', 'skipped', 'failed']) {
    const snap = await releaseRef.collection('targets').where('status', '==', status).count().get()
    counts[status] = snap.data().count
  }
  return counts
}

// A site-scoped release leaves the library block's definition alone:
// - a new revision becomes (or extends) the block's canary;
// - reapplying the released revision to canary sites rolls them back, and
//   the canary ends once none of its sites remain.
const finalizeScopedRelease = ({ transaction, release, releaseId, block, blockRef, revisionSnap, canarySnap, now }) => {
  const siteIds = release.scope.siteIds
  const canary = block.canary || null
  const blockUpdate = { activeReleaseId: null }
  if (release.kind === 'reapply') {
    if (revisionSnap.exists)
      transaction.update(revisionSnap.ref, { status: release.revisionStatusBefore || 'released', updatedAt: now })
    if (canary) {
      const remaining = canary.siteIds.filter(siteId => !siteIds.includes(siteId))
      blockUpdate.canary = remaining.length ? { ...canary, siteIds: remaining } : null
      if (!remaining.length && canarySnap?.exists && canarySnap.data()?.status === 'canary')
        transaction.update(canarySnap.ref, { status: 'superseded', updatedAt: now })
    }
  }
  else {
    const previousSites = canary?.revisionNumber === release.revisionNumber ? canary.siteIds : []
    blockUpdate.canary = {
      revisionNumber: release.revisionNumber,
      siteIds: [...new Set([...previousSites, ...siteIds])].sort(),
      releaseId,
      updatedAt: now,
    }
    if (revisionSnap.exists)
      transaction.update(revisionSnap.ref, { status: 'canary', releaseId, updatedAt: now })
  }
  transaction.update(blockRef, blockUpdate)
}

// Once no target is pending, a release to all sites moves the library block:
// it takes the released definition, the revision becomes released, and the
// one it replaces (and any other canary) is superseded. The write carries
// lastReleaseId, so blockUpdated ignores it.
const finalizeRelease = async (core, { orgId, releaseId }) => {
  const releaseRef = releaseRefOf(orgId, releaseId)
  // The running tallies can miss a chunk whose worker run died after its
  // targets committed, so the final counts come from the targets themselves.
  const finalCounts = await countTargets(releaseRef)
  return db.runTransaction(async (transaction) => {
    const release = (await transaction.get(releaseRef)).data() || {}
    if (release.status !== 'running')
      return release.status
    const blockRef = blockRefOf(orgId, release.blockId)
    const blockSnap = await transaction.get(blockRef)
    const block = blockSnap.data() || {}
    const revisionSnap = await transaction.get(revisionRefOf(blockRef, release.revisionNumber))
    const previousNumber = release.previousRevisionNumber
    const hasPrevious = core.isRevisionNumber(previousNumber) && previousNumber !== release.revisionNumber
    const previousSnap = hasPrevious ? await transaction.get(revisionRefOf(blockRef, previousNumber)) : null
    const canaryNumber = block.canary?.revisionNumber
    const hasOtherCanary = core.isRevisionNumber(canaryNumber) && canaryNumber !== release.revisionNumber
    const canarySnap = hasOtherCanary ? await transaction.get(revisionRefOf(blockRef, canaryNumber)) : null
    const now = nowIso()
    if (!blockSnap.exists || block.activeReleaseId !== releaseId) {
      transaction.update(releaseRef, { status: 'superseded', updatedAt: now, completedAt: now })
      return 'superseded'
    }

    const counts = { ...release.counts, ...finalCounts }
    const status = counts.failed > 0 ? 'partial' : 'completed'
    transaction.update(releaseRef, { status, counts, updatedAt: now, completedAt: now })
    if (isScoped(release.scope)) {
      finalizeScopedRelease({ transaction, release, releaseId, block, blockRef, revisionSnap, canarySnap, now })
      return status
    }

    // Field by field, so every other field (including Timestamps) is kept.
    const blockUpdate = {
      blockUpdatedAt: release.blockUpdatedAt,
      releasedRevision: release.revisionNumber,
      lastRevisionNumber: Math.max(block.lastRevisionNumber ?? 0, release.revisionNumber),
      lastReleaseId: releaseId,
      activeReleaseId: null,
      canary: null,
    }
    for (const field of core.BLOCK_REVISION_DEFINITION_FIELDS) {
      blockUpdate[field] = release.definition?.[field] !== undefined
        ? release.definition[field]
        : Firestore.FieldValue.delete()
    }
    if (block.draftRevision === release.revisionNumber)
      blockUpdate.draftRevision = null
    transaction.update(blockRef, blockUpdate)

    if (revisionSnap.exists) {
      transaction.update(revisionSnap.ref, {
        status: 'released',
        releaseId,
        releasedAt: now,
        releasedBy: release.startedBy || null,
        updatedAt: now,
      })
    }
    if (previousSnap?.exists && previousSnap.data()?.status === 'released')
      transaction.update(previousSnap.ref, { status: 'superseded', supersededBy: release.revisionNumber, updatedAt: now })
    if (canarySnap?.exists && canarySnap.data()?.status === 'canary' && canaryNumber !== previousNumber)
      transaction.update(canarySnap.ref, { status: 'superseded', supersededBy: release.revisionNumber, updatedAt: now })
    return status
  })
}

const addCounts = async (orgId, releaseId, tally) => {
  const releaseRef = releaseRefOf(orgId, releaseId)
  await db.runTransaction(async (transaction) => {
    const release = (await transaction.get(releaseRef)).data() || {}
    const counts = { planned: 0, done: 0, skipped: 0, failed: 0, ...release.counts }
    for (const [key, value] of Object.entries(tally))
      counts[key] = (counts[key] || 0) + value
    transaction.update(releaseRef, { counts, chunkAttempts: 0, updatedAt: nowIso() })
  })
}

// Processes one chunk of a release. Pub/Sub may deliver a message more than
// once; only pending targets are processed, so a repeat does no harm.
const runReleaseChunk = async ({ orgId, releaseId }) => {
  const core = await corePromise
  const releaseRef = releaseRefOf(orgId, releaseId)
  const releaseSnap = await releaseRef.get()
  if (!releaseSnap.exists)
    return 'missing'
  const release = releaseSnap.data() || {}
  if (release.status !== 'running')
    return release.status

  const chunkAttempts = (release.chunkAttempts || 0) + 1
  if (chunkAttempts > BLOCK_RELEASE_MAX_CHUNK_ATTEMPTS) {
    await releaseRef.update({ status: 'failed', error: `Stopped after ${BLOCK_RELEASE_MAX_CHUNK_ATTEMPTS} failed worker runs.`, updatedAt: nowIso() })
    return 'failed'
  }
  await releaseRef.update({ chunkAttempts, updatedAt: nowIso() })

  const pending = await releaseRef.collection('targets')
    .where('status', '==', 'pending')
    .limit(BLOCK_RELEASE_CHUNK_SIZE)
    .get()

  const tally = { done: 0, skipped: 0, failed: 0 }
  for (const targetDoc of pending.docs) {
    try {
      const status = await processTarget({ orgId, releaseId, release, targetDoc })
      if (status)
        tally[status] += 1
    }
    catch (error) {
      if (error instanceof ReleaseSuperseded) {
        await addCounts(orgId, releaseId, tally)
        await markSuperseded(orgId, releaseId, release)
        logger.warn(`Block release ${releaseId} was superseded by a newer release`)
        return 'superseded'
      }
      tally.failed += 1
      await targetDoc.ref.update({
        status: 'failed',
        error: String(error?.message || error),
        attempts: (targetDoc.data()?.attempts || 0) + 1,
        updatedAt: nowIso(),
      })
      logger.error(`Block release ${releaseId} failed on ${targetDoc.data()?.path}`, { error: error?.message })
    }
  }
  await addCounts(orgId, releaseId, tally)

  const remaining = await releaseRef.collection('targets').where('status', '==', 'pending').limit(1).get()
  if (!remaining.empty) {
    await publishRelease(orgId, releaseId)
    return 'continued'
  }
  return finalizeRelease(core, { orgId, releaseId })
}

exports.blockReleaseWorker = onMessagePublished(
  { topic: BLOCK_RELEASE_TOPIC, retry: true, timeoutSeconds: 540, memory: '512MiB' },
  async (event) => {
    const { orgId, releaseId } = event.data?.message?.json || {}
    if (!orgId || !releaseId)
      return
    const result = await runReleaseChunk({ orgId, releaseId })
    logger.log(`Block release ${releaseId}: ${result}`)
  },
)

// A definition written straight to the library block (the Firebase console,
// an older client, a history restore) still reaches every page, but as a
// tracked, resumable release. It is unchecked: the write has already happened.
// `eventId` makes a redelivered trigger a no-op.
const startImplicitRelease = async ({ orgId, blockId, beforeData, afterData, eventId }) => {
  const core = await corePromise
  const releaseId = `implicit-${String(eventId || '').replace(/[^\w-]/g, '') || Date.now()}`
  const releaseRef = releaseRefOf(orgId, releaseId)
  const blockRef = blockRefOf(orgId, blockId)
  if ((await releaseRef.get()).exists)
    return { releaseId, status: 'duplicate' }

  const targets = await planBlockTargets(db, orgId, blockId)
  const now = nowIso()
  const definition = core.pickBlockDefinition(afterData)
  // Targets first and the claim last, so a failure here never leaves the block
  // locked by a release that can't run.
  await writeTargets(releaseRef, targets)

  const revisionNumber = await db.runTransaction(async (transaction) => {
    if ((await transaction.get(releaseRef)).exists)
      return 'duplicate'
    const blockSnap = await transaction.get(blockRef)
    if (!blockSnap.exists)
      return null
    const block = blockSnap.data() || {}
    const released = core.isRevisionNumber(block.releasedRevision) ? block.releasedRevision : null
    const draft = core.isRevisionNumber(block.draftRevision) ? block.draftRevision : 0
    const last = core.isRevisionNumber(block.lastRevisionNumber) ? block.lastRevisionNumber : (released ?? 0)
    const number = Math.max(last, released ?? 0, draft) + 1

    if (released === null) {
      transaction.set(revisionRefOf(blockRef, 0), {
        number: 0,
        status: 'released',
        definition: core.pickBlockDefinition(beforeData),
        baseNumber: null,
        source: 'baseline',
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        releasedAt: now,
      })
    }
    transaction.set(revisionRefOf(blockRef, number), {
      number,
      status: 'releasing',
      definition,
      baseNumber: released ?? 0,
      source: 'implicit',
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      releaseId,
    })
    // Taking activeReleaseId stops any release still running for this block.
    transaction.update(blockRef, { activeReleaseId: releaseId, lastRevisionNumber: number })
    transaction.set(releaseRef, {
      blockId,
      revisionNumber: number,
      previousRevisionNumber: released ?? 0,
      kind: 'release',
      scope: 'all',
      implicit: true,
      status: 'running',
      definition,
      beforeDefinition: core.pickBlockDefinition(beforeData),
      blockUpdatedAt: afterData.blockUpdatedAt || now,
      counts: { planned: targets.length, done: 0, skipped: 0, failed: 0 },
      startedBy: null,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      chunkAttempts: 0,
    })
    return number
  })
  if (revisionNumber === null)
    return { releaseId, status: 'missing' }
  if (revisionNumber === 'duplicate')
    return { releaseId, status: 'duplicate' }

  await publishRelease(orgId, releaseId)
  logger.warn(`Block ${blockId} definition was written directly; started implicit release ${releaseId} of revision ${revisionNumber}`, { targets: targets.length })
  return { releaseId, status: 'running', revisionNumber }
}

module.exports.BLOCK_RELEASE_TOPIC = BLOCK_RELEASE_TOPIC
module.exports.BLOCK_RELEASE_CHUNK_SIZE = BLOCK_RELEASE_CHUNK_SIZE
module.exports.runReleaseChunk = runReleaseChunk
module.exports.startImplicitRelease = startImplicitRelease
