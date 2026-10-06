export const getCmsTemplateRuntimeMeta = (templateVersion, dataSources = {}, meta = {}) => {
  if (Number(templateVersion) !== 2)
    return meta || {}

  if (!dataSources || typeof dataSources !== 'object' || Array.isArray(dataSources))
    return {}

  return Object.keys(dataSources).reduce((runtimeMeta, sourceName) => {
    const sourceMeta = meta?.[sourceName]
    if (sourceMeta && typeof sourceMeta === 'object' && !Array.isArray(sourceMeta))
      runtimeMeta[sourceName] = sourceMeta
    return runtimeMeta
  }, {})
}

// Library-only `meta` entries a Template v2 block keeps: `design` is the
// design-to-block map (docs/data-contracts/cms-blocks, Library block). The
// Block Editor keeps them (`keepLibraryMeta`); a picked instance never gets
// them.
export const CMS_LIBRARY_META_KEYS = Object.freeze(['design'])

export const clearCmsTemplateV2LibraryState = (doc, { keepLibraryMeta = false } = {}) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || Number(doc.templateVersion) !== 2)
    return doc

  if (!doc.meta || typeof doc.meta !== 'object' || Array.isArray(doc.meta)) {
    doc.meta = {}
  }
  else {
    for (const key of Object.keys(doc.meta)) {
      if (!(keepLibraryMeta && CMS_LIBRARY_META_KEYS.includes(key)))
        delete doc.meta[key]
    }
  }
  if (!doc.values || typeof doc.values !== 'object' || Array.isArray(doc.values) || Object.keys(doc.values).length)
    doc.values = {}
  return doc
}

export const prepareCmsTemplateV2PickedBlock = (doc) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.synced)
    return doc

  return clearCmsTemplateV2LibraryState(doc)
}
