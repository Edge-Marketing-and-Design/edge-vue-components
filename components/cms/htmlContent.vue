<script setup>
import presetWind4 from '@unocss/preset-wind4'

import initUnocssRuntime, { defineConfig } from '@unocss/runtime'
import DOMPurify from 'dompurify'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useHead } from '#imports'

const props = defineProps({
  html: {
    type: String,
    default: '',
  },
  theme: {
    type: Object,
    default: () => ({}),
  },
  isolated: {
    type: Boolean,
    default: true,
  },
  comp: {
    type: String,
    required: false,
    default: null,
  },
  viewportMode: {
    type: String,
    default: 'auto',
  },
})

const emit = defineEmits(['loaded'])

const scopeId = `hc-${Math.random().toString(36).slice(2)}`

const themeExtraCSS = computed(() => {
  const value = props.theme?.extraCSS
  return typeof value === 'string' ? value : ''
})

const toCssVarToken = (key) => {
  return String(key || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const isSafeLegacyVarKey = key => /^[A-Za-z0-9_-]+$/.test(String(key || ''))

const pushVarDecl = (decls, prefix, key, value) => {
  const token = toCssVarToken(key)
  if (!token)
    return

  const normalizedName = `--${prefix}-${token}`
  decls.push(`${normalizedName}: ${value};`)

  const legacyKey = String(key || '')
  if (!isSafeLegacyVarKey(legacyKey))
    return

  const legacyName = `--${prefix}-${legacyKey}`
  if (legacyName !== normalizedName)
    decls.push(`${legacyName}: ${value};`)
}

const cssVarRef = (prefix, key) => `var(--${prefix}-${toCssVarToken(key)})`
const escapeClassToken = value => String(value || '').replace(/([^a-zA-Z0-9_-])/g, '\\$1')

// --- UnoCSS Runtime singleton (global, one init for the whole app) ---
async function ensureUnoRuntime() {
  if (typeof window === 'undefined')
    return
  // If already started, nothing to do.
  if (window.__unoRuntimeStarted === true)
    return
  // If another component is initializing, await that shared promise.
  if (window.__unoInitPromise) {
    await window.__unoInitPromise
    return
  }
  // Create a shared promise on window so all components can await the same init.
  window.__unoInitPromise = (async () => {
    // Pre-init de-dupe: keep only one style tag per Uno layer if any exist
    const preSheets = Array.from(document.querySelectorAll('style[data-unocss-runtime-layer]'))
    if (preSheets.length > 0) {
      const seen = new Set()
      preSheets.forEach((el) => {
        const layer = el.getAttribute('data-unocss-runtime-layer') || ''
        if (seen.has(layer))
          el.parentNode && el.parentNode.removeChild(el)
        else seen.add(layer)
      })
    }
    await initUnocssRuntime({
      defaults: defineConfig({
        presets: [presetWind4()],
        shortcuts: [],
      }),
      observe: true,
    })
    // Post-init de-dupe: if multiple parallel inits slipped through, collapse to one per layer.
    const postSheets = Array.from(document.querySelectorAll('style[data-unocss-runtime-layer]'))
    if (postSheets.length > 0) {
      const seen = new Set()
      postSheets.forEach((el) => {
        const layer = el.getAttribute('data-unocss-runtime-layer') || ''
        if (seen.has(layer))
          el.parentNode && el.parentNode.removeChild(el)
        else seen.add(layer)
      })
    }
    window.__unoRuntimeStarted = true
    window.__unoInitPromise = null
  })()
  await window.__unoInitPromise
}

// --- Global theme variables (single style tag) ---
function buildGlobalThemeCSS(theme) {
  const t = normalizeTheme(theme || {})
  const { colors, fontFamily, fontSize, borderRadius, boxShadow } = t
  const decls = []
  Object.entries(colors).forEach(([k, v]) => pushVarDecl(decls, 'color', k, Array.isArray(v) ? v[0] : v))
  Object.entries(fontFamily).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => (x.includes(' ') ? `'${x}'` : x)).join(', ') : v
    pushVarDecl(decls, 'font', k, val)
  })
  Object.entries(fontSize).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const [size, opts] = v
      pushVarDecl(decls, 'font-size', k, size)
      if (opts && opts.lineHeight)
        pushVarDecl(decls, 'line-height', k, opts.lineHeight)
    }
    else {
      pushVarDecl(decls, 'font-size', k, v)
    }
  })
  Object.entries(borderRadius).forEach(([k, v]) => pushVarDecl(decls, 'radius', k, v))
  Object.entries(boxShadow).forEach(([k, v]) => pushVarDecl(decls, 'shadow', k, v))
  return `:root{${decls.join('')}}`
}

function buildScopedThemeCSS(theme, scopeId) {
  const t = normalizeTheme(theme || {})
  const { colors, fontFamily, fontSize, borderRadius, boxShadow } = t
  const decls = []
  Object.entries(colors).forEach(([k, v]) => pushVarDecl(decls, 'color', k, Array.isArray(v) ? v[0] : v))
  Object.entries(fontFamily).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => (x.includes(' ') ? `'${x}'` : x)).join(', ') : v
    pushVarDecl(decls, 'font', k, val)
  })
  Object.entries(fontSize).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const [size, opts] = v
      pushVarDecl(decls, 'font-size', k, size)
      if (opts?.lineHeight)
        pushVarDecl(decls, 'line-height', k, opts.lineHeight)
    }
    else {
      pushVarDecl(decls, 'font-size', k, v)
    }
  })
  Object.entries(borderRadius).forEach(([k, v]) => pushVarDecl(decls, 'radius', k, v))
  Object.entries(boxShadow).forEach(([k, v]) => pushVarDecl(decls, 'shadow', k, v))

  const rules = [`[data-theme-scope="${scopeId}"]{${decls.join('')}}`]
  Object.keys(colors || {}).forEach((key) => {
    const escapedKey = escapeClassToken(key)
    const colorRef = cssVarRef('color', key)
    rules.push(`[data-theme-scope="${scopeId}"] .bg-${escapedKey}{background-color:${colorRef} !important;}`)
    rules.push(`[data-theme-scope="${scopeId}"] .text-${escapedKey}{color:${colorRef} !important;}`)
    rules.push(`[data-theme-scope="${scopeId}"] .border-${escapedKey}{border-color:${colorRef} !important;}`)
  })
  return rules.join('')
}

