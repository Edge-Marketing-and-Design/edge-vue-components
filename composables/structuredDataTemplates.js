export const useStructuredDataTemplates = () => {
  const buildSiteStructuredData = () => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': '{{cms-site}}#website',
    'name': '',
    'url': '{{cms-site}}',
    'description': '',
    'publisher': {
      '@type': 'Organization',
      'name': '',
      'logo': {
        '@type': 'ImageObject',
        'url': '{{cms-logo}}',
      },
    },
    'sameAs': [],
  }, null, 2)

  const buildPageStructuredData = () => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': '{{cms-url}}#webpage',
    'name': '',
    'url': '{{cms-url}}',
    'description': '',
    'isPartOf': {
      '@id': '{{cms-site}}#website',
    },
  }, null, 2)

  return {
    buildSiteStructuredData,
    buildPageStructuredData,
  }
}
