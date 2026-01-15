export const useStructuredDataTemplates = () => {
  const buildSiteStructuredData = () => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': '',
    'url': '',
    'description': '',
    'publisher': {
      '@type': 'Organization',
      'name': '',
      'logo': {
        '@type': 'ImageObject',
        'url': '',
      },
    },
    'sameAs': [],
  }, null, 2)

  const buildPageStructuredData = () => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    'name': '',
    'url': '',
    'description': '',
    'isPartOf': {
      '@type': 'WebSite',
      'name': '',
      'url': '',
    },
  }, null, 2)

  return {
    buildSiteStructuredData,
    buildPageStructuredData,
  }
}
