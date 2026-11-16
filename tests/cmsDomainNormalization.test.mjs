import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'acorn'
import { normalizeSiteDomainSettings } from '../lib/cmsOperations.js'

const require = createRequire(import.meta.url)
const { normalizeStoredSiteDomains } = require('../../functions/helpers/cmsDomainConnection.js')
const { createFakeDb } = require('../../functions/tests/support/fakeFirestore.cjs')

test('www aliases, case, whitespace and trailing dots collapse to one base domain', () => {
  for (const domains of [['www.example.com'], ['example.com', 'www.example.com'], [' WWW.Example.COM. ', 'example.com', 'www.example.com']])
    assert.deepEqual(normalizeSiteDomainSettings({ domains }), { domains: ['example.com'] })
})

test('other subdomains and order are preserved; normalization is idempotent', () => {
  const input = { domains: ['www.example.com', 'homes.example.com', 'www.homes.example.com', 'other.example.com'], canonicalDomain: 'WWW.HOMES.EXAMPLE.COM.' }
  const result = normalizeSiteDomainSettings(input)
  assert.deepEqual(result, { domains: ['example.com', 'homes.example.com', 'other.example.com'], canonicalDomain: 'homes.example.com' })
  assert.deepEqual(normalizeSiteDomainSettings(result), result)
  assert.equal(input.canonicalDomain, 'WWW.HOMES.EXAMPLE.COM.')
})

test('no-forward remains blank and an absent canonical preference is not introduced', () => {
  assert.deepEqual(normalizeSiteDomainSettings({ domains: ['www.example.com'], canonicalDomain: '' }), { domains: ['example.com'], canonicalDomain: '' })
  assert.equal(Object.hasOwn(normalizeSiteDomainSettings({ domains: ['www.example.com'] }), 'canonicalDomain'), false)
})

test('backend normalization reads current state, preserves content and stops writing after normalization', async () => {
  const path = 'organizations/org/sites/site'
  const f = createFakeDb({ [path]: { name: 'Site', domains: ['www.example.com', 'example.com'], canonicalDomain: 'www.example.com', forwardApex: false, users: ['user'] } })
  const ref = f.db.collection('organizations/org/sites').doc('site')
  assert.equal(await normalizeStoredSiteDomains({ db: f.db, ref, normalize: normalizeSiteDomainSettings }), true)
  assert.deepEqual(f.docs.get(path), { name: 'Site', domains: ['example.com'], canonicalDomain: 'example.com', forwardApex: false, users: ['user'] })
  assert.equal(await normalizeStoredSiteDomains({ db: f.db, ref, normalize: normalizeSiteDomainSettings }), false)
  assert.equal(f.writes.length, 1)
  f.docs.set(path, { domainError: 'Telemetry only' })
  assert.equal(await normalizeStoredSiteDomains({ db: f.db, ref, normalize: normalizeSiteDomainSettings }), false)
  f.docs.delete(path)
  assert.equal(await normalizeStoredSiteDomains({ db: f.db, ref, normalize: normalizeSiteDomainSettings }), false)
  assert.equal(f.docs.has(path), false)
})

const page = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const script = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module' })
const saveNode = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'saveSiteSettingsDocument'))

test('UI saves normalized data and returns the same normalized editor baseline', async () => {
  const calls = []
  const save = runInNewContext(`${script.slice(saveNode.start, saveNode.end)};saveSiteSettingsDocument`, {
    normalizeSiteDomainSettings,
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    edgeFirebase: { storeDoc: async (path, doc) => { calls.push({ path, doc }); return { success: true, meta: { docId: 'site' } } } },
  })
  const result = await save({ domains: ['www.example.com', 'example.com'], canonicalDomain: 'www.example.com', name: 'Site' })
  assert.deepEqual(Array.from(calls[0].doc.domains), ['example.com'])
  assert.equal(calls[0].path, 'organizations/org/sites')
  assert.equal(result.data.docId, 'site')
  assert.equal(result.data.canonicalDomain, 'example.com')
  assert.deepEqual(Array.from(result.data.domains), ['example.com'])
  assert.equal((page.match(/:save-handler="saveSiteSettingsDocument"/g) || []).length, 2)
})

test('failed normalized saves remain failures', async () => {
  const save = runInNewContext(`${script.slice(saveNode.start, saveNode.end)};saveSiteSettingsDocument`, {
    normalizeSiteDomainSettings,
    edgeGlobal: { edgeState: { organizationDocPath: 'organizations/org' } },
    edgeFirebase: { storeDoc: async () => ({ success: false, message: 'Denied' }) },
  })
  await assert.rejects(save({ domains: ['www.example.com'] }), /Denied/)
})
