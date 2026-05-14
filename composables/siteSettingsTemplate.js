import { useStructuredDataTemplates } from '@/edge/composables/structuredDataTemplates'

export const useSiteSettingsTemplate = () => {
  const { buildSiteStructuredData } = useStructuredDataTemplates()
  const createRestrictedContentDefaults = () => ({
    enabled: false,
    allowSelfRegistration: true,
    registrationPricing: 'free',
    provider: 'stripe',
    defaultCurrency: 'USD',
    registrationTermsUrl: '',
    loginHelpText: '',
    registrationSuccessMessage: '',
    rules: [],
  })
  const createContactSpamDefaults = () => ({
    enabled: true,
    mode: 'block',
    blockThreshold: 0.75,
    allowedInquiryContext: 'Legitimate messages usually come from people trying to contact the organization, ask a question, request services, request information, schedule an appointment, ask about availability, ask about pricing, follow up on an existing relationship, apply for an opportunity, submit a support request, or respond to content on the website. Allow messages that appear to be from a real visitor with a specific need, even if the message is short, informal, misspelled, or incomplete.',
    blockedInquiryContext: 'Spam messages usually advertise third-party services to the website owner, offer SEO, marketing, web design, app development, lead generation, directory listings, backlinks, loans, crypto, suspicious investments, or unrelated business promotions. Block messages that are primarily trying to sell something to the organization, contain generic outreach with no connection to the website services, include suspicious links, use mass-sales language, or appear automated. This includes unsolicited offers for free audits, mockups, redesign concepts, SEO reviews, performance checks, marketing ideas, or other no-cost evaluations when the purpose appears to be selling or promoting a service to the organization.',
  })
  const createDefaults = () => ({
    name: '',
    theme: '',
    allowedThemes: [],
    showMembersTab: false,
    logo: '',
    logoLight: '',
    logoText: '',
    logoType: 'image',
    brandLogoDark: '',
    brandLogoLight: '',
    favicon: '',
    menuPosition: 'right',
    domains: [],
    forwardApex: true,
    contactEmail: '',
    contactPhone: '',
    metaTitle: '',
    metaDescription: '',
    structuredData: buildSiteStructuredData(),
    trackingFacebookPixel: '',
    trackingGoogleAnalytics: '',
    trackingAdroll: '',
    sureFeedURL: '',
    socialFacebook: '',
    socialInstagram: '',
    socialTwitter: '',
    socialLinkedIn: '',
    socialYouTube: '',
    socialTikTok: '',
    users: [],
    restrictedContent: createRestrictedContentDefaults(),
    contactSpam: createContactSpamDefaults(),
    aiAgentUserId: '',
    aiInstructions: '',
  })

  const createNewDocSchema = () => {
    const defaults = createDefaults()
    return {
      name: { bindings: { 'field-type': 'text', 'label': 'Name' }, cols: '12', value: defaults.name },
      theme: { bindings: { 'field-type': 'collection', 'label': 'Themes', 'collection-path': 'themes' }, cols: '12', value: defaults.theme },
      allowedThemes: { bindings: { 'field-type': 'tags', 'label': 'Allowed Themes' }, cols: '12', value: defaults.allowedThemes },
      showMembersTab: { bindings: { 'field-type': 'boolean', 'label': 'Show Members Tab' }, cols: '12', value: defaults.showMembersTab },
      logo: { bindings: { 'field-type': 'text', 'label': 'Dark logo' }, cols: '12', value: defaults.logo },
      logoLight: { bindings: { 'field-type': 'text', 'label': 'Logo Light' }, cols: '12', value: defaults.logoLight },
      logoText: { bindings: { 'field-type': 'text', 'label': 'Logo Text' }, cols: '12', value: defaults.logoText },
      logoType: { bindings: { 'field-type': 'select', 'label': 'Logo Type', 'items': ['image', 'text'] }, cols: '12', value: defaults.logoType },
      brandLogoDark: { bindings: { 'field-type': 'text', 'label': 'Brand Logo Dark' }, cols: '12', value: defaults.brandLogoDark },
      brandLogoLight: { bindings: { 'field-type': 'text', 'label': 'Brand Logo Light' }, cols: '12', value: defaults.brandLogoLight },
      favicon: { bindings: { 'field-type': 'text', 'label': 'Favicon' }, cols: '12', value: defaults.favicon },
      menuPosition: { bindings: { 'field-type': 'select', 'label': 'Menu Position', 'items': ['left', 'center', 'right'] }, cols: '12', value: defaults.menuPosition },
      domains: { bindings: { 'field-type': 'tags', 'label': 'Domains', 'helper': 'Add or remove domains' }, cols: '12', value: defaults.domains },
      forwardApex: { bindings: { 'field-type': 'boolean', 'label': 'Forward Apex (non-www) domains to www' }, cols: '12', value: defaults.forwardApex },
      contactEmail: { bindings: { 'field-type': 'text', 'label': 'Contact Email' }, cols: '12', value: defaults.contactEmail },
      contactPhone: { bindings: { 'field-type': 'text', 'label': 'Contact Phone' }, cols: '12', value: defaults.contactPhone },
      metaTitle: { bindings: { 'field-type': 'text', 'label': 'Meta Title' }, cols: '12', value: defaults.metaTitle },
      metaDescription: { bindings: { 'field-type': 'textarea', 'label': 'Meta Description' }, cols: '12', value: defaults.metaDescription },
      structuredData: { bindings: { 'field-type': 'textarea', 'label': 'Structured Data (JSON-LD)' }, cols: '12', value: defaults.structuredData },
      trackingFacebookPixel: { bindings: { 'field-type': 'text', 'label': 'Facebook Pixel ID' }, cols: '12', value: defaults.trackingFacebookPixel },
      trackingGoogleAnalytics: { bindings: { 'field-type': 'text', 'label': 'Google Analytics ID' }, cols: '12', value: defaults.trackingGoogleAnalytics },
      trackingAdroll: { bindings: { 'field-type': 'text', 'label': 'AdRoll ID' }, cols: '12', value: defaults.trackingAdroll },
      sureFeedURL: { bindings: { 'field-type': 'text', 'label': 'Sure Feedback' }, cols: '12', value: defaults.sureFeedURL },
      socialFacebook: { bindings: { 'field-type': 'text', 'label': 'Facebook URL' }, cols: '12', value: defaults.socialFacebook },
      socialInstagram: { bindings: { 'field-type': 'text', 'label': 'Instagram URL' }, cols: '12', value: defaults.socialInstagram },
      socialTwitter: { bindings: { 'field-type': 'text', 'label': 'X (Twitter) URL' }, cols: '12', value: defaults.socialTwitter },
      socialLinkedIn: { bindings: { 'field-type': 'text', 'label': 'LinkedIn URL' }, cols: '12', value: defaults.socialLinkedIn },
      socialYouTube: { bindings: { 'field-type': 'text', 'label': 'YouTube URL' }, cols: '12', value: defaults.socialYouTube },
      socialTikTok: { bindings: { 'field-type': 'text', 'label': 'TikTok URL' }, cols: '12', value: defaults.socialTikTok },
      users: { bindings: { 'field-type': 'users', 'label': 'Users', 'hint': 'Choose users' }, cols: '12', value: defaults.users },
      contactSpam: { value: defaults.contactSpam },
      aiAgentUserId: { bindings: { 'field-type': 'select', 'label': 'Agent Data for AI to use to build initial site' }, cols: '12', value: defaults.aiAgentUserId },
      aiInstructions: { bindings: { 'field-type': 'textarea', 'label': 'Additional AI Instructions' }, cols: '12', value: defaults.aiInstructions },
    }
  }

  const settingsKeys = Object.keys(createDefaults())

  return {
    createDefaults,
    createRestrictedContentDefaults,
    createContactSpamDefaults,
    createNewDocSchema,
    settingsKeys,
  }
}
