# Working on a Hub site with the CMS tools

Served by `cms_guide` from the deployed Hub, so it always matches the tools.
Shared Edge source: `edge/functions/agentGuide/cms-agent-guide.md`.

## Rules

- **Everything is a draft.** No tool publishes a page or post, releases a
  block, or changes a live theme. A person publishes and releases in the Hub.
- **Check, then run.** Build the operation, send it to `cms_check_operation`,
  read what would change and any problems, then send the same operation to
  `cms_run_operation` with the returned `checksum`. The run is refused if
  anything the check read has changed since; check again.
- **Read the contract first.** Before writing a kind of document, read its
  contract with `cms_contract` (kind `operations` for every operation type and
  its fields, and `blocks`, `themes`, `sites-and-pages` or `posts` for what
  you write). Build the operation from those fields.
- **You act as yourself.** Every call runs with your current Hub rights in the
  organization you name, and is recorded: runs in the operation audit, library
  reads in the read audit. Lose access in the Hub and the tools stop too.
- **Some things stay in the Hub:** domains and apex forwarding; renaming and
  deleting pages; members-only content, users and the site AI; videos and
  files; publishing; releasing blocks; applying theme proposals.
- **Images come from the Hub's media.** Upload them with `cms_upload_media`
  and place the Hub URL it returns. Never leave a link to another site (an
  old site, a CDN, a stock photo URL) in a block or a value.

## Start

1. `cms_agent_organizations` lists the organizations you can edit. Page through
   with `nextStartAfter` until it is null.
2. Pass that `orgId` to every other tool. For page and post work also pass the
   `siteId` (from `cms_list_sites`; inside the operation for check and run). The server opens and
   renews the right session for each call: a site session for page, post,
   `site.update`, `site.settings` and `site.menus` work, an organization
   session for library reads, blocks, themes, templates and `site.create`. `cms_open_session` is optional; it only names a
   target up front.
3. `cms_list_pages` and `cms_list_posts` show a site's pages (menus, status)
   and posts; `cms_get_page` and `cms_get_post` outline one, with the
   instance ids and row indexes the operations use.

## Change page content

- **Values on a placed block:** `page.setValues` with the `instanceId` from
  `cms_get_page` (merged unless `replace`). Validation follows the block's
  schema; an empty required field or a value of the wrong type is a problem
  in the check. Synced blocks (site chrome) and Template v1 blocks are edited
  in the Hub.
- **Add a block:** `page.placeBlock` with a library `blockId` (find it with
  `cms_find_block`), its `values`, and `index` (the row position; default
  last). It adds a full-width row; multi-column rows are made in the Hub.
- **Reorder or remove:** `page.moveBlock` (`instanceId`, `index`) and
  `page.removeBlock`.
- **New page or SEO fields:** `page.create` and `page.update` (`fields`). A
  page whose structured data is AI-locked (`structuredDataAiLocked`) refuses
  `structuredData`.
- **Posts** work the same way with `post.create`, `post.update` and
  `post.placeBlock` / `setValues` / `moveBlock` / `removeBlock` with `postId`.

## Set up a site

- **Settings:** `site.settings` sets branding (logo, light logo, text logo,
  brand logos, favicon, app icon), contact email and phone, social links,
  menu position, tracking ids and sitemaps (see "Sitemaps") on the draft site. Images must be Hub media
  URLs (`cms_upload_media`). The SEO fields stay with `site.update`.
