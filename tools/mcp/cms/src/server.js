#!/usr/bin/env node

import './node-version.js'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import admin from 'firebase-admin'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { cmsAgentToolDefinitions, selectGuideSection } from '../../../../lib/cmsAgentMcpTools.js'
import { CMS_OPERATION_TYPES } from '../../../../lib/cmsOperations.js'
import { createConnectionClient, resolveConnectionKey } from './agent-connections.js'
import { agentEndpoint, createAgentOperationClient, loadOperationFile, resolveAgentKey } from './agent-operations.js'
import { createCmsToolService, resolveCmsOrganization } from './cms-tools.js'
import { contractKinds, readContract } from './contracts.js'
import { describeCredentials, resolveCredentials } from './credentials.js'

// Shared Edge code: this server lives in <hub>/edge/tools/mcp/cms/src and
// serves the Hub it is checked out in. Each Hub keeps its own config (for
// Clearwater, tools/mcp/config/clearwater.production.json), named by
// EDGE_CMS_MCP_CONFIG. Every EDGE_CMS_MCP_* setting also accepts its older
// CLEARWATER_FIRESTORE_MCP_* name.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = process.env.EDGE_CMS_HUB_ROOT || path.resolve(__dirname, '../../../../..')
const setting = name => process.env[`EDGE_CMS_MCP_${name}`] || process.env[`CLEARWATER_FIRESTORE_MCP_${name}`] || ''

const config = await loadConfig()
const redactionPatterns = (config.redactedFieldPatterns || []).map(pattern => new RegExp(pattern, 'i'))
const redactedFieldNames = new Set((config.redactedFieldNames || []).map(name => name.toLowerCase()))

const credentials = resolveCredentials({ configFile: config.credentialsFile })
const credentialSummary = describeCredentials(credentials)
if (!credentials.readOnlyServiceAccount) {
  console.error(`[${config.serverName}] No read-only service account key found; using Application Default Credentials. See the README "Credentials" section.`)
}

const app = admin.apps.length
  ? admin.app()
  : admin.initializeApp({
    projectId: setting('PROJECT') || config.projectId,
    ...(credentials.key ? { credential: admin.credential.cert(credentials.key) } : {}),
  })

const db = app.firestore()
const cmsTools = createCmsToolService({
  db,
  config,
  projectId: projectId(),
  sanitizeValue,
  repoRoot,
  credentials: credentialSummary,
})

const connectionMode = Boolean(config.agentConnectionFile || process.env.EDGE_CMS_AGENT_CONNECTION)
const connections = connectionMode
  ? createConnectionClient({
    endpoint: config.agentConnectionEndpoint || agentEndpoint({ config }).replace(/cms-agentOperation$/, 'cms-agentConnection'),
    getConnectionKey: () => resolveConnectionKey({ config }),
  })
  : null

const agentOperations = createAgentOperationClient({
  endpoint: agentEndpoint({ config }),
  getKey: () => resolveAgentKey({ config }),
  connections,
})

const server = new McpServer({
  name: config.serverName,
  version: '0.6.0',
})

const resolveOrgId = orgId => resolveCmsOrganization(orgId, config)

const OperationSchema = z.object({ type: z.enum(CMS_OPERATION_TYPES) }).passthrough()

// Exactly one of `operation` or `operationFile`. Returns { operation, source }
// or { refusal } in the Hub's refusal shape.
async function resolveOperationInput({ operation, operationFile }) {
  if (operation && operationFile)
    return { refusal: { ok: false, httpStatus: 0, code: 'operation-input', message: 'Send either operation or operationFile, not both.', details: null } }
  if (!operationFile) {
    if (!operation)
      return { refusal: { ok: false, httpStatus: 0, code: 'operation-input', message: 'Send operation or operationFile.', details: null } }
    return { operation, source: null }
  }
  const loaded = await loadOperationFile(operationFile, {
    baseDir: repoRoot,
    roots: [repoRoot, path.resolve(repoRoot, config.cmsWorkspaceRoot), os.tmpdir(), '/tmp'],
  })
  if (!loaded.ok)
    return { refusal: loaded }
  const parsed = OperationSchema.safeParse(loaded.operation)
  if (!parsed.success)
    return { refusal: { ok: false, httpStatus: 0, code: 'operation-file-invalid', message: `operationFile does not hold a valid operation: ${parsed.error.issues.map(issue => issue.message).join('; ')}`, details: null } }
  return { operation: parsed.data, source: loaded.source }
}

