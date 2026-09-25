// CMS operations: the document shapes the server-side write actions
// (functions/cmsOperations.js) produce. Each builder mirrors what the Hub UI
// writes today, so a page, instance or row created by an agent is
// indistinguishable from one made in the page editor.
//
// Shared by the Hub (edge/lib/cmsOperations.js) and Cloud Functions
// (edge/functions/helpers/cmsOperations.mjs and
// functions/helpers/cmsOperations.mjs). Keep the three copies byte-identical;
// tests/cmsOperations.test.mjs enforces it.

export const CMS_OPERATION_TYPES = Object.freeze([
  'theme.create',
  'theme.update',
  'theme.propose',
  'page.create',
  'page.update',
  'page.placeBlock',
  'page.setValues',
  'page.removeBlock',
  'block.create',
  'block.draft',
])

export const ROOT_MENUS = Object.freeze(['Site Root', 'Not In Menu'])

// Page fields an operation may set directly. Content and structure change
// only through the block operations.
export const PAGE_UPDATE_FIELDS = Object.freeze([
  'metaTitle',
  'metaDescription',
  'structuredData',
  'postMetaTitle',
  'postMetaDescription',
  'postStructuredData',
])

// A new library block's fields before the imported file's own, as the Blocks
// manager fills them (useCmsNewDocs blocks schema).
export const NEW_BLOCK_DEFAULTS = Object.freeze({
  name: '',
  content: '',
  templateVersion: 2,
  template: '',
  schema: {},
  dataSources: {},
  values: {},
  tags: [],
  themes: [],
  type: ['Page'],
  previewType: 'light',
  isOverrideBlock: false,
  synced: false,
  version: 1,
})

// Theme fields an operation may write.
export const THEME_FIELDS = Object.freeze(['name', 'theme', 'headJSON', 'extraCSS', 'defaultPages', 'defaultMenus', 'defaultSiteSettings'])

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

// Six base-36 characters, like the page editor's generateShortId, drawn
// until unused in `taken`.
export const generateShortId = (taken = new Set(), random = Math.random) => {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = random().toString(36).slice(2, 8).padEnd(6, '0')
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
  throw new Error('Could not generate a unique id.')
}

// ---- Pages and menus (edge/components/cms/menu.vue) ----

// The page editor's default structured data (structuredDataTemplates.js).
export const buildPageStructuredData = () => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': '{{cms-url}}#webpage',
  'name': '',
  'url': '{{cms-url}}',
  'description': '',
  'isPartOf': {
    '@id': '{{cms-site}}#website',
  },
}, null, 2)

export const isExternalLinkEntry = entry => !!entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'

// Slugs that resolve directly under "/": top-level pages and folders in both
// root menus.
export const collectRootSlugs = (menus) => {
  const slugs = new Set()
  for (const root of ROOT_MENUS) {
    for (const entry of (Array.isArray(menus?.[root]) ? menus[root] : [])) {
      if (typeof entry?.item === 'string') {
        if (entry.name)
          slugs.add(entry.name)
      }
      else if (isExternalLinkEntry(entry)) {
        continue
      }
      else if (entry && typeof entry.item === 'object') {
        const key = Object.keys(entry.item)[0]
        if (key)
          slugs.add(key)
      }
    }
  }
  return slugs
}

// menu.vue slugGenerator: lowercase, non-alphanumerics to "-", unique among
// root slugs by adding -1, -2...
export const uniqueRootSlug = (menus, name) => {
  const existing = collectRootSlugs(menus)
  const base = name ? String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : ''
  const baseSlug = base || 'page'
  let unique = baseSlug
  let suffix = 1
  while (existing.has(unique)) {
    unique = `${baseSlug}-${suffix}`
    suffix += 1
  }
  return unique
}

// menu.vue buildPagePayloadFromTemplate for a blank page.
export const blankPagePayload = (slug, now = Date.now()) => ({
  name: slug,
  content: [],
  postContent: [],
  blockIds: [],
  metaTitle: '',
  metaDescription: '',
  structuredData: buildPageStructuredData(),
  structuredDataAiLocked: false,
  postMetaTitle: '',
  postMetaDescription: '',
  postStructuredData: '',
  doc_created_at: now,
  last_updated: now,
})

// Menus with both root buckets present, other menus kept.
export const withRootMenus = (menus) => {
  const next = isPlainObject(menus) ? clone(menus) : {}
  for (const root of ROOT_MENUS) {
    if (!Array.isArray(next[root]))
      next[root] = []
  }
  return next
}

// ---- Rows (edge/components/cms/page.vue createRowFromLayout) ----

