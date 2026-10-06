#!/usr/bin/env node

// Package-convention checks for migrator output. The Hub's shared import
// check (scripts/cms/validate-import.mjs in the Hub checkout this skill lives
// in, under edge/skills/) runs first and is authoritative: a file it rejects
// would be rejected by import. The checks below add stricter package
// conventions on top.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const inputs = process.argv.slice(2)

if (!inputs.length) {
  console.error('Usage: validate-cms-import.mjs <json-file-or-package-directory> [...]')
  process.exit(2)
}

// The Hub checkout that contains this skill (edge/skills/<skill>/scripts).
const findHubImportChecker = () => {
  let dir = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'scripts', 'cms', 'validate-import.mjs')
    if (fs.existsSync(candidate))
      return candidate
    dir = path.dirname(dir)
  }
  return null
}

const hubChecker = findHubImportChecker()
let hubCheckFailed = false
if (hubChecker) {
  console.log(`Hub import check (${hubChecker}):`)
  const hub = spawnSync(process.execPath, [hubChecker, ...inputs], { stdio: 'inherit' })
  hubCheckFailed = hub.status !== 0
  console.log('')
}
else {
  console.warn('WARNING: the Hub import check was not run: this skill is not inside a Hub checkout (edge/skills/). Import may still reject these files.')
}

const errors = []
const warnings = []
const documents = []

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function collectJsonFiles(inputPath) {
  const resolved = path.resolve(inputPath)
  if (!fs.existsSync(resolved)) {
    errors.push(`${resolved}: path does not exist`)
    return []
  }

  const stat = fs.statSync(resolved)
  if (stat.isFile())
    return resolved.endsWith('.json') ? [resolved] : []

  if (!stat.isDirectory())
    return []

  return fs.readdirSync(resolved, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(resolved, entry.name)
    return entry.isDirectory() ? collectJsonFiles(child) : (entry.name.endsWith('.json') ? [child] : [])
  })
}

function normalizeDocument(payload) {
  if (!isObject(payload))
    return payload
  if (isObject(payload.document)) {
    return {
      ...payload.document,
      ...(payload.document.docId ? {} : { docId: payload.docId }),
    }
  }
  return payload
}

function classify(document, file) {
  const normalizedPath = file.split(path.sep).join('/')
  if (normalizedPath.includes('/blocks/'))
    return 'block'
  if (normalizedPath.includes('/pages/'))
    return 'page'
  if (Number(document?.templateVersion) === 2 || ('template' in (document || {}) && 'schema' in (document || {})))
    return 'block'
  if (Array.isArray(document?.content) && Array.isArray(document?.structure))
    return 'page'
  return 'other'
}

function requireKeys(document, keys, label) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(document, key))
      errors.push(`${label}: missing required key ${key}`)
  }
}

function validateTypes(document, file) {
  if (!Array.isArray(document.type) || !document.type.length) {
    errors.push(`${file}: type must be a non-empty array`)
    return
  }
  const invalid = document.type.filter(value => !['Page', 'Post'].includes(value))
  if (invalid.length)
    errors.push(`${file}: invalid type value(s): ${invalid.join(', ')}`)
}

