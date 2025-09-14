<script setup lang="js">
import { useVModel } from '@vueuse/core'
import { CircleCheck, FileMinus2, FolderOpen } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
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
})
const emit = defineEmits(['update:modelValue'])
const router = useRouter()
const modelValue = useVModel(props, 'modelValue', emit)
const route = useRoute()
const page = computed(() => {
  if (route.params?.page) {
    return route.params.page
  }
  return ''
})

const site = computed(() => {
  if (route.params?.site) {
    return route.params.site
  }
  return ''
})
const edgeFirebase = inject('edgeFirebase')

const isPublishedPageDiff = (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${site.value}/published`]?.[pageId]
  const draftPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${site.value}/pages`]?.[pageId]
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

const state = reactive({
  addPageDialog: false,
  newPageName: '',
  indexPath: '',
  addMenu: false,
  deletePage: {},
})

const addPageShow = (menuName, isMenu = false) => {
  state.addMenu = isMenu
  state.menuName = menuName
  state.addPageDialog = true
}

const deletePageShow = (page) => {
  state.deletePage = page
  state.deletePageDialog = true
}

const addPageAction = async () => {
  if (!state.menuName) {
    modelValue.value[state.newPageName] = []
    state.newPageName = ''
    state.addPageDialog = false
    return
  }
  if (state.addMenu) {
    modelValue.value[state.menuName].push({ item: { [state.newPageName]: [] } })
  }
  else {
    modelValue.value[state.menuName].push({ name: state.newPageName, item: '' })
  }

  state.newPageName = ''
  state.addPageDialog = false
}
const deletePageAction = async () => {
  if (page.value === state.deletePage.item) {
    router.replace(`/app/dashboard/sites/${site.value}`)
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
</script>

<template>
  <edge-shad-button v-if="!props.prevMenu" class="w-full mb-2 h-[24px] mt-1 text-xs" variant="outline" @click="addPageShow('', true)">
    Add Top Level Menu
  </edge-shad-button>
  <SidebarMenuItem v-for="(menu, menuName) in modelValue" :key="menu.name">
    <SidebarMenuButton class="!px-0 hover:!bg-transparent">
      <!-- Open icon (visible when group IS open) -->
      <FolderOpen
        class="mr-2"
      />
      <span>{{ menuName }}</span>
      <SidebarGroupAction class="absolute right-2 top-0 hover:!bg-transparent">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuAction>
              <PlusIcon />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuLabel v-if="props.prevMenu">
              {{ props.prevMenu }} / {{ menuName }}
            </DropdownMenuLabel>
            <DropdownMenuLabel v-else>
              {{ menuName }}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="addPageShow(menuName)">
              <span>New Page</span>
            </DropdownMenuItem>

            <DropdownMenuItem v-if="!props.prevMenu" @click="addPageShow(menuName, true)">
              <span>New Folder</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span>Rename</span>
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
            <edge-cms-menu v-if="typeof element.item === 'object'" v-model="modelValue[menuName][index].item" :prev-menu="menuName" :prev-index="index" />
            <SidebarMenuSubItem v-else class="relative">
              <SidebarMenuSubButton :class="{ 'text-gray-400': element.item === '' }" as-child :is-active="element.item === page">
                <NuxtLink :disabled="element.item === ''" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="text-xs" :to="`/app/dashboard/sites/${site}/${element.item}`">
                  <Loader2 v-if="element.item === '' || element.name === 'Deleting...'" :class="{ '!text-red-500': element.name === 'Deleting...' }" class="w-4 h-4 animate-spin" />
                  <FileMinus2 v-else-if="isPublishedPageDiff(element.item)" class="!text-yellow-600" />
                  <CircleCheck v-else class="text-xs !text-green-700 font-normal" />
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
                    <DropdownMenuLabel v-if="props.prevMenu">
                      {{ props.prevMenu }} / {{ menuName }} / {{ element.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuLabel v-else>
                      {{ menuName }} / {{ element.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <span>Publish</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="deletePageShow(element)">
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
          Delete Page "{{ state.deletePage.name }}"
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
</template>
