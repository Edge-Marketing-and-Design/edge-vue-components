# CMS blocks data contract

Status: in use in every Hub, for every block the CMS places on a page or post.

Last verified: 2026-11-09, ad98f805

This contract covers library blocks, the block instances placed on pages and
posts, draft revisions, releases, propagation and the shared validation rules.
Pages, sites and their publication are in
`edge/docs/data-contracts/cms-sites-and-pages/`; posts in
`edge/docs/data-contracts/cms-posts/`.

The words below mean exactly this, here and in the skills:

- **Library block**: the document at `organizations/{orgId}/blocks/{blockId}`.
  It holds the released definition (template, schema with defaults, data
  sources) that pages copy from.
- **Instance**: a copy of a library block placed in a page's or post's
  `content`, with its own `values`. Published pages carry the definition
  inline; the public renderer reads instances from KV and never reads the
  library.
- **Synced**: a synced block shares one instance's values across a site's
  pages. It is placed without values; the first instance on a site is placed
  in the Hub, and later placements copy it.
- **Override**: an override block is one the public renderer replaces with a
  Vue component resolved from the block name. The CMS HTML is the editor
  preview and the fallback, and the block is the design source of truth for
  the component.
- **Draft and release**: an edit to an existing library block is a draft
  revision; library changes reach pages only through a release, which a
  developer runs in the Hub.
- **Site chrome**: the synced navigation and footer blocks every page of a
  site shares.

## Storage

| Documents | Path |
| --- | --- |
| Library blocks | `organizations/{orgId}/blocks/{blockId}` |
| Revisions | `organizations/{orgId}/blocks/{blockId}/revisions/{number}` (the id is the revision number as a string); the definitions a save replaces at `revisions/{number}/replaced/{autoId}` |
| Releases | `organizations/{orgId}/blockReleases/{releaseId}` (implicit releases use `implicit-{eventId}`), targets at `blockReleases/{releaseId}/targets/{sha1(path)}` |
| Instances | the `content` or `postContent` arrays of draft pages `organizations/{orgId}/sites/{siteId}/pages/{pageId}`, published pages `sites/{siteId}/published/{pageId}`, posts `sites/{siteId}/posts/{postId}` and `sites/{siteId}/published_posts/{postId}` |

The Hub writes library blocks from the browser through `edgeFirebase.storeDoc`
(full replace) or `changeDoc`; the wrapper adds `last_updated`, `uid` and
`doc_created_at`. New blocks are created with `storeDoc`. An edit to an
existing block writes only metadata to it; a changed definition goes to a
draft revision (Revisions, below).

## Fields

### Library block

The library block holds the **released** definition, the one pages use.

<!-- fields: library-block generated from CMS_DOCUMENT_FIELDS -->

Required on import means the Hub importer rejects a file without the field.
The importer fills in `templateVersion`, `template`, `schema` and
`dataSources` before it checks. Defaults come from
`edge/composables/useCmsNewDocs.js`.

Stored blocks can predate these requirements (blocks without `version` or
`values` exist in production). The Block Editor's export merges the defaults,
so exported copies re-import.

Block packages may add `docId`, `Instructions` and `aiInstructions`. These are
package conventions; the Hub does not require them. A package's manifest
carries each block's `design` entry, which the block repeats as
`meta.design`.

### Organization block tag list

`cmsBlockTags` on the organization document `organizations/{orgId}`: an
ordered string array, the tags library blocks in that organization may carry.

- **Missing or empty** means unrestricted: any tag, and the Block Editor
  accepts new ones.
- **The rule** (when set): every tag on a block is in the list, and a block
  has one or two content tags. `Quick Picks` marks the block picker's first
  view and is not a content tag. Tags name the generic kind of content
  (Hero, Content, Cards & Grids, Form...); what a block shows stays in its
  name.
- **Written** by organization admins in the Blocks library (Block Actions →
  Block Tags, `blockTagListDialog.vue`) with `changeDoc` on the organization
  document, under the generic rules for that document. The admin-only menu
  is UI visibility, not a rule. Editing the list never changes any block's
  tags; renaming or removing a tag in use shows how many blocks still carry
  it.
