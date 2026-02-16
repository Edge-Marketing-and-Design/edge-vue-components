<script setup>
definePageMeta({
  middleware: 'auth',
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-cms-sites-manager />
  </div>
</template>
