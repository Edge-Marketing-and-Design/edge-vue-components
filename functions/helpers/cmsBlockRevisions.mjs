// Block revisions: a library block's definition changes only through a
// release, while its metadata saves directly. This module is the one place
// that decides which fields are which.
//
// Shared by the Hub (edge/lib/cmsBlockRevisions.js) and Cloud Functions
// (edge/functions/helpers/cmsBlockRevisions.mjs and
// functions/helpers/cmsBlockRevisions.mjs). Keep the three copies
// byte-identical; tests/cmsBlockRevisions.test.mjs enforces it.

// The fields a revision holds. All but `values` propagate to instances;
// library `values` are what new placements copy.
export const BLOCK_REVISION_DEFINITION_FIELDS = Object.freeze([
  'content',
  'template',
  'templateVersion',
  'schema',
  'dataSources',
  'isOverrideBlock',
  'meta',
  'values',
])

// Pointers the revision callables and the release worker own on the library
// block.
export const BLOCK_REVISION_POINTER_FIELDS = Object.freeze([
  'releasedRevision',
  'draftRevision',
  'lastRevisionNumber',
  'activeReleaseId',
  'lastReleaseId',
])

export const BLOCK_REVISION_SOURCES = Object.freeze(['editor', 'import', 'page-editor', 'agent'])

// Fields written by the Firestore wrapper or other bookkeeping. They are never
// treated as metadata edits.
const BOOKKEEPING_FIELDS = new Set([
  'docId',
  'uid',
  'last_updated',
  'doc_created_at',
  'version',
  'blockUpdatedAt',
  ...BLOCK_REVISION_POINTER_FIELDS,
])

const DEFINITION_FIELD_SET = new Set(BLOCK_REVISION_DEFINITION_FIELDS)
const OBJECT_DEFINITION_FIELDS = new Set(['schema', 'dataSources', 'meta', 'values'])

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

