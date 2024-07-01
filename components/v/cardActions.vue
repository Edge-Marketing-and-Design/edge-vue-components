<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <CardFooter class="flex justify-end gap-1">
    <slot />
  </CardFooter>
</template>

<style scoped>
/* your styles here */
</style>
