import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const blockEditorSource = readFileSync(new URL('../components/cms/blockEditor.vue', import.meta.url), 'utf8')
const pageBlockSource = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')

const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf('\n}\n', start)

  assert.notEqual(start, -1, `${name} should exist`)
  assert.notEqual(end, -1, `${name} should close`)

  return source.slice(start, end + 3)
}

test('developer template typing updates the draft without rebuilding its preview', () => {
  const syncSource = functionSource(blockEditorSource, 'syncWorkingTemplateContent')
  const editorUpdatesSource = blockEditorSource.slice(
    blockEditorSource.indexOf('const editorDocUpdates ='),
    blockEditorSource.indexOf('const isPlainObject ='),
  )

  assert.match(syncSource, /workingDoc\.content = value/)
  assert.match(syncSource, /workingDoc\.template = value/)
  assert.match(syncSource, /state\.previewTemplateDirty = true/)
  assert.doesNotMatch(syncSource, /state\.previewBlock/)
  assert.doesNotMatch(syncSource, /blockModel\(/)
  assert.match(editorUpdatesSource, /state\.editorWorkingDoc = workingDoc \|\| null\s+if \(state\.previewTemplateDirty\)\s+return\s+const parsed = blockModel/)
})

test('developer preview rebuilds only from the pending action or a successful save', () => {
  assert.doesNotMatch(blockEditorSource, /@focusout="handleTemplateEditorFocusOut/)
  assert.match(blockEditorSource, /@click="refreshWorkingTemplatePreview\(slotProps\.workingDoc, \{ force: true \}\)"/)
  assert.match(blockEditorSource, /v-if="state\.previewTemplateDirty"/)
  assert.match(blockEditorSource, />\s*Changes Pending: Refresh\s*</)
  // After a save the shared block checks run (advisory, never blocking),
  // then the preview rebuilds.
  assert.match(blockEditorSource, /const handleBlockSaved = async \(payload\) => \{\s+runBlockChecks\(payload\?\.data\)\s+refreshWorkingTemplatePreview\(state\.editorWorkingDoc, \{ force: true \}\)/)
  assert.match(blockEditorSource, /@saved="handleBlockSaved"/)
  assert.match(blockEditorSource, /state\.previewRefreshRevision \+= 1/)
})

test('page-level block editing remains on its existing live update path', () => {
  assert.doesNotMatch(pageBlockSource, /previewTemplateDirty|Refresh Preview|refreshWorkingTemplatePreview/)
})
