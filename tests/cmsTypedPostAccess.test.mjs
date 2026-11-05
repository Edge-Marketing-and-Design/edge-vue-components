import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const filename = new URL('../components/cms/typedPosts.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const accessDeclarations = source.split('\n').filter(line => /^const (publicAccessValue|accessItems|accessSelectValue|accessStoredValue) =/.test(line)).join('\n')

test('Public uses a nonempty select value without changing its stored restriction', () => {
  const siteDoc = { value: reactive({ restrictedContent: { rules: [{ id: 'members', name: 'Members' }] } }) }
  const access = runInNewContext(`${accessDeclarations}; ({ publicAccessValue, accessItems, accessSelectValue, accessStoredValue })`, { computed, siteDoc })
  assert.ok(access.publicAccessValue)
  assert.ok(access.accessItems.value.every(item => item.id !== ''))
  assert.equal(access.accessSelectValue(''), access.publicAccessValue)
  assert.equal(access.accessSelectValue(undefined), access.publicAccessValue)
  assert.equal(access.accessStoredValue(access.publicAccessValue), '')
  assert.equal(access.accessSelectValue('members'), 'members')
  assert.equal(access.accessStoredValue('members'), 'members')
  siteDoc.value.restrictedContent.rules.push({ id: 'staff', name: 'Staff' })
  assert.equal(access.accessItems.value.at(-1).id, 'staff')
})

test('Access dropdown maps only its UI value, preserving the stored field', () => {
  assert.match(source, /:model-value="accessSelectValue\(slot\.workingDoc\.restrictionRuleId\)"/)
  assert.match(source, /:items="accessItems"/)
  assert.match(source, /@update:model-value="value => slot\.workingDoc\.restrictionRuleId = accessStoredValue\(value\)"/)
  assert.doesNotMatch(source, /id: '', name: 'Public'/)
})

test('typed-post script and template compile', () => {
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'typed-post-access-test' })
  const result = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'typed-post-access-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
})
