# Porting override behavior to a static export

An override component is a Vue file in emd-cms-front that renders a block's
own markup and adds browser behavior. In an export the markup stays (server
rendered, with the component's scoped styles) and the behavior is ported to
one plain script per site, `importfiles/<site>/export-site.js`, passed to
`export-site.mjs --site-script`. It is served as `/assets/site.js` as a module
on every page, after the standalone runtime.

## What the export gives the script

Each override's root (the renderer's `<div class="contents">` wrapper):

```html
<div class="contents" data-v-…
     data-edge-override="<blockId>"
     data-edge-values="/assets/overrides/<instanceId>.json">
  …the component's server-rendered markup…
</div>
```

The values file is `{ blockId, name, values }`, where `values` is the
instance's values over the block schema's defaults, the same values the
component's `blockValue()` reads, with every image and file URL replaced by
its downloaded local path.

## Shape of a site script

```js
// <Site name>: static ports of override behavior.
const loadValues = async root => (await (await fetch(root.dataset.edgeValues)).json()).values || {}

// Scoped component styles target [data-v-<id>]; reuse the id for elements
// the port creates (dialogs, buttons) so those styles apply.
const scopeFor = (className) => {
  for (const style of document.querySelectorAll('style')) {
    const match = style.textContent.match(new RegExp(`\\.${className}\\[(data-v-[0-9a-f]+)\\]`))
    if (match)
      return match[1]
  }
  return ''
}

const exampleGallery = async (root) => {
  const values = await loadValues(root)
  // Re-render from values, wire the controls already in the markup, build
  // anything the component created on demand (a lightbox) with scopeFor().
}

const ports = { 'example-gallery': exampleGallery }
for (const root of document.querySelectorAll('[data-edge-override]')) {
  const port = ports[root.dataset.edgeOverride]
  if (port)
    Promise.resolve(port(root)).catch(error => console.error(`Override port ${root.dataset.edgeOverride} failed:`, error))
}
```

## Porting checklist

- Read the component's script for every behavior: event handlers, watchers,
  `onMounted` listeners, keyboard handling, focus management, body scroll
  locks, `matchMedia` and reduced-motion checks. Port each one.
- The server render shows the component's first state only (page 1, the
  first slide, closed dialogs). Data it shows later comes from the values
  file, not the markup.
- Keep the component's markup and classes for anything you create, and its
  accessibility (labels, `aria-live` counters, focus return, Escape).
- Keep the script free of the words the checker treats as Hub references
  (the renderer's host or project name) in comments and strings.
- Verify in the browser against the live component (SKILL.md step 7).
