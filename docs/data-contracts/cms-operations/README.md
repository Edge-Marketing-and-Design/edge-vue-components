# CMS operations data contract

Status: in use through the Hub callables and the agent endpoint; every write is a draft.

Last verified: 2026-10-28, remote MCP port (emd-cms handoff)

Server-side, draft-only writes for building sites, used by agents through the
CMS MCP and available to any signed-in caller with write permission. Source:
`functions/cmsOperations.js`, `functions/cmsAgentKeys.js`,
`functions/cmsAgentConnections.js` and
`functions/cmsPreviewTokens.js` (shared copies in `edge/functions/`), with the
document builders in `edge/lib/cmsOperations.js` (byte-identical copies in
`functions/helpers/` and `edge/functions/helpers/`).

The **Operations** section (every operation's inputs, effect, refusals and
problem codes) is generated from `CMS_OPERATION_SPECS` in
`edge/lib/cmsOperations.js`, the definitions the checks enforce; it replaces
the marker below whenever `cms_contract` serves this contract. Change an
operation there, not here. The rest of this file is hand-written.

## Storage

| Documents | Path |
| --- | --- |
| Operation audit records | `cms-operations/{operationId}` (top level) |
| Agent keys | `agent-keys/{keyId}` (top level) |
| Hub agent connections | `agent-connections/{connectionId}` (top level) |
| Connection sessions | `agent-sessions/{sessionId}` (top level) |
| Theme proposals | `organizations/{orgId}/themeProposals/{id}` |
| Agent read audit | `organizations/{orgId}/cmsAgentReads/{autoId}` |
| Operations contract explanation overrides | `agent-contract-notes/{key}` (top level; edited on the Agent Contract page, root admins) |
| Sign-in tokens and codes for the remote MCP | `agent-oauth-tokens/{id}`, `agent-oauth-codes/{id}` (top level; Functions only) |
| What operations write | `organizations/{orgId}/themes/{id}`, `sites/{siteId}`, `sites/{siteId}/pages/{pageId}`, `sites/{siteId}/posts/{postId}` (drafts), `blocks/{docId}` and `blocks/{blockId}/revisions/{number}` |

Both top-level collections sit outside the organization on purpose: the Hub's
generic Firestore rules (owned by `@edgedev/firebase`) let organization
editors create documents under `organizations/{orgId}/…`, so a key or an
audit record stored there could be forged (verified in the emulator). Under
those rules only the Functions and root admins can write a top-level path.
Nothing in the Hub reads `cms-operations` yet.

The agent read audit is deliberately under the organization (decided
2026-10-27): it records what agents read, not changes, so it is
informational, and an organization editor could add or remove entries under
those rules.

Operations never write `published`, `published_posts`,
`published-site-settings`, releases, or a theme a published site uses. On a
post they never write `publishAt`, `publishAtTimezone`, `publishedAt`,
`hidePublishedDate` or `legacyBlog`, nor an existing post's
`doc_created_at`.

<!-- operations: generated from CMS_OPERATION_SPECS -->

Post block operations work on the body as the post editor holds it after
opening it (`normalizePostBuilderDoc`: instance ids, string content, object
values and meta; rows normalized as `cmsPostStructure.js` does), so what
they write is what the editor would save. Posts have no `version`.

## Fields

### Operation audit record

Every successful run writes `cms-operations/{operationId}`:

| Field | Meaning |
| --- | --- |
| `orgId`, `type`, `operation` | The organization and the operation as run. `block.draft` records omit the definition |
| `changes`, `result`, `summary` | What the plan said would change and what the run returned |
| `checksum` | The check's checksum the run was executed with |
| `runBy`, `runAt` | The uid the operation ran as, and when |
| `via`, `agentKeyId`, `client` | `hub` for the callables, `agent` for the endpoint with the key used, and the caller's `client` label |
| `agentConnectionId` | Parent Hub connection ID for session-authenticated runs; `null` for legacy organization keys and Hub callables. Derived from the authenticated session, never caller input |
| `status` | `applied` |

Drafts made through an agent key have revision `source: 'agent'`; through
the callable, `source: 'editor'`.

### Agent key

Agents call the operations with a key a developer creates in the Hub (Dev
Mode > Agent Keys). The key (`cmsak.<keyId>.<secret>`, a 20-character id and
a 43-character base64url secret) is returned once, by `cms-createAgentKey`.