const withOperationSource = (result, source) => (source ? { ...result, operationFile: source } : result)

// Adds the local renderer's answer to each override item: whether the
// emd-cms-front checkout has the block's Vue component.
async function withLocalOverrideChecks(orgId, report) {
  if (!report?.ok || !Array.isArray(report.items))
    return report
  const items = []
  for (const item of report.items) {
    if (item.code !== 'block.override' || !item.blockId) {
      items.push(item)
      continue
    }
    try {
      const resolution = await cmsTools.resolveOverride({ orgId, docId: item.blockId })
      const found = resolution.status === 'vue-override'
      items.push({
        ...item,
        localRenderer: {
          status: resolution.status,
          file: resolution.selectedMatch?.relativePath || resolution.selectedMatch?.file || null,
          note: found ? 'The local emd-cms-front checkout has this component; confirm it is deployed.' : 'The local emd-cms-front checkout has no single matching component: the public site would show the block\'s CMS HTML.',
        },
      })
    }
    catch (error) {
      items.push({ ...item, localRenderer: { status: 'unchecked', note: error.message } })
    }
  }
  return { ...report, items }
}

// The Hub's explanation overrides for the operations contract (top-level
// agent-contract-notes), or none when this server can't read them.
async function readContractNotes() {
  try {
    const snapshot = await db.collection('agent-contract-notes').get()
    return Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()?.text]).filter(([, text]) => typeof text === 'string' && text.trim()))
  }
  catch {
    return {}
  }
}

// Readers that check a Firestore path against the config before reading.
const collectionPathFor = (input) => {
  const normalizedPath = resolveConfiguredPath(input)
  assertAllowedPath(normalizedPath)
  assertCollectionPath(normalizedPath)
  return normalizedPath
}
const readResult = extra => ({
  projectId: projectId(),
  environment: config.environment,
  productionRead: config.environment === 'production',
  credentials: credentialSummary,
  ...extra,
})

