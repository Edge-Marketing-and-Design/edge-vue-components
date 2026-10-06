# Theme JSON guidelines

Theme JSON is the reusable design-token layer used by the CMS template engine.
It is JSON, not CSS. The Hub theme editor stores it in the **Theme JSON** field.

## When a site already has a theme

Export the current Theme JSON and use it unchanged as the starting source.
Inventory the existing colors, font families, sizes, radii, shadows, `apply`
rules, slots, and variants before generating blocks. Extend established tokens
instead of introducing near-duplicates.

Do not infer a live theme from a screenshot when an exact export is available.
Do not replace an existing theme merely to support one block.

## Standard names (required for new themes)

Start new themes from the Hub's `edge/lib/cmsThemeDefaults.mjs`, the source
of truth for both the New Theme UI and agent defaults. Keep the baseline
present; custom additions are allowed. Baseline-only blocks are portable;
extensions require every selected theme to declare them. Existing themes and
duplicates retain their JSON. Contract: `docs/data-contracts/cms-themes/README.md`.

- **Colors** (`extend.colors`), baseline required, extensions allowed:
  - brand: `primary`, `secondary`, `tertiary`, `accent` (the call-to-action
    color), most used first;
  - text on brand: `onPrimary`, `onSecondary`, `onTertiary`, `onAccent`,
    each readable on its color (4.5:1 for body text);
  - page: `canvas`, `surface`, `surfaceAlt`;
  - text: `text`, `textMuted`, `heading`, `link`, `linkHover`, `border`;
  - optional: `success`, `warning`, `danger`, **for status only** (form
    errors, confirmations, alerts). Never park a spare brand color in one
    (an olive "meadow" is not `success`): a client theme will give it a
    status green, red or amber and change every block that used it.
- **Fonts** (`extend.fontFamily`): `display` (headings), `sans` (body),
  `accent` (eyebrows, quotes, a serif or script voice). All three; repeat a
  stack when the design has fewer faces.
- **Radii** (`extend.borderRadius`): `card`, `panel`, `button`.
- Prefer semantic role names over palette, Figma layer, hex-based or project
  aliases. Extra names are a design choice, not a forbidden JSON schema.

Map the design's palette onto the roles by how each color is used, not by its
name, and record the mapping (palette name → role) in the package README for
the checkpoint. When a design has more brand colors than the four roles,
fold the rarely used one into the closest role or use a tint of one
(`bg-tertiary/60`), and say so at checkpoint 1. Status colors are not spare
slots.

In blocks:

- preferably baseline names, plus `white`, `black`, `transparent`,
  `current`, `inherit`;
- tints and hover shades are opacity modifiers in whole percent
  (`hover:bg-accent/90`, `text-heading/5`), never a new color or a hex
  (`hover:bg-[#d96a20]`). Never a bracketed decimal (`/[0.03]`): the Hub
  renders it black and the public renderer drops it;
- no Tailwind palette colors (`text-red-500`); extension names or CSS variables
  must be declared by every selected theme;
- decorative textures and patterns (topography lines, grain) are part of the
  theme: export the SVG from the design into Extra CSS as a class, colored
  with standard names, and use that class in the blocks. Don't skip them as
  "images".

Check with `node <hub>/scripts/cms/validate-import.mjs --standard-theme
<theme.json> <blocks/>` for baseline-only portability. Deliberate custom tokens
may warn without selected-theme context: use normal import validation and
`cms_check_operation` to verify those extensions against the selected themes.

## When a site has no theme

Start from the shared new-theme defaults, using the shape below as an example,
then translate the design system
from Figma:

1. Map the design's colors onto the standard names above.
2. Record font stacks for `display`, `sans` and `accent` with reliable
   system fallbacks.
3. Add the three standard radii, and only the font sizes and shadows that
   appear repeatedly.
4. Leave `apply` empty (`{}`), in the theme and its variants. The public
   renderer ignores `apply` rules; only the Hub's editors add them, as
   classes that can override a block's own (a heading rule recolored every
   heading in run 2 of the Montana test). Each block sets its own base font
   and text color on its outer element instead (`font-sans text-text`), as
   Clearwater's blocks do.
5. Keep `slots` empty unless the active CMS/runtime defines a real slot
   contract.
6. Keep light/dark variants structurally present, but do not invent a dark
   palette that was not designed.

## Recommended shape

```json
{
  "extend": {
    "colors": {
      "primary": "#083D38", "onPrimary": "#F8F6EF",
      "secondary": "#43A1A3", "onSecondary": "#FFFFFF",
      "tertiary": "#E3A326", "onTertiary": "#083D38",
      "accent": "#EC782B", "onAccent": "#FFFFFF",
      "canvas": "#F8F6EF", "surface": "#FFFFFF", "surfaceAlt": "#E3DBC7",
      "text": "#63513D", "textMuted": "#8A7A66", "heading": "#083D38",
      "link": "#43A1A3", "linkHover": "#083D38", "border": "#E3DBC7"
    },
    "fontFamily": {
      "display": ["Sofia Sans Extra Condensed", "Arial Narrow", "sans-serif"],
      "sans": ["Sofia Sans", "Arial", "sans-serif"],
      "accent": ["Fraunces", "Georgia", "serif"]
    },
    "borderRadius": { "card": "16px", "panel": "24px", "button": "12px" }
  },
  "apply": {},
  "slots": {},
  "variants": {
    "light": { "apply": {} },
    "dark": { "apply": {}, "slots": {} }
  }
}
```

Other `extend` groups (`fontSize`, `boxShadow`) are allowed and not yet
standardized; name them by role.

## Naming beyond the standard

- Existing themes that predate the standard names (Clearwater Main, emd-cms
  themes) keep their names until an explicitly requested migration; blocks for
  them only warn. Do not rename or migrate them as part of creating a new theme.
- Avoid Figma layer names, page names, hex-based names, and project-prefixed
  aliases in every group.

## What does not belong in Theme JSON

- CSS declarations, selectors, media queries, keyframes, or `@import`;
- `<style>` or `<link>` tags;
- font URLs;
- block-specific layout rules;
- JavaScript or runtime configuration;
- a complete generated design system duplicated from a framework.

Put selector CSS, animation keyframes, helper overrides, and exceptional
responsive rules in Theme **Extra CSS**. Keep block-specific structure in the
block's literal utility classes.

## Fonts

Every custom family named in `extend.fontFamily` must either be loaded by Head
JSON or deliberately rely on a locally installed/system font. Always include
fallbacks. Font family names must match the provider's CSS exactly.

## Theme-less interim blocks

If Theme JSON is not ready, a block may use semantic HTML and conservative
built-in utilities. Do not claim visual parity, and do not introduce custom
theme class names that the active renderer cannot generate. Once the theme is
created, regenerate and revalidate the blocks against its exact tokens.
