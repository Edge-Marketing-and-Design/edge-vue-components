// cms_render_block (the library read "render"): one block definition rendered
// the way the public renderer (emd-cms-front rendered-blocks) renders it, with
// @edgedev/template-engine pageRender, the site's theme and real Data Source
// records from the KV mirror (helpers/cmsDataSourceRecords.mjs), sample
// records, or none. Returns the block's HTML, a standalone page to open in a
// browser, where each source's records came from, and the problems found.
// Runs as the operator: cmsAgentLibraryReads.js has checked read rights on
// blocks; this checks sites, themes and each live source's collection.
// Keep identical in functions/.
const { db, HttpsError } = require('./config.js')

const MAX_OUTPUT_BYTES = 512 * 1024
const RENDER_BUDGET_MS = 20000
const DATA_MODES = ['live', 'sample', 'empty']
// Instance values or settings sent with the request, as JSON.
const MAX_INPUT_BYTES = 256 * 1024

let modulesPromise
const loadModules = () => {
  modulesPromise = modulesPromise || Promise.all([
    import('./helpers/cmsDataSourceRecords.mjs'),
    import('@edgedev/template-engine'),
    import('./helpers/cmsBlockValidation.mjs'),
    import('./helpers/cmsAgentReads.mjs'),
    import('./helpers/cmsCollectionPreview.mjs'),
  ])
  return modulesPromise
}

const text = value => (typeof value === 'string' ? value.trim() : '')
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const docIdOf = (value, label) => {
  const id = text(value)
  if (id && !/^[\w-]{1,128}$/.test(id))
    throw new HttpsError('invalid-argument', `${label} is not a document id.`)
  return id
}
const objectInput = (value, label) => {
  if (value === undefined || value === null)
    return {}
  if (!isPlainObject(value))
    throw new HttpsError('invalid-argument', `${label} must be an object.`)
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_BYTES)
    throw new HttpsError('invalid-argument', `${label} is larger than ${MAX_INPUT_BYTES} bytes.`)
  return value
}
const parseJsonField = (value) => {
  if (isPlainObject(value))
    return value
  try {
    const parsed = JSON.parse(String(value || ''))
    return isPlainObject(parsed) ? parsed : null
  }
  catch {
    return null
  }
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character])

