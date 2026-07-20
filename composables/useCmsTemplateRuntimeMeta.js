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

export const clearCmsTemplateV2LibraryState = (doc) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || Number(doc.templateVersion) !== 2)
    return doc

  if (!doc.meta || typeof doc.meta !== 'object' || Array.isArray(doc.meta) || Object.keys(doc.meta).length)
    doc.meta = {}
  if (!doc.values || typeof doc.values !== 'object' || Array.isArray(doc.values) || Object.keys(doc.values).length)
    doc.values = {}
  return doc
}

export const prepareCmsTemplateV2PickedBlock = (doc) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.synced)
    return doc

  return clearCmsTemplateV2LibraryState(doc)
}
