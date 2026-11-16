import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../components/cms/menu.vue', import.meta.url), 'utf8')
const declaration = (name) => {
  const start = source.indexOf(`const ${name} =`)
  const end = source.indexOf('\nconst ', start + 1)
  assert.notEqual(start, -1)
  return source.slice(start, end).split('\nwatch(')[0]
}
const deferred = () => {
  let finish
  const promise = new Promise((resolve) => {
    finish = resolve
  })
  return { promise, resolve: finish }
}
const setup = ({ storeDoc, changeDoc, isTemplateSite = false, existing = false, blank = false } = {}) => {
  const calls = []
  const state = {
    addPageDialog: true,
    addPageSubmitting: false,
    pendingPageCreation: null,
    newPageName: ' Test Page ',
    menuName: 'Site Root',
    addMenu: false,
    addPageTab: existing ? 'existing' : 'templates',
    selectedTemplateId: 'template-1',
  }
  const modelValue = { value: { 'Site Root': [] } }
  const props = { site: 'site-1', isTemplateSite, rootModelValue: { nested: modelValue.value } }
  let nextId = 0
  const names = ['resetAddPageDialogState', 'addPageShow', 'addPageAction']
  const actions = runInNewContext(`${names.map(declaration).join('\n')}\n;({ ${names.join(', ')} })`, {
    state,
    modelValue,
    props,
    BLANK_TEMPLATE_ID: 'blank',
    crypto: { randomUUID: () => `page-${++nextId}` },
    canDuplicateExistingPages: { value: true },
    selectedExistingPage: { value: { source: 'existing' } },
    getTemplateDoc: () => blank ? null : { source: 'template' },
    buildPagePayloadFromTemplate: (doc, slug) => ({ ...doc, name: slug }),
    slugGenerator: () => 'test-page',
    edgeGlobal: {
      edgeState: { organizationDocPath: 'organizations/org-1' },
      dupObject: value => structuredClone(value),
    },
    assertCmsActionSucceeded: (result) => {
      if (!result?.success)
        throw new Error('Simulated wrapper failure')
    },
    edgeFirebase: {
      storeDoc: async (...args) => {
        calls.push(['store', ...args])
        return storeDoc ? storeDoc(...args) : { success: true }
      },
      changeDoc: async (...args) => {
        calls.push(['menu', ...args])
        return changeDoc ? changeDoc(...args) : { success: true }
      },
      toast: { error: message => calls.push(['error', message]) },
    },
  })
  return { ...actions, state, modelValue, props, calls }
}

