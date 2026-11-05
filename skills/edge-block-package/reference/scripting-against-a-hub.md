# Scripting against a Hub checkout

With a Hub checkout, a short Node script can use the same code the Hub runs:
its validator, its Template v1 → v2 converter, its revision hash and its
template engine, over many blocks at once, with read-only Firestore access.
Use a script for bulk work (every block in a theme, every instance on every
site) and the CMS MCP tools for single reads and every write. Writes always
go through `cms_check_operation` and `cms_run_operation` (drafts only); a
script never writes to Firestore.

## Where things are

Paths are relative to the Hub checkout. Put scripts under `.tmp/` (ignored by
git) or your scratch folder, and run them with the Node in `.nvmrc` from the
Hub's root so `@edgedev/template-engine` resolves from its `node_modules`.

| What | Import | Use |
| --- | --- | --- |
| Validator | `edge/lib/cmsBlockValidation.js` | `validateBlock(doc, { renderTemplate })` (structure, grammar, schema, render checks), `validateBlockDocument(doc)` (static only), `buildSourceFixtures(template, names)` |
| Converter | `edge/composables/useCmsTemplateV2Conversion.js` | `useCmsTemplateV2Conversion().convertLegacyBlockToTemplateV2(block)` returns `{ template, schema, dataSources, values, conversion: { warnings } }`, the Hub's own starting point for a v2 draft |
| Revision hash | `edge/lib/cmsBlockRevisions.js` | `blockDefinitionHash(definition)` is the `baseHash` `block.draft` expects; `pickBlockDefinition(doc)` gives the definition fields |
| Template engine | `@edgedev/template-engine` | `renderTemplateAsync(template, values, meta, { templateVersion: 2, schema, dataSources })` for one block; `pageRender([block], theme, '', null)` the way the public renderer renders a page |
| Render preparation | `edge/lib/cmsDataSourceRecords.js` | `prepareBlockForRender(instance, { orgId, siteId })` fills schema defaults and resolves `{orgId}`/`{siteId}` tokens as the public renderer does |
| Release propagation | `edge/functions/helpers/cmsBlockPropagation.js` (CommonJS) | `updateBlocksInArray([instance], blockId, released, definition)` applies a definition to an instance the way a release does |
| Instance comparison | `edge/tools/mcp/cms/src/compare-instances.js` | `collectInstanceDocuments` and `compareInstances`, the code behind `cms_compare_instances` |
| Firestore (reads) | `firebase-admin` from `edge/tools/mcp/cms/node_modules` | as your own Google sign-in (`gcloud auth application-default login`), with the Hub's `projectId` from its MCP config; read only, never write from a script |

## Example: validate and hash every v1 block's conversion

```js
// .tmp/convert-check.mjs, run from the Hub root as your Google sign-in, with
// the Hub's projectId (its tools/mcp/config/<hub>.production.json):
// node .tmp/convert-check.mjs <projectId> <orgId>
import { createRequire } from 'node:module'
import { renderTemplateAsync } from '@edgedev/template-engine'
import { validateBlock } from '../edge/lib/cmsBlockValidation.js'
import { blockDefinitionHash } from '../edge/lib/cmsBlockRevisions.js'
import { useCmsTemplateV2Conversion } from '../edge/composables/useCmsTemplateV2Conversion.js'

const require = createRequire(new URL('../edge/tools/mcp/cms/package.json', import.meta.url))
const admin = require('firebase-admin')
const [projectId, orgId] = process.argv.slice(2)
admin.initializeApp({ projectId })

const { convertLegacyBlockToTemplateV2 } = useCmsTemplateV2Conversion()
const blocks = await admin.firestore().collection(`organizations/${orgId}/blocks`).get()
for (const doc of blocks.docs) {
  const block = doc.data()
  if (Number(block.templateVersion) === 2)
    continue
  const converted = convertLegacyBlockToTemplateV2(block)
  const draft = { ...block, docId: doc.id, templateVersion: 2, template: converted.template, content: converted.template, schema: converted.schema, dataSources: converted.dataSources, values: {} }
  const result = await validateBlock(draft, { renderTemplate: renderTemplateAsync })
  console.log(doc.id, `baseHash ${blockDefinitionHash(block).slice(0, 12)}`, `${result.errors.length} errors`, `${converted.conversion.warnings.length} conversion warnings`)
}
process.exit(0)
```

The `baseHash` printed is the released definition's; when a block has an open
draft, take `baseHash` from `cms_block_base`, which reads the draft.

## When to use `cms_compare_instances`

Before saving a `block.draft` for a block that is already placed on pages,
and again before recommending a release. It answers "what would this change
do to every page that already uses the block?":

- every instance (draft and published pages and posts on every site, plus the
  templates site) renders before, from its own copy of the markup, and after,
  from the proposed definition applied the way a release applies it;
- Data Sources get the same records on both sides (`sourceRecords`, or
  sample records cut to each source's limit), so differences come from the
  template and the values, not the data;
- `differences` lists each value set that renders differently, with a short
  excerpt; `driftedCopies` lists instances holding an older copy of the
  markup (the "before" render uses their copy); `removedFieldValues` lists
  instance values in fields the new schema no longer has.

Every difference is either the change you meant or a finding to fix before
the draft is saved. It does not check where live records come from: API
sources and the Hub preview's own source loading still need `cms_preview_url`
(with `blockDrafts`). For a scripted variant (for example, removing an
intended fix from both sides to see what else differs), call
`compareInstances` from `edge/tools/mcp/cms/src/compare-instances.js`
directly with a wrapped `pageRender`.
