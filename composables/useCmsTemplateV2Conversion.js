const LEGACY_TAG_RE = /\{\{\{\#([A-Za-z0-9_-]+)(?::([A-Za-z0-9_-]+))?\s*\{/g
const LEGACY_CLOSE_RE = type => new RegExp(`\\{\\{\\{/${type}\\}\\}\\}`, 'g')

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const INLINE_SCHEMA_FORMATTERS = new Set([
  'date',
  'datetime',
  'money',
  'number',
  'integer',
  'lower',
  'upper',
  'trim',
  'slug',
  'title',
  'deslug',
  'default',
  'richtext',
])
const SCHEMA_FORMATTER_TYPE_MAP = {
  money: 'number',
  integer: 'number',
  date: 'text',
  datetime: 'text',
  lower: 'text',
  upper: 'text',
  trim: 'text',
  slug: 'text',
  title: 'text',
  deslug: 'text',
}

const cloneValue = (value) => {
  if (Array.isArray(value) || isPlainObject(value))
    return JSON.parse(JSON.stringify(value))
  return value
}

const findMatchingBrace = (text, startIndex) => {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      }
      else if (char === '\\') {
        escaped = true
      }
      else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth++
    }
    else if (char === '}') {
      depth--
      if (depth === 0)
        return index
    }
  }

  return -1
}

const parseJsonConfig = (rawConfig) => {
  try {
    return JSON.parse(rawConfig)
  }
  catch {
    return null
  }
}

const findNextLegacyTag = (template, startIndex = 0) => {
  LEGACY_TAG_RE.lastIndex = startIndex
  const match = LEGACY_TAG_RE.exec(template)
  if (!match)
    return null

  const configStart = LEGACY_TAG_RE.lastIndex - 1
  const configEnd = findMatchingBrace(template, configStart)
  if (configEnd === -1)
    return null

  const tagEnd = template.indexOf('}}}', configEnd + 1)
  if (tagEnd === -1)
    return null

  return {
    type: match[1],
    alias: match[2] || '',
    start: match.index,
    configStart,
    configEnd,
    end: tagEnd + 3,
    rawConfig: template.slice(configStart, configEnd + 1),
  }
}

const findLegacyCloseTag = (template, type, startIndex) => {
  const openRe = new RegExp(`\\{\\{\\{#${type}(?::[A-Za-z0-9_-]+)?\\s*\\{`, 'g')
  const closeRe = LEGACY_CLOSE_RE(type)
  openRe.lastIndex = startIndex
  closeRe.lastIndex = startIndex
  let depth = 1
  let cursor = startIndex

  for (;;) {
    openRe.lastIndex = cursor
    closeRe.lastIndex = cursor
    const openMatch = openRe.exec(template)
    const closeMatch = closeRe.exec(template)

    if (!closeMatch)
      return null

    if (openMatch && openMatch.index < closeMatch.index) {
      depth++
      cursor = openMatch.index + openMatch[0].length
      continue
    }

    depth--
    if (depth === 0) {
      return {
        start: closeMatch.index,
        end: closeMatch.index + closeMatch[0].length,
      }
    }
    cursor = closeMatch.index + closeMatch[0].length
  }
}

