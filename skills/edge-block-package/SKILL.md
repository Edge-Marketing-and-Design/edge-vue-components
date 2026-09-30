---
name: edge-block-package
description: Build Edge CMS Template v2 block import packages from a Claude Design handoff or a content plan, one page at a time, for any Hub (emd-cms, clearwater-hub, iafsc-hub). Use when asked to create blocks, a block package, an importfiles package, a site setup package, post/article blocks, or to turn a design handoff into CMS blocks. Reads the project's importfiles/PROJECT.md first, scaffolds a package with generator, validator, and preview scripts, and enforces the Hub-is-source-of-truth workflow. Do not use for Hub application UI, Nuxt pages, or renderer code; overrides in emd-cms-front are a separate task this skill only hands off.
---

# Edge block package

Repeatable process for producing Template v2 library blocks that a human uploads into a live Edge CMS Hub. Proven on The Mule (emd-cms, September 2026). The vue-to-block-migrator skill owns the block grammar; this skill owns the packaging workflow around it.

**With the Hub's agent tools** (the CMS MCP with an agent key), building a whole site follows the edge-design-to-site skill: author and validate blocks here (steps 1–6), then create them in the Hub with `block.create` instead of handing files over, and keep going to the next page. Its two checkpoints replace the per-package review in step 8 and the one-page limit below.

## Boundary

- Output is an import package under the project's `importfiles/` folder: block JSON files, a manifest, a README with upload steps, and support scripts. Never Hub application code, never renderer code.
- The Hub is the source of truth. Package files deliver **new** blocks. An existing Hub block is edited by pulling its live document through the Firebase MCP, editing that copy, and re-importing with Overwrite. Never regenerate an existing block from a local file. A git-based flow once cost the operator about 60 hours; do not reintroduce it.
- Shared renderer changes (Vue override blocks) are a separate task in `emd-cms-front`. This skill writes the handoff note and flags `rendererChanges: true`; it never edits that repository.

## Read first

1. `<importfiles>/PROJECT.md`. It carries the organization, site, and theme ids, the block prefix, the tag set, the chrome block names, the override folder, and where approved copy lives. If it is missing, gather those facts from the operator and write it before building anything (template: `templates/PROJECT.template.md`).
2. The precedent package for that Hub (PROJECT.md names it). Match its file shape exactly.
3. The design handoff or content plan, in full, before writing a block. Design files are annotations, not authority.

## Workflow

1. **Review before build.** Compare the design with the live site and any existing packages. List what to keep, what to correct, and what is invented. Invented people, quotes, headshots, job openings, statistics, promises, and stock image URLs never persist in a block; they become editable inputs that default to approved copy or stay empty with an intentional fallback.
2. **Establish what exists.** Through the Firebase MCP, list the Hub's current blocks and pages for the site. Decide per stable id: overwrite, new, or retire. Record it in the package README.
3. **Scaffold** one package per page with `node <skill>/scripts/scaffold.mjs <package-name> --dir <importfiles/project>`. Four blocks or fewer per package; quality drops beyond that.
4. **Write the blocks** in `generate-package.mjs`: template markup in `String.raw`, a `schema` object with every editable value, `makeBlock` for the document shape, and the manifest. Follow `reference/template-v2-contract.md` and the migrator skill for grammar.
5. **Validate three ways**: `node generate-package.mjs && node validate-package.mjs && node <validatorPath from PROJECT.md> .` The package validator renders every block through `@edgedev/template-engine` with its defaults and asserts the project's content rules. `validatorPath` should be the Hub's shared import check, `scripts/cms/validate-import.mjs` (relative to `hubPath`): it runs the exact check the Hub import runs, so a package that passes imports without rejections.
6. **Preview** with `node preview.mjs`, serve the folder, and look at desktop and phone widths. Fix what you see. Common catches: figures wrapping on phones, three-column grids at 375px, design-board labels baked into renders, duplicate headlines between a section heading and an image.
7. **Write the README**: block table with responsibilities and synced flags, facts baked into defaults, validation commands, files to upload in order with import modes, page assembly order, manual verification. Support files are not upload inputs; say so.
8. **Stop.** Hand the package over and wait for the operator to upload and review before starting the next one. Corrections carry forward.

## Rules the validator should enforce

- `templateVersion: 2`, `content === template`, library `values: {}`, defaults in `schema[field].value`, inputs use `label` (never `title`), `themes: [themeId]`, tags from the project's set, `type` includes `Post` only where authors may place the block in posts.
- Theme names: for a theme that uses the standard names (every new theme; `reference/theme-guidelines.md`, "Standard names"), classes use only `primary`, `onPrimary`, `canvas`, `font-display`, `rounded-card` and the rest of that set; tints are opacity modifiers; no hex, palette or `var(--color-…)` colors. Validate with `--standard-theme`: any `theme.*` finding fails the block. Each block's outer element sets its base font and text color (`font-sans text-text`); themes leave `apply` empty, because the public renderer ignores it. Don't combine `m-0` with `mt-*`/`mb-*` on one element (the Hub editor lets `m-0` win); use `mx-0` plus the side you need.
- Balanced HTML; no `<script>`; no Vue directives or inline handlers; conditionals as `{{{#if {"cond":"..."} }}}`; every declared data source called with `source("name")` and vice versa; literal utility classes only; no JSON-LD in blocks.
- Rendered defaults contain no unresolved `{{ }}`, no exclamation points, none of the project's banned phrases, and no claim the project has ruled out.
- Every image input has a paired alt input; renders and compositions are called illustrations, never screenshots.
- Numbers come from a source the validator can recompute (a shared model, a fixture); hand-typed figures fail.
- Override blocks: name normalizes (camelCase) to an existing Vue file; schema carries every value the Vue component reads; `isOverrideBlock: true`; manifest `rendererChanges: true`.

## Package layout

```text
importfiles/<project>/<NN-package-name>/
  generate-package.mjs     templates, schemas, manifest; writes blocks/ and manifest.json when run directly
  validate-package.mjs     package-specific assertions on top of validate-common.mjs
  validate-common.mjs      shared assertions (copied in by scaffold so the package is self-contained)
  preview.mjs              renders blocks into preview/index.html with the project's theme tokens
  README.md                block table, upload order, import modes, page assembly, manual checks
  manifest.json            generated
  blocks/<id>.json         generated, one file per block, descriptive kebab-case ids with the project prefix
  media/                   files the operator uploads to CMS Media, listed in the manifest
  values/                  instance values for existing blocks placed on a page (not uploads)
```

Numbering packages (`00-site-setup`, `01-global-chrome`, `02-home` ...) keeps upload order obvious.

## Site chrome, posts, overrides

- Navigation and footer are synced blocks that read the Site record through `siteDoc` (see `reference/chrome-and-helpers.md`). Never replace Site menu links or the Site logo with static content. New pages reuse the existing chrome blocks.
- Post-enabled pages: listing blocks read `source("posts")` index metadata; detail blocks look up `queryItems.name = {routeLastSegment}` and render the body with `renderBlocks` (see `reference/posts-contract.md`).
- Override blocks and the emd-cms-front handoff: `reference/override-blocks.md`.

## Do not

- Without the agent tools: build more than one page or four blocks before the operator has reviewed the previous package.
- Rebuild chrome, theme, or head for one page.
- Put a page JSON in a package unless the precedent package for that Hub does; pages are assembled in the Hub.
- Edit `emd-cms-front`, commit, publish, or deploy.
