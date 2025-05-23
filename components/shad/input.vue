<script setup>
import { useVModel } from '@vueuse/core'
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

const emits = defineEmits(['update:modelValue', 'blur'])

const state = reactive({
  showPassword: false,
  type: '',
})

onBeforeMount(() => {
  state.type = props.type
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  emits,
  prop: 'modelValue',
})

const classComputed = computed(() => {
  if (props.type === 'password') {
    return `${props.class} pr-10`
  }
  return props.class
})

const inputRef = ref(null) // Reference to the input field

const onInputChange = (e) => {
  if (e.target.value !== modelValue.value) {
    modelValue.value = e.target.value // Sync value only if changed
  }
}

// Check for pre-filled (autofilled) value on mount
onMounted(() => {
  nextTick(() => {
    if (inputRef.value?.value && inputRef.value.value !== modelValue.value) {
      modelValue.value = inputRef.value.value
    }
  })
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
              ref="inputRef"
              v-model="modelValue"
              v-maska:[props.maskOptions]
              :name="props.name"
              :default-value="props.modelValue"
              :value="modelValue"
              :class="classComputed"
              :type="state.type"
              v-bind="componentField"
              :placeholder="props.placeholder"
              :disabled="props.disabled"
              @change="onInputChange"
              @blur="$emit('blur', $event)"
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
