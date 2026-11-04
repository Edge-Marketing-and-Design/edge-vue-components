// cms_compare_instances (local only): what a proposed block definition would
// do to every instance already placed on pages and posts, before a draft is
// saved or released.
//
// Each instance renders twice with the Hub's template engine (pageRender, as
// the public renderer does): "before" from the instance's own copy of the
// markup, the way it renders today, and "after" from the proposed definition
// applied the way a release applies it (the release worker's own
// updateBlocksInArray: definition fields copied, library meta merged, newly
// added schema fields defaulted; instance values and per-page Data Source
// settings kept). Data Sources get the same records on both sides.
//
// Limits: it checks the template and the values, not where live records come
// from. API sources and the Hub preview's own source loading still need
// cms_preview_url.
import { createRequire } from 'node:module'
import { buildSourceFixtures } from '../../../../lib/cmsBlockValidation.js'
import { blockDataSources, prepareBlockForRender } from '../../../../lib/cmsDataSourceRecords.js'

const require = createRequire(import.meta.url)
const { updateBlocksInArray, BLOCK_DEFINITION_SYNC_FIELDS } = require('../../../../functions/helpers/cmsBlockPropagation.js')

export const COMPARE_COLLECTIONS = Object.freeze(['pages', 'published', 'posts', 'published_posts'])
export const DEFAULT_MAX_RENDERS = 3000
export const MAX_LISTED = 50
// The definition a release stores (RELEASE_DEFINITION_FIELDS).
const DEFINITION_FIELDS = ['content', 'template', 'templateVersion', 'schema', 'dataSources', 'isOverrideBlock', 'meta', 'values']
// The fields an instance holds its own copy of (the release sync fields).
const COPY_FIELDS = BLOCK_DEFINITION_SYNC_FIELDS.filter(field => field !== 'blockUpdatedAt')
const RENDER_FIELDS = [...COPY_FIELDS, 'values', 'meta']
// Values the renderer adds itself; never schema fields.
const RUNTIME_VALUES = new Set(['routeLastSegment', 'orgId', 'siteId'])
const EXCERPT = 120

export const LIMITS_NOTE = 'Checks the template and the values with the same records on both sides; it does not check where live records come from. API sources and the Hub preview\'s own source loading still need cms_preview_url (with blockDrafts). Renders are unthemed and use an empty routeLastSegment.'

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const pick = (object, fields) => Object.fromEntries(fields.filter(field => object?.[field] !== undefined).map(field => [field, object[field]]))
const hasValue = value => !(value === undefined || value === null || value === ''
  || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length))

export const canonicalJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (isObject(value))
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value === undefined ? null : value)
}

