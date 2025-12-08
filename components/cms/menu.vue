<script setup lang="js">
import { useVModel } from '@vueuse/core'
import { File, FileCheck, FileCog, FileDown, FileMinus2, FilePen, FilePlus2, FileUp, FileWarning, FileX, Folder, FolderMinus, FolderOpen, FolderPen, FolderPlus } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps({
  prevModelValue: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  modelValue: {
    type: Object,
    required: true,
  },
  prevMenu: {
    type: String,
    default: '',
  },
  dataDraggable: {
    type: Boolean,
    default: true,
  },
  prevIndex: {
    type: Number,
    default: -1,
  },
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: false,
    default: '',
  },
  isTemplateSite: {
    type: Boolean,
    default: false,
  },
  themeOptions: {
    type: Array,
    default: () => [],
  },
})
const emit = defineEmits(['update:modelValue', 'pageSettingsUpdate'])
const ROOT_MENUS = ['Site Root', 'Not In Menu']
const router = useRouter()
const modelValue = useVModel(props, 'modelValue', emit)
const route = useRoute()
const edgeFirebase = inject('edgeFirebase')

const orderedMenus = computed(() => {
  const menuEntries = Object.entries(modelValue.value || {}).map(([name, menu], originalIndex) => ({
    name,
    menu,
    originalIndex,
  }))
  const priority = (name) => {
    if (name === 'Site Root')
      return 0
    if (name === 'Not In Menu')
      return 2
    return 1
  }
  return menuEntries.sort((a, b) => priority(a.name) - priority(b.name) || a.originalIndex - b.originalIndex)
})

const pageRouteBase = computed(() => {
  return props.site === 'templates'
    ? '/app/dashboard/templates'
    : `/app/dashboard/sites/${props.site}`
})

const isPublishedPageDiff = (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  const draftPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[pageId]
  if (!publishedPage && draftPage) {
    return true
  }
  if (publishedPage && !draftPage) {
    return true
  }
  if (publishedPage && draftPage) {
    return JSON.stringify({ content: publishedPage.content, postContent: publishedPage.postContent, metaTitle: publishedPage.metaTitle, metaDescription: publishedPage.metaDescription, structuredData: publishedPage.structuredData }) !== JSON.stringify({ content: draftPage.content, postContent: draftPage.postContent, metaTitle: draftPage.metaTitle, metaDescription: draftPage.metaDescription, structuredData: draftPage.structuredData })
  }
  return false
}

const isPublished = (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  return !!publishedPage
}

const schemas = {
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
    tags: z.array(z.string()).optional(),
    allowedThemes: z.array(z.string()).optional(),
  })),
}

const state = reactive({
  addPageDialog: false,
  newPageName: '',
  indexPath: '',
  addMenu: false,
  deletePage: {},
  renameItem: {},
  renameFolderOrPageDialog: false,
  deletePageDialog: false,
  pageSettings: false,
  pageData: {},
  newDocs: {
    pages: {
      name: { value: '' },
      content: { value: [] },
      blockIds: { value: [] },
      tags: { value: [] },
      allowedThemes: { value: [] },
    },
  },
  hasErrors: false,
  templateFilter: 'quick-picks',
  selectedTemplateId: 'blank',
  showTemplatePicker: false,
})

const templateTagItems = computed(() => {
  if (!props.isTemplateSite)
    return []
  const pages
    = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const tags = new Set()
  for (const doc of Object.values(pages)) {
    if (Array.isArray(doc?.tags)) {
      for (const tag of doc.tags) {
        const normalized = typeof tag === 'string' ? tag.trim() : ''
        if (normalized && normalized.toLowerCase() !== 'quick picks')
          tags.add(normalized)
      }
    }
  }
  const tagList = Array.from(tags).sort((a, b) => a.localeCompare(b)).map(tag => ({ name: tag, title: tag }))
  return [{ name: 'Quick Picks', title: 'Quick Picks' }, ...tagList]
})

