const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { VERSION, buildInventory, makePlan } = require('../../scripts/function-deploy-plan.cjs')
const { deployFunctions, firebaseBatchArgs } = require('../../scripts/deploy-functions.cjs')
const { DeployCloud } = require('../../scripts/function-deploy-cloud.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-function-plan-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), value) }
  write('functions/index.js', "exports.alpha = require('./alpha'); exports.beta = require('./beta')")
  write('functions/alpha.js', "const shared = require('./shared'); const x = require('./alpha-helper'); exports.one = onCall(() => x)")
  write('functions/beta.js', "const shared = require('./shared'); exports.two = onSchedule(() => {})")
  write('functions/shared.js', 'module.exports = 1')
  write('functions/alpha-helper.js', 'module.exports = 1')
  write('functions/package.json', '{"engines":{"node":"22"}}')
  write('functions/.env.prod', 'FOO=secret-test-value')
  const endpoints = {
    'alpha-one': { entryPoint: 'alpha.one', platform: 'gcfv2', region: ['us-central1'], callableTrigger: {} },
    'beta-two': { entryPoint: 'beta.two', platform: 'gcfv2', region: ['us-west1'], scheduleTrigger: {} },
  }
  const inventory = () => buildInventory(root, endpoints, {}).inventory
  const initial = inventory()
  const remote = Object.fromEntries(Object.keys(initial).map(key => [key, { state: 'ACTIVE', updateTime: 'deployed-1' }]))
  const state = { version: VERSION, projectId: 'test-project', functions: Object.fromEntries(Object.entries(initial).map(([key, item]) => [key, { fingerprint: item.fingerprint, remoteUpdateTime: 'deployed-1' }])) }
  const plan = options => makePlan({ projectId: 'test-project', inventory: inventory(), state, remote, ...options })
  return { root, write, endpoints, inventory, initial, remote, state, plan }
}

