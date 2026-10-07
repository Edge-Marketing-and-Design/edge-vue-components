import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildDocumentDiff,
  buildWorkspaceStatus,
  collectBlockReferences,
  createCmsToolService,
  hashDocument,
  resolveCmsOrganization,
  resolveVueOverride,
  validateBlockDocument,
  validateBlockWithRender,
} from '../src/cms-tools.js'

test('organization resolution enforces configured tenants including the default', () => {
  const config = { defaultOrgId: 'allowed', allowedOrganizationIds: ['allowed'] }
  assert.equal(resolveCmsOrganization('', config), 'allowed')
  assert.equal(resolveCmsOrganization(' allowed ', config), 'allowed')
  assert.throws(() => resolveCmsOrganization('other', config), /outside allowedOrganizationIds/)
  assert.throws(() => resolveCmsOrganization('', { ...config, defaultOrgId: 'other' }), /outside allowedOrganizationIds/)
  assert.throws(() => resolveCmsOrganization('allowed/blocks', config), /orgId/)
  assert.throws(() => resolveCmsOrganization('allowed', { allowedOrganizationIds: 'allowed' }), /must be an array/)
  assert.equal(resolveCmsOrganization('other', {}), 'other')
})

test('CMS reads reject disallowed organizations before accessing Firestore', async () => {
  let reads = 0
  const db = {
    doc() {
      reads++
      throw new Error('Unexpected Firestore read')
    },
    collection() {
      reads++
      throw new Error('Unexpected Firestore read')
    },
  }
  const service = createCmsToolService({
    db,
    config: { defaultOrgId: 'other', allowedOrganizationIds: ['allowed'] },
    projectId: 'test-project',
    repoRoot: os.tmpdir(),
  })
  for (const name of ['readProductionBlock', 'readProductionTheme', 'findBlock', 'findTheme', 'findUsage', 'auditBlocks', 'resolveOverride']) {
    await assert.rejects(service[name]({ orgId: 'other', docId: 'hero', themeId: 'theme' }), /outside allowedOrganizationIds/, name)
    await assert.rejects(service[name]({ docId: 'hero', themeId: 'theme' }), /outside allowedOrganizationIds/, `${name} default`)
  }
  assert.equal(reads, 0)
})

test('hashDocument is stable across object key ordering', () => {
  assert.equal(
    hashDocument({ name: 'Hero', schema: { body: {}, heading: {} } }),
    hashDocument({ schema: { heading: {}, body: {} }, name: 'Hero' }),
  )
  assert.notEqual(
    hashDocument({ name: 'Hero', tags: ['one', 'two'] }),
    hashDocument({ name: 'Hero', tags: ['two', 'one'] }),
  )
})

test('buildWorkspaceStatus distinguishes safe and stale checkout states', () => {
  const base = { docId: 'hero', content: '<h1>Base</h1>' }
  const manifest = { baseHash: hashDocument(base) }

  assert.equal(buildWorkspaceStatus({ manifest, base, local: base, production: base }).status, 'clean')
  assert.equal(buildWorkspaceStatus({
    manifest,
    base,
    local: { ...base, content: '<h1>Local</h1>' },
    production: base,
  }).status, 'local-changed')
  assert.equal(buildWorkspaceStatus({
    manifest,
    base,
    local: base,
    production: { ...base, content: '<h1>Production</h1>' },
  }).status, 'production-changed')
  assert.equal(buildWorkspaceStatus({
    manifest,
    base,
    local: { ...base, content: '<h1>Local</h1>' },
    production: { ...base, content: '<h1>Production</h1>' },
  }).status, 'diverged')
  assert.equal(buildWorkspaceStatus({
    manifest,
    base,
    local: { ...base, content: '<h1>Shared</h1>' },
    production: { ...base, content: '<h1>Shared</h1>' },
  }).status, 'local-matches-production')
  assert.equal(buildWorkspaceStatus({
    manifest,
    base: { ...base, content: '<h1>Tampered base</h1>' },
    local: base,
    production: base,
  }).status, 'invalid-checkout')
})