const resetAddPageDialogState = () => {
  state.newPageName = ''
  state.templateFilter = 'quick-picks'
  state.selectedTemplateId = BLANK_TEMPLATE_ID
  state.showTemplatePicker = false
}

watch(() => state.addPageDialog, (open) => {
  if (!open)
    resetAddPageDialogState()
})

onMounted(async () => {
  if (!edgeGlobal.edgeState.organizationDocPath)
    return
  const path = TEMPLATE_COLLECTION_PATH.value
  if (!edgeFirebase.data?.[path])
    await edgeFirebase.startSnapshot(path)
})

const TEMPLATE_COLLECTION_PATH = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)

const templatePagesCollection = computed(() => {
  return edgeFirebase.data?.[TEMPLATE_COLLECTION_PATH.value] || {}
})

const templatePagesList = computed(() => {
  return Object.entries(templatePagesCollection.value).map(([docId, doc]) => ({
    docId,
    ...(doc || {}),
    name: doc?.name || 'Untitled Template',
    tags: Array.isArray(doc?.tags) ? doc.tags : [],
    description: doc?.metaDescription || doc?.description || '',
    content: Array.isArray(doc?.content) ? doc.content : [],
  }))
})

const templateFilterOptions = computed(() => {
  const tagSet = new Set()
  for (const template of templatePagesList.value) {
    for (const tag of template.tags || []) {
      if (!tag)
        continue
      if (tag.toLowerCase() === 'quick picks')
        continue
      tagSet.add(tag)
    }
  }
  const tagOptions = Array.from(tagSet)
    .sort((a, b) => a.localeCompare(b))
    .map(tag => ({ label: tag, value: tag }))
  return [
    { label: 'Quick Picks', value: 'quick-picks' },
    ...tagOptions,
  ]
})

const filterMatchesTemplate = (template, filterValue) => {
  if (filterValue === 'all')
    return true
  if (filterValue === 'quick-picks')
    return template.tags?.some(tag => tag?.toLowerCase() === 'quick picks'.toLowerCase())
  return template.tags?.some(tag => tag === filterValue)
}

const filteredTemplates = computed(() => {
  const templates = templatePagesList.value
  const filterValue = state.templateFilter
  const filtered = templates.filter(template => filterMatchesTemplate(template, filterValue))
  if (filtered.length === 0 && filterValue === 'quick-picks')
    return templates
  if (filtered.length === 0 && filterValue !== 'all')
    return templates
  return filtered
})

watch(filteredTemplates, (templates) => {
  if (state.selectedTemplateId === BLANK_TEMPLATE_ID)
    return
  if (!templates.some(template => template.docId === state.selectedTemplateId))
    state.selectedTemplateId = BLANK_TEMPLATE_ID
})

const BLANK_TEMPLATE_ID = 'blank'

const blankTemplateTile = {
  docId: BLANK_TEMPLATE_ID,
  name: 'Blank Page',
  tags: ['Start from scratch'],
  description: 'Create a new page without any blocks.',
  content: [],
}

const templateGridItems = computed(() => {
  return [blankTemplateTile, ...filteredTemplates.value]
})

const hasValidNewPageName = computed(() => !!(state.newPageName && state.newPageName.trim().length))

const blocksCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {}
})

const resolveBlockForPreview = (block) => {
  if (!block)
    return null
  if (block.content)
    return {
      content: block.content,
      values: block.values || {},
      meta: block.meta || {},
    }
  if (block.blockId && blocksCollection.value?.[block.blockId]) {
    const libraryBlock = blocksCollection.value[block.blockId]
    return {
      content: libraryBlock.content,
      values: block.values || libraryBlock.values || {},
      meta: block.meta || libraryBlock.meta || {},
    }
  }
  return null
}

const templateHasBlocks = template => Array.isArray(template?.content) && template.content.length > 0

const templatePreviewBlocks = (template) => {
  if (!templateHasBlocks(template))
    return []
  return template.content
}

