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

/* ---------------- Parsing & rendering helpers (aligned with your picker) ---------------- */

const PLACEHOLDER_RE = /(?<!\{)\{\{\s*({[\s\S]*?})\s*\}\}(?!\})/g
const ARRAY_BLOCK_RE = /\{\{\{\s*#array\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)\{\{\{\s*\/array\s*\}\}\}/g
// Nested-only arrays (safer than ARRAY_BLOCK_RE for inner scopes). Optional alias in tag as #subarray:alias
const SUBARRAY_BLOCK_RE = /\{\{\{\s*#subarray(?::([A-Za-z_][A-Za-z0-9_-]*))?\s*(?:({[\s\S]*?}))?\s*\}\}\}([\s\S]*?)\{\{\{\s*\/subarray\s*\}\}\}/g
const SIMPLE_BLOCK_RE = /\{\{\{\s*#(text|image|textarea|richtext)\s*({[\s\S]*?})\s*\}\}\}/g

const parseConfig = (raw) => {
  if (typeof raw !== 'string')
    return null
  const s = raw.trim()
  if (/^\{\s*#/.test(s) || /^\{\s*\//.test(s))
    return null
  try {
    return JSON.parse(s)
  }
  catch {
    let fixed = s
    fixed = fixed.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    try {
      return JSON.parse(fixed)
    }
    catch {
      return null
    }
  }
}

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

const escapeHtml = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Arrays
// Supports nested arrays by allowing a nested block to reference a path relative to the current item:
// Example:
// {{{#array {"field":"listthing"}}}
//   <li>
//     {{item.name}}
//     <ul>
//       {{{#array {"field":"item.children", "apiLimit": 3}}}
//         <li>{{item.firstName}} {{item.lastName}}</li>
//       {{{/array}}}
//     </ul>
//   </li>
// {{{/array}}}
// Also supports nested subarrays with an alias in the tag:
// {{{#subarray:agent {"field":"item.agents","apiLimit":3}}}
//   <li>{{agent.name}}</li>
// {{{/subarray}}}

const renderWithValues = (content, values) => {
  if (!content || typeof content !== 'string')
    return ''

  // Inner helper bound to current root values
  const renderSection = (tpl, data, alias) => {
    if (!tpl)
      return ''

    // 1) Expand nested #subarray blocks relative to CURRENT scope (regex; JSON optional; alias optional)
    let expanded = tpl.replace(SUBARRAY_BLOCK_RE, (_m, tagAlias, json, innerTpl) => {
      const cfg = parseConfig(json || '{}') || {}
      // Resolve list relative to current scope (prefer) then root; support both "item.agents" and "agents"
      let list
      const fieldRaw = typeof cfg.field === 'string' ? cfg.field.trim() : ''
      if (fieldRaw) {
        if (fieldRaw.startsWith('item.')) {
          list = getByPath(data, fieldRaw.slice(5))
        }
        else {
          // try direct key or deep path on current item
          list = (data && typeof data === 'object') ? (data[fieldRaw] ?? getByPath(data, fieldRaw)) : undefined
          if (!Array.isArray(list)) {
            // fall back to root values
            list = getByPath(values, fieldRaw)
          }
        }
      }
      else if (Array.isArray(cfg.value)) {
        list = cfg.value
      }
      // last-chance common keys if still not an array
      if (!Array.isArray(list) && data && typeof data === 'object') {
        const maybe = data.agents ?? data.items ?? data.children
        if (Array.isArray(maybe))
          list = maybe
      }
      list = Array.isArray(list) ? list : []
      const limit = Number(cfg.apiLimit)
      if (Number.isFinite(limit) && limit > 0)
        list = list.slice(0, limit)
      const childAlias = (typeof cfg.as === 'string' && cfg.as.trim())
        ? cfg.as.trim()
        : ((tagAlias && tagAlias.trim()) || undefined)

      return list.map(child => renderSection(innerTpl, child, childAlias)).join('')
    })

    // 2) (Optional) Support nested #array inside nested scopes as well (for backward compat)
    expanded = expanded.replace(ARRAY_BLOCK_RE, (_m, json, innerTpl) => {
      const cfg = parseConfig(json || '{}') || {}
      let list
      const fieldRaw = typeof cfg.field === 'string' ? cfg.field.trim() : ''
      if (fieldRaw) {
        if (fieldRaw.startsWith('item.')) {
          list = getByPath(data, fieldRaw.slice(5))
        }
        else {
          list = (data && typeof data === 'object') ? (data[fieldRaw] ?? getByPath(data, fieldRaw)) : undefined
          if (!Array.isArray(list)) {
            list = getByPath(values, fieldRaw)
          }
        }
      }
      else if (Array.isArray(cfg.value)) {
        list = cfg.value
      }
      if (!Array.isArray(list) && data && typeof data === 'object') {
        const maybe = data.agents ?? data.items ?? data.children
        if (Array.isArray(maybe))
          list = maybe
      }
      list = Array.isArray(list) ? list : []
      const limit = Number(cfg.apiLimit)
      if (Number.isFinite(limit) && limit > 0)
        list = list.slice(0, limit)
      const childAlias = (typeof cfg.as === 'string' && cfg.as.trim()) ? cfg.as.trim() : undefined
      return list.map(child => renderSection(innerTpl, child, childAlias)).join('')
    })

    // 3) Resolve placeholders for this scope (alias first, then item)
    if (alias && typeof alias === 'string') {
      const esc = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
      expanded = expanded.replace(new RegExp(`\\{\\{\\s*${esc}\\.([a-zA-Z0-9_.$]+)\\s*\\}\\}`, 'g'), (_m, p) => {
        const v = getByPath(data, p)
        return v == null ? '' : escapeHtml(String(v))
      })
      expanded = expanded.replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g'), () => {
        return data == null ? '' : escapeHtml(String(data))
      })
    }
    // Always allow {{item.*}} to refer to THIS scope
    expanded = expanded.replace(/\{\{\s*item\.([a-zA-Z0-9_.$]+)\s*\}\}/g, (_m, p) => {
      const v = getByPath(data, p)
      return v == null ? '' : escapeHtml(String(v))
    })
    expanded = expanded.replace(/\{\{\s*item\s*\}\}/g, () => {
      return data == null ? '' : escapeHtml(String(data))
    })

    return expanded
  }

  // Simple (#text/#image)
  content = content.replace(SIMPLE_BLOCK_RE, (_match, kind, json) => {
    const cfg = parseConfig(json) || {}
    const f = cfg.field
    const raw = f in values ? values[f] : cfg.value
    const val = raw == null ? '' : raw
    if (kind === 'text')
      return escapeHtml(String(val))
    // image → raw string; typically used inside src={}
    return String(val)
  })
  // Arrays: expand ONLY root-scoped arrays here; nested handled inside renderSection via #subarray or nested #array
  content = content.replace(ARRAY_BLOCK_RE, (full, json, innerTpl) => {
    const cfg = parseConfig(json) || {}
    const f = cfg.field
    if (typeof f === 'string' && f.startsWith('item.')) {
      // leave nested arrays intact for inner scopes
      return full
    }
    let list = Array.isArray(values?.[f]) ? values[f] : (Array.isArray(cfg.value) ? cfg.value : [])
    list = Array.isArray(list) ? list : []
    const alias = (typeof cfg.as === 'string' && cfg.as.trim()) ? cfg.as.trim() : undefined
    return list.map(it => renderSection(innerTpl, it, alias)).join('')
  })
  // Double-brace placeholders (if present)
  return content.replace(PLACEHOLDER_RE, (_m, json) => {
    const obj = parseConfig(json) || {}
    const f = obj.field
    const type = obj.type
    const raw = f in values ? values[f] : obj.value
    const val = raw == null ? '' : raw
    if (type === 'text')
      return escapeHtml(String(val))
    return String(val)
  })
}

const loadApiArrays = async () => {
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
}

/* ---------------- state & events ---------------- */

const rendered = computed(() => {
  return renderWithValues(props.content || '', resolvedValues)
})

onMounted(() => {
  loadApiArrays()
})

watch(
  () => [props.meta, props.values],
  () => { loadApiArrays() },
  { deep: true },
)
</script>

<template>
  <edge-cms-html-content :html="rendered" />
</template>
