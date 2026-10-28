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
  'cms_find_block', 'cms_audit_blocks', 'cms_checkout_block', 'cms_status', 'cms_diff', 'cms_resolve_override', 'cms_find_usage', 'cms_validate', 'cms_render_block', 'cms_find_theme', 'cms_get_theme', 'cms_contract', 'cms_schema', 'cms_guide',
  'cms_agent_organizations', 'cms_list_sites', 'cms_open_session', 'cms_check_operation', 'cms_run_operation', 'cms_preview_url', 'cms_site_readiness', 'cms_list_pages', 'cms_get_page', 'cms_list_posts', 'cms_get_post', 'cms_block_base',
]
// Remote-only wording: orgId comes from the call (no defaultOrgId), sessions
// are optional, and readiness has no local emd-cms-front check.
const REMOTE_FIELDS = ['orgId', 'sessionId']
const REMOTE_DESCRIPTIONS = ['cms_open_session', 'cms_site_readiness', 'cms_audit_blocks', 'cms_validate', 'cms_contract']
// Local only: operationFile reads a file on the editor's machine, so the
// remote check/run require the inline operation; themeName feeds override
// checks against the emd-cms-front checkout.
const LOCAL_ONLY_FIELDS = ['operationFile', 'themeName']
// Intended per-tool differences. The remote audit only reads and has no
// report file; the remote validate takes an inline definition instead of a
// local checkout.
const TOOL_DIFFERENCES = {
  cms_audit_blocks: { annotations: true, fields: ['listLimit'] },
  cms_validate: { localOnly: ['source'], remoteOnly: ['definition'], fields: ['docId'], required: ['docId'] },
}

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

test('the three copies of the shared tool definitions and library reads are byte-identical', () => {
  for (const name of ['cmsAgentMcpTools', 'cmsAgentReads']) {
    const source = readFileSync(new URL(`lib/${name}.js`, edgeRoot), 'utf8')
    assert.equal(readFileSync(new URL(`functions/helpers/${name}.mjs`, edgeRoot), 'utf8'), source, name)
    const hubCopy = new URL(`../functions/helpers/${name}.mjs`, edgeRoot)
    if (existsSync(hubCopy))
      assert.equal(readFileSync(hubCopy, 'utf8'), source, name)
  }
  for (const file of ['cms.js', 'cmsAgentMcp.js', 'cmsAgentConnections.js', 'cmsAgentKeys.js', 'cmsAgentLibraryReads.js', 'cmsAgentRender.js', 'tests/support/fakeFirestore.cjs']) {
    const deployed = new URL(`../functions/${file}`, edgeRoot)
    if (existsSync(deployed))
      assert.equal(readFileSync(deployed, 'utf8'), readFileSync(new URL(`functions/${file}`, edgeRoot), 'utf8'), file)
  }
})

test('the local server keeps every tool in its order; the remote list is the Hub-endpoint subset', async () => {
  assert.deepEqual((await listTools(false)).map(tool => tool.name), LOCAL_TOOLS)
  assert.deepEqual((await listTools(true)).map(tool => tool.name), [...CMS_AGENT_REMOTE_TOOL_NAMES])
  assert.ok(CMS_AGENT_REMOTE_TOOL_NAMES.every(name => LOCAL_TOOLS.includes(name)))
  assert.ok(!CMS_AGENT_REMOTE_TOOL_NAMES.some(name => /^firestore_|checkout|_status$|_diff$|_resolve_override$/.test(name)), 'no raw Firestore, workspace or renderer-checkout tools remotely')
})

test('local and remote definitions match for the shared subset', async () => {
  const local = Object.fromEntries((await listTools(false)).map(tool => [tool.name, tool]))
  for (const remote of await listTools(true)) {
    const own = local[remote.name]
    const differs = TOOL_DIFFERENCES[remote.name] || {}
    assert.equal(remote.title, own.title, remote.name)
    if (differs.annotations)
      assert.equal(remote.annotations.readOnlyHint, true, remote.name)
    else
      assert.deepEqual(remote.annotations, own.annotations, remote.name)
    if (!REMOTE_DESCRIPTIONS.includes(remote.name))
      assert.equal(remote.description, own.description, remote.name)
    const localOnly = [...LOCAL_ONLY_FIELDS, ...(differs.localOnly || [])]
    assert.deepEqual(
      Object.keys(remote.inputSchema.properties).filter(field => !(differs.remoteOnly || []).includes(field)).sort(),
      Object.keys(own.inputSchema.properties).filter(field => !localOnly.includes(field)).sort(),
      remote.name,
    )
    for (const [field, schema] of Object.entries(remote.inputSchema.properties)) {
      if ((differs.fields || []).includes(field) || (differs.remoteOnly || []).includes(field))
        continue
      if (!REMOTE_FIELDS.includes(field) || remote.name === 'cms_open_session')
        assert.deepEqual(schema, own.inputSchema.properties[field], `${remote.name}.${field}`)
    }
    const ignored = [...REMOTE_FIELDS, 'operation', ...(differs.required || [])]
    const required = list => (list || []).filter(field => !ignored.includes(field)).sort()
    assert.deepEqual(required(remote.inputSchema.required), required(own.inputSchema.required), remote.name)
  }
})

test('operationFile is local only; the remote check and run require the inline operation', async () => {
  const local = Object.fromEntries((await listTools(false)).map(tool => [tool.name, tool]))
  const remote = Object.fromEntries((await listTools(true)).map(tool => [tool.name, tool]))
  for (const name of ['cms_check_operation', 'cms_run_operation']) {
    assert.ok(local[name].inputSchema.properties.operationFile, name)
    assert.ok(!(local[name].inputSchema.required || []).includes('operation'), name)
    assert.equal(remote[name].inputSchema.properties.operationFile, undefined, name)
    assert.ok(remote[name].inputSchema.required.includes('operation'), name)
  }
})

test('the guide and contracts the servers serve are well formed', async () => {
  const { describeContract, selectGuideSection } = await import('../../../../lib/cmsAgentMcpTools.js')
  const guide = readFileSync(new URL('functions/agentGuide/cms-agent-guide.md', edgeRoot), 'utf8')
  const whole = selectGuideSection(guide)
  assert.ok(whole.sections.includes('Rules') && whole.sections.length >= 5, whole.sections.join(', '))
  for (const name of whole.sections) {
    const part = selectGuideSection(guide, name.toUpperCase())
    assert.equal(part.ok, true, name)
    assert.ok(part.markdown.startsWith(`## ${name}`), name)
    assert.ok(!part.markdown.slice(3).includes('\n## '), `${name} holds one section`)
  }
  assert.equal(selectGuideSection(guide, 'nope').code, 'unknown-section')
  // Every tool the guide names exists locally.
  const local = (await listTools(false)).map(tool => tool.name)
  for (const [name] of guide.matchAll(/\bcms_[a-z_]+\b/g))
    assert.ok(local.includes(name), `the guide names an unknown tool: ${name}`)
  const contract = describeContract('k', 'p.md', '# Title here\n\nLast verified: 2026-10-27\n')
  assert.deepEqual([contract.title, contract.lastVerified], ['Title here', '2026-10-27'])
})