- **Read** from the organization snapshot the Hub keeps
  (`useCmsBlockTagList`), and by `block.create`, `block.draft` and
  `cms_audit_blocks` with one document read. It is never published or
  mirrored to KV.
- **Hub behavior** (`edge/lib/cmsBlockTags.js`): with a list, the Block
  Editor's Tags field offers the list in order and accepts no new tags; a
  block's own off-list tags show as "(not in the list)" until removed. The
  block picker opens on Quick Picks and offers the listed tags blocks carry,
  in list order. The library filter offers the list in order, plus "Not in
  list" while any block carries another tag.
- **Retag** (Block Actions → Retag Blocks, `blockRetagDialog.vue`,
  organization admins): applies a `{ blockId: tags }` mapping, pasted as
  JSON or as a mapping table with block ids in backticks and the tags in the
  fourth column. The preview lists the changes, blocks already tagged, ids
  not in the library, and rows whose tags break the rule; any such row
  disables Apply, and the list must exist. Apply writes only `tags` to each
  block with `changeDoc`, skips a block whose tags changed since the
  preview, and can be re-run.
- **Tags are metadata**: the Block Editor and an Overwrite import save them
  directly to the library block. A draft revision never holds them
  (`block.draft` ignores `definition.tags`), and a release never changes
  them.

### Schema inputs

Clicking the Block Editor's standalone preview opens inputs from that exact
working preview definition, including new unreleased schema fields and source
controls. Refresh the preview when template changes are pending; releasing a
revision is not required to test its inputs. Field ordering and rendered
defaults use the same definition. History previews likewise use their selected
snapshot, including an empty schema, rather than reviving released inputs.
These test values stay in the preview; they do not release or update the
library block or any page. Ordinary page instances still use released inputs.

Each input is `{ type, label, value, ... }`.

- **Types:** `text`, `textarea`, `richtext`, `number`, `image`, `option`,
  `publication` and `array`.
- **Arrays** carry an item `schema` and an array `value`.
- **Optional keys:** `validation` (`required`, `min`, `max`), `option`,
  `picker` (Input types, below) and `tags`.
- **Legacy `title`:** accepted and still read as the field label, but new
  blocks use `label`.
- **Alt text:** image inputs should have a paired `<field>Alt` input.

CMS image fields expose a small **Clear image** action at the far right of the
label row when a value is selected. Both shared schema inputs (including array
items) and legacy block image fields clear their editable value to `''` and
close the picker; normal Save/Cancel behavior applies. Clearing does not delete
the media record/file, change a paired alt-text field or change another image
field. The action is visible without hovering over the preview. Empty image
fields always show Select Image (including immediately after clearing); hover
overlays are used only when an existing image is present.

### Input types

The Block Editor presents friendly input types on top of the stored types
above. **Video** is one: its durable schema is a `richtext` input with
`picker: "video"`, so the value stays on the rich-text contract without a new
template-engine version, and the picker replaces the rich-text editor with the
shared video media picker.

```json
{
  "promoVideo": {
    "type": "richtext",
    "label": "Promo Video",
    "picker": "video",
    "value": "",
    "tags": ["Videos"]
  }
}
```

- **Stored value:** after Cloudflare Stream processing completes, selection
  stores a Stream `iframe` string in the block value. The iframe uses a
  trusted `cloudflarestream.com` or `videodelivery.net` HTTPS URL and
  carries `data-cms-video` (`player` or `background`), `title`, `allow` and
  `loading` attributes; a player also has `width`, `height` and
  `allowfullscreen`. The raw R2 video URL is never stored in the value.
  Values saved before playback options are a bare iframe and still render.
- **Playback options:** the picker stores the editor's choices in the iframe
  URL as Stream player parameters, so no other field changes: `autoplay`
  (with `preload=auto`), `muted` (Sound off), `loop`, `controls=false`,
  `startTime` and `poster` (a Stream thumbnail at a chosen second). The
  `background` layout forces autoplay, muted, loop and no controls, and wraps
  the iframe in an `aria-hidden` `div[data-cms-video-background]` that covers
  its nearest positioned ancestor, so the template must render it inside an
  element with `position: relative` (or another positioned element). A schema
  may set starting options for a new selection with `videoOptions`, for
  example `"videoOptions": { "layout": "background" }`.
