#!/usr/bin/env node
// URL consistency checks: what a URL answers when fetched as Googlebot, hop by
// hop, and whether the site agrees with itself about each page's address.
//
//   node edge/skills/edge-search-health/scripts/url-checks.mjs probe <url> [<url>...]
//   node edge/skills/edge-search-health/scripts/url-checks.mjs coverage <export.zip|folder> [...] [--sample 8]
//
// - Redirects: more than one hop, or landing on a page whose canonical is a
//   different URL (an alias), wastes crawling and splits signals.
// - Links: the site's own links should point at canonical URLs, not at
//   redirects or aliases.
// - Variants: an uppercase, slashless or tracking-query copy of a page must
//   redirect to it or name it as canonical, never claim to be canonical itself.
// - Coverage: Search Console's Pages report (not available through the API)
//   exported as zips; each "not indexed" reason is sampled and probed live.
// Read-only GET requests.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { GOOGLEBOT_UA } from './crawler-render.mjs'

const attr = (html, pattern) => html.match(pattern)?.[1] || ''

// Normalized for comparison: no fragment, decoded path, default port dropped.
export const sameUrl = (a, b) => {
  try {
    const x = new URL(a)
    const y = new URL(b)
    x.hash = ''
    y.hash = ''
    return decodeURI(x.href) === decodeURI(y.href)
  }
  catch {
    return a === b
  }
}

