<script setup>
import DOMPurify from 'dompurify'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CANVAS_EDITOR_CSS, CANVAS_SRCDOC, buildCanvasSiteCss, buildChromeCss, canvasContentHeight, canvasHeadLinks, collectCanvasClassTokensFromHtml, guardCanvasNavigation, revealCanvasBody, upsertCanvasStyle } from '../../lib/cmsCanvas'
import { syncCmsPreviewAuthState } from '../../lib/cmsPreviewAuthState'

const props = defineProps({
  html: {
    type: String,
    default: '',
  },
  theme: {
    type: Object,
    default: () => ({}),
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
  previewFixedMinHeight: {
    type: String,
    default: '',
  },
  standalonePreview: {
    type: Boolean,
    default: false,
  },
  previewAuthLoggedIn: {
    type: Boolean,
    default: null,
  },
})

const emit = defineEmits(['loaded'])

const SANITIZE_OPTIONS = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: [
    'class',
    'style',
    'src',
    'title',
    'width',
    'height',
    'allow',
    'allowfullscreen',
    'loading',
    'referrerpolicy',
    'sandbox',
    'frameborder',
  ],
}

const themeExtraCSS = computed(() => {
  const value = props.theme?.extraCSS
  return typeof value === 'string' ? value : ''
})

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
  return DOMPurify.sanitize(c, SANITIZE_OPTIONS)
})

async function initEmblaCarousels(scope) {
  if (!scope || !import.meta.client)
    return

  const [{ default: EmblaCarousel }, { default: Autoplay }, { default: Fade }] = await Promise.all([
    import('embla-carousel'),
    import('embla-carousel-autoplay'),
    import('embla-carousel-fade'),
  ])

  if (!scope.isConnected)
    return
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
        const b = scope.ownerDocument.createElement('button')
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

    root._emblaApi = api
  })
}