- **Hidden-video guard:** each value ends with one inline
  `script[data-cms-video-guard]`. The public renderer runs block scripts, and
  the guard installs once per page: it reloads a player that becomes hidden
  (a pop-up closed without pausing), and drops autoplay from background
  videos for visitors who prefer reduced motion. The Hub preview does not run
  it.
- **Rendering:** templates render video values through the `richtext()`
  formatter, at the block root and inside manual array items:
  `{{ richtext(promoVideo) }}`, `{{ richtext(video.embed) }}`. A bare
  `{{ promoVideo }}` is unescaped only when the engine receives the field's
  schema as the flat string `"richtext"`: the Hub preview flattens root
  entries that way, the public renderer passes the stored object-shaped schema
  unchanged (so a bare root placeholder is HTML-escaped on the live site), and
  inside `{{#for}}` loops item schemas are not resolved in either renderer.
  `richtext()` inserts the value as trusted HTML whatever the schema.
- **Processing state:** uploads follow the R2-to-Cloudflare-Stream Function
  flow. A video without a trusted Stream preview or derivative URL is visible
  in the media manager but cannot be selected for a block; the picker stays
  open and asks the editor to wait.
- **Ownership:** `edge/components/cms/blockEditor.vue` maps the friendly type
  to the stored schema, `blockInput.vue` owns selection and the stored iframe,
  `mediaManager.vue` provides the video-only mode and `edge/lib/cmsVideo.js`
  validates Stream hosts and builds the iframe markup.

### Template v2 grammar the engine supports

- Conditionals use triple braces with JSON: `{{{#if {"cond":"a.b"} }}}`,
  `{{{#else}}}`, `{{{/if}}}`.
- Conditions support presence, comparisons (`==`, `!=`, `!==`, `>=`, and so
  on) and `contains`.
- They do **not** support `&&`, `||` or a leading `!`. The engine takes the
  `else` branch for those regardless of data. Nest positive conditions and
  put the content in `{{{#else}}}` instead.
- A condition tests `item` or the alias of a `{{#for}}` that encloses it.
  Outside every loop `item` is the block's values: test a field as
  `item.eyebrow`. Any other name (a bare `eyebrow`, or a name that is not an
  enclosing alias) is always false, so the `else` branch renders; the
  validator reports it as `grammar.condition-scope`. Inside a loop `item` and
  the alias are the current entry, so the block's own fields can't be tested
  there: move the condition outside the loop, or render the field in an
  element with `empty:hidden`. The validator warns with
  `grammar.condition-loop-item` when `item.<field>` inside a loop names one of
  the block's schema fields. Verified 2026-11-04 with
  `@edgedev/template-engine` 26.10.4 in the public renderer's engine, the Hub
  preview and the page editor canvas (`blockRender.vue`).
- A missing `{{{/if}}}` silently drops the rest of the enclosing content.

### Interactive collection helpers

Template-engine 26.11.1 adds generic collectionFilter, collectionOptions and a
paired collectionResults region inside the block's single template field.
Prefer these to custom filtering scripts or Vue overrides when selective,
bounded indexed filtering fits. Existing blocks stay unchanged until migrated.
A helper's `source` declaration activates its data source just as source() does;
validation and MCP source-use summaries recognize both. A results region owns
its loaded wrapper, so it does not require a separate `{{ loaded }}` class.

`dataSources.<name>.interactive` declares public `fields`, filter defaults
(`multiple: true` for arrays), optional `fallbackQueryItems`, `maxCandidates`
and `pageSize`. Optional `pagination: { mode: "server", pageParam, filterPrefix }`
uses API-managed pages and real page links. queryItems unions/deduplicates indexed
candidates; query applies AND conditions, then ordering, then the page slice.
Empty filter bindings omit their lookup/condition. No active lookup and no
fallback yields no candidates. Exceeding the explicit bound fails instead of
silently truncating; the engine ceiling is 2,000 candidates.

