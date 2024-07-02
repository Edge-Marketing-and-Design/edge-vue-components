<script setup>
import { useForm } from 'vee-validate'
const props = defineProps({
  schema: {
    type: Object,
    required: false,
    default: () => ({}),
  },
})

const emit = defineEmits(['submit', 'error'])

const form = useForm({
  validationSchema: props.schema,
})
const onSubmit = form.handleSubmit(
  async (values) => {
    emit('submit', values)
  },
  (errors) => {
    emit('error', errors)
  },
)
</script>

<template>
  <form @submit="onSubmit">
    <slot />
  </form>
</template>

<style lang="scss" scoped>
</style>
