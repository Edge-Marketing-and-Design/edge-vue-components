import { getPostTypes, postTypeKey } from './cmsPostTypes.js'
import { findCmsPageRoute } from './cmsPublishedSitePreview.js'
import { normalizeSitemapSettings, prepareSitemapSettings } from './cmsSitemapConfig.mjs'

export { createSitemapSettings, normalizeSitemapSettings, POST_SITEMAP_KEY_PATTERN, prepareSitemapSettings, validateSitemapSettings } from './cmsSitemapConfig.mjs'

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
