# CMS posts data contract

Status: in use for every post and event a site publishes.

Last verified: 2026-10-13, 9fa2002f

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
