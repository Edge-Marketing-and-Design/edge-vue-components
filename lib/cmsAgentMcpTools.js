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
  'cms_diff',
  'cms_resolve_override',
  'cms_find_usage',
  'cms_validate',
  'cms_render_block',
  'cms_find_theme',
  'cms_get_theme',
  'cms_contract',
  'cms_schema',
  'cms_guide',
  'cms_agent_organizations',
  'cms_list_sites',
  'cms_open_session',
  'cms_check_operation',
  'cms_run_operation',
  'cms_upload_media',
  'cms_find_media',
  'cms_preview_url',
  'cms_site_readiness',
  'cms_list_pages',
  'cms_get_page',
  'cms_list_posts',
  'cms_get_post',
  'cms_block_base',
])

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }

// The essential rules, sent to every client in the MCP initialize response.
// cms_guide serves the full workflow.
export const CMS_AGENT_INSTRUCTIONS = [
  'Edge CMS tools for one Hub. Everything you change is a draft: no tool publishes a page or post, releases a block, or changes a live theme; people do that in the Hub.',
  'Start with cms_agent_organizations, then pass that orgId to every tool (and siteId, from cms_list_sites, for page and post work). Sessions are handled for you.',
  'Read cms_guide for the workflow, and cms_contract (kind "operations", plus the kind you write) before building an operation.',
  'Change things with cms_check_operation, then cms_run_operation with the same operation and the returned checksum.',
  'For a block draft, take baseHash from cms_block_base and check the definition with cms_validate first.',
  'Images go into the Hub with cms_upload_media (look first with cms_find_media); place only Hub media URLs, never links to another site.',
  'Every call runs with your own Hub rights and is recorded.',
].join(' ')

