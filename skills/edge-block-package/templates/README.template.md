# __PROJECT_NAME__ — package __PACKAGE__

One-paragraph purpose: which page, which sections, what is reused from earlier packages. No page JSON is included; pages are assembled in the Hub.

Organization: `__ORG_ID__` · Site: `__SITE_ID__` · Theme: __THEME_NAME__ (`__THEME_ID__`).

## Blocks

| Block | File | Design node | Responsibility | Synced |
| --- | --- | --- | --- | --- |
| __NAME_PREFIX__ Example Section | `blocks/__BLOCK_PREFIX__-example-section.json` | `1:2` Example Section | | No |

The design node column is the manifest entry's `design` (and the block's `meta.design`): the node the block was built from, which the update workflow starts from.

Tags used: `Content`.

## Facts baked into the defaults

- What the copy asserts and where each fact comes from.
- What must be confirmed before publication.

## Validation

```bash
node generate-package.mjs
node validate-package.mjs
node __VALIDATOR__ .
node preview.mjs   # writes preview/index.html; not an upload input
```

## Files to upload/deploy

### 1. Runtime code to copy/deploy

None. `rendererChanges: false`.

### 2. Theme, Head, Extra CSS, and media

None.

### 3. Hub Blocks manager

Import as new, in this order:

1. `blocks/__BLOCK_PREFIX__-example-section.json`

If a stable ID already exists, stop and compare before choosing Overwrite. Do not choose Import as New for a collision.

### 4. Hub Pages editor

Page block order, top to bottom, including the existing chrome blocks.

### 5. Hub Templates manager

None.

`README.md`, `manifest.json`, `generate-package.mjs`, `validate-package.mjs`, `validate-common.mjs`, `preview.mjs`, and `preview/` are support files and are not upload inputs.

## Manual verification still required

- What to check in Hub preview and on the public renderer.
- Confirm Hub import, page assembly, public rendering, and publication as separate gates.