const ROW_WIDTH_CLASSES = {
  'full': 'w-full',
  'max-w-screen-2xl': 'w-full max-w-screen-2xl',
  'max-w-screen-xl': 'w-full max-w-screen-xl',
  'max-w-screen-lg': 'w-full max-w-screen-lg',
  'max-w-screen-md': 'w-full max-w-screen-md',
  'max-w-screen-sm': 'w-full max-w-screen-sm',
}
const ROW_GAP_CLASSES = { 0: 'gap-0 sm:gap-0', 2: 'gap-0 sm:gap-2', 4: 'gap-0 sm:gap-4', 6: 'gap-0 sm:gap-6', 8: 'gap-0 sm:gap-8' }
const GRID_CLASSES = {
  1: 'grid grid-cols-1 gap-4',
  2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
  3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
  4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
  5: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4',
  6: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4',
}
const VERTICAL_ALIGN_CLASSES = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' }

const rowGapClass = row => ROW_GAP_CLASSES[Number(row?.gap)] || ROW_GAP_CLASSES[4]
const rowUsesSpans = row => (row?.columns || []).some(col => Number.isFinite(col?.span))
const backgroundClass = (key) => {
  if (!key)
    return ''
  return key === 'transparent' ? 'bg-transparent' : `bg-${key}`
}

// page.vue computeRowTailwindClasses and computeColumnTailwindClasses.
export const rowTailwindClasses = (row) => {
  const grid = rowUsesSpans(row) ? 'grid grid-cols-1 sm:grid-cols-6' : (GRID_CLASSES[row?.columns?.length] || GRID_CLASSES[1])
  return [
    ROW_WIDTH_CLASSES[row?.width] || ROW_WIDTH_CLASSES.full,
    backgroundClass(row?.background),
    [grid, rowGapClass(row)].filter(Boolean).join(' '),
    VERTICAL_ALIGN_CLASSES[row?.verticalAlign] || VERTICAL_ALIGN_CLASSES.start,
    rowGapClass(row),
  ].filter(Boolean).join(' ').trim()
}

export const columnTailwindClasses = (row, index) => {
  const column = row?.columns?.[index]
  const span = Number.isFinite(column?.span) ? `col-span-${Math.min(Math.max(column.span, 1), 6)}` : ''
  const count = row?.columns?.length || 0
  const order = count ? (row?.mobileOrder === 'reverse' ? (count - index) : (index + 1)) : 0
  const orderClass = count ? [`order-${order}`, 'sm:order-none'].join(' ') : ''
  return [span, orderClass].filter(Boolean).join(' ').trim()
}

// A full-width, one-column row holding `instanceIds`, as the page editor's
// default layout ("6") creates it.
export const createFullWidthRow = ({ rowId, columnId, instanceIds = [] }) => {
  const row = {
    id: rowId,
    width: 'full',
    gap: '4',
    background: 'transparent',
    verticalAlign: 'start',
    mobileOrder: 'normal',
    marginXMode: 'auto',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    columns: [{ id: columnId, blocks: [...instanceIds], span: 6 }],
  }
  row.tailwindClasses = rowTailwindClasses(row)
  row.columns.forEach((column, index) => {
    column.tailwindClasses = columnTailwindClasses(row, index)
  })
  return row
}

// Every id used by a page's rows, columns and instances.
export const pageIds = (page) => {
  const ids = new Set()
  for (const key of ['content', 'postContent']) {
    for (const block of (Array.isArray(page?.[key]) ? page[key] : [])) {
      if (block?.id)
        ids.add(block.id)
    }
  }
  for (const key of ['structure', 'postStructure']) {
    for (const row of (Array.isArray(page?.[key]) ? page[key] : [])) {
      if (row?.id)
        ids.add(row.id)
      for (const column of row?.columns || []) {
        if (column?.id)
          ids.add(column.id)
      }
    }
  }
  return ids
}

// page.vue derivePageBlockIds: library ids from instances plus column block
// references.
export const derivePageBlockIds = (page = {}) => {
  const ids = new Set()
  for (const key of ['content', 'postContent']) {
    for (const block of (Array.isArray(page[key]) ? page[key] : [])) {
      const blockId = String(block?.blockId || '').trim()
      if (blockId)
        ids.add(blockId)
    }
  }
  for (const key of ['structure', 'postStructure']) {
    for (const row of (Array.isArray(page[key]) ? page[key] : [])) {
      for (const column of row?.columns || []) {
        for (const block of (Array.isArray(column?.blocks) ? column.blocks : [])) {
          const blockId = typeof block === 'string' ? block.trim() : String(block?.blockId || '').trim()
          if (blockId)
            ids.add(blockId)
        }
      }
    }
  }
  return [...ids]
}

export const getNextVersion = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric))
    return 1
  return Math.max(0, Math.trunc(numeric)) + 1
}

