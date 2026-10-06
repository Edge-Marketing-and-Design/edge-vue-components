---
name: edge-design-to-site
description: Build a whole Edge CMS site in a Hub from a designer's handoff, end to end, through the Hub's draft-only agent tools (the shared CMS MCP with an agent key) - theme, blocks for every page, the site and its pages, content, and a readiness report - stopping only at two checkpoints (theme review, site review) and for problems it can't solve. Also updates the blocks of an existing site when its design changes: finds the blocks through the design map, classifies each change, stops at one checkpoint, applies drafts and value changes, and hands over a release recommendation. Use when asked to build a site from a design, turn a handoff into a site, build every page of a handoff in a Hub (emd-cms, clearwater-hub, iafsc-hub), or update a site's blocks from a changed design. Uses the edge-block-package skill to author blocks. Never publishes pages, releases blocks, or edits emd-cms-front.
---

# Edge design to site

The first-release workflow (Clearwater Hub `docs/features/cms/first-release-plan.md`): the developer hands over the design once, reviews the theme, then reviews the finished draft site. Everything in between is yours: no relaying files, no waiting to be told to start the next page.

Three entry points, all through the same tools:

1. **Build a site from a design** (sections 1–3 below): theme, checkpoint 1, every page, readiness, checkpoint 2.
2. **Change a site during its build**: the developer's requests after checkpoint 2 (section 3, step 3).
3. **Update blocks from a design change** (section 4): the design changed after the site was built; the blocks follow it, through drafts, with one checkpoint.

## Block vocabulary

The words below mean exactly this, here and in the contracts:

- **Library block**: the document at `organizations/{orgId}/blocks/{blockId}`. It holds the released definition (template, schema with defaults, data sources) that pages copy from.
- **Instance**: a copy of a library block placed in a page's or post's `content`, with its own `values`. Published pages carry the definition inline; the public renderer reads instances from KV and never reads the library.
- **Synced**: a synced block shares one instance's values across a site's pages. It is placed without values; the first instance on a site is placed in the Hub, and later placements copy it.
- **Override**: an override block is one the public renderer replaces with a Vue component resolved from the block name. The CMS HTML is the editor preview and the fallback, and the block is the design source of truth for the component.
- **Draft and release**: an edit to an existing library block is a draft revision; library changes reach pages only through a release, which a developer runs in the Hub. Nothing here releases.
- **Site chrome**: the synced navigation and footer blocks every page of a site shares.

## What you can and can't do

You work through the Hub's CMS MCP. Everything you write is a draft:

| Tool | Use |
| --- | --- |
| `cms_contract` | The data contract for a kind (`operations`, `blocks`, `themes`, `posts`): the fields you write against |
| `cms_find_theme`, `cms_get_theme`, `cms_find_block`, `cms_find_usage` | Read what the Hub has (production reads) |
| `cms_check_operation` then `cms_run_operation` | Every write. The check returns problems and a checksum; the run is refused if anything changed since the check |
| `cms_block_base` | The current definition of an existing block (its open draft, else released) and the fingerprint a `block.draft` must send |
| `cms_preview_url` | A 15-minute link to the Hub's render of one draft page, with your unreleased block drafts by default |
| `cms_site_readiness` | What stops the site from being finished |

