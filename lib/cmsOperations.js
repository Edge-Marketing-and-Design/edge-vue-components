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
  'site.create',
  'site.update',
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
// A new Template v2 instance stores each schema field's default `value`, so the
// saved page carries what the editor and preview show.
export const getTemplateV2SchemaDefaults = (schema) => {
  if (!isPlainObject(schema))
    return {}
  const defaults = {}
  for (const [field, config] of Object.entries(schema)) {
    if (isPlainObject(config) && Object.prototype.hasOwnProperty.call(config, 'value'))
      defaults[field] = clone(config.value)
  }
  return defaults
}

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
    instance.values = getTemplateV2SchemaDefaults(libraryBlock?.schema)
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

// ---- Design reference ----

// `meta.design` on a library block says which design node the block was
// built from: the package manifest's `design` entry, kept with the block so
// it survives the package. It is part of the definition (a draft carries it)
// but stays on the library block; a release never copies it to instances.
// Returns a list of messages; empty means absent or valid.
export const DESIGN_REFERENCE_SOURCES = Object.freeze(['figma', 'handoff'])
const DESIGN_REFERENCE_FIELDS = Object.freeze({
  figma: { required: ['file', 'node'], optional: ['name'] },
  handoff: { required: ['path'], optional: ['section', 'name'] },
})
export const designReferenceProblems = (design, label = 'meta.design') => {
  if (design === undefined || design === null)
    return []
  if (!isPlainObject(design))
    return [`${label} must be an object: { source: "figma", file, node, name? } or { source: "handoff", path, section?, name? }.`]
  const shape = DESIGN_REFERENCE_FIELDS[design.source]
  if (!shape)
    return [`${label}.source must be ${DESIGN_REFERENCE_SOURCES.map(source => `"${source}"`).join(' or ')}.`]
  const problems = []
  for (const key of shape.required) {
    if (typeof design[key] !== 'string' || !design[key].trim())
      problems.push(`${label}.${key} is required for source "${design.source}".`)
  }
  for (const key of Object.keys(design)) {
    if (key === 'source')
      continue
    if (!shape.required.includes(key) && !shape.optional.includes(key))
      problems.push(`${label}.${key} is not a design reference field (source "${design.source}" takes ${[...shape.required, ...shape.optional].join(', ')}).`)
    else if (typeof design[key] !== 'string')
      problems.push(`${label}.${key} must be a string.`)
  }
  return problems
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

// ---- Page and site SEO ----
// The public renderer replaces these tokens in meta fields and structured
// data (emd-cms-front replaceMetaTokens). Post pages also fill tokens from
// each post, so their post* fields may use others.
export const SEO_TOKENS = Object.freeze(['cms-url', 'cms-site', 'cms-logo'])
// Site fields site.update may set: the site's SEO only.
export const SITE_UPDATE_FIELDS = Object.freeze(['metaTitle', 'metaDescription', 'structuredData'])

// A structured data (JSON-LD) string: { errors, warnings, items }. Empty is
// allowed here (readiness reports it). `post: true` for postStructuredData.
export const structuredDataFindings = (value, { label = 'structuredData', post = false } = {}) => {
  const errors = []
  const warnings = []
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text)
    return { errors, warnings, items: [] }
  let data
  try {
    data = JSON.parse(text)
  }
  catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`)
    return { errors, warnings, items: [] }
  }
  const items = Array.isArray(data) ? data : [data]
  if (!items.length || !items.every(isPlainObject)) {
    errors.push(`${label} must be a JSON-LD object (or a list of objects).`)
    return { errors, warnings, items: [] }
  }
  if (!post) {
    const unknown = [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]).filter(token => !SEO_TOKENS.includes(token)))]
    if (unknown.length)
      warnings.push(`${label} uses ${unknown.map(token => `{{${token}}}`).join(', ')}, which the public site leaves empty on a regular page; only {{cms-url}}, {{cms-site}} and {{cms-logo}} are replaced.`)
  }
  const hardcoded = items.flatMap(item => ['@id', 'url'].filter(key => typeof item[key] === 'string' && /^https?:\/\//i.test(item[key])).map(key => `"${key}": "${item[key]}"`))
  if (hardcoded.length)
    warnings.push(`${label} hard-codes ${hardcoded.join(', ')}; use {{cms-site}} or {{cms-url}} so it follows the site's domain.`)
  return { errors, warnings, items }
}

