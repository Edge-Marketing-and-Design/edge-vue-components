// Import-screen decisions around the shared block validator, and the one
// check a block file goes through before import: the Blocks manager and
// scripts/cms/validate-block.mjs both call checkImportedBlock, so a file that
// passes the command-line checker imports, and the reverse.
import { HUB_REQUIRED_BLOCK_KEYS, validateBlock } from './cmsBlockValidation.js'

// Shared-validator errors reject a file before anything is written; warnings
// are listed after import and never block. Enabled 2026-09-24 after the
// production block audit found no new-rule errors. The Hub's own hard
// failures (missing keys, invalid type or themes) apply regardless.
export const ENFORCE_SHARED_BLOCK_VALIDATION = true

// Unknown theme ids are resolved by their own confirmation, so they are not
// repeated in the findings list.
const HANDLED_ELSEWHERE = new Set(['themes.unknown'])

export const collectImportFindings = (result, { enforce = ENFORCE_SHARED_BLOCK_VALIDATION } = {}) => {
  const errors = (result?.errors || []).filter(issue => !HANDLED_ELSEWHERE.has(issue.code))
  const warnings = (result?.warnings || []).filter(issue => !HANDLED_ELSEWHERE.has(issue.code))
  return enforce
    ? { blocking: errors, notices: warnings }
    : { blocking: [], notices: [...errors, ...warnings] }
}

// Keeps the valid theme ids in order and reports the ones that will be dropped.
// Previously one unknown or empty id cleared every theme, valid ones included.
export const resolveImportedBlockThemes = (themes, knownThemeIds) => {
  const known = new Set(knownThemeIds || [])
  const kept = []
  const dropped = []
  for (const value of Array.isArray(themes) ? themes : []) {
    const themeId = String(value || '').trim()
    if (known.has(themeId)) {
      if (!kept.includes(themeId))
        kept.push(themeId)
    }
    else if (!dropped.includes(themeId)) {
      dropped.push(themeId)
    }
  }
  return { themes: kept, dropped }
}

// A rejected file's error carries its blocking findings so the results dialog
// can list each one.
export const createBlockCheckError = (blocking) => {
  const [first] = blocking
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : ''
  const error = new Error(`Block checks failed: ${first?.message || 'unknown error'}${more}`)
  error.issues = blocking
  return error
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

// The single-block shapes import accepts: a bare block, or
// `{ document: {...}, docId }`.
export const normalizeImportedDoc = (payload, fallbackDocId = '') => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid JSON payload. Expected an object.')

  if (payload.document && typeof payload.document === 'object' && !Array.isArray(payload.document)) {
    const normalized = { ...payload.document }
    if (!normalized.docId && payload.docId)
      normalized.docId = payload.docId
    if (!normalized.docId && fallbackDocId)
      normalized.docId = fallbackDocId
    return normalized
  }

  const normalized = { ...payload }
  if (!normalized.docId && fallbackDocId)
    normalized.docId = fallbackDocId
  return normalized
}

// Fills the Template v1/v2 fields import defaults.
export const normalizeImportedBlockVersion = (doc) => {
  const normalizedVersion = Number(doc?.templateVersion) === 2 ? 2 : 1
  doc.templateVersion = normalizedVersion
  if (typeof doc.template !== 'string')
    doc.template = (normalizedVersion === 2 && typeof doc.content === 'string') ? doc.content : ''
  if (!isPlainObject(doc.schema))
    doc.schema = {}
  if (!isPlainObject(doc.dataSources))
    doc.dataSources = {}
  return doc
}

// "Page", "Post" or both, from strings or picker objects.
export const normalizeBlockTypes = (value, { fallbackToPage = true } = {}) => {
  const hasExplicitTypeValue = !(
    value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0)
  )
  const rawTypes = Array.isArray(value) ? value : [value]
  const normalized = rawTypes
    .map((typeValue) => {
      if (typeValue && typeof typeValue === 'object') {
        const objectValue = typeValue.name ?? typeValue.value ?? typeValue.title ?? typeValue.label ?? ''
        return String(objectValue || '')
      }
      return String(typeValue || '')
    })
    .map(typeValue => typeValue.trim().toLowerCase())
    .map((typeValue) => {
      if (typeValue === 'page')
        return 'Page'
      if (typeValue === 'post')
        return 'Post'
      return ''
    })
    .filter(Boolean)
  const uniqueNormalized = [...new Set(normalized)]
  if (!uniqueNormalized.length && fallbackToPage && !hasExplicitTypeValue)
    return ['Page']
  return uniqueNormalized
}

// Everything import checks before it asks about themes or ids.
// - `hardError`: the file can't be imported at all (missing keys, bad type).
// - `blocking`: shared-validator errors, which reject the file.
// - `notices`: warnings, listed after import.
// - `doc`: the normalized block import would continue with.
// `requiredKeys` defaults to the keys the Hub's new-block schema requires.
export const checkImportedBlock = async (rawDoc, { knownThemeIds = null, renderTemplate = null, requiredKeys = HUB_REQUIRED_BLOCK_KEYS } = {}) => {
  // Validate the file as written, before the Hub fills in defaults.
  const validation = await validateBlock(isPlainObject(rawDoc) ? JSON.parse(JSON.stringify(rawDoc)) : rawDoc, { knownThemeIds, renderTemplate })
  const { blocking, notices } = collectImportFindings(validation)
  if (!isPlainObject(rawDoc))
    return { hardError: 'Invalid block document. Expected an object.', blocking, notices, doc: null }

  const doc = normalizeImportedBlockVersion(rawDoc)
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    return { hardError: `Missing required block key(s): ${missing.join(', ')}`, blocking, notices, doc }

  if (!Object.prototype.hasOwnProperty.call(doc, 'type')) {
    doc.type = ['Page']
  }
  else {
    const types = normalizeBlockTypes(doc.type, { fallbackToPage: false })
    if (!types.length)
      return { hardError: 'Invalid "type" value. Use "Page", "Post", or both.', blocking, notices, doc }
    doc.type = types
  }
  return { hardError: null, blocking, notices, doc }
}
