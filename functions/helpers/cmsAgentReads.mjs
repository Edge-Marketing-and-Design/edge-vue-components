// CMS library reads (blocks, themes, usage, audit) shared by the local MCP
// (edge/tools/mcp/cms/src/cms-tools.js, on a read-only service account) and
// the Hub's agent endpoint (cms-agentOperation and cms-agentMcp, as the
// operator). Callers check the organization and the reader's rights first;
// this module only reads, within the scan limits.
//
// Shared by edge/lib/cmsAgentReads.js, edge/functions/helpers/
// cmsAgentReads.mjs and functions/helpers/cmsAgentReads.mjs. Keep the three
// copies byte-identical; the MCP tests enforce it. The validator, the block
// fingerprint and the template engine are passed in, so it imports only Node.
import { createHash } from 'node:crypto'

export const DEFAULT_RESULT_LIMIT = 25
export const DEFAULT_SCAN_LIMIT = 1000
export const DEFAULT_PAGE_LIMIT = 500
export const DEFAULT_SITE_LIMIT = 100
export const DEFAULT_THEME_SCAN_LIMIT = 250
export const DEFAULT_THEME_FONT_LIMIT = 100
// Keys cms_validate requires; Hub import settings require more (the audit).
export const MCP_REQUIRED_BLOCK_KEYS = ['name', 'content']

// Firestore values as plain JSON: Timestamps as ISO strings, GeoPoints as
// { latitude, longitude }, references as { __type, path }. The local MCP
// passes its own sanitizer, which also redacts configured fields.
export function firestoreJson(value) {
  if (value === null || value === undefined)
    return value
  if (typeof value?.toDate === 'function' && typeof value?.toMillis === 'function')
    return value.toDate().toISOString()
  if (Array.isArray(value))
    return value.map(firestoreJson)
  if (typeof value === 'object') {
    if (value.constructor?.name === 'GeoPoint')
      return { latitude: value.latitude, longitude: value.longitude }
    if (value.constructor?.name === 'DocumentReference')
      return { __type: 'DocumentReference', path: value.path }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreJson(child)]))
  }
  return value
}

// A refusal with a code the Hub endpoint maps to an HTTP status.
const refusal = (code, message) => Object.assign(new Error(message), { code })

