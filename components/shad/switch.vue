<script setup>
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'
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
  <div>
    <FormField v-slot="{ handleChange: formHandleChange }" :name="props.name">
      <FormItem :class="cn('flex flex-row items-center justify-between rounded-lg border p-4', props.class)">
        <div class="mr-3">
          <FormLabel class="text-base">
            {{ props.label }}
          </FormLabel>
          <FormDescription>
            <slot />
          </FormDescription>
        </div>
        <FormControl id="test">
          <Switch
            :checked="modelValue"
            @update:checked="(value) => { handleChange(value); formHandleChange(value); }"
          />
        </FormControl>
      </FormItem>
    </FormField>
  </div>
</template>

<style lang="scss" scoped>

</style>
