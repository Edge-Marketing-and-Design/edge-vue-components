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
  templateVersion: {
    type: Number,
    default: 1,
  },
  template: {
    type: String,
    default: '',
  },
  schema: {
    type: Object,
    default: () => ({}),
  },
  dataSources: {
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

const looksLikeApiRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false

  return ['id', 'docId', 'rupid', 'property_id', 'display_address'].some(key => Object.prototype.hasOwnProperty.call(value, key))
}

const normalizeApiArrayData = (data) => {
  if (Array.isArray(data))
    return data

  if (!data || typeof data !== 'object')
    return []

  if (looksLikeApiRecord(data))
    return [data]

  const values = Object.values(data)
  if (values.length && values.every(item => item && typeof item === 'object' && !Array.isArray(item)))
    return values

  return [data]
}

const dataSourceToPreviewMetaConfig = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return null

  const cfg = {
    ...source,
  }

  const collectionSource = source.type === 'collection' || source.collection || source.path || source.query || source.canonicalLookup
  if (collectionSource) {
    const hasSourceCollection = !!source.collection && typeof source.collection === 'object' && !Array.isArray(source.collection)
    const sourceCollection = hasSourceCollection ? source.collection : {}
    cfg.collection = {
      ...sourceCollection,
    }
    const collectionKeys = ['path', 'baseKey', 'uniqueKey', 'canonicalLookup', 'query', 'order', 'orgLevel']
    collectionKeys.forEach((key) => {
      if (source[key] !== undefined)
        cfg.collection[key] = source[key]
    })
  }

  return cfg
}

const getRouteLastSegmentPreviewEntries = () => {
  const metaEntries = Object.entries(props.meta || {})
  const dataSourceEntries = Object.entries(props.dataSources || {})
    .map(([field, source]) => [field, dataSourceToPreviewMetaConfig(source)])
    .filter(([, cfg]) => !!cfg)

  return [...metaEntries, ...dataSourceEntries]
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

      const runtimeQueryItems = (cfg.queryItems && typeof cfg.queryItems === 'object') ? cfg.queryItems : {}
      const url = buildUrlWithQuery(String(cfg.api), String(cfg.apiQuery || ''), runtimeQueryItems)
      // use $fetch for SSR-friendly HTTP
      const json = await $fetch(url, { method: 'GET' })

      let data = normalizeApiArrayData(getByPath(json, cfg.apiField || ''))

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

const routeLastSegmentPreviewConfig = computed(() => {
  const entries = getRouteLastSegmentPreviewEntries()
  for (const [field, cfg] of entries) {
    if (!cfg || typeof cfg !== 'object')
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
    const queryEntry = Array.isArray(cfg.collection?.query)
      ? cfg.collection.query.find(query => typeof query?.value === 'string' && query.value.includes('{routeLastSegment}'))
      : null

    if (cfg.api && queryItemEntry) {
      const routeField = String(queryItemEntry[0] || 'name').trim() || 'name'
      const previewItems = (cfg.previewQueryItems && typeof cfg.previewQueryItems === 'object') ? cfg.previewQueryItems : {}
      const previewValue = Object.prototype.hasOwnProperty.call(previewItems, routeField)
        ? previewItems[routeField]
        : getByPath(previewItems, routeField)
      return {
        field,
        cfg,
        source: 'api',
        routeField,
        previewValue,
      }
    }

    if (!cfg.collection)
      continue

    return {
      field,
      cfg,
      source: 'collection',
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

const getPreviewFallbackQueryItems = (cfg) => {
  const queryItems = (cfg?.queryItems && typeof cfg.queryItems === 'object') ? cfg.queryItems : {}
  return Object.fromEntries(
    Object.entries(queryItems).filter(([, value]) => {
      try {
        return !JSON.stringify(value).includes('{routeLastSegment}')
      }
      catch {
        return true
      }
    }),
  )
}

const fetchPreviewApiFallbackRecord = async (cfg) => {
  if (!cfg?.api)
    return null
  const preparedCfg = edgeGlobal.prepareCmsMetaForRuntime({ preview: cfg }, props.siteId, {
    routeLastSegment: '',
  })?.preview || cfg
  const url = buildUrlWithQuery(
    String(preparedCfg.api),
    String(preparedCfg.apiQuery || ''),
    getPreviewFallbackQueryItems(preparedCfg),
  )
  const json = await $fetch(url, { method: 'GET' })
  const data = normalizeApiArrayData(getByPath(json, preparedCfg.apiField || ''))
  return data[0] || null
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

    const cacheKey = [
      edgeGlobal.edgeState.currentOrganization,
      props.siteId,
      previewConfig.field,
      previewConfig.source,
      previewConfig.source === 'api'
        ? String(previewConfig.cfg?.api || '')
        : getPreviewCollectionPath(previewConfig.cfg),
      String(previewConfig.cfg?.apiQuery || ''),
      String(previewConfig.cfg?.apiField || ''),
      previewConfig.routeField,
      JSON.stringify(previewConfig.cfg?.previewQueryItems || {}),
    ].join(':')
    const cached = String(previewRouteSegmentCache.value?.[cacheKey] || '').trim()
    if (cached) {
      fallbackRouteLastSegment.value = cached
      return
    }

    try {
      const configuredPreviewValue = String(previewConfig.previewValue || '').trim()
      if (configuredPreviewValue) {
        previewRouteSegmentCache.value[cacheKey] = configuredPreviewValue
        fallbackRouteLastSegment.value = configuredPreviewValue
        return
      }

      let firstRecord = null
      if (previewConfig.source === 'api') {
        firstRecord = await fetchPreviewApiFallbackRecord(previewConfig.cfg)
      }
      else {
        const collectionPath = getPreviewCollectionPath(previewConfig.cfg)
        if (!collectionPath) {
          fallbackRouteLastSegment.value = ''
          return
        }
        const staticSearch = new edgeFirebase.SearchStaticData()
        await staticSearch.getData(collectionPath, getPreviewFallbackQuery(previewConfig.cfg), previewConfig.cfg.collection.order, 1)
        firstRecord = Object.values(staticSearch.results?.data || {})[0]
      }
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
  return edgeGlobal.prepareCmsMetaForRuntime(props.meta, props.siteId, {
    routeLastSegment: effectiveRouteLastSegment.value,
  })
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
    :template-version="props.templateVersion"
    :template="props.template"
    :schema="props.schema"
    :data-sources="props.dataSources"
    :site-id="props.siteId"
    :route-last-segment="effectiveRouteLastSegment"
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