// limits: the MCP config's max* settings (maxCmsResultLimit,
// maxCmsBlockScanDocuments, ...); missing ones use the defaults above.
// validation: { validateBlock, commonTypeRoles, normalizeBlockTagList } from
// the shared block validator. loadRenderTemplate resolves the template engine
// or null (render checks are then skipped).
export function createCmsReads({ db, limits = {}, sanitizeValue = value => value, validation = {}, blockDefinitionHash = null, loadRenderTemplate = async () => null }) {
  const readBlock = async ({ orgId, docId: requestedDocId }) => {
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    const documentPath = `organizations/${orgId}/blocks/${docId}`
    const snapshot = await db.doc(documentPath).get()

    if (!snapshot.exists) {
      return {
        orgId,
        docId,
        documentPath,
        exists: false,
        data: null,
        hash: null,
        updateTime: null,
        createTime: null,
      }
    }

    const data = normalizeBlockDocument(sanitizeValue(snapshot.data()), docId)
    return {
      orgId,
      docId,
      documentPath,
      exists: true,
      data,
      hash: hashDocument(data),
      updateTime: timestampToIso(snapshot.updateTime),
      createTime: timestampToIso(snapshot.createTime),
    }
  }

  const readTheme = async ({ orgId, themeId: requestedThemeId }) => {
    const themeId = assertFirestoreSegment(requestedThemeId, 'themeId')
    const documentPath = `organizations/${orgId}/themes/${themeId}`
    const snapshot = await db.doc(documentPath).get()

    if (!snapshot.exists) {
      return {
        orgId,
        themeId,
        documentPath,
        exists: false,
        data: null,
        updateTime: null,
        createTime: null,
      }
    }

    return {
      orgId,
      themeId,
      documentPath,
      exists: true,
      data: normalizeThemeDocument(sanitizeValue(snapshot.data()), themeId),
      updateTime: timestampToIso(snapshot.updateTime),
      createTime: timestampToIso(snapshot.createTime),
    }
  }

  const findTheme = async ({ orgId, docId: requestedDocId = '', query = '', exactName = '', limit } = {}) => {
    const filters = normalizeThemeFilters({ query, exactName })
    const requestedLimit = boundedNumber(
      limit,
      limits.maxCmsThemeResultLimit || limits.maxCmsResultLimit || 100,
      DEFAULT_RESULT_LIMIT,
    )

    if (requestedDocId) {
      const theme = await readTheme({ orgId, themeId: requestedDocId })
      const matches = (theme.exists && themeMatchesFilters(theme.data, theme.themeId, filters))
        ? [summarizeProductionTheme(theme)]
        : []
      return {
        orgId,
        filters: { docId: requestedDocId, ...filters },
        scannedDocuments: theme.exists ? 1 : 0,
        scanTruncated: false,
        matchedDocuments: matches.length,
        returnedDocuments: matches.length,
        resultTruncated: false,
        matches,
      }
    }

    const scanLimit = boundedNumber(
      limits.maxCmsThemeScanDocuments,
      limits.maxCmsThemeScanDocuments || DEFAULT_THEME_SCAN_LIMIT,
      DEFAULT_THEME_SCAN_LIMIT,
    )
    const collectionPath = `organizations/${orgId}/themes`
    const snapshot = await db.collection(collectionPath).limit(scanLimit + 1).get()
    const scanTruncated = snapshot.size > scanLimit
    const matchingThemes = snapshot.docs.slice(0, scanLimit)
      .map((snapshotDoc) => {
        return {
          orgId,
          themeId: snapshotDoc.id,
          documentPath: snapshotDoc.ref?.path || `${collectionPath}/${snapshotDoc.id}`,
          exists: true,
          data: normalizeThemeDocument(sanitizeValue(snapshotDoc.data()), snapshotDoc.id),
          updateTime: timestampToIso(snapshotDoc.updateTime),
          createTime: timestampToIso(snapshotDoc.createTime),
        }
      })
      .filter(theme => themeMatchesFilters(theme.data, theme.themeId, filters))
      .map(summarizeProductionTheme)
    const matches = matchingThemes.slice(0, requestedLimit)

    return {
      orgId,
      filters,
      collectionPath,
      scannedDocuments: Math.min(snapshot.size, scanLimit),
      scanTruncated,
      matchedDocuments: matchingThemes.length,
      returnedDocuments: matches.length,
      resultTruncated: matchingThemes.length > matches.length,
      resultLimit: requestedLimit,
      matches,
    }
  }

  const getTheme = async ({ orgId, themeId: requestedThemeId, includeCustomFonts = true }) => {
    const production = await readTheme({ orgId, themeId: requestedThemeId })
    if (!production.exists)
      throw refusal('not-found', `Production CMS theme does not exist: ${production.documentPath}`)

    const themeJSON = parseStoredJsonField(production.data?.theme, 'theme')
    const headJSON = parseStoredJsonField(production.data?.headJSON, 'headJSON')
    const customFonts = includeCustomFonts
      ? await readThemeCustomFonts({
        db,
        orgId: production.orgId,
        themeId: production.themeId,
        headRaw: headJSON.raw,
        headDocument: headJSON.parsed,
        sanitizeValue,
        limit: limits.maxCmsThemeFontDocuments || DEFAULT_THEME_FONT_LIMIT,
      })
      : {
          included: false,
          collectionPath: `organizations/${production.orgId}/files`,
          queryField: 'meta.themeId',
          scannedDocuments: 0,
          scanTruncated: false,
          fontCount: 0,
          fonts: [],
        }

    return {
      orgId: production.orgId,
      themeId: production.themeId,
      documentPath: production.documentPath,
      name: String(production.data?.name || ''),
      version: production.data?.version ?? null,
      firestoreCreateTime: production.createTime,
      firestoreUpdateTime: production.updateTime,
      documentCreatedAt: production.data?.doc_created_at ?? null,
      documentLastUpdated: production.data?.last_updated ?? null,
      sourceFields: {
        themeJSON: 'theme',
        headJSON: 'headJSON',
        customFonts: 'files where meta.themeId matches and meta.cmsFont is true',
        extraCSS: 'extraCSS',
        defaultTemplates: ['defaultMenus', 'defaultPages', 'defaultSiteSettings'],
      },
      themeJSON,
      headJSON,
      customFonts,
      extraCSS: typeof production.data?.extraCSS === 'string' ? production.data.extraCSS : '',
      defaultTemplates: {
        defaultMenus: cloneJsonValue(production.data?.defaultMenus, {}),
        defaultPages: cloneJsonValue(production.data?.defaultPages, []),
        defaultSiteSettings: cloneJsonValue(production.data?.defaultSiteSettings, {}),
        referencedTemplatePageIds: collectDefaultTemplatePageIds(production.data),
      },
    }
  }

  const findBlock = async ({ orgId, docId: requestedDocId = '', query = '', exactName = '', tag = '', type = '', theme = '', limit, startAfter = '' } = {}) => {
    const requestedLimit = boundedNumber(limit, limits.maxCmsResultLimit || 100, DEFAULT_RESULT_LIMIT)
    const cursor = String(startAfter || '').trim()
    const filters = normalizeBlockFilters({ query, exactName, tag, type, theme })

    if (requestedDocId) {
      const block = await readBlock({ orgId, docId: requestedDocId })
      const matches = (block.exists && blockMatchesFilters(block.data, block.docId, filters))
        ? [summarizeProductionBlock(block)]
        : []
      return {
        orgId,
        filters: { docId: requestedDocId, ...filters },
        scannedDocuments: block.exists ? 1 : 0,
        scanTruncated: false,
        matchedDocuments: matches.length,
        returnedDocuments: matches.length,
        resultTruncated: false,
        matches,
      }
    }

    const scanLimit = boundedNumber(
      limits.maxCmsBlockScanDocuments,
      limits.maxCmsBlockScanDocuments || DEFAULT_SCAN_LIMIT,
      DEFAULT_SCAN_LIMIT,
    )
    const collectionPath = `organizations/${orgId}/blocks`
    const snapshot = await db.collection(collectionPath).limit(scanLimit + 1).get()
    const scanTruncated = snapshot.size > scanLimit
    // Firestore returns documents by id; sort explicitly so pages are stable.
    const scannedDocs = snapshot.docs.slice(0, scanLimit).sort((a, b) => compareDocIds(a.id, b.id))
    const matchingBlocks = []

    for (const snapshotDoc of scannedDocs) {
      const block = {
        orgId,
        docId: snapshotDoc.id,
        documentPath: snapshotDoc.ref?.path || `${collectionPath}/${snapshotDoc.id}`,
        exists: true,
        data: normalizeBlockDocument(sanitizeValue(snapshotDoc.data()), snapshotDoc.id),
        updateTime: timestampToIso(snapshotDoc.updateTime),
        createTime: timestampToIso(snapshotDoc.createTime),
      }
      block.hash = hashDocument(block.data)
      if (!blockMatchesFilters(block.data, block.docId, filters))
        continue
      matchingBlocks.push(summarizeProductionBlock(block))
    }
    const remaining = cursor
      ? matchingBlocks.filter(block => compareDocIds(block.docId, cursor) > 0)
      : matchingBlocks
    const matches = remaining.slice(0, requestedLimit)
    const resultTruncated = remaining.length > matches.length

    return {
      orgId,
      filters,
      collectionPath,
      scannedDocuments: scannedDocs.length,
      scanTruncated,
      matchedDocuments: matchingBlocks.length,
      startAfter: cursor,
      returnedDocuments: matches.length,
      resultTruncated,
      nextStartAfter: resultTruncated ? matches[matches.length - 1].docId : '',
      resultLimit: requestedLimit,
      matches,
    }
  }

  // A library block's current definition (its open draft, else the released
  // one) and the fingerprint block.draft must send as baseHash.
  const blockBase = async ({ orgId, docId: requestedDocId }) => {
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    const blockRef = db.collection('organizations').doc(orgId).collection('blocks').doc(docId)
    const blockSnap = await blockRef.get()
    if (!blockSnap.exists)
      return { ok: false, message: `Block "${docId}" does not exist in ${orgId}.` }
    const block = blockSnap.data() || {}
    let draft = null
    if (Number.isInteger(block.draftRevision)) {
      const draftSnap = await blockRef.collection('revisions').doc(String(block.draftRevision)).get()
      if (draftSnap.exists && draftSnap.data()?.status === 'draft')
        draft = draftSnap.data()
    }
    const definition = draft ? draft.definition : block
    return {
      ok: true,
      docId,
      releasedRevision: Number.isInteger(block.releasedRevision) ? block.releasedRevision : 0,
      draftRevision: draft ? block.draftRevision : null,
      startsFrom: draft ? 'draft' : 'released',
      baseHash: blockDefinitionHash(definition),
      definition: sanitizeValue(Object.fromEntries(['content', 'template', 'templateVersion', 'schema', 'dataSources', 'isOverrideBlock', 'meta', 'values'].filter(key => definition?.[key] !== undefined).map(key => [key, definition[key]]))),
    }
  }

  const findUsage = async ({ orgId, docId: requestedDocId, siteId: requestedSiteId = '', limit }) => {
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    const resultLimit = boundedNumber(limit, limits.maxCmsUsageResults || 500, 100)
    const maxSites = boundedNumber(
      limits.maxCmsSiteScanDocuments,
      limits.maxCmsSiteScanDocuments || DEFAULT_SITE_LIMIT,
      DEFAULT_SITE_LIMIT,
    )
    const maxPagesPerSite = boundedNumber(
      limits.maxCmsPageScanDocuments,
      limits.maxCmsPageScanDocuments || DEFAULT_PAGE_LIMIT,
      DEFAULT_PAGE_LIMIT,
    )
    // Posts per collection (each site's draft posts and published snapshots).
    const maxPostsPerSite = boundedNumber(
      limits.maxCmsPostScanDocuments,
      limits.maxCmsPostScanDocuments || DEFAULT_PAGE_LIMIT,
      DEFAULT_PAGE_LIMIT,
    )
    let siteIds = []
    let siteScanTruncated = false

    if (requestedSiteId) {
      siteIds = [assertFirestoreSegment(requestedSiteId, 'siteId')]
    }
    else {
      const sitesPath = `organizations/${orgId}/sites`
      const sitesSnapshot = await db.collection(sitesPath).limit(maxSites + 1).get()
      siteScanTruncated = sitesSnapshot.size > maxSites
      siteIds = sitesSnapshot.docs.slice(0, maxSites).map(siteDoc => siteDoc.id)
      if (!siteIds.includes('templates'))
        siteIds.push('templates')
    }

    const usages = []
    const scanned = []
    let resultTruncated = false

    for (const siteId of [...new Set(siteIds)]) {
      const pagesPath = `organizations/${orgId}/sites/${siteId}/pages`
      const pagesSnapshot = await db.collection(pagesPath).limit(maxPagesPerSite + 1).get()
      const pageScanTruncated = pagesSnapshot.size > maxPagesPerSite
      const pages = pagesSnapshot.docs.slice(0, maxPagesPerSite)
      scanned.push({
        siteId,
        collectionPath: pagesPath,
        scannedDocuments: pages.length,
        scanTruncated: pageScanTruncated,
      })

      for (const pageSnapshot of pages) {
        const pageData = sanitizeValue(pageSnapshot.data())
        const references = collectBlockReferences(pageData, docId)
        for (const reference of references) {
          usages.push({
            kind: 'page',
            siteId,
            pageId: pageSnapshot.id,
            pageName: firstNonEmptyString(pageData?.name, pageData?.title, pageData?.menuTitle),
            pageType: siteId === 'templates' ? 'template' : (pageData?.post ? 'post' : 'page'),
            ...reference,
          })
          if (usages.length >= resultLimit) {
            resultTruncated = true
            break
          }
        }
        if (resultTruncated)
          break
      }
      if (resultTruncated)
        break

      // Post bodies: drafts and the published snapshots the public site reads.
      for (const [collection, source] of [['posts', 'draft'], ['published_posts', 'published']]) {
        const postsPath = `organizations/${orgId}/sites/${siteId}/${collection}`
        const postsSnapshot = await db.collection(postsPath).limit(maxPostsPerSite + 1).get()
        const posts = postsSnapshot.docs.slice(0, maxPostsPerSite)
        scanned.push({
          siteId,
          collectionPath: postsPath,
          scannedDocuments: posts.length,
          scanTruncated: postsSnapshot.size > maxPostsPerSite,
        })
        for (const postSnapshot of posts) {
          const postData = sanitizeValue(postSnapshot.data())
          for (const reference of collectBlockReferences(postData, docId)) {
            usages.push({
              kind: 'post',
              siteId,
              postId: postSnapshot.id,
              source,
              title: firstNonEmptyString(postData?.title),
              slug: firstNonEmptyString(postData?.name),
              ...reference,
            })
            if (usages.length >= resultLimit) {
              resultTruncated = true
              break
            }
          }
          if (resultTruncated)
            break
        }
        if (resultTruncated)
          break
      }
      if (resultTruncated)
        break
    }

    return {
      orgId,
      docId,
      requestedSiteId: requestedSiteId || null,
      siteScanTruncated,
      resultTruncated,
      resultLimit,
      scanned,
      usageCount: usages.length,
      usages,
    }
  }

  // Validates every library block in an organization with the Hub's import
  // settings, reading it once. ownershipFor(block) returns the block's public
  // renderer resolution; without it, ownership is reported as "unchecked".
  // Returns every block's findings and the summary by rule.
  const auditBlocks = async ({ orgId, includeRender = true, ownershipFor = null } = {}) => {
    const { validateBlock, commonTypeRoles, normalizeBlockTagList } = validation
    const scanLimit = boundedNumber(
      limits.maxCmsBlockScanDocuments,
      limits.maxCmsBlockScanDocuments || DEFAULT_SCAN_LIMIT,
      DEFAULT_SCAN_LIMIT,
    )
    const themeScanLimit = boundedNumber(
      limits.maxCmsThemeScanDocuments,
      limits.maxCmsThemeScanDocuments || DEFAULT_THEME_SCAN_LIMIT,
      DEFAULT_THEME_SCAN_LIMIT,
    )
    const collectionPath = `organizations/${orgId}/blocks`
    const [blocksSnapshot, themesSnapshot, orgSnapshot] = await Promise.all([
      db.collection(collectionPath).limit(scanLimit + 1).get(),
      db.collection(`organizations/${orgId}/themes`).limit(themeScanLimit + 1).get(),
      db.doc(`organizations/${orgId}`).get(),
    ])
    const knownThemeIds = themesSnapshot.docs.slice(0, themeScanLimit).map(doc => doc.id)
    const themeDocs = Object.fromEntries(themesSnapshot.docs.slice(0, themeScanLimit).map(doc => [doc.id, doc.data()]))
    // The organization's block tag list; empty means unrestricted, so the tag
    // rules report nothing.
    const blockTagList = normalizeBlockTagList(orgSnapshot.exists ? orgSnapshot.data()?.cmsBlockTags : null)
    const renderTemplate = includeRender ? await loadRenderTemplate() : null
    const blockDocs = blocksSnapshot.docs.slice(0, scanLimit).sort((a, b) => compareDocIds(a.id, b.id))

    const results = []
    for (const snapshotDoc of blockDocs) {
      const block = normalizeBlockDocument(sanitizeValue(snapshotDoc.data()), snapshotDoc.id)
      const override = ownershipFor ? await ownershipFor(block) : null
      let result
      try {
        // Type roles from the block's allowed themes (none: not checked).
        const typeRoles = commonTypeRoles((Array.isArray(block?.themes) ? block.themes : []).map(id => themeDocs[id]).filter(Boolean))
        result = await validateBlock(block, { knownThemeIds, blockTagList, renderTemplate, ownership: override, typeRoles })
      }
      catch (error) {
        result = {
          errors: [{ code: 'audit.validator-threw', severity: 'error', path: '', message: String(error?.message || error) }],
          warnings: [],
          info: [],
        }
      }
      results.push({
        docId: snapshotDoc.id,
        name: String(block?.name || ''),
        templateVersion: Number(block?.templateVersion) === 2 ? 2 : 1,
        isOverrideBlock: block?.isOverrideBlock === true,
        renderingOwner: ownershipFor ? getRenderingOwner(override?.status) : 'unchecked',
        containsRedactedValues: containsRedactedValue(block),
        firestoreUpdateTime: timestampToIso(snapshotDoc.updateTime),
        tags: Array.isArray(block?.tags) ? block.tags : [],
        errors: result.errors,
        warnings: result.warnings,
        info: result.info,
      })
    }

    const summary = summarizeBlockAudit(results, {
      scanTruncated: blocksSnapshot.size > scanLimit,
      themeScanTruncated: themesSnapshot.size > themeScanLimit,
      knownThemeCount: knownThemeIds.length,
      blockTags: summarizeBlockTagRules(results, blockTagList),
      renderChecks: renderTemplate ? 'ran' : (includeRender ? 'skipped-engine-unavailable' : 'skipped-by-request'),
    })
    return { orgId, summary, results }
  }

  // Validates one definition with the MCP's validator settings (name and
  // content required, structure, schema, grammar and render checks with empty
  // and sample Data Source records): the inline `definition`, or the library
  // block `docId`'s current definition (its open draft, else the released
  // one). `override` is the public renderer resolution, when known.
  const validateDefinition = async ({ orgId, definition = null, docId: requestedDocId = '', override = null }) => {
    const { validateBlockDocument, validateBlockRender, mergeValidationResults } = validation
    let block
    let source = 'definition'
    if (definition) {
      if (!isPlainObject(definition))
        throw refusal('invalid-argument', 'definition must be one block object.')
      block = normalizeBlockDocument(definition, requestedDocId ? assertFirestoreSegment(requestedDocId, 'docId') : 'inline-definition')
    }
    else {
      const docId = assertFirestoreSegment(requestedDocId, 'docId')
      const blockRef = db.collection('organizations').doc(orgId).collection('blocks').doc(docId)
      const blockSnap = await blockRef.get()
      if (!blockSnap.exists)
        throw refusal('not-found', `Block "${docId}" does not exist in ${orgId}.`)
      const stored = blockSnap.data() || {}
      let draft = null
      if (Number.isInteger(stored.draftRevision)) {
        const draftSnap = await blockRef.collection('revisions').doc(String(stored.draftRevision)).get()
        if (draftSnap.exists && draftSnap.data()?.status === 'draft')
          draft = draftSnap.data()
      }
      // A draft revision holds the editable definition; the rest (name, tags,
      // themes) stays on the library block.
      block = normalizeBlockDocument(sanitizeValue(draft ? { ...stored, ...draft.definition } : stored), docId)
      source = draft ? 'draft' : 'released'
    }
    const shared = validateBlockDocument(block, { requiredKeys: MCP_REQUIRED_BLOCK_KEYS, requireDocId: true, ownership: override })
    const render = await validateBlockRender(block, { renderTemplate: await loadRenderTemplate() })
    const result = toMcpValidation(block, mergeValidationResults(shared, render), { override })
    return {
      orgId,
      docId: block.docId,
      source,
      valid: result.errors.length === 0,
      ...result,
      hash: hashDocument(block),
    }
  }

  return { readBlock, readTheme, findTheme, getTheme, findBlock, blockBase, findUsage, auditBlocks, validateDefinition }
}

