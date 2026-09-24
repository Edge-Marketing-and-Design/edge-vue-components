// Hub-side reads and writes for library block revisions. The Firestore
// wrapper (`edgeFirebase`) is passed in, so this stays testable without Vue.
import {
  applyBlockDefinition,
  blockWithDraftDefinition,
  isRevisionNumber,
  planBlockSave,
} from './cmsBlockRevisions.js'

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
    return { stored: null, draft: null, view: null }
  let draft = null
  if (isRevisionNumber(stored.draftRevision)) {
    const revision = await readDoc(edgeFirebase, blockRevisionsPath(organizationDocPath, blockId), String(stored.draftRevision))
    if (revision?.status === 'draft')
      draft = revision
  }
  return { stored, draft, view: blockWithDraftDefinition(stored, draft) }
}

const callableData = response => ((response && typeof response === 'object' && 'data' in response) ? response.data : response) || {}

// Saves an edit to an existing library block:
// - changed metadata is written to the library block directly;
// - a changed definition becomes the block's draft revision;
// - a definition matching the released one again discards the draft.
// The live definition, and therefore every page, is left untouched.
// Returns the editor view of the saved block and the revision outcome.
export const saveLibraryBlockEdit = async ({ edgeFirebase, organizationDocPath, orgId, blockId, nextDoc, source }) => {
  const blocksPath = `${organizationDocPath}/blocks`
  const stored = await readDoc(edgeFirebase, blocksPath, blockId)
  if (!stored)
    throw new Error(`Block "${blockId}" no longer exists.`)

  const plan = planBlockSave({ storedDoc: stored, nextDoc })
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
    })
    revision = callableData(response)
  }

  const view = applyBlockDefinition({ ...stored, ...plan.metadataChanges }, plan.definition)
  view.docId = blockId
  view.releasedRevision = revision.releasedRevision ?? null
  view.draftRevision = revision.draftRevision ?? null
  return { view, revision, metadataChanges: plan.metadataChanges }
}

export const discardLibraryBlockDraft = async ({ edgeFirebase, orgId, blockId, draftRevision }) =>
  callableData(await edgeFirebase.runFunction('cms-discardBlockDraft', { orgId, blockId, draftRevision }))
