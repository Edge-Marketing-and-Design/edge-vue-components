#!/usr/bin/env node
// What Google actually decided about a site, from the Search Console API
// (read-only): URL inspection, sitemaps, and daily clicks and impressions.
//
//   node edge/skills/edge-search-health/scripts/search-console.mjs sites
//   node edge/skills/edge-search-health/scripts/search-console.mjs inspect --host www.example.com --urls /,/about/
//   node edge/skills/edge-search-health/scripts/search-console.mjs sitemaps --host www.example.com
//   node edge/skills/edge-search-health/scripts/search-console.mjs traffic --host www.example.com [--launch-date 2026-10-24]
//
// Options: --property sc-domain:example.com (default: found from --host),
// --credentials <file> (see google-auth.mjs), --json.
// URL inspection reports Google's stored result (no live test, no screenshot)
// and is limited to 2,000 URLs a day per property.
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { credentialsPath, getAccessToken, loadCredentials } from './google-auth.mjs'

const API = 'https://www.googleapis.com/webmasters/v3'
const INSPECT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

export const createClient = ({ token, fetcher = fetch }) => {
  const call = async (url, { method = 'GET', body } = {}) => {
    const response = await fetcher(url, {
      method,
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = data.error?.message || response.statusText
      throw Object.assign(new Error(`Search Console ${response.status}: ${message}`), { status: response.status })
    }
    return data
  }
  return {
    sites: async () => (await call(`${API}/sites`)).siteEntry || [],
    sitemaps: async property => (await call(`${API}/sites/${encodeURIComponent(property)}/sitemaps`)).sitemap || [],
    inspect: async (property, url) => (await call(INSPECT, { method: 'POST', body: { inspectionUrl: url, siteUrl: property, languageCode: 'en-US' } })).inspectionResult || {},
    analytics: async (property, body) => (await call(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: 'POST', body })).rows || [],
  }
}

export const connect = async ({ credentials = '', fetcher = fetch } = {}) => {
  const token = await getAccessToken(loadCredentials(credentialsPath(credentials)), { fetcher })
  return createClient({ token, fetcher })
}

// The property for a host: the domain property (covers every subdomain and
// protocol) when the account has it, else the URL-prefix property.
export const findProperty = (sites, host) => {
  const bare = host.toLowerCase().replace(/^www\./, '')
  const usable = sites.filter(site => site.permissionLevel !== 'siteUnverifiedUser')
  return usable.find(site => site.siteUrl === `sc-domain:${bare}`)?.siteUrl
    || usable.find(site => site.siteUrl === `https://${host.toLowerCase()}/`)?.siteUrl
    || usable.find(site => site.siteUrl === `https://${bare}/`)?.siteUrl
    || null
}

// --- URL inspection ----------------------------------------------------------

// Problems in one inspection. A brand-new URL Google hasn't seen is 'info'.
export const summarizeInspection = (url, result) => {
  const index = result.indexStatusResult || {}
  const problems = []
  const add = (severity, code, detail) => problems.push({ severity, code, url, detail })
  const coverage = index.coverageState || ''
  if (/unknown to google|discovered - currently not indexed/i.test(coverage))
    add('info', 'not-crawled-yet', coverage)
  else if (/soft 404/i.test(coverage))
    add('error', 'soft-404', coverage)
  else if (/noindex/i.test(coverage) || ['BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER'].includes(index.indexingState))
    add('error', 'noindex', `${coverage} (${index.indexingState})`)
  else if (/blocked by robots/i.test(coverage) || index.robotsTxtState === 'DISALLOWED')
    add('error', 'blocked-by-robots', coverage || index.robotsTxtState)
  else if (/not found \(404\)|server error|redirect error|access denied|forbidden/i.test(coverage))
    add('error', 'fetch-error', `${coverage} (${index.pageFetchState})`)
  else if (/duplicate|alternate page/i.test(coverage))
    add('warning', 'not-canonical', `${coverage}; Google chose ${index.googleCanonical || '(none)'}`)
  else if (index.verdict && index.verdict !== 'PASS' && index.verdict !== 'NEUTRAL')
    add('warning', 'not-indexed', coverage || index.verdict)
  if (index.pageFetchState && !['SUCCESSFUL', 'PAGE_FETCH_STATE_UNSPECIFIED'].includes(index.pageFetchState) && !problems.some(problem => problem.code === 'fetch-error'))
    add('error', 'fetch-error', index.pageFetchState)
  if (index.googleCanonical && index.userCanonical && index.googleCanonical !== index.userCanonical && !problems.some(problem => problem.code === 'not-canonical'))
    add('warning', 'canonical-mismatch', `yours ${index.userCanonical}, Google's ${index.googleCanonical}`)
  const rich = result.richResultsResult
  if (rich?.verdict === 'FAIL') {
    const issues = (rich.detectedItems || []).flatMap(item => (item.items || []).flatMap(entry => (entry.issues || []).filter(issue => issue.severity === 'ERROR').map(issue => `${item.richResultType}: ${issue.issueMessage}`)))
    add('error', 'rich-results-invalid', issues.join('; ') || 'rich results invalid')
  }
  return {
    url,
    verdict: index.verdict || null,
    coverageState: coverage || null,
    indexingState: index.indexingState || null,
    pageFetchState: index.pageFetchState || null,
    robotsTxtState: index.robotsTxtState || null,
    lastCrawlTime: index.lastCrawlTime || null,
    crawledAs: index.crawledAs || null,
    googleCanonical: index.googleCanonical || null,
    userCanonical: index.userCanonical || null,
    sitemaps: index.sitemap || [],
    richResults: (rich?.detectedItems || []).map(item => item.richResultType),
    problems,
  }
}

