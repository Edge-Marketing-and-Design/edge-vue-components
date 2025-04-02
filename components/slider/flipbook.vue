<script setup lang="js">
// import spinner from '@/assets/spinner.svg'
const props = defineProps({
  magazine: {
    type: Object,
    required: true,
  },
  flipDuration: {
    type: Number,
    default: 1000,
  },
  zoomDuration: {
    type: Number,
    default: 500,
  },
  zoomLevels: {
    type: Array,
    default: () => [1, 2, 4],
  },
  perspective: {
    type: Number,
    default: 2400,
  },
  nPolygons: {
    type: Number,
    default: 10,
  },
  ambient: {
    type: Number,
    default: 0.4,
  },
  gloss: {
    type: Number,
    default: 0.6,
  },
  swipeMin: {
    type: Number,
    default: 3,
  },
  singlePage: {
    type: Boolean,
    default: false,
  },
  forwardDirection: {
    type: String,
    default: 'right',
    validator: val => val === 'right' || val === 'left',
  },
  centering: {
    type: Boolean,
    default: true,
  },
  startPage: {
    type: Number,
    default: null,
  },
  loadingImage: {
    type: String,
    default: 'spinner',
  },
  clickToZoom: {
    type: Boolean,
    default: true,
  },
  dragToFlip: {
    type: Boolean,
    default: true,
  },
  wheel: {
    type: String,
    default: 'scroll',
  },
  teleport: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'flip-left-start',
  'flip-left-end',
  'flip-right-start',
  'flip-right-end',
  'zoom-start',
  'zoom-end',
])
const easeIn = x => x ** 2
const easeOut = x => 1 - easeIn(1 - x)
const easeInOut = (x) => {
  if (x < 0.5) {
    return easeIn(x * 2) / 2
  }
  else {
    return 0.5 + easeOut((x - 0.5) * 2) / 2
  }
}
const zoom = ref(1)
const viewport = ref(null)

const state = reactive({
  viewWidth: 0,
  viewHeight: 0,
  imageWidth: null,
  imageHeight: null,
  displayedPages: 1,
  nImageLoad: 0,
  nImageLoadTrigger: 0,
  imageLoadCallback: null,
  currentPage: 0,
  firstPage: 0,
  secondPage: 1,
  zoomIndex: 0,
  zooming: false,
  touchStartX: null,
  touchStartY: null,
  maxMove: 0,
  activeCursor: null,
  hasTouchEvents: false,
  hasPointerEvents: false,
  minX: Infinity,
  maxX: -Infinity,
  preloadedImages: {},
  flip: {
    progress: 0,
    direction: null,
    frontImage: null,
    backImage: null,
    auto: false,
    opacity: 1,
  },
  currentCenterOffset: null,
  animatingCenter: false,
  startScrollLeft: 0,
  startScrollTop: 0,
  scrollLeft: 0,
  scrollTop: 0,
  loadedImages: {},
  mounted: false,
})

const pages = computed(() => {
  const images = props.magazine?.ccState?.cfImages || {}

  return Object.keys(images)
    .sort() // Ensures order by "page-001", "page-002", etc.
    .map((key) => {
      const image = images[key]
      return image.variants.find(url => url.includes('/thumbnail'))
    })
    .filter(Boolean) // Removes undefined values in case no thumbnail is found
})

const pagesHighRes = computed(() => {
  const images = props.magazine?.ccState?.cfImages || {}

  return Object.keys(images)
    .sort() // Ensures order by "page-001", "page-002", etc.
    .map((key) => {
      const image = images[key]
      return image.variants.find(url => url.includes('/public'))
    })
    .filter(Boolean) // Removes undefined values in case no thumbnail is found
})

const zooms_ = computed(() => props.zoomLevels || [1])

const canGoForward = computed(() => {
  return !state.flip.direction && state.currentPage < pages.value.length - state.displayedPages
})

const pageUrl = (page, hiRes = false) => {
  if (hiRes && zoom.value > 1 && !state.zooming) {
    const url = pagesHighRes.value[page]
    if (url)
      return url
  }

  return pages.value[page] || null
}

const canGoBack = computed(() => {
  return !state.flip.direction && state.currentPage >= state.displayedPages && !(state.displayedPages === 1 && !pageUrl(state.firstPage - 1))
})

const IE = computed(() => typeof navigator !== 'undefined' && /Trident/.test(navigator.userAgent))

const canFlipLeft = computed(() => {
  return props.forwardDirection === 'left' ? canGoForward.value : canGoBack.value
})

const canFlipRight = computed(() => {
  return props.forwardDirection === 'right' ? canGoForward.value : canGoBack.value
})

