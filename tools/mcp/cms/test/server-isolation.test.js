import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('the MCP rejects tenant escapes before database reads or agent requests', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cms-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configFile = path.join(root, 'config.json')
  await writeFile(configFile, JSON.stringify({
    projectId: 'demo-cms-isolation',
    environment: 'emulator',
    requireEmulator: true,
    defaultOrgId: 'other',
    allowedOrganizationIds: ['allowed'],
    allowedPathPrefixes: ['organizations'],
    collectionAliases: { '@blocks': 'organizations/{orgId}/blocks' },
    credentialsFile: path.join(root, 'absent-credentials.json'),
    agentEndpoint: 'http://127.0.0.1:1/never-requested',
  }))
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('EDGE_CMS_') || key.startsWith('CLEARWATER_') || key === 'GOOGLE_APPLICATION_CREDENTIALS')
      delete env[key]
  }
  Object.assign(env, { EDGE_CMS_MCP_CONFIG: configFile, FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' })
  const client = new Client({ name: 'tenant-isolation-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.js', import.meta.url))],
    env,
    stderr: 'pipe',
  })
  t.after(() => client.close())
  await client.connect(transport)
  for (const [name, args] of [
    ['cms_find_block', { orgId: 'other' }],
    ['cms_find_theme', { orgId: 'other' }],
    ['cms_block_base', { orgId: 'other', docId: 'hero' }],
    ['cms_find_block', {}],
    ['cms_preview_url', { orgId: 'other', siteId: 'site', pageId: 'home' }],
    ['cms_site_readiness', { orgId: 'other', siteId: 'site' }],
    ['cms_check_operation', { orgId: 'other', operation: { type: 'page.setValues' } }],
    ['cms_run_operation', { orgId: 'other', operation: { type: 'page.setValues' }, checksum: 'test' }],
    ['firestore_get_document', { documentPath: 'organizations/other/blocks/hero' }],
    ['firestore_get_document', { documentPath: '@blocks/hero' }],
  ]) {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, true, name)
    assert.match(result.content[0].text, /outside allowedOrganizationIds/, name)
  }
  for (const [name, args] of [
    ['firestore_list_collections', {}],
    ['firestore_sample_collection', { collectionPath: 'organizations' }],
  ]) {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, true, name)
    assert.match(result.content[0].text, /unavailable with an organization allowlist/, name)
  }
})
