# Edge CMS Import Contracts

Use this reference for any task that creates, validates, imports, repairs, or packages blocks and pages.

## Contents

1. Source-of-truth files
2. Library block documents
3. Page block instances
4. Page documents
5. Importer behavior
6. Package generation
7. Validation and parity

## Source-of-truth files

Resolve the active Hub and public frontend first. Then inspect:

- `${FRONT_ROOT}/docs/cms-template-v2-blocks.md`: authoritative Template v2 authoring/runtime guide.
- `${HUB_ROOT}/edge/composables/useCmsNewDocs.js`: library block defaults.
- `${HUB_ROOT}/edge/components/cms/blocksManager.vue`: block import normalization, required keys, type/theme validation, collision handling, and writes.
- `${HUB_ROOT}/edge/components/cms/page.vue`: page schema, import/export, conflict handling, structure behavior, menu update, history, and synced-block resolution.
- `${HUB_ROOT}/edge/components/cms/block.vue`: instance editing, values/meta persistence, and block/library relationships.
- Existing package `README.md`, generator, validator, manifest, one representative block, and one representative page.

Recheck these files when the Hub changes. Import acceptance and a production-safe package are not identical: the Hub importer may accept defaults that package output should make explicit.

## Library block documents

Generate a direct JSON document with these fields:

```json
{
  "docId": "feature-grid",
  "name": "Feature Grid",
  "content": "<section>{{ heading }}</section>",
  "templateVersion": 2,
  "template": "<section>{{ heading }}</section>",
  "schema": {
    "heading": {
      "type": "text",
      "label": "Heading",
      "value": "Features"
    }
  },
  "dataSources": {},
  "values": {},
  "Instructions": "Edit the heading and feature content in the page editor.",
  "aiInstructions": "Keep claims factual and concise. Do not invent statistics.",
  "tags": ["Website"],
  "themes": ["target-theme-id"],
  "type": ["Page"],
  "previewType": "light",
  "synced": false,
  "version": 1
}
```

Required package rules:

- `docId` is stable and unique in the organization block library.
- `content` and `template` are strings and match exactly.
- `templateVersion` is `2`.
- `schema`, `dataSources`, and `values` are objects.
- Library `values` is normally `{}`.
- `Instructions` and `aiInstructions` are present even if empty.
- `tags`, `themes`, and `type` are arrays.
- `type` contains `Page`, `Post`, or both.
- `previewType` is `light` or `dark`.
- `synced` is boolean; `version` is numeric.

The current block importer can accept a direct object or a wrapper:

```json
{
  "docId": "feature-grid",
  "document": {
    "name": "Feature Grid"
  }
}
```

Prefer direct objects in generated packages. A wrapper complicates diffing and is unnecessary unless an existing workflow requires it.

## Page block instances

A page does not merely store library IDs. It embeds a full block-instance snapshot.

Create an instance from the normalized library block and then add a unique page-instance `id` plus the library `blockId`:

```json
{
  "docId": "feature-grid",
  "name": "Feature Grid",
  "content": "<section>{{ heading }}</section>",
  "templateVersion": 2,
  "template": "<section>{{ heading }}</section>",
  "schema": {},
  "dataSources": {},
  "values": {},
  "Instructions": "",
  "aiInstructions": "",
  "tags": [],
  "themes": [],
  "type": ["Page"],
  "previewType": "light",
  "synced": false,
  "version": 1,
  "id": "home-block-01",
  "blockId": "feature-grid",
  "meta": {}
}
```

Identity rules:

- `id` identifies this instance inside this page and is what layout rows reference.
- `blockId` identifies the organization library block.
- `docId` remains the embedded block document ID in current generated packages; never use it as the page layout reference.
- `values` stores page-specific Input values.
- `meta` stores page-specific Data Source control/query/limit state.
- `protection`, when used, is instance state and must be preserved.

The Hub can resolve current library-authored fields through `blockId` while retaining instance `id`, `values`, selected `meta`, and protection. Import blocks first so this resolution has a valid source document.

## Page documents

Use this baseline for an ordinary page:

```json
{
  "docId": "page-home",
  "name": "home",
  "type": ["Page"],
  "content": [],
  "postContent": [],
  "structure": [],
  "postStructure": [],
  "metaTitle": "Home",
  "metaDescription": "",
  "structuredData": "",
  "version": 1
}
```

The current page importer requires these Hub schema fields to exist:

- `name`
- `content`
- `postContent`
- `structure`
- `postStructure`
- `metaTitle`
- `metaDescription`
- `postMetaTitle`
- `postMetaDescription`
- `structuredData`
- `postStructuredData`
- `post`
- `tags`
- `allowedThemes`

The Templates manager derives this list from its live `pageNewDocSchema`. The selected-site page importer derives the same list from `state.newDocs.pages`. Include every field explicitly even when its value is an empty string, `false`, or an empty array; importer defaults are merged only after validation. `type`, `docId`, `version`, `blockIds`, and generation metadata are useful package fields but are not part of that presence check. Copy current adjacent package conventions rather than inventing fields.

### Route-level blog pages and Post templates

These are different page-shaped documents:

- A blog route page has `post: true`. Its `content`/`structure` renders the post index. Its `postContent`/`postStructure` renders the detail shell for the selected post.
- A selectable Post template has `type` containing `Post` and `post` false or omitted. It appears in the Posts manager and is copied into a new post document; it does not create a route or menu entry.

