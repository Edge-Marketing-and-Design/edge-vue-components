import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEDIA_IMAGE_OPTIMIZATION_WINDOW_MS,
  isMediaImageOptimizing,
} from '../composables/useMediaImageReadiness.js'

const now = 1_800_000_000_000
const r2URL = 'https://files.example.com/org-images/abc-logo.png'

test('a fresh PNG upload without versions is optimizing', () => {
  assert.equal(isMediaImageOptimizing({ contentType: 'image/png', fileName: 'logo.png', uploadTime: now - 5_000 }, now), true)
  assert.equal(isMediaImageOptimizing({ contentType: 'image/png', uploadTime: now - 5_000, r2URL, edgeMediaImageState: { status: 'processing' } }, now), true)
})

test('an image with Cloudflare Images versions is ready', () => {
  const variants = ['https://imagedelivery.net/acct/job/public']
  assert.equal(isMediaImageOptimizing({ contentType: 'image/png', uploadTime: now, cloudflareImageVariants: variants }, now), false)
  assert.equal(isMediaImageOptimizing({
    contentType: 'image/png',
    uploadTime: now,
    edgeMediaImageState: { status: 'complete', outputs: { image: { variants: { public: variants[0] } } } },
  }, now), false)
})

test('formats Edge Media does not process are never optimizing', () => {
  assert.equal(isMediaImageOptimizing({ contentType: 'image/svg+xml', fileName: 'topo.svg', uploadTime: now }, now), false)
  assert.equal(isMediaImageOptimizing({ contentType: 'image/avif', fileName: 'hero.avif', uploadTime: now }, now), false)
})

test('failed and finished jobs fall back to the original', () => {
  assert.equal(isMediaImageOptimizing({ contentType: 'image/png', uploadTime: now, edgeMediaImageState: { status: 'failed' } }, now), false)
  assert.equal(isMediaImageOptimizing({ contentType: 'image/png', uploadTime: now, edgeMediaImageState: { status: 'complete' } }, now), false)
})

test('old uploads without versions and stalled jobs are not blocked', () => {
  const old = now - MEDIA_IMAGE_OPTIMIZATION_WINDOW_MS - 1
  assert.equal(isMediaImageOptimizing({ contentType: 'image/jpeg', uploadTime: old, r2URL }, now), false)
  assert.equal(isMediaImageOptimizing({ contentType: 'image/jpeg', uploadTime: old, edgeMediaImageState: { status: 'queued' } }, now), false)
  assert.equal(isMediaImageOptimizing({ contentType: 'image/jpeg', r2URL }, now), false)
})

test('a recent retry on an old upload is optimizing again', () => {
  const old = now - MEDIA_IMAGE_OPTIMIZATION_WINDOW_MS * 4
  assert.equal(isMediaImageOptimizing({
    contentType: 'image/png',
    uploadTime: old,
    edgeMediaImageState: { status: 'retry_requested', retryRequestedAt: now - 1_000 },
  }, now), true)
})

test('the extension is used when the content type is missing', () => {
  assert.equal(isMediaImageOptimizing({ fileName: 'photo.webp', uploadTime: now }, now), true)
  assert.equal(isMediaImageOptimizing({ fileName: 'notes.pdf', uploadTime: now }, now), false)
})