function setGlobalThemeVars(theme) {
  if (typeof window === 'undefined')
    return
  const sheetId = 'htmlcontent-theme-global'
  let styleEl = document.getElementById(sheetId)
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = sheetId
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = buildGlobalThemeCSS(theme)
  window.__htmlcontentGlobalTheme = true
}

const hostEl = ref(null)
let hasMounted = false

function notifyLoaded() {
  if (!import.meta.client || !hasMounted)
    return
  requestAnimationFrame(() => emit('loaded'))
}

// --- SSR-safe HTML: raw on server, sanitized on client ---
const safeHtml = computed(() => {
  const c = props.html || ''
  if (typeof window === 'undefined')
    return c
  return DOMPurify.sanitize(c, { ADD_ATTR: ['class'] })
})

// Inject theme CSS variables into <head> for SSR + client
useHead(() => {
  const style = [
    { id: `htmlcontent-theme-vars-${scopeId}`, children: buildScopedThemeCSS(props.theme, scopeId) },
  ]
  if (themeExtraCSS.value.trim()) {
    style.push({
      id: `htmlcontent-theme-extra-${scopeId}`,
      children: themeExtraCSS.value,
    })
  }
  return { style }
})

// --- Embla initializer (runs client-side only) ---
async function initEmblaCarousels(scope) {
  if (!scope || !import.meta.client)
    return

  const [{ default: EmblaCarousel }, { default: Autoplay }, { default: Fade }] = await Promise.all([
    import('embla-carousel'),
    import('embla-carousel-autoplay'),
    import('embla-carousel-fade'),
  ])

  const roots = scope.querySelectorAll('[data-carousel]:not([data-embla])')

  roots.forEach((root) => {
    // Options via data- attributes
    const loop = !!root.hasAttribute('data-carousel-loop')
    const transition = (root.getAttribute('data-carousel-transition') || 'none').toLowerCase() // 'none' | 'fade'
    const delay = Number(root.getAttribute('data-carousel-interval')) || 5000
    const noPause = root.hasAttribute('data-carousel-no-pause')
    const autoplayOn = root.hasAttribute('data-carousel-autoplay')
    const fadeDuration = Number(root.getAttribute('data-carousel-fade-duration')) || 200

    const stsBase = root.getAttribute('data-carousel-slides-to-scroll')
    const stsMd = root.getAttribute('data-carousel-slides-to-scroll-md')
    const stsLg = root.getAttribute('data-carousel-slides-to-scroll-lg')
    const stsXl = root.getAttribute('data-carousel-slides-to-scroll-xl')
    const slidesToScroll = stsBase != null ? Number(stsBase) : 1

    const plugins = []
    if (autoplayOn) {
      plugins.push(
        Autoplay({
          delay,
          stopOnInteraction: !noPause,
          stopOnMouseEnter: !noPause,
        }),
      )
    }
    if (transition === 'fade') {
      // Pass duration to the plugin and also expose via CSS vars
      // Ensure CSS-driven durations pick this up (covers common var names across versions)
      root.style.setProperty('--embla-fade-duration', `${fadeDuration}ms`)
      root.style.setProperty('--embla-duration', `${fadeDuration}ms`)
      plugins.push(Fade({ duration: fadeDuration, easing: 'ease' }))
    }

    const options = {
      loop,
      container: '[data-carousel-track]',
      align: 'start',
      slidesToScroll,
      breakpoints: {
        '(min-width: 768px)': stsMd != null ? { slidesToScroll: Number(stsMd) } : undefined,
        '(min-width: 1024px)': stsLg != null ? { slidesToScroll: Number(stsLg) } : undefined,
        '(min-width: 1280px)': stsXl != null ? { slidesToScroll: Number(stsXl) } : undefined,
      },
    }
    if (!loop)
      options.containScroll = 'trimSnaps'

    const api = EmblaCarousel(root, options, plugins)

    // Force-apply fade duration on slide nodes as inline styles to override any defaults
    if (transition === 'fade') {
      const applyFadeTransitionStyles = () => {
        api.slideNodes().forEach((el) => {
          el.style.transitionProperty = 'opacity, visibility'
          el.style.transitionDuration = `${fadeDuration}ms`
          el.style.transitionTimingFunction = 'ease'
        })
      }
      applyFadeTransitionStyles()
      api.on('reInit', applyFadeTransitionStyles)
    }

    // Wire prev/next, keeping disabled state in sync with snaps
    const prevBtn = root.querySelector('[data-carousel-prev]')
    const nextBtn = root.querySelector('[data-carousel-next]')
    const setBtnStates = () => {
      if (loop) {
        if (prevBtn)
          prevBtn.disabled = false
        if (nextBtn)
          nextBtn.disabled = false
        return
      }
      if (prevBtn)
        prevBtn.disabled = !api.canScrollPrev()
      if (nextBtn)
        nextBtn.disabled = !api.canScrollNext()
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (loop && !api.canScrollPrev()) {
          const snaps = api.scrollSnapList()
          api.scrollTo(snaps.length - 1)
          return
        }
        api.scrollPrev()
      })
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (loop && !api.canScrollNext()) {
          api.scrollTo(0)
          return
        }
        api.scrollNext()
      })
    }

    // Build dots based on scroll snaps (respects slidesToScroll & breakpoints)
    const dotsHost = root.querySelector('[data-carousel-dots]')
    let dotButtons = []
    const buildDots = () => {
      if (!dotsHost)
        return
      dotsHost.innerHTML = ''
      dotButtons = []
      const snaps = api.scrollSnapList() // snap positions, not slides
      const initial = api.selectedScrollSnap()
      snaps.forEach((_snap, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'h-2 w-2 rounded-full bg-gray-300 aria-[current=true]:bg-gray-800'
        b.setAttribute('aria-current', String(i === initial))
        b.addEventListener('click', () => {
          api.scrollTo(i)
        })
        dotsHost.appendChild(b)
        dotButtons.push(b)
      })
    }
    const updateDots = () => {
      if (!dotsHost || !dotButtons.length)
        return
      const idx = api.selectedScrollSnap()
      dotButtons.forEach((d, i) => {
        d.setAttribute('aria-current', String(i === idx))
      })
    }

    // Initial sync
    buildDots()
    setBtnStates()
    updateDots()

    // Keep everything in sync as selection/breakpoints change
    api.on('select', () => {
      setBtnStates()
      updateDots()
    })
    api.on('reInit', () => {
      buildDots() // snaps can change when slidesToScroll/breakpoints change
      setBtnStates()
      updateDots()
    })

    // Mark initialized
    root.setAttribute('data-embla', 'true')

    // Optional: store API for cleanup if needed later
    // root._emblaApi = api
  })
}

