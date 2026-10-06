const CLOUDFLARE_STREAM_HOST_RE = /(^|\.)(cloudflarestream\.com|videodelivery\.net)$/i

const getPlaybackUrl = (playback, key) => {
  if (!playback || typeof playback !== 'object' || Array.isArray(playback))
    return ''
  return String(playback[key] || '').trim()
}

const getTrustedStreamUrl = (value) => {
  const raw = String(value || '').trim()
  if (!raw)
    return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !CLOUDFLARE_STREAM_HOST_RE.test(url.hostname))
      return null
    return url
  }
  catch {
    return null
  }
}

export const getCloudflareVideoEmbedUrl = (item) => {
  const previewUrl = getTrustedStreamUrl(item?.cloudflareVideoPreview)
  if (previewUrl) {
    if (/\/iframe\/?$/i.test(previewUrl.pathname))
      return previewUrl.toString()
    if (/\/watch\/?$/i.test(previewUrl.pathname)) {
      previewUrl.pathname = previewUrl.pathname.replace(/\/watch\/?$/i, '/iframe')
      return previewUrl.toString()
    }
  }

  const videoId = String(item?.cloudflareVideoId || '').trim()
  if (!videoId)
    return ''

  const assetUrl = [
    item?.cloudflareVideoPreview,
    item?.cloudflareVideoThumbnail,
    getPlaybackUrl(item?.cloudflareVideoPlayback, 'hls'),
    getPlaybackUrl(item?.cloudflareVideoPlayback, 'dash'),
  ].map(getTrustedStreamUrl).find(Boolean)

  if (!assetUrl)
    return ''

  return `${assetUrl.origin}/${encodeURIComponent(videoId)}/iframe`
}

const escapeHtmlAttribute = value => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export const buildCloudflareVideoIframe = (item) => {
  const src = getCloudflareVideoEmbedUrl(item)
  if (!src)
    return ''
  const title = String(item?.name || item?.fileName || 'Video').trim() || 'Video'
  return `<iframe src="${escapeHtmlAttribute(src)}" title="${escapeHtmlAttribute(title)}" width="100%" height="100%" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
}

export const getCloudflareVideoIframeSrc = (value) => {
  const match = String(value || '').match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i)
  const src = String(match?.[2] || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
  return getTrustedStreamUrl(src)?.toString() || ''
}
