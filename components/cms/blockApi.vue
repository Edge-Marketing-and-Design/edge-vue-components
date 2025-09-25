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
    required: true,
  },
  values: {
    type: Object,
    required: true,
  },
  meta: {
    type: Object,
    required: true,
  },
  theme: {
    type: Object,
    default: null,
  },
})
const emit = defineEmits(['pending'])
const edgeFirebase = inject('edgeFirebase')
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

      const url = buildUrlWithQuery(String(cfg.api), String(cfg.apiQuery || ''), cfg.queryItems || {})
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

/* ---------------- async data (SSR + client) ---------------- */

// Stable, SSR-safe cache key so multiple block instances don't collide
const route = useRoute()
const asyncKey = computed(() => `blockApi:${route.fullPath}:${JSON.stringify(props.meta ?? {})}`)

const { data: apiResolved, pending } = await useAsyncData(
  asyncKey.value,
  () => {
    // Always compute from latest props
    return fetchAllArrays(props.meta, props.values)
  },
  {
    server: true,
    default: () => ({}),
    // Re-run when inputs change on client side
    watch: [() => props.meta, () => props.values],
  },
)

/* ---------------- state & derived values ---------------- */

// Merge props.values (base) + apiResolved (overrides for API-backed fields)
const mergedValues = computed(() => {
  return {
    ...(props.values || {}),
    ...(apiResolved.value || {}),
  }
})

// Map original loading flags into class toggles
const loadingRender = (content) => {
  const isLoading = pending.value
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

// Emit pending state to parent (client-side)
if (import.meta.client) {
  watch(pending, val => emit('pending', val), { immediate: true })
}

const collectionValues = computedAsync(
  async () => {
    const collectionData = await edgeGlobal.cmsCollectionData(
      edgeFirebase,
      mergedValues.value,
      props.meta,
    )
    return collectionData
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
    :meta="props.meta"
  />
</template>

<style scoped>
</style>