function initCmsNavHelpers(scope) {
  if (!scope || !import.meta.client)
    return

  const existingCleanupFns = Array.isArray(scope.__cmsNavCleanupFns)
    ? scope.__cmsNavCleanupFns
    : []
  existingCleanupFns.forEach((cleanup) => {
    try {
      cleanup()
    }
    catch {}
  })
  scope.__cmsNavCleanupFns = []

  const roots = scope.querySelectorAll('.cms-nav-root, [data-cms-nav-root]')
  roots.forEach((root) => {
    const parseBoolean = (rawValue, fallback = false) => {
      if (rawValue == null || rawValue === '')
        return fallback
      const normalized = String(rawValue).trim().toLowerCase()
      if (['false', '0', 'off', 'no'].includes(normalized))
        return false
      if (['true', '1', 'on', 'yes'].includes(normalized))
        return true
      return fallback
    }

    const toClassTokens = (rawValue) => {
      return String(rawValue || '')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean)
    }

    const normalizeRuntimeToken = (token) => {
      if (!token)
        return token
      const parts = token.split(':')
      const core = parts.pop()
      const nakedCore = core.startsWith('!') ? core.slice(1) : core
      const hasBreakpoint = parts.some((part) => {
        const normalized = part.replace(/^!/, '')
        return Object.prototype.hasOwnProperty.call(BREAKPOINT_MIN_WIDTHS, normalized)
      })
      const isTextSize = /^text-(xs|sm|base|lg|xl|\d+xl)$/.test(nakedCore)
      const isFontUtility = /^font-([\w-]+|\[[^\]]+\])$/.test(nakedCore)
      const nextCore = (hasBreakpoint || isTextSize || isFontUtility) && !core.startsWith('!')
        ? `!${core}`
        : core
      return [...parts, nextCore].join(':')
    }

    const tokenVariants = (token) => {
      if (!token)
        return []
      const variants = new Set([token])
      const parts = token.split(':')
      const core = parts.pop()
      const nakedCore = core.startsWith('!') ? core.slice(1) : core
      variants.add([...parts, nakedCore].join(':'))
      variants.add([...parts, `!${nakedCore}`].join(':'))
      return Array.from(variants).filter(Boolean)
    }

    const mapRuntimeTokens = (rawValue) => {
      const mapped = toVarBackedUtilities(rawValue, props.theme)
      return toClassTokens(mapped).map(normalizeRuntimeToken)
    }

    const replaceClassTokens = (el, currentTokens, nextTokens) => {
      if (!el)
        return nextTokens
      currentTokens
        .flatMap(tokenVariants)
        .forEach(token => el.classList.remove(token))
      const normalizedNextTokens = (nextTokens || []).map(normalizeRuntimeToken)
      normalizedNextTokens.forEach(token => el.classList.add(token))
      return normalizedNextTokens
    }

    const getAncestorElements = (el) => {
      const ancestors = []
      let parent = el?.parentElement || null
      while (parent && parent !== document.body && parent !== document.documentElement) {
        ancestors.push(parent)
        parent = parent.parentElement
      }
      return ancestors
    }

    const isScrollableElement = (el) => {
      if (!el || typeof window?.getComputedStyle !== 'function')
        return false
      const styles = window.getComputedStyle(el)
      const overflowY = styles?.overflowY || ''
      const overflow = styles?.overflow || ''
      return /(auto|scroll|overlay)/.test(overflowY) || /(auto|scroll|overlay)/.test(overflow)
    }

    const collectScrollTargets = (el) => {
      const targets = [window, document, document.documentElement, document.body]
      const ancestors = getAncestorElements(el)
      ancestors.forEach((ancestor) => {
        if (isScrollableElement(ancestor))
          targets.push(ancestor)
      })
      return Array.from(new Set(targets.filter(Boolean)))
    }

    const resolvePosition = () => {
      const attrValue = String(root.getAttribute('data-cms-nav-position') || '').trim().toLowerCase()
      if (attrValue === 'left' || attrValue === 'center' || attrValue === 'right')
        return attrValue
      if (root.classList.contains('cms-nav-pos-left'))
        return 'left'
      if (root.classList.contains('cms-nav-pos-center'))
        return 'center'
      return 'right'
    }

    const position = resolvePosition()
    const openClass = root.getAttribute('data-cms-nav-open-class') || 'is-open'
    const panel = root.querySelector('.cms-nav-panel, [data-cms-nav-panel]')
    const overlay = root.querySelector('.cms-nav-overlay, [data-cms-nav-overlay]')
    const toggles = Array.from(root.querySelectorAll('.cms-nav-toggle, [data-cms-nav-toggle]'))
    const closeButtons = Array.from(root.querySelectorAll('.cms-nav-close, [data-cms-nav-close]'))
    const links = Array.from(root.querySelectorAll('.cms-nav-link, [data-cms-nav-link]'))
    const closeOnLink = root.getAttribute('data-cms-nav-close-on-link') !== 'false'
    const navMain = root.querySelector('.cms-nav-main, [data-cms-nav-main], nav')
    const navRow = root.querySelector('.cms-nav-layout, [data-cms-nav-layout], nav > div > div')
    const desktopWrap = root.querySelector('.cms-nav-desktop, [data-cms-nav-desktop]')
      || navRow?.children?.[1]
      || null
    const logoLink = root.querySelector('.cms-nav-logo, [data-cms-nav-logo]')
      || navRow?.querySelector('a')
      || null
    const panelHiddenClass = position === 'left' ? '-translate-x-full' : 'translate-x-full'
    const previewSurface = root.closest('[data-cms-preview-surface]')
    const shouldContainFixedInPreview = Boolean(previewSurface)
    const stickyEnabled = root.classList.contains('cms-nav-sticky') || parseBoolean(root.getAttribute('data-cms-nav-sticky'))
    const getPreviewMode = () => String(previewSurface?.getAttribute('data-cms-preview-mode') || 'preview').toLowerCase()
    const shouldPinInsidePreview = () => shouldContainFixedInPreview && getPreviewMode() === 'preview' && stickyEnabled
    const hideOnDown = root.classList.contains('cms-nav-hide-on-down') || parseBoolean(root.getAttribute('data-cms-nav-hide-on-down'))
    const scrollThreshold = Number(root.getAttribute('data-cms-nav-scroll-threshold') || 10)
    const hideThreshold = Number(root.getAttribute('data-cms-nav-hide-threshold') || 80)
    const hideDelta = Number(root.getAttribute('data-cms-nav-hide-delta') || 6)
    const topNavClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-top-class') || '')
    const scrolledNavClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-scrolled-class') || '')
    const topRowClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-top-row-class') || '')
    const scrolledRowClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-scrolled-row-class') || '')
    const hiddenClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-hidden-class') || '-translate-y-full opacity-0')
    const visibleClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-visible-class') || 'translate-y-0 opacity-100')
    const transitionClassTokens = mapRuntimeTokens(root.getAttribute('data-cms-nav-transition-class') || 'transition-all duration-300')
    const resolvePreviewPinAnchor = () => {
      if (!previewSurface)
        return null
      const candidates = getAncestorElements(previewSurface).filter(isScrollableElement)
      const scrollingCandidate = candidates.find(el => (el.scrollHeight - el.clientHeight) > 1)
      return scrollingCandidate || candidates[0] || previewSurface
    }
    const resolvePreviewScrollTarget = () => {
      if (!previewSurface)
        return null
      if (isScrollableElement(previewSurface) && (previewSurface.scrollHeight - previewSurface.clientHeight) > 1)
        return previewSurface
      const candidates = getAncestorElements(previewSurface).filter(isScrollableElement)
      const scrollingCandidate = candidates.find(el => (el.scrollHeight - el.clientHeight) > 1)
      return scrollingCandidate || candidates[0] || previewSurface
    }
    const previewPinAnchor = resolvePreviewPinAnchor()
    const previewScrollTarget = resolvePreviewScrollTarget()
    const scrollTargets = shouldContainFixedInPreview
      ? Array.from(new Set([previewScrollTarget, previewPinAnchor, previewSurface].filter(Boolean)))
      : collectScrollTargets(root)
    const windowScrollY = () => window.scrollY || document.documentElement.scrollTop || 0
    const readScrollY = () => {
      if (shouldContainFixedInPreview) {
        const scopedTarget = previewScrollTarget || previewSurface
        if (scopedTarget && typeof scopedTarget.scrollTop === 'number')
          return Number(scopedTarget.scrollTop || 0)
      }
      let maxScrollY = windowScrollY()
      scrollTargets.forEach((target) => {
        if (!target || target === window || target === document)
          return
        const current = Number(target.scrollTop || 0)
        if (current > maxScrollY)
          maxScrollY = current
      })
      return maxScrollY
    }

    const readPinAnchorTop = () => {
      if (!previewPinAnchor || typeof previewPinAnchor.getBoundingClientRect !== 'function')
        return 0
      return Math.round(previewPinAnchor.getBoundingClientRect().top)
    }

    let appliedNavTokens = []
    let appliedRowTokens = []
    let appliedVisibilityTokens = []
    let lastScrollY = readScrollY()
    let pinnedViewportTop = null
    let pinnedOffsetFromSurface = null
    const resolvePinnedTop = () => {
      const anchorTop = readPinAnchorTop()
      const rootTop = Math.round(root.getBoundingClientRect().top)
      const measuredOffset = Math.max(0, rootTop - anchorTop)
      if (pinnedOffsetFromSurface == null) {
        pinnedOffsetFromSurface = measuredOffset
      }
      pinnedViewportTop = Math.max(anchorTop + pinnedOffsetFromSurface, anchorTop, 0)
      return pinnedViewportTop
    }
    if (shouldPinInsidePreview())
      pinnedViewportTop = resolvePinnedTop()

    if (navRow) {
      navRow.classList.remove('flex-row', 'flex-row-reverse', 'justify-between', 'justify-center', 'flex-wrap', 'flex-wrap-reverse')
      navRow.classList.add('flex', 'flex-nowrap', 'items-center', 'gap-6')
      if (position === 'left') {
        navRow.classList.add('flex-row-reverse', 'justify-between')
      }
      else if (position === 'center') {
        navRow.classList.add('flex-row', 'justify-center')
      }
      else {
        navRow.classList.add('flex-row', 'justify-between')
      }
    }

    if (logoLink) {
      logoLink.classList.remove('mr-6')
      if (position === 'center')
        logoLink.classList.add('mr-6')
    }

    if (desktopWrap) {
      desktopWrap.classList.remove('ml-auto', 'md:flex-1', 'md:pl-6', 'items-center', 'gap-6')
      if (position === 'left') {
        desktopWrap.classList.add('md:flex-1', 'md:pl-6')
      }
      else if (position === 'center') {
        desktopWrap.classList.add('items-center', 'gap-6')
      }
      else {
        desktopWrap.classList.add('ml-auto')
      }
    }

    const applyNavPinMode = () => {
      if (!stickyEnabled || !navMain)
        return
      if (shouldPinInsidePreview()) {
        // Pin to viewport with explicit left/width so it stays within preview surface.
        navMain.classList.remove('sticky', 'inset-x-0')
        navMain.classList.add('fixed', 'top-0')
      }
      else {
        // In non-preview CMS modes (edit), let nav render in-flow.
        if (shouldContainFixedInPreview) {
          navMain.classList.remove('fixed', 'sticky', 'inset-x-0', 'top-0')
        }
        else {
          navMain.classList.remove('sticky')
          navMain.classList.add('fixed', 'inset-x-0', 'top-0')
        }
      }
    }
    applyNavPinMode()

    const clearPinnedPreviewPosition = () => {
      if (!navMain)
        return
      navMain.style.left = ''
      navMain.style.width = ''
      navMain.style.right = ''
      navMain.style.top = ''
      navMain.style.bottom = ''
    }

    const updatePinnedPreviewPosition = () => {
      if (!shouldPinInsidePreview() || !navMain || !previewSurface)
        return
      const surfaceRect = previewSurface.getBoundingClientRect()
      if (pinnedViewportTop == null)
        pinnedViewportTop = resolvePinnedTop()
      navMain.style.left = `${Math.round(surfaceRect.left)}px`
      navMain.style.width = `${Math.round(surfaceRect.width)}px`
      navMain.style.right = 'auto'
      navMain.style.bottom = 'auto'
      navMain.style.top = `${pinnedViewportTop}px`
    }

    if (navMain && transitionClassTokens.length) {
      transitionClassTokens.forEach(token => navMain.classList.add(token))
    }

    const markInteractive = (el) => {
      if (!el)
        return
      el.setAttribute('data-cms-interactive', 'true')
    }

    toggles.forEach(markInteractive)
    closeButtons.forEach(markInteractive)
    links.forEach(markInteractive)
    markInteractive(panel)
    markInteractive(overlay)

    const isOpen = () => root.classList.contains(openClass)

    const setScrolledState = (isScrolled) => {
      root.classList.toggle('cms-nav-scrolled', isScrolled)
      root.setAttribute('data-cms-nav-scrolled', isScrolled ? 'true' : 'false')
      appliedNavTokens = replaceClassTokens(navMain, appliedNavTokens, isScrolled ? scrolledNavClassTokens : topNavClassTokens)
      appliedRowTokens = replaceClassTokens(navRow, appliedRowTokens, isScrolled ? scrolledRowClassTokens : topRowClassTokens)
    }

    const setVisibilityState = (isHidden) => {
      root.classList.toggle('cms-nav-hidden', isHidden)
      root.setAttribute('data-cms-nav-hidden', isHidden ? 'true' : 'false')
      appliedVisibilityTokens = replaceClassTokens(navMain, appliedVisibilityTokens, isHidden ? hiddenClassTokens : visibleClassTokens)
    }

    const handleScroll = () => {
      const currentScrollY = readScrollY()
      const isScrolled = currentScrollY > scrollThreshold
      setScrolledState(isScrolled)
      updatePinnedPreviewPosition()

      if (hideOnDown && navMain) {
        const delta = currentScrollY - lastScrollY
        const absDelta = Math.abs(delta)
        if (currentScrollY <= hideThreshold) {
          setVisibilityState(false)
        }
        else if (absDelta >= hideDelta) {
          setVisibilityState(delta > 0)
        }
      }
      else {
        setVisibilityState(false)
      }

      lastScrollY = currentScrollY
    }

    const setOpen = (open) => {
      root.classList.toggle(openClass, open)
      root.setAttribute('data-cms-nav-open', open ? 'true' : 'false')

      toggles.forEach((btn) => {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      })

      if (panel) {
        panel.classList.remove('left-0', 'right-0', 'right-auto', 'left-auto', 'translate-x-full', '-translate-x-full')
        if (position === 'left') {
          panel.classList.add('left-0', 'right-auto')
        }
        else {
          panel.classList.add('right-0', 'left-auto')
        }

        panel.classList.toggle('translate-x-0', open)
        panel.classList.toggle('opacity-100', open)
        panel.classList.toggle('pointer-events-auto', open)
        panel.classList.toggle(panelHiddenClass, !open)
        panel.classList.toggle('opacity-0', !open)
        panel.classList.toggle('pointer-events-none', !open)
        panel.setAttribute('aria-hidden', open ? 'false' : 'true')
      }

      if (overlay) {
        overlay.classList.toggle('opacity-100', open)
        overlay.classList.toggle('pointer-events-auto', open)
        overlay.classList.toggle('opacity-0', !open)
        overlay.classList.toggle('pointer-events-none', !open)
        overlay.setAttribute('aria-hidden', open ? 'false' : 'true')
      }
    }

    setOpen(root.classList.contains(openClass) || root.getAttribute('data-cms-nav-open') === 'true')
    handleScroll()
    if (shouldPinInsidePreview())
      updatePinnedPreviewPosition()
    else
      clearPinnedPreviewPosition()

    toggles.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOpen(!isOpen())
      })
    })

    closeButtons.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      })
    })

    if (overlay) {
      overlay.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      })
    }

    if (closeOnLink) {
      links.forEach((link) => {
        link.addEventListener('click', () => {
          setOpen(false)
        })
      })
    }

    const scrollListeners = scrollTargets
    scrollListeners.forEach((target) => {
      target.addEventListener('scroll', handleScroll, { passive: true })
    })
    let previewModeObserver = null
    let previewSurfaceObserver = null
    let previewSurfaceAttrObserver = null
    let pinSyncRaf = 0
    const schedulePinnedPositionSync = () => {
      if (pinSyncRaf)
        cancelAnimationFrame(pinSyncRaf)
      pinSyncRaf = requestAnimationFrame(() => {
        pinSyncRaf = 0
        updatePinnedPreviewPosition()
      })
    }
    const handlePreviewModeMutation = () => {
      pinnedViewportTop = null
      pinnedOffsetFromSurface = null
      applyNavPinMode()
      if (shouldPinInsidePreview()) {
        updatePinnedPreviewPosition()
      }
      else {
        clearPinnedPreviewPosition()
      }
      handleScroll()
    }
    if (previewSurface) {
      previewModeObserver = new MutationObserver((entries) => {
        if (entries.some(entry => entry.type === 'attributes' && entry.attributeName === 'data-cms-preview-mode'))
          handlePreviewModeMutation()
      })
      previewModeObserver.observe(previewSurface, {
        attributes: true,
        attributeFilter: ['data-cms-preview-mode'],
      })
      // Viewport-mode switches change preview width/position without a window resize.
      // Keep fixed nav left/width aligned to the preview surface as it transitions.
      if (typeof ResizeObserver !== 'undefined') {
        previewSurfaceObserver = new ResizeObserver(() => {
          schedulePinnedPositionSync()
        })
        previewSurfaceObserver.observe(previewSurface)
        if (previewPinAnchor && previewPinAnchor !== previewSurface)
          previewSurfaceObserver.observe(previewPinAnchor)
      }
      previewSurfaceAttrObserver = new MutationObserver((entries) => {
        if (entries.some(entry => entry.type === 'attributes' && (entry.attributeName === 'class' || entry.attributeName === 'style')))
          schedulePinnedPositionSync()
      })
      previewSurfaceAttrObserver.observe(previewSurface, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
      previewSurface.addEventListener('transitionrun', schedulePinnedPositionSync)
      previewSurface.addEventListener('transitionstart', schedulePinnedPositionSync)
      previewSurface.addEventListener('transitionend', schedulePinnedPositionSync)
      previewSurface.addEventListener('transitioncancel', schedulePinnedPositionSync)
    }
    const handleResize = () => {
      if (shouldPinInsidePreview() && pinnedViewportTop == null)
        pinnedViewportTop = resolvePinnedTop()
      updatePinnedPreviewPosition()
    }
    window.addEventListener('resize', handleResize, { passive: true })

    scope.__cmsNavCleanupFns.push(() => {
      scrollListeners.forEach((target) => {
        target.removeEventListener('scroll', handleScroll)
      })
      window.removeEventListener('resize', handleResize)
      if (previewModeObserver)
        previewModeObserver.disconnect()
      if (previewSurfaceObserver)
        previewSurfaceObserver.disconnect()
      if (previewSurfaceAttrObserver)
        previewSurfaceAttrObserver.disconnect()
      if (previewSurface) {
        previewSurface.removeEventListener('transitionrun', schedulePinnedPositionSync)
        previewSurface.removeEventListener('transitionstart', schedulePinnedPositionSync)
        previewSurface.removeEventListener('transitionend', schedulePinnedPositionSync)
        previewSurface.removeEventListener('transitioncancel', schedulePinnedPositionSync)
      }
      if (pinSyncRaf)
        cancelAnimationFrame(pinSyncRaf)
      clearPinnedPreviewPosition()
    })
  })
}

