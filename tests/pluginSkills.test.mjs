import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { skillDrift } from '../plugins/sync-skills.mjs'

test('the edge-cms plugin ships the current edge/skills copies', async () => {
  assert.deepEqual(await skillDrift(), [], 'run node edge/plugins/sync-skills.mjs')
})

// The server signs in with the Hub's OAuth (Connect), so the plugin holds no
// credential and no helper. The URL is literal: Connect matches it exactly.
test('the plugin MCP server is the emd-cms endpoint with OAuth sign-in only', async () => {
  const mcp = JSON.parse(await readFile(new URL('../plugins/edge-cms/.mcp.json', import.meta.url), 'utf8'))
  assert.deepEqual(mcp.mcpServers['edge-cms'], { type: 'http', url: 'https://us-west1-emd-cms.cloudfunctions.net/cms-agentMcp' })
})
