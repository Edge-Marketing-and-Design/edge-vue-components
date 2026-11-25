import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderTemplateAsync } from '@edgedev/template-engine'

import {
  BLOCK_TAG_RULE_SEVERITY,
  HUB_REQUIRED_BLOCK_KEYS,
  QUICK_PICKS_TAG,
  blockTagFindings,
  buildSourceFixtures,
  commonTypeRoles,
  normalizeBlockTagList,
  normalizeTypeRoles,
  sectionTypeRoleFindings,
  findUnbalancedHtml,
  findUnbalancedTemplateBlocks,
  isSlashlessPagePath,
  slashlessTemplateLinks,
  validateBlock,
  validateBlockDocument,
  validateBlockRender,
  validatePageDocument,
} from '../lib/cmsBlockValidation.js'

// Real client blocks stay in the Hub's own tests/fixtures (this repo is public).
const hubFixtures = new URL('../../tests/fixtures/cms-blocks/', import.meta.url)
const noHubFixtures = !existsSync(new URL('public-member-grid.json', hubFixtures)) && 'needs the Hub\'s tests/fixtures/cms-blocks'
const fixture = async name => JSON.parse(await readFile(new URL(name, hubFixtures), 'utf8'))
const codes = issues => issues.map(issue => issue.code)
const render = { renderTemplate: renderTemplateAsync }

const block = (overrides = {}) => ({
  docId: 'test-block',
  name: 'Test Block',
  templateVersion: 2,
  content: '<section><h2>{{ heading }}</h2></section>',
  template: '<section><h2>{{ heading }}</h2></section>',
  schema: { heading: { type: 'text', label: 'Heading', value: 'Hello' } },
  dataSources: {},
  values: {},
  tags: [],
  themes: [],
  type: ['Page'],
  previewType: 'light',
  synced: false,
  version: 1,
  ...overrides,
})
const withTemplate = (template, overrides = {}) => block({ content: template, template, ...overrides })

test('real Hub blocks pass structure and both render passes', { skip: noHubFixtures }, async () => {
  for (const name of ['careers-business.json', 'careers-contact.json', 'public-member-grid.json', 'home-footer.json']) {
    const result = await validateBlock(await fixture(name), render)
    assert.deepEqual(result.errors, [], `${name}: ${JSON.stringify(result.errors)}`)
    assert.equal(codes(result.warnings).includes('render.dynamic-unverified'), false, name)
  }
})

test('generated sample records make dynamic loop bodies render', { skip: noHubFixtures }, async () => {
  const doc = await fixture('public-member-grid.json')
  const { fixtures, unverified } = buildSourceFixtures(doc.template, Object.keys(doc.dataSources))
  assert.deepEqual(unverified, [])
  assert.equal(fixtures.clearwaterLeadershipMembers[0].name, '1')
  assert.deepEqual(fixtures.clearwaterLeadershipMembers[1], {})

  const renderWith = value => renderTemplateAsync(doc.template, {}, {}, {
    templateVersion: 2,
    dataSources: Object.fromEntries(Object.entries(doc.dataSources).map(([key, source]) => [key, { ...source, value: value(key) }])),
  })
  const empty = await renderWith(() => [])
  const sample = await renderWith(key => fixtures[key])
  assert.ok(sample.length > empty.length * 3, 'sample records render loop bodies')
})

test('nested plain arrays and multi-line source options get sample data', () => {
  const template = `{{#for agent in source("agents", {
    queryItems: { hide: false },
    canonical: true
  })}}<p>{{ agent.name }}</p>{{#for tag in agent.tags}}<b>{{ tag.label }}</b>{{/for}}{{/for}}`
  const { fixtures, unverified } = buildSourceFixtures(template, ['agents'])
  assert.deepEqual(unverified, [])
  assert.deepEqual(fixtures.agents[0], { name: '1', tags: [{ label: '1' }] })
})

test('loops the fixture scan cannot model are reported as unverified, never as passed', async () => {
  const template = '<ul class="{{ loading }}">{{#for entry in entries(settings)}}<li>{{ entry.key }}</li>{{/for}}{{#for a in source("agents")}}<li class="{{ loaded }}">{{ a.name }}</li>{{/for}}</ul>'
  const result = await validateBlock(withTemplate(template, {
    dataSources: { agents: { type: 'collection', path: 'users', value: [] } },
    schema: { settings: { type: 'text', label: 'Settings', value: '' } },
  }), render)
  const unverified = result.warnings.filter(issue => issue.code === 'render.dynamic-unverified')
  assert.equal(unverified.length, 1)
  assert.match(unverified[0].message, /iterates entries\(settings\)/)
  assert.equal(result.valid, true)
})

test('computed field access is flagged and, being unsupported, fails the sample render', async () => {
  const template = '<ul class="{{ loading }}">{{#for a in source("agents")}}<li class="{{ loaded }}">{{ a[field] }}</li>{{/for}}</ul>'
  const result = await validateBlock(withTemplate(template, {
    dataSources: { agents: { type: 'collection', path: 'users', value: [] } },
  }), render)
  assert.ok(result.warnings.some(issue => issue.code === 'render.dynamic-unverified' && /computed field access/.test(issue.message)))
  assert.deepEqual(codes(result.errors), ['render.unresolved-syntax'])
})

