#!/usr/bin/env node
// Exports one published Edge CMS site as a standalone static website plus a
// content archive. Reads only public, published data through the renderer that
// serves the site; it never writes to a Hub, KV or the renderer.
//
//   node export-site.mjs --org <orgId> --site <siteId> --out <folder>
//     [--source https://emd-cms-front.pages.dev]  renderer origin (default: the
//         preview host, which serves any published site by id; pass the live
//         domain instead to export exactly what visitors get)
//     [--domain www.example.com]  the domain the exported site will live on
//         (default: the site's canonical domain)
//     [--form-endpoint https://formspree.io/f/xxxx] [--form-format form|json]
//     [--renderer <emd-cms-front checkout>]  where the browser runtime is built
//         from (default: an emd-cms-front folder beside any parent folder)
//     [--site-script <file>]  ports of override behavior, served as /assets/site.js
//     [--max-pages 3000] [--concurrency 6] [--force]
//
// Output: <out>/site (deploy this folder), <out>/content (archive),
// <out>/export-report.json. Node 22, no dependencies.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { htmlToMarkdown } from './html-to-markdown.mjs'
import { cfEmail, pagePathsFromMenus, postDetailPath, postTypeKey, slug } from './site-model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (arg.startsWith('--'))
    pairs.push([arg.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true'])
  return pairs
}, []))
if (!args.org || !args.site || !args.out) {
  console.error('Usage: node export-site.mjs --org <orgId> --site <siteId> --out <folder> [--source <origin>] [--domain <domain>] [--form-endpoint <url>]')
  process.exit(1)
}

const ORG = args.org
const SITE = args.site
const OUT = resolve(args.out)
const SOURCE = String(args.source || 'https://emd-cms-front.pages.dev').replace(/\/+$/, '')
const SOURCE_HOST = new URL(SOURCE).host
const PREVIEW_HOST = /\.pages\.dev$|^localhost(:\d+)?$/.test(SOURCE_HOST)
const MAX_PAGES = Number(args['max-pages'] || 3000)
const CONCURRENCY = Number(args.concurrency || 6)
const SITE_DIR = join(OUT, 'site')
// The browser runtime is built from the renderer's client helpers each run.
const findRenderer = () => {
  if (args.renderer)
    return resolve(args.renderer)
  for (let dir = process.cwd(); dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'emd-cms-front')
    if (existsSync(join(candidate, 'app/plugins/cmsNav.client.ts')))
      return candidate
  }
  return ''
}
const RENDERER = findRenderer()
if (!RENDERER) {
  console.error('No emd-cms-front checkout found beside a parent folder. Pass --renderer <path> (its dependencies installed with pnpm install).')
  process.exit(1)
}
const CONTENT_DIR = join(OUT, 'content')
const ASSET_PREFIX = '/assets'
const USER_AGENT = 'EdgeSiteExport/1.0'
const LUCIDE_URL = 'https://unpkg.com/lucide@0.576.0/dist/umd/lucide.min.js'
// Site settings that are Hub bookkeeping or private, never part of the archive.
const PRIVATE_SITE_FIELDS = new Set(['users', 'uid', 'aiInstructions', 'aiAgentUserId', 'contactSpam', 'domainError', 'cacheVerification', 'allowedThemes', 'pageVersions', 'pageLastModified', 'revision', 'version', 'last_updated', 'doc_created_at', 'docId', 'theme', 'showMembersTab', 'sureFeedURL'])

const report = { startedAt: new Date().toISOString(), orgId: ORG, siteId: SITE, source: SOURCE, pages: [], posts: [], assets: { downloaded: 0, failed: [] }, warnings: [], forms: [], overrides: [], thirdPartyScripts: {} }
// What a visitor is told to do while forms have no endpoint. The site's
// contact email setting sometimes holds a name, so only a real address counts.
let contactInstead = 'contact us by email or phone'
const setContactInstead = (site) => {
  const email = String(site.contactEmail || '').trim()
  const phone = String(site.contactPhone || '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    contactInstead = `email ${email}`
  else if (phone)
    contactInstead = `call ${phone}`
}
const warn = (code, message, extra = {}) => {
  report.warnings.push({ code, message, ...extra })
  console.warn(`! ${code}: ${message}`)
}

const pool = async (items, worker) => {
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

// --- Renderer access -------------------------------------------------------
let cookie = ''
const request = async (url, init = {}, attempt = 0) => {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: init.redirect || 'follow',
      headers: { 'user-agent': USER_AGENT, ...(cookie && new URL(url).host === SOURCE_HOST ? { cookie } : {}), ...(init.headers || {}) },
      signal: AbortSignal.timeout(60000),
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)))
      return request(url, init, attempt + 1)
    }
    return response
  }
  catch (error) {
    if (attempt < 3) {
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)))
      return request(url, init, attempt + 1)
    }
    throw error
  }
}

const kv = async (action, params) => {
  const response = await request(`${SOURCE}/api/kv`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, params }) })
  if (!response.ok)
    throw new Error(`KV ${action} failed: HTTP ${response.status}`)
  return response.json()
}

// Reads many keys in order (null for a missing key). Older renderer deploys
// have no getKeys action, so fall back to one getKey per key.
let batchReads = true
const kvMany = async (keys) => {
  const out = []
  for (let i = 0; i < keys.length; i += 100) {
    const slice = keys.slice(i, i + 100)
    if (batchReads) {
      try {
        out.push(...await kv('getKeys', { keys: slice }))
        continue
      }
      catch {
        batchReads = false
      }
    }
    const results = []
    await pool(slice.map((key, index) => ({ key, index })), async ({ key, index }) => {
      const response = await request(`${SOURCE}/api/kv`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'getKey', params: { key } }) })
      results[index] = response.ok ? await response.json() : null
    })
    out.push(...results)
  }
  return out
}

