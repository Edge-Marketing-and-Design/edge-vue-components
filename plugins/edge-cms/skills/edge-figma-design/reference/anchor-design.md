# The anchor design

The anchor is the one piece of approved design the whole site extends. It is the biggest single reason the full-site draft looks bespoke instead of generic: every type size, radius, shadow, button, eyebrow, texture and section color in the plan's design language is measured from it, and the full site's home page and shared sections are duplicates of it.

## How the first anchor was made (Montana Outdoor Expo)

It did not need a big design budget:

1. **AI first pass.** Figma Make, on a less expensive model, given the brand colors and fonts and the landing page's copy, produced a full landing page.
2. **Developer polish.** The developer worked in Figma Make until it reached a basic level of acceptance (layout, hierarchy, obvious fixes).
3. **Light designer pass.** The designer did one short round: button rounding, some spacing, a few color changes.
4. **Approved.** That frame became the anchor. In MOE's case it also went live as a temporary landing page and was converted to CMS blocks, which gave the full site real sections to reuse. That is a bonus, not a requirement.

Repeat that recipe. The designer's pass matters more than its size: it is the human taste the rest of the site inherits.

## What the anchor must contain

At minimum, approved by the designer:

- **A hero** with the real nav: logo, menu, call-to-action button, the primary heading treatment (and an accent line if the brand uses one), eyebrow, body, primary and secondary buttons.
- **A dark section and a light section**, so both color treatments, their textures, and text on each are decided.
- **A card section** (stats, features, tiers or people): card radius, border, shadow, padding, the number or icon treatment.
- **A list or accordion section** (FAQ, benefits), so bullets, dividers and small type are decided.
- **The footer**, including any banner above it.
- Real copy for one page, so line lengths and heading sizes are realistic.

More is better (a gallery, a contact block), but four or five sections are enough.

## What to extract from it (plan §2 and §3)

Inspect every section with `get_design_context` and `get_screenshot`, and dump each section's tree (types, auto-layout, padding, fills with opacity, strokes, radii, effects, text styles) with a read-only `use_figma` script. Record:

- **Colors** as roles: which hex is the dark section background, light background, card surface, card border, body text, muted text, heading, each accent and where it is used (buttons, eyebrows on light vs dark, numbers, bullets). Note opacities used on top of them (body text on dark at 80%, borders at 10%).
- **Type scale**: every heading, eyebrow, body, label and button style with family, weight, size, line height, letter spacing and case. Note the font style names exactly as Figma lists them (`ExtraBold`, `SemiBold Italic`).
- **Components**: container width and side padding, section padding, button padding/radius/shadow per kind, card radius/border/padding/shadow, panel radius, pill and chip shapes, bullet size and color, the image placeholder style.
- **Textures and treatments**: background patterns (and the node to clone them from), gradient overlays on photo heroes (and their node), rotated photo collages, watermark words, banners.
- **Rhythm**: the order of dark, light and tinted sections, so neighbouring sections never share a background.
- **Node ids** of every section, for reuse by duplication and for `meta.design`.

Put the reusable source nodes in the Figma config (`darkTexture`, `lightPaintsFrom`, `heroOverlayFrom`; see `figma-build.md`).

## If there is no anchor

Stop and make one; it costs less than reworking a full site that looks generic. If the developer insists on going ahead, build the tokens from the brand guide, draw Tier 1 blocks only, and stop for a designer review of those before any page is drawn.
