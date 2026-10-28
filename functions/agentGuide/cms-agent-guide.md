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
- **Some things stay in the Hub:** menus and site settings other than
  `metaTitle`, `metaDescription` and `structuredData`; media uploads;
  publishing; releasing blocks; applying theme proposals.

## Start

1. `cms_agent_organizations` lists the organizations you can edit. Page through
   with `nextStartAfter` until it is null.
2. Pass that `orgId` to every other tool. For page and post work also pass the
   `siteId` (inside the operation for check and run). The server opens and
   renews the right session for each call: a site session for page, post and
   `site.update` work, an organization session for library reads, blocks,
   themes and `site.create`. `cms_open_session` is optional; it only names a
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

## Change a library block

1. `cms_find_block` to find it, `cms_find_usage` to see which pages and posts
   use it.
2. `cms_block_base` returns its current definition (its open draft, else the
   released one) and `baseHash`.
3. Edit the definition and check it with `cms_validate` (send it inline as
   `definition`). Fix every error.
4. `block.draft` with `blockId`, the `definition` and that `baseHash`: if
   someone changed the block in the Hub since, the check refuses it instead
   of overwriting. Fields the definition leaves out keep their current
   values. New blocks use `block.create` (`block`, with its `docId`).
5. A developer releases the draft in the Hub. Until then pages show the
   released block; `cms_preview_url` with `blockDrafts: true` shows the draft.
- `cms_audit_blocks` validates the whole library with the Hub's import
  settings and lists the blocks with errors and their findings.

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
  compare with the design. Vue override components only render on the public
  site.
- `cms_site_readiness` lists what stops a site from being finished: failed
  block checks, empty required content, missing blocks, unreleased drafts,
  pages behind the released block, and unpublished pages.

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
