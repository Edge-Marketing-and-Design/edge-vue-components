// Pure helpers for how a published site maps to URLs. Kept apart from
// export-site.mjs so edge/tests/siteExport.test.mjs can hold them to the
// Hub's own rules (edge/lib/cmsPostRoutes.js, edge/lib/cmsPostTypes.js).
export const slug = value => String(value || '').trim().toLowerCase()
const isExternal = entry => entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'

// Menus give every page its path: folders add a segment, the menu name does not.
export const pagePathsFromMenus = (menus) => {
  const paths = {}
  const walk = (items, folders) => {
    for (const entry of items || []) {
      if (isExternal(entry))
        continue
      if (typeof entry?.item === 'string') {
        const name = slug(entry.name)
        if (!name)
          continue
        const segments = [...folders, name]
        paths[entry.item] = segments.length === 1 && name === 'home' ? '/' : `/${segments.map(encodeURIComponent).join('/')}/`
        continue
      }
      if (entry?.item && typeof entry.item === 'object') {
        for (const [folder, nested] of Object.entries(entry.item)) {
          if (Array.isArray(nested))
            walk(nested, [...folders, slug(folder)])
        }
      }
    }
  }
  for (const items of Object.values(menus || {}))
    walk(items, [])
  return paths
}

export const postTypeKey = (id) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let buffer = 0
  let bits = 0
  let encoded = ''
  for (const byte of new TextEncoder().encode(String(id))) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += alphabet[(buffer >>> bits) & 31]
    }
    buffer &= (1 << bits) - 1
  }
  if (bits)
    encoded += alphabet[(buffer << (5 - bits)) & 31]
  return `custom-${encoded}`
}

// A post's detail URL under its post template page (cmsPostRoutes.buildCmsPostLiveUrl).
export const postDetailPath = (templatePath, name) => templatePath === '/' ? `/${encodeURIComponent(name)}/` : `${templatePath}${encodeURIComponent(name)}/`

// Cloudflare's email obfuscation: the first byte is the XOR key.
export const cfEmail = (hex) => {
  const key = Number.parseInt(hex.slice(0, 2), 16)
  let email = ''
  for (let i = 2; i < hex.length; i += 2)
    email += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key)
  return email
}
