<script setup>
const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
})
</script>

<template>
  <DropdownMenuItem class="cursor-pointer">
    <span>{{ props.item.title }}</span>
    <DropdownMenuShortcut v-if="props.item.shortcut">
      {{ props.item.shorcut }}
    </DropdownMenuShortcut>
  </DropdownMenuItem>
</template>

<style lang="scss" scoped>

</style>