function renderSafeHtml(content) {
  if (hostEl.value) {
    // The HTML is already in the DOM via v-html; just (re)wire behaviors
    initEmblaCarousels(hostEl.value)
    initCmsNavHelpers(hostEl.value)
  }
}

function normalizeTheme(input = {}) {
  const t = input || {}
  const ext = t.extend || {}
  return {
    colors: ext.colors || {},
    fontFamily: ext.fontFamily || {},
    fontSize: ext.fontSize || {},
    borderRadius: ext.borderRadius || {},
    boxShadow: ext.boxShadow || {},
    apply: (t.apply || {}),
    slots: (t.slots || {}),
    variants: (t.variants || {}),
  }
}

function setScopedThemeVars(scopeEl, theme) {
  if (!scopeEl)
    return
  // ensure a stable scope attribute so the style can target only this block
  if (!scopeEl.hasAttribute('data-theme-scope')) {
    scopeEl.setAttribute('data-theme-scope', Math.random().toString(36).slice(2))
  }
  const scopeId = scopeEl.getAttribute('data-theme-scope')

  const sheetId = `htmlcontent-theme-${scopeId}`
  let styleEl = document.getElementById(sheetId)
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = sheetId
    document.head.appendChild(styleEl)
  }

  styleEl.textContent = buildScopedThemeCSS(theme, scopeId)
}

