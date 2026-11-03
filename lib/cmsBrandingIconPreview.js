// Mirror clearwater-cms-front useSiteBrandingHead.ts and shared/siteAppIcons.js.
// The two consumers deliberately use different Cloudflare URL transformations.
const FLEXIBLE_VARIANT_ACCOUNTS = ['h7EjKG0X9kOxmLp41mxOng']
const clean = value => typeof value === 'string' ? value.trim() : ''

function previewUrl(source, frontendUrl) {
  try {
    const url = new URL(source, frontendUrl || undefined)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  }
  catch { return '' }
}

function appImage(source) {
  try {
    const url = new URL(source)
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'imagedelivery.net' || url.search || url.hash || parts.length !== 3 || !FLEXIBLE_VARIANT_ACCOUNTS.includes(parts[0]))
      return null
    return { origin: url.origin, account: parts[0], imageId: parts[1] }
  }
  catch { return null }
}

export function buildCmsBrandingIconPreview(settings = {}, frontendUrl = '') {
  const logo = clean(settings.logo) || '/images/logo.png'
  const favicon = clean(settings.favicon) || logo
  const appIcon = clean(settings.appIcon)
  const image = appImage(appIcon)
  const sourceLabel = clean(settings.favicon) ? 'Favicon' : clean(settings.logo) ? 'Dark logo (no favicon selected)' : 'Renderer default logo'
  const icons = [16, 32, 48, 96, 180].map(size => {
    const usesAppIcon = size === 180 && Boolean(appIcon)
    const iconSource = usesAppIcon ? appIcon : favicon
    let src = iconSource
    let transformed = false
    let treatment = 'Original image · No generated resize'
    if (usesAppIcon && image) {
      src = `${image.origin}/${image.account}/${image.imageId}/width=180,height=180,fit=pad,background=white,format=jpeg,quality=90`
      transformed = true
      treatment = 'JPEG · Padded square · White background · Quality 90'
    }
    // Match the public renderer's favicon builder, including existing queries.
    else if (!usesAppIcon && iconSource.includes('imagedelivery.net/')) {
      try {
        const url = new URL(iconSource)
        for (const [key, value] of Object.entries({ width: size, height: size, fit: 'cover', format: 'png', quality: 90 }))
          url.searchParams.set(key, String(value))
        src = url.toString()
        transformed = true
        treatment = 'PNG · Cover crop · Quality 90'
      }
      catch { /* The renderer also leaves invalid sources unchanged. */ }
    }
    return {
      id: `favicon-${size}`, group: 'favicons', size,
      label: size === 180 ? 'Apple touch icon' : 'Browser favicon',
      sourceLabel: usesAppIcon ? 'App icon' : sourceLabel, url: previewUrl(src, frontendUrl), transformed,
      treatment,
    }
  })
  // The public renderer may fall back to logo; the CMS preview intentionally
  // requires explicit app artwork so editors are prompted to choose it.
  if (!appIcon)
    return icons
  const appSourceLabel = 'App icon'
  if (image) {
    for (const size of [192, 512]) {
      icons.push({
        id: `app-${size}`, group: 'app', size, label: 'Installed-app icon', sourceLabel: appSourceLabel,
        url: `${image.origin}/${image.account}/${image.imageId}/width=${size},height=${size},fit=pad,background=white,format=jpeg,quality=90`,
        transformed: true, treatment: 'JPEG · Padded square · White background · Quality 90',
      })
    }
  }
  else {
    icons.push({ id: 'app-original', group: 'app', size: null, label: 'Installed-app icon', sourceLabel: appSourceLabel,
      url: previewUrl(appIcon, frontendUrl), transformed: false, treatment: 'Original image · Any size · No generated resize' })
  }
  return icons
}