const selectPreviewSite = async () => {
  const response = await request(`${SOURCE}/?siteId=${encodeURIComponent(SITE)}`, { redirect: 'manual' })
  const set = response.headers.getSetCookie?.() || []
  const preview = set.map(value => value.split(';')[0]).find(value => value.startsWith('edge_site_preview='))
  if (!preview)
    throw new Error(`The preview host did not select site ${SITE} (HTTP ${response.status}). Is the site published?`)
  cookie = preview
}

// --- Site model --------------------------------------------------------------
const listPosts = async (type) => {
  const rows = await kv('queryIndex', { baseKey: 'posts', searchKey: 'type', uniqueKey: `${ORG}:${SITE}`, searchValue: type })
  const keys = [...new Set(rows.map(row => row.canonical).filter(Boolean))]
  return (await kvMany(keys)).filter(Boolean)
}


// --- Assets ----------------------------------------------------------------
const assetMap = new Map() // absolute URL -> local path (or null when it failed)
const assetJobs = new Map()
const EXT_BY_TYPE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'text/css': '.css', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'application/zip': '.zip', 'application/json': '.json', 'application/javascript': '.js', 'text/javascript': '.js' }
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|csv|txt|mp3|mp4|webm|mov|jpe?g|png|gif|webp|avif|svg|ico)$/i

const folderFor = (type, ext) => {
  if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|svg|ico)$/i.test(ext))
    return 'media'
  if (type.startsWith('font/') || /\.(woff2?|ttf|otf|eot)$/i.test(ext))
    return 'fonts'
  if (type === 'text/css' || ext === '.css')
    return 'css'
  return 'files'
}

const fileBase = (url) => {
  const parts = url.pathname.split('/').filter(Boolean)
  // Cloudflare Images URLs end in a variant name; the image id is before it.
  const meaningful = url.hostname === 'imagedelivery.net' ? parts.slice(1, -1).join('-') : parts.pop() || 'file'
  return decodeURIComponent(meaningful).replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'file'
}

const absolute = (value, base) => {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), base)
    return /^https?:$/.test(url.protocol) ? url : null
  }
  catch {
    return null
  }
}

const localizeCss = async (css, baseUrl) => {
  // Quoted values are matched whole, so a data: SVG's inner url(%23id)
  // filter references are never mistaken for files.
  const found = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/g)]
  let out = css
  for (const [whole, double, single, bare] of found) {
    const ref = (double ?? single ?? bare ?? '').trim()
    if (!ref || /^(?:data:|#|%23|about:)/i.test(ref))
      continue
    const url = absolute(ref, baseUrl)
    if (!url)
      continue
    const local = await downloadAsset(url.href)
    if (local)
      out = out.split(whole).join(`url("${local}")`)
  }
  const imports = [...out.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?/g)]
  for (const [whole, ref] of imports) {
    // url() imports were localized above; leave those alone.
    if (ref.startsWith(`${ASSET_PREFIX}/`))
      continue
    const url = absolute(ref, baseUrl)
    const local = url && await downloadAsset(url.href, 'text/css')
    if (local)
      out = out.split(whole).join(`@import url("${local}")`)
  }
  return out
}

const downloadAsset = (href, expectType = '') => {
  if (assetMap.has(href))
    return Promise.resolve(assetMap.get(href))
  if (assetJobs.has(href))
    return assetJobs.get(href)
  const job = (async () => {
    try {
      const url = new URL(href)
      const response = await request(href, url.hostname === 'fonts.googleapis.com' ? { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } } : {})
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const type = String(response.headers.get('content-type') || expectType).split(';')[0].trim().toLowerCase()
      const pathExt = extname(url.pathname).toLowerCase()
      const ext = EXT_BY_TYPE[type] || (pathExt && pathExt.length <= 6 ? pathExt : '.bin')
      const hash = createHash('sha1').update(href).digest('hex').slice(0, 8)
      const folder = folderFor(type, ext)
      const local = `${ASSET_PREFIX}/${folder}/${fileBase(url)}-${hash}${ext}`
      mkdirSync(join(SITE_DIR, ASSET_PREFIX, folder), { recursive: true })
      if (folder === 'css') {
        const css = await localizeCss(await response.text(), href)
        writeFileSync(join(SITE_DIR, local), css)
      }
      else {
        writeFileSync(join(SITE_DIR, local), Buffer.from(await response.arrayBuffer()))
      }
      report.assets.downloaded++
      assetMap.set(href, local)
      return local
    }
    catch (error) {
      report.assets.failed.push({ url: href, error: String(error.message || error) })
      assetMap.set(href, null)
      return null
    }
  })()
  assetJobs.set(href, job)
  return job
}

// --- HTML transform ----------------------------------------------------------
let siteHosts = new Set()
// Override instances by instance id: { blockId, name, values }.
const overrideInstances = new Map()
// Override instance ids per page in render order: { content, post, all }.
const overrideOrder = new Map()
const pageIdByPath = new Map()
const isSiteUrl = url => url && (siteHosts.has(url.host) || url.host === SOURCE_HOST)
const isPageLink = url => isSiteUrl(url) && !/^\/(?:_nuxt|api|_files|_edge-fonts|_ipx|cdn-cgi|__)/.test(url.pathname) && (!extname(url.pathname) || /\.html?$/.test(url.pathname))
const normalPath = (pathname) => {
  let path = decodeURI(pathname).replace(/\/index\.html?$/, '/').replace(/\/{2,}/g, '/')
  if (!path.endsWith('/'))
    path += '/'
  return encodeURI(path)
}

const linksIn = (html, pageUrl) => {
  const links = new Set()
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"#][^"]*)"/gi)) {
    const url = absolute(href, pageUrl)
    if (url && isPageLink(url))
      links.add(normalPath(url.pathname))
  }
  return [...links]
}