- **Menus:** `site.menus` replaces the whole `menus` object. Read the current
  menus with `cms_list_pages`, change them and send them back: every draft
  page listed once (`Not In Menu` for routable pages the navigation hides),
  page entries keep the page's slug, folders are `{ name, menuTitle, item: {
  folderSlug: [entries] } }`, links `{ name, item: { type: 'external', url }
  }`.
- **Domains:** `site.create` needs a domain; a new site takes a placeholder
  `<site-slug>.test`. A person sets the real domain at launch, and readiness
  warns while it is on `.test` (`site.placeholder-domain`).

## Custom post types

For hand-entered content with a list page and one page per item (staff
profiles, board members, vendors, programs, FAQs by topic), use a
page-defined custom post type instead of a custom collection. Use a
collection (a Data Source) only when the records come from elsewhere: an
API, an import, a feed, or another system.

1. **Define the type on a page.** `page.create`, then `page.update` with
   `fields: { post: true, postType: { enabled: true, icon: "Users" } }`
   (`event: true` too for dated entries with Event Details). The page's id is
   the type; its menu title is the label editors see in the Content sidebar.
   The page's main area is the index (list); its post area is the detail page.
2. **Build both views.** `page.placeBlock` for the index's list block (a
   `posts` Data Source; the Hub binds it to the type) and, with
   `area: "post"`, the detail blocks. Add `useForCustomPost: true` to each
   detail block whose fields are the entry's content (or set it later with
   `page.setValues`). Unmarked blocks keep page-owned values and appear on
   every entry unchanged. A detail field maps to an entry path through its
   schema `postField` (else its key); `editable: false` and `private: true`
   fields are not entry fields.
3. **Add entries.** `post.create` with `postTypeId` (the defining page),
   `title`, `blurb` and `values` (the detail fields by path), and
   `post.update` with `fields.values`. Entries have no blocks of their own;
   `post.placeBlock` and the other block operations refuse them.
4. **Read them back.** `cms_list_pages` marks the defining page
   `customPostType`; `cms_get_page` shows `postType` and the marked
   instances; `cms_list_posts` with `postTypeId` lists the entries;
   `cms_get_post` shows their `values`.

A person publishes the defining page, then each entry, in the Hub.

## Interactive collection blocks

Prefer generic collectionFilter/collectionOptions/paired collectionResults
helpers to custom scripts or Vue overrides when indexed, bounded filtering fits.
Requires published template-engine 26.11.1 and the public frontend's interactive
controller/API. Declare defaults and multiple array filters in dataSources;
project only public display/filter/sort fields with interactive.fields.
queryItems unions/deduplicates indexed candidates; query applies the final AND
conditions, then order, then pagination. A broad initial lookup belongs in
fallbackQueryItems, not alongside active narrow selections. Empty selections
omit their lookup/condition; no lookup or fallback returns no candidates.

Use one template containing controls, loading skeletons and an inline paired
collectionResults region. Keep controls outside it. Results expose items, total,
page and pages; if conditions use item.total outside the item loop. Do not fetch
additional sources or render nested CMS blocks inside the result region.
Options remain dynamic through collectionOptions, source overrides and distinct;
distinct provides choices, not counts. maxCandidates is an explicit bound, not
silent truncation (global ceiling 2,000; prefer smaller sets).

Choose browser or server pagination deliberately. Server mode uses real page
links and unique pageParam/filterPrefix values for blocks sharing a page.
Verify direct URLs, filter reset, empty/error states, Back/Forward and mobile
layout. These helpers activate sources just as source() does. Do not assume
public filter interaction works in the Hub: its editor canvas renders a bounded
initial snapshot of options/results from already loaded records, including
scalar distinct choices, but installs no public controller/API. Other
placeholder-only rendering still fetches no helper KV data.
A person reviews the saved draft and confirms frontend readiness before release
or publication. With a checkout, the complete example and limitations are in
edge/skills/edge-block-package/reference/interactive-collections.md.

## Sitemaps

`site.settings` with `sitemap` sets the site's sitemap configuration
(Site Settings, Sitemaps): `posts` is the Enable Sitemap choice for each
post kind, `{ "post": true, "event": false, "page:<pageId>": true }` for
this site's custom post types, merged into the stored choices. Turn on a
custom type's sitemap when its entries are public pages. `collections` and
`apis` are the Dev Mode lists (collection and API sitemaps); given, each
replaces its stored list, checked as the Sitemaps tab checks it. Page
sitemaps need no setting. The generated post entries follow when a person
publishes the site settings, from the published pages and menus.

## Templates

Templates are pages on the `templates` site, copied when a theme seeds a new
site (its default pages and menus) or a page or post is created from one.

- `cms_list_pages` and `cms_get_page` with `siteId: "templates"` read them.
- `template.create` makes one (`name`, `templateType` `["Page"]`, `["Post"]`
  or both, `post: true` for a post template with an index and a detail
  page); `template.update` changes its name, types, tags, themes and SEO.
- Its blocks change with the page block operations: `page.placeBlock`,
  `page.setValues`, `page.moveBlock`, `page.removeBlock` with `siteId:
  "templates"` and the template id as `pageId`. A template only takes blocks
  whose types share one with its own.
- A theme's `defaultPages` and `defaultMenus` name templates; set them with
  `theme.update` (or `theme.propose` for a live theme).
- Changing a template never changes pages already made from it: only new
  pages and sites get the change. `cms_site_readiness` with `siteId:
  "templates"` checks the templates' blocks.

## Add images

1. **Look first.** `cms_find_media` finds what the organization already has,
   by name `query`, `tags`, `siteId`, or the `sourceUrl` an agent uploaded it
   from. Reuse a match.
2. **Upload.** `cms_upload_media` with `tags` (at least one; use the image
   field's `tags` option when it has one, so its picker shows the image), the
   `siteId` the images are for, and up to 10 `sources`:
   - `{ "url": "https://…" }`: a public image the server fetches (an old
     site's image). Private and internal addresses are refused.
   - `{ "localFile": { "name": "team.jpg", "size": 182044 } }`: a file on
     your machine. The answer has a one-time `upload` link (15 minutes); PUT
     the file to it with `upload.curl`. The bytes never go through the tool
     call, so don't paste base64 (it's refused).

   JPEG, PNG, GIF and WebP, up to 10 MB and 12,000 px a side. SVG is refused:
   convert it to PNG first. An image already uploaded (same URL or same
   bytes) comes back with `deduplicated: true`.
3. **Wait for "ready".** Cloudflare makes the image's variants in a few
   seconds; the upload waits up to `waitSeconds` (30). Anything still
   `processing`: call `cms_find_media` with its `fileIds` until it is
   `ready`. Place only a ready image.
4. **Place it.** Set the image field to `url` (the `public` variant), or
   `variants[variant]` when the field sets a `variant`. Never use the R2
   original.

`cms_site_readiness` reports `media.external-image` for every image URL left
on another host, with the page, instance and field.

## Change a library block

1. `cms_find_block` to find it, `cms_find_usage` to see which pages and posts
   use it.
2. `cms_block_base` returns its current definition (its open draft, else the
   released one) and `baseHash`.
3. Edit the definition and check it with `cms_validate` (send it inline as
   `definition`). Fix every error. `cms_render_block` renders it with a site's
   theme and its real Data Source records (`data: "sample"` or `"empty"` for
   the other states) and returns the HTML and a standalone page to open and
   screenshot. `cms_diff` with the `docId` and your `definition` lists exactly
   what the draft will change (field paths and a line diff of changed
   markup); `sameDefinition: true` means there is nothing to draft. Without a
   definition it shows what the block's open draft changes in the release.
   (The local server's `cms_diff` compares checkout files instead.)
4. `block.draft` with `blockId`, the `definition` and that `baseHash`: if
   someone changed the block in the Hub since, the check refuses it instead
   of overwriting. Fields the definition leaves out keep their current
   values. New blocks use `block.create` (`block`, with its `docId`).
5. A developer releases the draft in the Hub. Until then pages show the
   released block; `cms_preview_url` with `blockDrafts: true` shows the draft.
- `cms_audit_blocks` validates the whole library with the Hub's import
  settings and lists the blocks with errors and their findings.
- Building a block that reads a Data Source? `cms_schema` with the
  collection's name shows the fields its documents actually have, their types
  and how many documents have each, without values. It also describes blocks,
  themes, sites, and a site's pages and posts against their published copies.

## Change a theme

- `cms_find_theme` and `cms_get_theme` read a theme's Theme JSON, Head JSON,
  Extra CSS, fonts and default templates.
- `theme.create` and `theme.update` change themes no live site uses.
- A theme a published site uses only takes `theme.propose`: it records a
  proposal that a person reviews in the Hub's theme editor (the proposals
  button in its header) and applies or rejects. `cms_get_theme` shows the
  theme as it is; a proposal changes nothing until it is applied.

## Check your work

- `cms_preview_url` returns a 15-minute link to the Hub's preview of a draft
  page (or its published copy), with block drafts when `blockDrafts` is true and a
  `viewport` of `mobile`, `medium` or `large`. Open it in a browser and
  compare with the design. Lists show the records the public site shows; a
  Data Source that didn't load is counted in the page's
  `data-preview-collection-problems` attribute and logged to the console.
  Vue override components only render on the public site.
- `cms_render_block` checks one block the same way without a page: its
  `sources` say where each list's records came from and why one is empty.
- `cms_validate`, `cms_audit_blocks` and `cms_site_readiness` say whether the
  deployed public site replaces a block with a Vue component
  (`renderingOwner`, readiness `deployedRenderer`). A component only counts
  for a block marked `isOverrideBlock`. `cms_resolve_override` answers that for
  one block (`docId`) or a name you plan to use (`blockName`), with the
  matching component file; pass the site's theme id as `themeName` for
  theme-specific components.
- `cms_site_readiness` lists what stops a site from being finished: failed
  block checks, empty required content, missing blocks, unreleased drafts,
  pages behind the released block, unpublished pages, images linked from
  outside the Hub's media (`media.external-image`), and the site setup
  standard: favicon, logo, contact email, a placeholder domain, pages in no
  menu, pages missing the site chrome, and forms with no recipient.

## When something is refused

A check that finds problems returns them in `problems`, with a code for each
in `problemCodes` (same order). `cms_contract` kind `operations` explains
every code and how to fix it, under Problem codes.

Requests that fail outright are `{ ok: false, code, message }`:

- `unauthenticated` (HTTP 401): the connection is missing, revoked or expired.
  Renew or recreate it in the Hub (Dev Mode, Agent Keys, Hub connections).
- `permission-denied` (403): your Hub role doesn't allow it, or the target is
  in another organization or site than the session.
- `not-found` (404): the organization, site, page, post, block or theme id is
  wrong.
- `invalid-argument` (400): the request is malformed; the message says which
  field.
- `failed-precondition` (409): something changed since the check (run the
  check again), or the operation is not allowed in this state.
