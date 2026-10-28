import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { skillDrift } from '../plugins/sync-skills.mjs'

test('the edge-cms plugin ships the current edge/skills copies', async () => {
  assert.deepEqual(await skillDrift(), [], 'run node edge/plugins/sync-skills.mjs')
})

test('the plugin MCP server takes its URL and credential from userConfig', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugins/edge-cms/.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  const mcp = JSON.parse(await readFile(new URL('../plugins/edge-cms/.mcp.json', import.meta.url), 'utf8'))
  const server = mcp.mcpServers['edge-cms']
  assert.equal(manifest.userConfig.connection.sensitive, true)
  // eslint-disable-next-line no-template-curly-in-string
  assert.equal(server.url, '${user_config.hub_url}')
  // eslint-disable-next-line no-template-curly-in-string
  assert.equal(server.headers.Authorization, 'Bearer ${user_config.connection}')
})
