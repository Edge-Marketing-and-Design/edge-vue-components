<script setup>
const props = defineProps({
  to: {
    type: String,
    required: false,
  },
})
const router = useRouter()
</script>

<template>
  <Button v-if="props.to" @click="router.push(props.to)">
    <slot />
  </Button>
  <Button v-else>
    <slot />
  </Button>
</template>

<style lang="scss" scoped>

</style>