const canZoomIn = computed(() => !state.zooming && state.zoomIndex < zooms_.value.length - 1)

const canZoomOut = computed(() => !state.zooming && state.zoomIndex > 0)

const numPages = computed(() => pages.value[0] == null ? pages.value.length - 1 : pages.value.length)

const page = computed(() => {
  return pages.value[0] != null ? state.currentPage + 1 : Math.max(1, state.currentPage)
})

const leftPage = computed(() => {
  return (props.forwardDirection === 'right' || state.displayedPages === 1) ? state.firstPage : state.secondPage
})

const rightPage = computed(() => {
  return props.forwardDirection === 'left' ? state.firstPage : state.secondPage
})

const showLeftPage = computed(() => leftPage.value !== null && leftPage.value > 0)

const showRightPage = computed(() => rightPage.value !== null && state.displayedPages === 2)

const cursor = computed(() => {
  if (state.activeCursor)
    return state.activeCursor
  if (IE.value)
    return 'auto'
  if (props.clickToZoom && canZoomIn.value)
    return 'zoom-in'
  if (props.clickToZoom && canZoomOut.value)
    return 'zoom-out'
  if (props.dragToFlip)
    return 'grab'
  return 'auto'
})

const pageScale = computed(() => {
  const vw = state.viewWidth / state.displayedPages
  const xScale = vw / state.imageWidth
  const yScale = state.viewHeight / state.imageHeight
  const scale = xScale < yScale ? xScale : yScale
  return scale < 1 ? scale : 1
})

const pageWidth = computed(() => Math.round(state.imageWidth * pageScale.value))

const pageHeight = computed(() => Math.round(state.imageHeight * pageScale.value))

const xMargin = computed(() => (state.viewWidth - pageWidth.value * state.displayedPages) / 2)

const yMargin = computed(() => (state.viewHeight - pageHeight.value) / 2)

const polygonWidth = computed(() => {
  const w = pageWidth.value / props.nPolygons
  return `${Math.ceil(w + 1 / zoom.value)}px`
})

const polygonHeight = computed(() => `${pageHeight.value}px`)

const polygonBgSize = computed(() => `${pageWidth.value}px ${pageHeight.value}px`)

