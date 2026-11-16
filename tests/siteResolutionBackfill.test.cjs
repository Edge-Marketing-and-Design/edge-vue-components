const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../scripts/backfill-site-resolution.cjs'), 'utf8')
function fixture(env = {}) {
  const calls = []; const messages = []; let deleted = false
  const docs = [{ id: 'one', ref: { path: 'organizations/org/published-site-settings/one' }, data: () => ({}) }]
  const old = [{ id: 'old', data: () => ({ orgId: 'org', siteId: 'old' }) }, { id: 'duplicate', data: () => ({ orgId: 'org', siteId: 'one' }) }]
  const query = values => ({ orderBy() { return this }, limit() { return this }, startAfter() { return this }, async get() { return { docs: values, size: values.length } } })
  const db = {
    collectionGroup(name) { assert.equal(name, 'published-site-settings'); return query(docs) },
    collection(name) { return name === 'topic-queue' ? { async add(value) { calls.push(value) } } : query(old) },
  }
  const admin = { initializeApp(options) { assert.equal(options.projectId, 'test'); return { firestore: () => db, async delete() { deleted = true } } }, firestore: { FieldPath: { documentId: () => '__name__' }, FieldValue: { serverTimestamp: () => 'now' } } }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, require: name => {
    if (name === 'node:path') return path
    if (name === 'node:module') return { createRequire: () => () => admin }
    throw new Error(`Unexpected ${name}`)
  }, process: { env, cwd: () => process.cwd() }, console: { log: value => messages.push(value) }, Set })
  return { run: module.exports.main, calls, messages, deleted: () => deleted }
}
test('backfill dry run scans published sites and prior managed sites without writes', async () => {
  const f = fixture(); await f.run(['--project', 'test'])
  assert.equal(f.calls.length, 0); assert.match(f.messages.at(-1), /2 site/); assert.equal(f.deleted(), true)
})
test('backfill requires an explicit production write flag before loading Admin SDK', async () => {
  const f = fixture(); await assert.rejects(f.run(['--project', 'test', '--apply']), /Production writes/)
  assert.equal(f.calls.length, 0)
})
test('backfill queues one retry operation per unique current or prior site', async () => {
  const f = fixture(); await f.run(['--project', 'test', '--apply', '--production'])
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every(value => value.topic === 'kv-mirror-retry' && value.payload.op === 'reconcileSiteResolution'))
})
test('emulator apply is permitted but production flag with an emulator is rejected', async () => {
  const f = fixture({ FIRESTORE_EMULATOR_HOST: 'localhost:8080' })
  await assert.rejects(f.run(['--project', 'test', '--apply', '--production']), /Refusing/)
  await f.run(['--project', 'test', '--apply']); assert.equal(f.calls.length, 2)
})
