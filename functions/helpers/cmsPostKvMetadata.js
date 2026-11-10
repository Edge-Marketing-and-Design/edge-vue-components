// KV index metadata for published posts: the fields a post list renders
// without a canonical read. KV caps metadata at 1,024 bytes; tags are
// dropped from the end until it fits.
const MAX_KV_METADATA_BYTES = 1024
const POST_BLURB_MAX = 250

const postCanonicalKey = ({ orgId, siteId, postId }) => `posts:${orgId}:${siteId}:${postId}`
const metadataSizeBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')

const normalizePostTags = (value) => {
  if (!Array.isArray(value))
    return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    const tag = String(item || '').trim()
    if (!tag || seen.has(tag))
      continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

const fitPostTagsToMetadataBudget = ({ metadataBase, tags, canonicalKey, maxBytes = MAX_KV_METADATA_BYTES }) => {
  const normalizedTags = normalizePostTags(tags)
  if (!normalizedTags.length)
    return []

  const withAllTags = { ...metadataBase, tags: normalizedTags, canonical: canonicalKey }
  if (metadataSizeBytes(withAllTags) <= maxBytes)
    return normalizedTags

  const fitted = []
  for (const tag of normalizedTags) {
    const candidate = [...fitted, tag]
    const withCandidate = { ...metadataBase, tags: candidate, canonical: canonicalKey }
    if (metadataSizeBytes(withCandidate) > maxBytes)
      break
    fitted.push(tag)
  }
  return fitted
}

const buildPostKvMetadata = (data, params) => {
  const eventData = (data && typeof data.event === 'object') ? data.event : {}
  const metadataBase = {
    title: data?.title || '',
    blurb: data?.blurb || '',
    doc_created_at: data?.doc_created_at || '',
    featuredImage: data?.featuredImage || '',
    name: data?.name || '',
    type: (String(data?.type || 'post').trim().toLowerCase() || 'post'),
    event: {
      startAt: String(eventData.startAt || ''),
      endAt: String(eventData.endAt || ''),
      isPast: eventData.isPast === true,
      locationName: String(eventData.locationName || ''),
    },
  }
  // Lists hide the date of a post whose publication date is not public.
  if (data?.hidePublishedDate === true)
    metadataBase.hidePublishedDate = true
  if (data?.postTypeId) {
    // Only dependencies compiled from the published index are added. The complete
    // canonical post stays available through the existing canonical lookup.
    for (const path of data.postTypeProjection?.fields || []) {
      const parts = String(path).split('.')
      if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(path) || parts.some(key => ['__proto__', 'prototype', 'constructor', 'uid', 'users', 'roles', 'permissions', 'restrictionRuleId', 'postTypeSchema'].includes(key)))
        throw new Error('Invalid public post metadata field.')
      const value = parts.reduce((item, key) => item?.[key], data)
      if (value === undefined) continue
      let target = metadataBase
      for (const key of parts.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key] }
      target[parts.at(-1)] = value
    }
  }
  const canonicalKey = postCanonicalKey(params || {})
  // Apply after custom projections too, so they cannot restore a legacy blurb.
  // Keep full post/canonical data untouched and avoid splitting surrogate pairs.
  const blurbCharacters = Array.from(String(metadataBase.blurb || '').slice(0, POST_BLURB_MAX))
  if (blurbCharacters.at(-1)?.match(/[\uD800-\uDBFF]/)) blurbCharacters.pop()
  metadataBase.blurb = blurbCharacters.join('')
  while (blurbCharacters.length && metadataSizeBytes({ ...metadataBase, canonical: canonicalKey }) > MAX_KV_METADATA_BYTES) {
    blurbCharacters.pop()
    metadataBase.blurb = blurbCharacters.join('')
  }
  if (data?.postTypeId && metadataSizeBytes({ ...metadataBase, canonical: canonicalKey }) > MAX_KV_METADATA_BYTES)
    throw new Error('Post index metadata exceeds 1,024 bytes. Reduce the fields used by the index or use canonical post lookups.')
  const fittedTags = fitPostTagsToMetadataBudget({
    metadataBase,
    tags: data?.tags,
    canonicalKey,
  })
  if (fittedTags.length)
    metadataBase.tags = fittedTags
  return metadataBase
}

module.exports = {
  MAX_KV_METADATA_BYTES,
  POST_BLURB_MAX,
  buildPostKvMetadata,
  fitPostTagsToMetadataBudget,
  postCanonicalKey,
}