const makePolygonArray = (face) => {
  if (!state.flip.direction)
    return []

  let progress = state.flip.progress
  let direction = state.flip.direction

  if (state.displayedPages === 1 && direction !== props.forwardDirection) {
    progress = 1 - progress
    direction = props.forwardDirection
  }

  state.flip.opacity = (state.displayedPages === 1 && progress > 0.7)
    ? 1 - (progress - 0.7) / 0.3
    : 1

  const image = (face === 'front') ? state.flip.frontImage : state.flip.backImage
  const polygonWidth = pageWidth.value / props.nPolygons

  let pageX = xMargin.value
  let originRight = false

  if (state.displayedPages === 1) {
    if (props.forwardDirection === 'right') {
      if (face === 'back') {
        originRight = true
        pageX = xMargin.value - pageWidth.value
      }
    }
    else {
      if (direction === 'left') {
        if (face === 'back') {
          pageX = pageWidth.value - xMargin.value
        }
        else {
          originRight = true
        }
      }
      else {
        if (face === 'front') {
          pageX = pageWidth.value - xMargin.value
        }
        else {
          originRight = true
        }
      }
    }
  }
  else {
    if (direction === 'left') {
      if (face === 'back') {
        pageX = state.viewWidth / 2
      }
      else {
        originRight = true
      }
    }
    else {
      if (face === 'front') {
        pageX = state.viewWidth / 2
      }
      else {
        originRight = true
      }
    }
  }

  const computeLighting = (rot, dRotate) => {
    const gradients = []
    const lightingPoints = [-0.5, -0.25, 0, 0.25, 0.5]

    if (props.ambient < 1) {
      const blackness = 1 - props.ambient
      const diffuse = lightingPoints.map(d =>
        (1 - Math.cos((rot - dRotate * d) / 180 * Math.PI)) * blackness,
      )
      gradients.push(`
      linear-gradient(to right,
        rgba(0, 0, 0, ${diffuse[0]}),
        rgba(0, 0, 0, ${diffuse[1]}) 25%,
        rgba(0, 0, 0, ${diffuse[2]}) 50%,
        rgba(0, 0, 0, ${diffuse[3]}) 75%,
        rgba(0, 0, 0, ${diffuse[4]}))
    `)
    }

    if (props.gloss > 0 && !IE.value) {
      const DEG = 30
      const POW = 200
      const specular = lightingPoints.map(d =>
        Math.max(
          Math.cos((rot + DEG - dRotate * d) / 180 * Math.PI) ** POW,
          Math.cos((rot - DEG - dRotate * d) / 180 * Math.PI) ** POW,
        ),
      )
      gradients.push(`
      linear-gradient(to right,
        rgba(255, 255, 255, ${specular[0] * props.gloss}),
        rgba(255, 255, 255, ${specular[1] * props.gloss}) 25%,
        rgba(255, 255, 255, ${specular[2] * props.gloss}) 50%,
        rgba(255, 255, 255, ${specular[3] * props.gloss}) 75%,
        rgba(255, 255, 255, ${specular[4] * props.gloss}))
    `)
    }

    return gradients.join(',')
  }

  // Using DOMMatrix instead of custom Matrix class
  const pageMatrix = new DOMMatrix()
  pageMatrix.translateSelf(state.viewWidth / 2, 0)
  pageMatrix.scaleSelf(1, 1, props.perspective)
  pageMatrix.translateSelf(-state.viewWidth / 2, 0)
  pageMatrix.translateSelf(pageX, yMargin.value)

  let pageRotation = 0
  if (progress > 0.5) {
    pageRotation = -(progress - 0.5) * 2 * 180
  }
  if (direction === 'left') {
    pageRotation = -pageRotation
  }
  pageRotation += face === 'back' ? 180 : 0

  if (pageRotation) {
    if (originRight) {
      pageMatrix.translateSelf(pageWidth.value, 0)
    }
    pageMatrix.rotateAxisAngleSelf(0, 1, 0, pageRotation)
    if (originRight) {
      pageMatrix.translateSelf(-pageWidth.value, 0)
    }
  }

  let theta = (progress < 0.5)
    ? progress * 2 * Math.PI
    : (1 - (progress - 0.5) * 2) * Math.PI

  if (theta === 0)
    theta = 1e-9
  const radius = pageWidth.value / theta

  let radian = 0
  const dRadian = theta / props.nPolygons
  let rotate = (dRadian / 2 / Math.PI) * 180
  let dRotate = (dRadian / Math.PI) * 180

  if (originRight)
    rotate = -theta / Math.PI * 180 + dRotate / 2
  if (face === 'back') {
    rotate = -rotate
    dRotate = -dRotate
  }

  state.minX = Infinity
  state.maxX = -Infinity

  const polygons = []
  for (let i = 0; i < props.nPolygons; i++) {
    const bgPos = `${(i / (props.nPolygons - 1)) * 100}% 0px`

    const m = new DOMMatrix(pageMatrix) // Clone using new DOMMatrix
    const rad = originRight ? theta - radian : radian
    let x = Math.sin(rad) * radius
    x = originRight ? pageWidth.value - x : x
    let z = (1 - Math.cos(rad)) * radius
    z = (face === 'back') ? -z : z

    // Ensure x and z are not NaN or Infinity
    if (isNaN(x) || !isFinite(x))
      x = 0 // Fallback to 0 if invalid
    if (isNaN(z) || !isFinite(z))
      z = 0 // Fallback to 0 if invalid

    m.translateSelf(x, 0, z)
    m.rotateAxisAngleSelf(0, 1, 0, -rotate)

    const x0 = m.m41 // m41 in DOMMatrix represents the X translation
    const x1 = x0 + polygonWidth // Adjust x1 based on polygon width
    state.maxX = Math.max(x0, x1, state.maxX)
    state.minX = Math.min(x0, x1, state.minX)

    const lighting = computeLighting(pageRotation - rotate, dRotate)

    radian += dRadian
    rotate += dRotate

    polygons.push([face + i, image, lighting, bgPos, m.toString(), Math.abs(Math.round(z))])
  }

  return polygons
}

const rawPolygonData = computed(() => {
  return [
    ...makePolygonArray('front'), // Generates polygon data for the front side
    ...makePolygonArray('back'), // Generates polygon data for the back side
  ]
})

const loadImage = (url) => {
  if (state.imageWidth == null) {
    // First loaded image defines the image width and height.
    // So it must be a true image, not a 'loading' image.
    return url
  }
  else {
    if (state.loadedImages[url]) {
      return url
    }
    else {
      const img = new Image()
      img.onload = () => {
        // Directly set the loaded image in the reactive object, no need for `set`
        state.loadedImages[url] = true
      }
      img.src = url
      return props.loadingImage
    }
  }
}

const polygonArray = computed(() => {
  return rawPolygonData.value.map(([key, bgImage, lighting, bgPos, transform, z]) => {
    if (!state.loadedImages[bgImage]) {
      loadImage(bgImage) // Load only if not already cached
    }
    return {
      key,
      bgImage: state.loadedImages[bgImage] ? `url(${bgImage})` : null,
      lighting,
      bgPos,
      transform,
      z,
    }
  })
})

