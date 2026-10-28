import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  commonTypeRoles,
  mergeValidationResults,
  normalizeBlockTagList,
  validateBlock,
  validateBlockRender,
  validateBlockDocument as validateSharedBlockDocument,
} from '../../../../lib/cmsBlockValidation.js'
import {
  DEFAULT_RESULT_LIMIT,
  MCP_REQUIRED_BLOCK_KEYS,
  assertFirestoreSegment,
  boundedNumber,
  containsRedactedValue,
  createCmsReads,
  hashDocument,
  isPlainObject,
  stableStringify,
  toMcpValidation,
} from '../../../../lib/cmsAgentReads.js'
import { blockDefinitionHash } from '../../../../lib/cmsBlockRevisions.js'

// Shared with the Hub's agent endpoint; re-exported for existing callers.
export { collectBlockReferences, hashDocument, stableStringify, summarizeBlockAudit, summarizeBlockTagRules, toMcpValidation } from '../../../../lib/cmsAgentReads.js'

const CHECKOUT_SCHEMA_VERSION = 1
const MAX_DIFF_CHANGES = 500
const MAX_DIFF_TEXT = 50000

export function resolveCmsOrganization(requestedOrgId, config) {
  const orgId = String(requestedOrgId || config.defaultOrgId || '').trim()
  if (!orgId)
    throw new Error('orgId is required. Pass it explicitly or configure defaultOrgId/EDGE_CMS_MCP_DEFAULT_ORG_ID.')
  assertFirestoreSegment(orgId, 'orgId')
  const allowed = config.allowedOrganizationIds || []
  if (!Array.isArray(allowed))
    throw new Error('allowedOrganizationIds must be an array.')
  if (allowed.length && !allowed.includes(orgId))
    throw new Error(`Organization is outside allowedOrganizationIds: ${orgId}`)
  return orgId
}

