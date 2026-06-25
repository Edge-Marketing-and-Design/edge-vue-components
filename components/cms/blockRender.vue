<script setup>
import { renderTemplate, renderTemplateAsync } from '@edgedev/template-engine'

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

const applyTemplateV2DataSourceMeta = (dataSources, meta, tokens) => {
  if (!dataSources || typeof dataSources !== 'object' || Array.isArray(dataSources))
    return {}

  return Object.entries(dataSources).reduce((acc, [sourceName, sourceConfig]) => {
    const sourceMeta = meta?.[sourceName]
    const queryItems = sourceMeta?.queryItems
    const hasQueryItems = queryItems && typeof queryItems === 'object' && !Array.isArray(queryItems)
    const hasLimit = sourceMeta?.limit !== undefined && sourceMeta.limit !== null && sourceMeta.limit !== ''
    if (!hasQueryItems && !hasLimit) {
      acc[sourceName] = replaceTemplateV2RuntimeTokens(sourceConfig, tokens)
      return acc
    }
    const mergedSource = {
      ...(sourceConfig || {}),
      queryItems: {
        ...(sourceConfig?.queryItems || {}),
        ...(hasQueryItems ? queryItems : {}),
      },
    }
    if (hasLimit)
      mergedSource.limit = sourceMeta.limit
    acc[sourceName] = replaceTemplateV2RuntimeTokens(mergedSource, tokens)
    return acc
  }, {})
}

const templateV2Values = computed(() => ({
  ...templateV2RuntimeTokens.value,
  ...normalizeTemplateV2Values(renderValues.value, props.schema),
}))

const templateV2CmsDataSources = computed(() => {
  return Object.entries(applyTemplateV2DataSourceMeta(props.dataSources, props.meta, templateV2RuntimeTokens.value))
    .reduce((acc, [sourceName, sourceConfig]) => {
      acc[sourceName] = {
        ...(sourceConfig || {}),
        value: Array.isArray(templateV2Values.value?.[sourceName])
          ? templateV2Values.value[sourceName]
          : [],
      }
      return acc
    }, {})
})

const getTemplateV2ValueByPath = (source, path) => {
  if (!path || typeof path !== 'string')
    return source
  return path.split('.').reduce((acc, key) => {
    if (acc == null || typeof acc !== 'object')
      return undefined
    return acc[key]
  }, source)
}

const looksLikeTemplateV2ApiRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  return ['id', 'docId', 'rupid', 'property_id', 'display_address'].some(key => Object.prototype.hasOwnProperty.call(value, key))
}

const normalizeTemplateV2ApiArrayData = (data) => {
  if (Array.isArray(data))
    return data
  if (!data || typeof data !== 'object')
    return []
  if (looksLikeTemplateV2ApiRecord(data))
    return [data]
  const values = Object.values(data)
  if (values.length && values.every(item => item && typeof item === 'object' && !Array.isArray(item)))
    return values
  return [data]
}

const buildTemplateV2ApiUrl = (base, query, queryItems = {}) => {
  const safeBase = String(base || '')
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

  for (const [key, value] of Object.entries(queryItems || {})) {
    if (value === undefined || value === null || value === '') {
      params.delete(key)
      continue
    }
    params.delete(key)
    const values = Array.isArray(value) ? value : [value]
    values.forEach((item) => {
      if (item !== undefined && item !== null && item !== '')
        params.append(key, String(item))
    })
  }

  const paramString = params.toString()
  return `${basePath}${paramString ? `?${paramString}` : ''}${hash}`
}

