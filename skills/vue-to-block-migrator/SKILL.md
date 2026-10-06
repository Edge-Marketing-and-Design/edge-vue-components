---
name: vue-to-block-migrator
description: Create a block from scratch or convert Vue SFCs, HTML/CSS mockups, and design handoffs into importable Edge CMS Template v2 library blocks, CMS page documents, and validated import packages. Use only for CMS Template v2 artifact creation, conversion, import troubleshooting, package generation, theme-aware migration, or Hub-to-public-renderer parity. Do not use for Hub administrative application UI, Nuxt pages/components, or design-system implementation.
---

# Vue, HTML, and CSS to Edge CMS

## Boundary

Use this skill only when the requested output is an Edge CMS Template v2 block,
CMS page document, template, or import package. It may inspect Hub authoring code
and public-renderer contracts to preserve artifact compatibility, but that does
not make ordinary Hub application UI a CMS migration task.

Do not use this skill for Nuxt dashboard pages, application components,
application navigation, feature interfaces, or design-system implementation.
Route that work through the active repository's `AGENTS.md`,
`docs/features/registry.yaml`, the applicable OpenSpec change, and linked
`docs/engineering/application-ui.md` guidance. Do not convert application UI
into CMS blocks unless the user explicitly requests CMS import artifacts.

## Block vocabulary

The words below mean exactly this, here and in the contracts:

- **Library block**: the document at `organizations/{orgId}/blocks/{blockId}`. It holds the released definition (template, schema with defaults, data sources) that pages copy from.
- **Instance**: a copy of a library block placed in a page's or post's `content`, with its own `values`. Published pages carry the definition inline; the public renderer reads instances from KV and never reads the library.
- **Synced**: a synced block shares one instance's values across a site's pages. It is placed without values; the first instance on a site is placed in the Hub, and later placements copy it.
- **Override**: an override block is one the public renderer replaces with a Vue component resolved from the block name. The CMS HTML is the editor preview and the fallback, and the block is the design source of truth for the component.
- **Draft and release**: an edit to an existing library block is a draft revision; library changes reach pages only through a release, which a developer runs in the Hub. Nothing here releases.
- **Site chrome**: the synced navigation and footer blocks every page of a site shares.

## Purpose

Produce supported Template v2 artifacts, not raw Vue parity:

- library block JSON for the Hub block library;
- page JSON containing page-specific block instances and layout structure;
- optional import packages with theme dependencies, blocks, pages, manifest, instructions, and validation;
- an explicit report of dynamic data, theme, index, helper, and runtime requirements.

Never treat block creation, page assembly, importing, and publishing as the same operation.

## Resolve the Active Repositories

Do not assume Clearwater Hub, IAFSC Hub, or any fixed path is the active checkout. Resolve paths for every task.

1. Prefer a user-supplied Hub path or the current workspace.
2. If the current workspace is a parent directory, locate the task-named Hub beneath it before using `git rev-parse --show-toplevel` from that Hub.
3. Otherwise use `git rev-parse --show-toplevel` from the relevant working directory.
4. Accept a candidate only when it contains `AGENTS.md`, `edge/components/cms/blockEditor.vue`, and `edge/components/cms/page.vue`.
5. Read the Hub `AGENTS.md` before work. Read `RELATED-REPOSITORIES.md` when the public renderer, template engine, or another repository may be involved.
6. Resolve `emd-cms-front` in this order: a user-supplied path, workspace or relationship configuration, an adjacent checkout, then a bounded search beneath the common development root. A candidate must contain `docs/cms-template-v2-blocks.md`, identify itself as the shared public renderer, and list or otherwise support the selected Hub. Do not silently select among multiple valid candidates or substitute an old checkout.
7. If the correct Hub or public frontend cannot be located, stop before final artifact generation and ask for the path.

Suggested shell setup after discovery:

```bash
HUB_ROOT="$(git rev-parse --show-toplevel)"
test -f "$HUB_ROOT/edge/components/cms/blockEditor.vue"
test -f "$HUB_ROOT/edge/components/cms/page.vue"

# Check the adjacent layout first. If it is absent, search only beneath the
# common development root and review every result before choosing one.
test -f "$HUB_ROOT/../emd-cms-front/docs/cms-template-v2-blocks.md" \
  || find "$(cd "$HUB_ROOT/../.." && pwd)" -maxdepth 4 -type f \
    -path '*/emd-cms-front/docs/cms-template-v2-blocks.md' -print
```

