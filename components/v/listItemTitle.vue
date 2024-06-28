<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <div class="text-lg" :class="props.class">
    <slot />
  </div>
</template>

<style scoped>
/* your styles here */
</style>
