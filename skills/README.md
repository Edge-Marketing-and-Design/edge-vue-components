# Edge CMS skills

Shared Edge code: the agent skills every Hub ships, used from Claude Code and
Codex.

| Skill | Use |
| --- | --- |
| `edge-block-package` | Build Template v2 block import packages from a design handoff, one page at a time |
| `edge-design-to-site` | Build a whole site in a Hub through the draft-only agent operations |
| `vue-to-block-migrator` | Convert Vue, HTML and CSS sources into Template v2 blocks, pages and packages |
| `edge-figma-design` | Plan a whole site from its copy and an anchor design, draw it in Figma for designer review, and sync CMS block changes back to Figma |
| `edge-site-setup` | Set up a new site to the standard in its `site-standards.json`: one round of questions, then theme, site, settings, menus, pages, chrome, SEO, images and forms, checked |
| `edge-site-launch` | Launch a site: pre-launch checks, the person's launch steps (domain, DNS, publish, analytics, MyStats), post-launch checks and a launch report (`launch-standards.json`) |
| `edge-skill-impact` | Find and fix the documents a code change made wrong, through `knowledge-map.json`; the backstop is `edge/tests/skillImpact.test.mjs` |

Each skill opens with the block vocabulary and a step 0 that receives the data
contracts through the CMS MCP tool `cms_contract` (`edge/tools/mcp/cms`), so a
session in any repository writes against the contract text, not a path.

## The edge-cms plugin

Every skill here also ships in the `edge-cms` plugin (`edge/plugins/edge-cms`) with the Hub's remote CMS
tools, for people without a Hub checkout (developers use the Hub's links,
below). Each of them says what changes
without a checkout. After changing one, run `node edge/plugins/sync-skills.mjs`;
`edge/tests/pluginSkills.test.mjs` fails while the plugin's copy is stale.

## The knowledge map

`knowledge-map.json` links areas of shared code to the documents that
describe them (skill references, contract sections, agent guide sections,
the renderer guide in `emd-cms-front`). The `edge-skill-impact` skill reads
it; add an entry when new code defines behavior a document describes.

## In a Hub session

Each Hub commits relative links to these folders, so Claude Code and Codex
load the skills of the checkout and branch the session runs in:

- `.claude/skills/<name>` -> `../../edge/skills/<name>` (Claude Code)
- `.agents/skills/<name>` -> `../../edge/skills/<name>` (Codex)

After a subtree update adds, renames or removes a skill, run
`node edge/skills/link-skills.mjs` in the Hub and commit the links;
`node edge/skills/link-skills.mjs --check` reports drift and exits 1 (the
Hub's test runs it). Other entries in those folders, such as a Hub's own
skills, are left alone. Links need a checkout with symlinks enabled (the
default on macOS and Linux).

Developers don't keep copies in `~/.claude/skills`, `~/.codex/skills` or a
claude.ai account, and don't install the `edge-cms` plugin: a copy there would
load in every session next to the Hub's own, often older.
