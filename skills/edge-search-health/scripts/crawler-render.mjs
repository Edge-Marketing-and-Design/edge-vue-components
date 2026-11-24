#!/usr/bin/env node
// Render pages the way a search engine does and compare with a normal visit.
//
//   node edge/skills/edge-search-health/scripts/crawler-render.mjs \
//     --base https://www.example.com [--pages /,/about/] [--sitemap] [--max-pages 12] \
//     [--preview-site <siteId>] [--json] [--out result.json]
//
// Each page loads three times in headless Chrome with Googlebot's smartphone
// user agent:
//   open     - nothing blocked (what a visitor sees)
//   robots   - same-site requests the site's robots.txt disallows for Googlebot
//              fail, as they do in Google's renderer
//   no-api   - every same-site fetch/XHR fails, as when Google's renderer gives
//              up on a slow request (499) even though robots.txt allows it
// A page fails when a restricted load turns into an error screen, gains
// noindex, changes its title, h1 or canonical, loses structured data, or (in
// the robots load) loses content. It also checks that a missing URL returns a
// real 404 status, not a soft 404.
//
// --preview-site renders a published-site preview host (e.g. <project>.pages.dev)
// after selecting the site with ?siteId=; preview hosts are always noindex and
// allow everything in robots.txt, so only the open and no-api loads run there.
// Read-only. Needs Chrome (or EDGE_PLAYWRIGHT_MODULE / playwright installed).
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const GOOGLEBOT_UA = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

// --- robots.txt -------------------------------------------------------------

// Groups of { agents: [lowercase tokens], rules: [{ allow, path }] }.
export const parseRobots = (text = '') => {
  const groups = []
  let current = null
  let lastWasAgent = false
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match)
      continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (current && (field === 'allow' || field === 'disallow'))
      current.rules.push({ allow: field === 'allow', path: value })
  }
  return groups
}

// Google uses the group(s) with the most specific matching agent, else '*'.
export const rulesForAgent = (groups, agent = 'googlebot') => {
  const token = agent.toLowerCase()
  const matching = groups.filter(group => group.agents.some(name => name !== '*' && token.startsWith(name)))
  if (matching.length) {
    const longest = Math.max(...matching.flatMap(group => group.agents.filter(name => token.startsWith(name)).map(name => name.length)))
    return matching.filter(group => group.agents.some(name => name.length === longest && token.startsWith(name))).flatMap(group => group.rules)
  }
  return groups.filter(group => group.agents.includes('*')).flatMap(group => group.rules)
}

const patternToRegExp = (pattern) => {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

// Longest matching rule wins; on a tie, allow wins. Empty Disallow allows all.
export const isAllowed = (rules, pathWithQuery) => {
  let best = null
  for (const rule of rules) {
    if (!rule.path)
      continue
    if (!patternToRegExp(rule.path).test(pathWithQuery))
      continue
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))
      best = rule
  }
  return best ? best.allow : true
}

// --- choosing pages -----------------------------------------------------------

// One page per template: the first URL for each (first path segment, depth)
// pair, e.g. /agents/ and /agents/<slug>/. The home page comes first, then
// detail templates (two or more segments, where collections render), then
// top-level pages, so a small cap still covers every collection.
export const selectTemplatePages = (urls, maxPages = 12) => {
  const chosen = new Map()
  for (const value of urls) {
    let url
    try {
      url = new URL(value)
    }
    catch {
      continue
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const depth = Math.min(segments.length, 3)
    const key = depth === 0 ? '/' : `${segments[0]}:${depth}`
    if (!chosen.has(key))
      chosen.set(key, { href: url.href, rank: depth === 0 ? 0 : depth >= 2 ? 1 : 2 })
  }
  return [...chosen.values()]
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, maxPages)
    .map(entry => entry.href)
}

const fetchText = async (url, fetcher = fetch) => {
  try {
    const response = await fetcher(url, { headers: { 'user-agent': GOOGLEBOT_UA } })
    return { status: response.status, text: await response.text() }
  }
  catch (error) {
    return { status: null, text: '', error: error.message }
  }
}

// Every <loc> in a sitemap, following sitemap indexes (bounded).
export const readSitemapUrls = async (sitemapUrl, { fetcher = fetch, limitFiles = 60, maxPerFile = Infinity } = {}) => {
  const urls = []
  const queue = [sitemapUrl]
  const seen = new Set()
  while (queue.length && seen.size < limitFiles) {
    const next = queue.shift()
    if (seen.has(next))
      continue
    seen.add(next)
    const { text } = await fetchText(next, fetcher)
    const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(match => match[1].replace(/&amp;/g, '&'))
    if (/<sitemapindex/i.test(text))
      queue.push(...locs)
    else
      urls.push(...locs.slice(0, maxPerFile))
  }
  return urls
}

