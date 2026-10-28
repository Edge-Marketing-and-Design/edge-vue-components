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
  'page.moveBlock',
  'block.create',
  'block.draft',
  'site.create',
  'site.update',
  'post.create',
  'post.update',
  'post.placeBlock',
  'post.setValues',
  'post.moveBlock',
  'post.removeBlock',
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
export const THEME_FIELDS = Object.freeze(['name', 'theme', 'headJSON', 'extraCSS', 'typeRoles', 'defaultPages', 'defaultMenus', 'defaultSiteSettings'])

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
  // typeRoles names the classes a theme's Extra CSS defines for section type
  // (cmsBlockValidation.js sectionTypeRoleFindings): one class name each.
  if (fields?.typeRoles !== undefined) {
    if (!isPlainObject(fields.typeRoles)) {
      problems.push('typeRoles must be an object of class names.')
    }
    else {
      for (const [key, value] of Object.entries(fields.typeRoles)) {
        if (!['sectionTitle', 'sectionIntro'].includes(key))
          problems.push(`typeRoles.${key} is not a type role (sectionTitle, sectionIntro).`)
        else if (typeof value !== 'string' || (value.trim() && !/^-?[_a-zA-Z][\w-]*$/.test(value.trim())))
          problems.push(`typeRoles.${key} must be one class name, or empty.`)
      }
    }
  }
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

// ---- Page lists and outlines (agent page reads) ----
// What an agent sees of a site's pages and of one page, instead of the raw
// documents. Reads only.

// A draft page's publication state, as the readiness report compares it:
// `draft` (never published), `unpublished-changes` (its version is newer
// than the published copy's) or `published`.
export const pagePublicationStatus = (page, live) => {
  if (!live)
    return 'draft'
  return Number(page?.version) > Number(live?.version) ? 'unpublished-changes' : 'published'
}

const routeSlug = value => String(value || '').trim().toLowerCase()
// The route the Hub's page links use (cmsPublishedSitePreview.js
// findCmsPageRoute): "/" for a top-level "home" page, otherwise the folder
// and page slugs. Menus other than the two root menus prefix their own slug.
const routePath = (folders, slug) => ((!folders.length && slug === 'home') ? '/' : `/${[...folders, slug].join('/')}`)
const menuFolders = name => (ROOT_MENUS.includes(name) ? [] : [routeSlug(name)])
const menuOrder = name => (name === 'Site Root' ? 0 : name === 'Not In Menu' ? 2 : 1)

// The site's menus as a tree, in the Sites page's order (Site Root, other
// menus, Not In Menu), with each page's id, slug, menu title, path and
// publication state. Pages in no menu are listed in `unlisted`.
// - pages: { [pageId]: draft page }, published: { [pageId]: published page }
export const buildSitePages = ({ site = {}, pages = {}, published = {} }) => {
  const listed = new Set()
  const describePage = (pageId) => {
    const page = pages[pageId]
    if (!page)
      return { pageId, exists: false, status: 'missing' }
    return { pageId, exists: true, status: pagePublicationStatus(page, published[pageId]), version: Number.isFinite(Number(page.version)) ? Number(page.version) : null, post: page.post === true }
  }
  const visit = (entries, folders) => (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    if (!entry || entry.item == null || entry.item === '')
      return []
    if (isExternalLinkEntry(entry))
      return [{ kind: 'external', name: String(entry.name || ''), url: String(entry.item.url || '') }]
    if (typeof entry.item === 'string') {
      listed.add(entry.item)
      const slug = routeSlug(entry.name)
      return [{ kind: 'page', ...describePage(entry.item), slug: String(entry.name || ''), menuTitle: String(entry.menuTitle || ''), path: slug ? routePath(folders, slug) : null }]
    }
    if (isPlainObject(entry.item)) {
      const folderSlug = Object.keys(entry.item)[0]
      if (!folderSlug)
        return []
      return [{ kind: 'folder', slug: folderSlug, menuTitle: String(entry.menuTitle || entry.folderTitle || entry.name || ''), entries: visit(entry.item[folderSlug], [...folders, routeSlug(folderSlug)]) }]
    }
    return []
  })
  const menus = Object.entries(withRootMenus(site.menus))
    .map(([name, entries], index) => ({ name, entries, index }))
    .sort((a, b) => menuOrder(a.name) - menuOrder(b.name) || a.index - b.index)
    .map(({ name, entries }) => ({ menu: name, entries: visit(entries, menuFolders(name)) }))
  const unlisted = Object.keys(pages)
    .filter(pageId => !listed.has(pageId))
    .sort()
    .map(pageId => ({ ...describePage(pageId), slug: String(pages[pageId]?.name || '') }))
  return { menus, unlisted }
}

// A page's route from saved menus, or null when no menu lists it.
export const pageRoutePath = (menus, pageId) => {
  const visit = (entries, folders) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.item === pageId) {
        const slug = routeSlug(entry.name)
        if (slug)
          return routePath(folders, slug)
        continue
      }
      if (isPlainObject(entry?.item) && !isExternalLinkEntry(entry)) {
        for (const [folder, children] of Object.entries(entry.item)) {
          const found = visit(children, [...folders, routeSlug(folder)])
          if (found !== null)
            return found
        }
      }
    }
    return null
  }
  if (!pageId || !isPlainObject(menus))
    return null
  for (const [name, entries] of Object.entries(menus)) {
    const found = visit(entries, menuFolders(name))
    if (found !== null)
      return found
  }
  return null
}

const PAGE_OUTLINE_FIELDS = ['metaTitle', 'metaDescription', 'structuredData']
const POST_OUTLINE_FIELDS = ['postMetaTitle', 'postMetaDescription', 'postStructuredData']

// One body (a page area or a post) as rows, columns and instances in order.
// Instances the content lists but no column places are in `unplaced`; a
// column reference with no instance is `{ instanceId, missing: true }`.
// - blocks: { [blockId]: library block } for the body's instances
const outlineBody = ({ content, structure, blocks = {}, includeValues = true, includeSchema = false }) => {
  const describeInstance = (instance) => {
    const library = blocks[instance?.blockId] || null
    const released = Number.isInteger(library?.releasedRevision) ? library.releasedRevision : null
    const held = Number.isInteger(instance?.blockRevision) ? instance.blockRevision : null
    return {
      instanceId: instance?.id || null,
      blockId: instance?.blockId || null,
      name: String(instance?.name || library?.name || ''),
      templateVersion: Number(instance?.templateVersion) || null,
      synced: instance?.synced === true,
      override: (instance?.isOverrideBlock ?? library?.isOverrideBlock) === true,
      blockRevision: held,
      releasedRevision: released,
      behind: released !== null && held !== null && held < released,
      ...(library ? {} : { libraryMissing: true }),
      ...(includeValues ? { values: clone(isPlainObject(instance?.values) ? instance.values : {}) } : {}),
      ...(includeSchema ? { schema: clone(isPlainObject(instance?.schema) ? instance.schema : {}) } : {}),
    }
  }
  const instances = Array.isArray(content) ? content : []
  const byId = new Map(instances.filter(instance => instance?.id).map(instance => [instance.id, instance]))
  const placed = new Set()
  const rows = (Array.isArray(structure) ? structure : []).map((row, index) => {
    const columns = (Array.isArray(row?.columns) ? row.columns : []).map(column => ({
      columnId: column?.id || null,
      span: Number.isFinite(Number(column?.span)) ? Number(column.span) : null,
      instances: (Array.isArray(column?.blocks) ? column.blocks : []).map((reference) => {
        const instanceId = typeof reference === 'string' ? reference : reference?.id
        placed.add(instanceId)
        return byId.has(instanceId) ? describeInstance(byId.get(instanceId)) : { instanceId: instanceId || null, missing: true }
      }),
    }))
    return { rowId: row?.id || null, index, width: row?.width || null, layout: columns.map(column => column.span), columns }
  })
  const unplaced = instances.filter(instance => !placed.has(instance?.id)).map(describeInstance)
  return { rows, ...(unplaced.length ? { unplaced } : {}) }
}

