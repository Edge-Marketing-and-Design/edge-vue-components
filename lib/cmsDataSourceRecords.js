// Loads the records a block's Data Sources show, the way the public renderer
// (emd-cms-front) does: through @edgedev/template-engine against the KV
// mirror, so `queryItems` fetch candidates, `query` filters them, `order`
// sorts and `limit` trims. Used by the Hub page preview
// (cms-getPreviewRenderPayload) and by cms_render_block.
//
// - Every KV key and prefix read is checked against the organization: a
//   literal `uniqueKey` or `canonicalLookup.key` can't read another
//   organization's records.
// - `api` sources are never fetched here (that would let a definition make
//   the Function call any URL); they get their inline `value`.
// - Each source loads on its own, within one time budget; a failure keeps the
//   source's inline `value` (or []) and is reported as a problem.
// - Without KV credentials (the emulator) sources are read from Firestore.
//
// Shared by edge/lib/cmsDataSourceRecords.js, edge/functions/helpers/
// cmsDataSourceRecords.mjs and functions/helpers/cmsDataSourceRecords.mjs.
// Keep the three copies byte-identical; the tests enforce it. The template
// engine and Firestore are passed in, so it imports nothing.

export const MAX_SOURCE_RECORDS = 50
export const DEFAULT_TIME_BUDGET_MS = 8000
// KV list pages (of 1000 keys) one prefix may read.
export const MAX_KV_LIST_PAGES = 5

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

// An empty orgId or siteId stays a token, so a source that needs it is
// reported instead of read; routeLastSegment becomes '' as on the public site.
const replaceTokens = (value, tokens) => {
  if (typeof value === 'string') {
    let next = value.replaceAll('{routeLastSegment}', tokens.routeLastSegment)
    if (tokens.orgId)
      next = next.replaceAll('{orgId}', tokens.orgId)
    if (tokens.siteId)
      next = next.replaceAll('{siteId}', tokens.siteId)
    return next
  }
  if (Array.isArray(value))
    return value.map(entry => replaceTokens(entry, tokens))
  if (isPlainObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceTokens(entry, tokens)]))
  return value
}

const normalizeTokens = ({ orgId = '', siteId = '', routeLastSegment = '' } = {}) => ({
  orgId: String(orgId || ''),
  siteId: String(siteId || ''),
  routeLastSegment: String(routeLastSegment || '').toLowerCase(),
})

const hasUnresolvedToken = value => /\{(orgId|siteId)\}/.test(JSON.stringify(value ?? null))

// A collection-backed or API-backed source config (v2 dataSources entry or v1
// meta entry).
const isCollectionSource = source => isPlainObject(source)
  && (source.type === 'collection' || isPlainObject(source.collection) || !!source.path || !!source.query || !!source.canonicalLookup)
const apiUrlOf = source => (typeof source?.api === 'string' ? source.api.trim() : '')

// The block's Data Sources with the instance's settings applied, tokens
// resolved, as the public renderer prepares them (front shared/
// cmsBlockTokens.js and the engine's mergeV2DataSourcesWithMeta):
// [{ name, templateVersion, source }], where `source` is a v2 dataSources
// entry or a v1 meta entry.
export function blockDataSources(block, tokenInput = {}) {
  const tokens = normalizeTokens(tokenInput)
  const meta = isPlainObject(block?.meta) ? block.meta : {}
  const entries = []
  if (Number(block?.templateVersion) === 2) {
    for (const [name, rawSource] of Object.entries(isPlainObject(block?.dataSources) ? block.dataSources : {})) {
      if (!isCollectionSource(rawSource) && !apiUrlOf(rawSource))
        continue
      const metaEntry = isPlainObject(meta[name]) ? meta[name] : null
      const source = { ...clone(rawSource) }
      if (metaEntry) {
        if (isPlainObject(metaEntry.collection))
          source.collection = clone(metaEntry.collection)
        for (const key of ['queryItems', 'limit', 'apiQuery', 'value']) {
          if (Object.prototype.hasOwnProperty.call(metaEntry, key))
            source[key] = clone(metaEntry[key])
        }
        if (Array.isArray(metaEntry.queryOptions))
          source.queryOptions = clone(metaEntry.queryOptions)
        for (const key of ['api', 'apiField']) {
          if (typeof metaEntry[key] === 'string')
            source[key] = metaEntry[key]
        }
      }
      entries.push({ name, templateVersion: 2, source: replaceTokens(source, tokens) })
    }
    return entries
  }
  for (const [name, rawEntry] of Object.entries(meta)) {
    if (!isPlainObject(rawEntry) || (!isPlainObject(rawEntry.collection) && !apiUrlOf(rawEntry)))
      continue
    entries.push({ name, templateVersion: 1, source: replaceTokens(clone(rawEntry), tokens) })
  }
  return entries
}

