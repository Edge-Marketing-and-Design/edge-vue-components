import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

// The page canvas's site-CSS and reveal logic, run against a small fake DOM
// with a CSS build the test resolves by hand (a cold UnoCSS load is slow).
const canvasSource = readFileSync(new URL('../components/cms/pageCanvas.vue', import.meta.url), 'utf8')
const revealLogic = canvasSource.slice(canvasSource.indexOf('const elementTokens'), canvasSource.indexOf('\nfunction writeHead('))
const libSource = readFileSync(new URL('../lib/cmsCanvas.js', import.meta.url), 'utf8')
const collectLogic = libSource.slice(libSource.indexOf('const splitTokens'), libSource.indexOf('\nexport const collectCanvasClassTokensFromHtml'))
  .replace('export const', 'const')

class FakeElement {
  constructor(className = '', attrs = {}) {
    this.attrs = new Map(Object.entries(attrs))
    if (className)
      this.attrs.set('class', className)
    this.children = []
    this.parentElement = null
    this.nodeType = 1
    this.dataset = {}
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this
      this.children.push(child)
    })
    return this
  }

  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }))
  }

  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  removeAttribute(name) { this.attrs.delete(name) }
  hasAttribute(name) { return this.attrs.has(name) }
  addEventListener() {}

  matches(selector) {
    if (selector === '*')
      return true
    const attr = selector.match(/^\[([\w-]+)\]$/)?.[1]
    return Boolean(attr && this.attrs.has(attr))
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()])
  }

  querySelectorAll(selector) { return this.descendants().filter(el => el.matches(selector)) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }

  closest(selector) {
    for (let el = this; el; el = el.parentElement) {
      if (el.matches(selector))
        return el
    }
    return null
  }
}

function setup() {
  const body = new FakeElement()
  const root = new FakeElement()
  body.append(root)
  const doc = {
    head: {},
    body,
    querySelectorAll: selector => body.querySelectorAll(selector),
    querySelector: selector => body.querySelector(selector),
  }
  let now = 0
  let nextTimer = 1
  const timers = new Map()
  const builds = []
  const written = []
  const context = {
    Date: { now: () => now },
    setTimeout: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: id => timers.delete(id),
    frame: { value: { contentDocument: doc } },
    mount: { value: root },
    props: { theme: {}, fit: 'viewport' },
    extraCss: { value: '' },
    contentHeight: { value: 0 },
    buildCanvasSiteCss: tokens => new Promise((resolve) => {
      builds.push({ tokens: new Set(tokens), resolve: () => resolve([...tokens].join(' ')) })
    }),
    upsertCanvasStyle: (_doc, _id, css) => written.push(css),
    canvasContentHeight: () => 0,
    revealCanvasBody: (target) => { target.body.dataset.cmsCanvasShown = 'true' },
  }
  runInNewContext(`
    const SETTLE_MS = 150
    const MAX_FIRST_REVEAL_MS = 2500
    let cssTimer = null
    let settleTimer = null
    let cssRun = 0
    let cssBuilding = false
    let cssAgain = false
    let knownTokens = new Set()
    let firstRevealAt = 0
    ${collectLogic}
    ${revealLogic}
    globalThis.canvas = { scheduleSiteCss, onMutations }
  `, context)

  const flush = () => new Promise(resolve => setImmediate(resolve))
  // Advances the fake clock, firing due timers in order.
  const advance = async (ms) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due)
        break
      timers.delete(due[0])
      now = due[1].at
      due[1].fn()
      await flush()
    }
    now = end
  }
  const finishBuild = async (index) => {
    builds[index].resolve()
    await flush()
  }
  const insert = (el) => {
    root.append(el)
    context.canvas.onMutations([{ type: 'childList', addedNodes: [el] }])
  }
  const pending = el => el.hasAttribute('data-cms-canvas-pending')
  return { canvas: context.canvas, body, root, builds, written, advance, finishBuild, insert, pending }
}

test('a block inserted while the CSS builds stays hidden until a run covers it', async () => {
  const t = setup()
  const header = new FakeElement('flex h-20')
  t.root.append(header)
  t.canvas.scheduleSiteCss()
  await t.advance(30)
  assert.equal(t.builds.length, 1)

  // A logo arrives mid-build: its h-12/w-auto rules aren't in this build.
  const logo = new FakeElement('max-w-none').append(new FakeElement('h-12 w-auto'))
  t.insert(logo)
  assert.equal(t.pending(logo), true)
  await t.advance(30) // its own run is requested while the first is still building

  await t.finishBuild(0)
  assert.equal(t.pending(logo), true, 'first run must not reveal content it did not style')
  assert.ok(!t.written[0].includes('h-12'))

  await t.advance(30)
  assert.equal(t.builds.length, 2, 'a second run starts for the new tokens')
  assert.ok(t.builds[1].tokens.has('h-12'))
  await t.finishBuild(1)
  assert.equal(t.pending(logo), false)
})

test('new tokens that appear just before a build finishes trigger another run', async () => {
  const t = setup()
  t.root.append(new FakeElement('grid'))
  t.canvas.scheduleSiteCss()
  await t.advance(30)

  // Added without a debounce tick in between (the run request is still queued).
  const section = new FakeElement('bg-brand py-24')
  t.insert(section)
  await t.finishBuild(0)
  assert.equal(t.pending(section), true)

  await t.advance(30)
  assert.equal(t.builds.length, 2)
  await t.finishBuild(1)
  assert.equal(t.pending(section), false)
})

test('the first body reveal waits until nothing is held', async () => {
  const t = setup()
  t.root.append(new FakeElement('flex'))
  t.canvas.scheduleSiteCss()
  await t.advance(30)
  const block = new FakeElement('text-4xl')
  t.insert(block)
  await t.finishBuild(0)
  await t.advance(30) // the rerun's debounce fires, its build is in flight
  assert.equal(t.builds.length, 2)
  await t.advance(200)
  assert.equal(t.body.dataset.cmsCanvasShown, undefined, 'body stays hidden while a block is held')

  await t.finishBuild(1)
  await t.advance(150)
  assert.equal(t.body.dataset.cmsCanvasShown, 'true')
})

test('the first body reveal is not delayed past the cap', async () => {
  const t = setup()
  t.root.append(new FakeElement('flex'))
  t.canvas.scheduleSiteCss()
  await t.advance(30)
  await t.advance(3000) // a very slow cold build
  await t.finishBuild(0)
  assert.equal(t.body.dataset.cmsCanvasShown, 'true')
})

test('hub chrome classes never hold content', async () => {
  const t = setup()
  t.canvas.scheduleSiteCss()
  await t.advance(30)
  await t.finishBuild(0)
  const toolbar = new FakeElement('hub-only-button', { 'data-cms-chrome': '' })
  t.insert(toolbar)
  assert.equal(t.pending(toolbar), false)
})
