<script setup>
import { useAttrs } from 'vue'
import { useRoute } from 'vue-router'
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
    default: 'Organization',
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

const edgeFirebase = inject('edgeFirebase')

const attrs = useAttrs()

const DEV_TAP_TARGET = 7
const DEV_TAP_WINDOW_MS = 2000
const DEV_OVERRIDE_KEY = 'edgeDevOverride'
const devTapTimes = ref([])
const devOverride = ref(false)

onMounted(() => {
  try {
    devOverride.value = localStorage.getItem(DEV_OVERRIDE_KEY) === '1'
    edgeGlobal.edgeState.devOverride = devOverride.value
  }
  catch (error) {
    console.warn('dev override read failed', error)
  }
})

const toggleDevOverride = () => {
  devOverride.value = !devOverride.value
  edgeGlobal.edgeState.devOverride = devOverride.value
  try {
    if (devOverride.value) {
      localStorage.setItem(DEV_OVERRIDE_KEY, '1')
    }
    else {
      localStorage.removeItem(DEV_OVERRIDE_KEY)
    }
  }
  catch (error) {
    console.warn('dev override write failed', error)
  }
}

const handleDevTap = () => {
  const now = Date.now()
  devTapTimes.value = devTapTimes.value.filter(time => now - time <= DEV_TAP_WINDOW_MS)
  devTapTimes.value.push(now)
  if (devTapTimes.value.length >= DEV_TAP_TARGET) {
    devTapTimes.value = []
    toggleDevOverride()
  }
}

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

const route = useRoute()

const submenu = computed(() => {
  // Direct match on top-level item
  let match = props.menuItems.find(item => item.to === route.path)

  // Exact match on a submenu item
  if (!match) {
    match = props.menuItems.find(item =>
      item.submenu?.some(sub => sub.to === route.path),
    )
  }

  // Match route starting with submenu.to (e.g., dynamic routes like /blocks/abc)
  if (!match) {
    match = props.menuItems.find(item =>
      item.submenu?.some(sub => route.path.startsWith(`${sub.to}/`)),
    )
  }

  // Fallback: match route starting with top-level item.to
  if (!match) {
    match = props.menuItems.find(item =>
      route.path.startsWith(`${item.to}/`),
    )
  }

  return match?.submenu || []
})

const isDev = computed(() => {
  return process.dev || devOverride.value
})

const isAdmin = computed(() => {
  return edgeGlobal.isAdminGlobal(edgeFirebase).value
})

const subMenuItems = (items) => {
  console.log('submenu items', items)
  return items
    .filter(item => edgeGlobal.allowMenuItem(item, isAdmin.value))
    .map(item => ({
      ...item,
      submenu: Array.isArray(item.submenu)
        ? item.submenu.filter(subItem => edgeGlobal.allowMenuItem(subItem, isAdmin.value))
        : item.submenu,
    }))
}
</script>

<template>
  <div class="flex h-full">
    <!-- Primary Sidebar -->
    <Sidebar :style="styleOverrides" side="left" v-bind="attrs" :collapsible="collapsible">
      <SidebarHeader :class="props.headerClasses" @click="handleDevTap">
        <div v-if="isDev" :class="edgeGlobal.edgeState.isEmulator ? 'bg-yellow-500' : 'bg-red-500'" class="text-xs text-white px-0 text-center ">
          {{ edgeGlobal.edgeState.isEmulator ? 'Emulator' : '! Production !' }}
        </div>
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

    <!-- Submenu Sidebar -->
    <Transition name="slide-submenu">
      <Sidebar
        v-if="subMenuItems(submenu).length > 0 && !sidebarIsMobile"
        side="left"
        :collapsible="collapsible"
        class="border-solid border-r w-[60px]"
      >
        <edge-side-bar-content
          :menu-items="submenu"
          :submenu="true"
          :collapsible="props.collapsible"
          :show-settings-section="false"
          :header-classes="props.headerClasses"
          :content-classes="props.contentClasses"
          :footer-classes="props.footerClasses"
          :group-label-classes="props.groupLabelClasses"
          :button-classes="`gap-0 h-[52px] ${props.buttonClasses}`"
          :icon-classes="props.iconClasses"
          :hide-logout="props.hideLogout"
          class="mt-4"
        />
      </Sidebar>
    </Transition>
  </div>
</template>

<style scoped>
.slide-submenu-enter-active, .slide-submenu-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-submenu-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}
.slide-submenu-enter-to {
  transform: translateX(0);
  opacity: 1;
}
.slide-submenu-leave-from {
  transform: translateX(0);
  opacity: 1;
}
.slide-submenu-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
</style>