| Field | Meaning |
| --- | --- |
| `orgId` | The only organization the key works in |
| `name` | What the key is for |
| `createdBy` | The developer the key acts as; operations run with their permissions, so a key stops working when they lose write access |
| `createdAt`, `expiresAt` | ISO strings; 1–90 days, 30 by default |
| `revokedAt`, `revokedBy` | Set when revoked |
| `keyHash` | SHA-256 of the secret; the secret itself is never stored |
| `hint` | The secret's last four characters, to tell keys apart |
| `lastUsedAt`, `useCount` | Updated on each successful call |
| `scope` | `cms-operations` |

### Preview token

`<base64url JSON { o, s, p, src, exp }>.<base64url HMAC-SHA256>`, signed with
`CMS_PREVIEW_TOKEN_SECRET` (at least 32 characters, Functions environment).
Valid 15 minutes (at most an hour) for exactly that organization, site, page
and source. Without the secret, no link can be issued or accepted; signed-in
Hub users can still preview.

## Public projection

Operations write no public document. They read the public state of a site to
refuse what would change it (a live theme) and to report what stops the site
from being finished:

- **Live themes:** a theme is live when a `published-site-settings` document
  names it, or when a site whose `theme` is it has a published page or a
  `published-site-settings` document. Every theme write is copied to the
  public renderer (`onThemeWritten`), so live themes accept only
  `theme.propose`.
- **Site readiness** (`buildSiteReadiness` in `edge/lib/cmsOperations.js`,
  shared by the Hub dialog, the agent endpoint and the MCP) reads the draft
  pages, the published copies, the theme and the library blocks, and returns
  `{ siteId, ready, counts: { error, warning, info }, items, pagesChecked,
  blocksChecked, truncated }`. Each item is `{ severity: 'error' | 'warning'
  | 'info', code, message, pageId?, instanceId?, blockId? }`, errors first.
  `ready` is true when there are no errors; an incomplete check is never
  ready. Up to 500 draft pages, 500 published pages and 100 blocks are
  checked; `truncated` says when a site has more, and the report then
  carries the error `site.check-incomplete`.

| Readiness code | Meaning |
| --- | --- |
| `site.check-incomplete` | The site has more pages or blocks than the check reads; what was skipped may hold errors |
| `site.no-theme`, `site.theme-missing` | The site names no theme, or a theme that does not exist |
| `block.missing` | An instance references a library block that does not exist |
| `instance.values` | A Template v2 value fails the page editor's rules (an empty required field, for example) |
| `block.checks` | The shared block checks report an error |
| `page.empty` | A page with no content |
| `page.unpublished`, `page.unpublished-changes` | A page never published, or whose draft differs from its published copy |
| `instance.behind` | An instance holds an older revision than the released one |
| `block.override` | The public site needs a Vue component for this block |
| `block.unreleased` | The block has an open draft |
| `media.external-image` | An image URL outside the Hub's media (Cloudflare Images, the R2 host) in instance values, block markup or site settings: upload it with `cms_upload_media` (warning; `url` and `field` name it) |
| `seo.meta-title`, `seo.meta-description` | Missing on a draft page or the site |
| `seo.structured-data` | Missing (warning) or not a JSON-LD object (error) |
| `seo.structured-data-empty` | An empty `name` or `description` on the first item |
| `seo.structured-data-tokens` | A token the public site won't replace, or a hard-coded site URL |

## Consumers

- **Callables** (signed-in Hub users): `cms-checkOperation`,
  `cms-runOperation`, `cms-siteReadiness`, `cms-createAgentKey`,
  `cms-listAgentKeys`, `cms-revokeAgentKey`, `cms-getPreviewRenderPayload`.
- **Endpoint** (agents): `cms-agentOperation`.
- **Hub:** Dev Mode > Agent Keys; the site readiness dialog; the preview
  render route `/cms-preview-render/:siteId/:pageId`.
- **CMS MCP** (`edge/tools/mcp/cms`): `cms_check_operation`,
  `cms_run_operation`, `cms_block_base`, `cms_preview_url`,
  `cms_site_readiness`, `cms_list_pages`, `cms_get_page`, `cms_list_posts`,
  `cms_get_post`; `cms_contract` returns this document. `cms_find_usage`
  (read-only connection, not this endpoint) also scans each site's `posts`
  and `published_posts`.