// Convert utility tokens like text-brand/bg-surface/rounded-xl/shadow-card
// into variable-backed arbitrary values so we don't need to mutate Uno's theme.

function toVarBackedUtilities(classList, theme) {
  if (!classList)
    return ''
  const tokens = normalizeTheme(theme)
  const colorKeys = new Set(Object.keys(tokens.colors))
  const radiusKeys = new Set(Object.keys(tokens.borderRadius))
  const shadowKeys = new Set(Object.keys(tokens.boxShadow))

  return classList
    .split(/\s+/)
    .filter(Boolean)
    .map((cls) => {
      // colors: text-*, bg-*, border-* mapped when key exists
      const colorMatch = /^(text|bg|border)-(.*)$/.exec(cls)
      if (colorMatch) {
        const [, kind, rawKey] = colorMatch

        // support opacity suffix: bg-secondary/50, text-primary/80, etc.
        let key = rawKey
        let opacity = null
        const alphaMatch = /^(.+)\/(\d{1,3})$/.exec(rawKey)
        if (alphaMatch) {
          key = alphaMatch[1]
          opacity = alphaMatch[2]
        }

        if (colorKeys.has(key)) {
          const varRef = cssVarRef('color', key)

          // no /opacity → plain var()
          if (!opacity) {
            if (kind === 'text')
              return `text-[${varRef}]`
            if (kind === 'bg')
              return `bg-[${varRef}]`
            if (kind === 'border')
              return `border-[${varRef}]`
          }

          // with /opacity → use slash opacity on arbitrary value
          if (kind === 'text')
            return `text-[${varRef}]/${opacity}`
          if (kind === 'bg')
            return `bg-[${varRef}]/${opacity}`
          if (kind === 'border')
            return `border-[${varRef}]/${opacity}`

          return cls
        }

        return cls
      }

      // radius
      const radiusMatch = /^rounded-(.*)$/.exec(cls)
      if (radiusMatch) {
        const key = radiusMatch[1]
        if (radiusKeys.has(key))
          return `rounded-[${cssVarRef('radius', key)}]`
        return cls
      }

      // shadow
      const shadowMatch = /^shadow-(.*)$/.exec(cls)
      if (shadowMatch) {
        const key = shadowMatch[1]
        if (shadowKeys.has(key))
          return `shadow-[${cssVarRef('shadow', key)}]`
        return cls
      }

      // font families via root apply, including custom keys like "brand"
      if (cls === 'font-sans')
        return `font-[${cssVarRef('font', 'sans')}]`
      if (cls === 'font-serif')
        return `font-[${cssVarRef('font', 'serif')}]`
      if (cls === 'font-mono')
        return `font-[${cssVarRef('font', 'mono')}]`

      const ffMatch = /^font-([\w-]+)$/.exec(cls)
      if (ffMatch) {
        const key = ffMatch[1]
        if (Object.prototype.hasOwnProperty.call(tokens.fontFamily, key))
          return `font-[${cssVarRef('font', key)}]`
      }

      return cls
    })
    .join(' ')
}