test('a broken field inside a loop body fails only when sample records render it', async () => {
  const template = '<ul class="{{ loading }}">{{#for a in source("agents")}}<li class="{{ loaded }}">{{ a.name }}{{ money(a.price }}</li>{{/for}}</ul>'
  const doc = withTemplate(template, { dataSources: { agents: { type: 'collection', path: 'users', value: [] } } })
  const emptyOnly = await renderTemplateAsync(template, {}, {}, { templateVersion: 2, dataSources: { agents: { value: [] } } })
  assert.equal(/\{\{/.test(emptyOnly), false, 'without sample records the broken placeholder never renders')

  const result = await validateBlockRender(doc, render)
  assert.ok(codes(result.errors).includes('render.unresolved-syntax'), JSON.stringify(result))
})

test('a missing {{{/if}}} is caught statically even though its render stays balanced HTML', async () => {
  const template = '<ul>{{#for a in source("agents")}}<li>{{{#if {"cond":"a.photo"} }}}<img src="{{ a.photo }}">{{#for s in a.tags}}<b>{{ s }}</b>{{/for}}</li>{{/for}}</ul>'
  const doc = withTemplate(template, { dataSources: { agents: { type: 'collection', path: 'users', value: [] } } })
  const renderResult = await validateBlockRender(doc, render)
  assert.equal(codes(renderResult.errors).includes('render.unbalanced-html'), false, 'the render output alone looks fine')

  const result = validateBlockDocument(doc)
  assert.ok(codes(result.errors).includes('grammar.unbalanced-block'))
})

test('a missing {{/for}} leaves template syntax in the rendered output', async () => {
  const template = '<ul class="{{ loading }}">{{#for a in source("agents")}}<li class="{{ loaded }}">{{ a.name }}</li></ul>'
  const doc = withTemplate(template, { dataSources: { agents: { type: 'collection', path: 'users', value: [] } } })
  const result = await validateBlock(doc, render)
  assert.ok(codes(result.errors).includes('grammar.unbalanced-block'))
  assert.ok(codes(result.errors).includes('render.unresolved-syntax'))
})

const publicationSchema = { publicationPages: { type: 'publication', label: 'Publication Pages', effect: 'flip', value: {} } }
const publicationTemplate = '<div class="max-w-screen-2xl mx-auto">\n{{{#publication {"field":"publicationPages"}}}}\n</div>'

test('a publication field\'s marker is expected output, not leftover syntax', async () => {
  const result = await validateBlock(withTemplate(publicationTemplate, { schema: publicationSchema }), render)
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors))
})

test('leftover syntax beside a publication marker still fails', async () => {
  const template = `${publicationTemplate}<p>{{{#text caption</p>`
  const result = await validateBlockRender(withTemplate(template, { schema: publicationSchema }), render)
  assert.deepEqual(codes(result.errors), ['render.unresolved-syntax'])
  assert.match(result.errors[0].message, /"\{\{\{#t"/)
})

test('a publication marker for a field the schema does not declare as a publication fails', async () => {
  const template = '<div>{{{#publication {"field":"heading"}}}}</div>'
  const result = await validateBlockRender(withTemplate(template, { schema: { heading: { type: 'text', label: 'Heading', value: 'Hi' } } }), render)
  assert.deepEqual(codes(result.errors), ['render.unresolved-syntax'])
})

test('a render that throws is reported with the pass name', async () => {
  const renderTemplate = () => {
    throw new Error('boom')
  }
  const result = await validateBlockRender(block(), { renderTemplate })
  assert.deepEqual(codes(result.errors), ['render.error'])
  assert.match(result.errors[0].message, /default render failed: boom/)
})

test('render checks are skipped, not passed silently, without a template engine', async () => {
  const result = await validateBlockRender(block())
  assert.deepEqual(codes(result.info), ['render.skipped'])
  assert.equal(result.errors.length, 0)
})

test('the Hub\'s current hard-failure keys are errors and its defaulted keys are warnings', () => {
  for (const key of HUB_REQUIRED_BLOCK_KEYS) {
    const doc = block()
    delete doc[key]
    const result = validateBlockDocument(doc)
    assert.ok(result.errors.some(issue => issue.code === 'shape.missing-key' && issue.path === key), key)
  }
  const legacy = block()
  delete legacy.templateVersion
  const legacyResult = validateBlockDocument(legacy)
  assert.deepEqual(codes(legacyResult.errors), [])
  assert.deepEqual(codes(legacyResult.warnings), ['shape.defaulted-key', 'template.v1'])

  const v2 = block()
  delete v2.template
  delete v2.schema
  delete v2.dataSources
  const v2Result = validateBlockDocument(v2)
  assert.deepEqual(v2Result.warnings.filter(issue => issue.code === 'shape.defaulted-key').map(issue => issue.path), ['template', 'schema', 'dataSources'])
})

test('shape rules', () => {
  const cases = [
    [block({ type: ['Page', 'Widget'] }), 'shape.type'],
    [block({ type: [] }), 'shape.type'],
    [block({ tags: 'Hero' }), 'shape.tags'],
    [block({ themes: 'theme-1' }), 'shape.themes'],
    [block({ synced: 'no' }), 'shape.synced'],
    [block({ version: 'one' }), 'shape.version'],
    [block({ name: '  ' }), 'shape.name'],
    [block({ content: 5 }), 'shape.content'],
  ]
  for (const [doc, code] of cases)
    assert.ok(codes(validateBlockDocument(doc).errors).includes(code), code)
  assert.deepEqual(codes(validateBlockDocument('nope').errors), ['shape.not-object'])
  assert.ok(codes(validateBlockDocument(block({ previewType: 'blue' })).warnings).includes('shape.preview-type'))
  assert.ok(codes(validateBlockDocument(block({ docId: '' }), { requireDocId: true }).errors).includes('shape.doc-id'))
  assert.deepEqual(codes(validateBlockDocument(block({ tags: ['Hero', 'Other'] }), { allowedTags: ['Hero'] }).errors), ['shape.tag-not-allowed'])
})

const CLEARWATER_TAGS = ['Navigation', 'Hero', 'Content', 'Call to Action', 'Cards & Grids', 'Article', 'Testimonials', 'Media', 'Map', 'Search & Filters', 'Form', 'Footer', 'Quick Picks']

test('the block tag list: trimmed, de-duplicated, order kept; anything else is no list', () => {
  assert.deepEqual(normalizeBlockTagList([' Hero ', 'Content', 'Hero', '', 4, null, 'Quick Picks']), ['Hero', 'Content', 'Quick Picks'])
  assert.deepEqual(normalizeBlockTagList(undefined), [])
  assert.deepEqual(normalizeBlockTagList('Hero'), [])
  assert.equal(QUICK_PICKS_TAG, 'Quick Picks')
})

