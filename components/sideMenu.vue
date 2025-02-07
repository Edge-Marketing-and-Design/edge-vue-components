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
})

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
// collapsible: 'offcanvas' | 'icon' | 'none'
// side: 'left' | 'right'

// https://ui.shadcn.com/docs/components/sidebar
</script>

<template>
  <Sidebar side="left" variant="sidebar" collapsible="icon">
    <SidebarHeader>
      <slot name="header" />
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel v-if="props.title">
          {{ props.title }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <slot name="menu">
              <SidebarMenuItem v-for="item in props.menuItems" :key="item.title">
                <SidebarMenuButton
                  :is-active="currentRoutePath === item.to" class="hover:bg-accent hover:text-accent-foreground" :class="{
                    'bg-primary text-primary-foreground': currentRoutePath === item.to,
                  }"
                  @click="goTo(item.to)"
                >
                  <component :is="item.icon" />
                  <span>{{ item.title }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </slot>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <slot name="footer" />
      <SidebarMenu>
        <SidebarMenuItem>
          <edge-user-menu :title="props.organizationTitle" button-class="w-8 h-8 bg-primary" icon-class="w-6 h-6">
            <template #trigger>
              <SidebarMenuButton>
                <Settings2 /> Settings
                <ChevronUp class-name="ml-auto" />
              </SidebarMenuButton>
            </template>
          </edge-user-menu>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton @click="edgeFirebase.signOut">
            <LogOut />
            <span>Logout</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
</template>

<style scoped>
</style>