function initCmsNavHelpers(scope) {
  if (!scope || !import.meta.client)
    return
  // Helpers follow the canvas document and its viewport.
  const document = scope.ownerDocument || globalThis.document
  const window = document.defaultView || globalThis.window

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

    const mapRuntimeTokens = toClassTokens
    const replaceClassTokens = (el, currentTokens, nextTokens) => {
      if (!el)
        return nextTokens
      currentTokens.forEach(token => el.classList.remove(token))
      nextTokens.forEach(token => el.classList.add(token))
      return nextTokens
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
    const forceTopScrollState = props.standalonePreview || root.closest('[data-cms-standalone-preview="true"]')
    const stickyEnabled = root.classList.contains('cms-nav-sticky') || parseBoolean(root.getAttribute('data-cms-nav-sticky'))
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
    const scrollTargets = collectScrollTargets(root)
    const readScrollY = () => {
      if (forceTopScrollState)
        return 0
      return Math.max(window.scrollY || 0, ...scrollTargets.map(target => Number(target.scrollTop || 0)))
    }

    let appliedNavTokens = []
    let appliedRowTokens = []
    let appliedVisibilityTokens = []
    let lastScrollY = readScrollY()
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

    if (navMain && stickyEnabled) {
      navMain.classList.remove('sticky')
      navMain.classList.add('fixed', 'inset-x-0', 'top-0')
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

    const folderEntries = []
    const helperFolders = Array.from(root.querySelectorAll('.cms-nav-folder, [data-cms-nav-folder]'))
    helperFolders.forEach((folder) => {
      folderEntries.push({
        folder,
        toggle: folder.querySelector('.cms-nav-folder-toggle, [data-cms-nav-folder-toggle]'),
        menu: folder.querySelector('.cms-nav-folder-menu, [data-cms-nav-folder-menu]'),
      })
    })

    const fallbackFolders = Array.from(root.querySelectorAll('.cms-nav-desktop li.group, [data-cms-nav-desktop] li.group'))
    fallbackFolders.forEach((folder) => {
      if (folderEntries.some(entry => entry.folder === folder))
        return
      const directChildren = Array.from(folder.children || [])
      const toggle = directChildren.find(child => child?.matches?.('a, button, [role="button"]'))
        || folder.querySelector('a, button, [role="button"]')
      const menu = directChildren.find((child) => {
        if (!child?.matches?.('div.hidden, ul.hidden, [hidden], div.absolute, ul.absolute'))
          return false
        const hasItemLinks = child.querySelectorAll('a, button, [role="button"]').length > 0
        return hasItemLinks
      })
        || folder.querySelector('div.hidden, ul.hidden, [hidden]')
      if (!toggle || !menu)
        return
      folderEntries.push({ folder, toggle, menu })
    })

    const folderCleanupFns = []
    const setFolderOpenState = (folder, menu, open) => {
      folder.classList.toggle('cms-nav-folder-open', open)
      folder.setAttribute('data-cms-nav-folder-open', open ? 'true' : 'false')
      menu.classList.toggle('hidden', !open)
      menu.classList.toggle('block', open)
      menu.classList.toggle('pointer-events-none', !open)
      menu.classList.toggle('pointer-events-auto', open)
    }

    folderEntries.forEach(({ folder, toggle, menu }) => {
      if (!toggle || !menu)
        return

      Array.from(menu.classList).forEach((token) => {
        if (token.startsWith('group-hover:') || token.startsWith('group-focus-within:'))
          menu.classList.remove(token)
      })
      folder.classList.add('cms-nav-folder')
      toggle.classList.add('cms-nav-folder-toggle')
      menu.classList.add('cms-nav-folder-menu')
      markInteractive(toggle)
      markInteractive(menu)
      Array.from(menu.querySelectorAll('a, button, [role="button"]')).forEach(markInteractive)

      let closeTimer = 0
      const clearCloseTimer = () => {
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = 0
        }
      }

      const openFolder = () => {
        clearCloseTimer()
        setFolderOpenState(folder, menu, true)
      }

      const closeFolder = () => {
        clearCloseTimer()
        setFolderOpenState(folder, menu, false)
      }

      const scheduleCloseFolder = () => {
        clearCloseTimer()
        closeTimer = window.setTimeout(() => {
          closeTimer = 0
          setFolderOpenState(folder, menu, false)
        }, 120)
      }

      const onPointerEnter = () => {
        openFolder()
      }

      const onPointerLeave = (event) => {
        const nextTarget = event?.relatedTarget
        if (nextTarget && folder.contains(nextTarget))
          return
        scheduleCloseFolder()
      }

      const onFocusIn = () => {
        openFolder()
      }

      const onFocusOut = (event) => {
        const nextTarget = event?.relatedTarget
        if (nextTarget && folder.contains(nextTarget))
          return
        closeFolder()
      }

      const onToggleClick = (event) => {
        if (event.defaultPrevented)
          return
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches)
          return
        const isOpenNow = folder.getAttribute('data-cms-nav-folder-open') === 'true'
        if (!isOpenNow) {
          event.preventDefault()
          event.stopPropagation()
          openFolder()
          return
        }
        closeFolder()
      }

      const onDocumentClickCapture = (event) => {
        const clickTarget = event?.target
        if (clickTarget && folder.contains(clickTarget))
          return
        closeFolder()
      }

      folder.addEventListener('pointerenter', onPointerEnter)
      folder.addEventListener('pointerleave', onPointerLeave)
      folder.addEventListener('focusin', onFocusIn)
      folder.addEventListener('focusout', onFocusOut)
      toggle.addEventListener('click', onToggleClick)
      document.addEventListener('click', onDocumentClickCapture, true)

      setFolderOpenState(folder, menu, false)

      folderCleanupFns.push(() => {
        clearCloseTimer()
        setFolderOpenState(folder, menu, false)
        folder.removeEventListener('pointerenter', onPointerEnter)
        folder.removeEventListener('pointerleave', onPointerLeave)
        folder.removeEventListener('focusin', onFocusIn)
        folder.removeEventListener('focusout', onFocusOut)
        toggle.removeEventListener('click', onToggleClick)
        document.removeEventListener('click', onDocumentClickCapture, true)
      })
    })

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

    const onToggleClick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      setOpen(!isOpen())
    }
    const onCloseClick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onLinkClick = () => setOpen(false)
    toggles.forEach(btn => btn.addEventListener('click', onToggleClick))
    closeButtons.forEach(btn => btn.addEventListener('click', onCloseClick))
    overlay?.addEventListener('click', onCloseClick)
    if (closeOnLink)
      links.forEach(link => link.addEventListener('click', onLinkClick))

    const scrollListeners = scrollTargets
    scrollListeners.forEach((target) => {
      target.addEventListener('scroll', handleScroll, { passive: true })
    })
    const handleResize = () => handleScroll()
    window.addEventListener('resize', handleResize, { passive: true })

    scope.__cmsNavCleanupFns.push(() => {
      toggles.forEach(btn => btn.removeEventListener('click', onToggleClick))
      closeButtons.forEach(btn => btn.removeEventListener('click', onCloseClick))
      overlay?.removeEventListener('click', onCloseClick)
      if (closeOnLink)
        links.forEach(link => link.removeEventListener('click', onLinkClick))
      folderCleanupFns.forEach((cleanup) => {
        try {
          cleanup()
        }
        catch {}
      })
      scrollListeners.forEach((target) => {
        target.removeEventListener('scroll', handleScroll)
      })
      window.removeEventListener('resize', handleResize)
    })
  })
}