export function createCmsToolService({
  db,
  config,
  projectId,
  sanitizeValue = value => value,
  repoRoot,
  credentials = null,
}) {
  if (!db)
    throw new Error('CMS tools require a Firestore database client.')

  const workspaceRoot = resolveLocalPath(
    process.env.EDGE_CMS_WORKSPACE_ROOT || process.env.CLEARWATER_CMS_WORKSPACE_ROOT
      || config.cmsWorkspaceRoot
      || '.tmp/cms-block-workspace',
    repoRoot,
  )
  const rendererRepoPath = resolveLocalPath(
    process.env.EDGE_CMS_RENDERER_REPO || process.env.CLEARWATER_CMS_RENDERER_REPO
      || config.cmsRendererRepoPath
      || '../emd-cms-front',
    repoRoot,
  )
  const auditRoot = resolveLocalPath(
    process.env.EDGE_CMS_AUDIT_ROOT || process.env.CLEARWATER_CMS_AUDIT_ROOT
      || config.cmsAuditRoot
      || '.tmp/cms-block-audits',
    repoRoot,
  )

  const environmentSummary = () => ({
    projectId,
    environment: config.environment,
    productionRead: config.environment === 'production',
    ...(credentials ? { credentials } : {}),
  })

  const resolveOrgId = requestedOrgId => resolveCmsOrganization(requestedOrgId, config)

  const reads = createCmsReads({
    db,
    limits: config,
    sanitizeValue,
    validation: { validateBlock, commonTypeRoles, normalizeBlockTagList },
    blockDefinitionHash,
    loadRenderTemplate,
  })

  const readProductionBlock = async ({ orgId: requestedOrgId, docId }) => reads.readBlock({ orgId: resolveOrgId(requestedOrgId), docId })
  const readProductionTheme = async ({ orgId: requestedOrgId, themeId }) => reads.readTheme({ orgId: resolveOrgId(requestedOrgId), themeId })
  const findTheme = async ({ orgId: requestedOrgId = '', ...input } = {}) => ({ ...environmentSummary(), ...await reads.findTheme({ ...input, orgId: resolveOrgId(requestedOrgId) }) })
  const getTheme = async ({ orgId: requestedOrgId = '', ...input }) => ({ ...environmentSummary(), ...await reads.getTheme({ ...input, orgId: resolveOrgId(requestedOrgId) }) })
  const schema = async ({ orgId: requestedOrgId = '', ...input }) => ({ ...environmentSummary(), ...await reads.liveShape({ ...input, orgId: resolveOrgId(requestedOrgId) }) })
  const listSites = async ({ orgId: requestedOrgId = '' } = {}) => ({ ...environmentSummary(), ...await reads.listSites({ orgId: resolveOrgId(requestedOrgId) }) })
  const blockBase = async ({ orgId: requestedOrgId = '', docId }) => reads.blockBase({ orgId: resolveOrgId(requestedOrgId), docId })
  const findBlock = async ({ orgId: requestedOrgId = '', ...input } = {}) => ({ ...environmentSummary(), ...await reads.findBlock({ ...input, orgId: resolveOrgId(requestedOrgId) }) })

  // Validates every library block in an organization with the Hub's import
  // settings, reading production once. The full per-block report is written to
  // a local file; the response carries only the summary.
  const auditBlocks = async ({
    orgId: requestedOrgId = '',
    themeName = '',
    includeRender = true,
    listLimit,
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    const listedLimit = boundedNumber(listLimit, config.maxCmsResultLimit || 100, DEFAULT_RESULT_LIMIT)
    const { summary, results } = await reads.auditBlocks({
      orgId,
      includeRender,
      ownershipFor: block => resolveVueOverride({ rendererRepoPath, orgId, blockName: block?.name || '', themeName }),
    })
    const auditedAt = new Date().toISOString()
    const reportPath = path.join(auditRoot, orgId, `${auditedAt.replace(/[:.]/g, '-')}.json`)
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeJsonAtomically(reportPath, {
      ...environmentSummary(),
      orgId,
      auditedAt,
      semantics: 'hub-import',
      summary,
      results,
    })

    const blocksWithErrors = results.filter(item => item.errors.length)
    return {
      ...environmentSummary(),
      orgId,
      auditedAt,
      semantics: 'hub-import',
      reportPath,
      summary,
      blocksWithErrors: blocksWithErrors.slice(0, listedLimit).map(item => ({
        docId: item.docId,
        name: item.name,
        errorCodes: [...new Set(item.errors.map(issue => issue.code))],
      })),
      blocksWithErrorsTruncated: blocksWithErrors.length > listedLimit,
    }
  }

  const resolveOverride = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId = '',
    blockName = '',
    themeName = '',
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    let resolvedBlockName = String(blockName || '').trim()
    let productionBlock = null

    if (requestedDocId) {
      productionBlock = await readProductionBlock({ orgId, docId: requestedDocId })
      if (!productionBlock.exists)
        throw new Error(`Production CMS block does not exist: ${productionBlock.documentPath}`)
      resolvedBlockName = String(productionBlock.data?.name || '').trim()
    }
    if (!resolvedBlockName)
      throw new Error('blockName or docId is required to resolve a public frontend override.')

    const resolution = await resolveVueOverride({
      rendererRepoPath,
      orgId,
      blockName: resolvedBlockName,
      themeName,
    })

    return {
      ...environmentSummary(),
      orgId,
      docId: productionBlock?.docId || null,
      documentPath: productionBlock?.documentPath || null,
      blockName: resolvedBlockName,
      themeName: String(themeName || '').trim() || null,
      rendererRepoPath,
      ...resolution,
    }
  }

  const checkoutBlock = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    themeName = '',
  }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)
    if (containsRedactedValue(production.data)) {
      throw new Error(
        `Production CMS block ${production.docId} contains fields redacted by the MCP configuration. Checkout refused because the local copy would not be lossless.`,
      )
    }

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const existing = await readCheckoutFiles(checkoutPaths)
    if (existing.exists) {
      validateCheckoutIdentity(existing.manifest, production.orgId, production.docId)
      const existingBaseHash = hashDocument(existing.base)
      const existingLocalHash = hashDocument(existing.local)
      if (existingBaseHash !== existing.manifest.baseHash) {
        throw new Error(
          `Checkout base does not match its manifest for ${production.docId}. Run cms_status and repair or move the checkout before refreshing it.`,
        )
      }
      if (existingLocalHash !== existing.manifest.baseHash) {
        throw new Error(
          `Local checkout has changes for ${production.docId}. Checkout refused so block.json is not overwritten. Run cms_status and cms_diff first.`,
        )
      }
    }

    const override = await resolveVueOverride({
      rendererRepoPath,
      orgId: production.orgId,
      blockName: production.data?.name || '',
      themeName,
    })
    const checkedOutAt = new Date().toISOString()
    const manifest = {
      schemaVersion: CHECKOUT_SCHEMA_VERSION,
      projectId,
      environment: config.environment,
      orgId: production.orgId,
      docId: production.docId,
      blockName: String(production.data?.name || ''),
      documentPath: production.documentPath,
      checkedOutAt,
      firestoreCreateTime: production.createTime,
      firestoreUpdateTime: production.updateTime,
      baseHash: production.hash,
      renderer: {
        status: override.status,
        componentPath: override.selectedMatch?.absolutePath || null,
      },
    }

    await mkdir(checkoutPaths.directory, { recursive: true })
    await writeJsonAtomically(checkoutPaths.base, production.data)
    await writeJsonAtomically(checkoutPaths.local, production.data)
    await writeJsonAtomically(checkoutPaths.manifest, manifest)

    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      blockName: manifest.blockName,
      baseHash: production.hash,
      firestoreUpdateTime: production.updateTime,
      refreshedExistingCheckout: existing.exists,
      workspace: checkoutPaths,
      renderer: override,
    }
  }

  const status = async ({ orgId: requestedOrgId = '', docId: requestedDocId }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const checkout = await readCheckoutFiles(checkoutPaths)
    if (!checkout.exists) {
      return {
        ...environmentSummary(),
        orgId: production.orgId,
        docId: production.docId,
        documentPath: production.documentPath,
        status: 'untracked',
        productionHash: production.hash,
        workspace: checkoutPaths,
      }
    }

    validateCheckoutIdentity(checkout.manifest, production.orgId, production.docId)
    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      ...buildWorkspaceStatus({
        manifest: checkout.manifest,
        base: checkout.base,
        local: checkout.local,
        production: production.data,
      }),
      firestoreUpdateTime: production.updateTime,
      checkoutTime: checkout.manifest.checkedOutAt || null,
      workspace: checkoutPaths,
    }
  }

  const diff = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    comparison = 'local-production',
  }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const checkout = await readCheckoutFiles(checkoutPaths)
    if (!checkout.exists)
      throw new Error(`No local checkout exists for ${production.docId}. Run cms_checkout_block first.`)
    validateCheckoutIdentity(checkout.manifest, production.orgId, production.docId)

    const comparisons = {
      'base-local': {
        fromLabel: 'checkout-base',
        from: checkout.base,
        toLabel: 'local',
        to: checkout.local,
      },
      'base-production': {
        fromLabel: 'checkout-base',
        from: checkout.base,
        toLabel: 'production',
        to: production.data,
      },
      'local-production': {
        fromLabel: 'local',
        from: checkout.local,
        toLabel: 'production',
        to: production.data,
      },
    }
    const selected = comparisons[comparison]
    if (!selected)
      throw new Error(`Unsupported comparison "${comparison}".`)

    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      comparison,
      from: {
        label: selected.fromLabel,
        hash: hashDocument(selected.from),
      },
      to: {
        label: selected.toLabel,
        hash: hashDocument(selected.to),
      },
      ...buildDocumentDiff(selected.from, selected.to),
      workspace: checkoutPaths,
    }
  }

  const findUsage = async ({ orgId: requestedOrgId = '', ...input }) => ({ ...environmentSummary(), ...await reads.findUsage({ ...input, orgId: resolveOrgId(requestedOrgId) }) })

  const validate = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    source = 'local',
    themeName = '',
  }) => {
    const orgId = resolveOrgId(requestedOrgId)
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    let block
    let sourcePath
    let production = null

    if (source === 'production') {
      production = await readProductionBlock({ orgId, docId })
      if (!production.exists)
        throw new Error(`Production CMS block does not exist: ${production.documentPath}`)
      block = production.data
      sourcePath = production.documentPath
    }
    else {
      const checkoutPaths = getCheckoutPaths(workspaceRoot, orgId, docId)
      const checkout = await readCheckoutFiles(checkoutPaths)
      if (!checkout.exists)
        throw new Error(`No local checkout exists for ${docId}. Run cms_checkout_block first.`)
      validateCheckoutIdentity(checkout.manifest, orgId, docId)
      block = checkout.local
      sourcePath = checkoutPaths.local
    }

    const override = await resolveVueOverride({
      rendererRepoPath,
      orgId,
      blockName: block?.name || '',
      themeName,
    })
    const validation = await validateBlockWithRender(block, { override })

    return {
      ...environmentSummary(),
      orgId,
      docId,
      source,
      sourcePath,
      valid: validation.errors.length === 0,
      ...validation,
      renderer: override,
      hash: hashDocument(block),
      firestoreUpdateTime: production?.updateTime || null,
    }
  }

  return {
    auditBlocks,
    blockBase,
    schema,
    checkoutBlock,
    diff,
    findBlock,
    findTheme,
    findUsage,
    getTheme,
    listSites,
    readProductionBlock,
    readProductionTheme,
    resolveOverride,
    status,
    validate,
    rendererRepoPath,
    workspaceRoot,
    auditRoot,
  }
}