// --- comparing renders ---------------------------------------------------------

const ERROR_SCREEN = /^(?:404|page not found|unable to load this page|500|internal server error|application error)$/i
const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
const hasNoindex = snapshot => /noindex/i.test(`${snapshot.robotsMeta || ''} ${snapshot.robotsHeader || ''}`)

// Problems in one restricted load compared with the open load.
// severity: 'error' fails the page; 'warning' is reported.
export const compareRenders = (open, restricted, { mode, preview = false } = {}) => {
  const problems = []
  const add = (severity, code, detail) => problems.push({ severity, code, mode, detail })
  if (restricted.failed) {
    add('error', 'load-failed', restricted.failed)
    return problems
  }
  if (ERROR_SCREEN.test(norm(restricted.title)) || ERROR_SCREEN.test(norm(restricted.h1)))
    add('error', 'error-screen', `rendered "${restricted.title || restricted.h1}" instead of the page`)
  if (!preview && hasNoindex(restricted) && !hasNoindex(open))
    add('error', 'noindex', `noindex appeared (${restricted.robotsMeta || restricted.robotsHeader})`)
  if (norm(restricted.title) !== norm(open.title))
    add('error', 'title-changed', `"${open.title}" -> "${restricted.title}"`)
  if (norm(restricted.h1) !== norm(open.h1))
    add('error', 'h1-changed', `"${open.h1}" -> "${restricted.h1}"`)
  if (!preview && (restricted.canonical || '') !== (open.canonical || ''))
    add('error', 'canonical-changed', `${open.canonical || '(none)'} -> ${restricted.canonical || '(none)'}`)
  if (restricted.structuredData < open.structuredData)
    add('error', 'structured-data-lost', `${open.structuredData} -> ${restricted.structuredData} JSON-LD blocks`)
  if (open.textLength > 0 && restricted.textLength < open.textLength * 0.9)
    add(mode === 'robots' ? 'error' : 'warning', 'content-lost', `visible text ${open.textLength} -> ${restricted.textLength} characters`)
  if (restricted.pageErrors.length)
    add('warning', 'script-errors', restricted.pageErrors.slice(0, 3).join(' | '))
  return problems
}

// Problems in the open load itself.
export const checkOpenRender = (open, { preview = false } = {}) => {
  const problems = []
  const add = (severity, code, detail) => problems.push({ severity, code, mode: 'open', detail })
  if (open.failed)
    return [{ severity: 'error', code: 'load-failed', mode: 'open', detail: open.failed }]
  if (open.status && open.status !== 200)
    add('error', 'status', `HTTP ${open.status}`)
  if (!preview && hasNoindex(open))
    add('error', 'noindex', `the page is noindex (${open.robotsMeta || open.robotsHeader})`)
  if (ERROR_SCREEN.test(norm(open.title)) || ERROR_SCREEN.test(norm(open.h1)))
    add('error', 'error-screen', `rendered "${open.title || open.h1}"`)
  if (!preview && !open.canonical)
    add('warning', 'no-canonical', 'no rel=canonical')
  if (!open.h1)
    add('warning', 'no-h1', 'no h1')
  if (!open.structuredData)
    add('warning', 'no-structured-data', 'no JSON-LD')
  if (open.invalidStructuredData)
    add('error', 'invalid-structured-data', `${open.invalidStructuredData} JSON-LD block(s) do not parse`)
  if (open.layoutShift > 0.1) {
    const first = open.shifts?.[0]
    add(open.layoutShift > 0.25 ? 'error' : 'warning', 'layout-shift', `layout shift ${open.layoutShift} while loading at phone width (good ≤ 0.1, poor > 0.25)${first ? `; at ${first.at} ms: ${first.sources.join(', ')}` : ''}`)
  }
  return problems
}

// --- browser ------------------------------------------------------------------

export const loadPlaywright = async () => {
  const candidates = [
    process.env.EDGE_PLAYWRIGHT_MODULE,
    'playwright',
    join(homedir(), '.cache', 'edge-skills', 'node_modules', 'playwright', 'index.mjs'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const target = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate
      const module = await import(target)
      return module.chromium ? module : module.default
    }
    catch {}
  }
  throw new Error('Playwright is not installed. Run once: npm install --prefix ~/.cache/edge-skills playwright@1.56.1 (it uses your installed Google Chrome; no browser download), or set EDGE_PLAYWRIGHT_MODULE to a playwright index.mjs.')
}