test('frontend/test-only changes skip Functions and do not expose env values', t => {
  const f = fixture(t)
  f.write('edge/component.vue', '<div>changed</div>')
  f.write('functions/tests/new.test.js', 'throw new Error("test only")')
  assert.deepEqual(f.plan().selectedNames, [])
  assert.ok(!JSON.stringify(f.initial).includes('secret-test-value'))
})
test('transitive helper changes select only their owning namespace', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', 'module.exports = 2')
  assert.deepEqual(f.plan().selectedNames, ['alpha-one'])
})
test('emulator logs, local env and macOS metadata never select Functions', t => {
  const f = fixture(t)
  for (const name of ['firestore-debug.log', 'pubsub-debug.log', 'pglite-debug.log', 'database-debug.log', 'storage-debug.log', 'ui-debug.log', '.env.local', '.DS_Store']) {
    f.write(`functions/${name}`, 'first local-only contents')
    assert.deepEqual(f.plan().selectedNames, [], name)
    f.write(`functions/${name}`, 'different local-only contents')
    assert.deepEqual(f.plan().selectedNames, [], name)
  }
})
test('read/write permission differences between developers do not invalidate fingerprints', t => {
  const f = fixture(t)
  f.write('functions/logo.png', 'same image')
  fs.chmodSync(path.join(f.root, 'functions/logo.png'), 0o600)
  fs.chmodSync(path.join(f.root, 'functions/alpha-helper.js'), 0o600)
  const baseline = f.inventory()
  fs.chmodSync(path.join(f.root, 'functions/logo.png'), 0o644)
  fs.chmodSync(path.join(f.root, 'functions/alpha-helper.js'), 0o664)
  const current = f.inventory()
  for (const key of Object.keys(current)) assert.equal(current[key].fingerprint, baseline[key].fingerprint)
  // Executable bits still matter to deployed runtime assets/scripts.
  fs.chmodSync(path.join(f.root, 'functions/alpha-helper.js'), 0o755)
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
})
test('legacy hashes stay reproducible, but their volatile differences do not affect v2', t => {
  const f = fixture(t)
  f.write('functions/firestore-debug.log', 'before')
  const before = f.inventory()
  f.write('functions/firestore-debug.log', 'after')
  const after = f.inventory()
  for (const key of Object.keys(after)) {
    assert.equal(before[key].fingerprint, after[key].fingerprint)
    assert.notEqual(before[key].legacyFingerprint, after[key].legacyFingerprint)
  }
})
test('matching v1 state upgrades without redeploy, mismatches and drift remain selected', t => {
  const f = fixture(t)
  f.state.version = 1
  for (const [key, item] of Object.entries(f.initial)) f.state.functions[key].fingerprint = item.legacyFingerprint
  assert.deepEqual(f.plan().selectedNames, [])
  assert.equal(f.plan().baselineUpgrades.length, 2)
  f.write('functions/alpha-helper.js', 'module.exports = 2')
  assert.deepEqual(f.plan().selectedNames, ['alpha-one'])
  assert.deepEqual(f.plan().selectionReasons['us-central1/alpha-one'], ['legacy fingerprint changed'])
  f.remote['us-west1/beta-two'].updateTime = 'external-deploy'
  assert.deepEqual(f.plan().selectedNames, ['alpha-one', 'beta-two'])
  assert.equal(f.plan().baselineUpgrades.length, 0)
})
test('shared initialization, package, env and asset changes select both groups', t => {
  for (const [name, value] of [
    ['functions/shared.js', 'global.sharedSetting = 2; module.exports = 2'], ['functions/package.json', '{"engines":{"node":"24"}}'],
    ['functions/.env.prod', 'FOO=changed'], ['functions/view.html', '<p>New</p>'],
  ]) {
    const f = fixture(t)
    f.write(name, value)
    assert.deepEqual(f.plan().selectedNames, ['alpha-one', 'beta-two'], name)
  }
})
test('Markdown read through a __dirname path selects only its reader', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "const path = require('node:path'); const guide = path.join(__dirname, 'guide', 'a.md'); const dir = path.join(__dirname, 'contracts')")
  f.write('functions/guide/a.md', '# A')
  f.write('functions/contracts/posts.md', '# Posts')
  f.write('functions/README.md', '# Docs')
  const baseline = f.inventory()
  const changed = name => {
    f.write(name, `# ${name} changed`)
    return Object.keys(baseline).filter(key => baseline[key].fingerprint !== f.inventory()[key].fingerprint)
  }
  assert.deepEqual(changed('functions/README.md'), [])
  assert.deepEqual(changed('functions/guide/a.md'), ['us-central1/alpha-one'])
  f.write('functions/guide/a.md', '# A')
  assert.deepEqual(changed('functions/contracts/posts.md'), ['us-central1/alpha-one'])
})
test('literal dynamic import, cycles and JSON dependencies are fingerprinted', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "import('./deep.mjs'); require('./data.json')")
  f.write('functions/deep.mjs', "import './alpha-helper.js'; export const n = 1")
  f.write('functions/data.json', '{"x":1}')
  const baseline = f.inventory()
  f.write('functions/deep.mjs', "import './alpha-helper.js'; export const n = 2")
  assert.notEqual(baseline['us-central1/alpha-one'].fingerprint, f.inventory()['us-central1/alpha-one'].fingerprint)
})
test('unknown dependencies use a conservative whole-source fingerprint', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', 'module.exports = require(selectedPath)')
  const before = buildInventory(f.root, f.endpoints, {})
  assert.ok(before.conservativeReasons.some(reason => reason.includes('Dynamic require')))
  f.write('functions/unmapped.js', 'module.exports = 4')
  const after = f.inventory()
  for (const key of Object.keys(after)) assert.notEqual(after[key].fingerprint, before.inventory[key].fingerprint)
})
test('a root side-effect dependency affects all namespaces', t => {
  const f = fixture(t)
  f.write('functions/index.js', "require('./init'); exports.alpha = require('./alpha'); exports.beta = require('./beta')")
  f.write('functions/init.js', 'global.setting = 1')
  const before = f.inventory()
  f.write('functions/init.js', 'global.setting = 2')
  for (const [key, item] of Object.entries(f.inventory())) assert.notEqual(item.fingerprint, before[key].fingerprint)
})
test('one handler in a namespace changes without selecting its siblings', t => {
  const f = fixture(t)
  f.endpoints['alpha-other'] = { ...f.endpoints['alpha-one'], entryPoint: 'alpha.other' }
  const source = "const { first, second } = require('./helpers'); exports.one = onCall(() => first()); exports.other = onCall(() => second())"
  f.write('functions/alpha.js', source)
  f.write('functions/helpers.js', 'exports.first = () => 1; exports.second = () => 2')
  const baseline = f.inventory()
  f.write('functions/alpha.js', source.replace('first()', 'first() + 1'))
  const changed = () => Object.entries(f.inventory()).filter(([key, item]) => item.fingerprint !== baseline[key].fingerprint).map(([, item]) => item.name).sort()
  assert.deepEqual(changed(), ['alpha-one'])
  f.write('functions/alpha.js', source)
  f.write('functions/helpers.js', 'exports.first = () => 3; exports.second = () => 2')
  assert.deepEqual(changed(), ['alpha-one'])
})
test('adding or removing a pure helper import affects only the handler using it', t => {
  const f = fixture(t)
  f.write('functions/new-helper.js', 'exports.value = () => 3')
  f.write('functions/alpha.js', "const shared = require('./shared'); const x = require('./alpha-helper'); const { value } = require('./new-helper'); exports.one = onCall(() => x + value())")
  assert.deepEqual(f.plan().selectedNames, ['alpha-one'])
  f.write('functions/alpha.js', "const shared = require('./shared'); const x = require('./alpha-helper'); const unused = require('./new-helper'); exports.one = onCall(() => x)")
  assert.deepEqual(f.plan().selectedNames, [])
})
test('a known local mirror factory is traced through its consumer, not as global startup work', t => {
  const f = fixture(t)
  f.write('functions/kv/kvMirror.js', 'exports.createKvMirrorHandlerFromFields = options => () => options')
  const source = "const {createKvMirrorHandlerFromFields} = require('./kv/kvMirror'); const mirror = createKvMirrorHandlerFromFields({name: 'before'}); exports.one = onCall(() => mirror())"
  f.write('functions/alpha.js', source)
  const baseline = f.inventory()
  f.write('functions/alpha.js', source.replace("'before'", "'after'"))
  const changed = Object.entries(f.inventory()).filter(([key, item]) => item.fingerprint !== baseline[key].fingerprint).map(([, item]) => item.name)
  assert.deepEqual(changed, ['alpha-one'])
})
test('unknown factories with the same name remain conservative startup dependencies', t => {
  const f = fixture(t)
  f.write('functions/other-factory.js', 'exports.createKvMirrorHandlerFromFields = options => { global.setting = options; return () => options }')
  const source = "const {createKvMirrorHandlerFromFields} = require('./other-factory'); const mirror = createKvMirrorHandlerFromFields({name: 'before'}); exports.one = onCall(() => mirror())"
  f.write('functions/alpha.js', source)
  const baseline = f.inventory()
  f.write('functions/alpha.js', source.replace("'before'", "'after'"))
  for (const [key, item] of Object.entries(f.inventory())) assert.notEqual(item.fingerprint, baseline[key].fingerprint)
})
test('startup dynamic import traces module effects globally and pure exports only through consumers', t => {
  const f = fixture(t)
  f.write('functions/alpha.js', "const promise = import('./helper.mjs'); exports.one = onCall(async () => (await promise).value())")
  f.write('functions/helper.mjs', 'export const value = () => 1')
  const baseline = f.inventory()
  f.write('functions/helper.mjs', 'export const value = () => 2')
  const changed = () => Object.entries(f.inventory()).filter(([key, item]) => item.fingerprint !== baseline[key].fingerprint).map(([, item]) => item.name)
  assert.deepEqual(changed(), ['alpha-one'])
  f.write('functions/helper.mjs', 'global.setting = 1; export const value = () => 2')
  assert.deepEqual(changed(), ['alpha-one', 'beta-two'])
})
test('namespace imports, reexports, nonenumerable helpers and shared consumers are traced', t => {
  const f = fixture(t)
  f.write('functions/alpha.js', "const h = require('./bridge'); exports.one = onCall(() => h.first())")
  f.write('functions/beta.js', "const { second } = require('./helpers'); exports.two = onCall(() => second())")
  f.write('functions/bridge.js', "exports.first = require('./helpers').first")
  f.write('functions/helpers.js', "Object.defineProperty(exports, 'first', {value: () => 1}); Object.defineProperties(exports, {second: {value: () => 2}})")
  const baseline = f.inventory()
  f.write('functions/helpers.js', "Object.defineProperty(exports, 'first', {value: () => 3}); Object.defineProperties(exports, {second: {value: () => 2}})")
  const changed = () => Object.entries(f.inventory()).filter(([key, item]) => item.fingerprint !== baseline[key].fingerprint).map(([, item]) => item.name).sort()
  assert.deepEqual(changed(), ['alpha-one'])
  f.write('functions/beta.js', "const { first } = require('./helpers'); exports.two = onCall(() => first())")
  assert.deepEqual(changed(), ['alpha-one', 'beta-two'])
})
test('shadowed callback parameters do not capture unrelated module bindings', t => {
  const f = fixture(t)
  f.write('functions/alpha.js', "const h = require('./helpers'); exports.one = onCall(h => h.first())")
  f.write('functions/helpers.js', 'exports.first = () => 1')
  const baseline = f.inventory()
  f.write('functions/helpers.js', 'exports.first = () => 2')
  for (const [key, item] of Object.entries(f.inventory())) assert.equal(item.fingerprint, baseline[key].fingerprint)
})
test('root comments, unrelated declarations and unused pure exports do not redeploy', t => {
  const f = fixture(t)
  f.write('functions/index.js', "// prettier\nexports.alpha = require('./alpha'); exports.beta = require('./beta')")
  f.write('functions/alpha.js', "const unused = 100; const shared = require('./shared'); const x = require('./alpha-helper'); exports.one = onCall(() => x)")
  f.write('functions/shared.js', 'module.exports = 2')
  assert.deepEqual(f.plan().selectedNames, [])
})
test('nested initializer side effects and initialization order affect all importers', t => {
  const f = fixture(t)
  f.write('functions/shared.js', 'const a = { nested: initialize(1) }; module.exports = 1')
  const baseline = f.inventory()
  f.write('functions/shared.js', 'const a = { nested: initialize(2) }; module.exports = 1')
  for (const [key, item] of Object.entries(f.inventory())) assert.notEqual(item.fingerprint, baseline[key].fingerprint)
  f.write('functions/shared.js', 'global.a = 1; global.b = 2; module.exports = 1')
  const ordered = f.inventory()
  f.write('functions/shared.js', 'global.b = 2; global.a = 1; module.exports = 1')
  for (const [key, item] of Object.entries(f.inventory())) assert.notEqual(item.fingerprint, ordered[key].fingerprint)
})
test('ES module named imports trace the selected export and its dependencies', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "module.exports = require('./helper.mjs')")
  f.write('functions/helper.mjs', "import { first } from './values.mjs'; export const value = () => first()")
  f.write('functions/values.mjs', 'export const first = () => 1; export const second = () => 2')
  const baseline = f.inventory()
  f.write('functions/values.mjs', 'export const first = () => 1; export const second = () => 3')
  assert.equal(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
  f.write('functions/values.mjs', 'export const first = () => 3; export const second = () => 2')
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
})
test('unsupported exports fall back to the whole dependency closure', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "const name = 'value'; Object.defineProperty(exports, name, {get: () => 1})")
  const baseline = f.inventory()
  assert.ok(baseline['us-central1/alpha-one'].dependencyFallbacks.length)
  f.write('functions/alpha-helper.js', "const name = 'value'; Object.defineProperty(exports, name, {get: () => 2})")
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
})
test('matching v2 fingerprints upgrade safely, while changed inputs and remote drift stay pending', t => {
  const f = fixture(t)
  f.state.version = 2
  for (const [key, item] of Object.entries(f.initial)) f.state.functions[key].fingerprint = item.moduleFingerprint
  assert.deepEqual(f.plan().selectedNames, [])
  assert.equal(f.plan().baselineUpgrades.length, 2)
  f.write('functions/alpha-helper.js', 'module.exports = 3')
  assert.deepEqual(f.plan().selectedNames, ['alpha-one'])
  f.remote['us-west1/beta-two'].updateTime = 'outside-deploy'
  assert.deepEqual(f.plan().selectedNames, ['alpha-one', 'beta-two'])
  assert.deepEqual(f.plan().baselineUpgrades, [])
})
test('missing baseline, drift, missing remote and forced deployment select endpoints', t => {
  const f = fixture(t)
  assert.equal(f.plan({ state: null }).selectedNames.length, 2)
  assert.equal(f.plan({ all: true }).selectedNames.length, 2)
  delete f.remote['us-central1/alpha-one']
  assert.deepEqual(f.plan().selectedNames, ['alpha-one'])
  f.remote['us-west1/beta-two'].updateTime = 'changed-by-other-deployer'
  assert.equal(f.plan().selectedNames.length, 2)
})
test('an explicit one-time redeployment request selects only that Function', t => {
  const f = fixture(t)
  f.state.functions['us-central1/alpha-one'].redeployRequested = true
  const plan = f.plan()
  assert.deepEqual(plan.selectedNames, ['alpha-one'])
  assert.deepEqual(plan.selectionReasons['us-central1/alpha-one'], ['explicit redeployment requested'])
})
test('wrong/corrupt state and removed Functions stop rather than silently succeed', t => {
  const f = fixture(t)
  assert.throws(() => f.plan({ state: { ...f.state, projectId: 'other-project' } }), /wrong project/)
  assert.throws(() => f.plan({ state: { ...f.state, version: 999 } }), /Invalid/)
  assert.throws(() => f.plan({ state: { ...f.state, functions: [] } }), /Invalid/)
  assert.throws(() => f.plan({ state: { ...f.state, functions: { 'us-central1/alpha-one': null } } }), /Invalid/)
  f.state.functions['us-central1/deleted'] = {}
  assert.throws(() => f.plan(), /removed/)
})
test('new exports, destructured root exports and multi-region inventories are supported', t => {
  const f = fixture(t)
  f.write('functions/index.js', "const { one } = require('./alpha'); exports.one = one; exports.beta = require('./beta')")
  const result = buildInventory(f.root, { one: { entryPoint: 'one', region: ['us-central1', 'us-west1'], platform: 'gcfv2', callableTrigger: {} }, ...{ 'beta-two': f.endpoints['beta-two'] } }, {})
  assert.deepEqual(result.conservativeReasons, [])
  assert.equal(Object.keys(result.inventory).length, 3)
  assert.equal(result.inventory['us-west1/one'].callable, true)
})

