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
})
const emit = defineEmits(['update:modelValue'])
const ROOT_MENUS = ['Site Root', 'Not In Menu']
const router = useRouter()
const modelValue = useVModel(props, 'modelValue', emit)
const route = useRoute()
const edgeFirebase = inject('edgeFirebase')

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
    return JSON.stringify(publishedPage.content) !== JSON.stringify(draftPage.content)
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
    },
  },
  hasErrors: false,
})

const renameFolderOrPageShow = (item) => {
  state.renameItem = item
  state.renameItem.previousName = item.name
  state.renameFolderOrPageDialog = true
}

const addPageShow = (menuName, isMenu = false) => {
  state.addMenu = isMenu
  state.menuName = menuName
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
  const slug = slugGenerator(state.newPageName)
  if (!state.menuName) {
    modelValue.value[state.newPageName] = []
    state.newPageName = ''
    state.addPageDialog = false
    return
  }
  if (state.addMenu) {
    modelValue.value[state.menuName].push({ item: { [slug]: [] } })
  }
  else {
    modelValue.value[state.menuName].push({ name: slug, item: '' })
  }

  state.newPageName = ''
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
    router.replace(`/app/dashboard/sites/${props.site}`)
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
    state.pageSettings = false
  }
}
const titleFromSlug = (slug) => {
  if (!slug)
    return ''
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}
</script>

<template>
  <!-- <SidebarMenuItem v-if="!props.prevMenu" class="mt-2" @click="addPageShow('', true)">
    <SidebarMenuButton class="!text-center" @click="addPageShow('', true)">
      <div class="w-full text-center flex gap-1 justify-center items-center">
        <PlusIcon class="h-4 w-4" />
        Add Top Level Menu
      </div>
    </SidebarMenuButton>
  </SidebarMenuItem> -->
  <SidebarMenuItem v-for="(menu, menuName) in modelValue" :key="menu.name">
    <SidebarMenuButton class="!px-0 hover:!bg-transparent">
      <!-- Open icon (visible when group IS open) -->
      <FolderOpen
        class="mr-2"
      />
      <span>{{ menuName === 'Site Root' ? 'Site Menu' : menuName }}</span>
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
            <DropdownMenuItem v-if="!props.prevMenu" @click="addPageShow(menuName, true)">
              <FolderPlus />
              <span>New Folder</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canRename(menuName)" @click="renameFolderOrPageShow({ name: menuName, item: '' })">
              <FolderPen />
              <span>Rename Folder</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="flex-col gap-0 items-start" :disabled="disabledFolderDelete(menuName, menu)" @click="deletePageShow({ name: menuName, item: '' })">
              <span class="my-0 py-0 flex"> <FolderMinus class="mr-2 h-4 w-4" />Delete Folder</span>
              <span v-if="disabledFolderDelete(menuName, menu) && ROOT_MENUS.includes(menuName)" class="my-0 text-gray-400 py-0 text-xs">(Cannot delete {{ menuName }})</span>
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
            <edge-cms-menu v-if="typeof element.item === 'object'" v-model="modelValue[menuName][index].item" :prev-menu="menuName" :prev-model-value="modelValue" :site="props.site" :page="props.page" :prev-index="index" />
            <SidebarMenuSubItem v-else class="relative">
              <SidebarMenuSubButton :class="{ 'text-gray-400': element.item === '' }" as-child :is-active="element.item === props.page">
                <NuxtLink :disabled="element.item === ''" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="text-xs" :to="`/app/dashboard/sites/${props.site}/${element.item}`">
                  <Loader2 v-if="element.item === '' || element.name === 'Deleting...'" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="w-4 h-4 animate-spin" />
                  <FileWarning v-else-if="isPublishedPageDiff(element.item)" class="!text-yellow-600" />
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
                    <DropdownMenuItem @click="showPageSettings(element)">
                      <FileCog />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="isPublishedPageDiff(element.item)" @click="publishPage(element.item)">
                      <FileUp />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="renameFolderOrPageShow(element)">
                      <FilePen />
                      <span>Rename</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem v-if="isPublishedPageDiff(element.item) && isPublished(element.item)" @click="discardPageChanges(element.item)">
                      <FileX />
                      Discard Changes
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="isPublished(element.item)" @click="unPublishPage(element.item)">
                      <FileDown />
                      Unpublish
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="deletePageShow(element)">
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
  <edge-shad-dialog
    v-model="state.addPageDialog"
  >
    <DialogContent class="pt-10">
      <edge-shad-form :schema="pages" @submit="addPageAction">
        <DialogHeader>
          <DialogTitle class="text-left">
            <span v-if="!state.menuName">Add Menu</span>
            <span v-else-if="state.addMenu">Add folder to "{{ state.menuName }}"</span>
            <span v-else>
              Add page to "{{ state.menuName }}"
            </span>
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <edge-shad-input v-model="state.newPageName" name="name" placeholder="Page Name" />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="destructive" @click="state.addPageDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="submit" class="text-white bg-slate-800 hover:bg-slate-400 w-full">
            <span v-if="state.addMenu">
              Add Folder
            </span>
            <span v-else>
              Add Page
            </span>
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
          <div class="p-6 space-y-4  h-[calc(100vh-126px)] overflow-y-auto">
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