// A page as rows, columns and instances in order, per area (`main`, and
// `post` when the page has a post view), instead of the raw document
// (outlineBody).
// - blocks: { [blockId]: library block } for the page's instances
export const buildPageOutline = ({ pageId, page = {}, source = 'draft', status = null, path = null, blocks = {}, includeValues = true, includeSchema = false }) => {
  const outlineArea = (contentKey, structureKey) => outlineBody({ content: page[contentKey], structure: page[structureKey], blocks, includeValues, includeSchema })
  const hasPost = page.post === true
    || (Array.isArray(page.postStructure) && page.postStructure.length > 0)
    || (Array.isArray(page.postContent) && page.postContent.length > 0)
  const fields = hasPost ? [...PAGE_OUTLINE_FIELDS, ...POST_OUTLINE_FIELDS] : PAGE_OUTLINE_FIELDS
  return {
    pageId,
    source,
    name: String(page.name || ''),
    path,
    status,
    post: page.post === true,
    structuredDataAiLocked: page.structuredDataAiLocked === true,
    ...Object.fromEntries(fields.map(key => [key, typeof page[key] === 'string' ? page[key] : ''])),
    version: Number.isFinite(Number(page.version)) ? Number(page.version) : null,
    last_updated: page.last_updated ?? null,
    areas: {
      main: outlineArea('content', 'structure'),
      ...(hasPost ? { post: outlineArea('postContent', 'postStructure') } : {}),
    },
    blockIds: Array.isArray(page.blockIds) ? [...page.blockIds] : [],
  }
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

// Per-site GA4 event switches, read by emd-cms-front. Only `true` turns a
// switch on: a missing object or key reads as off, so a Site sends no events
// until someone turns them on. New categories are new keys, default off.
export const ANALYTICS_EVENT_KEYS = Object.freeze(['enabled', 'forms', 'contactClicks', 'accountSignUps'])

export const normalizeAnalyticsEvents = (value) => {
  const source = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
  return Object.fromEntries(ANALYTICS_EVENT_KEYS.map(key => [key, source[key] === true]))
}

export const analyticsEventsDefaults = () => normalizeAnalyticsEvents()

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
  trackingAdrollPixelId: '',
  trackingConsentEnabled: true,
  trackingConsentMessage: DEFAULT_TRACKING_CONSENT_MESSAGE,
  analyticsEvents: analyticsEventsDefaults(),
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
    if (key === 'analyticsEvents')
      themeValue = normalizeAnalyticsEvents(themeValue)
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

// ---- Posts (edge/components/cms/posts.vue, edge/lib/cmsPostStructure.js, edge/lib/cmsPostRoutes.js) ----
// What the post editor saves, so a post written by an operation is
// indistinguishable from one made in the Hub. Posts have no version; their
// publication state is the published_posts snapshot.

// Post fields post.update may set. Publication fields (publishAt,
// publishAtTimezone, publishedAt, doc_created_at, hidePublishedDate) and the
// importer's legacyBlog stay with the Hub and the importer.
export const POST_UPDATE_FIELDS = Object.freeze(['title', 'blurb', 'name', 'tags', 'featuredImage', 'event', 'restrictionRuleId'])
// Every key post.create accepts, `type` included.
export const POST_CREATE_KEYS = Object.freeze(['type', 'siteId', 'title', 'blurb', 'name', 'tags', 'featuredImage', 'postType', 'event', 'templateId'])
export const POST_BLURB_MAX = 500
export const POST_EVENT_STATUSES = Object.freeze(['scheduled', 'cancelled', 'completed'])

// posts.vue normalizePostType: missing or anything else means `post`.
export const normalizePostType = value => (String(value || '').trim().toLowerCase() === 'event' ? 'event' : 'post')

// blockPicker.vue normalizeBlockTypes: a block with no type is a Page block.
// The post editor's picker offers blocks whose types include `Post`.
export const normalizeBlockTypes = (value) => {
  const explicit = !(value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
  const types = [...new Set((Array.isArray(value) ? value : [value])
    .map((type) => {
      const raw = (type && typeof type === 'object') ? (type.name ?? type.value ?? type.title ?? type.label ?? '') : type
      const name = String(raw || '').trim().toLowerCase()
      return name === 'page' ? 'Page' : name === 'post' ? 'Post' : ''
    })
    .filter(Boolean))]
  return (!types.length && !explicit) ? ['Page'] : types
}
export const isPostBlock = block => normalizeBlockTypes(block?.type).includes('Post')

// posts.vue ensureUniqueSlug: the slugified input (or "post"), unique among
// `taken` (the site's other post slugs) by adding -1, -2...
export const uniquePostSlug = (input, taken = new Set()) => {
  const base = slugify(input) || 'post'
  let candidate = base
  let suffix = 1
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

// cmsPostStructure.js createPostRow: a full-width row with one column of
// span 12 (the post editor's grid clamps it to the full six columns).
export const createPostRow = ({ rowId, columnId, instanceIds = [] }) => ({
  id: rowId,
  width: 'full',
  gap: '4',
  verticalAlign: 'start',
  background: 'transparent',
  mobileStack: 'normal',
  columns: [{ id: columnId, span: 12, mobileOrder: 0, blocks: [...instanceIds] }],
})

// cmsPostStructure.js normalizeCmsPostStructure: row defaults, a span of 12
// for a lone column that has none, references to missing instances dropped,
// and instances no column places appended to the last row's first column.
export const normalizePostStructure = ({ structure = [], contentIds = [], createId }) => {
  const available = new Set(Array.isArray(contentIds) ? contentIds : [])
  const rows = (Array.isArray(structure) ? structure : []).filter(isPlainObject).map((row) => {
    const sourceColumns = (Array.isArray(row.columns) && row.columns.length) ? row.columns : [{}]
    const columns = sourceColumns.map((sourceColumn, index) => {
      const column = isPlainObject(sourceColumn) ? sourceColumn : {}
      return {
        ...column,
        id: column.id || createId(),
        span: Object.prototype.hasOwnProperty.call(column, 'span') ? column.span : (sourceColumns.length === 1 ? 12 : null),
        mobileOrder: Object.prototype.hasOwnProperty.call(column, 'mobileOrder') ? column.mobileOrder : index,
        blocks: (Array.isArray(column.blocks) ? column.blocks : []).filter(id => available.has(id)),
      }
    })
    return {
      ...row,
      id: row.id || createId(),
      width: row.width || 'full',
      gap: row.gap || '4',
      verticalAlign: row.verticalAlign || 'start',
      background: (typeof row.background === 'string' && row.background) ? row.background : 'transparent',
      mobileStack: row.mobileStack || 'normal',
      columns,
    }
  })
  if (!rows.length && available.size)
    rows.push(createPostRow({ rowId: createId(), columnId: createId(), instanceIds: [...available] }))
  const referenced = new Set(rows.flatMap(row => row.columns.flatMap(column => column.blocks)))
  const orphans = [...available].filter(id => !referenced.has(id))
  if (orphans.length) {
    if (!rows.length)
      rows.push(createPostRow({ rowId: createId(), columnId: createId() }))
    rows.at(-1).columns[0].blocks.push(...orphans)
  }
  return rows
}

// posts.vue normalizePostBuilderDoc for a body: instances get an id, string
// content and object values and meta; the structure is normalized.
export const normalizePostBody = ({ content = [], structure = [], createId }) => {
  const instances = (Array.isArray(content) ? content : []).filter(isPlainObject).map((block) => {
    const next = clone(block)
    if (!next.id)
      next.id = createId()
    if (typeof next.content !== 'string')
      next.content = String(next.content || '')
    if (!isPlainObject(next.values))
      next.values = {}
    if (!isPlainObject(next.meta))
      next.meta = {}
    return next
  })
  return { content: instances, structure: normalizePostStructure({ structure, contentIds: instances.map(block => block.id), createId }) }
}

// posts.vue onWorkingDocUpdate: the library ids of the post's instances.
export const derivePostBlockIds = post => [...new Set((Array.isArray(post?.content) ? post.content : []).map(block => block?.blockId).filter(Boolean))]

// A Post template page (templates site, offered by the new-post dialog): a
// page whose types include Post and that isn't itself a post template page.
// Its body is its postContent/postStructure, else its content/structure.
export const isPostTemplatePage = page => !!page && page.post !== true && normalizeBlockTypes(page.type).includes('Post')
export const postTemplateBody = (page = {}) => {
  const postContent = Array.isArray(page.postContent) ? page.postContent : []
  const postStructure = Array.isArray(page.postStructure) ? page.postStructure : []
  return {
    content: clone(postContent.length ? postContent : (Array.isArray(page.content) ? page.content : [])),
    structure: clone(postStructure.length ? postStructure : (Array.isArray(page.structure) ? page.structure : [])),
  }
}

// ---- Events (posts.vue normalizeEventData, syncEventUtcFields) ----

const EVENT_STRING_FIELDS = ['startAt', 'endAt', 'timezone', 'locationName', 'locationAddress', 'meetingUrl', 'registrationUrl', 'status']
const EVENT_BOOLEAN_FIELDS = ['unpublishPastEvent', 'isVirtual']
// Fields an operation may give; startAtUtc, endAtUtc and isPast are computed.
export const POST_EVENT_FIELDS = Object.freeze([...EVENT_STRING_FIELDS, ...EVENT_BOOLEAN_FIELDS, 'capacity'])

export const normalizePostEvent = (event = {}, defaultTimezone = 'UTC') => {
  const source = isPlainObject(event) ? event : {}
  const text = key => (typeof source[key] === 'string' ? source[key] : '')
  return {
    ...source,
    startAt: text('startAt'),
    endAt: text('endAt'),
    startAtUtc: text('startAtUtc'),
    endAtUtc: text('endAtUtc'),
    isPast: typeof source.isPast === 'boolean' ? source.isPast : false,
    unpublishPastEvent: typeof source.unpublishPastEvent === 'boolean' ? source.unpublishPastEvent : true,
    timezone: text('timezone') || defaultTimezone,
    locationName: text('locationName'),
    locationAddress: text('locationAddress'),
    isVirtual: typeof source.isVirtual === 'boolean' ? source.isVirtual : false,
    meetingUrl: text('meetingUrl'),
    registrationUrl: text('registrationUrl'),
    capacity: typeof source.capacity === 'number' ? source.capacity : null,
    status: POST_EVENT_STATUSES.includes(source.status) ? source.status : 'scheduled',
  }
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const timeZoneOffsetMinutes = (date, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(part => [part.type, part.value]))
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return (asIfUtc - date.getTime()) / 60000
}
// posts.vue localDateTimeInTimeZoneToUtcIso: "2026-11-02T18:30" in a time
// zone as an ISO UTC string; '' when either is missing or invalid.
export const localDateTimeToUtcIso = (value, timeZone) => {
  const match = LOCAL_DATE_TIME.exec(String(value || '').trim())
  if (!match || !timeZone)
    return ''
  try {
    const [, year, month, day, hour, minute, second] = match.map(Number)
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0)
    let utc = localAsUtc
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = localAsUtc - timeZoneOffsetMinutes(new Date(utc), timeZone) * 60000
      if (candidate === utc)
        break
      utc = candidate
    }
    return new Date(utc).toISOString()
  }
  catch {
    return ''
  }
}
export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone)
    return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  }
  catch {
    return false
  }
}