test('tag rules: listed tags with one or two content tags pass; Quick Picks is not counted', () => {
  const tagCodes = (tags, options) => codes(validateBlockDocument(block({ tags }), { blockTagList: CLEARWATER_TAGS, ...options }).warnings)
  assert.deepEqual(tagCodes(['Hero']), [])
  assert.deepEqual(tagCodes(['Footer', 'Call to Action']), [])
  assert.deepEqual(tagCodes(['Hero', 'Quick Picks']), [])
  assert.deepEqual(tagCodes(['Content', 'Cards & Grids', 'Quick Picks']), [], 'two content tags plus Quick Picks')
  assert.deepEqual(tagCodes(['Hero Sections']), ['tags.not-in-list'], 'an unknown tag (still one content tag)')
  assert.deepEqual(tagCodes(['hero']), ['tags.not-in-list'], 'tags match exactly')
  assert.deepEqual(tagCodes([]), ['tags.content-count'], 'zero tags')
  assert.deepEqual(tagCodes(['Quick Picks']), ['tags.content-count'], 'Quick Picks alone is zero content tags')
  assert.deepEqual(tagCodes(['Hero', 'Content', 'Media']), ['tags.content-count'], 'three content tags')
  assert.deepEqual(tagCodes(['clearwater-main', 'careers', 'hero']), ['tags.not-in-list', 'tags.not-in-list', 'tags.not-in-list', 'tags.content-count'])
  const [finding] = blockTagFindings(['Hero', 'Content', 'Media'], CLEARWATER_TAGS)
  assert.deepEqual(finding, { code: 'tags.content-count', severity: 'warning', path: 'tags', message: 'A block needs one or two content tags (Quick Picks not counted); this one has 3.' })
})

test('tag rules: warnings until the switch, errors after it; no list means unrestricted', () => {
  assert.equal(BLOCK_TAG_RULE_SEVERITY, 'warning', 'flip to error after the retag (block tags plan, T6)')
  const offList = block({ tags: ['clearwater-main'] })
  const warned = validateBlockDocument(offList, { blockTagList: CLEARWATER_TAGS })
  assert.equal(warned.valid, true, 'warnings never block')
  assert.ok(codes(warned.warnings).includes('tags.not-in-list'))
  const refused = validateBlockDocument(offList, { blockTagList: CLEARWATER_TAGS, blockTagSeverity: 'error' })
  assert.equal(refused.valid, false)
  assert.deepEqual(codes(refused.errors), ['tags.not-in-list'])
  for (const blockTagList of [null, undefined, [], ['  ']]) {
    const result = validateBlockDocument(block({ tags: ['anything', 'goes', 'here'] }), { blockTagList })
    assert.equal([...result.errors, ...result.warnings].some(issue => issue.code.startsWith('tags.')), false, String(blockTagList))
  }
  assert.deepEqual(blockTagFindings(undefined, CLEARWATER_TAGS), [], 'a missing tags array is shape.missing-key\'s job')
})

test('unknown theme ids are listed individually as warnings', () => {
  const result = validateBlockDocument(block({ themes: ['theme-a', 'missing', ''] }), { knownThemeIds: ['theme-a'] })
  assert.deepEqual(result.warnings.filter(issue => issue.code === 'themes.unknown').map(issue => issue.message), [
    'Theme "missing" does not exist in this organization.',
    'themes contains an empty theme id.',
  ])
  assert.equal(result.errors.length, 0)
})

test('Template v2 and schema rules', () => {
  const cases = [
    [block({ content: '<p>a</p>' }), 'v2.content-mismatch'],
    [block({ template: 5 }), 'v2.template'],
    [block({ schema: [] }), 'v2.schema'],
    [block({ dataSources: 'x' }), 'v2.dataSources'],
    [block({ values: [] }), 'v2.values'],
    [block({ schema: { heading: 'text' } }), 'schema.input-object'],
    [block({ schema: { heading: { label: 'Heading', value: '' } } }), 'schema.input-type'],
    [block({ schema: { heading: { type: 'text', value: '' } } }), 'schema.input-label'],
    [block({ schema: { items: { type: 'array', label: 'Items', value: {} } } }), 'schema.array-value'],
  ]
  for (const [doc, code] of cases)
    assert.ok(codes(validateBlockDocument(doc).errors).includes(code), code)

  const warnings = codes(validateBlockDocument(block({
    values: { heading: 'Saved' },
    schema: {
      heading: { type: 'text', label: 'Heading', value: '' },
      photo: { type: 'image', label: 'Photo', value: '' },
      items: { type: 'array', label: 'Items', value: [], schema: { img: { type: 'image', label: 'Image' } } },
    },
  })).warnings)
  assert.deepEqual(warnings.sort(), ['library.values', 'schema.image-alt', 'schema.image-alt'])
  assert.equal(codes(validateBlockDocument(block({ values: { a: 1 } }), { library: false }).warnings).includes('library.values'), false)
})

test('legacy titles and missing defaults are warnings, since the Hub still handles them', () => {
  const titled = validateBlockDocument(block({ schema: { heading: { type: 'text', title: 'Heading', value: '' } } }))
  assert.deepEqual(codes(titled.errors), [])
  assert.deepEqual(codes(titled.warnings), ['schema.input-title'])
  const noDefault = validateBlockDocument(block({ schema: { heading: { type: 'text', label: 'Heading' } } }))
  assert.deepEqual(codes(noDefault.errors), [])
  assert.deepEqual(codes(noDefault.warnings), ['schema.input-value'])
})

test('the same element opened differently in each branch is balanced', () => {
  const template = '<section><div>{{{#if {"cond":"item.center"} }}}<div class="mx-auto">{{{#else}}}<div class="ml-0">{{{/if}}}<h1>{{ heading }}</h1></div></div></section>'
  assert.deepEqual(validateBlockDocument(withTemplate(template)).errors, [])
})

