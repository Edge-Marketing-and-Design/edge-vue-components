// The operation specs (CMS_OPERATION_SPECS) are the contract agents read, so
// they must say exactly what the checks enforce: every operation has a spec,
// every problem a check reports has a registered code, a valid example of
// each operation passes, and breaking any declared rule is refused.
const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { existsSync, readFileSync } = require('node:fs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')
const { createFakeDb } = require('./support/fakeFirestore.cjs')

process.env.KV_MIRROR_DISABLED = '1'
process.env.EDGE_ERROR_REPORTING = 'false'

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    this.details = details
  }
}

const loadOperations = (db) => {
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const modules = ['cmsOperations.js', 'cmsBlockRevisions.js'].map(file => require.resolve(path.join(functionRoot, file)))
  const originalConfig = require.cache[configPath]
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      db,
      logger: { log() {}, warn() {}, error() {}, info() {} },
      onCall: (_options, handler) => handler,
      HttpsError,
      permissionCheck: async () => true,
    },
  }
  modules.forEach(file => delete require.cache[file])
  try {
    return require(path.join(functionRoot, 'cmsOperations.js'))
  }
  finally {
    modules.forEach(file => delete require.cache[file])
    if (originalConfig)
      require.cache[configPath] = originalConfig
    else
      delete require.cache[configPath]
  }
}

const ORG = 'organizations/org1'
const template = '<section><h1>{{ headline }}</h1></section>'
const block = { docId: 'hero', name: 'Hero', content: template, template, templateVersion: 2, schema: { headline: { type: 'text', label: 'Headline', value: 'Hello' } }, dataSources: {}, values: {}, meta: {}, tags: [], themes: ['theme1'], type: ['Page', 'Post'], synced: false, version: 1, releasedRevision: 1, draftRevision: null }
const seed = () => ({
  [`${ORG}`]: { name: 'Org' },
  [`${ORG}/themes/theme1`]: { docId: 'theme1', name: 'Main', theme: '{}', headJSON: '{}', extraCSS: '' },
  [`${ORG}/blocks/hero`]: block,
  [`${ORG}/sites/site1`]: { docId: 'site1', name: 'Site', theme: 'theme1', menus: { 'Site Root': [{ name: 'about', menuTitle: 'About', item: 'about' }], 'Not In Menu': [] } },
  [`${ORG}/sites/site1/pages/about`]: { docId: 'about', name: 'about', content: [], structure: [], blockIds: [], version: 1 },
})

