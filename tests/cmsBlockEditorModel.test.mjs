import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const loadBlockEditorModel = () => {
  const source = readFileSync(new URL('../composables/useCmsBlockEditorModel.js', import.meta.url), 'utf8')
    .replaceAll('export const ', 'const ')
  // eslint-disable-next-line no-new-func
  return new Function(`${source}; return { orderCmsBlockEditorMeta, buildCmsBlockEditorDraftValues };`)()
}

const { orderCmsBlockEditorMeta, buildCmsBlockEditorDraftValues } = loadBlockEditorModel()

test('legacy block controls only include fields referenced by the current template', () => {
  const meta = {
    header: { type: 'text' },
    image: { type: 'image' },
  }

  const result = orderCmsBlockEditorMeta({
    meta,
    orderedFields: ['header'],
  })

  assert.deepEqual(result, [{ field: 'header', meta: meta.header }])
  assert.equal(meta.image.type, 'image')
})

test('v2 block controls include every current input and preserve template ordering', () => {
  const meta = {
    summary: { type: 'richtext' },
    header: { type: 'text' },
  }

  const result = orderCmsBlockEditorMeta({
    meta,
    orderedFields: ['header'],
    includeUnreferenced: true,
  })

  assert.deepEqual(result.map(entry => entry.field), ['header', 'summary'])
})

test('removed legacy tags and v2 inputs keep their saved instance values', () => {
  const result = buildCmsBlockEditorDraftValues({
    schemaDefaults: { header: 'Default header' },
    legacyValues: { legacyDefault: 'Legacy default' },
    blockValues: { header: 'Block header' },
    instanceValues: {
      header: 'Entered header',
      removedImage: 'https://example.com/entered-image.jpg',
    },
  })

  assert.deepEqual(result, {
    header: 'Entered header',
    legacyDefault: 'Legacy default',
    removedImage: 'https://example.com/entered-image.jpg',
  })
})