collectionOptions emits escaped dynamic option values/labels. `distinct` emits
unique sorted scalar choices, flattening one array level and dropping blank,
null and object values after any source limit; it provides no counts.
text-contains/text-starts-with are case-insensitive candidate filters, not an
unbounded search. Only declared public interactive.fields are sent to results.
Controls and authored `{{ loading }}` skeletons stay outside the results region.
The region exposes items, total, page and pages. Normal condition scoping still
applies: use `item.total == 0` outside its item loop. No nested CMS block render
or additional source lookup is allowed inside that isolated results region.

The public frontend owns its interactive controller, filter/page URL handling,
Back/Forward, bounded browser cache and no-store API; the Hub engine upgrade
alone does not install these into the editor. The editor canvas renders options
and initial results from already loaded, authorized source records, using native
engine selection/filter/order/page and conditional rules. Its bounded static
snapshot does not install the controller/API. Distinct source loading returns
sorted unique scalar choices in KV and the Firestore emulator. The editor also
projects raw records from older deployed preview loaders without projecting
already-scalar choices twice. Other
placeholder-only rendering still fetches no helper KV and may show busy results.
Public interaction and draft-editor parity are separate acceptance checks.
Confirm frontend deployment readiness before a person publishes migrated blocks.

A complete configuration plus its one-template example, all helper signatures,
limits, cache/event behavior and verification steps are in
[interactive collections](../../../skills/edge-block-package/reference/interactive-collections.md).
The existing grammar's condition rule remains verified with engine 26.11.1.

### Block instance

Rows reference instances by `id` in `structure`/`postStructure`:
`[{ id, columns: [{ id, span, blocks: [instanceId] }] }]`. Each document also
keeps a derived `blockIds` array of library ids, which the propagation trigger
queries.

<!-- fields: block-instance generated from CMS_DOCUMENT_FIELDS -->

`useForCustomPost` is an optional instance-owned boolean on a custom type's
Detail blocks. Only explicit `true` includes that placement in the entry form;
it is not a library definition or a synced value. The Detail page still renders
every placement. Its checkbox is staged with the block's normal Save/Cancel,
and marked blocks show sample-post preview instead of page-owned content inputs.
The posts contract describes field discovery and preservation of inactive data.

### Revision

Writing a revision doesn't trigger `blockUpdated`, and history tracking
doesn't record it.

<!-- fields: revision generated from CMS_DOCUMENT_FIELDS -->

A replaced definition (`revisions/{number}/replaced/{autoId}`) carries
`definition`, `source`, `savedBy`, `savedAt`, `replacedBy`,
`replacedBySource` and `replacedAt`. Nothing a save replaces is lost.

### Release

A release applies one revision to every document that holds the block. It is
the only way a definition reaches pages.

<!-- fields: release generated from CMS_DOCUMENT_FIELDS -->

Targets are `{ path, siteId, collection, docId, status, outcome, attempts, error }`:
`status` is `pending`, `done`, `skipped` or `failed`; `outcome` is
`updated`, `skipped` (no instance, or already at the revision) or `missing`.
Targets are the drafts and published copies of pages and posts on every site,
plus the templates site's drafts.

The Block Releases dialog counts only real sites in the active organization;
the reserved `templates` site is not offered as a canary destination. With one
real site, Where shows that site's name as read-only text and an ordinary release
omits `siteIds`, preserving full-release/library promotion and template
propagation. With multiple sites it offers All sites in this organization or
Selected sites (canary), alongside the organization name. Loading/zero-site
states cannot start a release. Explicit rollback of an existing canary retains
its original site scope, even if only one real site remains. Templates can still
appear in outcome/history reports because full releases continue to update them.
These are client presentation/selection rules, not new backend permissions or
changes to persisted release scopes.

For a revision whose definition has `isOverrideBlock: true`, release content
checks are intentionally bypassed: no CMS markup/template/script validation,
theme warnings, schema compatibility checks, required-content-field removal
checks or per-instance renders. Such blocks are CMS placeholders for
renderer-owned Vue components; the checkbox is the intended rendering contract,
not a guarantee that the component exists. Creating a missing Vue component or
unchecking the flag is the developer's responsibility. These release checks do
not validate that component. The saved-block editor panel uses the same override
exemption; import validation is unchanged.