const boundingLeft = computed(() => {
  if (state.displayedPages === 1)
    return xMargin.value
  const x = showLeftPage ? xMargin.value : state.viewWidth / 2
  return x < state.minX ? x : state.minX
})

const boundingRight = computed(() => {
  if (state.displayedPages === 1)
    return state.viewWidth - xMargin.value
  const x = showRightPage ? state.viewWidth - xMargin.value : state.viewWidth / 2
  return x > state.maxX ? x : state.maxX
})

const centerOffset = computed(() => {
  const retval = props.centering ? Math.round(state.viewWidth / 2 - (boundingLeft.value + boundingRight.value) / 2) : 0
  if (state.currentCenterOffset == null && state.imageWidth != null)
    state.currentCenterOffset = retval
  return retval
})

const centerOffsetSmoothed = computed(() => Math.round(state.currentCenterOffset))

const dragToScroll = computed(() => !props.hasTouchEvents)

const scrollLeftMin = computed(() => {
  const w = (boundingRight.value - boundingLeft.value) * zoom.value
  if (w < state.viewWidth) {
    return (boundingLeft.value + centerOffsetSmoothed.value) * zoom.value - (state.viewWidth - w) / 2
  }
  else {
    return (boundingLeft.value + centerOffsetSmoothed.value) * zoom.value
  }
})

const scrollLeftMax = computed(() => {
  const w = (boundingRight.value - boundingLeft.value) * zoom.value
  if (w < state.viewWidth) {
    return (boundingLeft.value + centerOffsetSmoothed.value) * zoom.value - (state.viewWidth - w) / 2
  }
  else {
    return (boundingRight.value + centerOffsetSmoothed.value) * zoom.value - state.viewWidth
  }
})

const scrollTopMin = computed(() => {
  const h = pageHeight.value * zoom.value
  if (h < state.viewHeight) {
    return yMargin.value * zoom.value - (state.viewHeight - h) / 2
  }
  else {
    return yMargin.value * zoom.value
  }
})

const scrollTopMax = computed(() => {
  const h = pageHeight.value * zoom.value
  if (h < state.viewHeight) {
    return yMargin.value * zoom.value - (state.viewHeight - h) / 2
  }
  else {
    return (yMargin.value + pageHeight.value) * zoom.value - state.viewHeight
  }
})

const scrollLeftLimited = computed(() => Math.min(scrollLeftMax.value, Math.max(scrollLeftMin.value, state.scrollLeft)))

const scrollTopLimited = computed(() => Math.min(scrollTopMax.value, Math.max(scrollTopMin.value, state.scrollTop)))

const fixFirstPage = () => {
  if (state.displayedPages === 1
    && state.currentPage === 0
    && pages.value.length
    && !pageUrl(0)) {
    state.currentPage++
  }
}

const onResize = () => {
  const viewportElement = viewport.value // Access the ref value
  if (!viewportElement)
    return

  state.viewWidth = viewportElement.clientWidth
  state.viewHeight = viewportElement.clientHeight

  state.displayedPages = (state.viewWidth > state.viewHeight && !props.singlePage) ? 2 : 1

  if (state.displayedPages === 2) {
    state.currentPage &= ~1 // Bitwise operation to ensure the current page is an even number
  }

  fixFirstPage()
  state.minX = Infinity
  state.maxX = -Infinity
}

const goToPage = (p) => {
  if (p == null || p === page.value)
    return

  if (pages.value[0] == null) {
    if (state.displayedPages === 2 && p === 1) {
      state.currentPage = 0
    }
    else {
      state.currentPage = p
    }
  }
  else {
    state.currentPage = p - 1
  }

  state.minX = Infinity
  state.maxX = -Infinity
  state.currentCenterOffset = centerOffset.value // Assuming centerOffset is a computed property
}

// Mounted hook (replaces the Options API 'mounted' lifecycle method)
onMounted(() => {
  window.addEventListener('resize', onResize, { passive: true })
  onResize() // Call it initially to set dimensions
  zoom.value = zooms_.value[0]
  goToPage(props.startPage)
  console.log('canzoom')
  console.log(state.zoomIndex)
  console.log(zooms_.value)
  console.log(zoom.value)
  console.log(canZoomIn.value)
  state.mounted = true
})

// Before unmount hook (replaces 'beforeDestroy')
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize, { passive: true })
})

const onImageLoad = (trigger, cb) => {
  state.nImageLoad = 0
  state.nImageLoadTrigger = trigger
  state.imageLoadCallback = cb
}

