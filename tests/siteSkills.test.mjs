// The edge-site-setup and edge-site-launch standards files, the standards
// report and the launch scripts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { checkLive } from '../skills/edge-site-launch/scripts/check-live.mjs'
import { crawl, extractLinks } from '../skills/edge-site-launch/scripts/crawl-links.mjs'
import { evaluateStandards } from '../skills/edge-site-setup/scripts/standards-report.mjs'

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const setup = readJson('../skills/edge-site-setup/site-standards.json')
const launch = readJson('../skills/edge-site-launch/launch-standards.json')
const answers = readJson('../skills/edge-site-setup/answers.template.json')

// Every readiness code buildSiteReadiness can report.
const operations = readFileSync(new URL('../lib/cmsOperations.js', import.meta.url), 'utf8')
const READINESS_CODES = new Set([...operations.matchAll(/add\('(?:error|warning|info)', '([a-z.-]+)'/g)].map(match => match[1]).concat('site.check-incomplete'))

test('the standards files have unique ids, a rule each, and only readiness codes the Hub reports', () => {
  for (const [name, standards] of [['setup', setup], ['launch', launch]]) {
    const ids = standards.items.map(item => item.id)
    assert.equal(new Set(ids).size, ids.length, `${name}: unique ids`)
    for (const item of standards.items) {
      assert.ok(item.rule, `${name} ${item.id}: rule`)
      assert.ok(item.person || item.check, `${name} ${item.id}: checked, or a person's`)
      for (const code of item.check?.readiness || [])
        assert.ok(READINESS_CODES.has(code), `${name} ${item.id}: unknown readiness code ${code}`)
      for (const field of item.check?.answers || [])
        assert.ok(field in answers, `${name} ${item.id}: answers field ${field} is in the template`)
    }
  }
  for (const code of ['site.favicon', 'site.logo', 'site.contact-email', 'site.placeholder-domain', 'page.unlisted', 'page.chrome-missing', 'form.no-recipient'])
    assert.ok(setup.items.some(item => item.check?.readiness?.includes(code)) || code === 'site.placeholder-domain', `setup covers ${code}`)
  assert.ok(launch.items.some(item => item.person && /MyStats/.test(item.rule)))
})

test('the standards report marks items done, open, unchecked or a person\'s', () => {
  const readiness = { items: [
    { code: 'site.favicon', message: 'No favicon.' },
    { code: 'seo.meta-title', message: 'Page "about" has no meta title.', pageId: 'about' },
  ] }
  const site = { domains: ['hannah.test'], contactEmail: 'old@example.com', menus: { 'Site Root': [{ name: 'home', menuTitle: 'Home', item: 'h' }], 'Not In Menu': [] } }
  const given = { ...answers, domains: ['hannah.test'], contactEmail: 'hannah@example.com', pages: ['home', 'about'] }
  const rows = Object.fromEntries(evaluateStandards({ standards: setup, readiness, site, answers: given }).map(row => [row.id, row]))
  assert.equal(rows.favicon.status, 'open')
  assert.equal(rows['site-seo'].status, 'done', 'a page item is not a site item')
  assert.equal(rows['page-seo'].status, 'open')
  assert.equal(rows['placeholder-domain'].status, 'done')
  assert.match(rows.contact.reasons.join(' '), /contactEmail is "old@example.com"/)
  assert.match(rows.pages.reasons.join(' '), /about/)
  assert.equal(rows.publish.status, 'person')
  assert.equal(rows.social.status, 'unchecked', 'no social answers to check')

  const launchRows = Object.fromEntries(evaluateStandards({ standards: launch, readiness: { items: [] }, results: { 'pre.links': { ok: true, evidence: 'crawl-links: 212 links, none broken' }, 'launch.mystats': { ok: true, evidence: 'Dustin, 2026-11-04' } } }).map(row => [row.id, row]))
  assert.equal(launchRows['pre.links'].status, 'done')
  assert.equal(launchRows['pre.media'].status, 'done')
  assert.equal(launchRows['pre.seo'].status, 'unchecked', 'clear readiness alone does not pass a results item')
  assert.equal(launchRows['launch.mystats'].status, 'done')
  assert.equal(launchRows['launch.dns'].status, 'person')
})

test('resource hints, Cloudflare paths and commas inside srcset URLs are not broken links', () => {
  const links = extractLinks('<link rel="preconnect" href="https://fonts.googleapis.com"><a href="/cdn-cgi/l/email-protection#abc">e</a><img srcset="https://imagedelivery.net/a/b/width=1200,quality=85 1x, https://imagedelivery.net/a/b/width=2400,quality=85 2x">', 'https://example.com/')
  assert.deepEqual(links.map(link => link.url), ['https://imagedelivery.net/a/b/width=1200,quality=85', 'https://imagedelivery.net/a/b/width=2400,quality=85'])
})

test('mailto:// and tel:// links are reported broken', async () => {
  const report = await crawl({ rendered: [{ url: 'https://example.com/', html: '<a href="tel://+14065550100">Call</a><a href="mailto:a@b.co">Mail</a>' }], fetcher: fakeFetch({}) })
  assert.deepEqual(report.broken.map(link => [link.url, link.error]), [['tel://+14065550100', '"tel://" should be "tel:"']])
})

const page = (body, type = 'text/html') => ({ status: 200, url: '', headers: new Map([['content-type', type]]), text: async () => body })
const fakeFetch = routes => async (url, init) => {
  const route = routes[url]
  if (!route)
    return { status: 404, url, headers: new Map(), text: async () => '' }
  if (route instanceof Error)
    throw route
  return { ...route, url: route.url || url, headers: { get: key => route.headers?.get?.(key) ?? null }, method: init?.method }
}

test('links are extracted from every tag that loads something, resolved against the page', () => {
  const links = extractLinks('<a href="/about#team">A</a><img srcset="/a.jpg 1x, https://cdn.example.com/b.jpg 2x"><a href="mailto:x@y.z">m</a><a href="#top">t</a><link rel="stylesheet" href="https://example.com/s.css">', 'https://example.com/page')
  assert.deepEqual(links.map(link => link.url), ['https://example.com/about', 'https://example.com/a.jpg', 'https://cdn.example.com/b.jpg', 'mailto:x@y.z', 'https://example.com/s.css'])
  assert.equal(links.find(link => link.url.startsWith('mailto')).skipped, true)
})

test('the crawler follows same-host pages and reports broken links with the pages they are on', async () => {
  const fetcher = fakeFetch({
    'https://example.com/': page('<a href="/about">About</a><a href="https://other.com/gone">Gone</a><img src="/logo.png">'),
    'https://example.com/about': page('<a href="/">Home</a><a href="/missing">Missing</a>'),
    'https://other.com/gone': { status: 404 },
    'https://example.com/logo.png': { status: 200 },
  })
  const report = await crawl({ start: 'https://example.com/', fetcher })
  assert.deepEqual(report.pages.map(item => [item.url, item.status]), [['https://example.com/', 200], ['https://example.com/about', 200], ['https://example.com/missing', 404]])
  assert.deepEqual(report.broken.map(link => [link.url, link.on]).sort(), [['https://example.com/missing', ['https://example.com/about']], ['https://other.com/gone', ['https://example.com/']]])
  assert.equal(report.ok, false)
})

test('the live check passes a site on HTTPS with forwarding, robots and a sitemap on its host', async () => {
  const home = { status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html></html>' }
  const fetcher = fakeFetch({
    'https://www.example.com/': home,
    'http://www.example.com/': { ...home, url: 'https://www.example.com/' },
    'https://example.com/': { ...home, url: 'https://www.example.com/' },
    'http://example.com/': { ...home, url: 'https://www.example.com/' },
    'https://www.example.com/robots.txt': page('User-agent: *\nAllow: /\nSitemap: https://www.example.com/sitemap.xml', 'text/plain'),
    'https://www.example.com/sitemap.xml': page('<urlset><url><loc>https://www.example.com/</loc></url></urlset>', 'application/xml'),
  })
  const checks = await checkLive({ domain: 'example.com', fetcher })
  assert.deepEqual(checks.filter(check => !check.ok), [])
  const broken = await checkLive({ domain: 'example.com', fetcher: fakeFetch({ 'https://www.example.com/': home }) })
  assert.deepEqual(broken.filter(check => !check.ok).map(check => check.id), ['forward http://www.example.com/', 'forward https://example.com/', 'forward http://example.com/', 'robots.txt', 'sitemap'])
})

test('rendered HTML saved from a browser is crawled without fetching the page', async () => {
  const fetcher = fakeFetch({ 'https://example.com/ok': { status: 200 } })
  const report = await crawl({ rendered: [{ url: 'https://hub.example.com/preview/x?token=t', html: '<a href="https://example.com/ok">ok</a><a href="https://example.com/nope">x</a>' }], fetcher })
  assert.deepEqual(report.broken.map(link => link.url), ['https://example.com/nope'])
  assert.equal(report.pages[0].rendered, true)
})