const handlers = {
  async firestore_list_collections({ documentPath }) {
    const normalizedPath = resolveConfiguredPath(documentPath)
    if (normalizedPath) {
      assertAllowedPath(normalizedPath)
      assertDocumentPath(normalizedPath)
    }
    else if (config.allowedOrganizationIds.length) {
      throw new Error('Root collection listing is unavailable with an organization allowlist.')
    }
    const collections = normalizedPath
      ? await db.doc(normalizedPath).listCollections()
      : await db.listCollections()
    return jsonResult(readResult({
      parentPath: normalizedPath || '/',
      collections: collections.map(collection => ({
        id: collection.id,
        path: collection.path,
      })),
    }))
  },
  async firestore_get_document({ documentPath }) {
    const normalizedPath = resolveConfiguredPath(documentPath)
    assertAllowedPath(normalizedPath)
    assertDocumentPath(normalizedPath)
    const snapshot = await db.doc(normalizedPath).get()
    return jsonResult(readResult({
      path: normalizedPath,
      exists: snapshot.exists,
      data: snapshot.exists ? sanitizeValue(snapshot.data()) : null,
    }))
  },
  async firestore_sample_collection({ collectionPath, limit }) {
    const normalizedPath = collectionPathFor(collectionPath)
    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    return jsonResult(readResult({
      collectionPath: normalizedPath,
      limit: effectiveLimit,
      count: snapshot.size,
      documents: snapshot.docs.map(doc => ({
        id: doc.id,
        path: doc.ref.path,
        data: sanitizeValue(doc.data()),
      })),
    }))
  },
  async firestore_infer_schema({ collectionPath, limit }) {
    const normalizedPath = collectionPathFor(collectionPath)
    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    const schema = inferSchema(snapshot.docs.map(doc => doc.data()))
    return jsonResult(readResult({
      collectionPath: normalizedPath,
      sampledDocuments: snapshot.size,
      schema,
    }))
  },
  async firestore_compare_schema({ collectionPath, expectedSchema, limit }) {
    const normalizedPath = collectionPathFor(collectionPath)
    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    const currentSchema = inferSchema(snapshot.docs.map(doc => doc.data()))
    return jsonResult(readResult({
      collectionPath: normalizedPath,
      sampledDocuments: snapshot.size,
      comparison: compareSchemas(expectedSchema, currentSchema),
      currentSchema,
    }))
  },
  async firestore_find_field({ collectionPath, fieldPath, mode, limit }) {
    const normalizedPath = collectionPathFor(collectionPath)
    const effectiveLimit = boundedLimit(limit, config.maxFindFieldDocuments)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    const matches = []
    for (const doc of snapshot.docs) {
      const data = doc.data()
      const found = hasFieldPath(data, fieldPath)
      if ((mode === 'exists' && found) || (mode === 'missing' && !found)) {
        matches.push({
          id: doc.id,
          path: doc.ref.path,
          preview: sanitizeValue(data),
        })
      }
    }
    return jsonResult(readResult({
      collectionPath: normalizedPath,
      fieldPath,
      mode,
      scannedDocuments: snapshot.size,
      matchedDocuments: matches.length,
      matches,
    }))
  },
  cms_find_block: async input => jsonResult(await cmsTools.findBlock(input)),
  cms_audit_blocks: async input => jsonResult(await cmsTools.auditBlocks(input)),
  cms_checkout_block: async input => jsonResult(await cmsTools.checkoutBlock(input)),
  cms_status: async input => jsonResult(await cmsTools.status(input)),
  cms_diff: async input => jsonResult(await cmsTools.diff(input)),
  cms_resolve_override: async input => jsonResult(await cmsTools.resolveOverride(input)),
  cms_find_usage: async input => jsonResult(await cmsTools.findUsage(input)),
  cms_validate: async input => jsonResult(await cmsTools.validate(input)),
  cms_find_theme: async input => jsonResult(await cmsTools.findTheme(input)),
  cms_get_theme: async input => jsonResult(await cmsTools.getTheme(input)),
  cms_contract: async ({ kind }) => jsonResult(await readContract({ kind, repoRoot, notes: await readContractNotes() })),
  cms_schema: async input => jsonResult(await cmsTools.schema(input)),
  // The guide the remote server serves, from this checkout's Edge copy.
  cms_guide: async ({ section }) => jsonResult(selectGuideSection(await readFile(path.resolve(__dirname, '../../../../functions/agentGuide/cms-agent-guide.md'), 'utf8'), section)),
  cms_agent_organizations: async input => jsonResult(connections ? await connections.organizations(input) : { ok: false, code: 'connection-required', message: 'Configure a Hub-issued agent connection to discover its organizations.' }),
  async cms_open_session(input) {
    const orgId = resolveOrgId(input.orgId)
    return jsonResult(connections ? await connections.open({ ...input, orgId }) : { ok: false, code: 'connection-required', message: 'Configure a Hub-issued agent connection to open sessions.' })
  },
  async cms_check_operation({ orgId, operation, operationFile, sessionId }) {
    const org = resolveOrgId(orgId)
    const input = await resolveOperationInput({ operation, operationFile })
    if (input.refusal)
      return jsonResult(input.refusal)
    return jsonResult(withOperationSource(await agentOperations.check(org, input.operation, sessionId), input.source))
  },
  async cms_run_operation({ orgId, operation, operationFile, checksum, sessionId }) {
    const org = resolveOrgId(orgId)
    const input = await resolveOperationInput({ operation, operationFile })
    if (input.refusal)
      return jsonResult(input.refusal)
    return jsonResult(withOperationSource(await agentOperations.run(org, input.operation, checksum, sessionId), input.source))
  },
  cms_preview_url: async ({ orgId, siteId, pageId, source, blockDrafts, viewport, width, sessionId }) => jsonResult(await agentOperations.preview(resolveOrgId(orgId), siteId, pageId, source, blockDrafts, { viewport, width, sessionId })),
  async cms_site_readiness({ orgId, siteId, sessionId }) {
    const org = resolveOrgId(orgId)
    return jsonResult(await withLocalOverrideChecks(org, await agentOperations.readiness(org, siteId, sessionId)))
  },
  cms_list_pages: async ({ orgId, siteId, sessionId }) => jsonResult(await agentOperations.pages(resolveOrgId(orgId), siteId, sessionId)),
  cms_get_page: async ({ orgId, siteId, pageId, source, includeValues, includeSchema, sessionId }) => jsonResult(await agentOperations.page(resolveOrgId(orgId), siteId, pageId, { source, includeValues, includeSchema, sessionId })),
  cms_list_posts: async ({ orgId, siteId, type, tag, limit, startAfter, sessionId }) => jsonResult(await agentOperations.posts(resolveOrgId(orgId), siteId, { type, tag, limit, startAfter, sessionId })),
  cms_get_post: async ({ orgId, siteId, postId, source, includeValues, includeSchema, sessionId }) => jsonResult(await agentOperations.post(resolveOrgId(orgId), siteId, postId, { source, includeValues, includeSchema, sessionId })),
  cms_block_base: async input => jsonResult(await cmsTools.blockBase(input)),
}

