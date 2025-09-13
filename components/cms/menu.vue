<script setup lang="js">
import { useVModel } from '@vueuse/core'
import { CircleAlert, CircleCheck, FolderOpen } from 'lucide-vue-next'
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
})
const emit = defineEmits(['update:modelValue'])
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
</script>

<template>
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
            <DropdownMenuLabel>{{ props.prevMenu + menuName }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <span>New Page</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="!props.prevMenu">
              <span>New Folder</span>
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
            <edge-cms-menu v-if="typeof element.item === 'object'" v-model="modelValue[menuName][index].item" :prev-menu="`${menuName} / `" />
            <SidebarMenuSubItem v-else class="relative">
              <SidebarMenuSubButton as-child :is-active="element.item === page">
                <NuxtLink class="text-xs" :to="`/app/dashboard/sites/${site}/${element.item}`">
                  <CircleAlert v-if="isPublishedPageDiff(element.item)" class="!text-red-700" />
                  <CircleCheck v-else class="text-xs !text-green-700 font-normal" />
                  {{ element.name }}
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
                    <DropdownMenuLabel>{{ props.prevMenu + menuName }} / {{ element.name }}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <span>Publish</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem>
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <span>Move To</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
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
</template>