Override check results retain the usual result shape and instance total, with
`status: passed`, empty findings/schema changes and zero renders/unchecked
instances, plus `contentChecksSkipped: override`. The marker is retained in
stored check summaries and the dialog explicitly labels the skipped content
checks instead of claiming content validation succeeded. Permissions, revision
and checksum conflicts, canary scope, target planning, worker propagation,
idempotency and outcome reporting still apply. The revision being released
decides the exemption, not the current library block: unchecking or removing
the flag restores normal checks, including when rolling back or promoting.

For non-override revisions, release theme-name warnings use the themes of the actual planned destinations.
Draft pages/posts use `sites/{siteId}.theme`; published pages/posts use
`published-site-settings/{siteId}.theme`. Both reference the same live organization
theme document, since themes have no published snapshot. Custom color/font/radius
names declared in the applicable theme's top-level or `extend` groups are valid;
being outside the standard token set alone does not warn for that target.
Missing names are warnings with `siteId`, `themeId`, `themeName`, `context`
(draft/published/template/library), `targetPath` and field `path: template`, so
the grouped report identifies affected site/documents. Missing/malformed themes
report inability to verify, not compatibility. Template targets use the block's
declared themes when present, not an invented website theme. A definition with
no resolvable target/declared theme retains generic portability warnings.
Raw-color/opacity warnings and validation errors remain unchanged. Summarized
checks retain the existing finding cap and counts; these fields are additive to
the stored release check result, not new permission grants or propagation rules.

## Public projection

Published pages and posts carry block definitions inline in their instances.
The public renderer (`emd-cms-front`) reads those documents from KV (the
`pages:{orgId}:{siteId}:{pageId}` and `posts:{orgId}:{siteId}:{postId}`
datasets) and never reads library blocks. It
resolves overrides by instance `name`, organization folder and theme, and runs
inline block scripts once per route. This is deliberate; see the accepted
[inline block architectural decision](../../engineering/cms-inline-block-architecture.md)
for the performance rationale and propagation trade-offs.

## Consumers

- **Hub:**
  - `edge/components/cms/blocksManager.vue` (import, export; Overwrite saves
    a draft revision);
  - `blockEditor.vue` (edit, checks, rename guard, draft revisions, tag
    options);
  - `edge/lib/cmsBlockRevisionClient.js` (loading and saving draft
    revisions);
  - `blockPicker.vue` (placement);
  - `blockTagListDialog.vue`, `blockRetagDialog.vue` and
    `edge/lib/cmsBlockTags.js` (the organization block tag list, the
    retag, and the tag options);
  - `page.vue` and `posts.vue` (instances, publication);
  - `block.vue` (preview; `isOverrideBlock` badge; the inline library
    content editor saves a draft revision).
- **Functions:**
  - `blockUpdated`, `onPageUpdated` and `syncPublishedSyncedBlocks`
    (`functions/cms.js`);
  - `cms-saveBlockDraft` and `cms-discardBlockDraft`
    (`functions/cmsBlockRevisions.js`);
  - `cms-dryRunBlockRelease`, `cms-executeBlockRelease`,
    `cms-retryBlockRelease`, `cms-blockRevisionUsage` and
    `cms-blockReleaseWorker` (`functions/cmsBlockReleases.js`);
  - the page and post KV mirrors.
- **Public renderer:** `emd-cms-front` renders instances from KV.
- **Agents and tooling:** the CMS MCP (`edge/tools/mcp/cms`: `cms_validate`,
  `cms_audit_blocks`, `cms_block_base`), the `block.create` and
  `block.draft` operations (`edge/docs/data-contracts/cms-operations/`), and block
  import packages under `importfiles/`.

The validator, import, editor, picker, revision and release UI code live in
the shared `edge/` subtree. The trigger, revision and release Functions and
their helpers are shared between `functions/` and `edge/functions/` and stay
byte-identical; the definition and metadata split lives in
`edge/lib/cmsBlockRevisions.js` with copies at `edge/functions/helpers/` and
`functions/helpers/` (`cmsBlockRevisions.mjs`), and
`tests/cmsBlockRevisions.test.mjs` enforces it.

### Template editor readability

Opening a single-line template in the Block Editor formats only its editor
display. CMS tokens are masked while HTML is indented, then restored exactly;
non-whitespace changes are rejected. Existing multiline source is left alone.
This uses the installed Monaco public `editor.createWebWorker` API with the
HTML worker module and language createData. It initializes the HTML service
with `getProxy()` before `withSyncedResources()`, matching the bundled HTML
WorkerManager. It does not import a version-specific internal worker path.