// One section of the agent guide by its ## heading (case-insensitive), or the
// whole guide. An unknown section lists the known ones.
export function selectGuideSection(markdown, section = '') {
  const text = String(markdown || '')
  const sections = [...text.matchAll(/^## (.+?)\s*$/gm)].map(match => match[1])
  const wanted = String(section || '').trim().toLowerCase()
  if (!wanted)
    return { ok: true, sections, markdown: text }
  const index = sections.findIndex(name => name.toLowerCase() === wanted)
  if (index < 0)
    return { ok: false, code: 'unknown-section', message: `Unknown guide section "${section}". Sections: ${sections.join(', ')}.`, sections }
  const start = text.indexOf(`## ${sections[index]}`)
  const next = index + 1 < sections.length ? text.indexOf(`## ${sections[index + 1]}`, start) : text.length
  return { ok: true, section: sections[index], sections, markdown: text.slice(start, next).trimEnd() }
}

// A data contract's Markdown with its title, `Last verified` line and
// section headings. `section` narrows the Markdown to one `##` section.
export function describeContract(kind, contractPath, markdown, section = '') {
  const part = selectGuideSection(markdown, section)
  if (!part.ok)
    return { ...part, kind }
  return {
    ok: true,
    kind,
    path: contractPath,
    title: markdown.match(/^#\s+(.+?)\s*$/m)?.[1] || '',
    lastVerified: markdown.match(/^Last verified:\s*(.+?)\s*$/m)?.[1] || null,
    ...(part.section ? { section: part.section } : {}),
    sections: part.sections,
    markdown: part.markdown,
  }
}

// The renderer kind is long and read by section.
const RENDERER_CONTRACT_NOTE = 'Kind "renderer" is the public renderer\'s Template v2 guide (emd-cms-front; the remote server reads the copy the public site has deployed): how blocks render in Hub preview and on the public site, template syntax, Data Sources and KV queryability, client helpers. Read its "Agent quick contract", "System boundaries" and "End-to-end rendering flow" sections, then only the section the task needs.'

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
    .describe('A CMS operation, e.g. { "type": "page.placeBlock", "siteId": "...", "pageId": "...", "blockId": "...", "values": { ... } }, { "type": "page.moveBlock", "siteId": "...", "pageId": "...", "instanceId": "...", "index": 0 } or { "type": "post.create", "siteId": "...", "title": "...", "blurb": "...", "templateId?": "..." }. page.create takes optional SEO "fields" like page.update. post.* operations write draft posts only (post.create, post.update with "fields", and post.placeBlock/setValues/moveBlock/removeBlock with "postId"); a post\'s kind is "postType" (post or event), since "type" is the operation. A custom post type entry is post.create with "postTypeId" (its defining page) and "values" (its detail fields), and post.update with fields.values. page.update fields "post" (index/detail) and "postType" ({ enabled, icon, event }) make a page a custom post type, and page.placeBlock/page.setValues "useForCustomPost" (post area) choose its entry fields. site.settings sets a site\'s branding, contact, social, tracking and sitemap settings (sitemap.posts: Enable Sitemap choices for post, event and "page:<id>"); site.menus replaces its menus. Templates: template.create and template.update, and the page.* block operations with siteId "templates" and the template id as pageId. Call cms_contract (kind "operations") first: it returns every type and its fields. Read a page with cms_get_page, or a post with cms_get_post, for its instance ids and row order.')
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
        ? 'Validate every CMS library block in an organization with the Hub\'s shared block validator, using Hub import settings (required keys, organization themes, the organization\'s block tag list, render checks with empty and sample Data Source records). Returns a summary by rule and the blocks with errors, with their findings (up to listLimit blocks). Public Vue overrides are checked against the deployed public site\'s override manifest. Reads only.'
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
      title: remote ? 'Diff a CMS Block Definition' : 'Diff CMS Block Workspace States',
      description: remote
        ? 'Show what a block definition changes in a library block before you save it as a draft. Send the definition inline (as for block.draft): it is compared with the block\'s current definition (its open draft, else the released one), or with the released one when against is "released". Leave the definition out to see what the open draft changes in the release. Compares the definition fields only (content, template, templateVersion, schema, dataSources, isOverrideBlock, meta, values) and lists other keys you sent as ignoredFields. Returns field-path changes with a line diff for changed text, sameDefinition (true when a draft would change nothing), and the baseHash block.draft needs. Reads only.'
        : 'Return structured differences between local, checkout-base, and current production CMS block documents.',
      inputSchema: remote
        ? {
            orgId: orgIdSchema(),
            docId: CmsDocIdSchema,
            definition: z.record(z.any()).optional().describe('Your version of the block definition (content, template, templateVersion, schema, dataSources, meta, values, ...). Up to 1 MB. Leave it out to compare the open draft with the release.'),
            against: z.enum(['current', 'released']).optional().default('current').describe('current: the open draft, else the released definition (what block.draft would replace). released: what the public site uses now.'),
          }
        : {
            orgId: orgIdSchema(),
            docId: CmsDocIdSchema,
            comparison: z.enum(['base-local', 'base-production', 'local-production']).optional().default('local-production'),
          },
      annotations: READ,
    },
    {
      name: 'cms_resolve_override',
      title: 'Resolve CMS Public Frontend Override',
      description: remote
        ? 'Report whether the deployed public site (emd-cms-front) replaces a block with a Vue override component, using the renderer\'s name-resolution rules against its deployed override manifest: the matching component file, several ambiguous matches, or the block\'s CMS HTML. Pass a library block\'s docId (uses its name and isOverrideBlock flag) or a blockName to check a name before creating the block. Overrides that are not deployed yet are not seen. Reads only.'
        : 'Mirror the current renderer name-resolution rules and report the exact local emd-cms-front Vue override candidate, ambiguity, or CMS HTML fallback.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe(remote ? 'Library block document id: uses its current name and isOverrideBlock flag.' : 'Optional exact production CMS block id used to load its current name.'),
        blockName: OptionalCmsSearchSchema.describe('Block name to resolve when docId is omitted.'),
        themeName: OptionalCmsSearchSchema.describe(remote ? 'Optional theme document id (the site\'s theme from cms_list_sites), for theme-specific components.' : 'Optional public renderer theme name.'),
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
      description: remote
        ? 'Validate one CMS block definition with the Hub\'s shared block validator: Template v2 structure, schema and grammar, and render checks with empty and sample Data Source records. Send the definition inline (definition: the block object, as you would send it in block.create or block.draft), or a library block\'s docId to validate its current definition (its open draft, else the released one). Returns string errors/warnings/info plus structured issues, and renderingOwner: whether the deployed public site replaces the block with a Vue override (from its override manifest). Writes nothing.'
        : 'Validate a checked-out local or current production CMS block with the Hub\'s shared block validator: Template v2 structure, schema and grammar, render checks with empty and sample Data Source records, and public renderer ownership. Returns string errors/warnings/info plus structured issues.',
      inputSchema: remote
        ? {
            orgId: orgIdSchema(),
            docId: OptionalCmsSearchSchema.describe('Library block document id: validates its current definition, or names an inline definition.'),
            definition: z.record(z.any()).optional().describe('The block definition to validate (content, template, templateVersion, schema, dataSources, values, name, ...). Up to 1 MB.'),
          }
        : {
            orgId: orgIdSchema(),
            docId: CmsDocIdSchema,
            source: z.enum(['local', 'production']).optional().default('local'),
            themeName: OptionalCmsSearchSchema.describe('Optional public renderer theme name.'),
          },
      annotations: READ,
    },
    {
      name: 'cms_render_block',
      title: 'Render a CMS Block',
      description: 'Render one block definition to HTML the way the public site renders it: the site\'s theme and real Data Source records from the KV mirror the public site reads (or sample records, or none). Send the definition inline, or a library block\'s docId to render its current definition (its open draft, else the released one), with optional instance values and Data Source settings. Returns the block\'s html, a standalone document (save it as .html and open it in a browser to screenshot it), where each source\'s records came from (sources), problems, and whether the deployed public site replaces the block with a Vue override. At most 50 records per source; API sources are not fetched. Use it to check one block, and cms_preview_url to check a whole page. Reads only, through the Hub.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe('Library block document id: renders its current definition, or names an inline definition.'),
        definition: z.record(z.any()).optional().describe('The block definition to render (content, template, templateVersion, schema, dataSources, values, meta, name, ...), as in block.create or block.draft. Up to 1 MB.'),
        values: z.record(z.any()).optional().describe('Field values over the schema defaults, as a page instance stores them.'),
        meta: z.record(z.any()).optional().describe('Data Source settings per source name, as a page instance stores them: { "<source>": { "queryItems": { ... }, "limit": 6 } }.'),
        siteId: OptionalCmsSearchSchema.describe('Site document id: its theme, {siteId} in Data Sources, and posts. Without it the block renders unthemed and site-scoped sources stay empty.'),
        themeId: OptionalCmsSearchSchema.describe('Theme document id, instead of the site\'s theme.'),
        routeLastSegment: OptionalCmsSearchSchema.describe('The last URL segment, for detail blocks whose Data Source uses {routeLastSegment}.'),
        data: z.enum(['live', 'sample', 'empty']).optional().default('live').describe('live: real records from the KV mirror. sample: the validator\'s sample records. empty: no records (loading and empty states).'),
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
      description: remote
        ? `Read one of the Hub's data contracts as Markdown, as deployed with the Hub: the fields, storage paths, public projection, consumers and invariants an agent writes against. Call it for every kind the task will write before building (${contractKinds.join(', ')}), and name the contract lines each field follows in the handoff. ${RENDERER_CONTRACT_NOTE} An unknown kind lists the known ones.`
        : `Read one of the Hub's data contracts as Markdown, from the checkout this server runs in: the fields, storage paths, public projection, consumers and invariants an agent writes against. Call it for every kind the task will write before building (${contractKinds.join(', ')}), and name the contract lines each field follows in the handoff. ${RENDERER_CONTRACT_NOTE} Reads a file only: no network, no Firestore. An unknown kind lists the known ones.`,
      inputSchema: {
        kind: z.string().trim().min(1).describe(`Which contract: ${contractKinds.join(', ')}.`),
        section: z.string().trim().optional().describe('One section heading (a "## " heading, for example "Agent quick contract"). Omit for the whole contract; every answer lists its sections.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_schema',
      title: 'Describe a Collection\'s Live Shape',
      description: 'Describe what a collection actually stores in this organization, from a sample of its documents: each field path (array items as path[], maps as path.*), its types, and its presence (% of sampled documents). Never returns values. Collections: blocks, themes, sites, a site\'s pages and posts (with siteId; compared with their published copies), and any collection the organization\'s blocks read as a Data Source (an unknown name lists them). Collections that can hold personal data are refused. It shows what is stored, not what is allowed: cms_contract has the rules.',
      inputSchema: {
        orgId: orgIdSchema(),
        collection: z.string().trim().min(1).describe('blocks, themes, sites, pages, published-pages, posts, published-posts, or a Data Source collection name.'),
        siteId: z.string().trim().min(1).optional().describe('Site document id, for pages and posts.'),
        limit: z.number().int().min(1).max(200).optional().describe('Documents to sample (default 100).'),
      },
      annotations: READ,
    },
    {
      name: 'cms_guide',
      title: 'Read the CMS Agent Guide',
      description: 'Read the workflow guide for these tools as Markdown: the rules, how to start, changing page content, library blocks and themes, checking your work, and what refusals mean. Pass a section heading to read one part. Read it before your first change.',
      inputSchema: {
        section: z.string().trim().optional().describe('One section heading (for example "Rules" or "Change a library block"). Omit for the whole guide and its section list.'),
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
      name: 'cms_list_sites',
      title: 'List an Organization\'s Sites',
      description: 'List the organization\'s sites with each siteId, name, domains, canonical domain and theme id, to find the siteId page and post work needs. The templates site is left out. scanTruncated marks an organization with more sites than were read. Reads only.',
      inputSchema: { orgId: orgIdSchema() },
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
      description: 'Plan a draft-only CMS operation through the Hub (themes, new sites, their SEO, settings and menus, templates, draft pages and their SEO, draft posts and their fields, block placement, order and content on pages and posts, new blocks, block drafts) and return what would change, any problems, and a checksum for cms_run_operation. Call cms_contract first for the operations contract and for every kind the operation writes (blocks, themes, posts), and build the operation from those fields. Writes nothing. Nothing can publish a page or post or release a block. Needs an agent key (Dev Mode > Agent Keys).',
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
      name: 'cms_upload_media',
      title: 'Upload Images to CMS Media',
      description: 'Add images to the organization\'s media library through the Hub\'s own upload path (the same media document, R2 copy, Cloudflare Images variants and tags as an upload in the Hub). Each source is a public `url` the server fetches (an old site\'s image, a hosted asset), or a `localFile` ({ name, size }) for a file on this machine: that returns a one-time upload link to PUT the file to (upload.curl), so the bytes never go through the tool call. JPEG, PNG, GIF and WebP up to 10 MB; SVG is refused (convert it to PNG). Deduplicates by source URL and by content: an image already uploaded comes back with deduplicated: true and gets any missing tags. Waits up to waitSeconds for Cloudflare; place `url` (or variants[the image field\'s variant]) only when status is "ready", and never link to the old site. Every call is recorded with your own Hub rights.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).optional().describe('Site the images are for (stored as the media\'s cmssite, which the Hub\'s "Current Site" filter uses). Without it they are shared media ("all").'),
        tags: z.array(z.string().trim().min(1)).min(1).max(10).describe('Media tags, at least one, as the Hub\'s upload dialog requires. Use the image field\'s `tags` option when it has one, so its picker shows the image.'),
        sources: z.array(z.object({
          url: z.string().trim().min(1).optional().describe('Public http(s) URL of the image.'),
          localFile: z.object({
            name: z.string().trim().min(1).describe('The file\'s name, with its extension.'),
            size: z.number().int().positive().optional().describe('Size in bytes.'),
          }).optional().describe('A file on this machine: returns an upload link instead of fetching.'),
          name: z.string().trim().min(1).optional().describe('Media name; defaults to the file name from the URL or localFile. The extension follows the detected type.'),
        })).min(1).max(10).describe('1 to 10 images, each with url or localFile.'),
        waitSeconds: z.number().int().min(0).max(60).optional().describe('How long to wait for Cloudflare processing (default 30). Images still processing come back with status "processing"; check them with cms_find_media.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
      name: 'cms_find_media',
      title: 'Find CMS Media',
      description: 'Find images in the organization\'s media library, newest first: by fileIds (to wait for uploads to be "ready"), by the sourceUrl they were uploaded from, or by name query, tags and site. Each has fileId, name, status (ready, processing or failed), url (the Cloudflare public variant, only when ready), variants, tags and cmssite. Look here before uploading, and reuse what the Hub already has. Reads only.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        fileIds: z.array(z.string().trim().min(1)).max(100).optional().describe('Exact media file ids, e.g. from cms_upload_media.'),
        sourceUrl: z.string().trim().min(1).optional().describe('The URL an agent uploaded an image from.'),
        query: z.string().trim().optional().describe('Part of the media name.'),
        tags: z.array(z.string().trim().min(1)).optional().describe('Media with any of these tags.'),
        siteId: z.string().trim().min(1).optional().describe('Media for this site or shared ("all").'),
        limit: LimitSchema.describe('Maximum media returned (default 50).'),
        startAfter: z.string().trim().min(1).optional().describe('nextStartAfter from the previous page.'),
      },
      annotations: READ,
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
        ? 'List what stops a site from being finished: failed block checks, invalid or empty required block content, blocks missing from the library, override blocks that need a Vue component (deployedRenderer: whether the deployed public site has it), unreleased block drafts, pages behind the released block, empty pages, and pages never published or with unpublished changes. Reads only.'
        : 'List what stops a site from being finished: failed block checks, invalid or empty required block content, blocks missing from the library, override blocks that need a Vue component (deployedRenderer: whether the deployed public site has it; localRenderer: whether the local emd-cms-front checkout has it), unreleased block drafts, pages behind the released block, empty pages, and pages never published or with unpublished changes. Reads only. Needs an agent key.',
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
      description: 'List a site\'s menus as a tree (Site Root, other menus, Not In Menu; folders and external links included) with each page\'s pageId, slug, menu title, URL path, status (draft: never published; published; unpublished-changes), post (an index/detail page) and customPostType (the page defines a custom post type: its pageId is the postTypeId for post.create and cms_list_posts, and "page:<pageId>" its sitemap choice). Pages in no menu are listed under unlisted. Also returns the draft site\'s sitemap settings (sitemap: { posts, collections, apis }, null when never set), which site.settings sitemap changes. Reads only. Needs an agent key or a site session.',
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
      description: 'Read one page as an outline instead of the raw document: its SEO fields (and the post* fields when it has a post view), post and postType ({ enabled, icon, event } on a custom post type page; its post-area instances marked useForCustomPost are the entry form), structuredDataAiLocked (true: its custom structured data is left to the Hub, and page.update refuses structuredData), version and status, then per area (main, and post when present) its rows in order, each with its column spans and the instances in each column: instanceId, blockId, name, synced and override flags, whether it is behind the released block, and its values. Use the instance ids and row indexes with page.setValues, page.moveBlock and page.removeBlock. Schemas are left out unless includeSchema is true (cms_find_block and cms_block_base have them). Reads only. Needs an agent key or a site session.',
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
      description: 'List a site\'s posts, events and custom post type entries, newest first: each post\'s postId, name (its slug), postTypeId (custom entries: the defining page), title, type (post, event, or a custom type\'s "custom-…" key), tags, publishedAt, publishAt (a scheduled publication), status (draft: never published; published; unpublished-changes: the saved draft differs from what is live, compared as the Hub compares it; missing: published with no draft) and the library blockIds it uses. Filter by type, postTypeId (one custom post type\'s entries) or tag; page with startAfter (the last postId of the previous page, from nextStartAfter). Reads only. Needs an agent key or a site session.',
      inputSchema: {
        sessionId: SessionIdSchema,
        orgId: orgIdSchema(),
        siteId: z.string().trim().min(1).describe('Site document id.'),
        type: z.string().trim().regex(/^(?:post|event|custom-[a-z2-7]+)$/).optional().describe('Only posts, only events, or one custom type ("custom-…" key from an earlier listing).'),
        postTypeId: z.string().trim().min(1).optional().describe('Only the entries of the custom post type this page defines (cms_list_pages customPostType).'),
        tag: z.string().trim().min(1).optional().describe('Only posts with this exact tag.'),
        limit: z.number().int().min(1).max(100).optional().describe('Posts per page (default 50).'),
        startAfter: z.string().trim().min(1).optional().describe('nextStartAfter from the previous page.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_get_post',
      title: 'Read a CMS Post',
      description: 'Read one post as its fields and an outline instead of the raw document: name (slug), postTypeId and values (a custom post type entry: its detail values keyed by field path, dotted for nested ones, the shape post.update fields.values takes back; it has no body of its own), the URL paths the site\'s post template pages serve it at (paths), status, type, title, blurb, tags, featuredImage, restrictionRuleId, the event for events, publishedAt, publishAt, hidePublishedDate and whether it was imported (imported: its legacyBlog audit fields are never changed), then its body as rows in order with column spans and the instances in each column: instanceId, blockId, name, synced and override flags, whether it is behind the released block, and its values. Use the instance ids and row indexes with post.setValues, post.moveBlock and post.removeBlock. Schemas are left out unless includeSchema is true. Reads only. Needs an agent key or a site session.',
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
    // Local only (not in CMS_AGENT_REMOTE_TOOL_NAMES): they read every placed
    // instance through the server's Firestore access and the emd-cms-front
    // checkout.
    {
      name: 'cms_compare_instances',
      title: 'Compare a Block Change on Every Placed Instance',
      description: 'Before saving or releasing a block draft: render every instance of the block already placed on pages and posts (draft and published, every site, and the templates site) twice with the Hub\'s template engine, "before" from the instance\'s own copy of the markup and "after" from the proposed definition applied the way a release applies it (instance values and per-page Data Source settings kept, schema defaults filled), with the same Data Source records on both sides (sourceRecords, else sample records cut to each source\'s limit). Returns counts per site and collection (instances, distinct renders, identical, different), a short before/after excerpt for each difference, instances whose own markup copy differs from the library block, and instance values in fields the proposed schema no longer has. Checks the template and the values, not where live records come from: use cms_preview_url for API sources and the Hub preview. Reads only.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: CmsDocIdSchema,
        definition: z.record(z.any()).optional().describe('The proposed definition (content, template, templateVersion, schema, dataSources, meta, values, isOverrideBlock), as you would send it in block.draft. Send this or useDraft.'),
        useDraft: z.boolean().optional().describe('Compare the block\'s open draft instead of an inline definition.'),
        siteId: OptionalCmsSearchSchema.describe('Optional exact site id. Omit for every site plus the templates site.'),
        collections: z.array(z.enum(['pages', 'published', 'posts', 'published_posts'])).optional().describe('Collections to read. Default: all four (draft and published pages and posts).'),
        sourceRecords: z.record(z.array(z.any())).optional().describe('Records to feed each Data Source by name, on both sides. Default: generated sample records.'),
        maxRenders: z.number().int().min(1).max(10000).optional().describe('Distinct value sets rendered (default 3000); the rest are counted as unchecked.'),
      },
      annotations: READ,
    },
    {
      name: 'cms_override_component',
      title: 'Read an Override Block\'s Vue Component',
      description: 'For an override block (the public site renders an emd-cms-front Vue component instead of the block\'s CMS markup): the component file the public site resolves for it from the local emd-cms-front checkout (organization folder and theme-prefixed files included), its source, and a field comparison: the values, meta and Data Sources the component reads against the block\'s schema and sources (missing in the block, unused by the component). Also whether the deployed public site has the component (its override manifest) and whether the local file differs from the deployed commit. Pass a library block\'s docId (its open draft, else the released definition), or a blockName to check a name. Reads only; changing a component is work in emd-cms-front.',
      inputSchema: {
        orgId: orgIdSchema(),
        docId: OptionalCmsSearchSchema.describe('Library block document id: uses its name, isOverrideBlock flag and fields.'),
        blockName: OptionalCmsSearchSchema.describe('Block name to resolve when docId is omitted.'),
        themeName: OptionalCmsSearchSchema.describe('Optional theme document id (the site\'s theme), for theme-prefixed components.'),
      },
      annotations: READ,
    },
  ]
  return remote ? tools.filter(tool => CMS_AGENT_REMOTE_TOOL_NAMES.includes(tool.name)) : tools
}
