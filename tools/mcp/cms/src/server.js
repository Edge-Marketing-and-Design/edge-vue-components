#!/usr/bin/env node

import './node-version.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import admin from 'firebase-admin'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { blockDefinitionHash } from '../../../../lib/cmsBlockRevisions.js'
import { CMS_OPERATION_TYPES } from '../../../../lib/cmsOperations.js'
import { agentEndpoint, createAgentOperationClient, resolveAgentKey } from './agent-operations.js'
import { createCmsToolService } from './cms-tools.js'
import { describeCredentials, resolveCredentials } from './credentials.js'

// Shared Edge code: this server lives in <hub>/edge/tools/mcp/cms/src and
// serves the Hub it is checked out in. Each Hub keeps its own config (for
// Clearwater, tools/mcp/config/clearwater.production.json), named by
// EDGE_CMS_MCP_CONFIG. Every EDGE_CMS_MCP_* setting also accepts its older
// CLEARWATER_FIRESTORE_MCP_* name.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = process.env.EDGE_CMS_HUB_ROOT || path.resolve(__dirname, '../../../../..')
const setting = name => process.env[`EDGE_CMS_MCP_${name}`] || process.env[`CLEARWATER_FIRESTORE_MCP_${name}`] || ''

const PathSchema = z.string().trim().min(1)
const OptionalDocPathSchema = z.string().trim().optional().default('')
const LimitSchema = z.number().int().positive().max(100).optional()
const OptionalOrgIdSchema = z.string().trim().optional().default('')
const CmsDocIdSchema = z.string().trim().min(1).describe('Exact CMS library block Firestore document id.')
const CmsThemeIdSchema = z.string().trim().min(1).describe('Exact CMS theme Firestore document id.')
const OptionalCmsSearchSchema = z.string().trim().optional().default('')

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

const agentOperations = createAgentOperationClient({
  endpoint: agentEndpoint({ config }),
  getKey: () => resolveAgentKey({ config }),
})

const server = new McpServer({
  name: config.serverName,
  version: '0.5.0',
})

server.registerTool(
  'firestore_list_collections',
  {
    title: 'List Firestore Collections',
    description: 'List child collections at the Firestore root or below a document path.',
    inputSchema: {
      documentPath: OptionalDocPathSchema.describe('Optional document path. Empty string lists root collections.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ documentPath }) => {
    const normalizedPath = resolveConfiguredPath(documentPath)
    if (normalizedPath) {
      assertAllowedPath(normalizedPath)
      assertDocumentPath(normalizedPath)
    }

    const collections = normalizedPath
      ? await db.doc(normalizedPath).listCollections()
      : await db.listCollections()

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      parentPath: normalizedPath || '/',
      collections: collections.map(collection => ({
        id: collection.id,
        path: collection.path,
      })),
    })
  },
)

server.registerTool(
  'firestore_get_document',
  {
    title: 'Get Firestore Document',
    description: 'Read one Firestore document by document path.',
    inputSchema: {
      documentPath: PathSchema.describe('Document path with an even number of path segments.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ documentPath }) => {
    const normalizedPath = resolveConfiguredPath(documentPath)
    assertAllowedPath(normalizedPath)
    assertDocumentPath(normalizedPath)

    const snapshot = await db.doc(normalizedPath).get()

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      path: normalizedPath,
      exists: snapshot.exists,
      data: snapshot.exists ? sanitizeValue(snapshot.data()) : null,
    })
  },
)

server.registerTool(
  'firestore_sample_collection',
  {
    title: 'Sample Firestore Collection',
    description: 'Read a limited sample of documents from a collection path.',
    inputSchema: {
      collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
      limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ collectionPath, limit }) => {
    const normalizedPath = resolveConfiguredPath(collectionPath)
    assertAllowedPath(normalizedPath)
    assertCollectionPath(normalizedPath)

    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      collectionPath: normalizedPath,
      limit: effectiveLimit,
      count: snapshot.size,
      documents: snapshot.docs.map(doc => ({
        id: doc.id,
        path: doc.ref.path,
        data: sanitizeValue(doc.data()),
      })),
    })
  },
)

