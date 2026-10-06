import { createCmsThemeDefaults, createCmsThemeHeadDefaults } from '../lib/cmsThemeDefaults.mjs'

export const useCmsNewDocs = () => {
  const { createDefaults: createSiteSettingsDefaults } = useSiteSettingsTemplate()

  const blocks = useState('edge-cms-new-docs-blocks', () => ({
    name: { value: '' },
    content: { value: '' },
    templateVersion: { value: 2 },
    template: { value: '' },
    schema: { value: {} },
    dataSources: { value: {} },
    values: { value: {} },
    tags: { value: [] },
    themes: { value: [] },
    type: { value: ['Page'] },
    previewType: { value: 'light' },
    isOverrideBlock: { value: false },
    synced: { value: false },
    version: 1,
  }))

  const themes = useState('edge-cms-new-docs-themes', () => ({
    name: { value: '' },
    headJSON: { value: JSON.stringify(createCmsThemeHeadDefaults(), null, 2) },
    theme: { value: JSON.stringify(createCmsThemeDefaults(), null, 2) },
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
