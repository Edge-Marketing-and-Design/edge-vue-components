#!/usr/bin/env node
// Checks that every link on a site's pages resolves. Before launch, crawl
// the Hub preview links (cms_preview_url, one per page); after launch, the
// live site from its home page.
//
//   node edge/skills/edge-site-launch/scripts/crawl-links.mjs --start https://www.example.com/ [--max-pages 200]
//   node edge/skills/edge-site-launch/scripts/crawl-links.mjs --pages preview-urls.txt   # one URL per line, not followed
//   node edge/skills/edge-site-launch/scripts/crawl-links.mjs --html home.html@https://example.com/   # rendered HTML saved from a browser
//
// Hub preview links render in the browser (the HTML a request returns is the
// app shell), so before launch save each preview's rendered DOM
// (chrome-devtools evaluate_script `document.documentElement.outerHTML`)
// and pass it with --html <file>@<page URL>, repeated per page.
//   [--json] [--no-external] [--concurrency 6] [--timeout 15000]
//
// With --start, pages on the start URL's host are followed (same host only);
// with --pages, only the listed pages are read. Every link found (a, link,
// img, source, script, iframe) is requested (HEAD, then GET when HEAD is
// refused); 4xx, 5xx and network errors are broken, redirects are reported
// with where they end. mailto:, tel:, javascript: and in-page # links are
// listed but not requested. Exit code 1 when anything is broken.
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ATTRIBUTES = /<(a|link|img|source|script|iframe)\b[^>]*?\s(href|src|srcset)\s*=\s*("([^"]*)"|'([^']*)')/gi

// Links in a page's HTML, resolved against its URL: [{ url, tag, raw }].
export const extractLinks = (html, pageUrl) => {
  const links = []
  for (const match of String(html).matchAll(ATTRIBUTES)) {
    const tag = match[1].toLowerCase()
    const attribute = match[2].toLowerCase()
    const value = (match[4] ?? match[5] ?? '').trim()
    // Resource hints name origins, not resources.
    if (tag === 'link' && /\srel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(match[0]))
      continue
    // srcset candidates are separated by a comma and whitespace; URLs may
    // hold commas of their own (Cloudflare Images "width=1200,quality=85").
    const candidates = attribute === 'srcset' ? value.split(/,\s+/).map(part => part.trim().split(/\s+/)[0]).filter(Boolean) : [value]
    for (const raw of candidates) {
      // Cloudflare's own paths (email obfuscation) are not the site's links.
      if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.includes('{{') || raw.includes('/cdn-cgi/'))
        continue
      // mailto:// and tel:// put "//" in the address, which mail and phone
      // apps don't strip: the link is broken.
      if (/^(mailto|tel|sms):\/\//i.test(raw)) {
        links.push({ url: raw, tag, raw, invalid: true, error: `"${raw.split(':')[0]}://" should be "${raw.split(':')[0]}:"` })
        continue
      }
      if (/^(mailto|tel|javascript|sms):/i.test(raw)) {
        links.push({ url: raw, tag, raw, skipped: true })
        continue
      }
      try {
        const url = new URL(raw.replace(/&amp;/g, '&'), pageUrl)
        url.hash = ''
        links.push({ url: url.href, tag, raw })
      }
      catch {
        links.push({ url: raw, tag, raw, invalid: true })
      }
    }
  }
  return links
}

const fetchWithTimeout = async (url, init, timeout) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { 'user-agent': 'edge-site-launch link check', ...(init.headers || {}) } })
  }
  finally {
    clearTimeout(timer)
  }
}

// One link's status: { url, status, ok, finalUrl?, error? }.
export const checkLink = async (url, { timeout = 15000, fetcher = fetchWithTimeout } = {}) => {
  try {
    let response = await fetcher(url, { method: 'HEAD', redirect: 'follow' }, timeout)
    if ([403, 405, 501].includes(response.status) || response.status >= 500)
      response = await fetcher(url, { method: 'GET', redirect: 'follow' }, timeout)
    const finalUrl = response.url && response.url !== url ? response.url : undefined
    return { url, status: response.status, ok: response.status < 400, ...(finalUrl ? { finalUrl } : {}) }
  }
  catch (error) {
    return { url, status: null, ok: false, error: error.name === 'AbortError' ? `timed out after ${timeout} ms` : error.message }
  }
}

const pool = async (items, size, work) => {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }))
  return results
}