test('buildDocumentDiff reports field paths and readable markup changes', () => {
  const result = buildDocumentDiff(
    { content: '<section>\n  <h1>Old</h1>\n</section>', schema: { heading: { value: 'Old' } } },
    { content: '<section>\n  <h1>New</h1>\n</section>', schema: { heading: { value: 'New' } } },
  )

  assert.equal(result.equal, false)
  assert.deepEqual(result.changedTopLevelFields, ['content', 'schema'])
  assert.deepEqual(result.changes.map(change => change.path), ['content', 'schema.heading.value'])
  assert.match(result.changes[0].textDiff, /- {2}<h1>Old<\/h1>/)
  assert.match(result.changes[0].textDiff, /\+ {2}<h1>New<\/h1>/)
})

test('resolveVueOverride mirrors org-scoped preference and CMS fallback', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-override-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const blocksRoot = path.join(tempRoot, 'app/blocks')
  await mkdir(path.join(blocksRoot, 'clearwater-org-123'), { recursive: true })
  await writeFile(path.join(blocksRoot, 'cmpthemeListingActions.vue'), '<template />\n')
  await writeFile(
    path.join(blocksRoot, 'clearwater-org-123/cmpthemeListingActions.vue'),
    '<template />\n',
  )

  const resolved = await resolveVueOverride({
    rendererRepoPath: tempRoot,
    orgId: 'org-123',
    blockName: 'Cmptheme Listing Actions',
  })
  assert.equal(resolved.status, 'vue-override')
  assert.equal(
    resolved.selectedMatch.relativePath,
    path.join('clearwater-org-123', 'cmpthemeListingActions.vue'),
  )
  assert.equal(resolved.selectedMatch.scope, 'organization')

  const fallback = await resolveVueOverride({
    rendererRepoPath: tempRoot,
    orgId: 'org-123',
    blockName: 'Ordinary CMS Hero',
  })
  assert.equal(fallback.status, 'cms-html')
  assert.equal(fallback.selectedMatch, null)
})

test('validateBlockDocument checks Template v2 mirrors and source declarations', () => {
  const validBlock = {
    docId: 'agent-grid',
    name: 'Agent Grid',
    content: '<section><div class="{{ loading }}"></div><div class="{{ loaded }}">{{#for agent in source("agents")}}{{ agent.name }}{{/for}}</div></section>',
    template: '<section><div class="{{ loading }}"></div><div class="{{ loaded }}">{{#for agent in source("agents")}}{{ agent.name }}{{/for}}</div></section>',
    templateVersion: 2,
    schema: {},
    dataSources: { agents: { type: 'collection', path: 'users' } },
    values: {},
    tags: [],
    themes: [],
    type: ['Page'],
  }
  const validResult = validateBlockDocument(validBlock, {
    override: { status: 'cms-html' },
  })
  assert.deepEqual(validResult.errors, [])
  assert.deepEqual(validResult.sourceCalls, ['agents'])
  assert.equal(validResult.renderingOwner, 'cms')

  const invalidResult = validateBlockDocument({
    ...validBlock,
    content: '{{#if agent.name}}{{#for agent in source("missing")}}{{ agent.name }}{{/for}}',
    template: '{{#if agent.name}}{{#for agent in source("missing")}}{{ agent.name }}{{/for}}',
  }, {
    override: { status: 'cms-html' },
  })
  assert.ok(invalidResult.errors.some(message => message.includes('does not declare')))
  assert.ok(invalidResult.errors.some(message => message.includes('triple-brace')))
})

test('validateBlockDocument rejects a CMS contact form captured by a Vue override', () => {
  const result = validateBlockDocument({
    docId: 'contact',
    name: 'Contact',
    content: '<form class="cms-form" data-cms-form></form>',
    template: '<form class="cms-form" data-cms-form></form>',
    templateVersion: 2,
    schema: {},
    dataSources: {},
    values: {},
    tags: [],
    themes: [],
    type: ['Page'],
  }, {
    override: {
      status: 'vue-override',
      selectedMatch: { relativePath: 'clearwater/contact.vue' },
    },
  })

  assert.ok(result.errors.some(message => message.includes('Contact forms must remain CMS-rendered')))
  assert.equal(result.renderingOwner, 'public-frontend-vue-override')
})

