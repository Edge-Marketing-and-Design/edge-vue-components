import { getPostTypes, postTypeKey } from './cmsPostTypes.js'
import { findCmsPageRoute } from './cmsPublishedSitePreview.js'

const objectPosts = value => value && typeof value === 'object' && !Array.isArray(value)
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const string = value => typeof value === 'string' ? value.trim() : ''

export const createSitemapSettings = () => ({
  collections: [],
  apis: [],
})

// Keep incomplete entries so validation can explain them rather than dropping maps.
export const normalizeSitemapSettings = (value) => {
  const source = record(value)
  return {
    collections: (Array.isArray(source.collections) ? source.collections : []).map((entry) => {
      const row = record(entry)
      return {
        collection: string(row.collection),
        fileName: string(row.fileName),
        routePrefix: string(row.routePrefix).replace(/^\/+|\/+$/g, ''),
        pathField: string(row.pathField),
        scope: row.scope ?? 'org',
        indexField: string(row.indexField) || 'name',
        ...(row.indexValue !== undefined ? { indexValue: row.indexValue } : {}),
        ...(typeof row.managedPostType === 'string' ? { managedPostType: row.managedPostType } : {}),
      }
    }),
    ...(objectPosts(source.posts) ? { posts: Object.fromEntries(Object.entries(source.posts).filter(([, enabled]) => typeof enabled === 'boolean')) } : {}),
    apis: (Array.isArray(source.apis) ? source.apis : []).map((entry) => {
      const row = record(entry)
      return { fileName: string(row.fileName), sourceUrl: string(row.sourceUrl) }
    }),
  }
}

export const validateSitemapSettings = (value) => {
  if (value == null)
    return []
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Sitemap settings must be an object.']
  const errors = []
  if (value.posts !== undefined && (!objectPosts(value.posts) || Object.values(value.posts).some(enabled => typeof enabled !== 'boolean')))
    errors.push('Post sitemap choices must be true or false.')
  if (value.collections !== undefined && !Array.isArray(value.collections))
    errors.push('Collection sitemaps must be a list.')
  if (value.apis !== undefined && !Array.isArray(value.apis))
    errors.push('API sitemaps must be a list.')
  const config = normalizeSitemapSettings(value)
  const usedNames = new Set(['sitemap.xml', 'pages_sitemap.xml'])
  const validateFileName = (fileName, label) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.xml$/.test(fileName))
      errors.push(`${label}: enter an XML filename such as products_sitemap.xml.`)
    const fileKey = fileName.toLowerCase()
    if (usedNames.has(fileKey))
      errors.push(`${label}: choose a unique filename that is not reserved for pages.`)
    usedNames.add(fileKey)
  }
  for (const [i, row] of config.collections.entries()) {
    const label = `Collection sitemap ${i + 1}`
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(row.collection))
      errors.push(`${label}: enter a collection name without slashes or spaces.`)
    validateFileName(row.fileName, label)
    if (!row.routePrefix && !row.pathField)
      errors.push(`${label}: enter a URL prefix or stored path field.`)
    if ((row.routePrefix && !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(row.routePrefix)) || row.routePrefix.includes('//'))
      errors.push(`${label}: URL prefix must be a relative path such as area-guides.`)
    if (row.pathField && !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(row.pathField))
      errors.push(`${label}: stored path field must be a field name such as slug.`)
    if (!['org', 'site'].includes(row.scope))
      errors.push(`${label}: choose organization records or site records.`)
    if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(row.indexField))
      errors.push(`${label}: enter a valid index field.`)
    if (row.indexValue !== undefined && !(typeof row.indexValue === 'string' || typeof row.indexValue === 'boolean' || (typeof row.indexValue === 'number' && Number.isFinite(row.indexValue))))
      errors.push(`${label}: index value must be text, a boolean, or a finite number.`)
  }
  for (const [i, row] of config.apis.entries()) {
    const label = `API sitemap ${i + 1}`
    validateFileName(row.fileName, label)
    try {
      const url = new URL(row.sourceUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('Invalid URL')
    }
    catch {
      errors.push(`${label}: enter an HTTPS API URL without credentials or a fragment. Query strings are supported.`)
    }
  }
  return errors
}

