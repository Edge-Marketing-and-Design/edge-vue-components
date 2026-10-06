// Hub-side reads and writes for library block revisions. The Firestore
// wrapper (`edgeFirebase`) is passed in, so this stays testable without Vue.
import {
  applyBlockDefinition,
  blockDefinitionHash,
  blockDefinitionsEqual,
  blockWithDraftDefinition,
  changedDefinitionFields,
  isRevisionNumber,
  planBlockSave,
} from './cmsBlockRevisions.js'

// A save or discard refused because the block, or its draft, changed after
// the caller loaded it. `error.details` says what changed; saving again with
// `details.currentHash` as the base replaces those changes deliberately.
export const isBlockBaseChangedError = error => error?.details?.reason === 'base-changed'

export const blockRevisionsPath = (organizationDocPath, blockId) =>
  `${organizationDocPath}/blocks/${blockId}/revisions`

const readDoc = async (edgeFirebase, collectionPath, docId) => {
  try {
    const doc = await edgeFirebase.getDocData(collectionPath, docId)
    return (doc && doc.success !== false) ? doc : null
  }
  catch {
    // getDocData throws when the document doesn't exist.
    return null
  }
}

export const releasedRevisionOf = doc => (isRevisionNumber(doc?.releasedRevision) ? doc.releasedRevision : 0)

// The library block as stored (released definition), its open draft revision
// if any, and the view an editor should show (the draft definition in place).
export const loadLibraryBlockForEditing = async ({ edgeFirebase, organizationDocPath, blockId }) => {
  const stored = await readDoc(edgeFirebase, `${organizationDocPath}/blocks`, blockId)
  if (!stored)
    return { stored: null, draft: null, view: null, baseHash: null }
  let draft = null
  if (isRevisionNumber(stored.draftRevision)) {
    const revision = await readDoc(edgeFirebase, blockRevisionsPath(organizationDocPath, blockId), String(stored.draftRevision))
    if (revision?.status === 'draft')
      draft = revision
  }
  // What an editor starts from: the draft if there is one, else the released
  // definition. Saves send its fingerprint as their base.
  return { stored, draft, view: blockWithDraftDefinition(stored, draft), baseHash: blockDefinitionHash(draft ? draft.definition : stored) }
}

const callableData = response => ((response && typeof response === 'object' && 'data' in response) ? response.data : response) || {}

// Saves an edit to an existing library block:
// - changed metadata is written to the library block directly;
// - a changed definition becomes the block's draft revision;
// - a definition matching the released one again discards the draft.
// The live definition, and therefore every page, is left untouched.
// `baseHash` is the fingerprint of the definition the caller started from
// (from loadLibraryBlockForEditing, or a previous save). A definition save is
// refused when the block or its draft changed since; see
// isBlockBaseChangedError.
// Returns the editor view of the saved block, the revision outcome, and the
// base for the next save.
export const saveLibraryBlockEdit = async ({ edgeFirebase, organizationDocPath, orgId, blockId, nextDoc, source, baseHash }) => {
  const blocksPath = `${organizationDocPath}/blocks`
  const stored = await readDoc(edgeFirebase, blocksPath, blockId)
  if (!stored)
    throw new Error(`Block "${blockId}" no longer exists.`)

  const plan = planBlockSave({ storedDoc: stored, nextDoc })
  if (plan.draftAction !== 'none' && typeof baseHash !== 'string')
    throw new Error(`Block "${blockId}" can't be saved without knowing which version it was edited from. Reload the block and try again.`)
  if (Object.keys(plan.metadataChanges).length) {
    const result = await edgeFirebase.changeDoc(blocksPath, blockId, plan.metadataChanges)
    if (result?.success === false)
      throw new Error(result.message || 'Failed to save the block details.')
  }

  let revision = {
    status: 'unchanged',
    releasedRevision: releasedRevisionOf(stored),
    draftRevision: isRevisionNumber(stored.draftRevision) ? stored.draftRevision : null,
  }
  if (plan.draftAction !== 'none') {
    const response = await edgeFirebase.runFunction('cms-saveBlockDraft', {
      orgId,
      blockId,
      definition: plan.definition,
      source,
      baseRevision: releasedRevisionOf(stored),
      baseHash,
    })
    revision = callableData(response)
  }
  // After a save the block's current definition is the saved one, unless the
  // draft was discarded (or never needed) and the released one applies.
  const nextBaseHash = (revision.draftRevision === null || revision.draftRevision === undefined)
    ? blockDefinitionHash(stored)
    : blockDefinitionHash(plan.definition)

  const view = applyBlockDefinition({ ...stored, ...plan.metadataChanges }, plan.definition)
  view.docId = blockId
  view.releasedRevision = revision.releasedRevision ?? null
  view.draftRevision = revision.draftRevision ?? null
  return { view, revision, metadataChanges: plan.metadataChanges, baseHash: nextBaseHash }
}