Treat these commands as discovery and verification, not permission to choose the first match. Set `FRONT_ROOT` only after confirming the renderer's `AGENTS.md`, `RELATED-REPOSITORIES.md`, Git remote, and selected-project configuration where applicable.

## Load Current Sources

Read the public renderer's `AGENTS.md` first, then follow its routing for the authoritative guide:

```text
${FRONT_ROOT}/docs/cms-template-v2-blocks.md
```

At minimum, read the guide's Agent quick contract, system boundaries, and end-to-end rendering flow before authoring or repairing Template v2 artifacts. Load only the task-relevant reference sections unless the live renderer instructions require the complete guide.

Then read only the live Hub sources required by the task:

- Block authoring: `edge/components/cms/blockEditor.vue`, `blockRender.vue`, `blockApi.vue`, `block.vue`, `blocksManager.vue`, `edge/composables/useCmsNewDocs.js`.
- Legacy conversion: `edge/composables/useCmsTemplateV2Conversion.js`.
- Page creation/import: `edge/components/cms/page.vue`.
- Runtime helpers: `edge/components/cms/htmlContent.vue`.
- AI merge behavior: `functions/cms.js` and `edge/functions/cms.js`.
- Existing package: its `README.md`, generator, validator, manifest, representative block, and representative page.

For page or package work, read [references/import-contracts.md](references/import-contracts.md) completely. For helper-driven behavior, read only the relevant section of [references/runtime-helpers.md](references/runtime-helpers.md).

When live source and this skill disagree, live source wins. Report the mismatch.

## Select the Artifact Scope

| User request | Produce | Do not imply |
| --- | --- | --- |
| Convert one component | One library block JSON | That a page or package was created |
| Build a page | Required library blocks plus one page JSON | That importing or publishing occurred |
| Build an import package | Theme dependencies, blocks, pages, manifest, instructions, validator | That Firebase/KV changed |
| Import into the Hub | Perform the authorized Hub import flow | That the page is published |
| Publish | Publish only when explicitly authorized | That local validation alone proves production parity |

If scope is ambiguous, generate local import artifacts and stop before external or production writes.

## End-to-End Workflow

### 0. Receive the contracts

