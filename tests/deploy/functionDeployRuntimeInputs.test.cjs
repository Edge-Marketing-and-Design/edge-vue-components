const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { buildInventory, VERSION } = require('../../scripts/function-deploy-plan.cjs')
const { describeInputChanges } = require('../../scripts/function-deploy-runtime-inputs.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-inputs-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, value) => { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)) }
  write('package.json', { edgeDeploy: { retiredEnvironmentKeys: ['CLEARWATER_URL'] } })
  const manifest = { engines: { node: '22' }, dependencies: { 'alpha-lib': '1.0.0', 'beta-lib': '1.0.0' } }
  const lock = { lockfileVersion: 3, packages: {
    '': manifest,
    'node_modules/alpha-lib': { version: '1.0.0', integrity: 'alpha-1', dependencies: { shared: '1.0.0' } },
    'node_modules/beta-lib': { version: '1.0.0', integrity: 'beta-1' },
    'node_modules/shared': { version: '1.0.0', integrity: 'shared-1' },
  } }
  const packages = () => { write('functions/package.json', manifest); write('functions/package-lock.json', lock) }
  packages()
  write('functions/index.js', "exports.alpha = require('./alpha'); exports.beta = require('./beta')")
  write('functions/alpha.js', "const lib = require('alpha-lib/subpath'); exports.one = onCall(() => lib.run())")
  write('functions/beta.js', "const lib = require('beta-lib'); exports.two = onCall(() => lib.run())")
  write('functions/.env.prod', 'SHARED_SECRET=test-secret\n')
  const endpoints = { 'alpha-one': { entryPoint: 'alpha.one', platform: 'gcfv2', region: ['us-central1'] }, 'beta-two': { entryPoint: 'beta.two', platform: 'gcfv2', region: ['us-central1'] } }
  const inventory = () => buildInventory(root, endpoints, {}, { formats: [VERSION] }).inventory
  const before = inventory()
  const selected = () => Object.entries(inventory()).filter(([key, item]) => item.fingerprint !== before[key].fingerprint).map(([, item]) => item.name).sort()
  return { write, manifest, lock, packages, inventory, before, selected, root, endpoints }
}

test('direct and transitive package upgrades affect consumers rather than every handler', t => {
  const f = fixture(t)
  f.manifest.dependencies['alpha-lib'] = '2.0.0'
  f.lock.packages['node_modules/alpha-lib'].version = '2.0.0'
  f.packages()
  assert.deepEqual(f.selected(), ['alpha-one'])
  const changes = describeInputChanges(f.before['us-central1/alpha-one'].inputSummary, f.inventory()['us-central1/alpha-one'].inputSummary)
  assert.ok(changes.includes('package alpha-lib: 1.0.0 -> 2.0.0'))
  f.manifest.dependencies['alpha-lib'] = '1.0.0'
  f.lock.packages['node_modules/alpha-lib'].version = '1.0.0'
  f.lock.packages['node_modules/shared'].integrity = 'changed-shared'
  f.packages()
  assert.deepEqual(f.selected(), ['alpha-one'])
  assert.ok(describeInputChanges(f.before['us-central1/alpha-one'].inputSummary, f.inventory()['us-central1/alpha-one'].inputSummary).some(x => x.includes('locked dependencies changed')))
})

test('shared transitive dependencies select both consumers', t => {
  const f = fixture(t)
  f.lock.packages['node_modules/beta-lib'].dependencies = { shared: '1.0.0' }
  f.packages()
  const before = f.inventory()
  f.lock.packages['node_modules/shared'].integrity = 'new-shared'
  f.packages()
  const after = f.inventory()
  assert.ok(Object.keys(before).every(k => before[k].fingerprint !== after[k].fingerprint))
})

test('nested package resolution does not confuse hoisted dependencies', t => {
  const f = fixture(t)
  f.lock.packages['node_modules/alpha-lib/node_modules/shared'] = { version: '0.9.0', integrity: 'nested' }
  f.packages()
  const before = f.inventory()
  f.lock.packages['node_modules/shared'].integrity = 'changed-but-shadowed'
  f.packages()
  assert.equal(f.inventory()['us-central1/alpha-one'].fingerprint, before['us-central1/alpha-one'].fingerprint)
})

