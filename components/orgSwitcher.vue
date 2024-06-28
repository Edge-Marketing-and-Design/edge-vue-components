<script setup>
import { inject } from 'vue'

const props = defineProps({
  title: {
    type: String,
    default: 'Organization(s)',
  },
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')
</script>

<template>
  <DropdownMenuLabel class="text-xs text-muted-foreground">
    {{ props.title }}
  </DropdownMenuLabel>
  <edge-org-switcher />
  <DropdownMenuSeparator />
  <DropdownMenuItem>Logout</DropdownMenuItem>
</template>

<style lang="scss" scoped>

</style>