test('collectBlockReferences finds page and post block instances by library blockId', () => {
  const references = collectBlockReferences({
    content: [
      { id: 'page-instance', blockId: 'hero', name: 'Page Hero' },
    ],
    postContent: [
      { id: 'post-instance', blockId: 'hero', name: 'Post Hero' },
      { id: 'other-instance', blockId: 'other' },
    ],
  }, 'hero')

  assert.deepEqual(references, [
    {
      fieldPath: 'content[0]',
      instanceId: 'page-instance',
      instanceName: 'Page Hero',
    },
    {
      fieldPath: 'postContent[0]',
      instanceId: 'post-instance',
      instanceName: 'Post Hero',
    },
  ])
})

test('checkout writes an immutable base and refuses to overwrite local edits', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-checkout-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const rendererRoot = path.join(tempRoot, 'emd-cms-front')
  await mkdir(path.join(rendererRoot, 'app/blocks'), { recursive: true })

  const documentPath = 'organizations/org-123/blocks/hero'
  const productionBlock = {
    docId: 'ignored-production-doc-id',
    name: 'Ordinary CMS Hero',
    content: '<section>Production</section>',
    template: '<section>Production</section>',
    templateVersion: 2,
    schema: {},
    dataSources: {},
    values: {},
    tags: [],
    themes: [],
    type: ['Page'],
  }
  const db = createFakeFirestore({
    documents: {
      [documentPath]: productionBlock,
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: rendererRoot,
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })

  const checkout = await service.checkoutBlock({ docId: 'hero' })
  const checkedOutBlock = JSON.parse(await readFile(checkout.workspace.local, 'utf8'))
  const checkedOutBase = JSON.parse(await readFile(checkout.workspace.base, 'utf8'))
  const manifest = JSON.parse(await readFile(checkout.workspace.manifest, 'utf8'))
  assert.equal(checkedOutBlock.docId, 'hero')
  assert.deepEqual(checkedOutBlock, checkedOutBase)
  assert.equal(manifest.baseHash, hashDocument(checkedOutBlock))

  checkedOutBlock.content = '<section>Local edit</section>'
  checkedOutBlock.template = checkedOutBlock.content
  await writeFile(checkout.workspace.local, `${JSON.stringify(checkedOutBlock, null, 2)}\n`)

  await assert.rejects(
    service.checkoutBlock({ docId: 'hero' }),
    /Local checkout has changes/,
  )
  const status = await service.status({ docId: 'hero' })
  assert.equal(status.status, 'local-changed')
})

test('checkout refuses a production block that cannot be copied without redacted values', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-redaction-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const db = createFakeFirestore({
    documents: {
      'organizations/org-123/blocks/private-block': {
        name: 'Private Block',
        content: '<section />',
        apiKey: 'server-secret',
      },
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => ({ ...value, apiKey: '[REDACTED]' }),
    repoRoot: tempRoot,
  })

  await assert.rejects(
    service.checkoutBlock({ docId: 'private-block' }),
    /local copy would not be lossless/,
  )
})

test('findUsage scans site pages and templates without Firestore writes', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-usage-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const db = createFakeFirestore({
    collections: {
      'organizations/org-123/sites': {
        'site-one': { name: 'Site One' },
      },
      'organizations/org-123/sites/site-one/pages': {
        home: {
          name: 'Home',
          content: [{ id: 'hero-instance', blockId: 'hero', name: 'Hero' }],
        },
      },
      'organizations/org-123/sites/templates/pages': {
        'post-template': {
          name: 'Article',
          post: true,
          postContent: [{ id: 'post-hero', blockId: 'hero', name: 'Hero' }],
        },
      },
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })

  const result = await service.findUsage({ docId: 'hero' })
  assert.equal(result.usageCount, 2)
  assert.deepEqual(result.usages.map(usage => [usage.siteId, usage.pageId]), [
    ['site-one', 'home'],
    ['templates', 'post-template'],
  ])
  assert.equal(db.writeCalls, 0)
})

