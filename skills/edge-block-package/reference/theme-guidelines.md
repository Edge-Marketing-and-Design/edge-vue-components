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

## When a site has no theme

Start with `defaults/theme-minimal.json`, then translate the design system from
Figma:

1. Record the core background, surface, text, muted, border, link, brand,
   accent, success, and danger colors.
2. Record font stacks with reliable system fallbacks.
3. Add only the font sizes, radii, and shadows that appear repeatedly.
4. Add conservative global `apply` rules for the root, headings, links, and
   buttons.
5. Keep `slots` empty unless the active CMS/runtime defines a real slot
   contract.
6. Keep light/dark variants structurally present, but do not invent a dark
   palette that was not designed.

The root `theme.json` in this kit is the M4RL design base derived from the Figma
design. It can be pasted into a newly created theme after review.

## Recommended shape

```json
{
  "extend": {
    "colors": {
      "brand": "#1A2F4A",
      "surface": "#FFFFFF",
      "text": "#2A2A2A"
    },
    "fontFamily": {
      "sans": ["Poppins", "Arial", "sans-serif"],
      "display": ["Playfair Display", "Georgia", "serif"]
    }
  },
  "apply": {
    "root": "font-sans bg-surface text-text antialiased",
    "heading": "font-display text-brand"
  },
  "slots": {},
  "variants": {
    "light": { "apply": {} },
    "dark": { "apply": {}, "slots": {} }
  }
}
```

Common `extend` groups include `colors`, `fontFamily`, `fontSize`,
`borderRadius`, and `boxShadow`.

## Naming

- Prefer semantic tokens: `brand`, `surface`, `canvas`, `text`, `textMuted`,
  `border`, `accent`, `link`, `linkHover`.
- Use role-based tokens for stable components: `navBg`, `navText`, `footerBg`.
- Avoid Figma layer names, page names, hex-based names, and project-prefixed
  aliases unless the token truly has project-specific semantics.
- Do not create multiple names for the same visual role without a reason.

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
