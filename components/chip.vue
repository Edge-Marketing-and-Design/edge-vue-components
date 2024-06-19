<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  variant: {
    type: String,
    default: 'filled',
  },
  class: {
    type: String,
    required: false,
  },
})

const classes = computed(() => {
  let combinedClasses = 'relative grid select-none items-center whitespace-nowrap rounded-lg'
  if (props.variant === 'filled') {
    combinedClasses += ' bg-slate-700 py-1.5 px-3 font-sans text-xs   text-white dark:text-gray-100'
  }
  else if (props.variant === 'outlined') {
    combinedClasses += ' border-slate-700 border py-1.5 px-3 font-sans text-xs  text-gray-900 dark:text-gray-100'
  }
  return combinedClasses
})
</script>

<template>
  <div :class="cn(classes, props.class)">
    <span>
      <slot />
    </span>
  </div>
</template>
