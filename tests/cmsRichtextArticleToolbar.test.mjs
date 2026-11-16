import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const postsPath = new URL('../components/cms/posts.vue', import.meta.url)
const blockPath = new URL('../components/cms/block.vue', import.meta.url)
const blockInputPath = new URL('../components/cms/blockInput.vue', import.meta.url)
const htmlPath = new URL('../components/shad/html.vue', import.meta.url)

const [postsSource, blockSource, blockInputSource, htmlSource] = await Promise.all([
  readFile(postsPath, 'utf8'),
  readFile(blockPath, 'utf8'),
  readFile(blockInputPath, 'utf8'),
  readFile(htmlPath, 'utf8'),
])

test('blog post block editors opt into article rich-text tools', () => {
  const articleToolOptIns = postsSource.match(/:allow-richtext-article-tools="true"/g) || []
  assert.equal(articleToolOptIns.length, 2)
  assert.equal((postsSource.match(/:allow-richtext-image-tools="true"/g) || []).length, 2)
})

test('shared CMS blocks keep article tools default-off and forward the opt-in to every block input', () => {
  assert.match(blockSource, /allowRichtextArticleTools:\s*\{\s*type: Boolean,\s*default: false,/)
  assert.match(blockSource, /const showRichtextArticleTools = computed\(\(\) => props\.allowRichtextArticleTools === true\)/)
  assert.equal((blockSource.match(/:show-richtext-article-tools="showRichtextArticleTools"/g) || []).length, 4)
})

test('article toolbar exposes semantic structure without H1, font, or color controls', () => {
  assert.match(blockInputSource, /showRichtextArticleTools:\s*\{\s*type: Boolean,\s*required: false,\s*default: false,/)
  assert.match(
    blockInputSource,
    /baseToggles\.push\('paragraph', 'heading2', 'heading3', 'blockquote', 'horizontalrule'\)/,
  )
  assert.doesNotMatch(blockInputSource, /baseToggles\.push\([^)]*heading1/)
  assert.doesNotMatch(blockInputSource, /baseToggles\.push\([^)]*(?:font|color)/i)
})

test('newly exposed semantic controls have accessible names', () => {
  for (const label of ['Heading 2', 'Heading 3', 'Paragraph', 'Blockquote']) {
    assert.match(htmlSource, new RegExp(`title="${label}"[\\s\\S]*?aria-label="${label}"`))
  }
  assert.match(htmlSource, /title="Horizontal Rule"[\s\S]*?aria-label="Horizontal rule"/)
})
