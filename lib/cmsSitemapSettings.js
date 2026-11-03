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
      }
    }),
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
