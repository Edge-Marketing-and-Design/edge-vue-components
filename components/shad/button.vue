<script setup>
const props = defineProps({
  type: {
    type: String,
    required: false,
    default: 'button',
  },
  to: {
    type: String,
    required: false,
  },
})
const router = useRouter()
</script>

<template>
  <Button v-if="props.to" :type="props.type" @click="router.push(props.to)">
    <slot />
  </Button>
  <Button v-else :type="props.type">
    <slot />
  </Button>
</template>

<style lang="scss" scoped>

</style>