test('findTheme supports exact ids and bounded visible-name searches', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-theme-find-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const collectionPath = 'organizations/org-123/themes'
  const db = createFakeFirestore({
    documents: {
      [`${collectionPath}/clearwater-main`]: {
        name: 'Clearwater Main',
        theme: '{}',
        headJSON: '{}',
        extraCSS: '.cw-card {}',
        defaultMenus: {},
      },
    },
    collections: {
      [collectionPath]: {
        'clearwater-main': {
          name: 'Clearwater Main',
          theme: '{}',
          headJSON: '{}',
          extraCSS: '.cw-card {}',
          defaultMenus: {},
        },
        'clearwater-secondary': {
          name: 'Clearwater Secondary',
          theme: '{}',
          headJSON: '{}',
          extraCSS: '',
          defaultMenus: {},
        },
        'editorial': {
          name: 'Editorial',
          theme: '{}',
          headJSON: '{}',
          extraCSS: '',
          defaultMenus: {},
        },
      },
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      maxCmsThemeResultLimit: 10,
      maxCmsThemeScanDocuments: 10,
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })

  const exact = await service.findTheme({ docId: 'clearwater-main' })
  assert.equal(exact.matches.length, 1)
  assert.equal(exact.matches[0].name, 'Clearwater Main')
  assert.equal(exact.matches[0].themeJSONValid, true)

  const searched = await service.findTheme({ query: 'clearwater', limit: 1 })
  assert.equal(searched.matchedDocuments, 2)
  assert.equal(searched.returnedDocuments, 1)
  assert.equal(searched.resultTruncated, true)
  assert.equal(db.writeCalls, 0)
})

test('getTheme returns raw and parsed production surfaces, defaults, and linked custom fonts', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-theme-get-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const themeId = 'clearwater-main'
  const themePath = `organizations/org-123/themes/${themeId}`
  const filesPath = 'organizations/org-123/files'
  const fontURL = 'https://files.example.com/theme-sans.woff2'
  const themeRaw = '{\n  "extend": { "colors": { "brand": "#003E52" } }\n}'
  const headRaw = JSON.stringify({
    link: [{ rel: 'preload', href: fontURL }],
    style: [{
      children: `@font-face { font-family: "Theme Sans"; src: url("${fontURL}"); font-weight: 400; font-style: normal; font-display: swap; }`,
    }],
  }, null, 2)
  const db = createFakeFirestore({
    documents: {
      [themePath]: {
        docId: 'stale-doc-id',
        name: 'Clearwater Main',
        version: 4,
        theme: themeRaw,
        headJSON: headRaw,
        extraCSS: '.cw-card { color: var(--brand); }',
        defaultMenus: {
          'Site Root': [
            { name: 'home', item: 'page-home' },
            { menuTitle: 'About', item: { about: [{ name: 'team', item: 'page-team' }] } },
            { name: 'external', item: { type: 'external', url: 'https://example.com' } },
          ],
          'Not In Menu': [],
        },
        defaultPages: [{ pageId: 'page-contact', name: 'Contact' }],
        defaultSiteSettings: { theme: themeId, name: 'New Site' },
      },
    },
    collections: {
      [filesPath]: {
        'font-main': {
          name: 'Theme Sans Regular',
          fileName: 'theme-sans.woff2',
          contentType: 'font/woff2',
          r2URL: fontURL,
          uploadCompletedToR2: true,
          meta: {
            cmsFont: true,
            themeId,
            fontGroupId: 'theme-sans',
            autoLink: false,
          },
        },
        'theme-image': {
          name: 'Not a font',
          meta: { cmsFont: false, themeId },
        },
        'other-font': {
          name: 'Other Theme Font',
          meta: { cmsFont: true, themeId: 'other-theme' },
        },
      },
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      maxCmsThemeFontDocuments: 1,
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })

  const result = await service.getTheme({ themeId })
  assert.equal(result.themeId, themeId)
  assert.equal(result.name, 'Clearwater Main')
  assert.equal(result.themeJSON.raw, themeRaw)
  assert.equal(result.themeJSON.parsed.extend.colors.brand, '#003E52')
  assert.equal(result.headJSON.raw, headRaw)
  assert.equal(result.extraCSS, '.cw-card { color: var(--brand); }')
  assert.deepEqual(result.defaultTemplates.referencedTemplatePageIds, [
    'page-contact',
    'page-home',
    'page-team',
  ])
  assert.equal(result.customFonts.fontCount, 1)
  assert.equal(result.customFonts.scanTruncated, true)
  assert.equal(result.customFonts.fonts[0].linkedInHeadJSON, true)
  assert.deepEqual(result.customFonts.fonts[0].headFontFace, {
    fontFamily: 'Theme Sans',
    fontWeight: '400',
    fontStyle: 'normal',
    fontDisplay: 'swap',
  })
  assert.equal(result.customFonts.fonts[0].autoLink, false)
  assert.equal(db.writeCalls, 0)
})