const splitTemplateV2InlineArgs = (input) => {
  const args = []
  let current = ''
  let depth = 0
  let quote = null
  let escape = false
  for (const ch of String(input || '')) {
    if (quote) {
      current += ch
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote)
        quote = null
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[')
      depth += 1
    else if (ch === ')' || ch === '}' || ch === ']')
      depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() || input)
    args.push(current.trim())
  return args
}

const parseTemplateV2QuotedString = (input) => {
  const value = String(input || '').trim()
  const quote = value[0]
  if ((quote !== '"' && quote !== '\'') || value[value.length - 1] !== quote)
    return ''
  return value.slice(1, -1)
}

const resolveTemplateV2ScopedPath = (path, scope) => {
  return getTemplateV2ValueByPath(scope, path)
}

const parseTemplateV2ScopedObjectLiteral = (raw, scope) => {
  const input = String(raw || '').trim()
  if (!input.startsWith('{') || !input.endsWith('}'))
    return null

  let output = ''
  let quote = null
  let escape = false
  const readIdentifier = (start) => {
    let end = start
    while (end < input.length && /[A-Za-z0-9_.$-]/.test(input[end]))
      end += 1
    return { token: input.slice(start, end), end }
  }

  for (let i = 0; i < input.length;) {
    const ch = input[i]
    if (quote) {
      output += ch
      if (escape) {
        escape = false
        i += 1
        continue
      }
      if (ch === '\\') {
        escape = true
        i += 1
        continue
      }
      if (ch === quote)
        quote = null
      i += 1
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch
      output += ch
      i += 1
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      const { token, end } = readIdentifier(i)
      let cursor = end
      while (cursor < input.length && /\s/.test(input[cursor]))
        cursor += 1

      if (input[cursor] === ':') {
        output += JSON.stringify(token)
        i = end
        continue
      }

      if (token === 'true' || token === 'false' || token === 'null') {
        output += token
        i = end
        continue
      }

      output += JSON.stringify(resolveTemplateV2ScopedPath(token, scope))
      i = end
      continue
    }

    output += ch
    i += 1
  }

  try {
    const parsed = JSON.parse(output)
    const parsedIsObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    return parsedIsObject ? parsed : null
  }
  catch {
    return null
  }
}

const parseTemplateV2SourceExpression = (expression, scope) => {
  const match = String(expression || '').trim().match(/^source\(([\s\S]*)\)$/)
  if (!match)
    return null
  const args = splitTemplateV2InlineArgs(match[1] || '')
  const name = parseTemplateV2QuotedString(args[0] || '')
  if (!name)
    return null
  const parsedOverrides = args[1] ? parseTemplateV2ScopedObjectLiteral(args[1], scope) : null
  const overrides = parsedOverrides || {}
  return { name, overrides }
}

const replaceTemplateLoadingStateTokens = (template, state = 'loaded') => {
  const loadingClass = state === 'loading' ? '' : 'hidden'
  const loadedClass = state === 'loaded' ? '' : 'hidden'
  return String(template || '')
    .replace(/\{\{\s*loading\s*\}\}/g, loadingClass)
    .replace(/\{\{\s*loaded\s*\}\}/g, loadedClass)
}

const readTemplateV2ForTagAt = (input, start) => {
  if (!input.startsWith('{{', start))
    return null

  let cursor = start + 2
  while (/\s/.test(input[cursor] || ''))
    cursor += 1

  if (input.startsWith('/for', cursor)) {
    const close = input.indexOf('}}', cursor + 4)
    if (close === -1)
      return null
    return {
      start,
      end: close + 2,
      isOpen: false,
    }
  }

  if (!input.startsWith('#for', cursor))
    return null

  const expressionStart = cursor + 4
  let quote = null
  let escape = false
  let braceDepth = 0
  let bracketDepth = 0
  let parenDepth = 0

  for (let i = expressionStart; i < input.length; i += 1) {
    const ch = input[i]

    if (quote) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote)
        quote = null
      continue
    }

    if (ch === '\'' || ch === '"') {
      quote = ch
      continue
    }

    if (ch === '}' && input[i + 1] === '}' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const rawExpression = input.slice(expressionStart, i).trim()
      const match = rawExpression.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\s+in\s+)?([\s\S]+)$/)
      if (!match || !match[2])
        return null
      return {
        start,
        end: i + 2,
        isOpen: true,
        alias: match[1] || 'item',
        expression: match[2],
      }
    }

    if (ch === '{')
      braceDepth += 1
    else if (ch === '}' && braceDepth > 0)
      braceDepth -= 1
    else if (ch === '[')
      bracketDepth += 1
    else if (ch === ']' && bracketDepth > 0)
      bracketDepth -= 1
    else if (ch === '(')
      parenDepth += 1
    else if (ch === ')' && parenDepth > 0)
      parenDepth -= 1
  }

  return null
}

