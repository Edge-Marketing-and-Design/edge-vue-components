// CMS operations: validated, draft-only server writes for building sites
// (first-release plan, phase 3). Every operation follows the release
// pattern:
// - cms-checkOperation plans it and returns what would change, any problems
//   and a checksum of everything the plan read;
// - cms-runOperation plans it again inside a transaction and writes only if
//   the checksum still matches, so nothing that changed in between is
//   overwritten.
// Operations never write published pages, releases or themes that live sites
// use. Every run is recorded in organizations/{orgId}/cmsOperations.
// Keep identical to edge/functions/cmsOperations.js.
const { createHash, randomUUID } = require('node:crypto')
const {
  logger,
  db,
  onCall,
  HttpsError,
  permissionCheck,
} = require('./config.js')
const { saveDraft } = require('./cmsBlockRevisions.js')
const { stableStringify } = require('./helpers/historyFilter')

const corePromise = import('./helpers/cmsOperations.mjs')
const revisionsCorePromise = import('./helpers/cmsBlockRevisions.mjs')
const validationPromise = import('./helpers/cmsBlockValidation.mjs')
const loadImportCheck = () => Promise.all([
  import('./helpers/cmsBlockImport.mjs'),
  import('@edgedev/template-engine'),
])

const DOC_ID_PATTERN = /^[^/]{1,1500}$/
const PERMISSION_TARGETS = { theme: 'themes', page: 'sites', block: 'blocks', site: 'sites' }
const MAX_VALUE_BYTES = 200000

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const requireDocId = (value, label) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !DOC_ID_PATTERN.test(id) || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

const optionalDocId = (value, label) => ((value === undefined || value === null || value === '') ? null : requireDocId(value, label))

const orgRefOf = orgId => db.collection('organizations').doc(orgId)

// Reads through the transaction when there is one, and remembers what it
// read, for the checksum.
const createReader = (transaction) => {
  const reads = []
  const record = (path, exists, data) => reads.push({ path, exists, data: exists ? stableStringify(data || {}) : null })
  return {
    reads,
    async doc(ref) {
      const snap = transaction ? await transaction.get(ref) : await ref.get()
      record(ref.path, snap.exists, snap.exists ? snap.data() : null)
      return snap
    },
    async query(query, label) {
      const snap = transaction ? await transaction.get(query) : await query.get()
      record(label, !snap.empty, snap.docs.map(doc => doc.id).sort())
      return snap
    },
  }
}

const checksumOf = (operation, reads) => createHash('sha256')
  .update(stableStringify({ operation, reads: [...reads].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) }))
  .digest('hex')

// A plan: `problems` stop the run; `writes` are applied in order; `summary`
// and `changes` describe them for the caller.
const createPlan = () => ({ problems: [], writes: [], changes: [], summary: [], result: {} })
const addWrite = (plan, ref, data, mode, description) => {
  plan.writes.push({ ref, data, mode })
  plan.changes.push({ path: ref.path, action: mode === 'set' ? 'create' : 'update' })
  if (description)
    plan.summary.push(description)
}

const stamp = (uid, now) => ({ last_updated: now, uid })

// ---- Themes ----

// A theme is live when a published site uses it: every theme write is copied
// to the public renderer and bumps those sites (onThemeWritten). A site
// counts as published when its published-site-settings name the theme, or
// when a site using the theme has published pages or published settings
// (settings only carry the theme once the site was published from the Hub).
const liveSitesForTheme = async (reader, orgId, themeId) => {
  const org = orgRefOf(orgId)
  const live = new Set()
  const settings = await reader.query(org.collection('published-site-settings').where('theme', '==', themeId), `organizations/${orgId}/published-site-settings?theme=${themeId}`)
  for (const doc of settings.docs)
    live.add(doc.id)
  const sites = await reader.query(org.collection('sites').where('theme', '==', themeId), `organizations/${orgId}/sites?theme=${themeId}`)
  for (const site of sites.docs) {
    if (live.has(site.id))
      continue
    const published = await reader.query(site.ref.collection('published').limit(1), `${site.ref.path}/published?limit=1`)
    const siteSettings = await reader.doc(org.collection('published-site-settings').doc(site.id))
    if (!published.empty || siteSettings.exists)
      live.add(site.id)
  }
  return [...live].sort()
}

// ---- Standard theme names (docs/data-contracts/cms-themes/README.md) ----

