<script setup>
import { useAttrs } from 'vue'
import {
  Sidebar,
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
  singleOrg: {
    type: Boolean,
    default: false,
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

const attrs = useAttrs()

watch(() => props.modelValue, (newValue) => {
  setOpen(newValue)
})

const {
  state: sidebarState,
  toggleSidebar: sidebarToggle,
  open: sidebarOpen,
  setOpen: sidebarSetOpen,
  setOpenMobile: sidebarSetOpenMobile,
  isMobile: sidebarIsMobile,
} = useSidebar()

edgeGlobal.edgeState.sidebar = useSidebar()

// Sidebar props:
// variant: 'sidebar' | 'floating'
// collapsible: 'offcanvas' | 'icon' | 'none' | 'slack' | 'submenu'
// side: 'left' | 'right'

// https://ui.shadcn.com/docs/components/sidebar

const collapsible = computed(() => {
  if (props.collapsible === 'slack') {
    if (sidebarIsMobile.value) {
      return 'offcanvas'
    }
    return 'none'
  }
  if (props.collapsible === 'submenu') {
    if (sidebarIsMobile.value) {
      return 'offcanvas'
    }
    return 'none'
  }
  return props.collapsible
})

const styleOverrides = computed(() => {
  const styles = {}

  if (props.collapsible === 'slack' && !sidebarIsMobile.value) {
    styles['--sidebar-width'] = '97px'
    styles['--sidebar-width-icon'] = '97px'
  }

  return styles
})
</script>

<template>
  <Sidebar :style="styleOverrides" side="left" v-bind="attrs" :collapsible="collapsible">
    <SidebarHeader :class="props.headerClasses">
      <slot name="header" :side-bar-state="sidebarState" />
    </SidebarHeader>
    <slot name="content">
      <edge-side-bar-content
        v-bind="props"
      />
    </slot>
    <SidebarFooter :class="props.footerClasses">
      <slot name="footer" :side-bar-state="sidebarState" />
    </SidebarFooter>
    <SidebarRail v-if="props.showRail && props.collapsible !== 'slack'">
      <slot name="rail" :side-bar-state="sidebarState" />
    </SidebarRail>
  </Sidebar>
</template>

<style scoped>
</style>
