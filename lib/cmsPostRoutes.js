const normalizePathSlug = value => String(value || '').trim().toLowerCase()

const isExternalMenuLink = entry => entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'

const isPostRendererBlock = (block) => {
  if (!block || typeof block !== 'object')
    return false

  const template = String(block.template || block.content || '')
  const hasPostCollection = Object.values(block.dataSources || {}).some(source => (
    source?.type === 'collection' && String(source?.path || '').trim() === 'posts'
  ))
  return template.includes('#renderBlocks') && hasPostCollection
}

export const isCmsPostRoutePage = (pageDoc) => {
  if (!pageDoc || typeof pageDoc !== 'object' || pageDoc.post !== true)
    return false
  return Array.isArray(pageDoc.postContent) && pageDoc.postContent.some(isPostRendererBlock)
}

const getFirstFolderEntry = (entry) => {
  if (!entry?.item || typeof entry.item !== 'object' || isExternalMenuLink(entry))
    return null
  for (const [folderSlug, nestedItems] of Object.entries(entry.item || {})) {
    if (Array.isArray(nestedItems))
      return { folderSlug, nestedItems }
  }
  return null
}

export const findFirstCmsPostRouteSegments = (menus, pagesById, folderSlugs = []) => {
  for (const menuItems of Object.values(menus || {})) {
    if (!Array.isArray(menuItems))
      continue
    for (const entry of menuItems) {
      if (isExternalMenuLink(entry))
        continue
      if (typeof entry?.item === 'string') {
        const pageSlug = normalizePathSlug(entry?.name)
        if (!pageSlug)
          continue
        const pageDoc = pagesById?.[entry.item]
        if (isCmsPostRoutePage(pageDoc))
          return [...folderSlugs, pageSlug]
        continue
      }
      const folderEntry = getFirstFolderEntry(entry)
      if (!folderEntry)
        continue
      const folderSlug = normalizePathSlug(folderEntry.folderSlug)
      if (!folderSlug)
        continue
      const nested = findFirstCmsPostRouteSegments({ [folderEntry.folderSlug]: folderEntry.nestedItems }, pagesById, [...folderSlugs, folderSlug])
      if (nested.length)
        return nested
    }
  }
  return []
}

export const buildCmsPostLiveUrl = ({ origin, routeSegments, postSlug }) => {
  const normalizedOrigin = String(origin || '').replace(/\/+$/g, '')
  const normalizedPostSlug = String(postSlug || '').trim()
  if (!normalizedOrigin || !normalizedPostSlug || !Array.isArray(routeSegments) || !routeSegments.length)
    return ''

  const encodedPostSlug = encodeURIComponent(normalizedPostSlug)
  if (routeSegments.length === 1 && routeSegments[0] === 'home')
    return `${normalizedOrigin}/${encodedPostSlug}/`

  const encodedPath = routeSegments.map(segment => encodeURIComponent(segment)).join('/')
  return `${normalizedOrigin}/${encodedPath}/${encodedPostSlug}/`
}
