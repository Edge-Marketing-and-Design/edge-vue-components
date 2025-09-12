<script setup>
/**
 * SSR-friendly array loading for block APIs using useAsyncData
 * - Fetches all configured API arrays on the server when possible
 * - Refetches when meta/values change on the client
 * - Preserves original behavior: API fields override same-named props.values fields
 */

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
})

const emit = defineEmits(['pending'])

/* ---------------- helpers ---------------- */

// Safe dot-path getter
const getByPath = (obj, path) => {
  if (!path || typeof path !== 'string')
    return obj
  return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : undefined), obj)
}

// Build URL with optional query string without altering server-side limits
const buildUrlWithQuery = (base, query) => {
  if (!query)
    return base
  if (query.startsWith('?'))
    return `${base}${query}`
  return `${base}${base.includes('?') ? '&' : '?'}${query}`
}

// Core fetcher that resolves all API-backed arrays from meta
const fetchAllArrays = async (meta, baseValues) => {
  const out = {}
  const entries = Object.entries(meta || {})
  await Promise.all(entries.map(async ([field, cfg]) => {
    try {
      if (!cfg || cfg.type !== 'array' || !cfg.api)
        return

      const url = buildUrlWithQuery(String(cfg.api), String(cfg.apiQuery || ''))
      // use $fetch for SSR-friendly HTTP
      const json = await $fetch(url, { method: 'GET' })

      let data = getByPath(json, cfg.apiField || '')
      if (!Array.isArray(data)) {
        data = (data && typeof data === 'object') ? Object.values(data) : []
      }

      const limit = Number(cfg.apiLimit)
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
</script>

<template>
  <edge-cms-block-render
    :content="loadingRender(props.content)"
    :values="mergedValues"
    :meta="props.meta"
  />
</template>

<style scoped>
</style>
