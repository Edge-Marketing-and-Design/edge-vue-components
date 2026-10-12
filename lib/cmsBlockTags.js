// Block tag options for the Hub's Block Editor, block picker and Blocks
// library, and the edits the tag list editor makes. The list itself is
// `cmsBlockTags` on the organization document; missing or empty means
// unrestricted, and every helper then keeps the behavior from before the
// list existed (options from the tags blocks already carry).
import { QUICK_PICKS_TAG, normalizeBlockTagList } from './cmsBlockValidation.js'

export { QUICK_PICKS_TAG, normalizeBlockTagList }

// The library filter option for blocks carrying a tag outside the list.
export const NOT_IN_LIST_FILTER_VALUE = '__not_in_list__'

const option = tag => ({ name: tag, title: tag })
const tagsOf = block => (Array.isArray(block?.tags) ? block.tags : [])

export const organizationBlockTags = orgDoc => normalizeBlockTagList(orgDoc?.cmsBlockTags)

// Tags used across the blocks, in first-seen order.
export const usedBlockTags = (blocks) => {
  const used = new Set()
  for (const block of Object.values(blocks || {}))
    tagsOf(block).forEach(tag => used.add(tag))
  return [...used]
}

// Quick Picks first, then the rest alphabetically: the order before the list.
const quickPicksFirst = (tags) => {
  const rest = tags.filter(tag => tag !== QUICK_PICKS_TAG).sort((a, b) => a.localeCompare(b))
  return [QUICK_PICKS_TAG, ...rest].map(option)
}

export const offListBlockTags = (tags, tagList) => {
  const list = normalizeBlockTagList(tagList)
  if (!list.length)
    return []
  return [...new Set(Array.isArray(tags) ? tags : [])].filter(tag => !list.includes(tag))
}

// Block Editor Tags field. With a list: the list in its order, plus the
// block's own off-list tags so they stay visible (and removable) until the
// editor removes them. Without: every tag in the library, additions allowed.
export const editorTagOptions = (tagList, blocks, currentTags = []) => {
  const list = normalizeBlockTagList(tagList)
  if (!list.length)
    return quickPicksFirst(usedBlockTags(blocks))
  return [...list, ...offListBlockTags(currentTags, list)].map(option)
}

// Block picker filters. Quick Picks always leads (the picker opens on it);
// with a list, the other options are the listed tags some block carries, in
// list order.
export const pickerTagOptions = (tagList, blocks) => {
  const list = normalizeBlockTagList(tagList)
  const used = usedBlockTags(blocks)
  if (!list.length)
    return quickPicksFirst(used)
  return [QUICK_PICKS_TAG, ...list.filter(tag => tag !== QUICK_PICKS_TAG && used.includes(tag))].map(option)
}

// Blocks library filters (the "No Tags" option is the library's own). With
// a list: the listed tags in order, and "Not in list" while any block still
// carries an off-list tag.
export const libraryTagOptions = (tagList, blocks) => {
  const list = normalizeBlockTagList(tagList)
  const used = usedBlockTags(blocks)
  if (!list.length)
    return [...used].sort((a, b) => a.localeCompare(b)).map(option)
  const options = list.map(option)
  if (used.some(tag => !list.includes(tag)))
    options.push({ name: NOT_IN_LIST_FILTER_VALUE, title: 'Not in list' })
  return options
}

export const hasOffListBlockTag = (block, tagList) => offListBlockTags(tagsOf(block), tagList).length > 0

export const blockTagUsage = (blocks, tag) => Object.values(blocks || {}).filter(block => tagsOf(block).includes(tag)).length

// ---- The tag list editor ----

// The problem with a new or renamed tag, or '' when it is fine.
export const blockTagNameProblem = (name, tagList, { except = '' } = {}) => {
  const tag = String(name || '').trim()
  if (!tag)
    return 'Enter a tag name.'
  if (tag.length > 40)
    return 'Keep tag names to 40 characters.'
  if (normalizeBlockTagList(tagList).some(existing => existing !== except && existing.toLowerCase() === tag.toLowerCase()))
    return `"${tag}" is already in the list.`
  return ''
}

export const addBlockTag = (tagList, name) => [...normalizeBlockTagList(tagList), String(name || '').trim()]

export const renameBlockTag = (tagList, from, to) => normalizeBlockTagList(tagList).map(tag => (tag === from ? String(to || '').trim() : tag))

export const removeBlockTag = (tagList, tag) => normalizeBlockTagList(tagList).filter(existing => existing !== tag)

export const moveBlockTag = (tagList, tag, offset) => {
  const list = normalizeBlockTagList(tagList)
  const from = list.indexOf(tag)
  const to = from + offset
  if (from < 0 || to < 0 || to >= list.length)
    return list
  list.splice(from, 1)
  list.splice(to, 0, tag)
  return list
}