// Names, schemas and descriptions come from the shared definitions, which the
// remote endpoint (cms-agentMcp) also serves.
for (const { name, ...definition } of cmsAgentToolDefinitions({ z, operationTypes: CMS_OPERATION_TYPES, contractKinds: contractKinds() })) {
  if (!handlers[name])
    throw new Error(`No handler for the CMS tool ${name}.`)
  server.registerTool(name, definition, handlers[name])
}

const transport = new StdioServerTransport()
await server.connect(transport)

async function loadConfig() {
  const configSetting = setting('CONFIG')
  if (!configSetting)
    throw new Error('Set EDGE_CMS_MCP_CONFIG to this Hub\'s MCP config file (for Clearwater: tools/mcp/config/clearwater.production.json).')
  const configPath = path.resolve(repoRoot, configSetting)
  const rawConfig = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(rawConfig)
  if (!parsed.projectId && !setting('PROJECT'))
    throw new Error(`${configPath} needs a projectId.`)
  // An emulator config never talks to a real project.
  if (parsed.requireEmulator === true && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
    throw new Error(`${configPath} is for the emulators: set FIRESTORE_EMULATOR_HOST to the local Firestore emulator.`)
  const allowedOrgSetting = setting('ALLOWED_ORG_IDS') || process.env.EDGE_CMS_FIRESTORE_MCP_ALLOWED_ORG_IDS
  const allowedOrganizationIds = allowedOrgSetting
    ? allowedOrgSetting.split(',').map(value => value.trim()).filter(Boolean)
    : (parsed.allowedOrganizationIds || [])
  if (!Array.isArray(allowedOrganizationIds) || allowedOrganizationIds.some(value => typeof value !== 'string' || !value.trim()))
    throw new Error(`${configPath} allowedOrganizationIds must be an array of nonempty organization ids.`)

  return {
    serverName: parsed.serverName || 'edge-cms',
    projectId: setting('PROJECT') || parsed.projectId,
    environment: setting('ENVIRONMENT') || parsed.environment || 'production',
    defaultOrgId: setting('DEFAULT_ORG_ID') || parsed.defaultOrgId || '',
    allowedOrganizationIds,
    agentEndpoint: parsed.agentEndpoint || '',
    agentKeyFile: parsed.agentKeyFile || '',
    agentConnectionFile: parsed.agentConnectionFile || '',
    agentConnectionEndpoint: parsed.agentConnectionEndpoint || '',
    allowedPathPrefixes: parsed.allowedPathPrefixes || ['organizations'],
    collectionAliases: parsed.collectionAliases || {},
    maxSampleLimit: parsed.maxSampleLimit || 25,
    maxFindFieldDocuments: parsed.maxFindFieldDocuments || 500,
    maxCmsResultLimit: parsed.maxCmsResultLimit || 100,
    maxCmsBlockScanDocuments: parsed.maxCmsBlockScanDocuments || 1000,
    maxCmsSiteScanDocuments: parsed.maxCmsSiteScanDocuments || 100,
    maxCmsPageScanDocuments: parsed.maxCmsPageScanDocuments || 500,
    maxCmsUsageResults: parsed.maxCmsUsageResults || 500,
    maxCmsThemeResultLimit: parsed.maxCmsThemeResultLimit || 100,
    maxCmsThemeScanDocuments: parsed.maxCmsThemeScanDocuments || 250,
    maxCmsThemeFontDocuments: parsed.maxCmsThemeFontDocuments || 100,
    cmsWorkspaceRoot: process.env.EDGE_CMS_WORKSPACE_ROOT || process.env.CLEARWATER_CMS_WORKSPACE_ROOT || parsed.cmsWorkspaceRoot || '.tmp/cms-block-workspace',
    cmsRendererRepoPath: process.env.EDGE_CMS_RENDERER_REPO || process.env.CLEARWATER_CMS_RENDERER_REPO || parsed.cmsRendererRepoPath || '../emd-cms-front',
    credentialsFile: parsed.credentialsFile || '',
    redactedFieldNames: parsed.redactedFieldNames || [],
    redactedFieldPatterns: parsed.redactedFieldPatterns || [],
  }
}

function projectId() {
  return setting('PROJECT') || config.projectId
}

function jsonResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function normalizePath(input) {
  return String(input || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

function resolveConfiguredPath(input) {
  const normalizedInput = normalizePath(input)
  const aliases = config.collectionAliases || {}
  const [alias, ...remainingSegments] = normalizedInput.split('/').filter(Boolean)
  const template = aliases[alias]

  if (!template) {
    return normalizedInput
  }

  const orgId = config.defaultOrgId
  if (template.includes('{orgId}') && !orgId) {
    throw new Error(`Path alias ${alias} requires defaultOrgId in config or EDGE_CMS_MCP_DEFAULT_ORG_ID.`)
  }

  return normalizePath([
    template.replaceAll('{orgId}', orgId),
    ...remainingSegments,
  ].join('/'))
}

function assertAllowedPath(firestorePath) {
  if (config.allowedOrganizationIds.length) {
    const [collection, orgId] = firestorePath.split('/')
    if (collection === 'organizations') {
      if (!orgId)
        throw new Error('Organization collection scans are unavailable with an organization allowlist.')
      resolveOrgId(orgId)
    }
  }
  const allowedPrefixes = config.allowedPathPrefixes || []
  const allowed = allowedPrefixes.some((prefix) => {
    const normalizedPrefix = normalizePath(prefix)
    return firestorePath === normalizedPrefix || firestorePath.startsWith(`${normalizedPrefix}/`)
  })

  if (!allowed) {
    throw new Error(`Path is outside allowed Firestore prefixes: ${firestorePath}`)
  }
}

function assertDocumentPath(firestorePath) {
  const segments = firestorePath.split('/').filter(Boolean)
  if (segments.length % 2 !== 0) {
    throw new Error(`Expected a document path with an even number of segments: ${firestorePath}`)
  }
}

function assertCollectionPath(firestorePath) {
  const segments = firestorePath.split('/').filter(Boolean)
  if (segments.length % 2 !== 1) {
    throw new Error(`Expected a collection path with an odd number of segments: ${firestorePath}`)
  }
}

function boundedLimit(requestedLimit, configuredLimit) {
  const fallback = Number(configuredLimit) || 25
  const requested = Number(requestedLimit) || fallback
  return Math.max(1, Math.min(requested, fallback))
}

function sanitizeValue(value, key = '') {
  if (shouldRedact(key)) {
    return '[REDACTED]'
  }

  if (value === null || value === undefined) {
    return value
  }

  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString()
  }

  if (value instanceof admin.firestore.GeoPoint) {
    return {
      latitude: value.latitude,
      longitude: value.longitude,
    }
  }

  if (value instanceof admin.firestore.DocumentReference) {
    return {
      __type: 'DocumentReference',
      path: value.path,
    }
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item))
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey),
      ]),
    )
  }

  return value
}