// `baseHash` is the fingerprint of the draft the caller loaded, so a draft
// saved again by someone else in the meantime isn't discarded.
export const discardLibraryBlockDraft = async ({ edgeFirebase, orgId, blockId, draftRevision, baseHash }) =>
  callableData(await edgeFirebase.runFunction('cms-discardBlockDraft', { orgId, blockId, draftRevision, baseHash }))

// Thrown when the user chose to keep the Hub's newer version instead of
// replacing it. Nothing was saved.
export class BlockSaveCancelledError extends Error {
  constructor(blockId) {
    super(`Not saved: block "${blockId}" changed since it was loaded, and its newer version was kept. Reload it to see the changes.`)
    this.name = 'BlockSaveCancelledError'
    this.cancelled = true
  }
}

// Runs `save(baseHash)`. If the block changed since `baseHash` was taken,
// asks `confirm(details, message)` whether to replace the newer version; if
// so, saves again on top of it, otherwise throws BlockSaveCancelledError.
export const saveWithBaseCheck = async ({ blockId, baseHash, save, confirm }) => {
  try {
    return await save(baseHash)
  }
  catch (error) {
    if (!isBlockBaseChangedError(error))
      throw error
    const replace = await confirm(error.details, String(error.message || ''))
    if (replace !== true)
      throw new BlockSaveCancelledError(blockId)
    return save(error.details.currentHash)
  }
}

// Exported block files record the version they were made from, so importing
// an older file over a block that changed since is caught.
export const BLOCK_EXPORT_BASE_KEY = 'cmsRevisionBase'
const BASE_HASH_PATTERN = /^[0-9a-f]{16}$/

// The base to embed in an exported block file. `definitionDoc` is the
// definition being exported (the draft's view, or the stored block).
export const blockExportBase = ({ definitionDoc, releasedRevision = null, draftRevision = null }) => ({
  hash: blockDefinitionHash(definitionDoc),
  releasedRevision: isRevisionNumber(releasedRevision) ? releasedRevision : null,
  draftRevision: isRevisionNumber(draftRevision) ? draftRevision : null,
  exportedAt: new Date().toISOString(),
})

// Removes the export base from an imported document and returns it, or null
// when the file doesn't carry a usable one.
export const takeImportBase = (doc) => {
  if (!doc || typeof doc !== 'object' || !(BLOCK_EXPORT_BASE_KEY in doc))
    return null
  const base = doc[BLOCK_EXPORT_BASE_KEY]
  delete doc[BLOCK_EXPORT_BASE_KEY]
  return (base && typeof base.hash === 'string' && BASE_HASH_PATTERN.test(base.hash)) ? base : null
}

// How to overwrite an existing block from an imported file.
// - A file that records its base is saved on that base; the server refuses
//   it if the block changed since the file was made.
// - A file without a base is checked here: if the block has an unreleased
//   draft the file doesn't match, `conflict` describes it and the caller must
//   ask before replacing it (then save on `conflict.currentHash`).
export const planImportOverwrite = ({ loaded, fileBase, nextDoc }) => {
  if (fileBase?.hash)
    return { baseHash: fileBase.hash, conflict: null }
  const draftDefinition = loaded?.draft?.definition
  if (draftDefinition && !blockDefinitionsEqual(nextDoc, draftDefinition)) {
    const draft = loaded.draft
    return {
      baseHash: null,
      conflict: {
        reason: 'base-changed',
        unknownBase: true,
        currentHash: loaded.baseHash,
        releasedRevision: isRevisionNumber(loaded.stored?.releasedRevision) ? loaded.stored.releasedRevision : 0,
        draftRevision: loaded.stored?.draftRevision ?? null,
        draftSource: draft.source || null,
        draftUpdatedBy: draft.updatedBy || draft.createdBy || null,
        draftUpdatedAt: draft.updatedAt || draft.createdAt || null,
        wouldReplace: changedDefinitionFields(draftDefinition, nextDoc),
      },
    }
  }
  return { baseHash: loaded?.baseHash ?? null, conflict: null }
}
