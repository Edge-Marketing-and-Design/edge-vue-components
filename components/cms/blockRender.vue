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
  theme: {
    type: Object,
    default: null,
  },
  isolated: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['loaded'])

const defaultTheme = {
  extend: {
    colors: {
      brand: '#3B82F6',
      accent: '#F59E0B',
      surface: '#FAFAFA',
      subtle: '#F3F4F6',
      text: '#1F2937',
      muted: '#9CA3AF',
      success: '#22C55E',
      danger: '#EF4444',
    },
    fontFamily: {
      sans: ['Overpass', 'sans-serif'],
      serif: ['Kode Mono', 'monospace'],
      mono: ['Overpass', 'sans-serif'],
      brand: ['Kode Mono', 'monospace'],
    },
  },
  apply: {},
  slots: {},
  variants: {
    light: { apply: {} },
    dark: { apply: {}, slots: {} },
  },
}

const theme = computed(() => props.theme ?? defaultTheme)
/* ---------------- Parsing & rendering helpers (aligned with your picker) ---------------- */

const PLACEHOLDER_RE = /(?<!\{)\{\{\s*({[\s\S]*?})\s*\}\}(?!\})/g
const ARRAY_BLOCK_RE = /\{\{\{\s*#array\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)\{\{\{\s*\/array\s*\}\}\}/g
// Nested-only arrays (safer than ARRAY_BLOCK_RE for inner scopes). Optional alias in tag as #subarray:alias
const SUBARRAY_BLOCK_RE = /\{\{\{\s*#subarray(?::([A-Za-z_][A-Za-z0-9_-]*))?\s*(?:({[\s\S]*?}))?\s*\}\}\}([\s\S]*?)\{\{\{\s*\/subarray\s*\}\}\}/g
const SIMPLE_BLOCK_RE = /\{\{\{\s*#(text|image|textarea|richtext)\s*({[\s\S]*?})\s*\}\}\}/g
const IF_BLOCK_RE = /\{\{\{\s*#if\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)(?:\{\{\{\s*#else\s*\}\}\}([\s\S]*?))?\{\{\{\s*\/if\s*\}\}\}/g

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

const escapeHtml = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// ---------------- Schema-based formatting helpers ----------------
const normalizeNumber = (v) => {
  if (v == null || v === '')
    return ''
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const formatters = {
  text: v => (v == null ? '' : String(v)),
  textarea: v => (v == null ? '' : String(v)),
  number: (v) => {
    const n = normalizeNumber(v)
    return Number.isFinite(n) ? n.toLocaleString('en-US') : (v == null ? '' : String(v))
  },
  integer: (v) => {
    const n = normalizeNumber(v)
    return Number.isFinite(n) ? String(Math.trunc(n)) : (v == null ? '' : String(v))
  },
  money: (v) => {
    const n = normalizeNumber(v)
    return Number.isFinite(n)
      ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
      : (v == null ? '' : String(v))
  },
  richtext: v => (v == null ? '' : String(v)), // pass HTML through
}

const getFieldType = (schemaMap, fieldKey) => {
  if (!schemaMap || !fieldKey)
    return undefined
  const baseKey = String(fieldKey).split('.')[0]
  if (Array.isArray(schemaMap)) {
    const hit = schemaMap.find(e => e && e.field === baseKey)
    return hit && (hit.type || hit.value)
  }
  if (schemaMap && typeof schemaMap === 'object') {
    return schemaMap[baseKey]
  }
  return undefined
}

// Given a field name and value, apply schema-based formatting if present
const applySchemaFormat = (fieldKey, value, schemaMap) => {
  if (!schemaMap || !fieldKey)
    return value == null ? '' : String(value)

  const baseKey = String(fieldKey).split('.')[0]

  // Resolve type from either object schema or array schema; support legacy `value` as type
  let type
  if (Array.isArray(schemaMap)) {
    const hit = schemaMap.find(e => e && e.field === baseKey)
    type = hit && (hit.type || hit.value)
  }
  else if (schemaMap && typeof schemaMap === 'object') {
    type = schemaMap[baseKey]
  }

  const f = type && formatters[type]
  return f ? f(value) : (value == null ? '' : String(value))
}
const renderWithValues = (content, values) => {
  // console.log('Rendering content with values:', content, values)
  if (!content || typeof content !== 'string')
    return ''

  // Inner helper bound to current root values
  const renderSection = (tpl, data, alias, schemaCtx) => {
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
      const limit = Number(cfg.limit)
      if (Number.isFinite(limit) && limit > 0)
        list = list.slice(0, limit)
      const childAlias = (typeof cfg.as === 'string' && cfg.as.trim())
        ? cfg.as.trim()
        : ((tagAlias && tagAlias.trim()) || undefined)

      const childSchema = (cfg && cfg.schema && typeof cfg.schema === 'object') ? cfg.schema : schemaCtx
      return list.map(child => renderSection(innerTpl, child, childAlias, childSchema)).join('')
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
      const limit = Number(cfg.limit)
      if (Number.isFinite(limit) && limit > 0)
        list = list.slice(0, limit)
      const childAlias = (typeof cfg.as === 'string' && cfg.as.trim()) ? cfg.as.trim() : undefined
      const childSchema = (cfg && cfg.schema && typeof cfg.schema === 'object') ? cfg.schema : schemaCtx
      return list.map(child => renderSection(innerTpl, child, childAlias, childSchema)).join('')
    })

    // 3) Resolve placeholders for this scope (alias first, then item)
    if (alias && typeof alias === 'string') {
      const esc = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
      expanded = expanded.replace(new RegExp(`\\{\\{\\s*${esc}\\.([a-zA-Z0-9_.$]+)\\s*\\}\\}`, 'g'), (_m, p) => {
        const v = getByPath(data, p)
        const type = getFieldType(schemaCtx, p)
        const formatted = applySchemaFormat(p, v, schemaCtx)
        return type === 'richtext' ? (formatted == null ? '' : String(formatted)) : escapeHtml(String(formatted))
      })
      expanded = expanded.replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g'), () => {
        return data == null ? '' : escapeHtml(String(data))
      })
    }
    // Always allow {{item.*}} to refer to THIS scope
    expanded = expanded.replace(/\{\{\s*item\.([a-zA-Z0-9_.$]+)\s*\}\}/g, (_m, p) => {
      const v = getByPath(data, p)
      const type = getFieldType(schemaCtx, p)
      const formatted = applySchemaFormat(p, v, schemaCtx)
      return type === 'richtext' ? (formatted == null ? '' : String(formatted)) : (formatted == null ? '' : escapeHtml(String(formatted)))
    })
    expanded = expanded.replace(/\{\{\s*item\s*\}\}/g, () => {
      return data == null ? '' : escapeHtml(String(data))
    })

    // 4) Handle simple #if / #else blocks (string equality only)
    expanded = expanded.replace(IF_BLOCK_RE, (_m, json, trueTpl, falseTpl) => {
      const cfg = parseConfig(json || '{}') || {}
      const cond = (cfg.cond || '').trim()
      let result = false

      // Allow: item.path OP value
      const match = cond.match(/^item\.([a-zA-Z0-9_.$]+)\s*(==|!=|>|<|>=|<=)\s*['"]?([^'"]+)['"]?$/)
      if (match) {
        const [, path, op, valRaw] = match
        const v = getByPath(data, path)

        // Compare as numbers if possible, else as strings
        const toComparable = (x) => {
          const n = Number(x)
          return (Number.isFinite(n) && String(x).trim() !== '') ? n : String(x)
        }
        const left = toComparable(v)
        const right = toComparable(valRaw)

        switch (op) {
          case '==':
            result = (left === right)
            break
          case '!=':
            result = (left !== right)
            break
          case '>':
            result = (left > right)
            break
          case '<':
            result = (left < right)
            break
          case '>=':
            result = (left >= right)
            break
          case '<=':
            result = (left <= right)
            break
        }
      }

      return result
        ? renderSection(trueTpl, data, alias, schemaCtx)
        : renderSection(falseTpl || '', data, alias, schemaCtx)
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
    if (kind === 'richtext')
      return String(val) // raw HTML
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
    // Prefer schema from props.meta[field].schema, allow override via tag-level cfg.schema
    const schemaCtx = (props.meta && props.meta[f] && typeof props.meta[f].schema === 'object')
      ? props.meta[f].schema
      : ((cfg && typeof cfg.schema === 'object') ? cfg.schema : undefined)
    return list.map(it => renderSection(innerTpl, it, alias, schemaCtx)).join('')
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
    if (type === 'richtext')
      return String(val)
    return String(val)
  })
}

const rendered = computed(() => {
  return renderWithValues(props.content || '', props.values)
})
</script>

<template>
  <edge-cms-html-content
    :html="rendered"
    :theme="theme"
    :isolated="props.isolated"
    @loaded="emit('loaded')"
  />
</template>

<style scoped>
</style>