test('an imbalance in either branch is still reported', () => {
  const inIf = '<section>{{{#if {"cond":"item.a"} }}}<div>{{{#else}}}<div></div>{{{/if}}}</section>'
  const inElse = '<section>{{{#if {"cond":"item.a"} }}}<div></div>{{{#else}}}<div>{{{/if}}}</section>'
  assert.match(validateBlockDocument(withTemplate(inIf)).errors[0].message, /if branches/)
  assert.match(validateBlockDocument(withTemplate(inElse)).errors[0].message, /else branches/)
})

test('grammar rules', () => {
  const cases = [
    ['<section><div></section>', 'grammar.unbalanced-html'],
    ['<button v-if="open">x</button>', 'grammar.vue-or-inline-handler'],
    ['<button @click="open">x</button>', 'grammar.vue-or-inline-handler'],
    ['<button onclick="open()">x</button>', 'grammar.vue-or-inline-handler'],
    ['<div>{{#if heading}}x{{/if}}</div>', 'grammar.legacy-if'],
    ['<div>{{{#if {"cond":"a && b"} }}}x{{{/if}}}</div>', 'grammar.condition-operator'],
    ['<div>{{{/if}}}</div>', 'grammar.unbalanced-block'],
    ['<div>{{{#if {"cond":"!agent.bio"} }}}x{{{/if}}}</div>', 'grammar.condition-negation'],
    ['<div>{{{#if {"cond":"a.x == 1"} }}}{{{#if {"cond":"a.y  !a.z"} }}}x{{{/if}}}{{{/if}}}</div>', 'grammar.condition-negation'],
    ['<div>{{#for a in items}}{{{#if {"cond":"a"} }}}x{{/for}}{{{/if}}}</div>', 'grammar.unbalanced-block'],
  ]
  for (const [template, code] of cases)
    assert.ok(codes(validateBlockDocument(withTemplate(template)).errors).includes(code), `${code}: ${template}`)
  assert.ok(codes(validateBlockDocument(withTemplate('<script type="application/ld+json">{}</script>')).warnings).includes('grammar.json-ld'))
  const scripted = validateBlockDocument(withTemplate('<section><script>document.currentScript.remove()</script></section>'))
  assert.deepEqual(codes(scripted.errors), [])
  assert.deepEqual(codes(scripted.warnings), [])
})

test('flags select inputs with no option list, top level and inside arrays', () => {
  const choices = { options: [{ label: 'Yes', value: 'true' }], optionsKey: 'label', optionsValue: 'value' }
  const withSchema = schema => block({ schema: { heading: { type: 'text', label: 'Heading', value: 'Hello' }, ...schema } })
  const flagged = result => result.warnings.filter(w => w.code === 'schema.option-list').map(w => w.path)

  assert.deepEqual(flagged(validateBlockDocument(withSchema({
    layout: { type: 'option', label: 'Layout', value: 'left' },
    tone: { type: 'option', label: 'Tone', value: '', option: { options: [] } },
    fields: {
      type: 'array',
      label: 'Fields',
      value: [],
      schema: {
        fieldType: { type: 'option', label: 'Field Type', value: 'text' },
        required: { type: 'option', label: 'Required', option: choices },
      },
    },
  }))), ['schema.layout.option', 'schema.tone.option', 'schema.fields.schema.fieldType.option'])

  assert.deepEqual(flagged(validateBlockDocument(withSchema({
    layout: { type: 'option', label: 'Layout', value: 'true', option: choices },
    office: { type: 'option', label: 'Office', value: '', option: { options: 'offices', optionsKey: 'name', optionsValue: 'docId' } },
  }))), [])
})

test('flags nested default() calls, which the engine renders as an empty string', async () => {
  const nested = [
    '{{ default(a, default(b, "c")) }}',
    '{{ upper(default(a, "x")) }}',
    '{{ default(upper(b), "x") }}',
  ]
  const values = { a: '', b: 'bee' }
  const schema = { a: { type: 'text', label: 'A', value: '' }, b: { type: 'text', label: 'B', value: 'bee' } }
  for (const template of nested) {
    const result = validateBlockDocument(block({ content: `<p>${template}</p>`, template: `<p>${template}</p>`, schema }))
    assert.ok(codes(result.warnings).includes('grammar.nested-default'), template)
    // What the check guards against: the engine loses the value.
    const rendered = await renderTemplateAsync(template, values, {}, { templateVersion: 2, schema })
    assert.notEqual(rendered, 'bee', template)
  }

  const fine = '<p>{{ default(a, "x") }} {{ upper(b) }} {{ default(a, "f(x)") }}</p>{{#for item in source("x")}}{{/for}}'
  const result = validateBlockDocument(block({ content: fine, template: fine, schema }))
  assert.ok(!codes(result.warnings).includes('grammar.nested-default'))
})

