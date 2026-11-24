// The edge-search-health scripts: robots rules, page choice, render
// comparison, Search Console summaries, traffic alarms, Google auth and the
// audit report, URL consistency, Pages report exports and Core Web Vitals.
// The browser test runs only where Playwright and Chrome load.
import assert from 'node:assert/strict'
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { diffProblems, formatAudit } from '../skills/edge-search-health/scripts/audit.mjs'
import { checkOpenRender, compareRenders, crawlerRender, isAllowed, launchBrowser, loadPlaywright, parseRobots, rulesForAgent, selectTemplatePages } from '../skills/edge-search-health/scripts/crawler-render.mjs'
import { SEARCH_CONSOLE_SCOPE, getAccessToken, serviceAccountAssertion } from '../skills/edge-search-health/scripts/google-auth.mjs'
import { checkSitemaps, compareTraffic, findProperty, summarizeInspection } from '../skills/edge-search-health/scripts/search-console.mjs'
import { checkCoverage, checkInternalLinks, checkVariants, judgeProbe, linkPattern, mergeCoverageExports, probeUrl, readCoverageExport, reasonKind } from '../skills/edge-search-health/scripts/url-checks.mjs'
import { checkWebVitals, rate } from '../skills/edge-search-health/scripts/web-vitals.mjs'

const CLEARWATER_ROBOTS = `User-agent: *
Disallow: /admin
Disallow: /api
Disallow: /__nuxt_devtools__/
Disallow: /preview
Disallow: /auth

Allow: /

Sitemap: https://www.clearwaterproperties.com/sitemap.xml
`

test('robots rules follow Google: the most specific agent group, longest match, allow on a tie', () => {
  const rules = rulesForAgent(parseRobots(CLEARWATER_ROBOTS), 'googlebot')
  assert.equal(isAllowed(rules, '/api/kv'), false)
  assert.equal(isAllowed(rules, '/properties/'), true)
  assert.equal(isAllowed(rules, '/_nuxt/app.js'), true)

  const withAllow = rulesForAgent(parseRobots('User-agent: *\nAllow: /api/kv\nDisallow: /api\n'), 'googlebot')
  assert.equal(isAllowed(withAllow, '/api/kv'), true)
  assert.equal(isAllowed(withAllow, '/api/history'), false)

  const specific = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private/\n')
  assert.equal(isAllowed(rulesForAgent(specific, 'googlebot'), '/page/'), true)
  assert.equal(isAllowed(rulesForAgent(specific, 'otherbot'), '/page/'), false)

  const wildcard = rulesForAgent(parseRobots('User-agent: *\nDisallow: /*.json$\nDisallow: /search?*q=\n'), 'googlebot')
  assert.equal(isAllowed(wildcard, '/data/site.json'), false)
  assert.equal(isAllowed(wildcard, '/data/site.json?x=1'), true)
  assert.equal(isAllowed(wildcard, '/search?page=1&q=x'), false)
})

test('one page per template, home first, then collection detail pages, then top-level pages', () => {
  const base = 'https://www.example.com'
  const pages = selectTemplatePages([
    `${base}/about/`,
    `${base}/agents/`,
    `${base}/`,
    `${base}/agents/jane/`,
    `${base}/agents/john/`,
    `${base}/properties/a1/`,
    `${base}/properties/b2/`,
    'not a url',
  ], 4)
  assert.deepEqual(pages, [`${base}/`, `${base}/agents/jane/`, `${base}/properties/a1/`, `${base}/about/`])
})

const goodPage = { status: 200, title: 'Mountain West Real Estate | Clearwater Properties', h1: 'Find Your Wild', canonical: 'https://www.clearwaterproperties.com/', robotsMeta: '', robotsHeader: '', textLength: 5600, structuredData: 1, invalidStructuredData: 0, pageErrors: [] }