const pageUrlLoading = (page, hiRes = false) => {
  const url = pageUrl(page, hiRes)

  if (hiRes && zoom.value > 1 && !state.zooming) {
    return url // High-res image doesn't use 'loading'
  }

  if (url) {
    return loadImage(url) // Assuming loadImage is already defined
  }
}

const flipAuto = (ease) => {
  const t0 = Date.now()
  const duration = props.flipDuration * (1 - state.flip.progress)
  const startRatio = state.flip.progress

  state.flip.auto = true
  emit(`flip-${state.flip.direction}-start`, page.value)

  const animate = () => {
    requestAnimationFrame(() => {
      const t = Date.now() - t0
      let ratio = startRatio + t / duration
      ratio = ratio > 1 ? 1 : ratio // Ensure ratio does not exceed 1

      state.flip.progress = ease ? easeInOut(ratio) : ratio

      if (ratio < 1) {
        animate() // Continue animation
      }
      else {
        // Animation ends here
        if (state.flip.direction !== props.forwardDirection) {
          state.currentPage -= state.displayedPages
        }
        else {
          state.currentPage += state.displayedPages
        }
        emit(`flip-${state.flip.direction}-end`, page.value)

        if (state.displayedPages === 1 && state.flip.direction === props.forwardDirection) {
          state.flip.direction = null // End animation
        }
        else {
          onImageLoad(1, () => {
            state.flip.direction = null // End animation
          })
        }
        state.flip.auto = false // Mark the animation as complete
      }
    })
  }

  animate() // Start animation
}

const flipStart = (direction, auto) => {
  if (direction !== props.forwardDirection) {
    if (state.displayedPages === 1) {
      state.flip.frontImage = pageUrl(state.currentPage - 1)
      state.flip.backImage = null
    }
    else {
      state.flip.frontImage = pageUrl(state.firstPage)
      state.flip.backImage = pageUrl(state.currentPage - state.displayedPages + 1)
    }
  }
  else {
    if (state.displayedPages === 1) {
      state.flip.frontImage = pageUrl(state.currentPage)
      state.flip.backImage = null
    }
    else {
      state.flip.frontImage = pageUrl(state.secondPage)
      state.flip.backImage = pageUrl(state.currentPage + state.displayedPages)
    }
  }

  state.flip.direction = direction
  state.flip.progress = 0

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (state.flip.direction !== props.forwardDirection) {
        if (state.displayedPages === 2) {
          state.firstPage = state.currentPage - state.displayedPages
        }
      }
      else {
        if (state.displayedPages === 1) {
          state.firstPage = state.currentPage + state.displayedPages
        }
        else {
          state.secondPage = state.currentPage + 1 + state.displayedPages
        }
      }

      // Sample confirmation in flipStart

      if (auto)
        flipAuto(true)
    })
  })
}

const flipLeft = () => {
  if (!canFlipLeft.value)
    return

  flipStart('left', true) // Assuming flipStart is already defined
}
const flipRight = () => {
  if (!canFlipRight.value)
    return

  flipStart('right', true) // Assuming flipStart is already defined
}

// computeLighting method

const flipRevert = () => {
  const t0 = Date.now()
  const duration = props.flipDuration * state.flip.progress
  const startRatio = state.flip.progress

  state.flip.auto = true

  const animate = () => {
    requestAnimationFrame(() => {
      const t = Date.now() - t0
      let ratio = startRatio - (startRatio * t) / duration
      ratio = ratio < 0 ? 0 : ratio // Ensure ratio does not go below 0

      state.flip.progress = ratio

      if (ratio > 0) {
        animate() // Continue animation
      }
      else {
        // Animation ends here
        state.firstPage = state.currentPage
        state.secondPage = state.currentPage + 1

        if (state.displayedPages === 1 && state.flip.direction !== props.forwardDirection) {
          state.flip.direction = null // End animation
        }
        else {
          onImageLoad(1, () => {
            state.flip.direction = null // End animation
          })
        }
        state.flip.auto = false // Mark the animation as complete
      }
    })
  }

  animate() // Start animation
}

