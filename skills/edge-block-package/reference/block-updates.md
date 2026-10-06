# Block updates from a design change

How an existing Hub block follows a change in the design it was built from, without losing the hand edits the Hub holds and without anyone publishing by hand. The edge-design-to-site skill's "Update blocks from a design change" entry point drives this; this document is the classification and the per-class procedure it applies.

Rules that never bend:

- **The Hub copy is the only source of truth** for an existing block. Read it with `cms_block_base`, edit that definition, and save with `block.draft` and its `baseHash`. Never regenerate it from the package, and never re-import a package file over it. A "changed since you loaded it" refusal means someone edited the block; load it again and reapply the change.
- **Nothing here releases or publishes.** Every definition change is a draft revision the developer releases from the Block Editor; every value change is a draft page edit the developer publishes.
- **One draft per block.** A block has at most one open draft, so every change class that touches the same block goes into the same `block.draft` (the definition is saved whole; fields left out keep their current values).
- **Synced block values** (navigation, footer) are edited in the Hub. The operations refuse them; list them for the developer.

## Finding the block a node became

1. **The design map.** The package manifest's `design` entry per block and the same object on the library block as `meta.design` (`cms_block_base` returns it): `{ source: "figma", file, node, name }` or `{ source: "handoff", path, section, name }`. A changed node (or its nearest mapped ancestor) names the block directly.
2. **Layer name.** When node ids changed (a designer restructured the file), match the mapped `name` against the current layer names under the frame; report the match as "by name" and treat two candidates as ambiguous.
3. **No entry.** A node that no map entry covers, by id or by name, is listed for the developer with its id, name and position; never guessed. A block with no `meta.design` is listed too, with the draft that would add it (adding the map entry is a `block.draft` like any other definition change).

Blocks that no changed node touches are left alone and said so.

## Change classes

Each change in the design is one of these. A section can carry several; list each one.

| Class | How to tell | Path | Release risk |
| --- | --- | --- | --- |
| Markup only | Same fields, different HTML, classes, spacing or order | `block.draft` on `content` (Template v2 `template` follows) | None; the release checks render every instance |
| New field | The design shows content the schema has no input for | `block.draft` adding the input with a default and the markup that reads it; instances pick up the default on release | None |
| Removed or renamed field | An input the design no longer uses, or one whose meaning moved | Two steps: add the new field first and keep the old one; removal is a later draft. Say "breaking" in the handoff | Breaking on the removal step: the developer confirms |
| Content values | Same fields, different copy | `page.setValues` per instance (`cms_find_usage` lists them); synced values go to the developer | None (page drafts) |
| Media | A changed or new image | Listed for the developer with the Figma layer and the block field; the block keeps its fallback. Only markup around the image is drafted | None |
| Override behavior | The change is in what the Vue component does, not in what the block shows | The CMS block first (the fidelity rule in `override-blocks.md`), then a renderer task for `emd-cms-front` | Renderer deploy |

### Markup only

Edit the current `content` from `cms_block_base`, keep every `{{ field }}` the schema defines, validate the definition before saving it (`cms_validate` with the block's themes, or the Hub import check `scripts/cms/validate-import.mjs` on a copy of the definition), then `block.draft`. Theme names follow the current rule: baseline names, extensions only when every selected theme defines them; `cms_check_operation` refuses the rest.

Verify: a `cms_preview_url` link for a page holding the block, at about 1440 pixels wide and with `viewport: "mobile"`, beside the Figma screenshot of the node (`get_screenshot`). Up to three passes; record what still differs.

### New field

Add the input to `schema` with its `label`, `type` and a default `value` (image inputs with their paired alt input), and the markup that reads it. Instances receive the declared default when the draft is released (propagation fills newly added schema fields), so no value change is needed unless an instance should differ from the default; those go through `page.setValues` after the release, or now, with the readiness report confirming no `instance.values` errors.

Verify: the preview shows the default where the design shows the content; `cms_site_readiness` reports no `instance.values` error for the block.

### Removed or renamed field

The default is two steps, because the release checks flag a removed or retyped field as breaking and list every instance holding a value in it:

1. **Add.** Draft the new field (New field, above) and move the markup to it. Keep the old input in the schema, so existing values are not orphaned and the release is not breaking. For a rename, copy each instance's old value into the new field with `page.setValues` (`cms_find_usage` lists the instances) so nothing is lost when the old field goes.
2. **Remove, later.** After the first release, a second draft removes the old input. Its release is breaking; the handoff says so, and the developer confirms it in the release dialog.

A one-step removal (one draft that removes the field) is only done when the developer asks for it in so many words. The handoff then says "breaking" and lists the instances the release checks will name.

### Content values

Same fields, different copy: no draft. `cms_find_usage` for the block and site lists every instance (page, instance id, synced or not). One `page.setValues` per instance with only the fields that changed (the operation merges). The rules are the page editor's (`required`, `min`, `max`); a refused value is reported, not forced. Synced instances are refused by the operation: list the page, instance and the new values for the developer.

Verify: the preview shows the new copy; `cms_site_readiness` shows no `instance.values` error.

Measure it: a block placed on many pages is many calls. Record the count and the time in the handoff; it decides whether a bulk value operation is worth building.

### Media

Images are not uploaded by agents (no media upload in the operations). For each changed image: the Figma layer (id and name), the block and the field it belongs to, and whether the field is empty (fallback shown) or holds an older image. If the markup around the image changed, that part is a Markup only draft; the image itself waits for the developer.

### Override behavior

The CMS block is the design source of truth. Draft the block's markup and schema first (the classes above), so the fallback and the editor preview match the design; then write the renderer task note for `emd-cms-front` (block name, the `block.values` keys the component reads, the behavior, the breakpoints), as `override-blocks.md` describes. Never edit `emd-cms-front` from the block session. The override renders as its CMS HTML in the preview; that is expected.

## The checkpoint report

Before anything is applied, one report, one table, one row per affected block:

| Block | Node (map) | Classes | Breaking | Instances | Needs the developer |
| --- | --- | --- | --- | --- | --- |
| `moe2-hero` | `5:830` Hero | markup, content values | no | 1 on 1 site | image 5:832 |

Plus: nodes with no map entry; blocks with no `meta.design`; synced values; media; renderer tasks; and the estimated work (drafts, value calls). The developer answers before step 5 of the skill runs.

## The handoff

After applying:

- **Drafts awaiting release,** one line per block: revision number, the classes it carries, and a release recommendation: release to all sites when the block is on a handful of documents; canary to one site first when `cms_find_usage` counts more than that; confirmation needed when the step is breaking. Two-step changes name their order.
- **Value changes applied,** per page, and the synced values left for the developer.
- **Renderer tasks** for override blocks.
- **Media** for the developer.
- **Previews:** a fresh desktop and mobile link per page touched, and what still differs from the design.
- **The design revision** recorded in `PROJECT.md` (`design.revision`), and the time taken.

After the developer releases, `cms_site_readiness` confirms no instance is behind (`instance.behind`).
