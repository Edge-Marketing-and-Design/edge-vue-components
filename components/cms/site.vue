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

const state = reactive({
  filter: '',
  userFilter: 'all',
  newDocs: {
    sites: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name' }, cols: '12', value: '' },
      theme: { bindings: { 'field-type': 'collection', 'label': 'Themes', 'collection-path': 'themes' }, cols: '12', value: '' },
      domains: { bindings: { 'field-type': 'tags', 'label': 'Domains', 'helper': 'Add or remove domains' }, cols: '12', value: [] },
      users: { bindings: { 'field-type': 'users', 'label': 'Users', 'hint': 'Choose users' }, cols: '12', value: [] },
    },
  },
  mounted: false,
  page: {},
  menus: { 'Site Root': [], 'Not In Menu': [] },
  saving: false,
  siteSettings: false,
  hasError: false,
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

onBeforeMount(async () => {
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
    return JSON.stringify({ domains: publishedSite.domains, menus: publishedSite.menus, theme: publishedSite.theme }) !== JSON.stringify({ domains: siteData.value.domains, menus: siteData.value.menus, theme: siteData.value.theme })
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
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { domains: publishedSite.domains || [], menus: publishedSite.menus || {} })
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
  if (siteData.value?.menus) {
    state.menus = siteData.value.menus
  }
}, { immediate: true, deep: true })

watch(() => state.menus, async (newVal) => {
  if (state.saving)
    return
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
          <edge-g-input
            v-model="slotProps.workingDoc.theme"
            :disable-tracking="true"
            field-type="collection"
            :collection-path="`${edgeGlobal.edgeState.organizationDocPath}/themes`"
            label="Themes"
            name="theme"
            :pass-through-props="state.workingDoc"
          />
          <edge-shad-select-tags
            v-if="Object.values(edgeFirebase.state.users).length > 0"
            v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
            :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')" name="users" label="Users"
            item-title="meta.name" item-value="userId" placeholder="Select users" class="w-full" :multiple="true"
          />
        </div>
      </template>
    </edge-editor>
    <ResizablePanelGroup v-else direction="horizontal" class="w-full h-full">
      <ResizablePanel class="bg-sidebar text-sidebar-foreground" :default-size="16">
        <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-2">
          <template #start>
            <div class="flex flex-col gap-0">
              <span>{{ siteData.name || 'Site' }}</span>
            </div>
          </template>
          <template #center>
            <div />
          </template>
          <template #end>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuAction class="mt-1">
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuLabel class="flex items-center gap-2">
                  <FileStack class="w-5 h-5" />{{ siteData.name || 'Site' }}
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
          </template>
        </edge-menu>
        <SidebarGroup class="mt-0 pt-0">
          <SidebarGroupContent>
            <SidebarMenu>
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
                  <edge-cms-menu v-if="state.menus" v-model="state.menus" :site="props.site" :page="props.page" />
                </TabsContent>
                <TabsContent value="posts" class="p-0">
                  <edge-cms-posts :site="props.site" />
                </TabsContent>
              </Tabs>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ResizablePanel>
      <ResizablePanel ref="mainPanel">
        <Transition name="fade" mode="out-in">
          <div v-if="props.page" :key="props.page" class="max-h-[calc(100vh-50px)] overflow-y-auto w-full">
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
            <div class="p-6 space-y-4  h-[calc(100vh-120px)] overflow-y-auto">
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
              <edge-g-input
                v-model="slotProps.workingDoc.theme"
                :disable-tracking="true"
                field-type="collection"
                :collection-path="`${edgeGlobal.edgeState.organizationDocPath}/themes`"
                label="Themes"
                name="theme"
                :pass-through-props="state.workingDoc"
              />
              <edge-shad-select-tags
                v-if="Object.values(edgeFirebase.state.users).length > 0"
                v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
                :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')" name="users" label="Users"
                item-title="meta.name" item-value="userId" placeholder="Select users" class="w-full" :multiple="true"
              />
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
