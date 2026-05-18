export const usePublicationMedia = () => {
  const pageKeyPattern = /^page-\d+$/i

  const toText = value => String(value || '').trim()

  const getNamedVariant = (variants, name) => {
    if (!variants)
      return ''
    if (Array.isArray(variants))
      return toText(variants.find(variant => toText(variant).includes(`/${name}`)) || '')
    if (typeof variants === 'object')
      return toText(variants[name] || '')
    return ''
  }

  const firstVariant = (variants) => {
    if (!variants)
      return ''
    if (Array.isArray(variants))
      return toText(variants[0] || '')
    if (typeof variants === 'object')
      return toText(Object.values(variants).find(Boolean) || '')
    return ''
  }

  const normalizePageVariants = (pageData = {}) => {
    const variants = pageData?.variants || {}
    return {
      thumbnail: getNamedVariant(variants, 'thumbnail') || firstVariant(variants),
      highres: getNamedVariant(variants, 'highres') || getNamedVariant(variants, 'public') || firstVariant(variants),
      public: getNamedVariant(variants, 'public') || firstVariant(variants),
    }
  }

  const pageNumber = key => Number(toText(key).match(/(\d+)/)?.[1] || Number.POSITIVE_INFINITY)

  const sortedPageEntries = entries => entries
    .filter(([key]) => pageKeyPattern.test(toText(key)))
    .sort((a, b) => pageNumber(a[0]) - pageNumber(b[0]))

  const getEdgeMediaOutputs = (item) => {
    const outputs = item?.edgeMediaState?.outputs
    return (outputs && typeof outputs === 'object') ? outputs : {}
  }

  const getLegacyPageImages = (item) => {
    const pageImages = item?.ccState?.cFImages || item?.ccState?.cfImages
    return (pageImages && typeof pageImages === 'object') ? pageImages : {}
  }

  const getPublicationPageEntries = (item) => {
    const edgeOutputs = getEdgeMediaOutputs(item)
    if (Object.keys(edgeOutputs).length)
      return sortedPageEntries(Object.entries(edgeOutputs))

    return sortedPageEntries(Object.entries(getLegacyPageImages(item)))
  }

  const getPublicationPreviewPages = (item) => {
    return getPublicationPageEntries(item).map(([key, pageData]) => {
      const variants = normalizePageVariants(pageData || {})
      return {
        key,
        thumbnail: variants.thumbnail,
        preview: variants.highres || variants.public || variants.thumbnail,
        public: variants.public,
      }
    })
  }

  const getPublicationPageOutputs = (item) => {
    return getPublicationPageEntries(item).reduce((pages, [key, pageData]) => {
      pages[key] = JSON.parse(JSON.stringify(pageData || {}))
      return pages
    }, {})
  }

  const getPublicationPageUrls = (item, variant = 'public') => getPublicationPageEntries(item)
    .map(([, pageData]) => {
      const variants = normalizePageVariants(pageData || {})
      return variants[variant] || variants.public || variants.highres || variants.thumbnail
    })
    .filter(Boolean)

  const getPublicationHighResImages = item => getPublicationPageEntries(item)
    .map(([key, pageData]) => {
      const variants = normalizePageVariants(pageData || {})
      const url = variants.highres || variants.public || variants.thumbnail
      return url ? { pageName: key, url } : null
    })
    .filter(Boolean)

  const getPublicationThumbnailUrl = (item) => {
    const firstPage = getPublicationPreviewPages(item)[0]
    return toText(firstPage?.thumbnail || firstPage?.preview || item?.cover_image_url || item?.thumbnail || '')
  }

  const getPublicationPageCount = (item) => {
    const totalPages = Number(item?.totalPages)
    if (Number.isFinite(totalPages) && totalPages > 0)
      return totalPages

    const edgePageCount = Number(item?.edgeMediaState?.pageCount)
    if (Number.isFinite(edgePageCount) && edgePageCount > 0)
      return edgePageCount

    if (Array.isArray(item?.pages) && item.pages.length)
      return item.pages.length

    return getPublicationPageEntries(item).length
  }

  const getPublicationProcessedPages = (item) => {
    const edgeProcessedPages = Number(item?.edgeMediaState?.processedPages)
    if (Number.isFinite(edgeProcessedPages) && edgeProcessedPages > 0)
      return edgeProcessedPages
    return getPublicationPageEntries(item).length
  }

  const getPublicationStatus = (item) => {
    const edgeStatus = toText(item?.edgeMediaState?.status).toLowerCase()
    if (edgeStatus)
      return edgeStatus

    const legacyStatus = toText(item?.ccState?.status).toLowerCase()
    if (legacyStatus)
      return legacyStatus

    return toText(item?.ccState?.job?.status).toLowerCase()
  }

  const getPublicationProgressLabel = (item) => {
    const status = getPublicationStatus(item)
    if (!status)
      return ''
    if (status === 'complete')
      return 'Complete'
    if (status === 'failed' || status === 'error')
      return 'Failed'

    const processed = getPublicationProcessedPages(item)
    const total = getPublicationPageCount(item)
    if (processed > 0 && total > 0)
      return `Processing ${processed} of ${total}`
    if (processed > 0)
      return `Processing ${processed} page${processed === 1 ? '' : 's'}`
    return status.replace(/_/g, ' ')
  }

  const getPublicationError = (item) => {
    const edgeError = toText(item?.edgeMediaState?.errorMessage || item?.edgeMediaState?.error?.message)
    if (edgeError)
      return edgeError

    const legacyMessage = toText(item?.ccState?.errorMessage)
    if (legacyMessage)
      return legacyMessage

    return Object.values(getLegacyPageImages(item))
      .map(entry => toText(entry?.error))
      .find(Boolean) || ''
  }

  const hasPublicationMediaState = item => !!(item?.edgeMediaState || item?.ccState)

  return {
    getPublicationError,
    getPublicationHighResImages,
    getPublicationPageCount,
    getPublicationPageEntries,
    getPublicationPageOutputs,
    getPublicationPageUrls,
    getPublicationPreviewPages,
    getPublicationProcessedPages,
    getPublicationProgressLabel,
    getPublicationStatus,
    getPublicationThumbnailUrl,
    hasPublicationMediaState,
  }
}
