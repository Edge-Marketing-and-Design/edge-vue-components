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
  target: {
    type: String,
    required: false,
  },
})
const router = useRouter()
function handleNavigation() {
  if (props.target === '_blank') {
    window.open(props.to, '_blank')
  }
  else {
    router.push(props.to)
  }
}
</script>

<script setup>

</script>

<template>
  <Button v-if="props.to" :type="props.type" @click.stop.prevent="handleNavigation">
    <slot />
  </Button>
  <Button v-else :type="props.type">
    <slot />
  </Button>
</template>

<style lang="scss" scoped>

</style>
