<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <AlertTitle :class="props.class">
    <slot />
  </AlertTitle>
</template>

<style scoped>
/* your styles here */
</style>