// The event a save stores: ensurePostTypeAndEventDefaults also turns the
// capacity into a number, so a post without one saves 0.
export const savedPostEvent = (event = {}, defaultTimezone = 'UTC') => {
  const normalized = normalizePostEvent(event, defaultTimezone)
  const capacity = Number(normalized.capacity)
  return { ...normalized, capacity: Number.isFinite(capacity) ? capacity : null }
}

// syncEventUtcFields for an event: the UTC times from the local times and
// the time zone, and whether it has ended.
export const computePostEvent = (event, now = Date.now()) => {
  const startAtUtc = localDateTimeToUtcIso(event.startAt, event.timezone)
  const endAtUtc = localDateTimeToUtcIso(event.endAt, event.timezone)
  const endMs = endAtUtc ? Date.parse(endAtUtc) : Number.NaN
  return { ...event, startAtUtc, endAtUtc, isPast: Number.isFinite(endMs) ? endMs <= now : false }
}

// The event fields an operation gives, checked; and the post editor's rules
// for an event post (start, end and, in person, a location). An event also
// needs its time zone, unless the post already has one (`timezoneKnown`):
// the editor falls back to the browser's, an operation has none.
export const postEventProblems = (input, { type, merged, timezoneKnown = false } = {}) => {
  const problems = []
  if (input !== undefined) {
    if (!isPlainObject(input))
      return ['event must be an object of event fields.']
    for (const [key, value] of Object.entries(input)) {
      if (!POST_EVENT_FIELDS.includes(key))
        problems.push(`event.${key} can't be set (allowed: ${POST_EVENT_FIELDS.join(', ')}; startAtUtc, endAtUtc and isPast are computed).`)
      else if (EVENT_BOOLEAN_FIELDS.includes(key) && typeof value !== 'boolean')
        problems.push(`event.${key} must be true or false.`)
      else if (key === 'capacity' && value !== null && !(typeof value === 'number' && Number.isFinite(value)))
        problems.push('event.capacity must be a number or null.')
      else if (EVENT_STRING_FIELDS.includes(key) && typeof value !== 'string')
        problems.push(`event.${key} must be a string.`)
    }
    if (typeof input.status === 'string' && !POST_EVENT_STATUSES.includes(input.status))
      problems.push(`event.status must be one of: ${POST_EVENT_STATUSES.join(', ')}.`)
    for (const key of ['startAt', 'endAt']) {
      if (typeof input[key] === 'string' && input[key].trim() && !LOCAL_DATE_TIME.test(input[key].trim()))
        problems.push(`event.${key} must be a local date and time like "2026-11-02T18:30".`)
    }
    if (typeof input.timezone === 'string' && input.timezone && !isValidTimeZone(input.timezone))
      problems.push(`event.timezone "${input.timezone}" is not a time zone (use an IANA name like "America/Denver").`)
  }
  if (type === 'event' && merged) {
    if (!timezoneKnown && !(isPlainObject(input) && typeof input.timezone === 'string' && input.timezone))
      problems.push('An event needs event.timezone (an IANA name like "America/Denver"); its times are local to it.')
    if (!merged.startAt.trim())
      problems.push('Start At is required for events (event.startAt).')
    if (!merged.endAt.trim())
      problems.push('End At is required for events (event.endAt).')
    if (!merged.isVirtual && !merged.locationName.trim())
      problems.push('Location Name is required for in-person events (event.locationName).')
    if (!merged.isVirtual && !merged.locationAddress.trim())
      problems.push('Location Address is required for in-person events (event.locationAddress).')
  }
  return problems
}

