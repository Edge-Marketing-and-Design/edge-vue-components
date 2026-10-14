// Shared pieces of the isolated preview canvas (htmlContent.vue for single
// blocks, pageCanvas.vue for whole pages). The canvas renders blocks inside a
// same-origin iframe with the site CSS the public renderer uses, so the Hub's
// styles and the site's styles never meet.
import { unoCssFromHtml } from '@edgedev/template-engine'

// Classes the preview helpers (nav, carousel) add at runtime. They never appear
// in block markup, so they are probed to make sure the canvas CSS has them.
export const CANVAS_HELPER_CLASSES = [
  'translate-x-0', 'translate-x-full', '-translate-x-full', 'translate-y-0', '-translate-y-full',
  'opacity-0', 'opacity-100', 'pointer-events-none', 'pointer-events-auto',
  'transition-all', 'duration-300', 'left-0', 'right-0', 'top-0', 'ml-auto', 'mr-6',
  'md:flex-1', 'md:pl-6', 'items-center', 'gap-6', 'flex', 'flex-nowrap', 'flex-row',
  'flex-row-reverse', 'justify-between', 'justify-center', 'fixed', 'sticky', 'absolute',
  'relative', 'inset-x-0', 'hidden', 'block',
]

// Editor-only styles inside a canvas document: field highlights (block.vue),
// the nav helper's preview class, and the reveal transition for new content.
export const CANVAS_EDITOR_CSS = `
[data-cms-preview-highlight='text']{background:rgba(250,204,21,.35);box-shadow:0 0 0 2px rgba(250,204,21,.85);border-radius:2px}
[data-cms-preview-highlight='element']{outline:2px solid rgba(250,204,21,.95);outline-offset:2px}
[data-cms-canvas-pending]{opacity:0 !important;transition:none !important}
[data-cms-canvas-revealed]{animation:cms-canvas-reveal .18s ease-out}
@keyframes cms-canvas-reveal{from{opacity:0}to{opacity:1}}
`

export const CANVAS_SRCDOC = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;opacity:0"><div id="cms-canvas-root"></div></body></html>'

// Fade the whole canvas in once its CSS is in place.
export const revealCanvasBody = (doc) => {
  if (!doc?.body || doc.body.dataset.cmsCanvasShown)
    return
  doc.body.dataset.cmsCanvasShown = 'true'
  doc.body.style.transition = 'opacity .18s ease-out'
  doc.body.style.opacity = '1'
}

const splitTokens = value => String(value || '').split(/\s+/).filter(Boolean)

// Class names from a DOM subtree. Reading attributes (not innerHTML) matters:
// serialized HTML escapes `&` as `&amp;` (breaking `[&_strong]:` variants) and
// can carry Vue's `<!--[-->` markers, which make UnoCSS swallow classes.
// Hub editor controls ([data-cms-chrome]) are skipped; block content inside
// them ([data-cms-content]) is not.
export const collectCanvasClassTokens = (root) => {
  const tokens = new Set()
  if (!root)
    return tokens
  const elements = [root, ...root.querySelectorAll('*')]
  for (const el of elements) {
    const chrome = el.closest?.('[data-cms-chrome]')
    if (chrome && !el.closest('[data-cms-content]'))
      continue
    splitTokens(el.getAttribute?.('class')).forEach(t => tokens.add(t))
    for (const attr of el.attributes || []) {
      // Helper class lists authored in data attributes (data-cms-nav-*-class).
      if (attr.name.startsWith('data-cms-') && attr.name.endsWith('class'))
        splitTokens(attr.value).forEach(t => tokens.add(t))
    }
  }
  return tokens
}

export const collectCanvasClassTokensFromHtml = (html) => {
  if (typeof DOMParser === 'undefined')
    return new Set()
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html')
  return collectCanvasClassTokens(doc.body)
}

const ensureProcessEnv = () => {
  // unoCssFromHtml reads process.env.NITRO_PRESET; browsers have no process.
  if (typeof globalThis.process === 'undefined')
    globalThis.process = { env: {} }
  else if (!globalThis.process.env)
    globalThis.process.env = {}
}

