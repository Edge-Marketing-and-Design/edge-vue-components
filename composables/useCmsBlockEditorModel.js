const asRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}
  return value
}

export const orderCmsBlockEditorMeta = ({
  meta,
  orderedFields,
  includeUnreferenced = false,
  shouldIgnore = () => false,
} = {}) => {
  const metaObj = asRecord(meta)
  const out = []
  const picked = new Set()

  const addField = (field) => {
    if (!field || picked.has(field) || !(field in metaObj) || shouldIgnore(metaObj[field]))
      return
    out.push({ field, meta: metaObj[field] })
    picked.add(field)
  }

  for (const field of Array.isArray(orderedFields) ? orderedFields : [])
    addField(field)

  if (includeUnreferenced) {
    for (const field of Object.keys(metaObj))
      addField(field)
  }

  return out
}

export const buildCmsBlockEditorDraftValues = ({
  schemaDefaults,
  legacyValues,
  blockValues,
  instanceValues,
} = {}) => ({
  ...asRecord(schemaDefaults),
  ...asRecord(legacyValues),
  ...asRecord(blockValues),
  ...asRecord(instanceValues),
})
