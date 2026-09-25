// Library block revisions. Editing a block's definition saves a draft
// revision here; only a release (see block-revisions-and-releases-plan.md)
// changes the definition pages use. Keep identical to
// edge/functions/cmsBlockRevisions.js.
const {
  logger,
  db,
  onCall,
  HttpsError,
  permissionCheck,
} = require('./config.js')

const corePromise = import('./helpers/cmsBlockRevisions.mjs')

const DOC_ID_PATTERN = /^[^/]{1,1500}$/
const BASE_HASH_PATTERN = /^[0-9a-f]{16}$/

const SOURCE_LABELS = { 'editor': 'the Block Editor', 'import': 'an import', 'page-editor': 'the page editor' }

// Refuses a save whose starting point is out of date. The details let the
// caller show what changed and save again on top of it.
const baseChangedError = (core, { blockId, block, draft, draftNumber, current, currentHash, definition }) => {
  const where = draft
    ? `its unreleased draft (revision ${draftNumber}, saved from ${SOURCE_LABELS[draft.source] || draft.source || 'an unknown source'}${draft.updatedAt ? ` at ${draft.updatedAt}` : ''})`
    : 'its released definition'
  const wouldReplace = core.changedDefinitionFields(current, definition)
  return new HttpsError(
    'failed-precondition',
    `Block "${blockId}" changed since you loaded it: ${where} is different. Saving now would replace ${wouldReplace.join(', ') || 'it'}. Reload the block to see the changes, or confirm to replace them.`,
    {
      reason: 'base-changed',
      currentHash,
      releasedRevision: core.isRevisionNumber(block.releasedRevision) ? block.releasedRevision : 0,
      draftRevision: draft ? draftNumber : null,
      draftSource: draft?.source || null,
      draftUpdatedBy: draft ? (draft.updatedBy || draft.createdBy || null) : null,
      draftUpdatedAt: draft ? (draft.updatedAt || draft.createdAt || null) : null,
      wouldReplace,
    },
  )
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const requireDocId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !DOC_ID_PATTERN.test(id) || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

const assertRevisionCaller = async (request) => {
  const uid = request?.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  const orgId = requireDocId(request.data.orgId, 'organization id')
  const blockId = requireDocId(request.data.blockId, 'block id')
  if (!await permissionCheck(uid, 'write', `organizations/${orgId}/blocks`))
    throw new HttpsError('permission-denied', 'Not allowed to edit blocks in this organization.')
  const blockRef = db.collection('organizations').doc(orgId).collection('blocks').doc(blockId)
  return { uid, orgId, blockId, blockRef }
}

const revisionRef = (blockRef, number) => blockRef.collection('revisions').doc(String(number))

// Revision 0 is the definition the block had before its first revision. It
// is created lazily, so existing blocks need no migration.
const releasedRevisionNumber = (core, block) =>
  (core.isRevisionNumber(block.releasedRevision) ? block.releasedRevision : null)

const baselineRevision = (core, block, now) => ({
  number: 0,
  status: 'released',
  definition: core.pickBlockDefinition(block),
  baseNumber: null,
  source: 'baseline',
  createdBy: null,
  createdAt: now,
  updatedAt: now,
  releasedAt: now,
})

// Creates or updates the block's single draft revision. Saving the released
// definition back discards the draft instead.
exports.saveBlockDraft = onCall({ timeoutSeconds: 60 }, async (request) => {
  const core = await corePromise
  const { uid, blockId, blockRef } = await assertRevisionCaller(request)
  const data = request.data || {}

  if (!isPlainObject(data.definition))
    throw new HttpsError('invalid-argument', 'A block definition is required.')
  const definition = core.pickBlockDefinition(data.definition)
  if (typeof definition.content !== 'string')
    throw new HttpsError('invalid-argument', 'A block definition needs string content.')
  const source = data.source
  if (!core.BLOCK_REVISION_SOURCES.includes(source))
    throw new HttpsError('invalid-argument', `Unknown revision source "${source}".`)
  const baseRevision = data.baseRevision ?? null
  if (baseRevision !== null && !core.isRevisionNumber(baseRevision))
    throw new HttpsError('invalid-argument', 'baseRevision must be a revision number.')
  // The fingerprint of the definition the caller started from: the open
  // draft if there was one, otherwise the released block.
  const baseHash = data.baseHash
  if (typeof baseHash !== 'string' || !BASE_HASH_PATTERN.test(baseHash))
    throw new HttpsError('invalid-argument', 'baseHash is required. Reload the block and save again.')

  const result = await db.runTransaction(async (transaction) => {
    const blockSnap = await transaction.get(blockRef)
    if (!blockSnap.exists)
      throw new HttpsError('not-found', `Block "${blockId}" does not exist.`)
    const block = blockSnap.data() || {}
    const now = new Date().toISOString()

    let released = releasedRevisionNumber(core, block)
    // A draft is always edited from the released revision. Revision 0 exists
    // implicitly until it is written, so a missing pointer means 0.
    if (baseRevision !== null && baseRevision !== (released ?? 0)) {
      throw new HttpsError('failed-precondition', `Block "${blockId}" was released as revision ${released} after you started editing revision ${baseRevision}. Reload the block before saving.`)
    }

    const draftNumber = core.isRevisionNumber(block.draftRevision) ? block.draftRevision : null
    const draftSnap = draftNumber === null ? null : await transaction.get(revisionRef(blockRef, draftNumber))
    const openDraft = draftSnap?.exists && draftSnap.data()?.status === 'draft'
    const draft = openDraft ? draftSnap.data() : null

    // Never overwrite changes the caller didn't see. Saving exactly what is
    // already there is harmless (a repeated save), so it isn't refused.
    const current = draft ? draft.definition : block
    if (core.blockDefinitionsEqual(definition, current) && draft)
      return { status: 'unchanged', releasedRevision: released ?? 0, draftRevision: draftNumber }
    const currentHash = core.blockDefinitionHash(current)
    if (baseHash !== currentHash)
      throw baseChangedError(core, { blockId, block, draft, draftNumber, current, currentHash, definition })

    const blockUpdate = {}
    if (released === null) {
      released = 0
      transaction.set(revisionRef(blockRef, 0), baselineRevision(core, block, now))
      blockUpdate.releasedRevision = 0
    }

    if (core.blockDefinitionsEqual(definition, block)) {
      if (openDraft) {
        transaction.update(draftSnap.ref, { status: 'discarded', discardedBy: uid, discardedAt: now, updatedAt: now })
      }
      if (draftNumber !== null)
        blockUpdate.draftRevision = null
      if (Object.keys(blockUpdate).length)
        transaction.update(blockRef, blockUpdate)
      return { status: openDraft ? 'discarded' : 'unchanged', releasedRevision: released, draftRevision: null }
    }

    let number = draftNumber
    if (openDraft) {
      // Keep the definition this save replaces, so a hand edit is never lost.
      transaction.set(draftSnap.ref.collection('replaced').doc(), {
        definition: draft.definition,
        source: draft.source || null,
        savedBy: draft.updatedBy || draft.createdBy || null,
        savedAt: draft.updatedAt || draft.createdAt || null,
        replacedBy: uid,
        replacedBySource: source,
        replacedAt: now,
      })
      transaction.update(draftSnap.ref, { definition, baseNumber: released, source, updatedBy: uid, updatedAt: now })
    }
    else {
      const last = core.isRevisionNumber(block.lastRevisionNumber) ? block.lastRevisionNumber : released
      number = Math.max(last, released, draftNumber ?? 0) + 1
      transaction.set(revisionRef(blockRef, number), {
        number,
        status: 'draft',
        definition,
        baseNumber: released,
        source,
        createdBy: uid,
        createdAt: now,
        updatedBy: uid,
        updatedAt: now,
      })
      blockUpdate.lastRevisionNumber = number
    }
    blockUpdate.draftRevision = number
    transaction.update(blockRef, blockUpdate)
    return { status: 'saved', releasedRevision: released, draftRevision: number }
  })

  logger.log(`Block ${blockId} draft ${result.status} by ${uid} (source ${source})`, result)
  return result
})

// Discards the block's draft revision. `draftRevision` and `baseHash` must
// name the draft the caller saw, so a newer draft, or a later save of the same
// draft by someone else, is never discarded.
exports.discardBlockDraft = onCall({ timeoutSeconds: 60 }, async (request) => {
  const core = await corePromise
  const { uid, blockId, blockRef } = await assertRevisionCaller(request)
  const expected = request.data?.draftRevision
  if (!core.isRevisionNumber(expected))
    throw new HttpsError('invalid-argument', 'draftRevision must be a revision number.')
  const baseHash = request.data?.baseHash
  if (typeof baseHash !== 'string' || !BASE_HASH_PATTERN.test(baseHash))
    throw new HttpsError('invalid-argument', 'baseHash is required. Reload the block and discard again.')

  const result = await db.runTransaction(async (transaction) => {
    const blockSnap = await transaction.get(blockRef)
    if (!blockSnap.exists)
      throw new HttpsError('not-found', `Block "${blockId}" does not exist.`)
    const block = blockSnap.data() || {}
    if (block.draftRevision !== expected)
      throw new HttpsError('failed-precondition', `Block "${blockId}" no longer has draft revision ${expected}. Reload the block.`)

    const draftSnap = await transaction.get(revisionRef(blockRef, expected))
    const draft = (draftSnap.exists && draftSnap.data()?.status === 'draft') ? draftSnap.data() : null
    // The draft may have been saved again since the caller loaded it.
    if (draft && core.blockDefinitionHash(draft.definition) !== baseHash) {
      throw new HttpsError('failed-precondition', `Draft revision ${expected} of block "${blockId}" was saved again since you loaded it${draft.updatedAt ? ` (at ${draft.updatedAt})` : ''}. Reload the block before discarding it.`, {
        reason: 'base-changed',
        currentHash: core.blockDefinitionHash(draft.definition),
        draftRevision: expected,
        draftSource: draft.source || null,
        draftUpdatedBy: draft.updatedBy || draft.createdBy || null,
        draftUpdatedAt: draft.updatedAt || draft.createdAt || null,
      })
    }
    const now = new Date().toISOString()
    if (draft)
      transaction.update(draftSnap.ref, { status: 'discarded', discardedBy: uid, discardedAt: now, updatedAt: now })
    transaction.update(blockRef, { draftRevision: null })
    return { status: 'discarded', releasedRevision: releasedRevisionNumber(core, block), draftRevision: null }
  })

  logger.log(`Block ${blockId} draft ${expected} discarded by ${uid}`)
  return result
})
