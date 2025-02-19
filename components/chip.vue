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
  let combinedClasses = 'relative flex select-none items-center whitespace-nowrap rounded-lg'
  if (props.variant === 'filled') {
    combinedClasses += ' font-sans text-xs '
  }
  else if (props.variant === 'outlined') {
    combinedClasses += ' border font-sans text-xs '
  }
  return combinedClasses
})
</script>

<template>
  <Badge :class="cn(classes, props.class)">
    <span>
      <slot />
    </span>
  </Badge>
</template>
