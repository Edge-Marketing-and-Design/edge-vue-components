import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  mergeValidationResults,
  validateBlock,
  validateBlockRender,
  validateBlockDocument as validateSharedBlockDocument,
} from '../../../../lib/cmsBlockValidation.js'

const CHECKOUT_SCHEMA_VERSION = 1
const DEFAULT_RESULT_LIMIT = 25
const DEFAULT_SCAN_LIMIT = 1000
const DEFAULT_PAGE_LIMIT = 500
const DEFAULT_SITE_LIMIT = 100
const DEFAULT_THEME_SCAN_LIMIT = 250
const DEFAULT_THEME_FONT_LIMIT = 100
const MAX_DIFF_CHANGES = 500
const MAX_DIFF_TEXT = 50000

export function createCmsToolService({
  db,
  config,
  projectId,
  sanitizeValue = value => value,
  repoRoot,
  credentials = null,
}) {
  if (!db)
    throw new Error('CMS tools require a Firestore database client.')

  const workspaceRoot = resolveLocalPath(
    process.env.EDGE_CMS_WORKSPACE_ROOT || process.env.CLEARWATER_CMS_WORKSPACE_ROOT
      || config.cmsWorkspaceRoot
      || '.tmp/cms-block-workspace',
    repoRoot,
  )
  const rendererRepoPath = resolveLocalPath(
    process.env.EDGE_CMS_RENDERER_REPO || process.env.CLEARWATER_CMS_RENDERER_REPO
      || config.cmsRendererRepoPath
      || '../emd-cms-front',
    repoRoot,
  )
  const auditRoot = resolveLocalPath(
    process.env.EDGE_CMS_AUDIT_ROOT || process.env.CLEARWATER_CMS_AUDIT_ROOT
      || config.cmsAuditRoot
      || '.tmp/cms-block-audits',
    repoRoot,
  )

  const environmentSummary = () => ({
    projectId,
    environment: config.environment,
    productionRead: config.environment === 'production',
    ...(credentials ? { credentials } : {}),
  })

  const resolveOrgId = (requestedOrgId = '') => {
    const configuredOrgId = String(requestedOrgId || config.defaultOrgId || '').trim()
    if (!configuredOrgId) {
      throw new Error(
        'orgId is required. Pass it explicitly or configure defaultOrgId/EDGE_CMS_MCP_DEFAULT_ORG_ID.',
      )
    }
    return assertFirestoreSegment(configuredOrgId, 'orgId')
  }

  const readProductionBlock = async ({ orgId: requestedOrgId, docId: requestedDocId }) => {
    const orgId = resolveOrgId(requestedOrgId)
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

  const readProductionTheme = async ({ orgId: requestedOrgId, themeId: requestedThemeId }) => {
    const orgId = resolveOrgId(requestedOrgId)
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

  const findTheme = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId = '',
    query = '',
    exactName = '',
    limit,
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    const filters = normalizeThemeFilters({ query, exactName })
    const requestedLimit = boundedNumber(
      limit,
      config.maxCmsThemeResultLimit || config.maxCmsResultLimit || 100,
      DEFAULT_RESULT_LIMIT,
    )

    if (requestedDocId) {
      const theme = await readProductionTheme({ orgId, themeId: requestedDocId })
      const matches = (theme.exists && themeMatchesFilters(theme.data, theme.themeId, filters))
        ? [summarizeProductionTheme(theme)]
        : []
      return {
        ...environmentSummary(),
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
      config.maxCmsThemeScanDocuments,
      config.maxCmsThemeScanDocuments || DEFAULT_THEME_SCAN_LIMIT,
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
      ...environmentSummary(),
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

  const getTheme = async ({
    orgId: requestedOrgId = '',
    themeId: requestedThemeId,
    includeCustomFonts = true,
  }) => {
    const production = await readProductionTheme({
      orgId: requestedOrgId,
      themeId: requestedThemeId,
    })
    if (!production.exists)
      throw new Error(`Production CMS theme does not exist: ${production.documentPath}`)

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
        limit: config.maxCmsThemeFontDocuments || DEFAULT_THEME_FONT_LIMIT,
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
      ...environmentSummary(),
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

  const findBlock = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId = '',
    query = '',
    exactName = '',
    tag = '',
    type = '',
    theme = '',
    limit,
    startAfter = '',
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    const requestedLimit = boundedNumber(limit, config.maxCmsResultLimit || 100, DEFAULT_RESULT_LIMIT)
    const cursor = String(startAfter || '').trim()
    const filters = normalizeBlockFilters({ query, exactName, tag, type, theme })

    if (requestedDocId) {
      const block = await readProductionBlock({ orgId, docId: requestedDocId })
      const matches = (block.exists && blockMatchesFilters(block.data, block.docId, filters))
        ? [summarizeProductionBlock(block)]
        : []
      return {
        ...environmentSummary(),
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
      config.maxCmsBlockScanDocuments,
      config.maxCmsBlockScanDocuments || DEFAULT_SCAN_LIMIT,
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
      ...environmentSummary(),
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

  // Validates every library block in an organization with the Hub's import
  // settings, reading production once. The full per-block report is written to
  // a local file; the response carries only the summary.
  const auditBlocks = async ({
    orgId: requestedOrgId = '',
    themeName = '',
    includeRender = true,
    listLimit,
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    const scanLimit = boundedNumber(
      config.maxCmsBlockScanDocuments,
      config.maxCmsBlockScanDocuments || DEFAULT_SCAN_LIMIT,
      DEFAULT_SCAN_LIMIT,
    )
    const themeScanLimit = boundedNumber(
      config.maxCmsThemeScanDocuments,
      config.maxCmsThemeScanDocuments || DEFAULT_THEME_SCAN_LIMIT,
      DEFAULT_THEME_SCAN_LIMIT,
    )
    const listedLimit = boundedNumber(listLimit, config.maxCmsResultLimit || 100, DEFAULT_RESULT_LIMIT)
    const collectionPath = `organizations/${orgId}/blocks`
    const [blocksSnapshot, themesSnapshot] = await Promise.all([
      db.collection(collectionPath).limit(scanLimit + 1).get(),
      db.collection(`organizations/${orgId}/themes`).limit(themeScanLimit + 1).get(),
    ])
    const knownThemeIds = themesSnapshot.docs.slice(0, themeScanLimit).map(doc => doc.id)
    const renderTemplate = includeRender ? await loadRenderTemplate() : null
    const blockDocs = blocksSnapshot.docs.slice(0, scanLimit).sort((a, b) => compareDocIds(a.id, b.id))

    const results = []
    for (const snapshotDoc of blockDocs) {
      const block = normalizeBlockDocument(sanitizeValue(snapshotDoc.data()), snapshotDoc.id)
      const override = await resolveVueOverride({
        rendererRepoPath,
        orgId,
        blockName: block?.name || '',
        themeName,
      })
      let validation
      try {
        validation = await validateBlock(block, { knownThemeIds, renderTemplate, ownership: override })
      }
      catch (error) {
        validation = {
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
        renderingOwner: getRenderingOwner(override?.status),
        containsRedactedValues: containsRedactedValue(block),
        firestoreUpdateTime: timestampToIso(snapshotDoc.updateTime),
        errors: validation.errors,
        warnings: validation.warnings,
        info: validation.info,
      })
    }

    const summary = summarizeBlockAudit(results, {
      scanTruncated: blocksSnapshot.size > scanLimit,
      themeScanTruncated: themesSnapshot.size > themeScanLimit,
      knownThemeCount: knownThemeIds.length,
      renderChecks: renderTemplate ? 'ran' : (includeRender ? 'skipped-engine-unavailable' : 'skipped-by-request'),
    })
    const auditedAt = new Date().toISOString()
    const reportPath = path.join(auditRoot, orgId, `${auditedAt.replace(/[:.]/g, '-')}.json`)
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeJsonAtomically(reportPath, {
      ...environmentSummary(),
      orgId,
      auditedAt,
      semantics: 'hub-import',
      summary,
      results,
    })

    const blocksWithErrors = results.filter(item => item.errors.length)
    return {
      ...environmentSummary(),
      orgId,
      auditedAt,
      semantics: 'hub-import',
      reportPath,
      summary,
      blocksWithErrors: blocksWithErrors.slice(0, listedLimit).map(item => ({
        docId: item.docId,
        name: item.name,
        errorCodes: [...new Set(item.errors.map(issue => issue.code))],
      })),
      blocksWithErrorsTruncated: blocksWithErrors.length > listedLimit,
    }
  }

  const resolveOverride = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId = '',
    blockName = '',
    themeName = '',
  } = {}) => {
    const orgId = resolveOrgId(requestedOrgId)
    let resolvedBlockName = String(blockName || '').trim()
    let productionBlock = null

    if (requestedDocId) {
      productionBlock = await readProductionBlock({ orgId, docId: requestedDocId })
      if (!productionBlock.exists)
        throw new Error(`Production CMS block does not exist: ${productionBlock.documentPath}`)
      resolvedBlockName = String(productionBlock.data?.name || '').trim()
    }
    if (!resolvedBlockName)
      throw new Error('blockName or docId is required to resolve a public frontend override.')

    const resolution = await resolveVueOverride({
      rendererRepoPath,
      orgId,
      blockName: resolvedBlockName,
      themeName,
    })

    return {
      ...environmentSummary(),
      orgId,
      docId: productionBlock?.docId || null,
      documentPath: productionBlock?.documentPath || null,
      blockName: resolvedBlockName,
      themeName: String(themeName || '').trim() || null,
      rendererRepoPath,
      ...resolution,
    }
  }

  const checkoutBlock = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    themeName = '',
  }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)
    if (containsRedactedValue(production.data)) {
      throw new Error(
        `Production CMS block ${production.docId} contains fields redacted by the MCP configuration. Checkout refused because the local copy would not be lossless.`,
      )
    }

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const existing = await readCheckoutFiles(checkoutPaths)
    if (existing.exists) {
      validateCheckoutIdentity(existing.manifest, production.orgId, production.docId)
      const existingBaseHash = hashDocument(existing.base)
      const existingLocalHash = hashDocument(existing.local)
      if (existingBaseHash !== existing.manifest.baseHash) {
        throw new Error(
          `Checkout base does not match its manifest for ${production.docId}. Run cms_status and repair or move the checkout before refreshing it.`,
        )
      }
      if (existingLocalHash !== existing.manifest.baseHash) {
        throw new Error(
          `Local checkout has changes for ${production.docId}. Checkout refused so block.json is not overwritten. Run cms_status and cms_diff first.`,
        )
      }
    }

    const override = await resolveVueOverride({
      rendererRepoPath,
      orgId: production.orgId,
      blockName: production.data?.name || '',
      themeName,
    })
    const checkedOutAt = new Date().toISOString()
    const manifest = {
      schemaVersion: CHECKOUT_SCHEMA_VERSION,
      projectId,
      environment: config.environment,
      orgId: production.orgId,
      docId: production.docId,
      blockName: String(production.data?.name || ''),
      documentPath: production.documentPath,
      checkedOutAt,
      firestoreCreateTime: production.createTime,
      firestoreUpdateTime: production.updateTime,
      baseHash: production.hash,
      renderer: {
        status: override.status,
        componentPath: override.selectedMatch?.absolutePath || null,
      },
    }

    await mkdir(checkoutPaths.directory, { recursive: true })
    await writeJsonAtomically(checkoutPaths.base, production.data)
    await writeJsonAtomically(checkoutPaths.local, production.data)
    await writeJsonAtomically(checkoutPaths.manifest, manifest)

    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      blockName: manifest.blockName,
      baseHash: production.hash,
      firestoreUpdateTime: production.updateTime,
      refreshedExistingCheckout: existing.exists,
      workspace: checkoutPaths,
      renderer: override,
    }
  }

  const status = async ({ orgId: requestedOrgId = '', docId: requestedDocId }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const checkout = await readCheckoutFiles(checkoutPaths)
    if (!checkout.exists) {
      return {
        ...environmentSummary(),
        orgId: production.orgId,
        docId: production.docId,
        documentPath: production.documentPath,
        status: 'untracked',
        productionHash: production.hash,
        workspace: checkoutPaths,
      }
    }

    validateCheckoutIdentity(checkout.manifest, production.orgId, production.docId)
    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      ...buildWorkspaceStatus({
        manifest: checkout.manifest,
        base: checkout.base,
        local: checkout.local,
        production: production.data,
      }),
      firestoreUpdateTime: production.updateTime,
      checkoutTime: checkout.manifest.checkedOutAt || null,
      workspace: checkoutPaths,
    }
  }

  const diff = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    comparison = 'local-production',
  }) => {
    const production = await readProductionBlock({ orgId: requestedOrgId, docId: requestedDocId })
    if (!production.exists)
      throw new Error(`Production CMS block does not exist: ${production.documentPath}`)

    const checkoutPaths = getCheckoutPaths(workspaceRoot, production.orgId, production.docId)
    const checkout = await readCheckoutFiles(checkoutPaths)
    if (!checkout.exists)
      throw new Error(`No local checkout exists for ${production.docId}. Run cms_checkout_block first.`)
    validateCheckoutIdentity(checkout.manifest, production.orgId, production.docId)

    const comparisons = {
      'base-local': {
        fromLabel: 'checkout-base',
        from: checkout.base,
        toLabel: 'local',
        to: checkout.local,
      },
      'base-production': {
        fromLabel: 'checkout-base',
        from: checkout.base,
        toLabel: 'production',
        to: production.data,
      },
      'local-production': {
        fromLabel: 'local',
        from: checkout.local,
        toLabel: 'production',
        to: production.data,
      },
    }
    const selected = comparisons[comparison]
    if (!selected)
      throw new Error(`Unsupported comparison "${comparison}".`)

    return {
      ...environmentSummary(),
      orgId: production.orgId,
      docId: production.docId,
      documentPath: production.documentPath,
      comparison,
      from: {
        label: selected.fromLabel,
        hash: hashDocument(selected.from),
      },
      to: {
        label: selected.toLabel,
        hash: hashDocument(selected.to),
      },
      ...buildDocumentDiff(selected.from, selected.to),
      workspace: checkoutPaths,
    }
  }

  const findUsage = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    siteId: requestedSiteId = '',
    limit,
  }) => {
    const orgId = resolveOrgId(requestedOrgId)
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    const resultLimit = boundedNumber(limit, config.maxCmsUsageResults || 500, 100)
    const maxSites = boundedNumber(
      config.maxCmsSiteScanDocuments,
      config.maxCmsSiteScanDocuments || DEFAULT_SITE_LIMIT,
      DEFAULT_SITE_LIMIT,
    )
    const maxPagesPerSite = boundedNumber(
      config.maxCmsPageScanDocuments,
      config.maxCmsPageScanDocuments || DEFAULT_PAGE_LIMIT,
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
    }

    return {
      ...environmentSummary(),
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

  const validate = async ({
    orgId: requestedOrgId = '',
    docId: requestedDocId,
    source = 'local',
    themeName = '',
  }) => {
    const orgId = resolveOrgId(requestedOrgId)
    const docId = assertFirestoreSegment(requestedDocId, 'docId')
    let block
    let sourcePath
    let production = null

    if (source === 'production') {
      production = await readProductionBlock({ orgId, docId })
      if (!production.exists)
        throw new Error(`Production CMS block does not exist: ${production.documentPath}`)
      block = production.data
      sourcePath = production.documentPath
    }
    else {
      const checkoutPaths = getCheckoutPaths(workspaceRoot, orgId, docId)
      const checkout = await readCheckoutFiles(checkoutPaths)
      if (!checkout.exists)
        throw new Error(`No local checkout exists for ${docId}. Run cms_checkout_block first.`)
      validateCheckoutIdentity(checkout.manifest, orgId, docId)
      block = checkout.local
      sourcePath = checkoutPaths.local
    }

    const override = await resolveVueOverride({
      rendererRepoPath,
      orgId,
      blockName: block?.name || '',
      themeName,
    })
    const validation = await validateBlockWithRender(block, { override })

    return {
      ...environmentSummary(),
      orgId,
      docId,
      source,
      sourcePath,
      valid: validation.errors.length === 0,
      ...validation,
      renderer: override,
      hash: hashDocument(block),
      firestoreUpdateTime: production?.updateTime || null,
    }
  }

  return {
    auditBlocks,
    checkoutBlock,
    diff,
    findBlock,
    findTheme,
    findUsage,
    getTheme,
    readProductionBlock,
    readProductionTheme,
    resolveOverride,
    status,
    validate,
    rendererRepoPath,
    workspaceRoot,
    auditRoot,
  }
}

export function hashDocument(value) {
  return createHash('sha256').update(stableStringify(value) ?? 'undefined').digest('hex')
}

export function stableStringify(value) {
  return JSON.stringify(sortJsonValue(value))
}

export function buildWorkspaceStatus({ manifest, base, local, production }) {
  const expectedBaseHash = String(manifest?.baseHash || '')
  const baseHash = hashDocument(base)
  const localHash = hashDocument(local)
  const productionHash = hashDocument(production)

  if (!expectedBaseHash || baseHash !== expectedBaseHash) {
    return {
      status: 'invalid-checkout',
      reason: 'base-hash-mismatch',
      manifestBaseHash: expectedBaseHash || null,
      baseHash,
      localHash,
      productionHash,
    }
  }

  const localChanged = localHash !== baseHash
  const productionChanged = productionHash !== baseHash
  let status = 'clean'

  if (localHash === productionHash && localChanged)
    status = 'local-matches-production'
  else if (localChanged && productionChanged)
    status = 'diverged'
  else if (localChanged)
    status = 'local-changed'
  else if (productionChanged)
    status = 'production-changed'

  return {
    status,
    localChanged,
    productionChanged,
    manifestBaseHash: expectedBaseHash,
    baseHash,
    localHash,
    productionHash,
    changedTopLevelFields: {
      baseToLocal: changedTopLevelFields(base, local),
      baseToProduction: changedTopLevelFields(base, production),
      localToProduction: changedTopLevelFields(local, production),
    },
  }
}

export function buildDocumentDiff(fromValue, toValue) {
  const changes = []
  collectValueChanges(fromValue, toValue, '', changes)
  const truncated = changes.length > MAX_DIFF_CHANGES
  const selectedChanges = changes.slice(0, MAX_DIFF_CHANGES)
  return {
    equal: changes.length === 0,
    changeCount: changes.length,
    changesTruncated: truncated,
    changedTopLevelFields: changedTopLevelFields(fromValue, toValue),
    changes: selectedChanges,
  }
}

// The Hub's shared validator owns the block rules. This adapter keeps the MCP's
// original response: string errors, warnings and info, plus templateVersion,
// renderingOwner, declaredSources and sourceCalls. Structured findings are
// added as `issues`.
const MCP_REQUIRED_BLOCK_KEYS = ['name', 'content']

export function toMcpValidation(block, shared, { override = null } = {}) {
  const doc = isPlainObject(block) ? block : {}
  const info = shared.info.map(issue => issue.message)
  if (override?.status === 'vue-override')
    info.push(`Public rendering resolves to Vue override ${override.selectedMatch?.relativePath || ''}.`.trim())
  else if (!['ambiguous-vue-override', 'renderer-repo-unavailable'].includes(override?.status))
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

export function validateBlockDocument(block, { override = null } = {}) {
  const shared = validateSharedBlockDocument(block, {
    requiredKeys: MCP_REQUIRED_BLOCK_KEYS,
    requireDocId: true,
    ownership: override,
  })
  return toMcpValidation(block, shared, { override })
}

let templateEngine
// The engine is resolved from the Hub's root node_modules. When it cannot be
// loaded, render checks report as skipped instead of failing validation.
async function loadRenderTemplate() {
  if (templateEngine === undefined) {
    try {
      templateEngine = (await import('@edgedev/template-engine')).renderTemplateAsync || null
    }
    catch {
      templateEngine = null
    }
  }
  return templateEngine
}

export async function validateBlockWithRender(block, { override = null, renderTemplate } = {}) {
  const shared = validateSharedBlockDocument(block, {
    requiredKeys: MCP_REQUIRED_BLOCK_KEYS,
    requireDocId: true,
    ownership: override,
  })
  const render = await validateBlockRender(block, {
    renderTemplate: renderTemplate === undefined ? await loadRenderTemplate() : renderTemplate,
  })
  return toMcpValidation(block, mergeValidationResults(shared, render), { override })
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

export async function resolveVueOverride({ rendererRepoPath, orgId, blockName, themeName = '' }) {
  const blocksRoot = path.join(rendererRepoPath, 'app/blocks')
  let files
  try {
    files = await listFilesRecursively(blocksRoot, filePath => filePath.endsWith('.vue'))
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'renderer-repo-unavailable',
        candidateNames: componentCandidateNames(blockName),
        selectedMatch: null,
        matches: [],
      }
    }
    throw error
  }

  const candidateNames = componentCandidateNames(blockName)
  const candidateTokens = [...new Set(candidateNames.map(normalizeComponentLookup).filter(Boolean))]
  const orgToken = normalizeComponentLookup(orgId)
  const themeToken = normalizeComponentLookup(themeName)
  const orgMatches = []
  const globalMatches = []

  for (const absolutePath of files) {
    const relativePath = path.relative(blocksRoot, absolutePath)
    const relativeWithoutExtension = relativePath.replace(/\.vue$/i, '')
    const lookupKey = normalizeComponentLookup(relativeWithoutExtension)
    const basenameToken = normalizeComponentLookup(path.basename(relativeWithoutExtension))
    const orgIndex = orgToken ? lookupKey.indexOf(orgToken) : -1

    if (orgIndex >= 0) {
      const scopedName = lookupKey.slice(orgIndex + orgToken.length)
      const matchesScopedName = candidateTokens.some((candidateToken) => {
        return scopedName === candidateToken
          || (themeToken && scopedName === `${themeToken}${candidateToken}`)
      })
      if (matchesScopedName) {
        orgMatches.push({ absolutePath, relativePath, scope: 'organization' })
      }
      continue
    }

    if (!relativePath.includes(path.sep) && candidateTokens.includes(basenameToken))
      globalMatches.push({ absolutePath, relativePath, scope: 'global' })
  }

  const matches = orgMatches.length ? orgMatches : globalMatches
  const status = matches.length === 0
    ? 'cms-html'
    : (matches.length === 1 ? 'vue-override' : 'ambiguous-vue-override')

  return {
    status,
    candidateNames,
    selectedMatch: matches.length === 1 ? matches[0] : null,
    matches,
  }
}

function normalizeBlockFilters({ query, exactName, tag, type, theme }) {
  return {
    query: String(query || '').trim(),
    exactName: String(exactName || '').trim(),
    tag: String(tag || '').trim(),
    type: String(type || '').trim(),
    theme: String(theme || '').trim(),
  }
}

function blockMatchesFilters(block, docId, filters) {
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

function summarizeProductionBlock(block) {
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

function summarizeProductionTheme(theme) {
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

function normalizeThemeFilters({ query = '', exactName = '' } = {}) {
  return {
    query: String(query || '').trim(),
    exactName: String(exactName || '').trim(),
  }
}

function themeMatchesFilters(theme, themeId, filters) {
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

function normalizeThemeDocument(value, themeId) {
  const theme = isPlainObject(value) ? { ...value } : {}
  theme.docId = themeId
  return theme
}

function parseStoredJsonField(value, field) {
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

async function readThemeCustomFonts({
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

function projectCustomFont(docId, data, headRaw, headDocument) {
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

function findFontFaceForUrl(headDocument, url) {
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

function urlVariants(url) {
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

function extractCssDeclaration(css, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(css || '').match(new RegExp(`${escapedProperty}\\s*:\\s*([^;}]*)`, 'i'))
  return String(match?.[1] || '').trim().replace(/^['"]|['"]$/g, '') || null
}

function collectDefaultTemplatePageIds(theme) {
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

function cloneJsonValue(value, fallback) {
  const selected = value === undefined ? fallback : value
  return structuredClone(selected)
}

function normalizeBlockDocument(value, docId) {
  const block = isPlainObject(value) ? { ...value } : {}
  block.docId = docId
  return block
}

function resolveLocalPath(value, repoRoot) {
  const configuredPath = String(value || '').trim()
  if (!configuredPath)
    throw new Error('Configured local path cannot be empty.')
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(repoRoot, configuredPath)
}

function assertFirestoreSegment(value, label) {
  const segment = String(value || '').trim()
  if (!segment)
    throw new Error(`${label} is required.`)
  if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
    throw new Error(`${label} must be one Firestore path segment.`)
  return segment
}

function getCheckoutPaths(workspaceRoot, orgId, docId) {
  const safeOrgId = assertFirestoreSegment(orgId, 'orgId')
  const safeDocId = assertFirestoreSegment(docId, 'docId')
  const directory = path.join(workspaceRoot, safeOrgId, safeDocId)
  return {
    root: workspaceRoot,
    directory,
    local: path.join(directory, 'block.json'),
    base: path.join(directory, 'base.json'),
    manifest: path.join(directory, 'checkout.json'),
  }
}

async function readCheckoutFiles(checkoutPaths) {
  const [manifestResult, baseResult, localResult] = await Promise.all([
    readJsonIfExists(checkoutPaths.manifest),
    readJsonIfExists(checkoutPaths.base),
    readJsonIfExists(checkoutPaths.local),
  ])
  const existingCount = [manifestResult, baseResult, localResult].filter(result => result.exists).length

  if (existingCount === 0)
    return { exists: false, manifest: null, base: null, local: null }
  if (existingCount !== 3) {
    throw new Error(
      `Incomplete CMS checkout at ${checkoutPaths.directory}. Expected block.json, base.json, and checkout.json.`,
    )
  }

  return {
    exists: true,
    manifest: manifestResult.value,
    base: baseResult.value,
    local: localResult.value,
  }
}

async function readJsonIfExists(filePath) {
  try {
    const text = await readFile(filePath, 'utf8')
    return { exists: true, value: JSON.parse(text) }
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return { exists: false, value: null }
    if (error instanceof SyntaxError)
      throw new Error(`Invalid JSON in local CMS workspace file: ${filePath}`)
    throw error
  }
}

function validateCheckoutIdentity(manifest, orgId, docId) {
  if (!isPlainObject(manifest))
    throw new Error('CMS checkout manifest must be a JSON object.')
  if (Number(manifest.schemaVersion) !== CHECKOUT_SCHEMA_VERSION)
    throw new Error(`Unsupported CMS checkout schema version: ${manifest.schemaVersion}`)
  if (String(manifest.orgId || '') !== orgId || String(manifest.docId || '') !== docId) {
    throw new Error(
      `CMS checkout identity mismatch. Expected ${orgId}/${docId}, found ${manifest.orgId || ''}/${manifest.docId || ''}.`,
    )
  }
}

async function writeJsonAtomically(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

function timestampToIso(value) {
  if (!value)
    return null
  if (typeof value.toDate === 'function')
    return value.toDate().toISOString()
  if (typeof value.toMillis === 'function')
    return new Date(value.toMillis()).toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function boundedNumber(value, maximum, fallback) {
  const parsed = Number(value)
  const safeFallback = Math.max(1, Number(fallback) || 1)
  const requested = (Number.isFinite(parsed) && parsed > 0) ? Math.trunc(parsed) : safeFallback
  return Math.max(1, Math.min(requested, Math.max(1, Number(maximum) || safeFallback)))
}

function sortJsonValue(value) {
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

function changedTopLevelFields(left, right) {
  const keys = new Set([
    ...Object.keys(isPlainObject(left) ? left : {}),
    ...Object.keys(isPlainObject(right) ? right : {}),
  ])
  return [...keys]
    .filter(key => stableStringify(left?.[key]) !== stableStringify(right?.[key]))
    .sort()
}

function collectValueChanges(fromValue, toValue, fieldPath, changes) {
  if (stableStringify(fromValue) === stableStringify(toValue))
    return

  if (changes.length > MAX_DIFF_CHANGES)
    return

  if (isPlainObject(fromValue) && isPlainObject(toValue)) {
    const keys = [...new Set([...Object.keys(fromValue), ...Object.keys(toValue)])].sort()
    for (const key of keys) {
      const childPath = fieldPath ? `${fieldPath}.${key}` : key
      collectValueChanges(fromValue[key], toValue[key], childPath, changes)
    }
    return
  }

  changes.push({
    path: fieldPath || '$',
    kind: fromValue === undefined ? 'added' : (toValue === undefined ? 'removed' : 'changed'),
    before: summarizeDiffValue(fromValue),
    after: summarizeDiffValue(toValue),
    textDiff: (typeof fromValue === 'string' && typeof toValue === 'string')
      ? buildTextDiff(fromValue, toValue)
      : null,
  })
}

function summarizeDiffValue(value) {
  if (value === undefined)
    return { type: 'undefined' }
  if (typeof value === 'string') {
    return {
      type: 'string',
      length: value.length,
      hash: hashDocument(value),
      preview: truncateText(value, 4000),
    }
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      hash: hashDocument(value),
      preview: value.length <= 20 ? value : value.slice(0, 20),
    }
  }
  if (isPlainObject(value)) {
    return {
      type: 'object',
      keys: Object.keys(value).sort(),
      hash: hashDocument(value),
    }
  }
  return { type: value === null ? 'null' : typeof value, value }
}

function buildTextDiff(before, after) {
  const beforeLines = String(before).split('\n')
  const afterLines = String(after).split('\n')
  let prefix = 0
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const contextStart = Math.max(0, prefix - 3)
  const beforeChangeEnd = beforeLines.length - suffix
  const afterChangeEnd = afterLines.length - suffix
  const suffixContextEnd = Math.min(beforeLines.length, beforeChangeEnd + 3)
  const lines = []

  for (let index = contextStart; index < prefix; index++)
    lines.push(` ${beforeLines[index]}`)
  for (let index = prefix; index < beforeChangeEnd; index++)
    lines.push(`-${beforeLines[index]}`)
  for (let index = prefix; index < afterChangeEnd; index++)
    lines.push(`+${afterLines[index]}`)
  for (let index = beforeChangeEnd; index < suffixContextEnd; index++)
    lines.push(` ${beforeLines[index]}`)

  return truncateText(lines.join('\n'), MAX_DIFF_TEXT)
}

function truncateText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength)
    return text
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} characters]`
}

function extractSourceCalls(template) {
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

function componentCandidateNames(label) {
  const camel = toCamelFromLabel(label)
  if (!camel)
    return []
  const pascal = toPascalCase(camel)
  const kebab = toKebabCase(pascal)
  return [...new Set([pascal, camel, kebab].filter(Boolean))]
}

function toCamelFromLabel(label) {
  const tokens = String(label || '')
    .trim()
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length)
    return ''
  return tokens[0].toLowerCase() + tokens
    .slice(1)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join('')
}

function toPascalCase(value) {
  return String(value || '')
    .replace(/(^|[^A-Z0-9]+)([A-Z0-9])/gi, (_, __, character) => character.toUpperCase())
    .replace(/[^A-Z0-9]/gi, '')
}

function toKebabCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function normalizeComponentLookup(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

async function listFilesRecursively(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath, predicate))
      continue
    }
    if (entry.isFile() && predicate(entryPath))
      files.push(entryPath)
  }
  return files.sort()
}

function stringArray(value) {
  if (!Array.isArray(value))
    return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized)
      return normalized
  }
  return ''
}

function getRenderingOwner(overrideStatus) {
  if (overrideStatus === 'vue-override')
    return 'public-frontend-vue-override'
  if (overrideStatus === 'ambiguous-vue-override')
    return 'ambiguous'
  if (overrideStatus === 'renderer-repo-unavailable')
    return 'unverified'
  return 'cms'
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compareDocIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
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

function containsRedactedValue(value) {
  if (value === '[REDACTED]')
    return true
  if (Array.isArray(value))
    return value.some(containsRedactedValue)
  if (isPlainObject(value))
    return Object.values(value).some(containsRedactedValue)
  return false
}
