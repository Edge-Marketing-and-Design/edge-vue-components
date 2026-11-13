# Interactive KV collections

Use the generic collection helpers for indexed filtering and pagination instead
of a Vue override or custom filtering script when they fit the behavior.
Requires the published `@edgedev/template-engine` 26.11.1 package and a public
frontend deployment with its collection controller/API. Do not edit npm source.
Existing blocks do not opt in merely because the engine is upgraded.

## One block, one template

The block declares dataSources normally. Its single template contains controls,
option lookups, loading skeletons and a paired collectionResults region. No
separate results-template field or second results block is authored.

- `source("name")`, collectionFilter, collectionOptions and collectionResults
  all activate their declared sources. A declaration alone does not fetch data.
- `queryItems` selects indexed candidates. Multiple lookups are OR/union with
  deduplication, not AND/intersection. The final `query` applies AND filters,
  then `order`, then the page slice. A broad fixed lookup mixed into active
  narrow lookups defeats narrowing; put it in `fallbackQueryItems` instead.
- Empty dynamic filter values omit their lookup/condition. No remaining lookup
  and no fallback means no candidates, never an unbounded collection scan.
- The fields projection must include every public display, final-filter and sort
  field. `canonical: true` can load full records before projecting those fields.
  Never expose private fields. Keep fields, scope and indexed lookups aligned
  with the collection's documented contract; do not rewrite a supplied tested
  source path solely because its friendly name differs from a collection name.

## Complete authoring example

The following configuration and HTML are one generic catalog block. Collection
names and indexed fields here are illustrative; an existing block migration
keeps its approved source configuration. Existing unrelated schema, values and
metadata must be merged, not cleared. For a new library block, values belong
in schema defaults unless the approved migration supplies explicit values.

```json
{
  "templateVersion": 2,
  "dataSources": {
    "products": {
      "type": "collection",
      "path": "products",
      "uniqueKey": "{orgId}:{siteId}",
      "canonical": true,
      "queryItems": [
        { "categoryId": "{filters.category}" },
        { "tags": "{filters.tags}" }
      ],
      "query": [
        { "field": "published", "operator": "==", "value": true },
        { "field": "name", "operator": "text-contains", "value": "{filters.name}" },
        { "field": "categoryId", "operator": "==", "value": "{filters.category}" },
        { "field": "tags", "operator": "array-contains-all", "value": "{filters.tags}" }
      ],
      "order": [{ "field": "name", "direction": "asc" }],
      "interactive": {
        "fields": ["published", "name", "url", "categoryId", "tags"],
        "fallbackQueryItems": { "published": true },
        "maxCandidates": 200,
        "pageSize": 24,
        "filters": {
          "name": { "default": "" },
          "category": { "default": "" },
          "tags": { "multiple": true, "default": [] }
        },
        "pagination": {
          "mode": "server",
          "pageParam": "catalog_page",
          "filterPrefix": "catalog_"
        }
      }
    },
    "categories": {
      "type": "collection",
      "path": "categories",
      "uniqueKey": "{orgId}:{siteId}",
      "queryItems": { "published": true },
      "order": [{ "field": "name", "direction": "asc" }]
    },
    "tagOptions": {
      "type": "collection",
      "path": "products",
      "uniqueKey": "{orgId}:{siteId}",
      "canonical": true,
      "queryItems": { "published": true },
      "distinct": "tags"
    }
  },
  "schema": {},
  "values": {}
}
```

