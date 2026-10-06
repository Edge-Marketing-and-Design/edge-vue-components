export function buildPublishedSitePreviewUrl(frontendUrl, siteId) {
  const base = String(frontendUrl || '').trim()
  const id = String(siteId || '').trim()
  if (!base || !id || ['new', 'templates'].includes(id))
    return ''
  try {
    const url = new URL(base)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return ''
    url.searchParams.set('siteId', id)
    url.hash = ''
    return url.href
  }
  catch {
    return ''
  }
}
