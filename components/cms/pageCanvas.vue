<script setup>
// Renders a page preview in one same-origin iframe (docs/features/cms/iframe-canvas.md).
// The slot (rows, columns, blocks) is teleported into the frame, so Vue state,
// events and dialogs stay in the Hub while the styling context is the site's:
// - site CSS: the template engine's generator over the class names in the frame
//   (what the public renderer uses), with theme Extra CSS after it;
// - Hub chrome (block toolbars, badges): the Hub's own stylesheets, wrapped in
//   @scope ([data-cms-chrome]) to ([data-cms-content]) so they style editor
//   controls and stop at block content.
// New content waits (invisible) until its CSS exists, then fades in.
// When disabled, the slot renders in place (Teleport disabled).
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { CANVAS_EDITOR_CSS, CANVAS_SRCDOC, buildCanvasSiteCss, buildChromeCss, canvasContentHeight, canvasHeadLinks, collectCanvasClassTokens, guardCanvasNavigation, revealCanvasBody, upsertCanvasStyle } from '../../lib/cmsCanvas'

const props = defineProps({
  enabled: { type: Boolean, default: false },
  theme: { type: Object, default: () => ({}) },
  head: { type: Object, default: () => ({}) },
  viewportMode: { type: String, default: 'auto' },
  // 'viewport': fill the host and scroll inside (editors). 'content': grow to
  // the page's full height (standalone preview route, screenshots).
  fit: { type: String, default: 'viewport' },
})

const VIEWPORT_WIDTHS = { large: 1280, medium: 992, mobile: 420 }
// The first reveal waits for content to settle (blocks loading data), up to this long.
const SETTLE_MS = 150
const MAX_FIRST_REVEAL_MS = 2500

const host = ref(null)
const frame = ref(null)
const mount = ref(null)
const available = reactive({ width: 0, height: 0 })
const contentHeight = ref(0)
let cleanups = []
let cssTimer = null
let settleTimer = null
let cssRun = 0
let cssBuilding = false
let cssAgain = false
let knownTokens = new Set()
let headSignature = ''
let firstRevealAt = 0

const viewportWidth = computed(() => VIEWPORT_WIDTHS[props.viewportMode] || 0)
const scale = computed(() => {
  if (!viewportWidth.value || !available.width || viewportWidth.value <= available.width)
    return 1
  return Math.max(0.1, available.width / viewportWidth.value)
})
const frameStyle = computed(() => {
  let height = available.height ? `${Math.round(available.height / scale.value)}px` : '100%'
  if (props.fit === 'content')
    height = `${contentHeight.value || 150}px`
  return {
    width: viewportWidth.value ? `${viewportWidth.value}px` : '100%',
    height,
    zoom: scale.value === 1 ? null : scale.value,
  }
})

const extraCss = computed(() => (typeof props.theme?.extraCSS === 'string' ? props.theme.extraCSS : ''))

// --- Site CSS and reveal ---
const elementTokens = el => String(el.getAttribute?.('class') || '').split(/\s+/).filter(Boolean)

// Hub chrome classes are styled by the scoped Hub CSS, not the site CSS.
const isChromeOnly = el => Boolean(el.closest?.('[data-cms-chrome]')) && !el.closest('[data-cms-content]')

// True when the written site CSS doesn't cover an element's classes (or its descendants').
function isUnstyled(el) {
  return [el, ...el.querySelectorAll('[class]')]
    .filter(node => !isChromeOnly(node))
    .some(node => elementTokens(node).some(t => !knownTokens.has(t)))
}

// Hides an element until the site CSS covers its classes (returns true if held).
function holdIfUnstyled(el) {
  if (!el?.querySelectorAll)
    return false
  const missing = isUnstyled(el)
  if (missing)
    el.setAttribute('data-cms-canvas-pending', '')
  return missing
}

// Reveals the held elements the written CSS now covers. Content added while
// the CSS was building stays held for the next run.
function releasePending(doc) {
  doc.querySelectorAll('[data-cms-canvas-pending]').forEach((el) => {
    if (isUnstyled(el))
      return
    el.removeAttribute('data-cms-canvas-pending')
    el.setAttribute('data-cms-canvas-revealed', '')
    el.addEventListener('animationend', () => el.removeAttribute('data-cms-canvas-revealed'), { once: true })
  })
}

// Runs never overlap: a request during a build (cold loads import UnoCSS, so
// the first one is slow) runs again after it, instead of discarding it.
async function writeSiteCss() {
  const doc = frame.value?.contentDocument
  if (!doc?.head || !mount.value)
    return
  if (cssBuilding) {
    cssAgain = true
    return
  }
  cssBuilding = true
  cssAgain = false
  const run = cssRun
  const tokens = collectCanvasClassTokens(mount.value)
  let css
  try {
    css = await buildCanvasSiteCss(tokens, props.theme, extraCss.value)
  }
  finally {
    cssBuilding = false
  }
  // The frame reloaded (or unmounted) while building.
  if (run !== cssRun || frame.value?.contentDocument !== doc || !mount.value) {
    if (cssAgain)
      scheduleSiteCss()
    return
  }
  upsertCanvasStyle(doc, 'cms-page-canvas-site-css', css)
  knownTokens = tokens
  releasePending(doc)
  if (props.fit === 'content')
    contentHeight.value = canvasContentHeight(doc)
  const current = collectCanvasClassTokens(mount.value)
  if (cssAgain || [...current].some(t => !tokens.has(t))) {
    scheduleSiteCss()
    return
  }
  scheduleReveal()
}