const call = (handler, operation) => handler({ auth: { uid: 'dev' }, data: { uid: 'dev', orgId: 'org1', operation } })
// A check's verdict: refused (thrown or with problems) or accepted.
const verdict = async (ops, operation) => {
  try {
    const plan = await call(ops.checkOperation, operation)
    return { refused: plan.blocked, plan }
  }
  catch (error) {
    return { refused: true, error }
  }
}
// A world where every operation has something valid to act on, built through
// the operations themselves, and a valid example of each operation in it.
const setup = async () => {
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  const { blockDefinitionHash } = await import(path.join(functionRoot, 'helpers/cmsBlockRevisions.mjs'))
  const fake = createFakeDb(seed())
  const ops = loadOperations(fake.db)
  const runChecked = async (operation) => {
    const plan = await call(ops.checkOperation, operation)
    assert.equal(plan.blocked, false, `${operation.type}: ${plan.problems.join(' ')}`)
    return ops.runOperation({ auth: { uid: 'dev' }, data: { uid: 'dev', orgId: 'org1', operation, checksum: plan.checksum } })
  }
  const place = async () => (await runChecked({ type: 'page.placeBlock', siteId: 'site1', pageId: 'about', blockId: 'hero', values: { headline: 'One' } })).result.instanceId
  const first = await place()
  await place()
  const post = (await runChecked({ type: 'post.create', siteId: 'site1', title: 'News', blurb: 'Short' })).result.postId
  const placePost = async () => (await runChecked({ type: 'post.placeBlock', siteId: 'site1', postId: post, blockId: 'hero', values: { headline: 'One' } })).result.instanceId
  const postInstance = await placePost()
  await placePost()
  const examples = {
    'theme.create': { fields: { name: 'New theme' } },
    'theme.update': { themeId: 'theme1', fields: { extraCSS: '.a{}' } },
    'theme.propose': { themeId: 'theme1', fields: { extraCSS: '.a{}' }, note: 'Spacing' },
    'site.create': { name: 'Second', theme: 'theme1', domains: ['example.com'] },
    'site.update': { siteId: 'site1', fields: { metaTitle: 'Site' } },
    'page.create': { siteId: 'site1', name: 'New page' },
    'page.update': { siteId: 'site1', pageId: 'about', fields: { metaTitle: 'About' } },
    'page.placeBlock': { siteId: 'site1', pageId: 'about', blockId: 'hero', values: { headline: 'Hi' } },
    'page.setValues': { siteId: 'site1', pageId: 'about', instanceId: first, values: { headline: 'Changed' } },
    'page.removeBlock': { siteId: 'site1', pageId: 'about', instanceId: first },
    'page.moveBlock': { siteId: 'site1', pageId: 'about', instanceId: first, index: 1 },
    'block.create': { block: { ...block, docId: 'cta', name: 'CTA' } },
    'block.draft': { blockId: 'hero', definition: { content: '<section><h2>{{ headline }}</h2></section>' }, baseHash: blockDefinitionHash(block) },
    'post.create': { siteId: 'site1', title: 'Another', blurb: 'Preview' },
    'post.update': { siteId: 'site1', postId: post, fields: { title: 'Renamed' } },
    'post.placeBlock': { siteId: 'site1', postId: post, blockId: 'hero', values: { headline: 'Hi' } },
    'post.setValues': { siteId: 'site1', postId: post, instanceId: postInstance, values: { headline: 'Changed' } },
    'post.moveBlock': { siteId: 'site1', postId: post, instanceId: postInstance, index: 1 },
    'post.removeBlock': { siteId: 'site1', postId: post, instanceId: postInstance },
  }
  return { core, ops, examples }
}

test('every operation type has a spec, and every spec field has a known type', async () => {
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  assert.deepEqual(Object.keys(core.CMS_OPERATION_SPECS).sort(), [...core.CMS_OPERATION_TYPES].sort())
  for (const [type, spec] of Object.entries(core.CMS_OPERATION_SPECS)) {
    assert.ok(['site', 'organization'].includes(spec.scope), type)
    assert.ok(['themes', 'sites', 'blocks'].includes(spec.writes), type)
    for (const [name, field] of Object.entries(spec.input))
      assert.ok(['docId', 'string', 'text', 'boolean', 'integer', 'object', 'list', 'json'].includes(field.type), `${type}.${name}`)
  }
})

