# CMS themes data contract

Status: in use; the baseline names are adopted for new themes, and older themes keep working with warnings.

Last verified: 2026-11-10, splash screen defaults in theme settings

A theme is the Tailwind configuration, head markup and extra CSS a site
renders with, plus the pages and settings a new site starts from. This
contract covers the theme document, its public copy, and the standard color,
font and radius names every new theme defines and portable blocks use.

## Storage

| Documents | Path |
| --- | --- |
| Themes | `organizations/{orgId}/themes/{themeId}` |
| Theme proposals | `organizations/{orgId}/themeProposals/{id}` (`edge/docs/data-contracts/cms-operations/README.md`) |
| Template pages | `organizations/{orgId}/sites/templates/pages/{pageId}`, the pages a theme's default menus point at |
| Custom font files | `organizations/{orgId}/files/{fileId}` with `meta.themeId` and `meta.cmsFont: true` |

The Hub writes themes from the browser through `edgeFirebase.storeDoc`
(the theme editor, history restore); `theme.create` and `theme.update`
write them from the Functions. The wrapper adds `last_updated`, `uid` and
`doc_created_at`.

## Fields

<!-- fields: theme generated from CMS_DOCUMENT_FIELDS -->

New themes start from `edge/lib/cmsThemeDefaults.mjs`
(`createCmsThemeDefaults`, `createCmsThemeHeadDefaults`), the one source of
truth for the Hub's New Theme form (`useCmsNewDocs`) and for `theme.create`
when `fields.theme` or `fields.headJSON` is omitted. Explicit JSON is
preserved, never merged or renamed. Existing themes, their duplicates and
their sites are not converted.

A completed font upload tagged for a theme (`meta.themeId`, `meta.cmsFont`,
not `meta.autoLink: false`) appends a `link` entry for its public URL to the
theme's `headJSON` (`fontFileUpdated`); `@font-face` rules stay in
`extraCSS`.

## Public projection

Every theme write is mirrored to KV by `onThemeWritten` (`functions/cms.js`):

| Key | Value |
| --- | --- |
| `themes:{orgId}:{themeId}` | `{ theme, headJSON, extraCSS }` with `theme` and `headJSON` parsed to objects |

There is no published copy of a theme: the public renderer reads the live
document's mirror, which is why a theme a published site uses is live and
accepts only proposals through the operations. When `theme`, `headJSON` or
`extraCSS` changes, the mirror's follow-up increments `version` on every
`published-site-settings` document (and its `sites` document) whose `theme`
is the theme, so the renderer's caches refresh.

