#!/usr/bin/env node
// Search health audit for one live site: crawler render (crawler-render.mjs)
// plus what Google decided (search-console.mjs), saved with history so each
// run reports what changed since the last one.
//
//   node edge/skills/edge-search-health/scripts/audit.mjs --host www.example.com \
//     [--launch-date 2026-10-24] [--pages /,/about/] [--max-pages 12] [--inspect 12] \
//     [--out importfiles/search-health/www.example.com] [--credentials file] [--skip-search-console]
//     [--coverage <Pages report export.zip|folder>]... [--skip-vitals]
//
// Writes <out>/<YYYY-MM-DD>.json and <out>/<YYYY-MM-DD>.md (same-day runs
// overwrite), and prints the summary. Besides the render and Search Console it
// checks URL variants and the site's own links against canonical URLs,
// real-user Core Web Vitals (Chrome UX Report key), and, given Pages report
// exports from Search Console, samples every "not indexed" reason live. --launch-date compares traffic with the
// 28 days before launch; without it, with the previous 28 days.
// Exit codes: 0 no errors, 1 errors found, 2 the audit could not run.
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { crawlerRender } from './crawler-render.mjs'
import { checkSitemaps, compareTraffic, connect, fetchDailyTraffic, findProperty, inspectUrls } from './search-console.mjs'
import { checkCoverage, checkInternalLinks, checkVariants, coverageInputs, probeUrl, readCoverageExport, sameUrl } from './url-checks.mjs'
import { THRESHOLDS, checkWebVitals } from './web-vitals.mjs'

