<script setup lang="js">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

import { FileStack, FolderCog, FolderUp } from 'lucide-vue-next'
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
      users: { bindings: { 'field-type': 'users', 'label': 'Users', 'hint': 'Choose users' }, cols: '12', value: [] },
    },
  },
  mounted: false,
  page: {},
  menus: { 'Main Menu': [] },
  saving: false,
  siteSettings: false,
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
})

const publishSite = async () => {
  for (const [pageId, pageData] of Object.entries(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {})) {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageData)
  }
  edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { lastPublished: new Date().toISOString() })
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
            await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, item.item)
            state.menus[menuName].splice(index, 1)
          }
        }
      }
      console.log('item:', item)
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
                  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, subItem.item)
                  state.menus[menuName][index].item[subMenuName].splice(subIndex, 1)
                }
              }
            }
          }
        }
      }
    }
  }
  await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { menus: state.menus })
  state.saving = false
}, { deep: true })
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
        <Separator class="my-4" />
        <edge-shad-input
          v-model="slotProps.workingDoc.name"
          name="name"
          label="Name"
          placeholder="Enter name"
          class="w-full"
        />
        <Separator class="my-4" />
        <edge-shad-select-tags
          v-if="Object.values(edgeFirebase.state.users).length > 0"
          v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
          :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')" name="users" label="Users"
          item-title="meta.name" item-value="userId" placeholder="Select users" class="w-full" :multiple="true"
        />
      </template>
    </edge-editor>
    <ResizablePanelGroup v-else direction="horizontal" class="w-full h-full">
      <ResizablePanel class="bg-sidebar text-sidebar-foreground" :default-size="16">
        <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-2">
          <template #start>
            {{ siteData.name || 'Site' }}
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
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="publishSite">
                  <FolderUp />
                  Publish
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
              <edge-cms-menu v-if="state.menus" v-model="state.menus" :site="props.site" :page="props.page" />
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
          class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none"
          :show-footer="false"
          :show-header="false"

          :save-function-override="() => { state.siteSettings = false }"
        >
          <template #main="slotProps">
            <edge-shad-input
              v-model="slotProps.workingDoc.name"
              name="name"
              label="Name"
              placeholder="Enter name"
              class="w-full"
            />
            <Separator class="my-4" />
            <edge-g-input
              v-model="slotProps.workingDoc.theme"
              :disable-tracking="true"
              field-type="collection"
              :collection-path="`${edgeGlobal.edgeState.organizationDocPath}/themes`"
              label="Themes"
              name="theme"
              :pass-through-props="state.workingDoc"
              class="w-full"
            />
            <edge-shad-select-tags
              v-if="Object.values(edgeFirebase.state.users).length > 0"
              v-model="slotProps.workingDoc.users" :disabled="!edgeGlobal.isAdminGlobal(edgeFirebase).value"
              :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')" name="users" label="Users"
              item-title="meta.name" item-value="userId" placeholder="Select users" class="w-full" :multiple="true"
            />
            <SheetFooter class="pt-2 flex justify-between">
              <edge-shad-button variant="destructive" class="text-white" @click="state.siteSettings = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
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
