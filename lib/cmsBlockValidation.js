// Shared Template v2 block and page validation for the Hub import screen, the
// Firebase MCP, block packages, and server write operations. Pure ESM: callers
// inject the template engine so every runtime can supply its own copy.
//
// Every finding is { code, severity, path, message }. Codes are stable; callers
// decide which severities block their flow.

import { parse as parseJavaScript } from 'acorn'
import { THEME_COLOR_TOKENS, THEME_OPTIONAL_COLOR_TOKENS, THEME_FONT_TOKENS, THEME_RADIUS_TOKENS } from './cmsThemeDefaults.mjs'
export { THEME_COLOR_TOKENS, THEME_OPTIONAL_COLOR_TOKENS, THEME_FONT_TOKENS, THEME_RADIUS_TOKENS }

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const BLOCK_TYPES = new Set(['Page', 'Post'])
const PREVIEW_TYPES = new Set(['light', 'dark'])
const FIXTURE_TEXT = '1'

// Walk parsed JavaScript, not strings/comments, and never execute block code.
const scriptNodes = (node, result = []) => {
  if (!node || typeof node !== 'object') return result
  if (typeof node.type === 'string') result.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => scriptNodes(child, result))
    else if (value && typeof value === 'object') scriptNodes(value, result)
  }
  return result
}
const memberName = node => node?.type === 'MemberExpression'
  ? (node.computed ? node.property?.value : node.property?.name)
  : null
const documentMember = (node, name) =>
  node?.object?.type === 'Identifier' && node.object.name === 'document' && memberName(node) === name

// Only inspect calls in executable script/IIFE bodies. A call written inside a
// deferred callback, method or function declaration is not evidence that the
// script initializes directly. Named wrapper invocation is not flow-analyzed.
const immediateScriptNodes = (node, result = [], parent = null) => {
  if (!node || typeof node !== 'object') return result
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    && (node.generator || parent?.type !== 'CallExpression' || parent.callee !== node))
    return result
  if (typeof node.type === 'string') result.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => immediateScriptNodes(child, result, node))
    else if (value && typeof value === 'object') immediateScriptNodes(value, result, node)
  }
  return result
}

// Match the same receiver/member, including app.init and app['init'], without
// guessing the value of dynamic properties or arbitrary expressions.
const initializerKey = (node) => {
  if (node?.type === 'ChainExpression') return initializerKey(node.expression)
  if (node?.type === 'Identifier') return JSON.stringify(['identifier', node.name])
  if (node?.type !== 'MemberExpression') return null
  const receiver = initializerKey(node.object)
  const property = node.computed
    ? (node.property?.type === 'Literal' ? node.property.value : null)
    : node.property?.name
  return receiver && property != null ? JSON.stringify(['member', receiver, String(property)]) : null
}


const reliesOnlyOnDomContentLoaded = (ast) => {
  const nodes = immediateScriptNodes(ast)
  const listeners = nodes.filter(node => node.type === 'CallExpression'
    && memberName(node.callee) === 'addEventListener'
    && ['document', 'window'].includes(node.callee.object?.name)
    && node.arguments[0]?.value === 'DOMContentLoaded')
  if (!listeners.length) return false

  // Recognize the usual readyState loading/else fallback. This is a targeted
  // lifecycle lint, not proof that arbitrary control flow is correct.
  return listeners.some((listener) => {
    const callback = listener.arguments[1]
    const callbackKey = initializerKey(callback)
    const names = callbackKey ? [callbackKey]
      : immediateScriptNodes(callback?.body).filter(node => node.type === 'CallExpression')
        .map(node => initializerKey(node.callee)).filter(Boolean)
    const hasReadyFallback = nodes.some(node =>
      (node.type === 'IfStatement' && node.alternate || node.type === 'ConditionalExpression')
      && scriptNodes(node.test).some(test => documentMember(test, 'readyState'))
      && [node.consequent, node.alternate].some((branch, index) => {
        if (!(branch?.start <= listener.start && branch?.end >= listener.end)) return false
        const fallback = index === 0 ? node.alternate : node.consequent
        return immediateScriptNodes(fallback).some(call => call.type === 'CallExpression'
          && names.includes(initializerKey(call.callee)))
      }))
    if (hasReadyFallback) return false
    const calledSeparately = nodes.some(node => node.type === 'CallExpression'
      && names.includes(initializerKey(node.callee))
      && !(node.start >= callback?.start && node.end <= callback?.end)
      && !listeners.some(other => other.arguments[1]?.start <= node.start && other.arguments[1]?.end >= node.end)
      && !nodes.some(parent => parent.type === 'IfStatement'
        && parent.start <= node.start && parent.end >= node.end
        && scriptNodes(parent.test).some(test => documentMember(test, 'readyState'))))
    return !calledSeparately
  })
}