const replaceAsync = async (text, regex, fn) => {
  const pattern = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`)
  const matches = [...text.matchAll(pattern)]
  const results = await Promise.all(matches.map(match => fn(...match)))
  let index = 0
  return text.replace(pattern, () => results[index++])
}

const transformHtml = async (html, pageUrl, pagePath) => {
  const domain = report.domain
  let out = html
  // Remove the Nuxt application: its scripts, payload, preloads and runtime
  // config. The rendered markup stays; edge-standalone.js adds the behavior.
  out = out.replace(/<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/gi, '')
  out = out.replace(/<script>window\.__NUXT__[\s\S]*?<\/script>/gi, '')
  out = out.replace(/<script\b[^>]*\bsrc="\/_nuxt\/[^"]*"[^>]*>\s*<\/script>/gi, '')
  // The runtime loads a local Lucide copy when a page has icons.
  out = out.replace(/<script\b[^>]*\bsrc="https:\/\/unpkg\.com\/lucide@[^"]*"[^>]*>\s*<\/script>/gi, '')
  out = out.replace(/<link\b[^>]*\brel="(?:modulepreload|prefetch|preload)"[^>]*>/gi, tag => /as="(?:image|font)"/.test(tag) && !/href="\/_nuxt\//.test(tag) ? tag : '')

  // Structured data names images by URL; point them at the exported copies.
  out = await replaceAsync(out, /(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi, async (whole, open, json, close) => {
    const urls = [...new Set([...json.matchAll(/https?:\/\/[^"\s\\]+/g)].map(([url]) => url))]
    let next = json
    for (const href of urls) {
      const url = absolute(href, pageUrl)
      if (!url || isPageLink(url) || !/\.(?:jpe?g|png|webp|avif|gif|svg)(?:$|\?)|imagedelivery\.net|firebasestorage/i.test(href))
        continue
      const local = await downloadAsset(url.href)
      if (local)
        next = next.split(href).join(`https://${domain}${local}`)
    }
    return `${open}${next}${close}`
  })
  // The preview host adds a floating Exit Preview control to every page.
  out = out.replace(/<button\b[^>]*position:fixed[^>]*>\s*Exit Preview\s*<\/button>/gi, '')
  // A Cloudflare-proxied domain obfuscates email addresses and injects its own
  // scripts; restore the addresses and drop the scripts.
  out = out.replace(/href="(?:https?:\/\/[^/"]+)?\/cdn-cgi\/l\/email-protection\/?#([0-9a-f]+)"/gi, (_, hex) => `href="mailto:${cfEmail(hex)}"`)
  out = out.replace(/<(\w+)\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/\1>/gi, (_, tag, hex) => cfEmail(hex))
  out = out.replace(/<script\b[^>]*(?:\/cdn-cgi\/|static\.cloudflareinsights\.com)[^>]*>[\s\S]*?<\/script>/gi, '')
  // Cloudflare Zaraz (a tag manager on the domain's Cloudflare zone) is an
  // inline loader; the tools it ran (often analytics) leave with it.
  out = out.replace(/<script\b[^>]*>((?:(?!<\/script>)[\s\S])*?)<\/script>/gi, (whole, body) => {
    if (!/\/cdn-cgi\//.test(body))
      return whole
    if (/\/cdn-cgi\/zaraz\//.test(body))
      report.zaraz = true
    return ''
  })
  // Vue hydration markers and Hub identifiers have no meaning off the Hub.
  out = out.replace(/<!--(?:\[|\]|teleport start anchor|teleport anchor|teleport start|teleport end|v-if)?-->/g, '')
  // Override components lose their browser behavior off the renderer. The
  // renderer wraps each in <div class="contents"> with no instance id, in
  // render order; tag each wrapper with its block and values file so a site
  // script can port the behavior. Unequal counts are reported, never guessed.
  const pageId = (html.match(/data-cms-page-id="([^"]+)"/) || [])[1] || pageIdByPath.get(pagePath) || ''
  const order = overrideOrder.get(pageId)
  const wrappers = out.match(/<div class="contents"(?: data-v-[0-9a-f]+(?:="")?)?>/g) || []
  if (order && wrappers.length) {
    const candidates = [order.all, order.content, order.post].filter(list => list.length)
    const ids = candidates.find(list => list.length === wrappers.length)
    if (ids) {
      let index = 0
      out = out.replace(/<div class="contents"((?: data-v-[0-9a-f]+(?:="")?)?)>/g, (whole, scope) => {
        const id = ids[index++]
        const instance = overrideInstances.get(id)
        return `<div class="contents"${scope} data-edge-override="${xml(instance.blockId)}" data-edge-values="${ASSET_PREFIX}/overrides/${encodeURIComponent(id)}.json">`
      })
    }
    else {
      warn('override-unmatched', `${pagePath} has ${wrappers.length} override wrapper(s) but the page lists ${order.all.length} override instance(s); they were not tagged.`, { path: pagePath })
    }
  }
  out = out.replace(/\sdata-cms-(?:org|site|page|block)-id="[^"]*"/g, '')

  // Web app manifest: a data URL whose icons point at the Hub's image service.
  out = await replaceAsync(out, /href="data:application\/manifest\+json,([^"]+)"/g, async (whole, encoded) => {
    try {
      const manifest = JSON.parse(decodeURIComponent(encoded))
      for (const icon of manifest.icons || []) {
        const url = absolute(icon.src, pageUrl)
        const local = url && await downloadAsset(url.href)
        if (local)
          icon.src = local
      }
      manifest.start_url = '/'
      return `href="data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}"`
    }
    catch {
      return whole
    }
  })

  // Inline styles and <style> blocks.
  out = await replaceAsync(out, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async (_, open, css, close) => `${open}${await localizeCss(css, pageUrl)}${close}`)
  out = await replaceAsync(out, /\sstyle=(?:"([^"]*url\([^"]*)"|'([^']*url\([^']*)')/gi, async (_, double, single) => {
    const decoded = (double ?? single).replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#39;|&#x27;|&apos;/gi, '\'')
    return ` style="${(await localizeCss(decoded, pageUrl)).replace(/"/g, '&quot;')}"`
  })

  // Asset attributes: images, media, icons, stylesheets.
  const assetAttr = async (whole, attr, quote, value) => {
    const url = absolute(value, pageUrl)
    if (!url)
      return whole
    const local = await downloadAsset(url.href)
    return local ? ` ${attr}=${quote}${local}${quote}` : whole
  }
  out = await replaceAsync(out, /<(?:img|source|video|audio|track|input)\b[^>]*>/gi, async (tag) => {
    let next = await replaceAsync(tag, /\s(src|poster|data-src)=(["'])((?:(?!\2).)+)\2/gi, assetAttr)
    next = await replaceAsync(next, /\s(srcset|data-srcset)=(?:"([^"]+)"|'([^']+)')/gi, async (whole, attr, doubleSet, singleSet) => {
      const set = doubleSet ?? singleSet
      const parts = await Promise.all(set.split(/,\s+/).map(async (part) => {
        const [ref, size] = part.trim().split(/\s+/)
        const url = absolute(ref, pageUrl)
        const local = url && await downloadAsset(url.href)
        return local ? [local, size].filter(Boolean).join(' ') : part.trim()
      }))
      return ` ${attr}="${parts.join(', ')}"`
    })
    return next
  })
  out = await replaceAsync(out, /<link\b[^>]*>/gi, async (tag) => {
    if (!/rel="(?:stylesheet|icon|shortcut icon|apple-touch-icon|preload|mask-icon)"/i.test(tag))
      return tag
    return replaceAsync(tag, /\s(href)=(["'])((?:(?!\2).)+)\2/gi, assetAttr)
  })
  out = await replaceAsync(out, /<meta\b[^>]*\b(?:property|name)="(?:og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)"[^>]*>/gi, async (tag) => {
    return replaceAsync(tag, /\scontent="([^"]+)"/i, async (whole, value) => {
      const url = absolute(value, pageUrl)
      const local = url && await downloadAsset(url.href)
      return local ? ` content="https://${domain}${local}"` : whole
    })
  })

  // Links: downloads become local files; the site's own pages become
  // root-relative; canonical and og:url point at the new domain.
  out = await replaceAsync(out, /<a\b[^>]*>/gi, async (tag) => {
    return replaceAsync(tag, /\shref=(?:"([^"]+)"|'([^']+)')/i, async (whole, doubleValue, singleValue) => {
      const value = doubleValue ?? singleValue
      const url = absolute(value, pageUrl)
      if (!url)
        return whole
      if (isPageLink(url))
        return ` href="${normalPath(url.pathname)}${url.search}${url.hash}"`
      const hubFile = url.hostname === 'imagedelivery.net' || /firebasestorage|storage\.googleapis\.com|(?:^|\.)edge-marketing\.workers\.dev$/.test(url.hostname) || (isSiteUrl(url) && /^\/_files\//.test(url.pathname))
      if (hubFile || (isSiteUrl(url) && FILE_EXT.test(url.pathname))) {
        const local = await downloadAsset(url.href)
        return local ? ` href="${local}"` : whole
      }
      return whole
    })
  })
  out = out.replace(/(<link\b[^>]*rel="canonical"[^>]*href=")[^"]*(")/i, `$1https://${domain}${pagePath}$2`)
  out = out.replace(/(<meta\b[^>]*property="og:url"[^>]*content=")[^"]*(")/i, `$1https://${domain}${pagePath}$2`)
  for (const host of siteHosts) {
    if (host !== domain)
      out = out.split(`https://${host}/`).join(`https://${domain}/`)
  }

  const siteScript = args['site-script'] ? `<script type="module" src="${ASSET_PREFIX}/site.js"></script>` : ''
  const runtime = `<script src="${ASSET_PREFIX}/edge-standalone-config.js"></script><script type="module" src="${ASSET_PREFIX}/edge/edge-standalone.js"></script>${siteScript}`
  out = out.includes('</body>') ? out.replace('</body>', `${runtime}</body>`) : `${out}${runtime}`
  return out
}

// --- Page fetch and crawl --------------------------------------------------
const fetchPage = async (path) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request(`${SOURCE}${path}`, { headers: { accept: 'text/html' } })
    const html = await response.text()
    const finalPath = new URL(response.url).pathname
    // An SSR render that ran out of time ships a placeholder the browser
    // finishes; fetch again so the export holds the full render.
    const partial = /ssrBudgetFallback[^,\]]{0,20}true/.test(html) || /"ssrBudgetFallback",\s*true/.test(html)
    if (response.ok && partial && attempt < 2) {
      await new Promise(done => setTimeout(done, 2000))
      continue
    }
    return { status: response.status, html, finalPath, partial }
  }
}

const outputFile = path => join(SITE_DIR, decodeURI(path), 'index.html')


// --- Archive helpers ---------------------------------------------------------
const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cdata = value => `<![CDATA[${String(value ?? '').split(']]>').join(']]]]><![CDATA[>')}]]>`
const yaml = value => JSON.stringify(value ?? '')

const postBodyHtml = (post) => {
  const parts = []
  const collect = (value) => {
    if (typeof value === 'string' && /<\w+[^>]*>/.test(value))
      parts.push(value)
    else if (Array.isArray(value))
      value.forEach(collect)
    else if (value && typeof value === 'object')
      Object.values(value).forEach(collect)
  }
  for (const instance of post.content || [])
    collect(instance.values)
  return parts.join('\n')
}

const localizeFragment = async (html, base) => {
  let out = await replaceAsync(html, /\s(src)="([^"]+)"/gi, async (whole, attr, value) => {
    const url = absolute(value, base)
    const local = url && await downloadAsset(url.href)
    return local ? ` ${attr}="${local}"` : whole
  })
  out = await replaceAsync(out, /\shref="([^"]+)"/gi, async (whole, value) => {
    const url = absolute(value, base)
    return url && isPageLink(url) ? ` href="${normalPath(url.pathname)}"` : whole
  })
  return out
}

