<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <CardHeader>
    <CardTitle :class="props.class">
      <slot />
    </CardTitle>
  </CardHeader>
</template>

<style scoped>
/* your styles here */
</style>
