<script setup>
const state = reactive({
  mounted: false,
})
definePageMeta({
  middleware: 'auth',
})

onMounted(() => {
  state.mounted = true
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-media-manager />
  </div>
</template>

<style>

</style>