const parseThemeJson = (value) => {
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

const isStandardTheme = (validation, themeDoc) => {
  const theme = parseThemeJson(themeDoc?.theme)
  return !!theme && !validation.themeTokenProblems(theme).length
}

// A block whose themes all use the standard names must use them too. Blocks
// for older themes only get notices, so those sites keep working.
const blockTargetsStandardThemes = (validation, blockThemes, themeDocs) => {
  const ids = Array.isArray(blockThemes) ? blockThemes : []
  return ids.length > 0 && ids.every(id => themeDocs[id] && isStandardTheme(validation, themeDocs[id]))
}

const addThemeNameFindings = (plan, findings, strict) => {
  const messages = findings.map(issue => `${issue.code}: ${issue.message}`)
  if (strict)
    plan.problems.push(...messages)
  else if (messages.length)
    plan.notices = [...(plan.notices || []), ...messages]
}

const planTheme = async (core, reader, { orgId, uid, now, operation }) => {
  const plan = createPlan()
  const validation = await validationPromise
  const fields = isPlainObject(operation.fields) ? operation.fields : {}
  const themes = orgRefOf(orgId).collection('themes')

  if (operation.type === 'theme.create') {
    const themeId = optionalDocId(operation.themeId, 'theme id')
    const ref = themeId ? themes.doc(themeId) : themes.doc()
    if (themeId && (await reader.doc(ref)).exists)
      plan.problems.push(`Theme "${themeId}" already exists.`)
    plan.problems.push(...core.themeFieldProblems(fields))
    // New themes must use the standard names.
    const parsedTheme = typeof fields.theme === 'string' ? parseThemeJson(fields.theme) : null
    if (parsedTheme)
      addThemeNameFindings(plan, validation.themeTokenProblems(parsedTheme), true)
    if (typeof fields.name !== 'string' || !fields.name.trim())
      plan.problems.push('A theme needs a name.')
    if (fields.theme === undefined)
      plan.problems.push('A theme needs its Theme JSON (`theme`).')
    const doc = {
      docId: ref.id,
      name: '',
      headJSON: '{}',
      extraCSS: '',
      version: 1,
      defaultPages: [],
      defaultMenus: { 'Site Root': [], 'Not In Menu': [] },
      ...fields,
      doc_created_at: now,
      ...stamp(uid, now),
    }
    addWrite(plan, ref, doc, 'set', `Create theme "${fields.name || ref.id}" (${ref.id}).`)
    plan.result = { themeId: ref.id }
    return plan
  }

  const themeId = requireDocId(operation.themeId, 'theme id')
  const ref = themes.doc(themeId)
  const snap = await reader.doc(ref)
  if (!snap.exists) {
    plan.problems.push(`Theme "${themeId}" does not exist.`)
    return plan
  }
  plan.problems.push(...core.themeFieldProblems(fields))
  if (!Object.keys(fields).length)
    plan.problems.push('No theme fields to change.')
  // A standard theme must stay standard; an older theme gets notices.
  const parsedTheme = typeof fields.theme === 'string' ? parseThemeJson(fields.theme) : null
  if (parsedTheme)
    addThemeNameFindings(plan, validation.themeTokenProblems(parsedTheme), isStandardTheme(validation, snap.data()))

  if (operation.type === 'theme.update') {
    const live = await liveSitesForTheme(reader, orgId, themeId)
    if (live.length)
      plan.problems.push(`Theme "${themeId}" is used by ${live.length} published site(s) (${live.join(', ')}); edits would go live at once. Use theme.propose.`)
    addWrite(plan, ref, { ...fields, ...stamp(uid, now) }, 'update', `Update theme ${themeId}: ${Object.keys(fields).join(', ')}.`)
    plan.result = { themeId }
    return plan
  }

  // theme.propose: record the change for a developer; the theme is untouched.
  const proposal = orgRefOf(orgId).collection('themeProposals').doc()
  addWrite(plan, proposal, {
    docId: proposal.id,
    themeId,
    fields,
    note: typeof operation.note === 'string' ? operation.note.slice(0, 2000) : '',
    status: 'open',
    createdBy: uid,
    createdAt: new Date(now).toISOString(),
    doc_created_at: now,
    ...stamp(uid, now),
  }, 'set', `Propose a change to theme ${themeId}: ${Object.keys(fields).join(', ')}. The theme is not changed.`)
  plan.result = { themeId, proposalId: proposal.id }
  return plan
}

// ---- Pages ----

const loadSiteAndPage = async (reader, plan, { orgId, siteId, pageId }) => {
  const siteRef = orgRefOf(orgId).collection('sites').doc(siteId)
  const siteSnap = await reader.doc(siteRef)
  if (!siteSnap.exists) {
    plan.problems.push(`Site "${siteId}" does not exist.`)
    return {}
  }
  if (!pageId)
    return { siteRef, site: siteSnap.data() || {} }
  const pageRef = siteRef.collection('pages').doc(pageId)
  const pageSnap = await reader.doc(pageRef)
  if (!pageSnap.exists) {
    plan.problems.push(`Draft page "${pageId}" does not exist on site "${siteId}".`)
    return { siteRef, site: siteSnap.data() || {} }
  }
  return { siteRef, site: siteSnap.data() || {}, pageRef, page: pageSnap.data() || {} }
}

const areaKeys = area => (area === 'post' ? ['postContent', 'postStructure'] : ['content', 'structure'])

const findInstance = (page, instanceId) => {
  for (const key of ['content', 'postContent']) {
    const list = Array.isArray(page?.[key]) ? page[key] : []
    const index = list.findIndex(block => block?.id === instanceId)
    if (index >= 0)
      return { key, index, instance: list[index] }
  }
  return null
}

const valuesTooLarge = values => Buffer.byteLength(JSON.stringify(values || {})) > MAX_VALUE_BYTES

const planPage = async (core, reader, { orgId, uid, now, operation }) => {
  const plan = createPlan()
  const siteId = requireDocId(operation.siteId, 'site id')

  if (operation.type === 'page.create') {
    if (siteId === 'templates')
      plan.problems.push('Pages on the templates site are created in the Hub.')
    const { siteRef, site } = await loadSiteAndPage(reader, plan, { orgId, siteId })
    if (!siteRef)
      return plan
    const menuName = operation.menu || 'Site Root'
    if (!core.ROOT_MENUS.includes(menuName))
      plan.problems.push(`menu must be one of: ${core.ROOT_MENUS.join(', ')}.`)
    const title = typeof operation.name === 'string' ? operation.name.trim() : ''
    if (!title)
      plan.problems.push('A page needs a name.')
    const menus = core.withRootMenus(site.menus)
    const slug = core.uniqueRootSlug(menus, title)
    const pageId = randomUUID()
    const pageRef = siteRef.collection('pages').doc(pageId)
    addWrite(plan, pageRef, { ...core.blankPagePayload(slug, now), docId: pageId, uid }, 'set', `Create draft page "${title}" at /${slug} on ${siteId}.`)
    if (core.ROOT_MENUS.includes(menuName))
      menus[menuName].push({ name: slug, menuTitle: title, item: pageId })
    addWrite(plan, siteRef, { menus, ...stamp(uid, now) }, 'update', `Add it to the "${menuName}" menu.`)
    plan.result = { siteId, pageId, slug }
    return plan
  }

  const pageId = requireDocId(operation.pageId, 'page id')
  const { pageRef, page } = await loadSiteAndPage(reader, plan, { orgId, siteId, pageId })
  if (!pageRef)
    return plan
  const next = JSON.parse(JSON.stringify(page))
  plan.result = { siteId, pageId }

  if (operation.type === 'page.update') {
    const fields = isPlainObject(operation.fields) ? operation.fields : {}
    const update = {}
    for (const [key, value] of Object.entries(fields)) {
      if (!core.PAGE_UPDATE_FIELDS.includes(key))
        plan.problems.push(`"${key}" can't be set by page.update (allowed: ${core.PAGE_UPDATE_FIELDS.join(', ')}).`)
      else if (typeof value !== 'string')
        plan.problems.push(`${key} must be a string.`)
      else
        update[key] = value
    }
    if (!Object.keys(fields).length)
      plan.problems.push('No page fields to change.')
    addWrite(plan, pageRef, { ...update, version: core.getNextVersion(page.version), ...stamp(uid, now) }, 'update', `Update draft page ${pageId}: ${Object.keys(update).join(', ')}.`)
    return plan
  }

  if (operation.type === 'page.placeBlock') {
    const blockId = requireDocId(operation.blockId, 'block id')
    const blockSnap = await reader.doc(orgRefOf(orgId).collection('blocks').doc(blockId))
    if (!blockSnap.exists) {
      plan.problems.push(`Library block "${blockId}" does not exist.`)
      return plan
    }
    const block = blockSnap.data() || {}
    if (block.synced)
      plan.problems.push(`"${block.name || blockId}" is a synced block; place synced blocks in the Hub.`)
    const [contentKey, structureKey] = areaKeys(operation.area)
    const taken = core.pageIds(next)
    const instance = core.buildInstanceFromLibraryBlock(block, { id: core.generateShortId(taken), blockId })
    if (operation.values !== undefined) {
      if (Number(instance.templateVersion) !== 2)
        plan.problems.push('Values can only be set on Template v2 blocks.')
      else if (!isPlainObject(operation.values) || valuesTooLarge(operation.values))
        plan.problems.push('values must be an object under 200 KB.')
      else
        instance.values = JSON.parse(JSON.stringify(operation.values))
    }
    if (Number(instance.templateVersion) === 2)
      plan.problems.push(...core.validateInstanceValues(instance.schema, instance.values))
    const rows = Array.isArray(next[structureKey]) ? next[structureKey] : []
    const index = Number.isInteger(operation.index) ? Math.min(Math.max(operation.index, 0), rows.length) : rows.length
    const row = core.createFullWidthRow({ rowId: core.generateShortId(taken), columnId: core.generateShortId(taken), instanceIds: [instance.id] })
    next[contentKey] = [...(Array.isArray(next[contentKey]) ? next[contentKey] : []), instance]
    next[structureKey] = [...rows.slice(0, index), row, ...rows.slice(index)]
    addWrite(plan, pageRef, {
      [contentKey]: next[contentKey],
      [structureKey]: next[structureKey],
      blockIds: core.derivePageBlockIds(next),
      version: core.getNextVersion(page.version),
      ...stamp(uid, now),
    }, 'update', `Place "${block.name || blockId}" on draft page ${pageId} as row ${index + 1}.`)
    plan.result = { siteId, pageId, instanceId: instance.id, rowId: row.id }
    return plan
  }

  const instanceId = requireDocId(operation.instanceId, 'instance id')
  const found = findInstance(next, instanceId)
  if (!found) {
    plan.problems.push(`Draft page ${pageId} has no block instance "${instanceId}".`)
    return plan
  }

  if (operation.type === 'page.setValues') {
    const { instance, key, index } = found
    if (Number(instance.templateVersion) !== 2)
      plan.problems.push('Values can only be set on Template v2 blocks.')
    if (instance.synced)
      plan.problems.push('This is a synced block; edit its values in the Hub.')
    if (!isPlainObject(operation.values) || valuesTooLarge(operation.values)) {
      plan.problems.push('values must be an object under 200 KB.')
      return plan
    }
    const values = operation.replace === true
      ? JSON.parse(JSON.stringify(operation.values))
      : { ...(isPlainObject(instance.values) ? instance.values : {}), ...JSON.parse(JSON.stringify(operation.values)) }
    plan.problems.push(...core.validateInstanceValues(instance.schema, values))
    next[key][index] = { ...instance, values, blockUpdatedAt: new Date(now).toISOString() }
    addWrite(plan, pageRef, { [key]: next[key], version: core.getNextVersion(page.version), ...stamp(uid, now) }, 'update', `Set ${Object.keys(operation.values).join(', ')} on "${instance.name || instance.blockId}" (${instanceId}) on draft page ${pageId}.`)
    plan.result = { siteId, pageId, instanceId }
    return plan
  }

  // page.removeBlock: the instance, its column reference, and rows left empty.
  const { key, index, instance } = found
  next[key].splice(index, 1)
  const structureKey = key === 'postContent' ? 'postStructure' : 'structure'
  next[structureKey] = (Array.isArray(next[structureKey]) ? next[structureKey] : [])
    .map(row => ({ ...row, columns: (row.columns || []).map(column => ({ ...column, blocks: (column.blocks || []).filter(id => id !== instanceId) })) }))
    .filter(row => (row.columns || []).some(column => column.blocks.length))
  addWrite(plan, pageRef, {
    [key]: next[key],
    [structureKey]: next[structureKey],
    blockIds: core.derivePageBlockIds(next),
    version: core.getNextVersion(page.version),
    ...stamp(uid, now),
  }, 'update', `Remove "${instance.name || instance.blockId}" (${instanceId}) from draft page ${pageId}.`)
  return plan
}

// ---- Blocks ----

const planBlock = async (core, reader, { orgId, uid, now, operation }) => {
  const plan = createPlan()
  const blocks = orgRefOf(orgId).collection('blocks')

  if (operation.type === 'block.create') {
    const block = isPlainObject(operation.block) ? JSON.parse(JSON.stringify(operation.block)) : null
    if (!block) {
      plan.problems.push('block must be a block document.')
      return plan
    }
    const blockId = requireDocId(block.docId, 'block docId')
    const ref = blocks.doc(blockId)
    if ((await reader.doc(ref)).exists)
      plan.problems.push(`Block "${blockId}" already exists. Use block.draft to change it.`)
    const themes = await reader.query(orgRefOf(orgId).collection('themes'), `organizations/${orgId}/themes`)
    const [{ checkImportedBlock }, engine] = await loadImportCheck()
    const findings = await checkImportedBlock(block, { knownThemeIds: themes.docs.map(doc => doc.id), renderTemplate: engine.renderTemplateAsync })
    if (findings.hardError)
      plan.problems.push(findings.hardError)
    plan.problems.push(...findings.blocking.map(issue => `${issue.code}: ${issue.message}`))
    const isThemeName = issue => String(issue.code || '').startsWith('theme.')
    plan.notices = findings.notices.filter(issue => !isThemeName(issue)).map(issue => `${issue.code}: ${issue.message}`)
    const validation = await validationPromise
    const themeDocs = Object.fromEntries(themes.docs.map(doc => [doc.id, doc.data()]))
    addThemeNameFindings(plan, findings.notices.filter(isThemeName), blockTargetsStandardThemes(validation, (findings.doc || block).themes, themeDocs))
    const doc = { ...JSON.parse(JSON.stringify(core.NEW_BLOCK_DEFAULTS)), ...(findings.doc || block), docId: blockId, doc_created_at: now, ...stamp(uid, now) }
    addWrite(plan, ref, doc, 'set', `Create library block "${doc.name || blockId}" (${blockId}). Nothing uses it yet.`)
    plan.result = { blockId }
    return plan
  }

  // block.draft: checked here; written by the shared draft save (base check,
  // kept replaced drafts), as source "agent".
  const blockId = requireDocId(operation.blockId, 'block id')
  const ref = blocks.doc(blockId)
  const snap = await reader.doc(ref)
  if (!snap.exists) {
    plan.problems.push(`Block "${blockId}" does not exist. Use block.create.`)
    return plan
  }
  if (!isPlainObject(operation.definition) || typeof operation.definition.content !== 'string')
    plan.problems.push('definition must be a block definition with string content.')
  if (typeof operation.baseHash !== 'string')
    plan.problems.push('baseHash is required: the fingerprint of the definition you started from.')
  const revisionsCore = await revisionsCorePromise
  const block = snap.data() || {}
  let current = block
  if (Number.isInteger(block.draftRevision)) {
    const draftSnap = await reader.doc(ref.collection('revisions').doc(String(block.draftRevision)))
    if (draftSnap.exists && draftSnap.data()?.status === 'draft')
      current = draftSnap.data().definition || block
  }
  if (typeof operation.baseHash === 'string' && operation.baseHash !== revisionsCore.blockDefinitionHash(current)) {
    plan.problems.push(`Block "${blockId}" changed since you loaded it (its ${current === block ? 'released definition' : `unreleased draft, revision ${block.draftRevision}`} is different). Load it again before drafting.`)
    plan.currentHash = revisionsCore.blockDefinitionHash(current)
  }
  if (isPlainObject(operation.definition) && typeof operation.definition.content === 'string') {
    const validation = await validationPromise
    const themes = await reader.query(orgRefOf(orgId).collection('themes'), `organizations/${orgId}/themes`)
    const themeDocs = Object.fromEntries(themes.docs.map(doc => [doc.id, doc.data()]))
    const blockThemes = Array.isArray(operation.definition.themes) ? operation.definition.themes : block.themes
    const findings = validation.themeNameFindings(validation.templateClassStrings(operation.definition.content))
    addThemeNameFindings(plan, findings, blockTargetsStandardThemes(validation, blockThemes, themeDocs))
  }
  if (isPlainObject(operation.definition)) {
    // Describe what the save will store: fields the request leaves out keep
    // the current definition's (saveDraft completes them the same way).
    const changed = revisionsCore.changedDefinitionFields(current, revisionsCore.completeBlockDefinition(operation.definition, current))
    plan.summary.push(changed.length ? `Save a draft of "${block.name || blockId}" changing ${changed.join(', ')}. No page changes until a developer releases it.` : `No definition changes for "${block.name || blockId}".`)
  }
  plan.changes.push({ path: ref.path, action: 'draft' })
  plan.draft = { blockId, ref }
  plan.result = { blockId }
  return plan
}

// ---- Sites ----

// site.create { name, theme, domains, settings? }: a new site as the Hub's
// new-site form makes it (site settings defaults, the creator as its only user unless
// they are an organization admin), seeded from the theme's default menus and
// site settings (site.vue seedNewSiteFromTheme). Nothing is published.
const planSite = async (core, reader, { orgId, uid, now, operation }) => {
  const plan = createPlan()
  const org = orgRefOf(orgId)
  const name = typeof operation.name === 'string' ? operation.name.trim() : ''
  if (!name)
    plan.problems.push('A site needs a name.')
  const themeId = optionalDocId(operation.theme, 'theme id')
  let themeDoc = null
  if (!themeId) {
    plan.problems.push('A site needs a theme.')
  }
  else {
    const themeSnap = await reader.doc(org.collection('themes').doc(themeId))
    if (themeSnap.exists)
      themeDoc = themeSnap.data() || {}
    else
      plan.problems.push(`Theme "${themeId}" does not exist.`)
  }
  // Like the Hub form: at least one domain, each 45 characters or fewer.
  // Domains reach the public renderer only when the site settings are
  // published.
  const domains = Array.isArray(operation.domains) ? operation.domains.map(domain => (typeof domain === 'string' ? domain.trim() : domain)) : []
  if (!domains.length || domains.some(domain => typeof domain !== 'string' || !domain))
    plan.problems.push('A site needs at least one domain (domains: ["example.com"]).')
  else if (domains.some(domain => domain.length > 45))
    plan.problems.push('Each domain must be 45 characters or fewer.')
  const settings = isPlainObject(operation.settings) ? operation.settings : {}
  const defaults = core.siteSettingsDefaults()
  const chosen = {}
  const kindOf = value => (Array.isArray(value) ? 'a list of strings' : typeof value === 'boolean' ? 'true or false' : 'a string')
  for (const [key, value] of Object.entries(settings)) {
    const kind = kindOf(defaults[key])
    const valid = kind === 'a list of strings'
      ? (Array.isArray(value) && value.every(item => typeof item === 'string'))
      : (kind === 'true or false' ? typeof value === 'boolean' : typeof value === 'string')
    if (!core.SITE_CREATE_FIELDS.includes(key))
      plan.problems.push(`"${key}" can't be set by site.create (allowed: ${core.SITE_CREATE_FIELDS.join(', ')}). Set it in the Hub's site settings.`)
    else if (!valid)
      plan.problems.push(`${key} must be ${kind}.`)
    else
      chosen[key] = value
  }
  if (chosen.allowedThemes?.length && themeId && !chosen.allowedThemes.includes(themeId))
    plan.problems.push('allowedThemes must include the site\'s theme.')

  const isAdmin = await permissionCheck(uid, 'assign', `organizations/${orgId}`)
  const siteRef = org.collection('sites').doc()
  // The Hub's new-site form has every default except members-only content.
  const { restrictedContent: _restrictedContent, ...formDefaults } = defaults
  const siteDoc = {
    ...formDefaults,
    ...chosen,
    name,
    theme: themeId || '',
    domains,
    users: isAdmin ? [] : [uid],
    docId: siteRef.id,
    doc_created_at: now,
    ...stamp(uid, now),
  }
  const pageWrites = []
  if (themeDoc) {
    const themeMenus = core.deriveThemeMenus(themeDoc)
    if (themeMenus) {
      const templates = await reader.query(org.collection('sites').doc('templates').collection('pages'), `organizations/${orgId}/sites/templates/pages`)
      const templatePages = Object.fromEntries(templates.docs.map(doc => [doc.id, doc.data() || {}]))
      const { menus, pages } = core.seedMenusFromTheme(themeMenus, templatePages, () => siteRef.collection('pages').doc().id, now)
      siteDoc.menus = menus
      pageWrites.push(...pages)
    }
    Object.assign(siteDoc, core.buildThemeSettingsPayload(themeDoc, siteDoc))
  }
  addWrite(plan, siteRef, siteDoc, 'set', `Create site "${name}" with theme ${themeId}. Nothing is published.`)
  for (const { pageId, payload } of pageWrites)
    addWrite(plan, siteRef.collection('pages').doc(pageId), { ...payload, docId: pageId, uid }, 'set', `Create draft page "${payload.name}" at /${payload.slug} from the theme's templates.`)
  const pageIds = pageWrites.map(page => page.pageId)
  plan.result = { siteId: siteRef.id, pageIds }
  return plan
}

// ---- Check and run ----

const OPERATION_AREA = type => String(type || '').split('.')[0]

const planOperation = async (reader, context) => {
  const core = await corePromise
  const area = OPERATION_AREA(context.operation.type)
  if (area === 'theme')
    return planTheme(core, reader, context)
  if (area === 'page')
    return planPage(core, reader, context)
  if (area === 'site')
    return planSite(core, reader, context)
  return planBlock(core, reader, context)
}

// Checks the organization, the operation type and the caller's write
// permission. `uid` is the signed-in user, or for an agent key the developer
// who created it.
const authorizeOperation = async ({ uid, orgId: rawOrgId, operation }) => {
  const orgId = requireDocId(rawOrgId, 'organization id')
  const core = await corePromise
  if (!isPlainObject(operation) || !core.CMS_OPERATION_TYPES.includes(operation.type))
    throw new HttpsError('invalid-argument', `operation.type must be one of: ${core.CMS_OPERATION_TYPES.join(', ')}.`)
  const target = PERMISSION_TARGETS[OPERATION_AREA(operation.type)]
  if (!await permissionCheck(uid, 'write', `organizations/${orgId}/${target}`))
    throw new HttpsError('permission-denied', `Not allowed to change ${target} in this organization.`)
  return { uid, orgId, operation }
}

const assertOperationCaller = async (request) => {
  const uid = request?.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  return authorizeOperation({ uid, orgId: request.data.orgId, operation: request.data.operation })
}

const describePlan = (plan, checksum) => ({
  summary: plan.summary,
  changes: plan.changes,
  problems: plan.problems,
  notices: plan.notices || [],
  blocked: plan.problems.length > 0,
  result: plan.result,
  ...(plan.currentHash ? { currentHash: plan.currentHash } : {}),
  checksum,
})

// Plans an authorized operation and writes nothing.
const performCheck = async ({ uid, orgId, operation }) => {
  const reader = createReader(null)
  const plan = await planOperation(reader, { orgId, uid, now: Date.now(), operation })
  return describePlan(plan, checksumOf(operation, reader.reads))
}

// Runs an authorized operation if its checksum still matches. `via` is
// "hub" or "agent"; agent runs also record the key.
const performRun = async ({ uid, orgId, operation, checksum, client = '', via = 'hub', agentKeyId = null }) => {
  if (typeof checksum !== 'string' || !checksum)
    throw new HttpsError('invalid-argument', 'checksum is required: run cms-checkOperation first.')
  const now = Date.now()
  const auditRef = orgRefOf(orgId).collection('cmsOperations').doc()
  const auditBase = {
    type: operation.type,
    checksum,
    runBy: uid,
    runAt: new Date(now).toISOString(),
    via,
    agentKeyId,
    client: String(client || '').slice(0, 100),
    status: 'applied',
  }

  const outcome = await db.runTransaction(async (transaction) => {
    const reader = createReader(transaction)
    const plan = await planOperation(reader, { orgId, uid, now, operation })
    if (checksumOf(operation, reader.reads) !== checksum)
      throw new HttpsError('failed-precondition', 'Something this operation depends on changed since it was checked. Check it again.')
    if (plan.problems.length)
      throw new HttpsError('failed-precondition', `The operation has problems: ${plan.problems.join(' ')}`)
    if (plan.draft)
      return { plan }
    for (const write of plan.writes) {
      if (write.mode === 'set')
        transaction.set(write.ref, write.data)
      else
        transaction.update(write.ref, write.data)
    }
    transaction.set(auditRef, { ...auditBase, operation, changes: plan.changes, result: plan.result })
    return { plan }
  })

  let result = outcome.plan.result
  if (outcome.plan.draft) {
    // The draft save is its own transaction with the same base check.
    const revisionsCore = await revisionsCorePromise
    const draft = await saveDraft(revisionsCore, {
      uid,
      blockId: outcome.plan.draft.blockId,
      blockRef: outcome.plan.draft.ref,
      data: { definition: operation.definition, source: via === 'agent' ? 'agent' : 'editor', baseHash: operation.baseHash, baseRevision: operation.baseRevision ?? null },
    })
    result = { ...result, ...draft }
    const { definition: _definition, ...recorded } = operation
    await auditRef.set({ ...auditBase, operation: recorded, changes: outcome.plan.changes, result })
  }
  logger.log(`CMS operation ${operation.type} run by ${uid} via ${via}`, { orgId, result, agentKeyId })
  return { operationId: auditRef.id, status: 'applied', result, summary: outcome.plan.summary }
}

exports.checkOperation = onCall({ timeoutSeconds: 120 }, async (request) => {
  const caller = await assertOperationCaller(request)
  return performCheck(caller)
})

exports.runOperation = onCall({ timeoutSeconds: 120 }, async (request) => {
  const caller = await assertOperationCaller(request)
  return performRun({ ...caller, checksum: request.data.checksum, client: request.data.client, via: 'hub' })
})

// ---- Site readiness (phase 6) ----

const READINESS_MAX_PAGES = 500
const READINESS_MAX_BLOCK_CHECKS = 100
const loadValidation = () => Promise.all([import('./helpers/cmsBlockValidation.mjs'), import('@edgedev/template-engine')])

// What stops a site from being finished: see buildSiteReadiness in
// helpers/cmsOperations.mjs. Reads only.
const gatherSiteReadiness = async ({ orgId, siteId }) => {
  const core = await corePromise
  const org = orgRefOf(orgId)
  const siteRef = org.collection('sites').doc(siteId)
  const siteSnap = await siteRef.get()
  if (!siteSnap.exists)
    throw new HttpsError('not-found', `Site "${siteId}" does not exist.`)
  const site = siteSnap.data() || {}
  const themeSnap = site.theme ? await org.collection('themes').doc(String(site.theme)).get() : null
  const pagesSnap = await siteRef.collection('pages').limit(READINESS_MAX_PAGES + 1).get()
  const publishedSnap = await siteRef.collection('published').limit(READINESS_MAX_PAGES + 1).get()
  const pages = Object.fromEntries(pagesSnap.docs.slice(0, READINESS_MAX_PAGES).map(doc => [doc.id, doc.data() || {}]))
  const published = Object.fromEntries(publishedSnap.docs.map(doc => [doc.id, doc.data() || {}]))

  const blockIds = new Set()
  for (const page of Object.values(pages)) {
    for (const instance of [...(page.content || []), ...(page.postContent || [])]) {
      if (instance?.blockId)
        blockIds.add(String(instance.blockId))
    }
  }
  const blocks = {}
  const drafts = {}
  await Promise.all([...blockIds].map(async (blockId) => {
    const snap = await org.collection('blocks').doc(blockId).get()
    if (!snap.exists)
      return
    const block = snap.data() || {}
    blocks[blockId] = block
    if (Number.isInteger(block.draftRevision))
      drafts[blockId] = block.draftRevision
  }))

  const [validation, engine] = await loadValidation()
  const themes = await org.collection('themes').get()
  const knownThemeIds = themes.docs.map(doc => doc.id)
  const blockChecks = {}
  const checked = Object.keys(blocks).sort().slice(0, READINESS_MAX_BLOCK_CHECKS)
  for (const blockId of checked)
    blockChecks[blockId] = await validation.validateBlock({ ...blocks[blockId] }, { knownThemeIds, renderTemplate: engine.renderTemplateAsync })

  const report = core.buildSiteReadiness({ site, theme: themeSnap?.exists ? themeSnap.data() : null, pages, published, blocks, drafts, blockChecks })
  return {
    siteId,
    ...report,
    pagesChecked: Object.keys(pages).length,
    blocksChecked: checked.length,
    truncated: pagesSnap.size > READINESS_MAX_PAGES || Object.keys(blocks).length > READINESS_MAX_BLOCK_CHECKS,
  }
}

// cms-siteReadiness { orgId, siteId }: for anyone who can read the sites.
exports.siteReadiness = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const uid = request?.auth?.uid
  if (!uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  const orgId = requireDocId(request.data.orgId, 'organization id')
  const siteId = requireDocId(request.data.siteId, 'site id')
  if (!await permissionCheck(uid, 'read', `organizations/${orgId}/sites`))
    throw new HttpsError('permission-denied', 'Not allowed to read sites in this organization.')
  return gatherSiteReadiness({ orgId, siteId })
})

// For the agent endpoint (cmsAgentKeys.js); cms.js doesn't re-export these.
exports.authorizeOperation = authorizeOperation
exports.performCheck = performCheck
exports.performRun = performRun
exports.gatherSiteReadiness = gatherSiteReadiness
