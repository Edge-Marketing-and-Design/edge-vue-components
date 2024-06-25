<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
const setOpen = (value) => {
  modelValue.value = value
}
</script>

<template>
  <Dialog
    v-if="modelValue"
    :open="modelValue"
    @update:open="setOpen"
  >
    <slot />
  </Dialog>
</template>

<style lang="scss" scoped>
</style>
