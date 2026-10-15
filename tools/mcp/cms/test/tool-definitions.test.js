import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CMS_AGENT_REMOTE_TOOL_NAMES, cmsAgentToolDefinitions } from '../../../../lib/cmsAgentMcpTools.js'
import { CMS_OPERATION_TYPES } from '../../../../lib/cmsOperations.js'

const edgeRoot = new URL('../../../../', import.meta.url)
const LOCAL_TOOLS = [
  'firestore_list_collections', 'firestore_get_document', 'firestore_sample_collection', 'firestore_infer_schema', 'firestore_compare_schema', 'firestore_find_field',
  'cms_find_block', 'cms_audit_blocks', 'cms_checkout_block', 'cms_status', 'cms_diff', 'cms_resolve_override', 'cms_find_usage', 'cms_validate', 'cms_find_theme', 'cms_get_theme', 'cms_contract',
  'cms_agent_organizations', 'cms_open_session', 'cms_check_operation', 'cms_run_operation', 'cms_preview_url', 'cms_site_readiness', 'cms_list_pages', 'cms_get_page', 'cms_block_base',
]
// Remote-only wording: orgId comes from the call (no defaultOrgId), sessions
// are optional, and readiness has no local emd-cms-front check.
const REMOTE_FIELDS = ['orgId', 'sessionId']
const REMOTE_DESCRIPTIONS = ['cms_open_session', 'cms_site_readiness']

const listTools = async (remote) => {
  const server = new McpServer({ name: 'definitions-test', version: '1.0.0' })
  for (const { name, ...definition } of cmsAgentToolDefinitions({ z, operationTypes: CMS_OPERATION_TYPES, contractKinds: ['operations'], remote }))
    server.registerTool(name, definition, async () => ({ content: [] }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'definitions-test', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  return tools
}

test('the three copies of the shared tool definitions are byte-identical', () => {
  const source = readFileSync(new URL('lib/cmsAgentMcpTools.js', edgeRoot), 'utf8')
  assert.equal(readFileSync(new URL('functions/helpers/cmsAgentMcpTools.mjs', edgeRoot), 'utf8'), source)
  const hubCopy = new URL('../functions/helpers/cmsAgentMcpTools.mjs', edgeRoot)
  if (existsSync(hubCopy))
    assert.equal(readFileSync(hubCopy, 'utf8'), source)
  for (const file of ['cmsAgentMcp.js', 'cmsAgentConnections.js', 'cmsAgentKeys.js']) {
    const deployed = new URL(`../functions/${file}`, edgeRoot)
    if (existsSync(deployed))
      assert.equal(readFileSync(deployed, 'utf8'), readFileSync(new URL(`functions/${file}`, edgeRoot), 'utf8'), file)
  }
})

test('the local server keeps every tool in its order; the remote list is the Hub-endpoint subset', async () => {
  assert.deepEqual((await listTools(false)).map(tool => tool.name), LOCAL_TOOLS)
  assert.deepEqual((await listTools(true)).map(tool => tool.name), [...CMS_AGENT_REMOTE_TOOL_NAMES])
  assert.ok(CMS_AGENT_REMOTE_TOOL_NAMES.every(name => LOCAL_TOOLS.includes(name)))
  assert.ok(!CMS_AGENT_REMOTE_TOOL_NAMES.some(name => /^firestore_|checkout|_status$|_diff$/.test(name)), 'no raw Firestore or workspace tools remotely')
})

test('local and remote definitions match for the shared subset', async () => {
  const local = Object.fromEntries((await listTools(false)).map(tool => [tool.name, tool]))
  for (const remote of await listTools(true)) {
    const own = local[remote.name]
    assert.equal(remote.title, own.title, remote.name)
    assert.deepEqual(remote.annotations, own.annotations, remote.name)
    if (!REMOTE_DESCRIPTIONS.includes(remote.name))
      assert.equal(remote.description, own.description, remote.name)
    assert.deepEqual(Object.keys(remote.inputSchema.properties).sort(), Object.keys(own.inputSchema.properties).sort(), remote.name)
    for (const [field, schema] of Object.entries(remote.inputSchema.properties)) {
      if (!REMOTE_FIELDS.includes(field) || remote.name === 'cms_open_session')
        assert.deepEqual(schema, own.inputSchema.properties[field], `${remote.name}.${field}`)
    }
    const required = list => (list || []).filter(field => !REMOTE_FIELDS.includes(field)).sort()
    assert.deepEqual(required(remote.inputSchema.required), required(own.inputSchema.required), remote.name)
  }
})
