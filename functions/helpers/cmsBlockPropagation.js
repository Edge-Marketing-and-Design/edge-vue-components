// How a library block definition reaches the instances placed on pages and
// posts. Used by the blockUpdated trigger and the block release worker, so
// both update documents the same way. Keep identical to
// edge/functions/helpers/cmsBlockPropagation.js.
const { reconcilePublicationValues, resolvePublicationFile } = require('./cmsPublicationValues')

const BLOCK_META_EXCLUDE_KEYS = new Set(['limit'])
// Library-only meta entries. `design` is the design-to-block map (which
// design node the block was built from); it stays on the library block and
// is never copied to instances.
const BLOCK_META_LIBRARY_KEYS = new Set(['design'])
const BLOCK_DEFINITION_SYNC_FIELDS = ['content', 'template', 'templateVersion', 'schema', 'dataSources', 'isOverrideBlock', 'blockUpdatedAt']

// Deep copy that keeps Firestore Timestamps and Dates intact.
const cloneValue = (value) => {
  if (value === null || typeof value !== 'object')
    return value
  if (typeof value.toDate === 'function')
    return value
  if (value instanceof Date)
    return new Date(value.getTime())
  if (Array.isArray(value))
    return value.map(cloneValue)
  const cloned = {}
  for (const [key, item] of Object.entries(value))
    cloned[key] = cloneValue(item)
  return cloned
}

// Copies the definition in `afterData` into every instance of `blockId` in
// `blocks`. `beforeData` is the definition the instances had, used to remove
// query items the new definition dropped and to find publication selections.
// With `blockRevision`, each updated instance records the revision it now
// holds.
const updateBlocksInArray = async (blocks, blockId, beforeData, afterData, {
  resolveFile = async () => null,
  warn = () => {},
  blockRevision = null,
} = {}) => {
  let touched = false
  const beforeMeta = beforeData?.meta || {}
  const afterMeta = afterData?.meta || {}
  for (const block of blocks) {
    if (block?.blockId !== blockId)
      continue

    await reconcilePublicationValues(block, beforeData, afterData, resolveFile, warn)

    for (const field of BLOCK_DEFINITION_SYNC_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(afterData, field))
        block[field] = cloneValue(afterData[field])
      else if (field !== 'content')
        delete block[field]
    }
    if (blockRevision !== null)
      block.blockRevision = blockRevision

    block.meta = block.meta || {}
    const srcMeta = afterMeta
    for (const key of Object.keys(srcMeta)) {
      if (BLOCK_META_LIBRARY_KEYS.has(key))
        continue
      block.meta[key] = block.meta[key] || {}
      const src = srcMeta[key] || {}
      const previousTemplateQueryItems = (beforeMeta[key]?.queryItems && typeof beforeMeta[key].queryItems === 'object')
        ? beforeMeta[key].queryItems
        : {}
      const nextTemplateQueryItems = (src.queryItems && typeof src.queryItems === 'object')
        ? src.queryItems
        : {}
      for (const metaKey of Object.keys(src)) {
        if (metaKey === 'queryItems') {
          const existingQueryItems = (block.meta[key].queryItems && typeof block.meta[key].queryItems === 'object')
            ? block.meta[key].queryItems
            : {}
          const deletedTemplateKeys = Object.keys(previousTemplateQueryItems)
            .filter(queryKey => !Object.prototype.hasOwnProperty.call(nextTemplateQueryItems, queryKey))
          const nextQueryItems = { ...existingQueryItems }
          for (const queryKey of deletedTemplateKeys)
            delete nextQueryItems[queryKey]
          block.meta[key].queryItems = {
            ...nextQueryItems,
            ...nextTemplateQueryItems,
          }
          continue
        }
        if (BLOCK_META_EXCLUDE_KEYS.has(metaKey))
          continue
        block.meta[key][metaKey] = src[metaKey]
      }
    }

    touched = true
  }
  return touched
}

const buildPageBlockUpdate = async (pageData, blockId, beforeData, afterData, options) => {
  const pageContent = Array.isArray(pageData.content) ? [...pageData.content] : []
  const pagePostContent = Array.isArray(pageData.postContent) ? [...pageData.postContent] : []

  const contentTouched = await updateBlocksInArray(pageContent, blockId, beforeData, afterData, options)
  const postContentTouched = await updateBlocksInArray(pagePostContent, blockId, beforeData, afterData, options)

  return {
    touched: contentTouched || postContentTouched,
    content: pageContent,
    postContent: pagePostContent,
  }
}

const getNextVersion = (value) => {
  const numericVersion = Number(value)
  if (!Number.isFinite(numericVersion))
    return 1
  return Math.max(0, Math.trunc(numericVersion)) + 1
}

