import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { configureCmsPreview, checkSettings, addDeployCheck } = require('../../scripts/configure-cms-preview.cjs')
const { readValue } = require('../../scripts/configure-cms-frontend.cjs')
const deploy = '#!/bin/sh\nset -eu\nexport NODE_ENV=production\nfirebase deploy --only functions\nfirebase deploy --only hosting\n'

function fixture(t, settings = '') {
  const root = mkdtempSync(join(tmpdir(), 'cms-preview-setup-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'functions'))
  writeFileSync(join(root, 'functions/.env.prod'), settings)
  writeFileSync(join(root, 'deploy.sh'), deploy)
  return root
}

test('generates a stable unique secret per Hub and uses the Hub URL, not renderer URL', async (t) => {
  const secrets = []
  for (let index = 0; index < 2; index++) {
    const root = fixture(t, 'OTHER=keep\n')
    writeFileSync(join(root, '.env'), 'NUXT_PUBLIC_APP_URL=https://hub.example\nNUXT_PUBLIC_CMS_FRONTEND_URL=https://renderer.example\n')
    const result = await configureCmsPreview(root, { env: {} })
    const first = readFileSync(join(root, 'functions/.env.prod'), 'utf8')
    const secret = readValue(first, 'CMS_PREVIEW_TOKEN_SECRET')
    assert.match(secret, /^[a-f0-9]{64}$/)
    assert.equal(readValue(first, 'CMS_PREVIEW_RENDER_BASE_URL'), 'https://hub.example')
    assert.ok(first.startsWith('OTHER=keep\n'))
    assert.ok(!JSON.stringify(result).includes(secret))
    await configureCmsPreview(root, { env: {}, prompt: async () => assert.fail('unexpected prompt') })
    assert.equal(readFileSync(join(root, 'functions/.env.prod'), 'utf8'), first)
    secrets.push(secret)
  }
  assert.notEqual(secrets[0], secrets[1])
})

test('preserves existing preview credentials and origin byte-for-byte', async (t) => {
  const original = `CMS_PREVIEW_TOKEN_SECRET="${'x'.repeat(40)}"\nCMS_PREVIEW_RENDER_BASE_URL=https://existing.example/\n`
  const root = fixture(t, original)
  writeFileSync(join(root, '.env'), 'NUXT_PUBLIC_APP_URL=https://different.example\n')
  await configureCmsPreview(root, { env: {}, prompt: async () => assert.fail('unexpected prompt') })
  assert.equal(readFileSync(join(root, 'functions/.env.prod'), 'utf8'), original)
})

test('asks only for a missing Hub URL and generates the secret automatically', async (t) => {
  const root = fixture(t, 'CMS_PREVIEW_TOKEN_SECRET=\nCMS_PREVIEW_RENDER_BASE_URL=""\nKEEP=yes\n')
  let prompts = 0
  await configureCmsPreview(root, { env: {}, prompt: async () => { prompts++; return 'https://new-hub.example/' } })
  const settings = readFileSync(join(root, 'functions/.env.prod'), 'utf8')
  assert.equal(prompts, 1)
  assert.match(readValue(settings, 'CMS_PREVIEW_TOKEN_SECRET'), /^[a-f0-9]{64}$/)
  assert.equal(readValue(settings, 'CMS_PREVIEW_RENDER_BASE_URL'), 'https://new-hub.example')
  assert.ok(settings.includes('KEEP=yes\n'))
})

test('invalid existing secret is not silently rotated', async (t) => {
  const root = fixture(t, 'CMS_PREVIEW_TOKEN_SECRET=short\nCMS_PREVIEW_RENDER_BASE_URL=https://hub.example\n')
  const original = readFileSync(join(root, 'functions/.env.prod'), 'utf8')
  await assert.rejects(configureCmsPreview(root, { env: {} }), /at least 32/)
  assert.equal(readFileSync(join(root, 'functions/.env.prod'), 'utf8'), original)
  assert.equal(readFileSync(join(root, 'deploy.sh'), 'utf8'), deploy)
})

test('invalid URL and unrecognized deploy command fail without partial file changes', async (t) => {
  const root = fixture(t, 'KEEP=yes\n')
  await assert.rejects(configureCmsPreview(root, { env: {}, prompt: async () => 'https://hub.example/a-page' }), /Hub origin/)
  assert.equal(readFileSync(join(root, 'functions/.env.prod'), 'utf8'), 'KEEP=yes\n')
  writeFileSync(join(root, 'deploy.sh'), '#!/bin/sh\necho custom deploy\n')
  await assert.rejects(configureCmsPreview(root, { env: {}, prompt: async () => 'https://hub.example' }), /locate the Functions deploy/)
  assert.equal(readFileSync(join(root, 'functions/.env.prod'), 'utf8'), 'KEEP=yes\n')
})

test('deploy check is inserted once before the Functions deployment', () => {
  const migrated = addDeployCheck(deploy)
  assert.equal(addDeployCheck(migrated), migrated)
  assert.ok(migrated.indexOf('--check') < migrated.indexOf('firebase deploy --only functions'))
  assert.ok(addDeployCheck('firebase deploy --only "functions,hosting"\n').includes('--check'))
})

test('check validates missing settings and never reveals secret values', (t) => {
  const root = fixture(t)
  const script = new URL('../../scripts/configure-cms-preview.cjs', import.meta.url).pathname
  const env = { ...process.env }
  delete env.CMS_PREVIEW_TOKEN_SECRET
  delete env.CMS_PREVIEW_RENDER_BASE_URL
  const failed = spawnSync(process.execPath, [script, '--check', root], { env, encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /CMS_PREVIEW_TOKEN_SECRET/)
  const secret = 'private-test-key-not-to-print-'.repeat(3)
  writeFileSync(join(root, 'functions/.env.prod'), `CMS_PREVIEW_TOKEN_SECRET=${secret}\nCMS_PREVIEW_RENDER_BASE_URL=https://hub.example\n`)
  const passed = spawnSync(process.execPath, [script, '--check', root], { env, encoding: 'utf8' })
  assert.equal(passed.status, 0)
  assert.ok(!`${passed.stdout}${passed.stderr}`.includes(secret))
  assert.throws(() => checkSettings(`CMS_PREVIEW_TOKEN_SECRET=${secret}\nCMS_PREVIEW_RENDER_BASE_URL=https://user:pass@example.com\n`), /Hub origin/)
})

test('missing production file is created and shared updater calls setup', async (t) => {
  const root = fixture(t)
  rmSync(join(root, 'functions/.env.prod'))
  await configureCmsPreview(root, { env: {}, prompt: async () => 'https://hub.example' })
  assert.equal(existsSync(join(root, 'functions/.env.prod')), true)
  const updater = readFileSync(new URL('../../edge-update-all.sh', import.meta.url), 'utf8')
  assert.ok(updater.includes('node "$PROJECT_ROOT/edge/scripts/configure-cms-preview.cjs" "$PROJECT_ROOT"'))
  const deployment = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
  assert.ok(deployment.indexOf('configure-cms-preview.cjs') < deployment.lastIndexOf('deploy_selected_functions'))
})


test('shared entrypoint owns its preview guard; setup never rewrites it or legacy launcher', async t => {
  const root = fixture(t)
  mkdirSync(join(root, 'edge'))
  const shared = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
  writeFileSync(join(root, 'edge/deploy.sh'), shared)
  await configureCmsPreview(root, { env: {}, prompt: async () => 'https://hub.example' })
  assert.equal(readFileSync(join(root, 'edge/deploy.sh'), 'utf8'), shared)
  assert.equal(readFileSync(join(root, 'deploy.sh'), 'utf8'), deploy)
  rmSync(join(root, 'deploy.sh'))
  await configureCmsPreview(root, { env: {}, prompt: async () => assert.fail('unexpected prompt') })
  assert.equal(existsSync(join(root, 'deploy.sh')), false)
})
