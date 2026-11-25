import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('CMS option controls always provide a stable form field name', () => {
  const optionsSelectSource = readFileSync(new URL('../components/cms/optionsSelect.vue', import.meta.url), 'utf8')
  const blockSource = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')

  assert.match(optionsSelectSource, /name:\s*\{[\s\S]*?type:\s*String[\s\S]*?default:\s*''/)
  assert.match(optionsSelectSource, /const fieldName = computed\(\(\) => String\(props\.name \|\| props\.option\?\.field \|\| ''\)\.trim\(\)\)/)
  assert.equal((optionsSelectSource.match(/:name="fieldName"/g) || []).length, 2)
  assert.match(blockSource, /:name="`\$\{entry\.field\}-\$\{option\.field\}`"/)
  assert.match(blockSource, /:name="entry\.field"/)
})