export const inspectUrls = async (client, property, urls) => {
  const results = []
  for (const url of urls) {
    try {
      results.push(summarizeInspection(url, await client.inspect(property, url)))
    }
    catch (error) {
      results.push({ url, problems: [{ severity: 'error', code: 'inspection-failed', url, detail: error.message }] })
    }
  }
  return results
}

// --- sitemaps -----------------------------------------------------------------

export const checkSitemaps = (sitemaps, { expected = '', now = new Date(), staleDays = 14 } = {}) => {
  const problems = []
  const add = (severity, code, detail) => problems.push({ severity, code, detail })
  if (!sitemaps.length)
    add('error', 'sitemap-not-submitted', `no sitemap is submitted${expected ? `; submit ${expected}` : ''}`)
  else if (expected && !sitemaps.some(sitemap => sitemap.path === expected))
    add('warning', 'sitemap-not-submitted', `${expected} is not submitted (submitted: ${sitemaps.map(sitemap => sitemap.path).join(', ')})`)
  for (const sitemap of sitemaps) {
    if (!sitemap.lastDownloaded)
      add(sitemap.isPending ? 'info' : 'warning', 'sitemap-not-read', `${sitemap.path} has not been read by Google yet`)
    else if ((now - new Date(sitemap.lastDownloaded)) / 86400000 > staleDays)
      add('warning', 'sitemap-stale', `${sitemap.path} last read ${sitemap.lastDownloaded.slice(0, 10)}`)
    if (Number(sitemap.errors) > 0)
      add('error', 'sitemap-errors', `${sitemap.path}: ${sitemap.errors} error(s)`)
  }
  return {
    sitemaps: sitemaps.map(sitemap => ({ path: sitemap.path, lastSubmitted: sitemap.lastSubmitted || null, lastDownloaded: sitemap.lastDownloaded || null, isPending: Boolean(sitemap.isPending), errors: Number(sitemap.errors || 0), warnings: Number(sitemap.warnings || 0) })),
    problems,
  }
}

// --- traffic -----------------------------------------------------------------

const day = date => date.toISOString().slice(0, 10)
const addDays = (date, days) => new Date(new Date(`${day(date)}T00:00:00Z`).getTime() + days * 86400000)