export function buildWorkspaceStatus({ manifest, base, local, production }) {
  const expectedBaseHash = String(manifest?.baseHash || '')
  const baseHash = hashDocument(base)
  const localHash = hashDocument(local)
  const productionHash = hashDocument(production)

  if (!expectedBaseHash || baseHash !== expectedBaseHash) {
    return {
      status: 'invalid-checkout',
      reason: 'base-hash-mismatch',
      manifestBaseHash: expectedBaseHash || null,
      baseHash,
      localHash,
      productionHash,
    }
  }

  const localChanged = localHash !== baseHash
  const productionChanged = productionHash !== baseHash
  let status = 'clean'

  if (localHash === productionHash && localChanged)
    status = 'local-matches-production'
  else if (localChanged && productionChanged)
    status = 'diverged'
  else if (localChanged)
    status = 'local-changed'
  else if (productionChanged)
    status = 'production-changed'

  return {
    status,
    localChanged,
    productionChanged,
    manifestBaseHash: expectedBaseHash,
    baseHash,
    localHash,
    productionHash,
    changedTopLevelFields: {
      baseToLocal: changedTopLevelFields(base, local),
      baseToProduction: changedTopLevelFields(base, production),
      localToProduction: changedTopLevelFields(local, production),
    },
  }
}

