import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { organizationId, siteId, themeId, themeName } from './generate-package.mjs'
import { assertBlockBasics, assertManifest, assertRenderedCopy, defaults, renderBlock } from './validate-common.mjs'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const readJson = relativePath => JSON.parse(readFileSync(resolve(packageRoot, relativePath), 'utf8'))
const manifest = readJson('manifest.json')

// Keep this list in page order; the manifest must match it exactly.
const expectedIds = ['__BLOCK_PREFIX__-example-section']
const allowedTags = __TAGS__
const bannedPhrases = __BANNED__
// Sample records for any data source a block declares, keyed by source name.
const sampleSources = {}

assertManifest(manifest, expectedIds, { organizationId, siteId, themeId, themeName })
assert.deepEqual(readdirSync(resolve(packageRoot, 'blocks')).sort(), expectedIds.map(id => `${id}.json`).sort(), 'blocks/ must contain exactly the generated files')
assert.equal(existsSync(resolve(packageRoot, 'pages')), false, 'packages do not carry page JSON')
for (const media of manifest.media || []) assert.ok(existsSync(resolve(packageRoot, media.file)), `missing ${media.file}`)

for (const entry of manifest.blocks) {
  const block = readJson(entry.file)
  assertBlockBasics(block, entry.file, { themeId, allowedTags })
  const rendered = await renderBlock(block, { sources: sampleSources })
  assertRenderedCopy(rendered, entry.file, { bannedPhrases })
}

// --- Package-specific assertions: what a reviewer would otherwise catch. ----
const example = readJson('blocks/__BLOCK_PREFIX__-example-section.json')
assert.equal(example.schema.cards.value.length, 3)
const exampleHtml = await renderBlock(example)
assert.equal((exampleHtml.match(/<article/g) || []).length, 3)

console.log(`Validated ${expectedIds.length} block(s) in __PACKAGE__.`)