const renameFolderOrPageShow = (item) => {
  // Work on a copy so edits in the dialog do not mutate the live menu entry.
  state.renameItem = edgeGlobal.dupObject(item || {})
  state.renameItem.previousName = item?.name
  state.renameFolderOrPageDialog = true
}

const addPageShow = (menuName, isMenu = false) => {
  state.addMenu = isMenu
  state.menuName = menuName
  resetAddPageDialogState()
  state.addPageDialog = true
}

const deletePageShow = (page) => {
  state.deletePage = page
  state.deletePageDialog = true
}

const collectRootLevelSlugs = (excludeName = '') => {
  const slugs = new Set()
  if (!props.prevMenu) {
    for (const root of ROOT_MENUS) {
      const arr = modelValue.value?.[root] || []
      for (const entry of arr) {
      // Top-level page at "/<slug>"
        if (typeof entry.item === 'string') {
          if (entry.name && entry.name !== excludeName)
            slugs.add(entry.name)
        }
        // Top-level folder at "/<folder>/*"
        else if (entry && typeof entry.item === 'object') {
          const key = Object.keys(entry.item)[0]
          if (key && key !== excludeName)
            slugs.add(key)
        }
      }
    }
  }
  else {
    if (state.renameItem.item === '') {
      for (const root of ROOT_MENUS) {
        const arr = props.prevModelValue?.[root] || []
        for (const entry of arr) {
          // Top-level page at "/<slug>"
          if (typeof entry.item === 'string') {
            if (entry.name && entry.name !== excludeName)
              slugs.add(entry.name)
          }
          // Top-level folder at "/<folder>/*"
          else if (entry && typeof entry.item === 'object') {
            const key = Object.keys(entry.item)[0]
            if (key && key !== excludeName)
              slugs.add(key)
          }
        }
      }
    }
    else {
      const key = Object.keys(modelValue.value)[0]
      const arr = modelValue.value?.[key] || []
      for (const entry of arr) {
      // Top-level page at "/<slug>"
        if (typeof entry.item === 'string') {
          if (entry.name && entry.name !== excludeName)
            slugs.add(entry.name)
        }
        // Top-level folder at "/<folder>/*"
        else if (entry && typeof entry.item === 'object') {
          const key = Object.keys(entry.item)[0]
          if (key && key !== excludeName)
            slugs.add(key)
        }
      }
    }
  }
  return slugs
}

const slugGenerator = (name, excludeName = '') => {
  // Build a set of existing slugs that map to URLs off of "/" from *both* root menus.
  const existing = collectRootLevelSlugs(excludeName)
  console.log('Existing slugs:', existing)

  const base = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : ''
  let unique = base
  let suffix = 1
  while (existing.has(unique)) {
    unique = `${base}-${suffix}`
    suffix += 1
  }
  return unique
}

const selectTemplate = (templateId) => {
  state.selectedTemplateId = templateId
  state.showTemplatePicker = false
}

const isTemplateSelected = templateId => state.selectedTemplateId === templateId

const getTemplateDoc = (templateId) => {
  if (templateId === BLANK_TEMPLATE_ID)
    return null
  return templatePagesCollection.value?.[templateId] || null
}

const extractBlockIds = (blocks = []) => {
  if (!Array.isArray(blocks))
    return []
  return blocks
    .map(block => block?.blockId || block?.id)
    .filter(Boolean)
}

const deriveBlockIds = (pageDoc = {}) => {
  const ids = [
    ...extractBlockIds(pageDoc.content),
    ...extractBlockIds(pageDoc.postContent),
  ]
  return Array.from(new Set(ids))
}

const getSyncedBlockFromSite = (blockId) => {
  if (!blockId)
    return null
  const pages = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  for (const page of Object.values(pages)) {
    const contentBlocks = Array.isArray(page?.content) ? page.content : []
    const postBlocks = Array.isArray(page?.postContent) ? page.postContent : []
    for (const candidate of [...contentBlocks, ...postBlocks]) {
      if (candidate?.blockId === blockId && candidate?.synced)
        return edgeGlobal.dupObject(candidate)
    }
  }
  return null
}

