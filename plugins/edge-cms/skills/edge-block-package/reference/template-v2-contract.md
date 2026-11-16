# Portable Edge CMS Template v2 contract

This is the compact contract supplied to a block-generating agent. The active
public renderer's full authoring guide remains authoritative when this document
and the live system differ.

## Library block document

Every generated library block must have this shape:

```json
{
  "docId": "example-block",
  "name": "Example Block",
  "content": "<section>{{ heading }}</section>",
  "templateVersion": 2,
  "template": "<section>{{ heading }}</section>",
  "schema": {
    "heading": {
      "type": "text",
      "label": "Heading",
      "value": "Example heading"
    }
  },
  "dataSources": {},
  "values": {},
  "Instructions": "Edit the heading in the page editor.",
  "aiInstructions": "Keep the heading factual. Do not invent claims.",
  "tags": ["Content"],
  "themes": [],
  "type": ["Page"],
  "previewType": "light",
  "isOverrideBlock": false,
  "synced": false,
  "version": 1
}
```

Required rules:

- `docId` is stable, lowercase kebab case, and unique within a package.
- `templateVersion` is exactly `2`.
- `content` and `template` are identical.
- `schema`, `dataSources`, and `values` are objects.
- Library `values` is `{}`. Input defaults live in `schema[field].value`.
- New Input definitions use `label`, not legacy `title`.
- `themes` contains real CMS theme document IDs, not theme names. Leave it
  empty when the ID is unknown.
- A normal Template v2 block has `isOverrideBlock: false`.

## Supported starter grammar

```handlebars
{{ heading }}
{{{#if {"cond":"item.eyebrow"} }}}
  <p>{{ eyebrow }}</p>
{{{/if}}}
{{ richtext(body) }}
{{#for card in cards}}
  {{ card.title }}
  {{{#if {"cond":"card.link"} }}}
    <a href="{{ card.link }}">{{ card.linkLabel }}</a>
  {{{#else}}}
    <span>{{ card.linkLabel }}</span>
  {{{/if}}}
{{/for}}
```

- Plain placeholders are escaped.
- Use `richtext(value)` only for trusted CMS rich-text Inputs.
- Use plain `#for` loops for manual Input arrays.
- Template v2 conditions use triple braces and a JSON object.
- A condition reads data only through `item` or a loop alias (the enclosing
  loop's or an ancestor loop's, `card.link` above). Outside loops `item` is
  the block's values, so test a field as `item.eyebrow`; a bare `eyebrow` is
  always false and the `else` branch renders (`grammar.condition-scope`).
  Inside a loop `item` is the current entry and the block's own fields can't
  be tested: move the condition outside the loop, or render the field in an
  element with `empty:hidden` (`grammar.condition-loop-item` warns). Verified
  in the public renderer, the Hub preview and the page editor canvas
  (2026-11-04).
- Do not use JavaScript operators such as `&&` or `||` in conditions.

Dynamic sources, when a later workflow explicitly adds them, must be declared
and called:

```handlebars
{{#for item in source("items")}}
  {{ item.name }}
{{/for}}
```

A configured Data Source does not run merely because it exists. Activate it
with `source("name")` or a collectionFilter, collectionOptions or paired
collectionResults helper. For interactive filtering/pagination, use the complete
configuration and single-template example in
[interactive collections](interactive-collections.md). Keep the normal condition
scope rule in results: an empty-result condition is `item.total == 0`.
Hub preview and public frontend interactions remain separate verification paths.

The authenticated Hub canvas loads collection records from Firestore, including
saved draft site settings, menus and posts, without changing the block. Public rendering still reads published posts. Do not
change a source path or embed sample values to enable this preview behavior.

## Input mapping

Use these classifications:

- fixed structural copy: keep literal in the template;
- editable scalar: `text`, `textarea`, `richtext`, `image`, video (below),
  `number`, or `option` Input;
- editable link (a button, call to action or card link): a Link Input, below;
- repeated editorial content: `array` Input with a nested `schema`;
- collection/API content: Data Source, outside this starter kit;
- site/theme-controlled content: theme token, Site Data Source, or runtime
  helper, not duplicated text;
- interaction requiring client state: supported CMS helper or a separately
  reviewed Vue override, outside this starter kit.

### Video inputs