test('getTheme reports invalid stored JSON and can omit the custom-font query', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-theme-invalid-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const db = createFakeFirestore({
    documents: {
      'organizations/org-123/themes/broken-theme': {
        name: 'Broken Theme',
        theme: '{ invalid',
        headJSON: '',
        extraCSS: '',
      },
    },
  })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })

  const result = await service.getTheme({
    themeId: 'broken-theme',
    includeCustomFonts: false,
  })
  assert.equal(result.themeJSON.valid, false)
  assert.match(result.themeJSON.error, /theme is not valid JSON/)
  assert.equal(result.headJSON.valid, true)
  assert.equal(result.customFonts.included, false)
  assert.equal(db.readQueries.length, 0)
  assert.equal(db.writeCalls, 0)
})

function createFakeFirestore({ documents = {}, collections = {} }) {
  const db = {
    writeCalls: 0,
    readQueries: [],
    doc(documentPath) {
      return {
        async get() {
          return createFakeSnapshot(documentPath, documents[documentPath])
        },
      }
    },
    collection(collectionPath) {
      return createFakeQuery(db, collectionPath, collections[collectionPath] || {})
    },
  }
  return db
}

function createFakeQuery(db, collectionPath, collectionData, filters = [], limitValue = Infinity) {
  return {
    where(fieldPath, operator, value) {
      if (operator !== '==')
        throw new Error(`Unsupported fake query operator: ${operator}`)
      return createFakeQuery(
        db,
        collectionPath,
        collectionData,
        [...filters, { fieldPath, value }],
        limitValue,
      )
    },
    limit(nextLimit) {
      return createFakeQuery(db, collectionPath, collectionData, filters, nextLimit)
    },
    async get() {
      db.readQueries.push({ collectionPath, filters, limit: limitValue })
      const entries = Object.entries(collectionData)
        .filter(([, data]) => filters.every(({ fieldPath, value }) => {
          return getNestedValue(data, fieldPath) === value
        }))
        .slice(0, limitValue)
      const docs = entries.map(([docId, data]) => createFakeSnapshot(
        `${collectionPath}/${docId}`,
        data,
      ))
      return { size: docs.length, docs }
    },
  }
}

function getNestedValue(value, fieldPath) {
  return String(fieldPath || '').split('.').reduce((current, segment) => current?.[segment], value)
}

function createFakeSnapshot(documentPath, data) {
  const docId = documentPath.split('/').at(-1)
  const timestamp = {
    toDate: () => new Date('2026-07-23T12:00:00.000Z'),
  }
  return {
    id: docId,
    exists: data !== undefined,
    ref: { path: documentPath },
    createTime: timestamp,
    updateTime: timestamp,
    data: () => structuredClone(data),
  }
}

const sharedBlock = (overrides = {}) => ({
  docId: 'agent-grid',
  name: 'Agent Grid',
  templateVersion: 2,
  content: '<section class="{{ loading }}"><ul class="{{ loaded }}">{{#for agent in source("agents")}}<li>{{ agent.name }}</li>{{/for}}</ul></section>',
  template: '<section class="{{ loading }}"><ul class="{{ loaded }}">{{#for agent in source("agents")}}<li>{{ agent.name }}</li>{{/for}}</ul></section>',
  schema: {},
  dataSources: { agents: { type: 'collection', path: 'users', value: [] } },
  values: {},
  tags: [],
  themes: [],
  type: ['Page'],
  ...overrides,
})

