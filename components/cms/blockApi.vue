<script setup>
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

// Local resolved values (do not mutate props)
const resolvedValues = reactive({ ...(props.values || {}) })
const isLoading = ref(true)

// Helper: safe dot-path getter
const getByPath = (obj, path) => {
  if (!path || typeof path !== 'string')
    return obj
  return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : undefined), obj)
}

// Helper: build URL with optional query string without altering server-side limits
const buildUrlWithQuery = (base, query) => {
  if (!query)
    return base
  if (query.startsWith('?'))
    return `${base}${query}`
  return `${base}${base.includes('?') ? '&' : '?'}${query}`
}

const loadApiArrays = async () => {
  isLoading.value = true
  // Start from current prop values to avoid stale merges
  Object.keys(resolvedValues).forEach((k) => {
    delete resolvedValues[k]
  })
  Object.assign(resolvedValues, props.values || {})

  const meta = props.meta || {}
  const entries = Object.entries(meta)
  const fetches = entries.map(async ([field, cfg]) => {
    try {
      if (!cfg || cfg.type !== 'array' || !cfg.api)
        return

      const url = buildUrlWithQuery(String(cfg.api), String(cfg.apiQuery || ''))
      const res = await fetch(url, { method: 'GET' })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      let data = getByPath(json, cfg.apiField || '')
      if (!Array.isArray(data)) {
        // If it's an object, try to coerce to array of values; otherwise fallback to empty array
        data = (data && typeof data === 'object') ? Object.values(data) : []
      }

      // Apply client-side limit only (do not pass to API)
      const limit = Number(cfg.apiLimit)
      if (Number.isFinite(limit) && limit > 0)
        data = data.slice(0, limit)

      // Write into resolvedValues
      resolvedValues[field] = data
    }
    catch (e) {
      // On error, preserve any existing prop value or fallback to []
      if (!(field in resolvedValues))
        resolvedValues[field] = Array.isArray((props.values || {})[field]) ? (props.values || {})[field] : []
      // Optionally, you can console.warn here for visibility
      // console.warn('loadApiArrays error for', field, e)
    }
  })

  await Promise.all(fetches)
  isLoading.value = false
}

/* ---------------- state & events ---------------- */

const loadingRender = (content) => {
  if (isLoading.value) {
    content = content.replaceAll('{{loading}}', '')
    content = content.replaceAll('{{loaded}}', 'hidden')
  }
  else {
    content = content.replaceAll('{{loading}}', 'hidden')
    content = content.replaceAll('{{loaded}}', '')
  }
  return content
}

onMounted(async () => {
  await loadApiArrays()
})

watch(
  () => [props.meta, props.values],
  () => { loadApiArrays() },
  { deep: true },
)
</script>

<template>
  <edge-cms-block-render :content="loadingRender(props.content)" :values="resolvedValues" :meta="props.meta" />
</template>

<style scoped>
</style>