// HTML comments, whitespace between tags, runs of whitespace and spaces at
// the ends of an attribute value don't change the page; the loading-state
// tokens are the runtime's.
export const normalizeHtml = html => String(html || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\{\{\s*load(?:ing|ed)\s*\}\}/g, '')
  .replace(/\s+/g, ' ')
  .replace(/>\s+</g, '><')
  .replace(/\s+>/g, '>')
  .replace(/="\s+/g, '="')
  .replace(/\s+"(?=[\s>/])/g, '"')
  .trim()

// A short before/after excerpt around the first difference.
export function firstDifference(before, after) {
  let index = 0
  while (index < before.length && index < after.length && before[index] === after[index])
    index++
  const start = Math.max(0, index - 40)
  return {
    at: index,
    before: before.slice(start, start + EXCERPT),
    after: after.slice(start, start + EXCERPT),
  }
}

// Replaces a source with fixed records (as cmsAgentRender.js does): the
// engine finds nothing under the empty key and falls back to `value`.
function setStaticSource(block, name, records, orgId) {
  const empty = { uniqueKey: `${orgId}:-`, canonicalLookup: { key: `-:${orgId}:-` } }
  if (Number(block.templateVersion) === 2) {
    const { type: _type, path: _path, collection: _collection, query: _query, queryItems: _queryItems, canonicalLookup: _canonical, uniqueKey: _uniqueKey, baseKey: _baseKey, order: _order, api: _api, apiField: _apiField, apiQuery: _apiQuery, ...rest } = block.dataSources?.[name] || {}
    block.dataSources = isObject(block.dataSources) ? block.dataSources : {}
    block.dataSources[name] = { ...rest, ...empty, value: records }
    if (isObject(block.meta?.[name]))
      block.meta[name] = { value: records }
    return
  }
  block.meta[name] = { value: records, collection: empty }
}

// One record set per source name for both sides: the caller's records, else
// one sample record with every field either template reads, and one empty.
function sourceRecordsFor(names, templates, given) {
  const records = {}
  const fixtures = templates.map(template => buildSourceFixtures(template, names).fixtures)
  for (const name of names) {
    if (Array.isArray(given?.[name])) {
      records[name] = clone(given[name])
      continue
    }
    const filled = Object.assign({}, ...fixtures.map(set => (isObject(set[name]?.[0]) ? set[name][0] : {})))
    records[name] = [filled, {}]
  }
  return records
}

const sourceLimit = (source) => {
  const limit = Number(source?.limit)
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null
}

async function renderSide(block, { orgId, siteId, records, pageRender }) {
  const prepared = prepareBlockForRender(block, { orgId, siteId, routeLastSegment: '' })
  prepared.meta = isObject(prepared.meta) ? prepared.meta : {}
  for (const entry of blockDataSources(prepared, { orgId, siteId, routeLastSegment: '' })) {
    const limit = sourceLimit(entry.source)
    const list = records[entry.name] || []
    setStaticSource(prepared, entry.name, limit ? list.slice(0, limit) : list, orgId)
  }
  const rendered = await pageRender([{ ...prepared, id: prepared.id || 'instance' }], {}, '', null)
  return String(rendered?.blocks?.[0]?.html || '')
}

// Every instance of blockId in the documents ({ siteId, collection, docId,
// name, data }).
export function collectInstances(documents, blockId) {
  const instances = []
  for (const document of documents) {
    for (const listName of ['content', 'postContent']) {
      for (const block of Array.isArray(document.data?.[listName]) ? document.data[listName] : []) {
        if (block?.blockId === blockId)
          instances.push({ siteId: document.siteId, collection: document.collection, docId: document.docId, docName: document.name || '', instanceId: String(block.id || ''), block })
      }
    }
  }
  return instances
}

// The comparison itself. `library` is the released library block, `proposed`
// the definition to compare (a draft or an inline definition), `documents`
// the pages and posts to look in. `pageRender` is the engine's.
export async function compareInstances({
  orgId,
  blockId,
  library,
  proposed,
  documents,
  sourceRecords = null,
  pageRender,
  maxRenders = DEFAULT_MAX_RENDERS,
}) {
  if (typeof pageRender !== 'function')
    throw new Error('The template engine (@edgedev/template-engine) could not be loaded from the Hub checkout.')
  const released = isObject(library) ? library : {}
  const definition = pick(isObject(proposed) ? proposed : {}, DEFINITION_FIELDS)
  const instances = collectInstances(documents, blockId)

  // Instances whose own copy of the markup is not the library block's: a
  // release overwrites their copy.
  const libraryCopy = canonicalJson(pick(released, COPY_FIELDS))
  const drifted = instances.filter(instance => canonicalJson(pick(instance.block, COPY_FIELDS)) !== libraryCopy)

  // Values for fields the proposed schema no longer has.
  const removed = new Map()
  if (Number(definition.templateVersion) === 2 && isObject(definition.schema)) {
    for (const instance of instances) {
      for (const [field, value] of Object.entries(isObject(instance.block.values) ? instance.block.values : {})) {
        if (RUNTIME_VALUES.has(field) || Object.prototype.hasOwnProperty.call(definition.schema, field) || !hasValue(value))
          continue
        if (!removed.has(field))
          removed.set(field, [])
        removed.get(field).push(instance)
      }
    }
  }

  // Before and after for each instance, grouped by what they render.
  const groups = new Map()
  for (const instance of instances) {
    const before = clone(instance.block)
    const after = clone(instance.block)
    await updateBlocksInArray([after], blockId, released, definition)
    const key = canonicalJson({ siteId: instance.siteId, before: pick(before, RENDER_FIELDS), after: pick(after, RENDER_FIELDS) })
    if (!groups.has(key))
      groups.set(key, { before, after, siteId: instance.siteId, instances: [] })
    groups.get(key).instances.push(instance)
  }

  const counts = { instances: instances.length, distinctRenders: groups.size, rendered: 0, identical: 0, different: 0, failed: 0, unchecked: 0 }
  const bySite = new Map()
  const tally = (instance, outcome, groupKey) => {
    const key = `${instance.siteId}/${instance.collection}`
    if (!bySite.has(key))
      bySite.set(key, { siteId: instance.siteId, collection: instance.collection, instances: 0, distinctRenders: new Set(), identical: 0, different: 0, failed: 0, unchecked: 0 })
    const entry = bySite.get(key)
    entry.instances++
    entry.distinctRenders.add(groupKey)
    entry[outcome]++
  }
  const differences = []
  const failures = []
  let groupIndex = 0
  for (const [groupKey, group] of groups) {
    groupIndex++
    if (counts.rendered >= maxRenders) {
      counts.unchecked += group.instances.length
      group.instances.forEach(instance => tally(instance, 'unchecked', groupKey))
      continue
    }
    counts.rendered++
    const names = [...new Set([
      ...blockDataSources(group.before, { orgId, siteId: group.siteId }).map(entry => entry.name),
      ...blockDataSources(group.after, { orgId, siteId: group.siteId }).map(entry => entry.name),
    ])]
    const records = sourceRecordsFor(names, [group.before.template || group.before.content || '', group.after.template || group.after.content || ''], sourceRecords)
    const first = group.instances[0]
    const where = { siteId: first.siteId, collection: first.collection, docId: first.docId, docName: first.docName, instanceId: first.instanceId, instancesWithTheseValues: group.instances.length }
    let beforeHtml
    let afterHtml
    try {
      beforeHtml = normalizeHtml(await renderSide(group.before, { orgId, siteId: group.siteId, records, pageRender }))
      afterHtml = normalizeHtml(await renderSide(group.after, { orgId, siteId: group.siteId, records, pageRender }))
    }
    catch (error) {
      counts.failed += group.instances.length
      group.instances.forEach(instance => tally(instance, 'failed', groupKey))
      if (failures.length < MAX_LISTED)
        failures.push({ ...where, message: String(error?.message || error) })
      continue
    }
    if (beforeHtml === afterHtml) {
      counts.identical += group.instances.length
      group.instances.forEach(instance => tally(instance, 'identical', groupKey))
      continue
    }
    counts.different += group.instances.length
    group.instances.forEach(instance => tally(instance, 'different', groupKey))
    if (differences.length < MAX_LISTED)
      differences.push({ ...where, group: groupIndex, ...firstDifference(beforeHtml, afterHtml) })
  }

  const listInstance = ({ siteId, collection, docId, docName, instanceId }) => ({ siteId, collection, docId, docName, instanceId })
  return {
    ok: true,
    orgId,
    docId: blockId,
    counts,
    bySite: [...bySite.values()]
      .map(entry => ({ ...entry, distinctRenders: entry.distinctRenders.size }))
      .sort((a, b) => `${a.siteId}/${a.collection}`.localeCompare(`${b.siteId}/${b.collection}`)),
    differences,
    differencesTruncated: counts.different > 0 && differences.length >= MAX_LISTED,
    failures,
    driftedCopies: {
      count: drifted.length,
      note: 'These instances hold an older or different copy of the markup than the released library block; the "before" render uses their own copy, and a release replaces it.',
      instances: drifted.slice(0, MAX_LISTED).map(listInstance),
    },
    removedFieldValues: [...removed.entries()].map(([field, holders]) => ({
      field,
      instances: holders.length,
      examples: holders.slice(0, 5).map(listInstance),
    })),
    ...(definition.isOverrideBlock === true ? { overrideNote: 'This is an override block: the public site renders its Vue component (cms_override_component); this compares only the CMS markup the Hub preview shows.' } : {}),
    limits: LIMITS_NOTE,
  }
}

// The pages and posts that hold blockId, from the read-only Firestore access:
// every site (or one), plus the templates site, each collection queried by
// its blockIds index as the release worker does.
export async function collectInstanceDocuments({ db, orgId, blockId, siteId = '', collections = COMPARE_COLLECTIONS, maxSites = 100, maxDocuments = 1000, sanitizeValue = value => value }) {
  let siteIds
  let siteScanTruncated = false
  if (siteId) {
    siteIds = [siteId]
  }
  else {
    const sites = await db.collection(`organizations/${orgId}/sites`).limit(maxSites + 1).get()
    siteScanTruncated = sites.size > maxSites
    siteIds = sites.docs.slice(0, maxSites).map(doc => doc.id)
    if (!siteIds.includes('templates'))
      siteIds.push('templates')
  }
  const documents = []
  const scanned = []
  for (const site of siteIds) {
    for (const collection of collections) {
      // The templates site is never published.
      if (site === 'templates' && collection !== 'pages')
        continue
      const path = `organizations/${orgId}/sites/${site}/${collection}`
      const snapshot = await db.collection(path).where('blockIds', 'array-contains', blockId).limit(maxDocuments + 1).get()
      const docs = snapshot.docs.slice(0, maxDocuments)
      scanned.push({ siteId: site, collection, documents: docs.length, truncated: snapshot.size > maxDocuments })
      for (const doc of docs) {
        const data = sanitizeValue(doc.data())
        documents.push({ siteId: site, collection, docId: doc.id, name: String(data?.name || data?.title || ''), data })
      }
    }
  }
  return { documents, scanned: scanned.filter(entry => entry.documents), collectionsRead: scanned.length, siteScanTruncated, scanTruncated: scanned.some(entry => entry.truncated) }
}