// What to do about each problem, in plain words.
export const ADVICE = {
  'error-screen': 'The page turns into an error screen when a request fails while it loads, which Google reports as a Soft 404. The page code must catch the failure and keep the server-rendered content (emd-cms-front); allowing the path in robots.txt is not enough, because Google also abandons slow requests.',
  'noindex': 'noindex appears on a page that should be indexed. Find what adds it (an error view, a block, a header) before anything else.',
  'title-changed': 'The page changes its title when a request fails while it loads; usually the same cause as error-screen.',
  'h1-changed': 'The page changes its main heading when a request fails while it loads; usually the same cause as error-screen.',
  'canonical-changed': 'The canonical link changes or disappears when a request fails while it loads.',
  'structured-data-lost': 'JSON-LD disappears when a request fails while it loads; rich results depend on it.',
  'content-lost': 'Content that only loads through a request robots.txt blocks is invisible to Google. Render it on the server or allow that path.',
  'load-failed': 'The page did not load in time. Re-run; if it repeats, check the page in a browser.',
  'status': 'The page does not return 200.',
  'soft-404': 'Google treats this page (or a missing URL) as "not found" even though it returns 200. Check the page\'s rendered view (crawler render, or URL Inspection > Test live URL > View tested page > Screenshot). After fixing: Request indexing on key pages and Validate fix on the Soft 404 group in the Pages report.',
  'blocked-by-robots': 'robots.txt blocks this page for Googlebot.',
  'fetch-error': 'Google could not fetch this page (404, server error, redirect error or access denied).',
  'not-canonical': 'Google chose a different URL as the canonical, so this one is not indexed. Check canonical tags and duplicate URLs.',
  'canonical-mismatch': 'Google picked a different canonical than the page declares.',
  'not-indexed': 'Google has not indexed this page; see the coverage state.',
  'not-crawled-yet': 'Google has not crawled this URL yet. Normal for a new page; Request indexing for key pages.',
  'rich-results-invalid': 'Structured data has errors that block rich results.',
  'sitemap-not-submitted': 'In Search Console > Sitemaps, submit the site\'s sitemap.xml.',
  'sitemap-not-read': 'Google has not read the sitemap yet. Normal for a day or two after submitting.',
  'sitemap-stale': 'Google has not re-read the sitemap recently. Resubmit it in Search Console > Sitemaps.',
  'sitemap-errors': 'The sitemap has errors; open it in Search Console > Sitemaps.',
  'traffic-drop': 'Search clicks or impressions fell sharply. Look at the other problems first (Soft 404, noindex, robots); then the Pages report in Search Console for the URLs that dropped out.',
  'search-console-unavailable': 'Search Console data was not checked. Set up access (reference/search-console-setup.md) and add the account to the site\'s property.',
  'no-canonical': 'Add a rel=canonical link.',
  'no-h1': 'Add one h1.',
  'no-structured-data': 'Add structured data for the page type.',
  'invalid-structured-data': 'Fix the JSON-LD so it parses.',
  'script-errors': 'Scripts threw errors while the page loaded with a request blocked; check they are handled.',
  'sitemap-url': 'The sitemap lists an address that redirects or names another canonical. List only final, canonical URLs in sitemaps.',
  'redirect-chain': 'Old URLs take several redirects to reach a page. Redirect each one in a single step (301) straight to the canonical URL; chains slow crawling and weaken the signal.',
  'redirect-to-alias': 'Redirects end on an address whose canonical is a different URL. Point the redirect at the canonical URL itself.',
  'alias-url': 'The same page answers at more than one address. Keep one canonical address and make links, redirects and the sitemap use it; redirect (301) the others where possible.',
  'link-to-alias': 'The site links to addresses that redirect or are aliases of another canonical URL. Change the links (cards, menus, blocks) to the canonical URL so Google gets one consistent signal.',
  'broken-internal-link': 'The site links to pages that return an error.',
  'duplicate-variant': 'A capitalized, slashless or tracking-query copy of a page is served as its own canonical page. Redirect (301) such variants to the canonical URL, or point their canonical link at it.',
  'layout-shift': 'The page moves while it loads (Core Web Vitals CLS). Reserve space for what appears late (header, banners, images, overlays) in the server HTML and CSS.',
  'cwv-lcp': 'Real users wait too long for the main content (LCP). Usual causes: render-blocking fonts or CSS, large hero images, slow server response. Run Lighthouse on the slow templates for specifics.',
  'cwv-inp': 'Pages respond slowly to taps and clicks (INP). Look for long JavaScript tasks.',
  'cwv-cls': 'Real users see the page jump while loading (CLS). See layout-shift on the templates for the element that moves.',
  'cwv-unavailable': 'Core Web Vitals field data was not checked: set up the Chrome UX Report key (reference/search-console-setup.md).',
  'coverage-fixed': 'The cause behind this Pages report reason is gone on the live site. Validate fix on that reason in Search Console.',
  'coverage-expected': 'Expected for this kind of URL; nothing to fix unless the samples show otherwise.',
  'coverage-other': 'Review this reason in Search Console.',
}

const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

const key = problem => `${problem.code}|${problem.url || ''}|${problem.mode || ''}`

export const diffProblems = (previous = [], current = []) => {
  const before = new Set(previous.filter(problem => problem.severity !== 'info').map(key))
  const now = new Set(current.filter(problem => problem.severity !== 'info').map(key))
  return {
    new: current.filter(problem => problem.severity !== 'info' && !before.has(key(problem))),
    resolved: previous.filter(problem => problem.severity !== 'info' && !now.has(key(problem))),
  }
}