Opening a block does not change saved content, preview source, or dirty state.
A real edit emits the formatted markup; undoing back to the formatted baseline
restores the original source. Field/loop selection offsets map back to the
original source until an edit is made. Formatting failures preserve the source
and log a warning rather than modifying a template.

## Invariants and validation codes

### Revisions

Only two Cloud Functions callables write revisions and the pointer fields.
Both require block write permission in the organization (`permissionCheck`):

- **`cms-saveBlockDraft`** `{ orgId, blockId, definition, source, baseRevision, baseHash }`.
  In one transaction it creates revision 0 from the live definition if it
  doesn't exist, creates or updates the single draft, and sets
  `draftRevision`. A definition equal to the released one discards any open
  draft instead. If the block was released after `baseRevision`, the save is
  refused (`failed-precondition`).
  - **`baseHash` (required)** is the fingerprint (`blockDefinitionHash`) of
    the definition the caller started from: the open draft if there was one,
    otherwise the released block. If the current one differs, the save is
    refused with `failed-precondition` and `details`:
    `{ reason: 'base-changed', currentHash, releasedRevision, draftRevision,
    draftSource, draftUpdatedBy, draftUpdatedAt, wouldReplace }`. Saving
    again with `currentHash` replaces the newer version deliberately.
  - Saving exactly the current draft again returns `unchanged` whatever the
    base, so a repeated save is harmless.
  - Updating an open draft first copies the definition it replaces to
    `revisions/{number}/replaced/{autoId}`.
  - **Partial definitions** (`completeBlockDefinition`): a draft is the
    block's whole definition, because a release copies it field by field
    and deletes the fields it lacks. A save that leaves a definition field
    out keeps the base's value (the open draft, else the released block);
    `null` removes a field on purpose. For Template v2, a save without
    `template` stores its `content` as the template (never the base's older
    template).
- **`cms-discardBlockDraft`** `{ orgId, blockId, draftRevision, baseHash }`
  discards the named draft only if it is still the open one and its
  fingerprint still equals `baseHash` (the draft wasn't saved again since the
  caller loaded it); otherwise `failed-precondition` with the same
  `details`.
- **Exported block files** carry `cmsRevisionBase`
  `{ hash, releasedRevision, draftRevision, exportedAt }`. Import removes it
  before anything else and sends `hash` as the Overwrite base, so a file
  made before later changes to the block is caught. A file without it that
  doesn't match an open draft asks before replacing that draft.

Definitions compare independent of key order. Empty editor defaults (`{}`
objects, a blank Template v1 `template`, `isOverrideBlock: false`, a
`templateVersion` other than 2) count as missing, so opening and saving a
block unchanged creates no draft.

### Releases

- **Every release callable** accepts an optional `siteIds` (1–100) for a
  site-scoped release.
- **`cms-dryRunBlockRelease`** `{ orgId, blockId, revisionNumber }`. Needs
  block write permission and writes nothing. Returns `kind`,
  `releasedRevision`, `activeReleaseRunning`, target counts per site and
  collection, `checks`, `blocked` (the reason execute would refuse, or `''`)
  and a `checksum`. `targets.pages` and `targets.posts` count unique
  `(siteId, docId)` pairs across draft and published copies; per-site entries
  carry the same counts; `targets.total` is the document count;
  `targets.documents` lists `{ path, siteId, collection, docId }` for the
  first 2,000 targets, with `detailsTruncated`; totals always include every
  target. `breakingConfirmationRequired` identifies a block reason that
  explicit confirmation can clear, without overriding canary conflicts or
  active releases.
- **`cms-executeBlockRelease`** `{ orgId, blockId, revisionNumber, checksum, confirmBreaking }`.
  Needs organization admin (`assign`). It re-runs the checks, and is refused
  if:
  - the checksum is stale (including an edit to the revision's definition
    after the dry run), the block was released since, or another release is
    running. The claim re-checks the definition, so a draft saved while an
    execute is in flight is refused instead of released;
  - a new revision's checks are `blocked`;
  - they are `breaking` without `confirmBreaking: true`.
  Rollback and reapply are never blocked by checks.