function shouldRedact(key) {
  if (!key) {
    return false
  }

  const normalizedKey = key.toLowerCase()
  return redactedFieldNames.has(normalizedKey)
    || redactionPatterns.some(pattern => pattern.test(normalizedKey))
}

function inferSchema(documents) {
  const fields = new Map()

  documents.forEach((document) => {
    flattenDocument(document).forEach(({ path: fieldPath, value }) => {
      const existing = fields.get(fieldPath) || {
        path: fieldPath,
        presence: 0,
        types: new Set(),
        examples: [],
      }

      existing.presence += 1
      existing.types.add(describeType(value))

      if (existing.examples.length < 3 && !shouldRedact(fieldPath.split('.').at(-1))) {
        existing.examples.push(sanitizeValue(value))
      }

      fields.set(fieldPath, existing)
    })
  })

  return Object.fromEntries(
    [...fields.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldPath, field]) => [
        fieldPath,
        {
          presence: field.presence,
          types: [...field.types].sort(),
          examples: field.examples,
        },
      ]),
  )
}

function flattenDocument(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isSpecialFirestoreValue(value)) {
    return prefix ? [{ path: prefix, value }] : []
  }

  const entries = []
  for (const [key, childValue] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key
    entries.push({ path: childPath, value: childValue })

    if (childValue && typeof childValue === 'object' && !Array.isArray(childValue) && !isSpecialFirestoreValue(childValue)) {
      entries.push(...flattenDocument(childValue, childPath))
    }
  }

  return entries
}