// The SEO fields of a draft page or the site, as readiness items.
const seoReadinessItems = (fields, { subject, where = {} }) => {
  const items = []
  const add = (severity, code, message) => items.push({ severity, code, message, ...where })
  if (!String(fields?.metaTitle || '').trim())
    add('warning', 'seo.meta-title', `${subject} has no meta title.`)
  if (!String(fields?.metaDescription || '').trim())
    add('warning', 'seo.meta-description', `${subject} has no meta description.`)
  const structured = structuredDataFindings(fields?.structuredData)
  for (const message of structured.errors)
    add('error', 'seo.structured-data', `${subject}: ${message}`)
  if (!structured.errors.length && !String(fields?.structuredData || '').trim())
    add('warning', 'seo.structured-data', `${subject} has no structured data.`)
  const empty = structured.items.length ? ['name', 'description'].filter(key => !String(structured.items[0][key] ?? '').trim()) : []
  if (empty.length)
    add('warning', 'seo.structured-data-empty', `${subject}'s structured data has an empty ${empty.join(' and ')}.`)
  for (const message of structured.warnings)
    add('warning', 'seo.structured-data-tokens', `${subject}: ${message}`)
  if (String(fields?.postStructuredData || '').trim()) {
    for (const message of structuredDataFindings(fields.postStructuredData, { label: 'postStructuredData', post: true }).errors)
      add('error', 'seo.structured-data', `${subject}: ${message}`)
  }
  return items
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
  items.push(...seoReadinessItems(site, { subject: 'The site' }))

  const usedBlocks = new Map()
  for (const [pageId, page] of Object.entries(pages)) {
    const label = pageLabel(page, pageId)
    const instances = [...(Array.isArray(page?.content) ? page.content : []), ...(Array.isArray(page?.postContent) ? page.postContent : [])]
    if (!instances.length)
      add('warning', 'page.empty', `Page "${label}" has no blocks.`, { pageId })
    items.push(...seoReadinessItems(page, { subject: `Page "${label}"`, where: { pageId } }))
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

// ---- Sites (edge/composables/siteSettingsTemplate.js; edge/components/cms/site.vue seedNewSiteFromTheme) ----
// The Hub's site settings composable and new-site seeding use these, so a
// site created by an operation matches one made in the Hub.

// The site settings form's default structured data (structuredDataTemplates.js).
export const buildSiteStructuredData = () => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': '{{cms-site}}#website',
  'name': '',
  'url': '{{cms-site}}',
  'description': '',
  'publisher': {
    '@type': 'Organization',
    'name': '',
    'logo': {
      '@type': 'ImageObject',
      'url': '{{cms-logo}}',
    },
  },
  'sameAs': [],
}, null, 2)

export const DEFAULT_TRACKING_CONSENT_MESSAGE = 'We use analytics, advertising, and feedback tools to understand how visitors use this site, improve our marketing, and collect website feedback. These tools may collect information such as pages visited, browser and device details, and interactions with the site. You can choose whether to allow this tracking.'

export const restrictedContentDefaults = () => ({
  enabled: false,
  allowSelfRegistration: true,
  registrationPricing: 'free',
  provider: 'stripe',
  defaultCurrency: 'USD',
  registrationTermsUrl: '',
  loginHelpText: '',
  registrationSuccessMessage: '',
  rules: [],
})

