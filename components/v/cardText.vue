<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <div class="px-5 py-2" :class="props.class">
    <slot />
  </div>
</template>

<style scoped>
/* your styles here */
</style>
