// Short-lived preview tokens for the Hub's page preview route
// (/cms-preview-render/:siteId/:pageId). A token is an HMAC-SHA256 over one
// organization, site, page and source (draft or published) with an expiry,
// signed with CMS_PREVIEW_TOKEN_SECRET. It lets a browser that isn't signed
// in to the Hub (an agent checking its work, the thumbnail renderer) load one
// page's preview until it expires. Without the secret no token can be issued
// or accepted, and only signed-in Hub users can preview.
// Keep identical to edge/functions/cmsPreviewTokens.js.
const { createHmac, timingSafeEqual } = require('node:crypto')

const DEFAULT_TTL_SECONDS = 15 * 60
const MAX_TTL_SECONDS = 60 * 60
const MIN_SECRET_LENGTH = 32

const secret = () => {
  const value = String(process.env.CMS_PREVIEW_TOKEN_SECRET || '')
  return value.length >= MIN_SECRET_LENGTH ? value : ''
}

const previewTokensEnabled = () => !!secret()

const sign = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url')

// Throws when CMS_PREVIEW_TOKEN_SECRET isn't configured.
const issuePreviewToken = ({ orgId, siteId, pageId, source = 'draft', ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() }) => {
  const key = secret()
  if (!key)
    throw new Error(`Preview links need CMS_PREVIEW_TOKEN_SECRET (at least ${MIN_SECRET_LENGTH} characters) in the Functions environment.`)
  const ttl = Math.min(Math.max(Math.trunc(Number(ttlSeconds) || DEFAULT_TTL_SECONDS), 60), MAX_TTL_SECONDS)
  const expiresAt = now + ttl * 1000
  const payload = Buffer.from(JSON.stringify({ o: orgId, s: siteId, p: pageId, src: source === 'published' ? 'published' : 'draft', exp: expiresAt })).toString('base64url')
  return { token: `${payload}.${sign(payload, key)}`, expiresAt: new Date(expiresAt).toISOString() }
}

// True only for an unexpired token signed for exactly this page and source.
const verifyPreviewToken = (token, { orgId, siteId, pageId, source = 'draft', now = Date.now() }) => {
  const key = secret()
  const [payload, signature, extra] = String(token || '').split('.')
  if (!key || !payload || !signature || extra !== undefined)
    return false
  const expected = Buffer.from(sign(payload, key))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return false
  let claims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  }
  catch {
    return false
  }
  const wanted = source === 'published' ? 'published' : 'draft'
  return claims.o === orgId && claims.s === siteId && claims.p === pageId && claims.src === wanted
    && Number.isFinite(claims.exp) && claims.exp > now
}

// The Hub's origin for preview links: CMS_PREVIEW_RENDER_BASE_URL, else the
// project's default Hosting domain.
const previewBaseUrl = (projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '') => {
  const configured = String(process.env.CMS_PREVIEW_RENDER_BASE_URL || '').trim()
  try {
    if (configured) {
      const url = new URL(configured)
      if (['http:', 'https:'].includes(url.protocol))
        return `${url.protocol}//${url.host}`
    }
  }
  catch {}
  return projectId ? `https://${projectId}.web.app` : ''
}

const buildPreviewUrl = ({ baseUrl, orgId, siteId, pageId, source = 'draft', token, mode = '' }) => {
  const url = new URL(`/cms-preview-render/${encodeURIComponent(siteId)}/${encodeURIComponent(pageId)}`, baseUrl)
  url.searchParams.set('orgId', orgId)
  url.searchParams.set('token', token)
  if (source === 'published')
    url.searchParams.set('source', 'published')
  if (mode)
    url.searchParams.set('mode', mode)
  return url.toString()
}

module.exports = { DEFAULT_TTL_SECONDS, buildPreviewUrl, issuePreviewToken, previewBaseUrl, previewTokensEnabled, verifyPreviewToken }
