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
  "tags": ["Template v2"],
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
{{ richtext(body) }}
{{#for card in cards}}
  {{ card.title }}
{{/for}}
{{{#if {"cond":"card.link"} }}}
  <a href="{{ card.link }}">{{ card.linkLabel }}</a>
{{{#else}}}
  <span>{{ card.linkLabel }}</span>
{{{/if}}}
```

- Plain placeholders are escaped.
- Use `richtext(value)` only for trusted CMS rich-text Inputs.
- Use plain `#for` loops for manual Input arrays.
- Template v2 conditions use triple braces and a JSON object.
- Do not use JavaScript operators such as `&&` or `||` in conditions.

Dynamic sources, when a later workflow explicitly adds them, must be declared
and called:

```handlebars
{{#for item in source("items")}}
  {{ item.name }}
{{/for}}
```

A configured Data Source does not run merely because it exists. Every declared
source must be called with `source("name")`. Dynamic sources also require
separate Hub-preview and public-renderer/KV verification.

## Input mapping

Use these classifications:

- fixed structural copy: keep literal in the template;
- editable scalar: `text`, `textarea`, `richtext`, `image`, `number`, or
  `option` Input;
- repeated editorial content: `array` Input with a nested `schema`;
- collection/API content: Data Source, outside this starter kit;
- site/theme-controlled content: theme token, Site Data Source, or runtime
  helper, not duplicated text;
- interaction requiring client state: supported CMS helper or a separately
  reviewed Vue override, outside this starter kit.

Do not invent records, testimonials, statistics, prices, dates, credentials,
contact information, links, or media. Keep unresolved items out of final import
JSON until a source of truth is supplied.

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
