import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { linkSkills } from '../skills/link-skills.mjs'
import { runChecks, tomlTables } from '../tools/dev-check.mjs'

async function write(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

// A Hub with one skill, its links, a CMS server with a key, and a clean home.
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'edge-dev-check-'))
  const hub = path.join(root, 'hub')
  const home = path.join(root, 'home')
  await write(path.join(hub, 'edge/skills/alpha/SKILL.md'), '---\nname: alpha\n---\n')
  await mkdir(path.join(root, 'emd-cms-front'))
  await write(path.join(hub, '.mcp.json'), JSON.stringify({ mcpServers: { 'hub-readonly': {
    command: 'sh', args: ['-c', 'exec sh "$(git rev-parse --show-toplevel)/edge/tools/mcp/cms/launch.sh"'],
    env: { EDGE_CMS_MCP_CREDENTIALS: '~/.config/hub/key.json' },
  } } }))
  await write(path.join(home, '.config/hub/key.json'), '{}')
  await mkdir(path.join(hub, 'edge/tools/mcp/cms/node_modules'), { recursive: true })
  await linkSkills(hub)
  return { root, hub, home }
}

const failures = results => results.filter(r => r.ok === false).map(r => r.name)

test('reads TOML table headers and bodies', () => {
  const tables = tomlTables('a = 1\n[mcp_servers.x]\ncommand = "node"\n[mcp_servers.x.env]\nK = "v"\n')
  assert.deepEqual(Object.keys(tables), ['mcp_servers.x', 'mcp_servers.x.env'])
  assert.match(tables['mcp_servers.x'], /command/)
})

test('a clean machine passes', async t => {
  const { root, hub, home } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(failures(await runChecks({ hubRoot: hub, home, claudeMcpList: 'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected\n' })), [])
})

test('flags every source that puts other CMS tools or skill copies in a session', async t => {
  const { root, hub, home } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  await rm(path.join(hub, '.claude/skills/alpha'))
  await write(path.join(home, '.codex/skills/alpha/SKILL.md'), 'copy')
  await mkdir(path.join(home, '.claude/plugins/synced/org/edge-cms'), { recursive: true })
  await write(path.join(home, '.codex/config.toml'), [
    '[plugins."edge-cms@edge"]', 'enabled = true',
    '[mcp_servers.iafsc_firebase]', 'command = "node"',
    '[mcp_servers.old]', 'command = "node"', 'enabled = false', 'args = ["firebase"]',
  ].join('\n'))
  await write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'emd-cms-remote': { type: 'http', url: 'https://x.cloudfunctions.net/cms-agentMcp' } } }))
  await rm(path.join(home, '.config/hub/key.json'))
  const list = 'claude.ai EMD CMS: https://us-west1-emd-cms.cloudfunctions.net/cms-agentMcp - ✔ Connected\n'
  const results = await runChecks({ hubRoot: hub, home, claudeMcpList: list })
  assert.deepEqual(failures(results), [
    'Hub skill links match edge/skills',
    'No personal copies of Edge skills',
    'No edge-cms plugin or Edge account skill synced by the claude CLI',
    'No edge-cms plugin in Codex',
    'No Hub servers in ~/.codex/config.toml',
    'No Hub servers in ~/.claude.json',
    'No remote CMS connector or edge-cms plugin server',
    'Read-only key for hub-readonly',
  ])
  assert.match(results.find(r => r.name === 'No Hub servers in ~/.codex/config.toml').detail, /iafsc_firebase/)
  assert.doesNotMatch(results.find(r => r.name === 'No Hub servers in ~/.codex/config.toml').detail, /\bold\b/)
})

test('without the connector list it warns instead of passing', async t => {
  const { root, hub, home } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const results = await runChecks({ hubRoot: hub, home, claudeMcpList: null })
  assert.equal(results.find(r => r.name === 'claude.ai connectors not checked').ok, 'warn')
})