const isoDate = (post) => {
  const value = post.publishedAt || post.doc_created_at
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date
}

const readFileSafe = (file) => {
  try {
    return readFileSync(file, 'utf8')
  }
  catch {
    return ''
  }
}

// Override components read a value from the instance, else the schema default
// (the renderer's blockValue); the values file carries the same result.
const withSchemaDefaults = (instance) => {
  const defaults = Object.fromEntries(Object.entries(instance.schema || {}).filter(([, field]) => field && 'value' in field).map(([key, field]) => [key, field.value]))
  const values = Object.fromEntries(Object.entries(instance.values || {}).filter(([, value]) => value !== undefined && value !== null))
  return { ...defaults, ...values }
}

// The handover README for the site owner, from templates/CLIENT-README.md.
const writeClientReadme = (site, postCount, pageCount, config) => {
  const formPages = report.forms.filter(item => item.cms || item.fallback).length
  const formsSection = !formPages
    ? 'The site has no forms.'
    : config.formEndpoint
      ? `${formPages} page(s) have forms. They send each submission to \`${config.formEndpoint}\` (set in \`site/assets/edge-standalone-config.js\`). Send a test from each form after the site is live.`
      : `${formPages} page(s) have forms. They need somewhere to send submissions: create a form endpoint with a form service (for example Formspree, Basin or Netlify Forms) and put its URL in \`formEndpoint\` in \`site/assets/edge-standalone-config.js\`. Until then, a visitor who submits a form is asked to ${contactInstead} instead.`
  const differences = [
    'Editing: changes are made in the files, not in a CMS.',
    formPages ? 'Form submissions go to the form service you choose, not to a CMS inbox, and are not stored with the site.' : '',
    report.warnings.some(item => item.code === 'interactive-collection') ? 'Lists with filters, search or paging show their first set of results only.' : '',
    report.overrides.length && !report.siteScript ? 'A few interactive sections (such as galleries or sliders) show their first view without their interactive controls.' : '',
    Object.keys(report.thirdPartyScripts).length ? `Analytics and embeds already on the site stay as they were: ${Object.keys(report.thirdPartyScripts).join(', ')}.` : '',
    'Members-only or password-protected content, site search and visitor sign-in are not part of a static site.',
  ].filter(Boolean).map(line => `- ${line}`).join('\n')
  const fill = {
    siteName: site.name || report.domain,
    exportDate: new Date().toISOString().slice(0, 10),
    pageCount: String(pageCount),
    postSummary: postCount ? ` and ${postCount} posts` : '',
    domain: report.domain,
    redirectNote: report.redirects ? ', which keeps old page addresses working' : '',
    formsSection,
    differences,
    rssNote: postCount ? '\n- `site/rss.xml`: the feed of your latest posts.' : '',
  }
  const template = readFileSync(join(here, '../templates/CLIENT-README.md'), 'utf8')
  writeFileSync(join(OUT, 'README.md'), template.replace(/\{\{(\w+)\}\}/g, (_, key) => fill[key] ?? ''))
}

