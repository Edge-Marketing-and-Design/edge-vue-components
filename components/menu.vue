<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  type: {
    type: String,
    required: false,
    default: 'div',
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
})
const route = useRoute()
// const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')
const orgName = computed(() => {
  const org = edgeGlobal.edgeState.organizations.find(org => org.docId === edgeGlobal.edgeState.currentOrganization)
  return org?.name
})

const startsWithCurrentRoute = (path) => {
  const currentRoutePath = route.fullPath.endsWith('/') ? route.fullPath.substring(0, route.fullPath.length - 1) : route.fullPath
  return path === currentRoutePath || currentRoutePath.startsWith(path)
}

const typeClasses = computed(() => {
  return {
    header: 'top-0',
    footer: 'bottom-0',
    div: '',
  }
})
</script>

<template>
  <component :is="props.type" :class="cn (typeClasses[props.type], 'z-10 flex h-[57px] items-center gap-1 border-b  px-4 flex-shrink-0', props.class)">
    <div class="flex items-center gap-1">
      <slot name="start">
        <Package class="h-6 w-6 mr-2" />
        <h1 class="text-xl font-bold">
          {{ orgName }}
        </h1>
      </slot>
    </div>
    <div class="grow flex items-center gap-1">
      <slot name="center" />
      <div class="grow">
        <nav v-if="props.menuItems.length > 0" :class="cn ('justify-center ml-4 hidden flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6', props.navClass)">
          <edge-shad-button
            v-for="(item, key) in props.menuItems"
            :key="key"
            :to="item.to"
            :class="cn('text-foreground transition-colors hover:text-foreground px-0', props.buttonClass, { 'text-muted-foreground': !startsWithCurrentRoute(item.to) })"

            variant="text"
          >
            <component :is="item.icon" v-if="item.icon" class="h-4 w-4 mr-1" />
            {{ item.title }}
          </edge-shad-button>
        </nav>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <slot name="end">
        <div class="grow text-right">
          <edge-user-menu />
        </div>
      </slot>
    </div>
  </component>
</template>

<style lang="scss" scoped>
  .inverted-logo {
    filter: invert(1);
  }
</style>