// The conditions rule, as the engine renders it (the public renderer, the Hub
// preview and the page editor canvas all use it): outside loops `item` is the
// block's values; a bare name is always false; inside a loop `item` is the
// current entry.
test('conditions: item is the block outside loops and the entry inside them', async () => {
  const schema = { attribution: { type: 'text', label: 'Attribution', value: '' }, eyebrow: { type: 'text', label: 'Eyebrow', value: '' } }
  const dataSources = { posts: { value: [{ title: 'P1' }] } }
  const rendered = (template, values) => renderTemplateAsync(template, values, {}, { templateVersion: 2, schema, dataSources })
  const topItem = '<figure>{{{#if {"cond":"item.attribution"} }}}<figcaption>{{ attribution }}</figcaption>{{{#else}}}<i>none</i>{{{/if}}}</figure>'
  const topBare = '<div>{{{#if {"cond":"attribution"} }}}<b>{{ attribution }}</b>{{{#else}}}<i>none</i>{{{/if}}}</div>'
  const loopItem = '<section>{{#for post in source("posts")}}{{{#if {"cond":"item.eyebrow"} }}}<p>{{ eyebrow }}</p>{{{#else}}}<i>no</i>{{{/if}}}{{/for}}</section>'
  assert.equal(await rendered(topItem, { attribution: '' }), '<figure><i>none</i></figure>')
  assert.equal(await rendered(topItem, { attribution: 'Jane' }), '<figure><figcaption>Jane</figcaption></figure>')
  assert.equal(await rendered(topBare, { attribution: 'Jane' }), '<div><i>none</i></div>')
  assert.equal(await rendered(loopItem, { eyebrow: 'News' }), '<section><i>no</i></section>')

  const check = template => validateBlockDocument(withTemplate(template, { schema }))
  assert.deepEqual(codes(check(topItem).errors), [])
  assert.deepEqual(codes(check(topItem).warnings), [])
  assert.deepEqual(codes(check(topBare).errors), ['grammar.condition-scope'])
  assert.match(check(topBare).errors[0].message, /always false.*"item\.attribution"/)
  assert.deepEqual(codes(check(loopItem.replace('source("posts")', 'posts')).warnings), ['grammar.condition-loop-item'])
  // An entry field that is not a block field is the loop's own business.
  assert.deepEqual(codes(check('<ul>{{#for card in cards}}{{{#if {"cond":"item.link"} }}}<a href="{{ card.link }}">x</a>{{{/if}}}{{/for}}</ul>').warnings), [])
})

test('!= and !== comparisons are not treated as negation', () => {
  const template = '<div>{{#for credential in credentials}}{{{#if {"cond":"credential.type != \'Education\'"} }}}a{{{/if}}}{{/for}}{{#for a in rows}}{{{#if {"cond":"a.b !== c"} }}}b{{{/if}}}{{/for}}</div>'
  assert.deepEqual(validateBlockDocument(withTemplate(template)).errors, [])
})

test('the nested positive form that replaces && and ! passes', () => {
  const template = '<div>{{{#if {"cond":"item.bio"} }}}{{{#else}}}{{{#if {"cond":"item.bio2"} }}}{{{#else}}}<p>Biography coming soon.</p>{{{/if}}}{{{/if}}}</div>'
  assert.deepEqual(validateBlockDocument(withTemplate(template)).errors, [])
})

test('condition JSON with comparison operators does not break HTML balance', () => {
  const template = '{{#for p in products}}<div class="{{{#if {"cond":"p.price > 1000"} }}}big{{{#else}}}small{{{/if}}}"><span>{{ p.price }}</span></div>{{/for}}'
  assert.equal(findUnbalancedHtml(template.replace(/\{\{\{[\s\S]*?\}\}\}/g, '')), '')
  assert.deepEqual(validateBlockDocument(withTemplate(template)).errors, [])
})

test('template block balance messages', () => {
  assert.equal(findUnbalancedTemplateBlocks('{{#for a in b}}{{{#if {"cond":"a"} }}}{{{#else}}}{{{/if}}}{{/for}}'), '')
  assert.equal(findUnbalancedTemplateBlocks('{{{#else}}}'), '{{{#else}}} outside a conditional')
  assert.equal(findUnbalancedTemplateBlocks('{{/for}}'), '{{/for}} has no opening tag')
  assert.equal(findUnbalancedTemplateBlocks('{{#for a in b}}{{{/if}}}'), '{{{/if}}} closes a loop')
  assert.equal(findUnbalancedTemplateBlocks('{{#for a in b}}{{{#if {"cond":"a"} }}}'), '1 unclosed loop(s), 1 unclosed conditional(s)')
})

test('data source rules', () => {
  const sources = { agents: { type: 'collection', path: 'users', value: [] }, offices: { type: 'collection', path: 'offices', value: [] } }
  const result = validateBlockDocument(withTemplate('<ul>{{#for a in source("agents")}}<li>{{ a.name }}</li>{{/for}}{{#for p in source("posts")}}{{/for}}</ul>', { dataSources: sources }))
  assert.deepEqual(codes(result.errors), ['sources.undeclared'])
  assert.deepEqual(codes(result.warnings).sort(), ['sources.loaded-token', 'sources.loading-token', 'sources.unused'])
})

test('ownership rules use the override facts the caller supplies', () => {
  const form = withTemplate('<form data-cms-form><input name="email"></form>')
  assert.deepEqual(codes(validateBlockDocument(form, { ownership: { status: 'vue-override' } }).errors), ['ownership.form-override'])
  assert.deepEqual(codes(validateBlockDocument(form, { ownership: { status: 'cms-html' } }).errors), [])
  assert.deepEqual(codes(validateBlockDocument(block(), { ownership: { status: 'ambiguous-vue-override' } }).errors), ['ownership.ambiguous'])
  assert.deepEqual(codes(validateBlockDocument(block(), { ownership: { status: 'renderer-repo-unavailable' } }).warnings), ['ownership.unverified'])
})

test('project content rules apply to rendered defaults only when enabled', async () => {
  const doc = block({ schema: { heading: { type: 'text', label: 'Heading', value: 'We guarantee results!' } } })
  assert.deepEqual((await validateBlockRender(doc, render)).errors, [])
  const result = await validateBlockRender(doc, { ...render, contentRules: { noExclamation: true, bannedPhrases: ['guarantee'] } })
  assert.deepEqual(codes(result.errors).sort(), ['content.banned-phrase', 'content.exclamation'])
})

const page = (overrides = {}) => ({
  name: 'Home',
  type: ['Page'],
  content: [{ id: 'i1', blockId: 'hero', name: 'Hero', content: '<div></div>' }],
  structure: [{ id: 'r1', columns: [{ id: 'c1', blocks: ['i1'] }] }],
  ...overrides,
})

test('a well-formed page passes', () => {
  assert.deepEqual(validatePageDocument(page()), { valid: true, errors: [], warnings: [], info: [] })
})

