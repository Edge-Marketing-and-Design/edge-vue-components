import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { getPostTypes, postTypeKey } from '../lib/cmsPostTypes.js'
import { findCmsPageRoute } from '../lib/cmsPublishedSitePreview.js'

const filename = new URL('../components/cms/site.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const declaration = source.slice(source.indexOf('const customPostTypes = computed('), source.indexOf('const selectedCustomPostType = computed('))
const makeTypes = (records, menus) => {
  const pages = { value: reactive(records) }
  const siteData = { value: reactive({ menus }) }
  const types = runInNewContext(`${declaration}; customPostTypes`, { computed, getPostTypes, pages, siteData })
  return { pages, siteData, types }
}
const page = name => ({ name, post: true, postType: { enabled: true, icon: 'Users' } })

test('custom-post labels use menu titles without changing page identity or routes', () => {
  const menus = { 'Site Root': [{ name: 'persons', menuTitle: 'Persons', item: 'person-page' }] }
  const { pages, types } = makeTypes({ 'person-page': page('persons') }, menus)
  const type = types.value[0]
  assert.equal(type.name, 'Persons')
  assert.equal(type.id, 'person-page')
  assert.equal(type.type, postTypeKey('person-page'))
  assert.equal(type.icon, 'Users')
  assert.equal(type.page, pages.value['person-page'])
  assert.equal(type.page.name, 'persons')
  assert.equal(findCmsPageRoute(menus, 'person-page'), 'persons')
})

test('nested and unlisted menu titles are supported and external links are ignored', () => {
  const { types } = makeTypes({ team: page('team'), hidden: page('hidden'), orphan: page('orphan'), disabled: { name: 'disabled', post: true } }, {
    'Site Root': [{ item: { type: 'external', children: [{ item: 'team', menuTitle: 'Wrong' }] } }, { item: { company: [{ item: 'team', name: 'team', menuTitle: '  Our Team  ' }] } }],
    'Not In Menu': [{ item: 'hidden', name: 'hidden', menuTitle: 'Hidden Profiles' }],
  })
  assert.equal(types.value.find(type => type.id === 'team').name, 'Our Team')
  assert.equal(types.value.find(type => type.id === 'hidden').name, 'Hidden Profiles')
  assert.equal(types.value.find(type => type.id === 'orphan').name, 'orphan')
  assert.equal(types.value.some(type => type.id === 'disabled'), false)
})

test('labels react to menu renames, keep first nonempty title and sort by display name', () => {
  const { siteData, types } = makeTypes({ a: page('a'), z: page('z') }, {
    'Site Root': [
      { item: 'a', menuTitle: '   ' }, { item: 'a', menuTitle: 'Zebra' }, { item: 'a', menuTitle: 'Duplicate' }, { item: 'z', menuTitle: 'Alpha' },
    ],
  })
  assert.equal(types.value.map(type => type.name).join(','), 'Alpha,Zebra')
  siteData.value.menus['Site Root'][1].menuTitle = 'Aardvark'
  assert.equal(types.value.map(type => type.name).join(','), 'Aardvark,Alpha')
  siteData.value.menus = null
  assert.equal(types.value.map(type => type.name).join(','), 'a,z')
})

test('site script and template compile with custom-post display names', () => {
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'post-type-labels-test' })
  const result = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'post-type-labels-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
