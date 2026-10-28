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

When the plugin is enabled, it asks for:

- **Hub MCP URL:** defaults to emd-cms. Another Hub has its own URL
  (`https://<region>-<project-id>.cloudfunctions.net/cms-agentMcp`).
- **Hub connection credential:** your own `cmsac.…` credential, from the
  Hub's Dev Mode, Agent Keys, Hub connections, Create. It is kept in the
  system's secure credential store. The agent acts with your Hub rights, and
  the connection can be renewed or revoked there.

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
Functions. Codex packaging waits for the Codex setup.
