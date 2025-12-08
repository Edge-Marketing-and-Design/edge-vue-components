<script setup lang="js">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

import { CircleAlert, FileCheck, FileStack, FolderCog, FolderDown, FolderUp, FolderX, Loader2 } from 'lucide-vue-next'
const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: false,
    default: '',
  },
})
const edgeFirebase = inject('edgeFirebase')

const isTemplateSite = computed(() => props.site === 'templates')

const state = reactive({
  filter: '',
  userFilter: 'all',
  newDocs: {
    sites: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name' }, cols: '12', value: '' },
      theme: { bindings: { 'field-type': 'collection', 'label': 'Themes', 'collection-path': 'themes' }, cols: '12', value: '' },
      allowedThemes: { bindings: { 'field-type': 'tags', 'label': 'Allowed Themes' }, cols: '12', value: [] },
      logo: { bindings: { 'field-type': 'text', 'label': 'Logo' }, cols: '12', value: '' },
      menuPosition: { bindings: { 'field-type': 'select', 'label': 'Menu Position', 'items': ['left', 'center', 'right'] }, cols: '12', value: 'right' },
      domains: { bindings: { 'field-type': 'tags', 'label': 'Domains', 'helper': 'Add or remove domains' }, cols: '12', value: [] },
      metaTitle: { bindings: { 'field-type': 'text', 'label': 'Meta Title' }, cols: '12', value: '' },
      metaDescription: { bindings: { 'field-type': 'textarea', 'label': 'Meta Description' }, cols: '12', value: '' },
      structuredData: { bindings: { 'field-type': 'textarea', 'label': 'Structured Data (JSON-LD)' }, cols: '12', value: '' },
      users: { bindings: { 'field-type': 'users', 'label': 'Users', 'hint': 'Choose users' }, cols: '12', value: [] },
      aiAgentUserId: { bindings: { 'field-type': 'select', 'label': 'Agent Data for AI to use to build initial site' }, cols: '12', value: '' },
      aiInstructions: { bindings: { 'field-type': 'textarea', 'label': 'Additional AI Instructions' }, cols: '12', value: '' },
    },
  },
  mounted: false,
  page: {},
  menus: { 'Site Root': [], 'Not In Menu': [] },
  saving: false,
  siteSettings: false,
  hasError: false,
  updating: false,
  logoPickerOpen: false,
  aiSectionOpen: false,
})

const pageInit = {
  name: '',
  content: [],
  blockIds: [],
}

const schemas = {
  sites: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
    domains: z
      .array(z.string().max(45, 'Each domain must be 45 characters or fewer'))
      .refine(arr => !!(arr && arr[0] && String(arr[0]).trim().length), {
        message: 'At least one domain is required',
        path: ['domains', 0],
      }),
    theme: z.string({
      required_error: 'Theme is required',
    }).min(1, { message: 'Theme is required' }),
    allowedThemes: z.array(z.string()).optional(),
    logo: z.string().optional(),
    menuPosition: z.enum(['left', 'center', 'right']).optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    structuredData: z.string().optional(),
    aiAgentUserId: z.string().optional(),
    aiInstructions: z.string().optional(),
  })),
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const isAdmin = computed(() => {
  return edgeGlobal.isAdminGlobal(edgeFirebase).value
})

const siteData = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site] || {}
})

const themeCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {}
})

const deriveThemeLabel = (doc = {}) => {
  return doc?.name
    || doc?.title
    || doc?.theme?.name
    || doc?.theme?.title
    || doc?.meta?.name
    || doc?.meta?.title
    || ''
}

