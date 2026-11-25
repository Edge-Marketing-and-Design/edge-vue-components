---
name: edge-site-export
description: Export a published Edge CMS site (pages and posts) as a standalone static website the owner can host anywhere, disconnected from the Hub and the public renderer, plus a content archive (pages and posts as JSON, posts as Markdown, a WordPress import file, all media). Use when a client leaves and takes their site, when asked to export, hand over, archive, disconnect or "take a site with them" from a Hub (emd-cms, clearwater-hub, iafsc-hub). Reads only published data; never changes the Hub, KV, DNS or the renderer.
---

# Edge site export

A site in a Hub is data (pages, posts, blocks, theme) that the public
renderer (emd-cms-front) turns into HTML on each request. An export freezes
that HTML: it fetches every published page and post from the renderer,
removes the renderer's application (Nuxt, its payload and runtime config),
downloads every image, font, stylesheet and file the pages use, and adds a
small browser runtime built from the renderer's own helpers, so menus,
scroll reveals, countdowns, carousels and forms keep working. Nothing it
produces calls the Hub, the renderer or our image service.

The result, in one folder:

| Path | What it is |
| --- | --- |
| `site/` | The static site. Deploy this folder. |
| `content/` | `site.json` (public settings), `pages/*.json` (published page documents), `posts/*.json` and `posts/*.md`, `wordpress-export.xml` (posts), `media-manifest.json` (original URL → local file) |
| `README.md` | The owner's handover guide: hosting, forms, editing, what changed |
| `export-report.json` | What was exported and every warning |
| `check-results.json` | The checker's evidence |

## Rules

- **Read only.** Export through the renderer's public routes and the CMS
  tools' reads. Never publish, unpublish, edit pages, release blocks, move
  domains or change DNS; the person does those after the handover.
- **Published content only.** Drafts and unpublished changes are not
  exported. List them (step 1) so the person can publish first or accept it.
- **Agreement first.** Before exporting, confirm with the person which site
  is leaving and that the agreement covers it. Name what is not included
  (step 8) in the handover.
- **No client data in `edge/`.** Per-site work (the site script, the export
  itself) lives in `importfiles/<site>/export/` in the Hub checkout, never in
  this skill's folder. The renderer is private and `edge/` is public: the
  browser runtime is built into each export, never committed here.
- **The person sends it.** You produce the folder and a zip; the person
  delivers it to the client.

## Tools

- `scripts/export-site.mjs` — the export (Node 22, no dependencies).
- `scripts/check-export.mjs` — proves the export is disconnected and
  complete; must pass before handover.
- `scripts/serve.mjs` — serves an export on localhost like a static host.
- `runtime/build-runtime.mjs` — builds the browser runtime from an
  emd-cms-front checkout (`export-site.mjs` runs it; needs that checkout with
  `pnpm install` done).
- The Hub's CMS tools (`cms_list_sites`, `cms_list_pages`, `cms_list_posts`)
  to find ids and publication state; the in-app browser or
  `chrome-devtools` for the review.

## 1. Find the site and what is published

1. `cms_list_sites` for the organization: the `siteId`, its domains and
   canonical domain.
2. `cms_list_pages` and `cms_list_posts`: anything `draft` (never
   published) is left out; `unpublished-changes` exports the published
   version. Tell the person before exporting.
3. Decide the **source**: the live domain (`--source https://<domain>`) when
   the site is live, since it exports exactly what visitors get; otherwise
   the preview host (default, `https://emd-cms-front.pages.dev`, which serves
   any published site by id). A site served by another renderer project uses
   that project's host and `--renderer` checkout (iafsc-hub sites:
   `--renderer <iafsc-cms-front checkout>`). Helpers that renderer lacks
   (older ones have no countdown) are left out of the runtime and named in
   `report.runtime`.
4. Decide the **target domain** (`--domain`): where the owner will host it.
   Defaults to the site's canonical domain.

## 2. Export

```bash
node edge/skills/edge-site-export/scripts/export-site.mjs \
  --org <orgId> --site <siteId> \
  --source https://<live domain or preview host> \
  --domain www.<owner domain> \
  --out importfiles/<site>/export \
  [--form-endpoint <url>] [--site-script importfiles/<site>/export-site.js] \
  [--renderer <emd-cms-front checkout>] [--force]
```

It discovers pages from the site's menus, posts from the post indexes
(posts, events, custom post types) at their template pages' paths, and
anything else from the renderer's sitemap and the links on every page. Old
paths the renderer redirects become `_redirects` entries plus small redirect
pages. A run takes about a minute for 30 pages.

## 3. Work through the report