function fakeCloud() {
  const calls = []
  let state = null
  let generation = '0'
  return {
    calls,
    ensureBucket: async options => { calls.push(['bucket', options]); return true },
    acquireLock: async () => { calls.push(['lock']); return 'lock-1' },
    releaseLock: async lock => calls.push(['unlock', lock]),
    readState: async () => ({ state: state && structuredClone(state), generation }),
    listFunctions: async () => Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`us-central1/f${i}`, { state: 'ACTIVE', updateTime: 'updated' }])),
    assertHealthy: async () => calls.push(['healthy']),
    ensureInvoker: async () => calls.push(['invoker']),
    writeState: async (next, previous) => { assert.equal(previous, generation); state = structuredClone(next); generation = String(Number(generation) + 1); calls.push(['state', Object.keys(state.functions).length]); return generation },
  }
}
const largeInventory = () => Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`us-central1/f${i}`, { name: `f${i}`, region: 'us-central1', callable: i === 0, fingerprint: `hash-${i}` }]))
const run = options => deployFunctions({ root: '/fixture', projectId: 'test-project', cloud: fakeCloud(), inventory: largeInventory(), log: () => {}, ...options })

test('sequential batches stay at 10 names and checkpoint each successful batch', async () => {
  const cloud = fakeCloud()
  const sizes = []
  let running = false
  await run({ cloud, runBatch: async args => { assert.equal(running, false); running = true; sizes.push(args[2].split(',').length); await Promise.resolve(); running = false; assert.ok(args.includes('--non-interactive')); assert.equal(args[4], 'test-project') } })
  assert.deepEqual(sizes, [10, 10, 3])
  assert.deepEqual(cloud.calls.filter(call => call[0] === 'state').map(call => call[1]), [10, 20, 23])
  assert.equal(cloud.calls.filter(call => call[0] === 'invoker').length, 1)
  assert.equal(cloud.calls.at(-1)[0], 'unlock')
})
test('failed batches are pending on retry, previously successful ones are skipped', async () => {
  const cloud = fakeCloud()
  let runs = 0
  await assert.rejects(run({ cloud, runBatch: async () => { if (++runs === 2) throw new Error('quota') } }), /quota/)
  assert.equal(cloud.calls.at(-1)[0], 'unlock')
  assert.equal(Object.keys((await cloud.readState()).state.functions).length, 10)
  const retry = await run({ cloud, planOnly: true })
  assert.equal(retry.selectedNames.length, 13)
})
test('bad health or IAM prevents checkpointing even after CLI success', async () => {
  for (const method of ['assertHealthy', 'ensureInvoker']) {
    const cloud = fakeCloud()
    cloud[method] = async () => { throw new Error('not ready') }
    await assert.rejects(run({ cloud, runBatch: async () => {} }), /not ready/)
    assert.equal((await cloud.readState()).state, null)
    assert.equal(cloud.calls.at(-1)[0], 'unlock')
  }
})
test('source edits before or after deployment prevent checkpointing', async () => {
  for (const failAt of [1, 2]) {
    const cloud = fakeCloud()
    let checks = 0
    let batches = 0
    await assert.rejects(run({ cloud, verifySource: () => { if (++checks === failAt) throw new Error('source changed') }, runBatch: async () => { batches++ } }), /source changed/)
    assert.equal(batches, failAt - 1)
    assert.equal((await cloud.readState()).state, null)
    assert.equal(cloud.calls.at(-1)[0], 'unlock')
  }
})
test('checkpoint failure aborts without moving on to the next batch', async () => {
  const cloud = fakeCloud()
  cloud.writeState = async () => { throw new Error('generation conflict') }
  let batches = 0
  await assert.rejects(run({ cloud, runBatch: async () => { batches++ } }), /generation conflict/)
  assert.equal(batches, 1)
  assert.equal(cloud.calls.at(-1)[0], 'unlock')
})
test('plan mode writes no state, creates no bucket, acquires no lock and invokes no deployments', async () => {
  const cloud = fakeCloud()
  await run({ cloud, planOnly: true, runBatch: () => { throw new Error('must not deploy') } })
  assert.deepEqual(cloud.calls, [['bucket', { create: false }]])
})
for (const version of [1, 2, 3, 4, 5, 6]) test(`matching v${version} checkpoints migrate under the lock without deploying or changing deployed timestamps`, async () => {
  const cloud = fakeCloud()
  const inventory = Object.fromEntries(Object.entries(largeInventory()).map(([key, item]) => [key, { ...item, legacyFingerprint: `old-${item.fingerprint}`, moduleFingerprint: `v2-${item.fingerprint}`, handlerV3Fingerprint: `v3-${item.fingerprint}`, handlerV4Fingerprint: `v4-${item.fingerprint}`, handlerV5Fingerprint: `v5-${item.fingerprint}`, handlerV6Fingerprint: `v6-${item.fingerprint}` }]))
  const state = { version, projectId: 'test-project', functions: Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, {
    fingerprint: version === 1 ? item.legacyFingerprint : version === 2 ? item.moduleFingerprint : version === 3 ? item.handlerV3Fingerprint : version === 4 ? item.handlerV4Fingerprint : version === 5 ? item.handlerV5Fingerprint : item.handlerV6Fingerprint, remoteUpdateTime: 'updated', deployedAt: 'actual-old-deployment',
  }])) }
  await cloud.writeState(state, '0')
  cloud.calls.length = 0
  const preview = await run({ cloud, inventory, planOnly: true })
  assert.equal(preview.selectedNames.length, 0)
  assert.equal(preview.baselineUpgrades.length, 23)
  assert.deepEqual(cloud.calls, [['bucket', { create: false }]])
  assert.equal((await cloud.readState()).state.version, version)
  cloud.calls.length = 0
  await run({ cloud, inventory, runBatch: () => { throw new Error('unchanged Functions must not deploy') } })
  const migrated = (await cloud.readState()).state
  assert.equal(migrated.version, VERSION)
  for (const [key, item] of Object.entries(inventory)) {
    assert.equal(migrated.functions[key].fingerprint, item.fingerprint)
    assert.equal(migrated.functions[key].fingerprintVersion, VERSION)
    assert.equal(migrated.functions[key].deployedAt, 'actual-old-deployment')
  }
  assert.equal(cloud.calls.filter(c => c[0] === 'state').length, 1)
  assert.equal(cloud.calls[1][0], 'lock')
  assert.equal(cloud.calls.at(-1)[0], 'unlock')
  assert.equal((await run({ cloud, inventory, planOnly: true })).selectedNames.length, 0)
})
test('historical migration is read-only in preview and failed deployments retain the proven OLD handler fingerprint', async () => {
  const cloud = fakeCloud()
  const inventory = Object.fromEntries(Object.entries(largeInventory()).map(([key, item]) => [key, { ...item, moduleFingerprint: `changed-module-${item.name}` }]))
  const oldState = { version: 2, projectId: 'test-project', functions: Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, {
    fingerprint: `previous-module-${item.name}`, remoteUpdateTime: 'updated', deployedAt: 'original-deployment',
  }])) }
  await cloud.writeState(oldState, '0')
  const baselines = Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, {
    fingerprint: item.name === 'f0' ? 'old-handler-f0' : item.fingerprint,
    legacyFingerprint: oldState.functions[key].fingerprint, legacyVersion: 2, sourceArchive: { bucket: 'test-source', object: 'source.zip', generation: '1', sha256: 'a'.repeat(64) },
  }]))
  const recoverBaseline = () => baselines
  cloud.calls.length = 0
  const preview = await run({ cloud, inventory, planOnly: true, recoverBaseline })
  assert.deepEqual(preview.selectedNames, ['f0'])
  assert.deepEqual(cloud.calls, [['bucket', { create: false }]])
  assert.deepEqual((await cloud.readState()).state, oldState)
  cloud.calls.length = 0
  await assert.rejects(run({ cloud, inventory, recoverBaseline, runBatch: async () => { throw new Error('deployment failed') } }), /deployment failed/)
  const migrated = (await cloud.readState()).state
  assert.equal(migrated.version, VERSION)
  assert.equal(migrated.functions['us-central1/f0'].fingerprint, 'old-handler-f0')
  assert.notEqual(migrated.functions['us-central1/f0'].fingerprint, inventory['us-central1/f0'].fingerprint)
  assert.equal(migrated.functions['us-central1/f0'].deployedAt, 'original-deployment')
  assert.ok(cloud.calls.findIndex(call => call[0] === 'lock') < cloud.calls.findIndex(call => call[0] === 'state'))
  assert.deepEqual((await run({ cloud, inventory, planOnly: true })).selectedNames, ['f0'])
  await run({ cloud, inventory, runBatch: async () => {} })
  assert.deepEqual((await run({ cloud, inventory, planOnly: true })).selectedNames, [])
})
test('unverified legacy source never promotes checkpoints or silently starts a broad deployment', async () => {
  const cloud = fakeCloud(), inventory = largeInventory()
  await cloud.writeState({ version: 3, projectId: 'test-project', functions: Object.fromEntries(Object.entries(inventory).map(([key]) => [key, { fingerprint: 'old-source', remoteUpdateTime: 'updated' }])) }, '0')
  cloud.calls.length = 0
  let batches = 0
  const recoverBaseline = () => ({})
  const preview = await run({ cloud, inventory, recoverBaseline, planOnly: true })
  assert.ok(preview.selectionReasons['us-central1/f0'].includes('unverified legacy deployed source'))
  await assert.rejects(run({ cloud, inventory, recoverBaseline, runBatch: async () => { batches++ } }), /could not be verified/)
  assert.equal(batches, 0)
  assert.equal(cloud.calls.filter(call => call[0] === 'state').length, 0)
  assert.equal((await cloud.readState()).state.version, 3)
})
test('a successful requested redeployment clears its one-time request', async () => {
  const cloud = fakeCloud()
  const inventory = largeInventory()
  await cloud.writeState({ version: VERSION, projectId: 'test-project', functions: Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, {
    fingerprint: item.fingerprint, fingerprintVersion: VERSION, remoteUpdateTime: 'updated', redeployRequested: key.endsWith('/f0'),
  }])) }, '0')
  let batches = 0
  const plan = await run({ cloud, inventory, runBatch: async () => { batches++ } })
  assert.deepEqual(plan.selectedNames, ['f0'])
  assert.equal(batches, 1)
  assert.equal((await cloud.readState()).state.functions['us-central1/f0'].redeployRequested, undefined)
  assert.deepEqual((await run({ cloud, inventory, planOnly: true })).selectedNames, [])
})
test('migration preserves mismatched legacy entries as pending rather than blessing unknown inputs', async () => {
  const cloud = fakeCloud()
  const inventory = Object.fromEntries(Object.entries(largeInventory()).map(([key, item]) => [key, { ...item, legacyFingerprint: `old-${item.fingerprint}` }]))
  await cloud.writeState({ version: 1, projectId: 'test-project', functions: Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, {
    fingerprint: key.endsWith('/f0') ? 'different-inputs' : item.legacyFingerprint, remoteUpdateTime: 'updated',
  }])) }, '0')
  await assert.rejects(run({ cloud, inventory, runBatch: () => { throw new Error('simulated deployment failure') } }), /simulated deployment failure/)
  const saved = (await cloud.readState()).state
  assert.equal(saved.version, VERSION)
  assert.equal(saved.functions['us-central1/f0'].fingerprintVersion, 1)
  assert.equal(saved.functions['us-central1/f0'].fingerprint, 'different-inputs')
  assert.equal(saved.functions['us-central1/f1'].fingerprintVersion, VERSION)
  assert.deepEqual((await run({ cloud, inventory, planOnly: true })).selectedNames, ['f0'])
})
test('a held lock prevents deployments and cannot be unlocked by the contender', async () => {
  const cloud = fakeCloud()
  cloud.acquireLock = async () => { throw new Error('locked') }
  await assert.rejects(run({ cloud, runBatch: () => { throw new Error('must not deploy') } }), /locked/)
  assert.equal(cloud.calls.some(call => call[0] === 'unlock'), false)
})