const hydrateSyncedBlocksFromSite = (blocks = []) => {
  if (!Array.isArray(blocks) || !blocks.length)
    return blocks

  return blocks.map((block) => {
    if (!block?.synced || !block.blockId)
      return block
    const existing = getSyncedBlockFromSite(block.blockId)
    if (!existing)
      return block
    const hydrated = edgeGlobal.dupObject(existing)
    hydrated.id = block.id || hydrated.id || edgeGlobal.generateShortId()
    hydrated.blockId = block.blockId
    hydrated.name = block.name || hydrated.name
    return hydrated
  })
}

const buildPagePayloadFromTemplate = (templateDoc, slug) => {
  const timestamp = Date.now()
  const basePayload = {
    name: slug,
    content: [],
    postContent: [],
    blockIds: [],
    metaTitle: '',
    metaDescription: '',
    structuredData: '',
    doc_created_at: timestamp,
    last_updated: timestamp,
  }
  if (!templateDoc)
    return basePayload
  const copy = JSON.parse(JSON.stringify(templateDoc || {}))
  delete copy.docId
  copy.name = slug
  copy.doc_created_at = timestamp
  copy.last_updated = timestamp
  copy.content = Array.isArray(copy.content) ? hydrateSyncedBlocksFromSite(copy.content) : []
  copy.postContent = Array.isArray(copy.postContent) ? hydrateSyncedBlocksFromSite(copy.postContent) : []
  copy.blockIds = deriveBlockIds(copy)
  return { ...basePayload, ...copy }
}

const renameFolderOrPageAction = async () => {
  const newSlug = slugGenerator(state.renameItem.name, state.renameItem.previousName || '')

  if (state.renameItem.name === state.renameItem.previousName) {
    state.renameFolderOrPageDialog = false
    state.renameItem = {}
    return
  }

  // If the item is an empty string, we are renaming a top-level folder (handled here)
  if (state.renameItem.item === '') {
    const original = edgeGlobal.dupObject(modelValue.value)
    const originalItem = edgeGlobal.dupObject(modelValue.value[state.renameItem.previousName])
    // Renaming a folder: if the new name is empty, abort and reset dialog state
    if (!state.renameItem.name) {
      state.renameFolderOrPageDialog = false
      state.renameItem = {}
      return
    }
    // Move the array from the old key to the new key, then delete the old key
    modelValue.value[newSlug] = originalItem
    console.log('updated modelValue:', modelValue.value)
    delete modelValue.value[state.renameItem.previousName]
    state.renameFolderOrPageDialog = false
    state.renameItem = {}
    return
  }

  // Renaming a page: the page is uniquely identified by its docId in `state.renameItem.item`.
  // Traverse all menus and submenus; update the `name` where the `item` matches that docId (strings only).
  const targetDocId = state.renameItem.item
  // const newName = state.renameItem.name || ''

  let renamed = false
  for (const [menuName, items] of Object.entries(modelValue.value)) {
    for (const item of items) {
      if (typeof item.item === 'string' && item.item === targetDocId) {
        const results = await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, targetDocId, { name: newSlug })
        if (results.success) {
          item.name = newSlug
          renamed = true
        }
        break
      }
    }
    if (renamed)
      break
  }
  console.log(modelValue.value)
  // Close dialog and reset state regardless
  state.renameFolderOrPageDialog = false
  state.renameItem = {}
}

