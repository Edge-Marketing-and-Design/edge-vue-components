// Library reads for agents (blocks, block bases, themes, sites, usage, audit,
// validation, rendering) run as the operator: the Hub endpoint has already
// verified the credential and its organization session, and each read checks the
// operator's current Hub read rights before reading. The reads are the local
// MCP's, shared through helpers/cmsAgentReads.mjs, with the same scan limits.
// Each read is recorded in organizations/{orgId}/cmsAgentReads: what was
// asked for, never content, kept 90 days (a TTL policy on expiresAt deletes
// expired entries). Keep identical in functions/.
const { Timestamp } = require('firebase-admin/firestore')
const { db, HttpsError, logger, permissionCheck } = require('./config.js')
const { renderBlock } = require('./cmsAgentRender.js')

const LIBRARY_READ_ACTIONS = ['blocks', 'block', 'themes', 'theme', 'sites', 'usage', 'audit', 'validate', 'schema', 'render']
// What each action reads, for the permission check.
const READ_TARGETS = {
  blocks: ['blocks'],
  block: ['blocks'],
  themes: ['themes'],
  theme: ['themes'],
  sites: ['sites'],
  usage: ['blocks', 'sites'],
  audit: ['blocks', 'themes'],
  validate: ['blocks'],
  // render: also sites, themes and each live source, checked in renderBlock.
  render: ['blocks'],
  // schema: checked per collection in read().
  schema: [],
}
// A described shape is reused for this long, per organization, collection
// and site; permissions and the audit still run on every request.
const SHAPE_CACHE_MS = 5 * 60 * 1000
const shapeCache = new Map()
const AUDIT_DAYS = 90
const AUDIT_DOC_IDS = 20
// Findings listed per block in a remote audit.
const MAX_LISTED_FINDINGS = 20
// An inline definition to validate, as JSON.
const MAX_DEFINITION_BYTES = 1024 * 1024

const text = value => (typeof value === 'string' ? value.trim() : '')
const listLimit = value => Math.max(1, Math.min(Number.isInteger(value) ? value : 25, 100))

// The deployed renderer's override manifest (emd-cms-front
// /_edge/block-overrides.json, CMS_RENDERER_MANIFEST_URL): kept 5 minutes, a
// failed fetch retried after 30 seconds.
const MANIFEST_CACHE_MS = 5 * 60 * 1000
const MANIFEST_RETRY_MS = 30 * 1000
const MANIFEST_TIMEOUT_MS = 3000
let manifestCache = null

const readOverrideManifest = async ({ fetchImpl = globalThis.fetch, now = Date.now() } = {}) => {
  const url = text(process.env.CMS_RENDERER_MANIFEST_URL)
  if (!url)
    return { ok: false, status: 'unchecked', reason: 'CMS_RENDERER_MANIFEST_URL is not set for this Hub.' }
  if (manifestCache && manifestCache.url === url && now < manifestCache.expiresAt)
    return manifestCache.value
  let value
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS), headers: { accept: 'application/json' } })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body?.components) || !body.components.every(item => typeof item === 'string'))
      throw new Error('no components list')
    value = { ok: true, url, commit: text(body.commit) || null, builtAt: text(body.builtAt) || null, components: body.components }
  }
  catch (error) {
    logger.warn('Override manifest unavailable', { url, error: error?.message })
    value = { ok: false, status: 'renderer-manifest-unavailable', reason: `The override manifest (${url}) could not be read: ${error?.message || error}.` }
  }
  manifestCache = { url, value, expiresAt: now + (value.ok ? MANIFEST_CACHE_MS : MANIFEST_RETRY_MS) }
  return value
}

// A block's public renderer resolution from the manifest.
const overrideFromManifest = (reads, manifest, { orgId, block, themeId = '' }) => {
  if (!manifest.ok)
    return { status: manifest.status, candidateNames: [], selectedMatch: null, matches: [], reason: manifest.reason }
  return {
    ...reads.resolveOverrideFromComponents(manifest.components, { orgId, blockName: block?.name || '', themeId, isOverrideBlock: block?.isOverrideBlock === true }),
    manifest: { commit: manifest.commit, builtAt: manifest.builtAt },
  }
}

const rendererNote = manifest => (manifest.ok
  ? `Public Vue overrides checked against the deployed emd-cms-front (${manifest.commit || 'unknown commit'}, built ${manifest.builtAt || 'unknown'}).`
  : `${manifest.reason} Public Vue overrides are ${manifest.status === 'unchecked' ? 'not checked (renderingOwner "unchecked")' : 'unverified (renderingOwner "unverified")'}.`)