// ---- Post publication state (posts.vue hasPublishDiff) ----

// resolveSyncedPostBlock: an instance of a library block as publishing
// resolves it, with the library's current definition.
const mergeResolvedMeta = (libraryMeta, instanceMeta) => {
  const next = clone(isPlainObject(libraryMeta) ? libraryMeta : {})
  for (const [key, value] of Object.entries(isPlainObject(instanceMeta) ? instanceMeta : {})) {
    if (!isPlainObject(value))
      continue
    if (!isPlainObject(next[key]))
      next[key] = {}
    if (isPlainObject(value.queryItems))
      next[key].queryItems = clone(value.queryItems)
    if (Object.prototype.hasOwnProperty.call(value, 'limit'))
      next[key].limit = clone(value.limit)
  }
  return next
}
const resolvePostInstance = (block, blocks) => {
  if (!isPlainObject(block))
    return block
  const instance = clone(block)
  const blockId = String(instance.blockId || '').trim()
  const library = blockId ? blocks[blockId] : null
  if (!isPlainObject(library))
    return instance
  return {
    ...clone(library),
    id: instance.id,
    blockId,
    synced: instance.synced ?? library.synced ?? false,
    values: clone(instance.values || {}),
    meta: mergeResolvedMeta(library.meta, instance.meta),
    ...(isPlainObject(instance.protection) ? { protection: clone(instance.protection) } : {}),
  }
}

const postEventComparable = (event) => {
  const normalized = normalizePostEvent(event)
  return Object.fromEntries(['startAt', 'endAt', 'startAtUtc', 'endAtUtc', 'isPast', 'unpublishPastEvent', 'timezone', 'locationName', 'locationAddress', 'isVirtual', 'meetingUrl', 'registrationUrl', 'capacity', 'status'].map(key => [key, normalized[key]]))
}
// postDocComparable: what counts as a change. Dates and timestamps don't.
const postComparable = post => ({
  name: post?.name || '',
  title: post?.title || '',
  blurb: post?.blurb || '',
  tags: Array.isArray(post?.tags) ? post.tags : [],
  featuredImage: post?.featuredImage || '',
  restrictionRuleId: post?.restrictionRuleId || '',
  content: Array.isArray(post?.content) ? post.content : (typeof post?.content === 'string' ? post.content : ''),
  structure: Array.isArray(post?.structure) ? post.structure : [],
  type: normalizePostType(post?.type),
  event: postEventComparable(post?.event),
  publishAt: typeof post?.publishAt === 'string' ? post.publishAt : '',
  publishAtTimezone: typeof post?.publishAtTimezone === 'string' ? post.publishAtTimezone : '',
})

// The Hub's post status: `draft` (no snapshot), `published`, or
// `unpublished-changes` (the saved draft, resolved as publishing resolves
// it, differs from the snapshot); `missing` for a snapshot with no draft.
// - blocks: { [blockId]: library block } for the draft's instances
export const postPublicationStatus = (post, live, blocks = {}) => {
  if (!post)
    return live ? 'missing' : 'draft'
  if (!live)
    return 'draft'
  const resolved = { ...post, content: Array.isArray(post.content) ? post.content.map(block => resolvePostInstance(block, blocks)) : post.content }
  return stableSerialize(postComparable(live)) === stableSerialize(postComparable(resolved)) ? 'published' : 'unpublished-changes'
}

// ---- Post routes (cmsPostRoutes.js) ----

const isPostRendererBlock = (block) => {
  if (!isPlainObject(block))
    return false
  const template = String(block.template || block.content || '')
  const hasPostCollection = Object.values(block.dataSources || {}).some(source => source?.type === 'collection' && String(source?.path || '').trim() === 'posts')
  return template.includes('#renderBlocks') && hasPostCollection
}
// isCmsPostRoutePage: a post template page whose post view renders posts.
export const isPostRoutePage = page => !!page && page.post === true && Array.isArray(page.postContent) && page.postContent.some(isPostRendererBlock)

// Every route a post can be read at: the menu (and folder) slugs of each
// post route page, in the order findFirstCmsPostRouteSegments walks them
// (no menu prefix), then the post's slug, as the Hub's live URLs build them
// (buildCmsPostLiveUrl; a "home" route serves /{post}/).
// - pages: { [pageId]: draft page }
export const postRoutePaths = (menus, pages, slug) => {
  const name = String(slug || '').trim()
  if (!name)
    return []
  const routes = []
  const visit = (entries, folders) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (isExternalLinkEntry(entry))
        continue
      if (typeof entry?.item === 'string') {
        const pageSlug = routeSlug(entry.name)
        if (pageSlug && isPostRoutePage(pages?.[entry.item]))
          routes.push([...folders, pageSlug])
        continue
      }
      if (!isPlainObject(entry?.item))
        continue
      const folder = Object.entries(entry.item).find(([, children]) => Array.isArray(children))
      if (folder && routeSlug(folder[0]))
        visit(folder[1], [...folders, routeSlug(folder[0])])
    }
  }
  for (const entries of Object.values(isPlainObject(menus) ? menus : {}))
    visit(entries, [])
  const encoded = encodeURIComponent(name)
  return [...new Set(routes.map(segments => ((segments.length === 1 && segments[0] === 'home')
    ? `/${encoded}/`
    : `/${segments.map(segment => encodeURIComponent(segment)).join('/')}/${encoded}/`)))]
}

// ---- Post lists and outlines (agent post reads) ----

const postDate = post => String(post?.publishedAt || '') || ((Number.isFinite(Number(post?.doc_created_at)) && post?.doc_created_at) ? new Date(Number(post.doc_created_at)).toISOString() : '')

