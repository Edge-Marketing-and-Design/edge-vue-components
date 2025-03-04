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

const typeClasses = computed(() => {
  return {
    header: 'top-0',
    footer: 'bottom-0',
    div: '',
  }
})
</script>

<template>
  <Card
    v-if="props.type === 'Card'"
    :class="cn(typeClasses[props.type], 'z-10 flex items-center gap-1 px-4 flex-shrink-0 overflow-hidden', props.class)"
  >
    <edge-menu-content
      v-bind="props"
    >
      <template v-if="props.showStart" #start>
        <slot name="start" />
      </template>
      <template v-if="props.showCenter" #center>
        <slot name="center" />
      </template>
      <template v-if="props.showEnd" #end>
        <slot name="end" />
      </template>
    </edge-menu-content>
  </Card>

  <nav
    v-else-if="props.type === 'nav'"
    :class="cn(typeClasses[props.type], 'z-10 flex items-center gap-1 border-b px-4 flex-shrink-0', props.class)"
  >
    <edge-menu-content
      v-bind="props"
    >
      <template v-if="props.showStart" #start>
        <slot name="start" />
      </template>
      <template v-if="props.showCenter" #center>
        <slot name="center" />
      </template>
      <template v-if="props.showEnd" #end>
        <slot name="end" />
      </template>
    </edge-menu-content>
  </nav>
  <footer
    v-else-if="props.type === 'footer'"
    :class="cn(typeClasses[props.type], 'z-10 flex items-center gap-1 border-t px-4 flex-shrink-0', props.class)"
  >
    <edge-menu-content
      v-bind="props"
    >
      <template v-if="props.showStart" #start>
        <slot name="start" />
      </template>
      <template v-if="props.showCenter" #center>
        <slot name="center" />
      </template>
      <template v-if="props.showEnd" #end>
        <slot name="end" />
      </template>
    </edge-menu-content>
  </footer>
</template>

<style lang="scss" scoped>
  .inverted-logo {
    filter: invert(1);
  }
</style>
