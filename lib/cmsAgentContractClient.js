// Hub-side helpers for the agent contract review screen
// (docs/features/cms/agent-contracts-design.md, phase 4). The operation specs
// come from cmsOperations.js; the explanation notes and the check go through
// callables, with the Firestore wrapper (`edgeFirebase`) passed in so this
// stays testable without Vue.
import { CMS_OPERATION_PROBLEMS, CMS_OPERATION_SPECS, CMS_OPERATION_TYPES, CONTRACT_NOTE_MAX } from './cmsOperations.js'

export { CMS_OPERATION_PROBLEMS, CMS_OPERATION_SPECS, CONTRACT_NOTE_MAX }

const callableData = response => ((response && typeof response === 'object' && 'data' in response) ? response.data : response) || {}

export const listContractNotes = async ({ edgeFirebase }) =>
  callableData(await edgeFirebase.runFunction('listAgentContractNotes', {}))

export const setContractNote = async ({ edgeFirebase, key, text }) =>
  callableData(await edgeFirebase.runFunction('setAgentContractNote', { key, text }))

export const clearContractNote = async ({ edgeFirebase, key }) =>
  callableData(await edgeFirebase.runFunction('clearAgentContractNote', { key }))

// Checks an operation as the signed-in user, in an organization. Writes nothing.
export const checkOperation = async ({ edgeFirebase, orgId, operation }) =>
  callableData(await edgeFirebase.runFunction('cms-checkOperation', { orgId, operation }))

const AREA_TITLES = { theme: 'Themes', site: 'Sites', page: 'Pages', post: 'Posts', block: 'Blocks' }

// Operations grouped by area, in CMS_OPERATION_TYPES order: [{ area, title, types }].
export const operationGroups = (specs = CMS_OPERATION_SPECS) => {
  const groups = []
  for (const type of CMS_OPERATION_TYPES.filter(name => specs[name])) {
    const area = type.split('.')[0]
    let group = groups.find(item => item.area === area)
    if (!group) {
      group = { area, title: AREA_TITLES[area] || area, types: [] }
      groups.push(group)
    }
    group.types.push(type)
  }
  return groups
}

// The text agents read for one key: the note when there is one, else the
// default. `history` lists the note's earlier versions, newest first.
export const explanationFor = (key, defaults = {}, notes = []) => {
  const note = notes.find(item => item.key === key) || null
  const edited = typeof note?.text === 'string' && note.text.trim() !== ''
  return {
    key,
    text: edited ? note.text : (defaults[key] || ''),
    defaultText: defaults[key] || '',
    edited,
    updatedBy: note?.updatedBy || null,
    updatedAt: note?.updatedAt || null,
    history: Array.isArray(note?.history) ? note.history : [],
  }
}

// The control the generated form shows for an input.
export const inputControl = (field = {}) => {
  if (Array.isArray(field.values))
    return 'select'
  if (field.type === 'boolean')
    return 'switch'
  if (field.type === 'integer')
    return 'number'
  if (field.type === 'object' || field.type === 'list' || field.type === 'json')
    return 'json'
  if (field.type === 'text' && field.max && field.max > 200)
    return 'textarea'
  return 'text'
}

// Spec text with `code` spans, as [{ text, code }] for rendering without
// Markdown.
export const codeSegments = text => String(text || '').split('`').map((part, index) => ({ text: part, code: index % 2 === 1 })).filter(part => part.text)

// A starting operation for the check panel: the type and its required inputs.
export const sampleOperation = (type, specs = CMS_OPERATION_SPECS) => {
  const operation = { type }
  for (const [name, field] of Object.entries(specs[type]?.input || {})) {
    if (!field.required)
      continue
    operation[name] = field.type === 'object' ? {} : field.type === 'list' ? [] : field.type === 'integer' ? 0 : ''
  }
  return operation
}
