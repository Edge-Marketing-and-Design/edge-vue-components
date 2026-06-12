<script setup>
/**
 * SSR-friendly array loading for block APIs using useAsyncData
 * - Fetches all configured API arrays on the server when possible
 * - Refetches when meta/values change on the client
 * - Preserves original behavior: API fields override same-named props.values fields
 */

import { computedAsync } from '@vueuse/core'

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  values: {
    type: Object,
    default: () => ({}),
  },
  meta: {
    type: Object,
    default: () => ({}),
  },
  theme: {
    type: Object,
    default: null,
  },
  siteId: {
    type: String,
    default: '',
  },
  routeLastSegment: {
    type: String,
    default: '',
  },
  viewportMode: {
    type: String,
    default: 'auto',
  },
  renderContext: {
    type: Object,
    default: null,
  },
  standalonePreview: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['pending', 'loaded'])
const edgeFirebase = inject('edgeFirebase')
const previewRouteSegmentCache = useState('edge-cms-preview-route-segment-cache', () => ({}))
const fallbackRouteLastSegment = ref('')
/* ---------------- helpers ---------------- */

// Safe dot-path getter
const getByPath = (obj, path) => {
  if (!path || typeof path !== 'string')
    return obj
  return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : undefined), obj)
}

// Build URL combining existing query string, template query, and runtime overrides
const buildUrlWithQuery = (base, query, queryItems = {}) => {
  const safeBase = String(base || '')
  const queryOverrides = (queryItems && typeof queryItems === 'object') ? queryItems : {}

  // Separate hash fragment to re-attach later
  const hashIndex = safeBase.indexOf('#')
  const hash = hashIndex !== -1 ? safeBase.slice(hashIndex) : ''
  const baseWithoutHash = hashIndex !== -1 ? safeBase.slice(0, hashIndex) : safeBase

  const questionIndex = baseWithoutHash.indexOf('?')
  const basePath = questionIndex === -1 ? baseWithoutHash : baseWithoutHash.slice(0, questionIndex)
  const baseQuery = questionIndex === -1 ? '' : baseWithoutHash.slice(questionIndex + 1)

  const params = new URLSearchParams(baseQuery)

  const templateQuery = typeof query === 'string' ? query.trim() : ''
  if (templateQuery) {
    const cleaned = templateQuery.startsWith('?') ? templateQuery.slice(1) : templateQuery
    if (cleaned) {
      const templateParams = new URLSearchParams(cleaned)
      for (const [key, value] of templateParams.entries())
        params.set(key, value)
    }
  }

  for (const [key, value] of Object.entries(queryOverrides)) {
    if (value == null) {
      params.delete(key)
      continue
    }

    if (Array.isArray(value)) {
      params.delete(key)
      value.forEach((val) => {
        if (val != null)
          params.append(key, String(val))
      })
    }
    else {
      params.set(key, String(value))
    }
  }

  const paramString = params.toString()
  return `${basePath}${paramString ? `?${paramString}` : ''}${hash}`
}

// Core fetcher that resolves all API-backed arrays from meta
const fetchAllArrays = async (meta, baseValues) => {
  const out = {}
  const entries = Object.entries(meta || {})
  await Promise.all(entries.map(async ([field, cfg]) => {
    try {
      if (!cfg || cfg.type !== 'array' || !cfg.api)
        return

      const hasRuntimeQueryOptions = Array.isArray(cfg.queryOptions) && cfg.queryOptions.length > 0
      const runtimeQueryItems = hasRuntimeQueryOptions ? (cfg.queryItems || {}) : {}
      const url = buildUrlWithQuery(String(cfg.api), String(cfg.apiQuery || ''), runtimeQueryItems)
      // use $fetch for SSR-friendly HTTP
      const json = await $fetch(url, { method: 'GET' })

      let data = getByPath(json, cfg.apiField || '')
      if (!Array.isArray(data)) {
        data = (data && typeof data === 'object') ? Object.values(data) : []
      }

      const limit = Number(cfg.limit)
      if (Number.isFinite(limit) && limit > 0) {
        data = data.slice(0, limit)
      }

      out[field] = data
    }
    catch (e) {
      // On error, preserve any existing prop value for that field or fallback to []
      const existing = (baseValues || {})[field]
      out[field] = Array.isArray(existing) ? existing : []
      // Optional: console.warn('blockApi useAsyncData error for', field, e)
    }
  }))
  return out
}

