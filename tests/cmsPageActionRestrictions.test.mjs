import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../components/cms/page.vue', import.meta.url), 'utf8')
const declaration = (name) => {
  const start = source.indexOf(`const ${name} =`)
  const end = source.indexOf('\nconst ', start + 1)
  assert.notEqual(start, -1, `${name} must exist`)
  assert.notEqual(end, -1, `${name} must have a following declaration`)
  return source.slice(start, end)
}

const createPage = (menus = {}, isTemplateSite = false) => {
  const events = []
  const props = { page: 'page-1', site: 'site-1', isTemplateSite }
  const siteDoc = { value: { menus } }
  const state = {
    renamePageValue: 'New name',
    renamePageDialogOpen: false,
    deletePageDialogOpen: false,
    renamePageSubmitting: false,
    deletePageSubmitting: false,
  }
  const names = [
    'currentMenuPageEntry', 'isCurrentPageRenameDisabled', 'isCurrentPageDeleteDisabled',
    'openRenamePageDialog', 'openDeletePageDialog', 'renameCurrentPageAction', 'deleteCurrentPage',
  ]
  const page = runInNewContext(`${names.map(declaration).join('\n')}\n;({ ${names.join(', ')} })`, {
    props,
    siteDoc,
    state,
    computed: getter => ({ get value() { return getter() } }),
    edgeGlobal: { dupObject: value => structuredClone(value) },
    currentPageRenameLabel: { value: 'Existing name' },
    pagesCollectionPath: { value: 'organizations/org-1/sites/site-1/pages' },
    pageEditorBasePath: { value: '/pages' },
    edgeFirebase: {
      changeDoc: async (...args) => { events.push(['changeDoc', ...args]) },
      removeDoc: async (...args) => { events.push(['removeDoc', ...args]) },
    },
    assertCmsActionSucceeded: () => {},
    notifySuccess: message => events.push(['success', message]),
    notifyError: message => events.push(['error', message]),
    console: { error: (...args) => events.push(['error', ...args]) },
    router: { push: async path => events.push(['navigate', path]) },
  })
  return { ...page, state, props, siteDoc, events }
}

test('theme-created page flags disable both actions from the page editor', async () => {
  const page = createPage({ 'Site Root': [{ item: 'page-1', disableRename: true, disableDelete: true }] })
  assert.equal(page.isCurrentPageRenameDisabled.value, true)
  assert.equal(page.isCurrentPageDeleteDisabled.value, true)
  page.openRenamePageDialog()
  page.openDeletePageDialog()
  assert.equal(page.state.renamePageDialogOpen, false)
  assert.equal(page.state.deletePageDialogOpen, false)

  await page.renameCurrentPageAction()
  await page.deleteCurrentPage()
  assert.deepEqual(page.events, [])
})

test('nested and Not In Menu page entries retain independent restrictions', () => {
  const page = createPage({
    'Site Root': [{ item: { folder: [{ item: 'page-1', disableRename: true }] } }],
    'Not In Menu': [{ item: 'page-2', disableDelete: true }],
  })
  assert.equal(page.isCurrentPageRenameDisabled.value, true)
  assert.equal(page.isCurrentPageDeleteDisabled.value, false)
  page.openDeletePageDialog()
  assert.equal(page.state.deletePageDialogOpen, true)

  page.props.page = 'page-2'
  assert.equal(page.isCurrentPageRenameDisabled.value, false)
  assert.equal(page.isCurrentPageDeleteDisabled.value, true)
  page.openRenamePageDialog()
  assert.equal(page.state.renamePageDialogOpen, true)
})

test('restrictions are rechecked if they change after a dialog opens', async () => {
  const page = createPage({ 'Site Root': [{ item: 'page-1' }] })
  page.openRenamePageDialog()
  page.openDeletePageDialog()
  assert.equal(page.state.renamePageDialogOpen, true)
  assert.equal(page.state.deletePageDialogOpen, true)

  page.siteDoc.value.menus['Site Root'][0].disableRename = true
  page.siteDoc.value.menus['Site Root'][0].disableDelete = true
  await page.renameCurrentPageAction()
  await page.deleteCurrentPage()
  assert.deepEqual(page.events, [])
})

test('unrestricted and orphaned pages can still open action dialogs', () => {
  for (const menus of [{}, { 'Site Root': [{ item: 'page-1', disableRename: false, disableDelete: false }] }]) {
    const page = createPage(menus)
    page.openRenamePageDialog()
    page.openDeletePageDialog()
    assert.equal(page.state.renamePageDialogOpen, true)
    assert.equal(page.state.deletePageDialogOpen, true)
  }
})

test('template editing keeps its existing rename and delete behavior', async () => {
  const page = createPage({ 'Site Root': [{ item: 'page-1', disableRename: true, disableDelete: true }] }, true)
  assert.equal(page.isCurrentPageRenameDisabled.value, false)
  assert.equal(page.isCurrentPageDeleteDisabled.value, false)
  await page.renameCurrentPageAction()
  await page.deleteCurrentPage()
  assert.deepEqual(page.events.map(event => event[0]), ['changeDoc', 'success', 'removeDoc', 'success', 'navigate'])
})

test('both menu items and confirmation buttons bind the page restrictions', () => {
  assert.match(source, /:disabled="isCurrentPageRenameDisabled \|\| slotProps\.unsavedChanges[^"\n]*"\s+@click="openRenamePageDialog"/)
  assert.match(source, /:disabled="isCurrentPageDeleteDisabled \|\| slotProps\.unsavedChanges[^"\n]*"\s+@click="openDeletePageDialog"/)
  assert.match(source, /type="submit" :disabled="isCurrentPageRenameDisabled \|\| state\.renamePageSubmitting"/)
  assert.match(source, /:disabled="isCurrentPageDeleteDisabled \|\| state\.deletePageSubmitting" @click="deleteCurrentPage"/)
})
