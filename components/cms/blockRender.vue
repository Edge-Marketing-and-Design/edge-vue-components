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
})

/* ---------------- Parsing & rendering helpers (aligned with your picker) ---------------- */

const PLACEHOLDER_RE = /(?<!\{)\{\{\s*({[\s\S]*?})\s*\}\}(?!\})/g
const ARRAY_BLOCK_RE = /\{\{\{\s*#array\s*({[\s\S]*?})\s*\}\}\}([\s\S]*?)\{\{\{\s*\/array\s*\}\}\}/g
const SIMPLE_BLOCK_RE = /\{\{\{\s*#(text|image)\s*({[\s\S]*?})\s*\}\}\}/g

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

const escapeHtml = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const renderWithValues = (content, values) => {
  if (!content || typeof content !== 'string')
    return ''
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
  // Arrays
  content = content.replace(ARRAY_BLOCK_RE, (_m, json, innerTpl) => {
    const cfg = parseConfig(json) || {}
    const f = cfg.field
    let list = Array.isArray(values?.[f]) ? values[f] : (Array.isArray(cfg.value) ? cfg.value : [])
    list = Array.isArray(list) ? list : []
    const getByPath = (obj, path) => {
      if (obj == null)
        return ''
      if (!path || typeof path !== 'string')
        return obj
      return path.split('.').reduce((acc, key) => ((acc && acc[key] !== undefined) ? acc[key] : ''), obj)
    }
    const renderSection = (tpl, data) => {
      if (!tpl)
        return ''
      // {{item.some.path}}
      let out = tpl.replace(/\{\{\s*item\.([a-zA-Z0-9_.$]+)\s*\}\}/g, (_m2, p1) => {
        const v = getByPath(data, p1)
        return typeof v === 'string' ? escapeHtml(v) : (v ?? '')
      })
      // bare {{item}}
      out = out.replace(/\{\{\s*item\s*\}\}/g, () => {
        if (typeof data === 'string')
          return escapeHtml(data)
        if (data == null)
          return ''
        return escapeHtml(String(data))
      })
      return out
    }
    return list.map(it => renderSection(innerTpl, it)).join('')
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

/* ---------------- state & events ---------------- */

const rendered = computed(() =>
  renderWithValues(props.content || '', props.values || {}),
)
</script>

<template>
  <edge-cms-html-content :html="rendered" />
</template>
