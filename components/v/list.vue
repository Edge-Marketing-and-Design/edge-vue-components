<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
  justify: {
    type: String,
    default: 'center',
  },
  lines: {
    type: String,
    default: '',
  },
})

const justifyClasses = computed(() => {
  switch (props.justify) {
    case 'start':
      return 'justify-start'
    case 'center':
      return 'justify-center'
    case 'end':
      return 'justify-end'
    case 'between':
      return 'justify-between'
    case 'around':
      return 'justify-around'
    case 'evenly':
      return 'justify-evenly'
    case 'stretch':
      return 'grid-flow-col justify-stretch'
  }
})
</script>

<template>
  <div class="flex flex-wrap items-center py-0" :class="cn(justifyClasses, props.class)">
    <slot />
  </div>
</template>

<style scoped>
/* your styles here */
</style>