// The Firestore collection a source names, as the Hub reads it.
export function sourceCollectionPath(source, { orgId, siteId = '' }) {
  const path = String(source?.collection?.path || source?.path || '').trim()
  if (!path)
    return ''
  if (path === 'posts' || path === 'post')
    return siteId ? `organizations/${orgId}/sites/${siteId}/published_posts` : ''
  return `organizations/${orgId}/${path}`
}

// True when a KV key or list prefix stays inside the organization: index keys
// are idx:{collection}:{field}:{uniqueKey...}, record keys
// {collection}:{uniqueKey...}, and the uniqueKey starts with the orgId.
export function kvKeyInOrganization(key, orgId) {
  const text = String(key || '')
  if (!orgId || !text || text.includes('{'))
    return false
  const segments = text.split(':')
  const rest = segments[0] === 'idx' ? segments.slice(3) : segments.slice(1)
  if (segments[0] === 'idx' && segments[1] === 'manifest')
    return false
  return rest.length > 0 && rest[0] === orgId
}

// A KV namespace binding (the KVNamespaceLike the engine accepts) over the
// Cloudflare KV REST API. Refuses keys outside the organization, stops at the
// deadline, bounds list pages and counts what it read in `stats`.
export function createScopedKvBinding({ orgId, accountId, namespaceId, apiToken, fetch: fetchImpl, deadline = Infinity, maxListPages = MAX_KV_LIST_PAGES, stats = {} }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
  const headers = { Authorization: `Bearer ${apiToken}` }
  stats.reads = stats.reads || 0
  stats.refusedKeys = stats.refusedKeys || []
  stats.listTruncated = stats.listTruncated || false
  const guard = (key) => {
    if (Date.now() > deadline)
      throw new Error('Data Source time budget exceeded.')
    if (!kvKeyInOrganization(key, orgId)) {
      if (stats.refusedKeys.length < 10)
        stats.refusedKeys.push(String(key))
      throw Object.assign(new Error(`KV key "${key}" is outside organization ${orgId}.`), { code: 'kv-key-refused' })
    }
  }
  const getOne = async (key) => {
    guard(key)
    stats.reads += 1
    const response = await fetchImpl(`${base}/values/${encodeURIComponent(key)}`, { headers })
    if (response.status === 404)
      return null
    if (!response.ok)
      throw new Error(`Cloudflare KV (get) failed with status ${response.status}.`)
    return await response.text()
  }
  return {
    async get(keyOrKeys) {
      if (!Array.isArray(keyOrKeys))
        return getOne(keyOrKeys)
      const values = new Map()
      for (const key of keyOrKeys)
        values.set(key, await getOne(key))
      return values
    },
    // One call per page: the engine follows `cursor`, so this stops it after
    // maxListPages by returning no cursor.
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      guard(prefix)
      const pages = (stats.listPages = stats.listPages || new Map())
      const page = (pages.get(prefix) || 0) + 1
      pages.set(prefix, page)
      stats.reads += 1
      const search = new URLSearchParams({ prefix, limit: String(limit), include: 'metadata' })
      if (cursor)
        search.set('cursor', cursor)
      const response = await fetchImpl(`${base}/keys?${search}`, { headers })
      if (!response.ok)
        throw new Error(`Cloudflare KV (list) failed with status ${response.status}.`)
      const data = await response.json()
      let next = data?.result_info?.cursor || null
      if (next && page >= maxListPages) {
        stats.listTruncated = true
        next = null
      }
      return { keys: (data?.result || []).map(entry => ({ name: entry.name, metadata: entry.metadata })), cursor: next, list_complete: !next }
    },
  }
}

// The KV client options for the engine, or null without credentials. The
// engine's own `fetch` is used only for `api` sources, which this refuses.
export function scopedKvClientOptions({ orgId, env = {}, fetch: fetchImpl = globalThis.fetch, deadline, stats }) {
  const accountId = String(env.CF_ACCOUNT_ID || '').trim()
  const namespaceId = String(env.CLOUDFLARE_NAMESPACE_ID || '').trim()
  const apiToken = String(env.CLOUDFLARE_API_KEY || '').trim()
  if (!accountId || !namespaceId || !apiToken || typeof fetchImpl !== 'function')
    return null
  return {
    binding: createScopedKvBinding({ orgId, accountId, namespaceId, apiToken, fetch: fetchImpl, deadline, stats }),
    accountId,
    namespaceId,
    apiToken: '',
    fetch: async () => {
      throw new Error('API Data Sources are not fetched by the Hub.')
    },
  }
}

// --- Firestore reads (no KV credentials: the emulator) ---

const valueAtPath = (source, path) => String(path || '').split('.').reduce((acc, key) => ((acc == null || typeof acc !== 'object') ? undefined : acc[key]), source)