let readsPromise
const loadReads = () => {
  readsPromise = readsPromise || Promise.all([
    import('./helpers/cmsAgentReads.mjs'),
    import('./helpers/cmsBlockValidation.mjs'),
    import('./helpers/cmsBlockRevisions.mjs'),
  ]).then(([reads, validation, revisions]) => ({
    resolveOverrideFromComponents: reads.resolveOverrideFromComponents,
    getRenderingOwner: reads.getRenderingOwner,
    ...reads.createCmsReads({
    db,
    sanitizeValue: reads.firestoreJson,
    validation,
    blockDefinitionHash: revisions.blockDefinitionHash,
    loadRenderTemplate: async () => {
      try {
        return (await import('@edgedev/template-engine')).renderTemplateAsync || null
      }
      catch {
        return null
      }
    },
  })}))
  return readsPromise
}

const requireRead = async (uid, orgId, target) => {
  if (!await permissionCheck(uid, 'read', `organizations/${orgId}/${target}`))
    throw new HttpsError('permission-denied', `Not allowed to read ${target} in this organization.`)
}

// The action's result, and what the audit records about it.
const read = async (reads, orgId, body, uid) => {
  if (body.action === 'schema') {
    const collection = text(body.collection)
    const siteId = text(body.siteId)
    // Finding a Data Source collection reads the library.
    if (!['blocks', 'themes', 'sites', 'pages', 'published-pages', 'posts', 'published-posts'].includes(collection))
      await requireRead(uid, orgId, 'blocks')
    const target = await reads.resolveShapeCollection({ orgId, collection, siteId })
    for (const name of target.reads)
      await requireRead(uid, orgId, name)
    const key = [orgId, target.name, siteId, body.limit || ''].join('|')
    const cached = shapeCache.get(key)
    let result
    if (cached && Date.now() - cached.at < SHAPE_CACHE_MS) {
      result = { ...cached.result, cachedAt: new Date(cached.at).toISOString() }
    }
    else {
      result = await reads.liveShape({ orgId, collection, siteId, limit: body.limit })
      shapeCache.set(key, { at: Date.now(), result })
    }
    return { result, docIds: [], resultCount: result.sampled, truncated: result.truncated || result.fieldsTruncated }
  }
  if (body.action === 'blocks') {
    const result = await reads.findBlock({ orgId, docId: text(body.docId), query: text(body.query), exactName: text(body.exactName), tag: text(body.tag), type: text(body.type), theme: text(body.theme), limit: body.limit, startAfter: text(body.startAfter) })
    return { result, docIds: result.matches.map(match => match.docId), resultCount: result.returnedDocuments, truncated: result.resultTruncated || result.scanTruncated }
  }
  if (body.action === 'block') {
    const result = await reads.blockBase({ orgId, docId: body.docId })
    if (!result.ok)
      throw new HttpsError('not-found', result.message)
    return { result, docIds: [result.docId], resultCount: 1, truncated: false }
  }
  if (body.action === 'themes') {
    const result = await reads.findTheme({ orgId, docId: text(body.docId), query: text(body.query), exactName: text(body.exactName), limit: body.limit })
    return { result, docIds: result.matches.map(match => match.themeId), resultCount: result.returnedDocuments, truncated: result.resultTruncated || result.scanTruncated }
  }
  if (body.action === 'theme') {
    const result = await reads.getTheme({ orgId, themeId: body.themeId, includeCustomFonts: body.includeCustomFonts !== false })
    return { result, docIds: [result.themeId], resultCount: 1, truncated: false }
  }
  if (body.action === 'sites') {
    const result = await reads.listSites({ orgId })
    return { result, docIds: result.sites.map(site => site.siteId), resultCount: result.siteCount, truncated: result.scanTruncated }
  }
  if (body.action === 'usage') {
    const result = await reads.findUsage({ orgId, docId: body.docId, siteId: text(body.siteId), limit: body.limit })
    return { result, docIds: [result.docId], resultCount: result.usageCount, truncated: result.resultTruncated || result.siteScanTruncated || result.scanned.some(scan => scan.scanTruncated) }
  }
  if (body.action === 'validate') {
    const definition = body.definition ?? null
    if (definition !== null && Buffer.byteLength(JSON.stringify(definition)) > MAX_DEFINITION_BYTES)
      throw new HttpsError('invalid-argument', `definition is larger than ${MAX_DEFINITION_BYTES} bytes.`)
    if (definition === null && !text(body.docId))
      throw new HttpsError('invalid-argument', 'Send a definition to validate, or the docId of a library block.')
    const manifest = await readOverrideManifest()
    const result = await reads.validateDefinition({ orgId, definition, docId: text(body.docId), ownershipFor: block => overrideFromManifest(reads, manifest, { orgId, block }) })
    return { result: { ...result, renderer: rendererNote(manifest) }, docIds: definition ? [] : [result.docId], resultCount: 1, truncated: false }
  }
  if (body.action === 'render') {
    const manifest = await readOverrideManifest()
    return renderBlock({
      reads,
      orgId,
      body,
      requireRead: target => requireRead(uid, orgId, target),
      overrideFor: (block, themeId) => overrideFromManifest(reads, manifest, { orgId, block, themeId }),
    })
  }
  // audit: the summary and the blocks with errors, with their findings.
  const manifest = await readOverrideManifest()
  const { summary, results } = await reads.auditBlocks({ orgId, includeRender: body.includeRender !== false, ownershipFor: block => overrideFromManifest(reads, manifest, { orgId, block }) })
  const limit = listLimit(body.listLimit)
  const blocksWithErrors = results.filter(item => item.errors.length)
  const finding = issue => ({ code: issue.code, severity: issue.severity, path: issue.path, message: issue.message })
  const result = {
    orgId,
    auditedAt: new Date().toISOString(),
    semantics: 'hub-import',
    renderer: rendererNote(manifest),
    summary,
    blocksWithErrors: blocksWithErrors.slice(0, limit).map(item => ({
      docId: item.docId,
      name: item.name,
      errors: item.errors.slice(0, MAX_LISTED_FINDINGS).map(finding),
      warnings: item.warnings.slice(0, MAX_LISTED_FINDINGS).map(finding),
      findingsTruncated: item.errors.length > MAX_LISTED_FINDINGS || item.warnings.length > MAX_LISTED_FINDINGS,
    })),
    blocksWithErrorsTruncated: blocksWithErrors.length > limit,
  }
  return { result, docIds: blocksWithErrors.map(item => item.docId), resultCount: results.length, truncated: Boolean(summary.scanTruncated) }
}

