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
  switchClass: {
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

const modelValue = useVModel(props, 'modelValue', emits)
</script>

<template>
  <div>
    <FormField :name="props.name">
      <FormItem :class="cn('flex flex-row items-center justify-between', props.class)">
        <div class="flex flex-row items-center w-full">
          <div class="grow">
            <FormLabel class="text-base">
              {{ props.label }}
            </FormLabel>
            <FormDescription>
              <slot />
            </FormDescription>
          </div>
          <FormControl>
            <Switch
              v-model="modelValue"
              :class="cn('', props.switchClass)"
            />
          </FormControl>
        </div>
      </FormItem>
    </FormField>
  </div>
</template>

<style lang="scss" scoped>

</style>