function readElementClass(el) {
  if (!el)
    return ''
  if (typeof el.className === 'string')
    return el.className
  if (el.className && typeof el.className.baseVal === 'string')
    return el.className.baseVal
  return el.getAttribute('class') || ''
}

function writeElementClass(el, nextClass = '') {
  if (!el)
    return
  const normalized = typeof nextClass === 'string' ? nextClass : String(nextClass || '')
  if (typeof el.className === 'string') {
    el.className = normalized
    return
  }
  el.setAttribute('class', normalized)
}

function appendElementClasses(el, classList) {
  const additions = typeof classList === 'string' ? classList.trim() : ''
  if (!additions)
    return
  const base = readElementClass(el)
  writeElementClass(el, `${base} ${additions}`.trim())
}

function applyThemeClasses(scopeEl, theme, variant = 'light', isolated = true) {
  if (!scopeEl)
    return
  const t = normalizeTheme(theme)
  // merge base + variant overrides for apply & slots
  const v = (t.variants && t.variants[variant]) || {}
  const apply = { ...(t.apply || {}), ...(v.apply || {}) }
  const slots = JSON.parse(JSON.stringify(t.slots || {}))
  if (v.slots) {
    // shallow merge per slot key
    Object.entries(v.slots).forEach(([slotKey, obj]) => {
      slots[slotKey] = { ...(slots[slotKey] || {}), ...obj }
    })
  }

  // Root classes
  if (apply.root) {
    const mapped = toVarBackedUtilities(apply.root, t)
    if (isolated) {
      writeElementClass(scopeEl, `block-content ${mapped}`.trim())
    }
    else {
      const applied = (scopeEl.dataset.themeRootClasses || '').split(/\s+/).filter(Boolean)
      applied.forEach(cls => scopeEl.classList.remove(cls))
      const next = mapped.split(/\s+/).filter(Boolean)
      next.forEach(cls => scopeEl.classList.add(cls))
      scopeEl.classList.add('block-content')
      if (next.length)
        scopeEl.dataset.themeRootClasses = next.join(' ')
      else
        delete scopeEl.dataset.themeRootClasses
    }
  }

  // Optional convenience: map a few generic applies
  if (apply.link) {
    scopeEl.querySelectorAll('a').forEach((el) => {
      appendElementClasses(el, toVarBackedUtilities(apply.link, t))
    })
  }
  if (apply.heading) {
    scopeEl.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => {
      appendElementClasses(el, toVarBackedUtilities(apply.heading, t))
    })
  }
  if (apply.button) {
    scopeEl.querySelectorAll('button,[data-theme="button"]').forEach((el) => {
      appendElementClasses(el, toVarBackedUtilities(apply.button, t))
    })
  }
  if (apply.badge) {
    scopeEl.querySelectorAll('[data-theme="badge"]').forEach((el) => {
      appendElementClasses(el, toVarBackedUtilities(apply.badge, t))
    })
  }

  // Slot-based mapping via data-slot attributes
  const mapSlot = (slotBase, obj) => {
    if (!obj)
      return
    Object.entries(obj).forEach(([part, classes]) => {
      const sel = `[data-slot="${slotBase}.${part}"]`
      scopeEl.querySelectorAll(sel).forEach((el) => {
        appendElementClasses(el, toVarBackedUtilities(classes, t))
      })
    })
  }
  Object.entries(slots).forEach(([slotKey, val]) => {
    mapSlot(slotKey, val)
  })
}