server.registerTool(
  'firestore_infer_schema',
  {
    title: 'Infer Firestore Collection Schema',
    description: 'Infer field presence and value types from sampled documents in a collection.',
    inputSchema: {
      collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
      limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ collectionPath, limit }) => {
    const normalizedPath = resolveConfiguredPath(collectionPath)
    assertAllowedPath(normalizedPath)
    assertCollectionPath(normalizedPath)

    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    const schema = inferSchema(snapshot.docs.map(doc => doc.data()))

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      collectionPath: normalizedPath,
      sampledDocuments: snapshot.size,
      schema,
    })
  },
)

server.registerTool(
  'firestore_compare_schema',
  {
    title: 'Compare Firestore Collection Schema',
    description: 'Compare inferred production schema to a saved schema JSON object.',
    inputSchema: {
      collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
      expectedSchema: z.record(z.any()).describe('Saved schema object to compare against.'),
      limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ collectionPath, expectedSchema, limit }) => {
    const normalizedPath = resolveConfiguredPath(collectionPath)
    assertAllowedPath(normalizedPath)
    assertCollectionPath(normalizedPath)

    const effectiveLimit = boundedLimit(limit, config.maxSampleLimit)
    const snapshot = await db.collection(normalizedPath).limit(effectiveLimit).get()
    const currentSchema = inferSchema(snapshot.docs.map(doc => doc.data()))

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      collectionPath: normalizedPath,
      sampledDocuments: snapshot.size,
      comparison: compareSchemas(expectedSchema, currentSchema),
      currentSchema,
    })
  },
)

