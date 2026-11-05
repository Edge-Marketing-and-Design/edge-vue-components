# CMS posts data contract

Status: in use for every post and event a site publishes.

Last verified: 2026-11-04, custom-post label and access regression tests

A post is a dated entry (a post or an event) that a post template page
renders under its route. Drafts live with the site; publishing copies a
draft into a published collection the public renderer reads from KV. This
contract covers the post document, its published snapshot, scheduling, the
`posts:` KV dataset and how post blocks read it. The page that renders posts
is in `edge/docs/data-contracts/cms-sites-and-pages/`; the blocks in
`edge/docs/data-contracts/cms-blocks/`.

## Storage

| Documents | Path |
| --- | --- |
| Draft posts | `organizations/{orgId}/sites/{siteId}/posts/{postId}` |
| Published posts | `organizations/{orgId}/sites/{siteId}/published_posts/{postId}` (the same id as the draft) |

The Hub's post editor (`edge/components/cms/posts.vue`) writes both through
`edgeFirebase.storeDoc` and `changeDoc`; the wrapper adds `last_updated`,
`uid` and `doc_created_at`. The scheduled publisher, and a Hub's own
importer where it has one, write them from the Functions. The CMS operations (`post.*`,
`edge/docs/data-contracts/cms-operations/README.md`) write drafts only, shaped as
the editor saves them.

## Fields

<!-- fields: post generated from CMS_DOCUMENT_FIELDS -->

`hidePublishedDate` (boolean, optional) is `true` when the post's
publication date is not public. Its `publishedAt` and `doc_created_at` are
then ordering-only values: no date is shown and the JSON-LD has no
`datePublished`/`dateModified`. There is no editor control; an importer or a
backfill script sets it. Operations never write it.

The published snapshot is the draft with its synced instances resolved to
the library's current definition, `publishAt` and `publishAtTimezone`
removed, and `publishedAt` and `doc_created_at` set to the configured public
publication date/time.

## Public projection

### Publishing

- **Publish now** (`posts.vue` `publishPost`): the saved draft is resolved
  and stored as `published_posts/{postId}` using the edited publication date,
  otherwise the scheduled or existing publication date, otherwise the current
  time. The draft takes the same `publishedAt` and `doc_created_at` and loses
  its schedule.
- **Publish at** (`publishPostAt`, or a saved `publishAt`): the same, with
  the chosen time as the public publication date/time. `publishScheduledPosts` runs
  every minute over every site's `posts` and publishes each draft whose
  `publishAt` has passed; a draft that cannot be published keeps the reason
  in `publishAtError` and loses its schedule.
- **Unpublish** removes the snapshot only. **Delete** removes the snapshot,
  then the draft.
- The snapshot's existence is the publication state. The Hub shows
  **Published (Unpublished Changes)** when the saved draft, resolved the same
  way as publication, differs from the snapshot; `publishedAt` and
  timestamps are metadata and do not count as changes
  (`tests/cmsPostPublishStatus.test.mjs`).
- **Past events:** `syncPastPublishedEvents` runs every minute over every
  site's `published_posts`, keeps `event.isPast` current on the snapshot and
  the draft, and deletes the snapshot of an event that has ended while
  `event.unpublishPastEvent` is true. Publishing such an event is refused in
  the Hub and by the scheduler.

### KV dataset

`onPostWritten` (`functions/cms.js`) mirrors every snapshot write.

| Key | Value |
| --- | --- |
| `posts:{orgId}:{siteId}:{postId}` | The published post document, serialized as stored |
| `idx:posts:name:{orgId}:{siteId}:{name}` | Direct lookup by slug |
| `idx:posts:tags:{orgId}:{siteId}:{slug(tag)}:{postId}` | One per tag |
| `idx:posts:type:{orgId}:{siteId}:{type}:{postId}` | `post` or `event` |
| `idx:posts:dates:{orgId}:{siteId}:{yyyyMM}:{postId}` | Archive bucket of `publishedAt` (else `doc_created_at`) |
| `idx:posts:startAt:…`, `idx:posts:endAt:…`, `idx:posts:isPast:…` and the `event.`-prefixed twins | Event start, end (ISO strings) and `true`/`false` |

Index metadata, the fields a list renders without a canonical read:
`title`, `blurb`, `name`, `type`, `featuredImage`, `doc_created_at`,
`event.{startAt,endAt,isPast,locationName}`, `hidePublishedDate` (only when
`true`) and `tags`, with tags dropped
from the end until the metadata fits KV's 1,024-byte limit
(`functions/helpers/cmsPostKvMetadata.js`). `cms-reindexPublishedPostsToKv` (any
signed-in Hub user) rewrites every snapshot's keys.

### What the renderer reads

A post template page (`post: true`) serves `/{page-slug}/{post-name}` from its
`postContent`. Blocks read the dataset as a Template v2 collection source
with `path: "posts"` and `uniqueKey: "{orgId}:{siteId}"`:

- **Lists** query the indexes (`type`, `tags`, month buckets, event fields),
  order by `doc_created_at` and read the index metadata; a card links to
  `{{ basePath }}/{{ post.name }}`.
