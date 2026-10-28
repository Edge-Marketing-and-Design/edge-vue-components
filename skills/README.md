# Edge CMS skills

Shared Edge code: the agent skills every Hub ships, used from Claude Code and
Codex.

| Skill | Use |
| --- | --- |
| `edge-block-package` | Build Template v2 block import packages from a design handoff, one page at a time |
| `edge-design-to-site` | Build a whole site in a Hub through the draft-only agent operations |
| `vue-to-block-migrator` | Convert Vue, HTML and CSS sources into Template v2 blocks, pages and packages |
| `edge-figma-design` | Plan a whole site from its copy and an anchor design, draw it in Figma for designer review, and sync CMS block changes back to Figma |

Each skill opens with the block vocabulary and a step 0 that receives the data
contracts through the CMS MCP tool `cms_contract` (`edge/tools/mcp/cms`), so a
session in any repository writes against the contract text, not a path.

## The edge-cms plugin

`edge-block-package`, `edge-design-to-site`, `edge-figma-design` and
`vue-to-block-migrator` also ship in the `edge-cms` plugin (`edge/plugins/edge-cms`) with the Hub's remote CMS
tools, for people without a Hub checkout. Each of them says what changes
without a checkout. After changing one, run `node edge/plugins/sync-skills.mjs`;
`edge/tests/pluginSkills.test.mjs` fails while the plugin's copy is stale.

## Personal copies

Claude Code and Codex load skills from `~/.claude/skills` and
`~/.codex/skills`. Those folders hold copies of these directories, not links,
so they drift until refreshed. After a skill change lands on a branch, refresh
every copy that exists from that branch (run from any checkout of the Hub;
`git archive` reads the committed tree, so commit first):

```bash
branch=cms-autonomy-contracts
for name in edge-block-package edge-design-to-site vue-to-block-migrator edge-figma-design; do
  for dir in ~/.codex/skills ~/.claude/skills; do
    [ -d "$dir/$name" ] || continue
    rm -rf "${dir:?}/${name:?}" && mkdir -p "$dir/$name" \
      && git archive "$branch" "edge/skills/$name" | tar -x -C "$dir/$name" --strip-components=3
  done
done
```

Then compare: `diff -rq edge/skills/<name> ~/.codex/skills/<name>` prints
nothing when the copy matches. Only the copies that already exist are
refreshed; a skill is installed in a folder deliberately, not by this loop.