Call `cms_contract` (the Hub's CMS MCP) for every kind the task will write: `blocks` always, `themes` for Theme or Head JSON, `posts` for post blocks or page documents that render posts, `operations` when artifacts are created through the agent operations. Read the returned text before authoring. The completion summary and the package README list each field written and the contract line it follows (section and field name). Without the MCP (a package-only session in a repository with no Hub), read the file by path from the resolved Hub checkout (`${HUB_ROOT}/docs/data-contracts/cms-<kind>/README.md`) and say in the handoff that the contract was read by path, with the Hub commit.

### 1. Scout and classify

- Identify source paths, output path, target site/theme, requested pages, and expected routes.
- Classify each source as Vue SFC, standalone HTML, HTML plus CSS, mixed mockup, or existing block/page JSON.
- Inspect adjacent package conventions before inventing names or IDs.
- Check `git status --short` and preserve unrelated work.

### 2. Inventory behavior and content

Record:

- static structure and copy;
- editable fields;
- repeated/manual arrays;
- collection/API data;
- site/theme-controlled values;
- helper-controlled behavior;
- placeholders, mock records, temporary links, and unsupported scripts;
- style dependencies and runtime-owned components/overrides.

For generated mockups or uncertain sources, present this table before final JSON:

| Source item | Current value | Classification | Block mapping | Source of truth | Fallback | Decision needed |
| --- | --- | --- | --- | --- | --- | --- |

Use these classifications: `static`, `editable`, `manual array`, `collection/API dynamic`, `site/theme controlled`, `system/helper controlled`, and `remove`.

Do not silently hard-code fake listings, agents, offices, testimonials, prices, dates, claims, credentials, contact details, counts, locations, or stock images. If a source-of-truth decision is unresolved, pause final import JSON unless the user explicitly approves an assumption.

### 3. Load the theme contract

Use one of:

- a Hub theme export;
- supplied Theme JSON, Head JSON, and Extra CSS;
- a repo-tracked theme contract;
- authorized read-only Firebase output.

Inventory custom classes, CSS variables, fonts, theme tokens, slots, variants, and head dependencies. If unavailable, use semantic HTML and known CMS-safe utility classes. Do not invent project- or theme-prefixed classes, and do not assume live Firebase theme CSS.

Put reusable presentation in Theme Extra CSS. Keep block-specific structure in utilities or small safe inline styles. Do not duplicate a generated design system inside every block.

### 4. Convert each library block

Use a repo converter only after confirming its current command in `package.json` or repo scripts. Do not guess obsolete flags. If no converter exists, convert manually.

For Vue/JSX/HTML:

- preserve semantic HTML, responsive layout, heading order, labels, links, and image intent;
- replace supported state and behavior with Template v2 fields, Data Sources, and CMS helpers;
- remove Vue directives, component imports, inline handlers, external runtime dependencies, and unsupported scripts;
- replace repeated mock markup with manual arrays or runtime sources;
- add skeleton markup for asynchronous data;
- add accessible alt text or an equivalent for meaningful images;
- document behavior that cannot carry over.

### 5. Normalize the block contract

Every generated library block must include:

```json
{
  "docId": "example-block",
  "name": "Example Block",
  "content": "<section>{{ heading }}</section>",
  "templateVersion": 2,
  "template": "<section>{{ heading }}</section>",
  "schema": {
    "heading": {
      "type": "text",
      "label": "Heading",
      "value": "Example heading"
    }
  },
  "dataSources": {},
  "values": {},
  "Instructions": "Edit the heading in the page editor.",
  "aiInstructions": "Write a concise factual heading. Do not invent claims.",
  "tags": [],
  "themes": [],
  "type": ["Page"],
  "previewType": "light",
  "synced": false,
  "version": 1
}
```

Rules:

- Set `templateVersion` to `2`.
- Keep `content` and `template` identical for import/preview compatibility.
- Define editable Inputs in `schema`; tokens alone do not create Inputs.
- Define runtime sources in `dataSources` and call each with `source("name")`.
- Keep library `values` as `{}`; put defaults in `schema[field].value`.
- Keep instance Data Source overrides in page-instance `meta`, not in library definitions.
- Use `label`, not legacy `title`, for new Input labels.
- Choose `previewType`, `type`, `themes`, and `synced` intentionally.
- Include useful `Instructions` and restrictive, context-aware `aiInstructions`.

### 6. Use supported Template v2 grammar

- Editable field: `{{ field }}`.
- Formatter: `{{ formatter(field) }}`.
- Manual array: `{{#for item in items}}...{{/for}}`.
- Data Source: `{{#for item in source("items")}}...{{/for}}`.
- Nested source: `source("children", { queryItems: { parentId: parent.id } })`.
- Object iteration: `entries(object)`.
- Conditions: use the guide's triple-brace JSON `#if`/`#else` syntax.
- Async state: pair `{{ loading }}` skeletons with `{{ loaded }}` content.

Use `richtext(value)` only for trusted rich-text Inputs. Normal text and formatter output is escaped.

### 7. Configure dynamic data safely

- Manual repeated content belongs in `schema` with `type: "array"`.
- Collection/API content belongs in `dataSources` and must be called with `source(...)`.
- Use `canonicalLookup` when the exact canonical key is known.
- Use `canonical: true` for indexed multi-result loops that need complete canonical fields.
- Treat collection `path` as organization-relative where the current contract does.
- Preserve runtime tokens such as `{orgId}`, `{siteId}`, `{routeLastSegment}`, `{pageId}`, and `{postId}`.
- Store Data Source control selections in page-instance `meta` using the current Hub shape.

For every collection source, identify:

- Firestore collection/path and preview query;
- public KV path and unique key;
- indexed lookup fields;
- metadata fields needed before canonical resolution;
- canonical key and required canonical fields;
- mirror configuration and backfill needs;
- Firestore composite-index impact separately from KV-index impact.

Hub preview success is not public frontend proof.

### 8. Use runtime helpers

Prefer CMS helper contracts over custom client code:

- navigation and current-route behavior;
- contact forms;
- carousels;
- auth/account/plan controls;
- publications;
- scroll reveal;
- nested post/event content.

Load the relevant section of [references/runtime-helpers.md](references/runtime-helpers.md) before implementing one of these behaviors.

### 9. Assemble pages

For page or template output, follow [references/import-contracts.md](references/import-contracts.md).

Core invariants:

- A page is a separate document, not an array of library block IDs.
- `content` and `postContent` contain full page-specific block instances.
- Each instance has a unique `id` used by page layout and a `blockId` pointing to the library block `docId`.
- Preserve instance `values`, `meta`, and protection state separately from library definitions.
- `structure` and `postStructure` contain rows/columns whose `blocks` arrays reference instance `id` values.
- Every structure reference must resolve exactly once; every content instance must be placed exactly once unless the current Hub explicitly supports another pattern.
- Use unique, deterministic page, instance, row, and column IDs within a generated package.
- Mirror every key in the live page import schema, including blank post SEO fields, `post`, `tags`, and `allowedThemes`. The Hub validates field presence before merging importer defaults.

Classify post artifacts before generating them:

- A route-level blog page uses `post: true`; its `content`/`structure` is the post index view and its `postContent`/`postStructure` is the detail shell.
- A selectable Post template uses `type: ["Post"]` with `post` false or omitted. The Posts manager copies the template's `postContent`/`postStructure` when non-empty, otherwise it falls back to `content`/`structure`.
- Post templates scaffold post documents; they do not create routes. Keep navigation/footer/site chrome in the route-level blog page and keep article-specific heroes/body/related content in the Post template.
- If a Post template supplies its own hero, remove or skip a fixed hero in the route-level detail shell to avoid duplicate titles and featured images.

Import library blocks before their pages so the Hub can resolve `blockId` references against current library documents.

### 10. Build a package

Use this layout unless an existing package has a stronger local convention:

```text
package-root/
├── README.md
├── manifest.json
├── validate-package.mjs
├── blocks/
│   └── block-doc-id.json
├── pages/
│   └── page-doc-id.json
└── templates/
    └── post-template-doc-id.json
```

The README must state:

- target theme and required Theme JSON/Extra CSS/Head JSON;
- exact import order, with every upload/deploy filename listed individually;
- intended overwrite behavior;
- runtime-owned overrides or external data dependencies;
- validation command;
- manual verification and publish steps;
- that generation/import does not itself publish.

The manifest should list stable block/page IDs and source provenance. Generation must be deterministic except for an explicitly documented timestamp field. Do not use broad regenerated mtimes as proof that every artifact changed intentionally.

### Required upload/deployment handoff

In both the package README and the final completion summary, include a `Files to upload/deploy` section that enumerates every required artifact by exact filename. Never replace the list with category-only wording such as “upload the blocks,” “overwrite the page,” or “copy the override.”

Group the list by destination and action:

1. Runtime code to copy/deploy: give the exact source file and exact destination path in the renderer repository.
2. Theme, Head, or Extra CSS artifacts: list each upload filename, or state explicitly that none are required.
3. Hub Blocks manager: list every block JSON filename separately and state whether to overwrite or import as new.
4. Hub Pages editor: list every page JSON filename separately and state whether to overwrite or import as new.
5. Hub Templates manager: list every template JSON filename separately when applicable.

Also identify package support files such as `README.md`, `manifest.json`, generators, validators, source checkouts, and tests as **not upload inputs**. Use absolute clickable source paths in the final response when the files are local. If a layer requires deployment rather than a Hub upload, say so explicitly instead of calling it an upload.

### Link locally modified block files

Whenever the work creates or modifies a local library block file, every
completion, partial result, or blocking handoff must include a clickable
Markdown link to that file using its absolute local path. List multiple block
files separately so each artifact is directly accessible.

Do not require or automatically provide a Hub editor, public site, renderer, or
other production implementation link. A local artifact does not prove that a
corresponding remote block exists, was imported, or was published. Provide a
remote link only when the user explicitly asks for it or when it is otherwise
necessary to complete an explicitly authorized live workflow, and label the
remote state accurately.

### 11. Validate before handoff or import

Run the package's own validator when present, then run the skill validator:

```bash
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/vue-to-block-migrator"
node "$SKILL_DIR/scripts/validate-cms-import.mjs" /absolute/path/to/package-or-json
```

This skill is versioned in the shared Edge code (`edge/skills/` in every
Hub). The skill validator first runs the Hub's own import check,
`scripts/cms/validate-import.mjs`, which is the same check the Hub import
runs, then this skill's stricter package conventions. It can also be run on
its own:

```bash
node /absolute/path/to/hub/scripts/cms/validate-import.mjs [--themes id1,id2] /absolute/path/to/package-or-json
```

Also run:

```bash
jq empty /absolute/path/to/artifact.json
git diff --check -- /absolute/path/to/changed/artifacts
```

Validation must cover:

- block required keys and types;
- `templateVersion: 2` and `content === template`;
- schema/Data Source object shapes and declared `source(...)` names;
- page required keys and array shapes;
- unique block-instance IDs;
- row/column layout references and one-to-one placement;
- package page `blockId` references against packaged library blocks;
- theme IDs and style dependencies;
- placeholder/dynamic-content decisions;
- helper markup and accessibility;
- Firestore/KV query requirements.

Treat warnings as unresolved review items, not silent success.

### 12. Import safely when authorized

Importing is an external write. Do it only when the user asks.

1. Confirm the target organization, site, and theme.
2. Apply required theme configuration first.
3. Import all library blocks through Blocks.
4. Resolve every block conflict deliberately: overwrite, import as new, or cancel.
5. Import page files through the target site's Pages editor.
6. Resolve page conflicts deliberately. For replacement packages, prefer overwrite when stable `docId` identity must be preserved.
7. Check the site menu after new page imports; the Hub currently attempts to add new pages to `Site Root`.
8. Open each page, verify layout, values, Data Source controls, and theme behavior, then save if needed.
9. Publish only under explicit authorization.

The Hub accepts a direct document object and can normalize a `{ "docId": "...", "document": { ... } }` wrapper. Generate direct document objects unless compatibility requires the wrapper. Missing `docId` triggers an interactive prompt. Do not rely on prompts for deterministic packages.

If a block references unavailable theme IDs, the current importer may clear those theme restrictions rather than reject the block. Preflight target theme IDs and report any adjustment.

## Failure Handling

- **Wrong checkout:** stop and resolve the active Hub/frontend; do not edit a stale clone.
- **Invalid JSON:** report the file and parser error; fix locally and rerun all validators.
- **Missing `docId`:** add a stable ID before batch import.
- **Collision:** do not choose overwrite or import-as-new implicitly when identity matters.
- **Page structure mismatch:** regenerate structure from instance IDs; do not patch orphan references ad hoc.
- **Page imported but menu update failed:** page data may still exist; report partial success and repair the site menu separately with authorization.
- **Preview works but frontend is blank:** check bare loops versus `source(...)`, KV indexes/mirrors, canonical resolution, cache invalidation, and installed template-engine versions.
- **Missing theme:** preserve a readable utility fallback, list missing classes/tokens, and do not claim visual parity.
- **Unsupported behavior:** remove unsafe runtime code, preserve layout/content where possible, and disclose the exact loss.
- **Generator rewrote everything:** inspect semantic JSON diffs; do not equate mtimes or `generatedAt` churn with reviewed changes.

## Quality Gate

Before completion:

1. Re-read every changed artifact and the source it replaces.
2. Run the package validator, skill validator, `jq`, and `git diff --check`.
3. Verify representative static, manual-array, collection/API, helper-driven, and nested-source blocks as applicable.
4. Verify page content/structure and postContent/postStructure independently.
5. Verify Hub preview and public frontend independently when a live flow is available.
6. Report what was automated, manually verified, not verified, and why.

Completion summary must include:

- artifacts changed or generated;
- clickable absolute local file links for every locally created or modified
  block artifact;
- a `Files to upload/deploy` section listing every exact filename, destination/action, and overwrite behavior;
- source-to-field/data-source mapping decisions;
- each field written and the contract line it follows (step 0);
- page and package composition;
- theme/style dependencies;
- query/index/mirror impact;
- commands run and results;
- Hub import and publication status;
- manual verification;
- remaining behavior loss, risks, and follow-ups.
