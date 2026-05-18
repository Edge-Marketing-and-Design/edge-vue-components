<script setup>
import { renderTemplate } from '@edgedev/template-engine'

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
  isolated: {
    type: Boolean,
    default: true,
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
const renderValues = computed(() => {
  const baseValues = props.values || {}
  if (!props.renderContext || typeof props.renderContext !== 'object' || Array.isArray(props.renderContext))
    return baseValues

  return {
    ...props.renderContext,
    renderBlocks: props.renderContext,
    renderItem: props.renderContext,
    ...baseValues,
  }
})

function normalizeConfigLiteral(str) {
  return String(str || '')
    .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
}

function safeParseTagConfig(raw) {
  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}

function findMatchingBrace(str, startIdx) {
  let depth = 0
  let inString = false
  let quote = null
  let escape = false
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) {
        inString = false
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === '\'') {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{')
      depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0)
        return i
    }
  }
  return -1
}

const TAG_START_RE = /\{\{\{\#([A-Za-z0-9_-]+)\s*\{/g

function* iterateTags(html) {
  TAG_START_RE.lastIndex = 0
  for (;;) {
    const match = TAG_START_RE.exec(html)
    if (!match)
      break

    const type = match[1]
    const tagStart = match.index
    const configStart = TAG_START_RE.lastIndex - 1
    if (configStart < 0 || html[configStart] !== '{')
      continue

    const configEnd = findMatchingBrace(html, configStart)
    if (configEnd === -1)
      continue

    const rawCfg = html.slice(configStart, configEnd + 1)
    const closeTriple = html.indexOf('}}}', configEnd + 1)
    const tagEnd = closeTriple !== -1 ? closeTriple + 3 : configEnd + 1

    yield { type, rawCfg, tagStart, tagEnd }
    TAG_START_RE.lastIndex = tagEnd
  }
}

const renderHtmlSegment = (content) => {
  if (!content)
    return ''
  return renderTemplate(content, renderValues.value, props.meta)
}

const renderedSegments = computed(() => {
  const content = String(props.content || '')
  const segments = []
  let cursor = 0
  let publicationIndex = 0

  for (const tag of iterateTags(content)) {
    if (String(tag.type || '').toLowerCase() !== 'publication')
      continue

    const before = content.slice(cursor, tag.tagStart)
    if (before) {
      segments.push({
        id: `html-${segments.length}`,
        type: 'html',
        html: renderHtmlSegment(before),
      })
    }

    const cfg = safeParseTagConfig(tag.rawCfg)
    const field = String(cfg?.field || '').trim()
    const fieldMeta = props.meta?.[field] || {}
    const pages = renderValues.value?.[field] || cfg?.value || {}
    const effect = fieldMeta.effect || cfg?.effect || 'flip'

    segments.push({
      id: `publication-${field || publicationIndex}-${publicationIndex}`,
      type: 'publication',
      pages,
      effect,
      instanceKey: `${field || 'publication'}-${publicationIndex}`,
    })
    publicationIndex += 1
    cursor = tag.tagEnd
  }

  const after = content.slice(cursor)
  if (after || !segments.length) {
    segments.push({
      id: `html-${segments.length}`,
      type: 'html',
      html: renderHtmlSegment(after),
    })
  }

  return segments
})
</script>

<template>
  <template v-for="segment in renderedSegments" :key="segment.id">
    <edge-cms-html-content
      v-if="segment.type === 'html'"
      :html="segment.html"
      :theme="theme"
      :isolated="props.isolated"
      :viewport-mode="props.viewportMode"
      :standalone-preview="props.standalonePreview"
      @loaded="emit('loaded')"
    />
    <edge-cms-publication-preview
      v-else-if="segment.type === 'publication'"
      :pages="segment.pages"
      :effect="segment.effect"
      :instance-key="segment.instanceKey"
      @click.stop
    />
  </template>
</template>

<style scoped>
</style>
