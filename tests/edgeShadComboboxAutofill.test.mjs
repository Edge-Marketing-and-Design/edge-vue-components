import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const combobox = readFileSync(new URL('../components/shad/combobox.vue', import.meta.url), 'utf8')

test('shared Edge combobox suppresses credential autofill by default', () => {
  assert.match(combobox, /'name': `\$\{props\.name\}Search`/)
  assert.match(combobox, /'autocomplete': 'off'/)
  assert.match(combobox, /'data-1p-ignore': 'true'/)
  assert.match(combobox, /'data-lpignore': 'true'/)
  assert.match(combobox, /'data-form-type': 'other'/)
  assert.match(combobox, /\.\.\.props\.inputAttrs/)
  assert.match(combobox, /v-bind="resolvedInputAttrs"/)
})
