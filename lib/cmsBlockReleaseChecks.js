// Checks a block revision against every real use of the block before it is
// released:
// 1. the shared validator's static and render checks on the revision;
// 2. a render of every instance with its own values;
// 3. schema compatibility between the released and the new schema.
//
// The validator and the template engine are passed in, so this module has no
// imports. Shared by the Hub (edge/lib/cmsBlockReleaseChecks.js) and Cloud
// Functions (edge/functions/helpers/cmsBlockReleaseChecks.mjs and
// functions/helpers/cmsBlockReleaseChecks.mjs). Keep the three copies
// byte-identical; tests/cmsBlockReleaseChecks.test.mjs enforces it.

// Releases check the definition, not import completeness: stored blocks can
// predate the import requirements (for example a missing `version`).
export const RELEASE_REQUIRED_BLOCK_KEYS = Object.freeze(['name', 'content'])
// The fields a release copies from the revision onto the library block; it
// deletes the ones the revision lacks (functions/cmsBlockReleases.js). Mirrors
// BLOCK_REVISION_DEFINITION_FIELDS in cmsBlockRevisions.js.
export const RELEASE_DEFINITION_FIELDS = Object.freeze(['content', 'template', 'templateVersion', 'schema', 'dataSources', 'isOverrideBlock', 'meta', 'values'])
// Distinct instance value sets rendered per release. Past this the remaining
// instances are reported as unchecked.
export const MAX_INSTANCE_RENDERS = 500
// Findings kept per list in stored summaries, to keep documents small.
export const MAX_LISTED_FINDINGS = 50

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