let helperRoot = null
function cleanupPreviewHelpers() {
  if (!helperRoot)
    return
  for (const cleanup of helperRoot.__cmsNavCleanupFns || [])
    cleanup()
  helperRoot.__cmsNavCleanupFns = []
  helperRoot.querySelectorAll('[data-embla]').forEach((root) => {
    root._emblaApi?.destroy()
    delete root._emblaApi
    root.removeAttribute('data-embla')
  })
  helperRoot = null
}

const canvasOptions = inject('edgeCmsCanvas', null)
const pageCanvas = inject('edgeCmsPageCanvas', null)
const inPageCanvas = ref(Boolean(pageCanvas?.active))
const canvasEnabled = computed(() => !inPageCanvas.value)
const canvasFrame = ref(null)
const canvasMount = ref(null)
const canvasHeight = ref(150)
// Thumbnail grids can hold dozens of blocks; a canvas starts when it nears view.
const canvasActive = ref(false)
// What the canvas shows. It only advances once the CSS for it is in place, so
// an edit never flashes unstyled content.
const canvasHtml = ref('')
let canvasRun = 0
let canvasCleanups = []

const canvasRoot = () => (canvasEnabled.value ? canvasMount.value : hostEl.value)

// A fixed-position element (nav panel, modal) fills the frame's viewport, so a
// frame sized to its content would clip it. Editors that preview one block at a
// time (the block editor) provide a minimum height for that case.
const canvasHasFixed = ref(false)
const canvasMinHeight = computed(() => (canvasHasFixed.value && (props.previewFixedMinHeight || canvasOptions?.fixedMinHeight)) || null)

// Device widths render at their true size and scale down to fit, so the block's
// own breakpoints respond (no class rewriting).
const CANVAS_VIEWPORT_WIDTHS = { large: 1280, medium: 992, mobile: 420 }
const canvasAvailableWidth = ref(0)
const canvasViewportWidth = computed(() => CANVAS_VIEWPORT_WIDTHS[props.viewportMode] || 0)
const canvasScale = computed(() => {
  const target = canvasViewportWidth.value
  const available = canvasAvailableWidth.value
  if (!target || !available || target <= available)
    return 1
  return Math.max(0.1, available / target)
})
const canvasFrameStyle = computed(() => ({
  width: canvasViewportWidth.value ? `${canvasViewportWidth.value}px` : '100%',
  height: `${canvasHeight.value}px`,
  minHeight: canvasMinHeight.value,
  zoom: canvasScale.value === 1 ? null : canvasScale.value,
}))