test('unused dependency and dev-only lock updates do not select functions', t => {
  const f = fixture(t)
  f.manifest.devDependencies = { tools: '1.0.0' }
  f.lock.packages['node_modules/tools'] = { version: '1.0.0', dev: true }
  f.manifest.dependencies.unused = '2.0.0'
  f.lock.packages['node_modules/unused'] = { version: '2.0.0' }
  f.packages()
  assert.deepEqual(f.selected(), [])
})

test('runtime/build settings and unresolved package dependencies remain conservative', t => {
  const f = fixture(t)
  f.manifest.engines.node = '24'
  f.packages()
  assert.deepEqual(f.selected(), ['alpha-one', 'beta-two'])
  f.manifest.engines.node = '22'
  f.lock.packages['node_modules/alpha-lib'].dependencies.missing = '1.0.0'
  f.packages()
  const unresolved = f.inventory()
  assert.ok(unresolved['us-central1/alpha-one'].inputSummary.configuration['unresolved package/lock inputs'])
  assert.equal(unresolved['us-central1/beta-two'].fingerprint, f.before['us-central1/beta-two'].fingerprint)
  f.lock.packages['node_modules/alpha-lib'].dependencies.missing = '2.0.0'
  f.packages()
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, unresolved['us-central1/alpha-one'].fingerprint)
})

test('optional missing platform dependencies are allowed; installed optional peers are tracked', t => {
  const f = fixture(t)
  Object.assign(f.lock.packages['node_modules/alpha-lib'], { optionalDependencies: { native: '1' }, peerDependencies: { peer: '1' }, peerDependenciesMeta: { peer: { optional: true } } })
  f.packages()
  const before = f.inventory()
  assert.equal(before['us-central1/alpha-one'].inputSummary.configuration['unresolved package/lock inputs'], undefined)
  f.lock.packages['node_modules/peer'] = { version: '1.0.0' }
  f.packages()
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, before['us-central1/alpha-one'].fingerprint)
})

test('environment formatting is ignored, values remain conservative, and reports never expose secrets', t => {
  const f = fixture(t)
  f.write('functions/.env.prod', '# comment\nSHARED_SECRET = "test-secret" # another comment\n')
  assert.deepEqual(f.selected(), [])
  f.write('functions/.env.prod', 'SHARED_SECRET=changed-secret\n')
  assert.deepEqual(f.selected(), ['alpha-one', 'beta-two'])
  const after = f.inventory()
  const changes = describeInputChanges(f.before['us-central1/alpha-one'].inputSummary, after['us-central1/alpha-one'].inputSummary)
  assert.ok(changes.includes('environment key .env.prod:SHARED_SECRET'))
  assert.ok(!JSON.stringify(after).includes('changed-secret'))
})

test('ESM side-effect imports are package consumers', t => {
  const f = fixture(t)
  f.write('functions/setup.mjs', "import 'alpha-lib'; export const value = 1")
  f.write('functions/alpha.js', "exports.one = onCall(async () => (await import('./setup.mjs')).value)")
  const before = f.inventory()
  f.lock.packages['node_modules/alpha-lib'].integrity = 'changed-side-effect'
  f.packages()
  assert.notEqual(f.inventory()['us-central1/alpha-one'].fingerprint, before['us-central1/alpha-one'].fingerprint)
  assert.equal(f.inventory()['us-central1/beta-two'].fingerprint, before['us-central1/beta-two'].fingerprint)
})

test('the media factory and cached imports stay local, but added startup effects remain shared', t => {
  const f = fixture(t)
  f.write('functions/config.js', 'global.shared = 1; exports.value = 1')
  f.write('functions/alpha.js', "const config = require('./config'); exports.one = onCall(() => config.value)")
  f.write('functions/beta.js', "const config = require('./config'); exports.two = onCall(() => config.value)")
  const before = f.inventory()
  f.write('functions/cmsAgentMedia.js', "const crypto = require('node:crypto'); const config = require('./config'); const createAgentMedia = () => { const upload = () => crypto.randomBytes(config.value); return {upload} }; const agentMedia = createAgentMedia(); exports.agentMedia = agentMedia")
  f.write('functions/index.js', "exports.alpha = require('./alpha'); exports.beta = require('./beta'); exports.media = require('./cmsAgentMedia')")
  const after = f.inventory()
  assert.ok(Object.keys(before).every(key => before[key].fingerprint === after[key].fingerprint))
  f.write('functions/cmsAgentMedia.js', "const crypto = require('node:crypto'); const config = require('./config'); const createAgentMedia = () => { global.changed = 1; const upload = () => crypto.randomBytes(config.value); return {upload} }; const agentMedia = createAgentMedia(); exports.agentMedia = agentMedia")
  const effects = f.inventory()
  assert.ok(Object.keys(before).every(key => before[key].fingerprint !== effects[key].fingerprint))
  f.write('functions/cmsAgentMedia.js', "const config = require('./config'); const createAgentMedia = ({reset = global.reset()} = {}) => { return {reset} }; const agentMedia = createAgentMedia(); exports.agentMedia = agentMedia")
  const parameterEffects = f.inventory()
  assert.ok(Object.keys(before).every(key => before[key].fingerprint !== parameterEffects[key].fingerprint))
})