// Key-order independent serialization, so re-saving the same definition with
// reordered keys compares equal.
const canonicalJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value && typeof value === 'object') {
    const plain = typeof value.toJSON === 'function' ? value.toJSON() : value
    if (plain !== value)
      return canonicalJson(plain)
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

// The parts of a library block that updateBlocksInArray and publication value
// reconciliation read. blockUpdatedAt is excluded: the page editor stamps it on
// every inline save, and it carries no definition of its own. Per-entry meta
// keys that instances keep for themselves (BLOCK_META_EXCLUDE_KEYS) and the
// library-only entries (BLOCK_META_LIBRARY_KEYS) are excluded too.
const propagatedBlockDefinition = (data) => {
  const definition = {}
  for (const field of BLOCK_DEFINITION_SYNC_FIELDS) {
    if (field !== 'blockUpdatedAt')
      definition[field] = data?.[field]
  }
  const meta = {}
  for (const [key, entry] of Object.entries(data?.meta || {})) {
    if (BLOCK_META_LIBRARY_KEYS.has(key))
      continue
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      meta[key] = Object.fromEntries(Object.entries(entry).filter(([metaKey]) => !BLOCK_META_EXCLUDE_KEYS.has(metaKey)))
    }
    else {
      meta[key] = entry
    }
  }
  definition.meta = meta
  return definition
}

const blockDefinitionChanged = (beforeData, afterData) =>
  canonicalJson(propagatedBlockDefinition(beforeData)) !== canonicalJson(propagatedBlockDefinition(afterData))

// Every document that may hold an instance of `blockId`: drafts and published
// copies of pages and posts on every site, plus the templates site's drafts.
// Published template-site copies are never updated. Sorted by path, so the
// list (and a checksum of it) is stable. With `includeData`, each target also
// carries the document's data (for checks; never stored). With `siteIds`,
// only those sites are planned (a site-scoped canary release).
const planBlockTargets = async (db, orgId, blockId, { includeData = false, siteIds: onlySiteIds = null } = {}) => {
  const orgRef = db.collection('organizations').doc(orgId)
  let siteIds
  if (Array.isArray(onlySiteIds)) {
    siteIds = [...onlySiteIds]
  }
  else {
    const sites = await orgRef.collection('sites').get()
    siteIds = sites.docs.map(doc => doc.id)
    if (!siteIds.includes('templates'))
      siteIds.push('templates')
  }

  const targets = []
  for (const siteId of siteIds) {
    const isTemplates = siteId === 'templates'
    const collections = isTemplates
      ? ['pages', 'posts']
      : ['pages', 'published', 'posts', 'published_posts']
    for (const collection of collections) {
      const snap = await orgRef.collection('sites').doc(siteId).collection(collection)
        .where('blockIds', 'array-contains', blockId)
        .get()
      for (const doc of snap.docs) {
        const target = {
          path: `organizations/${orgId}/sites/${siteId}/${collection}/${doc.id}`,
          siteId,
          collection,
          docId: doc.id,
        }
        if (includeData)
          target.data = doc.data() || {}
        targets.push(target)
      }
    }
  }
  return targets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const hasInstanceAtRevision = (pageData, blockId, blockRevision) => {
  const instances = [
    ...(Array.isArray(pageData.content) ? pageData.content : []),
    ...(Array.isArray(pageData.postContent) ? pageData.postContent : []),
  ].filter(block => block?.blockId === blockId)
  return instances.length > 0 && instances.every(block => block.blockRevision === blockRevision)
}

// Applies a block definition to one document inside `transaction`. Reads come
// first (the document and any publication files), then writes:
// - the document's content, and a new version for pages;
// - for published pages, the pageVersions maps the renderer's caches use.
// Returns 'updated', 'skipped' (no instance, or already at `blockRevision`) or
// 'missing'.
const applyBlockToDocument = async (transaction, db, {
  orgId,
  target,
  blockId,
  beforeData,
  afterData,
  blockRevision = null,
  warn = () => {},
}) => {
  const orgRef = db.collection('organizations').doc(orgId)
  const siteRef = orgRef.collection('sites').doc(target.siteId)
  const docRef = siteRef.collection(target.collection).doc(target.docId)
  const currentDoc = await transaction.get(docRef)
  if (!currentDoc.exists)
    return 'missing'
  const pageData = currentDoc.data() || {}
  if (blockRevision !== null && hasInstanceAtRevision(pageData, blockId, blockRevision))
    return 'skipped'

  const publications = new Map()
  const resolveFile = (reference) => {
    if (!publications.has(reference))
      publications.set(reference, resolvePublicationFile(transaction, orgRef, reference))
    return publications.get(reference)
  }
  const { touched, content, postContent } = await buildPageBlockUpdate(pageData, blockId, beforeData, afterData, { resolveFile, warn, blockRevision })
  if (!touched)
    return 'skipped'

  const update = {}
  if (Array.isArray(pageData.content))
    update.content = content
  if (Array.isArray(pageData.postContent))
    update.postContent = postContent
  const isPage = target.collection === 'pages' || target.collection === 'published'
  if (isPage)
    update.version = getNextVersion(pageData.version)
  transaction.update(docRef, update)

  if (target.collection === 'published') {
    const versionMap = { pageVersions: { [target.docId]: update.version } }
    transaction.set(siteRef, versionMap, { merge: true })
    transaction.set(orgRef.collection('published-site-settings').doc(target.siteId), versionMap, { merge: true })
  }
  return 'updated'
}

module.exports = {
  BLOCK_DEFINITION_SYNC_FIELDS,
  BLOCK_META_EXCLUDE_KEYS,
  applyBlockToDocument,
  blockDefinitionChanged,
  buildPageBlockUpdate,
  canonicalJson,
  cloneValue,
  getNextVersion,
  planBlockTargets,
  propagatedBlockDefinition,
  updateBlocksInArray,
}
