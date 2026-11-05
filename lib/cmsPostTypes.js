// Shared post-type model. Keep identical to both Functions helpers/cmsPostTypes.mjs.
import { parseExpressionAt } from 'acorn'
import { buildPostEvent } from './cmsPostEvents.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const parseDsl = text => parseExpressionAt(text.replace(/\bdefault(?=\s*\()/g, '__def__').replace(/\.(\d+)\b/g, '["$1"]'), 0, { ecmaVersion: 2022 })
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'content', 'structure', 'schema', 'template', 'dataSources', 'blockIds', 'postTypeId', 'postTypeSchema', 'postTypeProjection', 'type', 'uid', 'users', 'permissions', 'roles', 'publishedAt', 'publishAt', 'publishAtTimezone', 'restrictionRuleId', 'docId', 'doc_created_at', 'last_updated'])
export const safePostField = path => typeof path === 'string' && /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(path) && !path.split('.').some(key => forbidden.has(key)) && !path.startsWith('_')
const publicEnvelopeFields = new Set(['type', 'publishedAt', 'doc_created_at', 'postTypeId'])
const publicPostField = path => safePostField(path) || publicEnvelopeFields.has(path)
export const postTypeKey = (id) => {
  // Lowercase base32 survives existing slug/index normalization without losing
  // the case-sensitive identity or wasting the small KV metadata budget.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let buffer = 0
  let bits = 0
  let encoded = ''
  for (const byte of new TextEncoder().encode(String(id))) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += alphabet[(buffer >>> bits) & 31]
    }
    buffer &= (1 << bits) - 1
  }
  if (bits)
    encoded += alphabet[(buffer << (5 - bits)) & 31]
  return `custom-${encoded}`
}
export const getPostPath = (value, path) => path.split('.').reduce((current, key) => current?.[key], value)
export const setPostPath = (target, path, value) => {
  if (!safePostField(path))
    throw new Error(`Unsupported post field: ${path}`)
  const parts = path.split('.')
  const last = parts.pop()
  let item = target
  for (const key of parts) {
    if (!object(item[key]))
      item[key] = {}
    item = item[key]
  }
  item[last] = clone(value)
}
export const getPostTypes = pages => Object.entries(pages || {})
  .filter(([, page]) => page.post === true && page.postType?.enabled === true)
  .map(([id, page]) => ({ id, name: page.name || id, icon: page.postType.icon || 'FileText', type: postTypeKey(id), page }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

// Delimiters inside JSON directive objects/strings are not token boundaries.
const templateTokens = (template) => {
  const tokens = []
  let offset = 0
  while (offset < template.length) {
    const start = template.indexOf('{{', offset)
    if (start < 0)
      break
    const width = template.startsWith('{{{', start) ? 3 : 2
    let quote = ''
    let escaped = false
    let depth = 0
    let end = -1
    for (let index = start + width; index < template.length; index++) {
      const char = template[index]
      if (quote) {
        if (escaped)
          escaped = false
        else if (char === '\\')
          escaped = true
        else if (char === quote)
          quote = ''
        continue
      }
      if (char === '"' || char === '\'') {
        quote = char
        continue
      }
      if (char === '{')
        depth++
      if (char === '}') {
        if (depth)
          depth--
        else if (template.startsWith('}'.repeat(width), index)) {
          end = index
          break
        }
      }
    }
    if (end < 0)
      throw new Error('An unclosed template expression prevents post-field discovery.')
    tokens.push({ start, end: end + width, body: template.slice(start + width, end), raw: template.slice(start, end + width) })
    offset = end + width
  }
  return tokens
}

// Read template expressions using the JS expression grammar, including JSON
// directive strings. Loop aliases are scoped to their source, not guessed names.
export const collectPostFields = (blocks = [], { includeQueries = true } = {}) => {
  const paths = new Set()
  for (const block of blocks || []) {
    const sources = new Map(Object.entries(block.dataSources || {}).filter(([, source]) => source?.type === 'collection' && source.path === 'posts'))
    if (!sources.size)
      continue
    const aliases = new Map([...sources.keys()].map(name => [name, '']))
    const stack = []
    const memberPath = (node) => {
      if (node?.type === 'Identifier')
        return aliases.has(node.name) ? aliases.get(node.name) : null
      if (node?.type !== 'MemberExpression')
        return null
      const base = memberPath(node.object)
      if (base === null)
        return null
      const key = node.computed ? node.property?.value : node.property?.name
      if (key === undefined)
        throw new Error('Post fields with computed property names need an explicit schema binding.')
      if (/^\d+$/.test(String(key)))
        return base
      return base ? `${base}.${key}` : key
    }
    const inspect = (node) => {
      if (!node || typeof node !== 'object')
        return
      if (node.type === 'MemberExpression') {
        const path = memberPath(node)
        if (path) {
          if (publicPostField(path))
            paths.add(path)
          return
        }
      }
      if (node.type === 'Literal' && typeof node.value === 'string' && /^[A-Za-z_]\w*\./.test(node.value)) {
        try {
          inspect(parseDsl(node.value))
        }
        catch (error) {
          if (error.message.includes('explicit schema'))
            throw error
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'callee' && node.type === 'CallExpression')
          continue
        if (Array.isArray(value))
          value.forEach(inspect)
        else if (value && typeof value === 'object')
          inspect(value)
      }
    }
    for (const token of templateTokens(String(block.template || block.content || ''))) {
      const text = token.body.trim()
      if (text.startsWith('/for') || text.startsWith('/array') || text.startsWith('/subarray')) {
        const scope = stack.pop()
        if (scope) {
          if (scope.old === undefined)
            aliases.delete(scope.name)
          else aliases.set(scope.name, scope.old)
        }
        continue
      }
      const array = text.match(/^#(?:sub)?array\s+(\{[\s\S]*\})$/)
      if (array) {
        let config
        try {
          config = JSON.parse(array[1])
        }
        catch { throw new Error('Cannot read a post array directive.') }
        const name = config.alias || 'item'
        let path = sources.has(config.field) ? '' : null
        if (path === null && typeof config.field === 'string') {
          try {
            path = memberPath(parseDsl(config.field))
          }
          catch {}
        }
        if (path && safePostField(path))
          paths.add(path)
        stack.push({ name, old: aliases.get(name) })
        if (path !== null)
          aliases.set(name, path)
        else aliases.delete(name)
        continue
      }
      const loop = text.match(/^#for\s+(\w+)\s+in\s+([\s\S]+)$/)
      if (loop) {
        const source = loop[2].match(/^source\(["']([^"']+)["']/)
        let path = (source && sources.has(source[1])) ? '' : null
        if (!source) {
          try {
            path = memberPath(parseDsl(loop[2]))
            if (path && safePostField(path))
              paths.add(path)
          }
          catch {}
        }
        stack.push({ name: loop[1], old: aliases.get(loop[1]) })
        if (path !== null)
          aliases.set(loop[1], path)
        else aliases.delete(loop[1])
        continue
      }
      if (text.startsWith('/') || text === '#else')
        continue
      const expression = text.replace(/^#\w+\s*/, '')
      if (!expression)
        continue
      try {
        inspect(parseDsl(`(${expression})`))
      }
      catch (error) {
        if (error.message.includes('explicit schema'))
          throw error
        if (!text.startsWith('#'))
          throw new Error(`Unable to read post template expression: ${text}`)
      }
    }
    // Query/sort fields are dependencies too, even if no card displays them.
    for (const [, source] of includeQueries ? sources : []) {
      if (object(source.queryItems)) {
        for (const key of Object.keys(source.queryItems)) if (safePostField(key))
          paths.add(key)
      }
      for (const item of [...(source.query || []), ...(source.order || []), ...(source.queryOptions || [])]) {
        const field = item?.field
        if (safePostField(field))
          paths.add(field)
      }
    }
  }
  // Keep parent values once (arrays/objects), rather than losing nested entries.
  return [...paths].sort().filter(path => ![...paths].some(parent => parent !== path && path.startsWith(`${parent}.`)))
}

export const buildPostTypeFields = (page, { includeUnmarked = false } = {}) => {
  const found = new Map()
  for (const block of page?.postContent || []) {
    if (!includeUnmarked && page?.postType?.enabled === true && block.useForCustomPost !== true)
      continue
    for (const [key, config] of Object.entries(block.schema || {})) {
      if (!object(config))
        continue
      const path = config.postField || key
      if (page.postType?.event === true && (path === 'event' || path.startsWith('event.')))
        continue
      if (!safePostField(path) || config.private || config.editable === false)
        continue
      if (!['text', 'textarea', 'richtext', 'image', 'number', 'boolean', 'option', 'array'].includes(config.type || 'text'))
        continue
      found.set(path, { ...clone(config), field: path, label: config.label || key, blockId: block.id, default: block.values?.[key] ?? config.default ?? config.value ?? (config.type === 'array' ? [] : config.type === 'boolean' ? false : config.type === 'number' ? 0 : '') })
    }
    for (const path of collectPostFields([block], { includeQueries: false })) {
      if (page.postType?.event === true && (path === 'event' || path.startsWith('event.')))
        continue
      if (safePostField(path) && !found.has(path))
        found.set(path, { field: path, label: path, type: /image|photo/i.test(path) ? 'image' : /body|description|content/i.test(path) ? 'richtext' : 'text', blockId: block.id, default: '' })
    }
  }
  return [...found.values()]
}
export const postTypeSchema = (page) => {
  // Ownership toggles do not change field definitions or invalidate existing entries.
  const fields = buildPostTypeFields(page, { includeUnmarked: true }).map(({ field, type, required, validation, schema }) => ({ field, type, required: !!required, ...(validation ? { validation } : {}), ...(schema ? { schema } : {}) })).sort((a, b) => a.field.localeCompare(b.field))
  const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  // A compatibility fingerprint, not an authorization token. Never persist a
  // copy of the detail schema on the post itself.
  let hash = 14695981039346656037n
  for (const byte of new TextEncoder().encode(JSON.stringify(canonical(fields)))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n)
  return `v1:${hash.toString(16).padStart(16, '0')}`
}
const validatePostValue = (field, value) => {
  const rules = { ...field.validation, ...(field.required !== undefined ? { required: field.required } : {}) }
  const empty = value == null || (typeof value === 'string' && !value.replace(/<[^>]*>/g, '').trim()) || (Array.isArray(value) && !value.length)
  if (rules.required && empty)
    throw new Error(`${field.label} is required.`)
  if (['text', 'textarea', 'richtext', 'image'].includes(field.type) && typeof value !== 'string')
    throw new Error(`${field.label} must be text.`)
  if (field.type === 'option' && !['string', 'number', 'boolean'].includes(typeof value))
    throw new Error(`${field.label} must be a selectable value.`)
  if (field.type === 'array' && !Array.isArray(value))
    throw new Error(`${field.label} must be a list.`)
  if (field.type === 'boolean' && typeof value !== 'boolean')
    throw new Error(`${field.label} must be true or false.`)
  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error(`${field.label} must be a number.`)
  const length = field.type === 'number' ? value : Array.isArray(value) ? value.length : String(value ?? '').replace(/<[^>]*>/g, '').length
  if (rules.min !== undefined && length < rules.min)
    throw new Error(`${field.label} must be at least ${rules.min}.`)
  if (rules.max !== undefined && length > rules.max)
    throw new Error(`${field.label} must be ${rules.max} or less.`)
  if (field.type === 'array') {
    const children = Array.isArray(field.schema) ? field.schema : Object.entries(field.schema || {}).map(([key, entry]) => ({ ...entry, field: key }))
    if (children.length)
      for (const [index, item] of value.entries()) {
        if (!object(item))
          throw new Error(`${field.label} item ${index + 1} must contain named content fields.`)
        for (const key of Object.keys(item)) if (!children.some(child => child.field === key))
          throw new Error(`${field.label} item ${index + 1} has an unknown field: ${key}`)
        for (const child of children) {
          if (!safePostField(child.field))
            throw new Error('Invalid repeated-content field.')
          validatePostValue({ ...child, label: `${field.label} ${index + 1}: ${child.label || child.field}` }, item[child.field] ?? child.default ?? child.value ?? (child.type === 'boolean' ? false : child.type === 'number' ? 0 : child.type === 'array' ? [] : ''))
        }
      }
  }
}

export const buildTypedPost = ({ page, pageId, post = {}, values = post, previous = {}, forPublication = false }) => {
  if (page?.post !== true || page.postType?.enabled !== true)
    throw new Error('This post type is unavailable. Restore its defining page before saving or publishing.')
  const fields = buildPostTypeFields(page)
  const schema = postTypeSchema(page)
  if (post.postTypeSchema && post.postTypeSchema !== schema)
    throw new Error('The detail page fields changed. Reload this editor before saving or publishing.')
  // Retain inactive content only from the existing record, never from new input.
  const result = Object.fromEntries(Object.entries(previous).filter(([key]) => safePostField(key)).map(([key, value]) => [key, clone(value)]))
  for (const field of fields) {
    const value = getPostPath(values, field.field) ?? field.default
    validatePostValue(field, value)
    setPostPath(result, field.field, value)
  }
  for (const field of ['docId', 'name', 'title', 'blurb', 'tags', 'featuredImage', 'restrictionRuleId', 'publishAt', 'publishAtTimezone', 'publishedAt', 'hidePublishedDate', 'doc_created_at']) {
    if (post[field] !== undefined)
      result[field] = clone(post[field])
  }
  if (page.postType.event === true)
    result.event = buildPostEvent(post.event || {})
  else
    delete result.event
  if (forPublication) {
    for (const block of page.postContent || []) {
      for (const [key, config] of Object.entries(block.schema || {})) {
        const path = config?.postField || key
        if (!config?.private || !safePostField(path))
          continue
        const parts = path.split('.')
        const leaf = parts.pop()
        const parent = parts.reduce((item, part) => item?.[part], result)
        if (parent && typeof parent === 'object')
          delete parent[leaf]
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 200000)
    throw new Error('Post values must be under 200 KB.')
  return { ...result, postTypeId: pageId, type: postTypeKey(pageId), postTypeSchema: schema }
}
export const postProjection = (page) => {
  const fields = collectPostFields(page?.content || [])
  const privateFields = (page?.postContent || []).flatMap(block => Object.entries(block.schema || {}).filter(([, config]) => config?.private === true).map(([key, config]) => config.postField || key))
  if (fields.some(field => privateFields.some(privateField => field === privateField || field.startsWith(`${privateField}.`) || privateField.startsWith(`${field}.`))))
    throw new Error('The index references a private post field. Remove that reference before publishing.')
  return { fields, schema: postTypeSchema(page) }
}
export const withPostProjection = (post, page) => {
  if (!post.postTypeId)
    return post
  const projection = postProjection(page)
  for (const path of projection.fields) {
    if (!publicPostField(path))
      throw new Error(`Invalid public field: ${path}`)
  }
  return { ...post, postTypeProjection: projection }
}

// Same public envelope and byte budget as cmsPostKvMetadata.js, checked before a
// manual publish. Required dynamic content is never silently truncated.
export const validateTypedPostMetadata = (post, { orgId, siteId, postId }) => {
  const metadata = { title: post.title || '', blurb: post.blurb || '', doc_created_at: post.doc_created_at || '', featuredImage: post.featuredImage || '', name: post.name || '', type: post.type || 'post', event: { startAt: '', endAt: '', isPast: false, locationName: '' }, canonical: `posts:${orgId}:${siteId}:${postId}` }
  if (post.hidePublishedDate === true)
    metadata.hidePublishedDate = true
  for (const path of post.postTypeProjection?.fields || []) {
    const value = getPostPath(post, path)
    if (value !== undefined) {
      if (publicEnvelopeFields.has(path))
        metadata[path] = value
      else setPostPath(metadata, path, value)
    }
  }
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > 1024)
    throw new Error('Post index metadata exceeds 1,024 bytes. Reduce the fields used by the index or use canonical post lookups.')
  return metadata
}

// Bind authored schema fields to the loop record. The engine intentionally
// prefers block-local defaults for unqualified names, so use explicit paths.
const bindPostTemplate = (template, schema) => {
  let output = ''
  let cursor = 0
  const bind = (token, expression) => {
    const directive = expression.match(/^\s*#\w+\s*/)?.[0] || ''
    const text = expression.slice(directive.length).trim()
    if (!text || text.startsWith('/') || directive.includes('#for'))
      return token
    const edits = []
    const mapped = key => (schema?.[key] && schema[key].editable !== false && !schema[key].private && safePostField(schema[key].postField || key)) ? `post.${schema[key].postField || key}` : null
    const visit = (node, parent, key) => {
      if (!node || typeof node !== 'object')
        return
      if (node.type === 'Identifier' && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) && !(parent?.type === 'Property' && key === 'key') && !(parent?.type === 'CallExpression' && key === 'callee')) {
        const value = mapped(node.name)
        if (value)
          edits.push([node.start, node.end, value])
      }
      if (node.type === 'Literal' && typeof node.value === 'string' && parent?.type === 'Property' && key === 'value' && ['cond', 'field'].includes(parent.key?.name || parent.key?.value)) {
        const [root, ...rest] = node.value.split('.')
        const value = mapped(root)
        if (value)
          edits.push([node.start, node.end, JSON.stringify([value, ...rest].join('.'))])
      }
      for (const [childKey, value] of Object.entries(node)) {
        if (Array.isArray(value))
          value.forEach(child => visit(child, node, childKey))
        else if (value && typeof value === 'object')
          visit(value, node, childKey)
      }
    }
    try {
      visit(parseExpressionAt(text.replace(/\bdefault(?=\s*\()/g, '__def__'), 0, { ecmaVersion: 2022 }))
    }
    catch {
      return token
    }
    let result = text
    for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + value + result.slice(end)
    return token.replace(expression, `${directive}${result}`)
  }
  for (const token of templateTokens(String(template))) {
    output += template.slice(cursor, token.start) + bind(token.raw, token.body)
    cursor = token.end
  }
  return output + template.slice(cursor)
}

// Adapt the page's public definition to the engine's existing posts source /
// loop contract. Definitions stay inline on the page, never on the post.
export const preparePostTypePage = (page, pageId) => {
  if (!page?.post || !page.postType?.enabled)
    return page
  const next = clone(page)
  for (const [area, detail] of [['content', false], ['postContent', true]]) {
    for (const block of next[area] || []) {
      block.dataSources ||= {}
      block.meta ||= {}
      const postSources = Object.entries(block.dataSources).filter(([, source]) => source?.type === 'collection' && source.path === 'posts')
      for (const [alias, source] of postSources) {
        const queryItems = { ...source.queryItems, ...block.meta?.[alias]?.queryItems, type: postTypeKey(pageId) }
        if (detail)
          queryItems.name = '{routeLastSegment}'
        source.canonical = true
        source.queryItems = queryItems
        block.meta[alias] = { ...block.meta[alias], queryItems }
      }
      if (detail && block.useForCustomPost === true && !postSources.length && Object.entries(block.schema || {}).some(([key, config]) => safePostField(config?.postField || key) && config?.editable !== false && !config?.private)) {
        const alias = 'cmsPost'
        block.dataSources[alias] = { type: 'collection', path: 'posts', uniqueKey: '{orgId}:{siteId}', canonical: true, queryItems: { type: postTypeKey(pageId), name: '{routeLastSegment}' }, limit: 1 }
        block.meta[alias] = { queryItems: { type: postTypeKey(pageId), name: '{routeLastSegment}' }, limit: 1 }
        block.template = `{{#for post in source("${alias}")}}${bindPostTemplate(block.template || block.content || '', block.schema)}{{/for}}`
        block.templateVersion = 2
      }
      if (block.templateVersion === 2 && block.template)
        block.content = block.template
    }
  }
  postProjection(next)
  return next
}
