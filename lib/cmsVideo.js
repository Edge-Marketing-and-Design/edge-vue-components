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

export const getCloudflareVideoIframeSrc = (value) => {
  const match = String(value || '').match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i)
  const src = String(match?.[2] || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
  return getTrustedStreamUrl(src)?.toString() || ''
}

// Playback options an editor can choose in the block video picker. They are
// stored inside the value itself (Stream iframe URL parameters plus a
// data-cms-video attribute), so templates need no new fields or schema.
export const VIDEO_LAYOUTS = ['player', 'background']

export const DEFAULT_VIDEO_OPTIONS = Object.freeze({
  layout: 'player',
  autoplay: false,
  sound: true,
  loop: false,
  controls: true,
  startTime: 0,
  posterTime: null,
})

const toSeconds = (value) => {
  if (value === null || value === undefined || value === '')
    return null
  const number = Number(String(value).replace(/s$/i, ''))
  if (!Number.isFinite(number) || number < 0)
    return null
  return Math.round(number * 10) / 10
}

// Background videos are decorative: always muted, looping, autoplaying and
// without controls. Browsers also refuse to autoplay a video with sound.
export const normalizeCloudflareVideoOptions = (options = {}) => {
  const layout = VIDEO_LAYOUTS.includes(options?.layout) ? options.layout : DEFAULT_VIDEO_OPTIONS.layout
  const normalized = {
    layout,
    autoplay: Boolean(options?.autoplay ?? DEFAULT_VIDEO_OPTIONS.autoplay),
    sound: Boolean(options?.sound ?? DEFAULT_VIDEO_OPTIONS.sound),
    loop: Boolean(options?.loop ?? DEFAULT_VIDEO_OPTIONS.loop),
    controls: Boolean(options?.controls ?? DEFAULT_VIDEO_OPTIONS.controls),
    startTime: toSeconds(options?.startTime) || 0,
    posterTime: toSeconds(options?.posterTime),
  }
  if (layout === 'background') {
    normalized.autoplay = true
    normalized.sound = false
    normalized.loop = true
    normalized.controls = false
  }
  return normalized
}

const getStreamBase = (embedUrl) => {
  const url = getTrustedStreamUrl(embedUrl)
  if (!url)
    return null
  const match = url.pathname.match(/^\/([^/]+)\/iframe\/?$/i)
  if (!match)
    return null
  return { origin: url.origin, videoId: decodeURIComponent(match[1]) }
}

export const buildCloudflareVideoEmbedUrl = (embedUrl, options = {}) => {
  const base = getStreamBase(embedUrl)
  if (!base)
    return ''
  const opts = normalizeCloudflareVideoOptions(options)
  const url = new URL(`${base.origin}/${encodeURIComponent(base.videoId)}/iframe`)
  if (opts.autoplay) {
    url.searchParams.set('autoplay', 'true')
    url.searchParams.set('preload', 'auto')
  }
  if (!opts.sound)
    url.searchParams.set('muted', 'true')
  if (opts.loop)
    url.searchParams.set('loop', 'true')
  if (!opts.controls)
    url.searchParams.set('controls', 'false')
  if (opts.startTime > 0)
    url.searchParams.set('startTime', `${opts.startTime}s`)
  if (opts.posterTime !== null) {
    const poster = new URL(`${base.origin}/${encodeURIComponent(base.videoId)}/thumbnails/thumbnail.jpg`)
    poster.searchParams.set('time', `${opts.posterTime}s`)
    poster.searchParams.set('height', '720')
    url.searchParams.set('poster', poster.toString())
  }
  if (opts.layout === 'background')
    url.searchParams.set('letterboxColor', 'transparent')
  return url.toString()
}

const readFlag = (params, key) => {
  if (!params.has(key))
    return null
  return params.get(key) !== 'false'
}

