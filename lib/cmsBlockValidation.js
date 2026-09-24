// Shared Template v2 block and page validation for the Hub import screen, the
// Firebase MCP, block packages, and server write operations. Pure ESM: callers
// inject the template engine so every runtime can supply its own copy.
//
// Every finding is { code, severity, path, message }. Codes are stable; callers
// decide which severities block their flow.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const BLOCK_TYPES = new Set(['Page', 'Post'])
const PREVIEW_TYPES = new Set(['light', 'dark'])
const FIXTURE_TEXT = '1'

// Keys the Hub importer rejects a file for missing today. It fills in
// templateVersion, template, schema, and dataSources before checking, so those
// are reported as defaulted instead. Stricter callers pass their own lists.
export const HUB_REQUIRED_BLOCK_KEYS = ['name', 'content', 'values', 'tags', 'themes', 'synced', 'version']
export const HUB_DEFAULTED_BLOCK_KEYS = ['templateVersion', 'template', 'schema', 'dataSources']
export const DEFAULT_REQUIRED_PAGE_KEYS = ['name', 'content', 'structure']

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

const createReport = () => {
  const report = { errors: [], warnings: [], info: [] }
  report.add = (severity, code, path, message) => {
    const issue = { code, severity, path, message }
    if (severity === 'error')
      report.errors.push(issue)
    else if (severity === 'warning')
      report.warnings.push(issue)
    else
      report.info.push(issue)
  }
  return report
}

const finish = ({ errors, warnings, info }) => ({ valid: errors.length === 0, errors, warnings, info })

export const mergeValidationResults = (...results) => finish({
  errors: results.flatMap(result => result?.errors || []),
  warnings: results.flatMap(result => result?.warnings || []),
  info: results.flatMap(result => result?.info || []),
})

// Template tokens: `{{ ... }}` placeholders and `{{{ ... }}}` conditionals.
// Stripping them first keeps condition JSON such as `a > 1` out of tag parsing.
const stripTemplateTokens = html => String(html || '')
  .replace(/\{\{\{[\s\S]*?\}\}\}/g, '')
  .replace(/\{\{[\s\S]*?\}\}/g, '')