```html
<section data-cms-collection="products">
  <label for="catalog-name">Name</label>
  <input id="catalog-name" type="search"
    {{{#collectionFilter {"source":"products","filter":"name"} }}}
    class="border px-3 py-2">
  <label for="catalog-category">Category</label>
  <select id="catalog-category"
    {{{#collectionFilter {"source":"products","filter":"category"} }}}
    class="border px-3 py-2">
    <option value="">All categories</option>
    {{{#collectionOptions {"source":"categories","label":"name","value":"docId"} }}}
  </select>
  <fieldset>
    <legend>Tags</legend>
    {{#for tag in source("tagOptions")}}
      <label><input type="checkbox" data-cms-filter="tags" value="{{ tag }}">{{ tag }}</label>
    {{/for}}
  </fieldset>
  <p role="status" aria-live="polite" data-cms-collection-status></p>
  <div class="{{ loading }} grid grid-cols-2 gap-4" role="status" aria-label="Loading results">
    <div class="h-32 animate-pulse bg-surfaceAlt" aria-hidden="true"></div>
    <div class="h-32 animate-pulse bg-surfaceAlt" aria-hidden="true"></div>
  </div>
  {{{#collectionResults {"source":"products"} }}}
    <ul class="grid grid-cols-2 gap-4">
      {{#for product in items}}
        <li><a href="{{ product.url }}">{{ product.name }}</a></li>
      {{/for}}
    </ul>
    {{{#if {"cond":"item.total == 0"} }}}
      <p>No matching results. Try another filter.</p>
    {{{/if}}}
  {{{/collectionResults}}}
</section>
```

The engine reads `items`, `total`, `page` and `pages` inside the results region.
Normal condition scope still applies: outside its item loop use `item.total`
in an if, even though `{{ total }}` works as a value placeholder. The loop's
alias (`product.name`) applies inside the loop. Do not reference outer aliases
or page-owned values in this isolated region; project what it needs up front.
Do not call source() or render nested CMS blocks inside collectionResults.

## Helpers and options

| Helper | Contract |
| --- | --- |
| `{{{#collectionFilter {"source":"products","filter":"name"} }}}` | Emits the control binding. Supports text/search inputs, selects, radios, checkboxes and multi-selects. Defaults and `multiple` are declared in interactive.filters. |
| `{{{#collectionOptions {"source":"categories","label":"name","value":"docId"} }}}` | Resolves its declared source and emits escaped option labels/values. |
| `{{{#collectionResults {"source":"products"} }}} ... {{{/collectionResults}}}` | One refreshable inline region per source; controls remain outside it and stay mounted during updates. |

Wrap the controls and the results region in one element with
`data-cms-collection="<source name>"`: the public controller mounts on that
element and ignores controls outside it. The equivalent
`data-cms-filter="name"` hooks are supported inside that root, including
custom radios/checkboxes; a `data-cms-filter` name that is not declared in
`interactive.filters` is ignored, and the validator does not flag it. Write
each helper tag and its JSON on one line: a helper split across lines is
dropped silently. An element with `data-cms-collection-status` inside the root
receives the result count ("N results. Page X of Y."), "No matching
results.", loading and error text. Place the block directly on the page or
post template; a block rendered inside another block cannot refresh.
A source invoked inside a group loop can receive indexed overrides, for example
`source("credentials", { queryItems: { type: group.name } })`.

`distinct: "field.path"` returns unique sorted scalar options after source
resolution and any limit. It flattens arrays one level and omits blank, null
and object values. A source limit limits the choices too. Distinct results do
not provide counts; never calculate tab totals from one page of results.

`text-contains` and `text-starts-with` match case-insensitively within the
selected candidate set, not across all KV records. `array-contains-all` requires
all selected values. Filter bounds are explicit: maxCandidates is a safety
ceiling with an error on overflow, not a silent truncation setting. The global
ceiling is 2,000; prefer much smaller candidates (the example above uses 200).

Defaults and limits: `maxCandidates` defaults to 500 (1 to 2,000); `pageSize`
defaults to 24 (100 at most). `fields` is required, up to 100 paths, and must
include every `query` and `order` field. Up to 20 filters, 20 values per
filter of up to 200 characters each, and 20 indexed lookups. Filter values
and defaults are strings, and `{filters.name}` must be the entire value.
`pagination.mode` is `"server"` or the key is left out; `pageParam` and
`filterPrefix` start with a letter and use letters, digits, `_` or `-` (41
characters at most). An interactive source is an indexed collection source,
never an `api` or `canonicalLookup` source. The markup inside a results region
is at most 50,000 characters and may not call `source(` or `renderBlocks`.

## Pagination and runtime boundary

