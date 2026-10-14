---
name: edge-figma-design
description: Plan and draw a whole Edge CMS website in Figma from an approved anchor design, the brand's colors and fonts, and the site's final copy - a page-by-page content plan, then design tokens, a component kit, one frame per new block, and one frame per page - for a designer to review before edge-design-to-site builds it in a Hub. Also keeps Figma in step with the CMS after launch, applying block changes made in the Hub (accessibility fixes, bug fixes, content-model changes) back onto the Figma frames. Use when asked to plan a site from its copy, write a site content plan, design or draft a full site in Figma, turn copy into Figma pages, or sync CMS block changes back to Figma. Never edits the anchor frames, never publishes or releases anything in a Hub.
---

# Edge Figma design

The design half of an Edge site, before and after the build. The first site made this way (Montana Outdoor Expo, 2026-10) went from copy document to a reviewed eight-page design in two sessions; this skill is that process, written down so it repeats.

## The workflow

| Stage | Who | Output |
| --- | --- | --- |
| 0. Anchor design | Developer + AI tool + designer | One approved Figma frame: a landing page or a hero and three or four sections. See `reference/anchor-design.md` |
| 1. Inputs | Developer | Brand colors and fonts, the final copy document for every page, the Figma file, the Hub organization |
| 2. Content plan | **This skill** | `docs/<site>/site-content-plan.md` from `templates/site-content-plan.template.md` |
| 3. Decision checkpoint | Developer | Answers to the plan's conflicts table; the new-block list approved |
| 4. Figma draft | **This skill** | Tokens, text styles, the component kit, every new block (with variants and phone frames), every page, the design map |
| 5. Designer review | Designer | Bespoke touches on the draft. The designer's frames become the source of truth |
| 6. Build | `edge-design-to-site` | Theme, blocks, pages in the Hub, each block's `meta.design` pointing at its frame |
| 7. Keep in step | `edge-design-to-site` section 4 (Figma → CMS); **this skill** section 6 (CMS → Figma) | One design, one site, never drifting |

Stages 2–4 and 6 are agent work; the people decide at stage 0, 3 and 5.

## Why it works (keep all of these)

1. **The anchor sets the taste.** Every value in the plan's design language is measured from an approved human-reviewed frame, not invented. New blocks extend that style; reused sections are duplicates of it. Without an anchor the result reads as generic AI design.
2. **Copy first, word for word.** The copy document is the content; the plan quotes it and the frames use it verbatim. Nothing is invented: missing content is a visible muted `[TBD: …]` layer named `TBD — …`, so gaps are findable instead of hidden behind plausible filler.
3. **Decisions before drawing.** The plan's conflicts table (copy vs anchor, typos, open questions) is answered by the developer before any frame is drawn, so the drawing step never guesses.
4. **Components for everything repeated.** Every card, row, tier, prize, tile and list item is an instance of one component from the kit. This is what keeps pages consistent with each other, and each component maps one-to-one to a CMS array item.
5. **One builder per block, used everywhere.** The frame on the blocks page and every copy on the pages are drawn by the same builder from data, so a block looks identical on every page and the copy for each page lives in data, not in hand edits.
6. **Tier 1 first, then look.** The blocks used on three or more pages are drawn and screenshot-checked against the anchor before anything else, because they set the look of every interior page.
7. **A design map from day one.** Every frame's node id is recorded in the plan; the build step copies it into each block's `meta.design`, and both sync directions use it.

## Tools

- **Figma MCP** (`use_figma`, `get_screenshot`, `get_metadata`, `get_design_context`). Load the `figma-use` skill before the first `use_figma` call (mandatory) and `figma-generate-design` for page assembly.
- **The library in `scripts/figma/`** (`setup.js`, `core.js`, `components.js`, `blocks.js`), installed into the Figma file once; see `reference/figma-build.md`.
- **The Hub's CMS MCP** for section 6 (and to read existing blocks and themes if the site already exists).
- Read `reference/figma-gotchas.md` before the first write. Every item in it cost real time on the first site.

## 1. Content plan