export function buildDocumentDiff(fromValue, toValue) {
  const changes = []
  collectValueChanges(fromValue, toValue, '', changes)
  const truncated = changes.length > MAX_DIFF_CHANGES
  const selectedChanges = changes.slice(0, MAX_DIFF_CHANGES)
  return {
    equal: changes.length === 0,
    changeCount: changes.length,
    changesTruncated: truncated,
    changedTopLevelFields: changedTopLevelFields(fromValue, toValue),
    changes: selectedChanges,
  }
}

export function validateBlockDocument(block, { override = null } = {}) {
  const shared = validateSharedBlockDocument(block, {
    requiredKeys: MCP_REQUIRED_BLOCK_KEYS,
    requireDocId: true,
    ownership: override,
  })
  return toMcpValidation(block, shared, { override })
}

let templateEngine
// The engine is resolved from the Hub's root node_modules. When it cannot be
// loaded, render checks report as skipped instead of failing validation.
async function loadRenderTemplate() {
  if (templateEngine === undefined) {
    try {
      templateEngine = (await import('@edgedev/template-engine')).renderTemplateAsync || null
    }
    catch {
      templateEngine = null
    }
  }
  return templateEngine
}

export async function validateBlockWithRender(block, { override = null, renderTemplate } = {}) {
  const shared = validateSharedBlockDocument(block, {
    requiredKeys: MCP_REQUIRED_BLOCK_KEYS,
    requireDocId: true,
    ownership: override,
  })
  const render = await validateBlockRender(block, {
    renderTemplate: renderTemplate === undefined ? await loadRenderTemplate() : renderTemplate,
  })
  return toMcpValidation(block, mergeValidationResults(shared, render), { override })
}