// Keeps one branch of every conditional: `if` keeps each if-branch, `else`
// keeps each else-branch (dropping if-only content). Templates often open the
// same element differently in each branch, so HTML balance is checked per
// path rather than across both branches at once.
export const selectConditionalPath = (template, branch = 'if') => {
  const text = String(template || '')
  const tokens = /\{\{\{\s*#if\b[\s\S]*?\}\}\}|\{\{\{\s*#else\s*\}\}\}|\{\{\{\s*\/if\s*\}\}\}/g
  const frames = []
  const keeping = () => frames.every(frame => frame.keep)
  let output = ''
  let index = 0
  for (const match of text.matchAll(tokens)) {
    if (keeping())
      output += text.slice(index, match.index)
    index = match.index + match[0].length
    const token = match[0].replace(/\s+/g, '')
    if (token.startsWith('{{{#if'))
      frames.push({ keep: branch === 'if' })
    else if (token === '{{{#else}}}' && frames.length)
      frames[frames.length - 1].keep = branch === 'else'
    else if (token === '{{{/if}}}')
      frames.pop()
  }
  if (keeping())
    output += text.slice(index)
  return output
}

// Returns a message describing the first imbalance, or '' when balanced.
export const findUnbalancedHtml = (html) => {
  const stack = []
  const markup = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
  for (const match of markup.matchAll(/<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\/?\s*>/gi)) {
    const tagName = match[1].toLowerCase()
    if (VOID_TAGS.has(tagName) || /\/\s*>$/.test(match[0]))
      continue
    if (match[0].startsWith('</')) {
      const open = stack.pop()
      if (open !== tagName)
        return open ? `</${tagName}> closes <${open}>` : `</${tagName}> has no opening tag`
      continue
    }
    stack.push(tagName)
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : ''
}

// Walks `{{#for ...}}`/`{{/for}}` and `{{{#if ...}}}`/`{{{#else}}}`/`{{{/if}}}`
// in order. An unmatched conditional silently drops content at render time, so
// this is checked statically.
export const findUnbalancedTemplateBlocks = (template) => {
  const stack = []
  const tokens = /\{\{\{\s*#if\b|\{\{\{\s*#else\s*\}\}\}|\{\{\{\s*\/if\s*\}\}\}|\{\{\s*#for\b|\{\{\s*\/for\s*\}\}/g
  for (const match of String(template || '').matchAll(tokens)) {
    const token = match[0].replace(/\s+/g, '')
    if (token === '{{{#if')
      stack.push('if')
    else if (token === '{{#for')
      stack.push('for')
    else if (token === '{{{#else}}}') {
      if (stack[stack.length - 1] !== 'if')
        return '{{{#else}}} outside a conditional'
    }
    else {
      const expected = token === '{{{/if}}}' ? 'if' : 'for'
      const open = stack.pop()
      if (!open)
        return `${token} has no opening tag`
      if (open !== expected)
        return `${token} closes a ${open === 'if' ? 'conditional' : 'loop'}`
    }
  }
  if (!stack.length)
    return ''
  const loops = stack.filter(kind => kind === 'for').length
  const conditionals = stack.length - loops
  return [loops && `${loops} unclosed loop(s)`, conditionals && `${conditionals} unclosed conditional(s)`].filter(Boolean).join(', ')
}

export const extractSourceCalls = template => [...String(template || '').matchAll(/source\(\s*["']([^"']+)["']/g)].map(match => match[1])

// Finds each loop header and returns { alias, expression, start, bodyStart,
// bodyEnd, depth }. Headers may span lines and contain option objects.
export const parseTemplateLoops = (template) => {
  const text = String(template || '')
  const loops = []
  const open = []
  const tokens = /\{\{\s*#for\s+([A-Za-z_$][\w$]*)\s+in\s+|\{\{\s*\/for\s*\}\}/g
  let match = tokens.exec(text)
  while (match) {
    if (match[0].includes('/for')) {
      const loop = open.pop()
      if (loop)
        loop.bodyEnd = match.index
    }
    else {
      let index = tokens.lastIndex
      let parens = 0
      let braces = 0
      let quote = ''
      for (; index < text.length; index++) {
        const char = text[index]
        if (quote) {
          if (char === quote && text[index - 1] !== '\\')
            quote = ''
          continue
        }
        if (char === '"' || char === '\'') {
          quote = char
          continue
        }
        if (char === '(')
          parens++
        else if (char === ')')
          parens--
        else if (char === '{')
          braces++
        else if (char === '}') {
          if (parens === 0 && braces === 0 && text[index + 1] === '}')
            break
          braces--
        }
      }
      const loop = {
        alias: match[1],
        expression: text.slice(tokens.lastIndex, index).trim(),
        start: match.index,
        bodyStart: index + 2,
        bodyEnd: text.length,
        depth: open.length,
        parent: open[open.length - 1] || null,
      }
      loops.push(loop)
      open.push(loop)
      tokens.lastIndex = index + 2
    }
    match = tokens.exec(text)
  }
  return loops
}

const schemaDefaults = schema => Object.fromEntries(
  Object.entries(isObject(schema) ? schema : {})
    .filter(([, input]) => isObject(input) && owns(input, 'value'))
    .map(([key, input]) => [key, JSON.parse(JSON.stringify(input.value))]),
)

const setPath = (target, path, value) => {
  const parts = path.split('.')
  let node = target
  for (const part of parts.slice(0, -1)) {
    if (!isObject(node[part]))
      node[part] = {}
    node = node[part]
  }
  const last = parts[parts.length - 1]
  if (!owns(node, last) || !Array.isArray(node[last]))
    node[last] = value
}

// Builds sample records for each declared data source from the fields its loop
// bodies reference, so loop bodies render during validation. Each source gets
// one filled record and one empty record to exercise both sides of presence
// conditions. Anything the scan cannot model is reported as unverified.
export const buildSourceFixtures = (template, dataSourceNames = []) => {
  const text = String(template || '')
  const loops = parseTemplateLoops(text)
  const fixtures = Object.fromEntries(dataSourceNames.map(name => [name, [{}, {}]]))
  const unverified = []

  const fieldsFor = (loop) => {
    const body = text.slice(loop.bodyStart, loop.bodyEnd)
    if (new RegExp(`\\b${loop.alias}\\s*\\[`).test(body))
      unverified.push(`loop "${loop.alias}" uses computed field access`)
    return [...new Set([...body.matchAll(new RegExp(`\\b${loop.alias}\\.([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`, 'g'))].map(item => item[1]))]
  }

  // A loop's sample element: an object with every referenced field, where
  // fields iterated by a child loop become one-element arrays.
  const sampleFor = (loop) => {
    const fields = fieldsFor(loop)
    const children = loops.filter(child => child.parent === loop)
    if (!fields.length && !children.length)
      return FIXTURE_TEXT
    const record = {}
    for (const field of fields)
      setPath(record, field, FIXTURE_TEXT)
    for (const child of children) {
      const collection = child.expression.replace(/,\s*\{[\s\S]*\}\s*$/, '').trim()
      if (collection.startsWith(`${loop.alias}.`))
        setPath(record, collection.slice(loop.alias.length + 1), [sampleFor(child)])
    }
    return record
  }

  for (const loop of loops) {
    const collection = loop.expression.replace(/,\s*\{[\s\S]*\}\s*$/, '').trim()
    const sourceMatch = collection.match(/^source\(\s*["']([^"']+)["']/)
    if (sourceMatch) {
      if (owns(fixtures, sourceMatch[1])) {
        const sample = sampleFor(loop)
        fixtures[sourceMatch[1]] = [isObject(sample) ? sample : { value: sample }, {}]
      }
      continue
    }
    const parentAlias = loop.parent?.alias
    if (parentAlias && collection.startsWith(`${parentAlias}.`))
      continue
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(collection))
      continue
    unverified.push(`loop "${loop.alias}" iterates ${collection}`)
  }
  return { fixtures, unverified }
}

const validateSchemaInput = (report, input, path, { allowMissingValue = false } = {}) => {
  if (!isObject(input)) {
    report.add('error', 'schema.input-object', path, `${path} must be an object.`)
    return
  }
  if (typeof input.type !== 'string' || !input.type.trim())
    report.add('error', 'schema.input-type', `${path}.type`, `${path} needs a string type.`)
  // The Hub still reads a legacy title as the field label, and a missing
  // default renders empty, so both are style findings rather than breakage.
  if (owns(input, 'title') && !owns(input, 'label'))
    report.add('warning', 'schema.input-title', `${path}.title`, `${path} uses legacy title; use label.`)
  else if (typeof input.label !== 'string' || !input.label.trim())
    report.add('error', 'schema.input-label', `${path}.label`, `${path} needs a label.`)
  if (!allowMissingValue && !owns(input, 'value'))
    report.add('warning', 'schema.input-value', `${path}.value`, `${path} has no default value.`)
  if (input.type === 'array') {
    if (owns(input, 'value') && !Array.isArray(input.value))
      report.add('error', 'schema.array-value', `${path}.value`, `${path}.value must be an array.`)
    for (const [name, child] of Object.entries(isObject(input.schema) ? input.schema : {}))
      validateSchemaInput(report, child, `${path}.schema.${name}`, { allowMissingValue: true })
  }
}

const hasAltPair = (schema, name) => owns(schema, `${name}Alt`) || owns(schema, 'alt')

// Structural, schema, and template-grammar checks. Pass the raw document as
// imported, before any Hub normalization.
export const validateBlockDocument = (doc, options = {}) => {
  const {
    requiredKeys = HUB_REQUIRED_BLOCK_KEYS,
    requireDocId = false,
    knownThemeIds = null,
    allowedTags = null,
    library = true,
    ownership = null,
  } = options
  const report = createReport()

  if (!isObject(doc)) {
    report.add('error', 'shape.not-object', '', 'Block document must be a JSON object.')
    return finish(report)
  }

  const templateVersion = Number(doc.templateVersion) === 2 ? 2 : 1
  for (const key of requiredKeys) {
    if (!owns(doc, key))
      report.add('error', 'shape.missing-key', key, `Missing required key "${key}".`)
  }
  for (const key of HUB_DEFAULTED_BLOCK_KEYS) {
    if (!owns(doc, key) && !requiredKeys.includes(key) && (key === 'templateVersion' || templateVersion === 2)) {
      const fallback = key === 'templateVersion' ? 'Template v1' : key === 'template' ? 'the content value' : 'an empty object'
      report.add('warning', 'shape.defaulted-key', key, `"${key}" is missing; the Hub will use ${fallback}.`)
    }
  }
  if (requireDocId && !String(doc.docId || '').trim())
    report.add('error', 'shape.doc-id', 'docId', 'Block document requires a docId.')
  if (owns(doc, 'name') && !String(doc.name || '').trim())
    report.add('error', 'shape.name', 'name', 'Block name must not be empty.')
  if (owns(doc, 'content') && typeof doc.content !== 'string')
    report.add('error', 'shape.content', 'content', 'Block content must be a string.')

  if (owns(doc, 'type')) {
    const types = Array.isArray(doc.type) ? doc.type : [doc.type]
    if (!types.length || types.some(type => !BLOCK_TYPES.has(type)))
      report.add('error', 'shape.type', 'type', 'type must be "Page", "Post", or both.')
  }
  for (const key of ['tags', 'themes']) {
    if (owns(doc, key) && !Array.isArray(doc[key]))
      report.add('error', `shape.${key}`, key, `${key} must be an array.`)
  }
  if (owns(doc, 'previewType') && !PREVIEW_TYPES.has(doc.previewType))
    report.add('warning', 'shape.preview-type', 'previewType', 'previewType should be "light" or "dark".')
  if (owns(doc, 'synced') && typeof doc.synced !== 'boolean')
    report.add('error', 'shape.synced', 'synced', 'synced must be true or false.')
  if (owns(doc, 'version') && !Number.isFinite(Number(doc.version)))
    report.add('error', 'shape.version', 'version', 'version must be numeric.')

  if (Array.isArray(allowedTags) && Array.isArray(doc.tags)) {
    for (const tag of doc.tags) {
      if (!allowedTags.includes(tag))
        report.add('error', 'shape.tag-not-allowed', 'tags', `Tag "${tag}" is not in the allowed tag set.`)
    }
  }
  if (Array.isArray(knownThemeIds) && Array.isArray(doc.themes)) {
    const known = new Set(knownThemeIds)
    const unknown = [...new Set(doc.themes.map(themeId => String(themeId || '').trim()).filter(themeId => !known.has(themeId)))]
    for (const themeId of unknown)
      report.add('warning', 'themes.unknown', 'themes', themeId ? `Theme "${themeId}" does not exist in this organization.` : 'themes contains an empty theme id.')
  }

  if (templateVersion !== 2) {
    report.add('warning', 'template.v1', 'templateVersion', 'Block uses the legacy Template v1 contract.')
    return finish(report)
  }

  const template = typeof doc.template === 'string' ? doc.template : ''
  if (owns(doc, 'template') && typeof doc.template !== 'string')
    report.add('error', 'v2.template', 'template', 'Template v2 block requires a string template.')
  else if (typeof doc.content === 'string' && typeof doc.template === 'string' && doc.content !== doc.template)
    report.add('error', 'v2.content-mismatch', 'content', 'Template v2 content and template must match.')
  for (const key of ['schema', 'dataSources', 'values']) {
    if (owns(doc, key) && !isObject(doc[key]))
      report.add('error', `v2.${key}`, key, `${key} must be an object.`)
  }
  if (library && isObject(doc.values) && Object.keys(doc.values).length)
    report.add('warning', 'library.values', 'values', 'Library block values should be empty; defaults belong in schema values.')

  const schema = isObject(doc.schema) ? doc.schema : {}
  for (const [name, input] of Object.entries(schema)) {
    validateSchemaInput(report, input, `schema.${name}`)
    if (input?.type === 'image' && !hasAltPair(schema, name))
      report.add('warning', 'schema.image-alt', `schema.${name}`, `Image input "${name}" has no paired ${name}Alt input.`)
    if (input?.type === 'array' && isObject(input.schema)) {
      for (const [child, childInput] of Object.entries(input.schema)) {
        if (childInput?.type === 'image' && !hasAltPair(input.schema, child))
          report.add('warning', 'schema.image-alt', `schema.${name}.schema.${child}`, `Array image "${child}" in "${name}" has no alt field.`)
      }
    }
  }

  for (const branch of ['if', 'else']) {
    const htmlProblem = findUnbalancedHtml(stripTemplateTokens(selectConditionalPath(template, branch)))
    if (htmlProblem) {
      report.add('error', 'grammar.unbalanced-html', 'template', `Template HTML is unbalanced when conditions take their ${branch} branches: ${htmlProblem}.`)
      break
    }
  }
  const blockProblem = findUnbalancedTemplateBlocks(template)
  if (blockProblem)
    report.add('error', 'grammar.unbalanced-block', 'template', `Template loops or conditionals are unbalanced: ${blockProblem}.`)
  // The public renderer runs inline block scripts once per route, so this is
  // a review prompt rather than breakage; helper contracts are preferred.
  if (/<script\b/i.test(template))
    report.add('warning', 'grammar.script', 'template', 'Block contains an inline script; the public renderer runs it once per route. Prefer the CMS helper contracts where one exists.')
  if (/\s(?:v-[a-z][\w-]*|@[a-z][\w.-]*|:[a-z][\w-]*|on[a-z]+)\s*=/i.test(stripTemplateTokens(template)))
    report.add('error', 'grammar.vue-or-inline-handler', 'template', 'Vue directives, bindings, and inline event handlers are not supported.')
  if (/(^|[^{])\{\{\s*#if\b/.test(template))
    report.add('error', 'grammar.legacy-if', 'template', 'Template v2 conditionals must use triple-brace JSON syntax.')
  if (/\{\{\{\s*#if\s+\{[^}]*(&&|\|\|)/.test(template))
    report.add('error', 'grammar.condition-operator', 'template', 'Template v2 conditions do not support && or ||; nest conditions instead.')
  // A leading ! is not negation to the engine: `!agent.bio` takes the else
  // branch even when the field is empty. Comparisons (!=, !==) are supported.
  const conditions = [...template.matchAll(/"cond"\s*:\s*"([^"]*)"/g)].map(match => match[1])
  if (conditions.some(condition => /(^|[\s(])!(?!=)/.test(condition)))
    report.add('error', 'grammar.condition-negation', 'template', 'Template v2 conditions do not support ! negation; test the field and put the content in the {{{#else}}} branch.')
  if (/ld\+json/i.test(template))
    report.add('warning', 'grammar.json-ld', 'template', 'Blocks should not contain JSON-LD; use page structured data.')

  const declared = isObject(doc.dataSources) ? Object.keys(doc.dataSources) : []
  const called = [...new Set(extractSourceCalls(template))]
  for (const name of called) {
    if (!declared.includes(name))
      report.add('error', 'sources.undeclared', 'template', `Template calls source("${name}") but dataSources does not declare it.`)
  }
  for (const name of declared) {
    if (!called.includes(name))
      report.add('warning', 'sources.unused', `dataSources.${name}`, `Data Source "${name}" is declared but never called.`)
  }
  if (called.length && !/\{\{\s*loading\s*\}\}/.test(template))
    report.add('warning', 'sources.loading-token', 'template', 'Dynamic Data Sources have no {{ loading }} placeholder class token.')
  if (called.length && !/\{\{\s*loaded\s*\}\}/.test(template))
    report.add('warning', 'sources.loaded-token', 'template', 'Dynamic Data Sources have no {{ loaded }} content class token.')

  const ownershipStatus = ownership?.status
  if (ownershipStatus === 'vue-override' && /\bdata-cms-form\b|\bclass=["'][^"']*\bcms-form\b/.test(String(doc.content || '')))
    report.add('error', 'ownership.form-override', 'name', 'Contact forms must remain CMS-rendered and must not resolve to a Vue override.')
  else if (ownershipStatus === 'ambiguous-vue-override')
    report.add('error', 'ownership.ambiguous', 'name', 'Block name resolves to multiple Vue override candidates.')
  else if (ownershipStatus === 'renderer-repo-unavailable')
    report.add('warning', 'ownership.unverified', 'name', 'Vue override resolution could not be verified because the renderer checkout is unavailable.')

  return finish(report)
}

const stripTags = html => String(html || '').replace(/<[^>]*>/g, ' ')

const checkRenderedOutput = (report, html, pass, contentRules) => {
  const leftover = html.match(/\{\{\{?\s*[#/]?[\w$]|source\(/)
  if (leftover)
    report.add('error', 'render.unresolved-syntax', 'template', `The ${pass} render left template syntax "${leftover[0]}" in its output.`)
  const htmlProblem = findUnbalancedHtml(html)
  if (htmlProblem)
    report.add('error', 'render.unbalanced-html', 'template', `The ${pass} render produced unbalanced HTML: ${htmlProblem}.`)
  if (contentRules?.noExclamation && /!(?=\s|<|$)/.test(stripTags(html)))
    report.add('error', 'content.exclamation', 'template', `The ${pass} render contains an exclamation point.`)
  for (const phrase of contentRules?.bannedPhrases || []) {
    if (new RegExp(phrase, 'i').test(stripTags(html)))
      report.add('error', 'content.banned-phrase', 'template', `The ${pass} render contains the banned phrase "${phrase}".`)
  }
}

// Renders the block with its schema defaults. Blocks with data sources render
// twice: with empty sources (loading and empty states) and with sample records
// (loop bodies). Each output must be free of template syntax and balanced.
export const validateBlockRender = async (doc, options = {}) => {
  const { renderTemplate, sourceFixtures = {}, values = null, contentRules = null } = options
  const report = createReport()
  if (!isObject(doc) || Number(doc.templateVersion) !== 2 || typeof doc.template !== 'string')
    return finish(report)
  if (typeof renderTemplate !== 'function') {
    report.add('info', 'render.skipped', 'template', 'Render checks were skipped because no template engine was provided.')
    return finish(report)
  }

  const renderValues = { ...schemaDefaults(doc.schema), ...(isObject(values) ? values : {}) }
  const dataSources = isObject(doc.dataSources) ? doc.dataSources : {}
  const sourceNames = Object.keys(dataSources)
  const withSourceValues = valuesByName => Object.fromEntries(sourceNames.map(name => [
    name,
    { ...(isObject(dataSources[name]) ? dataSources[name] : {}), value: valuesByName[name] || [] },
  ]))

  const passes = [{ name: sourceNames.length ? 'empty-source' : 'default', sources: withSourceValues({}) }]
  if (sourceNames.length) {
    const generated = buildSourceFixtures(doc.template, sourceNames)
    passes.push({ name: 'sample-source', sources: withSourceValues({ ...generated.fixtures, ...sourceFixtures }) })
    for (const reason of generated.unverified)
      report.add('warning', 'render.dynamic-unverified', 'template', `Sample records could not cover every loop: ${reason}.`)
  }

  for (const pass of passes) {
    let html
    try {
      html = await renderTemplate(doc.template, renderValues, isObject(doc.meta) ? doc.meta : {}, {
        templateVersion: 2,
        dataSources: pass.sources,
        schema: isObject(doc.schema) ? doc.schema : {},
      })
    }
    catch (error) {
      report.add('error', 'render.error', 'template', `The ${pass.name} render failed: ${error?.message || error}.`)
      continue
    }
    checkRenderedOutput(report, String(html ?? ''), pass.name, contentRules)
  }
  return finish(report)
}

// Static checks plus render checks.
export const validateBlock = async (doc, options = {}) => {
  const structure = validateBlockDocument(doc, options)
  const render = await validateBlockRender(doc, options)
  return mergeValidationResults(structure, render)
}

const collectPlacedIds = (report, structure, structureName) => {
  const placed = []
  const rowIds = new Set()
  const columnIds = new Set()
  if (!Array.isArray(structure)) {
    report.add('error', 'page.structure', structureName, `${structureName} must be an array.`)
    return placed
  }
  structure.forEach((row, rowIndex) => {
    const rowPath = `${structureName}[${rowIndex}]`
    if (!isObject(row)) {
      report.add('error', 'page.row', rowPath, `${rowPath} must be an object.`)
      return
    }
    if (!row.id)
      report.add('error', 'page.row-id', rowPath, `${rowPath} is missing id.`)
    else if (rowIds.has(row.id))
      report.add('error', 'page.duplicate-row-id', rowPath, `Duplicate row id "${row.id}".`)
    else
      rowIds.add(row.id)
    if (!Array.isArray(row.columns)) {
      report.add('error', 'page.columns', `${rowPath}.columns`, `${rowPath}.columns must be an array.`)
      return
    }
    row.columns.forEach((column, columnIndex) => {
      const columnPath = `${rowPath}.columns[${columnIndex}]`
      if (!isObject(column)) {
        report.add('error', 'page.column', columnPath, `${columnPath} must be an object.`)
        return
      }
      if (!column.id)
        report.add('error', 'page.column-id', columnPath, `${columnPath} is missing id.`)
      else if (columnIds.has(column.id))
        report.add('error', 'page.duplicate-column-id', columnPath, `Duplicate column id "${column.id}".`)
      else
        columnIds.add(column.id)
      if (!Array.isArray(column.blocks))
        report.add('error', 'page.column-blocks', `${columnPath}.blocks`, `${columnPath}.blocks must be an array.`)
      else
        placed.push(...column.blocks)
    })
  })
  return placed
}

const validatePageView = (report, content, structure, contentName, structureName) => {
  if (!Array.isArray(content)) {
    report.add('error', 'page.content', contentName, `${contentName} must be an array.`)
    return
  }
  const instanceIds = []
  content.forEach((block, index) => {
    const path = `${contentName}[${index}]`
    if (!isObject(block)) {
      report.add('error', 'page.instance', path, `${path} must be an object.`)
      return
    }
    for (const key of ['id', 'blockId', 'name']) {
      if (!String(block[key] || '').trim())
        report.add('error', 'page.instance-key', `${path}.${key}`, `${path} is missing ${key}.`)
    }
    if (typeof block.content !== 'string')
      report.add('error', 'page.instance-content', `${path}.content`, `${path}.content must be a string.`)
    instanceIds.push(block.id)
  })
  const uniqueIds = new Set(instanceIds)
  if (uniqueIds.size !== instanceIds.length)
    report.add('error', 'page.duplicate-instance-id', contentName, `${contentName} contains duplicate instance ids.`)

  const placed = collectPlacedIds(report, structure, structureName)
  const counts = new Map()
  for (const id of placed)
    counts.set(id, (counts.get(id) || 0) + 1)
  for (const id of uniqueIds) {
    const count = counts.get(id) || 0
    if (count !== 1)
      report.add('error', 'page.instance-placement', structureName, `Instance "${id}" is placed ${count} times in ${structureName}; expected exactly once.`)
  }
  for (const id of new Set(placed)) {
    if (!uniqueIds.has(id))
      report.add('error', 'page.unknown-instance', structureName, `${structureName} references unknown instance "${id}".`)
  }
}

// Page structure and content checks for draft pages and page templates.
export const validatePageDocument = (doc, options = {}) => {
  const { requiredKeys = DEFAULT_REQUIRED_PAGE_KEYS } = options
  const report = createReport()
  if (!isObject(doc)) {
    report.add('error', 'shape.not-object', '', 'Page document must be a JSON object.')
    return finish(report)
  }
  for (const key of requiredKeys) {
    if (!owns(doc, key))
      report.add('error', 'shape.missing-key', key, `Missing required key "${key}".`)
  }
  if (owns(doc, 'type')) {
    const types = Array.isArray(doc.type) ? doc.type : [doc.type]
    if (!types.length || types.some(type => !BLOCK_TYPES.has(type)))
      report.add('error', 'shape.type', 'type', 'type must be "Page", "Post", or both.')
  }

  validatePageView(report, doc.content ?? [], doc.structure ?? [], 'content', 'structure')
  if (owns(doc, 'postContent') || owns(doc, 'postStructure'))
    validatePageView(report, doc.postContent ?? [], doc.postStructure ?? [], 'postContent', 'postStructure')

  const types = Array.isArray(doc.type) ? doc.type : [doc.type]
  if (types.includes('Post')) {
    const hasContent = Array.isArray(doc.content) && doc.content.length > 0
    const hasPostContent = Array.isArray(doc.postContent) && doc.postContent.length > 0
    if (doc.post === true) {
      if (!hasContent)
        report.add('warning', 'page.post-index', 'content', 'Route-level blog page has no index content.')
      if (!hasPostContent)
        report.add('warning', 'page.post-detail', 'postContent', 'Route-level blog page has no detail-shell postContent.')
    }
    else if (!hasContent && !hasPostContent) {
      report.add('warning', 'page.post-scaffold', 'content', 'Post template has no scaffold content.')
    }
    else if (hasContent && hasPostContent) {
      report.add('warning', 'page.post-both', 'postContent', 'Post template has both content and postContent; the Posts manager prefers postContent.')
    }
  }
  return finish(report)
}