// Add new helper to rewrite arbitrary class tokens with responsive and state prefixes
const BREAKPOINT_MIN_WIDTHS = {
  'sm': 640,
  'md': 768,
  'lg': 1024,
  'xl': 1280,
  '2xl': 1536,
}

const VIEWPORT_WIDTHS = {
  auto: null,
  full: null,
  large: 1280,
  medium: 992,
  mobile: 480,
}

const viewportModeToWidth = (mode) => {
  if (!mode)
    return null
  if (Object.prototype.hasOwnProperty.call(VIEWPORT_WIDTHS, mode))
    return VIEWPORT_WIDTHS[mode]
  return null
}

function rewriteAllClasses(scopeEl, theme, isolated = true, viewportMode = 'auto') {
  if (!scopeEl)
    return
  // Utility regex for Uno/Tailwind classes
  const utilRe = /^-?([pmwhz]|px|py|pt|pr|pb|pl|mx|my|mt|mr|mb|ml|text|font|leading|tracking|bg|border|rounded|shadow|min-w|max-w|min-h|max-h|object|overflow|opacity|order|top|right|bottom|left|inset|translate|rotate|scale|skew|origin|grid|flex|items|justify|content|place|gap|space|columns|col|row|aspect|ring|outline|decoration|underline|line-through|no-underline|whitespace|break|truncate|sr-only|not-sr-only|cursor|select|duration|ease|delay|transition|animate)(-|$|\[)/
  // Mark utility classes as important so block-level styles win over parents.
  const importantify = (core) => {
    if (!core || core.startsWith('!'))
      return core
    // Avoid importantifying custom structural classes/hooks
    if (core === 'block-content' || core.startsWith('embla'))
      return core
    // If it's a typical utility or an arbitrary utility, make it important.
    if (utilRe.test(core) || core.includes('[')) {
      return `!${core}`
    }
    return core
  }
  const forcedWidth = viewportModeToWidth(viewportMode)

  const TEXT_SIZE_RE = /^text-(xs|sm|base|lg|xl|\d+xl)$/
  const FONT_UTILITY_RE = /^font-([\w-]+|\[[^\]]+\])$/

  const mapToken = (token) => {
    const parts = token.split(':')
    const core = parts.pop()
    const nakedCore = core.startsWith('!') ? core.slice(1) : core

    //
    // AUTO MODE: no breakpoint *simulation*, but we still:
    // - map theme utilities
    // - !important text sizes
    // - !important breakpoint-based utilities (sm:, md:, lg:, etc.)
    //
    if (forcedWidth == null) {
      let hadBreakpoint = false
      const nextParts = []

      for (const part of parts) {
        const normalized = part.replace(/^!/, '')
        if (Object.prototype.hasOwnProperty.call(BREAKPOINT_MIN_WIDTHS, normalized)) {
          hadBreakpoint = true
        }
        nextParts.push(part)
      }

      const mappedCore = toVarBackedUtilities(core, theme)
      const isTextSize = TEXT_SIZE_RE.test(nakedCore)
      const isFontUtility = FONT_UTILITY_RE.test(nakedCore)
      const shouldImportant = hadBreakpoint || isTextSize || isFontUtility
      const finalCore = shouldImportant ? importantify(mappedCore) : mappedCore

      return [...nextParts, finalCore].filter(Boolean).join(':')
    }

    //
    // SIZED MODES (mobile/medium/large/full): your existing branch stays as-is
    //
    let drop = false
    let hadBreakpoint = false
    const nextParts = []

    for (const part of parts) {
      const normalized = part.replace(/^!/, '')

      if (Object.prototype.hasOwnProperty.call(BREAKPOINT_MIN_WIDTHS, normalized)) {
        hadBreakpoint = true
        const minWidth = BREAKPOINT_MIN_WIDTHS[normalized]

        if (forcedWidth >= minWidth) {
        // We are "inside" this breakpoint → strip the prefix
          continue
        }

        // Too small for this breakpoint → drop the whole token
        drop = true
        break
      }

      nextParts.push(part)
    }

    if (drop)
      return ''

    const mappedCore = toVarBackedUtilities(core, theme)
    const isTextSize = TEXT_SIZE_RE.test(nakedCore)
    const isFontUtility = FONT_UTILITY_RE.test(nakedCore)
    const shouldImportant = hadBreakpoint || isTextSize || isFontUtility
    const finalCore = shouldImportant ? importantify(mappedCore) : mappedCore

    return [...nextParts, finalCore].filter(Boolean).join(':')
  }

  scopeEl.querySelectorAll('[class]').forEach((el) => {
    let base = el.dataset.viewportBaseClass
    if (typeof base !== 'string') {
      base = readElementClass(el)
      el.dataset.viewportBaseClass = base
    }
    const orig = typeof base === 'string' ? base : String(base || '')
    if (!orig.trim())
      return
    const origTokens = orig.split(/\s+/).filter(Boolean)
    const mappedTokens = origTokens
      .map(mapToken)
      .filter(Boolean)
    if (isolated) {
      const mapped = mappedTokens.join(' ')
      writeElementClass(el, mapped)
      return
    }

    const prevApplied = (el.dataset.themeAugmentedClasses || '').split(/\s+/).filter(Boolean)
    if (prevApplied.length)
      prevApplied.forEach(cls => el.classList.remove(cls))

    const additions = mappedTokens.filter(cls => cls && !origTokens.includes(cls))
    additions.forEach(cls => el.classList.add(cls))

    if (additions.length)
      el.dataset.themeAugmentedClasses = additions.join(' ')
    else
      delete el.dataset.themeAugmentedClasses
  })
}

