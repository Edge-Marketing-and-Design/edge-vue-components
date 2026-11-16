import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../components/cms/posts.vue', import.meta.url), 'utf8')

const sourceBetween = (start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Missing post editor source: ${start}`)
  return source.slice(from, to)
}

const postDocComparableSource = sourceBetween('const postDocComparable =', 'const eventEndAtMs =')
const hasPublishDiffSource = sourceBetween('const hasPublishDiff =', 'const getPublishState =')

const createPublishDiff = (libraryContent) => {
  const publishedPosts = { value: {} }
  const edgeFirebase = { data: { drafts: {} } }
  const collectionKey = { value: 'drafts' }
  const stableSerialize = value => JSON.stringify(value)
  const normalizePostType = value => value === 'event' ? 'event' : 'post'
  const eventComparable = value => value || {}
  const resolveSyncedPostDoc = doc => ({
    ...doc,
    content: doc.content.map(block => block.blockId
      ? { ...block, content: libraryContent }
      : block),
  })
  const hasPublishDiff = runInNewContext(
    `${postDocComparableSource}\n${hasPublishDiffSource}\nhasPublishDiff`,
    { publishedPosts, edgeFirebase, collectionKey, stableSerialize, normalizePostType, eventComparable, resolveSyncedPostDoc },
  )

  return { hasPublishDiff, publishedPosts, edgeFirebase }
}

test('published post matches the resolved draft that Publish Now writes', () => {
  const { hasPublishDiff, publishedPosts, edgeFirebase } = createPublishDiff('library version 2')
  const draft = {
    docId: 'post-1',
    name: 'post-1',
    title: 'A post',
    blurb: 'Preview',
    content: [{ id: 'block-1', blockId: 'library-block', content: 'library version 1' }],
  }
  edgeFirebase.data.drafts['post-1'] = draft
  publishedPosts.value['post-1'] = {
    ...draft,
    content: [{ ...draft.content[0], content: 'library version 2' }],
  }

  assert.equal(hasPublishDiff('post-1'), false)
  assert.equal(hasPublishDiff('post-1', { ...draft, blurb: 'Edited preview' }), true)
})

test('the two manual publish actions omit both schedule fields', () => {
  const publishActions = sourceBetween('const publishPost =', 'const schedulePostPublish =')
  assert.equal((publishActions.match(/delete publishedPost\.publishAt\n/g) || []).length, 2)
  assert.equal((publishActions.match(/delete publishedPost\.publishAtTimezone\n/g) || []).length, 2)
})