export const getCloudflareVideoOptions = (value) => {
  const html = String(value || '')
  const src = getCloudflareVideoIframeSrc(html)
  if (!src)
    return { ...DEFAULT_VIDEO_OPTIONS }
  const params = new URL(src).searchParams
  const layoutMatch = html.match(/\bdata-cms-video\s*=\s*(["'])(.*?)\1/i)
  let posterTime = null
  if (params.get('poster')) {
    try {
      posterTime = toSeconds(new URL(params.get('poster')).searchParams.get('time'))
    }
    catch {
      posterTime = null
    }
  }
  return normalizeCloudflareVideoOptions({
    layout: layoutMatch?.[2],
    autoplay: readFlag(params, 'autoplay') ?? false,
    sound: !(readFlag(params, 'muted') ?? false),
    loop: readFlag(params, 'loop') ?? false,
    controls: readFlag(params, 'controls') ?? true,
    startTime: params.get('startTime'),
    posterTime,
  })
}

// Runs on the public site (the renderer executes scripts in block HTML once per
// route). It stops any picked video that becomes hidden, such as a pop-up
// closed without pausing, by reloading its player (checked again after a
// fade-out), and keeps background videos
// still for visitors who ask for reduced motion. One copy runs per page however
// many videos the page has. Keep it free of "</" so it stays valid inline.
// eslint-disable-next-line @typescript-eslint/quotes -- the script uses single quotes
export const CMS_VIDEO_GUARD_SCRIPT = `(function(){var w=window;if(w.__cmsVideoGuard){w.__cmsVideoGuard.scan();return}var seen=new WeakSet(),shown=new WeakSet(),io=null;function hidden(f){if(typeof f.checkVisibility==='function')return!f.checkVisibility({visibilityProperty:true,opacityProperty:true});return f.getClientRects().length===0}function stop(f){if(!shown.has(f)||f.getAttribute('data-cms-video')==='background')return;shown.delete(f);var s=f.getAttribute('src');if(s){f.setAttribute('src','about:blank');f.setAttribute('src',s)}}function check(){document.querySelectorAll('iframe[data-cms-video]').forEach(function(f){if(hidden(f))stop(f);else shown.add(f)})}function calm(f){if(f.getAttribute('data-cms-video')!=='background')return;if(!w.matchMedia||!w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;try{var u=new URL(f.getAttribute('src'));if(u.searchParams.get('autoplay')==='true'){u.searchParams.delete('autoplay');f.setAttribute('src',u.toString())}}catch(e){}}function scan(){if(!io&&'IntersectionObserver' in w)io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)shown.add(e.target);else if(hidden(e.target))stop(e.target)})});document.querySelectorAll('iframe[data-cms-video]').forEach(function(f){if(seen.has(f))return;seen.add(f);calm(f);if(io)io.observe(f)})}function later(){setTimeout(check,50);setTimeout(check,700)}w.__cmsVideoGuard={scan:scan,check:check};w.addEventListener('hashchange',later);document.addEventListener('click',later,true);document.addEventListener('keyup',function(e){if(e.key==='Escape')later()});document.addEventListener('close',later,true);scan()})();`

const BACKGROUND_WRAPPER_STYLE = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;container-type:size;'
const BACKGROUND_IFRAME_STYLE = 'position:absolute;top:50%;left:50%;width:max(100%,177.78cqh);height:max(100%,56.25cqw);transform:translate(-50%,-50%);border:0;'

const renderVideoMarkup = ({ src, title, options }) => {
  const opts = normalizeCloudflareVideoOptions(options)
  const guard = `<script data-cms-video-guard>${CMS_VIDEO_GUARD_SCRIPT}</script>`
  if (opts.layout === 'background') {
    return `<div data-cms-video-background style="${BACKGROUND_WRAPPER_STYLE}" aria-hidden="true"><iframe data-cms-video="background" src="${escapeHtmlAttribute(src)}" title="${escapeHtmlAttribute(title)}" tabindex="-1" style="${BACKGROUND_IFRAME_STYLE}" allow="autoplay; encrypted-media" loading="eager"></iframe></div>${guard}`
  }
  return `<iframe data-cms-video="player" src="${escapeHtmlAttribute(src)}" title="${escapeHtmlAttribute(title)}" width="100%" height="100%" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="${opts.autoplay ? 'eager' : 'lazy'}"></iframe>${guard}`
}

export const buildCloudflareVideoIframe = (item, options = {}) => {
  const src = buildCloudflareVideoEmbedUrl(getCloudflareVideoEmbedUrl(item), options)
  if (!src)
    return ''
  const title = String(item?.name || item?.fileName || 'Video').trim() || 'Video'
  return renderVideoMarkup({ src, title, options })
}

// Rebuilds a stored value with new playback options, keeping its video and title.
export const applyCloudflareVideoOptions = (value, options = {}) => {
  const html = String(value || '')
  const current = getCloudflareVideoIframeSrc(html)
  const src = buildCloudflareVideoEmbedUrl(current, options)
  if (!src)
    return html
  const titleMatch = html.match(/<iframe\b[^>]*\btitle\s*=\s*(["'])(.*?)\1/i)
  const title = String(titleMatch?.[2] || 'Video')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&') || 'Video'
  return renderVideoMarkup({ src, title, options })
}
