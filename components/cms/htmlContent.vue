<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'

import initUnocssRuntime, { defineConfig } from '@unocss/runtime'
import presetWind4 from '@unocss/preset-wind4'

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
})

const scopeId = `hc-${Math.random().toString(36).slice(2)}`

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
  Object.entries(colors).forEach(([k, v]) => decls.push(`--color-${k}: ${Array.isArray(v) ? v[0] : v};`))
  Object.entries(fontFamily).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => (x.includes(' ') ? `'${x}'` : x)).join(', ') : v
    decls.push(`--font-${k}: ${val};`)
  })
  Object.entries(fontSize).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const [size, opts] = v
      decls.push(`--font-size-${k}: ${size};`)
      if (opts && opts.lineHeight)
        decls.push(`--line-height-${k}: ${opts.lineHeight};`)
    }
    else {
      decls.push(`--font-size-${k}: ${v};`)
    }
  })
  Object.entries(borderRadius).forEach(([k, v]) => decls.push(`--radius-${k}: ${v};`))
  Object.entries(boxShadow).forEach(([k, v]) => decls.push(`--shadow-${k}: ${v};`))
  return `:root{${decls.join('')}}`
}

function buildScopedThemeCSS(theme, scopeId) {
  const t = normalizeTheme(theme || {})
  const { colors, fontFamily, fontSize, borderRadius, boxShadow } = t
  const decls = []
  Object.entries(colors).forEach(([k, v]) => decls.push(`--color-${k}: ${Array.isArray(v) ? v[0] : v};`))
  Object.entries(fontFamily).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => (x.includes(' ') ? `'${x}'` : x)).join(', ') : v
    decls.push(`--font-${k}: ${val};`)
  })
  Object.entries(fontSize).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const [size, opts] = v
      decls.push(`--font-size-${k}: ${size};`)
      if (opts?.lineHeight)
        decls.push(`--line-height-${k}: ${opts.lineHeight};`)
    }
    else decls.push(`--font-size-${k}: ${v};`)
  })
  Object.entries(borderRadius).forEach(([k, v]) => decls.push(`--radius-${k}: ${v};`))
  Object.entries(boxShadow).forEach(([k, v]) => decls.push(`--shadow-${k}: ${v};`))
  return `[data-theme-scope="${scopeId}"]{${decls.join('')}}`
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

// --- SSR-safe HTML: raw on server, sanitized on client ---
const safeHtml = computed(() => {
  const c = props.html || ''
  if (typeof window === 'undefined')
    return c
  return DOMPurify.sanitize(c, { ADD_ATTR: ['class'] })
})

// Inject theme CSS variables into <head> for SSR + client
useHead(() => ({
  style: [
    { id: 'htmlcontent-theme-global', children: buildScopedThemeCSS(props.theme, scopeId) },
  ],
}))

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
    if (prevBtn)
      prevBtn.addEventListener('click', () => {
        if (loop && !api.canScrollPrev()) {
          const snaps = api.scrollSnapList()
          api.scrollTo(snaps.length - 1)
          return
        }
        api.scrollPrev()
      })
    if (nextBtn)
      nextBtn.addEventListener('click', () => {
        if (loop && !api.canScrollNext()) {
          api.scrollTo(0)
          return
        }
        api.scrollNext()
      })

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

function renderSafeHtml(content) {
  if (hostEl.value) {
    // The HTML is already in the DOM via v-html; just (re)wire behaviors
    initEmblaCarousels(hostEl.value)
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

  // Build CSS custom properties from theme tokens
  const { colors, fontFamily, fontSize, borderRadius, boxShadow } = theme

  const decls = []
  // colors
  Object.entries(colors).forEach(([k, v]) => {
    decls.push(`--color-${k}: ${Array.isArray(v) ? v[0] : v};`)
  })
  // fonts
  Object.entries(fontFamily).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => (x.includes(' ') ? `'${x}'` : x)).join(', ') : v
    decls.push(`--font-${k}: ${val};`)
  })
  // font sizes
  Object.entries(fontSize).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const [size, opts] = v
      decls.push(`--font-size-${k}: ${size};`)
      if (opts && opts.lineHeight)
        decls.push(`--line-height-${k}: ${opts.lineHeight};`)
    }
    else {
      decls.push(`--font-size-${k}: ${v};`)
    }
  })
  // radii
  Object.entries(borderRadius).forEach(([k, v]) => {
    decls.push(`--radius-${k}: ${v};`)
  })
  // shadows
  Object.entries(boxShadow).forEach(([k, v]) => {
    decls.push(`--shadow-${k}: ${v};`)
  })

  styleEl.textContent = `
[data-theme-scope="${scopeId}"]{${decls.join('')}}`
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
        const [, kind, key] = colorMatch
        if (colorKeys.has(key)) {
          if (kind === 'text')
            return `text-[color:var(--color-${key})]`
          if (kind === 'bg')
            return `bg-[var(--color-${key})]`
          if (kind === 'border')
            return `border-[var(--color-${key})]`
        }
        return cls
      }
      // radius
      const radiusMatch = /^rounded-(.*)$/.exec(cls)
      if (radiusMatch) {
        const key = radiusMatch[1]
        if (radiusKeys.has(key))
          return `rounded-[var(--radius-${key})]`
        return cls
      }
      // shadow
      const shadowMatch = /^shadow-(.*)$/.exec(cls)
      if (shadowMatch) {
        const key = shadowMatch[1]
        if (shadowKeys.has(key))
          return `shadow-[var(--shadow-${key})]`
        return cls
      }
      // font families via root apply, including custom keys like "brand"
      if (cls === 'font-sans')
        return 'font-[var(--font-sans)]'
      if (cls === 'font-serif')
        return 'font-[var(--font-serif)]'
      if (cls === 'font-mono')
        return 'font-[var(--font-mono)]'

      // Generic matcher for custom font keys: e.g., font-brand, font-ui, etc.
      const ffMatch = /^font-([a-zA-Z0-9_-]+)$/.exec(cls)
      if (ffMatch) {
        const key = ffMatch[1]
        // Only rewrite if that key exists in theme.extend.fontFamily
        if (Object.prototype.hasOwnProperty.call(tokens.fontFamily, key)) {
          return `font-[var(--font-${key})]`
        }
      }
      return cls
    })
    .join(' ')
}

