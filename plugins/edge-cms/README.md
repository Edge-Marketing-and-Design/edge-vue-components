# edge-cms plugin

The Edge CMS skills and the Hub's remote CMS tools in one install. Editors
use both, without a Hub checkout. Edge developers don't install it: a Hub
checkout supplies the same skills and its own CMS tools (Developers, below).

- **Skills:** `edge-block-package`, `edge-design-to-site`, `edge-figma-design`,
  `vue-to-block-migrator`, `edge-site-setup` (a new site to the standard in
  its `site-standards.json`), `edge-site-launch` (pre-launch, the person's
  launch steps, post-launch checks) and `edge-skill-impact` (keeps the
  skills, contracts and agent guide in step with code changes; needs a Hub
  checkout). Copies of `edge/skills/`; don't edit them here.
  Each says what changes without a Hub checkout. The migrator reads the public
  renderer's Template v2 guide as `cms_contract` kind `renderer`, which the
  Hub bundles from emd-cms-front.
- **MCP server `edge-cms`:** the Hub's `cms-agentMcp` endpoint (draft-only:
  nothing it does publishes a page, releases a block or changes a live theme).
- **MCP server `chrome-devtools`:** Google's `chrome-devtools-mcp`, pinned
  (`npx -y chrome-devtools-mcp@1.12.0`), for `edge-site-launch`: it drives a
  local Chrome for Lighthouse (accessibility, best practices, SEO; its
  performance trace tools for performance), phone-width checks, console and
  network. No key. Needs Node 22 and a current Chrome.

## Install

Install from the organization's plugin catalog, or in Claude Code add the
marketplace and install the plugin:

```bash
claude plugin marketplace add <owner>/edge-vue-components
claude plugin install edge-cms@edge
```

The first time a session uses the `edge-cms` server, sign in: in Claude
Desktop open the plugin's Connectors and click Connect (in a terminal, `/mcp`,
then `edge-cms`, then Authenticate). The browser opens the Hub's consent
screen; sign in with your Hub account and click Allow. The agent then acts
with your own Hub rights. Sign-ins last 30 days without use and 90 days at
most, and you can revoke one in the Hub at `/app/agent-authorize`. The plugin
holds no credential.

The server is emd-cms's endpoint. Each Hub signs in on its own origin, so for
another Hub (Clearwater, IAFSC) add that Hub's endpoint as its own connector
(`https://<region>-<project-id>.cloudfunctions.net/cms-agentMcp`) and sign in
to it there. claude.ai and Claude Desktop chats use the same sign-in: add the
endpoint as a custom connector and click Connect.

A Hub connection credential (`cmsac.…`, Dev Mode, Agent Keys, Hub
connections) still works as a bearer token for clients without OAuth, such as
a hand-added server or a script; the plugin no longer reads one.

If you already added the remote server by hand (for example `emd-cms-remote`
in `~/.claude.json`), remove it after installing so the tools don't appear
twice.

## Updating (plugin users)

After a change to the skills or servers is promoted to `edge-vue-components`
(`edge-push.sh`), update the marketplace and the plugin, then start a new
session:

```bash
claude plugin marketplace update edge
claude plugin update edge-cms@edge
```

Check it took: `/skills` lists the seven skills (`edge-site-setup`,
`edge-site-launch` and `edge-skill-impact` among them) and `/mcp` lists
`chrome-devtools`. The first `chrome-devtools` call downloads the pinned
package through `npx`. In Claude Desktop, update the plugin from its page
in the plugin catalog.

## Developers

Edge developers work from a Hub checkout and don't install this plugin or add
a Hub's remote endpoint as a claude.ai connector. Both belong to the account,
so they load in every session: in a Hub session that means a second, often
older copy of each skill and another Hub's remote CMS tools with the same tool
names as the local ones, so an agent can query the wrong Hub.

A Hub checkout supplies both instead:

- **Skills:** committed links from `.claude/skills/` and `.agents/skills/`
  to `edge/skills/` (`edge/skills/README.md`), so a session loads the skills
  of its own branch.
- **CMS tools:** the Hub's `.mcp.json` (Claude Code) and
  `.codex/config.toml` (Codex) start the local CMS server through
  `edge/tools/mcp/cms/launch.sh`, which keeps the checkout and its
  dependencies current (`edge/tools/mcp/cms/README.md`), and the pinned
  `chrome-devtools` server.
- **Access:** each developer's own, with no shared key files: a Hub
  connection created on the Hub's Agent keys page (drafts, media, previews,
  page and post reads, with their Hub permissions) and their Google sign-in
  (`gcloud auth application-default login`) for the database reads.

If the plugin or a CMS connector is already installed, remove it: the
plugin from Claude's plugin page and `[plugins."edge-cms@edge"]` (and the
`edge` marketplace) from `~/.codex/config.toml`; connectors in claude.ai
Settings, Connectors. The `claude` CLI keeps its own copies of org plugins
and account skills under `~/.claude/plugins/synced/` and
`~/.claude/skills/synced/`; if a removed one still loads there, delete its
folder.

The full one-time setup is in `edge/tools/mcp/cms/README.md` (Developer
setup); `node edge/tools/dev-check.mjs` checks a machine. Check a session: the
only CMS servers are the Hub's own (for example
`clearwater-firebase-readonly` and `clearwater-cms-emulator`) plus
`chrome-devtools`, and each Edge skill is listed once, without an
`edge-cms:` prefix.

## Maintaining

`edge/skills/` is the source. After changing one of these skills, run
`node edge/plugins/sync-skills.mjs` and commit both copies;
`edge/tests/pluginSkills.test.mjs` fails while they differ. Check the plugin
with `claude plugin validate edge/plugins/edge-cms` and the marketplace with
`claude plugin validate edge`.

The renderer guide reaches remote agents only through the Hub deploy: after
emd-cms-front changes `docs/cms-template-v2-blocks.md`, run
`node scripts/cms/sync-agent-contracts.mjs` in the Hub and deploy its
Functions.

## Codex

The same folder is a Codex plugin: `.codex-plugin/plugin.json` points at the
same `skills/` and at `.codex-mcp.json`, Codex's own server file, with
the OAuth resource, scope and tool timeout in Codex's format. Codex signs in with
OAuth on first use; its client id (`https://chatgpt.com/oauth/codex/client.json`)
is on the Hub's allowlist in `functions/cmsAgentOAuth.js`. Codex reads the
marketplace from `edge/.claude-plugin/marketplace.json`. The server URL is
emd-cms's; another Hub needs its own entry. `edge/tests/codexPlugin.test.mjs`
checks the package against the rules Codex applies when it loads a plugin;
it hasn't been installed in a real Codex yet.
