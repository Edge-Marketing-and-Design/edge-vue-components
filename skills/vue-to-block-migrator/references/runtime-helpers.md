# Edge CMS Template v2 Runtime Helpers

Read only the task-relevant section after reading the authoritative Template v2 guide and current Hub helper implementation.

## Contents

1. Loading and images
2. Navigation
3. Contact forms
4. Carousels
5. Auth and plans
6. Publications
7. Scroll reveal
8. Posts, events, and nested data

## Loading and images

Use `{{ loading }}` on skeleton markup and `{{ loaded }}` on hydrated content for collection/API sources, route-driven data, site/menu hydration, post/event feeds, and other delayed content. Prefer layout-shaped skeletons over spinners.

Every meaningful image needs editable or record-derived alt text. Use empty alt text only for decorative images. Prefer real `<img>` elements over content-bearing CSS backgrounds. Use current image `tags` and `variant` fields when media filtering or Cloudflare resizing is required.

## Navigation

Replace Vue menu state and click handlers with the CMS nav helper contract.

Required hooks:

- `cms-nav-root`
- `cms-nav-toggle`
- `cms-nav-panel`

Common hooks:

- `cms-nav-item`, `cms-nav-link`
- `cms-nav-overlay`, `cms-nav-close`
- `cms-nav-folder`, `cms-nav-folder-toggle`, `cms-nav-folder-menu`
- `cms-nav-main`, `cms-nav-layout`, `cms-nav-logo`, `cms-nav-desktop`

Common attributes/classes include current-route classes, open/close classes, sticky positioning, scroll thresholds, hide-on-down behavior, and panel position. Recheck `htmlContent.vue` and Block Help for the exact supported list.

Use a `siteDoc` collection Data Source with `canonicalLookup` for site menus. Use nested loops and `entries(...)` for object-shaped folders. Preserve menu `name`, `menuTitle`, item references, external URLs, and nested folder shape. Add loading/loaded states when site data hydrates asynchronously.

## Contact forms

Use the CMS form helper instead of custom Vue submit logic.

Required hooks:

- `form.cms-form` or `form[data-cms-form]`
- `.cms-form-required` or `[data-cms-required="true"]`
- `.cms-form-submit` or `[data-cms-form-submit]`
- `.cms-form-message` or `[data-cms-form-message]`

Recheck current support for required, success, error, invalid, and working message/class attributes. Include real labels, required-state semantics, a submit control, and a message container. Preserve honeypot or hidden subject fields when the current helper expects them.

The default helper records a Contact Form history event and supplies anti-bot behavior. Hub preview validates structure and required-state UX; it does not prove live delivery. Document lost custom endpoints or bespoke validation.

## Carousels

Use the CMS Embla helper contract, not Vue carousel state or third-party plugin code.

Required structure:

- `[data-carousel]` root with `overflow-hidden`;
- `[data-carousel-track]` flex track;
- slides with `shrink-0`, `min-w-0`, and explicit basis classes.

Optional hooks include `[data-carousel-prev]`, `[data-carousel-next]`, and `[data-carousel-dots]`. Current attributes control autoplay, interval, loop, fade, pause, and responsive slides-to-scroll. Recheck `htmlContent.vue` before relying on an attribute.

## Auth and plans

Use current helper hooks instead of Vue auth state or custom login/logout handlers:

- login, logout, and account buttons;
- show/hide logged-in and logged-out content;
- plan buttons with Stripe product/price IDs.

Recheck exact classes and `data-*` attributes in `htmlContent.vue`. Preserve keyboard semantics and do not expose restricted content merely by hiding it visually.

## Publications

Use a `publication` schema Input when an editor selects an existing processed publication. The current preview marker is:

```handlebars
{{{#publication {"field":"publicationPages"}}}}
```

Define the schema entry with `type: "publication"`, a label, and current `effect` value such as `flip` or `slide`. Keep `effect` in schema, not in the template marker. Verify the public publication runtime separately from editor preview.

## Scroll reveal

Use current `sr`, `sr-group`, and `sr-item` helper classes instead of custom intersection observers. Direction, delay, duration, distance, scale, rotation, view threshold, reset/cleanup, device, easing, container, and callback variants exist, but recheck current `htmlContent.vue` before authoring exact classes.

Avoid callback hook classes unless the target site already provides the matching callback. Do not port arbitrary animation scripts or global keyframes into the block.

## Posts, events, and nested data

For CMS-managed grids and details:

- use collection Data Sources and `source("posts")` or the current source name;
- put indexed lookup fields in `queryItems`;
- put after-fetch must-match filters in `query`;
- put ordering in `order`;
- use route tokens for detail lookup only as documented;
- add skeletons for delayed content.

For manual nested arrays, use ordinary nested `#for`. For nested Data Sources keyed from an outer record, pass scoped overrides to `source(...)`. For object maps, use `entries(object)`. Treat nested block rendering as an advanced path and reread Block Help before using it.

Keep Firestore preview queries, public KV index lookups, canonical hydration, and cache behavior as separate validation surfaces.