const preloadImages = (hiRes = false) => {
  for (let i = state.currentPage - 3; i <= state.currentPage + 3; i++) {
    pageUrlLoading(i) // Assuming this method is defined elsewhere
  }

  if (hiRes) {
    for (let i = state.currentPage; i < state.currentPage + state.displayedPages; i++) {
      const src = pagesHighRes.value[i]
      if (src) {
        const img = new Image()
        img.src = src
      }
    }
  }
}
const zoomTo = (z, zoomAt = null) => {
  const viewportElement = viewport.value // Access the DOM element via the ref

  let fixedX, fixedY

  if (zoomAt) {
    const rect = viewportElement.getBoundingClientRect()
    fixedX = zoomAt.pageX - rect.left
    fixedY = zoomAt.pageY - rect.top
  }
  else {
    fixedX = viewportElement.clientWidth / 2
    fixedY = viewportElement.clientHeight / 2
  }

  const start = zoom.value
  const end = z
  const startX = viewportElement.scrollLeft
  const startY = viewportElement.scrollTop
  const containerFixedX = fixedX + startX
  const containerFixedY = fixedY + startY
  const endX = (containerFixedX / start) * end - fixedX
  const endY = (containerFixedY / start) * end - fixedY

  const t0 = Date.now()
  state.zooming = true
  emit('zoomStart', zoom.value)

  const animate = () => {
    requestAnimationFrame(() => {
      const t = Date.now() - t0
      let ratio = t / props.zoomDuration
      ratio = ratio > 1 ? 1 : ratio // Ensure ratio does not exceed 1
      ratio = easeInOut(ratio) // Apply easing function

      zoom.value = start + (end - start) * ratio
      state.scrollLeft = startX + (endX - startX) * ratio
      state.scrollTop = startY + (endY - startY) * ratio

      if (t < props.zoomDuration) {
        animate() // Continue animation
      }
      else {
        // Animation ends here
        emit('zoomEnd', z)
        state.zooming = false
        zoom.value = z
        state.scrollLeft = endX
        state.scrollTop = endY
      }
    })
  }

  animate() // Start animation

  if (end > 1) {
    preloadImages(true) // Preload high-resolution images when zoomed in
  }
}

const didLoadImage = (ev) => {
  const imageTarget = ev.target || ev.path?.[0]

  if (state.imageWidth == null) {
    // Ensure these are set properly
    state.imageWidth = imageTarget.naturalWidth
    console.log('imageWidth', state.imageWidth)
    state.imageHeight = imageTarget.naturalHeight
    console.log('imageHeight', state.imageHeight)
    preloadImages() // Assuming you have a method to preload images
  }

  if (state.imageLoadCallback) {
    if (++state.nImageLoad >= state.nImageLoadTrigger) {
      state.imageLoadCallback()
      state.imageLoadCallback = null
    }
  }
}
const zoomIn = (zoomAt = null) => {
  if (!canZoomIn.value)
    return
  state.zoomIndex += 1
  zoomTo(zooms_.value[state.zoomIndex], zoomAt)
}

const zoomOut = (zoomAt = null) => {
  if (!canZoomOut.value)
    return
  state.zoomIndex -= 1
  zoomTo(zooms_.value[state.zoomIndex], zoomAt)
}

const zoomAt = (zoomAt) => {
  state.zoomIndex = (state.zoomIndex + 1) % zooms_.value.length
  zoomTo(zooms_.value[state.zoomIndex], zoomAt)
}
const swipeStart = (touch) => {
  state.touchStartX = touch.pageX
  state.touchStartY = touch.pageY
  state.maxMove = 0

  if (zoom.value <= 1) {
    if (props.dragToFlip) {
      state.activeCursor = 'grab'
    }
  }
  else {
    state.startScrollLeft = viewport.value.scrollLeft
    state.startScrollTop = viewport.value.scrollTop
    state.activeCursor = 'all-scroll'
  }
}

const dragScroll = (x, y) => {
  state.scrollLeft = state.startScrollLeft - x
  state.scrollTop = state.startScrollTop - y
}

const swipeMove = (touch) => {
  if (state.touchStartX == null)
    return

  const x = touch.pageX - state.touchStartX
  const y = touch.pageY - state.touchStartY

  state.maxMove = Math.max(state.maxMove, Math.abs(x))
  state.maxMove = Math.max(state.maxMove, Math.abs(y))

  if (zoom.value > 1) {
    if (dragToScroll.value) {
      dragScroll(x, y)
    }
    return
  }

  if (!props.dragToFlip)
    return
  if (Math.abs(y) > Math.abs(x))
    return

  state.activeCursor = 'grabbing'

  if (x > 0) {
    if (!state.flip.direction && canFlipLeft.value && x >= props.swipeMin) {
      flipStart('left', false)
    }
    if (state.flip.direction === 'left') {
      state.flip.progress = x / pageWidth.value
      if (state.flip.progress > 1)
        state.flip.progress = 1
    }
  }
  else {
    if (!state.flip.direction && canFlipRight.value && x <= -props.swipeMin) {
      flipStart('right', false)
    }
    if (state.flip.direction === 'right') {
      state.flip.progress = -x / pageWidth.value
      if (state.flip.progress > 1)
        state.flip.progress = 1
    }
  }

  return true
}
const swipeEnd = (touch) => {
  if (state.touchStartX == null)
    return

  if (props.clickToZoom && state.maxMove < props.swipeMin) {
    zoomAt(touch)
  }

  if (state.flip.direction && !state.flip.auto) {
    if (state.flip.progress > 0.25) {
      flipAuto(false)
    }
    else {
      flipRevert()
    }
  }

  state.touchStartX = null
  state.activeCursor = null
}
const onTouchStart = (ev) => {
  state.hasTouchEvents = true
  swipeStart(ev.changedTouches[0])
}