export const launchBrowser = async (playwright) => {
  const chromeApp = '/Applications/Google Chrome.app'
  try {
    return await playwright.chromium.launch({ channel: 'chrome', headless: true })
  }
  catch (error) {
    try {
      return await playwright.chromium.launch({ headless: true })
    }
    catch {
      throw new Error(`Could not start Chrome${existsSync(chromeApp) ? '' : ' (Google Chrome is not installed)'}: ${error.message.split('\n')[0]}`)
    }
  }
}

const snapshotScript = () => {
  const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')]
  let invalid = 0
  for (const block of blocks) {
    try {
      JSON.parse(block.textContent)
    }
    catch {
      invalid++
    }
  }
  return {
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map(node => node.innerText.trim()).filter(Boolean).join(' | ').slice(0, 160),
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robotsMeta: [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map(node => node.content).join(', '),
    textLength: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().length,
    structuredData: blocks.length,
    invalidStructuredData: invalid,
  }
}

// Layout shifts while the page loads (no input), with the elements that moved.
const recordLayoutShifts = () => {
  window.__edgeShifts = []
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput)
          continue
        window.__edgeShifts.push({
          at: Math.round(entry.startTime),
          value: entry.value,
          sources: entry.sources.map((source) => {
            const node = source.node
            const name = (node && node.nodeType === 1) ? `${node.nodeName.toLowerCase()}${node.id ? `#${node.id}` : ''}${(typeof node.className === 'string' && node.className) ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}` : '(text)'
            return `${name} moved ${Math.round(source.currentRect.y - source.previousRect.y)}px`
          }),
        })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  }
  catch {}
}

const openExtrasScript = () => {
  const shifts = window.__edgeShifts || []
  const links = [...new Set([...document.querySelectorAll('a[href]')]
    .map(anchor => anchor.href)
    .filter(href => href.startsWith(location.origin) && !/\.(?:pdf|jpe?g|png|webp|gif|svg|zip|xml|txt)(?:$|\?)/i.test(href))
    .map(href => href.split('#')[0]))].slice(0, 300)
  return {
    layoutShift: +shifts.reduce((sum, shift) => sum + shift.value, 0).toFixed(3),
    shifts: shifts.filter(shift => shift.value >= 0.01).slice(0, 3).map(shift => ({ ...shift, value: +shift.value.toFixed(3) })),
    links,
  }
}

export const renderPage = async (browser, url, { mode = 'open', rules = [], previewSite = '', timeout = 45000 } = {}) => {
  const context = await browser.newContext({ userAgent: GOOGLEBOT_UA, viewport: { width: 412, height: 915 }, isMobile: true })
  const page = await context.newPage()
  const origin = new URL(url).origin
  const blocked = []
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 200)))
  if (mode === 'open')
    await page.addInitScript(recordLayoutShifts)
  await page.route('**/*', (route) => {
    const request = route.request()
    let target
    try {
      target = new URL(request.url())
    }
    catch {
      return route.continue()
    }
    if (target.origin === origin && request.resourceType() !== 'document') {
      const path = `${target.pathname}${target.search}`
      const deny = (mode === 'robots' && !isAllowed(rules, path))
        || (mode === 'no-api' && ['fetch', 'xhr'].includes(request.resourceType()))
      if (deny) {
        blocked.push(`${request.method()} ${target.pathname}`)
        return route.abort('blockedbyclient')
      }
    }
    return route.continue()
  })
  try {
    if (previewSite)
      await page.goto(`${origin}/?siteId=${encodeURIComponent(previewSite)}`, { waitUntil: 'domcontentloaded', timeout })
    const response = await page.goto(url, { waitUntil: 'load', timeout })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const snapshot = await page.evaluate(snapshotScript)
    const extra = mode === 'open' ? await page.evaluate(openExtrasScript) : {}
    return {
      ...extra,
      url,
      mode,
      status: response?.status() ?? null,
      robotsHeader: response?.headers()['x-robots-tag'] || '',
      ...snapshot,
      blocked: [...new Set(blocked)],
      pageErrors,
    }
  }
  catch (error) {
    return { url, mode, failed: error.message.split('\n')[0], blocked: [...new Set(blocked)], pageErrors }
  }
  finally {
    await context.close()
  }
}

// --- run ----------------------------------------------------------------------

export const missingPageCheck = async (base, fetcher = fetch) => {
  const probe = `${base.replace(/\/$/, '')}/edge-search-health-missing-${Date.now().toString(36)}/`
  const { status, error } = await fetchText(probe, fetcher)
  return {
    url: probe,
    status,
    problems: status === 404 ? [] : [{ severity: 'error', code: 'soft-404', mode: 'open', detail: `a missing URL returned ${status ?? error} instead of 404` }],
  }
}