- **Release checks** (`edge/lib/cmsBlockReleaseChecks.js`, with
  byte-identical Functions copies) produce `{ status, counts, errors,
  warnings, instanceFailures, breaking, schemaChanges }`:
  - **What is checked** is what the release will store: the revision's
    definition, with no definition field taken from the released block.
  - **`release.field-removed`:** the revision lacks a definition field the
    released block has. An error (blocks the release) for `content`,
    `values`, and `template` on Template v2; a warning for any other field.
  - **`status`:** `blocked` (validator errors or instance render failures),
    `breaking`, `warnings` or `passed`;
  - **the validator** requires only `name` and `content` here;
  - **instances** render once per distinct value set, up to 500;
  - **schema changes:** removing or retyping a field (including array item
    fields) is breaking, and lists the instances holding a value in it.
    Adding a field is not.
  - **`detailsTruncated`:** findings or affected-instance detail arrays were
    capped (50 each). UI groups show the reported sample, not full totals.
- **One canary at a time:** a site-scoped release of a different revision
  is refused while a canary is live.
- **`cms-blockRevisionUsage`** `{ orgId, blockId }`. Needs block write
  permission. Per site, it counts draft and published instances by
  `blockRevision` (`unversioned` when missing; never treated as revision
  zero), and returns `releasedRevision` and `canary`. Each site also
  includes up to 200 document summaries `{ path, docId, collection, name,
  revisions }` and `detailsTruncated`; instance revision totals stay
  complete. Propagation reports read existing target records on demand (up
  to 2,000).
- **`cms-retryBlockRelease`** `{ orgId, releaseId }`. Needs organization
  admin. Re-queues failed targets and resumes a release that still owns the
  block.
- **Worker:** `cms-blockReleaseWorker` on Pub/Sub topic `cms-block-release`
  (`{ orgId, releaseId }`), 50 targets per message, one transaction per
  target. When nothing is pending it finalizes: the library block takes the
  definition, `releasedRevision`, `lastReleaseId` and `blockUpdatedAt`, and
  clears `activeReleaseId`; the revision becomes `released` and the previous
  one `superseded`. It finalizes the same way when some targets failed
  (status `partial`): the library block moves to the new revision, and only
  the failed documents keep the previous one until `cms-retryBlockRelease`
  re-queues them.

### Propagation

Updating a library block runs `blockUpdated` (`functions/cms.js`). Definition
changes reach every page automatically, but always through a release. The
page updates are made by the release worker
(`functions/helpers/cmsBlockPropagation.js`).

- The Hub writes definitions only through releases. A write that changes
  `lastReleaseId` is the worker's own and is ignored. Any other definition
  write (the Firebase console, an older client, the `history-restoreHistory`
  callable) starts an **implicit release** of a new `implicit` revision. It
  is tracked and resumable, but unchecked.
- Implicit events compare their definition against the current library block
  before target preparation and again inside the ownership transaction.
  A mismatched event is ignored without creating a revision or claiming
  `activeReleaseId`. The comparison uses normalized definition equality,
  ignoring key order, empty defaults and non-definition metadata.
  Each implicit target transaction and finalization repeats this comparison.
  A newer direct save stops the old worker with existing `superseded` release
  and revision statuses; it clears ownership only if that release still owns
  the block, never overwrites the newer library definition, and never clears
  another release's pointer. Already committed targets remain until the newer
  release updates them. Explicit release/canary behavior is unchanged.
- It does nothing unless the propagated definition changed. It compares the
  before and after documents, ignoring key order: `BLOCK_DEFINITION_SYNC_FIELDS`
  except `blockUpdatedAt`, and `meta` without the per-entry keys instances
  keep for themselves (`limit`) and without the library-only `meta.design`.
  Edits to `name`, `tags`, `themes`, `type` or `previewType`, a change to
  `meta.design` alone, and re-saves that only stamp `blockUpdatedAt`, write
  nothing and don't bump page versions.
- Each updated instance gets `blockRevision`, the revision it now holds.
- It scans every site in the organization, plus the `templates` site, and
  queries `pages`, `posts`, `published` and `published_posts`
  **separately** by `blockIds`.