// ---- Instances (edge/components/cms/blockPicker.vue chooseBlock) ----

// Library fields that describe the library document, not a placement.
const LIBRARY_ONLY_FIELDS = ['releasedRevision', 'draftRevision', 'lastRevisionNumber', 'activeReleaseId', 'lastReleaseId', 'canary', 'uid', 'last_updated', 'doc_created_at', 'previewType']

// A page instance of `libraryBlock`, as the picker and page editor make it:
// a copy of the library block with its identity, no preview type, and (for
// Template v2) empty values and meta so schema defaults apply. It also
// records the released revision it holds, so a later release knows it is
// current.
export const buildInstanceFromLibraryBlock = (libraryBlock, { id, blockId }) => {
  const instance = clone(libraryBlock) || {}
  for (const field of LIBRARY_ONLY_FIELDS)
    delete instance[field]
  instance.id = id
  instance.name = libraryBlock?.name
  instance.blockId = blockId || libraryBlock?.docId
  delete instance.docId
  if (Object.prototype.hasOwnProperty.call(libraryBlock || {}, 'isOverrideBlock'))
    instance.isOverrideBlock = libraryBlock.isOverrideBlock === true
  else
    delete instance.isOverrideBlock
  if (Number(instance.templateVersion) === 2 && !instance.synced) {
    instance.values = {}
    instance.meta = {}
  }
  if (Number.isInteger(libraryBlock?.releasedRevision))
    instance.blockRevision = libraryBlock.releasedRevision
  return instance
}

// ---- Values (edge/components/cms/block.vue collectValidationErrors) ----

const stringLength = value => ((value === null || value === undefined) ? 0 : String(value).trim().length)
const toNumber = (value) => {
  if (value === '' || value === null || value === undefined)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const checkRules = (value, rules, label, type) => {
  if (!isPlainObject(rules))
    return []
  const errors = []
  if (rules.required) {
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'string' && stringLength(value) === 0)
    if (empty)
      return [`${label} is required.`]
  }
  if (type === 'number') {
    const number = toNumber(value)
    if (number !== null) {
      if (rules.min !== undefined && number < rules.min)
        errors.push(`${label} must be at least ${rules.min}.`)
      if (rules.max !== undefined && number > rules.max)
        errors.push(`${label} must be ${rules.max} or less.`)
    }
    return errors
  }
  const length = Array.isArray(value) ? value.length : stringLength(value)
  if (rules.min !== undefined && length < rules.min)
    errors.push(`${label} must be at least ${rules.min} ${Array.isArray(value) ? 'items' : 'characters'}.`)
  if (rules.max !== undefined && length > rules.max)
    errors.push(`${label} must be ${rules.max} ${Array.isArray(value) ? 'items' : 'characters'} or less.`)
  return errors
}

const arrayItemSchema = (entry) => {
  const schema = entry?.schema
  if (Array.isArray(schema))
    return schema.filter(item => item?.field)
  if (isPlainObject(schema))
    return Object.entries(schema).map(([field, item]) => ({ field, ...(isPlainObject(item) ? item : {}) }))
  return []
}

// Checks instance values against a Template v2 schema with the page
// editor's rules: required, min and max (length, item count or number),
// and at least one item for manual arrays. Values for fields the schema
// doesn't define are errors, so a misspelt field isn't silently dropped.
// Returns a list of messages; empty means valid.
export const validateInstanceValues = (schema, values) => {
  const fields = isPlainObject(schema) ? schema : {}
  const current = isPlainObject(values) ? values : {}
  const errors = []
  for (const field of Object.keys(current)) {
    if (!Object.prototype.hasOwnProperty.call(fields, field))
      errors.push(`"${field}" is not a field of this block.`)
  }
  for (const [field, entry] of Object.entries(fields)) {
    const label = entry?.label || entry?.title || field
    const value = Object.prototype.hasOwnProperty.call(current, field) ? current[field] : entry?.value
    if (entry?.type === 'array' && !entry?.api && !entry?.collection) {
      if (!Array.isArray(value) || value.length < 1)
        errors.push(`${label} requires at least one item.`)
      if (Array.isArray(value)) {
        const itemSchema = arrayItemSchema(entry)
        value.forEach((item, index) => {
          for (const itemEntry of itemSchema)
            errors.push(...checkRules(item?.[itemEntry.field], itemEntry.validation, `${label} ${index + 1} · ${itemEntry.label || itemEntry.title || itemEntry.field}`, itemEntry.type))
        })
      }
    }
    errors.push(...checkRules(value, entry?.validation, label, entry?.type))
  }
  return errors
}

// ---- Themes ----

