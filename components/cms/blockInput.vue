<script setup>
import { useVModel } from '@vueuse/core'
import { ImagePlus } from 'lucide-vue-next'

const props = defineProps({
  field: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  modelValue: {
    type: [Object, String, Array, Number, Boolean],
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  schema: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  site: {
    type: String,
    required: false,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'delete'])

const modelValue = useVModel(props, 'modelValue', emit)
const edgeFirebase = inject('edgeFirebase')
const isGlobalAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const richtextEnabledToggles = computed(() => {
  const baseToggles = ['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline']
  if (isGlobalAdmin.value)
    return [...baseToggles, 'source']
  return baseToggles
})

const state = reactive({
  mounted: false,
  imageOpen: false,
})

const hasImageTags = computed(() => {
  return Array.isArray(props.schema?.tags) && props.schema.tags.length > 0
})

const selectImage = (url) => {
  modelValue.value = url || ''
  state.imageOpen = false
}

onBeforeMount(async () => {
  if (props.type === 'option' && !modelValue.value) {
    modelValue.value = props.schema.value
  }
  await nextTick()
  state.mounted = true
})
</script>

<template>
  <div v-if="state.mounted">
    <div v-if="props.type === 'richtext'">
      <edge-shad-html v-model="modelValue" :enabled-toggles="richtextEnabledToggles" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'textarea'">
      <edge-shad-textarea v-model="modelValue" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'array'">
      <edge-shad-tags v-model="modelValue" :label="label" :name="field" />
    </div>
    <div v-else-if="props.type === 'number'">
      <edge-shad-number v-model="modelValue" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'option'">
      <edge-shad-select v-model="modelValue" :name="field" :label="label" :item-title="props.schema.option.optionsKey" :item-value="props.schema.option.optionsValue" :items="props.schema.option.options" />
    </div>
    <div v-else-if="props.type === 'image'" class="space-y-2">
      <div class="mb-2 text-sm font-medium text-foreground">
        {{ label }}
      </div>
      <div class="relative py-2 rounded-md flex items-center justify-center border border-border">
        <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer">
          <Dialog v-model:open="state.imageOpen">
            <DialogTrigger as-child>
              <edge-shad-button type="button" variant="outline" class="bg-white text-black hover:bg-gray-200">
                <ImagePlus class="h-5 w-5 mr-2" />
                Select Image
              </edge-shad-button>
            </DialogTrigger>
            <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Select Image</DialogTitle>
                <DialogDescription />
              </DialogHeader>
              <edge-cms-media-manager
                v-if="hasImageTags"
                :site="props.site"
                :select-mode="true"
                :default-tags="props.schema.tags"
                @select="selectImage"
              />
              <edge-cms-media-manager
                v-else
                :site="props.site"
                :select-mode="true"
                @select="selectImage"
              />
            </DialogContent>
          </Dialog>
        </div>
        <img
          v-if="modelValue"
          :src="modelValue"
          class="max-h-40 max-w-full h-auto w-auto object-contain"
        >
      </div>
      <edge-shad-input v-model="modelValue" :name="field" :label="`${label} URL`" />
    </div>
    <div v-else>
      <edge-shad-input v-model="modelValue" :name="field" :label="label" />
    </div>
  </div>
</template>