const themeOptions = computed(() => {
  return Object.entries(themeCollection.value)
    .map(([value, doc]) => ({
      value,
      label: deriveThemeLabel(doc) || value,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const themeOptionsMap = computed(() => {
  const map = new Map()
  for (const option of themeOptions.value) {
    map.set(option.value, option)
  }
  return map
})

const orgUsers = computed(() => edgeFirebase.state?.users || {})
const userOptions = computed(() => {
  return Object.entries(orgUsers.value || {})
    .map(([id, user]) => ({
      value: user?.userId || id,
      label: user?.meta?.name || user?.userId || id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const themeItemsForAllowed = (allowed, current) => {
  const base = themeOptions.value
  const allowedList = Array.isArray(allowed) ? allowed.filter(Boolean) : []
  if (allowedList.length) {
    const allowedSet = new Set(allowedList)
    const filtered = base.filter(option => allowedSet.has(option.value))
    if (current && !allowedSet.has(current)) {
      const currentOption = themeOptionsMap.value.get(current)
      if (currentOption)
        filtered.push(currentOption)
    }
    return filtered
  }

  if (current) {
    const currentOption = themeOptionsMap.value.get(current)
    return currentOption ? [currentOption] : []
  }

  return []
}

const menuPositionOptions = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const TEMPLATE_PAGES_PATH = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)
const seededSiteIds = new Set()

const slugify = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const titleFromSlug = (slug) => {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'New Page'
}

const ensureMenuBuckets = (menus) => {
  const normalized = menus && typeof menus === 'object'
    ? edgeGlobal.dupObject(menus)
    : {}
  if (!Array.isArray(normalized['Site Root']))
    normalized['Site Root'] = []
  if (!Array.isArray(normalized['Not In Menu']))
    normalized['Not In Menu'] = []
  return normalized
}

const ensureUniqueSlug = (candidate, templateDoc, usedSlugs) => {
  const fallbackBase = slugify(templateDoc?.slug || templateDoc?.name || '')
  let base = candidate && candidate.trim().length ? slugify(candidate) : ''
  if (!base)
    base = fallbackBase || `page-${usedSlugs.size + 1}`
  let slugCandidate = base
  let suffix = 2
  while (usedSlugs.has(slugCandidate)) {
    slugCandidate = `${base}-${suffix}`
    suffix += 1
  }
  usedSlugs.add(slugCandidate)
  return slugCandidate
}

const cloneBlocks = (blocks = []) => {
  return Array.isArray(blocks) ? JSON.parse(JSON.stringify(blocks)) : []
}

const deriveBlockIdsFromDoc = (doc = {}) => {
  const collectBlocks = (blocks) => {
    if (!Array.isArray(blocks))
      return []
    return blocks
      .map(block => block?.blockId)
      .filter(Boolean)
  }

  const collectFromStructure = (structure) => {
    if (!Array.isArray(structure))
      return []
    const ids = []
    for (const row of structure) {
      for (const column of row?.columns || []) {
        if (Array.isArray(column?.blocks))
          ids.push(...column.blocks.filter(Boolean))
      }
    }
    return ids
  }

  const ids = new Set([
    ...collectBlocks(doc.content),
    ...collectBlocks(doc.postContent),
    ...collectFromStructure(doc.structure),
    ...collectFromStructure(doc.postStructure),
  ])
  return Array.from(ids)
}

const buildPagePayloadFromTemplateDoc = (templateDoc, slug, displayName = '') => {
  const timestamp = Date.now()
  const payload = {
    name: displayName?.trim()?.length ? displayName : titleFromSlug(slug),
    slug,
    post: templateDoc?.post || false,
    content: cloneBlocks(templateDoc?.content),
    postContent: cloneBlocks(templateDoc?.postContent),
    structure: cloneBlocks(templateDoc?.structure),
    postStructure: cloneBlocks(templateDoc?.postStructure),
    blockIds: [],
    metaTitle: templateDoc?.metaTitle || '',
    metaDescription: templateDoc?.metaDescription || '',
    structuredData: templateDoc?.structuredData || '',
    doc_created_at: timestamp,
    last_updated: timestamp,
  }
  payload.blockIds = deriveBlockIdsFromDoc(payload)
  return payload
}

const buildMenusFromDefaultPages = (defaultPages = []) => {
  if (!Array.isArray(defaultPages) || !defaultPages.length)
    return null
  const menus = { 'Site Root': [], 'Not In Menu': [] }
  const usedSlugs = new Set()
  for (const entry of defaultPages) {
    if (!entry?.pageId)
      continue
    const slug = ensureUniqueSlug(entry?.name || '', null, usedSlugs)
    menus['Site Root'].push({
      name: slug,
      item: entry.pageId,
    })
  }
  return menus
}

const deriveThemeMenus = (themeDoc = {}) => {
  if (themeDoc?.defaultMenus && Object.keys(themeDoc.defaultMenus || {}).length)
    return ensureMenuBuckets(themeDoc.defaultMenus)
  if (Array.isArray(themeDoc?.defaultPages) && themeDoc.defaultPages.length)
    return buildMenusFromDefaultPages(themeDoc.defaultPages)
  return null
}

const ensureTemplatePagesSnapshot = async () => {
  if (!edgeFirebase.data?.[TEMPLATE_PAGES_PATH.value])
    await edgeFirebase.startSnapshot(TEMPLATE_PAGES_PATH.value)
  return edgeFirebase.data?.[TEMPLATE_PAGES_PATH.value] || {}
}

const duplicateEntriesWithPages = async (entries = [], options) => {
  const {
    templatePages,
    siteId,
    usedSlugs,
  } = options
  const next = []
  for (const entry of entries) {
    if (!entry || entry.item == null)
      continue
    if (typeof entry.item === 'string' || entry.item === '') {
      const templateDoc = templatePages?.[entry.item] || null
      const slug = ensureUniqueSlug(entry.name || '', templateDoc, usedSlugs)
      const payload = buildPagePayloadFromTemplateDoc(templateDoc, slug, entry.name || '')
      try {
        const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${siteId}/pages`, payload)
        const docId = result?.meta?.docId
        if (docId) {
          next.push({
            ...entry,
            name: slug,
            item: docId,
          })
        }
      }
      catch (error) {
        console.error('Failed to duplicate template page for site seed', error)
      }
    }
    else if (typeof entry.item === 'object') {
      const folderName = Object.keys(entry.item || {})[0]
      if (!folderName)
        continue
      const children = await duplicateEntriesWithPages(entry.item[folderName], options)
      if (children.length) {
        next.push({
          ...entry,
          item: {
            [folderName]: children,
          },
        })
      }
    }
  }
  return next
}

const seedNewSiteFromTheme = async (siteId, themeId) => {
  if (!siteId || !themeId)
    return
  const themeDoc = themeCollection.value?.[themeId]
  if (!themeDoc)
    return
  const themeMenus = deriveThemeMenus(themeDoc)
  if (!themeMenus)
    return
  const templatePages = await ensureTemplatePagesSnapshot()
  const usedSlugs = new Set()
  const seededMenus = ensureMenuBuckets(themeMenus)
  seededMenus['Site Root'] = await duplicateEntriesWithPages(seededMenus['Site Root'], { templatePages, siteId, usedSlugs })
  seededMenus['Not In Menu'] = await duplicateEntriesWithPages(seededMenus['Not In Menu'], { templatePages, siteId, usedSlugs })
  await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, siteId, { menus: seededMenus })
}

const handleNewSiteSaved = async ({ docId, data, collection }) => {
  if (props.site !== 'new')
    return
  if (collection !== 'sites')
    return
  if (!docId || seededSiteIds.has(docId))
    return
  const themeId = data?.theme
  if (!themeId)
    return
  seededSiteIds.add(docId)
  try {
    await seedNewSiteFromTheme(docId, themeId)
  }
  catch (error) {
    console.error('Failed to seed site from theme defaults', error)
    seededSiteIds.delete(docId)
  }
}

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/users`]) {
    await edgeFirebase.startUsersSnapshot(edgeGlobal.edgeState.organizationDocPath)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/published-site-settings`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/published-site-settings`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/pages`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/pages`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/posts`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/posts`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published_posts`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published_posts`)
  }
  state.mounted = true
})

const isSiteDiff = computed(() => {
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  if (!publishedSite && siteData.value) {
    return true
  }
  if (publishedSite && !siteData.value) {
    return true
  }
  if (publishedSite && siteData.value) {
    return JSON.stringify({
      domains: publishedSite.domains,
      menus: publishedSite.menus,
      theme: publishedSite.theme,
      allowedThemes: publishedSite.allowedThemes,
      logo: publishedSite.logo,
      menuPosition: publishedSite.menuPosition,
      metaTitle: publishedSite.metaTitle,
      metaDescription: publishedSite.metaDescription,
      structuredData: publishedSite.structuredData,
    }) !== JSON.stringify({
      domains: siteData.value.domains,
      menus: siteData.value.menus,
      theme: siteData.value.theme,
      allowedThemes: siteData.value.allowedThemes,
      logo: siteData.value.logo,
      menuPosition: siteData.value.menuPosition,
      metaTitle: siteData.value.metaTitle,
      metaDescription: siteData.value.metaDescription,
      structuredData: siteData.value.structuredData,
    })
  }
  return false
})

const publishSiteSettings = async () => {
  console.log('Publishing site settings for site:', props.site)
  await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`, siteData.value)
}

const discardSiteSettings = async () => {
  console.log('Discarding site settings for site:', props.site)
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  if (publishedSite) {
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, {
      domains: publishedSite.domains || [],
      menus: publishedSite.menus || {},
      theme: publishedSite.theme || '',
      allowedThemes: publishedSite.allowedThemes || [],
      logo: publishedSite.logo || '',
      menuPosition: publishedSite.menuPosition || '',
      metaTitle: publishedSite.metaTitle || '',
      metaDescription: publishedSite.metaDescription || '',
      structuredData: publishedSite.structuredData || '',
    })
  }
}

const unPublishSite = async () => {
  console.log('Unpublishing site:', props.site)
  const pages = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  for (const pageId of Object.keys(pages)) {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageId)
  }
  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`, props.site)
}

const publishSite = async () => {
  for (const [pageId, pageData] of Object.entries(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {})) {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageData)
  }
}

const pages = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
})

watch (() => siteData.value, () => {
  if (isTemplateSite.value)
    return
  if (siteData.value?.menus) {
    console.log('Loading menus from site data')
    state.saving = true
    state.menus = JSON.parse(JSON.stringify(siteData.value.menus))
    state.saving = false
  }
}, { immediate: true, deep: true })

const buildTemplateMenus = (pagesCollection) => {
  const items = Object.entries(pagesCollection || {})
    .map(([id, doc]) => ({
      name: doc?.name || 'Untitled Page',
      item: id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    'Site Root': items,
  }
}

watch(pages, (pagesCollection) => {
  if (!isTemplateSite.value)
    return
  const nextMenu = buildTemplateMenus(pagesCollection)
  if (JSON.stringify(state.menus) === JSON.stringify(nextMenu))
    return
  state.menus = nextMenu
}, { immediate: true, deep: true })

watch(() => state.siteSettings, (open) => {
  if (!open)
    state.logoPickerOpen = false
})

watch(() => state.menus, async (newVal) => {
  if (JSON.stringify(siteData.value.menus) === JSON.stringify(newVal)) {
    return
  }
  if (!state.mounted) {
    return
  }
  if (state.saving) {
    return
  }
  state.saving = true
  // todo loop through menus and if any item is a blank string use the name {name:'blah', item: ''} and used edgeFirebase to add that page and wait for complete and put docId as value of item
  const newPage = JSON.parse(JSON.stringify(pageInit))
  for (const [menuName, items] of Object.entries(newVal)) {
    for (const [index, item] of items.entries()) {
      if (typeof item.item === 'string') {
        if (item.item === '') {
          newPage.name = item.name
          console.log('Creating new page for menu item:', item)
          const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, newPage)
          const docId = result?.meta?.docId
          item.item = docId
        }
        else {
          if (item.name === 'Deleting...') {
            await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, item.item)
            state.menus[menuName].splice(index, 1)
          }
        }
      }
      if (typeof item.item === 'object') {
        for (const [subMenuName, subItems] of Object.entries(item.item)) {
          for (const [subIndex, subItem] of subItems.entries()) {
            if (typeof subItem.item === 'string') {
              if (subItem.item === '') {
                newPage.name = subItem.name
                const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, newPage)
                const docId = result?.meta?.docId
                subItem.item = docId
              }
              else {
                if (subItem.name === 'Deleting...') {
                  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, subItem.item)
                  state.menus[menuName][index].item[subMenuName].splice(subIndex, 1)
                }
              }
            }
          }
        }
        if (Object.keys(item.item).length === 0) {
          state.menus[menuName].splice(index, 1)
        }
      }
    }
  }
  if (!isTemplateSite.value)
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { menus: state.menus })
  state.saving = false
}, { deep: true })

const formErrors = (error) => {
  console.log('Form errors:', error)
  console.log(Object.values(error))
  if (Object.values(error).length > 0) {
    console.log('Form errors found')
    state.hasError = true
    console.log(state.hasError)
  }
  state.hasError = false
}

const onSubmit = () => {
  if (!state.hasError) {
    state.siteSettings = false
  }
}

const isAllPagesPublished = computed(() => {
  const pagesData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  return Object.keys(pagesData).length === Object.keys(publishedData).length
})

const isSiteSettingPublished = computed(() => {
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  return !!publishedSite
})

const isAnyPagesDiff = computed(() => {
  const pagesData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  for (const [pageId, pageData] of Object.entries(pagesData)) {
    const publishedPage = publishedData?.[pageId]
    if (!publishedPage) {
      return true
    }
    if (JSON.stringify({ content: pageData.content, postContent: pageData.postContent, metaTitle: pageData.metaTitle, metaDescription: pageData.metaDescription, structuredData: pageData.structuredData }) !== JSON.stringify({ content: publishedPage.content, postContent: publishedPage.postContent, metaTitle: publishedPage.metaTitle, metaDescription: publishedPage.metaDescription, structuredData: publishedPage.structuredData })) {
      return true
    }
  }
  return false
})

const isAnyPagesPublished = computed(() => {
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  return Object.keys(publishedData).length > 0
})

const pageSettingsUpdated = async (pageData) => {
  console.log('Page settings updated:', pageData)
  state.updating = true
  await nextTick()
  state.updating = false
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-editor
      v-if="!props.page && props.site === 'new'"
      collection="sites"
      :doc-id="props.site"
      :schema="schemas.sites"
      :new-doc-schema="state.newDocs.sites"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none"
      :show-footer="false"
      @saved="handleNewSiteSaved"
    >
      <template #header-start="slotProps">
        <FilePenLine class="mr-2" />
        {{ slotProps.title }}
      </template>
      <template #header-end="slotProps">
        <edge-shad-button
          v-if="!slotProps.unsavedChanges"
          to="/app/dashboard/sites"
          class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Close
        </edge-shad-button>
        <edge-shad-button
          v-else
          to="/app/dashboard/sites"
          class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          type="submit"
          class="bg-slate-500 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Save
        </edge-shad-button>
      </template>
      <template #main="slotProps">
        <div class="flex-col flex gap-4 mt-4">
          <edge-shad-input
            v-model="slotProps.workingDoc.name"
            name="name"
            label="Name"
            placeholder="Enter name"
            class="w-full"
          />
          <edge-shad-tags
            v-model="slotProps.workingDoc.domains"
            name="domains"
            label="Domains"
            placeholder="Add or remove domains"
            class="w-full"
          />
          <edge-shad-select-tags
            v-if="isAdmin"
            :model-value="Array.isArray(slotProps.workingDoc.allowedThemes) ? slotProps.workingDoc.allowedThemes : []"
            name="allowedThemes"
            label="Allowed Themes"
            placeholder="Select allowed themes"
            class="w-full"
            :items="themeOptions"
            item-title="label"
            item-value="value"
            @update:model-value="(value) => {
              const normalized = Array.isArray(value) ? value : []
              slotProps.workingDoc.allowedThemes = normalized
              if (normalized.length && !normalized.includes(slotProps.workingDoc.theme)) {
                slotProps.workingDoc.theme = normalized[0] || ''
              }
            }"
          />
          <edge-shad-select
            :model-value="slotProps.workingDoc.theme || ''"
            name="theme"
            label="Theme"
            placeholder="Select a theme"
            class="w-full"
            :items="themeItemsForAllowed(isAdmin ? slotProps.workingDoc.allowedThemes : themeOptions.map(option => option.value), slotProps.workingDoc.theme)"
            item-title="label"
            item-value="value"
            @update:model-value="value => (slotProps.workingDoc.theme = value || '')"
          />
          <edge-shad-select-tags
            v-if="Object.keys(orgUsers).length > 0"
            v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
            :items="userOptions"
            name="users"
            label="Users"
            item-title="label"
            item-value="value"
            placeholder="Select users"
            class="w-full"
            :multiple="true"
          />
          <div class="rounded-lg border border-dashed border-slate-200 p-4 ">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-foreground">
                  AI (optional)
                </div>
                <p class="text-xs text-muted-foreground">
                  Include user data and instructions for the first AI-generated version of the site.
                </p>
              </div>
              <!-- <edge-shad-switch
                v-model="state.aiSectionOpen"
                name="enableAi"
                label="Add AI details"
              /> -->
            </div>
            <div class="space-y-3">
              <edge-shad-select
                :model-value="slotProps.workingDoc.aiAgentUserId || ''"
                name="aiAgentUserId"
                label="User Data for AI to use to build initial site"
                placeholder="- select one -"
                class="w-full"
                :items="userOptions"
                item-title="label"
                item-value="value"
                @update:model-value="value => (slotProps.workingDoc.aiAgentUserId = value || '')"
              />
              <edge-shad-textarea
                v-model="slotProps.workingDoc.aiInstructions"
                name="aiInstructions"
                label="Additional AI instructions"
                placeholder="Share any goals, tone, or details the AI should prioritize"
                class="w-full"
              />
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
    <ResizablePanelGroup v-else direction="horizontal" class="w-full h-full">
      <ResizablePanel class="bg-sidebar text-sidebar-foreground" :default-size="16">
        <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-2">
          <template #start>
            <div class="flex flex-col gap-0">
              <span>{{ siteData.name || 'Templates' }}</span>
            </div>
          </template>
          <template #center>
            <div />
          </template>
          <template #end>
            <DropdownMenu v-if="!isTemplateSite">
              <DropdownMenuTrigger as-child>
                <SidebarMenuAction class="mt-1">
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuLabel class="flex items-center gap-2">
                  <FileStack class="w-5 h-5" />{{ siteData.name || 'Templates' }}
                </DropdownMenuLabel>

                <DropdownMenuSeparator v-if="isSiteDiff" />
                <DropdownMenuLabel v-if="isSiteDiff" class="flex items-center gap-2">
                  Site Settings
                </DropdownMenuLabel>

                <DropdownMenuItem v-if="isSiteDiff" class="pl-4 text-xs" @click="publishSiteSettings">
                  <FolderUp />
                  Publish
                </DropdownMenuItem>
                <DropdownMenuItem v-if="isSiteDiff && isSiteSettingPublished" class="pl-4 text-xs" @click="discardSiteSettings">
                  <FolderX />
                  Discard Changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem v-if="isAnyPagesDiff" @click="publishSite">
                  <FolderUp />
                  Publish All Pages
                </DropdownMenuItem>
                <DropdownMenuItem v-if="isSiteSettingPublished || isAnyPagesPublished" @click="unPublishSite">
                  <FolderDown />
                  Unpublish Site
                </DropdownMenuItem>

                <DropdownMenuItem @click="state.siteSettings = true">
                  <FolderCog />
                  <span>Settings</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div v-else />
          </template>
        </edge-menu>
        <SidebarGroup class="mt-0 pt-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <template v-if="!isTemplateSite">
                <Transition name="fade" mode="out-in">
                  <div v-if="isSiteDiff" key="unpublished" class="flex gap-1 items-center mt-2 bg-yellow-100 text-xs py-1 px-4 text-yellow-800">
                    <CircleAlert class="!text-yellow-800 w-3 h-3" />
                    <span class="font-medium text-[10px]">
                      Unpublished Settings
                    </span>
                  </div>
                  <div v-else key="published" class="flex gap-1 items-center mt-2 bg-green-100 text-xs py-1 px-4 text-green-800">
                    <FileCheck class="!text-green-800 w-3 h-3" />
                    <span class="font-medium text-[10px]">
                      Settings Published
                    </span>
                  </div>
                </Transition>
                <Tabs default-value="pages" class="mt-2">
                  <TabsList class="grid w-full grid-cols-2 py-0">
                    <TabsTrigger value="pages" class="py-0">
                      Pages
                    </TabsTrigger>
                    <TabsTrigger value="posts" class="py-0">
                      Posts
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="pages" class="p-0">
                    <edge-cms-menu
                      v-if="state.menus"
                      v-model="state.menus"
                      :site="props.site"
                      :page="props.page"
                      :is-template-site="isTemplateSite"
                      :theme-options="themeOptions"
                      @page-settings-update="pageSettingsUpdated"
                    />
                  </TabsContent>
                  <TabsContent value="posts" class="p-0">
                    <edge-cms-posts :site="props.site" @updating="isUpdating => state.updating = isUpdating" />
                  </TabsContent>
                </Tabs>
              </template>
              <template v-else>
                <edge-cms-menu
                  v-if="state.menus"
                  v-model="state.menus"
                  :site="props.site"
                  :page="props.page"
                  :is-template-site="isTemplateSite"
                  :theme-options="themeOptions"
                  @page-settings-update="pageSettingsUpdated"
                />
              </template>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ResizablePanel>
      <ResizablePanel ref="mainPanel">
        <Transition name="fade" mode="out-in">
          <div v-if="props.page && !state.updating" :key="props.page" class="max-h-[calc(100vh-50px)] overflow-y-auto w-full">
            <NuxtPage class="flex flex-col flex-1 p-3 pt-0" />
          </div>
          <div v-else class="p-4 text-center flex text-slate-500 h-[calc(100vh-4rem)] justify-center items-center overflow-y-auto">
            <div class="text-4xl">
              <ArrowLeft class="inline-block w-12 h-12 mr-2" /> Select a page to get started.
            </div>
          </div>
        </Transition>
      </ResizablePanel>
    </ResizablePanelGroup>
    <Sheet v-model:open="state.siteSettings">
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>{{ siteData.name || 'Site' }}</SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <edge-editor
          collection="sites"
          :doc-id="props.site"
          :schema="schemas.sites"
          :new-doc-schema="state.newDocs.sites"
          class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none px-0 mx-0 shadow-none"
          :show-footer="false"
          :show-header="false"
          :save-function-override="onSubmit"
          card-content-class="px-0"
          @error="formErrors"
        >
          <template #main="slotProps">
            <div class="p-6 space-y-4  h-[calc(100vh-140px)] overflow-y-auto">
              <edge-shad-input
                v-model="slotProps.workingDoc.name"
                name="name"
                label="Name"
                placeholder="Enter name"
                class="w-full"
              />
              <edge-shad-tags
                v-model="slotProps.workingDoc.domains"
                name="domains"
                label="Domains"
                placeholder="Add or remove domains"
                class="w-full"
              />
              <edge-shad-select-tags
                v-if="isAdmin"
                :model-value="Array.isArray(slotProps.workingDoc.allowedThemes) ? slotProps.workingDoc.allowedThemes : []"
                name="allowedThemes"
                label="Allowed Themes"
                placeholder="Select allowed themes"
                class="w-full"
                :items="themeOptions"
                item-title="label"
                item-value="value"
                @update:model-value="(value) => {
                  const normalized = Array.isArray(value) ? value : []
                  slotProps.workingDoc.allowedThemes = normalized
                  if (normalized.length && !normalized.includes(slotProps.workingDoc.theme)) {
                    slotProps.workingDoc.theme = normalized[0] || ''
                  }
                }"
              />
              <edge-shad-select
                :model-value="slotProps.workingDoc.theme || ''"
                name="theme"
                label="Theme"
                placeholder="Select a theme"
                class="w-full"
                :items="themeItemsForAllowed(slotProps.workingDoc.allowedThemes, slotProps.workingDoc.theme)"
                item-title="label"
                item-value="value"
                @update:model-value="value => (slotProps.workingDoc.theme = value || '')"
              />
              <div class="space-y-2">
                <label class="text-sm font-medium text-foreground flex items-center justify-between">
                  Logo
                  <edge-shad-button
                    type="button"
                    variant="link"
                    class="px-0 h-auto text-sm"
                    @click="state.logoPickerOpen = !state.logoPickerOpen"
                  >
                    {{ state.logoPickerOpen ? 'Hide picker' : 'Select logo' }}
                  </edge-shad-button>
                </label>
                <div class="flex items-center gap-4">
                  <div v-if="slotProps.workingDoc.logo" class="flex items-center gap-3">
                    <img :src="slotProps.workingDoc.logo" alt="Logo preview" class="h-16 w-auto rounded-md border border-border bg-muted object-contain">
                    <edge-shad-button
                      type="button"
                      variant="ghost"
                      class="h-8"
                      @click="slotProps.workingDoc.logo = ''"
                    >
                      Remove
                    </edge-shad-button>
                  </div>
                  <span v-else class="text-sm text-muted-foreground italic">No logo selected</span>
                </div>
                <div v-if="state.logoPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
                  <edge-cms-media-manager
                    :site="props.site"
                    :select-mode="true"
                    :default-tags="['Logos']"
                    @select="(url) => {
                      slotProps.workingDoc.logo = url
                      state.logoPickerOpen = false
                    }"
                  />
                </div>
              </div>
              <edge-shad-select
                :model-value="slotProps.workingDoc.menuPosition || ''"
                name="menuPosition"
                label="Menu Position"
                placeholder="Select menu position"
                class="w-full"
                :items="menuPositionOptions"
                item-title="label"
                item-value="value"
                @update:model-value="value => (slotProps.workingDoc.menuPosition = value || '')"
              />
              <edge-shad-select-tags
                v-if="Object.keys(orgUsers).length > 0 && isAdmin"
                v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
                :items="Object.values(orgUsers)" name="users" label="Users"
                item-title="meta.name" item-value="userId" placeholder="Select users" class="w-full" :multiple="true"
              />
              <Card>
                <CardHeader>
                  <CardTitle>SEO</CardTitle>
                  <CardDescription>Default settings if the information is not entered on the page.</CardDescription>
                </CardHeader>
                <CardContent class="pt-0">
                  <edge-shad-input
                    v-model="slotProps.workingDoc.metaTitle"
                    label="Meta Title"
                    name="metaTitle"
                  />
                  <edge-shad-textarea
                    v-model="slotProps.workingDoc.metaDescription"
                    label="Meta Description"
                    name="metaDescription"
                  />
                  <edge-cms-code-editor
                    v-model="slotProps.workingDoc.structuredData"
                    title="Structured Data (JSON-LD)"
                    language="json"
                    name="structuredData"
                    height="300px"
                    class="mb-4 w-full"
                  />
                </CardContent>
              </Card>
            </div>
            <SheetFooter class="pt-2 flex justify-between">
              <edge-shad-button variant="destructive" class="text-white" @click="state.siteSettings = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button :disabled="slotProps.submitting" type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
                <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
                Update
              </edge-shad-button>
            </SheetFooter>
          </template>
        </edge-editor>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