export async function resolveVueOverride({ rendererRepoPath, orgId, blockName, themeName = '' }) {
  const blocksRoot = path.join(rendererRepoPath, 'app/blocks')
  let files
  try {
    files = await listFilesRecursively(blocksRoot, filePath => filePath.endsWith('.vue'))
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'renderer-repo-unavailable',
        candidateNames: componentCandidateNames(blockName),
        selectedMatch: null,
        matches: [],
      }
    }
    throw error
  }

  const candidateNames = componentCandidateNames(blockName)
  const candidateTokens = [...new Set(candidateNames.map(normalizeComponentLookup).filter(Boolean))]
  const orgToken = normalizeComponentLookup(orgId)
  const themeToken = normalizeComponentLookup(themeName)
  const orgMatches = []
  const globalMatches = []

  for (const absolutePath of files) {
    const relativePath = path.relative(blocksRoot, absolutePath)
    const relativeWithoutExtension = relativePath.replace(/\.vue$/i, '')
    const lookupKey = normalizeComponentLookup(relativeWithoutExtension)
    const basenameToken = normalizeComponentLookup(path.basename(relativeWithoutExtension))
    const orgIndex = orgToken ? lookupKey.indexOf(orgToken) : -1

    if (orgIndex >= 0) {
      const scopedName = lookupKey.slice(orgIndex + orgToken.length)
      const matchesScopedName = candidateTokens.some((candidateToken) => {
        return scopedName === candidateToken
          || (themeToken && scopedName === `${themeToken}${candidateToken}`)
      })
      if (matchesScopedName) {
        orgMatches.push({ absolutePath, relativePath, scope: 'organization' })
      }
      continue
    }

    if (!relativePath.includes(path.sep) && candidateTokens.includes(basenameToken))
      globalMatches.push({ absolutePath, relativePath, scope: 'global' })
  }

  const matches = orgMatches.length ? orgMatches : globalMatches
  const status = matches.length === 0
    ? 'cms-html'
    : (matches.length === 1 ? 'vue-override' : 'ambiguous-vue-override')

  return {
    status,
    candidateNames,
    selectedMatch: matches.length === 1 ? matches[0] : null,
    matches,
  }
}

function resolveLocalPath(value, repoRoot) {
  const configuredPath = String(value || '').trim()
  if (!configuredPath)
    throw new Error('Configured local path cannot be empty.')
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(repoRoot, configuredPath)
}

function getCheckoutPaths(workspaceRoot, orgId, docId) {
  const safeOrgId = assertFirestoreSegment(orgId, 'orgId')
  const safeDocId = assertFirestoreSegment(docId, 'docId')
  const directory = path.join(workspaceRoot, safeOrgId, safeDocId)
  return {
    root: workspaceRoot,
    directory,
    local: path.join(directory, 'block.json'),
    base: path.join(directory, 'base.json'),
    manifest: path.join(directory, 'checkout.json'),
  }
}

async function readCheckoutFiles(checkoutPaths) {
  const [manifestResult, baseResult, localResult] = await Promise.all([
    readJsonIfExists(checkoutPaths.manifest),
    readJsonIfExists(checkoutPaths.base),
    readJsonIfExists(checkoutPaths.local),
  ])
  const existingCount = [manifestResult, baseResult, localResult].filter(result => result.exists).length

  if (existingCount === 0)
    return { exists: false, manifest: null, base: null, local: null }
  if (existingCount !== 3) {
    throw new Error(
      `Incomplete CMS checkout at ${checkoutPaths.directory}. Expected block.json, base.json, and checkout.json.`,
    )
  }

  return {
    exists: true,
    manifest: manifestResult.value,
    base: baseResult.value,
    local: localResult.value,
  }
}

async function readJsonIfExists(filePath) {
  try {
    const text = await readFile(filePath, 'utf8')
    return { exists: true, value: JSON.parse(text) }
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return { exists: false, value: null }
    if (error instanceof SyntaxError)
      throw new Error(`Invalid JSON in local CMS workspace file: ${filePath}`)
    throw error
  }
}

function validateCheckoutIdentity(manifest, orgId, docId) {
  if (!isPlainObject(manifest))
    throw new Error('CMS checkout manifest must be a JSON object.')
  if (Number(manifest.schemaVersion) !== CHECKOUT_SCHEMA_VERSION)
    throw new Error(`Unsupported CMS checkout schema version: ${manifest.schemaVersion}`)
  if (String(manifest.orgId || '') !== orgId || String(manifest.docId || '') !== docId) {
    throw new Error(
      `CMS checkout identity mismatch. Expected ${orgId}/${docId}, found ${manifest.orgId || ''}/${manifest.docId || ''}.`,
    )
  }
}