// One post's row in a list.
export const describePost = ({ postId, post, live, blocks = {} }) => {
  const doc = post || live || {}
  return {
    postId,
    exists: !!post,
    name: String(doc.name || ''),
    title: String(doc.title || ''),
    type: normalizePostType(doc.type),
    tags: Array.isArray(doc.tags) ? [...doc.tags] : [],
    publishedAt: (live?.publishedAt ?? post?.publishedAt) || null,
    publishAt: (typeof post?.publishAt === 'string' && post.publishAt) ? post.publishAt : null,
    status: postPublicationStatus(post, live, blocks),
    blockIds: Array.isArray(doc.blockIds) ? [...doc.blockIds] : derivePostBlockIds(doc),
  }
}

// A site's posts, newest first (publication date, else creation), filtered
// by type and tag and paged after `startAfter` (a postId).
// - posts: { [postId]: draft }, published: { [postId]: snapshot }
export const selectSitePosts = ({ posts = {}, published = {}, type = null, tag = null, limit = 50, startAfter = null }) => {
  const sorted = [...new Set([...Object.keys(posts), ...Object.keys(published)])]
    .map(postId => ({ postId, doc: posts[postId] || published[postId] }))
    .filter(({ doc }) => (!type || normalizePostType(doc?.type) === type) && (!tag || (Array.isArray(doc?.tags) && doc.tags.includes(tag))))
    .sort((a, b) => postDate(b.doc).localeCompare(postDate(a.doc)) || (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0))
  const start = startAfter ? sorted.findIndex(entry => entry.postId === startAfter) + 1 : 0
  const page = sorted.slice(start, start + limit)
  return {
    postIds: page.map(entry => entry.postId),
    matched: sorted.length,
    nextStartAfter: (start + limit < sorted.length) ? (page.at(-1)?.postId || null) : null,
  }
}

const POST_DOC_OUTLINE_FIELDS = ['title', 'blurb', 'featuredImage', 'restrictionRuleId', 'publishAt', 'publishAtTimezone', 'publishAtError']

// One post as its fields and its body outline (outlineBody), instead of the
// raw document.
export const buildPostOutline = ({ postId, post = {}, source = 'draft', status = null, paths = [], blocks = {}, includeValues = true, includeSchema = false }) => ({
  postId,
  source,
  name: String(post.name || ''),
  paths,
  status,
  type: normalizePostType(post.type),
  ...Object.fromEntries(POST_DOC_OUTLINE_FIELDS.map(key => [key, typeof post[key] === 'string' ? post[key] : ''])),
  ...((Array.isArray(post.featuredImages) && post.featuredImages.length) ? { featuredImages: [...post.featuredImages] } : {}),
  tags: Array.isArray(post.tags) ? [...post.tags] : [],
  ...(normalizePostType(post.type) === 'event' ? { event: normalizePostEvent(post.event) } : {}),
  publishedAt: post.publishedAt || null,
  hidePublishedDate: post.hidePublishedDate === true,
  imported: isPlainObject(post.legacyBlog),
  doc_created_at: post.doc_created_at ?? null,
  last_updated: post.last_updated ?? null,
  body: outlineBody({ content: post.content, structure: post.structure, blocks, includeValues, includeSchema }),
  blockIds: Array.isArray(post.blockIds) ? [...post.blockIds] : derivePostBlockIds(post),
})

// ---- Operation specs ----
//
// What every operation accepts, declared once: the checks in
// functions/cmsOperations.js enforce it (tests prove each declared rule is
// refused when broken), and cms_contract serves the operations contract
// generated from it (renderOperationsContract). Explanations here are the
// defaults; docs/features/cms/agent-contracts-design.md has the plan for
// editable overrides.
//
// Field types: docId (a Firestore document id), string, text (a non-empty
// string), boolean, integer, object, list, json (a JSON object as a string).
// `required` fields are refused when missing; `values` lists the allowed
// values; `fields` lists the keys an object may hold.

const docIdField = (note, extra = {}) => ({ type: 'docId', required: true, note, ...extra })
const siteIdField = docIdField('Site document id (cms_list_pages, the Hub URL).')
const pageIdField = docIdField('Draft page id (cms_list_pages).')
const postIdField = docIdField('Draft post id (cms_list_posts).')
const instanceIdField = docIdField('Block instance id (cms_get_page or cms_get_post).')
const indexField = { type: 'integer', note: 'Row position; 0 is the first row. Out-of-range values are clamped.' }
const valuesField = { type: 'object', note: 'Field values for the block, validated against its schema. Under 200 KB.' }

