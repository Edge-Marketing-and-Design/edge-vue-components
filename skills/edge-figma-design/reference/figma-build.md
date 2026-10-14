# Building the Figma draft

The library in `scripts/figma/` turns the content plan into frames. It was extracted from the first site's build and tested end to end; read `figma-gotchas.md` first.

| File | What it does | Stored under key |
| --- | --- | --- |
| `setup.js` | Creates the token collection (colors, radii) and text styles from the plan's §2. Run once, not stored | — |
| `core.js` | Helpers: token paints, text with styles, auto-layout, buttons, icons, placeholders, section backgrounds, instances, anchor duplication | `core` |
| `components.js` | Builds the kit on the current page: 43 line icons, 4 placeholders, 23 item components | `components` |
| `blocks.js` | One builder per block type (page hero, feature grid, callout, newsletter, split, pathways, event facts, team, pricing, prizes, logo grid, media card, directory, contact form, recap, resources) | `blocks` |

## Installing the library

Each file is one function expression. Install it by sending its text inside a `use_figma` call that stores its source in root shared plugin data, one file per call (calls are capped at 50,000 characters; comment-only lines can be dropped to save space):

```js
const core = (/* paste the whole of core.js here */)
figma.root.setSharedPluginData('edgesite', 'core', core.toString())
```

Write the config in the same call as the core:

```js
figma.root.setSharedPluginData('edgesite', 'config', JSON.stringify({
  ns: 'edgesite',              // letters, digits, _ and . only
  tokens: 'ACME Tokens',       // collection setup.js creates
  stylePrefix: 'ACME/',        // text style prefix setup.js creates
  desktopWidth: 1171,          // the anchor frame's width
  mobileWidth: 390, padX: 24, mobilePadX: 20,
  darkTexture: '7:3',          // optional: node cloned behind dark sections
  lightPaintsFrom: '5:1462',   // optional: node whose non-solid fills layer on light sections
  heroOverlayFrom: ['5:833']   // optional: nodes whose fills overlay photo heroes
}))
```

Every later call starts with:

```js
const cfg = JSON.parse(figma.root.getSharedPluginData('edgesite', 'config'))
const L = await eval('(' + figma.root.getSharedPluginData(cfg.ns, 'core') + ')')(figma, cfg)
const B = await eval('(' + figma.root.getSharedPluginData(cfg.ns, 'blocks') + ')')(figma, L)
```

When you change a library file in the repo, re-install it; don't patch the stored copy by string replacement. When the site is finished and reviewed, the developer may ask you to clear the keys (set each to `''`).

## Tokens and text styles (`setup.js`)

The spec comes from plan §2. Color roles (keep the names, the kit and blocks use them): `primary` (dark sections, dark buttons), `onPrimary`, `secondary` (eyebrows on light, numbers, links), `tertiary` (eyebrows on dark, emphasis), `onTertiary`, `accent` (primary buttons, accent heading line, bullets), `canvas` (light background), `surface` (cards), `surfaceAlt` (tinted background at 25%, placeholders, body text on dark at 80%), `text`, `textMuted`, `heading`, `border`, `success`. Radii: `button`, `card`, `panel`, `tile`, `sm`, `pill`. The 25 text style names are listed at the top of `setup.js`. Map the anchor's measured values onto these; the names are roles, not colors, so a brand without a "pine" still has a `primary`.

## Naming

- Pages: `Site — New Blocks`, `Site — Pages` (create both; never draw on the anchor's page).
- Block frames: exactly the block id (`acme-feature-grid`); variants as siblings (`acme-feature-grid / compact`); phone frames `… / mobile`.
- Page frames: `Page / Home`, `Page / About`, …
- Sections on pages: the block id and variant; duplicated anchor sections `acme-stats (reuse)`.
- Repeated items: `Item / <title>`; images `Image (<shot id>: <description>)`; logos `Logo (<owner>)`; missing content `TBD — <what>`; buttons `Button / <label>`; links whose target is unknown name the gap (`Link / Get directions (URL TBD)`).

## Canvas layout

On `Site — New Blocks`: the kit at x 0 (icons and placeholders above it), then one column per block family from x 1800, 1700 apart, variants stacked 160 apart, phone frames to the right of their desktop frame. On `Site — Pages`: page frames side by side, 1400 apart. Keep a registry of node ids in plugin data (`L.save('map', …)`) as you place frames.

## Call boundaries

- One `use_figma` call per logical step: setup, kit, Tier 1 blocks, Tier 2 blocks, two pages at a time.
- A failed call rolls back completely, so a retry after a fix is safe.
- Save each page's copy data in plugin data (`L.save('data-about', …)`) in the call that builds it; later fixes load it instead of re-sending copy.
- Return node ids from every write.

## Blocks

Each builder takes `(parent, data)` and returns the section. `parent` is `null` for a frame on the blocks page and the page frame on the pages page. Data fields are documented above each builder in `blocks.js`. Pass copy exactly as the plan quotes it; pass missing items as TBD text (`'[TBD: …]'`) or let the builder draw its TBD layer.

**Adapt before you build.** The builders encode the first site's choices (section padding 80–96, cards radius 16 with a 1px border and soft shadow, centred showcase headers, 3-up grids). Compare the Tier 1 output with the anchor. Where this anchor differs, change the builder (in the repo copy, then re-install) or override in data (`bg`, `align`), and note the difference in plan §2. Add a builder for any block the plan needs that has no builder; follow the same pattern (a section from `L.section`, a header from `L.header`, items as instances).

**New repeated items** get a component first (`components.js` pattern: build a frame with named text layers, `figma.createComponentFromNode`, add it to the `comps` registry), then the block uses `L.I`.

## Reusing anchor sections

Reused sections are duplicates of the anchor's nodes with only text and placeholders changed (`L.dup(nodeId, pageFrame)`):

```js
const { node, map } = await L.dup('5:796', page)       // the anchor's nav
const cta = await map('5:826')                          // map every node first...
const links = await Promise.all(['5:800', '5:803'].map(map))
// ...then insert, remove and edit
await L.setText(cta, 'Get Tickets')
```

After editing, check for fixed heights and fixed-width buttons (`L.hugBtn`, `L.hugAll`; see the gotchas). Name the duplicate `<block> (reuse)` and record it in §10.

## Pages

```js
const page = L.page('Page / About', 1400, 0)
await dupNav(page)                                     // your reuse helper for the anchor nav
await B.pageHero(page, { name: 'acme-page-hero', ...data.hero })
await B.split(page, { name: 'acme-split-content', ...data.intro })
await dupFooter(page)
```

The nav and footer are duplicated per page with the full site's menu and footer links. The home page reuses the anchor's hero and as many anchor sections as the content allows, so it looks nearly identical to the anchor.

## QA before handoff

Screenshot every page (`get_screenshot`, `maxDimension` up to 5000; crop locally for detail) and check:

- no clipped or overflowing text, no overlapping sections, no empty space left by fixed heights;
- neighbouring sections never share a background; the section before the footer is light where the anchor does that;
- every repeated item is an instance; every image and logo is a named placeholder; every gap is a `TBD —` layer;
- copy matches the plan word for word (spot-check each page against §5);
- the anchor frame is unchanged (compare a few of its texts and its child counts with the start of the session).

## The design map (plan §10)

One row per frame: block or page, Figma page, frame name, node id, phone node id, **used on** (the pages that carry a copy of it), status, last synced. The build copies node ids into `meta.design`; both sync directions read this table.
