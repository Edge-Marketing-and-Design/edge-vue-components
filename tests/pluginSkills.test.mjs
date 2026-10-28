import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { skillDrift } from '../plugins/sync-skills.mjs'

test('the edge-cms plugin ships the current edge/skills copies', async () => {
  assert.deepEqual(await skillDrift(), [], 'run node edge/plugins/sync-skills.mjs')
})

// Plugins synced from an org catalog never prompt for userConfig, so the
// credential comes from the person's credential file through headersHelper.
test('the plugin MCP server reads the credential through its headersHelper', async () => {
  const mcp = JSON.parse(await readFile(new URL('../plugins/edge-cms/.mcp.json', import.meta.url), 'utf8'))
  const server = mcp.mcpServers['edge-cms']
  assert.equal(server.headers, undefined)
  // eslint-disable-next-line no-template-curly-in-string
  assert.equal(server.headersHelper, 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/hub-auth.sh"')
  const dir = await mkdtemp(path.join(tmpdir(), 'edge-cms-auth-'))
  const helper = fileURLToPath(new URL('../plugins/edge-cms/scripts/hub-auth.sh', import.meta.url))
  const run = file => spawnSync('sh', [helper], { env: { ...process.env, EDGE_CMS_CONNECTION_FILE: file }, encoding: 'utf8' })
  await writeFile(path.join(dir, 'ok'), 'cmsac.test-credential\n')
  assert.deepEqual(JSON.parse(run(path.join(dir, 'ok')).stdout), { Authorization: 'Bearer cmsac.test-credential' })
  await writeFile(path.join(dir, 'bad'), 'not-a-credential')
  assert.equal(run(path.join(dir, 'bad')).status, 1)
  assert.equal(run(path.join(dir, 'missing')).status, 1)
  await rm(dir, { recursive: true, force: true })
})
