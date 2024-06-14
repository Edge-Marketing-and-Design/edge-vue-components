<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  modelValue: {
    type: Boolean,
    default: false,
  },
  class: {
    type: null,
    required: false,
  },
  placeholder: {
    type: String,
    required: false,
  },
  label: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.modelValue,
})

const handleChange = (value) => {
  modelValue.value = value
}
</script>

<template>
  <FormField v-slot="{ handleChange: formHandleChange }" type="checkbox" :name="props.name">
    <FormItem class="flex flex-row items-start gap-x-3 space-y-0 rounded-md border p-4" @click.capture.once="formHandleChange(modelValue)">
      <FormControl>
        <Checkbox
          :id="props.name"
          :class="props.class"
          class="bg-slate-200"
          :checked="modelValue"
          @update:checked="(value) => { handleChange(value); formHandleChange(value); }"
        />
      </FormControl>
      <div class="space-y-1 leading-none">
        <FormLabel><slot /></FormLabel>
        <FormDescription />
        <FormMessage />
      </div>
    </FormItem>
  </FormField>
</template>

<style lang="scss" scoped>

</style>