async function writeJsonAtomically(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

function changedTopLevelFields(left, right) {
  const keys = new Set([
    ...Object.keys(isPlainObject(left) ? left : {}),
    ...Object.keys(isPlainObject(right) ? right : {}),
  ])
  return [...keys]
    .filter(key => stableStringify(left?.[key]) !== stableStringify(right?.[key]))
    .sort()
}

function collectValueChanges(fromValue, toValue, fieldPath, changes) {
  if (stableStringify(fromValue) === stableStringify(toValue))
    return

  if (changes.length > MAX_DIFF_CHANGES)
    return

  if (isPlainObject(fromValue) && isPlainObject(toValue)) {
    const keys = [...new Set([...Object.keys(fromValue), ...Object.keys(toValue)])].sort()
    for (const key of keys) {
      const childPath = fieldPath ? `${fieldPath}.${key}` : key
      collectValueChanges(fromValue[key], toValue[key], childPath, changes)
    }
    return
  }

  changes.push({
    path: fieldPath || '$',
    kind: fromValue === undefined ? 'added' : (toValue === undefined ? 'removed' : 'changed'),
    before: summarizeDiffValue(fromValue),
    after: summarizeDiffValue(toValue),
    textDiff: (typeof fromValue === 'string' && typeof toValue === 'string')
      ? buildTextDiff(fromValue, toValue)
      : null,
  })
}

function summarizeDiffValue(value) {
  if (value === undefined)
    return { type: 'undefined' }
  if (typeof value === 'string') {
    return {
      type: 'string',
      length: value.length,
      hash: hashDocument(value),
      preview: truncateText(value, 4000),
    }
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      hash: hashDocument(value),
      preview: value.length <= 20 ? value : value.slice(0, 20),
    }
  }
  if (isPlainObject(value)) {
    return {
      type: 'object',
      keys: Object.keys(value).sort(),
      hash: hashDocument(value),
    }
  }
  return { type: value === null ? 'null' : typeof value, value }
}

function buildTextDiff(before, after) {
  const beforeLines = String(before).split('\n')
  const afterLines = String(after).split('\n')
  let prefix = 0
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const contextStart = Math.max(0, prefix - 3)
  const beforeChangeEnd = beforeLines.length - suffix
  const afterChangeEnd = afterLines.length - suffix
  const suffixContextEnd = Math.min(beforeLines.length, beforeChangeEnd + 3)
  const lines = []

  for (let index = contextStart; index < prefix; index++)
    lines.push(` ${beforeLines[index]}`)
  for (let index = prefix; index < beforeChangeEnd; index++)
    lines.push(`-${beforeLines[index]}`)
  for (let index = prefix; index < afterChangeEnd; index++)
    lines.push(`+${afterLines[index]}`)
  for (let index = beforeChangeEnd; index < suffixContextEnd; index++)
    lines.push(` ${beforeLines[index]}`)

  return truncateText(lines.join('\n'), MAX_DIFF_TEXT)
}

function truncateText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength)
    return text
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} characters]`
}

function componentCandidateNames(label) {
  const camel = toCamelFromLabel(label)
  if (!camel)
    return []
  const pascal = toPascalCase(camel)
  const kebab = toKebabCase(pascal)
  return [...new Set([pascal, camel, kebab].filter(Boolean))]
}

function toCamelFromLabel(label) {
  const tokens = String(label || '')
    .trim()
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length)
    return ''
  return tokens[0].toLowerCase() + tokens
    .slice(1)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join('')
}

function toPascalCase(value) {
  return String(value || '')
    .replace(/(^|[^A-Z0-9]+)([A-Z0-9])/gi, (_, __, character) => character.toUpperCase())
    .replace(/[^A-Z0-9]/gi, '')
}

function toKebabCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function normalizeComponentLookup(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

async function listFilesRecursively(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath, predicate))
      continue
    }
    if (entry.isFile() && predicate(entryPath))
      files.push(entryPath)
  }
  return files.sort()
}
