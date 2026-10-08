export function buildPublishedSitePreviewUrl(frontendUrl, siteId, orgId) {
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
    url.hash = ''
    return url.href
  }
  catch {
    return ''
  }
}