const api = (handler) => new DeployCloud({ projectId: 'test-project', tokenProvider: () => 'fake-token', fetchImpl: async (url, options) => {
  const result = handler(url, options)
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status || 200, headers: { 'Content-Type': 'application/json' } })
} })
test('bucket verification refuses wrong-project or publicly accessible state buckets', async () => {
  for (const bucket of [ { projectNumber: 'other' }, { projectNumber: '123', iamConfiguration: {} } ]) {
    const cloud = api(url => ({ body: url.includes('cloudresourcemanager') ? { projectNumber: '123' } : bucket }))
    await assert.rejects(cloud.ensureBucket(), /must belong/)
  }
})
test('bucket creation explicitly enforces privacy; plan mode never creates it', async () => {
  const methods = []
  const cloud = api((url, options) => {
    methods.push(options.method)
    if (url.includes('cloudresourcemanager')) return { body: { projectNumber: '123' } }
    if (options.method === 'GET') return { status: 404, body: {} }
    const body = JSON.parse(options.body)
    assert.equal(body.iamConfiguration.publicAccessPrevention, 'enforced')
    assert.equal(body.iamConfiguration.uniformBucketLevelAccess.enabled, true)
    return { body: { ...body, projectNumber: '123' } }
  })
  assert.equal(await cloud.ensureBucket({ create: false }), false)
  assert.equal(methods.includes('POST'), false)
  assert.equal(await cloud.ensureBucket({ create: true }), true)
})
test('locks and state use generation preconditions and only owned lock is deleted', async () => {
  const urls = []
  const cloud = api((url, options) => { urls.push(url); return options.method === 'DELETE' ? { status: 204 } : { body: { generation: '42' } } })
  assert.equal(await cloud.acquireLock('owner'), '42')
  await cloud.writeState({ functions: {} }, '7')
  await cloud.releaseLock('42')
  assert.ok(urls[0].includes('ifGenerationMatch=0'))
  assert.ok(urls[1].includes('ifGenerationMatch=7'))
  assert.ok(urls[2].includes('ifGenerationMatch=42'))
})
test('public IAM already set is a read-only operation', async () => {
  const cloud = api((url, options) => {
    assert.equal(options.method, 'GET')
    assert.match(url, /:getIamPolicy$/)
    return { body: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] } }
  })
  await cloud.ensureInvoker({ name: 'test', platform: 'gcfv2', region: 'us-central1' }, { serviceConfig: { service: 'projects/test-project/locations/us-central1/services/test' } }, () => {})
})
test('latest failed Cloud Run revision cannot be checkpointed as healthy', async () => {
  const cloud = api(() => ({ body: { terminalCondition: { state: 'CONDITION_FAILED' }, latestCreatedRevision: 'new', latestReadyRevision: 'old' } }))
  await assert.rejects(cloud.assertHealthy({ name: 'test', platform: 'gcfv2', region: 'us-central1' }, { state: 'ACTIVE', serviceConfig: { service: 'projects/test-project/locations/us-central1/services/test' } }), /not ready/)
})
test('missing or conditional public binding repairs only the selected callable', async () => {
  const commands = []
  const cloud = new DeployCloud({ projectId: 'test-project', tokenProvider: () => 'fake-token',
    commandRunner: (...args) => commands.push(args),
    fetchImpl: async () => new Response(JSON.stringify({ bindings: [{ role: 'roles/run.invoker', members: ['allUsers'], condition: { expression: 'false' } }] })),
  })
  await cloud.ensureInvoker({ name: 'test', platform: 'gcfv2', region: 'us-central1' }, { serviceConfig: { service: 'projects/test-project/locations/us-central1/services/test' } }, () => {})
  assert.equal(commands.length, 1)
  assert.deepEqual(commands[0][1], ['functions', 'add-invoker-policy-binding', 'test', '--gen2', '--project', 'test-project', '--region', 'us-central1', '--member=allUsers', '--quiet'])
})
test('function inventory paginates and rejects unreachable regions or denied reads', async () => {
  const cloud = api(url => url.includes('pageToken=next')
    ? { body: { functions: [{ name: 'projects/test-project/locations/us-west1/functions/b' }] } }
    : { body: { functions: [{ name: 'projects/test-project/locations/us-central1/functions/a' }], nextPageToken: 'next' } })
  assert.deepEqual(Object.keys(await cloud.listFunctions()), ['us-central1/a', 'us-west1/b'])
  await assert.rejects(api(() => ({ body: { unreachable: ['us-west1'] } })).listFunctions(), /unreachable/)
  await assert.rejects(api(() => ({ status: 403, body: {} })).readState(), /403/)
})

