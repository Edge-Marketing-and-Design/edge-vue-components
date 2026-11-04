import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { checkoutNotice, parseCheckoutStatus, withCheckoutNotice } from '../src/checkout-status.js'

const behindHub = { hub: { state: 'behind', branch: 'claude/feature', behind: 7, detail: 'on claude/feature, not main: left as it is' }, renderer: { state: 'current', branch: 'main', behind: 0 }, dependencies: 'current', checkedAt: '2026-11-04T20:00:00Z' }

test('no status, unreadable status and current checkouts give no notice', () => {
  assert.equal(parseCheckoutStatus(''), null)
  assert.equal(parseCheckoutStatus('{nope'), null)
  assert.equal(checkoutNotice(null), null)
  assert.equal(checkoutNotice({ hub: { state: 'current' }, renderer: { state: 'updated' }, dependencies: 'installed' }), null)
  assert.equal(checkoutNotice({ hub: { state: 'unchecked' }, renderer: { state: 'missing' } }), null)
})

test('a Hub branch behind main names the branch and the commit count', () => {
  const notice = checkoutNotice(parseCheckoutStatus(JSON.stringify(behindHub)))
  assert.match(notice.message, /^The Hub checkout \(branch claude\/feature\) is 7 commits behind origin\/main/)
  assert.match(notice.message, /restart the server/)
  assert.equal(notice.hub.behind, 7)
})

test('the renderer and a failed install are reported too', () => {
  const notice = checkoutNotice({ hub: { state: 'current' }, renderer: { state: 'behind', branch: 'main', behind: 1, detail: 'main has local changes: left as it is' }, dependencies: 'install-failed' })
  assert.match(notice.message, /The emd-cms-front checkout \(main\) is 1 commit behind origin\/main \(main has local changes/)
  assert.match(notice.message, /npm ci for the CMS MCP failed/)
})

test('withCheckoutNotice adds the notice first and leaves other results alone', () => {
  const notice = checkoutNotice(behindHub)
  assert.deepEqual(Object.keys(withCheckoutNotice({ ok: true }, notice)), ['checkoutNotice', 'ok'])
  assert.deepEqual(withCheckoutNotice({ ok: true }, null), { ok: true })
})

// The running server: cms_guide, cms_contract and cms_agent_organizations
// carry the notice; other tools don't.
async function startServer(t, status) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cms-checkout-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configFile = path.join(root, 'config.json')
  await writeFile(configFile, JSON.stringify({ projectId: 'demo-checkout-status', environment: 'emulator', requireEmulator: true, defaultOrgId: 'org', agentEndpoint: 'http://127.0.0.1:1/never-requested' }))
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('EDGE_CMS_') || key.startsWith('CLEARWATER_') || key === 'GOOGLE_APPLICATION_CREDENTIALS')
      delete env[key]
  }
  Object.assign(env, { EDGE_CMS_MCP_CONFIG: configFile, FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', ...(status ? { EDGE_CMS_CHECKOUT_STATUS: JSON.stringify(status) } : {}) })
  const client = new Client({ name: 'checkout-status-test', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.js', import.meta.url))], env, stderr: 'pipe' })
  t.after(() => client.close())
  await client.connect(transport)
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text)
  return call
}

test('a server started behind main reports it in cms_guide, cms_contract and cms_agent_organizations', async (t) => {
  const call = await startServer(t, behindHub)
  for (const [name, args] of [['cms_guide', { section: 'Rules' }], ['cms_contract', { kind: 'blocks', section: 'Fields' }], ['cms_agent_organizations', {}]]) {
    const result = await call(name, args)
    assert.match(result.checkoutNotice?.message || '', /7 commits behind origin\/main/, name)
  }
  const validate = await call('cms_resolve_override', { blockName: 'Hero' })
  assert.equal(validate.checkoutNotice, undefined)
})

test('a current server adds no notice', async (t) => {
  const call = await startServer(t, { hub: { state: 'current' }, renderer: { state: 'current' } })
  assert.equal((await call('cms_guide', { section: 'Rules' })).checkoutNotice, undefined)
})
