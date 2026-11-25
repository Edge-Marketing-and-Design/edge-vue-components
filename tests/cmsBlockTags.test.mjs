import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  NOT_IN_LIST_FILTER_VALUE,
  addBlockTag,
  blockTagNameProblem,
  blockTagUsage,
  editorTagOptions,
  hasOffListBlockTag,
  libraryTagOptions,
  moveBlockTag,
  offListBlockTags,
  organizationBlockTags,
  parseBlockRetagInput,
  pickerTagOptions,
  planBlockRetag,
  removeBlockTag,
  renameBlockTag,
} from '../lib/cmsBlockTags.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const names = options => options.map(option => option.name)

const LIST = ['Navigation', 'Hero', 'Content', 'Cards & Grids', 'Quick Picks']
const blocks = {
  a: { tags: ['Hero', 'Quick Picks'] },
  b: { tags: ['clearwater-main', 'Content Sections'] },
  c: { tags: ['Content'] },
  d: { tags: [] },
  e: {},
}

test('the list comes from cmsBlockTags on the organization document', () => {
  assert.deepEqual(organizationBlockTags({ name: 'Org', cmsBlockTags: [' Hero', 'Hero', 'Content'] }), ['Hero', 'Content'])
  assert.deepEqual(organizationBlockTags({ name: 'Org' }), [])
  assert.deepEqual(organizationBlockTags(undefined), [])
})

test('Block Editor options: the list in order, plus the block\'s own off-list tags; no list keeps today\'s options', () => {
  assert.deepEqual(names(editorTagOptions(LIST, blocks, ['Hero'])), LIST)
  assert.deepEqual(names(editorTagOptions(LIST, blocks, ['Hero', 'Hero Sections'])), [...LIST, 'Hero Sections'])
  assert.deepEqual(offListBlockTags(['Hero', 'Hero Sections', 'Hero Sections'], LIST), ['Hero Sections'])
  assert.deepEqual(offListBlockTags(['anything'], []), [], 'no list, nothing is off-list')
  assert.deepEqual(names(editorTagOptions([], blocks, [])), ['Quick Picks', 'clearwater-main', 'Content', 'Content Sections', 'Hero'])
})

test('picker options: Quick Picks first; with a list, listed tags in use, in list order', () => {
  assert.deepEqual(names(pickerTagOptions(LIST, blocks)), ['Quick Picks', 'Hero', 'Content'], 'Navigation and Cards & Grids are unused; off-list tags are not offered')
  assert.deepEqual(names(pickerTagOptions(LIST, {})), ['Quick Picks'], 'the default filter always exists')
  assert.deepEqual(names(pickerTagOptions([], blocks)), ['Quick Picks', 'clearwater-main', 'Content', 'Content Sections', 'Hero'])
})

test('library options: the list in order and "Not in list" while blocks carry other tags', () => {
  assert.deepEqual(names(libraryTagOptions(LIST, blocks)), [...LIST, NOT_IN_LIST_FILTER_VALUE])
  assert.deepEqual(names(libraryTagOptions(LIST, { a: blocks.a, c: blocks.c })), LIST, 'nothing off-list, no extra option')
  assert.deepEqual(names(libraryTagOptions([], blocks)), ['clearwater-main', 'Content', 'Content Sections', 'Hero', 'Quick Picks'])
  assert.equal(hasOffListBlockTag(blocks.b, LIST), true)
  assert.equal(hasOffListBlockTag(blocks.a, LIST), false)
  assert.equal(hasOffListBlockTag(blocks.b, []), false)
  assert.equal(blockTagUsage(blocks, 'Hero'), 1)
  assert.equal(blockTagUsage(blocks, 'Footer'), 0)
})

