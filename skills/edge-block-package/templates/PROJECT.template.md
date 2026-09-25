# <Project name> block packages

Read this before building any package here. The JSON block is read by the scaffold script; keep it valid.

```json project
{
  "project": "<slug, e.g. the-mule>",
  "hub": "<emd-cms | clearwater-hub | iafsc-hub>",
  "hubPath": "</absolute/path/to/hub checkout>",
  "organizationId": "<Hub organization document id>",
  "siteId": "<Hub site document id>",
  "themeId": "<Hub theme document id>",
  "themeName": "<theme name as shown in the Hub>",
  "blockPrefix": "<kebab prefix for docIds, e.g. mule>",
  "namePrefix": "<Name prefix for block names, e.g. Mule>",
  "tags": ["Navigation", "Hero", "Content", "CTA", "Footer", "Calculator", "Quick Picks"],
  "chrome": { "navigation": "<block name>", "footer": "<block name>", "cta": "<block name or empty>" },
  "overrideFolder": "app/blocks/<project>-<organizationId>",
  "validatorPath": "scripts/cms/validate-import.mjs",
  "precedentPackage": "<path to the package to copy the file shape from>",
  "themeSetupPackage": "<path to theme.json/head.json for previews, or empty>",
  "bannedPhrases": ["requires an Apple Watch", "only app"]
}
```

## Source of truth

- Live Hub: <URL>. Existing blocks are pulled through the Firebase MCP before editing; never regenerated from files here.
- Approved copy: <documents or live pages that count as approved>.
- Design source: <Claude Design project / handoff zip location>.

## Brand and content rules

- <accent rule, voice rule, minimum text size, contrast rule>
- <what must never be claimed>

## Existing packages and Hub state

| Package | Uploaded | Notes |
| --- | --- | --- |
| | | |

## Media

- <where approved images live, what may be called a screenshot>