The public renderer (`emd-cms-front`, the template engine's `unoCssFromHtml`)
generates utilities from the block markup and the theme's `extend` groups. It
ignores `apply`; the Hub does not apply it either.

## Consumers

- **Hub:** `edge/components/cms/themeEditor.vue` (Theme JSON, Head JSON,
  Extra CSS, Default Templates, Default Site Settings, history),
  `themeDefaultMenu.vue`, `fontUpload.vue`, `site.vue` (seeding a new site
  from the theme, `allowedThemes`), `blockEditor.vue` and the page editor
  (rendering with the theme).
- **Functions:** `onThemeWritten` and its site-version follow-up
  (`functions/kv/kvMirrorFollowups.js`), `fontFileUpdated`, the theme
  operations (`functions/cmsOperations.js`), the preview render payload.
- **Public renderer:** `emd-cms-front` reads the `themes:` dataset.
- **Agents and tooling:** the CMS MCP (`cms_find_theme`, `cms_get_theme`,
  which returns the five editor surfaces and the linked custom fonts),
  `theme.create`, `theme.update` and `theme.propose`, the
  `edge-design-to-site` skill, `scripts/cms/validate-import.mjs` for theme
  files in import packages.

The checker (`edge/lib/cmsBlockValidation.js`, with its Functions copies),
the operations and the import script share the name lists in
`edge/lib/cmsThemeDefaults.mjs`.

## Invariants and validation codes

### The names

Theme JSON defines **all** of these as a baseline, the colors in
`extend.colors` (or top-level `colors`); additional names may be defined:

<!-- theme names: generated from THEME_NAME_GROUPS -->

Other `extend` groups (`fontSize`, `boxShadow`, spacing) are not
standardized. `apply` stays empty, in the theme and its variants, because
neither renderer applies it; blocks set their own base font and text color. A
standard theme with `apply` rules is refused (`theme.apply-rules`).

Blocks using only the baseline can switch between compatible themes: swapping
a site's theme never leaves a block asking for a color the new theme lacks, or
showing a color under a name that no longer describes it, and a group of
themes can be offered as interchangeable because they share one contract.
Custom names remain allowed; blocks using them are compatible only with
themes that also define them.

### Blocks

Portable blocks use the baseline names, plus `white`, `black`, `transparent`,
`current` and `inherit`, Tailwind's sizes and weights, and `font-mono`:

- tints and hover shades use opacity modifiers (`hover:bg-accent/90`,
  `text-heading/5`), not new colors;
- no hard-coded colors: no `bg-[#d96a20]`, no Tailwind palette colors
  (`text-red-500`);
- additional names (including CSS variables) must be defined in every theme
  selected for the block; the operations check that common set;
- decorative textures and patterns (a topography line pattern) go in the
  theme's Extra CSS as a class, colored with the standard names.

### Enforcement

| Where | New or standard theme | Theme that predates the names |
| --- | --- | --- |
| `theme.create` | Shared defaults when omitted; explicit JSON must include the baseline; extensions allowed | — |
| `theme.update`, `theme.propose` with `theme` | Baseline cannot be removed; extensions allowed | Allowed, with notices |
| `block.create`, `block.draft` | Undeclared names and hard-coded colors refused when all selected themes include the baseline; common declared extensions allowed | Allowed, with notices |
| Block import, Block Editor, MCP `cms_validate` | Warnings (codes below) | Warnings |
| `scripts/cms/validate-import.mjs` | Theme files require the baseline; `--standard-theme` audits baseline-only block portability (no selected-theme context) | Blocks warn without the flag |

| Code | Meaning |
| --- | --- |
| `theme.color-missing`, `theme.font-missing`, `theme.radius-missing` | A theme lacks a baseline name |
| `theme.apply-rules` | A standard theme carries `apply` rules |
| `theme.color-name`, `theme.font-name`, `theme.radius-name` | A block class uses a name outside the baseline and the block's declared extensions |
| `theme.raw-color` | A hard-coded color in a block class |
| `theme.opacity-format` | A bracketed opacity such as `/[0.03]`: the public renderer drops it; use whole percents |

### Theme fields

`theme` and `headJSON` must be JSON object strings (the mirror parses
them); `extraCSS` a string. The operations accept no other theme fields
than `name`, `theme`, `headJSON`, `extraCSS`, `typeRoles`, `defaultPages`,
`defaultMenus` and `defaultSiteSettings` (`THEME_FIELDS`).

Default Site Settings includes the same Splash Screen tab as site settings.
Its `splashImage` and `splashBackgroundColor` values seed newly created sites;
the color choices resolve against the theme being edited. These defaults do
not update existing sites. See the sites-and-pages Splash screen settings
contract for the fields and preview behavior.

### Older themes

Themes created before the baseline (each Hub's "This Hub" section names
its own) predate the names (`brand`, `brandDark`, `textOnDark`, `font-brand`,
…). Their blocks keep working and only warn. Migrating one means renaming its
tokens and the classes in every block that uses them, as one reviewed change.

### Checks that enforce this contract

Each Hub lists the tests in its own checkout under "This Hub". Shared:

- `node --test edge/tools/mcp/cms/test/*.test.js`

## Related contracts

- `edge/docs/data-contracts/cms-blocks/README.md`: the block classes the names
  apply to, and the validator that reports the codes.
- `edge/docs/data-contracts/cms-operations/README.md`: the theme operations, the
  live-theme rule and `themeProposals`. Open proposals are reviewed in the
  theme editor (a "proposals" button in its header): the diff against the
  current theme, then Apply (the same save as restoring a history version) or
  Reject.