test('list edits: add, rename, remove and reorder, with name checks', () => {
  assert.deepEqual(addBlockTag(['Hero'], ' Footer '), ['Hero', 'Footer'])
  assert.deepEqual(renameBlockTag(LIST, 'Content', 'Copy'), ['Navigation', 'Hero', 'Copy', 'Cards & Grids', 'Quick Picks'])
  assert.deepEqual(removeBlockTag(LIST, 'Hero'), ['Navigation', 'Content', 'Cards & Grids', 'Quick Picks'])
  assert.deepEqual(moveBlockTag(LIST, 'Hero', -1), ['Hero', 'Navigation', 'Content', 'Cards & Grids', 'Quick Picks'])
  assert.deepEqual(moveBlockTag(LIST, 'Navigation', -1), LIST, 'the first tag stays first')
  assert.deepEqual(moveBlockTag(LIST, 'Quick Picks', 1), LIST, 'the last tag stays last')
  assert.equal(blockTagNameProblem('  ', LIST), 'Enter a tag name.')
  assert.equal(blockTagNameProblem('hero', LIST), '"hero" is already in the list.', 'case-insensitive duplicates')
  assert.equal(blockTagNameProblem('Hero', LIST, { except: 'Hero' }), '', 'renaming a tag to itself')
  assert.equal(blockTagNameProblem('x'.repeat(41), LIST), 'Keep tag names to 40 characters.')
  assert.equal(blockTagNameProblem('Footer', LIST), '')
})

