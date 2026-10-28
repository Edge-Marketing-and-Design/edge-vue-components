# CMS → Figma sync

After launch a block can change in the Hub for reasons that never touched Figma: an accessibility audit (contrast, focus states, target sizes, heading order), a bug fix, a content-model change (a new field), a developer's hand fix. Each such change is applied back to the Figma frames so Figma stays the design source of truth and the next Figma → CMS update (`edge-design-to-site` section 4) doesn't undo it.

The direction matters: this procedure only edits Figma. It never changes a block, a page or a theme.

## Inputs

- The organization and site, and which blocks changed: block ids, or "every block released since <date>".
- The Figma file and the plan's design map (§10). Each block's `meta.design` (from `cms_block_base`) names its frame.
- The Figma MCP and the Hub's CMS MCP. Call `cms_contract` for `blocks` first.

## The sync baseline

`cms_diff` compares a local checkout of a block with production. So whenever Figma and the CMS are known to match (after the first build is released, and after every sync in either direction), take a baseline: `cms_checkout_block` for every block in the design map. Each checkout writes `base.json` under the Hub checkout's `.tmp/cms-block-workspace/<orgId>/<blockId>/` (git-ignored), so the baseline belongs to that machine: record the date and the machine in §10 ("baseline"), and on another machine take a fresh baseline or fall back to the visual comparison below. Later, `cms_diff` with `comparison: "base-production"` shows exactly what changed in the Hub since Figma last matched.

Without a Hub checkout (the remote CMS tools have no `cms_checkout_block` or `cms_diff`), the baseline is a file you keep: save each block's `cms_block_base` result as `baselines/<blockId>.json` in your workspace folder, next to the site content plan, and record the date in §10. Later, compare a fresh `cms_block_base` with that file (template, schema and data sources) to get the same list of changes.

## 1. Find what changed

For each block:

1. `cms_block_base` for the current definition (template, CSS classes, schema, `meta.design`).
2. `cms_diff` (`comparison: "base-production"`) against the baseline, or remotely the comparison with the saved baseline file. With no baseline (the first sync of an older site), compare the current block with the Figma frame directly: render it with `cms_preview_url` (about 1440 wide and `viewport: "mobile"`) and screenshot the frame (`get_screenshot`) side by side.
3. Write each change down in one line: what changed, in which element, old → new.

### What the comparison looks like in practice

For the visual comparison, `cms_preview_url` needs a session (`cms_open_session`, scope `site`, which grants no writes you don't run). Open the link in a browser at the design width, then for each top-level block section collect its text (`innerText`) and compare it with the frame's text layers; differences in text are the fastest signal. Then compare screenshots section by section for layout and style.

Not every difference is a block change. Menu labels and social links come from the site's settings and menus, and copy from instance values: those are content, so the frame changes only if the developer wants the design to show the live content.

## 2. Find the frames

- The block frame: `meta.design.node` on `Site — New Blocks` (and its variants and phone frames, which share the block id in their names).
- Every copy on the pages: the §10 "used on" column, then search each page frame for sections named with the block id (`figma.currentPage.findAll(n => n.name.startsWith('<block id>'))`).
- The components: if the change is inside a repeated item, the item component (`item/…`) on the kit; editing the main component updates every instance.
- A block with no `meta.design` or no frame: list it for the developer with the change; don't guess a node.

## 3. Classify each change

| Class | Examples | Figma edit |
| --- | --- | --- |
| Token | A color, radius or type size changed everywhere (contrast fix on `textMuted`) | Update the variable or text style once; every bound node follows. Translucent tints are plain colors (see gotchas): update those nodes too |
| Visual, one block | Larger button padding, a heavier border, a darker eyebrow on one block | Edit the block frame, its variants and every page copy; or the item component when the element is inside a repeated item |
| Structure | A new element or field (an alt-text caption, a "Read more" link), a removed element, a reordered layout | Add or remove the layer in the item component or block frame and every page copy; name new layers like the schema field |
| State | Focus ring, hover, error and disabled styles | Add a state frame beside the block (`<block id> / states`) showing the new state; don't change the default frames |
| Behaviour only | ARIA attributes, keyboard handling, link targets, alt text values, `rel`, lazy loading | No visual change: record it as an annotation on the block frame only |
| Content values | Copy edited in the Hub | Update the page copies only when the developer asks; the plan's §5 copy is the reference until then |

## 4. Checkpoint

Stop and report one row per change: block, frames affected (block frame, variants, phone frames, page copies, components), class, the proposed edit, and **whether the designer has customised any of those frames** (compare the frame's last-edited state with the design map's status, or ask). Wait for the developer. A change that would overwrite designer work goes to the designer instead.

## 5. Apply

The anchor frame is protected while the full site is being drafted. During a sync it is just another mapped frame: edit it only for the changes the developer approved at the checkpoint, the same way as any other frame.


- Make targeted edits to the existing nodes: change a fill, a padding, a text style, add one layer. Never rebuild or replace a frame the designer has touched; rebuilding with the builders is only for frames still in their drafted state.
- Edit the component when the element is part of an item component; check the instances afterwards.
- Apply the same edit to every page copy found in step 2.
- Annotate each edited node so the designer sees what changed and why:

  ```js
  node.annotations = [...node.annotations, { labelMarkdown: '**CMS sync 2026-11-02**: focus ring added (accessibility audit, block acme-hero)' }]
  ```

- Screenshot each edited frame before and after, and compare the after with the CMS preview.

## 6. Log and hand off

- Update the plan's §10 rows: status and "last synced" with the date and a one-line change note.
- Refresh the baseline: `cms_checkout_block` again for each synced block (remotely, save a fresh `cms_block_base` over each baseline file), so the next diff starts from here.
- Report: changes applied (with before/after screenshots), changes left for the designer, blocks without a frame, and anything that still differs between Figma and the CMS.

## Drift check

Asked to "check Figma against the site", run steps 1–3 for every block in the design map without a known change list: preview each block, screenshot its frame, list every difference with its class, and stop at the checkpoint. Run it before a redesign and after an audit.