const metaUsesRouteLastSegment = computed(() => {
  const metaEntries = Object.values(props.meta || {})
  return metaEntries.some((cfg) => {
    if (!cfg || typeof cfg !== 'object')
      return false
    try {
      return JSON.stringify(cfg).includes('{routeLastSegment}')
    }
    catch {
      return false
    }
  })
})

const routeLastSegmentPreviewConfig = computed(() => {
  const entries = Object.entries(props.meta || {})
  for (const [field, cfg] of entries) {
    if (!cfg || typeof cfg !== 'object' || !cfg.collection)
      continue
    let serialized = ''
    try {
      serialized = JSON.stringify(cfg)
    }
    catch {
      serialized = ''
    }
    if (!serialized.includes('{routeLastSegment}'))
      continue

    const queryItemEntry = Object.entries(cfg.queryItems || {})
      .find(([, value]) => typeof value === 'string' && value.includes('{routeLastSegment}'))
    const queryEntry = Array.isArray(cfg.collection.query)
      ? cfg.collection.query.find(query => typeof query?.value === 'string' && query.value.includes('{routeLastSegment}'))
      : null

    return {
      field,
      cfg,
      routeField: String(queryItemEntry?.[0] || queryEntry?.field || 'name').trim() || 'name',
    }
  }
  return null
})

const getPreviewCollectionPath = (cfg) => {
  const path = String(cfg?.collection?.path || '').trim()
  if (!path)
    return ''
  if ((path === 'posts' || path === 'post') && props.siteId)
    return `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/published_posts`
  if (path === 'posts' || path === 'post')
    return ''
  return `${edgeGlobal.edgeState.organizationDocPath}/${path}`
}

const getPreviewFallbackQuery = (cfg) => {
  const query = Array.isArray(cfg?.collection?.query) ? cfg.collection.query : []
  return query.filter((item) => {
    try {
      return !JSON.stringify(item?.value).includes('{routeLastSegment}')
    }
    catch {
      return true
    }
  })
}

watch(
  [() => props.routeLastSegment, routeLastSegmentPreviewConfig, () => props.siteId],
  async () => {
    const manualValue = String(props.routeLastSegment || '').trim()
    if (manualValue) {
      fallbackRouteLastSegment.value = ''
      return
    }
    const previewConfig = routeLastSegmentPreviewConfig.value
    if (!previewConfig) {
      fallbackRouteLastSegment.value = ''
      return
    }

    const collectionPath = getPreviewCollectionPath(previewConfig.cfg)
    if (!collectionPath) {
      fallbackRouteLastSegment.value = ''
      return
    }

    const cacheKey = [
      edgeGlobal.edgeState.currentOrganization,
      props.siteId,
      previewConfig.field,
      collectionPath,
      previewConfig.routeField,
    ].join(':')
    const cached = String(previewRouteSegmentCache.value?.[cacheKey] || '').trim()
    if (cached) {
      fallbackRouteLastSegment.value = cached
      return
    }

    try {
      const staticSearch = new edgeFirebase.SearchStaticData()
      await staticSearch.getData(collectionPath, getPreviewFallbackQuery(previewConfig.cfg), previewConfig.cfg.collection.order, 1)
      const firstRecord = Object.values(staticSearch.results?.data || {})[0]
      const firstRouteValue = String(getByPath(firstRecord, previewConfig.routeField) || '').trim()
      if (firstRouteValue)
        previewRouteSegmentCache.value[cacheKey] = firstRouteValue
      fallbackRouteLastSegment.value = firstRouteValue
    }
    catch {
      fallbackRouteLastSegment.value = ''
    }
  },
  { immediate: true },
)

const effectiveRouteLastSegment = computed(() => {
  return String(props.routeLastSegment || '').trim() || String(fallbackRouteLastSegment.value || '').trim()
})