export const contactSpamDefaults = () => ({
  enabled: true,
  mode: 'block',
  blockThreshold: 0.75,
  allowedInquiryContext: 'Legitimate messages usually come from people trying to contact the organization, ask a question, request services, request information, schedule an appointment, ask about availability, ask about pricing, follow up on an existing relationship, apply for an opportunity, submit a support request, or respond to content on the website. Allow messages that appear to be from a real visitor with a specific need, even if the message is short, informal, misspelled, or incomplete.',
  blockedInquiryContext: 'Spam messages usually advertise third-party services to the website owner, offer SEO, marketing, web design, app development, lead generation, directory listings, backlinks, loans, crypto, suspicious investments, or unrelated business promotions. Block messages that are primarily trying to sell something to the organization, contain generic outreach with no connection to the website services, include suspicious links, use mass-sales language, or appear automated. This includes unsolicited offers for free audits, mockups, redesign concepts, SEO reviews, performance checks, marketing ideas, or other no-cost evaluations when the purpose appears to be selling or promoting a service to the organization.',
})

export const siteSettingsDefaults = () => ({
  name: '',
  theme: '',
  allowedThemes: [],
  showMembersTab: false,
  logo: '',
  logoLight: '',
  logoText: '',
  logoType: 'image',
  brandLogoDark: '',
  brandLogoLight: '',
  favicon: '',
  menuPosition: 'right',
  domains: [],
  forwardApex: true,
  contactEmail: '',
  contactPhone: '',
  metaTitle: '',
  metaDescription: '',
  structuredData: buildSiteStructuredData(),
  trackingFacebookPixel: '',
  trackingGoogleAnalytics: '',
  trackingAdroll: '',
  trackingConsentEnabled: true,
  trackingConsentMessage: DEFAULT_TRACKING_CONSENT_MESSAGE,
  sureFeedURL: '',
  socialFacebook: '',
  socialInstagram: '',
  socialTwitter: '',
  socialLinkedIn: '',
  socialYouTube: '',
  socialTikTok: '',
  users: [],
  restrictedContent: restrictedContentDefaults(),
  contactSpam: contactSpamDefaults(),
  aiAgentUserId: '',
  aiInstructions: '',
})

const normalizeForCompare = (value) => {
  if (Array.isArray(value))
    return value.map(normalizeForCompare)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForCompare(value[key])
      return acc
    }, {})
  }
  return value
}
const stableSerialize = value => JSON.stringify(normalizeForCompare(value))
const areEqualNormalized = (a, b) => stableSerialize(a) === stableSerialize(b)
const hasStructuredDataCmsToken = value => typeof value === 'string' && /\{\{\s*cms-[^}]+\s*\}\}/.test(value)
const parseStructuredDataValue = (value) => {
  if (!value)
    return null
  if (typeof value === 'object')
    return value
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}
const matchesDefaultStructuredDataShape = (current, defaultValue) => {
  if (hasStructuredDataCmsToken(defaultValue))
    return current === defaultValue
  if (Array.isArray(defaultValue))
    return Array.isArray(current)
  if (defaultValue && typeof defaultValue === 'object') {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      return false
    const currentKeys = Object.keys(current).sort()
    const defaultKeys = Object.keys(defaultValue).sort()
    if (stableSerialize(currentKeys) !== stableSerialize(defaultKeys))
      return false
    return defaultKeys.every(key => matchesDefaultStructuredDataShape(current[key], defaultValue[key]))
  }
  return true
}
export const isCustomStructuredDataTemplate = (value) => {
  if (!String(value || '').trim())
    return false
  const current = parseStructuredDataValue(value)
  const defaultValue = parseStructuredDataValue(buildPageStructuredData())
  if (!current || !defaultValue)
    return true
  return !matchesDefaultStructuredDataShape(current, defaultValue)
}

export const slugify = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export const titleFromSlug = (slug) => {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'New Page'
}

export const ensureMenuBuckets = (menus) => {
  const normalized = (menus && typeof menus === 'object')
    ? clone(menus)
    : {}
  if (!Array.isArray(normalized['Site Root']))
    normalized['Site Root'] = []
  if (!Array.isArray(normalized['Not In Menu']))
    normalized['Not In Menu'] = []
  return normalized
}