onMounted(async () => {
  await ensureUnoRuntime()

  // Apply global theme once (keeps one style tag for vars; blocks can still override locally if needed)
  // setGlobalThemeVars(props.theme)
  setScopedThemeVars(hostEl.value, props.theme)
  // If you later need per-block overrides, keep the next line; otherwise, it can be omitted.
  // setScopedThemeVars(hostEl.value, normalizeTheme(props.theme))
  applyThemeClasses(hostEl.value, props.theme, (props.theme && props.theme.variant) || 'light')
  rewriteAllClasses(hostEl.value, props.theme, props.isolated, props.viewportMode)
  // Initialize behaviors after class rewriting so helpers use final class state.
  initEmblaCarousels(hostEl.value)
  initCmsNavHelpers(hostEl.value)
  await nextTick()
  hasMounted = true
  notifyLoaded()
})

watch(
  () => props.html,
  async (val) => {
    // Wait for DOM to reflect new v-html, then (re)wire behaviors and class mappings
    await nextTick()
    // setGlobalThemeVars(props.theme)
    setScopedThemeVars(hostEl.value, props.theme)

    applyThemeClasses(hostEl.value, props.theme, (props.theme && props.theme.variant) || 'light')
    rewriteAllClasses(hostEl.value, props.theme, props.isolated, props.viewportMode)
    initEmblaCarousels(hostEl.value)
    initCmsNavHelpers(hostEl.value)
    await nextTick()
    notifyLoaded()
  },
)

watch(
  () => props.theme,
  async (val) => {
    // 1) Write scoped CSS variables from the raw theme object
    setScopedThemeVars(hostEl.value, val)
    // 2) Apply classes based on `apply`, `slots`, and optional variants
    applyThemeClasses(hostEl.value, val, (val && val.variant) || 'light')
    rewriteAllClasses(hostEl.value, val, props.isolated, props.viewportMode)
    initCmsNavHelpers(hostEl.value)
    await nextTick()
    notifyLoaded()
  },
  { immediate: true, deep: true },
)

watch(
  () => props.viewportMode,
  async () => {
    await nextTick()
    rewriteAllClasses(hostEl.value, props.theme, props.isolated, props.viewportMode)
    // Viewport button changes can alter preview surface width without a window resize.
    // Reinitialize nav helpers so fixed nav left/width is recalculated immediately.
    initCmsNavHelpers(hostEl.value)
  },
)

onBeforeUnmount(() => {
  if (hostEl.value && Array.isArray(hostEl.value.__cmsNavCleanupFns)) {
    hostEl.value.__cmsNavCleanupFns.forEach((cleanup) => {
      try {
        cleanup()
      }
      catch {}
    })
    hostEl.value.__cmsNavCleanupFns = []
  }
  // UnoCSS runtime attaches globally; no per-component teardown required.
})
</script>

<template>
  <!-- Runtime CSS applies inside this container -->
  <div ref="hostEl" class="block-content" :data-theme-scope="scopeId">
    <component :is="props.comp" v-if="props.comp" />
    <div v-else v-html="safeHtml" />
  </div>
</template>

<style>
p {
  margin-bottom: 1em;
}
</style>