// Compare recent days with a baseline. With a launch date the baseline is the
// 28 days before launch (the old site); otherwise the 28 days before the
// recent window. Two recent windows: the last 7 complete days (data lags about
// 3 days) and the last 3 days of fresh data (lag 2), so a sudden cliff alarms
// within about 3 days instead of a week.
export const compareTraffic = (rows, { today = new Date(), launchDate = '', baselineDays = 28, minBaselineClicks = 3 } = {}) => {
  const byDate = new Map(rows.map(row => [row.keys[0], row]))
  const window = (start, end) => {
    let clicks = 0
    let impressions = 0
    let days = 0
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const row = byDate.get(day(date))
      clicks += row?.clicks || 0
      impressions += row?.impressions || 0
      days++
    }
    return { start: day(start), end: day(end), clicksPerDay: +(clicks / days).toFixed(1), impressionsPerDay: +(impressions / days).toFixed(1) }
  }
  const weekEnd = addDays(today, -3)
  const weekStart = addDays(weekEnd, -6)
  const recent = window(weekStart, weekEnd)
  const latest = window(addDays(today, -4), addDays(today, -2))
  const baselineEnd = launchDate ? addDays(new Date(`${launchDate}T00:00:00Z`), -1) : addDays(weekStart, -1)
  const baseline = window(addDays(baselineEnd, -(baselineDays - 1)), baselineEnd)
  const change = (now, before) => (before > 0 ? +(((now - before) / before) * 100).toFixed(0) : null)
  const changes = current => ({ clicks: change(current.clicksPerDay, baseline.clicksPerDay), impressions: change(current.impressionsPerDay, baseline.impressionsPerDay) })
  const recentChange = changes(recent)
  const latestChange = changes(latest)
  const problems = []
  if (baseline.clicksPerDay >= minBaselineClicks || baseline.impressionsPerDay >= minBaselineClicks * 10) {
    const describe = (label, current, delta) => `${label} ${current.start}..${current.end}: clicks/day ${baseline.clicksPerDay} -> ${current.clicksPerDay} (${delta.clicks ?? 'n/a'}%), impressions/day ${baseline.impressionsPerDay} -> ${current.impressionsPerDay} (${delta.impressions ?? 'n/a'}%)`
    const worstWeek = Math.min(recentChange.clicks ?? 0, recentChange.impressions ?? 0)
    const worstLatest = Math.min(latestChange.clicks ?? 0, latestChange.impressions ?? 0)
    if (worstWeek <= -50 || worstLatest <= -50)
      problems.push({ severity: 'error', code: 'traffic-drop', detail: worstLatest < worstWeek ? describe('last 3 days', latest, latestChange) : describe('last 7 days', recent, recentChange) })
    else if (worstWeek <= -30)
      problems.push({ severity: 'warning', code: 'traffic-drop', detail: describe('last 7 days', recent, recentChange) })
  }
  return {
    baselineKind: launchDate ? 'before-launch' : 'previous-28-days',
    baseline,
    recent: { ...recent, change: recentChange },
    latest: { ...latest, change: latestChange },
    problems,
  }
}

export const fetchDailyTraffic = async (client, property, { today = new Date(), days = 120 } = {}) =>
  client.analytics(property, {
    startDate: day(addDays(today, -days)),
    endDate: day(today),
    dimensions: ['date'],
    dataState: 'all',
    rowLimit: 25000,
  })

// --- CLI ----------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const [command, ...args] = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const print = data => console.log(JSON.stringify(data, null, 2))
  try {
    const client = await connect({ credentials: value('--credentials') })
    if (command === 'sites') {
      print(await client.sites())
      process.exit(0)
    }
    const host = value('--host')
    if (!host || !['inspect', 'sitemaps', 'traffic'].includes(command)) {
      console.error('Usage: search-console.mjs sites | inspect|sitemaps|traffic --host www.example.com [--property ...] [--urls /,/a/] [--launch-date YYYY-MM-DD] [--credentials file]')
      process.exit(2)
    }
    const property = value('--property') || findProperty(await client.sites(), host)
    if (!property)
      throw new Error(`This account has no Search Console property for ${host}. Add the account as a user on the property (reference/search-console-setup.md).`)
    if (command === 'inspect') {
      const urls = (value('--urls') || '/').split(',').map(url => new URL(url.trim(), `https://${host}/`).href)
      print({ property, results: await inspectUrls(client, property, urls) })
    }
    else if (command === 'sitemaps') {
      print({ property, ...checkSitemaps(await client.sitemaps(property), { expected: `https://${host}/sitemap.xml` }) })
    }
    else {
      print({ property, ...compareTraffic(await fetchDailyTraffic(client, property), { launchDate: value('--launch-date') || '' }) })
    }
  }
  catch (error) {
    console.error(error.message)
    process.exit(error.code === 'no-credentials' ? 3 : 2)
  }
}