- **Skills:** `edge-design-to-site` drives every operation; the
  `edge-block-package` and `vue-to-block-migrator` skills create blocks
  through `block.create`.

## Invariants and validation codes

### Check, then run

- **`cms-checkOperation`** `{ orgId, operation }` plans the operation and
  writes nothing. It returns `{ summary, changes: [{ path, action }],
  problems, notices, blocked, result, checksum, currentHash? }`. `checksum`
  covers the operation, every document the plan read and, for every query it
  ran, each result document's id and contents (so a template page edited
  under the same id stales a `site.create` check).
- **`cms-runOperation`** `{ orgId, operation, checksum, client? }` plans it
  again inside a transaction, and writes only when the checksum still
  matches and there are no problems; otherwise `failed-precondition` and
  nothing is written. It returns `{ operationId, status: 'applied', result,
  summary }`. Generated ids (a new page's id, an automatic theme id) come
  from the run, not the check.
- **`cms-siteReadiness`** `{ orgId, siteId }`: for anyone who can read the
  organization's sites. Writes nothing.
- Both operation callables require the caller's uid to match the request.

### Document shapes

The builders mirror the Hub UI, so operation output is indistinguishable
from editor output:

- **New site:** the site settings defaults (`siteSettingsDefaults`, which
  the Hub's `siteSettingsTemplate.js` uses) without `restrictedContent`
  (the new-site form doesn't have it); `users: [creator]` unless the creator
  is an organization admin (`[]`), as the form forces; then the theme's
  default menus copied with a page per entry from `sites/templates/pages`
  (`seedMenusFromTheme`, the same helpers as `site.vue`
  `seedNewSiteFromTheme`: unique slugs across both root menus, folders kept,
  external links copied, custom structured data locked from AI) and the
  theme's `defaultSiteSettings` for settings still at their defaults.
  Nothing is published and no `published-site-settings` are written.
- **Blank page:** `menu.vue` `buildPagePayloadFromTemplate` without a
  template, including the default page structured data.
- **Instance:** the block picker's copy of the library block: identity
  (`blockId`, `name`, `isOverrideBlock` when the block has it), no
  `previewType`, and for Template v2 non-synced blocks `values` set to each
  schema field's default `value` (fields without one are omitted) and
  `meta: {}`, unless values are given. The public renderer also fills a
  field an instance has never saved from the schema default, so older
  instances saved with `values: {}` render what the editor showed. Saved
  values, including empty strings, are never replaced. Library
  bookkeeping (`releasedRevision`, `draftRevision`, `lastRevisionNumber`,
  `activeReleaseId`, `lastReleaseId`, `canary`, `uid`, `last_updated`,
  `doc_created_at`, `docId`) is not copied. The instance records
  `blockRevision` (the library block's released revision), so a later
  release treats it as current. Ids are six base-36 characters, unique in
  the page.
- **Row:** `page.vue` `createRowFromLayout('6')`: full width, gap 4,
  transparent, vertical start, normal mobile order, auto horizontal margin,
  zero padding and margins, one column with `span: 6`, and the page editor's
  `tailwindClasses` on the row and column.
- **`blockIds`:** `page.vue` `derivePageBlockIds` (library ids from
  instances plus column references).
- **Post** (`posts.vue`): a new post is `{ name, title, tags, blurb,
  content, structure, featuredImage, restrictionRuleId: '', type, event,
  blockIds, docId, doc_created_at, last_updated, uid }`. `event` is the
  editor's normalized event (Events) for every post; without one the time
  zone is `UTC` and the capacity `0`, as a save stores it. `publishAt` and
  `publishAtTimezone` are left out; the editor writes them as `''` on its
  next save, which counts as no change. A post's `blockIds` are the library
  ids of its instances (`onWorkingDocUpdate`). `featuredImage` is a string:
  the editor sets it from the media picker.
- **Post row:** `cmsPostStructure.js` `createPostRow`: `{ id, width: 'full',
  gap: '4', verticalAlign: 'start', background: 'transparent', mobileStack:
  'normal', columns: [{ id, span: 12, mobileOrder: 0, blocks }] }`, no
  `tailwindClasses`; the post editor's grid shows span 12 at full width. A
  template body keeps its own rows (a page template's `span: 6` included).
- **Post template:** a templates-site page whose types include `Post` and
  that is not a post template page (`post: true`), as the new-post dialog
  lists them; its body is its `postContent`/`postStructure`, else its
  `content`/`structure`.
- **Events:** `event` fields an operation may give are `startAt`, `endAt`
  (local `YYYY-MM-DDTHH:mm`), `timezone` (IANA), `locationName`,
  `locationAddress`, `meetingUrl`, `registrationUrl`, `status`
  (`scheduled`, `cancelled`, `completed`), `isVirtual`,
  `unpublishPastEvent` and `capacity`. `startAtUtc`, `endAtUtc` and `isPast`
  are computed as `syncEventUtcFields` computes them. An event needs a start,
  an end, a location unless virtual (the editor's rules) and a time zone
  (the editor falls back to the browser's; an operation has none).

### Rules

- **Values** are checked with the page editor's rules
  (`validateInstanceValues`): `required`, `min` and `max` (characters, items
  or number), at least one item for manual arrays, and no values for fields
  the schema doesn't define.
- **Theme fields:** `theme` and `headJSON` must be JSON object strings (the
  KV mirror parses them); `extraCSS` a string; no other fields.
- **Structured data** (`structuredData`, `postStructuredData`, and the site's
  `structuredData` in `site.create` and `site.update`): empty is allowed;
  anything else must parse as a JSON-LD object or a list of objects, or the
  operation is refused. Notices: on regular pages and the site, a `{{token}}`
  other than `{{cms-url}}`, `{{cms-site}}` and `{{cms-logo}}` (the only ones
  the public renderer replaces outside posts); a top-level `@id` or `url`
  written as an absolute URL instead of a token (`structuredDataFindings`
  in `edge/lib/cmsOperations.js`).
- **Design reference** (`designReferenceProblems` in `edge/lib/cmsOperations.js`):
  a block's `meta.design` (`edge/docs/data-contracts/cms-blocks/README.md`,
  Library block) is `{ source: "figma", file, node, name? }` or
  `{ source: "handoff", path, section?, name? }`, every value a non-empty
  string and no other keys. `block.create` and `block.draft` refuse any
  other shape; omitting it is allowed. It reaches the library block through
  a release like the rest of the definition and is never copied to
  instances.
- **Block tags** (`edge/docs/data-contracts/cms-blocks/README.md`, Organization
  block tag list): `block.create` checks the new block's tags and
  `block.draft` the tags the block carries against the organization's
  `cmsBlockTags`, which the plan reads (a list change stales a check).
  `tags.not-in-list` and `tags.content-count` are notices while the rules are
  warnings and problems once they are errors. No list, no findings. Tags are
  metadata: `block.draft` ignores `definition.tags` and says so in a notice.
- **Standard theme names** (`edge/docs/data-contracts/cms-themes/README.md`):
  `theme.create` uses the Hub's shared defaults if JSON is omitted. Explicit
  JSON must include the baseline colors, fonts and radii, but may add custom
  names. `theme.update` and `theme.propose` are refused when a standard
  theme would stop being standard, and add notices for older themes.
  `block.create` and `block.draft` are refused for color, font or radius
  names absent from the baseline and the common declared tokens of the
  block's selected themes (and for hard-coded colors) when every selected
  theme includes the baseline; otherwise they are notices. Existing JSON is
  untouched.

### Agent endpoint

`cms-agentOperation` is an HTTP `POST` with `Authorization: Bearer <key>`
and JSON `{ orgId, action: 'check' | 'run', operation, checksum?, client? }`,
`{ orgId, action: 'preview', siteId, pageId, source?, blockDrafts?,
viewport?, width? }` for a preview link, `{ orgId, action: 'readiness',
siteId }` for the readiness report (as `cms-siteReadiness`), `{ orgId,
action: 'pages', siteId }` for the page list, `{ orgId, action: 'page',
siteId, pageId, source?, includeValues?, includeSchema? }` for a page outline
(Page reads), `{ orgId, action: 'posts', siteId, type?, tag?, limit?,
startAfter? }` for the post list or `{ orgId, action: 'post', siteId,
postId, source?, includeValues?, includeSchema? }` for a post outline (Post
reads). The reads need the key creator's read permission on the
organization's sites and write nothing. It verifies the key (constant-time hash
comparison, organization, not revoked, not expired), authorizes the operation
as the key's creator, and runs `check` or `run` exactly as the callables do,
recording `via: 'agent'` and the key.

Responses are `{ ok: true, … }` or `{ ok: false, code, message, details }`
with HTTP 400 (invalid argument), 401 (key missing, invalid, revoked or
expired), 403 (permission), 404, 405 (not POST), 409 (failed precondition) or
500.

Key callables: `cms-createAgentKey` `{ orgId, name, expiresInDays? }` needs
write access to both blocks and sites; `cms-listAgentKeys` `{ orgId }`
returns the caller's keys, or every key in the organization for organization
admins, never the hash; `cms-revokeAgentKey` `{ orgId, keyId }` is for the
creator or an organization admin.

### Page reads

Built by `buildSitePages` and `buildPageOutline` in
`edge/lib/cmsOperations.js` from the draft pages, the published copies and
the library blocks; the MCP's `cms_list_pages` and `cms_get_page`.

- **Status** (`pagePublicationStatus`): `draft` (no published copy),
  `unpublished-changes` (the draft's `version` is newer than the published
  copy's, as `page.unpublished-changes` compares) or `published`; `missing`
  for a menu entry, or a published copy, whose draft page doesn't exist.
- **Path:** the route the Hub's page links use (`findCmsPageRoute`): `/` for
  a top-level `home` page, otherwise `/` plus the folder and page slugs;
  menus other than `Site Root` and `Not In Menu` prefix their own slug. `null`
  when no menu lists the page.
- **`pages`** returns `{ siteId, siteName, menus: [{ menu, entries }],
  unlisted, pageCount, truncated }`. Menus are in the Sites page's order
  (`Site Root`, other menus, `Not In Menu`). Entries are `{ kind: 'page',
  pageId, exists, status, version?, post?, slug, menuTitle, path }`,
  `{ kind: 'folder', slug, menuTitle, entries }` or `{ kind: 'external',
  name, url }`. `unlisted` holds pages in no menu (`{ pageId, exists, status,
  version, post, slug }`). Up to 500 draft and 500 published pages are read;
  `truncated` says when there are more.
- **`page`** returns `{ siteId, pageId, source, name, path, status, post,
  structuredDataAiLocked, metaTitle, metaDescription, structuredData, version, last_updated, areas,
  blockIds }`, with `postMetaTitle`, `postMetaDescription` and
  `postStructuredData` when the page has a post view (`post: true` or post
  rows or instances). `source: 'published'` outlines the published copy and
  takes its path from the published site settings' menus; `status` is the
  draft's either way. `areas.main` (and `areas.post`) is `{ rows, unplaced? }`:
  rows in order, `{ rowId, index, width, layout: [span], columns: [{
  columnId, span, instances }] }`; instances `{ instanceId, blockId, name,
  templateVersion, synced, override, blockRevision, releasedRevision, behind,
  libraryMissing?, values?, schema? }` (`values` unless `includeValues` is
  false, `schema` only when `includeSchema` is true). A column reference with
  no instance is `{ instanceId, missing: true }`; instances no column places
  are in `unplaced`. A page using more than 200 library blocks is refused
  (409).

### Post reads

Built by `selectSitePosts`, `describePost`, `buildPostOutline` and
`postRoutePaths` in `edge/lib/cmsOperations.js` from the draft posts, the
published snapshots and the library blocks; the MCP's `cms_list_posts` and
`cms_get_post`.

- **Status** (`postPublicationStatus`, as `posts.vue` `hasPublishDiff`):
  `draft` (no snapshot), `published`, `unpublished-changes` (the saved
  draft, with each instance resolved to its library block's current
  definition as publishing resolves it, differs from the snapshot in
  `postDocComparable`'s fields; dates and timestamps don't count) or
  `missing` (a snapshot without a draft).
- **`posts`** returns `{ siteId, siteName, posts, matched, nextStartAfter,
  postCount, truncated }`, newest first (`publishedAt`, else
  `doc_created_at`), filtered by `type` (`post` or `event`) and exact `tag`;
  `limit` 1–100 (default 50), `startAfter` a postId from `nextStartAfter`.
  Each post is `{ postId, exists, name, title, type, tags, publishedAt,
  publishAt, status, blockIds }`. Up to 500 drafts and 500 snapshots are
  read; `truncated` says when there are more.
- **`post`** returns `{ siteId, postId, source, name, paths, status, type,
  title, blurb, featuredImage, featuredImages?, restrictionRuleId,
  publishAt, publishAtTimezone, publishAtError, tags, event? (events),
  publishedAt, hidePublishedDate, imported, doc_created_at, last_updated,
  body, blockIds }`. `body` is `{ rows, unplaced? }` as a page area.
  `imported` is true for a post with `legacyBlog` (the audit fields are not
  returned). `paths` are the URLs the site's post route pages (`post: true`
  with a post-rendering block, `cmsPostRoutes.js`) serve it at, in menu
  order, `/{folders}/{page}/{post}/` (`/{post}/` under `home`); the first is
  the Hub's live post URL. `source: 'published'` outlines the snapshot with
  the published menus and pages; `status` is the draft's either way. Posts
  whose draft and snapshot use more than 200 library blocks are refused
  (409).

### Library reads

Added 2026-10-27. Shared source: `edge/lib/cmsAgentReads.js` (with
byte-identical copies in `edge/functions/helpers/` and `functions/helpers/`,
also used by the local MCP's `cms-tools.js`) and
`edge/functions/cmsAgentLibraryReads.js`. The MCP's `cms_find_block`,
`cms_block_base`, `cms_find_theme`, `cms_get_theme`, `cms_find_usage` and
`cms_audit_blocks` and `cms_validate`, run as the operator with the same scan limits as the local
MCP (1000 blocks, 250 themes, 100 sites, 500 pages and 500 posts per site).

| Action | Body | Needs read on |
| --- | --- | --- |
| `blocks` | `docId?, query?, exactName?, tag?, type?, theme?, limit?, startAfter?` | blocks |
| `block` | `docId`: the definition (open draft, else released) and its `baseHash` | blocks |
| `themes` | `docId?, query?, exactName?, limit?` | themes |
| `theme` | `themeId, includeCustomFonts?` | themes |
| `usage` | `docId, siteId?, limit?` | blocks and sites |
| `audit` | `includeRender?, listLimit?` | blocks and themes |
| `validate` | `definition` (inline block object, up to 1 MB) or `docId` (the block's open draft, else released definition) | blocks |
| `diff` | `docId`, `definition?` (inline, up to 1 MB), `against?` (`current`, default, or `released`). Without a definition: the open draft against the release. Added 2026-11-02 | blocks |
| `override` | `docId` (uses its name and `isOverrideBlock`) or `blockName` (flag not checked), `themeName?` (theme id), against the deployed override manifest. Added 2026-11-02 | blocks |
| `schema` | `collection`, `siteId?`, `limit?` (the live shape) | the collection's own rights (blocks, themes or sites; a Data Source collection by name, plus blocks) |

Results match the local MCP's, without its environment and credential summary.
`audit` returns the summary by rule and up to `listLimit` (default 25) blocks
with errors, each with up to 20 errors and warnings (`code`, `severity`,
`path`, `message`); it writes no report file and does not resolve public Vue
overrides (`renderingOwner: 'unchecked'`). `validate` returns `{ docId, source
('definition', 'draft' or 'released'), valid, templateVersion, renderingOwner,
declaredSources, sourceCalls, errors, warnings, info, issues, hash }` with the
local MCP's `cms_validate` settings; an inline definition is not named in the
audit (`docIds` empty). `diff` returns `{ docId, comparison
('<from>-<to>' with 'released', 'draft' or 'definition'), releasedRevision,
draftRevision, baseHash, from, to (label, revision, hash), sameDefinition,
ignoredFields, equal, changeCount, changedTopLevelFields, changes }` over the
definition fields only. `override` returns the resolution (`status`,
`selectedMatch`, `matches`, `unflaggedMatch?`), `renderingOwner` and the
manifest's commit. A missing block or theme is 404.

Each successful library read adds an audit record: `{ tool, siteId, docIds
(first 20), resultCount, truncated, connectionId, agentKeyId, runBy, at,
expiresAt }`. `connectionId` is set for connection sessions, `agentKeyId` for
legacy keys; `at` is ISO and `expiresAt` a Timestamp 90 days later. It never
holds content or values. The write is awaited but its failure is only logged,
so it never fails the read. To delete expired records, enable a TTL policy on
the `cmsAgentReads` collection group field `expiresAt`; none is enabled by
this code.

### Preview links

`action: 'preview'` returns `{ url, expiresAt, blockDrafts, viewport, width }`:
a link to the Hub route
`/cms-preview-render/:siteId/:pageId?orgId=…&token=…[&source=published][&drafts=1][&viewport=…|&width=…]`
for one draft page (or its published copy) the key's creator can read. The
page must exist.

- **Origin:** `CMS_PREVIEW_RENDER_BASE_URL`, else
  `https://<projectId>.web.app`.
- **`cms-getPreviewRenderPayload`** `{ orgId, siteId, pageId, source?,
  token?, blockDrafts?, routeLastSegment? }` returns the page, site, theme,
  blocks, `draftBlockIds` and collection values only to a signed-in caller
  with `read` permission on the organization's sites, or with a valid token
  for that page.
- **Unreleased drafts** (`blockDrafts: true`, link `drafts=1`, draft pages
  only): every block on the page with an open draft revision is shown with
  the draft's definition (`blocksWithDraftDefinitions` in
  `edge/lib/cmsBlockRevisions.js`), copied into the page's instances by the
  release's own `buildPageBlockUpdate`, so the preview shows what a release
  would produce. Nothing is written. `draftBlockIds` (and the route's
  `data-preview-block-drafts` attribute) lists the blocks shown as drafts.
  The MCP's `cms_preview_url` asks for this by default.
- **Page width** (link only; thumbnails keep their layout): `viewport`
  (`mobile`, `medium`, `large`) renders a 420, 992 or 1280px page and
  simulates its breakpoints, as the page editor's canvases do
  (`edge/lib/cmsViewportClasses.js`), in any browser window, with fixed
  elements kept inside the page; `width` (320–2560) only sets the page
  width, breakpoints follow the window, and it is ignored when `viewport` is
  set. Without either, the page is 1600px wide.
- **Data Sources:** the payload's collection values include each block's
  Template v2 `dataSources` collections (the site record, posts,
  listings…), resolved on the server with the instance's query items and
  limit, as well as legacy `meta` collections, so token previews show them
  without a signed-in user.

### Checks that enforce this contract

Each Hub lists the tests in its own checkout under "This Hub". Shared:

- `node --test edge/tools/mcp/cms/test/*.test.js`

## Hub-managed agent connections

Shared source: `edge/functions/cmsAgentConnections.js`,
`edge/functions/cmsAgentKeys.js`, and `edge/tools/mcp/cms/src/agent-connections.js`.
The deployable Functions copies must match their Edge sources.

A signed-in operator creates a personal/device connection using
`cms-createAgentConnection` (`uid`, eligibility `orgId`, `name`,
`expiresInDays` 1–90, default 30). The eligibility org is not a stored grant
list. Current Hub roles determine every requested organization's access.
The connection credential (`cmsac.…`) is shown once; only its SHA-256 hash
and last-four hint are stored in top-level `agent-connections`.

`cms-listAgentConnections` lists one's own connections; Hub administrators
can list/revoke all. Only the creator can renew using
`cms-renewAgentConnection`. Renewal extends expiry without replacing the
credential. Revoked connections cannot be renewed; create a new connection.
Every callable requires authentication and an exact matching payload `uid`.

`cms-agentConnection` is an HTTP POST endpoint authenticated with the connection:

- `action: organizations`, optional `limit` 1–100 and `startAfter`: discover
  live organizations where the creator can write both sites and blocks.
  `nextStartAfter` pages the scanned organizations, including when the visible
  result is empty. Follow it until null; a page is not the full access list.
- `action: session`, explicit `orgId`, `scope` and optional `siteId`: issue a
  15-minute `cmsas.…` credential, capped at the parent connection's expiry.
  `scope: site` requires an existing site under that organization, and allows
  only its page and post operations, `site.update`, and its reads: preview,
  readiness, the page and post lists and outlines (`check`, `run`,
  `preview`, `readiness`, `pages`, `page`, `posts`, `post`; any other action
  is refused).
  `scope: organization` excludes site/page/post work and allows library/theme
  work and `site.create`. No session can publish or release.

Sessions are hashed in top-level `agent-sessions`. `expiresAt` remains an ISO
string for authentication and API responses; `expiresAtTimestamp` is a native
Firestore Timestamp for the same expiry, capped by the parent connection.
An operator can enable a Firestore TTL policy on `agent-sessions` collection
group field `expiresAtTimestamp` to remove expired records. No TTL policy is
enabled by this code, and TTL deletion is asynchronous; expiry checks remain
authoritative. Older records without the Timestamp need a backfill to be
covered by that policy.
The existing `cms-agentOperation` endpoint accepts session credentials and legacy
org-scoped `cmsak.…` keys. A connection credential cannot execute operations
itself. A session checks its parent revocation/expiry, creator, organization,
site scope and current CMS rights on every request, followed by the existing
operation-specific permission checks. Operation audit `agentKeyId` identifies
that session, `agentConnectionId` records its parent connection directly, and
`runBy` identifies the operator. These audit fields survive session cleanup.
Historical audit records may lack `agentConnectionId`.

The MCP config enables connections with `agentConnectionFile` or
`EDGE_CMS_AGENT_CONNECTION`; `agentConnectionEndpoint` otherwise follows
`agentEndpoint` with the `cms-agentConnection` handler name. There is no fallback
from a missing connection/session to a legacy key. Legacy setups without a
configured connection continue unchanged.

`cms_agent_organizations` discovers the live authorized org list.
`cms_open_session` names the job's explicit org/scope/site and returns an opaque
`sessionId` plus readable target names. Credentials never appear in tool output.
Check/run/preview/readiness and the page and post reads require that handle
in connection mode. Handles are
independent; no mutable global active target exists. Within 30 seconds of expiry,
the client obtains a new credential for precisely that handle's original target.
Restarting the MCP requires opening new handles, not copying organization keys.
Existing operation fingerprints/checksums and draft-only behavior remain in force.

The connection and read-only Firestore service-account credential are separate.
Generic Firestore reads retain configured path/tenant limits. They are not
filtered by the connection owner's roles; only the new discovery/session/write
flow uses current Hub permissions. Operators must still use read-only IAM and
appropriate read prefixes for their Hub.

### Remote MCP and sign-in

Shared source: `edge/functions/cmsAgentMcp.js` and
`edge/functions/cmsAgentOAuth.js` (copies in `functions/`; design in emd-cms
`docs/features/cms/remote-mcp-design.md`). `cms-agentMcp` serves the remote
CMS tools over Streamable HTTP. It accepts a `cmsac.…` connection credential,
or, once `CMS_AGENT_HUB_URL` is set, a `cmsat.…` access token from sign-in.
Either way every tool call runs through the connection sessions and
per-operation checks above. `cms_contract` serves the bundle in
`functions/agent-contracts/`, built by `node scripts/cms/sync-agent-contracts.mjs`
(`--check` fails while it is stale), with the Operations section generated and
`agent-contract-notes` applied.

Sign-in (`cms-agentOAuth`, issuer: the Hub's own origin, `CMS_AGENT_HUB_URL`):
each approval on `/app/agent-authorize` creates one grant, an
`agent-connections` document with `kind: "oauth"`, `scope: "cms-drafts"`,
`client` (`{ id, name, host }`), `redirectHost` and the refresh token's hash.
Grants last 30 days from the last refresh and at most 90 days from sign-in;
`verifyConnection` and renewal refuse them, and revoking one (Hub connections
or Connected agents) stops its tokens on the next request. Access tokens are
hashed in `agent-oauth-tokens` (1 hour), authorization codes in
`agent-oauth-codes` (single use, 5 minutes); both carry `expiresAtTimestamp`
for a TTL policy and are written only by Functions, so the rules don't
change.

## Related contracts

- `edge/docs/data-contracts/cms-blocks/README.md`: the block document
  `block.create` writes, the revisions `block.draft` writes, and the
  instance shape `page.placeBlock` copies.
- `edge/docs/data-contracts/cms-themes/README.md`: the names the theme and block
  operations enforce.
- `edge/docs/data-contracts/cms-posts/README.md`: the post documents the
  `post` area of a page template renders, and that the `post.*` operations
  write as drafts.
