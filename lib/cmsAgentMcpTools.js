// CMS MCP tool definitions: names, titles, descriptions, input schemas and
// annotations, shared by the local stdio server (edge/tools/mcp/cms) and the
// remote endpoint (cms-agentMcp), so their tool lists cannot drift.
//
// Shared by edge/lib/cmsAgentMcpTools.js, edge/functions/helpers/
// cmsAgentMcpTools.mjs and functions/helpers/cmsAgentMcpTools.mjs. Keep the
// three copies byte-identical; the MCP tests enforce it. Takes zod and the
// operation types as arguments so it imports nothing.

// The tools the remote endpoint serves: the ones that go through the Hub's
// agent endpoints, in the local server's order.
export const CMS_AGENT_REMOTE_TOOL_NAMES = Object.freeze([
  'cms_find_block',
  'cms_audit_blocks',
  'cms_find_usage',
  'cms_find_theme',
  'cms_get_theme',
  'cms_agent_organizations',
  'cms_open_session',
  'cms_check_operation',
  'cms_run_operation',
  'cms_preview_url',
  'cms_site_readiness',
  'cms_list_pages',
  'cms_get_page',
  'cms_list_posts',
  'cms_get_post',
  'cms_block_base',
])

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }

// Every tool, in registration order. `remote: true` returns only the remote
// subset, with the remote server's orgId, sessionId and readiness wording.
export function cmsAgentToolDefinitions({ z, operationTypes, contractKinds = [], remote = false }) {
  const PathSchema = z.string().trim().min(1)
  const OptionalDocPathSchema = z.string().trim().optional().default('')
  const LimitSchema = z.number().int().positive().max(100).optional()
  const OptionalOrgIdSchema = z.string().trim().optional().default('')
  const CmsDocIdSchema = z.string().trim().min(1).describe('Exact CMS library block Firestore document id.')
  const CmsThemeIdSchema = z.string().trim().min(1).describe('Exact CMS theme Firestore document id.')
  const OptionalCmsSearchSchema = z.string().trim().optional().default('')
  const OperationSchema = z.object({ type: z.enum(operationTypes) }).passthrough()
    .describe('A CMS operation, e.g. { "type": "page.placeBlock", "siteId": "...", "pageId": "...", "blockId": "...", "values": { ... } }, { "type": "page.moveBlock", "siteId": "...", "pageId": "...", "instanceId": "...", "index": 0 } or { "type": "post.create", "siteId": "...", "title": "...", "blurb": "...", "templateId?": "..." }. page.create takes optional SEO "fields" like page.update. post.* operations write draft posts only (post.create, post.update with "fields", and post.placeBlock/setValues/moveBlock/removeBlock with "postId"); a post\'s kind is "postType" (post or event), since "type" is the operation. Call cms_contract (kind "operations") first: it returns every type and its fields. Read a page with cms_get_page, or a post with cms_get_post, for its instance ids and row order.')
  // Local only: the remote server cannot read the editor's files.
  const OperationFileSchema = z.string().trim().min(1).optional()
    .describe('Path to a .json file holding the whole operation, instead of `operation`. Use it for large operations (block definitions) written by a script, so they are sent exactly as written. Relative paths start at the Hub checkout; the file must be inside the checkout, the block workspace or the temp directory. Send the same file to cms_run_operation.')
  const operationInput = remote
    ? { operation: OperationSchema }
    : { operation: OperationSchema.optional(), operationFile: OperationFileSchema }
  const SessionIdSchema = remote
    ? z.string().trim().min(1).optional().describe('Optional handle from cms_open_session. Without it the server opens and renews the session for orgId (and the site) itself.')
    : z.string().trim().min(1).optional().describe('Explicit target handle from cms_open_session. Required when using a Hub connection.')
  const orgIdSchema = () => (remote
    ? z.string().trim().optional().describe('Organization id (from cms_agent_organizations). Required unless sessionId is given.')
    : OptionalOrgIdSchema.describe('Organization id. Uses configured defaultOrgId when omitted.'))

  const tools = [
    {
      name: 'firestore_list_collections',
      title: 'List Firestore Collections',
      description: 'List child collections at the Firestore root or below a document path.',
      inputSchema: {
        documentPath: OptionalDocPathSchema.describe('Optional document path. Empty string lists root collections.'),
      },
      annotations: READ,
    },
    {
      name: 'firestore_get_document',
      title: 'Get Firestore Document',
      description: 'Read one Firestore document by document path.',
      inputSchema: {
        documentPath: PathSchema.describe('Document path with an even number of path segments.'),
      },
      annotations: READ,
    },
    {
      name: 'firestore_sample_collection',
      title: 'Sample Firestore Collection',
      description: 'Read a limited sample of documents from a collection path.',
      inputSchema: {
        collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
        limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
      },
      annotations: READ,
    },
    {
      name: 'firestore_infer_schema',
      title: 'Infer Firestore Collection Schema',
      description: 'Infer field presence and value types from sampled documents in a collection.',
      inputSchema: {
        collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
        limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
      },
      annotations: READ,
    },
    {
      name: 'firestore_compare_schema',
      title: 'Compare Firestore Collection Schema',
      description: 'Compare inferred production schema to a saved schema JSON object.',
      inputSchema: {
        collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
        expectedSchema: z.record(z.any()).describe('Saved schema object to compare against.'),
        limit: LimitSchema.describe('Maximum document count. Capped by config maxSampleLimit.'),
      },
      annotations: READ,
    },
    {
      name: 'firestore_find_field',
      title: 'Find Firestore Field',
      description: 'Scan a bounded sample of collection documents for documents containing or missing a dot-path field.',
      inputSchema: {
        collectionPath: PathSchema.describe('Collection path with an odd number of path segments.'),
        fieldPath: PathSchema.describe('Dot path to inspect, for example photos.0.url or media.images.'),
        mode: z.enum(['exists', 'missing']).optional().default('exists'),
        limit: LimitSchema.describe('Maximum document count. Capped by config maxFindFieldDocuments.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_find_block',
      title: 'Find Production CMS Blocks',
      description: 'Find exact or metadata-matching CMS library blocks in an organization. This performs bounded, read-only production Firestore reads.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe('Optional exact block document id. Prefer this whenever known.'),
        query: OptionalCmsSearchSchema.describe('Case-insensitive substring across docId, name, tags, types, and themes.'),
        exactName: OptionalCmsSearchSchema.describe('Optional case-sensitive exact block name.'),
        tag: OptionalCmsSearchSchema.describe('Optional exact tag.'),
        type: OptionalCmsSearchSchema.describe('Optional exact block type such as Page or Post.'),
        theme: OptionalCmsSearchSchema.describe('Optional exact allowed-theme document id.'),
        limit: LimitSchema.describe('Maximum matches returned.'),
        startAfter: OptionalCmsSearchSchema.describe('Return matches after this block document id. Pass the previous response\'s nextStartAfter to page through results.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_audit_blocks',
      title: 'Audit Production CMS Blocks',
      description: remote
        ? 'Validate every CMS library block in an organization with the Hub\'s shared block validator, using Hub import settings (required keys, organization themes, the organization\'s block tag list, render checks with empty and sample Data Source records). Returns a summary by rule and the blocks with errors, with their findings (up to listLimit blocks). Public Vue overrides are not checked remotely. Reads only.'
        : 'Validate every production CMS library block in an organization with the Hub\'s shared block validator, using Hub import settings (required keys, organization themes, the organization\'s block tag list, render checks with empty and sample Data Source records, renderer ownership). Reads production only; writes the full per-block report to a local file and returns a summary by rule.',
      inputSchema: {
        orgId: orgIdSchema(),
        // Local only: override diagnostics need the emd-cms-front checkout.
        ...(remote ? {} : { themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name used for override diagnostics.') }),
        includeRender: z.boolean().optional().default(true).describe('Run render checks. Defaults to true.'),
        listLimit: LimitSchema.describe(remote ? 'Maximum blocks with errors listed in the response.' : 'Maximum blocks with errors listed in the response. The report file lists all.'),
      },
      // Locally the audit writes its report file; remotely it only reads.
      annotations: remote ? READ : { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cms_checkout_block',
      title: 'Check Out Production CMS Block',
      description: 'Read an exact production CMS block and write a guarded local workspace containing block.json, base.json, and checkout.json. Refuses to overwrite local changes.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
        themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name used for override diagnostics.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cms_status',
      title: 'Get CMS Block Workspace Status',
      description: 'Compare a local CMS checkout with its immutable base and the current production block.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
      },
      annotations: READ,
    },
    {
      name: 'cms_diff',
      title: 'Diff CMS Block Workspace States',
      description: 'Return structured differences between local, checkout-base, and current production CMS block documents.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
        comparison: z.enum(['base-local', 'base-production', 'local-production']).optional().default('local-production'),
      },
      annotations: READ,
    },
    {
      name: 'cms_resolve_override',
      title: 'Resolve CMS Public Frontend Override',
      description: 'Mirror the current renderer name-resolution rules and report the exact local emd-cms-front Vue override candidate, ambiguity, or CMS HTML fallback.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe('Optional exact production CMS block id used to load its current name.'),
        blockName: OptionalCmsSearchSchema.describe('Block name to resolve when docId is omitted.'),
        themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_find_usage',
      title: 'Find CMS Block Usage',
      description: 'Find persisted blockId references to a CMS library block in bounded scans of the organization\'s pages, templates and posts (each site\'s draft posts and published snapshots). Each usage has kind "page" (siteId, pageId, pageName, pageType) or "post" (siteId, postId, title, slug, source draft or published), with its instanceId and fieldPath. scanned lists every collection read; scanTruncated marks one with more documents than were read.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
        siteId: OptionalCmsSearchSchema.describe('Optional exact site id. Omit to scan bounded organization sites and templates.'),
        limit: LimitSchema.describe('Maximum usage records returned.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_validate',
      title: 'Validate CMS Block',
      description: 'Validate a checked-out local or current production CMS block with the Hub\'s shared block validator: Template v2 structure, schema and grammar, render checks with empty and sample Data Source records, and public renderer ownership. Returns string errors/warnings/info plus structured issues.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
        source: z.enum(['local', 'production']).optional().default('local'),
        themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_find_theme',
      title: 'Find Production CMS Themes',
      description: 'Find production CMS themes by exact document id, visible name, or bounded name/id search.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe('Optional exact theme document id. Prefer this whenever known.'),
        query: OptionalCmsSearchSchema.describe('Case-insensitive substring across theme document id and visible name.'),
        exactName: OptionalCmsSearchSchema.describe('Optional case-sensitive exact visible theme name.'),
        limit: LimitSchema.describe('Maximum matches returned.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_get_theme',
      title: 'Get Production CMS Theme Context',
      description: 'Read one exact production CMS theme and return Theme JSON, Head JSON, Custom Fonts, Extra CSS, default template settings, and revision metadata.',
      inputSchema: {
        orgId: orgIdSchema(),
        themeId: CmsThemeIdSchema,
        includeCustomFonts: z.boolean().optional().default(true).describe('Include production custom-font file metadata linked to this theme.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_contract',
      title: 'Read a CMS Data Contract',
      description: `Read one of the Hub's data contracts as Markdown, from the checkout this server runs in: the fields, storage paths, public projection, consumers and invariants an agent writes against. Call it for every kind the task will write before building (${contractKinds.join(', ')}), and name the contract lines each field follows in the handoff. Reads a file only: no network, no Firestore. An unknown kind lists the known ones.`,
      inputSchema: {
        kind: z.string().trim().min(1).describe(`Which contract: ${contractKinds.join(', ')}.`),
      },
      annotations: READ,
    },
    {
      name: 'cms_agent_organizations',
      title: 'Discover Agent Organizations',
      description: 'List organizations currently editable through your Hub-issued connection. Refreshes Hub permissions; no local org/key list. Paginate with nextStartAfter.',
      inputSchema: { startAfter: z.string().trim().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    {
      name: 'cms_open_session',
      title: 'Open a Targeted CMS Session',
      description: remote
        ? 'Optional. Check that your connection can work on an explicit org and scope, and get a sessionId handle for it. Site scope requires an exact site id and permits only page and post work/site updates there. Organization scope permits library/theme work and site creation. Returns a sessionId, never a credential. Other tools work without it: pass orgId (and siteId) and the server opens and renews the session itself.'
        : 'Choose an explicit org and scope for this job. Site scope requires an exact site id and permits only page and post work/site updates there. Organization scope permits library/theme work and site creation. Returns a sessionId, never a credential. Pass that handle to check/run/preview/readiness and the page and post reads (cms_list_pages, cms_get_page, cms_list_posts, cms_get_post); it refreshes automatically for the same target.',
      inputSchema: { orgId: z.string().trim().min(1), scope: z.enum(['organization', 'site']), siteId: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cms_check_operation',
      title: 'Check a CMS Operation',
      description: 'Plan a draft-only CMS operation through the Hub (themes, new sites and their SEO, draft pages and their SEO, draft posts and their fields, block placement, order and content on pages and posts, new blocks, block drafts) and return what would change, any problems, and a checksum for cms_run_operation. Call cms_contract first for the operations contract and for every kind the operation writes (blocks, themes, posts), and build the operation from those fields. Writes nothing. Nothing can publish a page or post or release a block. Needs an agent key (Dev Mode > Agent Keys).',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        ...operationInput,
      },
      annotations: READ,
    },
    {
      name: 'cms_run_operation',
      title: 'Run a CMS Operation',
      description: 'Run a draft-only CMS operation that cms_check_operation checked, with its checksum. The Hub refuses it if anything the check read has changed since, or if it has problems. Changes are drafts: pages and posts are not published and blocks are not released. Every run is recorded in the organization\'s cmsOperations audit.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        ...operationInput,
        checksum: z.string().trim().min(1).describe('The checksum cms_check_operation returned for this exact operation.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cms_preview_url',
      title: 'Get a CMS Page Preview Link',
      description: 'Get a short-lived link (15 minutes) to the Hub\'s preview of one draft page (or its published copy), rendered with the Hub\'s own block renderer and the site\'s theme. Open it in a browser and screenshot it to compare what you built with the design. Vue override components are not shown (they render only on the public site). Needs an agent key.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
        pageId: z.string().trim().min(1).describe('Page document id.'),
        source: z.enum(['draft', 'published']).optional().default('draft'),
        blockDrafts: z.boolean().optional().default(true).describe('Render blocks with their unreleased drafts (block.draft), so you can check a fix before a developer releases it. Draft pages only. False shows what the released blocks look like. The Hub page editor shows released blocks until a developer releases the drafts.'),
        viewport: z.enum(['mobile', 'medium', 'large']).optional().describe('Render at a phone (420px), tablet (992px) or large (1280px) canvas and simulate its breakpoints, as the page editor does, in any browser window. Use mobile to check the phone layout.'),
        width: z.number().int().min(320).max(2560).optional().describe('Page width in pixels without breakpoint simulation (breakpoints follow the browser window). Ignored when viewport is set.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cms_site_readiness',
      title: 'Check a Site Is Ready',
      description: remote
        ? 'List what stops a site from being finished: failed block checks, invalid or empty required block content, blocks missing from the library, override blocks that need a Vue component, unreleased block drafts, pages behind the released block, empty pages, and pages never published or with unpublished changes. Reads only.'
        : 'List what stops a site from being finished: failed block checks, invalid or empty required block content, blocks missing from the library, override blocks that need a Vue component (with whether the local emd-cms-front checkout has it), unreleased block drafts, pages behind the released block, empty pages, and pages never published or with unpublished changes. Reads only. Needs an agent key.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_list_pages',
      title: 'List a Site\'s Pages',
      description: 'List a site\'s menus as a tree (Site Root, other menus, Not In Menu; folders and external links included) with each page\'s pageId, slug, menu title, URL path and status: draft (never published), published, or unpublished-changes. Pages in no menu are listed under unlisted. Reads only. Needs an agent key or a site session.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_get_page',
      title: 'Read a CMS Page',
      description: 'Read one page as an outline instead of the raw document: its SEO fields (and the post* fields when it has a post view), structuredDataAiLocked (true: its custom structured data is left to the Hub, and page.update refuses structuredData), version and status, then per area (main, and post when present) its rows in order, each with its column spans and the instances in each column: instanceId, blockId, name, synced and override flags, whether it is behind the released block, and its values. Use the instance ids and row indexes with page.setValues, page.moveBlock and page.removeBlock. Schemas are left out unless includeSchema is true (cms_find_block and cms_block_base have them). Reads only. Needs an agent key or a site session.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
        pageId: z.string().trim().min(1).describe('Page document id (from cms_list_pages).'),
        source: z.enum(['draft', 'published']).optional().default('draft'),
        includeValues: z.boolean().optional().default(true).describe('Include each instance\'s values.'),
        includeSchema: z.boolean().optional().default(false).describe('Include each instance\'s schema (large).'),
      },
      annotations: READ,
    },
    {
      name: 'cms_list_posts',
      title: 'List a Site\'s Posts',
      description: 'List a site\'s posts and events, newest first: each post\'s postId, name (its slug), title, type (post or event), tags, publishedAt, publishAt (a scheduled publication), status (draft: never published; published; unpublished-changes: the saved draft differs from what is live, compared as the Hub compares it; missing: published with no draft) and the library blockIds it uses. Filter by type or tag; page with startAfter (the last postId of the previous page, from nextStartAfter). Reads only. Needs an agent key or a site session.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
        type: z.enum(['post', 'event']).optional().describe('Only posts or only events.'),
        tag: z.string().trim().min(1).optional().describe('Only posts with this exact tag.'),
        limit: z.number().int().min(1).max(100).optional().describe('Posts per page (default 50).'),
        startAfter: z.string().trim().min(1).optional().describe('nextStartAfter from the previous page.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_get_post',
      title: 'Read a CMS Post',
      description: 'Read one post as its fields and an outline instead of the raw document: name (slug), the URL paths the site\'s post template pages serve it at (paths), status, type, title, blurb, tags, featuredImage, restrictionRuleId, the event for events, publishedAt, publishAt, hidePublishedDate and whether it was imported (imported: its legacyBlog audit fields are never changed), then its body as rows in order with column spans and the instances in each column: instanceId, blockId, name, synced and override flags, whether it is behind the released block, and its values. Use the instance ids and row indexes with post.setValues, post.moveBlock and post.removeBlock. Schemas are left out unless includeSchema is true. Reads only. Needs an agent key or a site session.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
        postId: z.string().trim().min(1).describe('Post document id (from cms_list_posts).'),
        source: z.enum(['draft', 'published']).optional().default('draft'),
        includeValues: z.boolean().optional().default(true).describe('Include each instance\'s values.'),
        includeSchema: z.boolean().optional().default(false).describe('Include each instance\'s schema (large).'),
      },
      annotations: READ,
    },
    {
      name: 'cms_block_base',
      title: 'Get a CMS Block\'s Base',
      description: 'Read a library block\'s current definition (its open draft if there is one, otherwise the released definition) and its fingerprint. A block.draft operation must send this fingerprint as baseHash, so it never overwrites changes made in the Hub since.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
      },
      annotations: READ,
    },
  ]
  return remote ? tools.filter(tool => CMS_AGENT_REMOTE_TOOL_NAMES.includes(tool.name)) : tools
}