const addPageAction = async () => {
  state.newPageName = state.newPageName?.trim() || ''
  if (!state.newPageName)
    return
  const slug = slugGenerator(state.newPageName)
  if (!state.menuName) {
    modelValue.value[state.newPageName] = []
    state.newPageName = ''
    state.addPageDialog = false
    return
  }

  if (!Array.isArray(modelValue.value[state.menuName]))
    modelValue.value[state.menuName] = []

  if (state.addMenu) {
    modelValue.value[state.menuName].push({ item: { [slug]: [] } })
  }
  else {
    const templateDoc = getTemplateDoc(state.selectedTemplateId)
    const payload = buildPagePayloadFromTemplate(templateDoc, slug)
    const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, payload)
    const docId = result?.meta?.docId
    if (docId) {
      const targetMenu = modelValue.value[state.menuName]
      const alreadyExists = Array.isArray(targetMenu) && targetMenu.some(entry => entry?.item === docId)
      if (!alreadyExists)
        targetMenu.push({ name: slug, item: docId })
    }
  }

  state.addPageDialog = false
}
const deletePageAction = async () => {
  if (state.deletePage.item === '') {
    // deleting a folder
    delete modelValue.value[state.deletePage.name]
    state.deletePageDialog = false
    state.deletePage = {}
    return
  }
  if (props.page === state.deletePage.item) {
    router.replace(pageRouteBase.value)
  }
  for (const [menuName, items] of Object.entries(modelValue.value)) {
    for (const item of items) {
      if (typeof item.item === 'string' && item.item === state.deletePage.item) {
        item.name = 'Deleting...'
      }
      if (typeof item.item === 'object') {
        for (const [subMenuName, subItems] of Object.entries(item.item)) {
          for (const subItem of subItems) {
            if (typeof subItem.item === 'string' && subItem.item === state.deletePage.item) {
              subItem.name = 'Deleting...'
            }
          }
        }
      }
    }
  }
  state.deletePageDialog = false
  state.deletePage = {}
}

const pages = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

const disabledFolderDelete = (menuName, menu) => {
  if (menuName === 'Site Root') {
    return true
  }
  if (menu.length > 0) {
    return true
  }
  return false
}

const canRename = (menuName) => {
  if (props.prevMenu) {
    return true
  }
  if (menuName === 'Site Root') {
    return false
  }
  return true
}

const publishPage = async (pageId) => {
  const pageData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  if (pageData[pageId]) {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageData[pageId])
  }
}
const unPublishPage = async (pageId) => {
  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageId)
}

const discardPageChanges = async (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  if (publishedPage) {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, publishedPage, pageId)
  }
}