// Theme fonts: the editor's theme head when provided, otherwise the font
// stylesheets the Hub page already loaded for this theme.
const canvasHead = () => {
  if (canvasOptions?.head?.link?.length)
    return canvasOptions.head
  const link = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]'))
    .filter(el => /fonts\.googleapis|fonts\.gstatic|typekit|files\.edgemarketingdesign\.com/.test(el.href))
    .map(el => ({ rel: el.rel, href: el.href, ...(el.hasAttribute('crossorigin') ? { crossorigin: el.getAttribute('crossorigin') } : {}) }))
  return { link }
}

async function writeCanvasCss(html) {
  const doc = canvasFrame.value?.contentDocument
  if (!doc?.head)
    return false
  const run = ++canvasRun
  const css = await buildCanvasSiteCss(collectCanvasClassTokensFromHtml(html), props.theme, themeExtraCSS.value)
  if (run !== canvasRun)
    return false
  upsertCanvasStyle(doc, 'cms-canvas-site-css', css)
  return true
}

function detectCanvasFixed() {
  const win = canvasFrame.value?.contentWindow
  if (!win || !canvasMount.value)
    return
  canvasHasFixed.value = Array.from(canvasMount.value.querySelectorAll('*'))
    .some(el => win.getComputedStyle(el).position === 'fixed')
}

function syncCanvasHeight() {
  const doc = canvasFrame.value?.contentDocument
  if (!doc?.documentElement)
    return
  const next = canvasContentHeight(doc)
  if (next && Math.abs(next - canvasHeight.value) > 1)
    canvasHeight.value = next
}

// DOM events inside the iframe don't reach ancestors in the Hub document, so
// clicks are re-dispatched on the iframe element. The original target is kept
// so block.vue's selector checks still see the element that was clicked.
function forwardCanvasClick(event) {
  const frameEl = canvasFrame.value
  if (!frameEl)
    return
  const proxy = new MouseEvent(event.type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  })
  Object.defineProperty(proxy, 'target', { value: event.target })
  frameEl.dispatchEvent(proxy)
  if (proxy.defaultPrevented)
    event.preventDefault()
  if (proxy.cancelBubble)
    event.stopPropagation()
}

// Hub components teleported into this canvas (the publication viewer) need the
// Hub's styles; added only when present, so thumbnail frames stay light.
function syncCanvasChromeCss() {
  const doc = canvasFrame.value?.contentDocument
  if (doc && canvasMount.value?.querySelector('[data-cms-chrome]'))
    upsertCanvasStyle(doc, 'cms-canvas-chrome-css', buildChromeCss(document))
}

async function showCanvasContent() {
  const html = safeHtml.value
  if (!(await writeCanvasCss(html)))
    return
  cleanupPreviewHelpers()
  canvasHtml.value = html
  await nextTick()
  const root = canvasMount.value
  if (!root)
    return
  helperRoot = root
  syncCmsPreviewAuthState(root, props.previewAuthLoggedIn)
  initEmblaCarousels(root)
  initCmsNavHelpers(root)
  detectCanvasFixed()
  syncCanvasChromeCss()
  syncCanvasHeight()
  revealCanvasBody(canvasFrame.value?.contentDocument)
  hasMounted = true
  notifyLoaded()
}