const toTitle = (value) => {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

const sanitizeIdentifier = (value, fallback = 'source') => {
  const cleaned = String(value || '')
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .replace(/\s+([A-Za-z0-9_$])/g, (_, char) => char.toUpperCase())
    .replace(/^[^A-Za-z_$]+/, '')
  return cleaned || fallback
}

const singularize = (value) => {
  const cleaned = sanitizeIdentifier(value, '')
  if (!cleaned)
    return ''
  if (cleaned.endsWith('ies'))
    return `${cleaned.slice(0, -3)}y`
  if (cleaned.endsWith('children'))
    return 'child'
  if (cleaned.endsWith('s') && cleaned.length > 1)
    return cleaned.slice(0, -1)
  return cleaned
}

const getPathLastSegment = (path) => {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .pop() || ''
}

const uniqueAlias = (baseAlias, usedAliases) => {
  const base = sanitizeIdentifier(baseAlias, 'subItem')
  if (!usedAliases.has(base)) {
    usedAliases.add(base)
    return base
  }

  let index = 2
  for (;;) {
    const candidate = `${base}${index}`
    if (!usedAliases.has(candidate)) {
      usedAliases.add(candidate)
      return candidate
    }
    index++
  }
}

const inferSubarrayAlias = (fieldPath, usedAliases) => {
  const segment = getPathLastSegment(fieldPath)
  const singular = singularize(segment)
  return uniqueAlias(singular || 'subItem', usedAliases)
}

const getSchemaEntryType = (config) => {
  if (typeof config === 'string')
    return config
  if (isPlainObject(config))
    return config.type || config.value || ''
  return ''
}

const getEditorSchemaType = (type) => {
  const normalized = String(type || '').trim().toLowerCase()
  return SCHEMA_FORMATTER_TYPE_MAP[normalized] || normalized || 'text'
}

const addSchemaFormatter = (schemaEntry, type) => {
  const normalized = String(type || '').trim().toLowerCase()
  if (INLINE_SCHEMA_FORMATTERS.has(normalized))
    schemaEntry.formatter = normalized
  return schemaEntry
}

const convertSchemaDefinition = (schema) => {
  if (Array.isArray(schema)) {
    return schema.reduce((acc, item) => {
      if (!item?.field)
        return acc
      const field = String(item.field)
      const schemaType = getSchemaEntryType(item) || 'text'
      acc[field] = addSchemaFormatter({
        type: getEditorSchemaType(schemaType),
        label: item.title || item.label || toTitle(field),
      }, schemaType)
      if (Object.prototype.hasOwnProperty.call(item, 'value') && item.type)
        acc[field].value = cloneValue(item.value)
      return acc
    }, {})
  }

  if (isPlainObject(schema)) {
    return Object.entries(schema).reduce((acc, [field, config]) => {
      if (typeof config === 'string') {
        acc[field] = addSchemaFormatter({ type: getEditorSchemaType(config), label: toTitle(field) }, config)
        return acc
      }
      if (isPlainObject(config)) {
        const schemaType = getSchemaEntryType(config) || 'text'
        acc[field] = addSchemaFormatter({
          type: getEditorSchemaType(schemaType),
          label: config.title || config.label || toTitle(field),
        }, schemaType)
        if (Object.prototype.hasOwnProperty.call(config, 'value') && config.type)
          acc[field].value = cloneValue(config.value)
      }
      return acc
    }, {})
  }

  return {}
}

const getSchemaFormatterMap = (schema) => {
  const formatterMap = {}
  const addFormatter = (field, type) => {
    const formatter = String(type || '').trim().toLowerCase()
    if (field && INLINE_SCHEMA_FORMATTERS.has(formatter))
      formatterMap[String(field)] = formatter
  }

  if (Array.isArray(schema)) {
    schema.forEach((item) => {
      if (item?.field)
        addFormatter(item.field, getSchemaEntryType(item))
    })
    return formatterMap
  }

  if (isPlainObject(schema)) {
    Object.entries(schema).forEach(([field, config]) => {
      addFormatter(field, getSchemaEntryType(config))
    })
  }

  return formatterMap
}

const getScopedFieldExpression = (expression, scopeAlias = 'item') => {
  const path = String(expression || '').trim()
  if (!path)
    return ''

  const alias = String(scopeAlias || '').trim()
  if (alias && path.startsWith(`${alias}.`))
    return path.slice(alias.length + 1)
  if (path.startsWith('item.'))
    return path.slice(5)
  return path
}

const applySchemaFormatter = (expression, schemaFormatters = {}, scopeAlias = 'item') => {
  const path = getScopedFieldExpression(expression, scopeAlias)
  if (!path || /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(path))
    return expression

  const rootField = path.split('.')[0]
  const formatter = schemaFormatters[path] || schemaFormatters[rootField]
  return formatter ? `${formatter}(${path})` : path
}

const legacyFieldToSchema = (type, cfg, field) => {
  const schemaType = type === 'textarea' ? 'textarea' : type
  const schema = addSchemaFormatter({
    type: getEditorSchemaType(schemaType),
    label: cfg.title || cfg.label || toTitle(field),
  }, schemaType)
  if (cfg.option)
    schema.option = cloneValue(cfg.option)
  if (Object.prototype.hasOwnProperty.call(cfg, 'value'))
    schema.value = cloneValue(cfg.value)
  return schema
}

const setValueAtPath = (target, path, value) => {
  const parts = path.filter(Boolean)
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!isPlainObject(cursor[part]))
      cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

const buildControlsFromQueryOptions = (queryOptions = []) => {
  if (!Array.isArray(queryOptions))
    return {}

  return queryOptions.reduce((acc, option) => {
    if (!option?.field)
      return acc
    const field = String(option.field)
    const controlType = option.input === 'text' ? 'text' : (option.type || 'select')
    acc[field] = {
      type: controlType,
      label: option.title || option.label || toTitle(field),
    }
    if (controlType !== 'text') {
      acc[field].options = cloneValue(option.options || [])
      acc[field].optionsKey = option.optionsKey || 'label'
      acc[field].optionsValue = option.optionsValue || 'value'
    }
    if (option.placeholder)
      acc[field].placeholder = option.placeholder
    if (option.operator)
      acc[field].operator = option.operator
    return acc
  }, {})
}

const buildDataSource = (name, cfg, values) => {
  const source = {}
  let collection = null
  if (cfg.collection && isPlainObject(cfg.collection))
    collection = cfg.collection

  if (collection) {
    source.type = 'collection'
    const collectionKeys = ['path', 'baseKey', 'uniqueKey', 'orgLevel']
    collectionKeys.forEach((key) => {
      if (collection[key] !== undefined)
        source[key] = cloneValue(collection[key])
    })
    if (collection.query !== undefined)
      source.query = cloneValue(collection.query)
    if (collection.canonicalLookup !== undefined)
      source.canonicalLookup = cloneValue(collection.canonicalLookup)
    if (collection.order !== undefined)
      source.order = cloneValue(collection.order)
  }
  else if (cfg.api) {
    source.type = 'api'
    source.api = cfg.api
    if (cfg.apiField !== undefined)
      source.apiField = cfg.apiField
    if (cfg.apiQuery !== undefined)
      source.apiQuery = cfg.apiQuery
  }
  else {
    source.type = 'manual'
  }

  const sourceKeys = ['queryItems', 'previewQueryItems', 'query', 'canonicalLookup', 'order', 'limit', 'value']
  sourceKeys.forEach((key) => {
    if (cfg[key] !== undefined)
      source[key] = cloneValue(cfg[key])
  })

  const controls = buildControlsFromQueryOptions(cfg.queryOptions)
  if (Object.keys(controls).length)
    source.controls = controls

  if (isPlainObject(cfg.queryItems)) {
    Object.entries(cfg.queryItems).forEach(([field, value]) => {
      setValueAtPath(values, ['dataSources', name, field], cloneValue(value))
    })
  }

  return source
}

const normalizeLegacyReferences = (content, fromAlias = '', toAlias = '', schemaFormatters = {}, scopeAlias = 'item') => {
  let normalized = String(content || '')

  if (fromAlias && toAlias && fromAlias !== toAlias) {
    normalized = normalized.replace(new RegExp(`\\b${fromAlias}\\.`, 'g'), `${toAlias}.`)
    normalized = normalized.replace(new RegExp(`\\{\\{\\s*${fromAlias}\\s*\\}\\}`, 'g'), `{{ ${toAlias} }}`)
  }

  normalized = normalized.replace(/\{\{\{\s*([^{}#/][^{}]*?)\s*\}\}\}/g, (_, expression) => `{{ ${applySchemaFormatter(expression, schemaFormatters, scopeAlias)} }}`)
  normalized = normalized.replace(/\{\{\s*([^{}#/][^{}]*?)\s*\}\}/g, (_, expression) => `{{ ${applySchemaFormatter(expression, schemaFormatters, scopeAlias)} }}`)
  return normalized
}

export const useCmsTemplateV2Conversion = () => {
  const convertLegacyBlockToTemplateV2 = (legacyContent = {}) => {
    const content = typeof legacyContent === 'string' ? legacyContent : String(legacyContent?.content || '')
    const schema = {}
    const dataSources = {}
    const values = {}
    const warnings = []
    const usedAliases = new Set(['item'])

    const convertSegment = (segment, options = {}) => {
      const scopeAlias = options.scopeAlias || 'item'
      const schemaFormatters = options.schemaFormatters || {}
      let cursor = 0
      let output = ''

      for (;;) {
        const tag = findNextLegacyTag(segment, cursor)
        if (!tag) {
          output += normalizeLegacyReferences(segment.slice(cursor), options.rewriteFromAlias, options.rewriteToAlias, schemaFormatters, scopeAlias)
          break
        }

        output += normalizeLegacyReferences(segment.slice(cursor, tag.start), options.rewriteFromAlias, options.rewriteToAlias, schemaFormatters, scopeAlias)

        const cfg = parseJsonConfig(tag.rawConfig)
        if (!cfg) {
          warnings.push(`Could not parse ${tag.type} tag near offset ${tag.start}.`)
          output += segment.slice(tag.start, tag.end)
          cursor = tag.end
          continue
        }

        const type = String(tag.type || '')
        if (type === 'array' || type === 'subarray') {
          const closeTag = findLegacyCloseTag(segment, type, tag.end)
          if (!closeTag) {
            warnings.push(`Could not find closing tag for ${type} field "${cfg.field || ''}".`)
            output += segment.slice(tag.start, tag.end)
            cursor = tag.end
            continue
          }

          const body = segment.slice(tag.end, closeTag.start)
          const field = String(cfg.field || '').trim()
          if (!field) {
            warnings.push(`Skipped ${type} tag without a field.`)
            output += convertSegment(body, { scopeAlias })
            cursor = closeTag.end
            continue
          }

          if (type === 'array') {
            const fieldName = sanitizeIdentifier(field, 'items')
            const alias = sanitizeIdentifier(cfg.as || 'item', 'item')
            const childSchemaFormatters = getSchemaFormatterMap(cfg.schema)
            usedAliases.add(alias)
            const convertedBody = convertSegment(body, { scopeAlias: alias, schemaFormatters: childSchemaFormatters })

            if (cfg.collection || cfg.api) {
              dataSources[fieldName] = buildDataSource(fieldName, cfg, values)
              output += `{{#for ${alias} in source("${fieldName}")}}${convertedBody}{{/for}}`
            }
            else {
              schema[fieldName] = {
                type: 'array',
                label: cfg.title || cfg.label || toTitle(fieldName),
                schema: convertSchemaDefinition(cfg.schema),
              }
              values[fieldName] = Array.isArray(cfg.value) ? cloneValue(cfg.value) : []
              output += `{{#for ${alias} in ${fieldName}}}${convertedBody}{{/for}}`
            }
          }
          else {
            const explicitAlias = String(tag.alias || cfg.as || '').trim()
            const alias = explicitAlias ? uniqueAlias(explicitAlias, usedAliases) : inferSubarrayAlias(field, usedAliases)
            const convertedBody = convertSegment(body, {
              scopeAlias: alias,
              rewriteFromAlias: explicitAlias ? '' : scopeAlias,
              rewriteToAlias: explicitAlias ? '' : alias,
              schemaFormatters,
            })
            if (Number(cfg.limit) > 0)
              warnings.push(`Review subarray limit ${cfg.limit} for "${field}"; v2 loop output was converted without inline slice syntax.`)
            output += `{{#for ${alias} in ${field}}}${convertedBody}{{/for}}`
          }

          cursor = closeTag.end
          continue
        }

        const field = String(cfg.field || '').trim()
        if (!field) {
          output += segment.slice(tag.start, tag.end)
          cursor = tag.end
          continue
        }

        schema[field] = legacyFieldToSchema(type, cfg, field)
        values[field] = Object.prototype.hasOwnProperty.call(cfg, 'value') ? cloneValue(cfg.value) : ''
        const inlineFormatter = INLINE_SCHEMA_FORMATTERS.has(type) ? type : ''
        output += inlineFormatter ? `{{ ${inlineFormatter}(${field}) }}` : `{{ ${field} }}`
        cursor = tag.end
      }

      return output
    }

    return {
      templateVersion: 2,
      template: convertSegment(content).trim(),
      schema,
      dataSources,
      values,
      conversion: {
        source: 'legacy-inline-tags',
        warnings,
        originalContent: content,
        convertedAt: new Date().toISOString(),
      },
    }
  }

  return {
    convertLegacyBlockToTemplateV2,
  }
}