- Inside a transaction per document, it copies `BLOCK_DEFINITION_SYNC_FIELDS`
  into each matching instance: `content`, `template`, `templateVersion`,
  `schema`, `dataSources`, `isOverrideBlock` and `blockUpdatedAt`. It
  removes a field from the instance when the library block no longer has it
  (`content` excepted). Library `meta` entries are merged into the instance's `meta`
  except `design`.
- Draft page versions and published page versions advance independently. A
  published update also writes `pageVersions` on the site and on
  `published-site-settings`.
- Published copies on the `templates` site are not updated, and unpublished
  draft edits are never copied into published documents.
- Instance `values` are preserved. The exceptions are publication inputs,
  which are reconciled to processed page images, and newly added schema
  fields, which receive their declared defaults
  (`functions/helpers/cmsPublicationValues.js`).

### Validation

`edge/lib/cmsBlockValidation.js` is the shared validator. It is a pure
module, and the caller supplies the template engine. Its callers are Hub block
import (`blocksManager.vue`), block editor checks (`blockEditor.vue`), the
CMS operations, `scripts/cms/validate-import.mjs` and the CMS MCP
(`cms_validate`, `cms_audit_blocks`).

Each finding is `{ code, severity, path, message }`, and codes are stable.

The editor's advisory panel wraps validation through `cmsBlockEditorChecks.js`.
It reruns after a successful save and never blocks saving. Override blocks skip
content validation and explicitly display that their Vue component was not
validated. Non-overrides retain syntax, lifecycle, schema and other shared
checks. Theme-name advice uses the same contextual warning function as releases,
but checks the saved block's allowed themes rather than destination-site themes.
Custom colors/fonts/radii defined in an allowed theme do not warn for that theme;
missing names identify the affected theme. No allowed themes retains generic
portability advice; unavailable themes report uncertainty. Unrelated organization
themes do not affect the result. The marker `contentChecksSkipped: override` in
this panel is local-only and is not written to the block document.

**Tag rules:** Hub import, the Block Editor checks, `block.create`,
`block.draft` (on the tags the block carries) and `cms_audit_blocks` pass the
organization's list. `BLOCK_TAG_RULE_SEVERITY` in the validator sets both
tag codes' severity: `warning` while existing blocks still carry other tags,
so they import and save; `error` makes import and the operations refuse them.

**Import:** shared-validator errors reject a file before any write, and
warnings never block (`ENFORCE_SHARED_BLOCK_VALIDATION` in
`edge/lib/cmsBlockImport.js`). A rejected file's error carries its findings
as `issues`. The importer's own hard failures also apply: a missing required
key, a non-object document, an invalid `type`, a non-array `themes`.

**Render checks:** the template renders with its schema defaults. Blocks with
Data Sources render twice: once with empty sources, and once with generated
sample records built from the fields each loop body references. Loops the
generator cannot model are reported as unverified, never as passed.

<!-- validation codes: generated from BLOCK_VALIDATION_CODES -->

### Checks that enforce this contract

Each Hub lists the tests in its own checkout under "This Hub". Shared:

- `node --test edge/tools/mcp/cms/test/*.test.js`
- `cms_audit_blocks`, a read-only production audit. Its report is written
  under `.tmp/cms-block-audits/`.

## Related contracts

- `edge/docs/data-contracts/cms-operations/README.md`: `block.create` and
  `block.draft`, the readiness codes that read blocks.
- `edge/docs/data-contracts/cms-themes/README.md`: the theme names blocks use and
  the codes that enforce them.
- `edge/docs/data-contracts/cms-sites-and-pages/README.md`: the page and site
  documents that hold instances, and their KV datasets.
- `edge/docs/data-contracts/cms-posts/README.md`: post documents and their KV
  dataset.

### Saved draft data in the Hub canvas

CMS canvas collection sources load authorized Firestore records, not published
KV. Site lookups show saved draft settings and menus; post lookups show saved
draft posts. Keep the authored source configuration pointed at the published
delivery contract: the Hub handles draft loading without changing the block.
This is a visual preview, not a functional public-site runtime. Use the frontend
preview links for interaction testing. Unsaved settings are not included.
