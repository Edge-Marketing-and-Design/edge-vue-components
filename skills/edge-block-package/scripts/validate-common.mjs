// Shared assertions for Edge CMS Template v2 block packages. Copied into each package by scaffold.mjs.
import assert from 'node:assert/strict'
import { renderTemplateAsync } from '@edgedev/template-engine'

export const requiredBlockKeys = ['docId', 'name', 'content', 'templateVersion', 'template', 'schema', 'dataSources', 'values', 'Instructions', 'aiInstructions', 'tags', 'themes', 'type', 'previewType', 'synced', 'version']
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'path'])

export const assertBalancedHtml = (html, label) => {
  const stack = []
  for (const match of html.matchAll(/<\/?([a-z][\w-]*)(?:\s[^<>]*?)?\/?\s*>/gi)) {
    const tagName = match[1].toLowerCase()
    if (voidTags.has(tagName) || /\/\s*>$/.test(match[0])) continue
    if (match[0].startsWith('</')) { assert.equal(stack.pop(), tagName, `${label} has an unmatched closing </${tagName}>`); continue }
    stack.push(tagName)
  }
  assert.deepEqual(stack, [], `${label} has unclosed tags: ${stack.join(', ')}`)
}

export const defaults = block => Object.fromEntries(Object.entries(block.schema).map(([key, input]) => [key, input.value]))

/** Render a block with its default values; `sources` maps a data-source name to sample records. */
export const renderBlock = (block, { values = defaults(block), sources = {} } = {}) => {
  let template = block.template
  for (const name of Object.keys(sources)) template = template.replaceAll(`source("${name}")`, name)
  return renderTemplateAsync(template, { ...values, ...sources }, {}, { templateVersion: 2 })
}

/** Same normalization the public renderer applies to a block name before looking up a Vue override. */
export const toCamelFromLabel = (label) => {
  const tokens = String(label).replace(/[^A-Z0-9]+/gi, ' ').trim().split(/\s+/)
  return tokens[0].toLowerCase() + tokens.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('')
}

const validateInput = (input, location) => {
  assert.equal(typeof input.type, 'string', `${location}.type must be a string`)
  assert.equal(typeof input.label, 'string', `${location}.label must be a string`)
  assert.ok(!Object.hasOwn(input, 'title'), `${location} uses legacy title; use label`)
  if (input.type === 'array') {
    assert.ok(Array.isArray(input.value), `${location}.value must be an array`)
    for (const [name, child] of Object.entries(input.schema || {})) validateInput(child, `${location}.schema.${name}`)
  }
}

/** Structural checks every block must pass. */
export const assertBlockBasics = (block, file, { themeId, allowedTags = null } = {}) => {
  for (const key of requiredBlockKeys) assert.ok(Object.hasOwn(block, key), `${file} is missing ${key}`)
  assert.match(block.docId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${file}: docId must be kebab case`)
  assert.equal(block.templateVersion, 2, `${file}: templateVersion must be 2`)
  assert.equal(block.content, block.template, `${file}: content and template must match`)
  assert.deepEqual(block.values, {}, `${file}: library values must be empty`)
  if (themeId) assert.deepEqual(block.themes, [themeId], `${file}: themes must be [${themeId}]`)
  assert.ok(Array.isArray(block.type) && block.type.length, `${file}: type must be a non-empty array`)
  assert.ok(['light', 'dark'].includes(block.previewType), `${file}: previewType must be light or dark`)
  assert.equal(typeof block.synced, 'boolean', `${file}: synced must be boolean`)
  assert.ok(block.Instructions.trim() && block.aiInstructions.trim(), `${file}: Instructions and aiInstructions are required`)
  if (allowedTags) for (const tag of block.tags) assert.ok(allowedTags.includes(tag), `${file}: tag "${tag}" is not in the project tag set`)
  for (const [name, input] of Object.entries(block.schema)) validateInput(input, `${file}.schema.${name}`)
  assert.doesNotMatch(block.template, /<script\b/i, `${file}: script tags are not supported`)
  assert.doesNotMatch(block.template, /\s(?:v-if|v-for|v-model|@click|onclick)\s*=/i, `${file}: Vue directives and inline handlers are not supported`)
  assert.doesNotMatch(block.template, /(?<!\{)\{\{#if\s/i, `${file}: conditions require triple braces and JSON`)
  assert.doesNotMatch(block.template, /ld\+json/, `${file}: no JSON-LD inside blocks`)
  assertBalancedHtml(block.template, file)
  const declared = Object.keys(block.dataSources)
  const called = [...block.template.matchAll(/source\(\s*["']([^"']+)["']/g)].map(match => match[1])
  for (const name of declared) assert.ok(called.includes(name), `${file}: data source ${name} is declared but never called`)
  for (const name of called) assert.ok(declared.includes(name), `${file}: source(${name}) is called but not declared`)
  for (const [name, input] of Object.entries(block.schema)) {
    if (input.type === 'image')
      assert.ok(Object.hasOwn(block.schema, `${name}Alt`), `${file}: image input ${name} needs a paired ${name}Alt input`)
    if (input.type === 'array')
      for (const [child, childInput] of Object.entries(input.schema || {}))
        if (childInput.type === 'image') assert.ok(Object.hasOwn(input.schema, 'alt') || Object.hasOwn(input.schema, `${child}Alt`), `${file}: array image ${child} needs an alt field`)
  }
}

/** Voice and content checks on rendered output. */
export const assertRenderedCopy = (rendered, file, { bannedPhrases = [] } = {}) => {
  assert.doesNotMatch(rendered, /\{\{/, `${file}: unresolved placeholder`)
  assert.doesNotMatch(rendered, /!(?=\s|<|$)/, `${file}: exclamation point in copy`)
  assert.doesNotMatch(rendered, /screenshot/i, `${file}: call renders and compositions illustrations, not screenshots`)
  for (const phrase of bannedPhrases)
    assert.doesNotMatch(rendered, new RegExp(phrase, 'i'), `${file}: banned phrase "${phrase}"`)
}

/** Manifest sanity against the generated blocks directory. */
export const assertManifest = (manifest, expectedIds, { organizationId, siteId, themeId, themeName } = {}) => {
  assert.deepEqual(manifest.blocks.map(entry => entry.docId), expectedIds, 'manifest block ids must match expectedIds in order')
  if (organizationId) assert.deepEqual(manifest.targetOrganization, { id: organizationId })
  if (siteId) assert.deepEqual(manifest.targetSite, { id: siteId })
  if (themeId) assert.deepEqual(manifest.targetTheme, { id: themeId, name: themeName })
  for (const entry of manifest.blocks) assert.equal(entry.file, `blocks/${entry.docId}.json`)
}
