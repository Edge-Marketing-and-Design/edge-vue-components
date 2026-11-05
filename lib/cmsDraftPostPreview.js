import { resolveDataSource } from '@edgedev/template-engine'

export const draftPostPreviewContext = (page, pageId, orgId, siteId) => {
  if (page?.post !== true || page?.postType?.enabled !== true || !pageId || !orgId || !siteId || siteId === 'templates')
    return null
  return { postTypeId: pageId, orgId, siteId }
}

export const isDraftPostPreviewSource = (source, context) => Boolean(context?.postTypeId && ['post', 'posts'].includes(source?.collection?.path || source?.path))

const valueAt = (record, path) => String(path).split('.').reduce((value, key) => value?.[key], record)
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// A read-only local KV view lets the engine retain its normal query, ordering,
// canonical lookup and limit rules without reading published KV or changing blocks.
export const resolveDraftPostPreviewSource = async (name, source, context, posts = {}) => {
  if (!isDraftPostPreviewSource(source, context))
    return null
  const scope = `${context.orgId}:${context.siteId}`
  const collection = { ...(source.collection || {}) }
  for (const key of ['path', 'uniqueKey', 'query', 'order', 'canonicalLookup', 'orgLevel']) {
    if (source[key] !== undefined && collection[key] === undefined)
      collection[key] = source[key]
  }
  if ((collection.uniqueKey && collection.uniqueKey !== scope) || collection.orgLevel)
    return []
  collection.uniqueKey = scope
  const path = collection.path
  const records = new Map()
  const keys = []
  for (const [docId, post] of Object.entries(posts || {})) {
    if (post?.postTypeId !== context.postTypeId)
      continue
    const canonical = `${path}:${scope}:${docId}`
    const record = { ...post, docId, canonical }
    records.set(canonical, JSON.stringify(record))
    keys.push({ name: canonical, metadata: record })
    for (const field of Object.keys(source.queryItems || {})) {
      const value = valueAt(record, field)
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null)
          keys.push({ name: `idx:${path}:${field}:${scope}:${slug(item)}:${docId}`, metadata: record })
      }
    }
  }
  const binding = {
    async get(key) {
      if (Array.isArray(key))
        return new Map(key.map(item => [item, records.get(item) || null]))
      return records.get(key) || null
    },
    async list({ prefix = '' }) {
      return { keys: keys.filter(key => key.name.startsWith(prefix)), list_complete: true }
    },
  }
  return resolveDataSource({
    name,
    source: { collection, queryItems: source.queryItems, queryOptions: source.queryOptions, limit: source.limit, value: [], canonical: true },
    uniqueKey: scope,
    clientOptions: { binding, accountId: '', namespaceId: '', apiToken: '', maxKeys: Math.max(1000, keys.length) },
  })
}
