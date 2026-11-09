const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { VERSION, buildInventory, makePlan, fingerprintAtVersion } = require('../../scripts/function-deploy-plan.cjs')
const { recoverBaselines } = require('../../scripts/function-deploy-baseline.cjs')

function fixture(t, version = 2, withRetiredEnv = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-baseline-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content) }
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '--quiet'])
  const commit = () => { git(['add', '.']); git(['-c', 'user.name=Deployment Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']); return git(['rev-parse', 'HEAD']) }
  write('functions/index.js', "exports.alpha = require('./alpha'); exports.beta = require('./beta')")
  const source = 'exports.one = onCall(() => 1); exports.other = onCall(() => 2)'
  write('functions/alpha.js', source)
  write('functions/beta.js', 'exports.two = onCall(() => 3)')
  write('functions/package.json', '{"engines":{"node":"22"}}')
  write('firebase.json', '{}')
  if (withRetiredEnv) write('package.json', JSON.stringify({ edgeDeploy: { retiredEnvironmentKeys: ['CLEARWATER_URL'] } }))
  if (withRetiredEnv) write('functions/.env.prod', 'CLEARWATER_URL=https://retired.example.test\n')
  const oldRevision = commit()
  const endpoints = Object.fromEntries(['alpha-one', 'alpha-other', 'beta-two'].map(name => [name, { entryPoint: name.replace('-', '.'), platform: 'gcfv2', region: ['us-central1'], callableTrigger: {} }]))
  const old = buildInventory(root, endpoints, {}).inventory
  const archive = { sha256: 'b'.repeat(64), files: ['index.js', 'alpha.js', 'beta.js', 'package.json', ...(withRetiredEnv ? ['.env.prod'] : [])].map(file => ({ path: file, mode: 0o644, content: fs.readFileSync(path.join(root, 'functions', file)) })) }
  const cloud = { describeSource: async () => ({ bucket: 'test-source', object: 'function-source.zip', generation: '1', md5Hash: 'same-archive', size: '100' }), readSource: async () => archive }
  const keyFor = item => fingerprintAtVersion(item, version)
  const state = { version, projectId: 'test-project', functions: Object.fromEntries(Object.entries(old).map(([key, item]) => [key, { fingerprint: keyFor(item), remoteUpdateTime: 'deployed-1', deployedAt: 'original-date' }])) }
  const remote = Object.fromEntries(Object.keys(old).map(key => [key, { state: 'ACTIVE', updateTime: 'deployed-1' }]))
  write('functions/new-helper.js', 'exports.value = () => 4')
  write('functions/alpha.js', "const {value} = require('./new-helper'); exports.one = onCall(() => value()); exports.other = onCall(() => 2)")
  commit()
  const inventory = () => buildInventory(root, endpoints, {}).inventory
  const recover = options => recoverBaselines({ root, endpoints, environment: {}, inventory: inventory(), state, remote, cloud, ...options })
  const plan = baselines => makePlan({ projectId: 'test-project', inventory: inventory(), state, remote, baselines, requireSourceProof: true })
  return { root, write, commit, oldRevision, state, remote, inventory, recover, plan, endpoints, git }
}

for (const version of [1, 2, 3, 4, 5, 6, 7]) test(`v${version} recovery proves old source before skipping unchanged siblings`, async t => {
  const f = fixture(t, version)
  assert.ok(f.plan().selectedNames.includes('alpha-other'))
  const before = JSON.stringify(f.state)
  const baselines = await f.recover()
  const plan = f.plan(baselines)
  assert.deepEqual(plan.selectedNames, ['alpha-one'])
  assert.equal(baselines['us-central1/alpha-other'].sourceArchive.sha256, 'b'.repeat(64))
  assert.equal(plan.baselineUpgrades.length, 2)
  assert.equal(Object.keys(plan.baselineConversions).length, 3)
  assert.equal(JSON.stringify(f.state), before, 'recovery does not mutate saved state')
  assert.equal(f.git(['status', '--porcelain']), '', 'historical comparison never edits the checkout')
})
test('an incorrect old fingerprint is never accepted as a handler baseline', async t => {
  const f = fixture(t)
  f.state.functions['us-central1/alpha-other'].fingerprint = 'unknown-old-source'
  const baselines = await f.recover()
  assert.equal(baselines['us-central1/alpha-other'], undefined)
  assert.deepEqual(f.plan(baselines).selectedNames, ['alpha-one', 'alpha-other'])
})
test('remote drift or a non-ACTIVE function prevents historical recovery and skipping', async t => {
  const f = fixture(t)
  f.remote['us-central1/alpha-other'].updateTime = 'external-change'
  f.remote['us-central1/alpha-one'].state = 'FAILED'
  const baselines = await f.recover()
  assert.equal(baselines['us-central1/alpha-other'], undefined)
  assert.equal(baselines['us-central1/alpha-one'], undefined)
  assert.deepEqual(f.plan(baselines).selectedNames, ['alpha-one', 'alpha-other'])
})
test('changed repo-level production configuration cannot be used to manufacture legacy proof', async t => {
  const f = fixture(t)
  f.write('firebase.json', '{"changed":true}')
  assert.deepEqual(await f.recover(), {})
  assert.deepEqual(f.plan({}).selectedNames, ['alpha-one', 'alpha-other', 'beta-two'])
})
test('new callables remain selected while known legacy siblings recover', async t => {
  const f = fixture(t)
  f.endpoints['alpha-new'] = { ...f.endpoints['alpha-one'], entryPoint: 'alpha.new' }
  fs.appendFileSync(path.join(f.root, 'functions/alpha.js'), '; exports.new = onCall(() => 5)')
  f.commit()
  const plan = f.plan(await f.recover())
  assert.deepEqual(plan.selectedNames, ['alpha-new', 'alpha-one'])
  assert.ok(plan.selectionReasons['us-central1/alpha-new'].includes('no successful checkpoint'))
})
test('failed proof metadata cannot override a checkpoint comparison', async t => {
  const f = fixture(t)
  const baselines = await f.recover()
  baselines['us-central1/alpha-other'].legacyFingerprint = 'wrong-proof'
  assert.deepEqual(f.plan(baselines).selectedNames, ['alpha-one', 'alpha-other'])
})
test('source recovery remains portable without Git history', async t => {
  const f = fixture(t)
  fs.rmSync(path.join(f.root, '.git'), { recursive: true, force: true })
  assert.deepEqual(f.plan(await f.recover()).selectedNames, ['alpha-one'])
})

for (const version of [5, 6, 7]) test(`retiring CLEARWATER_URL preserves source proof for v${version} checkpoints`, async t => {
  const f = fixture(t, version, true)
  const original = JSON.stringify(f.state)
  f.write('functions/.env.prod', '')
  const baselines = await f.recover()
  assert.equal(Object.keys(baselines).length, 3)
  assert.deepEqual(f.plan(baselines).selectedNames, ['alpha-one'])
  assert.equal(JSON.stringify(f.state), original)
})