function isSpecialFirestoreValue(value) {
  return value instanceof admin.firestore.Timestamp
    || value instanceof admin.firestore.GeoPoint
    || value instanceof admin.firestore.DocumentReference
}

function describeType(value) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    const childTypes = new Set(value.map(item => describeType(item)))
    return `array<${[...childTypes].sort().join('|') || 'empty'}>`
  }

  if (value instanceof admin.firestore.Timestamp) {
    return 'timestamp'
  }

  if (value instanceof admin.firestore.GeoPoint) {
    return 'geopoint'
  }

  if (value instanceof admin.firestore.DocumentReference) {
    return 'document-reference'
  }

  return typeof value
}

function compareSchemas(expectedSchema, currentSchema) {
  const expectedFields = new Set(Object.keys(expectedSchema || {}))
  const currentFields = new Set(Object.keys(currentSchema || {}))
  const missingFields = [...expectedFields].filter(field => !currentFields.has(field)).sort()
  const addedFields = [...currentFields].filter(field => !expectedFields.has(field)).sort()
  const changedTypes = []

  for (const field of expectedFields) {
    if (!currentFields.has(field)) {
      continue
    }

    const expectedTypes = normalizeTypeList(expectedSchema[field])
    const currentTypes = normalizeTypeList(currentSchema[field])

    if (expectedTypes.join('|') !== currentTypes.join('|')) {
      changedTypes.push({
        field,
        expectedTypes,
        currentTypes,
      })
    }
  }

  return {
    missingFields,
    addedFields,
    changedTypes,
  }
}

function normalizeTypeList(schemaField) {
  if (Array.isArray(schemaField)) {
    return schemaField.map(String).sort()
  }

  if (Array.isArray(schemaField?.types)) {
    return schemaField.types.map(String).sort()
  }

  if (schemaField?.type) {
    return [String(schemaField.type)]
  }

  return [describeType(schemaField)]
}

function hasFieldPath(value, fieldPath) {
  const segments = fieldPath.split('.').filter(Boolean)
  let cursor = value

  for (const segment of segments) {
    if (Array.isArray(cursor) && /^\d+$/.test(segment)) {
      cursor = cursor[Number(segment)]
    }
    else if (cursor && typeof cursor === 'object' && Object.hasOwn(cursor, segment)) {
      cursor = cursor[segment]
    }
    else {
      return false
    }
  }

  return cursor !== undefined
}
