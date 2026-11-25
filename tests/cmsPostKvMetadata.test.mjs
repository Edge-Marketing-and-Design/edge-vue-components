import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { buildPostKvMetadata, MAX_KV_METADATA_BYTES } = require('../../functions/helpers/cmsPostKvMetadata.js')

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const params = { orgId: 'org', siteId: 'site', postId: 'post-1' }

test('builds list metadata for a published post', () => {
  const metadata = buildPostKvMetadata({
    title: 'Title',
    blurb: 'Blurb',
    doc_created_at: 1790190337494,
    featuredImage: 'https://example.com/a.jpg',
    name: 'title',
    tags: ['Field Notes', 'Field Notes', ' '],
    legacyBlog: { sourceId: 'title' },
  }, params)

  assert.deepEqual(metadata, {
    title: 'Title',
    blurb: 'Blurb',
    doc_created_at: 1790190337494,
    featuredImage: 'https://example.com/a.jpg',
    name: 'title',
    type: 'post',
    event: { startAt: '', endAt: '', isPast: false, locationName: '' },
    tags: ['Field Notes'],
  })
})

test('carries hidePublishedDate only when it is true', () => {
  assert.equal(buildPostKvMetadata({ name: 'a', hidePublishedDate: true }, params).hidePublishedDate, true)
  assert.equal('hidePublishedDate' in buildPostKvMetadata({ name: 'a', hidePublishedDate: false }, params), false)
  assert.equal('hidePublishedDate' in buildPostKvMetadata({ name: 'a', hidePublishedDate: 'true' }, params), false)
  assert.equal('hidePublishedDate' in buildPostKvMetadata({ name: 'a' }, params), false)
})

test('drops tags before the flag when metadata exceeds the KV budget', () => {
  const tags = Array.from({ length: 80 }, (_, index) => `tag-number-${index}`)
  const metadata = buildPostKvMetadata({ name: 'a', title: 'T', hidePublishedDate: true, tags }, params)
  assert.equal(metadata.hidePublishedDate, true)
  assert.ok(metadata.tags.length < tags.length)
  const stored = { ...metadata, canonical: 'posts:org:site:post-1' }
  assert.ok(Buffer.byteLength(JSON.stringify(stored), 'utf8') <= MAX_KV_METADATA_BYTES)
})

test('onPostWritten uses the shared helper and the Functions copies stay identical', () => {
  const cmsSource = read('../../functions/cms.js')
  assert.equal(read('../functions/cms.js'), cmsSource)
  assert.equal(read('../functions/helpers/cmsPostKvMetadata.js'), read('../../functions/helpers/cmsPostKvMetadata.js'))
  assert.match(cmsSource, /makeMetadata: buildPostKvMetadata,/)
})

test('caps legacy blurbs without changing the source post', () => {
  const post = { title: 'Title', blurb: 'x'.repeat(2000) }
  const metadata = buildPostKvMetadata(post, params)
  assert.equal(metadata.blurb, 'x'.repeat(250))
  assert.equal(post.blurb.length, 2000)
  assert.equal(buildPostKvMetadata({ blurb: 'x'.repeat(250) }, params).blurb.length, 250)
})

test('shortens multibyte blurbs to fit the full metadata byte budget', () => {
  const post = { title: 'Title', blurb: '😀'.repeat(500), featuredImage: 'https://example.com/' + 'a'.repeat(300) }
  const metadata = buildPostKvMetadata(post, params)
  assert.ok(metadata.blurb.length < 250)
  assert.match(metadata.blurb, /^(?:😀)*$/u)
  assert.ok(Buffer.byteLength(JSON.stringify({ ...metadata, canonical: 'posts:org:site:post-1' }), 'utf8') <= MAX_KV_METADATA_BYTES)
})

test('custom projections cannot restore an uncapped blurb', () => {
  const metadata = buildPostKvMetadata({ postTypeId: 'stories', postTypeProjection: { fields: ['blurb'] }, blurb: 'x'.repeat(2000) }, params)
  assert.equal(metadata.blurb.length, 250)
})