The Posts manager selects scaffold content in this order:

1. non-empty `postContent` plus `postStructure`;
2. otherwise `content` plus `structure`.

Prefer `content`/`structure` for dedicated Post-template packages so the artifact reads as the exact block content copied into the post. Keep `postContent` and `postStructure` as explicit empty arrays to satisfy the page importer. Do not populate both views with competing Post-template content because the non-empty `postContent` view silently takes precedence.

The route-level detail shell must contain a Post Content renderer that loads the route's post record and invokes the CMS nested-block renderer. Keep shared site chrome in that shell. Keep post-specific hero, article body, pull quotes, forms, and related-post treatments in the Post template. If the template owns the hero, omit any fixed detail-shell hero to prevent duplicate title/featured-image output.

Import sequence:

1. library blocks;
2. Post templates through the Templates manager;
3. verify the existing blog route page's detail shell;
4. create a post from the template and publish through the Posts manager.

### Content and structure

For one full-width row per block:

```json
{
  "content": [
    {
      "id": "home-block-01",
      "blockId": "feature-grid",
      "docId": "feature-grid",
      "name": "Feature Grid",
      "content": "<section>...</section>",
      "templateVersion": 2,
      "template": "<section>...</section>",
      "schema": {},
      "dataSources": {},
      "values": {},
      "meta": {}
    }
  ],
  "structure": [
    {
      "id": "home-row-01",
      "width": "full",
      "gap": "4",
      "background": "transparent",
      "verticalAlign": "start",
      "mobileOrder": "normal",
      "columns": [
        {
          "id": "home-column-01",
          "blocks": ["home-block-01"],
          "span": null
        }
      ]
    }
  ]
}
```

Rules:

- `content` and `postContent` are arrays of embedded instances.
- `structure` lays out `content`; `postStructure` lays out `postContent`.
- Every row has a unique ID and a `columns` array.
- Every column has a unique ID and a `blocks` array.
- Each `blocks` entry equals an instance `id`, never a library `blockId`.
- Keep instance IDs unique across both page views to avoid ambiguous editing and diffs.
- Validate each content instance is placed exactly once unless current Hub behavior explicitly supports otherwise.
- Keep `postContent` and `postStructure` empty arrays for pages without a post/detail view.
- For a Post template, validate the view the Posts manager will actually select: non-empty `postContent` first, otherwise `content`.

## Importer behavior

### Blocks

The current Hub block importer:

1. Parses one or more selected JSON files.
2. Normalizes direct documents or `document` wrappers.
3. Prompts for `docId` when absent.
4. Normalizes Template v2 fields and block type.
5. Checks referenced theme IDs against the target organization.
6. Can clear unavailable theme restrictions rather than rejecting the entire block.
7. On an existing ID, asks whether to overwrite, import as a new unique ID, or cancel.
8. Stores the result in the organization block collection.

Do not depend on interactive ID prompts or automatic theme clearing in a deterministic package.

### Pages

The current Hub page importer:

1. Parses one or more selected JSON files.
2. Normalizes direct documents or `document` wrappers.
3. Applies structured-data defaults when blank.
4. Requires all current page schema keys.
5. Prompts for `docId` when absent.
6. On an existing ID, asks whether to overwrite, import as a new random ID/name, or cancel.
7. Stores the draft under the selected site's pages collection.
8. For a newly created page, attempts to append a menu entry to `Site Root` if the page is not already represented.
9. Can succeed at page storage while failing menu update; report this as partial success.
10. Does not publish the page.

For a package intended to replace prior stable pages, document that the operator should choose **Overwrite**. Choosing import-as-new creates new identity and can leave old pages/menu entries in place.

## Package generation

Recommended deterministic order:

1. Normalize all library blocks.
2. Write block JSON with stable IDs.
3. Build page instances from the normalized block objects.
4. Assign deterministic instance, row, and column IDs.
5. Build `content`/`structure` and `postContent`/`postStructure` together.
6. Write page JSON.
7. Write a manifest containing source provenance and stable artifact IDs.
8. Write import instructions with theme and runtime dependencies.
9. Run the package validator and skill validator.

Avoid reading output file mtimes as intentional-change evidence. A generator may rewrite every file. Review semantic diffs, counts, IDs, templates, schema, sources, page composition, and validation results.

Recommended import order:

1. Theme JSON, Head JSON, Extra CSS, and required media.
2. Library blocks.
3. Pages.
4. Site menu and route verification.
5. Hub preview and editor verification.
6. Public frontend preview/parity verification.
7. Publish only when authorized.

## Validation and parity

Validate at four levels.

### JSON

- Every file parses.
- No duplicate keys are introduced by generation.
- Stable IDs are present.

### Contract

- Blocks match the library contract.
- Page instances embed valid block documents.
- Structure references instance IDs one-to-one.
- Package pages reference packaged library `blockId` values or explicitly documented pre-existing/runtime-owned blocks.

### Hub

- Block and page importers accept the files.
- Block editor exposes expected Inputs and Data Sources.
- Page editor preserves layout, values, meta controls, post view, and theme.
- New page menu changes are correct.

### Public frontend

- Templates use `source(...)` for Data Sources.
- KV indexes, metadata, canonical records, and mirrors exist.
- Skeleton and loaded states behave during hydration.
- Helper contracts reinitialize on client navigation.
- Installed template-engine versions support the used grammar.
- Published page output and cache invalidation are verified independently from Hub preview.