const readNextTemplateV2ForTag = (input, from = 0) => {
  let cursor = from
  while (cursor < input.length) {
    const start = input.indexOf('{{', cursor)
    if (start === -1)
      return null
    const tag = readTemplateV2ForTagAt(input, start)
    if (tag)
      return tag
    cursor = start + 2
  }
  return null
}

const findNextTemplateV2ForBlock = (input) => {
  const open = readNextTemplateV2ForTag(input, 0)
  if (!open?.isOpen || !open.expression)
    return null

  let depth = 1
  let cursor = open.end
  let close = readNextTemplateV2ForTag(input, cursor)
  while (close) {
    if (close.isOpen) {
      depth += 1
      cursor = close.end
      close = readNextTemplateV2ForTag(input, cursor)
      continue
    }

    depth -= 1
    if (depth === 0) {
      return {
        start: open.start,
        end: close.end,
        alias: open.alias || 'item',
        expression: open.expression,
        innerTpl: input.slice(open.end, close.start),
      }
    }
    cursor = close.end
    close = readNextTemplateV2ForTag(input, cursor)
  }
  return null
}

const valuesMatchTemplateV2Query = (recordValue, queryValue) => {
  if (Array.isArray(recordValue))
    return recordValue.some(item => valuesMatchTemplateV2Query(item, queryValue))
  if (Array.isArray(queryValue))
    return queryValue.some(item => valuesMatchTemplateV2Query(recordValue, item))
  return recordValue === queryValue || String(recordValue ?? '') === String(queryValue ?? '')
}

const resolveTemplateV2ParentToken = (value, scope) => {
  if (typeof value !== 'string')
    return value
  const trimmed = value.trim()
  const parentMatch = trimmed.match(/^\{parent\.([^}]+)\}$/)
  if (parentMatch)
    return getTemplateV2ValueByPath(scope, parentMatch[1])
  return value
}

const resolveTemplateV2ScopedQueryItems = (queryItems, scope) => {
  if (!queryItems || typeof queryItems !== 'object' || Array.isArray(queryItems))
    return {}
  return Object.entries(queryItems).reduce((acc, [field, value]) => {
    acc[field] = resolveTemplateV2ParentToken(value, scope)
    return acc
  }, {})
}

const getTemplateV2CanonicalDocIds = (canonicalLookup, scope) => {
  const rawKey = resolveTemplateV2ParentToken(canonicalLookup?.key, scope)
  const keys = Array.isArray(rawKey) ? rawKey : [rawKey]
  return keys.map((key) => {
    const stringKey = String(key || '').trim()
    if (!stringKey)
      return ''
    const segments = stringKey.split(':').filter(Boolean)
    return segments[segments.length - 1] || stringKey
  }).filter(Boolean)
}

const compareTemplateV2OrderValues = (aValue, bValue) => {
  if (aValue == null && bValue == null)
    return 0
  if (aValue == null)
    return 1
  if (bValue == null)
    return -1
  const aNum = Number(aValue)
  const bNum = Number(bValue)
  if (Number.isFinite(aNum) && Number.isFinite(bNum))
    return aNum === bNum ? 0 : aNum > bNum ? 1 : -1
  return String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' })
}

const applyTemplateV2SourceOrder = (records, orderList) => {
  if (!Array.isArray(orderList) || !orderList.length)
    return records
  const validOrders = orderList.filter(order => order && typeof order.field === 'string' && order.field.trim())
  if (!validOrders.length)
    return records
  return [...records].sort((a, b) => {
    for (const order of validOrders) {
      const direction = String(order.direction || 'asc').toLowerCase() === 'desc' ? -1 : 1
      const compared = compareTemplateV2OrderValues(
        getTemplateV2ValueByPath(a, order.field),
        getTemplateV2ValueByPath(b, order.field),
      )
      if (compared !== 0)
        return compared * direction
    }
    return 0
  })
}

