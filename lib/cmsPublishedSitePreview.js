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

const normalizePublishedDomain = (value) => {
  const domain = String(value || '').trim().toLowerCase().replace(/\.+$/g, '')
  // Domains are hostnames, not URLs, paths or credentials.
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain) ? domain : ''
}

// Recorded connection/DNS readiness, not a new uptime probe. Draft settings
// must never select the public destination. Unknown readiness fails closed.
export function getCmsPublishedSiteOrigin(settings, registry, { orgId, siteId } = {}) {
  if (!orgId || !siteId || ['new', 'templates'].includes(siteId))
    return ''
  const domains = [...new Set((Array.isArray(settings?.domains) ? settings.domains : []).map(normalizePublishedDomain).filter(Boolean))]
  const canonical = normalizePublishedDomain(settings?.canonicalDomain)
  if (settings?.canonicalDomain && !canonical)
    return ''
  const apex = domain => domain.replace(/^www\./, '')
  const candidates = canonical ? domains.filter(domain => apex(domain) === apex(canonical)) : domains
  for (const domain of candidates) {
    const record = registry?.[domain]
    if (record?.orgId !== orgId || record?.siteId !== siteId || record?.dnsSyncSucceeded !== true || record?.dnsSyncError)
      continue
    const hostname = settings?.forwardApex !== false ? `www.${apex(domain)}` : (canonical || domain)
    const variant = hostname.startsWith('www.') ? 'www' : 'apex'
    if (record[`${variant}Added`] !== true || record[`${variant}Error`] || record.dnsRecords?.[variant]?.error)
      continue
    return `https://${hostname}`
  }
  return ''
}

export function buildCmsPublishedPageUrl(frontendUrl, siteId, orgId, { origin = '', route } = {}) {
  if (route === null || route === undefined)
    return ''
  // Share route validation with the renderer fallback. A configured renderer
  // isn't required when a ready public domain exists.
  const validated = buildCmsSitePreviewUrl('https://route-validation.invalid/', siteId, orgId, { route })
  if (!validated)
    return ''
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) {
      const path = new URL(validated).searchParams.get('route')
      url.pathname = path === '/' ? '/' : `/${path}/`
      return url.href
    }
  }
  catch {
    // Unknown/failed domain setup keeps the existing published preview URL.
  }
  return buildCmsSitePreviewUrl(frontendUrl, siteId, orgId, { route })
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