// Follow redirects one hop at a time. Returns the chain and the final page's
// status, canonical and robots directives.
export const probeUrl = async (url, { fetcher = fetch, maxHops = 6 } = {}) => {
  const hops = []
  let current = url
  for (let i = 0; i <= maxHops; i++) {
    let response
    try {
      response = await fetcher(current, { redirect: 'manual', headers: { 'user-agent': GOOGLEBOT_UA } })
    }
    catch (error) {
      return { url, hops, final: current, status: null, error: error.message }
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      hops.push({ status: response.status, from: current, to: new URL(location, current).href })
      current = hops.at(-1).to
      continue
    }
    const html = /html/.test(response.headers.get('content-type') || '') ? await response.text() : ''
    const canonical = attr(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || attr(html, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)
    return {
      url,
      hops,
      final: current,
      status: response.status,
      canonical: canonical ? new URL(canonical.replace(/&amp;/g, '&'), current).href : '',
      robots: [attr(html, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i), response.headers.get('x-robots-tag') || ''].filter(Boolean).join(' / '),
    }
  }
  return { url, hops, final: current, status: null, error: `more than ${maxHops} redirects` }
}

// Problems with one probed URL that is expected to end on an indexable page.
export const judgeProbe = (probe, { expectRedirect = false } = {}) => {
  const problems = []
  const add = (severity, code, detail) => problems.push({ severity, code, url: probe.url, detail })
  if (probe.error)
    add('error', 'fetch-error', probe.error)
  else if (probe.status >= 500)
    add('error', 'fetch-error', `ends on HTTP ${probe.status}`)
  if (probe.hops.length > 1)
    add('warning', 'redirect-chain', `${probe.hops.length} redirects (${probe.hops.map(hop => hop.status).join(', ')}) to ${probe.final}; redirect in one step to the canonical URL`)
  if (probe.status === 200 && probe.canonical && !sameUrl(probe.canonical, probe.final))
    add('warning', probe.hops.length ? 'redirect-to-alias' : 'alias-url', `${probe.hops.length ? 'redirects to' : 'serves'} ${probe.final}, whose canonical is ${probe.canonical}${probe.hops.length ? '; redirect straight to the canonical' : ''}`)
  if (probe.status === 200 && !probe.canonical)
    add('warning', 'no-canonical', `${probe.final} has no canonical link`)
  if (probe.status === 200 && /noindex/i.test(probe.robots))
    add('error', 'noindex', `${probe.final} is ${probe.robots}`)
  if (expectRedirect && !probe.hops.length && probe.status === 200 && probe.canonical && sameUrl(probe.canonical, probe.final))
    add('error', 'duplicate-variant', `${probe.url} serves its own copy and names itself canonical`)
  return problems
}

// --- URL variants -------------------------------------------------------------

// Copies of a canonical page a crawler may find through old links.
export const urlVariants = (canonical) => {
  const url = new URL(canonical)
  const variants = []
  const segments = url.pathname.split('/')
  const last = segments.findLastIndex(segment => /[a-z]/.test(segment))
  if (last > 0) {
    const upper = [...segments]
    upper[last] = upper[last][0].toUpperCase() + upper[last].slice(1)
    variants.push({ kind: 'uppercase', url: `${url.origin}${upper.join('/')}${url.search}` })
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/'))
    variants.push({ kind: 'no-trailing-slash', url: `${url.origin}${url.pathname.slice(0, -1)}${url.search}` })
  const tracked = new URL(url)
  tracked.searchParams.set('utm_source', 'edge-search-health')
  variants.push({ kind: 'tracking-query', url: tracked.href })
  return variants
}

// A variant passes when it redirects to the canonical page or serves a page
// whose canonical is the canonical URL.
export const checkVariants = async (canonicalUrls, { fetcher = fetch } = {}) => {
  const problems = []
  const results = []
  for (const canonical of canonicalUrls) {
    for (const variant of urlVariants(canonical)) {
      const probe = await probeUrl(variant.url, { fetcher })
      const ok = probe.status === 404
        || (probe.status === 200 && probe.canonical && sameUrl(probe.canonical, canonical))
        || (probe.hops.length > 0 && probe.status === 200 && sameUrl(probe.final, canonical))
      results.push({ canonical, ...variant, status: probe.status, hops: probe.hops.length, final: probe.final, finalCanonical: probe.canonical, ok })
      if (!ok) {
        problems.push({
          severity: (probe.status === 200 && (!probe.canonical || sameUrl(probe.canonical, probe.final))) ? 'error' : 'warning',
          code: 'duplicate-variant',
          url: variant.url,
          detail: `${variant.kind} copy of ${canonical} answers ${probe.status}${probe.hops.length ? ` after ${probe.hops.length} redirect(s) to ${probe.final}` : ''} with canonical ${probe.canonical || '(none)'}; redirect it (301) or point its canonical at ${canonical}`,
        })
      }
    }
  }
  return { results, problems }
}

// --- internal links -------------------------------------------------------------

// A pattern for grouping links: ids and long slugs become placeholders.
export const linkPattern = (href) => {
  const url = new URL(href)
  const path = url.pathname.split('/').map((segment) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
      return '<id>'
    if (/\d/.test(segment) && segment.length > 6)
      return '<slug>'
    return segment
  }).join('/')
  return `${path}${url.search ? '?…' : ''}`
}

// Probe a sample of the site's own links (two per pattern, at most `limit`).
// links: [{ href, from }] collected from rendered pages.
export const checkInternalLinks = async (links, { fetcher = fetch, limit = 30 } = {}) => {
  const byPattern = new Map()
  for (const link of links) {
    const pattern = linkPattern(link.href)
    if (!byPattern.has(pattern))
      byPattern.set(pattern, { count: 0, samples: [] })
    const group = byPattern.get(pattern)
    group.count++
    if (group.samples.length < 2 && !group.samples.some(sample => sample.href === link.href))
      group.samples.push(link)
  }
  const problems = []
  const checked = []
  let probes = 0
  for (const [pattern, group] of byPattern) {
    for (const sample of group.samples) {
      if (probes++ >= limit)
        break
      const probe = await probeUrl(sample.href, { fetcher })
      const redirects = probe.hops.length > 0
      const alias = probe.status === 200 && probe.canonical && !sameUrl(probe.canonical, probe.final)
      checked.push({ pattern, href: sample.href, status: probe.status, hops: probe.hops.length, canonical: probe.canonical })
      if (redirects || alias || probe.status >= 400) {
        problems.push({
          severity: probe.status >= 400 ? 'error' : 'warning',
          code: probe.status >= 400 ? 'broken-internal-link' : 'link-to-alias',
          url: sample.from,
          detail: `${group.count} link(s) like ${sample.href} ${probe.status >= 400 ? `return ${probe.status}` : redirects ? `redirect ${probe.hops.length}x to ${probe.final}` : `point at an alias whose canonical is ${probe.canonical}`}; link to the canonical URL`,
        })
        break
      }
    }
  }
  return { patterns: byPattern.size, checked, problems }
}

// --- coverage exports ------------------------------------------------------------

const parseCsv = (text) => {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      }
      else if (char === '"') {
        quoted = false
      }
      else {
        field += char
      }
    }
    else if (char === '"') {
      quoted = true
    }
    else if (char === ',') {
      row.push(field)
      field = ''
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n')
        i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    }
    else {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(Boolean))
}

