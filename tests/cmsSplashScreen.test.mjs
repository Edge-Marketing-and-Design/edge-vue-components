import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { splashThemeColors } from '../lib/cmsSplashScreen.js'
import { createCmsThemeDefaults } from '../lib/cmsThemeDefaults.mjs'
import { siteSettingsDefaults, siteSettingsProblems } from '../lib/cmsOperations.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('color options come exclusively from the selected theme and preserve custom names', () => {
  const theme = { extend: { colors: { primary: '#003e52', customBrand: '#ff8800', gray: { DEFAULT: '#eee', 900: '#111' } } } }
  const options = splashThemeColors(theme)
  assert.deepEqual(options, [
    { name: 'primary', color: '#003e52' }, { name: 'customBrand', color: '#ff8800' },
    { name: 'gray.900', color: '#111' }, { name: 'gray', color: '#eee' },
  ])
  assert.deepEqual(splashThemeColors({ theme: JSON.stringify(theme) }), options)
  assert.ok(splashThemeColors(createCmsThemeDefaults()).some(item => item.name === 'canvas'))
  for (const input of [null, '', 'invalid JSON', {}, { extend: { colors: [] } }]) assert.deepEqual(splashThemeColors(input), [])
  assert.equal(splashThemeColors({ extend: { colors: { primary: '#ffffff' } } })[0].color, '#ffffff')
})

test('site settings expose optional splash fields and validate media URLs', () => {
  const defaults = siteSettingsDefaults()
  assert.equal(defaults.splashImage, '')
  assert.equal(defaults.splashBackgroundColor, '')
  assert.deepEqual(siteSettingsProblems({ splashImage: '', splashBackgroundColor: 'primary' }), [])
  assert.ok(siteSettingsProblems({ splashImage: 'javascript:alert(1)' }).some(item => item.code === 'site.settings-media'))
  for (const path of ['../../functions/helpers/cmsOperations.mjs', '../functions/helpers/cmsOperations.mjs'])
    assert.equal(read(path), read('../lib/cmsOperations.js'))
})

test('Splash Screen follows Branding and edited Vue components compile', () => {
  const form = read('../components/cms/siteSettingsForm.vue')
  assert.ok(form.indexOf('<TabsTrigger value="splash-screen"') > form.indexOf('<TabsTrigger value="branding"'))
  assert.ok(form.indexOf('<TabsTrigger value="splash-screen"') < form.indexOf('<TabsTrigger value="seo"'))
  for (const file of ['siteSettingsForm.vue', 'splashScreenSettings.vue', 'site.vue', 'themeEditor.vue']) {
    const { descriptor, errors } = parse(read(`../components/cms/${file}`))
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: `splash-${file}` })
    const template = compileTemplate({ source: descriptor.template.content, filename: file, id: `splash-${file}`, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})