const applyTemplateV2SourceOverrides = (items, sourceConfig, overrides, scope) => {
  let records = Array.isArray(items) ? [...items] : []
  const canonicalLookup = overrides?.canonicalLookup || sourceConfig?.canonicalLookup
  const canonicalDocIds = getTemplateV2CanonicalDocIds(canonicalLookup, scope)
  if (canonicalLookup && !canonicalDocIds.length)
    return []
  if (canonicalDocIds.length) {
    const canonicalSet = new Set(canonicalDocIds.map(id => String(id)))
    records = records.filter((record) => {
      const recordDocId = getTemplateV2ValueByPath(record, 'docId') ?? getTemplateV2ValueByPath(record, 'id')
      return canonicalSet.has(String(recordDocId ?? ''))
    })
  }
  const mergedQueryItems = {
    ...((sourceConfig?.queryItems && typeof sourceConfig.queryItems === 'object' && !Array.isArray(sourceConfig.queryItems)) ? sourceConfig.queryItems : {}),
    ...((overrides?.queryItems && typeof overrides.queryItems === 'object' && !Array.isArray(overrides.queryItems)) ? overrides.queryItems : {}),
  }
  const hasQueryItems = Object.keys(mergedQueryItems).length > 0
  const queryItems = hasQueryItems
    ? mergedQueryItems
    : {}
  for (const [field, value] of Object.entries(queryItems)) {
    const resolvedValue = resolveTemplateV2ParentToken(value, scope)
    if (resolvedValue === undefined || resolvedValue === null || resolvedValue === '')
      continue
    records = records.filter(record => valuesMatchTemplateV2Query(getTemplateV2ValueByPath(record, field), resolvedValue))
  }
  records = applyTemplateV2SourceOrder(records, overrides?.order || sourceConfig?.order)
  const limit = Number(overrides?.limit ?? sourceConfig?.limit)
  if (Number.isFinite(limit) && limit > 0)
    records = records.slice(0, Math.floor(limit))
  return records
}

const fetchTemplateV2ApiSource = async (sourceConfig, overrides, scope, renderOptions = {}) => {
  if (!sourceConfig?.api)
    return null

  const mergedQueryItems = {
    ...resolveTemplateV2ScopedQueryItems(sourceConfig.queryItems, scope),
    ...resolveTemplateV2ScopedQueryItems(overrides?.queryItems, scope),
  }
  const url = buildTemplateV2ApiUrl(
    sourceConfig.api,
    overrides?.apiQuery ?? sourceConfig.apiQuery ?? '',
    mergedQueryItems,
  )
  const apiField = String(overrides?.apiField || sourceConfig.apiField || '')
  const cache = renderOptions.templateV2ApiRequestCache || (renderOptions.templateV2ApiRequestCache = new Map())
  const cacheKey = JSON.stringify({ url, apiField })
  if (cache.has(cacheKey))
    return cache.get(cacheKey)

  const load = (async () => {
    try {
      const json = await $fetch(url, { method: 'GET' })
      let records = normalizeTemplateV2ApiArrayData(getTemplateV2ValueByPath(json, apiField))
      records = applyTemplateV2SourceOrder(records, overrides?.order || sourceConfig?.order)
      const limit = Number(overrides?.limit ?? sourceConfig?.limit)
      if (Number.isFinite(limit) && limit > 0)
        records = records.slice(0, Math.floor(limit))
      return records
    }
    catch {
      return []
    }
  })()
  cache.set(cacheKey, load)
  return load
}

const parseTemplateV2LoopExpression = (expression, scope) => {
  const parts = splitTemplateV2InlineArgs(String(expression || ''))
  if (parts.length < 2)
    return { expression: String(expression || '').trim(), options: {} }

  const options = parseTemplateV2ScopedObjectLiteral(parts[parts.length - 1] || '', scope)
  if (!options)
    return { expression: String(expression || '').trim(), options: {} }

  return {
    expression: parts.slice(0, -1).join(', ').trim(),
    options,
  }
}