export const formatAudit = (audit) => {
  const errors = audit.problems.filter(problem => problem.severity === 'error')
  const warnings = audit.problems.filter(problem => problem.severity === 'warning')
  const lines = [
    `# Search health: ${audit.host} (${audit.date})`,
    '',
    `**${errors.length ? 'FAIL' : 'PASS'}**: ${errors.length} error(s), ${warnings.length} warning(s).${audit.launchDate ? ` Launched ${audit.launchDate}.` : ''}`,
    '',
    '## Crawler render',
    '',
    '| Page | Title | Text | JSON-LD | Result |',
    '| --- | --- | --- | --- | --- |',
    ...audit.render.pages.map(page => `| ${new URL(page.url).pathname} | ${cell(page.loads.open.title || page.loads.open.failed)} | ${page.loads.open.textLength ?? ''} | ${page.loads.open.structuredData ?? ''} | ${page.ok ? 'ok' : page.problems.filter(problem => problem.severity === 'error').map(problem => `${problem.code} (${problem.mode})`).join(', ')} |`),
    '',
    `Missing URL returns ${audit.render.missingPage?.status ?? 'n/a'}${audit.render.missingPage?.problems.length ? ' (soft 404)' : ''}.`,
    '',
    '## Search Console',
    '',
  ]
  const sc = audit.searchConsole
  if (!sc?.property) {
    lines.push(sc?.error || 'Not checked.', '')
  }
  else {
    lines.push(`Property \`${sc.property}\`.`, '')
    lines.push(`**Sitemaps:** ${sc.sitemaps.sitemaps.map(sitemap => `${sitemap.path} (read ${sitemap.lastDownloaded?.slice(0, 10) || 'never'}${sitemap.errors ? `, ${sitemap.errors} errors` : ''})`).join('; ') || 'none submitted'}`, '')
    if (sc.traffic) {
      const t = sc.traffic
      lines.push(`**Traffic** (baseline ${t.baseline.start}..${t.baseline.end}, ${t.baselineKind}): ${t.baseline.clicksPerDay} clicks/day, ${t.baseline.impressionsPerDay} impressions/day. Last 7 days ${t.recent.clicksPerDay} / ${t.recent.impressionsPerDay} (${t.recent.change.clicks ?? 'n/a'}% / ${t.recent.change.impressions ?? 'n/a'}%). Last 3 days ${t.latest.clicksPerDay} / ${t.latest.impressionsPerDay}.`, '')
    }
    lines.push('| Page | Coverage | Last crawl | Google canonical | Rich results |', '| --- | --- | --- | --- | --- |')
    for (const inspection of sc.inspections)
      lines.push(`| ${new URL(inspection.url).pathname} | ${cell(inspection.coverageState || inspection.problems?.[0]?.detail)} | ${inspection.lastCrawlTime?.slice(0, 10) || ''} | ${inspection.googleCanonical === inspection.userCanonical ? 'same' : (inspection.googleCanonical || '')} | ${(inspection.richResults || []).join(', ')} |`)
    lines.push('')
  }
  if (audit.urls) {
    lines.push('## Site URLs', '')
    const badVariants = audit.urls.variants.results.filter(result => !result.ok)
    lines.push(`**Variants** (uppercase, no trailing slash, tracking query) of ${audit.render.pages.length} pages: ${badVariants.length ? `${badVariants.length} served as separate pages` : 'all redirect or point at the canonical URL'}.`)
    lines.push(`**Links:** ${audit.urls.links.checked.length} sampled from ${audit.urls.links.patterns} link patterns; ${audit.urls.links.problems.length ? `${audit.urls.links.problems.length} pattern(s) point at redirects or aliases (below)` : 'all point at canonical URLs'}.`)
    lines.push(`**Sitemap entries:** ${audit.urls.sitemap?.length ? `${audit.urls.sitemap.length} of the sampled pages redirect or are aliases (below)` : 'the sampled entries are final, canonical URLs'}.`, '')
  }
  if (audit.coverage) {
    lines.push('## Pages report (not indexed)', '', '| Reason | Pages | Sampled | More than 1 redirect | Ends on alias | noindex now | Clean |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const reason of audit.coverage.reasons)
      lines.push(`| ${cell(reason.reason)} | ${reason.affected ?? `${reason.exported}+`} | ${reason.sampled} | ${reason.tally.redirectChains} | ${reason.tally.landsOnAlias} | ${reason.tally.noindexNow} | ${reason.tally.ok} |`)
    lines.push('')
  }
  if (audit.vitals?.available) {
    const fmt = summary => (summary ? Object.entries(THRESHOLDS).filter(([metric]) => summary[metric]).map(([metric, threshold]) => `${threshold.label} ${threshold.unit === 'ms' ? `${(summary[metric].p75 / 1000).toFixed(2)} s` : summary[metric].p75} (${summary[metric].rating.replace('-', ' ')})`).join(', ') : 'not enough traffic')
    lines.push('## Core Web Vitals (real users, 75th percentile)', '', `- Site, phone: ${fmt(audit.vitals.site.PHONE)}`, `- Site, desktop: ${fmt(audit.vitals.site.DESKTOP)}`)
    const withData = audit.vitals.pages.filter(page => page.phone)
    lines.push(`- Pages with their own data: ${withData.length ? withData.map(page => `${new URL(page.url).pathname} ${fmt(page.phone)}`).join('; ') : 'none yet (Google reports this site by URL group)'}`)
    const shifting = audit.render.pages.filter(page => page.loads.open.layoutShift > 0.1)
    lines.push(`- Lab layout shift at phone width: ${shifting.length ? shifting.map(page => `${new URL(page.url).pathname} ${page.loads.open.layoutShift}`).join(', ') : 'all templates ≤ 0.1'}`, '')
  }
  if (audit.changes) {
    lines.push(`## Since ${audit.changes.since}`, '')
    lines.push(audit.changes.new.length ? `New: ${audit.changes.new.map(problem => `${problem.code}${problem.url ? ` ${new URL(problem.url).pathname}` : ''}`).join(', ')}` : 'No new problems.')
    lines.push(audit.changes.resolved.length ? `Resolved: ${audit.changes.resolved.map(problem => `${problem.code}${problem.url ? ` ${new URL(problem.url).pathname}` : ''}`).join(', ')}` : 'Nothing resolved.', '')
  }
  if (audit.problems.length) {
    lines.push('## Problems and what to do', '')
    const byCode = new Map()
    for (const problem of audit.problems.filter(problem => problem.severity !== 'info')) {
      if (!byCode.has(problem.code))
        byCode.set(problem.code, [])
      byCode.get(problem.code).push(problem)
    }
    for (const [code, problems] of byCode) {
      lines.push(`- **${code}** (${problems[0].severity}, ${problems.length}): ${ADVICE[code] || ''}`)
      for (const problem of problems.slice(0, 5))
        lines.push(`  - ${problem.url ? `${new URL(problem.url).pathname}: ` : ''}${problem.detail}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

const previousAudit = async (out, date) => {
  if (!existsSync(out))
    return null
  const files = (await readdir(out)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name < `${date}.json`).sort()
  if (!files.length)
    return null
  return JSON.parse(await readFile(join(out, files.at(-1)), 'utf8'))
}

export const runAudit = async ({ host, launchDate = '', pages = [], maxPages = 12, inspect = 12, out = '', credentials = '', skipSearchConsole = false, coverage = [], skipVitals = false, log = () => {} }) => {
  const date = new Date().toISOString().slice(0, 10)
  const base = `https://${host}/`
  log('crawler render')
  const render = await crawlerRender({ base, pages, useSitemap: !pages.length, maxPages, log })
  let searchConsole = null
  const scProblems = []
  if (!skipSearchConsole) {
    try {
      const client = await connect({ credentials })
      const property = findProperty(await client.sites(), host)
      if (!property)
        throw new Error(`The Search Console account cannot see a property for ${host}; add it as a user on the property.`)
      log(`search console ${property}`)
      const sitemaps = checkSitemaps(await client.sitemaps(property), { expected: `${base}sitemap.xml` })
      const inspections = await inspectUrls(client, property, render.pages.slice(0, inspect).map(page => page.url))
      const traffic = compareTraffic(await fetchDailyTraffic(client, property), { launchDate })
      searchConsole = { property, sitemaps, inspections, traffic }
      scProblems.push(...sitemaps.problems, ...inspections.flatMap(inspection => inspection.problems), ...traffic.problems)
    }
    catch (error) {
      searchConsole = { error: error.message }
      scProblems.push({ severity: 'error', code: 'search-console-unavailable', detail: error.message })
    }
  }
  log('url variants and links')
  const canonicalPages = render.pages.map(page => page.loads.open.canonical || page.url).filter(Boolean)
  const variants = await checkVariants(canonicalPages)
  // Sitemap entries must be final, canonical URLs (no redirect, no alias).
  const sitemapProblems = []
  if (!pages.length) {
    for (const page of render.pages) {
      const probe = await probeUrl(page.url)
      if (probe.hops.length || (probe.status === 200 && probe.canonical && !sameUrl(probe.canonical, probe.final)))
        sitemapProblems.push({ severity: 'warning', code: 'sitemap-url', url: page.url, detail: `listed in the sitemap but ${probe.hops.length ? `redirects to ${probe.final}` : `its canonical is ${probe.canonical}`}` })
    }
  }
  const links = await checkInternalLinks(render.pages.flatMap(page => (page.links || []).map(href => ({ href, from: page.url }))))
  const urls = { variants, links, sitemap: sitemapProblems }
  let coverageReport = null
  if (coverage.length) {
    log('pages report exports')
    coverageReport = await checkCoverage(coverageInputs(coverage).map(readCoverageExport))
  }
  let vitals = null
  if (!skipVitals) {
    log('core web vitals')
    try {
      vitals = await checkWebVitals({ origin: `https://${host}`, urls: render.pages.map(page => page.url) })
    }
    catch (error) {
      vitals = { available: false, problems: [{ severity: 'warning', code: 'cwv-unavailable', detail: error.message }] }
    }
  }
  const problems = [...render.problems, ...scProblems, ...sitemapProblems, ...variants.problems, ...links.problems, ...(coverageReport?.problems || []), ...(vitals?.problems || [])]
  const audit = { host, date, launchDate: launchDate || null, render: { ...render, pages: render.pages.map(({ links: _links, ...page }) => page) }, searchConsole, urls, coverage: coverageReport, vitals, problems, ok: !problems.some(problem => problem.severity === 'error') }
  const folder = out || join('importfiles', 'search-health', host)
  const previous = await previousAudit(folder, date)
  if (previous)
    audit.changes = { since: previous.date, ...diffProblems(previous.problems, problems) }
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, `${date}.json`), `${JSON.stringify(audit, null, 2)}\n`)
  const summary = formatAudit(audit)
  await writeFile(join(folder, `${date}.md`), `${summary}\n`)
  return { audit, summary, folder }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const host = value('--host')
  if (!host) {
    console.error('Usage: audit.mjs --host www.example.com [--launch-date YYYY-MM-DD] [--pages /,/a/] [--max-pages 12] [--inspect 12] [--out dir] [--credentials file] [--skip-search-console] [--coverage export.zip|folder]... [--skip-vitals]')
    process.exit(2)
  }
  try {
    const { audit, summary, folder } = await runAudit({
      host: host.toLowerCase(),
      launchDate: value('--launch-date') || '',
      pages: (value('--pages') || '').split(',').map(page => page.trim()).filter(Boolean),
      maxPages: Number(value('--max-pages') || 12),
      inspect: Number(value('--inspect') || 12),
      out: value('--out') || '',
      credentials: value('--credentials') || '',
      skipSearchConsole: args.includes('--skip-search-console'),
      coverage: args.flatMap((arg, index) => ((arg === '--coverage' && args[index + 1]) ? [args[index + 1]] : [])),
      skipVitals: args.includes('--skip-vitals'),
      log: message => console.error(message),
    })
    console.log(summary)
    console.log(`\nSaved in ${folder}/`)
    process.exit(audit.ok ? 0 : 1)
  }
  catch (error) {
    console.error(error.message)
    process.exit(2)
  }
}
