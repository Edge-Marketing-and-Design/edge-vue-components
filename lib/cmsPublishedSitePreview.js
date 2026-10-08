export function buildCmsSitePreviewUrl(frontendUrl, siteId, orgId, { draft = false, route = null } = {}) {
  const base = String(frontendUrl || '').trim()
  const id = String(siteId || '').trim()
  const organization = String(orgId || '').trim()
  if (!base || !organization || !id || ['new', 'templates'].includes(id))
    return ''
  try {
    const url = new URL(base)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return ''
    url.searchParams.set('siteId', `${organization}-${id}`)
    url.searchParams.delete('preview')
    url.searchParams.delete('route')
    if (draft)
      url.searchParams.set('preview', 'true')
    if (route !== null) {
      const path = String(route || '')
      const segments = path.replace(/^\//, '').replace(/\/$/, '').split('/')
      if (path !== '/' && segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\?#:%\s\x00-\x1F\x7F]/.test(segment)))
        return ''
      url.searchParams.set('route', path === '/' ? '/' : segments.map(segment => encodeURIComponent(segment)).join('/'))
    }
    url.hash = ''
    return url.href
  }
  catch {
    return ''
  }
}

export function buildPublishedSitePreviewUrl(frontendUrl, siteId, orgId) {
  return buildCmsSitePreviewUrl(frontendUrl, siteId, orgId)
}

// Resolve against the selected saved menu version, not editor memory. Published
// links keep the old route when a draft renames or moves the same page.
export function findCmsPageRoute(menus, pageId) {
  if (!pageId || !menus || typeof menus !== 'object')
    return null
  const slug = value => String(value || '').trim().toLowerCase()
  const visit = (items, folders) => {
    if (!Array.isArray(items))
      return null
    for (const entry of items) {
      if (entry?.item === pageId) {
        const name = slug(entry.name)
        if (!name)
          continue
        return !folders.length && name === 'home' ? '/' : [...folders, name].join('/')
      }
      if (entry?.item && typeof entry.item === 'object' && !Array.isArray(entry.item) && entry.item.type !== 'external') {
        for (const [folder, children] of Object.entries(entry.item)) {
          const route = visit(children, [...folders, slug(folder)])
          if (route !== null)
            return route
        }
      }
    }
    return null
  }
  for (const [menu, items] of Object.entries(menus)) {
    const route = visit(items, ['Site Root', 'Not In Menu'].includes(menu) ? [] : [slug(menu)])
    if (route !== null)
      return route
  }
  return null
}