// Bundle ownership is discovered from code, not a special-case filename.
for (const filename of ['agent-contracts/index.json', 'other-contracts/schema.json', 'guide/a.md']) {
  test(`runtime bundle ${filename} changes only its readers`, t => {
    const f = fixture(t)
    f.write('functions/alpha-helper.js', `const path = require('node:path'); const fs = require('node:fs'); const dir = path.join(__dirname, '${filename.split('/')[0]}'); exports.read = () => fs.readFileSync(path.join(dir, '${filename.split('/')[1]}'), 'utf8')`)
    f.write('functions/alpha.js', "const helper = require('./alpha-helper'); exports.one = onCall(() => helper.read())")
    f.write(`functions/${filename}`, 'original')
    const baseline = f.inventory()
    const changed = () => Object.keys(baseline).filter(key => baseline[key].fingerprint !== f.inventory()[key].fingerprint)
    f.write(`functions/${filename}`, 'updated')
    assert.deepEqual(changed(), ['us-central1/alpha-one'])
    fs.unlinkSync(path.join(f.root, 'functions', filename))
    assert.deepEqual(changed(), ['us-central1/alpha-one'], 'deletion is detected')
    f.write(`functions/${filename}`, 'original')
    f.write(`functions/${filename.split('/')[0]}/new.json`, '{}')
    assert.deepEqual(changed(), ['us-central1/alpha-one'], 'new directory members are detected')
  })
}
test('JSON imports belong to consumers rather than unrelated module initialization', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "const data = require('./data.json'); exports.value = () => data.x")
  f.write('functions/alpha.js', "const { value } = require('./alpha-helper'); exports.one = onCall(() => value())")
  f.write('functions/data.json', '{"x":1}')
  const baseline = f.inventory()
  f.write('functions/data.json', '{"x":2}')
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
  assert.equal(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
})
test('static metadata spreads and Promise.all imports do not become global startup work', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "const definitions = Promise.all([import('./metadata.mjs')]); exports.value = () => definitions")
  f.write('functions/alpha.js', "const { value } = require('./alpha-helper'); exports.one = onCall(() => value())")
  f.write('functions/metadata.mjs', "const base = ['name']; export const fields = Object.freeze([...base, 'title']); export const options = {...{a: 1}}")
  const baseline = f.inventory()
  f.write('functions/metadata.mjs', "const base = ['name']; export const fields = Object.freeze([...base, 'summary']); export const options = {...{a: 2}}")
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
  assert.equal(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
  f.write('functions/metadata.mjs', 'global.sharedSetting = 2; export const fields = []')
  assert.notEqual(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint, 'real imported startup work remains global')
})
test('the reviewed MCP factory and its runtime assets are dependencies of its consumers', t => {
  const f = fixture(t)
  f.write('functions/alpha.js', "const { read } = require('./cmsAgentMcp'); exports.one = onCall(() => read())")
  f.write('functions/cmsAgentMcp.js', "const path = require('node:path'); const fs = require('node:fs'); const dir = path.join(__dirname, 'agent-contracts'); const createRemoteCms = () => { const data = fs.readFileSync(path.join(dir, 'index.json')); return () => data }; const read = createRemoteCms(); exports.read = read")
  f.write('functions/agent-contracts/index.json', '{}')
  const baseline = f.inventory()
  f.write('functions/agent-contracts/index.json', '{"contracts":{}}')
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
  assert.equal(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
})

test('unreferenced source backups do not select Functions, but runtime-read backups do', t => {
  const f = fixture(t)
  f.write('functions/index.js.backup', 'old source')
  assert.deepEqual(f.plan().selectedNames, [])
  f.write('functions/alpha-helper.js', "const path = require('node:path'); const file = path.join(__dirname, 'index.js.backup'); exports.value = () => require('node:fs').readFileSync(file)")
  const baseline = f.inventory()
  f.write('functions/index.js.backup', 'changed source')
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, baseline['us-central1/alpha-one'].fingerprint)
  assert.equal(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
})
test('expression factories stay local; factories with side effects remain global', t => {
  const f = fixture(t)
  f.write('functions/alpha-helper.js', "const field = (note, extra = {}) => ({ type: 'text', note, ...extra }); const fields = Object.freeze({id: field('id')}); exports.value = () => fields")
  const baseline = f.inventory()
  f.write('functions/alpha-helper.js', "const field = (note, extra = {}) => ({ type: 'text', note, ...extra }); const fields = Object.freeze({id: field('updated')}); exports.value = () => fields")
  assert.equal(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
  f.write('functions/alpha-helper.js', "const field = note => { global.setting = note; return {note} }; const fields = field('updated'); exports.value = () => fields")
  assert.notEqual(f.inventory()['us-west1/beta-two'].fingerprint, baseline['us-west1/beta-two'].fingerprint)
})
test('v4 compatibility hashes retain the recorded pre-v5 fixture values', t => {
  const f = fixture(t)
  assert.deepEqual(Object.fromEntries(Object.entries(f.initial).map(([key, item]) => [key, item.handlerV4Fingerprint])), {
    'us-central1/alpha-one': '3dc25901444ac45695debdf642aad9daf729d5ae780747a180405ab894e17b4c',
    'us-west1/beta-two': '8c7dac80797908477e2bdfa21c621fff9afa69964b75b8386e140322d939720b',
  })
})
test('early deployment lock check is read-only and reports the owning machine', async () => {
  const calls = []
  const cloud = api((url, options) => {
    calls.push([url, options.method])
    return { body: { owner: 'Other-Mac:123:nonce', startedAt: '2026-11-02T16:33:35.394Z' } }
  })
  await assert.rejects(cloud.assertNoDeploymentLock(), /Another deployment holds the lock on Other-Mac.*Try again after it finishes/)
  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /deploy-lock\.json\?alt=media$/)
  assert.equal(calls[0][1], 'GET')
})
test('missing lock proceeds; permission failures stop; unknown owner still blocks', async () => {
  await api(() => ({ status: 404 })).assertNoDeploymentLock()
  await assert.rejects(api(() => ({ status: 403 })).assertNoDeploymentLock(), /403/)
  await assert.rejects(api(() => ({ body: {} })).assertNoDeploymentLock(), /Another deployment holds the lock/)
})
test('atomic acquisition still stops a contender if the lock appears after the early check', async () => {
  let reads = 0
  const methods = []
  const cloud = api((url, options) => {
    methods.push(options.method)
    if (options.method === 'POST') return { status: 412 }
    reads++
    return reads === 1 ? { status: 404 } : { body: { owner: 'Other-Mac:123:nonce' } }
  })
  await cloud.assertNoDeploymentLock()
  await assert.rejects(cloud.acquireLock('this-machine'), /Another deployment holds the lock on Other-Mac/)
  assert.deepEqual(methods, ['GET', 'POST', 'GET'])
})
test('deploy.sh checks the lock before Git/build work and leaves plan mode available', t => {
  const { spawnSync } = require('node:child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-early-deploy-lock-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin'), log = path.join(root, 'commands.log')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh
printf '%s\\n' "$*" >> "$COMMAND_LOG"
case " $* " in
  *" --check-lock "*) echo 'Another deployment holds the lock on Other-Mac.' >&2; exit 1 ;;
  *" --plan-functions "*) exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })
  fs.mkdirSync(path.join(root, 'edge'))
  const deploy = path.join(root, 'edge/deploy.sh')
  fs.copyFileSync(path.resolve(__dirname, '../../deploy.sh'), deploy)
  const options = { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/bin:/usr/bin`, PROJECT_ID: 'test-project', FIREBASE_STORE_REGION: 'us-central1', COMMAND_LOG: log } }
  const normal = spawnSync('/bin/sh', [deploy], options)
  assert.equal(normal.status, 1)
  assert.match(normal.stderr, /Another deployment holds the lock on Other-Mac/)
  assert.equal(fs.readFileSync(log, 'utf8'), 'edge/scripts/deploy-functions.cjs --project test-project --region us-central1 --check-lock\n')
  fs.writeFileSync(log, '')
  const plan = spawnSync('/bin/sh', [deploy, '--plan-functions'], options)
  assert.equal(plan.status, 0)
  assert.equal(fs.readFileSync(log, 'utf8'), 'edge/scripts/deploy-functions.cjs --project test-project --region us-central1 --plan-functions\n')
  fs.writeFileSync(log, '')
  const elsewhere = spawnSync('/bin/sh', [deploy, '--plan-functions'], { ...options, cwd: os.tmpdir() })
  assert.equal(elsewhere.status, 0)
  assert.equal(fs.readFileSync(log, 'utf8'), 'edge/scripts/deploy-functions.cjs --project test-project --region us-central1 --plan-functions\n')
})


test('v5 compatibility hashes retain pre-v6 fixture values', t => {
  const f = fixture(t)
  const inventory = buildInventory(f.root, f.endpoints, {}, { formats: [5] }).inventory
  assert.deepEqual(Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, item.handlerV5Fingerprint])), {
    'us-central1/alpha-one': '583b2df3678725f71d9ca4876951d469ed550b5f90f80b02cfc05cb84dbdee3d',
    'us-west1/beta-two': '4dae4271ac8c87cff4a80905f40b1c271877f475c6736fa59c0f20116d0cc3cc',
  })
})


test('legacy remote drift stays selected without requiring proof to redeploy it', t => {
  const f = fixture(t)
  const key = 'us-central1/alpha-one'
  f.state.functions[key].fingerprintVersion = 5
  f.state.functions[key].fingerprint = f.initial[key].handlerV5Fingerprint
  f.remote[key].updateTime = 'external-update'
  const plan = f.plan({ requireSourceProof: true })
  assert.deepEqual(plan.selectedNames, ['alpha-one'])
  assert.ok(plan.selectionReasons[key].includes('server changed outside checkpoint'))
  assert.ok(!plan.selectionReasons[key].includes('unverified legacy deployed source'))
  assert.equal(plan.baselineConversions[key], undefined)
})


test('v6 compatibility hashes retain pre-retirement fixture values', t => {
  const f = fixture(t)
  const inventory = buildInventory(f.root, f.endpoints, {}, { formats: [6] }).inventory
  assert.deepEqual(Object.fromEntries(Object.entries(inventory).map(([key, item]) => [key, item.handlerV6Fingerprint])), {
    'us-central1/alpha-one': 'b595115757de0e6cd516042e89fa488dbad0eedbbb6cd3fe35df34511681bb79',
    'us-west1/beta-two': '5768fca5d18bd0f05e58c210d9ac22856b4a0280fe211b4277c0400240ea484f',
  })
})


test('unconverted old-format summaries do not report retired keys as current input changes', t => {
  const f = fixture(t)
  const key = 'us-central1/alpha-one'
  f.state.functions[key].fingerprintVersion = 6
  f.state.functions[key].fingerprint = f.initial[key].handlerV6Fingerprint
  f.state.functions[key].inputSummary = { environment: { '.env.prod:CLEARWATER_URL': 'old-hash' } }
  f.remote[key].updateTime = 'external-update'
  const plan = f.plan({ requireSourceProof: true })
  assert.deepEqual(plan.inputChanges[key], [])
  assert.deepEqual(plan.selectionReasons[key], ['server changed outside checkpoint'])
})


test('batch args accept newly configured retries and leave ordinary batches unforced', () => {
  const key = 'us-central1/alpha-one'
  const item = { name: 'alpha-one', platform: 'gcfv2', eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retry: true } }
  const args = remote => firebaseBatchArgs({ batch: ['alpha-one'], inventory: { [key]: item }, remote, projectId: 'test-project' })
  assert.ok(args({}).includes('--force'))
  const deployed = { environment: 'GEN_2', eventTrigger: { eventType: item.eventTrigger.eventType, retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY' } }
  assert.ok(args({ [key]: deployed }).includes('--force'))
  deployed.eventTrigger.retryPolicy = 'RETRY_POLICY_RETRY'
  assert.ok(!args({ [key]: deployed }).includes('--force'))
  item.eventTrigger.retry = false
  assert.ok(!args({}).includes('--force'))
  assert.ok(args({}).includes('--non-interactive'))
})

test('accepting retries cannot silently delete selector matches or migrate generation/trigger types', () => {
  const item = { name: 'alpha-one', platform: 'gcfv2', eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retry: true } }
  const args = remote => firebaseBatchArgs({ batch: ['alpha-one'], inventory: { 'us-central1/alpha-one': item }, remote, projectId: 'test-project' })
  assert.throws(() => args({ 'us-west1/alpha-one': { environment: 'GEN_2' } }), /removed locally/)
  assert.throws(() => args({ 'us-central1/alpha-one-old': { environment: 'GEN_2' } }), /outside this batch/)
  assert.throws(() => firebaseBatchArgs({ batch: ['alpha-one'], inventory: { 'us-central1/alpha-one': item, 'us-central1/alpha-one-child': { ...item, name: 'alpha-one-child' } }, remote: {}, projectId: 'test-project' }), /outside this batch/)
  assert.throws(() => args({ 'us-central1/alpha-one': { environment: 'GEN_1', eventTrigger: { eventType: item.eventTrigger.eventType } } }), /generation or trigger type/)
  assert.throws(() => args({ 'us-central1/alpha-one': { environment: 'GEN_2', eventTrigger: { eventType: 'google.cloud.pubsub.topic.v1.messagePublished' } } }), /generation or trigger type/)
})

test('SDK inventory carries retry metadata without changing content fingerprints', t => {
  const f = fixture(t)
  f.endpoints['alpha-one'].eventTrigger = { eventType: 'google.cloud.firestore.document.v1.written', retry: true }
  delete f.endpoints['alpha-one'].callableTrigger
  const item = f.inventory()['us-central1/alpha-one']
  assert.equal(item.eventTrigger.retry, true)
  assert.equal(item.eventTrigger.eventType, 'google.cloud.firestore.document.v1.written')
  const first = item.fingerprint
  assert.equal(f.inventory()['us-central1/alpha-one'].fingerprint, first)
})

test('a new retry function deploys noninteractively with confirmation and checkpoints only on success', async () => {
  const item = { name: 'newRetry', region: 'us-central1', platform: 'gcfv2', fingerprint: 'new-retry-hash', eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retry: true } }
  const cloud = fakeCloud()
  let deployed = false
  cloud.listFunctions = async () => deployed ? { 'us-central1/newRetry': { state: 'ACTIVE', updateTime: 'new-version', environment: 'GEN_2', eventTrigger: { ...item.eventTrigger, retryPolicy: 'RETRY_POLICY_RETRY' } } } : {}
  await run({ cloud, inventory: { 'us-central1/newRetry': item }, runBatch: async args => {
    assert.ok(args.includes('--force'))
    assert.ok(args.includes('--non-interactive'))
    assert.equal(args[2], 'functions:newRetry')
    deployed = true
  } })
  assert.equal((await cloud.readState()).state.functions['us-central1/newRetry'].remoteUpdateTime, 'new-version')
  const failed = fakeCloud()
  failed.listFunctions = async () => ({})
  await assert.rejects(run({ cloud: failed, inventory: { 'us-central1/newRetry': item }, runBatch: async args => { assert.ok(args.includes('--force')); throw new Error('provider failure') } }), /provider failure/)
  assert.equal((await failed.readState()).state, null)
})