test('double submit is blocked through both saves and success closes and resets the dialog', async () => {
  const pageSave = deferred()
  const menuSave = deferred()
  const page = setup({ storeDoc: () => pageSave.promise, changeDoc: () => menuSave.promise })
  const saving = page.addPageAction()
  assert.equal(page.state.addPageSubmitting, true)
  await page.addPageAction()
  assert.equal(page.calls.length, 1)
  page.addPageShow('Different menu')
  assert.equal(page.state.menuName, 'Site Root')
  pageSave.resolve({ success: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.state.addPageDialog, true)
  assert.equal(page.state.addPageSubmitting, true)
  await page.addPageAction()
  assert.deepEqual(page.calls.map(call => call[0]), ['store', 'menu'])
  assert.equal(page.calls[0][1], 'organizations/org-1/sites/site-1/pages')
  assert.equal(page.calls[1][1], 'organizations/org-1/sites')
  assert.deepEqual(page.calls[1][3].menus, structuredClone(page.props.rootModelValue))
  menuSave.resolve({ success: true })
  await saving
  assert.equal(page.modelValue.value['Site Root'].length, 1)
  assert.equal(page.modelValue.value['Site Root'][0].menuTitle, 'Test Page')
  assert.equal(page.state.addPageDialog, false)
  assert.equal(page.state.addPageSubmitting, false)
  assert.equal(page.state.pendingPageCreation, null)
  assert.equal(page.state.newPageName, '')
  await page.addPageAction()
  assert.equal(page.calls.length, 2)
})

for (const throws of [false, true]) {
  test(`page save ${throws ? 'throw' : 'unsuccessful result'} retains the same ID for retry`, async () => {
    let attempt = 0
    const page = setup({
      storeDoc: async () => {
        if (++attempt === 1) {
          if (throws)
            throw new Error('Private server details')
          return { success: false }
        }
        return { success: true }
      },
    })
    await page.addPageAction()
    assert.equal(page.state.addPageDialog, true)
    assert.equal(page.state.addPageSubmitting, false)
    assert.equal(page.modelValue.value['Site Root'].length, 0)
    assert.deepEqual(page.calls.map(call => call[0]), ['store', 'error'])
    assert.doesNotMatch(page.calls[1][1], /Private server details/)
    await page.addPageAction()
    const writes = page.calls.filter(call => call[0] === 'store')
    assert.equal(writes[0][2].docId, 'page-1')
    assert.equal(writes[0][2].docId, writes[1][2].docId)
    assert.equal(page.state.addPageDialog, false)
  })

  test(`menu save ${throws ? 'throw' : 'unsuccessful result'} retries without recreating the page or menu entry`, async () => {
    let attempt = 0
    const page = setup({
      changeDoc: async () => {
        if (++attempt === 1) {
          if (throws)
            throw new Error('Save failed')
          return { success: false }
        }
        return { success: true }
      },
    })
    await page.addPageAction()
    assert.equal(page.state.addPageDialog, true)
    assert.equal(page.state.addPageSubmitting, false)
    assert.equal(page.state.pendingPageCreation.saved, true)
    await page.addPageAction()
    assert.deepEqual(page.calls.map(call => call[0]), ['store', 'menu', 'error', 'menu'])
    assert.equal(page.modelValue.value['Site Root'].length, 1)
    assert.equal(page.state.addPageDialog, false)
  })
}

test('template-site and existing-page creation preserve their source and persistence behavior', async () => {
  for (const existing of [false, true]) {
    const page = setup({ isTemplateSite: true, existing })
    await page.addPageAction()
    assert.equal(page.calls[0][2].source, existing ? 'existing' : 'template')
    assert.deepEqual(page.calls.map(call => call[0]), ['store'])
    assert.equal(page.state.addPageDialog, false)
  }
})

test('blank names are rejected and folder creation still closes without page writes', async () => {
  const page = setup()
  page.state.newPageName = ' '
  await page.addPageAction()
  assert.equal(page.calls.length, 0)
  page.state.newPageName = 'Folder'
  page.state.addMenu = true
  await page.addPageAction()
  assert.equal(page.calls.length, 0)
  assert.equal(page.modelValue.value['Site Root'].length, 1)
  assert.equal(page.state.addPageDialog, false)
})

test('blank pages still save and receive one menu entry', async () => {
  const page = setup({ blank: true })
  await page.addPageAction()
  assert.equal(page.calls[0][2].source, undefined)
  assert.equal(page.calls[0][2].name, 'test-page')
  assert.equal(page.modelValue.value['Site Root'].length, 1)
  assert.equal(page.state.addPageDialog, false)
})

test('closing during a save cannot reopen another creation and cleans up after completion', async () => {
  const save = deferred()
  const page = setup({ storeDoc: () => save.promise })
  const saving = page.addPageAction()
  page.state.addPageDialog = false
  page.addPageShow('Another menu')
  assert.equal(page.state.addPageDialog, false)
  assert.equal(page.state.menuName, 'Site Root')
  save.resolve({ success: true })
  await saving
  assert.equal(page.modelValue.value['Site Root'][0].menuTitle, 'Test Page')
  assert.equal(page.state.pendingPageCreation, null)
  assert.equal(page.state.addPageSubmitting, false)
})

test('dialog binds loading, spinner, disabled inputs, cancel and submit states', () => {
  assert.match(source, /<fieldset :disabled="state\.addPageSubmitting \|\| !!state\.pendingPageCreation"/)
  assert.match(source, /:disabled="state\.addPageSubmitting" @click="state\.addPageDialog = false"/)
  assert.match(source, /:disabled="state\.addPageSubmitting \|\| !hasValidNewPageName" :aria-busy="state\.addPageSubmitting"/)
  assert.match(source, /<Loader2 v-if="state\.addPageSubmitting"[^>]*animate-spin/)
  assert.match(source, /state\.addPageSubmitting \? 'Creating…'/)
  assert.match(source, /if \(!open && !state\.addPageSubmitting\)/)
})