const csvObjects = (text) => {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  return rows.map(cells => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
}

// One Pages-report drilldown or validation export (a zip or its folder).
export const readCoverageExport = (path) => {
  let folder = path
  let temporary = ''
  if (statSync(path).isFile()) {
    temporary = mkdtempSync(join(tmpdir(), 'edge-coverage-'))
    execFileSync('unzip', ['-qq', '-o', path, '-d', temporary])
    folder = temporary
  }
  try {
    const read = name => (existsSync(join(folder, name)) ? readFileSync(join(folder, name), 'utf8') : '')
    const metadata = Object.fromEntries(csvObjects(read('Metadata.csv')).map(row => [row.Property, row.Value]))
    const table = csvObjects(read('Table.csv'))
    const chart = csvObjects(read('Chart.csv'))
    const latest = chart.at(-1)
    return {
      source: path,
      reason: (metadata.Issue || '').replace(/[‘’]/g, '\''),
      sitemap: metadata.Sitemap || '',
      affected: latest ? Number(latest['Affected pages'] || 0) : null,
      urls: table.map(row => ({ url: row.URL, lastCrawled: row['Last crawled'] || '', validation: row.Status || '' })),
    }
  }
  finally {
    if (temporary)
      rmSync(temporary, { recursive: true, force: true })
  }
}

// Same reason exported twice: keep the one with the most URLs.
export const mergeCoverageExports = (exports) => {
  const byReason = new Map()
  for (const item of exports) {
    const current = byReason.get(item.reason)
    if (!current || item.urls.length > current.urls.length)
      byReason.set(item.reason, item)
  }
  return [...byReason.values()]
}

const REASON_KIND = [
  [/soft 404/i, 'soft-404'],
  [/noindex/i, 'noindex'],
  [/page with redirect/i, 'redirect'],
  [/duplicate|alternate page/i, 'duplicate'],
  [/crawled - currently not indexed/i, 'crawled-not-indexed'],
  [/discovered - currently not indexed/i, 'discovered-not-indexed'],
  [/not found \(404\)/i, 'not-found'],
  [/blocked by robots/i, 'robots'],
  [/server error|5xx/i, 'server-error'],
  [/redirect error/i, 'redirect-error'],
  [/blocked due to|access forbidden|unauthorized/i, 'blocked'],
]

export const reasonKind = reason => REASON_KIND.find(([pattern]) => pattern.test(reason))?.[1] || 'other'

// Probe a sample of each reason's URLs and say whether the cause is still live.
export const checkCoverage = async (exports, { fetcher = fetch, sample = 8, seed = 1 } = {}) => {
  const results = []
  for (const item of mergeCoverageExports(exports)) {
    const kind = reasonKind(item.reason)
    const step = Math.max(1, Math.floor(item.urls.length / sample))
    const urls = item.urls.filter((_, index) => (index + seed) % step === 0).slice(0, sample)
    const probes = []
    for (const entry of urls)
      probes.push(await probeUrl(entry.url, { fetcher }))
    const tally = {
      redirectChains: probes.filter(probe => probe.hops.length > 1).length,
      landsOnAlias: probes.filter(probe => probe.status === 200 && probe.canonical && !sameUrl(probe.canonical, probe.final)).length,
      noindexNow: probes.filter(probe => probe.status === 200 && /noindex/i.test(probe.robots || '')).length,
      notFound: probes.filter(probe => probe.status === 404 || probe.status === 410).length,
      serverErrors: probes.filter(probe => !probe.status || probe.status >= 500).length,
      ok: probes.filter(probe => probe.status === 200 && (!probe.canonical || sameUrl(probe.canonical, probe.final)) && !/noindex/i.test(probe.robots || '')).length,
    }
    const problems = []
    const add = (severity, code, detail) => problems.push({ severity, code, url: probes[0]?.url, detail: `${item.reason} (${item.affected ?? item.urls.length} pages): ${detail}` })
    const n = probes.length
    if (kind === 'noindex')
      add(tally.noindexNow ? 'error' : 'info', tally.noindexNow ? 'noindex' : 'coverage-fixed', tally.noindexNow ? `${tally.noindexNow}/${n} sampled pages are still noindex` : `0/${n} sampled pages are noindex now; Validate fix in the Pages report`)
    else if (kind === 'redirect' || kind === 'redirect-error')
      add((tally.redirectChains || tally.landsOnAlias) ? 'warning' : 'info', (tally.redirectChains || tally.landsOnAlias) ? 'redirect-chain' : 'coverage-expected', `${tally.redirectChains}/${n} take more than one redirect, ${tally.landsOnAlias}/${n} end on an alias, ${tally.notFound}/${n} end on 404. Redirecting URLs are never indexed themselves; they should reach the canonical page in one step.`)
    else if (kind === 'duplicate')
      add(tally.landsOnAlias ? 'warning' : 'info', tally.landsOnAlias ? 'alias-url' : 'coverage-expected', `${tally.landsOnAlias}/${n} sampled URLs are aliases of another canonical URL. Make the site's links, redirects and sitemap all use the canonical form.`)
    else if (kind === 'crawled-not-indexed' || kind === 'discovered-not-indexed')
      add('warning', 'not-indexed', `${tally.landsOnAlias}/${n} sampled URLs are aliases, ${tally.redirectChains}/${n} redirect more than once, ${tally.ok}/${n} are clean canonical pages. Google chose not to index them: consistent canonical signals help; for syndicated content (MLS listings) unique text and internal links matter most.`)
    else if (kind === 'soft-404')
      add('warning', 'soft-404', `run crawler-render on ${urls.slice(0, 3).map(entry => entry.url).join(', ')}; if it passes, Validate fix`)
    else if (kind === 'not-found')
      add('info', 'coverage-expected', `${tally.notFound}/${n} still return 404. Fine for removed pages; remove them from sitemaps and links, or redirect when a replacement exists.`)
    else if (kind === 'server-error')
      add(tally.serverErrors ? 'error' : 'info', tally.serverErrors ? 'fetch-error' : 'coverage-fixed', `${tally.serverErrors}/${n} still fail`)
    else if (kind === 'robots' || kind === 'blocked')
      add('warning', 'blocked-by-robots', 'check robots.txt and access rules for these URLs')
    else
      add('info', 'coverage-other', 'review in Search Console')
    results.push({ reason: item.reason, kind, affected: item.affected, exported: item.urls.length, sampled: n, tally, samples: probes.map(probe => ({ url: probe.url, hops: probe.hops.length, status: probe.status, final: probe.final, canonical: probe.canonical, robots: probe.robots })), problems })
  }
  return { reasons: results, problems: results.flatMap(result => result.problems) }
}

export const coverageInputs = paths => paths.flatMap((path) => {
  if (statSync(path).isDirectory() && !existsSync(join(path, 'Table.csv')))
    return readdirSync(path).filter(name => name.endsWith('.zip')).map(name => join(path, name))
  return [path]
})

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const [command, ...args] = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const positional = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
  if (command === 'probe' && positional.length) {
    for (const url of positional) {
      const probe = await probeUrl(url)
      console.log(JSON.stringify({ ...probe, problems: judgeProbe(probe) }, null, 2))
    }
  }
  else if (command === 'coverage' && positional.length) {
    const report = await checkCoverage(coverageInputs(positional).map(readCoverageExport), { sample: Number(value('--sample') || 8) })
    console.log(JSON.stringify(report, null, 2))
  }
  else {
    console.error('Usage: url-checks.mjs probe <url>... | coverage <export.zip|folder>... [--sample 8]')
    process.exit(2)
  }
}
