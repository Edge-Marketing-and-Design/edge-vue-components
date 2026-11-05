import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive, ref } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { buildPostEntryPreviewBlock } from '../lib/cmsPostEntryPreview.js'
import { buildPostTypeFields, getPostPath, preparePostTypePage, setPostPath } from '../lib/cmsPostTypes.js'

const source = readFileSync(new URL('../components/cms/typedPosts.vue', import.meta.url), 'utf8')
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
      template: '<h1>{{ headline }}</h1><div>{{ richtext(biography) }}</div>',
      schema: { headline: { type: 'text', label: 'Headline', value: '' }, biography: { type: 'richtext', label: 'Biography', value: '' } },
      values: {},
      dataSources: {},
    }],
  }, 'persons'))
  const fields = computed(() => buildPostTypeFields(sessionPage.value))
  const editingFields = ref('')
  const fieldDraft = ref({})
  return runInNewContext(`${declarations}; ({ editFields, applyFields, closeFields, editingFields, fieldDraft, fieldEditorPreviewBlock })`, {
    sessionPage,
    fields,
    editingFields,
    fieldDraft,
    computed,
    buildPostEntryPreviewBlock,
    getPostPath,
    setPostPath,
    edgeGlobal: { dupObject: value => JSON.parse(JSON.stringify(value)) },
  })
}

test('live preview follows the detached field draft before Apply', () => {
  const editor = setupEditor()
  const doc = reactive({ headline: 'Original', biography: '<p>Original biography</p>' })
  assert.equal(editor.fieldEditorPreviewBlock.value, null)
  editor.editFields('profile', doc)
  setPostPath(editor.fieldDraft.value, 'headline', 'Typing a headline')
  setPostPath(editor.fieldDraft.value, 'biography', '<p>Updated biography</p>')
  const preview = editor.fieldEditorPreviewBlock.value.values.cmsPost[0]
  assert.equal(preview.headline, 'Typing a headline')
  assert.equal(preview.biography, '<p>Updated biography</p>')
  assert.equal(doc.headline, 'Original')
  assert.equal(doc.biography, '<p>Original biography</p>')
})

test('Cancel discards draft edits and reopening starts from the working entry', () => {
  const editor = setupEditor()
  const doc = { headline: 'Original', biography: '<p>Original</p>' }
  editor.editFields('profile', doc)
  editor.fieldDraft.value.headline = 'Discard this'
  editor.closeFields()
  assert.equal(editor.editingFields.value, '')
  assert.equal(editor.fieldEditorPreviewBlock.value, null)
  assert.equal(Object.keys(editor.fieldDraft.value).length, 0)
  assert.equal(doc.headline, 'Original')
  editor.editFields('profile', doc)
  assert.equal(editor.fieldDraft.value.headline, 'Original')
})

test('Apply changes only the selected block fields without copying preview placeholders', () => {
  const editor = setupEditor()
  const doc = { headline: 'Original', biography: '<p>Original</p>', unrelated: 'Keep this' }
  editor.editFields('profile', doc)
  editor.fieldDraft.value.headline = ''
  editor.fieldDraft.value.biography = '<p>Apply this</p>'
  editor.fieldDraft.value.unrelated = 'Do not apply'
  assert.equal(editor.fieldEditorPreviewBlock.value.values.cmsPost[0].headline, 'Headline')
  editor.applyFields(doc)
  assert.equal(doc.headline, '')
  assert.equal(doc.biography, '<p>Apply this</p>')
  assert.equal(doc.unrelated, 'Keep this')
  assert.equal(editor.fieldEditorPreviewBlock.value, null)
  assert.equal(Object.keys(editor.fieldDraft.value).length, 0)
  assert.doesNotMatch(declarations, /storeDoc|changeDoc|runFunction/)
})

test('content editor is full-screen with fields before the live preview and explicit Cancel', () => {
  const { descriptor } = parse(source)
  const walk = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => walk(child, predicate)).find(Boolean)
  const sheet = walk(descriptor.template.ast, node => node.tag === 'Sheet' && node.props?.some(prop => prop.name === 'bind' && prop.arg?.content === 'open' && prop.exp?.content === '!!editingFields'))
  assert.ok(sheet)
  const content = walk(sheet, node => node.tag === 'edge-cms-block-sheet-content')
  assert.match(content.props.find(prop => prop.name === 'class').value.content, /w-full max-w-none/)
  assert.match(content.props.find(prop => prop.name === 'class').value.content, /overflow-hidden/)
  const fields = walk(sheet, node => node.props?.some(prop => prop.name === 'aria-label' && prop.value?.content === 'Content fields'))
  const preview = walk(sheet, node => node.props?.some(prop => prop.name === 'aria-label' && prop.value?.content === 'Live block preview'))
  assert.ok(fields.loc.start.offset < preview.loc.start.offset, 'Fields are left of the preview on desktop')
  const renderer = walk(preview, node => node.tag === 'edge-cms-block-api')
  assert.ok(renderer.props.some(prop => prop.name === 'bind' && prop.exp?.content === 'fieldEditorPreviewBlock'))
  assert.ok(renderer.props.some(prop => prop.name === 'bind' && prop.arg?.content === 'render-context' && prop.exp?.content === 'fieldDraft'))
  assert.ok(renderer.props.some(prop => prop.name === 'bind' && prop.arg?.content === 'key' && prop.exp?.content === 'editingFields'), 'Do not remount the iframe for every keystroke')
  assert.match(source, /lg:grid-cols-\[minmax\(280px,0\.8fr\)_minmax\(0,1\.6fr\)\]/)
  assert.match(content.loc.source, /@click="closeFields"/)
  assert.match(content.loc.source, /@click="applyFields\(slot\.workingDoc\)"/)
})