function applyThemeClasses(scopeEl, theme, variant = 'light') {
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
    scopeEl.className = `block-content ${mapped}`.trim()
  }

  // Optional convenience: map a few generic applies
  if (apply.link) {
    scopeEl.querySelectorAll('a').forEach((el) => {
      el.className = `${el.className} ${toVarBackedUtilities(apply.link, t)}`.trim()
    })
  }
  if (apply.heading) {
    scopeEl.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => {
      el.className = `${el.className} ${toVarBackedUtilities(apply.heading, t)}`.trim()
    })
  }
  if (apply.button) {
    scopeEl.querySelectorAll('button,[data-theme="button"]').forEach((el) => {
      el.className = `${el.className} ${toVarBackedUtilities(apply.button, t)}`.trim()
    })
  }
  if (apply.badge) {
    scopeEl.querySelectorAll('[data-theme="badge"]').forEach((el) => {
      el.className = `${el.className} ${toVarBackedUtilities(apply.badge, t)}`.trim()
    })
  }

  // Slot-based mapping via data-slot attributes
  const mapSlot = (slotBase, obj) => {
    if (!obj)
      return
    Object.entries(obj).forEach(([part, classes]) => {
      const sel = `[data-slot="${slotBase}.${part}"]`
      scopeEl.querySelectorAll(sel).forEach((el) => {
        el.className = `${el.className} ${toVarBackedUtilities(classes, t)}`.trim()
      })
    })
  }
  Object.entries(slots).forEach(([slotKey, val]) => {
    mapSlot(slotKey, val)
  })
}

// Add new helper to rewrite arbitrary class tokens with responsive and state prefixes
function rewriteAllClasses(scopeEl, theme) {
  if (!scopeEl)
    return
  // Utility regex for Uno/Tailwind classes
  const utilRe = /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|text|font|leading|tracking|bg|border|rounded|shadow|w|h|min-w|max-w|min-h|max-h|object|overflow|opacity|z|order|top|right|bottom|left|inset|translate|rotate|scale|skew|origin|grid|flex|items|justify|content|place|gap|space|columns|col|row|aspect|ring|outline|decoration|underline|line-through|no-underline|whitespace|break|truncate|sr-only|not-sr-only|cursor|select|duration|ease|delay|transition|animate)(-|$|\[)/
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
  const mapToken = (token) => {
    // Support responsive/state prefixes like md:hover:bg-brand
    const parts = token.split(':')
    const core = parts.pop()
    const mappedCore = toVarBackedUtilities(core, theme)
    const finalCore = importantify(mappedCore)
    return [...parts, finalCore].join(':')
  }
  scopeEl.querySelectorAll('[class]').forEach((el) => {
    const orig = el.className || ''
    if (!orig)
      return
    const mapped = orig
      .split(/\s+/)
      .filter(Boolean)
      .map(mapToken)
      .join(' ')
    if (mapped !== orig)
      el.className = mapped
  })
}

onMounted(async () => {
  await ensureUnoRuntime()

  // Initialize carousels/behaviors for SSR-inserted HTML
  initEmblaCarousels(hostEl.value)

  // Apply global theme once (keeps one style tag for vars; blocks can still override locally if needed)
  // setGlobalThemeVars(props.theme)
  setScopedThemeVars(hostEl.value, normalizeTheme(props.theme))
  // If you later need per-block overrides, keep the next line; otherwise, it can be omitted.
  // setScopedThemeVars(hostEl.value, normalizeTheme(props.theme))
  applyThemeClasses(hostEl.value, props.theme, (props.theme && props.theme.variant) || 'light')
  rewriteAllClasses(hostEl.value, props.theme)
})

watch(
  () => props.html,
  async (val) => {
    // Wait for DOM to reflect new v-html, then (re)wire behaviors and class mappings
    await nextTick()
    initEmblaCarousels(hostEl.value)
    // setGlobalThemeVars(props.theme)
    setScopedThemeVars(hostEl.value, normalizeTheme(props.theme))
    applyThemeClasses(hostEl.value, props.theme, (props.theme && props.theme.variant) || 'light')
    rewriteAllClasses(hostEl.value, props.theme)
  },
)

watch(
  () => props.theme,
  (val) => {
    const t = normalizeTheme(val)
    // 1) Write CSS variables globally
    // setGlobalThemeVars(t)
    setScopedThemeVars(hostEl.value, t)
    // 2) Apply classes based on `apply`, `slots`, and optional variants
    applyThemeClasses(hostEl.value, t, (val && val.variant) || 'light')
    rewriteAllClasses(hostEl.value, t)
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  // UnoCSS runtime attaches globally; no per-component teardown required.
})
</script>

<template>
  <!-- Runtime CSS applies inside this container -->
  <div ref="hostEl" class="block-content" :data-theme-scope="scopeId" v-html="safeHtml" />
</template>