const showPageSettings = (page) => {
  console.log('showPageSettings', page)
  state.pageData = page
  state.pageSettings = true
}

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
    emit('pageSettingsUpdate', state.pageData)
    state.pageSettings = false
  }
}
const titleFromSlug = (slug) => {
  if (!slug)
    return ''
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

const theme = computed(() => {
  const theme = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site]?.theme || ''
  console.log(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}`)
  let themeContents = null
  if (theme) {
    themeContents = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.theme || null
  }
  if (themeContents) {
    return JSON.parse(themeContents)
  }
  return null
})
</script>

<template>
  <SidebarMenuItem v-for="({ menu, name: menuName }) in orderedMenus" :key="menuName">
    <SidebarMenuButton class="!px-0 hover:!bg-transparent">
      <FolderOpen
        class="mr-2"
      />
      <span v-if="!props.isTemplateSite">{{ menuName === 'Site Root' ? 'Site Menu' : menuName }}</span>
      <SidebarGroupAction class="absolute right-2 top-0 hover:!bg-transparent">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuAction>
              <PlusIcon />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuLabel v-if="props.prevMenu" class="flex items-center gap-2">
              <Folder class="w-5 h-5" /> {{ ROOT_MENUS.includes(props.prevMenu) ? '' : props.prevMenu }}/{{ menuName }}/
            </DropdownMenuLabel>
            <DropdownMenuLabel v-else class="flex items-center gap-2">
              <Folder class="w-5 h-5" /> {{ ROOT_MENUS.includes(menuName) ? '' : menuName }}/
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="addPageShow(menuName, false)">
              <FilePlus2 />
              <span>New Page</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="!props.prevMenu && !props.isTemplateSite" @click="addPageShow(menuName, true)">
              <FolderPlus />
              <span>New Folder</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canRename(menuName)" @click="renameFolderOrPageShow({ name: menuName, item: '' })">
              <FolderPen />
              <span>Rename Folder</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="flex-col gap-0 items-start text-destructive" :disabled="disabledFolderDelete(menuName, menu) || ROOT_MENUS.includes(menuName)" @click="deletePageShow({ name: menuName, item: '' })">
              <span class="my-0 py-0 flex"> <FolderMinus class="mr-2 h-4 w-4" />Delete Folder</span>
              <span v-if="ROOT_MENUS.includes(menuName)" class="my-0 text-gray-400 py-0 text-xs">(Cannot delete {{ menuName }})</span>
              <span v-else-if="disabledFolderDelete(menuName, menu)" class="my-0 text-gray-400 py-0 text-xs">(Folder must be empty to delete)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGroupAction>
    </SidebarMenuButton>

    <SidebarMenuSub class="mx-0 px-2">
      <draggable
        :list="modelValue[menuName]"
        handle=".handle"
        item-key="subindex"
        class="list-group"
        :group="{ name: 'menus', pull: true, put: true }"
      >
        <template #item="{ element, index }">
          <div class="handle list-group-item">
            <edge-cms-menu
              v-if="typeof element.item === 'object'"
              v-model="modelValue[menuName][index].item"
              :prev-menu="menuName"
              :prev-model-value="modelValue"
              :site="props.site"
              :page="props.page"
              :prev-index="index"
              :is-template-site="props.isTemplateSite"
            />
            <SidebarMenuSubItem v-else class="relative">
              <SidebarMenuSubButton :class="{ 'text-gray-400': element.item === '' }" as-child :is-active="element.item === props.page">
                <NuxtLink :disabled="element.item === ''" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="text-xs" :to="`${pageRouteBase}/${element.item}`">
                  <Loader2 v-if="element.item === '' || element.name === 'Deleting...'" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="w-4 h-4 animate-spin" />
                  <FileWarning v-else-if="isPublishedPageDiff(element.item) && !props.isTemplateSite" class="!text-yellow-600" />
                  <FileCheck v-else class="text-xs !text-green-700 font-normal" />
                  <span>{{ element.name }}</span>
                </NuxtLink>
              </SidebarMenuSubButton>
              <div class="absolute right-0 -top-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <SidebarMenuAction>
                      <MoreHorizontal />
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuLabel v-if="props.prevMenu" class="flex items-center gap-2">
                      <File class="w-5 h-5" /> {{ ROOT_MENUS.includes(props.prevMenu) ? '' : props.prevMenu }}/{{ menuName }}/{{ element.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuLabel v-else class="flex items-center gap-2">
                      <File class="w-5 h-5" />  {{ ROOT_MENUS.includes(menuName) ? '' : menuName }}/{{ element.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem :disabled="edgeGlobal.edgeState.cmsPageWithUnsavedChanges === element.item" @click="showPageSettings(element)">
                      <FileCog />
                      <div class="flex flex-col">
                        <span>Settings</span>
                        <span v-if="edgeGlobal.edgeState.cmsPageWithUnsavedChanges === element.item" class="text-xs text-red-500">(Unsaved Changes)</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="!props.isTemplateSite && isPublishedPageDiff(element.item)" @click="publishPage(element.item)">
                      <FileUp />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="renameFolderOrPageShow(element)">
                      <FilePen />
                      <span>Rename</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem v-if="!props.isTemplateSite && isPublishedPageDiff(element.item) && isPublished(element.item)" @click="discardPageChanges(element.item)">
                      <FileX />
                      Discard Changes
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="!props.isTemplateSite && isPublished(element.item)" @click="unPublishPage(element.item)">
                      <FileDown />
                      Unpublish
                    </DropdownMenuItem>
                    <DropdownMenuItem class="text-destructive" @click="deletePageShow(element)">
                      <FileMinus2 />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SidebarMenuSubItem>
          </div>
        </template>
      </draggable>
    </SidebarMenuSub>
  </SidebarMenuItem>
  <edge-shad-dialog
    v-model="state.deletePageDialog"
  >
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle class="text-left">
          <span v-if="state.deletePage.item === ''">Delete Folder "{{ state.deletePage.name }}"</span>
          <span v-else>Delete Page "{{ state.deletePage.name }}"</span>
        </DialogTitle>
        <DialogDescription />
      </DialogHeader>
      <div class="text-left px-1">
        Are you sure you want to delete "{{ state.deletePage.name }}"? This action cannot be undone.
      </div>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button
          class="text-white bg-slate-800 hover:bg-slate-400" @click="state.deletePageDialog = false"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          variant="destructive" class="text-white w-full" @click="deletePageAction()"
        >
          Delete Page
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog v-model="state.addPageDialog">
    <DialogContent v-if="state.addMenu" class="pt-10">
      <edge-shad-form :schema="pages" @submit="addPageAction">
        <DialogHeader>
          <DialogTitle class="text-left">
            <span v-if="!state.menuName">Add Menu</span>
            <span v-else>Add folder to "{{ state.menuName }}"</span>
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <edge-shad-input v-model="state.newPageName" name="name" placeholder="Folder Name" />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button type="button" variant="destructive" @click="state.addPageDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="submit" class="text-white bg-slate-800 hover:bg-slate-400 w-full">
            Add Folder
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
    <DialogContent v-else class="pt-6 w-full max-w-6xl h-[90vh] flex flex-col">
      <edge-shad-form :schema="pages" class="flex flex-col h-full" @submit="addPageAction">
        <DialogHeader class="pb-2">
          <DialogTitle class="text-left">
            Add page to "{{ state.menuName }}"
          </DialogTitle>
          <DialogDescription>
            Choose a template or start with a blank page. You can always customize it later.
          </DialogDescription>
        </DialogHeader>
        <div>
          <div class="w-full space-y-4">
            <edge-shad-input v-model="state.newPageName" name="name" label="Page Name" placeholder="Enter page name" />
            <edge-shad-select
              v-model="state.templateFilter"
              label="Template Tags"
              :items="templateFilterOptions"
              item-title="label"
              item-value="value"
              placeholder="Select tag"
            />
            <p class="text-xs text-muted-foreground">
              Filter templates by tag or choose Quick Picks for the most commonly used layouts.
            </p>
          </div>
          <edge-button-divider class="my-4">
            <span class="text-xs text-muted-foreground !nowrap text-center">Select Template</span>
          </edge-button-divider>
          <div class="overflow-y-auto !h-[calc(100vh-510px)] pr-1">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-fr pb-2">
              <button
                v-for="template in templateGridItems"
                :key="template.docId"
                type="button"
                class="rounded-lg border bg-card text-left p-3 flex flex-col gap-3 transition focus:outline-none focus-visible:ring-2"
                :class="isTemplateSelected(template.docId) ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
                :aria-pressed="isTemplateSelected(template.docId)"
                @click="selectTemplate(template.docId)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold truncate">{{ template.name }}</span>
                  <File class="w-4 h-4 text-muted-foreground" />
                </div>
                <div class="template-scale-wrapper border border-dashed border-border/60 rounded-md bg-background/80">
                  <div class="template-scale-inner">
                    <div class="template-scale-content space-y-4">
                      <template v-if="template.docId === BLANK_TEMPLATE_ID">
                        <div class="flex h-32 items-center justify-center text-[100px] mt-[100px] text-muted-foreground">
                          Blank page
                        </div>
                      </template>
                      <template v-else-if="templateHasBlocks(template)">
                        <div
                          v-for="(block, idx) in templatePreviewBlocks(template)"
                          :key="`${template.docId}-block-${idx}`"
                        >
                          <edge-cms-block-api
                            v-if="resolveBlockForPreview(block)"
                            :content="resolveBlockForPreview(block).content"
                            :values="resolveBlockForPreview(block).values"
                            :meta="resolveBlockForPreview(block).meta"
                            :theme="theme"
                            :isolated="true"
                          />
                        </div>
                      </template>
                      <template v-else>
                        <div class="flex h-32 items-center justify-center text-[100px] mt-[100px]  text-muted-foreground">
                          No blocks yet
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-4">
          <edge-shad-button type="button" variant="destructive" @click="state.addPageDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="submit" class="bg-slate-800 hover:bg-slate-400 text-white" :disabled="!hasValidNewPageName">
            Create Page
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>
  <edge-shad-dialog
    v-model="state.renameFolderOrPageDialog"
  >
    <DialogContent class="pt-10">
      <edge-shad-form :schema="pages" @submit="renameFolderOrPageAction">
        <DialogHeader>
          <DialogTitle class="text-left">
            <span v-if="state.renameItem.item === ''">Rename Folder "{{ state.renameItem.name }}"</span>
            <span v-else>Rename Page "{{ state.renameItem.name }}"</span>
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <edge-shad-input v-model="state.renameItem.name" name="name" placeholder="New Name" />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="destructive" @click="state.renameFolderOrPageDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="submit" class="text-white bg-slate-800 hover:bg-slate-400 w-full">
            Rename
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>
  <Sheet v-model:open="state.pageSettings">
    <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
      <SheetHeader>
        <SheetTitle>{{ state.pageData.name || 'Site' }}</SheetTitle>
        <SheetDescription />
      </SheetHeader>
      <edge-editor
        :collection="`sites/${props.site}/pages`"
        :doc-id="state.pageData.item"
        :schema="schemas.pages"
        :new-doc-schema="state.newDocs.pages"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none px-0shadow-none"
        :show-footer="false"
        :show-header="false"
        :save-function-override="onSubmit"
        card-content-class="px-0"
        @error="formErrors"
      >
        <template #main="slotProps">
          <div class="p-6 space-y-4  h-[calc(100vh-142px)] overflow-y-auto">
            <edge-shad-checkbox
              v-model="slotProps.workingDoc.post"
              label="Is a Post Template"
              name="post"
            >
              Creates both an Index Page and a Detail Page for this section.
              The Index Page lists all items (e.g., /{{ slotProps.workingDoc.name }}), while the Detail Page displays a single item (e.g., /{{ slotProps.workingDoc.name }}/:slug).
            </edge-shad-checkbox>
            <edge-shad-select-tags
              v-if="props.isTemplateSite"
              v-model="slotProps.workingDoc.tags"
              name="tags"
              label="Tags"
              placeholder="Add tags"
              :items="templateTagItems"
              :allow-additions="true"
            />
            <edge-shad-select-tags
              v-if="props.themeOptions.length"
              :model-value="Array.isArray(slotProps.workingDoc.allowedThemes) ? slotProps.workingDoc.allowedThemes : []"
              name="allowedThemes"
              label="Allowed Themes"
              placeholder="Select allowed themes"
              :items="props.themeOptions"
              item-title="label"
              item-value="value"
              @update:model-value="(value) => {
                slotProps.workingDoc.allowedThemes = Array.isArray(value) ? value : []
              }"
            />
            <Card>
              <CardHeader>
                <CardTitle>SEO</CardTitle>
                <CardDescription>Meta tags for the page.</CardDescription>
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
            <edge-shad-button variant="destructive" class="text-white" @click="state.pageSettings = false">
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
</template>

<style lang="scss">
.template-scale-wrapper {
  width: 100%;
  overflow: hidden;
  position: relative;
  border-radius: 0.5rem;
  height: 400px;
}

.template-scale-inner {
  transform-origin: top left;
  display: inline-block;
  width: 100%;
  height: 400px;
  overflow: hidden;
}

.template-scale-content {
  transform: scale(0.2);
  transform-origin: top left;
  width: 500%;
}
</style>