Every warning in `export-report.json` has a code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `page-without-path` | A published page is in no menu, so it has no URL | Ask whether it matters; it is in `content/pages/` either way |
| `post-without-page` | A post has no published post page | It is archived only; say so in the handover |
| `page-fetch-failed` | A known page did not return 200 | Open it on the source; fix the cause or record it |
| `partial-render` | The renderer kept timing out on a page | Re-run; if it persists, review that page closely |
| `interactive-collection` | A filtered, searched or paged list | The export shows the first results. Say so, or link to all items another way |
| `override-components` | Blocks use renderer override components | Step 4 |
| `override-unmatched` | Override wrappers could not be matched to instances | Step 4, by hand |
| `form-fallback` | Forms built by renderer components | They post to `formEndpoint`; test each (step 5) |
| `form-endpoint-missing` | Forms and no endpoint | Step 5 |
| `asset-download-failed` | Files that could not be downloaded | Check each URL in `assets.failed`; re-run, or replace the reference |
| `broken-on-source` | Links that 404 on the source too | The checker lists them as `knownBroken`; fix them in the Hub first or name them in the handover |
| `licensed-fonts` | An Adobe Fonts (Typekit) kit | Its files are copied, but Adobe Fonts may not be self-hosted: the owner needs their own kit or replacement fonts. Say so in the handover |
| `cloudflare-zaraz` | The domain ran Cloudflare Zaraz | Dropped with the domain's Cloudflare zone; ask what it loaded (often analytics) and tell the owner to add it directly |
| `max-pages`, `sitemap-unavailable`, `lucide-download` | Crawl limits, missing sitemap, icon script | Re-run with a higher limit or check the source |

Also read `thirdPartyScripts` (analytics and embeds kept on the site) and
confirm with the person that each belongs to the owner. Our own tracking
(the renderer's history and analytics calls) is gone with the Nuxt app.

## 4. Override components

An override block renders through a Vue component in emd-cms-front. The
export keeps its server-rendered markup, but whatever the component adds in
the browser (pagers, lightboxes, parallax, tabs) is gone. The export tags
each one `data-edge-override="<blockId>"` with
`data-edge-values="/assets/overrides/<instanceId>.json"` (its values with
schema defaults, images downloaded).

For each override in `report.overrides`:

1. Read its component in emd-cms-front (`app/blocks/<org folder>/<name>.vue`)
   and list the browser behavior it adds.
2. Decide with the person: port it, or accept the static first view.
3. To port, write `importfiles/<site>/export-site.js` (one file for the
   site, plain browser JavaScript, no imports) following
   `reference/override-ports.md`, and re-run the export with
   `--site-script`. It is served as `/assets/site.js` on every page.

## 5. Forms

CMS forms (`cms-form`) keep their markup, validation, phone formatting and
messages; their submissions go to `formEndpoint` in
`site/assets/edge-standalone-config.js` (form-encoded, or JSON with
`--form-format json`). Forms rendered by renderer components without an
`action` get the same endpoint through a fallback handler. Forms with their
own `action` (a Mailchimp signup) keep working unchanged.

The owner chooses the form service (Formspree, Basin, Netlify Forms, their
own script). If they have one, pass `--form-endpoint`. If not, leave it: a
submission then shows "This form is not connected yet. Please email
<site contact email>." and the README tells them how to connect it.

## 6. Check

```bash
node edge/skills/edge-site-export/scripts/check-export.mjs --out importfiles/<site>/export
```

It must print `OK`. It fails on any reference to Cloudflare Images,
Firebase, the renderer or its routes (`/api`, `/_nuxt`, `/_files`), Nuxt
payloads, Hub ids, preview controls or Cloudflare-injected scripts, on any
internal link or asset that does not resolve to a file, and on a page without
the runtime. Fix the cause in the export (or report a script bug), never by
editing the output by hand.

## 7. Review in a browser

```bash
node edge/skills/edge-site-export/scripts/serve.mjs --dir importfiles/<site>/export/site --port 4321
```

Open it next to the source, desktop and phone width, and check:

- Every page: layout matches the source, no console errors, and the
  network requests go only to localhost and the owner's third parties.
- The menu opens and closes on a phone; the current page is marked.
- Scroll reveals, carousels and countdowns run.
- Each override port behaves like the source.
- Each form: with no endpoint it shows the not-connected message; with a
  test endpoint (a local echo server) the fields arrive.
- A post page, the post list, `rss.xml`, `sitemap.xml`, `404.html` and one
  redirect.

## 8. Hand over

1. Zip it: `cd importfiles/<site> && zip -r <site>-export-<date>.zip export -x '*.DS_Store'`.
2. Give the person the zip, the README's "What works differently now", and
   what is **not** included:
   - drafts and unpublished changes;
   - form submissions and contacts stored in the Hub (export them separately
     if the agreement includes them);
   - media in the Hub library that no page uses;
   - members-only content, site search and visitor sign-in.
3. The person's steps, after the owner confirms the new host works: move the
   domain's DNS to the new host, then unpublish the site in the Hub and
   remove its domains there so the renderer stops answering for them. None
   of these are yours.

## Limits

- The export is a snapshot. Later Hub changes need a new export.
- The runtime is built from the renderer checkout you have. If the live site
  runs an older deploy, compare behavior in step 7.
- Posts lists that page or filter through the renderer keep their first
  results only; every post page is still exported and linked from
  `sitemap.xml` and `rss.xml`.
- The WordPress file carries posts (title, date, excerpt, tags, body); pages
  stay as HTML, since their design does not map onto WordPress blocks.