test('unsupported lock formats and missing required peers cannot silently skip a consumer', t => {
  const f = fixture(t)
  f.lock.lockfileVersion = 1
  f.packages()
  assert.deepEqual(f.selected(), ['alpha-one', 'beta-two'])
  assert.ok(f.inventory()['us-central1/alpha-one'].inputSummary.configuration['unresolved package/lock inputs'])
  f.lock.lockfileVersion = 3
  f.lock.packages['node_modules/alpha-lib'].peerDependencies = { requiredPeer: '1' }
  f.packages()
  assert.ok(f.inventory()['us-central1/alpha-one'].inputSummary.configuration['unresolved package/lock inputs'])
  assert.equal(f.inventory()['us-central1/beta-two'].fingerprint, f.before['us-central1/beta-two'].fingerprint)
})

test('linked local package content cannot be accepted as a proven immutable dependency', t => {
  const f = fixture(t)
  f.lock.packages['node_modules/alpha-lib'] = { link: true, resolved: '../local-lib' }
  f.packages()
  assert.throws(() => f.inventory(), /immutable lock inputs for local runtime package alpha-lib/)
})

test('retired CLEARWATER_URL changes alone do not deploy; active environment values still do', t => {
  const f = fixture(t)
  f.write('functions/.env.prod', 'SHARED_SECRET=test-secret\nCLEARWATER_URL=https://retired.example.test\n')
  assert.deepEqual(f.selected(), [])
  const withRetired = f.inventory()
  f.write('functions/.env.prod', 'SHARED_SECRET=test-secret\n')
  const removed = f.inventory()
  for (const key of Object.keys(removed)) {
    assert.equal(removed[key].fingerprint, withRetired[key].fingerprint)
    assert.ok(!Object.hasOwn(removed[key].inputSummary.environment, '.env.prod:CLEARWATER_URL'))
  }
  f.write('functions/.env.prod', 'SHARED_SECRET=changed-secret\n')
  assert.deepEqual(f.selected(), ['alpha-one', 'beta-two'])
})

test('the retired-variable exception stops if production code references it again', t => {
  const f = fixture(t)
  for (const source of [
    'exports.one = onCall(() => process.env.CLEARWATER_URL)',
    "const name = 'CLEARWATER_URL'; exports.one = onCall(() => process.env[name])",
  ]) {
    f.write('functions/alpha.js', source)
    f.write('functions/.env.prod', 'CLEARWATER_URL=https://old.example.test\n')
    const before = f.inventory()
    f.write('functions/.env.prod', 'CLEARWATER_URL=https://new.example.test\n')
    const after = f.inventory()
    assert.ok(Object.keys(before).every(key => before[key].fingerprint !== after[key].fingerprint))
  }
})


test('another Hub includes every environment key unless it explicitly retires one', t => {
  const f = fixture(t)
  f.write('package.json', {})
  f.write('functions/.env.prod', 'CLEARWATER_URL=https://old.example.test\n')
  const before = f.inventory()
  f.write('functions/.env.prod', 'CLEARWATER_URL=https://new.example.test\n')
  const after = f.inventory()
  for (const key of Object.keys(before)) assert.notEqual(before[key].fingerprint, after[key].fingerprint)
})

test('invalid retired environment policy fails closed', t => {
  const f = fixture(t)
  for (const edgeDeploy of [null, [], { retiredEnvironmentKeys: null }, { retiredEnvironmentKeys: 'NAME' }, { retiredEnvironmentKeys: ['not a key'] }]) {
    f.write('package.json', { edgeDeploy })
    assert.throws(() => f.inventory(), /edgeDeploy/)
  }
})