export const crawlerRender = async ({ base, pages = [], useSitemap = false, maxPages = 12, previewSite = '', fetcher = fetch, browser: givenBrowser = null, log = () => {} }) => {
  const root = new URL(base)
  const preview = Boolean(previewSite)
  const robots = await fetchText(new URL('/robots.txt', root).href, fetcher)
  const rules = rulesForAgent(parseRobots(robots.text), 'googlebot')
  let urls = pages.map(page => new URL(page, root).href)
  if (useSitemap || !urls.length) {
    const sitemapUrl = robots.text.match(/^\s*sitemap:\s*(\S+)/im)?.[1] || new URL('/sitemap.xml', root).href
    const fromSitemap = preview ? [] : await readSitemapUrls(sitemapUrl, { fetcher, maxPerFile: 25 })
    urls = selectTemplatePages([...urls, root.href, ...fromSitemap], maxPages)
  }
  const modes = preview ? ['open', 'no-api'] : ['open', 'robots', 'no-api']
  const browser = givenBrowser || await launchBrowser(await loadPlaywright())
  const results = []
  try {
    for (const url of urls) {
      log(`rendering ${url}`)
      const loads = {}
      for (const mode of modes)
        loads[mode] = await renderPage(browser, url, { mode, rules, previewSite })
      const problems = [
        ...checkOpenRender(loads.open, { preview }),
        ...modes.filter(mode => mode !== 'open' && !loads.open.failed).flatMap(mode => compareRenders(loads.open, loads[mode], { mode, preview })),
      ]
      results.push({
        url,
        ok: !problems.some(problem => problem.severity === 'error'),
        problems,
        loads: Object.fromEntries(Object.entries(loads).map(([mode, load]) => [mode, { status: load.status, title: load.title, h1: load.h1, canonical: load.canonical, robots: [load.robotsMeta, load.robotsHeader].filter(Boolean).join(' / '), textLength: load.textLength, structuredData: load.structuredData, layoutShift: load.layoutShift, shifts: load.shifts, blocked: load.blocked, failed: load.failed }])),
        links: loads.open.links || [],
      })
    }
  }
  finally {
    if (!givenBrowser)
      await browser.close()
  }
  const missing = preview ? null : await missingPageCheck(root.href, fetcher)
  const problems = [...results.flatMap(result => result.problems.map(problem => ({ ...problem, url: result.url }))), ...(missing?.problems || []).map(problem => ({ ...problem, url: missing.url }))]
  return {
    base: root.origin,
    preview,
    checkedAt: new Date().toISOString(),
    robotsTxt: { status: robots.status, googlebotRules: rules },
    pages: results,
    missingPage: missing,
    ok: !problems.some(problem => problem.severity === 'error'),
    problems,
  }
}

export const formatRender = (report) => {
  const lines = [`Crawler render: ${report.base}${report.preview ? ' (preview host)' : ''} - ${report.ok ? 'PASS' : 'FAIL'}`]
  for (const page of report.pages) {
    const open = page.loads.open
    lines.push(`${page.ok ? 'ok  ' : 'FAIL'} ${page.url}  "${open.title || open.failed || ''}"  text ${open.textLength ?? '-'}  ld ${open.structuredData ?? '-'}`)
    for (const problem of page.problems)
      lines.push(`       ${problem.severity} [${problem.mode}] ${problem.code}: ${problem.detail}`)
  }
  if (report.missingPage)
    lines.push(`${report.missingPage.problems.length ? 'FAIL' : 'ok  '} missing page returns ${report.missingPage.status}`)
  return lines.join('\n')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const base = value('--base')
  if (!base) {
    console.error('Usage: crawler-render.mjs --base https://www.example.com [--pages /,/about/] [--sitemap] [--max-pages 12] [--preview-site <siteId>] [--json] [--out file]')
    process.exit(2)
  }
  try {
    const report = await crawlerRender({
      base,
      pages: (value('--pages') || '').split(',').map(page => page.trim()).filter(Boolean),
      useSitemap: args.includes('--sitemap'),
      maxPages: Number(value('--max-pages') || 12),
      previewSite: value('--preview-site') || '',
      log: message => console.error(message),
    })
    if (value('--out'))
      await writeFile(value('--out'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatRender(report))
    process.exit(report.ok ? 0 : 1)
  }
  catch (error) {
    console.error(error.message)
    process.exit(2)
  }
}
