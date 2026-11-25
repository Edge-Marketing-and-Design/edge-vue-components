import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderTemplateAsync } from '@edgedev/template-engine'

import {
  LINK_PICKER,
  isLinkInput,
  isSiteLinkHref,
  linkTargetForHref,
  linkTargets,
  linkValueProblems,
  normalizeLinkHref,
  pageLinkHref,
  validateInstanceValues,
} from '../lib/cmsOperations.js'
import { linkInputFindings, validateBlockDocument } from '../lib/cmsBlockValidation.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

const menus = {
  'Site Root': [
    { name: 'home', menuTitle: 'Home', item: 'p-home' },
    { name: 'about', menuTitle: 'About Us', item: 'p-about' },
    { name: 'company', menuTitle: 'Company', item: { company: [
      { name: 'leadership', menuTitle: 'Leadership', item: 'p-leaders' },
    ] } },
    { name: 'Blog', item: { type: 'external', url: 'https://blog.example.com' } },
  ],
  'Not In Menu': [{ name: 'thank-you', menuTitle: '', item: 'p-thanks' }],
  'Footer': [{ name: 'privacy', menuTitle: 'Privacy', item: 'p-privacy' }],
}

test('site paths are normalized to the trailing-slash form; outside addresses are kept', () => {
  const cases = [
    ['', ''],
    ['   ', ''],
    ['/', '/'],
    ['about', '/about/'],
    ['/about', '/about/'],
    ['/about/', '/about/'],
    [' //about// ', '//about//'],
    ['about//team', '/about/team/'],
    ['/about?ref=nav', '/about/?ref=nav'],
    ['/about#team', '/about/#team'],
    ['/About-Us', '/About-Us/'],
    ['/files/brochure.pdf', '/files/brochure.pdf'],
    ['/sitemap.xml', '/sitemap.xml'],
    ['brochure.pdf', '/brochure.pdf'],
    ['about.html', '/about.html'],
    ['?q=1', '/?q=1'],
    ['#contact', '#contact'],
    ['https://example.com/path', 'https://example.com/path'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['mailto:info@example.com', 'mailto:info@example.com'],
    ['tel:+14065551234', 'tel:+14065551234'],
    ['www.example.com', 'https://www.example.com'],
    ['example.com/contact', 'https://example.com/contact'],
    ['javascript:alert(1)', ''],
    [' Data:text/html,x', ''],
  ]
  for (const [input, expected] of cases)
    assert.equal(normalizeLinkHref(input), expected, JSON.stringify(input))
  assert.equal(normalizeLinkHref(null), '')
  assert.equal(normalizeLinkHref(undefined), '')
  assert.equal(isSiteLinkHref('/about/'), true)
  assert.equal(isSiteLinkHref('//cdn.example.com'), false)
  assert.equal(isSiteLinkHref('https://example.com/'), false)
})

test('the picker offers each page at its route with a trailing slash, in Sites order', () => {
  assert.deepEqual(linkTargets(menus), [
    { pageId: 'p-home', title: 'Home', href: '/', group: '' },
    { pageId: 'p-about', title: 'About Us', href: '/about/', group: '' },
    { pageId: 'p-leaders', title: 'Leadership', href: '/company/leadership/', group: 'Company' },
    { pageId: 'p-privacy', title: 'Privacy', href: '/footer/privacy/', group: 'Footer' },
    { pageId: 'p-thanks', title: 'thank-you', href: '/thank-you/', group: 'Not In Menu' },
  ])
  // With the pages collection, entries for deleted pages are dropped and a
  // page without a menu title uses its page name.
  const pages = { 'p-home': { name: 'home' }, 'p-thanks': { name: 'Thank You' } }
  assert.deepEqual(linkTargets(menus, pages).map(target => [target.pageId, target.title]), [['p-home', 'Home'], ['p-thanks', 'Thank You']])
  assert.deepEqual(linkTargets(undefined).length, 0)
  assert.equal(pageLinkHref(menus, 'p-leaders'), '/company/leadership/')
  assert.equal(pageLinkHref(menus, 'p-home'), '/')
  assert.equal(pageLinkHref(menus, 'missing'), null)
})

test('a stored address finds its page, ignoring a query or fragment', () => {
  const targets = linkTargets(menus)
  assert.equal(linkTargetForHref(targets, '/about/')?.pageId, 'p-about')
  assert.equal(linkTargetForHref(targets, '/about/#team')?.pageId, 'p-about')
  assert.equal(linkTargetForHref(targets, '/about'), null, 'the old form is not a page address')
  assert.equal(linkTargetForHref(targets, ''), null)
})

test('page.setValues and readiness refuse a Link value that is not in its final form', () => {
  const schema = {
    ctaUrl: { type: 'text', label: 'Button Link', picker: LINK_PICKER, value: '' },
    heading: { type: 'text', label: 'Heading', value: '' },
    cards: { type: 'array', label: 'Cards', value: [], schema: { link: { type: 'text', label: 'Link', picker: 'link' } } },
  }
  assert.equal(isLinkInput(schema.ctaUrl), true)
  assert.equal(isLinkInput(schema.heading), false)
  assert.deepEqual(validateInstanceValues(schema, { ctaUrl: '/about/', heading: 'about', cards: [{ link: 'https://example.com' }] }), [])
  assert.deepEqual(validateInstanceValues(schema, { ctaUrl: '', cards: [{ link: '' }] }), [], 'empty is allowed unless required')
  assert.deepEqual(validateInstanceValues(schema, { ctaUrl: '/about', cards: [{ link: 'contact' }] }), [
    'Button Link should be "/about/": site links start and end with "/".',
    'Cards 1 · Link should be "/contact/": site links start and end with "/".',
  ])
  assert.deepEqual(linkValueProblems('www.example.com', 'Link'), ['Link should be "https://www.example.com".'])
  assert.deepEqual(linkValueProblems('javascript:alert(1)', 'Link'), ['Link uses a link type that isn\'t allowed ("javascript:").'])
  assert.deepEqual(linkValueProblems(5, 'Link'), ['Link must be a link (a string such as "/about/").'])
})

test('the validator asks for a Link input where a text input is written as a whole href', () => {
  const template = [
    '<a href="{{ ctaUrl }}">Go</a>',
    '<a href="mailto:{{ email }}">Mail</a>',
    '<a href="{{ pickedUrl }}">Picked</a>',
    '{{#for card in cards}}<a href=\'{{ card.link }}\'>{{ card.title }}</a>{{/for}}',
  ].join('')
  const schema = {
    ctaUrl: { type: 'text', label: 'Button Link', value: '' },
    email: { type: 'text', label: 'Email', value: '' },
    pickedUrl: { type: 'text', label: 'Picked', picker: 'link', value: '' },
    cards: { type: 'array', label: 'Cards', value: [], schema: { link: { type: 'text', label: 'Link' }, title: { type: 'text', label: 'Title' } } },
  }
  assert.deepEqual(linkInputFindings(template, schema).map(finding => finding.path), ['schema.ctaUrl', 'schema.cards.schema.link'])
  const doc = { name: 'CTA', templateVersion: 2, content: template, template, schema, dataSources: {}, values: {}, tags: [], themes: [], type: ['Page'], synced: false, version: 1 }
  const findings = validateBlockDocument(doc).warnings.filter(issue => issue.code === 'schema.link-picker')
  assert.deepEqual(findings.map(issue => [issue.severity, issue.path]), [['warning', 'schema.ctaUrl'], ['warning', 'schema.cards.schema.link']])
})

test('a Link value renders as a plain escaped string in an href', async () => {
  const schema = { ctaUrl: { type: 'text', label: 'Button Link', picker: 'link', value: '' } }
  const html = await renderTemplateAsync('<a href="{{ ctaUrl }}">Go</a>', { ctaUrl: '/about/?a=1&b=2' }, {}, { templateVersion: 2, schema })
  assert.equal(html, '<a href="/about/?a=1&amp;b=2">Go</a>')
})

test('the Hub offers Link as a friendly input type and the picker uses the shared helpers', async () => {
  const blockInput = await read('../components/cms/blockInput.vue')
  assert.match(blockInput, /import \{ LINK_PICKER, isSiteLinkHref, linkTargetForHref, linkTargets, normalizeLinkHref \} from '\.\.\/\.\.\/lib\/cmsOperations'/)
  assert.match(blockInput, /props\.type === 'text' && props\.schema\?\.picker === LINK_PICKER/)
  assert.match(blockInput, /@blur="normalizeLinkValue"/)
  const editor = await read('../components/cms/blockEditor.vue')
  assert.equal((editor.match(/\{ name: 'link', title: 'Link' \}/g) || []).length, 2, 'Link is offered for block inputs and array item inputs')
  assert.match(editor, /if \(entry\?\.type === 'text' && entry\?\.picker === 'link'\)\n {4}return 'link'/)
  assert.match(editor, /<section id="link-fields"/)
  const block = await read('../components/cms/block.vue')
  assert.match(block, /if \(normalized\.type === 'link'\) \{\n {4}normalized\.type = 'text'\n {4}normalized\.picker = 'link'/)
  assert.match(block, /option\.picker !== 'link'/, 'AI rewrites leave Link fields alone')
})
