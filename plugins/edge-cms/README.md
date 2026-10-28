# edge-cms plugin

The Edge CMS skills and the Hub's remote CMS tools in one install, for people
who build or edit sites in a Hub without a Hub checkout.

- **Skills:** `edge-block-package`, `edge-design-to-site`, `edge-figma-design`,
  `vue-to-block-migrator`. Copies of `edge/skills/`; don't edit them here.
  Each says what changes without a Hub checkout. The migrator reads the public
  renderer's Template v2 guide as `cms_contract` kind `renderer`, which the
  Hub bundles from emd-cms-front.
- **MCP server `edge-cms`:** the Hub's `cms-agentMcp` endpoint (draft-only:
  nothing it does publishes a page, releases a block or changes a live theme).

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