export const ensureUniqueSlug = (candidate, templateDoc, usedSlugs) => {
  const fallbackBase = slugify(templateDoc?.slug || templateDoc?.name || '')
  let base = (candidate && candidate.trim().length) ? slugify(candidate) : ''
  if (!base)
    base = fallbackBase || `page-${usedSlugs.size + 1}`
  let slugCandidate = base
  let suffix = 2
  while (usedSlugs.has(slugCandidate)) {
    slugCandidate = `${base}-${suffix}`
    suffix += 1
  }
  usedSlugs.add(slugCandidate)
  return slugCandidate
}

const cloneBlocks = (blocks = []) => {
  return Array.isArray(blocks) ? JSON.parse(JSON.stringify(blocks)) : []
}

export const deriveBlockIdsFromDoc = (doc = {}) => {
  const collectBlocks = (blocks) => {
    if (!Array.isArray(blocks))
      return []
    return blocks
      .map(block => block?.blockId)
      .filter(Boolean)
  }

  const collectFromStructure = (structure) => {
    if (!Array.isArray(structure))
      return []
    const ids = []
    for (const row of structure) {
      for (const column of row?.columns || []) {
        if (Array.isArray(column?.blocks))
          ids.push(...column.blocks.filter(Boolean))
      }
    }
    return ids
  }

  const ids = new Set([
    ...collectBlocks(doc.content),
    ...collectBlocks(doc.postContent),
    ...collectFromStructure(doc.structure),
    ...collectFromStructure(doc.postStructure),
  ])
  return Array.from(ids)
}

export const buildPagePayloadFromTemplateDoc = (templateDoc, slug, displayName = '', timestamp = Date.now()) => {
  const templateStructuredData = typeof templateDoc?.structuredData === 'string' ? templateDoc.structuredData.trim() : ''
  const payload = {
    name: displayName?.trim()?.length ? displayName : titleFromSlug(slug),
    slug,
    post: templateDoc?.post || false,
    content: cloneBlocks(templateDoc?.content),
    postContent: cloneBlocks(templateDoc?.postContent),
    structure: cloneBlocks(templateDoc?.structure),
    postStructure: cloneBlocks(templateDoc?.postStructure),
    blockIds: [],
    metaTitle: templateDoc?.metaTitle || '',
    metaDescription: templateDoc?.metaDescription || '',
    structuredData: templateStructuredData || buildPageStructuredData(),
    structuredDataAiLocked: isCustomStructuredDataTemplate(templateStructuredData),
    doc_created_at: timestamp,
    last_updated: timestamp,
  }
  payload.blockIds = deriveBlockIdsFromDoc(payload)
  return payload
}

const buildMenusFromDefaultPages = (defaultPages = []) => {
  if (!Array.isArray(defaultPages) || !defaultPages.length)
    return null
  const menus = { 'Site Root': [], 'Not In Menu': [] }
  const usedSlugs = new Set()
  for (const entry of defaultPages) {
    if (!entry?.pageId)
      continue
    const slug = ensureUniqueSlug(entry?.name || '', null, usedSlugs)
    const menuTitle = String(entry?.menuTitle || entry?.name || '').trim() || titleFromSlug(slug)
    menus['Site Root'].push({
      name: slug,
      menuTitle,
      item: entry.pageId,
      disableRename: !!entry?.disableRename,
      disableDelete: !!entry?.disableDelete,
    })
  }
  return menus
}

export const deriveThemeMenus = (themeDoc = {}) => {
  if (themeDoc?.defaultMenus && Object.keys(themeDoc.defaultMenus || {}).length)
    return ensureMenuBuckets(themeDoc.defaultMenus)
  if (Array.isArray(themeDoc?.defaultPages) && themeDoc.defaultPages.length)
    return buildMenusFromDefaultPages(themeDoc.defaultPages)
  return null
}