function validateBlock(document, file) {
  requireKeys(document, [
    'docId', 'name', 'content', 'templateVersion', 'template', 'schema',
    'dataSources', 'values', 'Instructions', 'aiInstructions', 'tags',
    'themes', 'type', 'previewType', 'synced', 'version',
  ], file)

  if (Number(document.templateVersion) !== 2)
    errors.push(`${file}: templateVersion must be 2`)
  if (typeof document.content !== 'string' || typeof document.template !== 'string')
    errors.push(`${file}: content and template must be strings`)
  else if (document.content !== document.template)
    errors.push(`${file}: content and template must match exactly`)
  if (!isObject(document.schema))
    errors.push(`${file}: schema must be an object`)
  if (!isObject(document.dataSources))
    errors.push(`${file}: dataSources must be an object`)
  if (!isObject(document.values))
    errors.push(`${file}: values must be an object`)
  if (!Array.isArray(document.tags))
    errors.push(`${file}: tags must be an array`)
  if (!Array.isArray(document.themes))
    errors.push(`${file}: themes must be an array`)
  if (typeof document.synced !== 'boolean')
    errors.push(`${file}: synced must be boolean`)
  if (!['light', 'dark'].includes(document.previewType))
    errors.push(`${file}: previewType must be light or dark`)
  if (!Number.isFinite(Number(document.version)))
    errors.push(`${file}: version must be numeric`)
  validateTypes(document, file)

  if (typeof document.template === 'string' && isObject(document.dataSources)) {
    const sourceNames = [...document.template.matchAll(/source\(\s*["']([^"']+)["']/g)].map(match => match[1])
    for (const sourceName of new Set(sourceNames)) {
      if (!Object.prototype.hasOwnProperty.call(document.dataSources, sourceName))
        errors.push(`${file}: template calls undeclared data source ${sourceName}`)
    }
    for (const sourceName of Object.keys(document.dataSources)) {
      if (!sourceNames.includes(sourceName))
        warnings.push(`${file}: data source ${sourceName} is declared but no source(...) call was found`)
    }
  }
}

function collectStructureIds(structure, file, viewName) {
  const ids = []
  const rowIds = new Set()
  const columnIds = new Set()

  if (!Array.isArray(structure)) {
    errors.push(`${file}: ${viewName} must be an array`)
    return ids
  }

  for (const [rowIndex, row] of structure.entries()) {
    if (!isObject(row)) {
      errors.push(`${file}: ${viewName}[${rowIndex}] must be an object`)
      continue
    }
    if (!row.id)
      errors.push(`${file}: ${viewName}[${rowIndex}] is missing id`)
    else if (rowIds.has(row.id))
      errors.push(`${file}: duplicate row id ${row.id}`)
    else
      rowIds.add(row.id)

    if (!Array.isArray(row.columns)) {
      errors.push(`${file}: ${viewName}[${rowIndex}].columns must be an array`)
      continue
    }

    for (const [columnIndex, column] of row.columns.entries()) {
      if (!isObject(column)) {
        errors.push(`${file}: ${viewName}[${rowIndex}].columns[${columnIndex}] must be an object`)
        continue
      }
      if (!column.id)
        errors.push(`${file}: ${viewName}[${rowIndex}].columns[${columnIndex}] is missing id`)
      else if (columnIds.has(column.id))
        errors.push(`${file}: duplicate column id ${column.id}`)
      else
        columnIds.add(column.id)

      if (!Array.isArray(column.blocks)) {
        errors.push(`${file}: ${viewName}[${rowIndex}].columns[${columnIndex}].blocks must be an array`)
        continue
      }
      ids.push(...column.blocks)
    }
  }
  return ids
}

function validatePageView(content, structure, file, contentName, structureName) {
  if (!Array.isArray(content)) {
    errors.push(`${file}: ${contentName} must be an array`)
    return
  }

  const instanceIds = []
  for (const [index, block] of content.entries()) {
    if (!isObject(block)) {
      errors.push(`${file}: ${contentName}[${index}] must be an object`)
      continue
    }
    for (const key of ['id', 'blockId', 'docId', 'name']) {
      if (!String(block[key] || '').trim())
        errors.push(`${file}: ${contentName}[${index}] is missing ${key}`)
    }
    if (typeof block.content !== 'string')
      errors.push(`${file}: ${contentName}[${index}].content must be a string`)
    instanceIds.push(block.id)
  }

  const uniqueIds = new Set(instanceIds)
  if (uniqueIds.size !== instanceIds.length)
    errors.push(`${file}: ${contentName} contains duplicate instance ids`)

  const placedIds = collectStructureIds(structure, file, structureName)
  const counts = new Map()
  for (const id of placedIds)
    counts.set(id, (counts.get(id) || 0) + 1)

  for (const id of instanceIds) {
    const count = counts.get(id) || 0
    if (count !== 1)
      errors.push(`${file}: instance ${id} is placed ${count} times in ${structureName}; expected exactly once`)
  }
  for (const id of placedIds) {
    if (!uniqueIds.has(id))
      errors.push(`${file}: ${structureName} references unknown instance id ${id}`)
  }
}

function validatePage(document, file) {
  requireKeys(document, [
    'docId', 'name', 'type', 'content', 'postContent', 'structure',
    'postStructure', 'metaTitle', 'metaDescription', 'postMetaTitle',
    'postMetaDescription', 'structuredData', 'postStructuredData', 'post',
    'tags', 'allowedThemes', 'version',
  ], file)
  validateTypes(document, file)
  validatePageView(document.content, document.structure, file, 'content', 'structure')
  validatePageView(document.postContent, document.postStructure, file, 'postContent', 'postStructure')

  if (!document.type?.includes('Post'))
    return

  const isRouteLevelBlogPage = document.post === true
  const hasContent = Array.isArray(document.content) && document.content.length > 0
  const hasPostContent = Array.isArray(document.postContent) && document.postContent.length > 0

  if (isRouteLevelBlogPage) {
    if (!hasContent)
      warnings.push(`${file}: route-level blog page has no index content`)
    if (!hasPostContent)
      warnings.push(`${file}: route-level blog page has no detail-shell postContent`)
    return
  }

  if (!hasContent && !hasPostContent)
    warnings.push(`${file}: Post template has no scaffold content`)
  if (hasContent && hasPostContent)
    warnings.push(`${file}: Post template contains both content and postContent; the Posts manager will prefer postContent`)
}

for (const input of inputs) {
  for (const file of collectJsonFiles(input)) {
    let payload
    try {
      payload = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    catch (error) {
      errors.push(`${file}: invalid JSON: ${error.message}`)
      continue
    }

    const document = normalizeDocument(payload)
    if (!isObject(document)) {
      errors.push(`${file}: expected a JSON object`)
      continue
    }
    const kind = classify(document, file)
    documents.push({ file, document, kind })
    if (kind === 'block')
      validateBlock(document, file)
    else if (kind === 'page')
      validatePage(document, file)
  }
}

const blocksById = new Map(
  documents
    .filter(item => item.kind === 'block' && item.document.docId)
    .map(item => [item.document.docId, item.file]),
)

for (const { file, document, kind } of documents) {
  if (kind !== 'page')
    continue
  for (const block of [...(document.content || []), ...(document.postContent || [])]) {
    if (block?.blockId && !blocksById.has(block.blockId))
      warnings.push(`${file}: blockId ${block.blockId} is not included in the validated inputs; confirm it already exists or is runtime-owned`)
  }
}

for (const warning of warnings)
  console.warn(`WARN: ${warning}`)
for (const error of errors)
  console.error(`ERROR: ${error}`)

const counts = documents.reduce((summary, item) => {
  summary[item.kind] = (summary[item.kind] || 0) + 1
  return summary
}, {})

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s).`)
  process.exit(1)
}

if (hubCheckFailed) {
  console.error('Package conventions passed, but the Hub import check rejected at least one file (see above).')
  process.exit(1)
}

console.log(`Validated ${counts.block || 0} block(s) and ${counts.page || 0} page(s) with ${warnings.length} warning(s).`)
