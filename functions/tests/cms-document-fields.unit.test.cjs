// The field tables in the contracts (CMS_DOCUMENT_FIELDS) must match the
// documents the operations store: every key a stored document has is
// described, and every described field is stored or says who writes it.
// Releases are checked in cms-block-releases.unit.test.cjs, which runs the
// worker.
const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { existsSync } = require('node:fs')
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

test('the documents the operations store match their field tables', async () => {
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  const { createCmsThemeDefaults } = await import(path.join(functionRoot, 'helpers/cmsThemeDefaults.mjs'))
  const { blockDefinitionHash } = await import(path.join(functionRoot, 'helpers/cmsBlockRevisions.mjs'))
  const fake = createFakeDb({
    [ORG]: { name: 'Org' },
    [`${ORG}/themes/theme1`]: { docId: 'theme1', name: 'Main', theme: JSON.stringify(createCmsThemeDefaults()), headJSON: '{}', extraCSS: '', defaultMenus: { 'Site Root': [{ name: 'home', menuTitle: 'Home', item: 'tplHome' }], 'Not In Menu': [] } },
    [`${ORG}/sites/templates/pages/tplHome`]: { name: 'Home', content: [], structure: [] },
    [`${ORG}/sites/site1`]: { docId: 'site1', name: 'Site', theme: 'theme1', menus: { 'Site Root': [], 'Not In Menu': [] } },
  })
  const ops = loadOperations(fake.db)
  const run = async (operation) => {
    const plan = await ops.checkOperation({ auth: { uid: 'dev' }, data: { uid: 'dev', orgId: 'org1', operation } })
    assert.equal(plan.blocked, false, `${operation.type}: ${plan.problems.join(' ')}`)
    return ops.runOperation({ auth: { uid: 'dev' }, data: { uid: 'dev', orgId: 'org1', operation, checksum: plan.checksum } })
  }
  const template = '<section class="bg-canvas text-text"><h1>{{ headline }}</h1></section>'
  const site = await run({ type: 'site.create', name: 'New', theme: 'theme1', domains: ['new.example.com'] })
  const post = await run({ type: 'post.create', siteId: 'site1', title: 'News', blurb: 'Short' })
  await run({ type: 'theme.create', themeId: 'theme2', fields: { name: 'Two' } })
  await run({ type: 'block.create', block: { docId: 'hero', name: 'Hero', content: template, template, templateVersion: 2, schema: { headline: { type: 'text', label: 'Headline', value: 'Hi' } }, dataSources: {}, values: {}, tags: [], themes: ['theme1'], synced: false, version: 1 } })
  const library = fake.docs.get(`${ORG}/blocks/hero`)
  const edited = template.replace(/h1>/g, 'h2>')
  const draft = await run({ type: 'block.draft', blockId: 'hero', definition: { ...library, content: edited, template: edited }, baseHash: blockDefinitionHash(library) })

  const stored = {
    'site': [fake.docs.get(`${ORG}/sites/${site.result.siteId}`)],
    'post': [fake.docs.get(`${ORG}/sites/site1/posts/${post.result.postId}`)],
    'theme': [fake.docs.get(`${ORG}/themes/theme2`)],
    'library-block': [fake.docs.get(`${ORG}/blocks/hero`)],
    // Revision 0 (the baseline the first draft creates) and the draft.
    'revision': [fake.docs.get(`${ORG}/blocks/hero/revisions/0`), fake.docs.get(`${ORG}/blocks/hero/revisions/${draft.result.draftRevision}`)],
  }
  const writerKinds = Object.keys(core.CMS_DOCUMENT_FIELDS).filter(kind => core.CMS_DOCUMENT_FIELDS[kind].writer && kind !== 'release')
  assert.deepEqual(Object.keys(stored).sort(), writerKinds.sort())
  for (const [kind, docs] of Object.entries(stored)) {
    assert.ok(docs.every(Boolean), kind)
    assert.deepEqual(core.documentFieldGaps(kind, Object.assign({}, ...docs)), { undescribed: [], unwritten: [], duplicates: [] }, kind)
  }
})