test('the Block Editor, picker and library read the organization list', async () => {
  const editor = await read('../components/cms/blockEditor.vue')
  assert.match(editor, /const blockTagList = useCmsBlockTagList\(\)/)
  assert.match(editor, /:items="blockTagOptions\(slotProps\.workingDoc\.tags\)"/)
  assert.match(editor, /:allow-additions="!blockTagList\.length"/, 'no new tags while a list exists')
  assert.match(editor, /title: `\$\{item\.name\} \(not in the list\)`/, 'off-list tags are marked')

  const picker = await read('../components/cms/blockPicker.vue')
  assert.match(picker, /const getTagsFromBlocks = computed\(\(\) => pickerTagOptions\(blockTagList\.value, blocks\.value\)\)/)
  assert.equal([...picker.matchAll(/selectedTags: \['Quick Picks'\]/g)].length, 2, 'the picker still opens on Quick Picks')

  const manager = await read('../components/cms/blocksManager.vue')
  assert.match(manager, /libraryTagOptions\(blockTagList\.value, blocks\)/)
  assert.match(manager, /checkImportedBlock\(rawDoc, \{\s*knownThemeIds: getOrgThemeIds\(\),\s*blockTagList: blockTagList\.value,/, 'import checks the list')
  assert.match(manager, /<edge-cms-block-tag-list-dialog v-if="canEditBlockTagList"/)
  assert.match(manager, /const canEditBlockTagList = computed\(\(\) => edgeGlobal\.isAdminGlobal\(edgeFirebase\)\.value\)/, 'organization admins only (UI, not a rule)')
})

test('the tag list editor saves cmsBlockTags on the organization and never edits blocks', async () => {
  const dialog = await read('../components/cms/blockTagListDialog.vue')
  assert.match(dialog, /edgeFirebase\.changeDoc\('organizations', orgId, \{ cmsBlockTags: state\.list \}\)/)
  assert.doesNotMatch(dialog, /storeDoc|\/blocks/, 'no block writes')
  for (const text of ['No list: blocks can carry any tag', 'which won\'t be in the list', 'their tags stay as they are', 'You do not have permission'])
    assert.ok(dialog.includes(text), text)
  assert.match(dialog, /aria-live="polite"/)
  const tag = ['$', '{tag}'].join('')
  for (const label of [`Move ${tag} up`, `Move ${tag} down`, `Rename ${tag}`, `Remove ${tag}`])
    assert.ok(dialog.includes(`:aria-label="\`${label}\`"`), label)
})

test('the block package validator applies the same tag rules as the Hub', async () => {
  const { assertBlockBasics } = await import('../skills/edge-block-package/scripts/validate-common.mjs')
  const template = '<section>{{ heading }}</section>'
  const block = tags => ({
    docId: 'hero',
    name: 'Hero',
    content: template,
    templateVersion: 2,
    template,
    schema: { heading: { type: 'text', label: 'Heading', value: 'Hi' } },
    dataSources: {},
    values: {},
    Instructions: 'i',
    aiInstructions: 'a',
    tags,
    themes: ['theme'],
    type: ['Page'],
    previewType: 'dark',
    synced: false,
    version: 1,
  })
  const check = tags => () => assertBlockBasics(block(tags), 'blocks/hero.json', { themeId: 'theme', allowedTags: LIST })
  check(['Hero'])()
  check(['Hero', 'Content', 'Quick Picks'])()
  assert.throws(check([]), /one or two content tags \(Quick Picks not counted\); it has 0/)
  assert.throws(check(['Quick Picks']), /it has 0/)
  assert.throws(check(['Hero', 'Content', 'Navigation']), /it has 3/)
  assert.throws(check(['hero']), /tag "hero" is not in the project tag set/)
})

test('retag input: the mapping table or JSON', async () => {
  const table = [
    '| Block | ID | Current tags | Proposed tags | Note |',
    '|---|---|---|---|---|',
    '| Agent Blog | `agent-blog` | Blog, Article, Quick Picks | **Article, Quick Picks** |  |',
    '| Footer CTA | `footer-cta` | expedition | **Footer, Call to Action** | note, with comma |',
  ].join('\n')
  assert.deepEqual(parseBlockRetagInput(table), { mapping: { 'agent-blog': ['Article', 'Quick Picks'], 'footer-cta': ['Footer', 'Call to Action'] }, problems: [] })
  assert.deepEqual(parseBlockRetagInput('{ "a": ["Hero", " Hero "] }'), { mapping: { a: ['Hero'] }, problems: [] })
  assert.match(parseBlockRetagInput('{ "a": "Hero" }').problems[0], /tags must be an array/)
  assert.match(parseBlockRetagInput('{ nope').problems[0], /doesn't parse/)
  assert.match(parseBlockRetagInput('').problems[0], /Paste a mapping/)
  assert.match(parseBlockRetagInput('just text').problems[0], /No rows found/)
  assert.match(parseBlockRetagInput(`${table}\n${table.split('\n')[2]}`).problems[0], /agent-blog appears more than once/)

})

test('retag plan: changes, already tagged, missing and invalid rows', () => {
  const library = {
    hero: { name: 'Hero', tags: ['hero', 'clearwater-main'] },
    grid: { name: 'Grid', tags: ['Cards & Grids'] },
    footer: { name: 'Footer', tags: [] },
  }
  const plan = planBlockRetag(library, { hero: ['Hero', 'Quick Picks'], grid: ['Cards & Grids'], gone: ['Hero'], footer: ['Footer', 'Map', 'Media'] }, LIST)
  assert.deepEqual(plan.changes, [{ blockId: 'hero', name: 'Hero', before: ['hero', 'clearwater-main'], after: ['Hero', 'Quick Picks'] }])
  assert.deepEqual(plan.unchanged, ['grid'])
  assert.deepEqual(plan.missing, ['gone'])
  assert.deepEqual(plan.invalid.map(row => row.blockId), ['footer'], 'unlisted tags and three content tags are refused')
  assert.equal(plan.invalid[0].problems.length, 4, 'Footer, Map and Media are off this list, plus the count')
  assert.match(planBlockRetag(library, { hero: ['Hero'] }, []).invalid[0].problems[0], /no block tag list/)
})

test('the retag dialog writes only tags, skips blocks changed since the preview, and needs a clean plan', async () => {
  const dialog = await read('../components/cms/blockRetagDialog.vue')
  assert.match(dialog, /edgeFirebase\.changeDoc\(blocksPath, change\.blockId, \{ tags: change\.after \}\)/)
  assert.doesNotMatch(dialog, /storeDoc|saveBlockDraft|runFunction/, 'no definition, draft or release writes')
  assert.match(dialog, /its tags changed since the preview/)
  assert.match(dialog, /!state\.plan\.invalid\.length && state\.plan\.changes\.length > 0/)
  const manager = await read('../components/cms/blocksManager.vue')
  assert.match(manager, /<edge-cms-block-retag-dialog v-if="canEditBlockTagList"/)
})