// Stylesheet and preconnect links from the theme's Head JSON (fonts); its
// scripts are left out.
const headLinks = (head) => {
  const links = Array.isArray(head?.link) ? head.link : []
  return links
    .filter(link => isPlainObject(link) && ['stylesheet', 'preconnect'].includes(String(link.rel)) && /^https:\/\//.test(String(link.href || '')))
    .map(link => `<link rel="${escapeHtml(link.rel)}" href="${escapeHtml(link.href)}"${link.crossorigin !== undefined ? ' crossorigin' : ''}>`)
    .join('\n')
}

const truncate = (value) => {
  const buffer = Buffer.from(String(value || ''))
  if (buffer.length <= MAX_OUTPUT_BYTES)
    return { value: String(value || ''), truncated: false }
  return { value: buffer.subarray(0, MAX_OUTPUT_BYTES).toString('utf8'), truncated: true }
}

// At most `max` records per source, in the render as in the report.
const capLimit = (entry, max) => {
  if (!isPlainObject(entry))
    return
  const limit = Number(entry.limit)
  if (!Number.isFinite(limit) || limit <= 0 || limit > max)
    entry.limit = max
}

// Replaces a source with fixed records. The engine still looks a source up in
// KV by its name when the render reads KV, so the source also gets a
// uniqueKey (and canonical key) inside the organization that holds nothing:
// the lookup finds no records and the engine falls back to `value`.
const setStaticSource = (block, name, records, orgId) => {
  const empty = { uniqueKey: `${orgId}:-`, canonicalLookup: { key: `-:${orgId}:-` } }
  if (Number(block.templateVersion) === 2) {
    const { type: _type, path: _path, collection: _collection, query: _query, queryItems: _queryItems, canonicalLookup: _canonical, uniqueKey: _uniqueKey, baseKey: _baseKey, order: _order, api: _api, apiField: _apiField, apiQuery: _apiQuery, ...rest } = block.dataSources[name] || {}
    block.dataSources[name] = { ...rest, ...empty, value: records }
    if (isPlainObject(block.meta?.[name]))
      block.meta[name] = { value: records }
    return
  }
  block.meta[name] = { value: records, collection: empty }
}

// Sample records for interactive lists. The template's loops can't show which
// fields a list or options source uses, so the samples carry the list's
// declared fields (and the fixed values its query requires) and each options
// list's label and value fields.
const SAMPLE_TEXT = 'Sample'
const setSamplePath = (record, path, value) => {
  const parts = String(path).split('.')
  let target = record
  for (const part of parts.slice(0, -1))
    target = isPlainObject(target[part]) ? target[part] : (target[part] = {})
  target[parts[parts.length - 1]] = value
}
const interactiveSamples = (template, dataSources) => {
  const samples = {}
  for (const [name, source] of Object.entries(isPlainObject(dataSources) ? dataSources : {})) {
    const fields = Array.isArray(source?.interactive?.fields) ? source.interactive.fields : []
    if (!fields.length)
      continue
    const record = {}
    for (const field of fields)
      setSamplePath(record, field, SAMPLE_TEXT)
    for (const entry of [...(source.collection?.query ?? source.query ?? [])]) {
      const operator = String(entry?.operator || '==').toLowerCase()
      if (operator === '==' && !JSON.stringify(entry.value ?? '').includes('{') && typeof entry.field === 'string')
        setSamplePath(record, entry.field, entry.value)
    }
    samples[name] = [record, { ...record }]
  }
  for (const match of String(template || '').matchAll(/\{\{\{#collectionOptions\s+(\{[^\n]*?\})\s*\}\}\}/g)) {
    try {
      const { source, label, value } = JSON.parse(match[1])
      if (typeof source !== 'string' || samples[source] || !isPlainObject(dataSources?.[source]))
        continue
      const record = {}
      for (const path of [label, value].filter(item => typeof item === 'string' && item))
        setSamplePath(record, path, SAMPLE_TEXT)
      samples[source] = [record, { ...record }]
    }
    catch {}
  }
  return samples
}

// The collection read rights a live source needs; null when it may not be
// read live (personal data).
const sourceReadTarget = (shared, entry) => {
  const path = text(entry.source?.collection?.path || entry.source?.path)
  if (path === 'posts' || path === 'post' || path === 'sites')
    return 'sites'
  const name = path.split('/')[0]
  if (!name || shared.PERSONAL_DATA_COLLECTION.test(name))
    return null
  return name
}

// { result, docIds, resultCount, truncated } for the library read audit.
// overrideFor(block, themeId) is the deployed renderer's resolution.
const renderBlock = async ({ reads, orgId, body, requireRead, overrideFor }) => {
  const [records, engine, validation, shared, collectionPreview] = await loadModules()
  const data = DATA_MODES.includes(body.data) ? body.data : 'live'
  const siteId = docIdOf(body.siteId, 'siteId')
  const routeLastSegment = text(body.routeLastSegment).slice(0, 200)
  const values = objectInput(body.values, 'values')
  const meta = objectInput(body.meta, 'meta')
  const definition = body.definition ?? null
  if (definition !== null && Buffer.byteLength(JSON.stringify(definition)) > 1024 * 1024)
    throw new HttpsError('invalid-argument', 'definition is larger than 1048576 bytes.')
  if (definition === null && !text(body.docId))
    throw new HttpsError('invalid-argument', 'Send a definition to render, or the docId of a library block.')
  const { block, source } = await reads.readDefinition({ orgId, definition, docId: docIdOf(body.docId, 'docId') })
  const problems = []

  let site = null
  if (siteId) {
    await requireRead('sites')
    const siteSnap = await db.collection('organizations').doc(orgId).collection('sites').doc(siteId).get()
    if (!siteSnap.exists)
      throw new HttpsError('not-found', `Site "${siteId}" does not exist in ${orgId}.`)
    site = siteSnap.data() || {}
  }
  const themeId = docIdOf(body.themeId, 'themeId') || text(site?.theme)
  let theme = {}
  let themeDoc = null
  if (themeId) {
    await requireRead('themes')
    const themeSnap = await db.collection('organizations').doc(orgId).collection('themes').doc(themeId).get()
    if (!themeSnap.exists)
      throw new HttpsError('not-found', `Theme "${themeId}" does not exist in ${orgId}.`)
    themeDoc = themeSnap.data() || {}
    theme = parseJsonField(themeDoc.theme) || {}
    if (!Object.keys(theme).length)
      problems.push(`Theme "${themeId}" has no valid Theme JSON; the block renders unthemed.`)
  }
  else {
    problems.push('No siteId or themeId: the block renders unthemed.')
  }

  // The instance: the definition with the given values and settings.
  const instance = {
    ...block,
    id: block.docId,
    values: { ...(isPlainObject(block.values) ? block.values : {}), ...values },
    meta: { ...(isPlainObject(block.meta) ? block.meta : {}), ...meta },
  }
  const prepared = records.prepareBlockForRender(instance, { orgId, siteId, routeLastSegment })
  prepared.meta = isPlainObject(prepared.meta) ? prepared.meta : {}
  for (const entry of records.blockDataSources(prepared, { orgId, siteId, routeLastSegment })) {
    if (Number(entry.source?.limit) > records.MAX_SOURCE_RECORDS)
      problems.push(`Data Source "${entry.name}": limit ${entry.source.limit} lowered to ${records.MAX_SOURCE_RECORDS}.`)
    if (entry.templateVersion === 2)
      capLimit(prepared.dataSources[entry.name], records.MAX_SOURCE_RECORDS)
    if (entry.templateVersion !== 2 || prepared.meta[entry.name]?.limit !== undefined)
      capLimit(prepared.meta[entry.name], records.MAX_SOURCE_RECORDS)
  }
  const entries = records.blockDataSources(prepared, { orgId, siteId, routeLastSegment })
  // Sources as declared, before any is replaced with fixed records: an
  // interactive list drawn from fixed records still needs its query and order.
  const declaredSources = isPlainObject(prepared.dataSources) ? JSON.parse(JSON.stringify(prepared.dataSources)) : {}
  const staticRecords = {}
  const useStaticSource = (name, list) => {
    staticRecords[name] = list
    setStaticSource(prepared, name, list, orgId)
  }

  const deadline = Date.now() + RENDER_BUDGET_MS
  const requestCache = engine.createHydrationRequestCache()
  let hydrate = null
  let sources = []
  if (data === 'live' && entries.length) {
    // Sources the operator may not read, and personal-data collections, are
    // left empty.
    const refused = {}
    for (const entry of entries) {
      if (/^https?:/i.test(text(entry.source?.api)))
        continue
      const target = sourceReadTarget(shared, entry)
      if (!target) {
        refused[entry.name] = 'This collection can hold personal data, so it is not loaded.'
        continue
      }
      try {
        await requireRead(target)
      }
      catch (error) {
        refused[entry.name] = error.message
      }
    }
    const toLoad = JSON.parse(JSON.stringify(prepared))
    for (const name of Object.keys(refused)) {
      useStaticSource(name, [])
      delete toLoad.meta[name]
      if (isPlainObject(toLoad.dataSources))
        delete toLoad.dataSources[name]
    }
    const kvOptions = records.scopedKvClientOptions({ orgId, env: process.env, deadline })
    const loaded = await records.loadBlockSources({ block: toLoad, orgId, siteId, routeLastSegment, engine, kvOptions, db: kvOptions ? null : db, deadline, requestCache })
    sources = [
      ...loaded.sources,
      ...Object.entries(refused).map(([name, problem]) => ({ name, path: text(entries.find(entry => entry.name === name)?.source?.path), loadedFrom: 'none', records: 0, truncated: false, problem })),
    ].sort((a, b) => a.name.localeCompare(b.name))
    if (kvOptions) {
      // The render reads the same records again, through the request cache.
      hydrate = { uniqueKey: siteId ? `${orgId}:${siteId}` : orgId, clientOptions: kvOptions, requestCache }
      for (const item of sources) {
        if (item.loadedFrom !== 'kv')
          useStaticSource(item.name, loaded.values[item.name] || [])
      }
    }
    else {
      for (const item of sources)
        useStaticSource(item.name, loaded.values[item.name] || [])
    }
  }
  else {
    const fixtures = data === 'sample'
      ? { ...validation.buildSourceFixtures(prepared.template || prepared.content || '', entries.map(entry => entry.name)).fixtures, ...interactiveSamples(prepared.template, prepared.dataSources) }
      : {}
    for (const entry of entries) {
      const list = Array.isArray(fixtures[entry.name]) ? fixtures[entry.name] : []
      useStaticSource(entry.name, list)
      sources.push({ name: entry.name, path: text(entry.source?.collection?.path || entry.source?.path), loadedFrom: data, records: list.length, truncated: false })
    }
  }
  for (const item of sources) {
    if (item.problem)
      problems.push(`Data Source "${item.name}": ${item.problem}`)
  }

  // The engine draws an interactive list only from indexed KV records, so a
  // render without them (sample, empty, or live records read from Firestore)
  // draws its first page from the fixed records, as the Hub canvas does.
  let restoreCollections = html => html
  if (!hydrate && Number(prepared.templateVersion) === 2 && /\{\{\{#collection(?:Results|Options)\s/.test(String(prepared.template || ''))) {
    const withRecords = {}
    for (const [name, source] of Object.entries(declaredSources))
      withRecords[name] = { ...source, value: staticRecords[name] || [] }
    try {
      const preview = await collectionPreview.prepareCmsCollectionPreview(String(prepared.template), withRecords)
      prepared.template = preview.template
      for (const [name, source] of Object.entries(preview.dataSources || {})) {
        if (source?.interactive && isPlainObject(prepared.dataSources?.[name]))
          prepared.dataSources[name].interactive = source.interactive
      }
      restoreCollections = preview.restore
    }
    catch (error) {
      throw new HttpsError('failed-precondition', `The block's interactive collection did not render: ${error?.message || error}`)
    }
  }

  let rendered
  try {
    let timer
    rendered = await Promise.race([
      engine.pageRender([prepared], theme, '', hydrate),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Rendering took longer than ${RENDER_BUDGET_MS / 1000} seconds.`)), Math.max(1000, deadline - Date.now()))
      }),
    ]).finally(() => clearTimeout(timer))
  }
  catch (error) {
    throw new HttpsError('failed-precondition', `The block did not render: ${error?.message || error}`)
  }
  const html = restoreCollections(String(rendered?.blocks?.[0]?.html || ''))
  const unresolved = [...new Set(html.match(/\{\{\{?[^{}]{1,80}\}?\}\}/g) || [])].slice(0, 10)
  if (unresolved.length)
    problems.push(`Unrendered template tags in the output: ${unresolved.join(', ')}`)

  const head = parseJsonField(themeDoc?.headJSON)
  const css = [engine.buildCssVarsBlock(theme), rendered?.css || '', text(themeDoc?.extraCSS)].filter(Boolean).join('\n')
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(block.name || block.docId || 'Block')}</title>\n${headLinks(head)}\n<style>\n${css}\n</style>\n</head>\n<body>\n${html}\n</body>\n</html>\n`
  const htmlOut = truncate(html)
  const documentOut = truncate(page)
  const override = await overrideFor(block, themeId)
  const recordCount = sources.reduce((sum, item) => sum + (item.records || 0), 0)
  const result = {
    orgId,
    docId: definition ? (text(body.docId) || null) : block.docId,
    source,
    name: block.name || null,
    siteId: siteId || null,
    themeId: themeId || null,
    data,
    sources,
    problems,
    renderingOwner: shared.getRenderingOwner(override.status),
    override: {
      status: override.status,
      file: override.selectedMatch?.relativePath || null,
      commit: override.manifest?.commit || null,
      ...(override.reason ? { reason: override.reason } : {}),
    },
    ...(override.status === 'vue-override' ? { note: `The public site replaces this block with ${override.selectedMatch.relativePath}; this HTML is only its CMS fallback.` } : {}),
    htmlBytes: Buffer.byteLength(html),
    html: htmlOut.value,
    htmlTruncated: htmlOut.truncated,
    document: documentOut.value,
    documentTruncated: documentOut.truncated,
    documentNote: 'A standalone page with the theme\'s CSS: save it as .html and open it in a browser to screenshot it. Client helpers (carousels, nav menus, forms) need the public site\'s scripts and stay static here.',
  }
  return {
    result,
    docIds: definition ? [] : [block.docId],
    resultCount: recordCount,
    truncated: htmlOut.truncated || documentOut.truncated || sources.some(item => item.truncated),
  }
}

exports.renderBlock = renderBlock
