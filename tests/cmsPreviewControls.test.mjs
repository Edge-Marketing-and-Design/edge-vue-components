import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const htmlSource = readFileSync(new URL('../components/cms/htmlContent.vue', import.meta.url), 'utf8')
const navHelper = htmlSource.slice(htmlSource.indexOf('function initCmsNavHelpers('), htmlSource.indexOf('\nlet helperRoot = null'))
  .replaceAll('import.meta.client', 'true')

class PreviewElement extends EventTarget {
  attrs = new Map()
  tokens = new Set()
  listeners = new Map()
  parentElement = null
  scrollTop = 0
  classList = {
    contains: key => this.tokens.has(key),
    add: (...keys) => keys.forEach(key => this.tokens.add(key)),
    remove: (...keys) => keys.forEach(key => this.tokens.delete(key)),
    toggle: (key, force) => {
      const on = force ?? !this.tokens.has(key)
      on ? this.tokens.add(key) : this.tokens.delete(key)
      return on
    },
  }

  addEventListener(type, handler, options) {
    if (!this.listeners.has(type))
      this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
    super.addEventListener(type, handler, options)
  }

  removeEventListener(type, handler, options) {
    this.listeners.get(type)?.delete(handler)
    super.removeEventListener(type, handler, options)
  }

  getAttribute(key) { return this.attrs.get(key) ?? null }
  setAttribute(key, value) { this.attrs.set(key, value) }
  querySelector() { return null }
  closest() { return null }
}

const createNavFixture = () => {
  const root = new PreviewElement()
  const toggle = new PreviewElement()
  const close = new PreviewElement()
  const overlay = new PreviewElement()
  const link = new PreviewElement()
  root.querySelector = selector => selector.startsWith('.cms-nav-overlay,') ? overlay : null
  root.querySelectorAll = (selector) => {
    if (selector.startsWith('.cms-nav-toggle,'))
      return [toggle]
    if (selector.startsWith('.cms-nav-close,'))
      return [close]
    if (selector.startsWith('.cms-nav-link,'))
      return [link]
    return []
  }
  const window = new PreviewElement()
  window.scrollY = 0
  const document = new PreviewElement()
  document.defaultView = window
  document.body = new PreviewElement()
  document.documentElement = new PreviewElement()
  const scope = { ownerDocument: document, querySelectorAll: () => [root] }
  const init = runInNewContext(`${navHelper}; initCmsNavHelpers`, { props: { standalonePreview: false }, clearTimeout })
  return { root, toggle, close, overlay, link, scope, init }
}

const click = element => element.dispatchEvent(new Event('click', { cancelable: true }))

test('theme refreshes on reused menu nodes retain exactly one working click handler', () => {
  const fixture = createNavFixture()
  const { root, toggle, close, overlay, link, scope, init } = fixture
  for (let refresh = 0; refresh < 5; refresh++) {
    init(scope)
    for (const element of [toggle, close, overlay, link])
      assert.equal(element.listeners.get('click').size, 1)
    click(toggle)
    assert.equal(root.classList.contains('is-open'), true)
    click(close)
    assert.equal(root.classList.contains('is-open'), false)
    click(toggle)
    click(overlay)
    assert.equal(root.classList.contains('is-open'), false)
    click(toggle)
    click(link)
    assert.equal(root.classList.contains('is-open'), false)
  }
  scope.__cmsNavCleanupFns.forEach(cleanup => cleanup())
  for (const element of [toggle, close, overlay, link])
    assert.equal(element.listeners.get('click').size, 0)
  click(toggle)
  assert.equal(root.classList.contains('is-open'), false)
})

const blockSource = readFileSync(new URL('../components/cms/block.vue', import.meta.url), 'utf8')
const moveHelper = blockSource.slice(blockSource.indexOf('const movePreviewToolbar ='), blockSource.indexOf('\nconst initializePreviewToolbarPosition ='))
const placeCard = (height, navigation = []) => {
  const previewToolbarPosition = { value: null }
  const previewToolbarOverflow = { value: false }
  const savedPreviewToolbarPosition = { value: { x: 100, y: 0 } }
  const move = runInNewContext(`${moveHelper}; movePreviewToolbar`, { previewToolbarPosition, previewToolbarOverflow, savedPreviewToolbarPosition })
  move(100, 0, {
    height,
    maxX: 1000,
    maxY: Math.max(0, height - 62),
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    toolbarWidth: 327,
    toolbarHeight: 62,
    overlappingNavigation: navigation,
  })
  assert.deepEqual(savedPreviewToolbarPosition.value, { x: 100, y: 0 })
  return { position: previewToolbarPosition.value, overflow: previewToolbarOverflow.value }
}

test('short-block card extends past block bounds instead of returning beneath the menu', () => {
  const result = placeCard(100, [{ left: 0, right: 1200, top: 0, bottom: 88 }])
  assert.equal(result.position.y, 96)
  assert.equal(result.overflow, true)
})

test('card stays inside normal blocks and flags cards taller than their block', () => {
  const normal = placeCard(260, [{ left: 0, right: 1200, top: 0, bottom: 88 }])
  assert.equal(normal.position.y, 96)
  assert.equal(normal.overflow, false)
  const short = placeCard(30)
  assert.equal(short.position.y, 0)
  assert.equal(short.overflow, true)
})