// A failed audit write is logged, never returned: it must not fail the read.
const recordRead = async ({ orgId, action, siteId, docIds, resultCount, truncated, uid, keyId, connectionId }) => {
  try {
    const now = Date.now()
    await db.collection('organizations').doc(orgId).collection('cmsAgentReads').add({
      tool: action,
      siteId: siteId || null,
      docIds: docIds.filter(Boolean).slice(0, AUDIT_DOC_IDS),
      resultCount,
      truncated,
      connectionId: connectionId || null,
      agentKeyId: connectionId ? null : (keyId || null),
      runBy: uid,
      at: new Date(now).toISOString(),
      expiresAt: Timestamp.fromMillis(now + AUDIT_DAYS * 86400000),
    })
  }
  catch (error) {
    logger.warn('Agent read audit write failed', { orgId, action, error: error?.message })
  }
}

// Runs one library read for a verified caller and records it.
const runLibraryRead = async ({ uid, orgId, body, keyId = null, connectionId = null }) => {
  for (const target of READ_TARGETS[body.action])
    await requireRead(uid, orgId, target)
  const reads = await loadReads()
  const { result, docIds, resultCount, truncated } = await read(reads, orgId, body, uid)
  // Awaited so the write finishes before Cloud Run stops the instance's CPU.
  await recordRead({ orgId, action: body.action, siteId: text(body.siteId), docIds, resultCount, truncated, uid, keyId, connectionId })
  return result
}

// Adds the deployed renderer's answer (the override manifest) to each
// block.override item of a site readiness report, with the site's theme.
const withDeployedOverrides = async ({ orgId, siteId, report }) => {
  const items = Array.isArray(report?.items) ? report.items : []
  if (!items.some(item => item.code === 'block.override' && item.blockId))
    return report
  const [reads, manifest, siteSnap] = await Promise.all([
    loadReads(),
    readOverrideManifest(),
    db.collection('organizations').doc(orgId).collection('sites').doc(siteId).get(),
  ])
  const themeId = text(siteSnap.data()?.theme)
  const decorated = await Promise.all(items.map(async (item) => {
    if (item.code !== 'block.override' || !item.blockId)
      return item
    const blockSnap = await db.collection('organizations').doc(orgId).collection('blocks').doc(String(item.blockId)).get()
    const resolution = overrideFromManifest(reads, manifest, { orgId, block: blockSnap.data() || {}, themeId })
    const found = resolution.status === 'vue-override'
    return {
      ...item,
      deployedRenderer: {
        status: resolution.status,
        renderingOwner: reads.getRenderingOwner(resolution.status),
        file: resolution.selectedMatch?.relativePath || null,
        commit: resolution.manifest?.commit || null,
        note: !manifest.ok
          ? manifest.reason
          : found
            ? 'The deployed public site has this component.'
            : resolution.status === 'ambiguous-vue-override'
              ? `Several deployed components match: ${resolution.matches.map(match => match.relativePath).join(', ')}.`
              : 'The deployed public site has no matching component, so it shows the block\'s CMS HTML.',
      },
    }
  }))
  return { ...report, items: decorated }
}

exports.LIBRARY_READ_ACTIONS = LIBRARY_READ_ACTIONS
exports.withDeployedOverrides = withDeployedOverrides
exports.runLibraryRead = runLibraryRead
