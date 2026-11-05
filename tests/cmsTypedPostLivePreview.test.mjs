import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import { buildPostEntryPreviewBlock } from '../lib/cmsPostEntryPreview.js'
import { buildPostTypeFields, getPostPath, preparePostTypePage, setPostPath } from '../lib/cmsPostTypes.js'

const source = readFileSync(new URL('../components/cms/typedPosts.vue', import.meta.url), 'utf8')
const blockSource = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')
const declarations = source.slice(source.indexOf('const pageBlock ='), source.indexOf('const readHistoryItems ='))
const setupEditor = () => {
  const sessionPage = ref(preparePostTypePage({
    post: true,
    postType: { enabled: true },
    content: [],
    postContent: [{
      id: 'profile',
      useForCustomPost: true,
      templateVersion: 2,
      template: '<h1>{{ headline }}</h1><div>{{ richtext(biography) }}</div><p>{{ note }}</p>',
      schema: { headline: { type: 'text', label: 'Headline', value: '' }, biography: { type: 'richtext', label: 'Biography', value: '' }, note: { type: 'text', postField: 'person.note', value: '' } },
      values: {},
      dataSources: {},
    }],
  }, 'persons'))
  return runInNewContext(`${declarations}; ({ postBlockEditorAdapter, applyPostBlockFields })`, {
    sessionPage,
    fields: computed(() => buildPostTypeFields(sessionPage.value)),
    buildPostEntryPreviewBlock,
    getPostPath,
    setPostPath,
    edgeGlobal: { dupObject: value => JSON.parse(JSON.stringify(value)) },
  })
}

test('shared editor adapter hydrates semantic paths and previews detached edits', () => {
  const editor = setupEditor()
  const doc = { headline: 'Original', biography: '<p>Original biography</p>', person: { note: 'Original note' } }
  const adapter = editor.postBlockEditorAdapter('profile', doc)
  assert.equal(adapter.schema.headline.type, 'text')
  assert.equal(adapter.values['person.note'], 'Original note')
  adapter.values.headline = 'Typing a headline'
  adapter.values.biography = '<p>Updated biography</p>'
  adapter.values['person.note'] = 'Updated note'
  const preview = adapter.preview(adapter.values)
  assert.equal(preview.values.cmsPost[0].headline, 'Typing a headline')
  assert.equal(preview.values.cmsPost[0].biography, '<p>Updated biography</p>')
  assert.equal(preview.renderContext.person.note, 'Updated note')
  assert.equal(doc.headline, 'Original')
  assert.equal(doc.person.note, 'Original note')
})

test('discarding the shared editor draft leaves the entry unchanged', () => {
  const editor = setupEditor()
  const doc = { headline: 'Original', biography: '', person: { note: 'Original note' } }
  const adapter = editor.postBlockEditorAdapter('profile', doc)
  adapter.values['person.note'] = 'Discard this'
  adapter.preview(adapter.values)
  const reopened = editor.postBlockEditorAdapter('profile', doc)
  assert.equal(reopened.values['person.note'], 'Original note')
})

test('shared Save changes maps only declared values into the unsaved entry', () => {
  const editor = setupEditor()
  const doc = { headline: 'Original', biography: '', unrelated: 'Keep this', person: { note: 'Old', keep: 'Keep nested value' } }
  const adapter = editor.postBlockEditorAdapter('profile', doc)
  adapter.values.headline = ''
  adapter.values.biography = '<p>Save this</p>'
  adapter.values['person.note'] = 'New note'
  adapter.values.unrelated = 'Do not apply'
  assert.equal(adapter.preview(adapter.values).values.cmsPost[0].headline, 'Headline')
  editor.applyPostBlockFields('profile', { values: adapter.values, template: 'Do not copy', content: [] }, doc)
  assert.equal(doc.headline, '')
  assert.equal(doc.biography, '<p>Save this</p>')
  assert.equal(doc.person.note, 'New note')
  assert.equal(doc.person.keep, 'Keep nested value')
  assert.equal(doc.unrelated, 'Keep this')
  assert.equal(doc.template, undefined)
  assert.equal(doc.content, undefined)
  assert.doesNotMatch(declarations, /storeDoc|changeDoc|runFunction/)
})

test('custom posts reuse the actual page block editor instead of their own form or sheet', () => {
  assert.ok(source.includes('<edge-cms-block\n'))
  assert.ok(source.includes(':content-editor-adapter="postBlockEditorAdapter(id, slot.workingDoc)"'))
  assert.ok(source.includes('@update:model-value="value => applyPostBlockFields(id, value, slot.workingDoc)"'))
  assert.doesNotMatch(source, /<Sheet|<edge-cms-post-value-field|editingFields|fieldDraft|editFields/)
  assert.ok(blockSource.includes('schema: props.contentEditorAdapter.schema, values: props.contentEditorAdapter.values'))
  assert.match(blockSource, /if \(!props\.contentEditorAdapter\)\s+modelValue\.value\.blockUpdatedAt/)
  assert.ok(blockSource.includes(':render-context="fieldEditorRenderContext"'))
  assert.ok(blockSource.includes('meta: { ...(preview?.meta || {}), ...state.meta }'))
})
