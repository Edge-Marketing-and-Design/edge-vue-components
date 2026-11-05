// Editor-only placeholders. Never save these values to the post or its page.
import { buildPostTypeFields, getPostPath, setPostPath } from './cmsPostTypes.js'
import { normalizeCmsPostStructure } from './cmsPostStructure.js'

const clone = value => JSON.parse(JSON.stringify(value))
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]))
const blankImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500" viewBox="0 0 1200 500"><rect width="1200" height="500" fill="#f1f5f9"/><rect x="548" y="175" width="104" height="88" rx="12" fill="none" stroke="#94a3b8" stroke-width="5"/><circle cx="579" cy="201" r="10" fill="#94a3b8"/><path d="m553 247 28-27 24 21 19-14 23 22" fill="none" stroke="#94a3b8" stroke-width="5"/><text x="600" y="312" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="24">Add an image</text></svg>')}`
const placeholder = (field) => {
  if (field.type === 'image')
    return blankImage
  if (field.type === 'richtext')
    return `<p>${escapeHtml(field.label || field.field)} goes here. Select this area to start writing.</p>`
  if (field.type === 'boolean')
    return false
  if (field.type === 'number')
    return 0
  if (field.type === 'array') {
    const children = Array.isArray(field.schema) ? field.schema : Object.entries(field.schema || {}).map(([key, child]) => ({ ...child, field: key }))
    return children.length ? [Object.fromEntries(children.map(child => [child.field, placeholder(child)]))] : []
  }
  return field.label || field.field
}
export const buildPostEntryPreviewBlock = (page, blockId, post) => {
  const original = (page?.postContent || []).find(block => block.id === blockId)
  if (!original)
    return null
  const block = clone(original)
  const values = clone(post || {})
  for (const field of buildPostTypeFields(page)) {
    const current = getPostPath(values, field.field)
    if (current === undefined || current === null || current === '' || (Array.isArray(current) && !current.length))
      setPostPath(values, field.field, (field.default && (!Array.isArray(field.default) || field.default.length)) ? field.default : placeholder(field))
  }
  block.values = { ...block.values }
  for (const [alias, source] of Object.entries(block.dataSources || {})) {
    if (source?.path === 'posts') {
      block.dataSources[alias] = { value: [values] }
      block.values[alias] = [values]
      if (block.meta)
        delete block.meta[alias]
    }
  }
  return block
}
export const postEntryPreviewRows = (page) => {
  let next = 0
  const blocks = (page?.postContent || []).filter(block => page?.postType?.enabled !== true || block.useForCustomPost === true)
  return normalizeCmsPostStructure({ structure: page?.postStructure, contentIds: blocks.map(block => block.id), createId: () => `entry-preview-${next++}` })
    .filter(row => row.columns.some(column => column.blocks.length))
}