test('the October 2026 failure is an error: the page swapped for the developer 404 screen', () => {
  // What Google's renderer captured for the Clearwater home page.
  const captured = { ...goodPage, title: 'Edge Website - An awesome Edge website', h1: '404', canonical: '', textLength: 203, structuredData: 0 }
  const codes = compareRenders(goodPage, captured, { mode: 'robots' }).map(problem => `${problem.severity}:${problem.code}`)
  for (const expected of ['error:error-screen', 'error:title-changed', 'error:h1-changed', 'error:canonical-changed', 'error:structured-data-lost', 'error:content-lost'])
    assert.ok(codes.includes(expected), `${expected} in ${codes}`)

  const retryScreen = { ...goodPage, title: 'Unable to load this page', h1: 'Unable to load this page', robotsMeta: 'noindex', textLength: 66, structuredData: 0, canonical: '' }
  assert.ok(compareRenders(goodPage, retryScreen, { mode: 'no-api' }).some(problem => problem.code === 'noindex' && problem.severity === 'error'))
})

test('content that only loads through an API is an error when robots blocks it and a warning when the request fails', () => {
  const thinner = { ...goodPage, textLength: 3000 }
  assert.deepEqual(compareRenders(goodPage, thinner, { mode: 'robots' }).map(problem => `${problem.severity}:${problem.code}`), ['error:content-lost'])
  assert.deepEqual(compareRenders(goodPage, thinner, { mode: 'no-api' }).map(problem => `${problem.severity}:${problem.code}`), ['warning:content-lost'])
  assert.deepEqual(compareRenders(goodPage, { ...goodPage }, { mode: 'robots' }), [])
})

test('preview hosts ignore noindex and canonical, which every preview page has', () => {
  const preview = { ...goodPage, robotsMeta: 'noindex, nofollow', canonical: 'https://x.pages.dev/' }
  assert.deepEqual(checkOpenRender(preview, { preview: true }), [])
  assert.deepEqual(compareRenders(preview, { ...preview, canonical: '' }, { mode: 'no-api', preview: true }), [])
  assert.ok(checkOpenRender({ ...goodPage, robotsMeta: 'noindex' }).some(problem => problem.code === 'noindex'))
})

