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

Before the first session, save your own Hub connection credential (Hub: Dev
Mode, Agent Keys, Hub connections, Create; it is shown once) in a private
file. The agent acts with your Hub rights, and the connection can be renewed
or revoked in the Hub:

```bash
mkdir -p ~/.config/emd-cms
pbpaste > ~/.config/emd-cms/cms-agent-connection   # after copying the credential
chmod 600 ~/.config/emd-cms/cms-agent-connection
```

The server's `headersHelper` (`scripts/hub-auth.sh`) reads that file on each
connection, so the credential is never in the plugin or Claude's settings.
Plugins installed from an organization catalog don't prompt for settings,
which is why it isn't a plugin setting. `EDGE_CMS_CONNECTION_FILE` points at
another file, and `EDGE_CMS_HUB_URL` at another Hub's endpoint
(`https://<region>-<project-id>.cloudfunctions.net/cms-agentMcp`); the default
is emd-cms. The desktop app doesn't read shell variables, so they only help
in a terminal.

claude.ai and Claude Desktop don't need the file: add the endpoint as a
custom connector there and click Connect to sign in with your Hub account.

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
same `skills/` and at `.codex-mcp.json`, Codex's own server file (Codex
refuses the Claude-only `headersHelper` in `.mcp.json`). Codex signs in with
OAuth on first use; its client id (`https://chatgpt.com/oauth/codex/client.json`)
is on the Hub's allowlist in `functions/cmsAgentOAuth.js`. Codex reads the
marketplace from `edge/.claude-plugin/marketplace.json`. The server URL is
emd-cms's; another Hub needs its own entry. `edge/tests/codexPlugin.test.mjs`
checks the package against the rules Codex applies when it loads a plugin;
it hasn't been installed in a real Codex yet.
