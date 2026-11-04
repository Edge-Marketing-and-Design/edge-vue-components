#!/usr/bin/env node
// Post-launch checks of a live domain: HTTPS, http and apex forwarding,
// robots.txt and the sitemap.
//
//   node edge/skills/edge-site-launch/scripts/check-live.mjs --domain example.com [--canonical www.example.com] [--json]
//
// --domain is the base hostname the Hub stores (no www). --canonical is the
// host the site should end on (default: www.<domain>; pass the bare domain
// when the site's canonical domain is the apex). Exit code 1 when a check
// fails. Read-only: plain GET requests.
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const get = async (url, { redirect = 'follow', timeout = 15000, fetcher = fetch } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetcher(url, { redirect, signal: controller.signal, headers: { 'user-agent': 'edge-site-launch live check' } })
    const text = /text|xml|json/.test(response.headers.get('content-type') || '') ? await response.text() : ''
    return { status: response.status, url: response.url || url, location: response.headers.get('location'), text }
  }
  catch (error) {
    return { status: null, url, error: error.name === 'AbortError' ? `timed out after ${timeout} ms` : error.message }
  }
  finally {
    clearTimeout(timer)
  }
}

// [{ id, ok, detail }] for one live domain. fetcher is injectable for tests.
export const checkLive = async ({ domain, canonical = null, fetcher = fetch }) => {
  const base = String(domain).trim().toLowerCase().replace(/^www\./, '')
  const host = (canonical || `www.${base}`).toLowerCase()
  const home = `https://${host}/`
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok, detail })
  const endsOn = result => (result.status !== null ? new URL(result.url).host : null)

  const secure = await get(home, { fetcher })
  add('https', secure.status === 200 && endsOn(secure) === host, `${home} -> ${secure.status ?? secure.error}${endsOn(secure) && endsOn(secure) !== host ? ` (ended on ${secure.url})` : ''}`)

  for (const from of [`http://${host}/`, `https://${base}/`, `http://${base}/`, `https://www.${base}/`].filter(url => url !== home)) {
    const result = await get(from, { fetcher })
    add(`forward ${from}`, result.status === 200 && endsOn(result) === host && result.url.startsWith('https://'), `${from} -> ${result.status ?? result.error} at ${result.url}`)
  }

  const robots = await get(`${home}robots.txt`, { fetcher })
  const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(robots.text || '') && !/^\s*allow:/im.test(robots.text || '')
  const sitemapLine = (robots.text || '').match(/^\s*sitemap:\s*(\S+)/im)?.[1] || null
  add('robots.txt', robots.status === 200 && !blocksAll, robots.status === 200 ? (blocksAll ? 'robots.txt disallows the whole site' : `found${sitemapLine ? `, names ${sitemapLine}` : ', names no sitemap'}`) : `robots.txt -> ${robots.status ?? robots.error}`)

  const sitemapUrl = sitemapLine || `${home}sitemap.xml`
  const sitemap = await get(sitemapUrl, { fetcher })
  const locs = [...(sitemap.text || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(match => match[1])
  const foreign = locs.filter((loc) => {
    try {
      return new URL(loc).host !== host
    }
    catch {
      return true
    }
  })
  add('sitemap', sitemap.status === 200 && locs.length > 0 && !foreign.length, sitemap.status === 200 ? `${locs.length} URLs${foreign.length ? `; ${foreign.length} on another host (first: ${foreign[0]})` : ''}` : `${sitemapUrl} -> ${sitemap.status ?? sitemap.error}`)
  return checks
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const domain = value('--domain')
  if (!domain) {
    console.error('--domain <example.com> is required.')
    process.exit(2)
  }
  const checks = await checkLive({ domain, canonical: value('--canonical') })
  if (args.includes('--json'))
    console.log(JSON.stringify(checks, null, 2))
  else
    checks.forEach(check => console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.id}: ${check.detail}`))
  process.exitCode = checks.every(check => check.ok) ? 0 : 1
}
