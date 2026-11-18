#!/usr/bin/env node
// Proves an exported site is disconnected and complete:
//   - no reference to the Hub, the renderer or their services remains
//   - every internal page link and every local asset resolves to a file
//   - no Nuxt payload, runtime config or Hub identifiers remain
// Usage: node check-export.mjs --out <export folder> [--allow host1,host2]
// Writes <out>/check-results.json and exits 1 when a check fails.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (arg.startsWith('--'))
    pairs.push([arg.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true'])
  return pairs
}, []))
if (!args.out) {
  console.error('Usage: node check-export.mjs --out <export folder>')
  process.exit(1)
}
const OUT = resolve(args.out)
const SITE = join(OUT, 'site')
if (!existsSync(SITE)) {
  console.error(`No site folder in ${OUT}; run export-site.mjs first.`)
  process.exit(1)
}
const report = existsSync(join(OUT, 'export-report.json')) ? JSON.parse(readFileSync(join(OUT, 'export-report.json'), 'utf8')) : {}
const sourceHost = report.source ? new URL(report.source).host : ''

// Hosts and markers that mean the page still depends on the Hub or renderer.
const HUB_PATTERNS = [
  { id: 'cloudflare-images', pattern: /imagedelivery\.net/ },
  { id: 'firebase', pattern: /firebasestorage\.googleapis\.com|firebaseapp\.com|cloudfunctions\.net|\.web\.app\b/ },
  { id: 'renderer-host', pattern: /emd-cms-front|\.pages\.dev|edge-marketing\.workers\.dev|edgemarketingdesign\.com\/(?:api|_files)/ },
  { id: 'renderer-api', pattern: /["'(]\/(?:api|_nuxt|_files|_edge-fonts|_ipx)\// },
  { id: 'nuxt-payload', pattern: /__NUXT_DATA__|window\.__NUXT__/ },
  { id: 'hub-ids', pattern: /data-cms-(?:org|site)-id=/ },
  { id: 'preview-controls', pattern: />\s*Exit Preview\s*</ },
  { id: 'cloudflare-injected', pattern: /\/cdn-cgi\/|cloudflareinsights\.com/ },
]
if (sourceHost && !/pages\.dev$/.test(sourceHost) && sourceHost !== report.domain)
  HUB_PATTERNS.push({ id: 'source-host', pattern: new RegExp(sourceHost.replace(/\./g, '\\.')) })
const allowed = String(args.allow || '').split(',').filter(Boolean)

const walk = dir => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const files = walk(SITE)
const textFiles = files.filter(file => /\.(html|css|js|xml|txt|json|webmanifest)$/.test(file) && !file.includes(`${join('assets', 'edge')}/`))
const htmlFiles = files.filter(file => file.endsWith('.html'))

const failures = []
const fail = (check, file, detail) => failures.push({ check, file: relative(SITE, file), detail })
if (!htmlFiles.length || !existsSync(join(SITE, 'index.html')))
  failures.push({ check: 'site-exported', file: 'site/index.html', detail: 'No exported home page; run export-site.mjs first.' })

for (const file of textFiles) {
  const text = readFileSync(file, 'utf8')
  for (const { id, pattern } of HUB_PATTERNS) {
    const match = text.match(pattern)
    if (match && !allowed.some(host => text.slice(Math.max(0, match.index - 80), match.index + 80).includes(host)))
      fail(`no-hub-reference:${id}`, file, text.slice(Math.max(0, match.index - 60), match.index + 60).replace(/\s+/g, ' '))
  }
}

const exists = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0])
  const target = join(SITE, clean)
  if (clean.endsWith('/'))
    return existsSync(join(target, 'index.html'))
  return existsSync(target) || (!extname(clean) && existsSync(join(target, 'index.html')))
}

let linkCount = 0
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8')
  for (const [, attr, value] of html.matchAll(/\s(href|src|poster)="(\/[^"/][^"]*|\/)"/g)) {
    if (value.startsWith('//'))
      continue
    linkCount++
    if (!exists(value))
      fail(attr === 'href' ? 'internal-link-resolves' : 'asset-exists', file, value)
  }
  for (const [, set] of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const part of set.split(/,\s+/)) {
      const ref = part.trim().split(/\s+/)[0]
      if (ref.startsWith('/') && !exists(ref))
        fail('asset-exists', file, ref)
    }
  }
  if (!/edge-standalone\.js/.test(html) && !/http-equiv="refresh"/.test(html))
    fail('runtime-included', file, 'edge-standalone.js is not loaded')
}
for (const file of files.filter(file => file.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8')
  for (const [, ref] of css.matchAll(/url\("(\/assets\/[^"]+)"\)/g)) {
    if (!exists(ref))
      fail('asset-exists', file, ref)
  }
}

const config = existsSync(join(SITE, 'assets/edge-standalone-config.js')) ? readFileSync(join(SITE, 'assets/edge-standalone-config.js'), 'utf8') : ''
const formsConnected = !(report.forms || []).length || /"formEndpoint":\s*"https?:\/\//.test(config)

const results = {
  checkedAt: new Date().toISOString(),
  files: files.length,
  pages: htmlFiles.length,
  localReferences: linkCount,
  ok: failures.length === 0,
  formsConnected,
  failures,
}
writeFileSync(join(OUT, 'check-results.json'), JSON.stringify(results, null, 2))
const byCheck = failures.reduce((counts, item) => ({ ...counts, [item.check]: (counts[item.check] || 0) + 1 }), {})
console.log(`${htmlFiles.length} pages, ${files.length} files, ${linkCount} local references checked.`)
console.log(failures.length ? `FAILED: ${JSON.stringify(byCheck)} (details in check-results.json)` : 'OK: no Hub references, every local link and asset resolves.')
if (!formsConnected)
  console.log('NOTE: forms have no endpoint yet (formEndpoint in site/assets/edge-standalone-config.js).')
process.exit(failures.length ? 1 : 0)