export const CMS_OPERATION_SPECS = Object.freeze({
  'theme.create': {
    scope: 'organization',
    writes: 'themes',
    summary: 'Create a theme. Theme and Head JSON default to the standard new-theme values when omitted.',
    effect: '`themes/{id}` with the shared new-theme Theme and Head JSON defaults when omitted, `extraCSS: \'\'`, `version: 1`, `defaultPages: []`, empty root menus',
    input: {
      themeId: { type: 'docId', note: 'Optional id; generated when omitted.' },
      fields: { type: 'object', required: true, fields: ['name', 'theme', 'headJSON', 'extraCSS', 'typeRoles', 'defaultPages', 'defaultMenus', 'defaultSiteSettings'], note: '`name` is required; `theme` and `headJSON` are JSON object strings; new themes must use the standard token names.' },
    },
    result: '{ themeId }',
    problems: ['theme.exists', 'theme.fields', 'theme.name-required', 'theme.json-required', 'theme.token-names'],
  },
  'theme.update': {
    scope: 'organization',
    writes: 'themes',
    summary: 'Change fields of a theme no published site uses.',
    effect: 'The listed fields. Refused when the theme is live (Invariants)',
    input: {
      themeId: docIdField('Theme id (cms_find_theme).'),
      fields: { type: 'object', required: true, fields: ['name', 'theme', 'headJSON', 'extraCSS', 'typeRoles', 'defaultPages', 'defaultMenus', 'defaultSiteSettings'], note: 'Only the listed fields change.' },
    },
    result: '{ themeId }',
    problems: ['theme.not-found', 'theme.fields', 'theme.no-fields', 'theme.token-names', 'theme.live'],
  },
  'theme.propose': {
    scope: 'organization',
    writes: 'themes',
    summary: 'Propose a change to a theme, for a person to review and apply in the Hub\'s theme editor. The theme is unchanged.',
    effect: '`themeProposals/{id}`: `{ themeId, fields, note, status: \'open\', createdBy, createdAt }`; the theme is unchanged. A person reviews it in the Hub\'s theme editor (Theme Proposals): applying saves `fields` over the theme and sets `status: \'applied\'`, `appliedBy`, `appliedAt`; rejecting sets `status: \'rejected\'`, `rejectedBy`, `rejectedAt`',
    input: {
      themeId: docIdField('Theme id (cms_find_theme).'),
      fields: { type: 'object', required: true, fields: ['name', 'theme', 'headJSON', 'extraCSS', 'typeRoles', 'defaultPages', 'defaultMenus', 'defaultSiteSettings'], note: 'The proposed values.' },
      note: { type: 'string', note: 'What the change is for, shown to the reviewer. Up to 2000 characters.' },
    },
    result: '{ themeId, proposalId }',
    problems: ['theme.not-found', 'theme.fields', 'theme.no-fields', 'theme.token-names'],
  },
  'site.create': {
    scope: 'organization',
    writes: 'sites',
    summary: 'Create a site as the Hub\'s new-site form does, with a draft page for each entry of the theme\'s default menus.',
    effect: '`sites/{auto id}` as the Hub\'s new-site form saves it (Document shapes), and one draft page per theme default-menu entry. Users, members-only content and the AI agent are left to the Hub\'s site settings.',
    input: {
      name: { type: 'text', required: true },
      theme: { type: 'docId', required: true, note: 'An existing theme id.' },
      domains: { type: 'list', required: true, note: 'At least one domain, each 45 characters or fewer.' },
      settings: { type: 'object', fields: SITE_CREATE_FIELDS, note: '`forwardApex` is true or false, `allowedThemes` a list that includes `theme`, the rest strings.' },
    },
    result: '{ siteId, pageIds }',
    problems: ['site.name-required', 'site.theme-required', 'theme.not-found', 'site.domains', 'fields.not-allowed', 'fields.type', 'site.allowed-themes', 'structured-data'],
  },
  'site.update': {
    scope: 'site',
    writes: 'sites',
    summary: 'Change the draft site\'s SEO fields. Published site settings change when the site is published from the Hub.',
    effect: 'Those fields on the draft site document (`sites/{siteId}`); published site settings are unchanged until the site is published from the Hub. Other settings stay with the Hub\'s site settings',
    input: {
      siteId: siteIdField,
      fields: { type: 'object', required: true, fields: SITE_UPDATE_FIELDS, note: 'Strings.' },
    },
    result: '{ siteId }',
    problems: ['site.not-found', 'fields.not-allowed', 'fields.type', 'site.no-fields', 'structured-data'],
  },
  'page.create': {
    scope: 'site',
    writes: 'sites',
    summary: 'Create a blank draft page and add it to a root menu.',
    effect: '`sites/{siteId}/pages/{uuid}`: the menu editor\'s blank page (`name` = unique root slug) with `fields` applied in the same write, and the site\'s `menus` with `{ name: slug, menuTitle: name, item: pageId }` added',
    input: {
      siteId: siteIdField,
      name: { type: 'text', required: true, note: 'The page title; its slug is made unique among root pages.' },
      menu: { type: 'string', values: ROOT_MENUS, default: 'Site Root' },
      fields: { type: 'object', fields: PAGE_UPDATE_FIELDS, note: 'SEO fields, as page.update.' },
    },
    result: '{ siteId, pageId, slug }',
    problems: ['site.not-found', 'page.templates-site', 'page.menu', 'page.name-required', 'fields.type', 'fields.not-allowed', 'structured-data'],
  },
  'page.update': {
    scope: 'site',
    writes: 'sites',
    summary: 'Change a draft page\'s SEO fields.',
    effect: 'Those fields; `version` + 1. Structured data rules in Invariants. Refused when it sets `structuredData` on a page with `structuredDataAiLocked: true` (custom structured data copied from its template), which the Hub\'s AI SEO also leaves alone; it is edited in the Hub\'s page settings. The other fields, `postStructuredData` included, stay open, as they do for the Hub\'s AI',
    input: {
      siteId: siteIdField,
      pageId: pageIdField,
      fields: { type: 'object', required: true, fields: PAGE_UPDATE_FIELDS, note: 'Strings. `structuredData` is refused on a page whose structured data is AI-locked.' },
    },
    result: '{ siteId, pageId }',
    problems: ['site.not-found', 'page.not-found', 'fields.not-allowed', 'fields.type', 'page.no-fields', 'page.structured-data-locked', 'structured-data'],
  },
  'page.placeBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Place a library block in a new full-width row of a draft page.',
    effect: 'A new instance and a new full-width row (Document shapes); `blockIds`; `version` + 1. A synced block (site chrome) copies the site\'s existing synced instance (`values`, `meta`, `protection`, `blockUpdatedAt`; its own instance id) and refuses `values`; refused when the site has no instance of it yet (the first one is placed in the Hub)',
    input: {
      siteId: siteIdField,
      pageId: pageIdField,
      blockId: docIdField('Library block id (cms_find_block).'),
      values: valuesField,
      index: indexField,
      area: { type: 'string', values: ['main', 'post'], default: 'main', note: '`post` places it in the page\'s post area.' },
    },
    result: '{ siteId, pageId, instanceId, rowId }',
    problems: ['site.not-found', 'page.not-found', 'area.invalid', 'block.not-found', 'block.synced-first', 'block.synced-values', 'values.template-v1', 'values.invalid', 'values.schema'],
  },
  'page.setValues': {
    scope: 'site',
    writes: 'sites',
    summary: 'Set field values on a placed block instance (Template v2, not synced).',
    effect: 'The instance\'s `values` (merged unless `replace`), `blockUpdatedAt`; `version` + 1. Template v2, non-synced instances only',
    input: {
      siteId: siteIdField,
      pageId: pageIdField,
      instanceId: instanceIdField,
      values: { ...valuesField, required: true },
      replace: { type: 'boolean', default: false, note: 'Replace all values instead of merging.' },
    },
    result: '{ siteId, pageId, instanceId }',
    problems: ['site.not-found', 'page.not-found', 'instance.not-found', 'values.template-v1', 'block.synced-values', 'values.invalid', 'values.schema'],
  },
  'page.removeBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Remove a block instance; rows left empty are removed.',
    effect: 'The instance, its column reference, rows left empty; `blockIds`; `version` + 1',
    input: { siteId: siteIdField, pageId: pageIdField, instanceId: instanceIdField },
    result: '{ siteId, pageId }',
    problems: ['site.not-found', 'page.not-found', 'instance.not-found'],
  },
  'page.moveBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Move a block instance to another row position in its area.',
    effect: 'The area\'s rows (`structure` or `postStructure`); `version` + 1. An instance alone in its row moves with the row (layout and settings unchanged); one sharing a row leaves its column for a new full-width row (Document shapes). Rows left empty are removed, as `page.removeBlock` removes them. The instance, its values, meta and synced state, and `blockIds` are unchanged. Refused for moves between the main and post areas, an instance in no row, and a move that changes nothing',
    input: {
      siteId: siteIdField,
      pageId: pageIdField,
      instanceId: instanceIdField,
      index: { ...indexField, required: true },
      area: { type: 'string', values: ['main', 'post'], note: 'Must be the instance\'s own area.' },
    },
    result: '{ siteId, pageId, instanceId, rowId, index, area }',
    problems: ['site.not-found', 'page.not-found', 'instance.not-found', 'area.invalid', 'move.cross-area', 'move.index', 'move.no-row', 'move.no-change'],
  },
  'block.create': {
    scope: 'organization',
    writes: 'blocks',
    summary: 'Create a library block after the Hub\'s import check.',
    effect: '`blocks/{docId}` after the Hub import check (`checkImportedBlock`), filled with the new-block defaults. Refused if the block exists',
    input: {
      block: { type: 'object', required: true, note: 'A block document with its `docId` (blocks contract). Check it with cms_validate first.' },
    },
    result: '{ blockId }',
    problems: ['block.document', 'block.exists', 'block.design-reference', 'block.validation', 'block.tags'],
  },
  'block.draft': {
    scope: 'organization',
    writes: 'blocks',
    summary: 'Save an unreleased draft of a library block; a developer releases it in the Hub.',
    effect: 'A draft revision through the same save as `cms-saveBlockDraft`, with `source: \'agent\'` and its base check (`docs/data-contracts/cms-blocks/README.md`, Revisions). Fields `definition` leaves out keep the current definition\'s; a Template v2 `template` follows `content`; `null` removes a field',
    input: {
      blockId: docIdField('Library block id (cms_find_block).'),
      definition: { type: 'object', required: true, note: 'The block definition; `content` is required. Fields left out keep their current values; `null` removes one.' },
      baseHash: { type: 'string', required: true, note: 'cms_block_base\'s baseHash for the definition you started from.' },
      baseRevision: { type: 'integer', note: 'The revision you started from, when known.' },
    },
    result: '{ blockId, status, releasedRevision, draftRevision } (status saved, unchanged or discarded)',
    problems: ['block.not-found', 'block.definition', 'block.base-hash-required', 'block.changed', 'block.design-reference', 'block.validation', 'block.tags'],
  },
  'post.create': {
    scope: 'site',
    writes: 'sites',
    summary: 'Create a draft post as the post editor does. Nothing is published.',
    effect: '`sites/{siteId}/posts/{auto id}` as the post editor saves a new post (Document shapes, Post), with the slug made unique among the site\'s draft posts (`-1`, `-2`…; a notice says so). With `templateId`, the template\'s body is copied as the new-post dialog copies it. Nothing is published.',
    input: {
      siteId: siteIdField,
      title: { type: 'text', required: true },
      blurb: { type: 'text', required: true, max: POST_BLURB_MAX, note: 'Preview text.' },
      name: { type: 'string', note: 'Slug; made from the title when omitted, and made unique.' },
      tags: { type: 'list', note: 'Strings.' },
      featuredImage: { type: 'string', note: 'One image URL or storage path.' },
      postType: { type: 'string', values: ['post', 'event'], default: 'post', note: 'The post\'s kind; `type` is the operation.' },
      event: { type: 'object', note: 'For events (posts contract, Events).' },
      templateId: { type: 'docId', note: 'A Post template page on the templates site; its body is copied.' },
    },
    closed: true,
    result: '{ siteId, postId, name }',
    problems: ['site.not-found', 'fields.not-allowed', 'post.title-required', 'post.blurb-required', 'post.blurb-too-long', 'post.tags', 'post.featured-image', 'post.type', 'post.event', 'post.slug', 'post.template-not-found', 'post.template-type'],
  },
  'post.update': {
    scope: 'site',
    writes: 'sites',
    summary: 'Change a draft post\'s fields with the post editor\'s rules.',
    effect: 'Those fields and `last_updated`/`uid`, with the editor\'s rules: title and blurb required, blurb at most 500 characters, `name` slugified and made unique (a title change keeps the slug, as for a saved post in the editor), `event` merged into the post\'s event and recomputed for events, `restrictionRuleId` empty or one of the site\'s `restrictedContent.rules` ids. Other fields are refused',
    input: {
      siteId: siteIdField,
      postId: postIdField,
      fields: { type: 'object', required: true, fields: POST_UPDATE_FIELDS, note: 'Publication, scheduling and dates are set in the Hub.' },
    },
    result: '{ siteId, postId }',
    problems: ['site.not-found', 'post.not-found', 'post.no-fields', 'fields.not-allowed', 'post.title-required', 'post.blurb-required', 'post.blurb-too-long', 'post.tags', 'post.featured-image', 'post.slug', 'post.event', 'post.restriction-rule'],
  },
  'post.placeBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Place a library block (one whose types include Post) in a new row of a draft post.',
    effect: 'As `page.placeBlock`, in the post\'s `content`/`structure`, with a post row (Document shapes, Post) and post `blockIds`. Refused for blocks the post editor\'s picker doesn\'t offer: a block\'s types must include `Post` (no type counts as `Page`). Posts have one body: `area` is refused',
    input: { siteId: siteIdField, postId: postIdField, blockId: docIdField('Library block id (cms_find_block).'), values: valuesField, index: indexField },
    result: '{ siteId, postId, instanceId, rowId }',
    problems: ['site.not-found', 'post.not-found', 'post.area', 'post.legacy-body', 'block.not-found', 'block.not-allowed-here', 'block.synced-first', 'block.synced-values', 'values.template-v1', 'values.invalid', 'values.schema'],
  },
  'post.setValues': {
    scope: 'site',
    writes: 'sites',
    summary: 'Set field values on a block instance in a draft post, as page.setValues.',
    effect: 'As `page.setValues`',
    input: { siteId: siteIdField, postId: postIdField, instanceId: instanceIdField, values: { ...valuesField, required: true }, replace: { type: 'boolean', default: false } },
    result: '{ siteId, postId, instanceId }',
    problems: ['site.not-found', 'post.not-found', 'post.legacy-body', 'instance.not-found', 'values.template-v1', 'block.synced-values', 'values.invalid', 'values.schema'],
  },
  'post.moveBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Move a block instance to another row of a draft post, as page.moveBlock.',
    effect: 'As `page.moveBlock`; an instance leaving a shared row gets a post row',
    input: { siteId: siteIdField, postId: postIdField, instanceId: instanceIdField, index: { ...indexField, required: true } },
    result: '{ siteId, postId, instanceId, rowId, index, area }',
    problems: ['site.not-found', 'post.not-found', 'post.area', 'post.legacy-body', 'instance.not-found', 'move.index', 'move.no-row', 'move.no-change'],
  },
  'post.removeBlock': {
    scope: 'site',
    writes: 'sites',
    summary: 'Remove a block instance from a draft post, as page.removeBlock.',
    effect: 'As `page.removeBlock`',
    input: { siteId: siteIdField, postId: postIdField, instanceId: instanceIdField },
    result: '{ siteId, postId }',
    problems: ['site.not-found', 'post.not-found', 'post.legacy-body', 'instance.not-found'],
  },
})