const compareValues = (a, b) => {
  if (a == null && b == null)
    return 0
  if (a == null)
    return 1
  if (b == null)
    return -1
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

const orderRecords = (records, orders = []) => {
  const valid = (Array.isArray(orders) ? orders : []).filter(order => typeof order?.field === 'string' && order.field.trim())
  if (!valid.length)
    return records
  return [...records].sort((a, b) => {
    for (const order of valid) {
      const compared = compareValues(valueAtPath(a, order.field), valueAtPath(b, order.field))
      if (compared !== 0)
        return compared * (String(order.direction || 'asc').toLowerCase() === 'desc' ? -1 : 1)
    }
    return 0
  })
}

// A v2 source as the collection config the v1 path uses.
const collectionConfig = (source) => {
  const collection = isPlainObject(source.collection) ? { ...source.collection } : {}
  for (const key of ['path', 'baseKey', 'uniqueKey', 'canonicalLookup', 'query', 'order', 'orgLevel']) {
    if (source[key] !== undefined && collection[key] === undefined)
      collection[key] = source[key]
  }
  return collection
}

const firestoreQuery = (source) => {
  const collection = collectionConfig(source)
  const query = Array.isArray(collection.query) ? clone(collection.query) : []
  const queryItems = isPlainObject(source.queryItems) ? source.queryItems : {}
  for (const [field, rawValue] of Object.entries(queryItems)) {
    const index = query.findIndex(entry => entry?.field === field)
    if (rawValue === undefined || rawValue === null || rawValue === '' || (Array.isArray(rawValue) && !rawValue.length)) {
      if (index > -1)
        query.splice(index, 1)
      continue
    }
    const option = (Array.isArray(source.queryOptions) ? source.queryOptions : []).find(entry => entry?.field === field)
      || (isPlainObject(source.controls?.[field]) ? source.controls[field] : null)
    const operator = option?.operator || '=='
    const value = (operator === 'array-contains-any' && !Array.isArray(rawValue)) ? [rawValue] : rawValue
    const entry = { field, operator, value }
    if (index > -1)
      query[index] = entry
    else
      query.push(entry)
  }
  return query.filter(entry => entry?.field && entry?.operator)
}

// Reads one source from Firestore with the admin SDK (`db`).
export async function readFirestoreSource({ db, source, orgId, siteId = '', limit }) {
  const collection = collectionConfig(source)
  const path = sourceCollectionPath({ collection }, { orgId, siteId })
  if (!path)
    return []
  const canonicalKey = collection.canonicalLookup?.key
  if (typeof canonicalKey === 'string' && canonicalKey.trim()) {
    const docId = canonicalKey.split(':').filter(Boolean).pop()
    const snap = await db.doc(`${path}/${docId}`).get()
    return snap.exists ? [{ docId: snap.id, ...(snap.data() || {}) }] : []
  }
  let ref = db.collection(path)
  for (const entry of firestoreQuery(source))
    ref = ref.where(entry.field, entry.operator, entry.value)
  for (const order of Array.isArray(collection.order) ? collection.order : []) {
    if (order?.field)
      ref = ref.orderBy(order.field, String(order.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc')
  }
  const snap = await ref.limit(limit).get()
  return orderRecords(snap.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) })), collection.order)
}

// --- Loading ---

const sourceLimit = (source, maxRecords) => {
  const limit = Number(source?.limit)
  return (Number.isFinite(limit) && limit > 0) ? Math.min(Math.floor(limit), maxRecords) : maxRecords
}

const withDeadline = (promise, deadline) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Data Source time budget exceeded.')), Math.max(0, deadline - Date.now()))
    }),
  ]).finally(() => clearTimeout(timer))
}

const inlineValue = source => (Array.isArray(source?.value) ? source.value : [])