// --- Main ------------------------------------------------------------------
const main = async () => {
  if (existsSync(OUT) && readdirSync(OUT).length && args.force !== 'true') {
    console.error(`${OUT} is not empty. Pass --force to replace its site/ and content/ folders.`)
    process.exit(1)
  }
  rmSync(SITE_DIR, { recursive: true, force: true })
  rmSync(CONTENT_DIR, { recursive: true, force: true })
  mkdirSync(SITE_DIR, { recursive: true })
  mkdirSync(join(CONTENT_DIR, 'pages'), { recursive: true })
  mkdirSync(join(CONTENT_DIR, 'posts'), { recursive: true })

  if (PREVIEW_HOST)
    await selectPreviewSite()

  const site = await kv('getKey', { key: `sites:${ORG}:${SITE}` })
  if (!site)
    throw new Error(`No published site sites:${ORG}:${SITE} on ${SOURCE}.`)
  const domains = (site.domains || []).map(slug).filter(domain => domain && !domain.startsWith('localhost'))
  report.siteName = site.name
  setContactInstead(site)
  report.domain = slug(args.domain || site.canonicalDomain || domains[0] || SOURCE_HOST).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  siteHosts = new Set([SOURCE_HOST, report.domain, ...domains.flatMap(domain => [domain, domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`])])
  console.log(`Exporting "${site.name}" to ${OUT} for https://${report.domain}`)

  // Published pages and their paths.
  const pageIds = Object.keys(site.pageVersions || {})
  const pageDocs = await kvMany(pageIds.map(id => `pages:${ORG}:${SITE}:${id}`))
  const pages = Object.fromEntries(pageIds.map((id, index) => [id, pageDocs[index]]).filter(([, doc]) => doc))
  const pagePaths = pagePathsFromMenus(site.menus)
  for (const [id, doc] of Object.entries(pages)) {
    if (pagePaths[id])
      pageIdByPath.set(pagePaths[id], id)
    const inRenderOrder = (instances, structure) => {
      const byId = new Map((instances || []).filter(item => item?.id).map(item => [item.id, item]))
      const ordered = (structure || []).flatMap(row => (row.columns || []).flatMap(column => column.blocks || [])).filter(item => byId.has(item))
      const rest = [...byId.keys()].filter(item => !ordered.includes(item))
      return [...ordered, ...rest].map(item => byId.get(item))
    }
    const content = inRenderOrder(doc.content, doc.structure).filter(item => item.isOverrideBlock)
    const post = inRenderOrder(doc.postContent, doc.postStructure).filter(item => item.isOverrideBlock)
    for (const instance of [...content, ...post])
      overrideInstances.set(instance.id, { pageId: id, path: pagePaths[id] || '', blockId: instance.blockId || '', name: instance.name || '', values: withSchemaDefaults(instance) })
    if (content.length || post.length)
      overrideOrder.set(id, { content: content.map(item => item.id), post: post.map(item => item.id), all: [...content, ...post].map(item => item.id) })
  }
  for (const id of Object.keys(pages)) {
    if (!pagePaths[id])
      warn('page-without-path', `Published page ${pages[id].name || id} is in no menu, so it has no URL and is left out.`, { pageId: id })
  }

  // Published posts, events and custom post type entries.
  const postTemplatePaths = Object.entries(pages).filter(([id, doc]) => doc.post === true && pagePaths[id]).map(([id, doc]) => ({ id, path: pagePaths[id], custom: doc.postType?.enabled === true }))
  const posts = [...await listPosts('post'), ...await listPosts('event')]
  for (const template of postTemplatePaths.filter(item => item.custom))
    posts.push(...await listPosts(postTypeKey(template.id)))
  const postPaths = new Map()
  for (const post of posts) {
    const templates = post.postTypeId
      ? postTemplatePaths.filter(item => item.id === post.postTypeId)
      : postTemplatePaths.filter(item => !item.custom)
    postPaths.set(post.docId || post.name, templates.map(item => postDetailPath(item.path, post.name)))
    if (!templates.length)
      warn('post-without-page', `Post "${post.title || post.name}" has no published post page to show it, so it is archived but not in the site.`, { postId: post.docId })
  }

  // Seed the crawl with every known path plus the renderer's sitemap.
  const queue = new Set(['/', ...Object.values(pagePaths), ...[...postPaths.values()].flat()])
  try {
    const sitemap = await (await request(`${SOURCE}/sitemap.xml`)).text()
    for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = absolute(loc, SOURCE)
      if (url && isPageLink(url))
        queue.add(normalPath(url.pathname))
    }
  }
  catch {
    warn('sitemap-unavailable', 'The renderer sitemap could not be read; pages come from menus, posts and links only.')
  }

  const done = new Map()
  const redirects = new Map()
  const pending = [...queue]
  const seen = new Set(pending)
  while (pending.length && done.size < MAX_PAGES) {
    const batch = pending.splice(0, CONCURRENCY * 4)
    await pool(batch, async (path) => {
      const page = await fetchPage(path)
      const finalPath = normalPath(page.finalPath)
      if (page.status !== 200) {
        done.set(path, { status: page.status })
        if (page.status !== 404 || Object.values(pagePaths).includes(path))
          warn('page-fetch-failed', `${path} returned HTTP ${page.status}.`, { path })
        return
      }
      if (finalPath !== path) {
        redirects.set(path, finalPath)
        done.set(path, { status: 301, to: finalPath })
        if (seen.has(finalPath) && finalPath !== path && (done.has(finalPath) || pending.includes(finalPath)))
          return
        seen.add(finalPath)
      }
      const pageUrl = `${SOURCE}${finalPath}`
      for (const link of linksIn(page.html, pageUrl)) {
        if (!seen.has(link)) {
          seen.add(link)
          pending.push(link)
        }
      }
      const html = await transformHtml(page.html, pageUrl, finalPath)
      const file = outputFile(finalPath)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, html)
      done.set(finalPath, { status: 200, file, partial: page.partial })
      // Scripts that stay: the owner's analytics and embeds. List them so a
      // person confirms each belongs to the owner, not to us.
      for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi))
        (report.thirdPartyScripts[new URL(src).host] ||= new Set()).add(finalPath)
      for (const [name, pattern] of [['Google tag (gtag/GTM)', /googletagmanager\.com|gtag\(/], ['Microsoft Clarity', /clarity\.ms/], ['Meta Pixel', /fbq\(|connect\.facebook\.net/], ['AdRoll', /adroll/i]]) {
        if (pattern.test(html))
          (report.thirdPartyScripts[name] ||= new Set()).add(finalPath)
      }
      // Forms: CMS forms and action-less component forms go to formEndpoint;
      // forms with their own action (Mailchimp...) keep working as they are.
      const formTags = page.html.match(/<form\b[^>]*>/gi) || []
      const cms = formTags.filter(tag => /cms-form|data-cms-form/.test(tag)).length
      const fallback = formTags.filter(tag => !/cms-form|data-cms-form|\saction="/.test(tag)).length
      const external = [...new Set(formTags.map(tag => (tag.match(/\saction="https?:\/\/([^/"]+)/) || [])[1]).filter(Boolean))]
      if (cms || fallback || external.length)
        report.forms.push({ path: finalPath, cms, fallback, external })
      if (page.partial)
        warn('partial-render', `${finalPath} still came back as a partial server render after 3 tries; check it in a browser.`, { path: finalPath })
      if (/data-cms-collection[\s=>]|data-cms-filter[\s=>]/.test(page.html))
        warn('interactive-collection', `${finalPath} has a filter, search or paged list; the export keeps only its first rendered results.`, { path: finalPath })
      process.stdout.write('.')
    })
  }
  process.stdout.write('\n')
  if (pending.length)
    warn('max-pages', `Stopped at --max-pages ${MAX_PAGES}; ${pending.length} links were not followed.`)

  // 404 page.
  const missing = await request(`${SOURCE}/__edge-export-missing-page__/`)
  if (missing.status === 404) {
    const html = await transformHtml(await missing.text(), `${SOURCE}/`, '/404/')
    writeFileSync(join(SITE_DIR, '404.html'), html.replace(/<link\b[^>]*rel="canonical"[^>]*>/i, ''))
  }

  // Override values, with every image or file they name downloaded, for the
  // site script that ports each override's behavior (--site-script).
  const localizeValues = async (value) => {
    if (typeof value === 'string') {
      const url = /^https?:\/\//.test(value) ? absolute(value, SOURCE) : null
      if (url && !isPageLink(url) && (url.hostname === 'imagedelivery.net' || /firebasestorage/.test(url.hostname) || FILE_EXT.test(url.pathname)))
        return (await downloadAsset(url.href)) || value
      return value
    }
    if (Array.isArray(value))
      return Promise.all(value.map(localizeValues))
    if (value && typeof value === 'object')
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await localizeValues(item)])))
    return value
  }
  if (overrideInstances.size)
    mkdirSync(join(SITE_DIR, ASSET_PREFIX, 'overrides'), { recursive: true })
  for (const [id, instance] of overrideInstances) {
    writeFileSync(join(SITE_DIR, ASSET_PREFIX, 'overrides', `${id}.json`), JSON.stringify({ blockId: instance.blockId, name: instance.name, values: await localizeValues(instance.values) }, null, 2))
    report.overrides.push({ path: instance.path, pageId: instance.pageId, instanceId: id, blockId: instance.blockId, name: instance.name })
  }
  if (args['site-script']) {
    cpSync(resolve(args['site-script']), join(SITE_DIR, ASSET_PREFIX, 'site.js'))
    report.siteScript = resolve(args['site-script'])
  }
  if (overrideInstances.size) {
    const blocks = [...new Set([...overrideInstances.values()].map(item => item.blockId))].join(', ')
    warn('override-components', `${overrideInstances.size} block instance(s) (${blocks}) use renderer override components. The export keeps their server-rendered markup, tagged data-edge-override, with values in /assets/overrides/. ${report.siteScript ? 'Check that the site script ports each one.' : 'Port their behavior in a site script (--site-script) or accept the static markup.'}`)
  }

  // Runtime, config, robots and sitemap.
  const runtimeOut = join(SITE_DIR, ASSET_PREFIX, 'edge')
  const built = execFileSync(process.execPath, [join(here, '../runtime/build-runtime.mjs'), '--renderer', RENDERER, '--out', runtimeOut]).toString().trim()
  report.runtime = built.replace(/^.* from /, '')
  const usesLucide = [...done.values()].some(entry => entry.file && /data-lucide/.test(readFileSafe(entry.file)))
  if (usesLucide) {
    const local = await downloadAsset(LUCIDE_URL, 'application/javascript')
    if (!local)
      warn('lucide-download', 'Icons use Lucide but its script could not be downloaded; icons will not draw.')
    report.lucideUrl = local
  }
  // Adobe Fonts kits are licensed to the kit owner's Adobe account and may
  // only be served by Adobe; the copied files keep the export complete but
  // the owner must license the fonts or swap them before launch.
  const adobeFonts = [...assetMap.keys()].filter(href => /^https:\/\/(?:use|p)\.typekit\.net\//.test(href))
  if (adobeFonts.length)
    warn('licensed-fonts', 'The site uses an Adobe Fonts (Typekit) kit. Its fonts are copied so the export looks right, but Adobe Fonts may not be self-hosted: the owner needs their own Adobe Fonts kit (swap the @import) or replacement fonts before launch.', { urls: adobeFonts })
  const config = {
    formEndpoint: args['form-endpoint'] || '',
    formFormat: args['form-format'] === 'json' ? 'json' : 'form',
    formMissingMessage: `This form is not connected yet. Please ${contactInstead}.`,
    lucideUrl: report.lucideUrl || '',
  }
  writeFileSync(join(SITE_DIR, ASSET_PREFIX, 'edge-standalone-config.js'), `// Settings for this site's forms and icons. formEndpoint receives each form\n// submission as a POST (form-encoded, or JSON when formFormat is "json"),\n// for example a Formspree, Basin or Netlify function URL.\nwindow.EDGE_STANDALONE = ${JSON.stringify(config, null, 2)}\n`)
  // Links that are already broken on the source stay broken; list them so
  // the checker and the handover can name them instead of failing on them.
  report.brokenOnSource = [...done.entries()].filter(([, entry]) => entry.status === 404).map(([path]) => path).sort()
  if (report.brokenOnSource.length)
    warn('broken-on-source', `${report.brokenOnSource.length} linked path(s) return 404 on the source too; fix the links in the Hub or tell the owner.`, { paths: report.brokenOnSource })
  if (report.zaraz)
    warn('cloudflare-zaraz', 'The source domain runs Cloudflare Zaraz (tag manager on its Cloudflare zone). The export drops it; whatever it loaded (often analytics) must be added to the site directly by the owner.')
  const exportedPaths = [...new Set([...done.entries()].filter(([, entry]) => entry.status === 200).map(([path]) => path))].sort()
  // Redirects the renderer answered (old slugs, moved pages): a _redirects
  // file for hosts that read one (Netlify, Cloudflare Pages) and a small
  // redirect page at each old path for every other host.
  const redirectList = [...redirects.entries()].filter(([from, to]) => from !== to && done.get(to)?.status === 200)
  if (redirectList.length) {
    writeFileSync(join(SITE_DIR, '_redirects'), `${redirectList.map(([from, to]) => `${decodeURI(from)} ${decodeURI(to)} 301`).join('\n')}\n`)
    for (const [from, to] of redirectList) {
      const file = outputFile(from)
      if (existsSync(file))
        continue
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="https://${report.domain}${to}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${to}"><a href="${to}">This page has moved.</a>\n`)
    }
    report.redirects = Object.fromEntries(redirectList)
  }
  writeFileSync(join(SITE_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: https://${report.domain}/sitemap.xml\n`)
  writeFileSync(join(SITE_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${exportedPaths.map(path => `  <url><loc>https://${report.domain}${path}</loc></url>`).join('\n')}\n</urlset>\n`)
  if (report.forms.some(item => item.fallback))
    warn('form-fallback', `${report.forms.filter(item => item.fallback).length} page(s) have forms built by renderer components; the export sends their fields to formEndpoint. Submit each once to check.`)
  if (!config.formEndpoint && report.forms.some(item => item.cms || item.fallback))
    warn('form-endpoint-missing', `${report.forms.filter(item => item.cms || item.fallback).length} page(s) have forms and no --form-endpoint was given; set formEndpoint in site/assets/edge-standalone-config.js before launch.`)

  // Content archive: settings, pages, posts (JSON + Markdown), WordPress WXR.
  const publicSite = Object.fromEntries(Object.entries(site).filter(([key]) => !PRIVATE_SITE_FIELDS.has(key)))
  writeFileSync(join(CONTENT_DIR, 'site.json'), JSON.stringify(publicSite, null, 2))
  for (const [id, doc] of Object.entries(pages)) {
    const path = pagePaths[id] || ''
    const name = path === '/' ? 'home' : (path.replace(/^\/|\/$/g, '').replace(/\//g, '--') || doc.name || id)
    const { uid, ...rest } = doc
    writeFileSync(join(CONTENT_DIR, 'pages', `${decodeURIComponent(name)}.json`), JSON.stringify({ path, ...rest }, null, 2))
    report.pages.push({ pageId: id, name: doc.name, path, exported: done.get(path)?.status === 200 })
  }

  const items = []
  for (const post of posts.sort((a, b) => (isoDate(b)?.getTime() || 0) - (isoDate(a)?.getTime() || 0))) {
    const urls = postPaths.get(post.docId || post.name) || []
    const date = isoDate(post)
    const bodyHtml = await localizeFragment(postBodyHtml(post), `${SOURCE}/`)
    const featured = post.featuredImage ? await downloadAsset(absolute(post.featuredImage, SOURCE)?.href || '') : ''
    const meta = {
      title: post.title || post.name,
      slug: post.name,
      type: post.type || 'post',
      date: post.hidePublishedDate ? undefined : date?.toISOString(),
      tags: post.tags || [],
      blurb: post.blurb || '',
      featuredImage: featured || post.featuredImage || '',
      url: urls[0] || '',
      event: post.type === 'event' ? post.event : undefined,
    }
    const { uid, blockIds, structure, ...doc } = post
    writeFileSync(join(CONTENT_DIR, 'posts', `${post.name}.json`), JSON.stringify({ ...meta, bodyHtml, source: doc }, null, 2))
    const frontMatter = Object.entries(meta)
      .filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))
      .map(([key, value]) => {
        if (Array.isArray(value))
          return `${key}:\n${value.map(item => `  - ${yaml(item)}`).join('\n')}`
        return `${key}: ${typeof value === 'object' ? JSON.stringify(value) : yaml(value)}`
      })
      .join('\n')
    writeFileSync(join(CONTENT_DIR, 'posts', `${post.name}.md`), `---\n${frontMatter}\n---\n\n${htmlToMarkdown(bodyHtml)}\n`)
    report.posts.push({ name: post.name, title: meta.title, urls, exported: urls.some(url => done.get(url)?.status === 200) })
    items.push({ meta, bodyHtml, date })
  }

  const absoluteAssets = html => html.replace(/(src|href)="\/assets\//g, `$1="https://${report.domain}/assets/`)
  const wxrItems = items.map(({ meta, bodyHtml, date }, index) => `  <item>
    <title>${xml(meta.title)}</title>
    <link>https://${report.domain}${meta.url}</link>
    <pubDate>${date ? date.toUTCString() : ''}</pubDate>
    <content:encoded>${cdata(absoluteAssets(bodyHtml))}</content:encoded>
    <excerpt:encoded>${cdata(meta.blurb)}</excerpt:encoded>
    <wp:post_id>${index + 1}</wp:post_id>
    <wp:post_date>${date ? date.toISOString().replace('T', ' ').slice(0, 19) : ''}</wp:post_date>
    <wp:post_name>${xml(meta.slug)}</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
${meta.tags.map(tag => `    <category domain="post_tag" nicename="${xml(slug(tag).replace(/[^a-z0-9]+/g, '-'))}">${cdata(tag)}</category>`).join('\n')}
  </item>`).join('\n')
  writeFileSync(join(CONTENT_DIR, 'wordpress-export.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>${xml(site.name)}</title>
  <link>https://${report.domain}</link>
  <wp:wxr_version>1.2</wp:wxr_version>
  <wp:base_site_url>https://${report.domain}</wp:base_site_url>
  <wp:base_blog_url>https://${report.domain}</wp:base_blog_url>
${wxrItems}
</channel>
</rss>
`)
  if (items.length) {
    const rssItems = items.slice(0, 50).map(({ meta, date }) => `  <item>
    <title>${xml(meta.title)}</title>
    <link>https://${report.domain}${meta.url}</link>
    <guid>https://${report.domain}${meta.url}</guid>
${date && meta.date ? `    <pubDate>${date.toUTCString()}</pubDate>\n` : ''}    <description>${xml(meta.blurb)}</description>
  </item>`).join('\n')
    writeFileSync(join(SITE_DIR, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${xml(site.metaTitle || site.name)}</title>
  <link>https://${report.domain}/</link>
  <description>${xml(site.metaDescription || '')}</description>
${rssItems}
</channel>
</rss>
`)
  }
  writeFileSync(join(CONTENT_DIR, 'media-manifest.json'), JSON.stringify(Object.fromEntries([...assetMap.entries()].filter(([, local]) => local)), null, 2))

  report.thirdPartyScripts = Object.fromEntries(Object.entries(report.thirdPartyScripts).map(([key, paths]) => [key, paths.size]))
  report.finishedAt = new Date().toISOString()
  report.counts = { pages: exportedPaths.length, posts: posts.length, assets: report.assets.downloaded, failedAssets: report.assets.failed.length, warnings: report.warnings.length }
  if (report.assets.failed.length)
    warn('asset-download-failed', `${report.assets.failed.length} asset(s) could not be downloaded; they still point at their original URLs (see assets.failed).`)
  writeFileSync(join(OUT, 'export-report.json'), JSON.stringify(report, null, 2))
  writeClientReadme(site, posts.length, exportedPaths.length, config)
  console.log(`Done: ${report.counts.pages} pages, ${report.counts.posts} posts, ${report.counts.assets} assets, ${report.warnings.length} warnings. Report: ${join(OUT, 'export-report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