test('page structure rules', () => {
  const cases = [
    [page({ structure: [{ id: 'r1', columns: [{ id: 'c1', blocks: ['i1', 'i1'] }] }] }), 'page.instance-placement'],
    [page({ structure: [{ id: 'r1', columns: [{ id: 'c1', blocks: [] }] }] }), 'page.instance-placement'],
    [page({ structure: [{ id: 'r1', columns: [{ id: 'c1', blocks: ['i1', 'ghost'] }] }] }), 'page.unknown-instance'],
    [page({ content: [...page().content, { ...page().content[0] }] }), 'page.duplicate-instance-id'],
    [page({ structure: [{ id: 'r1', columns: [{ id: 'c1', blocks: ['i1'] }] }, { id: 'r1', columns: [] }] }), 'page.duplicate-row-id'],
    [page({ structure: [{ columns: [{ id: 'c1', blocks: ['i1'] }] }] }), 'page.row-id'],
    [page({ structure: [{ id: 'r1', columns: [{ blocks: ['i1'] }] }] }), 'page.column-id'],
    [page({ structure: [{ id: 'r1' }] }), 'page.columns'],
    [page({ content: [{ id: 'i1', name: 'Hero', content: '' }] }), 'page.instance-key'],
    [page({ content: [{ id: 'i1', blockId: 'hero', name: 'Hero' }] }), 'page.instance-content'],
    [page({ type: ['Landing'] }), 'shape.type'],
  ]
  for (const [doc, code] of cases)
    assert.ok(codes(validatePageDocument(doc).errors).includes(code), code)
  const missing = page()
  delete missing.structure
  assert.ok(codes(validatePageDocument(missing).errors).includes('shape.missing-key'))
})

test('post template warnings', () => {
  const empty = page({ type: ['Post'], content: [], structure: [], postContent: [], postStructure: [] })
  assert.deepEqual(codes(validatePageDocument(empty).warnings), ['page.post-scaffold'])
  const both = page({ type: ['Post'], postContent: [{ id: 'p1', blockId: 'body', name: 'Body', content: '' }], postStructure: [{ id: 'pr', columns: [{ id: 'pc', blocks: ['p1'] }] }] })
  assert.deepEqual(codes(validatePageDocument(both).warnings), ['page.post-both'])
  const route = page({ type: ['Post'], post: true, postContent: [], postStructure: [] })
  assert.deepEqual(codes(validatePageDocument(route).warnings), ['page.post-detail'])
})

test('standard theme names: blocks flag custom, raw and palette colors, not ordinary utilities', async () => {
  const { findThemeNameIssues, templateClassStrings, themeTokenProblems, THEME_COLOR_TOKENS } = await import('../lib/cmsBlockValidation.js')
  const ordinary = templateClassStrings('<div class="text-center text-lg bg-cover bg-no-repeat border-2 border-t border-dashed ring-inset shadow-lg font-bold rounded-lg rounded-t-card lg:!hidden sm:text-left divide-y outline-none decoration-wavy bg-gradient-to-r from-primary via-accent/50 to-transparent text-onPrimary hover:bg-primary/90 font-display">{{ x }}</div>')
  assert.deepEqual(findThemeNameIssues(ordinary), { colors: [], fonts: [], radii: [], raw: [], opacity: [] })
  assert.deepEqual(findThemeNameIssues(['text-primary/[0.03] bg-accent/10 hover:bg-primary/[5%]']).opacity, ['hover:bg-primary/[5%]', 'text-primary/[0.03]'], 'bracketed opacity is flagged; whole percents are not')
  const custom = findThemeNameIssues(templateClassStrings('<p class="bg-pine hover:text-gold/80 !text-[var(--color-sand)] font-serif !font-[var(--font-brand)] rounded-pill bg-[#d96a20] text-red-500">{{{#if {"cond":"a == \'b\'"}}}}x{{{/if}}}</p>'))
  assert.deepEqual(custom.colors, ['gold', 'pine', 'sand'])
  assert.deepEqual(custom.fonts, ['brand', 'serif'])
  assert.deepEqual(custom.radii, ['pill'])
  assert.deepEqual(custom.raw, ['bg-[#d96a20]', 'text-red-500'])

  const colors = Object.fromEntries(THEME_COLOR_TOKENS.map(name => [name, '#000']))
  const standard = { extend: { colors, fontFamily: { display: ['A'], sans: ['B'], accent: ['C'] }, borderRadius: { card: '1px', panel: '2px', button: '3px' } }, apply: {} }
  assert.deepEqual(themeTokenProblems(standard), [])
  const codes = themeTokenProblems({ extend: { ...standard.extend, colors: { ...colors, river: '#43A1A3', success: '#0a0' } } }).map(problem => problem.code)
  assert.deepEqual(codes, [], 'baseline themes may add custom tokens')
  assert.deepEqual(findThemeNameIssues(['bg-river font-serif rounded-pill'], { colors: ['river'], fontFamily: ['serif'], borderRadius: ['pill'] }), { colors: [], fonts: [], radii: [], raw: [], opacity: [] })
  assert.deepEqual(themeTokenProblems({ ...standard, apply: { root: 'font-sans bg-canvas text-text' } }).map(problem => problem.code), ['theme.apply-rules'], 'apply stays empty')
  assert.deepEqual(themeTokenProblems({ ...standard, apply: { root: '' }, variants: { dark: { apply: {} } } }), [], 'empty apply values are fine')
})

test('a site-record lookup must use {siteId}, not a fixed site id', async () => {
  const { validateBlockDocument } = await import('../lib/cmsBlockValidation.js')
  const block = key => ({ name: 'Nav', content: '<nav>{{{#for site in source("siteDoc")}}}{{ site.name }}{{{/for}}}</nav>', template: '<nav>{{{#for site in source("siteDoc")}}}{{ site.name }}{{{/for}}}</nav>', templateVersion: 2, schema: {}, dataSources: { siteDoc: { type: 'collection', path: 'sites', canonicalLookup: { key } } }, values: {}, tags: [], themes: [], synced: false, version: 1 })
  const fixed = validateBlockDocument(block('{orgId}:R37c0iuDN8ONcpVuGpHV'))
  assert.ok(fixed.warnings.some(issue => issue.code === 'sources.site-id'))
  assert.equal(validateBlockDocument(block('{orgId}:{siteId}')).warnings.some(issue => issue.code === 'sources.site-id'), false)
})