A video in the design (a player, or a background behind other content)
becomes a video input: a `richtext` input with `picker: "video"`, empty by
default. The blocks contract ("Input types") is the full reference.

```json
{
  "heroVideo": {
    "type": "richtext",
    "label": "Hero Video",
    "picker": "video",
    "value": "",
    "tags": ["Videos"],
    "videoOptions": { "layout": "background" }
  }
}
```

- Render it with `{{ richtext(heroVideo) }}`, also inside array items. A bare
  `{{ heroVideo }}` is escaped on the public site.
- `videoOptions` only sets the picker's starting choices for a new
  selection; leave it out for an ordinary player. Don't add schema fields
  for autoplay, sound, loop, controls, start time or poster: the editor picks
  those in the video picker and they live in the stored value.
- A background video covers its nearest positioned ancestor. Render it
  inside an element with `relative` (or another positioning class), and give
  content that sits on top its own `relative` and a `z-` class.
- Agents can't upload or choose videos: `cms_upload_media` takes images only,
  and a value must be a processed Cloudflare Stream iframe from the Hub's
  picker. Leave the value empty, and list each video for a person to pick in
  the Hub (field, block, page, the source video). Never put a YouTube, Vimeo,
  R2 or old-site video URL in markup, a default or a value.
- The Hub preview doesn't run the video's inline guard script. Check
  autoplay and background behavior on the published site.

Do not invent records, testimonials, statistics, prices, dates, credentials,
contact information, links, or media. Keep unresolved items out of final import
JSON until a source of truth is supplied.

## Links

Every link an editor sets is a Link Input: a `text` Input with
`"picker": "link"`. The Hub shows a page picker for it; the stored value is
the page's address with a trailing slash, the form the public site serves
(`/`, `/about/`, `/team/leadership/`). Typed site paths are corrected to that
form; outside addresses (`https://`, `mailto:`, `tel:`, `#section`) are kept.

```json
{
  "ctaUrl": { "type": "text", "label": "Button Link", "picker": "link", "value": "" },
  "cards": {
    "type": "array",
    "label": "Cards",
    "value": [],
    "schema": {
      "title": { "type": "text", "label": "Title", "value": "" },
      "link": { "type": "text", "label": "Link", "picker": "link", "value": "" }
    }
  }
}
```

```handlebars
{{{#if {"cond":"item.ctaUrl"} }}}<a href="{{ ctaUrl }}">{{ ctaLabel }}</a>{{{/if}}}
```

- The value is a plain string; render it with `{{ field }}`, never
  `richtext()`. To hide a link left empty, condition on it: a root Input is
  `item.<field>` in a condition (`{"cond":"item.ctaUrl"}`), a loop field
  `card.link`.
- A default is a site path in that form (`"/contact/"`) or empty. Never an
  invented address.
- Values written by `page.setValues` must already be in that form; the check
  refuses `/about` and names `/about/`.
- A plain `text` Input written as a whole `href` gets the
  `schema.link-picker` warning. `mailto:{{ email }}` and `tel:{{ phone }}`
  stay `text`.
- The address doesn't follow a page renamed or moved later; the picker shows
  a warning for an address no page uses.

## Markup and accessibility

- Preserve semantic landmarks and heading order.
- Give meaningful images editable, accurate alternative text.
- Mark purely decorative images with `alt=""` and `aria-hidden="true"`.
- Use real links for navigation and buttons for actions.
- Include `type="button"` for non-submit buttons.
- Preserve visible focus behavior and readable contrast.
- Keep utility class names literal; do not assemble class fragments through
  placeholders.

## Prohibited output

Do not emit:

- `<script>` tags;
- Vue directives (`v-if`, `v-for`, `v-model`, `@click`);
- JSX or React component syntax;
- inline event handlers such as `onclick`;
- unapproved external JavaScript dependencies;
- Firebase SDK access;
- a Vue override disguised as a Template v2 block.

## Theme boundary

Theme JSON defines reusable design tokens and theme application classes. Head
JSON loads fonts and other approved head resources. Selector CSS and animations
belong in Theme Extra CSS. A block should use existing tokens where available
and must disclose any class or font dependency it introduces.

## Validation boundary

Local generation and validation do not import, publish, deploy, or prove
production rendering. Advanced blocks must additionally verify Hub preview,
the public renderer, runtime helpers, and any collection/API contracts.
