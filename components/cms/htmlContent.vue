<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { install, observe } from '@twind/core'
import presetTailwind from '@twind/preset-tailwind'
import DOMPurify from 'dompurify'

const props = defineProps({ html: { type: String, default: '' } })

const hostEl = ref(null)
let stopObserving = null
let twind

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
    const fadeDuration = Number(root.getAttribute('data-carousel-fade-duration')) || 400

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
    // sanitize, allow class attributes so Tailwind/Twind still work
    const safeHtml = DOMPurify.sanitize(content, { ADD_ATTR: ['class'] })
    hostEl.value.innerHTML = safeHtml
    // initialize any embla carousels in this HTML
    initEmblaCarousels(hostEl.value)
  }
}

onMounted(() => {
  twind = install({
    presets: [presetTailwind()],
    mode: 'silent', // suppress warnings (strict|warn|silent)
  })
  stopObserving = observe(twind, hostEl.value)

  renderSafeHtml(props.html)
})

watch(() => props.html, (val) => {
  renderSafeHtml(val || '')
})

onBeforeUnmount(() => {
  if (stopObserving)
    stopObserving()
  // Optional: destroy embla instances if you later store them on the roots
  // hostEl.value?.querySelectorAll('[data-carousel][data-embla]')?.forEach((root) => root._emblaApi?.destroy?.())
})
</script>

<template>
  <!-- Twind only interprets inside this container -->
  <div ref="hostEl" class="block-content" />
</template>