// What each problem code means and how to fix it. Every code a check
// reports is listed here (tests enforce both directions).
export const CMS_OPERATION_PROBLEMS = Object.freeze({
  'theme.exists': 'A theme with that id exists. Leave themeId out, or change it with theme.update or theme.propose.',
  'theme.fields': 'A theme field has the wrong form: theme and headJSON must be JSON object strings, extraCSS a string, typeRoles an object of class names.',
  'theme.name-required': 'New themes need fields.name.',
  'theme.json-required': 'New themes need their Theme JSON (fields.theme).',
  'theme.not-found': 'No theme with that id in this organization (cms_find_theme).',
  'theme.no-fields': 'fields has nothing to change.',
  'theme.live': 'A published site uses this theme, so changes would go live at once. Use theme.propose; a person applies it in the theme editor.',
  'theme.token-names': 'The Theme JSON uses non-standard token names. New and standard themes must keep the standard names (themes contract).',
  'structured-data': 'Structured data must be valid JSON-LD. Read the message for the exact error.',
  'site.not-found': 'No site with that id in this organization (cms_list_pages lists a site\'s pages; the Hub shows site ids).',
  'site.name-required': 'New sites need a name.',
  'site.theme-required': 'New sites need a theme (an existing theme id).',
  'site.domains': 'Sites need at least one domain, each 45 characters or fewer.',
  'site.allowed-themes': 'settings.allowedThemes must include the site\'s theme.',
  'site.no-fields': 'fields has nothing to change.',
  'fields.not-allowed': 'The operation can\'t set that field; the message lists the ones it can. The rest are set in the Hub.',
  'fields.type': 'A field has the wrong type; the message says which type it needs.',
  'page.not-found': 'No draft page with that id on the site (cms_list_pages).',
  'page.templates-site': 'Pages on the templates site are created in the Hub.',
  'page.menu': 'menu must be one of the root menus.',
  'page.name-required': 'New pages need a name.',
  'page.no-fields': 'fields has nothing to change.',
  'page.structured-data-locked': 'The page\'s structured data came from its template and is AI-locked; change it in the Hub\'s page settings. The other fields can still change.',
  'block.not-found': 'No library block with that id (cms_find_block). New blocks use block.create.',
  'block.not-allowed-here': 'This block can\'t go here; for posts, the block\'s types must include Post.',
  'block.synced-first': 'A synced block (site chrome) is placed first in the Hub; after that, operations can place copies.',
  'block.synced-values': 'A synced block\'s values are shared across the site and edited in the Hub.',
  'block.document': 'block must be a block document object.',
  'block.exists': 'A block with that docId exists. Change it with block.draft.',
  'block.design-reference': 'meta.design has the wrong form (blocks contract, design references).',
  'block.validation': 'The block fails the Hub\'s import check; the message starts with the validator\'s code. Check it with cms_validate and fix every error.',
  'block.tags': 'The block\'s tags break the organization\'s tag list or tag count rules.',
  'block.definition': 'definition must be a block definition object with string content.',
  'block.base-hash-required': 'baseHash is required: send cms_block_base\'s baseHash for the definition you started from.',
  'block.changed': 'The block changed in the Hub since you read it. Read cms_block_base again, reapply your change, and send the new baseHash.',
  'values.template-v1': 'Values can only be set on Template v2 blocks; Template v1 blocks are edited in the Hub.',
  'values.invalid': 'values must be an object under 200 KB.',
  'values.schema': 'A value doesn\'t match the block\'s schema (unknown field, wrong type, missing required value, or out of bounds).',
  'instance.not-found': 'No block instance with that id (cms_get_page or cms_get_post).',
  'area.invalid': 'area must be one of the page\'s areas: "main" or "post" (when the page has a post area). Leave it out for main.',
  'move.cross-area': 'Blocks can\'t move between the main and post areas; remove it and place the block in the other area.',
  'move.index': 'index must be a whole number: the row position (0 is the first row).',
  'move.no-row': 'The instance isn\'t in any row; remove it and place the block again.',
  'move.no-change': 'The instance is already at that position.',
  'post.not-found': 'No draft post with that id on the site (cms_list_posts).',
  'post.no-fields': 'fields has nothing to change.',
  'post.title-required': 'Posts need a non-empty title.',
  'post.blurb-required': 'Posts need a non-empty blurb (preview text).',
  'post.blurb-too-long': 'The blurb is too long; the message gives the limit.',
  'post.tags': 'tags must be a list of strings.',
  'post.featured-image': 'featuredImage must be one image URL or storage path.',
  'post.type': 'postType must be "post" or "event".',
  'post.event': 'The event fields are invalid; the message says which (posts contract, Events).',
  'post.slug': 'name must be a slug, like "spring-open-house".',
  'post.template-not-found': 'No page with that id on the templates site.',
  'post.template-type': 'The template page isn\'t a Post template.',
  'post.restriction-rule': 'restrictionRuleId must be empty or one of the site\'s restricted-content rules.',
  'post.area': 'Posts have one body; leave area out.',
  'post.legacy-body': 'The post still has a legacy HTML body; open it once in the Hub\'s post editor to turn it into blocks.',
})