function scheduleSiteCss() {
  clearTimeout(cssTimer)
  cssTimer = setTimeout(writeSiteCss, 30)
}

// First reveal: once CSS covers everything in the frame and content has stopped
// changing, or after MAX_FIRST_REVEAL_MS (anything still unstyled stays held).
function scheduleReveal() {
  const doc = frame.value?.contentDocument
  if (!doc || doc.body?.dataset.cmsCanvasShown)
    return
  clearTimeout(settleTimer)
  const waited = Date.now() - firstRevealAt
  if (waited > MAX_FIRST_REVEAL_MS) {
    revealCanvasBody(doc)
    return
  }
  settleTimer = setTimeout(() => {
    if (!doc.querySelector('[data-cms-canvas-pending]'))
      revealCanvasBody(doc)
  }, SETTLE_MS)
}

function onMutations(records) {
  let changed = false
  for (const record of records) {
    if (record.type === 'childList') {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          changed = true
          holdIfUnstyled(node)
        }
      })
    }
    else if (record.type === 'attributes' && record.attributeName === 'class') {
      // Class changes by helpers (nav open/close) are already covered by the
      // helper probe; only hold elements whose new classes have no CSS yet.
      const tokens = elementTokens(record.target)
      if (!isChromeOnly(record.target) && tokens.some(t => !knownTokens.has(t))) {
        changed = true
        holdIfUnstyled(record.target)
      }
    }
  }
  if (changed)
    scheduleSiteCss()
}

function writeHead() {
  const doc = frame.value?.contentDocument
  if (!doc?.head)
    return
  // Rewriting identical font links makes the browser reload them (a visible
  // font flash), so only rewrite when the head actually changed.
  const signature = JSON.stringify(props.head?.link || [])
  if (signature !== headSignature) {
    headSignature = signature
    canvasHeadLinks(doc, props.head)
  }
  upsertCanvasStyle(doc, 'cms-page-canvas-chrome-css', buildChromeCss(document))
  upsertCanvasStyle(doc, 'cms-page-canvas-editor-css', CANVAS_EDITOR_CSS)
}

function measure() {
  const el = host.value
  if (!el)
    return
  available.width = el.clientWidth
  available.height = el.clientHeight
}

async function onLoad() {
  const doc = frame.value?.contentDocument
  if (!doc)
    return
  cleanups.forEach(fn => fn())
  cleanups = []
  headSignature = ''
  knownTokens = new Set()
  cssRun++
  firstRevealAt = Date.now()
  writeHead()
  mount.value = doc.getElementById('cms-canvas-root')
  await nextTick()
  scheduleSiteCss()
  cleanups.push(guardCanvasNavigation(doc))
  const observer = new MutationObserver(onMutations)
  observer.observe(mount.value, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  cleanups.push(() => observer.disconnect())
  const sizeObserver = new ResizeObserver(measure)
  sizeObserver.observe(host.value)
  cleanups.push(() => sizeObserver.disconnect())
  measure()
  if (props.fit === 'content') {
    const FrameResizeObserver = frame.value.contentWindow?.ResizeObserver || ResizeObserver
    const contentObserver = new FrameResizeObserver(() => {
      contentHeight.value = canvasContentHeight(doc)
    })
    contentObserver.observe(doc.body)
    cleanups.push(() => contentObserver.disconnect())
    // Web fonts and images change the height after the first render.
    const remeasure = () => {
      contentHeight.value = canvasContentHeight(doc)
    }
    doc.fonts?.ready?.then(remeasure)
    frame.value.contentWindow?.addEventListener('load', remeasure)
    doc.addEventListener('load', remeasure, true)
    cleanups.push(() => doc.removeEventListener('load', remeasure, true))
  }
}

watch(() => [props.theme, props.head], () => {
  if (!mount.value)
    return
  writeHead()
  scheduleSiteCss()
}, { deep: true })

watch(() => props.enabled, (on) => {
  if (!on) {
    cleanups.forEach(fn => fn())
    cleanups = []
    mount.value = null
  }
})

provide('edgeCmsPageCanvas', reactive({
  active: computed(() => props.enabled),
  contentChanged: () => scheduleSiteCss(),
}))

onBeforeUnmount(() => {
  clearTimeout(cssTimer)
  clearTimeout(settleTimer)
  cleanups.forEach(fn => fn())
})
</script>

<template>
  <div v-if="enabled" ref="host" class="w-full overflow-hidden" :class="fit === 'content' ? '' : 'h-full'" data-cms-page-canvas>
    <iframe
      ref="frame"
      title="Page canvas"
      class="mx-auto block border-0 bg-white"
      :style="frameStyle"
      :srcdoc="CANVAS_SRCDOC"
      @load="onLoad"
    />
  </div>
  <Teleport v-if="!enabled || mount" :to="mount || 'body'" :disabled="!enabled">
    <slot />
  </Teleport>
</template>