Without server pagination, bounded candidates are filtered in the browser,
and paging needs your own buttons inside the root: `<button type="button"
data-cms-page="previous">` and `data-cms-page="next"`. Without them only the
first `pageSize` results can be reached.
With `pagination: { mode: "server", pageParam, filterPrefix }`, the public API
performs the final query, ordering and slicing and sends only the requested
page. The results helper appends real Previous/Next page links. Do not append
browser-mode pagination buttons to a server-mode region. KV cursors are not
visible page boundaries.

Use unique parameter names/prefixes when several blocks share a page. Direct
URLs work with SSR; filter changes reset the page, Back/Forward restores state,
and unrelated query parameters remain. The API accepts filter values and page,
not arbitrary client-supplied templates, queries, scope or sort definitions.

Successful results use a bounded browser-memory cache scoped to site, render
revision and source contract. Server-mode entries also include filters/page.
Responses to the browser stay no-store. On the server, `emd-cms-front` main
caches each indexed candidate set (not filtered pages) in its rendered-page
cache tiers and serves hits stale while it revalidates, so a newly published
record can take a moment to appear in results. An open browser tab does not
poll for publication changes.

Placeholder rendering fetches no KV for these helpers: options remain empty
and the results wrapper stays busy until hydration. Put authored skeletons
outside the results region and use `{{ loading }}`. Keep normal links,
accessible labels/status text, and literal utility classes for CSS extraction.
The runtime emits `cms:collection-updated` after replacing results if other
behavior needs reinitialization; controls remain mounted.

## Small option catalogs

When choices already have a generated catalog, read it directly rather than
scanning result records only to build picker options. For example:

```json
{
  "type": "collection",
  "path": "directory-options",
  "uniqueKey": "{orgId}",
  "canonicalLookup": { "key": "{orgId}:default" },
  "limit": 1,
  "distinct": "specialties"
}
```

The catalog must exist and be mirrored before switching a live source. The
source limit bounds catalog records, not the number of scalar choices extracted
from them; Hub preview still bounds the final choices by its preview ceiling.
A second source can read another field from the same canonical record, with the
engine request cache reusing the read. Keep filter indexes independent of choice
catalogs and lean list metadata. Full canonical candidate hydration for result
filtering is a separate cost from building option lists.

## Verification and Hub limits

Test direct paginated URLs, initial SSR, filter/page reset, empty results,
errors, Back/Forward, keyboard controls and mobile layout on the supported
public frontend path. Confirm the deployed frontend has engine/controller
support before a person publishes a migrated block.

The Hub's upgraded engine can recognize the helper syntax. Its validator and
MCP source-use summaries count helper references, and the results region owns
its loaded wrapper (it needs no separate `{{ loaded }}` class). This does not
install the public frontend's controller or API into the Hub editor. Its
editor canvas renders options and the initial results from its already
loaded, authorized Firestore records (saved drafts for sites and posts), using the engine's default selection, filtering,
ordering, pagination and conditional scope. Distinct sources yield sorted,
unique scalar choices in KV and emulator loading. The editor also projects raw
records from older deployed preview loaders, so local UI testing does not require
deploying that loader first; already-projected choices remain intact. Initial
interactive loads bind default filter values and fallbackQueryItems rather than
sending literal filter placeholders. When an older loader returns index metadata
missing active query fields, the editor uses the same authorized loader for an
explicit canonical batch before applying the result filters; it never invents
agent eligibility fields. The canvas snapshot is bounded
by the preview loader's limits; it installs no public controller/API and does
not verify filter interaction or subsequent pages. The agent render
(`cms_render_block`) draws the same initial snapshot from its records when it
has no indexed KV records to hand the engine: `sample` (rows carry the
declared `interactive.fields` and the fixed values the query requires),
`empty`, and live records read from Firestore. Other placeholder-only
rendering can still show busy/empty helpers. Do not claim public interaction
parity because a block saves or its initial canvas snapshot looks correct.

Source of truth for public behavior: the frontend's
`docs/interactive-kv-collections.md`, `docs/cms-template-v2-blocks.md` and the
published engine exports. The approved Clearwater migration handoff preserves
its tested `credentials` source path and other source settings as supplied.