test('validateBlockDocument keeps the MCP response shape and adds structured issues', () => {
  const result = validateBlockDocument(sharedBlock(), { override: { status: 'cms-html' } })
  assert.deepEqual(Object.keys(result), ['templateVersion', 'renderingOwner', 'declaredSources', 'sourceCalls', 'errors', 'warnings', 'info', 'issues'])
  assert.equal(result.templateVersion, 2)
  assert.deepEqual(result.declaredSources, ['agents'])
  assert.deepEqual(result.sourceCalls, ['agents'])
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.info, ['Public rendering falls back to CMS HTML when no deployed override matches.'])

  const invalid = validateBlockDocument(sharedBlock({ docId: '', template: '<div>{{{/if}}}</div>', content: '<div>{{{/if}}}</div>' }), { override: { status: 'cms-html' } })
  for (const message of invalid.errors)
    assert.equal(typeof message, 'string')
  const codes = invalid.issues.map(issue => issue.code)
  assert.ok(codes.includes('shape.doc-id'))
  assert.ok(codes.includes('grammar.unbalanced-block'))
  for (const issue of invalid.issues)
    assert.deepEqual(Object.keys(issue), ['code', 'severity', 'path', 'message'])
})

test('validateBlockDocument keeps the MCP override diagnostics', () => {
  const ambiguous = validateBlockDocument(sharedBlock(), { override: { status: 'ambiguous-vue-override' } })
  assert.ok(ambiguous.errors.some(message => message.includes('multiple')))
  assert.equal(ambiguous.info.length, 0)
  const unavailable = validateBlockDocument(sharedBlock(), { override: { status: 'renderer-repo-unavailable' } })
  assert.ok(unavailable.warnings.some(message => message.includes('renderer checkout is unavailable')))
  const vue = validateBlockDocument(sharedBlock(), { override: { status: 'vue-override', selectedMatch: { relativePath: 'org/agentGrid.vue' } } })
  assert.deepEqual(vue.info, ['Public rendering resolves to Vue override org/agentGrid.vue.'])
  assert.equal(vue.renderingOwner, 'public-frontend-vue-override')
})

test('validateBlockDocument does not require Hub-only keys the MCP never required', () => {
  const block = sharedBlock()
  delete block.tags
  delete block.themes
  const result = validateBlockDocument(block, { override: { status: 'cms-html' } })
  assert.deepEqual(result.errors, [])
})

test('validateBlockWithRender adds render checks with sample Data Source records', async () => {
  const valid = await validateBlockWithRender(sharedBlock(), { override: { status: 'cms-html' } })
  assert.deepEqual(valid.errors, [])
  assert.equal(valid.issues.some(issue => issue.code === 'render.skipped'), false, 'the Hub template engine was found')

  const broken = '<section class="{{ loading }}"><ul class="{{ loaded }}">{{#for agent in source("agents")}}<li>{{ money(agent.price }}</li>{{/for}}</ul></section>'
  const result = await validateBlockWithRender(sharedBlock({ template: broken, content: broken }), { override: { status: 'cms-html' } })
  assert.ok(result.issues.some(issue => issue.code === 'render.unresolved-syntax'))
  assert.ok(result.errors.some(message => message.includes('sample-source render left template syntax')))
})

test('validateBlockWithRender reports skipped render checks without an engine', async () => {
  const result = await validateBlockWithRender(sharedBlock(), { override: { status: 'cms-html' }, renderTemplate: null })
  assert.deepEqual(result.errors, [])
  assert.ok(result.issues.some(issue => issue.code === 'render.skipped'))
  assert.ok(result.info.some(message => message.includes('Render checks were skipped')))
})

