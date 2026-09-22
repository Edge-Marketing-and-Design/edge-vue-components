const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)
const isPublication = meta => meta?.type === 'publication' || meta?.option?.picker === 'publication'
const httpUrl = value => (typeof value === 'string' && /^https?:\/\/[^\s{}]+$/i.test(value)) ? value : ''

const getPublicationOutputs = (file) => {
  const edge = file?.edgeMediaState?.outputs
  const outputs = (edge && typeof edge === 'object' && Object.keys(edge).length)
    ? edge
    : (file?.ccState?.cFImages || file?.ccState?.cfImages || {})
  return Object.fromEntries(Object.entries(outputs).filter(([key]) => /^page-\d+$/i.test(key)))
}

// Resolves only an exact identity in the current organization. Never guess from
// titles, filenames, or another organization's similarly named publication.
const resolvePublicationFile = async (transaction, orgRef, reference) => {
  if (!reference || reference.includes('/') || reference.length > 1500)
    return null
  const files = orgRef.collection('files')
  const matches = new Map()
  const direct = await transaction.get(files.doc(reference))
  if (direct.exists)
    matches.set(direct.id, direct.data())
  const slugs = await transaction.get(files.where('slug', '==', reference).limit(2))
  for (const doc of slugs.docs)
    matches.set(doc.id, doc.data())
  return matches.size === 1 ? [...matches.values()][0] : null
}

const reconcilePublicationValues = async (block, beforeDefinition, afterDefinition, resolveFile, warn) => {
  const fields = Object.entries(afterDefinition.schema || {}).filter(([, meta]) => meta?.type === 'publication')
  if (!fields.length)
    return
  const values = { ...(block.values || {}) }
  for (const [field] of fields) {
    let sourceField = field
    if (!owns(values, field)) {
      const candidates = new Set()
      for (const metadata of [block.schema, block.meta, beforeDefinition.schema, beforeDefinition.meta]) {
        for (const [key, meta] of Object.entries(metadata || {})) {
          if (isPublication(meta) && owns(values, key))
            candidates.add(key)
        }
      }
      // Compatibility with the original shared publication block's field name.
      if (field === 'publicationPages' && owns(values, 'publicationSlug'))
        candidates.add('publicationSlug')
      if (fields.length !== 1 || candidates.size !== 1) {
        warn(`Publication field ${field} in block ${block.id} has no unique saved selection`)
        continue
      }
      sourceField = [...candidates][0]
    }
    const selection = values[sourceField]
    if (selection && typeof selection === 'object') {
      // An explicitly cleared destination remains cleared; never replace an
      // existing image snapshot with the source file's latest processed images.
      values[field] = selection
      continue
    }
    if (selection === '' || selection === null) {
      values[field] = {}
      continue
    }
    const file = typeof selection === 'string' ? await resolveFile(selection.trim()) : null
    const outputs = getPublicationOutputs(file)
    if (!Object.keys(outputs).length) {
      warn(`Publication field ${field} in block ${block.id} could not resolve its saved selection`)
      continue
    }
    values[field] = outputs
    if (owns(afterDefinition.schema, 'publicationPdfUrl') && !httpUrl(values.publicationPdfUrl))
      values.publicationPdfUrl = httpUrl(file?.r2URL || file?.r2Url)
  }
  // Newly introduced display fields need their declared defaults in nested
  // post rendering too. Keep unresolved publication selections retryable.
  for (const [field, meta] of Object.entries(afterDefinition.schema || {})) {
    if (meta?.type !== 'publication' && !owns(values, field) && owns(meta, 'value'))
      values[field] = JSON.parse(JSON.stringify(meta.value))
  }
  if (owns(afterDefinition.schema, 'publicationPdfUrl') && owns(values, 'publicationPdfUrl'))
    values.publicationPdfUrl = httpUrl(values.publicationPdfUrl)
  block.values = values
}

module.exports = { getPublicationOutputs, resolvePublicationFile, reconcilePublicationValues }
