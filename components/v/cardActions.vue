<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <CardFooter class="flex justify-between">
    <slot />
  </CardFooter>
</template>

<style scoped>
/* your styles here */
</style>
