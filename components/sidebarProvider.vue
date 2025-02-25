<script setup>
const props = defineProps({
  collapsible: {
    type: String,
    default: 'icon',
  },
  enableNestedMenu: {
    type: Boolean,
    default: false,
  },
})
const styleOverrides = computed(() => {
  if (props.collapsible === 'slack' && props.enableNestedMenu) {
    return {
      '--sidebar-width': '300px',
      '--sidebar-width-icon': '80px',
    }
  }
  return {}
})
</script>

<template>
  <SidebarProvider :style="styleOverrides">
    <slot
      :collapsible="props.collapsible"
    />
  </SidebarProvider>
</template>

<style>

</style>
