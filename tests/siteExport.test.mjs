import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildCmsPostLiveUrl } from '../lib/cmsPostRoutes.js'
import { postTypeKey as hubPostTypeKey } from '../lib/cmsPostTypes.js'
import { htmlToMarkdown } from '../skills/edge-site-export/scripts/html-to-markdown.mjs'
import { cfEmail, pagePathsFromMenus, postDetailPath, postTypeKey } from '../skills/edge-site-export/scripts/site-model.mjs'

const checker = fileURLToPath(new URL('../skills/edge-site-export/scripts/check-export.mjs', import.meta.url))

test('site export derives custom post type keys exactly as the Hub does', () => {
  for (const id of ['3f7b5501-16c9-49c7-994b-cdb3362a3b48', 'AbC123', 'x'])
    assert.equal(postTypeKey(id), hubPostTypeKey(id))
})

test('site export builds post detail paths as the Hub builds post live URLs', () => {
  assert.equal(`https://example.com${postDetailPath('/blog/', 'my-post')}`, buildCmsPostLiveUrl({ origin: 'https://example.com', routeSegments: ['blog'], postSlug: 'my-post' }))
  assert.equal(`https://example.com${postDetailPath('/', 'my-post')}`, buildCmsPostLiveUrl({ origin: 'https://example.com', routeSegments: ['home'], postSlug: 'my-post' }))
  assert.equal(postDetailPath('/news/updates/', 'a b'), '/news/updates/a%20b/')
})

test('site export maps menus to page paths: home at the root, folders add a segment, external links skipped', () => {
  const paths = pagePathsFromMenus({
    'Site Root': [
      { item: 'home-id', name: 'home' },
      { item: 'about-id', name: 'About' },
      { item: { resources: [{ item: 'faq-id', name: 'faq' }] }, name: 'resources' },
      { item: { type: 'external', url: 'https://elsewhere.example' }, name: 'elsewhere' },
    ],
    'Not In Menu': [{ item: 'thanks-id', name: 'thank-you' }],
  })
  assert.deepEqual(paths, { 'home-id': '/', 'about-id': '/about/', 'faq-id': '/resources/faq/', 'thanks-id': '/thank-you/' })
})

test('site export restores Cloudflare-obfuscated email addresses', () => {
  const email = 'info@example.com'
  const key = 0x42
  const hex = key.toString(16) + [...email].map(char => (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('')
  assert.equal(cfEmail(hex), email)
})

test('site export converts post rich text to Markdown', () => {
  const markdown = htmlToMarkdown('<p><strong>Title&nbsp;</strong></p><p><strong>&nbsp;</strong></p><h2>Part</h2><ul><li>one <em>two</em></li><li><a href="/x/">link</a></li></ul><p>a &amp; b<br>c</p><img src="/assets/media/a.jpg" alt="A">')
  assert.equal(markdown, '**Title**\n\n## Part\n\n- one *two*\n- [link](/x/)\n\na & b  \nc\n\n![A](/assets/media/a.jpg)')
})

const writeExport = (pages) => {
  const out = mkdtempSync(join(tmpdir(), 'edge-site-export-'))
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(join(out, 'site', path), { recursive: true })
    writeFileSync(join(out, 'site', path, 'index.html'), html)
  }
  mkdirSync(join(out, 'site/assets/media'), { recursive: true })
  writeFileSync(join(out, 'site/assets/media/a.jpg'), 'x')
  mkdirSync(join(out, 'site/assets/edge'), { recursive: true })
  writeFileSync(join(out, 'site/assets/edge/edge-standalone.js'), '')
  return out
}
const runtime = '<script type="module" src="/assets/edge/edge-standalone.js"></script>'

test('site export checker passes a disconnected export', () => {
  const out = writeExport({ '': `<a href="/about/">About</a><img src="/assets/media/a.jpg">${runtime}`, 'about': `<a href="/">Home</a>${runtime}` })
  const result = spawnSync(process.execPath, [checker, '--out', out])
  rmSync(out, { recursive: true, force: true })
  assert.equal(result.status, 0, result.stdout.toString())
})

test('site export checker fails Hub references, missing pages and missing assets', () => {
  const out = writeExport({ '': `<img src="https://imagedelivery.net/abc/id/public"><a href="/missing/">x</a><img src="/assets/media/gone.jpg"><script src="/_nuxt/entry.js"></script>${runtime}` })
  const result = spawnSync(process.execPath, [checker, '--out', out])
  const output = result.stdout.toString()
  rmSync(out, { recursive: true, force: true })
  assert.equal(result.status, 1)
  for (const check of ['cloudflare-images', 'renderer-api', 'internal-link-resolves', 'asset-exists'])
    assert.match(output, new RegExp(check))
})
