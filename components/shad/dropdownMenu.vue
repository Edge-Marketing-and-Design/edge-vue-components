<!-- Usage:
<edge-shad-dropdown-menu :items="[{ label: 'Hello', items: [{ title: 'Hello there', shortcut: '+L' }] }]">
    <template #trigger>
      <Button variant="outline" class="">
        test
      </Button>
    </template>
    <template #item="itemProps">
      <edge-shad-dropdown-menu-item :item="itemProps.item" @click="console.log(itemProps.item)" />
    </template>
  </edge-shad-dropdown-menu> -->
<script setup>
const props = defineProps({
  class: {
    type: null,
    required: false,
  },
  items: {
    type: Array,
    required: false,
    default: () => [],
  },
  variant: {
    type: String,
    required: false,
    default: 'filled',
  },
})
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-56">
      <template v-for="(group, key) in props.items" :key="key">
        <DropdownMenuLabel>
          {{ group.label }}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <template v-for="(item, key2) in group.items" :key="key2">
            <slot name="item" :item="item" />
          </template>
        </DropdownMenuGroup>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style lang="scss" scoped>

</style>