- **Detail blocks** (`type: ["Post"]`) look the post up with
  `queryItems: { name: "{routeLastSegment}" }`, `limit: 1`, and render the
  body with `{{{#renderBlocks {"field":"post"} }}}`, which draws the post's
  own rows from Post-typed blocks. The body block never holds article text.
- The post view's SEO comes from the page's `postMetaTitle`,
  `postMetaDescription` and `postStructuredData` with the post's own tokens.
  Use `{{publishedAt}}` (ISO 8601) for `datePublished`; `{{doc_created_at}}`
  is milliseconds. For a post with `hidePublishedDate`, emd-cms-front removes
  `datePublished` and `dateModified` from the post structured data
  (`shared/cmsPostStructuredData.js`). It reads the flag from the route's
  merged token data, whose first post record is the post-content renderer's
  own post; a post template with another top-level block listing posts could
  supply the flag from a different post.
- Date surfaces hide the date with
  `{{{#if {"cond":"post.hidePublishedDate"} }}}{{{#else}}}…{{{/if}}}` (`item.`
  in a post's own blocks); list blocks read the full record through
  `canonical: true`, and metadata-only lists read the index metadata flag.

The field names and the listing and detail sources are spelled out in the
`edge-block-package` skill's `reference/posts-contract.md`.

## Consumers

- **Hub:** `edge/components/cms/posts.vue` (editor, publish, schedule,
  unpublish, status), `page.vue` (post template pages, the post preview
  surface), `edge/lib/cmsPostRoutes.js` and `cmsPostStructure.js`.
- **Functions** (`functions/cms.js` and its `edge/functions/` copy):
  `onPostWritten`, `publishScheduledPosts`, `syncPastPublishedEvents`,
  `cms-reindexPublishedPostsToKv`, the release worker (post drafts and
  snapshots are release targets), `cms-getPreviewRenderPayload` (post
  collections for previews). A Hub's own importers are in its "This Hub"
  section.
- **Public renderer:** `emd-cms-front` reads the `posts:` dataset through
  block Data Sources.
- **Agents and tooling:** the CMS operations read posts (`cms-agentOperation`
  actions `posts` and `post`; the MCP's `cms_list_posts` and `cms_get_post`)
  and write draft posts (`post.create`, `post.update`, `post.placeBlock`,
  `post.setValues`, `post.moveBlock`, `post.removeBlock`), never
  `published_posts` or the publication fields; see
  `edge/docs/data-contracts/cms-operations/README.md`. The MCP's
  `cms_find_usage` scans `posts` and `published_posts` for a block's
  instances. The readiness report counts posts as pages' targets; the
  `edge-block-package` and `vue-to-block-migrator` skills author post
  blocks.

## Invariants and validation codes

- **Required:** `name`, `title` and `blurb` (at most 500 characters) on
  every save.
- **Slugs** are unique within the site's posts and are generated from the
  title until edited.
- **Events** carry computed `startAtUtc`, `endAtUtc` and `isPast`; an event
  that has ended cannot be published while `unpublishPastEvent` is true, and
  its snapshot is removed when it ends.
- **Publication date:** the draft and snapshot share `publishedAt` and
  `doc_created_at`. Manual publication uses the edited publication date,
  otherwise the scheduled or existing publication date, otherwise the current
  time. Scheduled publication uses its scheduled time; published imports use
  their import-publication time. Republishing a hidden-date post keeps its
  ordering-only date. Snapshots omit `publishAt` and
  `publishAtTimezone`.
- **Snapshots are full copies** with synced instances resolved; a release
  updates both the draft and the snapshot (`edge/docs/data-contracts/cms-blocks/`,
  Releases) and raises no page version for posts.
- **Template columns** carry `span: 6` for a full-width column; a `null`
  span renders at one sixth in the public template engine. Rows the post
  editor adds (`createPostRow`) carry `span: 12` and `mobileOrder: 0`; the
  editor's grid clamps 12 to the full six columns. A post made from a
  template keeps the template's rows.
- **Imported posts** keep their `legacyBlog` audit fields through edits and
  republishing.
- The readiness report's `page.*` codes apply to post template pages; the
  block checks' `page.*` codes cover post template scaffolds
  (`validatePageDocument`).

### Checks that enforce this contract

Each Hub lists the tests in its own checkout under "This Hub". Shared:

- `node --test edge/tools/mcp/cms/test/*.test.js`

## Related contracts

- `edge/docs/data-contracts/cms-sites-and-pages/README.md`: the post template
  page, its `postContent` and SEO fields.
- `edge/docs/data-contracts/cms-blocks/README.md`: the instances a post holds,
  releases and the block checks.
- `edge/docs/data-contracts/cms-operations/README.md`: the readiness report, the
  post reads and the draft-only `post.*` operations.

## Page-defined custom post types

An ordinary site's index/detail page (`post: true`) can opt into
`postType: { enabled: true, icon: 'BookOpen' }`. Its stable page ID identifies
the type. The site-local Content sidebar uses the first nonempty matching
`menuTitle` in the saved site menus (including folders and Not In Menu),
falling back to the page name or ID. Display labels do not change the page's
route slug or type identity. It shows its selected supported icon and a
filtered list. Add New goes directly
to a values-only editor built from that page's detail blocks/structure. The
normal Posts editor continues handling existing copied-layout posts/events.

When site restrictions are enabled, the custom editor's Access dropdown uses
a nonempty UI-only value for Public, mapped to an empty `restrictionRuleId`
in the working document. Existing rule IDs pass through unchanged; the UI
value is never stored as a restriction.

Custom post drafts use the same `posts` collection and published snapshots use
`published_posts`. Additive fields:

- `postTypeId`: the defining page ID in this same site.
- `type`: `custom-` followed by the defining-page ID UTF-8 bytes encoded as
  unpadded lowercase base32. This keeps case-distinct IDs distinct through existing
  lowercase/slug-based `idx:posts:type` readers. Labels never define identity.
- `postTypeSchema`: a compact versioned fingerprint of the editable schema,
  used to reject saves/publication against incompatible detail definitions.
- Content values live at their named paths on the post itself, alongside the
  standard title, slug, blurb, tags, image, restriction and publication fields.
  No page `content`, `structure`, block definitions, templates or data sources
  are copied onto a custom post.
- `postTypeProjection` on a published snapshot: `{ fields, schema }`, the index
  page's compiled post dependencies and detail schema signature. This allows
  the normal post mirror to include dynamic values in index metadata without
  changing the public renderer's post-source contract.

Detail block schemas define editable text, richtext, image, number, boolean,
option and repeated content fields. `postField` optionally binds a local schema
field to a semantic post path; otherwise its schema key is the field identity.
`editable: false` and `private: true` fields are not editable. Post-source field
references in detail templates supply additional inferred fields. Page-owned
layout/theme/source configuration, bookkeeping and permission fields cannot
be stored as content paths. Existing values remain stored if a schema changes;
incompatible changes block saving/publication until explicitly resolved.

The Hub prepares the inline detail template using the engine's existing
`source("posts")` loop, canonical lookup, route slug and type filter. Explicit
record bindings avoid block defaults overriding the post's values. No frontend
or template-engine package changes are required. Manual and scheduled
publication validate against the published defining page; publication fails
with a visible reason if the page/type/schema is unavailable or incompatible.
History, compare, draft restore, discard, scheduling and unpublish remain source
versus snapshot operations. No migration/backfill of legacy posts is performed.

### Type-specific index metadata

`cmsPostTypes` compiles post-source dependencies from template expressions,
conditionals, loops, nested arrays and source sort/query field declarations.
Computed field names fail explicitly rather than omitting data. Private detail
fields cannot be index dependencies. The usual routing/order metadata envelope
is retained; only referenced dynamic post values are added. Required values
are never truncated: the exact UTF-8 envelope, including `canonical`, must fit
KV's 1,024-byte limit. Use existing canonical post lookups for larger cards.

`cms-refreshPostTypeMetadata` handles published-page writes with Firestore
retries. It skips unchanged projections, scans only that site's published posts
with the matching `postTypeId`, and uses paginated reads and per-post
transactions. Each transaction rereads the current published page and snapshot;
old events cannot restore an older projection or resurrect unpublished posts.
Already-current projections are skipped, so retries resume safely. It writes
only `postTypeProjection` on affected snapshots; the existing mirror provides
stale-source guards, retries and public collection-cache invalidation. Drafts
and unrelated types/sites are untouched. Progress/completion are recorded in
Function logs. KV convergence remains eventual. Custom post sources use existing canonical
reads, keeping cards usable while metadata converges; this does not add any
request-time block-library lookups.

### Sitemap controls

Site Settings owns the sitemap preferences and generated entries. See the
site/page contract's post-sitemap section. There are no sitemap hooks on post
publication, and no automatic enabling based on whether posts exist.


### Custom event entries and editor controls

A defining index/detail page may set `postType.event: true`. Its entries retain
`postTypeId` and their existing `custom-…` type index; they do not become the
shared `event` type. `event` is an independent standard post envelope with the
same dates, IANA timezone, location/virtual flag, registration/meeting URL,
capacity, status and `unpublishPastEvent` fields as regular events. The shared
normalizer computes UTC dates and `isPast`; custom event saves require valid
start/end dates, an end after the start, and location details for in-person
entries. Event fields are edited through Event Details, not inferred as text
fields from the page template. Turning the page's event option off removes the
event envelope on the next entry save; it does not rewrite existing records.

The existing scheduled publication guard and past-event job include custom
entries carrying event data, while preserving their custom type index. With
`unpublishPastEvent` enabled, publication at/after the end time is refused and
published past events are removed through the existing job. Standard posts
and regular events retain their existing publication behavior.

Both editors use the same Publishing panel in a dialog opened from the top
bar. It includes publication status, last-published date, Publish At,
Publish Now, Schedule Publish, clearing a schedule, and Unpublish. Event Details
uses a separate dialog; changes remain part of the unsaved entry until Save.
The standard editor retains its existing copied content/layout and history;
its list and content-first/right-details layout now align with custom entries.
No public renderer changes or content backfill are required.
