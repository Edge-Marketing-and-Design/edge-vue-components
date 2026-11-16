import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const blockEditorSource = readFileSync(new URL('../components/cms/blockEditor.vue', import.meta.url), 'utf8')

// Recipients are chosen by recipientUserId; a visitor's userId never selects
// one (sites-and-pages contract, recipient routing; 9ce3f495).
test('Forms guide documents trusted emailTo and recipientUserId routing', () => {
  assert.match(blockEditorSource, /Email Routing by User ID/)
  assert.match(blockEditorSource, /Set <code>emailTo<\/code> as a block Input value/)
  assert.match(blockEditorSource, /Do not add an <code>emailTo<\/code> hidden input/)
  assert.match(blockEditorSource, /name="recipientUserId" value="\{\{ userId \}\}"/)
  assert.match(blockEditorSource, /<code>userId<\/code> identifies the visitor and never selects an email recipient/)
  assert.doesNotMatch(blockEditorSource, /name="userId" value=/)
  assert.match(blockEditorSource, /<code>meta\.contactEmail<\/code>, then <code>meta\.email<\/code>/)
  assert.doesNotMatch(blockEditorSource, /agent-specific form|Clearwater leads/)
})

test('Carousel guide documents frontend dot styling hooks', () => {
  assert.match(blockEditorSource, />\s*Dot Styling\s*</)
  assert.match(blockEditorSource, /<code>cms-carousel-dot<\/code>/)
  assert.match(blockEditorSource, /--carousel-dot-color: var\(--colors-muted\)/)
  assert.match(blockEditorSource, /--carousel-dot-active-color: var\(--colors-accent\)/)
})
