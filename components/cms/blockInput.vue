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
  showRichtextImageToggle: {
    type: Boolean,
    required: false,
    default: false,
  },
  richtextAutoHeight: {
    type: Boolean,
    required: false,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'delete'])

const modelValue = useVModel(props, 'modelValue', emit)
const richtextEditorRef = ref(null)
const edgeFirebase = inject('edgeFirebase')
const isGlobalAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const richtextEnabledToggles = computed(() => {
  const baseToggles = ['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline', 'link', 'files']
  if (props.showRichtextImageToggle)
    baseToggles.push('image')
  if (isGlobalAdmin.value)
    return [...baseToggles, 'source']
  return baseToggles
})

const state = reactive({
  mounted: false,
  imageOpen: false,
  richtextImageOpen: false,
  richtextFileOpen: false,
})

const hasImageTags = computed(() => {
  return Array.isArray(props.schema?.tags) && props.schema.tags.length > 0
})

const resolvedImageUrl = computed(() => {
  if (typeof modelValue.value === 'string')
    return modelValue.value
  return ''
})

const hasImageValue = computed(() => String(resolvedImageUrl.value || '').trim().length > 0)

const normalizeSelectedImageUrl = (url) => {
  if (typeof url === 'string')
    return url
  if (url && typeof url === 'object') {
    if (typeof url.url === 'string')
      return url.url
    const publicUrl = edgeGlobal.getImage(url, 'public')
    if (typeof publicUrl === 'string')
      return publicUrl
  }
  return ''
}

const selectImage = async (url) => {
  modelValue.value = normalizeSelectedImageUrl(url)
  await nextTick()
  state.imageOpen = false
}

const openRichtextImagePicker = () => {
  state.richtextImageOpen = true
}

const openRichtextFilePicker = () => {
  state.richtextFileOpen = true
}

const selectRichtextImage = async (url) => {
  const normalizedUrl = normalizeSelectedImageUrl(url)
  if (normalizedUrl)
    richtextEditorRef.value?.insertImage?.(normalizedUrl)
  await nextTick()
  state.richtextImageOpen = false
}

const selectRichtextFile = async (url) => {
  const normalizedUrl = normalizeSelectedImageUrl(url)
  if (normalizedUrl)
    richtextEditorRef.value?.insertFile?.(normalizedUrl)
  await nextTick()
  state.richtextFileOpen = false
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
      <edge-shad-html
        ref="richtextEditorRef"
        v-model="modelValue"
        :enabled-toggles="richtextEnabledToggles"
        :enable-links="true"
        :height-class="props.richtextAutoHeight ? 'none' : ''"
        :name="field"
        :label="label"
        @request-image="openRichtextImagePicker"
        @request-file="openRichtextFilePicker"
      />
      <edge-shad-dialog v-model="state.richtextImageOpen">
        <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Image</DialogTitle>
            <DialogDescription />
          </DialogHeader>
          <edge-cms-media-manager
            v-if="hasImageTags"
            :site="props.site"
            :select-mode="true"
            :default-tags="props.schema.tags"
            @select="selectRichtextImage"
          />
          <edge-cms-media-manager
            v-else
            :site="props.site"
            :select-mode="true"
            @select="selectRichtextImage"
          />
        </DialogContent>
      </edge-shad-dialog>
      <edge-shad-dialog v-model="state.richtextFileOpen">
        <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select File</DialogTitle>
            <DialogDescription />
          </DialogHeader>
          <edge-cms-media-manager
            v-if="hasImageTags"
            :site="props.site"
            :select-mode="true"
            :include-files="true"
            :files-only="true"
            :default-tags="props.schema.tags"
            @select="selectRichtextFile"
          />
          <edge-cms-media-manager
            v-else
            :site="props.site"
            :select-mode="true"
            :include-files="true"
            :files-only="true"
            @select="selectRichtextFile"
          />
        </DialogContent>
      </edge-shad-dialog>
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
        <Dialog v-model:open="state.imageOpen">
          <DialogTrigger as-child>
            <edge-shad-button
              v-if="!hasImageValue"
              type="button"
              variant="outline"
              class="h-20 w-full border-dashed text-muted-foreground hover:text-foreground"
            >
              <ImagePlus class="h-5 w-5 mr-2" />
              Select Image
            </edge-shad-button>
          </DialogTrigger>
          <DialogTrigger v-if="hasImageValue" as-child>
            <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer">
              <edge-shad-button type="button" variant="outline" class="bg-white text-black hover:bg-gray-200">
                <ImagePlus class="h-5 w-5 mr-2" />
                Replace Image
              </edge-shad-button>
            </div>
          </DialogTrigger>
          <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-hidden">
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
        <img
          v-if="hasImageValue"
          :src="resolvedImageUrl"
          class="max-h-40 max-w-full h-auto w-auto object-contain"
        >
      </div>
    </div>
    <div v-else>
      <edge-shad-input v-model="modelValue" :name="field" :label="label" />
    </div>
  </div>
</template>