// Key-order independent serialization, so reordered keys compare equal.
export const canonicalJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value && typeof value === 'object') {
    const plain = typeof value.toJSON === 'function' ? value.toJSON() : value
    if (plain !== value)
      return canonicalJson(plain)
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

export const isRevisionNumber = value => Number.isInteger(value) && value >= 0

// The definition fields present on a document, cloned.
export const pickBlockDefinition = (doc) => {
  const definition = {}
  if (!isPlainObject(doc))
    return definition
  for (const field of BLOCK_REVISION_DEFINITION_FIELDS) {
    if (doc[field] !== undefined)
      definition[field] = clone(doc[field])
  }
  return definition
}

// A draft replaces the block's whole definition: a release copies it field by
// field and deletes the fields it lacks. So a save that leaves a field out
// keeps the base definition's (the open draft, else the released block), and
// sending `null` is how a field is removed on purpose. Template v2 keeps
// `template` equal to `content`: a save without `template` takes its
// content, never the base's older template.
export const completeBlockDefinition = (requested, base) => {
  const definition = pickBlockDefinition(requested)
  const baseDefinition = pickBlockDefinition(base)
  const templateVersion = Number(definition.templateVersion ?? baseDefinition.templateVersion)
  for (const field of BLOCK_REVISION_DEFINITION_FIELDS) {
    if (definition[field] === null) {
      delete definition[field]
      continue
    }
    if (definition[field] !== undefined)
      continue
    if (field === 'template' && templateVersion === 2 && typeof definition.content === 'string')
      definition.template = definition.content
    else if (baseDefinition[field] !== undefined)
      definition[field] = baseDefinition[field]
  }
  return definition
}

// Editors fill in empty defaults (`schema: {}`, `values: {}`, a blank v1
// `template`) that stored blocks may lack. Those differences are not edits.
const normalizeDefinitionForCompare = (doc) => {
  const definition = pickBlockDefinition(doc)
  for (const field of Object.keys(definition)) {
    const value = definition[field]
    const empty = value === null
      || (OBJECT_DEFINITION_FIELDS.has(field) && isPlainObject(value) && !Object.keys(value).length)
      || (field === 'template' && value === '')
      || (field === 'isOverrideBlock' && value === false)
      || (field === 'templateVersion' && Number(value) !== 2)
    if (empty)
      delete definition[field]
  }
  if (definition.templateVersion !== undefined)
    definition.templateVersion = 2
  return definition
}

export const blockDefinitionsEqual = (a, b) =>
  canonicalJson(normalizeDefinitionForCompare(a)) === canonicalJson(normalizeDefinitionForCompare(b))

// A 64-bit FNV-1a hash as 16 hex characters. It detects change; it is not a
// security measure. Pure JavaScript, so the browser and Functions agree.
const hashString = (text) => {
  let high = 0xCBF29CE4
  let low = 0x84222325
  for (let index = 0; index < text.length; index += 1) {
    low = (low ^ text.charCodeAt(index)) >>> 0
    // Multiply the 64-bit value by the FNV prime 0x100000001B3.
    const lowProduct = low * 0x1B3
    const carry = Math.floor(lowProduct / 0x100000000)
    high = (high * 0x1B3 + (low << 8) + carry) >>> 0
    low = lowProduct >>> 0
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')
}

// Fingerprint of a block's definition, ignoring the empty defaults that
// blockDefinitionsEqual ignores. A save sends the fingerprint of the
// definition it started from, so the server can refuse it when the block or
// its draft changed in the meantime.
export const blockDefinitionHash = doc => hashString(canonicalJson(normalizeDefinitionForCompare(doc)))

// The definition fields whose values differ between two documents.
export const changedDefinitionFields = (a, b) => {
  const left = normalizeDefinitionForCompare(a)
  const right = normalizeDefinitionForCompare(b)
  return BLOCK_REVISION_DEFINITION_FIELDS
    .filter(field => canonicalJson(left[field]) !== canonicalJson(right[field]))
}

// A copy of `doc` whose definition fields are exactly `definition`.
export const applyBlockDefinition = (doc, definition) => {
  const next = clone(isPlainObject(doc) ? doc : {})
  for (const field of BLOCK_REVISION_DEFINITION_FIELDS)
    delete next[field]
  return { ...next, ...pickBlockDefinition(definition) }
}

// Metadata keys whose value differs between the stored and the next document.
// Keys missing from `nextDoc` are left alone: the Firestore wrapper's partial
// update can't delete fields.
export const diffBlockMetadata = (storedDoc, nextDoc) => {
  const changes = {}
  if (!isPlainObject(nextDoc))
    return changes
  const stored = isPlainObject(storedDoc) ? storedDoc : {}
  for (const [key, value] of Object.entries(nextDoc)) {
    if (value === undefined || DEFINITION_FIELD_SET.has(key) || BOOKKEEPING_FIELDS.has(key))
      continue
    if (canonicalJson(value) !== canonicalJson(stored[key]))
      changes[key] = clone(value)
  }
  return changes
}

// How to save an existing library block. The stored document always holds
// the released definition.
// - metadataChanges: write directly to the library block.
// - draftAction: 'save' (the definition differs from the released one),
//   'discard' (it matches again and a draft exists) or 'none'.
export const planBlockSave = ({ storedDoc, nextDoc }) => {
  const definition = pickBlockDefinition(nextDoc)
  const definitionChanged = !blockDefinitionsEqual(storedDoc, nextDoc)
  const hasDraft = isRevisionNumber(storedDoc?.draftRevision)
  let draftAction = 'none'
  if (definitionChanged)
    draftAction = 'save'
  else if (hasDraft)
    draftAction = 'discard'
  return {
    metadataChanges: diffBlockMetadata(storedDoc, nextDoc),
    definition,
    draftAction,
  }
}

// What the Block Editor shows: the library block with the draft revision's
// definition in place of the released one.
export const blockWithDraftDefinition = (storedDoc, draftRevisionDoc) => {
  if (!isPlainObject(draftRevisionDoc) || draftRevisionDoc.status !== 'draft' || !isPlainObject(draftRevisionDoc.definition))
    return clone(storedDoc)
  return applyBlockDefinition(storedDoc, draftRevisionDoc.definition)
}

// A page preview that shows unreleased work: each library block with an open
// draft is replaced by the block with its draft definition, as the Block
// Editor shows it. `draftRevisionDocs` maps block ids to their draft revision
// documents. Returns { blocks, draftBlockIds }.
export const blocksWithDraftDefinitions = (blocksById = {}, draftRevisionDocs = {}) => {
  const blocks = {}
  const draftBlockIds = []
  for (const [blockId, block] of Object.entries(isPlainObject(blocksById) ? blocksById : {})) {
    const draft = draftRevisionDocs?.[blockId]
    const usable = isRevisionNumber(block?.draftRevision) && isPlainObject(draft) && draft.status === 'draft' && draft.number === block.draftRevision
    blocks[blockId] = usable ? blockWithDraftDefinition(block, draft) : clone(block)
    if (usable)
      draftBlockIds.push(blockId)
  }
  return { blocks, draftBlockIds }
}