const auditService = (tempRoot, collections) => {
  const db = createFakeFirestore({ collections })
  const service = createCmsToolService({
    db,
    config: {
      defaultOrgId: 'org-123',
      environment: 'production',
      cmsWorkspaceRoot: path.join(tempRoot, 'workspace'),
      cmsAuditRoot: path.join(tempRoot, 'audits'),
      cmsRendererRepoPath: path.join(tempRoot, 'renderer'),
    },
    projectId: 'clearwater-hub',
    sanitizeValue: value => value,
    repoRoot: tempRoot,
  })
  return { db, service }
}

test('findBlock pages through matches with startAfter in document id order', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-find-page-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const blocks = Object.fromEntries(['e', 'b', 'd', 'a', 'c'].map(id => [id, { name: `Block ${id}`, content: '' }]))
  const { service } = auditService(tempRoot, { 'organizations/org-123/blocks': blocks })

  const first = await service.findBlock({ limit: 2 })
  assert.deepEqual(first.matches.map(block => block.docId), ['a', 'b'])
  assert.equal(first.resultTruncated, true)
  assert.equal(first.nextStartAfter, 'b')
  assert.equal(first.matchedDocuments, 5)

  const second = await service.findBlock({ limit: 2, startAfter: first.nextStartAfter })
  assert.deepEqual(second.matches.map(block => block.docId), ['c', 'd'])
  const last = await service.findBlock({ limit: 2, startAfter: second.nextStartAfter })
  assert.deepEqual(last.matches.map(block => block.docId), ['e'])
  assert.equal(last.resultTruncated, false)
  assert.equal(last.nextStartAfter, '')
})

test('auditBlocks validates every block with Hub import settings and writes a local report', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-audit-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const { db, service } = auditService(tempRoot, {
    'organizations/org-123/themes': { 'theme-main': { name: 'Main' } },
    'organizations/org-123/blocks': {
      'agent-grid': { ...sharedBlock(), synced: false, version: 1, themes: ['theme-main'] },
      'unknown-theme': { ...sharedBlock({ docId: 'unknown-theme', name: 'Unknown Theme' }), synced: false, version: 1, themes: ['gone'] },
      'broken': { ...sharedBlock({ docId: 'broken', name: 'Broken', template: '<div>{{{/if}}}</div>', content: '<div>{{{/if}}}</div>' }), synced: false, version: 1 },
      'legacy': { name: 'Legacy', content: '<div></div>', values: {}, tags: [], themes: [], synced: false, version: 1 },
    },
  })

  const result = await service.auditBlocks({})
  assert.equal(result.semantics, 'hub-import')
  assert.equal(result.summary.blocks, 4)
  assert.equal(result.summary.templateV1, 1)
  assert.equal(result.summary.renderChecks, 'ran')
  assert.equal(result.summary.knownThemeCount, 1)
  assert.equal(result.summary.blocksWithErrors, 1)
  assert.deepEqual(result.blocksWithErrors, [{ docId: 'broken', name: 'Broken', errorCodes: ['grammar.unbalanced-block'] }])
  const rule = code => result.summary.byRule.find(entry => entry.code === code)
  assert.deepEqual(rule('grammar.unbalanced-block'), { severity: 'error', code: 'grammar.unbalanced-block', findings: 1, blocks: 1 })
  assert.equal(rule('themes.unknown').blocks, 1)
  assert.equal(rule('template.v1').blocks, 1)
  assert.equal(result.summary.byRule[0].severity, 'error', 'errors sort first')

  const report = JSON.parse(await readFile(result.reportPath, 'utf8'))
  assert.ok(result.reportPath.startsWith(path.join(tempRoot, 'audits', 'org-123')))
  assert.deepEqual(report.results.map(item => item.docId), ['agent-grid', 'broken', 'legacy', 'unknown-theme'])
  assert.deepEqual(report.summary, result.summary)
  assert.equal(db.writeCalls, 0)
})

test('auditBlocks reports skipped render checks when asked not to render', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cms-audit-norender-test-'))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const { service } = auditService(tempRoot, {
    'organizations/org-123/blocks': { 'agent-grid': { ...sharedBlock(), synced: false, version: 1 } },
  })
  const result = await service.auditBlocks({ includeRender: false })
  assert.equal(result.summary.renderChecks, 'skipped-by-request')
  assert.equal(result.summary.blocksWithErrors, 0)
})
