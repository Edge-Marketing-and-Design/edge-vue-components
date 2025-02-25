<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  type: {
    type: String,
    required: false,
    default: 'Card',
  },
  class: {
    type: String,
    required: false,
    default: '',
  },
  menuItems: {
    type: Array,
    required: false,
    default: () => [],
  },
  navClass: {
    type: String,
    required: false,
    default: '',
  },
  buttonClass: {
    type: String,
    required: false,
    default: '',
  },
  showIcon: {
    type: Boolean,
    required: false,
    default: true,
  },
  selectedBgColor: {
    type: String,
    required: false,
    default: '',
  },
  selectedTextColor: {
    type: String,
    required: false,
    default: '',
  },
  showStart: {
    type: Boolean,
    required: false,
    default: true,
  },
  showEnd: {
    type: Boolean,
    required: false,
    default: true,
  },
  showCenter: {
    type: Boolean,
    required: false,
    default: true,
  },
})

const route = useRoute()

const orgName = computed(() => {
  const org = edgeGlobal.edgeState.organizations.find(
    org => org.docId === edgeGlobal.edgeState.currentOrganization,
  )
  return org?.name
})

const startsWithCurrentRoute = (path) => {
  const currentRoutePath = route.fullPath.endsWith('/')
    ? route.fullPath.substring(0, route.fullPath.length - 1)
    : route.fullPath
  return (
    path === currentRoutePath || currentRoutePath.startsWith(path)
  )
}
</script>

<template>
  <div v-if="props.showStart" class="flex items-center gap-1">
    <slot name="start">
      <Package class="h-6 w-6 mr-2" />
      <h1 class="text-xl font-bold">
        {{ orgName }}
      </h1>
    </slot>
  </div>
  <div v-if="props.showCenter" class="grow flex items-center gap-1">
    <slot name="center" />
    <div v-if="props.menuItems.length > 0" class="grow">
      <nav
        :class="cn('justify-center ml-4 hidden flex-col gap-3 text-lg font-medium md:flex md:flex-row md:items-center md:gap-2 md:text-sm lg:gap-3', navClass)"
      >
        <edge-shad-button
          v-for="(item, key) in props.menuItems"
          :key="key"
          :to="item.to"
          :class="cn(
            'transition-colors px-0',
            hoverClass,
            buttonClass,
            {
              [selectedBgColor]: startsWithCurrentRoute(item.to),
              [selectedTextColor]: startsWithCurrentRoute(item.to),
            },
          )"
          variant="text"
        >
          <component
            :is="item.icon"
            v-if="item.icon && props.showIcon"
            class="h-4 w-4 mr-1"
          />
          {{ item.title }}
        </edge-shad-button>
      </nav>
    </div>
  </div>
  <div v-if="props.showEnd" class="flex items-center gap-1">
    <slot name="end">
      <div class="grow text-right">
        <edge-user-menu button-class="bg-primary" />
      </div>
    </slot>
  </div>
</template>