const THEME_NAME_CODES = new Set(['theme.color-name', 'theme.font-name', 'theme.radius-name'])
// Shared by release checks and saved-block editor advice.
export const contextualBlockThemeWarnings = ({ doc, originalWarnings, themeContexts, themeNameFindings, templateClassStrings, sectionTypeRoleFindings = null }) => {
  const contextual = Array.isArray(themeContexts) && themeContexts.length > 0
    && typeof themeNameFindings === 'function' && typeof templateClassStrings === 'function'
  const warnings = originalWarnings.filter(issue => !contextual || !THEME_NAME_CODES.has(issue.code))
  if (contextual) {
    const classes = templateClassStrings(doc.template || doc.content || '')
    for (const context of themeContexts) {
      const findings = themeNameFindings(classes, themeTokens(context.theme)).filter(issue => THEME_NAME_CODES.has(issue.code))
      for (const finding of findings) {
        const message = context.theme
          ? `${context.siteName} · ${context.phase} · Theme “${context.themeName}”: ${finding.message.replace('outside the standard theme names', 'not defined in this theme or the standard names')}`
          : `${context.siteName} · ${context.phase} · Theme “${context.themeName}” is unavailable; cannot verify custom names. ${finding.message}`
        for (const targetPath of context.paths)
          warnings.push({ code: finding.code, path: 'template', targetPath, siteId: context.siteId, themeId: context.themeId, themeName: context.themeName, context: context.phase, message })
      }
    }
  }
  // Type roles come from each destination's theme; themes without them add
  // nothing.
  if (Array.isArray(themeContexts) && typeof sectionTypeRoleFindings === 'function') {
    const template = doc.template || doc.content || ''
    for (const context of themeContexts) {
      for (const finding of sectionTypeRoleFindings(template, context.typeRoles)) {
        const message = `${context.siteName} · ${context.phase} · Theme “${context.themeName}”: ${finding.message}`
        for (const targetPath of context.paths)
          warnings.push({ code: finding.code, path: 'template', targetPath, siteId: context.siteId, themeId: context.themeId, themeName: context.themeName, context: context.phase, message })
      }
    }
  }
  return warnings
}
const parseTheme = (value) => {
  if (isObject(value))
    return value
  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

// Themes themselves have no draft/published split. The selected theme comes
// from draft site settings or published-site-settings, matching each target.
export const buildReleaseThemeContexts = ({ targets, sites = {}, publishedSites = {}, themes = {}, blockThemes = [] }) => {
  const contexts = new Map()
  const add = (siteId, phase, themeId, path) => {
    const key = JSON.stringify([siteId, phase, themeId])
    const context = contexts.get(key) || {
      siteId, phase, themeId,
      siteName: siteId === 'templates' ? 'Templates (library)' : sites[siteId]?.name || siteId || 'Block library',
      themeName: themes[themeId]?.name || themeId || '(no theme selected)',
      theme: parseTheme(themes[themeId]?.theme),
      typeRoles: isObject(themes[themeId]?.typeRoles) ? themes[themeId].typeRoles : null,
      paths: [],
    }
    if (!context.paths.includes(path))
      context.paths.push(path)
    contexts.set(key, context)
  }
  for (const target of targets) {
    if (target.siteId === 'templates') {
      if (blockThemes.length)
        for (const themeId of blockThemes) add('templates', 'template', themeId, target.path)
      continue
    }
    const published = ['published', 'published_posts'].includes(target.collection)
    const settings = (published ? publishedSites : sites)[target.siteId]
    add(target.siteId, published ? 'published' : 'draft', String(settings?.theme || '').trim(), target.path)
  }
  if (!targets.length)
    for (const themeId of blockThemes) add('', 'library', themeId, 'template')
  return [...contexts.values()]
}

const themeTokens = theme => Object.fromEntries(['colors', 'fontFamily', 'borderRadius'].map(group => [
  group, Object.keys({ ...(theme?.[group] || {}), ...(theme?.extend?.[group] || {}) }),
]))

const canonicalJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

const hasValue = value => !(value === undefined || value === null || value === ''
  || (Array.isArray(value) && !value.length)
  || (isObject(value) && !Object.keys(value).length))

// Differences between two schemas, including array item schemas (`field[].x`).
// Removing a field or changing its type is breaking; adding one is not.
export const compareSchemas = (beforeSchema, afterSchema, prefix = '') => {
  const before = isObject(beforeSchema) ? beforeSchema : {}
  const after = isObject(afterSchema) ? afterSchema : {}
  const changes = []
  for (const [field, input] of Object.entries(before)) {
    const path = `${prefix}${field}`
    if (!owns(after, field)) {
      changes.push({ path, field, change: 'removed', breaking: true })
      continue
    }
    const fromType = String(input?.type || '')
    const toType = String(after[field]?.type || '')
    if (fromType !== toType) {
      changes.push({ path, field, change: 'type-changed', from: fromType, to: toType, breaking: true })
      continue
    }
    if (fromType === 'array')
      changes.push(...compareSchemas(input?.schema, after[field]?.schema, `${path}[].`))
  }
  for (const [field, input] of Object.entries(after)) {
    if (!owns(before, field))
      changes.push({ path: `${prefix}${field}`, field, change: 'added', hasDefault: owns(input, 'value'), breaking: false })
  }
  return changes
}

// Every instance of the block in the planned documents.
export const collectInstances = (targets, blockId) => {
  const instances = []
  for (const target of targets) {
    const data = target.data || {}
    for (const listName of ['content', 'postContent']) {
      for (const block of Array.isArray(data[listName]) ? data[listName] : []) {
        if (block?.blockId === blockId)
          instances.push({ path: target.path, siteId: target.siteId, instanceId: String(block.id || ''), values: isObject(block.values) ? block.values : {} })
      }
    }
  }
  return instances
}

// Instances that hold a value in a top-level field a breaking change affects.
const instancesUsing = (instances, change) => {
  const topField = change.path.split('[]')[0].replace(/\.$/, '')
  return instances
    .filter(instance => hasValue(instance.values[topField]))
    .map(({ path, instanceId }) => ({ path, instanceId }))
}

const findingsOf = result => [...(result?.errors || []), ...(result?.warnings || [])]
  .map(({ code, severity, path, message }) => ({ code, severity, path, message }))

export const runReleaseChecks = async ({
  blockId,
  blockDoc,
  definition,
  beforeDefinition,
  targets,
  validateBlock,
  validateBlockRender,
  renderTemplate,
  knownThemeIds = null,
  themeContexts = null,
  themeNameFindings = null,
  templateClassStrings = null,
  sectionTypeRoleFindings = null,
  maxInstanceRenders = MAX_INSTANCE_RENDERS,
}) => {
  // Check what the release will store: the revision's definition replaces
  // every definition field, so none comes from the released block.
  const released = isObject(blockDoc) ? blockDoc : {}
  const nextDefinition = isObject(definition) ? definition : {}
  const doc = {
    ...Object.fromEntries(Object.entries(released).filter(([key]) => !RELEASE_DEFINITION_FIELDS.includes(key))),
    ...nextDefinition,
  }
  // Override blocks are CMS placeholders for renderer-owned Vue components.
  // Only the definition being released decides this, not the current library
  // flag: disabling the override must restore all normal content checks.
  if (doc.isOverrideBlock === true) {
    return {
      status: 'passed',
      contentChecksSkipped: 'override',
      errors: [],
      warnings: [],
      instanceFailures: [],
      schemaChanges: [],
      breaking: [],
      counts: {
        instances: collectInstances(targets, blockId).length,
        rendered: 0, unchecked: 0, instanceFailures: 0,
        errors: 0, warnings: 0, breaking: 0,
      },
    }
  }
  const removedFields = RELEASE_DEFINITION_FIELDS.filter(key => released[key] !== undefined && nextDefinition[key] === undefined)
  const validation = await validateBlock(doc, {
    requiredKeys: RELEASE_REQUIRED_BLOCK_KEYS,
    knownThemeIds,
    renderTemplate,
  })

  const instances = collectInstances(targets, blockId)
  const renderGroups = new Map()
  for (const instance of instances) {
    const key = canonicalJson(instance.values)
    if (!renderGroups.has(key))
      renderGroups.set(key, [])
    renderGroups.get(key).push(instance)
  }

  const instanceFailures = []
  let rendered = 0
  let unchecked = 0
  for (const group of renderGroups.values()) {
    if (rendered >= maxInstanceRenders) {
      unchecked += group.length
      continue
    }
    rendered += 1
    const result = await validateBlockRender(doc, { renderTemplate, values: group[0].values })
    if (result.errors.length) {
      for (const instance of group)
        instanceFailures.push({ path: instance.path, instanceId: instance.instanceId, findings: findingsOf({ errors: result.errors }) })
    }
  }

  const schemaChanges = compareSchemas(beforeDefinition?.schema, definition?.schema)
  const breaking = schemaChanges
    .filter(change => change.breaking)
    .map(change => ({ ...change, instances: instancesUsing(instances, change) }))

  const errors = validation.errors.map(({ code, path, message }) => ({ code, path, message }))
  const warnings = contextualBlockThemeWarnings({
    doc, originalWarnings: validation.warnings.map(({ code, path, message }) => ({ code, path, message })),
    themeContexts, themeNameFindings, templateClassStrings, sectionTypeRoleFindings,
  })
  // A release deletes the fields the revision lacks. Content, library values
  // and a Template v2 template must never go; anything else is flagged.
  const isTemplateV2 = Number(doc.templateVersion) === 2
  for (const key of removedFields) {
    const required = key === 'content' || key === 'values' || (key === 'template' && isTemplateV2)
    const finding = {
      code: 'release.field-removed',
      path: key,
      message: required
        ? `This revision has no "${key}"; releasing it would remove the block's ${key}. Save the draft again (saves now keep fields they leave out).`
        : `Releasing this revision removes the block's "${key}".`,
    }
    ;(required ? errors : warnings).push(finding)
  }
  if (unchecked) {
    warnings.push({
      code: 'release.instances-unchecked',
      path: 'template',
      message: `${unchecked} instance(s) were not rendered: only ${maxInstanceRenders} distinct value sets are checked per release.`,
    })
  }

  let status = 'passed'
  if (errors.length || instanceFailures.length)
    status = 'blocked'
  else if (breaking.length)
    status = 'breaking'
  else if (warnings.length)
    status = 'warnings'

  return {
    status,
    errors,
    warnings,
    instanceFailures,
    schemaChanges,
    breaking,
    counts: {
      instances: instances.length,
      rendered,
      unchecked,
      instanceFailures: instanceFailures.length,
      errors: errors.length,
      warnings: warnings.length,
      breaking: breaking.length,
    },
  }
}

// A copy small enough to store on the release and the revision.
export const summarizeReleaseChecks = (checks) => {
  const cap = list => (Array.isArray(list) ? list.slice(0, MAX_LISTED_FINDINGS) : [])
  return {
    status: checks.status,
    ...(checks.contentChecksSkipped ? { contentChecksSkipped: checks.contentChecksSkipped } : {}),
    counts: checks.counts,
    detailsTruncated: ['errors', 'warnings', 'instanceFailures', 'breaking', 'schemaChanges'].some(key => (checks[key]?.length || 0) > MAX_LISTED_FINDINGS)
      || (checks.breaking || []).some(change => (change.instances?.length || 0) > MAX_LISTED_FINDINGS),
    errors: cap(checks.errors),
    warnings: cap(checks.warnings),
    instanceFailures: cap(checks.instanceFailures),
    breaking: cap(checks.breaking).map(change => ({ ...change, instances: cap(change.instances) })),
    schemaChanges: cap(checks.schemaChanges),
  }
}