// Site CSS for a set of class names: the template engine's generator (the one
// the public renderer uses), with theme Extra CSS after it so the generated
// reset can't override theme rules.
export const buildCanvasSiteCss = async (tokens, theme, extraCss = '') => {
  ensureProcessEnv()
  const all = new Set([...tokens, ...CANVAS_HELPER_CLASSES])
  // One element per class, written raw (UnoCSS extracts from the text).
  const html = [...all].map(t => `<i class="${t.replace(/"/g, '&quot;')}"></i>`).join('')
  const { css } = await unoCssFromHtml(html, theme || {})
  return `${css}\n${extraCss || ''}`
}

export const canvasHeadLinks = (doc, head) => {
  doc.head.querySelectorAll('[data-cms-canvas-link]').forEach(el => el.remove())
  for (const link of head?.link || []) {
    const el = doc.createElement('link')
    Object.entries(link || {}).forEach(([key, value]) => el.setAttribute(key, value === true ? '' : String(value ?? '')))
    el.setAttribute('data-cms-canvas-link', '')
    doc.head.appendChild(el)
  }
}

export const upsertCanvasStyle = (doc, id, cssText) => {
  let style = doc.getElementById(id)
  if (!style) {
    style = doc.createElement('style')
    style.id = id
    doc.head.appendChild(style)
  }
  if (style.textContent !== cssText)
    style.textContent = cssText
  return style
}

// A canvas is an iframe: a form submit or a link to another page would
// navigate the frame itself and blank the preview. Same-page anchors (#faq)
// still scroll. Returns a cleanup function.
export const guardCanvasNavigation = (doc) => {
  const onClick = (event) => {
    const link = event.target?.closest?.('a[href]')
    if (!link || event.defaultPrevented)
      return
    const href = String(link.getAttribute('href') || '').trim()
    if (href.startsWith('#') && link.target !== '_blank')
      return
    event.preventDefault()
  }
  const onSubmit = event => event.preventDefault()
  doc.addEventListener('click', onClick)
  doc.addEventListener('submit', onSubmit, true)
  return () => {
    doc.removeEventListener('click', onClick)
    doc.removeEventListener('submit', onSubmit, true)
  }
}

// Content height of a canvas document. documentElement.scrollHeight is never
// less than the frame's own height, so a frame sized with it could grow but
// never shrink; the body's box is the content.
export const canvasContentHeight = (doc) => {
  const body = doc?.body
  if (!body)
    return 0
  return Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height))
}

// --- Hub chrome inside a canvas ---
// Editor controls that render inside a canvas (block toolbars in the page
// canvas, the publication viewer) are marked [data-cms-chrome]. They get the
// Hub's own stylesheets, wrapped in @scope so the rules stop at block content
// ([data-cms-content]) and never reach the site.
const isHubSheet = (sheet) => {
  const owner = sheet.ownerNode
  if (!owner)
    return true
  return true
}

const SCOPE_ROOT_SELECTOR = /(^|,)\s*(:root|html|body)(?=\s*(,|$|[\s.:[>+~]))/g

const serializeChromeRules = (rules, scoped, global) => {
  for (const rule of rules) {
    if (rule.type === 1) { // CSSRule.STYLE_RULE
      scoped.push(`${rule.selectorText.replace(SCOPE_ROOT_SELECTOR, '$1 :scope')}{${rule.style.cssText}}`)
    }
    else if (rule.type === 4 || rule.type === 12) { // MEDIA_RULE, SUPPORTS_RULE
      const inner = []
      serializeChromeRules(rule.cssRules, inner, global)
      const prelude = rule.type === 4 ? `@media ${rule.media.mediaText}` : `@supports ${rule.conditionText}`
      if (inner.length)
        scoped.push(`${prelude}{${inner.join('')}}`)
    }
    else {
      // @font-face, @keyframes, @property can't live inside @scope.
      global.push(rule.cssText)
    }
  }
}

let chromeCssCache = { count: -1, css: '' }

export const buildChromeCss = (hubDocument) => {
  const sheets = Array.from(hubDocument.styleSheets).filter(isHubSheet)
  if (chromeCssCache.count === sheets.length && chromeCssCache.css)
    return chromeCssCache.css
  const scoped = []
  const global = []
  for (const sheet of sheets) {
    let rules
    try {
      rules = sheet.cssRules
    }
    catch {
      continue
    }
    serializeChromeRules(rules, scoped, global)
  }
  const css = `${global.join('\n')}\n@scope ([data-cms-chrome]) to ([data-cms-content]) {\n${scoped.join('\n')}\n}`
  chromeCssCache = { count: sheets.length, css }
  return css
}
