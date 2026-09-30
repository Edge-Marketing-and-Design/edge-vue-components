// How the Hub's block canvases handle responsive classes (htmlContent.vue).
//
// Full width ('auto'): breakpoint prefixes stay, and breakpoint utilities get
// `!important` so block styles win over the Hub's own styles.
//
// Sized canvases (large, medium, mobile): the canvas is narrower than the
// window, so real media queries would answer for the window, not the canvas.
// The Hub simulates them instead: a prefix the canvas width satisfies is
// stripped (`lg:hidden` -> `!hidden` at 1280), a prefix it doesn't is dropped
// with its class. The `!` is what lets the stripped class beat the base class
// (`flex lg:hidden`), so every stripped class needs it, and when two stripped
// classes set the same thing (`md:flex lg:hidden`), the larger breakpoint is
// kept, as a real media query cascade would.

export const BREAKPOINT_MIN_WIDTHS = {
  'sm': 640,
  'md': 768,
  'lg': 1024,
  'xl': 1280,
  '2xl': 1536,
}

const TEXT_SIZE_RE = /^text-(xs|sm|base|lg|xl|\d+xl)$/
const FONT_UTILITY_RE = /^font-([\w-]+|\[[^\]]+\])$/

// Keyword utilities that set the same property, so only one can apply.
const KEYWORD_FAMILIES = {
  display: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents', 'flow-root', 'list-item', 'table', 'inline-table', 'table-caption', 'table-cell', 'table-column', 'table-column-group', 'table-footer-group', 'table-header-group', 'table-row-group', 'table-row'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  visibility: ['visible', 'invisible', 'collapse'],
}
const FAMILY_OF = Object.fromEntries(Object.entries(KEYWORD_FAMILIES).flatMap(([family, words]) => words.map(word => [word, family])))

const isBreakpoint = part => Object.prototype.hasOwnProperty.call(BREAKPOINT_MIN_WIDTHS, part.replace(/^!/, ''))

// Every utility gets `!` except structural hooks the Hub owns. A `!` on a
// class no rule generates does nothing.
export const importantifyUtility = (core) => {
  if (!core || core.startsWith('!'))
    return core
  if (core === 'block-content' || core.startsWith('embla'))
    return core
  return `!${core}`
}

// tokens: the element's classes as written. forcedWidth: the canvas width, or
// null at full width. mapCore: the theme mapping for a class (no prefixes).
// Returns the classes to apply.
export const rewriteViewportClassTokens = (tokens, { forcedWidth = null, mapCore = core => core } = {}) => {
  const rewritten = []
  for (const token of tokens) {
    const parts = token.split(':')
    const core = parts.pop()
    const nakedCore = core.replace(/^!/, '')
    const nextParts = []
    let hadBreakpoint = false
    let breakpointWidth = 0
    let drop = false

    for (const part of parts) {
      if (!isBreakpoint(part)) {
        nextParts.push(part)
        continue
      }
      hadBreakpoint = true
      if (forcedWidth == null) {
        nextParts.push(part)
        continue
      }
      const minWidth = BREAKPOINT_MIN_WIDTHS[part.replace(/^!/, '')]
      if (forcedWidth < minWidth) {
        drop = true
        break
      }
      breakpointWidth = Math.max(breakpointWidth, minWidth)
    }
    if (drop)
      continue

    const mappedCore = mapCore(core)
    const shouldImportant = hadBreakpoint || TEXT_SIZE_RE.test(nakedCore) || FONT_UTILITY_RE.test(nakedCore)
    rewritten.push({
      className: [...nextParts, shouldImportant ? importantifyUtility(mappedCore) : mappedCore].filter(Boolean).join(':'),
      family: FAMILY_OF[nakedCore] || null,
      variants: nextParts.join(':'),
      breakpointWidth: (forcedWidth != null && hadBreakpoint) ? breakpointWidth : 0,
    })
  }

  // Sized canvases: of the stripped classes in one family (with the same
  // state variants), keep only the largest breakpoint's.
  if (forcedWidth != null) {
    const winner = new Map()
    for (const entry of rewritten) {
      if (!entry.family || !entry.breakpointWidth)
        continue
      const key = `${entry.variants}|${entry.family}`
      if (!winner.has(key) || winner.get(key).breakpointWidth <= entry.breakpointWidth)
        winner.set(key, entry)
    }
    return rewritten
      .filter(entry => !entry.family || !entry.breakpointWidth || winner.get(`${entry.variants}|${entry.family}`) === entry)
      .map(entry => entry.className)
  }
  return rewritten.map(entry => entry.className)
}
