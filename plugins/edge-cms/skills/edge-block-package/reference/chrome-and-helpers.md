# Site chrome and CMS runtime helpers

## siteDoc source (navigation, footer)

```json
{ "siteDoc": { "type": "collection", "path": "sites", "canonicalLookup": { "key": "{orgId}:{siteId}" }, "order": [], "value": [] } }
```

Inside `{{#for site in source("siteDoc")}}`: `site.name`, `site.logo`, `site.logoLight`, and `site.menus.Site Root` (array of `{ name, menuTitle, item }`; `item` is a page id, `{ type: 'external', url }`, or an object of folder children). Menu loop that handles all three, copied from the M4RL and Mule navigation blocks:

```handlebars
{{#for menuItem in site.menus.Site Root}}
  <li class="cms-nav-item">
    {{{#if {"cond":"menuItem.name"} }}}
      {{{#if {"cond":"menuItem.item.type == 'external'"} }}}
        <a href="{{ menuItem.item.url }}" class="cms-nav-link ..." data-cms-nav-current-class="...">{{ default(menuItem.menuTitle, menuItem.name) }}</a>
      {{{#else}}}
        <a href="/{{ menuItem.name }}" class="cms-nav-link ..." data-cms-nav-current-class="...">{{ default(menuItem.menuTitle, menuItem.name) }}</a>
      {{{/if}}}
    {{{#else}}}
      {{{#entries:folderEntry {"field":"menuItem.item"} }}}
        <a href="/{{ folderEntry.key }}" class="cms-nav-link ...">{{ default(menuItem.menuTitle, folderEntry.key) }}</a>
      {{{/entries}}}
    {{{/if}}}
  </li>
{{/for}}
```

Navigation hooks: root `cms-nav-root` (+ `cms-nav-sticky`, `data-cms-nav-root`, `data-cms-nav-position`, `data-cms-nav-close-on-link`), `cms-nav-main`, `cms-nav-layout`, `cms-nav-logo`, `cms-nav-desktop`, `cms-nav-toggle`, `cms-nav-overlay`, `cms-nav-panel`, `cms-nav-close`, `cms-nav-link`, `cms-nav-item`. Wrap in a `{{ loading }}` skeleton header and a `{{ loaded }}` root. The runtime owns open/close; blocks ship no JavaScript.

## Interactive collection filters and pagination

Use collectionFilter for control bindings, collectionOptions for escaped dynamic
options, and paired collectionResults for an inline refreshable result region.
These helpers activate sources without a source() loop. Prefer them to custom
scripts or Vue overrides when bounded indexed filtering fits the behavior.
The complete source configuration, single-template example, field projection,
limits, browser/server pagination and preview boundary are in
[interactive collections](interactive-collections.md). No state-tab counts are
provided by distinct options; do not invent them.

## Forms

`form.cms-form` or `data-cms-form`; required controls `data-cms-required="true"` and `aria-required="true"` (never native `required`, it blocks page saves); `data-cms-form-submit`; `data-cms-form-message`; optional `data-cms-success-message`, `data-cms-error-message`, class hooks. Endpoint is the shared `/api/contact`; delivery is verified separately.

## Reveals and carousels

Reveal: `sr`, `sr-up`, `sr-group`, `sr-item`, `sr-delay-*`. Carousel: `[data-carousel]` root with `overflow-hidden`, `[data-carousel-track]`, slides `shrink-0 flex-[0_0_100%]`, optional prev/next/dots hooks. No inline scripts.

## Apple App Store badge (any app site)

Use Apple's official badge SVG unmodified (geometry untouched). Inline it; remove only the root `id` and `<title>`, add `role="img" aria-label="Download on the App Store"`. Never recolor or redraw. Do not show two store entry points in one viewport.

### Saved draft data in the Hub canvas

CMS canvas collection sources load authorized Firestore records, not published
KV. Site lookups show saved draft settings and menus; post lookups show saved
draft posts. Keep the authored source configuration pointed at the published
delivery contract: the Hub handles draft loading without changing the block.
This is a visual preview, not a functional public-site runtime. Use the frontend
preview links for interaction testing. Unsaved settings are not included.