Operations (fields from `cms_contract`, kind `operations`): `theme.create`, `theme.update` (only themes no published site uses), `theme.propose` (for a live theme), `site.create`, `site.update` (the site's SEO only), `page.create`, `page.update`, `page.placeBlock`, `page.setValues`, `page.removeBlock`, `block.create`, `block.draft`.

You never publish a page, release a block, change a live theme, or edit `emd-cms-front`. The developer does those, in the Hub, after checkpoint 2.

## Before starting

0. **Contracts.** Call `cms_contract` for every kind you will write: `operations` (every operation's fields), `blocks`, `themes`, and `posts` when the handoff covers posts. Read them before the first check. Keep a list of each field you write and the contract line it follows; it goes in the checkpoint 2 report. Without the MCP there is no site to build; stop.
1. **Tools.** The CMS MCP is connected with the right Hub config, and an agent key is set (a check without one says "No agent key is configured"). If not, stop and tell the developer: Dev Mode > Agent Keys in the Hub, then the MCP README's setup.
2. **Project facts.** Read `<importfiles>/PROJECT.md` (the edge-block-package skill's template). Besides its usual facts you need the site's name and at least one domain for `site.create`. Ask for anything missing now, in one message: this is the only handover.
3. **The design.** Read the whole handoff before writing anything. Design files are annotations, not authority; the edge-block-package rules on invented content apply.
4. **What exists.** List the organization's themes and blocks. Reuse the site chrome (navigation, footer) and shared sections instead of rebuilding them; note which existing blocks the design changes.
5. **Start a log** for the report: start time, each checkpoint, each page finished, end time. The release is measured on the developer's hands-on time.

## 1. Theme, then checkpoint 1

1. Start new Theme JSON and Head JSON from the Hub's shared defaults (`edge/lib/cmsThemeDefaults.mjs`), then adapt them to the design (edge-block-package `reference/theme-guidelines.md`, `reference/head-guidelines.md`). Keep baseline colors, fonts and radii present. Prefer those roles for portable blocks; custom additions are allowed when needed and should be explained at checkpoint 1. Status colors are for status, not spare brand colors. Decorative textures belong in Extra CSS. The checker validates the theme baseline; `--standard-theme` additionally audits baseline-only block portability. For deliberate extensions, use the normal import check and `cms_check_operation`, which verifies tokens against every selected theme.
2. `theme.create` with them. If the design needs changes to a theme a published site uses, `theme.propose` instead and say so.
3. `site.create` with the name, the theme, the domains and any settings the handoff gives (contact details, logos, social links), and the site's SEO (see "SEO" below): `metaTitle`, `metaDescription` and `structuredData`. The theme's default menus and pages are copied in. Nothing is published.
4. **Checkpoint 1.** Stop. Report the theme (fonts, colours, spacing decisions and where they came from), the palette mapping (design color → standard name, and any color folded into another role), the texture classes, the site id, and what you'll build next. Wait for the developer's review; apply their changes with `theme.update` before going on.

## 2. Every page, without stopping

Work through the pages in the handoff's order. For each page:

1. **Plan the blocks.** Existing blocks it reuses, new blocks it needs (four or fewer per page is a good size), and which need a Vue override component (interactive or renderer-owned behaviour; see edge-block-package `reference/override-blocks.md`). Flag overrides now, not at the end.
2. **Author new blocks** with the edge-block-package workflow: generate, validate three ways, local preview at desktop and phone widths, fix. Prefer baseline theme names; extensions must exist in every selected theme. Use `--standard-theme` for baseline-only portability, not to reject intentional declared extensions. Get them right locally first: once a block is on a page, later fixes are drafts the developer must release.
3. **Create them**: `block.create` per block. The check runs the Hub's import check; fix every problem it reports and check again.
4. **Change existing blocks** only from the Hub's copy: `cms_block_base`, edit that definition, `block.draft` with its `baseHash`. Never from a local file: the Hub may hold hand fixes you don't have. A "changed since you loaded it" refusal means someone edited it; load it again and reapply your change.
5. **Build the page**: `page.create` (or use the page the theme seeded), `page.placeBlock` for each block in order with its content as `values`, `page.update` for the page's SEO (see "SEO" below). Content is the handoff's approved copy; anything invented stays empty or uses the block's intentional fallback, and goes in the report. Site chrome (navigation, footer) is synced: place it without `values`, and the operation copies the instance the site already has (the theme's seeded pages carry it). If the check says the site has no instance of it yet, the developer places the first one in the Hub: note the page in the report and go on.
6. **Look at it.** `cms_preview_url`, open the link in a browser and screenshot it at about 1440 pixels wide, then get a second link with `viewport: "mobile"` for the phone layout (it renders a 420px page and simulates its breakpoints in any window), and compare both with the design. Fix what doesn't match: content with `page.setValues`, a block's markup with `block.draft` (the preview shows your drafts). Up to three passes per page; record what still differs.
7. Log the page as done and go straight to the next one.

Override blocks render as their CMS HTML in the preview; that is expected. Check their CMS HTML is a sensible fallback.

## SEO (every page and the site)

Set with the operations, from the handoff's approved copy only:

- **`metaTitle`** (about 60 characters) and **`metaDescription`** (about 155) for each page and for the site (`site.create` settings, or `site.update` later).
- **`structuredData`**: start from the default template already on the page or site (a `WebPage` with `isPartOf` the site; a `WebSite` with a publisher `Organization`) and fill its `name` and `description`; the site's publisher `name` too. Keep the tokens exactly as they are: `{{cms-url}}` (this page's URL), `{{cms-site}}` (the site URL) and `{{cms-logo}}` (the logo). Never write the site's own URLs out, and don't invent other tokens: the public site replaces only those three on a regular page.
- **A more specific type** only when the approved content states the facts: an event with dates and a venue (Montana Outdoor Expo) gets an `Event` item (`name`, `startDate`, `endDate`, `location` with the venue name and address, `organizer`, `url: "{{cms-url}}"`) alongside the `WebPage`, as a list or `@graph`; a business with an address can use `Organization` or `LocalBusiness` on the site. No ratings, prices or offers the handoff doesn't give.
- The operations refuse structured data that isn't a JSON-LD object and give notices for unknown tokens or hard-coded URLs; the readiness report warns about any page or site with missing meta or an empty structured data `name` or `description`. Fix them before checkpoint 2.
- Post fields (`postMetaTitle`, `postStructuredData`) belong to post templates and use each post's own tokens; leave them unless the handoff covers posts.

## 3. Readiness report, then checkpoint 2

1. `cms_site_readiness` for the site. Fix what you can (errors first), then run it again. `truncated: true` (error `site.check-incomplete`) means the report is incomplete and the site can't be called ready; say so at checkpoint 2.
2. **Checkpoint 2.** Stop and report:
   - pages built, each with a fresh preview link;
   - blocks created, and block drafts waiting for the developer to release (Block Editor, then release). Say plainly that the Hub page editor shows **released** blocks: until these drafts are released, the editor shows the older versions, while your preview links showed the drafts;
   - override blocks that need a Vue component, with a handoff note each (block name, fields the component reads, behaviour), and whether the local `emd-cms-front` checkout already has it (the readiness report says);
   - the fields you wrote and the contract line each follows (from step 0);
   - content you couldn't fill or left at a fallback, and anything you invented and removed;
   - remaining readiness items and differences from the design you couldn't fix;
   - the time log.
3. The developer reviews the site in the Hub, asks for changes, releases the drafts and publishes. For each requested change, re-read the Hub's current state first (`cms_block_base`, the page) because they may have fixed things by hand, then change it through the operations as above.

## 4. Update blocks from a design change

The job that follows every launch: the design changed and the blocks already in the Hub have to follow it. The reference is edge-block-package `reference/block-updates.md` (the change classes, the path and the verification for each); this section is the order of work. Steps 0, 1 and 5 of "Before starting" apply (contracts, tools, the time log); the handoff is the one input, so ask for anything missing in one message.

1. **Inputs.** The organization and site; the design reference (the Figma file and the changed node ids, or "compare the whole frame" when the designer did not record them; or a handoff export); and the map (the package manifest's `design` entries, or each block's `meta.design` from `cms_block_base`). Call `cms_contract` for `blocks` and `operations` first, and `sites-and-pages` when values change. Without the Figma MCP, a handoff export or screenshots work with your own comparison; say so in the report.
2. **Identify the affected blocks** from the map (`block-updates.md`, "Finding the block a node became"). "Compare the whole frame" means `get_metadata` on the frame, then each mapped section against its block. Nodes with no map entry, by id or by name, are listed for the developer, never guessed; blocks with no `meta.design` are listed with the draft that would add it.
3. **For each affected block:** `cms_block_base` (the current definition and its `baseHash`), the design node (`get_design_context`, `get_screenshot`), and the current preview (`cms_preview_url` for a page that holds it). Classify every change by the table in `block-updates.md`; a section can carry several classes. Count the instances with `cms_find_usage`.
4. **Checkpoint.** Stop and report, in one table, one row per block: the node, the change classes, whether anything is breaking (a removed or renamed field), what needs the developer (media, synced values, a renderer task), and the instance count. Add the nodes with no map entry and the estimated work. Wait for the developer. Two-step is the default for a removed or renamed field (add now, remove in a later draft); a one-step removal happens only when the developer asks for it here.
5. **Apply.** Per block, one `block.draft` carrying every definition change (markup, new fields, the first step of a rename, and `meta.design` when it was missing), validated with the checker before it is saved; `page.setValues` per instance for value changes; nothing for media and synced values beyond the list. Then preview each touched page beside the design at about 1440 pixels and with `viewport: "mobile"`, and fix what differs: up to three passes per block, as in section 2.
6. **Hand off.** Drafts awaiting release, each with its classes and a release recommendation (all sites for a handful of documents; canary to one site first when `cms_find_usage` counts more; confirmation when breaking; two-step changes in order); value changes applied and the synced ones left for the developer; renderer tasks for override blocks; media for the developer; fresh preview links; what still differs; the design revision written to `PROJECT.md` (`design.revision`); the time log. Say plainly that the Hub page editor shows released blocks until the drafts are released.

The developer releases from the Block Editor. Asked afterwards, confirm with `cms_site_readiness` that no instance is behind (`instance.behind`).

## When to stop early

Only when you can't go on without the developer:
- a fact only they have (domain, which copy is approved, a missing asset, which design node a block with no map entry belongs to);
- a refusal you can't fix (permission, an expired or revoked key, a live theme that needs their decision on a proposal);
- the same check failing after three honest attempts.

Say exactly what you need, and keep going on anything that doesn't depend on it.

## Do not

- Publish, release, or ask the MCP to do either; it can't.
- Regenerate an existing Hub block from a local file, or re-import a package over Hub edits.
- Remove or rename a schema field in one step unless the developer asked for exactly that at the checkpoint.
- Rebuild the chrome, theme or head for one page.
- Edit `emd-cms-front`, commit, push, or deploy.
