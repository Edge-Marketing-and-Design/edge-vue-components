// Edge Media only makes Cloudflare Images versions of these formats. Other
// images (SVG, AVIF) are always served from R2 as uploaded.
const optimizableImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const optimizableImageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp']

// How long after an upload (or a retry request) an image without Cloudflare
// Images versions counts as still optimizing. After this the job is treated as
// stalled, and older uploads without versions predate Edge Media.
export const MEDIA_IMAGE_OPTIMIZATION_WINDOW_MS = 30 * 60 * 1000

const toText = value => String(value || '').trim()

const getMediaExtension = (item) => {
  const candidates = [item?.fileName, item?.name, toText(item?.r2URL || item?.r2Url).split('?')[0]]
  for (const candidate of candidates) {
    const match = toText(candidate).toLowerCase().match(/\.([a-z0-9]+)$/i)
    if (match?.[1])
      return match[1]
  }
  return ''
}

const hasUrl = (values) => {
  if (Array.isArray(values))
    return values.some(value => toText(value))
  if (values && typeof values === 'object')
    return Object.values(values).some(value => toText(value))
  return false
}

export const hasMediaImageOptimizedUrl = item =>
  hasUrl(item?.cloudflareImageVariants) || hasUrl(item?.edgeMediaImageState?.outputs?.image?.variants)

// True while an image's Cloudflare Images versions are expected but not ready
// yet. Pickers must not fall back to the R2 original during this time, or the
// page keeps the unoptimized file after the versions arrive.
export const isMediaImageOptimizing = (item, now = Date.now()) => {
  if (!item || hasMediaImageOptimizedUrl(item))
    return false

  const contentType = toText(item.contentType).toLowerCase()
  if (!optimizableImageTypes.includes(contentType) && !optimizableImageExtensions.includes(getMediaExtension(item)))
    return false

  const status = toText(item.edgeMediaImageState?.status).toLowerCase()
  if (status === 'failed' || status === 'complete')
    return false

  const startedAt = Math.max(Number(item.uploadTime) || 0, Number(item.edgeMediaImageState?.retryRequestedAt) || 0)
  if (!startedAt)
    return !!status
  return now - startedAt < MEDIA_IMAGE_OPTIMIZATION_WINDOW_MS
}

export const useMediaImageReadiness = () => ({
  hasMediaImageOptimizedUrl,
  isMediaImageOptimizing,
})