const ROLES = { sectionTitle: 'cw-section__title', sectionIntro: 'cw-section__intro' }
const sectionBlock = html => block({ content: html, template: html, schema: { heading: { type: 'text', label: 'Heading', value: 'Hi' }, intro: { type: 'richtext', label: 'Intro', value: '<p>Hi</p>' } } })
const roleCodes = (html, typeRoles = ROLES) => codes(validateBlockDocument(sectionBlock(html), { typeRoles }).warnings).filter(code => code === 'type.section-role')

test('type roles: themes without roles are not checked', () => {
  const html = '<section><h2 class="text-[34px] leading-none">{{ heading }}</h2><div class="max-w-[58ch] text-[18px]">{{ richtext(intro) }}</div></section>'
  assert.deepEqual(roleCodes(html, null), [])
  assert.deepEqual(roleCodes(html, { sectionTitle: '', sectionIntro: '' }), [], 'empty roles are none')
  assert.deepEqual(sectionTypeRoleFindings(html, undefined), [])
})

test('type roles: blocks using the role classes pass', () => {
  const html = '<section><header class="text-center"><div class="cw-eyebrow">{{ heading }}</div><h2 class="cw-section__title mt-3 text-center text-brand">{{ heading }}</h2>\n  <div class="cw-section__intro mx-auto mt-5 text-center">{{ richtext(intro) }}</div></header></section>'
  assert.deepEqual(roleCodes(html), [])
  const column = '<section><h2 class="cw-section__title">{{ heading }}</h2><p class="cw-section__intro cw-section__intro--column mt-4">{{ heading }}</p></section>'
  assert.deepEqual(roleCodes(column), [], 'width modifiers are part of the role')
})

test('type roles: own heading sizes or a missing role class warn', () => {
  const findings = sectionTypeRoleFindings('<h2 class="cw-section__title text-[30px] md:text-[38px] lg:leading-[0.875]">{{ heading }}</h2>', ROLES)
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /cw-section__title.*text-\[30px\] md:text-\[38px\] lg:leading-\[0\.875\]/)
  assert.deepEqual(roleCodes('<h2 class="font-sans font-bold uppercase text-brand">{{ heading }}</h2>'), ['type.section-role'], 'no role class')
  assert.deepEqual(roleCodes('<h2 class="cw-section__title text-3xl leading-tight">{{ heading }}</h2>'), ['type.section-role'], 'named sizes override the role too')
  assert.deepEqual(roleCodes('<h2 class="cw-section__title text-[#003E52] text-[var(--color-brand)]">{{ heading }}</h2>'), [], 'arbitrary colors are not sizes')
})

test('type roles: own intro sizes, line heights and widths warn', () => {
  const html = '<h2 class="cw-section__title">{{ heading }}</h2>\n<p class="cw-body mx-auto mt-4 max-w-[640px] !text-[24px]">{{ heading }}</p>'
  const findings = sectionTypeRoleFindings(html, ROLES)
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /cw-section__intro.*cw-body max-w-\[640px\] !text-\[24px\]/)
  assert.deepEqual(roleCodes('<h2 class="cw-section__title">{{ heading }}</h2><div class="cw-section__intro max-w-[520px]">x</div>'), ['type.section-role'], 'a one-off width beside the role')
  assert.deepEqual(roleCodes('<h2 class="cw-section__title">{{ heading }}</h2><div class="grid grid-cols-2 gap-4">x</div>'), [], 'a plain layout element after the heading is not an intro')
  assert.deepEqual(roleCodes('<h2 class="cw-section__title">{{ heading }}</h2></header><p class="text-[18px]">x</p>'), [], 'only the element directly after the heading')
})

test('type roles: data-type-role="none" marks a deliberate exception', () => {
  const html = '<h2 data-type-role="none" class="text-[72px]">{{ heading }}</h2><p class="text-[24px]">x</p><h2 class="cw-section__title">{{ heading }}</h2><p data-type-role="none" class="text-[13px]">x</p>'
  assert.deepEqual(roleCodes(html), [])
})

test('type roles: template tokens and conditionals do not hide headings', () => {
  const html = '{{{#if {"cond":"heading"} }}}<h2 class="{{ headingClass }} text-[40px]">{{ heading }}</h2>{{{/if}}}'
  assert.deepEqual(roleCodes(html), ['type.section-role'])
})

test('type roles: normalized from theme documents', () => {
  assert.deepEqual(normalizeTypeRoles({ sectionTitle: ' cw-section__title ', sectionIntro: 'two classes', extra: 'x' }), { sectionTitle: 'cw-section__title' })
  assert.deepEqual(normalizeTypeRoles('{"sectionIntro":"cw-section__intro"}'), { sectionIntro: 'cw-section__intro' })
  assert.equal(normalizeTypeRoles('not json'), null)
  assert.equal(normalizeTypeRoles({ sectionTitle: '' }), null)
  const a = { typeRoles: ROLES }
  assert.deepEqual(commonTypeRoles([a, { typeRoles: { sectionTitle: 'cw-section__title', sectionIntro: 'other' } }]), { sectionTitle: 'cw-section__title' }, 'disagreeing roles are dropped')
  assert.deepEqual(commonTypeRoles([a, { name: 'No roles' }]), ROLES, 'themes without roles do not cancel the check')
  assert.equal(commonTypeRoles([{ name: 'No roles' }]), null)
  assert.equal(commonTypeRoles([]), null)
})

