<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  class: {
    type: String,
    required: false,
  },
  cols: {
    type: String,
    default: 'auto',
  },
})

const colsClasses = computed(() => {
  switch (props.cols) {
    case 'auto':
      return 'grow'
    case '1':
      return 'w-1/12'
    case '2':
      return 'w-2/12'
    case '3':
      return 'w-3/12'
    case '4':
      return 'w-4/12'
    case '5':
      return 'w-5/12'
    case '6':
      return 'w-6/12'
    case '7':
      return 'w-7/12'
    case '8':
      return 'w-8/12'
    case '9':
      return 'w-9/12'
    case '10':
      return 'w-10/12'
    case '11':
      return 'w-11/12'
    case '12':
      return 'w-full'
    default:
      return 'grow'
  }
})
</script>

<template>
  <div class="px-2" :class="cn(colsClasses, props.class)">
    <slot />
  </div>
</template>

<style scoped>
/* your styles here */
</style>