async function initCanvas() {
  const frameEl = canvasFrame.value
  const doc = frameEl?.contentDocument
  if (!doc)
    return
  canvasCleanups.forEach(fn => fn())
  canvasCleanups = []
  canvasHeadLinks(doc, canvasHead())
  upsertCanvasStyle(doc, 'cms-canvas-editor-css', CANVAS_EDITOR_CSS)
  canvasMount.value = doc.getElementById('cms-canvas-root')

  doc.addEventListener('click', forwardCanvasClick, true)
  canvasCleanups.push(() => doc.removeEventListener('click', forwardCanvasClick, true))
  canvasCleanups.push(guardCanvasNavigation(doc))
  if (hostEl.value) {
    const hostObserver = new ResizeObserver(() => {
      canvasAvailableWidth.value = hostEl.value?.clientWidth || 0
    })
    hostObserver.observe(hostEl.value)
    canvasAvailableWidth.value = hostEl.value.clientWidth
    canvasCleanups.push(() => hostObserver.disconnect())
  }
  const FrameResizeObserver = frameEl.contentWindow?.ResizeObserver || ResizeObserver
  const observer = new FrameResizeObserver(() => syncCanvasHeight())
  observer.observe(doc.documentElement)
  if (doc.body)
    observer.observe(doc.body)
  canvasCleanups.push(() => observer.disconnect())
  doc.fonts?.ready?.then(() => syncCanvasHeight())
  await showCanvasContent()
}

function refreshCanvas() {
  if (!canvasMount.value)
    return
  showCanvasContent()
}

function startCanvasWhenVisible() {
  const el = hostEl.value
  if (!el || typeof IntersectionObserver === 'undefined') {
    canvasActive.value = true
    return
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      canvasActive.value = true
      observer.disconnect()
    }
  }, { rootMargin: '600px' })
  observer.observe(el)
  canvasCleanups.push(() => observer.disconnect())
}

async function initInlineCanvas() {
  const root = hostEl.value
  helperRoot = root
  syncCmsPreviewAuthState(root, props.previewAuthLoggedIn)
  initEmblaCarousels(root)
  initCmsNavHelpers(root)
  pageCanvas?.contentChanged?.()
  await nextTick()
  hasMounted = true
  notifyLoaded()
}

onMounted(async () => {
  // Sheets inherit the page provider but render in the Hub document.
  inPageCanvas.value = Boolean(hostEl.value?.ownerDocument && hostEl.value.ownerDocument !== globalThis.document)
  await nextTick()
  if (canvasEnabled.value)
    startCanvasWhenVisible()
  else
    await initInlineCanvas()
})

watch(() => props.html, async () => {
  if (!canvasEnabled.value)
    cleanupPreviewHelpers()
  await nextTick()
  if (canvasEnabled.value)
    refreshCanvas()
  else
    await initInlineCanvas()
})

watch(() => [props.theme, canvasOptions?.head], () => {
  if (!canvasEnabled.value || !canvasMount.value)
    return
  canvasHeadLinks(canvasFrame.value.contentDocument, canvasHead())
  refreshCanvas()
}, { deep: true })

watch(() => props.previewAuthLoggedIn, async (loggedIn) => {
  await nextTick()
  syncCmsPreviewAuthState(canvasRoot(), loggedIn)
})

defineExpose({ contentRoot: canvasRoot })

onBeforeUnmount(() => {
  canvasRun += 1
  cleanupPreviewHelpers()
  canvasCleanups.forEach(fn => fn())
  canvasCleanups = []
})
</script>

<template>
  <div v-if="canvasEnabled" ref="hostEl" data-cms-canvas-host>
    <iframe
      v-if="canvasActive"
      ref="canvasFrame"
      data-cms-canvas
      title="Block canvas"
      class="block w-full border-0"
      :style="canvasFrameStyle"
      :srcdoc="CANVAS_SRCDOC"
      @load="initCanvas"
    />
    <div v-else :style="{ height: `${canvasHeight}px` }" />
    <Teleport v-if="canvasMount" :to="canvasMount">
      <component :is="props.comp" v-if="props.comp" />
      <div v-else v-html="canvasHtml" />
    </Teleport>
  </div>
  <div v-else ref="hostEl" class="block-content" data-cms-content>
    <component :is="props.comp" v-if="props.comp" />
    <div v-else v-html="safeHtml" />
  </div>
</template>
