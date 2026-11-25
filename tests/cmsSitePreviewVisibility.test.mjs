import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const siteSource = readFileSync(new URL('../components/cms/site.vue', import.meta.url), 'utf8')
const visibilityStart = siteSource.indexOf('const visibleSitePagePreviewIds =')
const visibilityEnd = siteSource.indexOf('let html2canvasModulePromise', visibilityStart)
const visibilitySource = siteSource.slice(visibilityStart, visibilityEnd)

const createVisibility = (IntersectionObserver) => {
  // eslint-disable-next-line no-new-func
  return new Function('ref', 'IntersectionObserver', `${visibilitySource}; return { visibleSitePagePreviewIds, sitePagePreviewVisibilityObservers, vPreviewVisible }`)(
    value => ({ value }),
    IntersectionObserver,
  )
}

test('site page previews mount only when their card approaches view, then remain mounted', () => {
  const observers = []
  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.disconnected = false
      observers.push(this)
    }

    observe(element) {
      this.element = element
    }

    disconnect() {
      this.disconnected = true
    }
  }

  const { visibleSitePagePreviewIds, sitePagePreviewVisibilityObservers, vPreviewVisible } = createVisibility(MockIntersectionObserver)
  const card = {}
  vPreviewVisible.mounted(card, { value: 'page-1' })
  assert.equal(visibleSitePagePreviewIds.value.has('page-1'), false)
  assert.equal(observers[0].element, card)
  assert.equal(observers[0].options.rootMargin, '400px 0px')

  observers[0].callback([{ isIntersecting: false }])
  assert.equal(visibleSitePagePreviewIds.value.has('page-1'), false)
  observers[0].callback([{ isIntersecting: true }])
  assert.equal(visibleSitePagePreviewIds.value.has('page-1'), true)
  assert.equal(observers[0].disconnected, true)
  assert.equal(sitePagePreviewVisibilityObservers.size, 0)

  vPreviewVisible.unmounted(card)
  vPreviewVisible.mounted(card, { value: 'page-1' })
  assert.equal(observers.length, 1)
  assert.match(siteSource, /v-preview-visible="item\.docId"/)
  assert.match(siteSource, /v-else-if="visibleSitePagePreviewIds\.has\(item\.docId\)"/)
})

test('site page previews remain available without IntersectionObserver', () => {
  const { visibleSitePagePreviewIds, vPreviewVisible } = createVisibility(undefined)
  vPreviewVisible.mounted({}, { value: 'page-2' })
  assert.equal(visibleSitePagePreviewIds.value.has('page-2'), true)
})
