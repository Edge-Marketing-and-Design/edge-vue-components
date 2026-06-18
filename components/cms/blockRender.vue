<script setup>
import { pageRender, renderTemplate } from '@edgedev/template-engine'

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
  siteId: {
    type: String,
    default: '',
  },
  routeLastSegment: {
    type: String,
    default: '',
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
const renderInstanceId = `cms-block-render-${Math.random().toString(36).slice(2, 10)}`
const htmlReady = ref(false)
const templateV2Html = ref('')
let templateV2RenderToken = 0

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
const isTemplateV2 = computed(() => Number(props.templateVersion) === 2)
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

const templateV2RuntimeTokens = computed(() => ({
  orgId: String(edgeGlobal.edgeState.currentOrganization || ''),
  siteId: String(props.siteId || ''),
  routeLastSegment: String(props.routeLastSegment || props.renderContext?.routeLastSegment || ''),
  pageId: String(props.renderContext?.pageId || ''),
  postId: String(props.renderContext?.postId || ''),
}))

const normalizeTemplateV2Schema = (schema) => {
  if (!schema || typeof schema !== 'object')
    return {}
  if (Array.isArray(schema))
    return schema
  return Object.entries(schema).reduce((normalized, [field, config]) => {
    if (config && typeof config === 'object' && !Array.isArray(config))
      normalized[field] = config.type || config.value || config
    else
      normalized[field] = config
    return normalized
  }, {})
}

const getTemplateV2SchemaDefaults = (schema) => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return {}
  return Object.entries(schema).reduce((defaults, [field, config]) => {
    if (config && typeof config === 'object' && !Array.isArray(config) && Object.prototype.hasOwnProperty.call(config, 'value'))
      defaults[field] = config.value
    return defaults
  }, {})
}

const normalizeTemplateV2Values = (values, schema) => {
  const defaults = getTemplateV2SchemaDefaults(schema)
  const normalized = { ...defaults, ...(values || {}) }
  Object.entries(defaults).forEach(([field, value]) => {
    if (normalized[field] === '')
      normalized[field] = value
  })
  return normalized
}

const replaceTemplateV2RuntimeTokens = (value, tokens) => {
  if (typeof value === 'string') {
    return Object.entries(tokens || {}).reduce((resolved, [key, tokenValue]) => {
      if (!tokenValue)
        return resolved
      return resolved.replaceAll(`{${key}}`, tokenValue)
    }, value)
  }
  if (Array.isArray(value))
    return value.map(item => replaceTemplateV2RuntimeTokens(item, tokens))
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, child]) => {
      acc[key] = replaceTemplateV2RuntimeTokens(child, tokens)
      return acc
    }, {})
  }
  return value
}

const applyTemplateV2DataSourceControlValues = (dataSources, values, tokens) => {
  const controlValues = values?.dataSources
  if (!dataSources || typeof dataSources !== 'object' || Array.isArray(dataSources))
    return {}

  return Object.entries(dataSources).reduce((acc, [sourceName, sourceConfig]) => {
    const sourceControlValues = controlValues?.[sourceName]
    if (!sourceControlValues || typeof sourceControlValues !== 'object' || Array.isArray(sourceControlValues)) {
      acc[sourceName] = replaceTemplateV2RuntimeTokens(sourceConfig, tokens)
      return acc
    }
    const mergedSource = {
      ...(sourceConfig || {}),
      queryItems: {
        ...(sourceConfig?.queryItems || {}),
        ...sourceControlValues,
      },
    }
    acc[sourceName] = replaceTemplateV2RuntimeTokens(mergedSource, tokens)
    return acc
  }, {})
}

const templateV2Values = computed(() => ({
  ...templateV2RuntimeTokens.value,
  ...normalizeTemplateV2Values(renderValues.value, props.schema),
}))

const templateV2HydrateOptions = computed(() => {
  const fetchImpl = globalThis.fetch?.bind(globalThis)
  if (!fetchImpl)
    return null

  const uniqueKey = [
    templateV2RuntimeTokens.value.orgId,
    props.siteId || 'preview',
  ].filter(Boolean).join(':') || 'preview'

  return {
    uniqueKey,
    clientOptions: {
      fetch: fetchImpl,
    },
  }
})

const templateV2Block = computed(() => ({
  templateVersion: 2,
  template: props.template || props.content || '',
  values: templateV2Values.value,
  schema: normalizeTemplateV2Schema(props.schema),
  dataSources: applyTemplateV2DataSourceControlValues(props.dataSources, templateV2Values.value, templateV2RuntimeTokens.value),
}))

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

const renderedBlock = computed(() => {
  if (isTemplateV2.value)
    return { html: templateV2Html.value, publications: [] }

  const content = String(props.content || '')
  let html = ''
  const publications = []
  let cursor = 0
  let publicationIndex = 0

  for (const tag of iterateTags(content)) {
    if (String(tag.type || '').toLowerCase() !== 'publication')
      continue

    const before = content.slice(cursor, tag.tagStart)
    if (before)
      html += renderHtmlSegment(before)

    const cfg = safeParseTagConfig(tag.rawCfg)
    const field = String(cfg?.field || '').trim()
    const fieldMeta = props.meta?.[field] || {}
    const pages = renderValues.value?.[field] || cfg?.value || {}
    const effect = fieldMeta.effect || cfg?.effect || 'flip'
    const targetId = `${renderInstanceId}-publication-${publicationIndex}`

    html += `<div id="${targetId}" class="edge-cms-publication-slot"></div>`
    publications.push({
      id: targetId,
      target: `#${targetId}`,
      pages,
      effect,
      instanceKey: `${field || 'publication'}-${publicationIndex}`,
    })
    publicationIndex += 1
    cursor = tag.tagEnd
  }

  const after = content.slice(cursor)
  if (after || !html)
    html += renderHtmlSegment(after)

  return { html, publications }
})

watch(
  templateV2Block,
  async (block) => {
    if (!isTemplateV2.value) {
      templateV2Html.value = ''
      return
    }

    const renderToken = ++templateV2RenderToken
    try {
      const result = await pageRender([block], theme.value || {}, '', templateV2HydrateOptions.value)
      if (renderToken === templateV2RenderToken)
        templateV2Html.value = result?.html || ''
    }
    catch {
      if (renderToken === templateV2RenderToken)
        templateV2Html.value = ''
    }
  },
  { immediate: true, deep: true },
)

watch(() => renderedBlock.value.html, () => {
  htmlReady.value = false
})

const handleHtmlLoaded = async () => {
  await nextTick()
  htmlReady.value = true
  emit('loaded')
}
</script>

<template>
  <edge-cms-html-content
    :html="renderedBlock.html"
    :theme="theme"
    :isolated="props.isolated"
    :viewport-mode="props.viewportMode"
    :standalone-preview="props.standalonePreview"
    @loaded="handleHtmlLoaded"
  />
  <ClientOnly>
    <template v-if="htmlReady">
      <Teleport
        v-for="publication in renderedBlock.publications"
        :key="publication.id"
        :to="publication.target"
      >
        <edge-cms-publication-preview
          :pages="publication.pages"
          :effect="publication.effect"
          :instance-key="publication.instanceKey"
          @click.stop
        />
      </Teleport>
    </template>
  </ClientOnly>
</template>

<style scoped>
</style>
