// Source of truth for new Hub and agent-created themes. Existing themes and
// duplicates are never converted. Callers receive independent, editable JSON.
export const THEME_COLOR_TOKENS = [
  'primary', 'onPrimary', 'secondary', 'onSecondary', 'tertiary', 'onTertiary', 'accent', 'onAccent',
  'canvas', 'surface', 'surfaceAlt', 'text', 'textMuted', 'heading', 'link', 'linkHover', 'border',
]
export const THEME_OPTIONAL_COLOR_TOKENS = ['success', 'warning', 'danger']
export const THEME_FONT_TOKENS = ['display', 'sans', 'accent']
export const THEME_RADIUS_TOKENS = ['card', 'panel', 'button']

export const createCmsThemeDefaults = () => ({
  extend: {
    colors: {
      primary: '#1D4ED8', onPrimary: '#FFFFFF', secondary: '#334155', onSecondary: '#FFFFFF',
      tertiary: '#6D28D9', onTertiary: '#FFFFFF', accent: '#F59E0B', onAccent: '#1F2937',
      canvas: '#FAFAFA', surface: '#FFFFFF', surfaceAlt: '#F3F4F6',
      text: '#1F2937', textMuted: '#4B5563', heading: '#111827',
      link: '#1D4ED8', linkHover: '#1E40AF', border: '#E5E7EB',
      success: '#15803D', warning: '#B45309', danger: '#B91C1C',
    },
    fontFamily: {
      display: ['Overpass', 'sans-serif'], sans: ['Overpass', 'sans-serif'], accent: ['Kode Mono', 'monospace'],
    },
    borderRadius: { card: '0.75rem', panel: '1rem', button: '0.375rem' },
  },
  apply: {}, slots: {}, variants: { light: { apply: {} }, dark: { apply: {}, slots: {} } },
})

export const createCmsThemeHeadDefaults = () => ({ link: [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Overpass:wght@400;700&family=Kode+Mono:wght@400;700&display=swap' },
] })
