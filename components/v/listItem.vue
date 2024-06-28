<script setup>
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
})
</script>

<template>
  <div class="w-full flex justify-between items-center py-1 gap-3" :class="props.class">
    <div>
      <slot name="prepend" />
    </div>
    <div class="grow">
      <slot />
    </div>
    <div>
      <slot name="append" />
    </div>
  </div>
</template>

<style scoped>
/* your styles here */
</style>
