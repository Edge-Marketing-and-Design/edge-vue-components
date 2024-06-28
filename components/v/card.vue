<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  variant: {
    type: String,
    default: 'plain',
  },
  class: {
    type: String,
    required: false,
  },
  maxWidth: {
    type: String,
    default: '',
  },
})

const cardClassesBasedOnVariantProp = computed(() => {
  switch (props.variant) {
    case 'text':
      return 'bg-muted/100 border-0'
    case 'flat':
      return 'bg-muted/100 border-0'
    case 'elevated':
      return 'bg-muted/100 elevation-2'
    case 'tonal':
      return 'bg-muted/60 shadow-md'
    case 'outlined':
      return 'bg-muted/100'
    case 'plain':
      return 'bg-muted/100 border-0'
  }
})

const maxWidthClass = computed (() => {
  if (!props.maxWidth) {
    return 'w-full'
  }
  else {
    return 'w-full max-w-7xl'
  }
})
</script>

<template>
  <Card :class="cn(maxWidthClass, cardClassesBasedOnVariantProp, props.class)">
    <slot />
  </Card>
</template>

<style scoped>
/* your styles here */
</style>