const shouldApplyThemeSetting = (currentValue, baseValue) => {
  if (currentValue === undefined || currentValue === null)
    return true
  if (typeof currentValue === 'string')
    return !currentValue.trim() || areEqualNormalized(currentValue, baseValue)
  if (Array.isArray(currentValue))
    return currentValue.length === 0 || areEqualNormalized(currentValue, baseValue)
  if (typeof currentValue === 'object')
    return Object.keys(currentValue).length === 0 || areEqualNormalized(currentValue, baseValue)
  return areEqualNormalized(currentValue, baseValue)
}

export const buildThemeSettingsPayload = (themeDoc = {}, siteDoc = {}) => {
  if (!themeDoc?.defaultSiteSettings || typeof themeDoc.defaultSiteSettings !== 'object' || Array.isArray(themeDoc.defaultSiteSettings))
    return {}
  const baseDefaults = siteSettingsDefaults()
  const payload = {}
  for (const [key, baseValue] of Object.entries(baseDefaults)) {
    if (!(key in themeDoc.defaultSiteSettings))
      continue
    let themeValue = themeDoc.defaultSiteSettings[key]
    if (key === 'structuredData' && typeof themeValue === 'string' && !themeValue.trim())
      themeValue = baseValue
    if (key === 'contactSpam' && themeValue && typeof themeValue === 'object' && !Array.isArray(themeValue))
      themeValue = { ...baseValue, ...themeValue }
    if (areEqualNormalized(themeValue, baseValue))
      continue
    if (shouldApplyThemeSetting(siteDoc?.[key], baseValue))
      payload[key] = themeValue
  }
  return payload
}

// Copies a theme's default menus into a new site, one page per menu entry
// from the templates site (site.vue duplicateEntriesWithPages, without the
// writes). `newPageId()` names each page. Returns { menus, pages: [{ pageId,
// payload }] }; the caller writes the pages and stores `menus` on the site.
export const seedMenusFromTheme = (themeMenus, templatePages = {}, newPageId, timestamp = Date.now()) => {
  const pages = []
  const usedSlugs = new Set()
  const duplicate = (entries = []) => {
    const next = []
    for (const entry of entries) {
      if (!entry || entry.item == null)
        continue
      if (isExternalLinkEntry(entry)) {
        next.push(clone(entry))
        continue
      }
      if (typeof entry.item === 'string' || entry.item === '') {
        const templateDoc = templatePages?.[entry.item] || null
        const entryMenuTitle = String(entry?.menuTitle || '').trim()
        const slugSource = entry.name || entryMenuTitle
        const slug = ensureUniqueSlug(slugSource || '', templateDoc, usedSlugs)
        const pageId = newPageId()
        pages.push({ pageId, payload: buildPagePayloadFromTemplateDoc(templateDoc, slug, entry.name || '', timestamp) })
        next.push({ ...entry, name: slug, menuTitle: entryMenuTitle || titleFromSlug(slug), item: pageId })
      }
      else if (typeof entry.item === 'object') {
        const folderName = Object.keys(entry.item || {})[0]
        if (!folderName)
          continue
        const children = duplicate(entry.item[folderName])
        if (children.length)
          next.push({ ...entry, item: { [folderName]: children } })
      }
    }
    return next
  }
  const menus = ensureMenuBuckets(themeMenus)
  menus['Site Root'] = duplicate(menus['Site Root'])
  menus['Not In Menu'] = duplicate(menus['Not In Menu'])
  return { menus, pages }
}

// Settings site.create may set besides name, theme and domains. Users,
// members-only content and the AI agent stay with the Hub's site settings:
// they affect access and billing.
export const SITE_CREATE_FIELDS = Object.freeze([
  'allowedThemes',
  'forwardApex',
  'menuPosition',
  'logo',
  'logoLight',
  'logoText',
  'logoType',
  'brandLogoDark',
  'brandLogoLight',
  'favicon',
  'contactEmail',
  'contactPhone',
  'metaTitle',
  'metaDescription',
  'structuredData',
  'socialFacebook',
  'socialInstagram',
  'socialTwitter',
  'socialLinkedIn',
  'socialYouTube',
  'socialTikTok',
])
