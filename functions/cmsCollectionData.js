// The Hub canvas is a visual preview of saved Firestore drafts, not the
// published KV delivery layer. Keep source configuration unchanged so the
// public renderer still reads published records. Keep identical in functions/.
const { db, HttpsError, onCall, permissionCheck } = require('./config.js')

const MAX_SOURCES = 20
const MAX_INPUT_BYTES = 64 * 1024
// The canvas shows long lists (the old browser query allowed 250).
const MAX_RECORDS = 250
const BUDGET_MS = 15000

let modulesPromise
const loadModules = () => {
  modulesPromise = modulesPromise || Promise.all([
    import('./helpers/cmsDataSourceRecords.mjs'),
    import('@edgedev/template-engine').catch(() => null),
    import('./helpers/cmsAgentReads.mjs'),
  ])
  return modulesPromise
}

const text = value => (typeof value === 'string' ? value.trim() : '')
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const docId = (value, label, required = false) => {
  const id = text(value)
  if ((required && !id) || (id && !/^[\w-]{1,128}$/.test(id)))
    throw new HttpsError('invalid-argument', `${label} is not a document id.`)
  return id
}

// The collection a source reads, for the permission check: posts and sites
// belong to sites. Null for a personal-data collection.
const readTarget = (cfg, reads) => {
  const path = text(cfg?.collection?.path || cfg?.path)
  if (['posts', 'post', 'sites', 'published-site-settings'].includes(path))
    return 'sites'
  const name = path.split('/')[0]
  return (name && !reads.PERSONAL_DATA_COLLECTION.test(name)) ? name : null
}

// { uid, orgId, siteId?, routeLastSegment?, sources: { field: meta entry } }
// -> { values: { field: records }, sources: [{ name, path, loadedFrom,
// records, truncated, problem? }] }
exports.collectionData = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  const data = request.data || {}
  const orgId = docId(data.orgId, 'orgId', true)
  const siteId = docId(data.siteId, 'siteId')
  const routeLastSegment = text(data.routeLastSegment).slice(0, 200)
  const sources = isPlainObject(data.sources) ? data.sources : {}
  const names = Object.keys(sources)
  if (names.length > MAX_SOURCES)
    throw new HttpsError('invalid-argument', `At most ${MAX_SOURCES} sources per request.`)
  if (Buffer.byteLength(JSON.stringify(sources)) > MAX_INPUT_BYTES)
    throw new HttpsError('invalid-argument', `sources is larger than ${MAX_INPUT_BYTES} bytes.`)

  const [records, engine, reads] = await loadModules()
  const allowed = {}
  const refused = []
  for (const name of names) {
    const cfg = sources[name]
    if (!isPlainObject(cfg) || !isPlainObject(cfg.collection))
      continue
    const target = readTarget(cfg, reads)
    if (!target) {
      refused.push({ name, path: text(cfg.collection.path), loadedFrom: 'none', records: 0, truncated: false, problem: 'This collection can hold personal data, so it is not loaded.' })
      continue
    }
    if (!await permissionCheck(uid, 'read', `organizations/${orgId}/${target}`)) {
      refused.push({ name, path: text(cfg.collection.path), loadedFrom: 'none', records: 0, truncated: false, problem: `Not allowed to read ${target} in this organization.` })
      continue
    }
    // An API source is never fetched by the Hub.
    const { api: _api, apiField: _apiField, apiQuery: _apiQuery, ...rest } = cfg
    allowed[name] = rest
  }

  const deadline = Date.now() + BUDGET_MS
  const loaded = await records.loadBlockSources({
    block: { templateVersion: 1, meta: allowed },
    orgId,
    siteId,
    routeLastSegment,
    engine,
    db,
    draftPreview: true,
    deadline,
    maxRecords: MAX_RECORDS,
  })
  const values = { ...loaded.values }
  for (const item of refused)
    values[item.name] = []
  return {
    values: JSON.parse(JSON.stringify(values)),
    sources: [...loaded.sources, ...refused].sort((a, b) => a.name.localeCompare(b.name)),
  }
})
