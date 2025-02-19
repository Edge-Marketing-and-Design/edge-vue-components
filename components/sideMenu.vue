<script setup>
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

const props = defineProps({
  title: {
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
})

const { state: sidebarState } = useSidebar()

const edgeFirebase = inject('edgeFirebase')
const isAdmin = computed(() => {
  const orgRole = edgeFirebase?.user?.roles.find(role =>
    role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'),
  )
  return orgRole && orgRole.role === 'admin'
})

const route = useRoute()
const router = useRouter()
const goTo = (path) => {
  router.push(path)
}

const currentRoutePath = computed(() => {
  return route.fullPath.endsWith('/') ? route.fullPath.slice(0, -1) : route.fullPath
})
// Sidebar props:
// variant: 'sidebar' | 'floating'
// collapsible: 'offcanvas' | 'icon' | 'none' | 'slack'
// side: 'left' | 'right'

// https://ui.shadcn.com/docs/components/sidebar

const collapsible = computed(() => {
  if (props.collapsible === 'slack') {
    return 'none'
  }
  return props.collapsible
})

const sidebarClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return 'w-[80px]'
  }
  return ''
})

const sidebarMenuItemClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return 'justify-center flex'
  }
  return ''
})

const sideBarMenuButtonClasses = computed(() => {
  if (props.collapsible === 'slack') {
    return 'w-7 h-7 p-1 rounded-[6px]'
  }
  return ''
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
</script>

<template>
  <Sidebar side="left" variant="primary" :class="sidebarClasses" :collapsible="collapsible">
    <SidebarHeader :class="props.headerClasses">
      <slot name="header" :side-bar-state="sidebarState" />
    </SidebarHeader>
    <SidebarContent :class="props.contentClasses">
      <SidebarGroup>
        <SidebarGroupLabel v-if="props.title">
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
        <SidebarGroupContent>
          <CommandSeparator class="mb-3" />
          <SidebarMenu>
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
          </SidebarMenu>
          <SidebarMenu>
            <SidebarMenuItem :class="sidebarMenuItemClasses">
              <div class="flex flex-col items-center">
                <SidebarMenuButton :class="sideBarMenuButtonClasses" tooltip="Logout" @click="edgeGlobal.edgeLogOut(edgeFirebase)">
                  <LogOut />
                  <span v-if="!isSlack">Logout</span>
                </SidebarMenuButton>
                <span v-if="isSlack" class="text-xs mb-3">Logout</span>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter :class="props.footerClasses">
      <slot name="footer" :side-bar-state="sidebarState" />
    </SidebarFooter>
    <SidebarRail>
      <slot name="rail" :side-bar-state="sidebarState" />
    </SidebarRail>
  </Sidebar>
</template>

<style scoped>
</style>