const resolveTemplateV2CmsForItems = async (expression, scope, dataSources, renderOptions) => {
  const sourceCall = parseTemplateV2SourceExpression(expression, scope)
  if (sourceCall) {
    const sourceConfig = dataSources?.[sourceCall.name] || {}
    if (sourceConfig?.api) {
      const apiItems = await fetchTemplateV2ApiSource(sourceConfig, sourceCall.overrides, scope, renderOptions)
      if (apiItems)
        return apiItems
    }
    return applyTemplateV2SourceOverrides(sourceConfig.value, sourceConfig, sourceCall.overrides, scope)
  }
  const loopExpression = parseTemplateV2LoopExpression(expression, scope)
  const resolved = resolveTemplateV2ScopedPath(loopExpression.expression, scope)
  if (!Array.isArray(resolved))
    return []

  const limit = Number(loopExpression.options?.limit)
  if (Number.isFinite(limit) && limit > 0)
    return resolved.slice(0, Math.floor(limit))
  return resolved
}

const createTemplateV2ChildScope = (scope, alias, entry) => {
  const nextScope = {
    ...(scope || {}),
    [alias || 'item']: entry,
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry))
    Object.assign(nextScope, entry)
  return nextScope
}

const renderTemplateV2CmsSection = async (template, scope, dataSources, schema, renderOptions) => {
  let output = replaceTemplateLoadingStateTokens(template, 'loaded')
  let forBlock = findNextTemplateV2ForBlock(output)
  while (forBlock) {
    const items = (await resolveTemplateV2CmsForItems(forBlock.expression, scope, dataSources, renderOptions)).slice(0, 500)
    const renderedItems = []
    for (const entry of items) {
      const childScope = createTemplateV2ChildScope(scope, forBlock.alias, entry)
      renderedItems.push(await renderTemplateV2CmsSection(forBlock.innerTpl, childScope, dataSources, schema, renderOptions))
    }
    output = `${output.slice(0, forBlock.start)}${renderedItems.join('')}${output.slice(forBlock.end)}`
    forBlock = findNextTemplateV2ForBlock(output)
  }
  return renderTemplateAsync(
    output,
    scope || {},
    {},
    {
      ...renderOptions,
      hydrateOptions: null,
      dataSources,
      schema,
      templateVersion: 2,
    },
  )
}

const templateV2Block = computed(() => ({
  templateVersion: 2,
  template: props.template || props.content || '',
  values: templateV2Values.value,
  schema: normalizeTemplateV2Schema(props.schema),
  dataSources: templateV2CmsDataSources.value,
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

const getPublicationMeta = (field) => {
  if (isTemplateV2.value) {
    const schemaEntry = props.schema?.[field]
    if (schemaEntry && typeof schemaEntry === 'object' && !Array.isArray(schemaEntry))
      return schemaEntry
    return {}
  }
  return props.meta?.[field] || {}
}

const renderPublicationContent = (content, values, renderSegment) => {
  let html = ''
  const publications = []
  let cursor = 0
  let publicationIndex = 0

  for (const tag of iterateTags(content)) {
    if (String(tag.type || '').toLowerCase() !== 'publication')
      continue

    const before = content.slice(cursor, tag.tagStart)
    if (before)
      html += renderSegment(before)

    const cfg = safeParseTagConfig(tag.rawCfg)
    const field = String(cfg?.field || '').trim()
    const fieldMeta = getPublicationMeta(field)
    const pages = values?.[field] || cfg?.value || {}
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
    html += renderSegment(after)

  return { html, publications }
}

const renderedBlock = computed(() => {
  if (isTemplateV2.value) {
    return renderPublicationContent(
      String(templateV2Html.value || ''),
      templateV2Values.value,
      segment => segment,
    )
  }

  return renderPublicationContent(
    String(props.content || ''),
    renderValues.value,
    renderHtmlSegment,
  )
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
      const result = await renderTemplateV2CmsSection(
        block.template || '',
        block.values || {},
        block.dataSources || {},
        block.schema || {},
        {
          theme: theme.value || {},
          extraHtml: '',
        },
      )
      if (renderToken === templateV2RenderToken)
        templateV2Html.value = result || ''
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
