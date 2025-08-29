<script setup>
const props = defineProps({
  class: String,
})
const state = reactive({
  count: 20,
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const incrementCount = async () => {
  while (true) {
    if (state.count < 100) {
      state.count += 10
      await sleep(100) // Wait for 100 milliseconds
    }
    else {
      state.count = 0
      await sleep(500) // Wait for 100 milliseconds
    }
  }
}

incrementCount()
</script>

<template>
  <div class="flex h-full w-full align-bottom items-center">
    <Card :class="props.class" class="w-full pt-10 pb-6">
      <CardContent class="text-center">
        <slot>
          Loading...
        </slot>
        <Progress v-model="state.count" class="w-100" />
      </CardContent>
    </Card>
  </div>
</template>

<style lang="scss" scoped>

</style>
