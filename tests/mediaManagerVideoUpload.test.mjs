import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mediaManagerSource = await readFile(new URL('../components/cms/mediaManager.vue', import.meta.url), 'utf8')
const mediaCardSource = await readFile(new URL('../components/cms/mediaCard.vue', import.meta.url), 'utf8')
const autoFileUploadSource = await readFile(new URL('../components/autoFileUpload.vue', import.meta.url), 'utf8')
const mediaRouteSource = await readFile(new URL('../routes/cms/dashboard/media/index.vue', import.meta.url), 'utf8')
const siteSource = await readFile(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const edgeMediaFunctionSource = await readFile(new URL('../functions/edgeMedia.js', import.meta.url), 'utf8')

test('shared media manager opts full media surfaces into video uploads without changing image picker defaults', () => {
  assert.match(mediaManagerSource, /includeVideos:\s*\{[\s\S]*?default: false/)
  assert.match(mediaRouteSource, /<edge-cms-media-manager[\s\S]*?:include-files="true"[\s\S]*?:include-videos="true"/)
  assert.match(siteSource, /state\.viewMode === 'media'[\s\S]*?<edge-cms-media-manager[\s\S]*?:include-files="true"[\s\S]*?:include-videos="true"/)
})

test('video formats are accepted, classified, and filterable independently from files', () => {
  assert.match(mediaManagerSource, /const videoExtensions = \[[^\]]*'mp4'[^\]]*'mov'[^\]]*'webm'/)
  assert.match(mediaManagerSource, /const videoMimeTypes = \[[\s\S]*?'video\/mp4'[\s\S]*?'video\/quicktime'[\s\S]*?'video\/webm'/)
  assert.match(mediaManagerSource, /const videoAcceptTypes = \[\.\.\.videoMimeTypes, \.\.\.videoExtensions\.map\(extension => `\.\$\{extension\}`\)\]/)
  assert.match(mediaManagerSource, /const isVideoMediaItem = \(item\) => \{[\s\S]*?contentType\.startsWith\('video\/'\)[\s\S]*?videoExtensions\.includes\(ext\)/)
  assert.match(mediaManagerSource, /if \(isImageMediaItem\(item\) \|\| isVideoMediaItem\(item\)\)[\s\S]*?return false/)
  assert.match(mediaManagerSource, /videos: 'Videos Only'/)
  assert.match(mediaManagerSource, /activeMediaScope\.value === 'videos'[\s\S]*?new Set\(videoExtensions\)/)
  assert.match(mediaManagerSource, /videosEnabled\.value \? videoAcceptTypes : \[\]/)
})

test('shared uploader honors accepted extensions when a browser omits the MIME type', () => {
  assert.match(autoFileUploadSource, /const normalizedAcceptItems = computed/)
  assert.match(autoFileUploadSource, /if \(acceptItem\.startsWith\('\.'\)\)[\s\S]*?return extension === acceptItem/)
  assert.match(autoFileUploadSource, /if \(!isAcceptedFile\(file\)\)/)
  assert.doesNotMatch(autoFileUploadSource, /file\.type\.match\(acceptRegex\.value\)/)
})

test('video cards and detail view use Stream derivatives with an R2 playback fallback', () => {
  assert.match(mediaCardSource, /const isVideoItem = computed/)
  assert.match(mediaCardSource, /cloudflareVideoThumbnail/)
  assert.match(mediaCardSource, /if \(!isImageItem\.value\)[\s\S]*?r2URL/)
  assert.match(mediaCardSource, /v-else-if="isVideoItem"[\s\S]*?\{\{ fileTypeLabel \}\}/)
  assert.match(mediaManagerSource, /const workingDocVideoEmbedUrl = computed/)
  assert.match(mediaManagerSource, /getCloudflareVideoEmbedUrl\(state\.workingDoc\)/)
  assert.match(mediaManagerSource, /<iframe[\s\S]*?workingDocIsVideo && workingDocVideoEmbedUrl/)
  assert.match(mediaManagerSource, /<video[\s\S]*?workingDocIsVideo && workingDocVideoSourceUrl[\s\S]*?controls/)
})

test('existing shared upload backend sends video uploads through R2 and Cloudflare Stream', () => {
  assert.match(edgeMediaFunctionSource, /contentType\.startsWith\('video\/'\)/)
  assert.match(edgeMediaFunctionSource, /\/stream\/copy/)
  assert.match(edgeMediaFunctionSource, /cloudflareVideoId/)
  assert.match(edgeMediaFunctionSource, /cloudflareVideoPlayback/)
  assert.match(edgeMediaFunctionSource, /cloudflareVideoThumbnail/)
  assert.match(edgeMediaFunctionSource, /cloudflareVideoPreview/)
})
