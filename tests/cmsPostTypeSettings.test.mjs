import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

const readComponent = name => parse(readFileSync(new URL(`../components/cms/${name}.vue`, import.meta.url), 'utf8')).descriptor
const menu = readComponent('menu')
const page = readComponent('page')
const settings = readComponent('postTypeSettings')
const walk = (node, match) => {
  if (match(node))
    return node
  for (const child of node.children || []) {
    const found = walk(child, match)
    if (found)
      return found
  }
  return null
}
const directive = (node, name, argument) => node.props?.find(prop => prop.type === 7 && prop.name === name && (!argument || prop.arg?.content === argument))
const settingsSheet = (descriptor, expression) => walk(descriptor.template.ast, node => node.tag === 'Sheet' && directive(node, 'model')?.exp?.content === expression)

for (const [name, descriptor, expression] of [['menu', menu, 'state.pageSettings'], ['page preview', page, 'state.pageSettingsOpen']]) {
  test(`${name} settings binds custom-post options to the same working page`, () => {
    const sheet = settingsSheet(descriptor, expression)
    assert.ok(sheet)
    const control = walk(sheet, node => node.tag === 'edge-cms-post-type-settings')
    assert.ok(control, 'Settings must expose the shared custom-post control')
    assert.equal(directive(control, 'model')?.exp?.content, 'slotProps.workingDoc.postType')
    assert.equal(directive(control, 'bind', 'page')?.exp?.content, 'slotProps.workingDoc')
  })
}

test('preview settings exposes Index/Detail on ordinary site pages', () => {
  const sheet = settingsSheet(page, 'state.pageSettingsOpen')
  const checkbox = walk(sheet, node => node.tag === 'edge-shad-checkbox' && directive(node, 'model')?.exp?.content === 'slotProps.workingDoc.post')
  assert.ok(checkbox)
  const condition = directive(checkbox, 'if')?.exp?.content
  assert.equal(condition, '!templateTypeIncludesPost(slotProps.workingDoc)')
  const visible = (props, slotProps, templateTypeIncludesPost) => runInNewContext(condition, { props, slotProps, templateTypeIncludesPost })
  for (const isTemplateSite of [false, true]) {
    assert.equal(visible({ isTemplateSite }, { workingDoc: { post: false } }, () => false), true)
    assert.equal(visible({ isTemplateSite }, { workingDoc: {} }, () => true), false, 'Post-only templates retain their existing checkbox exclusion')
  }
})

test('shared custom-post control is visible only when Index/Detail is checked', async () => {
  const render = runInNewContext(`(function () { ${compile(settings.template.content, { mode: 'function', prefixIdentifiers: true }).code} })()`, { Vue })
  const checkbox = { setup: (_, { slots }) => () => Vue.h('label', slots.default?.()) }
  const html = post => renderToString(Vue.createSSRApp({
    components: Object.fromEntries(['edge-shad-checkbox', 'ChevronsUpDown', 'edge-shad-button', 'PopoverTrigger', 'edge-shad-input', 'Check', 'PopoverContent', 'Popover'].map(name => [name, checkbox])),
    setup: () => ({ page: { name: 'persons', post }, modelValue: { enabled: false }, set() {} }),
    render,
  }))
  assert.match(await html(true), /Use as a custom post type/)
  assert.doesNotMatch(await html(false), /Use as a custom post type/)
  assert.doesNotMatch(await html(undefined), /Use as a custom post type/)
})

for (const [name, descriptor] of [['menu', menu], ['page', page]]) {
  test(`${name} settings script and template compile`, () => {
    const filename = `${name}.vue`
    const script = compileScript(descriptor, { id: `post-type-settings-${name}` })
    const result = compileTemplate({ source: descriptor.template.content, filename, id: `post-type-settings-${name}`, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [])
  })
}
