---
name: edge-design-to-site
description: Build a whole Edge CMS site in a Hub from a designer's handoff, end to end, through the Hub's draft-only agent tools (the shared CMS MCP with an agent key) - theme, blocks for every page, the site and its pages, content, and a readiness report - stopping only at two checkpoints (theme review, site review) and for problems it can't solve. Use when asked to build a site from a design, turn a handoff into a site, or build every page of a handoff in a Hub (emd-cms, clearwater-hub, iafsc-hub). Uses the edge-block-package skill to author blocks. Never publishes pages, releases blocks, or edits emd-cms-front.
---

# Edge design to site

The first-release workflow (Clearwater Hub `docs/features/cms/first-release-plan.md`): the developer hands over the design once, reviews the theme, then reviews the finished draft site. Everything in between is yours: no relaying files, no waiting to be told to start the next page.

## What you can and can't do

You work through the Hub's CMS MCP. Everything you write is a draft:

| Tool | Use |
| --- | --- |
| `cms_find_theme`, `cms_get_theme`, `cms_find_block`, `cms_find_usage` | Read what the Hub has (production reads) |
| `cms_check_operation` then `cms_run_operation` | Every write. The check returns problems and a checksum; the run is refused if anything changed since the check |
| `cms_block_base` | The current definition of an existing block (its open draft, else released) and the fingerprint a `block.draft` must send |
| `cms_preview_url` | A 15-minute link to the Hub's render of one draft page, with your unreleased block drafts by default |
| `cms_site_readiness` | What stops the site from being finished |

Operations (fields in the Hub's `docs/data-contracts/cms-operations/README.md`): `theme.create`, `theme.update` (only themes no published site uses), `theme.propose` (for a live theme), `site.create`, `page.create`, `page.update`, `page.placeBlock`, `page.setValues`, `page.removeBlock`, `block.create`, `block.draft`.

You never publish a page, release a block, change a live theme, or edit `emd-cms-front`. The developer does those, in the Hub, after checkpoint 2.

## Before starting

1. **Tools.** The CMS MCP is connected with the right Hub config, and an agent key is set (a check without one says "No agent key is configured"). If not, stop and tell the developer: Dev Mode > Agent Keys in the Hub, then the MCP README's setup.
2. **Project facts.** Read `<importfiles>/PROJECT.md` (the edge-block-package skill's template). Besides its usual facts you need the site's name and at least one domain for `site.create`. Ask for anything missing now, in one message: this is the only handover.
3. **The design.** Read the whole handoff before writing anything. Design files are annotations, not authority; the edge-block-package rules on invented content apply.
4. **What exists.** List the organization's themes and blocks. Reuse the site chrome (navigation, footer) and shared sections instead of rebuilding them; note which existing blocks the design changes.
5. **Start a log** for the report: start time, each checkpoint, each page finished, end time. The release is measured on the developer's hands-on time.

## 1. Theme, then checkpoint 1

1. Draft Theme JSON, Head JSON and extra CSS from the design (edge-block-package `reference/theme-guidelines.md`, `reference/head-guidelines.md`). A new theme uses **only the standard names** ("Standard names" in the theme guidelines): map the design's palette onto `primary`, `secondary`, `tertiary`, `accent`, their `on…` text colors and the page and text roles by how each color is used (a fifth brand color folds into one of those roles or a tint of one, never into `success`, `warning` or `danger`, which are for status only); fonts are `display`, `sans`, `accent`; radii `card`, `panel`, `button`. No palette names, even as aliases. Decorative textures and patterns in the design (topography lines, grain) go into Extra CSS as classes now; they are theme, not images. Check the theme file with `scripts/cms/validate-import.mjs --standard-theme` before `theme.create`, which refuses anything else.
2. `theme.create` with them. If the design needs changes to a theme a published site uses, `theme.propose` instead and say so.
3. `site.create` with the name, the theme, the domains and any settings the handoff gives (contact details, logos, social links). The theme's default menus and pages are copied in. Nothing is published.
4. **Checkpoint 1.** Stop. Report the theme (fonts, colours, spacing decisions and where they came from), the palette mapping (design color → standard name, and any color folded into another role), the texture classes, the site id, and what you'll build next. Wait for the developer's review; apply their changes with `theme.update` before going on.

## 2. Every page, without stopping

Work through the pages in the handoff's order. For each page:

1. **Plan the blocks.** Existing blocks it reuses, new blocks it needs (four or fewer per page is a good size), and which need a Vue override component (interactive or renderer-owned behaviour; see edge-block-package `reference/override-blocks.md`). Flag overrides now, not at the end.
2. **Author new blocks** with the edge-block-package workflow: generate, validate three ways (the checker with `--standard-theme` for a standard theme), local preview at desktop and phone widths, fix. Classes use only the standard theme names; tints and hovers are opacity modifiers. Get them right locally first: once a block is on a page, later fixes are drafts the developer must release.
3. **Create them**: `block.create` per block. The check runs the Hub's import check; fix every problem it reports and check again.
4. **Change existing blocks** only from the Hub's copy: `cms_block_base`, edit that definition, `block.draft` with its `baseHash`. Never from a local file: the Hub may hold hand fixes you don't have. A "changed since you loaded it" refusal means someone edited it; load it again and reapply your change.
5. **Build the page**: `page.create` (or use the page the theme seeded), `page.placeBlock` for each block in order with its content as `values`, `page.update` for the meta title and description. Content is the handoff's approved copy; anything invented stays empty or uses the block's intentional fallback, and goes in the report.
6. **Look at it.** `cms_preview_url`, open the link in a browser and screenshot it at about 1440 pixels wide, then get a second link with `viewport: "mobile"` for the phone layout (it renders a 420px page and simulates its breakpoints in any window), and compare both with the design. Fix what doesn't match: content with `page.setValues`, a block's markup with `block.draft` (the preview shows your drafts). Up to three passes per page; record what still differs.
7. Log the page as done and go straight to the next one.

Override blocks render as their CMS HTML in the preview; that is expected. Check their CMS HTML is a sensible fallback.

## 3. Readiness report, then checkpoint 2

1. `cms_site_readiness` for the site. Fix what you can (errors first), then run it again.
2. **Checkpoint 2.** Stop and report:
   - pages built, each with a fresh preview link;
   - blocks created, and block drafts waiting for the developer to release (Block Editor, then release). Say plainly that the Hub page editor shows **released** blocks: until these drafts are released, the editor shows the older versions, while your preview links showed the drafts;
   - override blocks that need a Vue component, with a handoff note each (block name, fields the component reads, behaviour), and whether the local `emd-cms-front` checkout already has it (the readiness report says);
   - content you couldn't fill or left at a fallback, and anything you invented and removed;
   - remaining readiness items and differences from the design you couldn't fix;
   - the time log.
3. The developer reviews the site in the Hub, asks for changes, releases the drafts and publishes. For each requested change, re-read the Hub's current state first (`cms_block_base`, the page) because they may have fixed things by hand, then change it through the operations as above.

## When to stop early

Only when you can't go on without the developer:
- a fact only they have (domain, which copy is approved, a missing asset);
- a refusal you can't fix (permission, an expired or revoked key, a live theme that needs their decision on a proposal);
- the same check failing after three honest attempts.

Say exactly what you need, and keep going on anything that doesn't depend on it.

## Do not

- Publish, release, or ask the MCP to do either; it can't.
- Regenerate an existing Hub block from a local file, or re-import a package over Hub edits.
- Rebuild the chrome, theme or head for one page.
- Edit `emd-cms-front`, commit, push, or deploy.