const markdownCell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

// The operations section of the operations contract, as Markdown.
export const renderOperationsContract = (specs = CMS_OPERATION_SPECS, problems = CMS_OPERATION_PROBLEMS) => {
  const lines = [
    '## Operations',
    '',
    'Generated from `CMS_OPERATION_SPECS` in `edge/lib/cmsOperations.js`, the definitions the checks enforce. Every operation is `{ type, ...input }`. Send it to `cms_check_operation`, then to `cms_run_operation` with the returned checksum. A refusal lists its messages in `problems` and their codes in `problemCodes` (Problem codes, below). Not supported: synced block values (edited in the Hub), Template v1 values, multi-column rows, and moving a block into another column or a whole multi-instance row.',
    '',
  ]
  const order = type => (CMS_OPERATION_TYPES.includes(type) ? CMS_OPERATION_TYPES.indexOf(type) : CMS_OPERATION_TYPES.length)
  for (const [type, spec] of Object.entries(specs).sort(([a], [b]) => order(a) - order(b))) {
    lines.push(`### \`${type}\``, '', spec.summary, '', ...(spec.effect ? [`Writes: ${spec.effect}`, ''] : []), `Session: ${spec.scope}. Needs write access to ${spec.writes}. Result: \`${spec.result}\`.${spec.closed ? ' No other keys are accepted.' : ''}`, '', '| Input | Type | Required | Notes |', '| --- | --- | --- | --- |')
    for (const [name, field] of Object.entries(spec.input)) {
      const details = [
        field.values ? `One of ${field.values.map(value => `\`${value}\``).join(', ')}.` : '',
        field.default !== undefined ? `Default \`${field.default}\`.` : '',
        field.max ? `At most ${field.max} characters.` : '',
        field.fields ? `Keys: ${field.fields.map(key => `\`${key}\``).join(', ')}.` : '',
        field.note || '',
      ].filter(Boolean).join(' ')
      lines.push(`| \`${name}\` | ${field.type} | ${field.required ? 'yes' : 'no'} | ${markdownCell(details)} |`)
    }
    lines.push('', `Refusals: ${spec.problems.map(code => `\`${code}\``).join(', ')}.`, '')
  }
  lines.push('### Problem codes', '', '| Code | Meaning and fix |', '| --- | --- |')
  for (const [code, text] of Object.entries(problems))
    lines.push(`| \`${code}\` | ${markdownCell(text)} |`)
  return `${lines.join('\n')}\n`
}

// The marker in the operations contract that the generated section replaces
// when cms_contract serves it.
export const OPERATIONS_CONTRACT_MARKER = '<!-- operations: generated from CMS_OPERATION_SPECS -->'
export const withGeneratedOperations = markdown => (String(markdown).includes(OPERATIONS_CONTRACT_MARKER)
  ? String(markdown).replace(OPERATIONS_CONTRACT_MARKER, renderOperationsContract().trimEnd())
  : String(markdown))
