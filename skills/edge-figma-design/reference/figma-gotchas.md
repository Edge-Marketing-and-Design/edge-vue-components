# Figma gotchas

Each of these cost real time on the first site. The library in `scripts/figma/` already handles the ones marked **handled**; the rest are rules for your own scripts.

## Paints and tokens

- **Variable-bound paints lose their opacity** (handled). A paint bound to a color variable keeps opacity 1 on a node's first assignment, and inside component instances it renders solid even when the main component is right, and repairs made in the same call revert. Rule: bind opaque paints to tokens; make translucent tints (white 5%, teal 12%, sand 25%) plain colors from the token's value (`L.raw`). `L.paint` does this automatically.
- If a file already has bound translucent paints, convert them with a pass over the page (replace each bound paint with opacity < 1 by a plain paint of the same color and opacity), then run `L.syncTranslucent(page)` **in a separate `use_figma` call** to restore instances.
- **Paint `color` takes `{ r, g, b }` only**, in 0–1. Opacity goes on the paint.

## Plugin data and the library

- **Plugin data namespaces allow only letters, digits, `_` and `.`** (`edge-site` throws; `edgesite` works).
- **`eval` and `new Function` work** in `use_figma`, and a function's `toString()` returns its source, so a library stored in root shared plugin data can be loaded in any later call. `setPluginData` is not available; use `setSharedPluginData`.
- **A call's return value is capped at 20 KB.** Read large plugin-data values one key at a time.
- **Code is capped at 50,000 characters per call.** Install the library one file per call.

## Instances and components

- **`figma.skipInvisibleInstanceChildren` is true by default**, so `findOne` inside an instance cannot see hidden layers (an optional badge, a stat icon). The core sets it to false.
- **Name collisions inside instances.** A card's `label` text and its nested photo placeholder's `label` text are both findable; `L.own` returns only the layer that belongs to the instance itself.
- **Reparenting an instance resets some of its overrides.** Append instances to their parent before setting texts and fills (`L.I` does).
- **Overriding an instance's fills is fine** (featured tier in a dark fill), but detaching it is not: detached items no longer map to the CMS array component.
- **`toString()` output may be reformatted** after storage (spacing, semicolons). Patch stored source with tolerant matching, or better, re-install the file from the repo.

## Layout

- **`layoutSizingHorizontal = 'FILL'` only works after the node is appended to an auto-layout parent.** Text that wraps needs `textAutoResize = 'HEIGHT'` before `FILL`.
- **`node.clone()` lands on the current page**, not next to the original. Cloning an anchor section never touches the anchor frame.
- **Index-path mapping into a clone breaks after you insert or remove children.** Map every node you need first, then mutate (`L.dup().map`).
- **Duplicated anchor sections keep fixed heights.** After changing their copy, removing items or adding answers, hug the containers (`L.hugAll`) or size them to content. Do not hug a chart or anything aligned to a fixed height (bar charts collapse); fix those by hand.
- **Grid auto-layout (`layoutMode: 'GRID'`) centers a taller cell vertically**, pushing content above the frame. Convert the row to horizontal auto-layout with top or center alignment.
- **Anchor buttons are often fixed-size frames**; a longer label overflows. `L.hugBtn` converts them to hugging auto-layout.
- **Text with `textCase: 'UPPER'` is typed in mixed case in the anchor.** When replacing an uppercase label, keep the style's case (or set `textCase`) instead of typing capitals.
- **Absolute children of an auto-layout section** (texture, photo, overlay) need `constraints: STRETCH` and a resize after the content grows (`L.fitAbs`).

## Pages and canvas

- **Switch pages with `await figma.setCurrentPageAsync(page)`, once per call.** Each call starts on the first page.
- **The API cannot delete a page** ("Removing this node is not allowed"). Test on a scratch file, or empty the page and ask the developer to delete it.
- **Place top-level frames away from existing content** (to the right of the rightmost node), in columns: one column per block family, variants stacked, phone frames beside their desktop frame.
- **Screenshots**: `get_screenshot` with `maxDimension` up to about 5000 for a long page, then crop locally to inspect detail; a node's own `screenshot()` returns inline.
