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

// Expose form methods for parent components
defineExpose({
  // submission
  handleSubmit: form.handleSubmit,
  // value setters
  setValues: form.setValues,
  setFieldValue: form.setFieldValue,
  // validation helpers
  validate: form.validate,
  validateField: form.validateField,
  // state accessors
  values: form.values,
  errors: form.errors,
  // utils
  resetForm: form.resetForm,
})
</script>

<template>
  <form @submit.prevent="onSubmit">
    <slot />
  </form>
</template>
