# <Project name> block packages

Read this before building any package here. The JSON block is read by the scaffold script; keep it valid.

```json project
{
  "project": "<slug, e.g. the-mule>",
  "hub": "<emd-cms | clearwater-hub | iafsc-hub>",
  "hubPath": "</absolute/path/to/hub checkout, or empty without one>",
  "organizationId": "<Hub organization document id>",
  "siteId": "<Hub site document id>",
  "themeId": "<Hub theme document id>",
  "themeName": "<theme name as shown in the Hub>",
  "blockPrefix": "<kebab prefix for docIds, e.g. mule>",
  "namePrefix": "<Name prefix for block names, e.g. Mule>",
  "tags": ["<the organization's block tag list from the Hub (cmsBlockTags), in order, e.g. Navigation, Hero, Content, Call to Action, Cards & Grids, Form, Footer, Quick Picks>"],
  "chrome": { "navigation": "<block name>", "footer": "<block name>", "cta": "<block name or empty>" },
  "overrideFolder": "app/blocks/<project>-<organizationId>",
  "validatorPath": "<scripts/cms/validate-import.mjs with a Hub checkout; empty without one (cms_validate runs the check)>",
  "precedentPackage": "<path to the package to copy the file shape from>",
  "themeSetupPackage": "<path to theme.json/head.json for previews, or empty>",
  "design": { "source": "figma", "file": "<Figma file key, or the handoff path with source handoff>", "revision": "<YYYY-MM-DD the design was last read>" },
  "bannedPhrases": ["requires an Apple Watch", "only app"]
}
```

## Source of truth

- Live Hub: <URL>. Existing blocks are read from the Hub before editing (`cms_block_base`, or the Firebase MCP with a checkout); never regenerated from files here.
- Approved copy: <documents or live pages that count as approved>.
- Design source: <Claude Design project / handoff zip location>. The `design` entry above names the file; each block's manifest entry and `meta.design` name its node. Update `revision` each time the design is re-read.

## Brand and content rules

- <accent rule, voice rule, minimum text size, contrast rule>
- <what must never be claimed>

## Existing packages and Hub state

| Package | Uploaded | Notes |
| --- | --- | --- |
| | | |

## Media

- <where approved images live, what may be called a screenshot>
