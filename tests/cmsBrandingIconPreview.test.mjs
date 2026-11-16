import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCmsBrandingIconPreview } from '../lib/cmsBrandingIconPreview.js'

const source = 'https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/artwork/public'
test('matches all five renderer favicon sizes and query transformations', () => {
  const icons = buildCmsBrandingIconPreview({ favicon: `${source}?custom=keep` })
  const favicons = icons.filter(icon => icon.group === 'favicons')
  assert.deepEqual(favicons.map(icon => icon.size), [16, 32, 48, 96, 180])
  for (const icon of favicons) {
    const url = new URL(icon.url)
    assert.equal(url.pathname, new URL(source).pathname)
    assert.deepEqual(Object.fromEntries(url.searchParams), { custom: 'keep', width: String(icon.size), height: String(icon.size), fit: 'cover', format: 'png', quality: '90' })
  }
  assert.equal(favicons[4].label, 'Apple touch icon')
})
test('matches the app icon path variants for selected app artwork', () => {
  const icons = buildCmsBrandingIconPreview({ logo: source.replace('artwork', 'wide-logo'), appIcon: source, favicon: source.replace('artwork', 'favicon') })
  const app = icons.filter(icon => icon.group === 'app')
  assert.deepEqual(app.map(icon => icon.size), [192, 512])
  for (const icon of app)
    assert.equal(icon.url, `https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/artwork/width=${icon.size},height=${icon.size},fit=pad,background=white,format=jpeg,quality=90`)
})
test('missing favicon falls back to logo; missing logo resolves on renderer origin', () => {
  const settings = { logo: source }
  const original = structuredClone(settings)
  assert.match(buildCmsBrandingIconPreview(settings)[0].sourceLabel, /Dark logo/)
  assert.deepEqual(settings, original)
  assert.equal(buildCmsBrandingIconPreview({}, 'https://renderer.example/')[0].url, 'https://renderer.example/images/logo.png')
  assert.equal(buildCmsBrandingIconPreview({})[0].url, '')
})
test('external and unsupported Cloudflare app images keep the actual any-size fallback', () => {
  for (const logo of ['https://example.com/logo.svg', source.replace('h7EjKG0X9kOxmLp41mxOng', 'other'), `${source}?signed=1`]) {
    const app = buildCmsBrandingIconPreview({ appIcon: logo }).filter(icon => icon.group === 'app')
    assert.equal(app.length, 1)
    assert.equal(app[0].size, null)
    assert.equal(app[0].url, logo)
    assert.equal(app[0].transformed, false)
  }
  const icons = buildCmsBrandingIconPreview({ favicon: 'https://example.com/favicon.png' })
  assert.ok(icons.filter(icon => icon.group === 'favicons').every(icon => icon.url === 'https://example.com/favicon.png' && !icon.transformed))
})
test('updated unsaved settings change the URLs without mutations or writes', () => {
  const settings = { logo: source, appIcon: source }
  const first = buildCmsBrandingIconPreview(settings)
  settings.appIcon = source.replace('artwork', 'new-artwork')
  settings.favicon = 'https://example.com/new-icon.png'
  const next = buildCmsBrandingIconPreview(settings)
  assert.notEqual(first[5].url, next[5].url)
  assert.equal(next[0].url, settings.favicon)
})
test('invalid and non-web sources are not embedded as preview or open links', () => {
  for (const source of ['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/logo.png'])
    assert.ok(buildCmsBrandingIconPreview({ logo: source, favicon: source, appIcon: source }).every(icon => !icon.url))
})


test('dedicated app artwork drives Apple touch and app icons; browser favicons stay separate', () => {
  const settings = { logo: source, favicon: source.replace('artwork', 'favicon'), appIcon: source.replace('artwork', 'square-app-art') }
  const icons = buildCmsBrandingIconPreview(settings)
  assert.ok(icons.filter(icon => icon.group === 'app').every(icon => icon.url.includes('/square-app-art/') && icon.sourceLabel === 'App icon'))
  assert.ok(icons.filter(icon => icon.group === 'favicons' && icon.size !== 180).every(icon => icon.url.includes('/favicon/')))
  settings.appIcon = ''
  assert.equal(buildCmsBrandingIconPreview(settings).filter(icon => icon.group === 'app').length, 0)
  settings.appIcon = 'https://example.com/non-square-art.svg'
  const fallback = buildCmsBrandingIconPreview(settings).filter(icon => icon.group === 'app')
  assert.equal(fallback.length, 1)
  assert.equal(fallback[0].url, settings.appIcon)
})


test('missing, blank or cleared app artwork never previews the public logo fallback', () => {
  for (const appIcon of [undefined, '', '   ']) {
    const icons = buildCmsBrandingIconPreview({ logo: source, appIcon }, 'https://renderer.example')
    assert.equal(icons.filter(icon => icon.group === 'app').length, 0)
    assert.equal(icons.filter(icon => icon.group === 'favicons').length, 5)
  }
})


test('Apple touch uses padded app artwork first and returns to favicon then logo when cleared', () => {
  const settings = { appIcon: source.replace('artwork', 'app'), favicon: source.replace('artwork', 'favicon'), logo: source.replace('artwork', 'logo') }
  const apple = () => buildCmsBrandingIconPreview(settings).find(icon => icon.size === 180)
  assert.equal(apple().url, 'https://imagedelivery.net/h7EjKG0X9kOxmLp41mxOng/app/width=180,height=180,fit=pad,background=white,format=jpeg,quality=90')
  assert.equal(apple().sourceLabel, 'App icon')
  settings.appIcon = ''
  assert.ok(apple().url.includes('/favicon/'))
  settings.favicon = ''
  assert.ok(apple().url.includes('/logo/'))
  settings.appIcon = 'https://example.com/art.svg'
  assert.equal(apple().url, settings.appIcon)
})
