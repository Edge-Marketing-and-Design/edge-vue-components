# Edge developer setup: instructions for your AI agent

Give this file to Claude Code or Codex on the developer's Mac and say: "Follow
this from start to finish." The agent does the terminal work. It stops for
the person at the steps marked **Person**: browser sign-ins and app settings.

The result: in every Hub checkout, sessions in Claude Code (desktop app and
`claude` CLI) and Codex get that Hub's own CMS tools and the Edge skills from
the checkout. Nothing Edge-specific comes from the person's accounts.
Background is in `edge/tools/mcp/cms/README.md`, "Developer setup" and
"Credentials".

## Rules for the agent

- Never ask the person to paste a credential into the chat, and never print
  one. Hub connections go from the clipboard straight into a file (step 6).
- Before deleting or editing anything outside the Hub checkouts, show the
  person what you will change and wait for a yes.
- Don't commit, push, deploy, or change anything in a Hub (pages, sites,
  blocks). This setup only reads.
- If a step fails, say which step, show the error, and stop. Don't work
  around it.

## Step 1: Tools on the Mac

Check each one, and install what is missing with Homebrew (ask first):

- `git`, with access to github.com/Edge-Marketing-and-Design (`git ls-remote
  git@github.com:Edge-Marketing-and-Design/clearwater-hub.git` succeeds).
- `nvm`, then `nvm install 22.13.1` (the Hubs' `.nvmrc`).
- The Google Cloud CLI: `gcloud --version`.
- Claude Code (`claude --version`) and/or Codex, whichever the person uses.

## Step 2: Checkouts

Use one parent folder, `~/Development/Edge` unless the person already has
checkouts somewhere (then use theirs). Each Hub needs `emd-cms-front` in the
folder next to it.

```bash
mkdir -p ~/Development/Edge && cd ~/Development/Edge
git clone git@github.com:Edge-Marketing-and-Design/clearwater-hub.git
git clone git@github.com:Edge-Marketing-and-Design/emd-cms.git
git clone git@github.com:Edge-Marketing-and-Design/emd-cms-front.git
```

Existing checkouts: on `main`, run `git pull --ff-only`. If a Hub lives in a
different folder from `emd-cms-front`, link it in:
`ln -s <path to emd-cms-front> <hub's parent folder>/emd-cms-front`.

## Step 3: Remove account-level Edge tools

These load in every session, next to the Hub's own tools.

1. **Person**, in claude.ai, Settings, Connectors: remove any connector whose
   URL ends in `/cms-agentMcp` (for example "EMD CMS" or "Clearwater MCP").
2. **Person**, in the Claude desktop app: uninstall the `edge-cms` plugin if
   it is installed. In claude.ai, Settings, Skills: delete any skill named
   `edge-*` or `vue-to-block-migrator`.
3. **Agent**, after showing the list and getting a yes, remove:
   - folders named like an Edge skill (`edge-*`, `vue-to-block-migrator`) in
     `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`;
   - `~/.claude/plugins/synced/*/edge-cms` and any Edge skill under
     `~/.claude/skills/synced/*/`. The `claude` CLI keeps these copies after
     removals in claude.ai.
   - In `~/.codex/config.toml`: `[plugins."edge-cms@…"]`, `[marketplaces.edge]`,
     and any `[mcp_servers.*]` that starts a CMS or Firebase server for a Hub.
     Back the file up first.
   - In `~/.claude.json`: any user-level `mcpServers` entry for a Hub's CMS
     or Firebase (`claude mcp remove <name> -s user`).

## Step 4: Google sign-in (Person)

Run `gcloud auth application-default login`. The person signs in in the
browser with the Google account that has access to the `clearwater-hub` and
`emd-cms` Firebase projects. The CMS tools read each Hub's database as this
account.

## Step 5: Server dependencies

In each Hub's folder: `npm --prefix edge/tools/mcp/cms install`.

## Step 6: Hub connections (Person, one per Hub)

For each Hub, the person opens Agent keys:

- Clearwater: https://hub.clearwaterproperties.com/app/dashboard/agent-keys
- emd-cms: https://emd-cms.web.app/app/dashboard/agent-keys

Under Hub connections, they create a connection named for themselves and
this computer (for example "Seth's MacBook"), pick a lifetime, and click Copy
on the credential, which is shown only once. Then the agent runs, for that
Hub:

```bash
mkdir -p ~/.config/clearwater && pbpaste > ~/.config/clearwater/cms-agent-connection && chmod 600 ~/.config/clearwater/cms-agent-connection
```

```bash
mkdir -p ~/.config/emd-cms && pbpaste > ~/.config/emd-cms/cms-agent-connection && chmod 600 ~/.config/emd-cms/cms-agent-connection
```

Check without printing it: `grep -c '^cmsac\.' <file>` prints `1`. Only then
does the person click "I’ve stored it" in the Hub, and copy something harmless
to clear the clipboard.

## Step 7: Automated check

In each Hub's folder:

```bash
node edge/tools/dev-check.mjs
```

It must end with "No failures.", with no `FAIL` lines; `warn` lines are
advice. A `FAIL` line names its fix: apply it and run the check again. "Your Google sign-in can read …"
failing with permission denied means the Google account needs access to that
Firebase project: tell the person to ask Dustin.

## Step 8: Client check (Person starts the sessions)

For each Hub and each client the person uses:

- **Claude desktop app:** a new Code session in the Hub folder.
- **`claude` CLI:** `claude` in the Hub folder. Approve the project's MCP
  servers the first time.
- **Codex:** open the Hub folder and trust it when asked.

In each new session, ask: "List your MCP servers and your skills. Then call
`cms_agent_organizations`, and `cms_list_sites` for the first organization."
Working means all of these:

- The CMS servers are only that Hub's: `clearwater-firebase-readonly` and
  `clearwater-cms-emulator`, or `emd-cms-production` and `emd-cms-emulator`,
  plus `chrome-devtools`. No `edge-cms` and no claude.ai CMS connector.
- The skills include `edge-block-package`, `edge-design-to-site`,
  `edge-figma-design`, `edge-site-launch`, `edge-site-setup`,
  `edge-skill-impact` and `vue-to-block-migrator`, each once, with no
  `edge-cms:` prefix.
- `cms_agent_organizations` returns `ok: true` with the person's
  organizations, which shows the Hub connection works.
- `cms_list_sites` returns sites, with `credentials.source` set to
  `google-sign-in`, which shows the database reads work.

The emulator server answers only while the local emulators run; that's
expected.

## Step 9: Report

Finish with a short report:

- `dev-check.mjs` result for each Hub.
- For each Hub and client: servers, skills, and the two tool calls, each as
  pass or fail.
- What was removed in step 3.
- Anything that still fails, and the step that needs the person.

The setup is complete only when every item passes. Hub connections expire
after their lifetime: renew them on the same Agent keys page. The local file
stays the same.