test('URL inspection: Soft 404, noindex and robots are errors, a new URL is info, a different canonical is a warning', () => {
  const soft = summarizeInspection('https://x.com/', { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Soft 404', pageFetchState: 'SUCCESSFUL', indexingState: 'INDEXING_ALLOWED' } })
  assert.deepEqual(soft.problems.map(problem => `${problem.severity}:${problem.code}`), ['error:soft-404'])
  const noindex = summarizeInspection('https://x.com/a/', { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Excluded by \'noindex\' tag', indexingState: 'BLOCKED_BY_META_TAG', pageFetchState: 'SUCCESSFUL' } })
  assert.equal(noindex.problems[0].code, 'noindex')
  const robots = summarizeInspection('https://x.com/b/', { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Blocked by robots.txt', robotsTxtState: 'DISALLOWED' } })
  assert.equal(robots.problems[0].code, 'blocked-by-robots')
  const fresh = summarizeInspection('https://x.com/c/', { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' } })
  assert.deepEqual(fresh.problems.map(problem => problem.severity), ['info'])
  const indexed = summarizeInspection('https://x.com/d/', { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', pageFetchState: 'SUCCESSFUL', googleCanonical: 'https://x.com/e/', userCanonical: 'https://x.com/d/' }, richResultsResult: { verdict: 'FAIL', detectedItems: [{ richResultType: 'Breadcrumbs', items: [{ issues: [{ severity: 'ERROR', issueMessage: 'Missing field "name"' }] }] }] } })
  assert.deepEqual(indexed.problems.map(problem => `${problem.severity}:${problem.code}`), ['warning:canonical-mismatch', 'error:rich-results-invalid'])
  assert.deepEqual(indexed.richResults, ['Breadcrumbs'])
})

test('sitemaps: none submitted is an error, never read and stale are flagged', () => {
  assert.equal(checkSitemaps([], { expected: 'https://x.com/sitemap.xml' }).problems[0].code, 'sitemap-not-submitted')
  const now = new Date('2026-11-24T00:00:00Z')
  const result = checkSitemaps([
    { path: 'https://x.com/sitemap.xml', lastSubmitted: '2026-10-24T00:00:00Z', lastDownloaded: '2026-10-25T00:00:00Z', errors: '0' },
    { path: 'https://x.com/other.xml', isPending: true },
  ], { expected: 'https://x.com/sitemap.xml', now })
  assert.deepEqual(result.problems.map(problem => `${problem.severity}:${problem.code}`), ['warning:sitemap-stale', 'info:sitemap-not-read'])
})

test('properties: the domain property is preferred over a URL prefix', () => {
  const sites = [{ siteUrl: 'https://www.x.com/', permissionLevel: 'siteFullUser' }, { siteUrl: 'sc-domain:x.com', permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'sc-domain:y.com', permissionLevel: 'siteUnverifiedUser' }]
  assert.equal(findProperty(sites, 'www.x.com'), 'sc-domain:x.com')
  assert.equal(findProperty(sites.slice(0, 1), 'www.x.com'), 'https://www.x.com/')
  assert.equal(findProperty(sites, 'www.y.com'), null)
})

// Clearwater's home page clicks and impressions around the 2026 launch
// (Search Console export): ~25 clicks/day, then the cliff on Nov 1.
const day = (date, clicks, impressions) => ({ keys: [date], clicks, impressions })
const clearwaterRows = () => {
  const rows = []
  for (let date = new Date('2026-09-20T00:00:00Z'); date <= new Date('2026-11-21T00:00:00Z'); date = new Date(date.getTime() + 86400000)) {
    const iso = date.toISOString().slice(0, 10)
    rows.push(iso < '2026-11-01' ? day(iso, 22 + (date.getUTCDate() % 7), 120 + (date.getUTCDate() % 5) * 10) : day(iso, date.getUTCDate() % 4 === 0 ? 1 : 0, 20))
  }
  return rows
}

test('traffic: the launch cliff alarms within 3 days; ordinary weeks do not', () => {
  const rows = clearwaterRows()
  const at = date => compareTraffic(rows, { today: new Date(`${date}T12:00:00Z`), launchDate: '2026-10-24' })
  assert.deepEqual(at('2026-11-02').problems, [])
  assert.equal(at('2026-11-04').problems[0]?.severity, 'error')
  assert.match(at('2026-11-04').problems[0].detail, /last 3 days/)
  assert.equal(at('2026-11-21').problems[0]?.severity, 'error')
  for (let date = new Date('2026-10-01T12:00:00Z'); date <= new Date('2026-11-02T12:00:00Z'); date = new Date(date.getTime() + 86400000))
    assert.deepEqual(compareTraffic(rows, { today: date }).problems, [], date.toISOString())
  assert.deepEqual(compareTraffic(rows.map(row => ({ ...row, clicks: 0, impressions: row.impressions / 100 })), { today: new Date('2026-11-21T12:00:00Z') }).problems, [], 'too small to alarm')
})

test('google auth: a service account signs an RS256 assertion; an authorized user refreshes; failures name no secret', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const credentials = { type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'k1', token_uri: 'https://oauth2.googleapis.com/token' }
  const assertion = serviceAccountAssertion(credentials, SEARCH_CONSOLE_SCOPE, 1000)
  const [header, claims, signature] = assertion.split('.')
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${header}.${claims}`)
  assert.ok(verifier.verify(createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(signature, 'base64url')))
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: credentials.client_email, scope: SEARCH_CONSOLE_SCOPE, aud: credentials.token_uri, iat: 1000, exp: 4600 })

  const calls = []
  const fetcher = async (url, options) => {
    calls.push(Object.fromEntries(options.body))
    return { ok: true, status: 200, json: async () => ({ access_token: 'token-1', scope: SEARCH_CONSOLE_SCOPE }) }
  }
  assert.equal(await getAccessToken(credentials, { fetcher }), 'token-1')
  assert.equal(calls[0].grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const user = { type: 'authorized_user', client_id: 'c', client_secret: 's', refresh_token: 'r' }
  assert.equal(await getAccessToken(user, { fetcher }), 'token-1')
  assert.equal(calls[1].grant_type, 'refresh_token')

  const expired = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })
  await assert.rejects(getAccessToken(user, { fetcher: expired }), (error) => {
    assert.match(error.message, /expired or was revoked/)
    assert.doesNotMatch(error.message, /\br\b|client_secret/)
    return true
  })
  const wrongScope = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 't', scope: 'https://www.googleapis.com/auth/analytics.readonly' }) })
  await assert.rejects(getAccessToken(user, { fetcher: wrongScope }), /does not include Search Console/)
})

test('the audit report escapes table cells and says what changed since the last run', () => {
  const problem = { severity: 'error', code: 'soft-404', url: 'https://x.com/a/', detail: 'Soft 404' }
  const changes = diffProblems([{ severity: 'error', code: 'noindex', url: 'https://x.com/b/' }], [problem])
  assert.deepEqual(changes.new.map(item => item.code), ['soft-404'])
  assert.deepEqual(changes.resolved.map(item => item.code), ['noindex'])
  const report = formatAudit({
    host: 'x.com',
    date: '2026-11-24',
    launchDate: null,
    render: { pages: [{ url: 'https://x.com/', ok: true, problems: [], loads: { open: { title: 'Home | X', textLength: 10, structuredData: 1 } } }], missingPage: { status: 404, problems: [] } },
    searchConsole: { error: 'No Search Console credentials' },
    problems: [problem],
    changes: { since: '2026-11-17', ...changes },
  })
  assert.match(report, /\| Home \\\| X \|/)
  assert.match(report, /\*\*FAIL\*\*/)
  assert.match(report, /New: soft-404 \/a\//)
  assert.match(report, /Request indexing/)
})

// A local site whose page replaces itself with an error screen when its API
// request fails - the October 2026 renderer bug - next to a page that keeps
// its server-rendered content, and a missing URL that returns 200.
const page = (title, script = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"WebPage"}</script></head><body><h1>${title}</h1><p>${'Real listing content. '.repeat(40)}</p><script>${script}</script></body></html>`
const breaksOnFailure = 'fetch(\'/api/kv\',{method:\'POST\'}).catch(()=>{document.title=\'Unable to load this page\';document.head.querySelector(\'script[type="application/ld+json"]\').remove();document.head.insertAdjacentHTML(\'beforeend\',\'<meta name="robots" content="noindex">\');document.body.innerHTML=\'<h1>Unable to load this page</h1>\'})'
const survivesFailure = 'fetch(\'/api/kv\',{method:\'POST\'}).catch(()=>{})'
// A header inserted above the content after the first paint, as on Clearwater.
const lateHeader = 'setTimeout(()=>document.body.insertAdjacentHTML(\'afterbegin\',\'<div style="height:300px">Header</div>\'),1200)'

test('crawler render catches a page that breaks when its own API request is blocked', async (t) => {
  let browser
  try {
    browser = await launchBrowser(await loadPlaywright())
  }
  catch (error) {
    t.skip(`no browser: ${error.message.slice(0, 80)}`)
    return
  }
  const server = createServer((request, response) => {
    const send = (status, body, type = 'text/html') => {
      response.writeHead(status, { 'content-type': type })
      response.end(body)
    }
    if (request.url === '/robots.txt')
      return send(200, 'User-agent: *\nDisallow: /api\n', 'text/plain')
    if (request.url.startsWith('/api/'))
      return send(200, '{}', 'application/json')
    if (request.url === '/broken/')
      return send(200, page('Broken Listing', breaksOnFailure))
    if (request.url === '/' || request.url === '/fixed/')
      return send(200, page('Fixed Listing', survivesFailure).replace('<p>', '<a href="/broken/">listing</a><p>'))
    if (request.url === '/jumpy/')
      return send(200, page('Jumpy Listing', lateHeader))
    return send(200, page('Soft Missing'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/`
  try {
    const report = await crawlerRender({ base, pages: ['/fixed/', '/broken/', '/jumpy/'], browser })
    const [fixed, broken, jumpy] = report.pages
    assert.equal(fixed.ok, true, JSON.stringify(fixed.problems))
    assert.ok(fixed.links.includes(`${base}broken/`), 'links are collected from the open render')
    const shift = jumpy.problems.find(problem => problem.code === 'layout-shift')
    assert.ok(shift, JSON.stringify(jumpy.problems))
    assert.match(shift.detail, /moved -?\d+px/)
    assert.equal(broken.ok, false)
    for (const mode of ['robots', 'no-api'])
      assert.ok(broken.problems.some(problem => problem.mode === mode && problem.code === 'error-screen'), `${mode}: ${JSON.stringify(broken.problems)}`)
    assert.ok(broken.loads.robots.blocked.includes('POST /api/kv'))
    assert.equal(report.missingPage.problems[0].code, 'soft-404')
    assert.equal(report.ok, false)
  }
  finally {
    server.close()
    await browser.close()
  }
})

// A fake site for fetch(): path -> { status, location?, html? }.
const fakeSite = routes => async (url) => {
  const { pathname, search } = new URL(url)
  const route = routes[`${pathname}${search}`] || routes[pathname] || { status: 404, html: '<title>Not found</title>' }
  const headers = new Map(Object.entries({ 'content-type': 'text/html', ...(route.location ? { location: route.location } : {}), ...(route.headers || {}) }))
  return { status: route.status, headers: { get: name => headers.get(name.toLowerCase()) ?? null }, text: async () => route.html || '' }
}
const listingHtml = (canonical, extra = '') => `<html><head><link rel="canonical" href="${canonical}">${extra}</head><body>Listing</body></html>`
const BASE = 'https://www.example.com'

test('probes follow redirects hop by hop and flag chains, alias landings and noindex', async () => {
  const fetcher = fakeSite({
    '/properties/mt_1/city/address': { status: 301, location: '/properties/mt_1/city/address/' },
    '/properties/mt_1/city/address/': { status: 301, location: `${BASE}/properties/abc/MT-City-Address` },
    '/properties/abc/MT-City-Address': { status: 301, location: '/properties/abc/MT-City-Address/' },
    '/properties/abc/MT-City-Address/': { status: 200, html: listingHtml(`${BASE}/properties/abc/`) },
    '/hidden/': { status: 200, html: listingHtml(`${BASE}/hidden/`, '<meta name="robots" content="noindex">') },
  })
  const probe = await probeUrl(`${BASE}/properties/mt_1/city/address`, { fetcher })
  assert.equal(probe.hops.length, 3)
  assert.equal(probe.final, `${BASE}/properties/abc/MT-City-Address/`)
  assert.deepEqual(judgeProbe(probe).map(problem => problem.code), ['redirect-chain', 'redirect-to-alias'])
  assert.deepEqual(judgeProbe(await probeUrl(`${BASE}/hidden/`, { fetcher })).map(problem => problem.code), ['noindex'])
})

test('URL variants must redirect to the canonical page or name it; a self-canonical copy is an error', async () => {
  const canonical = `${BASE}/offices/bigfork/`
  const fetcher = fakeSite({
    '/offices/Bigfork/': { status: 200, html: listingHtml(`${BASE}/offices/Bigfork/`) },
    '/offices/bigfork': { status: 308, location: '/offices/bigfork/' },
    '/offices/bigfork/': { status: 200, html: listingHtml(canonical) },
  })
  const { results, problems } = await checkVariants([canonical], { fetcher })
  assert.deepEqual(results.map(result => `${result.kind}:${result.ok}`), ['uppercase:false', 'no-trailing-slash:true', 'tracking-query:true'])
  assert.deepEqual(problems.map(problem => `${problem.severity}:${problem.code}`), ['error:duplicate-variant'])
})

test('internal links are grouped by pattern and flagged when they redirect or point at aliases', async () => {
  assert.equal(linkPattern(`${BASE}/properties/0a94008b-0b4d-3ff1-96db-f160e775ae54/MT-Great-Falls-2626-8th/`), '/properties/<id>/<slug>/')
  const fetcher = fakeSite({
    '/sell-with-us': { status: 308, location: '/sell-with-us/' },
    '/sell-with-us/': { status: 200, html: listingHtml(`${BASE}/sell-with-us/`) },
    '/properties/0a94008b-0b4d-3ff1-96db-f160e775ae54/MT-A-1/': { status: 200, html: listingHtml(`${BASE}/properties/0a94008b-0b4d-3ff1-96db-f160e775ae54/`) },
    '/about/': { status: 200, html: listingHtml(`${BASE}/about/`) },
  })
  const links = [
    ...Array.from({ length: 5 }, () => ({ href: `${BASE}/sell-with-us`, from: `${BASE}/` })),
    { href: `${BASE}/properties/0a94008b-0b4d-3ff1-96db-f160e775ae54/MT-A-1/`, from: `${BASE}/` },
    { href: `${BASE}/about/`, from: `${BASE}/` },
  ]
  const report = await checkInternalLinks(links, { fetcher })
  assert.equal(report.patterns, 3)
  assert.deepEqual(report.problems.map(problem => problem.code), ['link-to-alias', 'link-to-alias'])
  assert.match(report.problems[0].detail, /^5 link\(s\) like .*sell-with-us redirect 1x/)
})

test('Pages report exports are read, merged by reason and sampled live', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'coverage-test-'))
  const make = (name, reason, urls, chart) => {
    const dir = join(folder, name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Metadata.csv'), `\uFEFFProperty,Value\nSitemap,All known pages\nIssue,${reason}`)
    writeFileSync(join(dir, 'Table.csv'), `URL,Last crawled\n${urls.map(url => `"${url}",2026-11-17`).join('\n')}\n`)
    if (chart)
      writeFileSync(join(dir, 'Chart.csv'), `Date,Affected pages\n2026-11-14,100\n2026-11-15,${chart}\n`)
    return dir
  }
  try {
    const noindex = readCoverageExport(make('a', 'Excluded by ‘noindex’ tag', [`${BASE}/properties/x/`, `${BASE}/properties/y/a,b`], 113))
    assert.equal(noindex.reason, 'Excluded by \'noindex\' tag')
    assert.equal(noindex.affected, 113)
    assert.deepEqual(noindex.urls.map(entry => entry.url), [`${BASE}/properties/x/`, `${BASE}/properties/y/a,b`])
    assert.equal(reasonKind(noindex.reason), 'noindex')
    const redirectSmall = readCoverageExport(make('b', 'Page with redirect', [`${BASE}/old/`]))
    const redirectLarge = readCoverageExport(make('c', 'Page with redirect', [`${BASE}/old/`, `${BASE}/older/`]))
    assert.equal(mergeCoverageExports([redirectSmall, noindex, redirectLarge]).length, 2)

    const fetcher = fakeSite({
      '/properties/x/': { status: 200, html: listingHtml(`${BASE}/properties/x/`) },
      '/properties/y/a,b': { status: 200, html: listingHtml(`${BASE}/properties/y/`) },
      '/old/': { status: 301, location: '/older/' },
      '/older/': { status: 301, location: '/new/' },
      '/new/': { status: 200, html: listingHtml(`${BASE}/new/`) },
    })
    const report = await checkCoverage([noindex, redirectSmall, redirectLarge], { fetcher, sample: 4 })
    const byKind = Object.fromEntries(report.reasons.map(reason => [reason.kind, reason]))
    assert.equal(byKind.noindex.problems[0].code, 'coverage-fixed')
    assert.equal(byKind.redirect.exported, 2)
    assert.equal(byKind.redirect.problems[0].code, 'redirect-chain')
  }
  finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('Core Web Vitals: Google thresholds, poor is an error, no data for a page is not a problem', async () => {
  assert.equal(rate('largest_contentful_paint', 2500), 'good')
  assert.equal(rate('largest_contentful_paint', 3523), 'needs-improvement')
  assert.equal(rate('cumulative_layout_shift', 0.26), 'poor')
  assert.equal(rate('interaction_to_next_paint', 96), 'good')
  const requests = []
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (body.url)
      return { ok: false, status: 404, json: async () => ({}) }
    const phone = body.formFactor === 'PHONE'
    return {
      ok: true,
      status: 200,
      json: async () => ({
        record: {
          collectionPeriod: {},
          metrics: {
            largest_contentful_paint: { percentiles: { p75: phone ? 4200 : 2100 } },
            interaction_to_next_paint: { percentiles: { p75: 96 } },
            cumulative_layout_shift: { percentiles: { p75: phone ? '0.17' : '0.08' } },
          },
        },
      }),
    }
  }
  const report = await checkWebVitals({ origin: BASE, urls: [`${BASE}/`], key: 'k', fetcher })
  assert.deepEqual(report.problems.map(problem => `${problem.severity}:${problem.code}`), ['error:cwv-lcp', 'warning:cwv-cls'])
  assert.equal(report.pages[0].phone, null)
  assert.deepEqual(requests.map(body => body.formFactor), ['PHONE', 'DESKTOP', 'PHONE'])
  assert.equal((await checkWebVitals({ origin: BASE, key: '' })).problems[0].code, 'cwv-unavailable')
})
