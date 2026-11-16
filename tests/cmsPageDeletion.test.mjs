import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)

const loadPageDeletionHelpers = () => {
  const source = readFileSync(new URL('../composables/useCmsPageDeletion.js', import.meta.url), 'utf8')
    .replaceAll('export const ', 'const ')
  // eslint-disable-next-line no-new-func
  return new Function(`${source}; return { removeCmsPageFromMenus, assertCmsActionSucceeded, removeCmsPageFromPublishedMenus };`)()
}

const { removeCmsPageFromMenus, assertCmsActionSucceeded, removeCmsPageFromPublishedMenus } = loadPageDeletionHelpers()
const serverDeletionHelpers = require('../../functions/helpers/cmsPageDeletion.js')
const pageSource = readFileSync(new URL('../components/cms/page.vue', import.meta.url), 'utf8')
const menuSource = readFileSync(new URL('../components/cms/menu.vue', import.meta.url), 'utf8')
const functionSource = readFileSync(new URL('../../functions/cms.js', import.meta.url), 'utf8')
const edgeFunctionSource = readFileSync(new URL('../functions/cms.js', import.meta.url), 'utf8')
const serverHelperSource = readFileSync(new URL('../../functions/helpers/cmsPageDeletion.js', import.meta.url), 'utf8')
const edgeServerHelperSource = readFileSync(new URL('../functions/helpers/cmsPageDeletion.js', import.meta.url), 'utf8')

test('removes every nested page reference without changing external links', () => {
  const menus = {
    'Site Root': [
      { name: 'target', item: 'page-1' },
      { name: 'external', item: { type: 'external', url: 'https://example.com' } },
      {
        name: 'folder',
        item: {
          folder: [
            { name: 'target-again', item: 'page-1' },
            { name: 'other', item: 'page-2' },
          ],
        },
      },
    ],
  }

  const result = removeCmsPageFromMenus(menus, 'page-1')

  assert.deepEqual(result, {
    'Site Root': [
      { name: 'external', item: { type: 'external', url: 'https://example.com' } },
      {
        name: 'folder',
        item: {
          folder: [{ name: 'other', item: 'page-2' }],
        },
      },
    ],
  })
  assert.equal(menus['Site Root'].length, 3)
})

test('can restore required root menu arrays while deleting a page', () => {
  const result = removeCmsPageFromMenus({}, 'page-1', { ensureRootMenus: true })

  assert.deepEqual(result, {
    'Site Root': [],
    'Not In Menu': [],
  })
})

test('rejects Firebase wrapper responses that report failure', () => {
  assert.throws(
    () => assertCmsActionSucceeded({ success: false, message: 'Permission denied' }, 'Fallback'),
    /Permission denied/,
  )
  assert.equal(assertCmsActionSucceeded({ success: true }).success, true)
})

test('published menu deletion preserves unrelated published-only menu entries', async () => {
  const writes = []
  const publishedSettings = {
    menus: {
      'Site Root': [
        { name: 'target', item: 'page-1' },
        { name: 'published-only', item: 'page-2' },
      ],
    },
  }
  const edgeFirebase = {
    changeDoc: async (...args) => {
      writes.push(args)
      return { success: true }
    },
  }

  const menus = await removeCmsPageFromPublishedMenus({
    edgeFirebase,
    organizationDocPath: 'organizations/org-1',
    siteId: 'site-1',
    pageId: 'page-1',
    publishedSettings,
  })

  assert.deepEqual(menus, {
    'Site Root': [{ name: 'published-only', item: 'page-2' }],
    'Not In Menu': [],
  })
  assert.deepEqual(writes, [[
    'organizations/org-1/published-site-settings',
    'site-1',
    { menus },
  ]])
  assert.equal(publishedSettings.menus['Site Root'].length, 2)
})

test('unpublished sites skip published menu cleanup', async () => {
  let changed = false
  const result = await removeCmsPageFromPublishedMenus({
    edgeFirebase: { changeDoc: async () => { changed = true } },
    organizationDocPath: 'organizations/org-1',
    siteId: 'site-1',
    pageId: 'page-1',
    publishedSettings: null,
  })

  assert.equal(result, null)
  assert.equal(changed, false)
})

test('server and browser menu deletion helpers preserve the same nested contract', () => {
  const menus = {
    'Site Root': [
      { name: 'target', item: 'page-1' },
      { name: 'external', item: { type: 'external', url: 'https://example.com' } },
      { name: 'folder', item: { folder: [{ name: 'nested-target', item: 'page-1' }, { name: 'keep', item: 'page-2' }] } },
    ],
  }

  assert.deepEqual(
    serverDeletionHelpers.removeCmsPageFromMenus(menus, 'page-1'),
    removeCmsPageFromMenus(menus, 'page-1'),
  )
  assert.deepEqual(
    serverDeletionHelpers.removeCmsPageFromMenus(null, 'page-1', { ensureRootMenus: true }),
    removeCmsPageFromMenus(null, 'page-1', { ensureRootMenus: true }),
  )
  assert.equal(serverHelperSource, edgeServerHelperSource)
})

test('both UI delete paths clean published menus before deleting page documents', () => {
  for (const [source, draftDeleteNeedle] of [
    [pageSource, 'removeDoc(pagesCollectionPath.value, props.page)'],
    [menuSource, '/pages`, normalizedPageId)'],
  ]) {
    const cleanupIndex = source.indexOf('await removeCmsPageFromPublishedMenus({')
    const publishedDeleteNeedle = 'removeDoc(`$' + '{edgeGlobal.edgeState.organizationDocPath}/sites/$' + '{props.site}/published`'
    const publishedDeleteIndex = source.indexOf(publishedDeleteNeedle, cleanupIndex)
    const draftDeleteIndex = source.indexOf(draftDeleteNeedle, cleanupIndex)
    assert.ok(cleanupIndex >= 0)
    assert.ok(publishedDeleteIndex > cleanupIndex)
    assert.ok(draftDeleteIndex > cleanupIndex)
  }
})

test('page deletion trigger atomically cleans the published menu and page', () => {
  assert.equal(functionSource, edgeFunctionSource)
  assert.match(functionSource, /require\('\.\/helpers\/cmsPageDeletion'\)/)
  const triggerSource = functionSource.slice(
    functionSource.indexOf('exports.onPageDeleted'),
    functionSource.indexOf('exports.onSiteDeleted'),
  )
  assert.match(triggerSource, /db\.runTransaction/)
  assert.match(triggerSource, /menus: removeCmsPageFromMenus\(publishedSiteSettingsSnap\.data\(\)\?\.menus, pageId, \{ ensureRootMenus: true \}\)/)
  assert.match(triggerSource, /transaction\.delete\(publishedRef\)/)
})