// Loads every Data Source of one block. Returns { values: { name: records },
// sources: [{ name, path, loadedFrom, records, truncated, problem? }] }.
// engine: { resolveDataSource, hydrateValues } from @edgedev/template-engine.
// kvOptions: from scopedKvClientOptions (null: read Firestore with `db`).
// requestCache: the engine's, shared with a render that reads the same keys.
export async function loadBlockSources({ block, orgId, siteId = '', routeLastSegment = '', engine = null, kvOptions = null, db = null, deadline = Date.now() + DEFAULT_TIME_BUDGET_MS, maxRecords = MAX_SOURCE_RECORDS, uniqueKey = '', requestCache = undefined }) {
  const values = {}
  const sources = []
  const entries = blockDataSources(block, { orgId, siteId, routeLastSegment })
  await Promise.all(entries.map(async ({ name, templateVersion, source }) => {
    const report = { name, path: String(source?.collection?.path || source?.path || ''), loadedFrom: 'none', records: 0, truncated: false }
    sources.push(report)
    const fallback = inlineValue(source)
    values[name] = fallback
    if (apiUrlOf(source)) {
      report.loadedFrom = 'inline'
      report.records = fallback.length
      report.problem = 'API Data Sources are not loaded by the Hub; it shows the inline value.'
      return
    }
    const limit = sourceLimit(source, maxRecords)
    if (Number(source?.limit) > maxRecords)
      report.problem = `limit ${source.limit} lowered to ${maxRecords}.`
    if (hasUnresolvedToken(source)) {
      report.problem = 'The source needs a siteId, which was not given.'
      return
    }
    try {
      let records
      if (kvOptions && engine) {
        const scopedKey = uniqueKey || (siteId ? `${orgId}:${siteId}` : orgId)
        const bounded = { ...source, limit }
        if (templateVersion === 2) {
          records = await withDeadline(engine.resolveDataSource({ name, source: bounded, values: {}, uniqueKey: scopedKey, clientOptions: kvOptions, requestCache }), deadline)
        }
        else {
          const hydrated = await withDeadline(engine.hydrateValues({ content: `{{{#array {"field":${JSON.stringify(name)}}}}}{{{/array}}}`, meta: { [name]: bounded }, values: {}, uniqueKey: scopedKey, clientOptions: kvOptions, requestCache }), deadline)
          records = hydrated[name]
        }
        report.loadedFrom = 'kv'
      }
      else if (db) {
        records = await withDeadline(readFirestoreSource({ db, source, orgId, siteId, limit: limit + 1 }), deadline)
        report.loadedFrom = 'firestore'
      }
      else {
        report.problem = 'No KV credentials or Firestore to load from.'
        return
      }
      const list = Array.isArray(records) ? records : (records == null ? [] : [records])
      report.truncated = list.length > limit
      values[name] = list.slice(0, limit)
      report.records = values[name].length
      if (!report.records && report.loadedFrom === 'kv')
        report.note = 'No records. The public site reads the same KV mirror, so it shows none either; check the source\'s query and that its fields are in the mirror\'s indexKeys.'
    }
    catch (error) {
      values[name] = fallback
      report.loadedFrom = 'inline'
      report.records = fallback.length
      report.problem = String(error?.message || error)
    }
  }))
  sources.sort((a, b) => a.name.localeCompare(b.name))
  return { values, sources }
}

// Template v2 values start from each schema field's `value` (front
// shared/cmsBlockSchemaDefaults.js); saved values win.
export function applySchemaDefaults(values, schema) {
  const defaults = Object.fromEntries(Object.entries(isPlainObject(schema) ? schema : {})
    .filter(([, config]) => isPlainObject(config) && Object.prototype.hasOwnProperty.call(config, 'value'))
    .map(([field, config]) => [field, config.value]))
  return { ...defaults, ...(isPlainObject(values) ? values : {}) }
}

// The block as the public renderer prepares it (front shared/
// cmsBlockTokens.js resolveCmsBlockTokens): tokens resolved in its Data
// Source settings, schema defaults and the `routeLastSegment`, `orgId` and
// `siteId` values added.
export function prepareBlockForRender(block, tokenInput = {}) {
  const tokens = normalizeTokens(tokenInput)
  const next = clone(block) || {}
  if (isPlainObject(next.meta)) {
    for (const entry of Object.values(next.meta)) {
      if (!isPlainObject(entry))
        continue
      if (isPlainObject(entry.collection)) {
        if (typeof entry.collection.uniqueKey === 'string')
          entry.collection.uniqueKey = replaceTokens(entry.collection.uniqueKey, tokens)
        if (isPlainObject(entry.collection.canonicalLookup) && Object.prototype.hasOwnProperty.call(entry.collection.canonicalLookup, 'key'))
          entry.collection.canonicalLookup.key = replaceTokens(entry.collection.canonicalLookup.key, tokens)
        if (Array.isArray(entry.collection.query))
          entry.collection.query = entry.collection.query.map(query => (isPlainObject(query) ? { ...query, value: replaceTokens(query.value, tokens) } : query))
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'queryItems'))
        entry.queryItems = replaceTokens(entry.queryItems, tokens)
    }
  }
  const instanceValues = isPlainObject(next.values) ? next.values : {}
  next.values = { ...(Number(next.templateVersion) === 2 ? applySchemaDefaults(instanceValues, next.schema) : instanceValues), routeLastSegment: tokens.routeLastSegment }
  if (Number(next.templateVersion) === 2) {
    if (typeof next.template === 'string')
      next.template = replaceTokens(next.template, tokens)
    if (isPlainObject(next.dataSources))
      next.dataSources = replaceTokens(next.dataSources, tokens)
    next.values = { ...next.values, orgId: tokens.orgId, siteId: tokens.siteId }
  }
  return next
}