// Checks the JSON-string fields the KV mirror parses (onThemeWritten), so a
// theme write can't break it.
export const themeFieldProblems = (fields) => {
  const problems = []
  for (const key of ['theme', 'headJSON']) {
    if (fields?.[key] === undefined)
      continue
    if (typeof fields[key] !== 'string') {
      problems.push(`${key} must be a JSON string.`)
      continue
    }
    try {
      const parsed = JSON.parse(fields[key])
      if (!isPlainObject(parsed))
        problems.push(`${key} must be a JSON object.`)
    }
    catch (error) {
      problems.push(`${key} is not valid JSON: ${error.message}`)
    }
  }
  if (fields?.extraCSS !== undefined && typeof fields.extraCSS !== 'string')
    problems.push('extraCSS must be a string.')
  for (const key of Object.keys(fields || {})) {
    if (!THEME_FIELDS.includes(key))
      problems.push(`"${key}" is not a theme field an operation can set.`)
  }
  return problems
}

// ---- Site readiness (first-release plan, phase 6) ----

const pageLabel = (page, id) => page?.name || id

// Everything that would stop a site from being finished, from facts the
// caller gathers:
// - pages: { [pageId]: draft page }, published: { [pageId]: published page }
// - blocks: { [blockId]: library block } for every block the drafts use
// - drafts: { [blockId]: open draft revision number }
// - blockChecks: { [blockId]: { errors: [...], warnings: [...] } }
// - site, theme (null when missing)
// Returns { ready, counts: { error, warning, info }, items } with items
// { severity, code, message, pageId?, instanceId?, blockId? }.
export const buildSiteReadiness = ({ site = {}, theme = null, pages = {}, published = {}, blocks = {}, drafts = {}, blockChecks = {} }) => {
  const items = []
  const add = (severity, code, message, where = {}) => items.push({ severity, code, message, ...where })

  if (!site?.theme)
    add('error', 'site.no-theme', 'The site has no theme.')
  else if (!theme)
    add('error', 'site.theme-missing', `The site's theme "${site.theme}" does not exist.`)

  const usedBlocks = new Map()
  for (const [pageId, page] of Object.entries(pages)) {
    const label = pageLabel(page, pageId)
    const instances = [...(Array.isArray(page?.content) ? page.content : []), ...(Array.isArray(page?.postContent) ? page.postContent : [])]
    if (!instances.length)
      add('warning', 'page.empty', `Page "${label}" has no blocks.`, { pageId })
    const live = published[pageId]
    if (!live)
      add('warning', 'page.unpublished', `Page "${label}" has never been published.`, { pageId })
    else if (Number(page?.version) > Number(live?.version))
      add('info', 'page.unpublished-changes', `Page "${label}" has changes that aren't published.`, { pageId })

    for (const instance of instances) {
      const where = { pageId, instanceId: instance?.id, blockId: instance?.blockId }
      const library = blocks[instance?.blockId]
      if (!library) {
        add('error', 'block.missing', `Page "${label}" uses block "${instance?.name || instance?.blockId}", which is not in the library.`, where)
        continue
      }
      if (!usedBlocks.has(instance.blockId))
        usedBlocks.set(instance.blockId, new Set())
      usedBlocks.get(instance.blockId).add(label)
      if (Number(instance.templateVersion) === 2 && !instance.synced) {
        for (const message of validateInstanceValues(instance.schema, instance.values))
          add('error', 'instance.values', `Page "${label}", "${instance.name || library.name}": ${message}`, where)
      }
      const released = Number.isInteger(library.releasedRevision) ? library.releasedRevision : null
      if (released !== null && Number.isInteger(instance.blockRevision) && instance.blockRevision < released)
        add('warning', 'instance.behind', `Page "${label}", "${instance.name || library.name}" holds revision ${instance.blockRevision}; revision ${released} is released.`, where)
    }
  }

  for (const [blockId, pageNames] of usedBlocks) {
    const library = blocks[blockId] || {}
    const name = library.name || blockId
    const onPages = [...pageNames].join(', ')
    if (library.isOverrideBlock === true)
      add('warning', 'block.override', `"${name}" is an override block: the public site needs its Vue component (used on ${onPages}).`, { blockId })
    if (Number.isInteger(drafts[blockId]))
      add('info', 'block.unreleased', `"${name}" has unreleased changes (revision ${drafts[blockId]}).`, { blockId })
    for (const issue of blockChecks[blockId]?.errors || [])
      add('error', 'block.checks', `"${name}": ${issue.code}: ${issue.message}`, { blockId })
  }

  const counts = { error: 0, warning: 0, info: 0 }
  for (const item of items)
    counts[item.severity] += 1
  const order = { error: 0, warning: 1, info: 2 }
  items.sort((a, b) => order[a.severity] - order[b.severity])
  return { ready: counts.error === 0, counts, items }
}
