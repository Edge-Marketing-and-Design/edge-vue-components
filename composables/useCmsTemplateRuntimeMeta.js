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
