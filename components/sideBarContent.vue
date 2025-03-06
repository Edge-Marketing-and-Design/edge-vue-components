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
  buttonClasses: {
    type: String,
    default: '',
  },
  hideLogout: {
    type: Boolean,
    default: false,
  },
  iconClasses: {
    type: String,
    default: '',
  },
})

const {
  state: sidebarState,
  isMobile: sidebarIsMobile,
} = useSidebar()

const sidebarMenuItemClasses = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return 'justify-center flex w-full'
  }
  return ''
})

const sideBarMenuButtonClasses = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return `w-full h-[78px] rounded-[0px] flex flex-col items-center justify-center ${props.buttonClasses}`
  }
  return ''
})

const sideBarButtonStyles = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return {
      padding: '0 !important',
      width: 'auto !important',
      height: 'auto !important',
    }
  }
  return {}
})

const sideBarIconClasses = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return `!w-5 !h-5${props.iconClasses ? ` ${props.iconClasses}` : ''}`
  }
  return `${props.iconClasses ? ` ${props.iconClasses}` : ''}`
})

const sidebarGroupClasses = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return 'px-0 pt-0'
  }
  return ''
})

const sidebarMenuClasses = computed(() => {
  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    return 'gap-0'
  }
  return ''
})

const isSlack = computed(() => {
  if (sidebarIsMobile.value) {
    return false
  }
  return props.collapsible === 'slack'
})

const edgeFirebase = inject('edgeFirebase')

const route = useRoute()
const router = useRouter()
const goTo = (path) => {
  router.push(path)
}

const currentRoutePath = computed(() => {
  return route.fullPath.endsWith('/') ? route.fullPath.slice(0, -1) : route.fullPath
})
</script>

<template>
  <SidebarContent class="gap-0" :class="props.contentClasses">
    <slot name="content" :side-bar-state="sidebarState">
      <SidebarGroup class="pb-0" :class="sidebarGroupClasses">
        <SidebarGroupLabel v-if="props.title" :class="props.groupLabelClasses">
          {{ props.title }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu :class="sidebarMenuClasses">
            <slot name="menu">
              <SidebarMenuItem v-for="item in props.menuItems" :key="item.title" :class="sidebarMenuItemClasses">
                <div class="flex flex-col items-center w-full">
                  <SidebarMenuButton
                    :is-active="currentRoutePath.startsWith(item.to)"
                    :tooltip="item.title"
                    :class="sideBarMenuButtonClasses"
                    @click="goTo(item.to)"
                  >
                    <component :is="item.icon" class="[stroke-width:1]" :class="sideBarIconClasses" />
                    <span v-if="!isSlack">{{ item.title }}</span>
                    <span v-else class="text-xs">{{ item.title }}</span>
                  </SidebarMenuButton>
                </div>
              </SidebarMenuItem>
            </slot>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup class="pt-0" :class="sidebarGroupClasses">
        <SidebarGroupLabel v-if="props.settingsTitle" :class="props.groupLabelClasses">
          {{ props.settingsTitle }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu :class="sidebarMenuClasses">
            <SidebarMenuItem v-for="item in props.settingsMenuItems" :key="item.title" :class="sidebarMenuItemClasses">
              <div class="flex flex-col items-center w-full">
                <SidebarMenuButton
                  :is-active="currentRoutePath.startsWith(item.to)"
                  :tooltip="item.title"
                  :class="sideBarMenuButtonClasses"
                  :style="sideBarButtonStyles"
                  @click="goTo(item.to)"
                >
                  <component :is="item.icon" class="[stroke-width:1]" :class="sideBarIconClasses" />
                  <span v-if="!isSlack">{{ item.title }}</span>
                  <span v-else class="text-xs">{{ item.title }}</span>
                </SidebarMenuButton>
              </div>
            </SidebarMenuItem>
            <template v-if="props.showSettingsSection">
              <SidebarMenuItem :class="sidebarMenuItemClasses">
                <edge-user-menu class="w-full" :title="props.organizationTitle">
                  <template #trigger>
                    <div class="flex flex-col items-center w-full">
                      <SidebarMenuButton :is-active="currentRoutePath.startsWith('/app/account')" :class="sideBarMenuButtonClasses" tooltip="Settings">
                        <Settings2 :class="sideBarIconClasses" class="[stroke-width:1]" />
                        <span v-if="!isSlack">Settings</span>
                        <span v-else class="text-xs">Settings</span>
                      </SidebarMenuButton>
                    </div>
                  </template>
                </edge-user-menu>
              </SidebarMenuItem>
              <SidebarMenuItem v-if="!props.hideLogout" :class="sidebarMenuItemClasses">
                <div class="flex flex-col items-center w-full">
                  <SidebarMenuButton :class="sideBarMenuButtonClasses" tooltip="Logout" @click="edgeGlobal.edgeLogOut(edgeFirebase)">
                    <LogOut :class="sideBarIconClasses" class="[stroke-width:1]" />
                    <span v-if="!isSlack">Logout</span>
                    <span v-else class="text-xs">Logout</span>
                  </SidebarMenuButton>
                </div>
              </SidebarMenuItem>
            </template>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </slot>
  </SidebarContent>
</template>