const runtimeMeta = computed(() => {
  const prepared = edgeGlobal.prepareCmsMetaForRuntime(props.meta, props.siteId, {
    routeLastSegment: effectiveRouteLastSegment.value,
  })
  if (import.meta.client && metaUsesRouteLastSegment.value) {
    console.log('[cms routeLastSegment] blockApi runtimeMeta', {
      routeLastSegmentProp: props.routeLastSegment,
      effectiveRouteLastSegment: effectiveRouteLastSegment.value,
      siteId: props.siteId,
      preparedMeta: prepared,
    })
  }
  return prepared
})

/* ---------------- async data (SSR + client) ---------------- */

// Stable, SSR-safe cache key so multiple block instances don't collide
const route = useRoute()
const asyncKey = computed(() => `blockApi:${route.fullPath}:${String(props.routeLastSegment || '')}:${JSON.stringify(runtimeMeta.value ?? {})}`)

const { data: apiResolved, pending } = await useAsyncData(
  asyncKey.value,
  () => {
    // Always compute from latest props
    return fetchAllArrays(runtimeMeta.value, props.values)
  },
  {
    server: true,
    default: () => ({}),
    // Re-run when inputs change on client side
    watch: [runtimeMeta, () => props.values],
  },
)
const collectionPending = ref(false)
let collectionRequestId = 0
const anyPending = computed(() => pending.value || collectionPending.value)

/* ---------------- state & derived values ---------------- */

// Merge props.values (base) + apiResolved (overrides for API-backed fields)
const mergedValues = computed(() => {
  return {
    ...(props.values || {}),
    ...(apiResolved.value || {}),
  }
})

const collectionMetaToFetch = computed(() => {
  const meta = runtimeMeta.value || {}
  if (!props.standalonePreview)
    return meta

  const nextMeta = {}
  for (const [field, cfg] of Object.entries(meta)) {
    if (!cfg || typeof cfg !== 'object' || !cfg.collection) {
      nextMeta[field] = cfg
      continue
    }

    if (Array.isArray(mergedValues.value?.[field]))
      continue

    nextMeta[field] = cfg
  }
  return nextMeta
})

const hasCollectionMetaToFetch = computed(() => {
  return Object.values(collectionMetaToFetch.value || {}).some(cfg => cfg && typeof cfg === 'object' && cfg.collection)
})

// Map original loading flags into class toggles
const loadingRender = (content) => {
  const isLoading = anyPending.value
  if (isLoading) {
    content = content.replaceAll('{{loading}}', '')
    content = content.replaceAll('{{loaded}}', 'hidden')
  }
  else {
    content = content.replaceAll('{{loading}}', 'hidden')
    content = content.replaceAll('{{loaded}}', '')
  }
  return content
}

if (import.meta.client) {
  watch(anyPending, async (val) => {
    emit('pending', val)
    if (!val) {
      await nextTick()
      emit('loaded')
    }
  }, { immediate: true })
}

const collectionValues = computedAsync(
  async () => {
    if (!hasCollectionMetaToFetch.value) {
      collectionPending.value = false
      return {}
    }

    const requestId = ++collectionRequestId
    collectionPending.value = true
    try {
      const collectionData = await edgeGlobal.cmsCollectionData(
        edgeFirebase,
        { ...(mergedValues.value || {}) },
        collectionMetaToFetch.value,
        props.siteId,
      )
      return collectionData
    }
    catch {
      return {}
    }
    finally {
      if (requestId === collectionRequestId)
        collectionPending.value = false
    }
  },
  {},
)

const finalValues = computed(() => {
  return {
    ...(mergedValues.value || {}),
    ...(collectionValues.value || {}),
  }
})
</script>

<template>
  <edge-cms-block-render
    :theme="props.theme"
    :content="loadingRender(props.content)"
    :values="finalValues"
    :meta="runtimeMeta"
    :viewport-mode="props.viewportMode"
    :render-context="props.renderContext"
    :standalone-preview="props.standalonePreview"
    @loaded="!anyPending && emit('loaded')"
  />
</template>

<style scoped>
</style>