// Crawls and checks. fetcher(url, init, timeout) is injectable for tests.
export const crawl = async ({ start = null, pages = [], rendered = [], maxPages = 200, external = true, concurrency = 6, timeout = 15000, fetcher = fetchWithTimeout }) => {
  const host = start ? new URL(start).host : null
  const queue = start ? [new URL(start).href] : [...pages]
  const seenPages = new Set(queue)
  const crawled = []
  const linksByUrl = new Map()
  // Rendered pages ([{ url, html }]) are read as given, not fetched.
  for (const { url: pageUrl, html } of rendered) {
    crawled.push({ url: pageUrl, status: 200, rendered: true })
    for (const link of extractLinks(html, pageUrl)) {
      if (!linksByUrl.has(link.url))
        linksByUrl.set(link.url, { ...link, on: new Set() })
      linksByUrl.get(link.url).on.add(pageUrl)
    }
  }
  while (queue.length && crawled.length < maxPages) {
    const pageUrl = queue.shift()
    let html = ''
    let status = null
    try {
      const response = await fetcher(pageUrl, { method: 'GET', redirect: 'follow' }, timeout)
      status = response.status
      if ((response.headers.get('content-type') || '').includes('text/html'))
        html = await response.text()
    }
    catch (error) {
      crawled.push({ url: pageUrl, status: null, error: error.message })
      continue
    }
    crawled.push({ url: pageUrl, status })
    for (const link of extractLinks(html, pageUrl)) {
      if (!linksByUrl.has(link.url))
        linksByUrl.set(link.url, { ...link, on: new Set() })
      linksByUrl.get(link.url).on.add(pageUrl)
      if (start && !link.skipped && !link.invalid && link.tag === 'a') {
        const target = new URL(link.url)
        if (target.host === host && !seenPages.has(target.href) && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?)$/i.test(target.pathname)) {
          seenPages.add(target.href)
          queue.push(target.href)
        }
      }
    }
  }
  const toCheck = [...linksByUrl.values()].filter(link => !link.skipped && !link.invalid && (external || !host || new URL(link.url).host === host))
  const checked = await pool(toCheck, concurrency, link => checkLink(link.url, { timeout, fetcher }))
  const results = checked.map((result, index) => ({ ...result, tag: toCheck[index].tag, on: [...toCheck[index].on] }))
  const invalid = [...linksByUrl.values()].filter(link => link.invalid).map(link => ({ url: link.url, ok: false, status: null, error: link.error || 'not a valid URL', tag: link.tag, on: [...link.on] }))
  const broken = [...results.filter(result => !result.ok), ...invalid]
  return {
    pages: crawled,
    checked: results.length,
    skipped: [...linksByUrl.values()].filter(link => link.skipped).map(link => link.url),
    broken,
    redirected: results.filter(result => result.ok && result.finalUrl),
    truncated: queue.length > 0,
    ok: !broken.length && crawled.every(page => page.status !== null && page.status < 400),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const pagesFile = value('--pages')
  const rendered = args.flatMap((arg, index) => (arg === '--html' ? [args[index + 1]] : [])).map((pair) => {
    const at = pair.indexOf('@')
    return { url: pair.slice(at + 1), html: readFileSync(pair.slice(0, at), 'utf8') }
  })
  const report = await crawl({
    rendered,
    start: value('--start'),
    pages: pagesFile ? readFileSync(pagesFile, 'utf8').split('\n').map(line => line.trim()).filter(Boolean) : [],
    maxPages: Number(value('--max-pages') || 200),
    external: !args.includes('--no-external'),
    concurrency: Number(value('--concurrency') || 6),
    timeout: Number(value('--timeout') || 15000),
  })
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  }
  else {
    console.log(`Pages read: ${report.pages.length}${report.truncated ? ' (stopped at --max-pages)' : ''}; links checked: ${report.checked}; skipped (mailto/tel): ${report.skipped.length}`)
    for (const page of report.pages.filter(item => item.status === null || item.status >= 400))
      console.log(`PAGE ${page.status ?? 'error'} ${page.url}${page.error ? ` (${page.error})` : ''}`)
    for (const link of report.broken)
      console.log(`BROKEN ${link.status ?? 'error'} ${link.url}${link.error ? ` (${link.error})` : ''} on ${link.on.join(', ')}`)
    for (const link of report.redirected)
      console.log(`REDIRECT ${link.url} -> ${link.finalUrl}`)
    console.log(report.ok ? 'Every link resolves.' : `${report.broken.length} broken link(s).`)
  }
  process.exitCode = report.ok ? 0 : 1
}
