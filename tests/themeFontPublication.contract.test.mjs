import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cmsFunctionSource = await readFile(new URL('../../functions/cms.js', import.meta.url), 'utf8')
const edgeCmsFunctionSource = await readFile(new URL('../functions/cms.js', import.meta.url), 'utf8')
const kvMirrorSource = await readFile(new URL('../../functions/kv/kvMirror.js', import.meta.url), 'utf8')
const edgeKvMirrorSource = await readFile(new URL('../functions/kv/kvMirror.js', import.meta.url), 'utf8')
const kvMirrorFollowupSource = await readFile(new URL('../../functions/kv/kvMirrorFollowups.js', import.meta.url), 'utf8')
const edgeKvMirrorFollowupSource = await readFile(new URL('../functions/kv/kvMirrorFollowups.js', import.meta.url), 'utf8')
const fontUploadSource = await readFile(new URL('../components/cms/fontUpload.vue', import.meta.url), 'utf8')

test('theme output changes bump draft and published site versions after the KV write', () => {
  assert.equal(cmsFunctionSource, edgeCmsFunctionSource)
  assert.equal(kvMirrorSource, edgeKvMirrorSource)
  assert.equal(kvMirrorFollowupSource, edgeKvMirrorFollowupSource)
  assert.match(cmsFunctionSource, /const PUBLISHED_THEME_FIELDS = \['theme', 'headJSON', 'extraCSS'\]/)
  assert.match(kvMirrorFollowupSource, /collection\('published-site-settings'\)[\s\S]*?\.where\('theme', '==', themeId\)/)
  assert.match(kvMirrorFollowupSource, /version: Firestore\.FieldValue\.increment\(1\)/)
  assert.match(kvMirrorFollowupSource, /batch\.set\(publishedSite\.ref, versionUpdate, \{ merge: true \}\)/)
  assert.match(kvMirrorFollowupSource, /batch\.set\(orgRef\.collection\('sites'\)\.doc\(publishedSite\.id\), versionUpdate, \{ merge: true \}\)/)
  assert.match(cmsFunctionSource, /exports\.onThemeWritten = createKvMirrorHandler\([\s\S]*?makeAfterMirrorOperation:[\s\S]*?op: 'bumpPublishedSiteVersionsForTheme'/)
  assert.doesNotMatch(cmsFunctionSource, /exports\.bumpPublishedSiteVersionsOnThemeWritten/)
  assert.match(kvMirrorSource, /for \(const phase of phases\)[\s\S]*?await runKvMirrorFollowup\(afterOperation\)[\s\S]*?run: \(\) => runKvPayload\(versionOperation\)/)
})

test('font processing safely waits for R2 and preloads one regular face', () => {
  assert.match(fontUploadSource, /let settled = false[\s\S]*?queueMicrotask\(\(\) => unwatch\?\.\(\)\)/)
  assert.match(fontUploadSource, /styles\.find\(style => style\.weight === '400' && style\.style === 'normal'\) \|\| styles\[0\]/)
  assert.match(fontUploadSource, /rel: 'preload',[\s\S]*?as: 'font',[\s\S]*?crossorigin: 'anonymous'/)
  assert.match(fontUploadSource, /const contentTypeFromFormat/)
})