export const inlineScriptFindings = (html, { deferTemplated = false } = {}) => {
  const findings = []
  const scripts = /<!--[\s\S]*?-->|<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi
  let index = 0
  for (const match of String(html || '').matchAll(scripts)) {
    if (match[1] === undefined) continue
    index++
    const [, attributes, body] = match
    if (/(?:^|\s)src\s*=/i.test(attributes)) continue
    const typeMatch = attributes.match(/(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i)
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '').trim().toLowerCase().split(';')[0]
    if (type && type !== 'module' && !/^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?$/.test(type)) continue
    // Hydrated code is checked by validateBlockRender instead.
    if (deferTemplated && /\{\{\{?[\s\S]*?\}\}\}?/.test(body)) continue
    let ast
    try {
      ast = parseJavaScript(body, { ecmaVersion: 'latest', sourceType: type === 'module' ? 'module' : 'script' })
    }
    catch (error) {
      findings.push({ severity: 'error', code: 'script.syntax', path: 'template',
        message: 'Inline script ' + index + ' has invalid JavaScript: ' + error.message })
      continue
    }
    if (reliesOnlyOnDomContentLoaded(ast)) {
      findings.push({ severity: 'warning', code: 'script.dom-content-loaded-only', path: 'template',
        message: 'Inline script ' + index + ' initializes only on DOMContentLoaded, which may have already fired during client-side navigation. Initialize directly or add a document.readyState fallback.' })
    }
  }
  return findings
}


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