const onTouchMove = (ev) => {
  if (swipeMove(ev.changedTouches[0])) {
    if (ev.cancelable)
      ev.preventDefault()
  }
}

const onTouchEnd = ev => swipeEnd(ev.changedTouches[0])
const onPointerDown = (ev) => {
  console.log('on pointer down')
  state.hasPointerEvents = true
  if (state.hasTouchEvents)
    return
  if (ev.which && ev.which !== 1)
    return // Ignore right-click

  swipeStart(ev)

  try {
    ev.target.setPointerCapture(ev.pointerId)
  }
  catch (e) {
    // Handle potential errors when capturing pointer
  }
}

const onPointerMove = (ev) => {
  if (!state.hasTouchEvents)
    swipeMove(ev)
}

const onPointerUp = (ev) => {
  if (state.hasTouchEvents)
    return

  swipeEnd(ev)

  try {
    ev.target.releasePointerCapture(ev.pointerId)
  }
  catch (e) {
    // Handle potential errors when releasing pointer
  }
}
const onMouseDown = (ev) => {
  console.log('on mouse down')
  if (state.hasTouchEvents || state.hasPointerEvents)
    return
  if (ev.which && ev.which !== 1)
    return // Ignore right-click

  swipeStart(ev)
}

const onMouseMove = (ev) => {
  if (!state.hasTouchEvents && !state.hasPointerEvents) {
    swipeMove(ev)
  }
}

const onMouseUp = (ev) => {
  console.log('on mouse up')
  if (!state.hasTouchEvents && !state.hasPointerEvents) {
    swipeEnd(ev)
  }
}

const onWheel = (ev) => {
  if (props.wheel === 'scroll' && zoom.value > 1 && dragToScroll.value) {
    state.scrollLeft = viewport.value.scrollLeft + ev.deltaX
    state.scrollTop = viewport.value.scrollTop + ev.deltaY
    if (ev.cancelable)
      ev.preventDefault()
  }

  if (props.wheel === 'zoom') {
    if (ev.deltaY >= 100) {
      zoomOut(ev)
      if (ev.cancelable)
        ev.preventDefault()
    }
    else if (ev.deltaY <= -100) {
      zoomIn(ev)
      if (ev.cancelable)
        ev.preventDefault()
    }
  }
}

watch(() => state.currentPage, () => {
  state.firstPage = state.currentPage
  state.secondPage = state.currentPage + 1
  preloadImages()
})

watch(() => centerOffset.value, () => {
  if (state.animatingCenter)
    return

  const animate = () => {
    requestAnimationFrame(() => {
      const rate = 0.1
      const diff = centerOffset.value - state.currentCenterOffset

      if (Math.abs(diff) < 0.5) {
        state.currentCenterOffset = centerOffset.value
        state.animatingCenter = false // End animation
      }
      else {
        state.currentCenterOffset += diff * rate
        animate() // Continue animation
      }
    })
  }

  state.animatingCenter = true
  animate() // Start animation
})

watch(scrollLeftLimited, (val) => {
  if (IE.value) {
    requestAnimationFrame(() => {
      if (viewport.value) {
        viewport.value.scrollLeft = val
      }
    })
  }
  else {
    if (viewport.value) {
      viewport.value.scrollLeft = val
    }
  }
})

watch(() => scrollTopLimited.value, (val) => {
  if (IE.value) {
    requestAnimationFrame(() => {
      viewport.value.scrollTop = val
    })
  }
  else {
    viewport.value.scrollTop = val
  }
})

watch(() => pages.value, (after, before) => {
  fixFirstPage() // Assuming `fixFirstPage` is defined
  if (!before?.length && after?.length) {
    if (props.startPage > 1 && after[0] === null) {
      state.currentPage++
    }
  }
})

watch(() => props.startPage, (p) => {
  goToPage(p) // Assuming `goToPage` is defined
})

const openFullscreen = (elem) => {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  }
  else {
    if (elem.requestFullscreen) {
      elem.requestFullscreen()
    }
    else if (elem.webkitRequestFullscreen) { /* Safari */
      elem.webkitRequestFullscreen()
    }
    else if (elem.msRequestFullscreen) { /* IE11 */
      elem.msRequestFullscreen()
    }
  }
}
</script>

