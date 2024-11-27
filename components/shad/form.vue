<script setup>
import { useForm } from 'vee-validate'
const props = defineProps({
  schema: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  initialValues: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['submit', 'error'])

const { schema, initialValues } = toRefs(props)

const form = useForm({
  validationSchema: schema,
  initialValues: initialValues.value,
})
const onSubmit = form.handleSubmit(
  async (values) => {
    emit('submit', values)
  },
  (errors) => {
    if (errors.errors.length !== 0) {
      console.log(errors)
      emit('error', errors)
    }
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