// The renderer 301s every slashless HTML path to its trailing-slash URL, so a
// menu built from href="/{{ menuItem.name }}" carried ~35 redirects per page.
test('internal links: slashless page paths are flagged, everything the renderer leaves alone is not', () => {
  const flagged = ['/sell-with-us', '/about/our-story', '/{{ menuItem.name }}', '/{{ folderEntry.key }}/{{ folderChild.name }}', '/{{ folderEntry.key }}', '/agents/{{ slug(member.name) }}', '/search?q=1', '/about#team']
  const fine = [
    '/', '/sell-with-us/', '/{{ menuItem.name }}/', '/{{ folderEntry.key }}/{{ folderChild.name }}/', '/about/?q=1',
    'https://example.com/a', '//cdn.example.com/a', '#top', '?page=2', 'tel:5551234', 'mailto:a@b.co',
    '/files/guide.pdf', '/favicon.ico', '/images/{{ photo.name }}.jpg', '/api/contact', '/api', '/_nuxt/x', '/__nuxt_island/a', '/_ipx/w_400/a',
    '{{ menuItem.item.url }}', '{{ buttonUrl }}', '', 'sell-with-us',
  ]
  for (const value of flagged)
    assert.equal(isSlashlessPagePath(value), true, value)
  for (const value of fine)
    assert.equal(isSlashlessPagePath(value), false, value)
})

test('internal links: hrefs are read whole, including placeholders that hold quotes', () => {
  const template = `<a href="/{{ menuItem.name }}">A</a><a href='/b'>B</a><a href="{{ default(indexUrl, "/real-estate") }}/">C</a><a href="/c/">D</a><a class="x" data-href="/nope">E</a>`
  assert.deepEqual(slashlessTemplateLinks(template), ['/{{ menuItem.name }}', '/b'])
})

test('internal links: a navigation template with slashless menu links is a warning', () => {
  const menu = (page, folder, child) => `<nav>{{#for menuItem in site.menus.Site Root}}<a href="${page}">P</a>{{{#entries:folderEntry {"field":"menuItem.item"} }}}<a href="${folder}">F</a>{{#for folderChild in folderEntry.value}}<a href="${child}">C</a>{{/for}}{{{/entries}}}{{/for}}</nav>`
  const broken = validateBlockDocument(withTemplate(menu('/{{ menuItem.name }}', '/{{ folderEntry.key }}', '/{{ folderEntry.key }}/{{ folderChild.name }}')))
  const issue = broken.warnings.find(warning => warning.code === 'links.trailing-slash')
  assert.ok(issue, JSON.stringify(broken.warnings))
  assert.ok(!codes(broken.errors).includes('links.trailing-slash'))
  assert.match(issue.message, /"\/\{\{ menuItem\.name \}\}"/)
  assert.match(issue.message, /"\/\{\{ folderEntry\.key \}\}\/\{\{ folderChild\.name \}\}"/)

  const fixed = validateBlockDocument(withTemplate(menu('/{{ menuItem.name }}/', '/{{ folderEntry.key }}/', '/{{ folderEntry.key }}/{{ folderChild.name }}/')))
  assert.ok(!codes(fixed.warnings).includes('links.trailing-slash'), JSON.stringify(fixed.warnings))
})

test('internal links: author-entered page paths without the slash are warnings', () => {
  const schema = {
    buttonUrl: { type: 'text', label: 'Button URL', value: '/sell-with-us' },
    pdfUrl: { type: 'text', label: 'PDF', value: '/files/guide.pdf' },
    external: { type: 'text', label: 'External', value: 'https://example.com/a' },
    body: { type: 'richtext', label: 'Body', value: '<p>/not a link</p>' },
    links: { type: 'array', label: 'Links', value: [{ url: '/contact' }, { url: '/contact/' }], schema: { url: { type: 'text', label: 'URL', value: '' } } },
  }
  const result = validateBlockDocument(block({ schema }))
  const warned = result.warnings.filter(issue => issue.code === 'links.value-trailing-slash')
  assert.deepEqual(warned.map(issue => issue.path), ['schema.buttonUrl.value', 'schema.links.value[0].url'])
  assert.match(warned[0].message, /"\/sell-with-us\/"/)
  assert.ok(!codes(result.errors).includes('links.value-trailing-slash'))

  const instance = page({ content: [{ ...page().content[0], values: { buttonUrl: '/sell-with-us', other: '/ok/' } }] })
  const pageResult = validatePageDocument(instance)
  assert.deepEqual(pageResult.warnings.map(issue => [issue.code, issue.path]), [['links.value-trailing-slash', 'content[0].values.buttonUrl']])
  assert.equal(pageResult.valid, true)
})

test('conditions: an enclosing {{{#entries:alias}}} is in scope, as the engine renders it', async () => {
  const template = '<ul>{{#for menuItem in menu}}{{{#entries:folderEntry {"field":"menuItem.item","value":{}}}}}<li>{{{#if {"cond":"folderEntry.key == \'home\'"}}}}H{{{#else}}}{{ folderEntry.key }}{{{/if}}}</li>{{{/entries}}}{{/for}}</ul>'
  const schema = { menu: { type: 'array', label: 'Menu', value: [] } }
  assert.ok(!codes(validateBlockDocument(withTemplate(template, { schema })).errors).includes('grammar.condition-scope'))
  const rendered = await renderTemplateAsync(template, { menu: [{ item: { home: [] } }, { item: { about: [] } }] }, {}, { templateVersion: 2 })
  assert.equal(rendered, '<ul><li>H</li><li>about</li></ul>')

  const outside = '<ul>{{#for menuItem in menu}}{{{#entries:folderEntry {"field":"menuItem.item","value":{}}}}}<li></li>{{{/entries}}}{{{#if {"cond":"folderEntry.key == \'home\'"}}}}H{{{/if}}}{{/for}}</ul>'
  assert.ok(codes(validateBlockDocument(withTemplate(outside, { schema })).errors).includes('grammar.condition-scope'))
})