1. Read the whole copy document and the anchor before writing anything. Inspect the anchor with `get_metadata`, `get_design_context` and `get_screenshot` on each section; list every section with its node id.
2. Write `docs/<site>/site-content-plan.md` from the template, section by section. Read `examples/moe-site-content-plan.md` first: it is the finished plan from the first site, with its decisions log and filled design map, and the level of detail to match.
   - **Design language** (§2): colors, type scale, components, textures and section rhythm, each measured from the anchor (exact sizes, weights, radii, paddings, opacities). Where the anchor and the brand guide disagree, note it as a conflict.
   - **Existing block inventory** (§3): each anchor section, its node id, and how the full site reuses it (reuse as is, reuse with a new field, or not at all). New fields must leave the anchor's live page rendering unchanged.
   - **Site map** (§4), **page-by-page plan** (§5) with the exact copy per section, **new block specs** (§6) in two tiers, **image shot list** (§7), **links and forms** (§8).
   - **Conflicts and open questions** (§9): every place the copy and the anchor disagree, every typo, every missing item, each with a proposed default.
   - **Design map** (§10): empty rows for every frame to come.
3. Keep blocks few and reusable: a new block is justified when its layout appears on two or more pages or cannot be expressed by an existing block plus a variant. Variants are an option field on one block, not new blocks.

## 2. Checkpoint

Stop and hand the developer the plan with the conflicts table and the new-block list. Record each answer in §9 as **Decided** with the date. Do not draw until the conflicts that affect layout or content are decided; open items that only affect content become `[TBD]` layers.

## 3. Figma draft

Follow `reference/figma-build.md` in this order, each step in its own `use_figma` call or calls:

1. Install the library and write the config (namespace, token collection, anchor texture and paint sources).
2. `setup.js`: the token collection and text styles from §2.
3. Two new pages: `Site — New Blocks` and `Site — Pages`.
4. `components.js` on the blocks page: icons, placeholders, item components. Add components for any new repeated item the plan needs before drawing blocks.
5. **Tier 1 blocks**, one frame per block and variant, named exactly by block id (`acme-feature-grid / compact`), plus the phone frames §6 asks for. Screenshot each and compare with the anchor; fix before going on.
6. Tier 2 blocks and the reuse states of anchor sections (duplicates with the full site's copy).
7. Pages, one 1171-wide frame each (`Page / About`), nav duplicate at the top, footer duplicate at the bottom, sections in §5 order with the §5 copy. Save each page's copy data in plugin data as you go so later fixes don't need it re-sent.
8. Screenshot every page; fix overlaps, clipped text, broken auto-layout and rhythm (neighbouring sections never share a background).
9. Fill in §10 with every frame's node id, phone frame id, the pages each block appears on, and status.

Never edit the anchor frame or its children; reuse means duplicate.

## 4. Handoff to the designer

Report, and put the same in the plan's §10 notes:
- links to both Figma pages, and which blocks, variants and pages were drawn;
- plan items not drawn and why;
- copy that did not fit its layout, and every place the draft chose between options the plan left open;
- `[TBD]` counts by kind (copy, images, links).

The designer works on the frames directly. Ask the designer to keep layer names and the item components (detaching an instance breaks the array mapping), and to note in the plan which frames she changed, so the build reads the right node.

## 5. Build

Hand over to `edge-design-to-site` with the plan, the design map and the Figma file. Its `meta.design` entries come from §10.

## 6. CMS → Figma sync

When a block changes in the Hub for a reason that did not start in Figma (an accessibility audit, a bug fix, a content-model change, a hand fix), apply it to Figma so the design stays the source of truth. The full procedure is `reference/cms-to-figma-sync.md`: find the change (`cms_diff`, `cms_block_base`), find the frames (`meta.design` and §10's "used on" column), classify it, stop at one checkpoint, apply targeted edits (never redraw a frame the designer touched), annotate every edited node, screenshot before and after, and log the sync in §10.

## When to stop early

- The anchor is missing or not approved: stop at stage 0.
- A conflict that changes layout or content is undecided at stage 3.
- A Figma call fails the same way three times after reading its error and the gotchas.
- A sync change would overwrite the designer's work on a frame.

Say exactly what you need and keep going on anything that doesn't depend on it.

## Do not

- Edit the anchor frames, publish pages, release blocks, or change a live theme.
- Invent copy, prices, names, statistics, dates, prizes, contacts or URLs.
- Draw a repeated item as one-off frames, or detach instances to customise them.
- Bind a translucent paint to a color variable (see the gotchas).
- Commit, push or deploy unless the developer asks.