// ---- Standard theme names ----
// Every theme defines the same color, font and radius names, and blocks use
// only those, so a block works with any theme in the organization: swapping
// themes never leaves a block pointing at a color (river, timber) the new
// theme doesn't have. Contract: docs/data-contracts/cms-themes/README.md.
const STANDARD_COLORS = new Set([...THEME_COLOR_TOKENS, ...THEME_OPTIONAL_COLOR_TOKENS, 'white', 'black', 'transparent', 'current', 'inherit'])
const STANDARD_FONTS = new Set([...THEME_FONT_TOKENS, 'mono'])
const STANDARD_RADII = new Set([...THEME_RADIUS_TOKENS, 'none', 'sm', 'md', 'lg', 'xl', 'full'])
const FONT_WEIGHTS = new Set(['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'])
const TAILWIND_PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
// Letter-only suffixes of color utilities that aren't colors.
const NON_COLOR_WORDS = {
  text: ['left', 'center', 'right', 'justify', 'start', 'end', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip', 'xs', 'sm', 'base', 'lg', 'xl'],
  bg: ['fixed', 'local', 'scroll', 'cover', 'contain', 'auto', 'center', 'top', 'bottom', 'left', 'right', 'none', 'repeat'],
  border: ['x', 'y', 't', 'r', 'b', 'l', 's', 'e', 'solid', 'dashed', 'dotted', 'double', 'hidden', 'none', 'collapse', 'separate'],
  divide: ['x', 'y', 'solid', 'dashed', 'dotted', 'double', 'none'],
  outline: ['none', 'solid', 'dashed', 'dotted', 'double'],
  ring: ['inset'],
  decoration: ['solid', 'double', 'dotted', 'dashed', 'wavy', 'auto', 'slice', 'clone'],
  accent: ['auto'],
  fill: ['none'],
  stroke: ['none'],
}
const COLOR_UTILITY = /^(bg|text|border(?:-[xytrblse])?|divide|outline|ring(?:-offset)?|decoration|fill|stroke|from|via|to|accent|caret|placeholder)-([a-z][a-zA-Z]*)(?:\/(?:\d+|\[[^\]]+\]))?$/
const PALETTE_UTILITY = new RegExp(`^(?:bg|text|border(?:-[xytrblse])?|divide|outline|ring(?:-offset)?|decoration|fill|stroke|from|via|to|accent|caret|placeholder)-(?:${TAILWIND_PALETTE})-\\d{2,3}(?:\\/.*)?$`)
const RAW_COLOR = /^(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|color-mix\()/i

// The class strings in a template or an `apply` value, with template tokens
// removed.
export const templateClassStrings = (template) => {
  const source = String(template || '').replace(/\{\{\{?[\s\S]*?\}?\}\}/g, ' ')
  return [...source.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(match => match[1] ?? match[2] ?? '')
}

// Names in class strings that aren't standard theme names:
// { colors, fonts, radii, raw } (sorted, unique). `raw` holds hard-coded
// colors: hex or rgb arbitrary values and the Tailwind palette.
export const findThemeNameIssues = (classStrings, themeTokens = {}) => {
  const colors = new Set([...STANDARD_COLORS, ...(themeTokens.colors || [])])
  const fonts = new Set([...STANDARD_FONTS, ...(themeTokens.fontFamily || [])])
  const radii = new Set([...STANDARD_RADII, ...(themeTokens.borderRadius || [])])
  const found = { colors: new Set(), fonts: new Set(), radii: new Set(), raw: new Set(), opacity: new Set() }
  for (const classString of classStrings) {
    for (const token of String(classString || '').split(/\s+/).filter(Boolean)) {
      const utility = token.split(':').pop().replace(/^!/, '').replace(/^-/, '')
      // Opacity modifiers are whole percents (/5): a bracketed value
      // (/[0.03]) is dropped by the public renderer.
      if (/\/\[[^\]]+\]$/.test(utility) && /^(bg|text|border|divide|outline|ring|decoration|fill|stroke|from|via|to|accent|caret|placeholder)-/.test(utility))
        found.opacity.add(token)
      const arbitrary = utility.match(/^([a-z-]+)-\[(.+)\](?:\/.*)?$/)
      if (arbitrary) {
        const [, prefix, value] = arbitrary
        const cssVar = value.match(/^var\(--(color|font|radius)-([\w-]+)\)/)
        if (cssVar) {
          const [, kind, name] = cssVar
          if (kind === 'color' && !colors.has(name))
            found.colors.add(name)
          else if (kind === 'font' && !fonts.has(name))
            found.fonts.add(name)
          else if (kind === 'radius' && !radii.has(name))
            found.radii.add(name)
        }
        else if (prefix !== 'font' && prefix !== 'rounded' && RAW_COLOR.test(value)) {
          found.raw.add(token)
        }
        continue
      }
      if (PALETTE_UTILITY.test(utility)) {
        found.raw.add(token)
        continue
      }
      const font = utility.match(/^font-([a-z][a-zA-Z]*)$/)
      if (font) {
        if (!fonts.has(font[1]) && !FONT_WEIGHTS.has(font[1]))
          found.fonts.add(font[1])
        continue
      }
      const radius = utility.match(/^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-([a-z][a-zA-Z]*)$/)
      if (radius) {
        if (!radii.has(radius[1]))
          found.radii.add(radius[1])
        continue
      }
      const color = utility.match(COLOR_UTILITY)
      if (color) {
        const group = color[1].replace(/-.*/, '')
        if (!colors.has(color[2]) && !(NON_COLOR_WORDS[group] || []).includes(color[2]))
          found.colors.add(color[2])
      }
    }
  }
  const sorted = set => [...set].sort()
  return { colors: sorted(found.colors), fonts: sorted(found.fonts), radii: sorted(found.radii), raw: sorted(found.raw), opacity: sorted(found.opacity) }
}

// The same issues as block findings: { code, message } per kind found.
export const themeNameFindings = (classStrings, themeTokens = {}) => {
  const issues = findThemeNameIssues(classStrings, themeTokens)
  const findings = []
  if (issues.colors.length)
    findings.push({ code: 'theme.color-name', message: `Colors outside the standard theme names: ${issues.colors.join(', ')}. Use ${THEME_COLOR_TOKENS.join(', ')} (or ${THEME_OPTIONAL_COLOR_TOKENS.join(', ')}).` })
  if (issues.fonts.length)
    findings.push({ code: 'theme.font-name', message: `Fonts outside the standard theme names: ${issues.fonts.join(', ')}. Use ${THEME_FONT_TOKENS.join(', ')}.` })
  if (issues.radii.length)
    findings.push({ code: 'theme.radius-name', message: `Radii outside the standard theme names: ${issues.radii.join(', ')}. Use ${THEME_RADIUS_TOKENS.join(', ')} or a Tailwind size.` })
  if (issues.opacity.length)
    findings.push({ code: 'theme.opacity-format', message: `Opacity modifiers must be whole percents (/5, /90): ${issues.opacity.slice(0, 8).join(' ')}. The public renderer drops bracketed values like /[0.03].` })
  if (issues.raw.length)
    findings.push({ code: 'theme.raw-color', message: `Hard-coded colors bypass the theme: ${issues.raw.slice(0, 8).join(' ')}${issues.raw.length > 8 ? ` (+${issues.raw.length - 8} more)` : ''}. Use a standard theme color, with an opacity modifier if needed.` })
  return findings
}

// ---- Type roles (docs/data-contracts/cms-themes/README.md) ----
// A theme may name the classes that style its section headings and intros
// (`typeRoles`). Blocks for that theme use them instead of their own sizes,
// so the theme's Extra CSS sets the style once. Themes without type roles are
// not checked.
export const TYPE_ROLE_KEYS = Object.freeze(['sectionTitle', 'sectionIntro'])
const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/

// A theme's `typeRoles` as { sectionTitle?, sectionIntro? }, keeping only
// single class names; null when the theme sets none.
export const normalizeTypeRoles = (value) => {
  let roles = value
  if (typeof roles === 'string') {
    try {
      roles = JSON.parse(roles)
    }
    catch {
      return null
    }
  }
  if (!isObject(roles))
    return null
  const normalized = {}
  for (const key of TYPE_ROLE_KEYS) {
    const name = typeof roles[key] === 'string' ? roles[key].trim() : ''
    if (CLASS_NAME.test(name))
      normalized[key] = name
  }
  return Object.keys(normalized).length ? normalized : null
}

// Roles a block can rely on when it allows several themes: each role every
// declaring theme names the same way. Themes without type roles don't count.
export const commonTypeRoles = (themeDocs = []) => {
  const declared = themeDocs.map(doc => normalizeTypeRoles(doc?.typeRoles)).filter(Boolean)
  if (!declared.length)
    return null
  const common = {}
  for (const key of TYPE_ROLE_KEYS) {
    const names = new Set(declared.map(roles => roles[key]))
    if (names.size === 1 && !names.has(undefined))
      common[key] = [...names][0]
  }
  return Object.keys(common).length ? common : null
}

const TYPE_SIZE_VALUE = /^(?:length:)?-?[\d.]+(?:px|rem|em|vw|vh|svw|dvw|ch|%)$|^(?:clamp|calc|min|max)\(/
const NAMED_TEXT_SIZE = /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/
const NAMED_LEADING = /^leading-(?:none|tight|snug|normal|relaxed|loose|\d+)$/
const OWN_TYPE_CLASSES = new Set(['cw-body', 'cw-body-lg', 'cw-small', 'cw-h1', 'cw-h2', 'cw-h3', 'cw-h4', 'cw-display'])

// Class tokens that set an element's own size, line height or width.
const ownTypeTokens = (classString, { width = false } = {}) => String(classString || '').split(/\s+/).filter((token) => {
  const utility = token.split(':').pop().replace(/^!/, '')
  if (OWN_TYPE_CLASSES.has(utility) || NAMED_TEXT_SIZE.test(utility) || NAMED_LEADING.test(utility))
    return true
  const arbitrary = utility.match(/^(text|leading|max-w)-\[(.+)\]$/)
  if (!arbitrary)
    return false
  const [, prefix, value] = arbitrary
  if (prefix === 'text')
    return TYPE_SIZE_VALUE.test(value)
  return prefix === 'leading' || width
})

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match ? (match[1] ?? match[2] ?? '') : null
}
const hasClass = (classString, name) => String(classString || '').split(/\s+/).some(token => token.split(':').pop().replace(/^!/, '') === name)
const optedOut = tag => attribute(tag, 'data-type-role') === 'none'

// Section headings (<h2>) and the intro right after one, checked against the
// theme's type roles. An element with data-type-role="none" is a deliberate
// exception. Returns { code, message } findings, at most one per kind.
export const sectionTypeRoleFindings = (template, typeRoles) => {
  const roles = normalizeTypeRoles(typeRoles)
  if (!roles)
    return []
  const source = stripTemplateTokens(template)
  const headings = []
  const intros = []
  for (const match of source.matchAll(/<h2\b[^>]*>/gi)) {
    const tag = match[0]
    if (optedOut(tag))
      continue
    const classes = attribute(tag, 'class') || ''
    if (roles.sectionTitle) {
      const own = ownTypeTokens(classes)
      if (own.length || !hasClass(classes, roles.sectionTitle))
        headings.push(own.length ? own.join(' ') : '(no role class)')
    }
    if (!roles.sectionIntro)
      continue
    const close = source.slice(match.index + tag.length).search(/<\/h2\s*>/i)
    if (close < 0)
      continue
    const after = source.slice(match.index + tag.length + close).replace(/^<\/h2\s*>/i, '')
    const next = after.match(/^\s*<(p|div)\b[^>]*>/i)
    if (!next || optedOut(next[0]))
      continue
    const introClasses = attribute(next[0], 'class') || ''
    const own = ownTypeTokens(introClasses, { width: true })
    if (own.length)
      intros.push(own.join(' '))
  }
  const findings = []
  const list = items => `${items.slice(0, 4).join('; ')}${items.length > 4 ? ` (+${items.length - 4} more)` : ''}`
  if (headings.length)
    findings.push({ code: 'type.section-role', message: `Section headings should use the theme's "${roles.sectionTitle}" class for their size and line height, not their own: ${list(headings)}. Mark a deliberate exception with data-type-role="none".` })
  if (intros.length)
    findings.push({ code: 'type.section-role', message: `Section intros should use the theme's "${roles.sectionIntro}" class (and its width modifiers) for size, line height and width, not their own: ${list(intros)}. Mark a deliberate exception with data-type-role="none".` })
  return findings
}

const themeGroup = (theme, name) => {
  const extend = isObject(theme?.extend) ? theme.extend[name] : undefined
  const top = isObject(theme) ? theme[name] : undefined
  if (!isObject(extend) && !isObject(top))
    return null
  return { ...(isObject(top) ? top : {}), ...(isObject(extend) ? extend : {}) }
}

// Problems with a parsed Theme JSON object against the standard names: every
// required color, font and radius defined, custom additions allowed, and `apply`
// rules using only standard names. [] means the theme is standard.
export const themeTokenProblems = (theme) => {
  if (!isObject(theme))
    return [{ code: 'theme.not-object', message: 'Theme JSON must be an object.' }]
  const problems = []
  const checkGroup = (groupName, label, required, code) => {
    const group = themeGroup(theme, groupName) || {}
    const keys = Object.keys(group)
    const missing = required.filter(key => !keys.includes(key))
    if (missing.length)
      problems.push({ code: `${code}-missing`, message: `Theme is missing standard ${label}: ${missing.join(', ')}.` })
  }
  checkGroup('colors', 'colors', THEME_COLOR_TOKENS, 'theme.color')
  checkGroup('fontFamily', 'fonts', THEME_FONT_TOKENS, 'theme.font')
  checkGroup('borderRadius', 'radii', THEME_RADIUS_TOKENS, 'theme.radius')
  const applyStrings = []
  const collectApply = (apply) => {
    for (const value of Object.values(isObject(apply) ? apply : {})) {
      if (typeof value === 'string')
        applyStrings.push(value)
    }
  }
  collectApply(theme.apply)
  for (const variant of Object.values(isObject(theme.variants) ? theme.variants : {}))
    collectApply(variant?.apply)
  // `apply` stays empty: the public renderer ignores it (and the Hub no
  // longer applies it), so blocks set their own base font and color.
  if (applyStrings.some(value => value.trim()))
    problems.push({ code: 'theme.apply-rules', message: 'Theme apply rules have no effect on published sites; leave "apply" empty and set base fonts and colors in each block\'s classes.' })
  return problems
}

// The organization's block tag list (`cmsBlockTags` on the organization
// document): an ordered list of the tags blocks may carry. Missing or empty
// means unrestricted. Quick Picks marks the block picker's default view and
// is not a content tag.
export const QUICK_PICKS_TAG = 'Quick Picks'
export const MAX_CONTENT_TAGS = 2
// 'warning' until every library block carries only listed tags, then 'error'.
export const BLOCK_TAG_RULE_SEVERITY = 'warning'

// Trimmed, non-empty, first occurrence kept, order preserved.
export const normalizeBlockTagList = (value) => {
  const list = []
  for (const entry of Array.isArray(value) ? value : []) {
    const tag = typeof entry === 'string' ? entry.trim() : ''
    if (tag && !list.includes(tag))
      list.push(tag)
  }
  return list
}

// The tags that count toward the one-or-two rule.
export const contentBlockTags = tags => [...new Set((Array.isArray(tags) ? tags : []).filter(tag => tag !== QUICK_PICKS_TAG))]

// Findings for a block's tags against the organization list: each tag not in
// the list, and a content tag count other than one or two. No list, no
// findings.
export const blockTagFindings = (tags, tagList, { severity = BLOCK_TAG_RULE_SEVERITY } = {}) => {
  const list = normalizeBlockTagList(tagList)
  if (!list.length || !Array.isArray(tags))
    return []
  const findings = []
  for (const tag of [...new Set(tags)]) {
    if (!list.includes(tag))
      findings.push({ code: 'tags.not-in-list', severity, path: 'tags', message: `Tag "${tag}" is not in the organization's block tag list.` })
  }
  const count = contentBlockTags(tags).length
  if (count < 1 || count > MAX_CONTENT_TAGS)
    findings.push({ code: 'tags.content-count', severity, path: 'tags', message: `A block needs one or two content tags (${QUICK_PICKS_TAG} not counted); this one has ${count}.` })
  return findings
}

// Structural, schema, and template-grammar checks. Pass the raw document as
// imported, before any Hub normalization.
export const validateBlockDocument = (doc, options = {}) => {
  const {
    requiredKeys = HUB_REQUIRED_BLOCK_KEYS,
    requireDocId = false,
    knownThemeIds = null,
    allowedTags = null,
    blockTagList = null,
    blockTagSeverity = BLOCK_TAG_RULE_SEVERITY,
    library = true,
    ownership = null,
    typeRoles = null,
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
  for (const finding of blockTagFindings(doc.tags, blockTagList, { severity: blockTagSeverity }))
    report.add(finding.severity, finding.code, finding.path, finding.message)
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
  for (const finding of inlineScriptFindings(template, { deferTemplated: true }))
    report.add(finding.severity, finding.code, finding.path, finding.message)
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
  // Warnings here: blocks for themes that predate the standard names still
  // import. Operations refuse them for blocks whose themes are standard.
  for (const finding of themeNameFindings(templateClassStrings(template)))
    report.add('warning', finding.code, 'template', finding.message)
  // Only when the caller knows the block's themes declare type roles.
  for (const finding of sectionTypeRoleFindings(template, typeRoles))
    report.add('warning', finding.code, 'template', finding.message)

  const declared = isObject(doc.dataSources) ? Object.keys(doc.dataSources) : []
  // A lookup of the site record must name the current site with the
  // {siteId} token; a literal id only works on the site it was built for.
  for (const [name, source] of Object.entries(isObject(doc.dataSources) ? doc.dataSources : {})) {
    const lookupKey = String((source?.canonicalLookup || source?.collection?.canonicalLookup)?.key || '')
    const path = String(source?.path || source?.collection?.path || '')
    if (path === 'sites' && lookupKey && !lookupKey.includes('{siteId}'))
      report.add('warning', 'sources.site-id', `dataSources.${name}`, `Data Source "${name}" looks up the site record by a fixed id ("${lookupKey}"); use "{orgId}:{siteId}" so it works on any site.`)
  }
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

// Publication fields render to a {{{#publication {...} }}} marker that the
// public renderer swaps for the flipbook. The engine URI-encodes the marker's
// context, so its JSON holds no braces. Only markers for a field the schema
// declares as a publication are expected output.
const stripPublicationMarkers = (html, schema) => html.replace(
  /\{\{\{\s*#publication\s*(\{[^{}]*\})\s*\}\}\}/g,
  (marker, json) => {
    try {
      const field = JSON.parse(json)?.field
      return typeof field === 'string' && schema?.[field]?.type === 'publication' ? '' : marker
    }
    catch {
      return marker
    }
  },
)

const checkRenderedOutput = (report, html, pass, contentRules, schema) => {
  for (const finding of inlineScriptFindings(html)) {
    if (![...report.errors, ...report.warnings].some(issue => issue.code === finding.code && issue.message === finding.message))
      report.add(finding.severity, finding.code, finding.path, finding.message)
  }
  const leftover = stripPublicationMarkers(html, schema).match(/\{\{\{?\s*[#/]?[\w$]|source\(/)
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
    checkRenderedOutput(report, String(html ?? ''), pass.name, contentRules, isObject(doc.schema) ? doc.schema : {})
  }
  return finish(report)
}

// Static checks plus render checks.
export const validateBlock = async (doc, options = {}) => {
  const structure = validateBlockDocument(doc, options)
  const render = await validateBlockRender(doc, options)
  // Static and hydrated checks can find the same issue. Keep one script finding.
  for (const severity of ['errors', 'warnings'])
    render[severity] = render[severity].filter(issue => !issue.code.startsWith('script.') || !structure[severity].some(other => other.code === issue.code && other.message === issue.message))
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

// ---- Validation codes ----
//
// Every code the validator can report, with its severity and meaning. The
// blocks contract's validation table is generated from this when
// cms_contract serves it (withGeneratedValidationCodes); tests check that
// every code the validator reports is listed here and every listed code is
// reported. Theme-name and type-role findings carry no severity of their
// own: the validator reports them as warnings, and the CMS operations may
// refuse them (cms-operations contract, Rules).
export const BLOCK_VALIDATION_CODES = Object.freeze({
  'shape.not-object': { severity: 'error', meaning: 'The block is not an object.' },
  'shape.missing-key': { severity: 'error', meaning: 'A key the caller requires is missing.' },
  'shape.doc-id': { severity: 'error', meaning: '`docId` missing, when the caller requires it (the MCP).' },
  'shape.name': { severity: 'error', meaning: '`name` is missing or not a string.' },
  'shape.content': { severity: 'error', meaning: '`content` is missing or not a string.' },
  'shape.type': { severity: 'error', meaning: '`type` is not a string or list of strings.' },
  'shape.synced': { severity: 'error', meaning: '`synced` is not true or false.' },
  'shape.version': { severity: 'error', meaning: '`version` is not a number.' },
  'shape.tag-not-allowed': { severity: 'error', meaning: 'A tag outside the caller\'s allowed set.' },
  'shape.defaulted-key': { severity: 'warning', meaning: 'A field the importer fills in is missing.' },
  'shape.preview-type': { severity: 'warning', meaning: '`previewType` other than `light` or `dark`.' },
  'themes.unknown': { severity: 'warning', meaning: 'A theme id not in the organization. Import asks before dropping it and keeps the valid ids.' },
  'tags.not-in-list': { severity: 'warning', meaning: 'A tag outside the organization\'s block tag list (when it has one).' },
  'tags.content-count': { severity: 'warning', meaning: 'A block needs one or two content tags (Quick Picks not counted).' },
  'template.v1': { severity: 'warning', meaning: 'Legacy Template v1 block.' },
  'v2.template': { severity: 'error', meaning: 'A Template v2 block needs a string `template`.' },
  'v2.content-mismatch': { severity: 'error', meaning: 'Template v2 `content` and `template` must match.' },
  'v2.schema': { severity: 'error', meaning: '`schema` must be an object.' },
  'v2.dataSources': { severity: 'error', meaning: '`dataSources` must be an object.' },
  'v2.values': { severity: 'error', meaning: '`values` must be an object.' },
  'library.values': { severity: 'warning', meaning: 'Library `values` should be empty; defaults belong in the schema.' },
  'schema.input-object': { severity: 'error', meaning: 'A schema input is not an object.' },
  'schema.input-type': { severity: 'error', meaning: 'A schema input has no string `type`.' },
  'schema.input-label': { severity: 'error', meaning: 'A schema input has no label.' },
  'schema.array-value': { severity: 'error', meaning: 'An array input\'s value is not a list.' },
  'schema.input-title': { severity: 'warning', meaning: 'A schema input uses the legacy `title`; use `label`.' },
  'schema.input-value': { severity: 'warning', meaning: 'A schema input has no default value.' },
  'schema.image-alt': { severity: 'warning', meaning: 'An image input has no alt-text input beside it.' },
  'grammar.unbalanced-html': { severity: 'error', meaning: 'HTML is unbalanced when every conditional takes its `if` branch, or every one takes its `else` branch.' },
  'grammar.unbalanced-block': { severity: 'error', meaning: 'Unpaired `{{#for}}`/`{{/for}}` or `{{{#if}}}`/`{{{#else}}}`/`{{{/if}}}`.' },
  'grammar.legacy-if': { severity: 'error', meaning: 'Unsupported conditional syntax (legacy if).' },
  'grammar.condition-operator': { severity: 'error', meaning: 'Unsupported conditional operator.' },
  'grammar.condition-negation': { severity: 'error', meaning: 'Unsupported negated condition.' },
  'grammar.vue-or-inline-handler': { severity: 'error', meaning: 'Vue directives, bindings or inline `on*` handlers.' },
  'grammar.json-ld': { severity: 'warning', meaning: 'JSON-LD belongs in page structured data, not in a block.' },
  'script.syntax': { severity: 'error', meaning: 'An inline script does not parse as JavaScript.' },
  'script.dom-content-loaded-only': { severity: 'warning', meaning: 'An inline script only runs on DOMContentLoaded, which the renderer has already fired; block scripts run once per route.' },
  'theme.color-name': { severity: 'warning', meaning: 'Colors outside the standard theme names (themes contract).' },
  'theme.font-name': { severity: 'warning', meaning: 'Fonts outside the standard theme names.' },
  'theme.radius-name': { severity: 'warning', meaning: 'Radii outside the standard theme names.' },
  'theme.raw-color': { severity: 'warning', meaning: 'Hard-coded colors bypass the theme.' },
  'theme.opacity-format': { severity: 'warning', meaning: 'Opacity modifiers must be whole percents; the renderer drops bracketed values.' },
  'theme.not-object': { severity: 'error', meaning: 'Theme JSON is not an object (theme checks).' },
  'theme.apply-rules': { severity: 'warning', meaning: 'Theme apply rules have no effect on published sites; leave `apply` empty (theme checks).' },
  'type.section-role': { severity: 'warning', meaning: 'Section headings and intros should use the theme\'s type-role classes for size, line height and width; `data-type-role="none"` marks an exception.' },
  'sources.undeclared': { severity: 'error', meaning: '`source("x")` without a declaration in `dataSources`.' },
  'sources.site-id': { severity: 'warning', meaning: 'A Data Source looks up the site record by a literal id instead of `{orgId}:{siteId}`, so it only works on one site.' },
  'sources.unused': { severity: 'warning', meaning: 'A declared Data Source is never called.' },
  'sources.loading-token': { severity: 'warning', meaning: 'Dynamic Data Sources have no `{{ loading }}` class token.' },
  'sources.loaded-token': { severity: 'warning', meaning: 'Dynamic Data Sources have no `{{ loaded }}` class token.' },
  'render.error': { severity: 'error', meaning: 'A render pass threw.' },
  'render.unresolved-syntax': { severity: 'error', meaning: 'A render pass left template syntax in its output.' },
  'render.unbalanced-html': { severity: 'error', meaning: 'A render pass produced unbalanced HTML.' },
  'render.dynamic-unverified': { severity: 'warning', meaning: 'Sample records could not cover a loop, so it was not verified.' },
  'render.skipped': { severity: 'info', meaning: 'No template engine was available; render checks were skipped.' },
  'ownership.form-override': { severity: 'error', meaning: 'A CMS form resolved to a Vue override; forms must stay CMS-rendered.' },
  'ownership.ambiguous': { severity: 'error', meaning: 'The block name matches more than one Vue override.' },
  'ownership.unverified': { severity: 'warning', meaning: 'The renderer checkout was unavailable, so overrides were not checked.' },
  'content.exclamation': { severity: 'error', meaning: 'Project copy rule: no exclamation marks. Only applied when the caller enables it.' },
  'content.banned-phrase': { severity: 'error', meaning: 'Project copy rule: a banned phrase. Only applied when the caller enables it.' },
  'page.content': { severity: 'error', meaning: 'Page `content` is not a list.' },
  'page.structure': { severity: 'error', meaning: 'Page `structure` is not a list.' },
  'page.instance': { severity: 'error', meaning: 'A content entry is not a block instance object.' },
  'page.instance-key': { severity: 'error', meaning: 'A block instance is missing a required key.' },
  'page.instance-content': { severity: 'error', meaning: 'A block instance has no content.' },
  'page.duplicate-instance-id': { severity: 'error', meaning: 'Two block instances share an id.' },
  'page.row': { severity: 'error', meaning: 'A structure row is not an object.' },
  'page.row-id': { severity: 'error', meaning: 'A row has no id.' },
  'page.duplicate-row-id': { severity: 'error', meaning: 'Two rows share an id.' },
  'page.columns': { severity: 'error', meaning: 'A row\'s `columns` is not a list.' },
  'page.column': { severity: 'error', meaning: 'A column is not an object.' },
  'page.column-id': { severity: 'error', meaning: 'A column has no id.' },
  'page.duplicate-column-id': { severity: 'error', meaning: 'Two columns share an id.' },
  'page.column-blocks': { severity: 'error', meaning: 'A column\'s `blocks` is not a list of instance ids.' },
  'page.unknown-instance': { severity: 'error', meaning: 'A column names a block instance the page doesn\'t have.' },
  'page.instance-placement': { severity: 'error', meaning: 'A block instance is placed in no column, or in more than one.' },
  'page.post-index': { severity: 'warning', meaning: 'A route-level blog page has no index content.' },
  'page.post-detail': { severity: 'warning', meaning: 'A route-level blog page has no detail-shell `postContent`.' },
  'page.post-scaffold': { severity: 'warning', meaning: 'A post template has no scaffold content.' },
  'page.post-both': { severity: 'warning', meaning: 'A post template has both `content` and `postContent`; the Posts manager prefers `postContent`.' },
})

// The validation codes as a Markdown table, for the blocks contract.
export const renderBlockValidationCodes = (codes = BLOCK_VALIDATION_CODES) => {
  const cell = value => String(value).replace(/\|/g, '\\|')
  const lines = [
    'Generated from `BLOCK_VALIDATION_CODES` in `edge/lib/cmsBlockValidation.js`, the codes the validator reports.',
    '',
    '| Code | Severity | Meaning |',
    '| --- | --- | --- |',
    ...Object.entries(codes).map(([code, { severity, meaning }]) => `| \`${code}\` | ${severity} | ${cell(meaning)} |`),
    '| `audit.validator-threw` | error | `cms_audit_blocks` only: the validator failed on a block. |',
  ]
  return `${lines.join('\n')}\n`
}

// The marker in the blocks contract that the generated table replaces when
// cms_contract serves it.
export const BLOCK_VALIDATION_CODES_MARKER = '<!-- validation codes: generated from BLOCK_VALIDATION_CODES -->'
export const withGeneratedValidationCodes = markdown => (String(markdown).includes(BLOCK_VALIDATION_CODES_MARKER)
  ? String(markdown).replace(BLOCK_VALIDATION_CODES_MARKER, renderBlockValidationCodes().trimEnd())
  : String(markdown))
