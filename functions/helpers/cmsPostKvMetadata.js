// KV index metadata for published posts: the fields a post list renders
// without a canonical read. KV caps metadata at 1,024 bytes; tags are
// dropped from the end until it fits.
const MAX_KV_METADATA_BYTES = 1024

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
  const canonicalKey = postCanonicalKey(params || {})
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
  buildPostKvMetadata,
  fitPostTagsToMetadataBudget,
  postCanonicalKey,
}
