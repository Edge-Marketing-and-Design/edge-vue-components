import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  collectCmsPostStructureBlockIds,
  filterCmsPostContentToStructure,
  insertCmsPostBlockReference,
  normalizeCmsPostStructure,
  removeCmsPostBlockReferences,
} from '../lib/cmsPostStructure.js'

const postsSource = await readFile(new URL('../components/cms/posts.vue', import.meta.url), 'utf8')

const makeIdFactory = () => {
  let nextId = 0
  return () => `generated-${++nextId}`
}

test('normalization preserves multi-column rows, spans, settings, and block positions', () => {
  const structure = [{
    id: 'row-sidebar',
    width: 'max-w-screen-xl',
    gap: '8',
    verticalAlign: 'center',
    background: 'surface-muted',
    mobileStack: 'reverse',
    customRowSetting: 'keep-me',
    columns: [
      {
        id: 'column-main',
        span: 4,
        mobileOrder: 1,
        customColumnSetting: 'main',
        blocks: ['hero', 'article'],
      },
      {
        id: 'column-sidebar',
        span: 2,
        mobileOrder: 0,
        customColumnSetting: 'sidebar',
        blocks: ['contact'],
      },
    ],
  }]

  const normalized = normalizeCmsPostStructure({
    structure,
    contentIds: ['hero', 'article', 'contact'],
    createId: makeIdFactory(),
  })

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].columns.length, 2)
  assert.deepEqual(normalized[0].columns.map(column => column.span), [4, 2])
  assert.deepEqual(normalized[0].columns.map(column => column.blocks), [
    ['hero', 'article'],
    ['contact'],
  ])
  assert.equal(normalized[0].width, 'max-w-screen-xl')
  assert.equal(normalized[0].gap, '8')
  assert.equal(normalized[0].verticalAlign, 'center')
  assert.equal(normalized[0].background, 'surface-muted')
  assert.equal(normalized[0].mobileStack, 'reverse')
  assert.equal(normalized[0].customRowSetting, 'keep-me')
  assert.equal(normalized[0].columns[1].customColumnSetting, 'sidebar')
  assert.deepEqual(structure[0].columns[1].blocks, ['contact'])
})

test('normalization filters missing references and appends orphaned blocks without collapsing columns', () => {
  const normalized = normalizeCmsPostStructure({
    structure: [{
      id: 'row-one',
      columns: [
        { id: 'column-left', span: 3, blocks: ['left', 'missing'] },
        { id: 'column-right', span: 3, blocks: ['right'] },
      ],
    }],
    contentIds: ['left', 'right', 'orphan'],
    createId: makeIdFactory(),
  })

  assert.equal(normalized[0].columns.length, 2)
  assert.deepEqual(normalized[0].columns[0].blocks, ['left', 'orphan'])
  assert.deepEqual(normalized[0].columns[1].blocks, ['right'])
})

test('legacy content without structure receives one full-width row', () => {
  const normalized = normalizeCmsPostStructure({
    structure: null,
    contentIds: ['legacy-one', 'legacy-two'],
    createId: makeIdFactory(),
  })

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].columns.length, 1)
  assert.equal(normalized[0].columns[0].span, 12)
  assert.deepEqual(normalized[0].columns[0].blocks, ['legacy-one', 'legacy-two'])
})

test('cleanup and removal traverse every column', () => {
  const structure = [{
    columns: [
      { blocks: ['main'] },
      { blocks: ['sidebar', 'shared'] },
    ],
  }]
  const content = [
    { id: 'main' },
    { id: 'sidebar' },
    { id: 'shared' },
    { id: 'unused' },
  ]

  assert.deepEqual([...collectCmsPostStructureBlockIds(structure)], ['main', 'sidebar', 'shared'])
  assert.deepEqual(filterCmsPostContentToStructure(content, structure).map(block => block.id), ['main', 'sidebar', 'shared'])

  removeCmsPostBlockReferences(structure, 'shared')
  assert.deepEqual(structure[0].columns[0].blocks, ['main'])
  assert.deepEqual(structure[0].columns[1].blocks, ['sidebar'])
})

test('block insertion targets the requested column and position', () => {
  const structure = [{
    columns: [
      { blocks: ['main'] },
      { blocks: ['contact'] },
    ],
  }]

  assert.equal(insertCmsPostBlockReference(structure, 0, 1, 0, 'sidebar-heading'), true)
  assert.deepEqual(structure[0].columns[0].blocks, ['main'])
  assert.deepEqual(structure[0].columns[1].blocks, ['sidebar-heading', 'contact'])
  assert.equal(insertCmsPostBlockReference(structure, 0, 3, 0, 'missing-column'), false)
})

test('both Post editor surfaces address and render every column', () => {
  assert.doesNotMatch(postsSource, /row\.columns\[0\]/)
  assert.doesNotMatch(postsSource, /row\?\.columns\?\.\[0\]/)
  assert.match(postsSource, /const addPostBlockToRow = \(workingDoc, rowIndex, columnIndex, insertIndex, block\)/)
  assert.equal((postsSource.match(/v-for="\(column, columnIndex\) in row\.columns"/g) || []).length, 3)
  assert.equal((postsSource.match(/v-model="column\.blocks"/g) || []).length, 2)
  assert.equal((postsSource.match(/addPostBlockToRow\(slotProps\.workingDoc, rowIndex, columnIndex,/g) || []).length, 6)
})

test('Post template previews use responsive equal-column and explicit-span layouts', () => {
  assert.match(postsSource, /const hasPostPreviewSpans = row => \(row\?\.columns \|\| \[\]\)\.some\(hasExplicitPostPreviewSpan\)/)
  assert.match(postsSource, /return 'grid grid-cols-1 sm:grid-cols-6 gap-4'/)
  assert.match(postsSource, /return \{ gridColumn: `span \$\{safeSpan\} \/ span \$\{safeSpan\}` \}/)
  assert.match(postsSource, /4: 'col-span-1 sm:col-span-4'/)
})
