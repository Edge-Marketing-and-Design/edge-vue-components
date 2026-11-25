import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const blockSource = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')
const blockApiSource = readFileSync(new URL('../components/cms/blockApi.vue', import.meta.url), 'utf8')

test('block API is the single owner of loading and loaded template rendering', () => {
  assert.match(blockApiSource, /const loadingRender = \(content\) =>/)
  assert.match(blockApiSource, /:template="loadingRender\(props\.template\)"/)
  assert.doesNotMatch(blockSource, /const loadingRender = \(content\) =>/)
  assert.doesNotMatch(blockSource, /@pending="state\.loading = \$event"/)
  assert.doesNotMatch(blockSource, /v-if="state\.loading"/)
})

test('block wrapper mounts one block API renderer and no parallel loading renderer', () => {
  const contentStart = blockSource.indexOf('<!-- Content -->')
  const overlayStart = blockSource.indexOf('<div v-if="showProtectedEditOverlay"', contentStart)
  assert.notEqual(contentStart, -1)
  assert.notEqual(overlayStart, -1)

  const contentTemplate = blockSource.slice(contentStart, overlayStart)
  assert.equal((contentTemplate.match(/<edge-cms-block-api\b/g) || []).length, 1)
  assert.doesNotMatch(contentTemplate, /<edge-cms-block-render\b/)
})