export const prepareSitemapSettings = (value) => {
  const errors = validateSitemapSettings(value)
  if (errors.length)
    throw new Error(errors.join(' '))
  return value == null ? null : normalizeSitemapSettings(value)
}


export const postSitemapOptions = pages => [
  { id: 'post', name: 'Default' }, { id: 'event', name: 'Event' },
  ...getPostTypes(pages).map(type => ({ id: `page:${type.id}`, pageId: type.id, name: type.name })),
]

// Recognize existing site-local post maps without writing preferences on open.
export const postSitemapOwner = (row, pages = {}) => {
  if (row?.managedPostType)
    return row.managedPostType
  if (row?.collection !== 'posts' || row.scope !== 'site' || row.indexField !== 'type' || (row.pathField && row.pathField !== 'name'))
    return ''
  const option = postSitemapOptions(pages).find(option => row.indexValue === (option.pageId ? postTypeKey(option.pageId) : option.id))
  return option?.id || ''
}

export const postSitemapChoices = (settings, pages = {}) => {
  const choices = { ...(settings?.posts || {}) }
  for (const row of settings?.collections || []) {
    const owner = postSitemapOwner(row, pages)
    if (owner && typeof choices[owner] !== 'boolean')
      choices[owner] = true
  }
  return choices
}

export const reconcilePostSitemaps = ({ settings, pages, menus }) => {
  if (settings == null || settings.posts === undefined) return prepareSitemapSettings(settings)
  const config = normalizeSitemapSettings(settings)
  config.posts = postSitemapChoices(config, pages)
  const owned = config.collections.map(row => ({ ...row, managedPostType: postSitemapOwner(row, pages) }))
  const manual = config.collections.filter((row, index) => !owned[index].managedPostType)
  const used = new Set(['sitemap.xml', 'pages_sitemap.xml', ...manual.map(row => row.fileName.toLowerCase()), ...config.apis.map(row => row.fileName.toLowerCase())])
  const pageOrder = []
  const walk = items => {
    for (const entry of Array.isArray(items) ? items : []) {
      if (typeof entry.item === 'string') pageOrder.push(entry.item)
      else if (entry.item && entry.item.type !== 'external') Object.values(entry.item).forEach(walk)
    }
  }
  Object.values(menus || {}).forEach(walk)
  const candidates = [...new Set(pageOrder)].map(id => ({ id, page: pages?.[id] })).filter(({ page }) => page?.post === true)
  const matchingKind = (page, kind) => !page.postType?.enabled && [...(page.content || []), ...(page.postContent || [])].some(block =>
    Object.entries(block.dataSources || {}).some(([name, source]) => source?.path === 'posts' && (source.queryItems?.type ?? block.meta?.[name]?.queryItems?.type ?? 'post') === kind))
  const managed = []
  for (const option of postSitemapOptions(pages)) {
    if (config.posts?.[option.id] !== true) continue
    const candidate = option.id === 'post' || option.id === 'event'
      ? candidates.find(({ page }) => matchingKind(page, option.id))
      : candidates.find(({ id, page }) => id === option.pageId && page.postType?.enabled === true)
    if (!candidate) continue
    const route = findCmsPageRoute(menus, candidate.id)
    if (route === null) continue
    const routePrefix = route.replace(/^\/+|\/+$/g, '')
    const type = option.id === 'post' || option.id === 'event' ? option.id : postTypeKey(option.pageId)
    const stem = `posts_${option.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const previous = owned.find(row => row.managedPostType === option.id)
    let fileName = previous?.fileName && !used.has(previous.fileName.toLowerCase()) ? previous.fileName : `${stem}_sitemap.xml`, suffix = 2
    while (used.has(fileName.toLowerCase())) fileName = `${stem}_${suffix++}_sitemap.xml`
    used.add(fileName.toLowerCase())
    managed.push({ collection: 'posts', scope: 'site', fileName, routePrefix, pathField: 'name', indexField: 'type', indexValue: type, managedPostType: option.id })
  }
  return prepareSitemapSettings({ ...config, collections: [...manual, ...managed] })
}
