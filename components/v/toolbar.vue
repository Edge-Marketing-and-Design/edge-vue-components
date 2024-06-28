<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
  flat: {
    type: Boolean,
  },
})
</script>

<template>
  <edge-menu>
    <template #start />
    <template #end>
      <slot />
    </template>
  </edge-menu>
</template>

<style scoped>
/* your styles here */
</style>
