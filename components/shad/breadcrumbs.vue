<script setup>
const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  itemClass: {
    type: String,
    default: 'text-secondary text-2xl sm:text-4xl font-[700]',
  },
})
</script>

<template>
  <Breadcrumb>
    <BreadcrumbList>
      <template v-for="(item, index) in props.items" :key="index">
        <BreadcrumbItem>
          <BreadcrumbLink v-if="item.to" class="border-b-2 border-dashed" :class="props.itemClass">
            <NuxtLink :to="item.to">
              {{ item.text }}
            </NuxtLink>
          </BreadcrumbLink>
          <BreadcrumbPage v-else :class="props.itemClass">
            {{ item.text }}
          </BreadcrumbPage>
        </BreadcrumbItem>
        <BreadcrumbSeparator v-if="index < (props.items.length - 1)" />
      </template>
    </BreadcrumbList>
  </Breadcrumb>
</template>

<style>
</style>