server.registerTool(
  'firestore_find_field',
  {
    title: 'Find Firestore Field',
    description: 'Scan a bounded sample of collection documents for documents containing or missing a dot-path field.',
    inputSchema: {
      collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
      fieldPath: PathSchema.describe('Dot path to inspect, for example photos.0.url or media.images.'),
      mode: z.enum(['exists', 'missing']).optional().default('exists'),
      limit: LimitSchema.describe('Maximum document count. Capped by config maxFindFieldDocuments.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ collectionPath, fieldPath, mode, limit }) => {
    const normalizedPath = resolveConfiguredPath(collectionPath)
    assertAllowedPath(normalizedPath)
    assertCollectionPath(normalizedPath)

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

    return jsonResult({
      projectId: projectId(),
      environment: config.environment,
      productionRead: config.environment === 'production',
      credentials: credentialSummary,
      collectionPath: normalizedPath,
      fieldPath,
      mode,
      scannedDocuments: snapshot.size,
      matchedDocuments: matches.length,
      matches,
    })
  },
)

server.registerTool(
  'cms_find_block',
  {
    title: 'Find Production CMS Blocks',
    description: 'Find exact or metadata-matching CMS library blocks in an organization. This performs bounded, read-only production Firestore reads.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: OptionalCmsSearchSchema.describe('Optional exact block document id. Prefer this whenever known.'),
      query: OptionalCmsSearchSchema.describe('Case-insensitive substring across docId, name, tags, types, and themes.'),
      exactName: OptionalCmsSearchSchema.describe('Optional case-sensitive exact block name.'),
      tag: OptionalCmsSearchSchema.describe('Optional exact tag.'),
      type: OptionalCmsSearchSchema.describe('Optional exact block type such as Page or Post.'),
      theme: OptionalCmsSearchSchema.describe('Optional exact allowed-theme document id.'),
      limit: LimitSchema.describe('Maximum matches returned.'),
      startAfter: OptionalCmsSearchSchema.describe('Return matches after this block document id. Pass the previous response\'s nextStartAfter to page through results.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.findBlock(input)),
)

server.registerTool(
  'cms_audit_blocks',
  {
    title: 'Audit Production CMS Blocks',
    description: 'Validate every production CMS library block in an organization with the Hub\'s shared block validator, using Hub import settings (required keys, organization themes, render checks with empty and sample Data Source records, renderer ownership). Reads production only; writes the full per-block report to a local file and returns a summary by rule.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name used for override diagnostics.'),
      includeRender: z.boolean().optional().default(true).describe('Run render checks. Defaults to true.'),
      listLimit: LimitSchema.describe('Maximum blocks with errors listed in the response. The report file lists all.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async input => jsonResult(await cmsTools.auditBlocks(input)),
)

server.registerTool(
  'cms_checkout_block',
  {
    title: 'Check Out Production CMS Block',
    description: 'Read an exact production CMS block and write a guarded local workspace containing block.json, base.json, and checkout.json. Refuses to overwrite local changes.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
      themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name used for override diagnostics.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async input => jsonResult(await cmsTools.checkoutBlock(input)),
)

server.registerTool(
  'cms_status',
  {
    title: 'Get CMS Block Workspace Status',
    description: 'Compare a local CMS checkout with its immutable base and the current production block.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.status(input)),
)

server.registerTool(
  'cms_diff',
  {
    title: 'Diff CMS Block Workspace States',
    description: 'Return structured differences between local, checkout-base, and current production CMS block documents.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
      comparison: z.enum(['base-local', 'base-production', 'local-production']).optional().default('local-production'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.diff(input)),
)

server.registerTool(
  'cms_resolve_override',
  {
    title: 'Resolve CMS Public Frontend Override',
    description: 'Mirror the current renderer name-resolution rules and report the exact local emd-cms-front Vue override candidate, ambiguity, or CMS HTML fallback.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: OptionalCmsSearchSchema.describe('Optional exact production CMS block id used to load its current name.'),
      blockName: OptionalCmsSearchSchema.describe('Block name to resolve when docId is omitted.'),
      themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.resolveOverride(input)),
)

server.registerTool(
  'cms_find_usage',
  {
    title: 'Find CMS Block Usage',
    description: 'Find persisted blockId references to a CMS library block in bounded organization page and template scans.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
      siteId: OptionalCmsSearchSchema.describe('Optional exact site id. Omit to scan bounded organization sites and templates.'),
      limit: LimitSchema.describe('Maximum usage records returned.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.findUsage(input)),
)

server.registerTool(
  'cms_validate',
  {
    title: 'Validate CMS Block',
    description: 'Validate a checked-out local or current production CMS block with the Hub\'s shared block validator: Template v2 structure, schema and grammar, render checks with empty and sample Data Source records, and public renderer ownership. Returns string errors/warnings/info plus structured issues.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
      source: z.enum(['local', 'production']).optional().default('local'),
      themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.validate(input)),
)

server.registerTool(
  'cms_find_theme',
  {
    title: 'Find Production CMS Themes',
    description: 'Find production CMS themes by exact document id, visible name, or bounded name/id search.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: OptionalCmsSearchSchema.describe('Optional exact theme document id. Prefer this whenever known.'),
      query: OptionalCmsSearchSchema.describe('Case-insensitive substring across theme document id and visible name.'),
      exactName: OptionalCmsSearchSchema.describe('Optional case-sensitive exact visible theme name.'),
      limit: LimitSchema.describe('Maximum matches returned.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.findTheme(input)),
)

server.registerTool(
  'cms_get_theme',
  {
    title: 'Get Production CMS Theme Context',
    description: 'Read one exact production CMS theme and return Theme JSON, Head JSON, Custom Fonts, Extra CSS, default template settings, and revision metadata.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      themeId: CmsThemeIdSchema,
      includeCustomFonts: z.boolean().optional().default(true).describe('Include production custom-font file metadata linked to this theme.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async input => jsonResult(await cmsTools.getTheme(input)),
)

const OperationSchema = z.object({ type: z.enum(CMS_OPERATION_TYPES) }).passthrough()
  .describe('A CMS operation, e.g. { "type": "page.placeBlock", "siteId": "...", "pageId": "...", "blockId": "...", "values": { ... } }. See docs/data-contracts/cms-operations/README.md for every type and its fields.')

const resolveOrgId = orgId => orgId || config.defaultOrgId

server.registerTool(
  'cms_check_operation',
  {
    title: 'Check a CMS Operation',
    description: 'Plan a draft-only CMS operation through the Hub (themes, new sites, draft pages, block placement and content, new blocks, block drafts) and return what would change, any problems, and a checksum for cms_run_operation. Writes nothing. Nothing can publish a page or release a block. Needs an agent key (Dev Mode > Agent Keys).',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      operation: OperationSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orgId, operation }) => jsonResult(await agentOperations.check(resolveOrgId(orgId), operation)),
)

server.registerTool(
  'cms_run_operation',
  {
    title: 'Run a CMS Operation',
    description: 'Run a draft-only CMS operation that cms_check_operation checked, with its checksum. The Hub refuses it if anything the check read has changed since, or if it has problems. Changes are drafts: pages are not published and blocks are not released. Every run is recorded in the organization\'s cmsOperations audit.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      operation: OperationSchema,
      checksum: z.string().trim().min(1).describe('The checksum cms_check_operation returned for this exact operation.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ orgId, operation, checksum }) => jsonResult(await agentOperations.run(resolveOrgId(orgId), operation, checksum)),
)

server.registerTool(
  'cms_preview_url',
  {
    title: 'Get a CMS Page Preview Link',
    description: 'Get a short-lived link (15 minutes) to the Hub\'s preview of one draft page (or its published copy), rendered with the Hub\'s own block renderer and the site\'s theme. Open it in a browser and screenshot it to compare what you built with the design. Vue override components are not shown (they render only on the public site). Needs an agent key.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      siteId: z.string().trim().min(1).describe('Site document id.'),
      pageId: z.string().trim().min(1).describe('Page document id.'),
      source: z.enum(['draft', 'published']).optional().default('draft'),
      blockDrafts: z.boolean().optional().default(true).describe('Render blocks with their unreleased drafts (block.draft), so you can check a fix before a developer releases it. Draft pages only. False shows what the released blocks look like. The Hub page editor shows released blocks until a developer releases the drafts.'),
      viewport: z.enum(['mobile', 'medium', 'large']).optional().describe('Render at a phone (420px), tablet (992px) or large (1280px) canvas and simulate its breakpoints, as the page editor does, in any browser window. Use mobile to check the phone layout.'),
      width: z.number().int().min(320).max(2560).optional().describe('Page width in pixels without breakpoint simulation (breakpoints follow the browser window). Ignored when viewport is set.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ orgId, siteId, pageId, source, blockDrafts, viewport, width }) => jsonResult(await agentOperations.preview(resolveOrgId(orgId), siteId, pageId, source, blockDrafts, { viewport, width })),
)

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

server.registerTool(
  'cms_site_readiness',
  {
    title: 'Check a Site Is Ready',
    description: 'List what stops a site from being finished: failed block checks, invalid or empty required block content, blocks missing from the library, override blocks that need a Vue component (with whether the local emd-cms-front checkout has it), unreleased block drafts, pages behind the released block, empty pages, and pages never published or with unpublished changes. Reads only. Needs an agent key.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      siteId: z.string().trim().min(1).describe('Site document id.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orgId, siteId }) => {
    const org = resolveOrgId(orgId)
    return jsonResult(await withLocalOverrideChecks(org, await agentOperations.readiness(org, siteId)))
  },
)

server.registerTool(
  'cms_block_base',
  {
    title: 'Get a CMS Block\'s Base',
    description: 'Read a library block\'s current definition (its open draft if there is one, otherwise the released definition) and its fingerprint. A block.draft operation must send this fingerprint as baseHash, so it never overwrites changes made in the Hub since.',
    inputSchema: {
      orgId: OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'),
      docId: CmsDocIdSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orgId, docId }) => {
    const org = resolveOrgId(orgId)
    const blockRef = db.collection('organizations').doc(org).collection('blocks').doc(docId)
    const blockSnap = await blockRef.get()
    if (!blockSnap.exists)
      return jsonResult({ ok: false, message: `Block "${docId}" does not exist in ${org}.` })
    const block = blockSnap.data() || {}
    let draft = null
    if (Number.isInteger(block.draftRevision)) {
      const draftSnap = await blockRef.collection('revisions').doc(String(block.draftRevision)).get()
      if (draftSnap.exists && draftSnap.data()?.status === 'draft')
        draft = draftSnap.data()
    }
    const definition = draft ? draft.definition : block
    return jsonResult({
      ok: true,
      docId,
      releasedRevision: Number.isInteger(block.releasedRevision) ? block.releasedRevision : 0,
      draftRevision: draft ? block.draftRevision : null,
      startsFrom: draft ? 'draft' : 'released',
      baseHash: blockDefinitionHash(definition),
      definition: sanitizeValue(Object.fromEntries(['content', 'template', 'templateVersion', 'schema', 'dataSources', 'isOverrideBlock', 'meta', 'values'].filter(key => definition?.[key] !== undefined).map(key => [key, definition[key]]))),
    })
  },
)

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

  return {
    serverName: parsed.serverName || 'edge-cms',
    projectId: setting('PROJECT') || parsed.projectId,
    environment: setting('ENVIRONMENT') || parsed.environment || 'production',
    defaultOrgId: setting('DEFAULT_ORG_ID') || parsed.defaultOrgId || '',
    agentEndpoint: parsed.agentEndpoint || '',
    agentKeyFile: parsed.agentKeyFile || '',
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
