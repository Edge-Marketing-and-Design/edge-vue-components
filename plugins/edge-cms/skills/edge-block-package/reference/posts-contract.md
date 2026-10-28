# Posts contract (verified against emd-cms `functions/cms.js` onPostWritten and `edge/components/cms/init_blocks/`, 2026-09-18)

- Published posts live at `organizations/{orgId}/sites/{siteId}/published_posts/{postId}` and are mirrored to KV as collection `posts` with `uniqueKey: "{orgId}:{siteId}"`.
- Indexed (usable in `queryItems`): `name` (slug), `tags` (one key per tag), `type` (`post` | `event`), month buckets, event start/end/isPast.
- Metadata (available to lists without `canonical: true`): `title`, `blurb`, `name`, `type`, `featuredImage` (single URL), `doc_created_at` (publish time in milliseconds), `tags`, `event.{startAt,endAt,isPast,locationName}`.
- Hub editor fields: Title (required), Name = slug (generated, editable), Content Blurb (required, max 500 chars), Featured Image (media manager), Publish At (sets `publishedAt`; `doc_created_at` follows it), Tags (free multi-select), Post Type, and a block-based body stored as `content` + `structure`.

## Listing source

```json
{ "posts": { "type": "collection", "path": "posts", "uniqueKey": "{orgId}:{siteId}",
  "query": [{ "field": "type", "operator": "==", "value": "post" }],
  "order": [{ "field": "doc_created_at", "direction": "desc" }], "limit": 12, "value": [] } }
```

Template: `{{#for post in source("posts")}} ... {{ post.title }} {{ post.blurb }} {{ date(post.doc_created_at) }} <a href="{{ basePath }}/{{ post.name }}"> ... {{/for}}` with a `{{ loading }}` skeleton and a `{{ loaded }}` wrapper. `date()` accepts millisecond timestamps.

## Detail source (post template blocks, `type: ["Post"]`)

```json
{ "postDoc": { "type": "collection", "path": "posts", "uniqueKey": "{orgId}:{siteId}",
  "queryItems": { "name": "{routeLastSegment}" }, "order": [], "limit": 1, "value": [] } }
```

Header: `{{#for post in source("postDoc")}} <h1>{{ post.title }}</h1> ... {{/for}}`.
Body: `{{#for post in source("postDoc")}}{{{#renderBlocks {"field":"post"} }}}{{/for}}` renders the post's own rows. Authors build articles from Post-typed blocks (rich text, callouts, FAQ); the body block itself never contains article text.

## Page setup

A post-enabled page has two arrangements: page content (listing at `/route`) and the post template (detail at `/route/<slug>`). Chrome blocks placed on posts must be `type: ["Page", "Post"]`.
