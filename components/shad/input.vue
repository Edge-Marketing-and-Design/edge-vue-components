<script setup>
import { useVModel } from '@vueuse/core'
import { Eye, EyeOff } from 'lucide-vue-next'
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: false,
    default: 'text',
  },
  defaultValue: {
    type: [String, Number],
    required: false,
  },
  modelValue: {
    type: [String, Number],
    required: false,
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
  maskOptions: {
    type: [Object],
    required: false,
    default: null,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  showPassword: false,
  type: '',
})

onBeforeMount(() => {
  state.type = props.type
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const classComputed = computed(() => {
  if (props.type === 'password') {
    return `${props.class} pr-10`
  }
  return props.class
})
</script>

<template>
  <div>
    <FormField v-slot="{ componentField }" :name="props.name">
      <FormItem>
        <FormLabel class="flex">
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <FormControl>
          <div class="relative w-full  items-center">
            <Input
              :id="props.name"
              v-model="modelValue"
              v-maska:[props.maskOptions]
              :default-value="modelValue"
              :class="classComputed"
              :type="state.type"
              v-bind="componentField"
              :placeholder="props.placeholder"
              :disabled="props.disabled"
            />
            <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
              <slot name="icon" />
              <template v-if="props.type === 'password'">
                <Eye v-if="state.type === 'text'" class="size-6 text-muted-foreground cursor-pointer" @click="state.type = 'password'" />
                <EyeOff v-else class="size-6 text-muted-foreground cursor-pointer" @click="state.type = 'text'" />
              </template>
            </span>
          </div>
        </FormControl>
        <FormDescription>
          {{ props.description }}
          <slot name="description" />
        </FormDescription>
        <FormMessage />
      </FormItem>
    </FormField>
  </div>
</template>

<style lang="scss" scoped>

</style>