export function hashDocument(value) {
  return createHash('sha256').update(stableStringify(value) ?? 'undefined').digest('hex')
}

export function stableStringify(value) {
  return JSON.stringify(sortJsonValue(value))
}

export function collectBlockReferences(value, targetBlockId) {
  const target = String(targetBlockId || '').trim()
  const references = []

  const visit = (current, fieldPath) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${fieldPath}[${index}]`))
      return
    }
    if (!isPlainObject(current))
      return

    if (String(current.blockId || '').trim() === target) {
      references.push({
        fieldPath: fieldPath || '$',
        instanceId: firstNonEmptyString(current.id, current.docId),
        instanceName: firstNonEmptyString(current.name, current.title),
      })
    }

    for (const [key, child] of Object.entries(current)) {
      const childPath = fieldPath ? `${fieldPath}.${key}` : key
      visit(child, childPath)
    }
  }

  visit(value, '')
  return references
}

export function normalizeBlockFilters({ query, exactName, tag, type, theme }) {
  return {
    query: String(query || '').trim(),
    exactName: String(exactName || '').trim(),
    tag: String(tag || '').trim(),
    type: String(type || '').trim(),
    theme: String(theme || '').trim(),
  }
}

export function blockMatchesFilters(block, docId, filters) {
  const query = filters.query.toLowerCase()
  const name = String(block?.name || '')
  const tags = stringArray(block?.tags)
  const types = stringArray(Array.isArray(block?.type) ? block.type : [block?.type])
  const themes = stringArray(block?.themes)

  if (query) {
    const haystack = [docId, name, ...tags, ...types, ...themes].join('\n').toLowerCase()
    if (!haystack.includes(query))
      return false
  }
  if (filters.exactName && name !== filters.exactName)
    return false
  if (filters.tag && !tags.includes(filters.tag))
    return false
  if (filters.type && !types.includes(filters.type))
    return false
  if (filters.theme && !themes.includes(filters.theme))
    return false
  return true
}

export function summarizeProductionBlock(block) {
  return {
    docId: block.docId,
    documentPath: block.documentPath,
    name: String(block.data?.name || ''),
    templateVersion: Number(block.data?.templateVersion) === 2 ? 2 : 1,
    type: stringArray(Array.isArray(block.data?.type) ? block.data.type : [block.data?.type]),
    tags: stringArray(block.data?.tags),
    themes: stringArray(block.data?.themes),
    synced: block.data?.synced === true,
    firestoreUpdateTime: block.updateTime,
    hash: block.hash,
  }
}

export function summarizeProductionTheme(theme) {
  const themeJSON = parseStoredJsonField(theme.data?.theme, 'theme')
  const headJSON = parseStoredJsonField(theme.data?.headJSON, 'headJSON')
  const referencedTemplatePageIds = collectDefaultTemplatePageIds(theme.data)
  return {
    themeId: theme.themeId,
    docId: theme.themeId,
    documentPath: theme.documentPath,
    name: String(theme.data?.name || ''),
    version: theme.data?.version ?? null,
    themeJSONValid: themeJSON.valid,
    headJSONValid: headJSON.valid,
    extraCssLength: typeof theme.data?.extraCSS === 'string' ? theme.data.extraCSS.length : 0,
    defaultTemplatePageCount: referencedTemplatePageIds.length,
    referencedTemplatePageIds,
    firestoreUpdateTime: theme.updateTime,
    hash: hashDocument(theme.data),
  }
}

export function normalizeThemeFilters({ query = '', exactName = '' } = {}) {
  return {
    query: String(query || '').trim(),
    exactName: String(exactName || '').trim(),
  }
}

export function themeMatchesFilters(theme, themeId, filters) {
  const name = String(theme?.name || '')
  if (filters.exactName && name !== filters.exactName)
    return false
  if (filters.query) {
    const needle = filters.query.toLowerCase()
    const haystack = `${themeId}\n${name}`.toLowerCase()
    if (!haystack.includes(needle))
      return false
  }
  return true
}

export function normalizeThemeDocument(value, themeId) {
  const theme = isPlainObject(value) ? { ...value } : {}
  theme.docId = themeId
  return theme
}

export function parseStoredJsonField(value, field) {
  if (isPlainObject(value) || Array.isArray(value)) {
    return {
      field,
      storedType: Array.isArray(value) ? 'array' : 'object',
      raw: JSON.stringify(value, null, 2),
      parsed: cloneJsonValue(value, {}),
      valid: true,
      error: null,
    }
  }

  const raw = value == null ? '' : String(value)
  if (!raw.trim()) {
    return {
      field,
      storedType: typeof value,
      raw,
      parsed: {},
      valid: true,
      error: null,
    }
  }

  try {
    return {
      field,
      storedType: typeof value,
      raw,
      parsed: JSON.parse(raw),
      valid: true,
      error: null,
    }
  }
  catch (error) {
    return {
      field,
      storedType: typeof value,
      raw,
      parsed: null,
      valid: false,
      error: `${field} is not valid JSON: ${error.message}`,
    }
  }
}

export async function readThemeCustomFonts({
  db,
  orgId,
  themeId,
  headRaw,
  headDocument,
  sanitizeValue,
  limit,
}) {
  const collectionPath = `organizations/${orgId}/files`
  const resultLimit = boundedNumber(limit, limit, DEFAULT_THEME_FONT_LIMIT)
  const snapshot = await db.collection(collectionPath)
    .where('meta.themeId', '==', themeId)
    .limit(resultLimit + 1)
    .get()
  const scanTruncated = snapshot.size > resultLimit
  const scannedDocs = snapshot.docs.slice(0, resultLimit)
  const fonts = scannedDocs
    .map((snapshotDoc) => {
      const data = sanitizeValue(snapshotDoc.data())
      return { snapshotDoc, data }
    })
    .filter(({ data }) => data?.meta?.cmsFont === true)
    .map(({ snapshotDoc, data }) => projectCustomFont(
      snapshotDoc.id,
      data,
      headRaw,
      headDocument,
    ))

  return {
    included: true,
    collectionPath,
    queryField: 'meta.themeId',
    queryValue: themeId,
    scannedDocuments: scannedDocs.length,
    scanTruncated,
    resultLimit,
    fontCount: fonts.length,
    fonts,
  }
}

export function projectCustomFont(docId, data, headRaw, headDocument) {
  const r2URL = String(data?.r2URL || '')
  const fontFace = findFontFaceForUrl(headDocument, r2URL)
  return {
    docId,
    name: String(data?.name || ''),
    fileName: String(data?.fileName || ''),
    contentType: String(data?.contentType || ''),
    size: Number.isFinite(Number(data?.size)) ? Number(data.size) : null,
    r2URL: r2URL || null,
    uploadTime: data?.uploadTime ?? null,
    uploadCompletedToR2: data?.uploadCompletedToR2 === true,
    fontGroupId: String(data?.meta?.fontGroupId || '') || null,
    autoLink: data?.meta?.autoLink !== false,
    linkedInHeadJSON: !!r2URL && String(headRaw || '').includes(r2URL),
    headFontFace: fontFace,
  }
}

export function findFontFaceForUrl(headDocument, url) {
  if (!url)
    return null
  const styles = Array.isArray(headDocument?.style) ? headDocument.style : []
  const cssText = styles
    .map(entry => String(entry?.children || entry?.innerHTML || ''))
    .join('\n')
  const cssBlocks = cssText.match(/@font-face\s*\{[\s\S]*?\}/gi) || []
  const variants = urlVariants(url)
  const css = cssBlocks.find(block => variants.some(variant => block.includes(variant)))
  if (!css)
    return null
  return {
    fontFamily: extractCssDeclaration(css, 'font-family'),
    fontWeight: extractCssDeclaration(css, 'font-weight'),
    fontStyle: extractCssDeclaration(css, 'font-style'),
    fontDisplay: extractCssDeclaration(css, 'font-display'),
  }
}

export function urlVariants(url) {
  const variants = new Set([String(url || '')])
  try {
    variants.add(encodeURI(url))
  }
  catch {}
  try {
    variants.add(decodeURI(url))
  }
  catch {}
  return [...variants].filter(Boolean)
}

export function extractCssDeclaration(css, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(css || '').match(new RegExp(`${escapedProperty}\\s*:\\s*([^;}]*)`, 'i'))
  return String(match?.[1] || '').trim().replace(/^['"]|['"]$/g, '') || null
}

export function collectDefaultTemplatePageIds(theme) {
  const ids = new Set()
  for (const entry of Array.isArray(theme?.defaultPages) ? theme.defaultPages : []) {
    const pageId = String(entry?.pageId || '').trim()
    if (pageId)
      ids.add(pageId)
  }

  const visitMenuEntries = (entries) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.item === 'string') {
        const pageId = entry.item.trim()
        if (pageId)
          ids.add(pageId)
        continue
      }
      if (!isPlainObject(entry?.item) || entry.item.type === 'external')
        continue
      for (const nestedEntries of Object.values(entry.item))
        visitMenuEntries(nestedEntries)
    }
  }

  if (isPlainObject(theme?.defaultMenus)) {
    for (const entries of Object.values(theme.defaultMenus))
      visitMenuEntries(entries)
  }
  return [...ids].sort()
}

export function cloneJsonValue(value, fallback) {
  const selected = value === undefined ? fallback : value
  return structuredClone(selected)
}

export function normalizeBlockDocument(value, docId) {
  const block = isPlainObject(value) ? { ...value } : {}
  block.docId = docId
  return block
}

export function assertFirestoreSegment(value, label) {
  const segment = String(value || '').trim()
  if (!segment)
    throw refusal('invalid-argument', `${label} is required.`)
  if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
    throw refusal('invalid-argument', `${label} must be one Firestore path segment.`)
  return segment
}

export function timestampToIso(value) {
  if (!value)
    return null
  if (typeof value.toDate === 'function')
    return value.toDate().toISOString()
  if (typeof value.toMillis === 'function')
    return new Date(value.toMillis()).toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function boundedNumber(value, maximum, fallback) {
  const parsed = Number(value)
  const safeFallback = Math.max(1, Number(fallback) || 1)
  const requested = (Number.isFinite(parsed) && parsed > 0) ? Math.trunc(parsed) : safeFallback
  return Math.max(1, Math.min(requested, Math.max(1, Number(maximum) || safeFallback)))
}

export function sortJsonValue(value) {
  if (Array.isArray(value))
    return value.map(sortJsonValue)
  if (!isPlainObject(value))
    return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortJsonValue(value[key])]),
  )
}

export function stringArray(value) {
  if (!Array.isArray(value))
    return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

export function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized)
      return normalized
  }
  return ''
}

export function getRenderingOwner(overrideStatus) {
  if (overrideStatus === 'vue-override')
    return 'public-frontend-vue-override'
  if (overrideStatus === 'ambiguous-vue-override')
    return 'ambiguous'
  if (overrideStatus === 'renderer-repo-unavailable')
    return 'unverified'
  // Remote reads cannot see the public renderer's overrides.
  if (overrideStatus === 'unchecked')
    return 'unchecked'
  return 'cms'
}

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function compareDocIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

// The tag rules' share of an audit: the organization list, and the blocks
// with a tag outside it or a content tag count other than one or two.
export function summarizeBlockTagRules(results, blockTagList) {
  const isTagFinding = issue => String(issue.code || '').startsWith('tags.')
  const flagged = results.filter(item => [...item.errors, ...item.warnings].some(isTagFinding))
  return {
    list: blockTagList,
    restricted: blockTagList.length > 0,
    blocksWithTagFindings: flagged.length,
    offListTags: [...new Set(results.flatMap(item => (item.tags || []).filter(tag => blockTagList.length && !blockTagList.includes(tag))))].sort(),
  }
}

export function summarizeBlockAudit(results, extra = {}) {
  const byRule = new Map()
  for (const item of results) {
    for (const issue of [...item.errors, ...item.warnings]) {
      const key = `${issue.severity}:${issue.code}`
      const entry = byRule.get(key) || { severity: issue.severity, code: issue.code, findings: 0, blocks: new Set() }
      entry.findings++
      entry.blocks.add(item.docId)
      byRule.set(key, entry)
    }
  }
  const count = predicate => results.filter(predicate).length
  return {
    blocks: results.length,
    templateV2: count(item => item.templateVersion === 2),
    templateV1: count(item => item.templateVersion === 1),
    blocksWithErrors: count(item => item.errors.length),
    blocksWithWarningsOnly: count(item => !item.errors.length && item.warnings.length),
    cleanBlocks: count(item => !item.errors.length && !item.warnings.length),
    vueOverrideBlocks: count(item => item.renderingOwner === 'public-frontend-vue-override'),
    blocksWithRedactedValues: count(item => item.containsRedactedValues),
    ...extra,
    byRule: [...byRule.values()]
      .map(entry => ({ ...entry, blocks: entry.blocks.size }))
      .sort((a, b) => {
        if (a.severity !== b.severity)
          return a.severity === 'error' ? -1 : 1
        return (b.blocks - a.blocks) || a.code.localeCompare(b.code)
      }),
  }
}

export function containsRedactedValue(value) {
  if (value === '[REDACTED]')
    return true
  if (Array.isArray(value))
    return value.some(containsRedactedValue)
  if (isPlainObject(value))
    return Object.values(value).some(containsRedactedValue)
  return false
}

// The Hub's shared validator owns the block rules. This adapter keeps the MCP's
// original response: string errors, warnings and info, plus templateVersion,
// renderingOwner, declaredSources and sourceCalls. Structured findings are
// added as `issues`.

export function toMcpValidation(block, shared, { override = null } = {}) {
  const doc = isPlainObject(block) ? block : {}
  const info = shared.info.map(issue => issue.message)
  if (override?.status === 'vue-override')
    info.push(`Public rendering resolves to Vue override ${override.selectedMatch?.relativePath || ''}.`.trim())
  else if (!['ambiguous-vue-override', 'renderer-repo-unavailable', 'unchecked'].includes(override?.status))
    info.push('Public rendering falls back to CMS HTML when no deployed override matches.')

  return {
    templateVersion: Number(doc.templateVersion) === 2 ? 2 : 1,
    renderingOwner: getRenderingOwner(override?.status),
    declaredSources: isPlainObject(doc.dataSources) ? Object.keys(doc.dataSources) : [],
    sourceCalls: [...new Set(extractSourceCalls(doc.template || doc.content || ''))],
    errors: shared.errors.map(issue => issue.message),
    warnings: shared.warnings.map(issue => issue.message),
    info,
    issues: [...shared.errors, ...shared.warnings, ...shared.info],
  }
}

export function extractSourceCalls(template) {
  const calls = []
  const matcher = /source\(\s*["']([^"']+)["']/g
  for (;;) {
    const match = matcher.exec(String(template || ''))
    if (!match)
      break
    calls.push(match[1])
  }
  return calls
}
