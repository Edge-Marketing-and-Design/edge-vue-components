export const useCmsNewDocs = () => {
  const { createDefaults: createSiteSettingsDefaults } = useSiteSettingsTemplate()

  const blocks = useState('edge-cms-new-docs-blocks', () => ({
    name: { value: '' },
    content: { value: '' },
    tags: { value: [] },
    themes: { value: [] },
    synced: { value: false },
    version: 1,
  }))

  const themes = useState('edge-cms-new-docs-themes', () => ({
    name: { value: '' },
    headJSON: {
      value: `{
  "link": [
    {
      "rel": "preconnect",
      "href": "https://fonts.googleapis.com"
    },
    {
      "rel": "preconnect",
      "href": "https://fonts.gstatic.com",
      "crossorigin": ""
    },
    {
      "rel": "stylesheet",
      "href": "https://fonts.googleapis.com/css2?family=Overpass:wght@400;700&family=Kode+Mono:wght@400;700&display=swap"
    }
  ]
}`,
    },
    theme: {
      value: `{
  "extend": {
    "colors": {
      "brand": "#3B82F6",
      "accent": "#F59E0B",
      "surface": "#FAFAFA",
      "subtle": "#F3F4F6",
      "text": "#1F2937",
      "muted": "#9CA3AF",
      "success": "#22C55E",
      "danger": "#EF4444",
      "border": "#E5E7EB",
      "ring": "#93C5FD",
      "link": "#3B82F6",
      "linkHover": "#1D4ED8",
      "navBg": "#000000",
      "navText": "#FFFFFF",
      "navMuted": "#6B7280",
      "navBorder": "",
      "navActive": "#3B82F6",
      "navHoverBg": "",
      "navActiveBg": "",
      "sideNavBg": "#FFFFFF",
      "sideNavText": "#000000",
      "sideNavActive": "#AFBD23"
    },
    "fontFamily": {
      "sans": ["Overpass", "sans-serif"],
      "serif": ["Kode Mono", "monospace"],
      "mono": ["Overpass", "sans-serif"],
      "brand": ["Kode Mono", "monospace"]
    }
  },
  "apply": {},
  "slots": {},
  "variants": {
    "light": {
      "apply": {}
    },
    "dark": {
      "apply": {},
      "slots": {}
    }
  }
}`,
    },
    extraCSS: {
      value: '',
    },
    version: 1,
    defaultPages: { value: [] },
    defaultMenus: {
      value: {
        'Site Root': [],
        'Not In Menu': [],
      },
    },
    defaultSiteSettings: { value: createSiteSettingsDefaults() },
  }))

  return {
    blocks,
    themes,
  }
}
