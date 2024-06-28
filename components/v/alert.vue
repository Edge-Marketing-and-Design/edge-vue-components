<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  variant: {
    type: String,
    default: 'plain',
  },
  type: {
    type: String,
    default: 'info',
  },
  class: {
    type: String,
    required: false,
  },
})

const cardClassesBasedOnVariantProp = computed(() => {
  switch (props.variant) {
    case 'text':
      return ''
    case 'flat':
      return ''
    case 'elevated':
      return ''
    case 'tonal':
      return 'bg-muted/30 shadow-md'
    case 'outlined':
      return ''
    case 'plain':
      return ''
  }
})

const cardClassesBasedOnTypeProp = computed(() => {
  switch (props.type) {
    case 'info':
      return 'bg-info'
    case 'success':
      return 'bg-success'
    case 'warning':
      return 'bg-warning'
    case 'error':
      return 'bg-error'
  }
})
</script>

<template>
  <Alert class="p-0 border-0" :class="cn(cardClassesBasedOnTypeProp, props.class)">
    <div class="w-full h-full p-4" :class="cardClassesBasedOnVariantProp">
      <slot />
    </div>
  </Alert>
</template>

<style scoped>
/* your styles here */
</style>
