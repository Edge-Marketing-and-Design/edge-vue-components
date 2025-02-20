<script setup>
import {
  useSidebar,
} from '@/components/ui/sidebar'
const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  settingsTitle: {
    type: String,
    default: '',
  },
  organizationTitle: {
    type: String,
    default: 'Organization(s)',
  },
  menuItems: {
    type: Array,
    default: () => [],
  },
  settingsMenuItems: {
    type: Array,
    default: () => [],
  },
  headerClasses: {
    type: String,
    default: '',
  },
  contentClasses: {
    type: String,
    default: '',
  },
  footerClasses: {
    type: String,
    default: '',
  },
  collapsible: {
    type: String,
    default: 'icon',
  },
  showRail: {
    type: Boolean,
    default: true,
  },
  showSettingsSection: {
    type: Boolean,
    default: true,
  },
  groupLabelClasses: {
    type: String,
    default: '',
  },
})

const sidebarMenuItemClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return 'justify-center flex'
  }
  return ''
})

const sideBarMenuButtonClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return 'w-8 h-8 rounded-[6px] flex items-center justify-center'
  }
  return ''
})

const sideBarButtonStyles = computed(() => {
  if (props.collapsible === 'slack') {
    return {
      padding: '0 !important',
      width: 'auto !important',
      height: 'auto !important',
    }
  }
  return {}
})

const sideBarIconClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return '!w-5 !h-5'
  }
  return ''
})

const isSlack = computed(() => {
  return props.collapsible === 'slack'
})

const edgeFirebase = inject('edgeFirebase')

const route = useRoute()
const router = useRouter()
const goTo = (path) => {
  router.push(path)
}

const {
  state: sidebarState,
} = useSidebar()

const currentRoutePath = computed(() => {
  return route.fullPath.endsWith('/') ? route.fullPath.slice(0, -1) : route.fullPath
})
</script>

<template>
  <SidebarHeader :class="props.headerClasses">
    <slot name="header" :side-bar-state="sidebarState" />
  </SidebarHeader>
  <SidebarContent :class="props.contentClasses">
    <slot name="content" :side-bar-state="sidebarState">
      <SidebarGroup>
        <SidebarGroupLabel v-if="props.title" :class="props.groupLabelClasses">
          {{ props.title }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <slot name="menu">
              <SidebarMenuItem v-for="item in props.menuItems" :key="item.title" :class="sidebarMenuItemClasses">
                <div class="flex flex-col items-center">
                  <SidebarMenuButton
                    :is-active="currentRoutePath.startsWith(item.to)"
                    :tooltip="item.title"
                    :class="sideBarMenuButtonClasses"
                    @click="goTo(item.to)"
                  >
                    <component :is="item.icon" :class="sideBarIconClasses" />
                    <span v-if="!isSlack">{{ item.title }}</span>
                  </SidebarMenuButton>
                  <span v-if="isSlack" class="text-xs mb-3">{{ item.title }}</span>
                </div>
              </SidebarMenuItem>
            </slot>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <CommandSeparator class="mb-3" />
        <SidebarGroupLabel v-if="props.settingsTitle" :class="props.groupLabelClasses">
          {{ props.settingsTitle }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in props.settingsMenuItems" :key="item.title" :class="sidebarMenuItemClasses">
              <div class="flex flex-col items-center">
                <SidebarMenuButton
                  :is-active="currentRoutePath.startsWith(item.to)"
                  :tooltip="item.title"
                  :class="sideBarMenuButtonClasses"
                  :style="sideBarButtonStyles"
                  @click="goTo(item.to)"
                >
                  <component :is="item.icon" :class="sideBarIconClasses" />
                  <span v-if="!isSlack">{{ item.title }}</span>
                </SidebarMenuButton>
                <span v-if="isSlack" class="text-xs mb-3">{{ item.title }}</span>
              </div>
            </SidebarMenuItem>
            <template v-if="props.showSettingsSection">
              <SidebarMenuItem :class="sidebarMenuItemClasses">
                <edge-user-menu :title="props.organizationTitle">
                  <template #trigger>
                    <div class="flex flex-col items-center">
                      <SidebarMenuButton :class="sideBarMenuButtonClasses" tooltip="Settings">
                        <Settings2 />
                        <span v-if="!isSlack">Settings</span>
                      </SidebarMenuButton>
                      <span v-if="isSlack" class="text-xs mb-3"> Settings</span>
                    </div>
                  </template>
                </edge-user-menu>
              </SidebarMenuItem>
              <SidebarMenuItem :class="sidebarMenuItemClasses">
                <div class="flex flex-col items-center">
                  <SidebarMenuButton :class="sideBarMenuButtonClasses" tooltip="Logout" @click="edgeGlobal.edgeLogOut(edgeFirebase)">
                    <LogOut />
                    <span v-if="!isSlack">Logout</span>
                  </SidebarMenuButton>
                  <span v-if="isSlack" class="text-xs mb-3">Logout</span>
                </div>
              </SidebarMenuItem>
            </template>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </slot>
  </SidebarContent>
</template>