test('every problem code a check reports is registered and explained, and every registered code is reported', async () => {
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  const source = readFileSync(path.join(functionRoot, 'cmsOperations.js'), 'utf8')
  const used = new Set([...source.matchAll(/problem\(plan, '([a-z0-9.-]+)'/g)].map(match => match[1]))
  const registered = Object.keys(core.CMS_OPERATION_PROBLEMS)
  assert.deepEqual([...used].filter(code => !registered.includes(code)), [], 'codes used but not registered')
  assert.deepEqual(registered.filter(code => !used.has(code)), [], 'codes registered but never reported')
  assert.ok(!/plan\.problems\.push\(/.test(source.replace(/const problem = [\s\S]*?\n}\n/, '')), 'every problem goes through problem() with a code')
  for (const [type, spec] of Object.entries(core.CMS_OPERATION_SPECS)) {
    for (const code of spec.problems)
      assert.ok(registered.includes(code), `${type} lists unknown code ${code}`)
  }
  for (const [code, text] of Object.entries(core.CMS_OPERATION_PROBLEMS))
    assert.ok(text.length > 10, code)
})

test('a valid example of every operation passes its check', async () => {
  const { core, ops, examples } = await setup()
  assert.deepEqual(Object.keys(examples).sort(), [...core.CMS_OPERATION_TYPES].sort())
  for (const [type, input] of Object.entries(examples)) {
    const { refused, plan, error } = await verdict(ops, { type, ...input })
    assert.equal(refused, false, `${type}: ${error?.message || plan.problems.join(' ')}`)
    assert.deepEqual(plan.problemCodes, [], type)
  }
})

test('breaking any declared rule is refused: required fields, allowed values, allowed keys and closed operations', async () => {
  const { core, ops, examples } = await setup()
  for (const [type, spec] of Object.entries(core.CMS_OPERATION_SPECS)) {
    const example = { type, ...examples[type] }
    for (const [name, field] of Object.entries(spec.input)) {
      if (field.required) {
        const { [name]: _removed, ...without } = example
        assert.equal((await verdict(ops, without)).refused, true, `${type} without ${name}`)
      }
      if (field.values)
        assert.equal((await verdict(ops, { ...example, [name]: 'not-an-allowed-value' })).refused, true, `${type} with a ${name} outside ${field.values.join(', ')}`)
      if (field.fields && field.type === 'object' && name === 'fields')
        assert.equal((await verdict(ops, { ...example, fields: { ...(example.fields || {}), notAField: 'x' } })).refused, true, `${type} with fields.notAField`)
      if (field.max)
        assert.equal((await verdict(ops, { ...example, [name]: 'x'.repeat(field.max + 1) })).refused, true, `${type} with a ${name} over ${field.max}`)
    }
    if (spec.closed)
      assert.equal((await verdict(ops, { ...example, notAKey: 'x' })).refused, true, `${type} with an undeclared key`)
  }
})

test('refusals carry their codes beside the messages, and each code is one the operation declares', async () => {
  const { core, ops, examples } = await setup()
  const cases = [
    [{ type: 'theme.update', ...examples['theme.update'], themeId: 'missing' }, 'theme.not-found'],
    [{ type: 'page.setValues', ...examples['page.setValues'], instanceId: 'missing' }, 'instance.not-found'],
    [{ type: 'post.create', siteId: 'site1', title: 'T', blurb: 'x'.repeat(core.POST_BLURB_MAX + 1) }, 'post.blurb-too-long'],
    [{ type: 'block.draft', ...examples['block.draft'], baseHash: 'stale' }, 'block.changed'],
  ]
  for (const [operation, code] of cases) {
    const plan = await call(ops.checkOperation, operation)
    assert.equal(plan.problems.length, plan.problemCodes.length, operation.type)
    assert.ok(plan.problemCodes.includes(code), `${operation.type}: ${plan.problemCodes.join(', ')}`)
    for (const reported of plan.problemCodes)
      assert.ok(core.CMS_OPERATION_SPECS[operation.type].problems.includes(reported), `${operation.type} reports undeclared ${reported}`)
  }
})

test('the generated operations contract lists every operation, input and problem code', async () => {
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  const markdown = core.renderOperationsContract()
  for (const [type, spec] of Object.entries(core.CMS_OPERATION_SPECS)) {
    assert.ok(markdown.includes(`### \`${type}\``), type)
    for (const name of Object.keys(spec.input))
      assert.ok(markdown.includes(`| \`${name}\` |`), `${type}.${name}`)
  }
  for (const code of Object.keys(core.CMS_OPERATION_PROBLEMS))
    assert.ok(markdown.includes(`| \`${code}\` |`), code)
  const served = core.withGeneratedOperations(`# Title\n\n${core.OPERATIONS_CONTRACT_MARKER}\n\n## Notes\n`)
  assert.ok(served.startsWith('# Title\n\n## Operations'))
  assert.ok(served.endsWith('## Notes\n'))
})