<template>
  <div>
    <!-- Slot Binding -->
    <Teleport v-if="state.mounted && props.teleport" :to="`#${props.teleport}`">
      <slot
        v-bind="{
          canFlipLeft,
          canFlipRight,
          canZoomIn,
          canZoomOut,
          page,
          numPages,
          flipLeft,
          flipRight,
          zoomIn,
          zoomOut,
          openFullscreen,
          viewport,
        }"
      />
    </Teleport>
    <slot
      v-else
      v-bind="{
        canFlipLeft,
        canFlipRight,
        canZoomIn,
        canZoomOut,
        page,
        numPages,
        flipLeft,
        flipRight,
        zoomIn,
        zoomOut,
        openFullscreen,
        viewport,
      }"
    />
    <!-- Viewport Container -->
    <div
      ref="viewport" class="viewport h-full w-full" :class="{
        'zoom': state.zooming || zoom > 1,
        'drag-to-scroll': dragToScroll,
      }" :style="{ cursor: cursor === 'grabbing' ? 'grabbing' : 'auto' }"
      @touchmove="onTouchMove" @pointermove="onPointerMove" @mousemove="onMouseMove" @touchend="onTouchEnd"
      @touchcancel="onTouchEnd" @pointerup="onPointerUp" @pointercancel="onPointerUp" @mouseup="onMouseUp"
      @wheel="onWheel"
    >
      <!-- Flipbook Container -->
      <div class="flipbook-container" :style="{ transform: `scale(${zoom})` }">
        <!-- Click-to-Flip Left -->
        <div class="click-to-flip left" :style="{ cursor: canFlipLeft ? 'pointer' : 'auto' }" @click="flipLeft" />

        <!-- Click-to-Flip Right -->
        <div class="click-to-flip right" :style="{ cursor: canFlipRight ? 'pointer' : 'auto' }" @click="flipRight" />

        <!-- Page Display Area -->
        <div :style="{ transform: `translateX(${centerOffsetSmoothed}px)` }">
          <!-- Left Page -->
          <img
            v-if="showLeftPage" class="fixed page" :style="{
              width: `${pageWidth}px`,
              height: `${pageHeight}px`,
              left: `${xMargin}px`,
              top: `${yMargin}px`,
            }" :src="pageUrlLoading(leftPage, true)" @load="didLoadImage($event)"
          >

          <!-- Right Page -->
          <img
            v-if="showRightPage" class="fixed page" :style="{
              width: `${pageWidth}px`,
              height: `${pageHeight}px`,
              left: `${state.viewWidth / 2}px`,
              top: `${yMargin}px`,
            }" :src="pageUrlLoading(rightPage, true)" @load="didLoadImage($event)"
          >

          <!-- Flipbook Polygon Animation -->
          <div :style="{ opacity: state.flip.opacity }">
            <div
              v-for="{
                key,
                bgImage,
                lighting,
                bgPos,
                transform,
                z,
              } in polygonArray" :key="key" class="polygon" :class="{ blank: !bgImage }" :style="{
                backgroundImage: bgImage,
                backgroundSize: polygonBgSize,
                backgroundPosition: bgPos,
                width: polygonWidth,
                height: polygonHeight,
                transform,
                zIndex: z,
              }"
            >
              <div v-show="lighting.length" class="lighting" :style="{ backgroundImage: lighting }" />
            </div>
          </div>

          <!-- Bounding Box -->
          <div
            class="bounding-box" :style="{
              left: `${boundingLeft}px`,
              top: `${yMargin}px`,
              width: `${boundingRight - boundingLeft}px`,
              height: `${pageHeight}px`,
              cursor,
            }" @touchstart="onTouchStart" @pointerdown="onPointerDown" @mousedown="onMouseDown"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewport {
  -webkit-overflow-scrolling: touch;
  width: 100%;
  height: 100%;
}
.viewport.zoom {
  overflow: scroll;
}

.viewport.zoom.drag-to-scroll {
  overflow: hidden;
}

.flipbook-container {
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: top left;
  user-select: none;
}

.click-to-flip {
  position: absolute;
  width: 50%;
  height: 100%;
  top: 0;
  user-select: none;
}

.click-to-flip.left {
  left: 0;
}

.click-to-flip.right {
  right: 0;
}

.bounding-box {
  position: absolute;
  user-select: none;
}

.page {
  position: absolute;
  backface-visibility: hidden;
}

.polygon {
  position: absolute;
  top: 0;
  left: 0;
  background-repeat: no-repeat;
  backface-visibility: hidden;
  transform-origin: center left;
}

.polygon.blank {
  background-color: #ddd;
}

.polygon .lighting {
  width: 100%;
  height: 100%;
}
</style>
