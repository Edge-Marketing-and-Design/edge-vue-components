export const cmsRoutes = [
  {
    name: 'cms-dashboard-sites-index',
    path: '/app/dashboard/sites',
    file: './edge/routes/cms/dashboard/sites/index.vue',
  },
  {
    name: 'cms-dashboard-blocks-index',
    path: '/app/dashboard/blocks',
    file: './edge/routes/cms/dashboard/blocks/index.vue',
  },
  {
    name: 'cms-dashboard-blocks-block',
    path: '/app/dashboard/blocks/:block',
    file: './edge/routes/cms/dashboard/blocks/[block].vue',
  },
  {
    name: 'cms-dashboard-media-index',
    path: '/app/dashboard/media',
    file: './edge/routes/cms/dashboard/media/index.vue',
  },
  {
    name: 'cms-dashboard-sites-site',
    path: '/app/dashboard/sites/:site',
    file: './edge/routes/cms/dashboard/sites/[site].vue',
    children: [
      {
        name: 'cms-dashboard-sites-site-page',
        path: ':page',
        file: './edge/routes/cms/dashboard/sites/[site]/[[page]].vue',
      },
    ],
  },
  {
    name: 'cms-dashboard-templates-index',
    path: '/app/dashboard/templates',
    file: './edge/routes/cms/dashboard/templates/index.vue',
    children: [
      {
        name: 'cms-dashboard-templates-page',
        path: ':page',
        file: './edge/routes/cms/dashboard/templates/[page].vue',
      },
    ],
  },
  {
    name: 'cms-dashboard-themes-index',
    path: '/app/dashboard/themes',
    file: './edge/routes/cms/dashboard/themes/index.vue',
  },
  {
    name: 'cms-dashboard-themes-theme',
    path: '/app/dashboard/themes/:theme',
    file: './edge/routes/cms/dashboard/themes/[theme].vue',
  },
]
