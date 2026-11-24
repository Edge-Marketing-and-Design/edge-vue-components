// The edge-search-health scripts: robots rules, page choice, render
// comparison, Search Console summaries, traffic alarms, Google auth and the
// audit report. The browser test runs only where Playwright and Chrome load.
import assert from 'node:assert/strict'
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { diffProblems, formatAudit } from '../skills/edge-search-health/scripts/audit.mjs'
import { checkOpenRender, compareRenders, crawlerRender, isAllowed, launchBrowser, loadPlaywright, parseRobots, rulesForAgent, selectTemplatePages } from '../skills/edge-search-health/scripts/crawler-render.mjs'
import { SEARCH_CONSOLE_SCOPE, getAccessToken, serviceAccountAssertion } from '../skills/edge-search-health/scripts/google-auth.mjs'
import { checkSitemaps, compareTraffic, findProperty, summarizeInspection } from '../skills/edge-search-health/scripts/search-console.mjs'

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
const page = (title, script = '') => `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"WebPage"}</script></head><body><h1>${title}</h1><p>${'Real listing content. '.repeat(40)}</p><script>${script}</script></body></html>`
const breaksOnFailure = 'fetch(\'/api/kv\',{method:\'POST\'}).catch(()=>{document.title=\'Unable to load this page\';document.head.querySelector(\'script[type="application/ld+json"]\').remove();document.head.insertAdjacentHTML(\'beforeend\',\'<meta name="robots" content="noindex">\');document.body.innerHTML=\'<h1>Unable to load this page</h1>\'})'
const survivesFailure = 'fetch(\'/api/kv\',{method:\'POST\'}).catch(()=>{})'

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
      return send(200, page('Fixed Listing', survivesFailure))
    return send(200, page('Soft Missing'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/`
  try {
    const report = await crawlerRender({ base, pages: ['/fixed/', '/broken/'], browser })
    const [fixed, broken] = report.pages
    assert.equal(fixed.ok, true, JSON.stringify(fixed.problems))
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
