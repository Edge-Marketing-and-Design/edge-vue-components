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
    ['cms_list_pages', { orgId: 'other', siteId: 'site' }],
    ['cms_get_page', { orgId: 'other', siteId: 'site', pageId: 'home' }],
    ['cms_check_operation', { orgId: 'other', operation: { type: 'page.setValues' } }],
    ['cms_run_operation', { orgId: 'other', operation: { type: 'page.setValues' }, checksum: 'test' }],
    ['cms_check_operation', { orgId: 'other', operationFile: '/etc/hosts.json' }],
    ['firestore_get_document', { documentPath: 'organizations/other/blocks/hero' }],
    ['firestore_get_document', { documentPath: '@blocks/hero' }],
  ]) {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, true, name)
    assert.match(result.content[0].text, /outside allowedOrganizationIds/, name)
  }
  for (const [args, code] of [
    [{ orgId: 'allowed' }, 'operation-input'],
    [{ orgId: 'allowed', operation: { type: 'page.setValues' }, operationFile: 'op.json' }, 'operation-input'],
    [{ orgId: 'allowed', operationFile: '/etc/hosts' }, 'operation-file-invalid'],
    [{ orgId: 'allowed', operationFile: 'absent-operation.json' }, 'operation-file-missing'],
  ]) {
    const result = await client.callTool({ name: 'cms_check_operation', arguments: args })
    assert.equal(JSON.parse(result.content[0].text).code, code, JSON.stringify(args))
  }
  const operationFile = path.join(root, 'operation.json')
  await writeFile(operationFile, JSON.stringify({ type: 'page.setValues', siteId: 'site', pageId: 'home', instanceId: 'a', values: {} }))
  const fromFile = JSON.parse((await client.callTool({ name: 'cms_check_operation', arguments: { orgId: 'allowed', operationFile } })).content[0].text)
  assert.equal(fromFile.code, 'no-agent-key')
  assert.match(fromFile.operationFile.path, /operation\.json$/)
  assert.match(fromFile.operationFile.sha256, /^[0-9a-f]{64}$/)
  for (const [name, args] of [
    ['firestore_list_collections', {}],
    ['firestore_sample_collection', { collectionPath: 'organizations' }],
  ]) {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, true, name)
    assert.match(result.content[0].text, /unavailable with an organization allowlist/, name)
  }
})
