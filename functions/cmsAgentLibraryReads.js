// Library reads for agents (blocks, block bases, themes, usage, audit,
// validation) run as the operator: the Hub endpoint has already verified the
// credential and its organization session, and each read checks the
// operator's current Hub read rights before reading. The reads are the local
// MCP's, shared through helpers/cmsAgentReads.mjs, with the same scan limits.
// Each read is recorded in organizations/{orgId}/cmsAgentReads: what was
// asked for, never content, kept 90 days (a TTL policy on expiresAt deletes
// expired entries). Keep identical in functions/.
const { Timestamp } = require('firebase-admin/firestore')
const { db, HttpsError, logger, permissionCheck } = require('./config.js')

const LIBRARY_READ_ACTIONS = ['blocks', 'block', 'themes', 'theme', 'usage', 'audit', 'validate']
// What each action reads, for the permission check.
const READ_TARGETS = {
  blocks: ['blocks'],
  block: ['blocks'],
  themes: ['themes'],
  theme: ['themes'],
  usage: ['blocks', 'sites'],
  audit: ['blocks', 'themes'],
  validate: ['blocks'],
}
const AUDIT_DAYS = 90
const AUDIT_DOC_IDS = 20
// Findings listed per block in a remote audit.
const MAX_LISTED_FINDINGS = 20
// An inline definition to validate, as JSON.
const MAX_DEFINITION_BYTES = 1024 * 1024

let readsPromise
const loadReads = () => {
  readsPromise = readsPromise || Promise.all([
    import('./helpers/cmsAgentReads.mjs'),
    import('./helpers/cmsBlockValidation.mjs'),
    import('./helpers/cmsBlockRevisions.mjs'),
  ]).then(([reads, validation, revisions]) => reads.createCmsReads({
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
  }))
  return readsPromise
}

const text = value => (typeof value === 'string' ? value.trim() : '')
const listLimit = value => Math.max(1, Math.min(Number.isInteger(value) ? value : 25, 100))

// The action's result, and what the audit records about it.
const read = async (reads, orgId, body) => {
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
    const result = await reads.validateDefinition({ orgId, definition, docId: text(body.docId), override: { status: 'unchecked' } })
    return { result: { ...result, renderer: 'Public Vue overrides are not checked remotely (renderingOwner "unchecked").' }, docIds: definition ? [] : [result.docId], resultCount: 1, truncated: false }
  }
  // audit: the summary and the blocks with errors, with their findings.
  const { summary, results } = await reads.auditBlocks({ orgId, includeRender: body.includeRender !== false })
  const limit = listLimit(body.listLimit)
  const blocksWithErrors = results.filter(item => item.errors.length)
  const finding = issue => ({ code: issue.code, severity: issue.severity, path: issue.path, message: issue.message })
  const result = {
    orgId,
    auditedAt: new Date().toISOString(),
    semantics: 'hub-import',
    renderer: 'Public Vue overrides are not checked remotely (renderingOwner "unchecked").',
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
  for (const target of READ_TARGETS[body.action]) {
    if (!await permissionCheck(uid, 'read', `organizations/${orgId}/${target}`))
      throw new HttpsError('permission-denied', `Not allowed to read ${target} in this organization.`)
  }
  const reads = await loadReads()
  const { result, docIds, resultCount, truncated } = await read(reads, orgId, body)
  // Awaited so the write finishes before Cloud Run stops the instance's CPU.
  await recordRead({ orgId, action: body.action, siteId: text(body.siteId), docIds, resultCount, truncated, uid, keyId, connectionId })
  return result
}

exports.LIBRARY_READ_ACTIONS = LIBRARY_READ_ACTIONS
exports.runLibraryRead = runLibraryRead
