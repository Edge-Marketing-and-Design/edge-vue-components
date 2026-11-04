<script setup>
import { useVModel } from '@vueuse/core'
import { ImagePlus, Video, X } from 'lucide-vue-next'
import {
  applyCloudflareVideoOptions,
  buildCloudflareVideoIframe,
  getCloudflareVideoIframeSrc,
  getCloudflareVideoOptions,
  normalizeCloudflareVideoOptions,
} from '../../lib/cmsVideo'

const props = defineProps({
  field: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  placeholder: {
    type: String,
    required: false,
    default: '',
  },
  modelValue: {
    type: [Object, String, Array, Number, Boolean],
    required: false,
    default: '',
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
  showRichtextArticleTools: {
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
  if (props.showRichtextArticleTools)
    baseToggles.push('paragraph', 'heading2', 'heading3', 'blockquote', 'horizontalrule')
  if (props.showRichtextImageToggle)
    baseToggles.push('image')
  if (isGlobalAdmin.value)
    return [...baseToggles, 'source']
  return baseToggles
})

const state = reactive({
  mounted: false,
  imageOpen: false,
  videoOpen: false,
  videoError: '',
  richtextImageOpen: false,
  richtextFileOpen: false,
})

const hasImageTags = computed(() => {
  return Array.isArray(props.schema?.tags) && props.schema.tags.length > 0
})

const resolvedImageVariant = computed(() => {
  return String(props.schema?.variant || 'public').trim() || 'public'
})

const resolvedImageUrl = computed(() => {
  if (typeof modelValue.value === 'string')
    return modelValue.value
  return ''
})

const hasImageValue = computed(() => String(resolvedImageUrl.value || '').trim().length > 0)
const isVideoPicker = computed(() => props.type === 'richtext' && props.schema?.picker === 'video')
const selectedVideoEmbedUrl = computed(() => getCloudflareVideoIframeSrc(modelValue.value))
const hasVideoValue = computed(() => Boolean(selectedVideoEmbedUrl.value))
const videoOptions = computed(() => getCloudflareVideoOptions(modelValue.value))
const isBackgroundVideo = computed(() => videoOptions.value.layout === 'background')
// Values saved before playback options existed have no hidden-video guard.
const videoNeedsPlayerUpdate = computed(() => hasVideoValue.value && !/data-cms-video-guard/.test(String(modelValue.value || '')))
const videoLayoutItems = [
  { label: 'Standard player', value: 'player' },
  { label: 'Background (fills the block, muted, loops)', value: 'background' },
]
// A block author can set starting options with schema.videoOptions, such as
// { "layout": "background" } for a hero background video.
const schemaVideoOptions = computed(() => {
  const options = props.schema?.videoOptions
  return (options && typeof options === 'object' && !Array.isArray(options)) ? options : {}
})
const videoToggles = [
  { key: 'autoplay', label: 'Autoplay', description: 'Starts when the page loads.' },
  { key: 'sound', label: 'Sound', description: 'Off starts the video muted.' },
  { key: 'loop', label: 'Loop', description: 'Starts again when it ends.' },
  { key: 'controls', label: 'Player controls', description: 'Play, pause, volume and full screen.' },
]

const optionConfig = computed(() => {
  let option = {}
  if (props.schema?.option && typeof props.schema.option === 'object' && !Array.isArray(props.schema.option))
    option = props.schema.option
  const itemTitle = String(option.optionsKey || 'label').trim() || 'label'
  const itemValue = String(option.optionsValue || 'value').trim() || 'value'
  let items = []
  if (Array.isArray(option.options)) {
    items = option.options
      .map((item) => {
        if (typeof item === 'string') {
          const value = item.trim()
          return value ? { [itemTitle]: value, [itemValue]: value } : null
        }
        if (!item || typeof item !== 'object')
          return null
        const label = item[itemTitle] ?? item.label ?? item.title ?? item.name ?? item[itemValue] ?? item.value ?? ''
        const value = item[itemValue] ?? item.value ?? item.name ?? item.id ?? label
        if (String(label || '').trim() === '' && String(value || '').trim() === '')
          return null
        return {
          [itemTitle]: String(label || value).trim(),
          [itemValue]: String(value || label).trim(),
        }
      })
      .filter(item => item && String(item[itemValue] || '').trim() !== '')
  }
  return {
    itemTitle,
    itemValue,
    items,
  }
})

const getOptionDefaultValue = () => {
  if (props.schema?.value !== undefined && props.schema?.value !== null && props.schema?.value !== '')
    return props.schema.value
  return optionConfig.value.items[0]?.[optionConfig.value.itemValue] || ''
}

const normalizeSelectedImageUrl = (url) => {
  if (typeof url === 'string')
    return url
  if (url && typeof url === 'object') {
    if (typeof url.url === 'string')
      return url.url
    const publicUrl = edgeGlobal.getImage(url, resolvedImageVariant.value)
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

const clearImage = () => {
  modelValue.value = ''
  state.imageOpen = false
}

const selectVideo = async (_url, item) => {
  const options = hasVideoValue.value
    ? videoOptions.value
    : normalizeCloudflareVideoOptions(schemaVideoOptions.value)
  const iframe = buildCloudflareVideoIframe(item, options)
  if (!iframe) {
    state.videoError = 'This video is still processing in Cloudflare Stream. Wait a few minutes, then reopen the picker and select it again.'
    return
  }
  modelValue.value = iframe
  state.videoError = ''
  await nextTick()
  state.videoOpen = false
}

const updateVideoOptions = (patch) => {
  if (!hasVideoValue.value)
    return
  modelValue.value = applyCloudflareVideoOptions(modelValue.value, { ...videoOptions.value, ...patch })
}

const updateVideoSeconds = (key, event) => {
  const raw = String(event?.target?.value ?? '').trim()
  updateVideoOptions({ [key]: raw === '' ? (key === 'posterTime' ? null : 0) : raw })
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
    modelValue.value = getOptionDefaultValue()
  }
  await nextTick()
  state.mounted = true
})
</script>

<template>
  <div v-if="state.mounted">
    <div v-if="isVideoPicker" class="space-y-2">
      <div class="text-sm font-medium text-foreground">
        {{ label }}
      </div>
      <div class="relative min-h-40 overflow-hidden rounded-md border border-border bg-black flex items-center justify-center">
        <Dialog v-model:open="state.videoOpen">
          <DialogTrigger as-child>
            <edge-shad-button
              v-if="!hasVideoValue"
              type="button"
              variant="outline"
              class="h-40 w-full rounded-none border-dashed bg-background text-muted-foreground hover:text-foreground"
            >
              <Video class="h-5 w-5 mr-2" />
              Select Video
            </edge-shad-button>
          </DialogTrigger>
          <DialogTrigger v-if="hasVideoValue" as-child>
            <div class="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/80 opacity-0 transition-opacity hover:opacity-100">
              <edge-shad-button type="button" variant="outline" class="bg-white text-black hover:bg-gray-200">
                <Video class="h-5 w-5 mr-2" />
                Replace Video
              </edge-shad-button>
            </div>
          </DialogTrigger>
          <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Select Video</DialogTitle>
              <DialogDescription>
                Newly uploaded videos can take a few minutes to become available from Cloudflare Stream.
              </DialogDescription>
            </DialogHeader>
            <edge-cms-media-manager
              :site="props.site"
              :show-cms-site-filter="true"
              cms-site-only-title="Current Site"
              :select-mode="true"
              :include-videos="true"
              :videos-only="true"
              media-type-default="videos"
              :default-tags="hasImageTags ? props.schema.tags : []"
              @select="selectVideo"
            />
          </DialogContent>
        </Dialog>
        <iframe
          v-if="hasVideoValue"
          :src="selectedVideoEmbedUrl"
          :title="label"
          class="aspect-video w-full"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowfullscreen
          loading="lazy"
        />
      </div>
      <p v-if="state.videoError" class="text-sm text-destructive" role="alert">
        {{ state.videoError }}
      </p>
      <div v-if="hasVideoValue" class="space-y-3 rounded-md border border-border p-3">
        <div v-if="videoNeedsPlayerUpdate" class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
          <span>This video was added before playback options. Update it so it stops when a pop-up closes.</span>
          <edge-shad-button type="button" size="sm" variant="outline" class="h-7" @click="updateVideoOptions({})">
            Update player
          </edge-shad-button>
        </div>
        <div class="space-y-1">
          <label :for="`${field}-video-layout`" class="text-sm font-medium text-foreground">Layout</label>
          <select
            :id="`${field}-video-layout`"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            :value="videoOptions.layout"
            @change="updateVideoOptions({ layout: $event.target.value })"
          >
            <option v-for="item in videoLayoutItems" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <p v-if="isBackgroundVideo" class="text-xs text-muted-foreground">
            Covers the block behind its content. Always muted, looping and without controls; it stays still for visitors who turn on reduced motion. The block template must place it inside a positioned element.
          </p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div
            v-for="toggle in videoToggles"
            :key="toggle.key"
            class="flex items-start justify-between gap-3 rounded-md border border-border p-2"
          >
            <label :for="`${field}-video-${toggle.key}`" class="min-w-0">
              <span class="block text-sm font-medium text-foreground">{{ toggle.label }}</span>
              <span class="block text-xs text-muted-foreground">{{ toggle.description }}</span>
            </label>
            <Switch
              :id="`${field}-video-${toggle.key}`"
              :model-value="videoOptions[toggle.key]"
              :disabled="isBackgroundVideo"
              @update:model-value="value => updateVideoOptions({ [toggle.key]: value })"
            />
          </div>
        </div>
        <p v-if="videoOptions.autoplay && videoOptions.sound" class="text-xs text-amber-600 dark:text-amber-400" role="status">
          Browsers block autoplay with sound, so this video may wait for a click. Turn Sound off to make sure it starts on its own.
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="space-y-1">
            <label :for="`${field}-video-start`" class="text-sm font-medium text-foreground">Start at (seconds)</label>
            <input
              :id="`${field}-video-start`"
              type="number"
              min="0"
              step="0.5"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              :value="videoOptions.startTime || ''"
              placeholder="0"
              @change="updateVideoSeconds('startTime', $event)"
            >
          </div>
          <div class="space-y-1">
            <label :for="`${field}-video-poster`" class="text-sm font-medium text-foreground">Cover image from (seconds)</label>
            <input
              :id="`${field}-video-poster`"
              type="number"
              min="0"
              step="0.5"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              :value="videoOptions.posterTime ?? ''"
              placeholder="Default frame"
              @change="updateVideoSeconds('posterTime', $event)"
            >
          </div>
        </div>
        <p class="text-xs text-muted-foreground">
          On the live site a video stops when it is hidden, such as when a pop-up closes.
        </p>
      </div>
    </div>
    <div v-else-if="props.type === 'richtext'">
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
            :show-cms-site-filter="true"
            cms-site-only-title="Current Site"
            :select-mode="true"
            :default-tags="props.schema.tags"
            :image-variant="resolvedImageVariant"
            @select="selectRichtextImage"
          />
          <edge-cms-media-manager
            v-else
            :site="props.site"
            :show-cms-site-filter="true"
            cms-site-only-title="Current Site"
            :select-mode="true"
            :image-variant="resolvedImageVariant"
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
            :show-cms-site-filter="true"
            cms-site-only-title="Current Site"
            :select-mode="true"
            :include-files="true"
            :files-only="true"
            :default-tags="props.schema.tags"
            @select="selectRichtextFile"
          />
          <edge-cms-media-manager
            v-else
            :site="props.site"
            :show-cms-site-filter="true"
            cms-site-only-title="Current Site"
            :select-mode="true"
            :include-files="true"
            :files-only="true"
            @select="selectRichtextFile"
          />
        </DialogContent>
      </edge-shad-dialog>
    </div>
    <div v-else-if="props.type === 'textarea'">
      <edge-shad-textarea v-model="modelValue" :name="field" :label="label" :placeholder="props.placeholder" />
    </div>
    <div v-else-if="props.type === 'array'">
      <edge-shad-tags v-model="modelValue" :label="label" :name="field" />
    </div>
    <div v-else-if="props.type === 'number'">
      <edge-shad-number v-model="modelValue" :name="field" :label="label" />
    </div>
    <div v-else-if="props.type === 'option'">
      <edge-shad-select v-model="modelValue" :name="field" :label="label" :item-title="optionConfig.itemTitle" :item-value="optionConfig.itemValue" :items="optionConfig.items" />
    </div>
    <div v-else-if="props.type === 'image'" class="space-y-2">
      <div class="mb-2 flex w-full items-center justify-between gap-2">
        <span class="min-w-0 text-sm font-medium text-foreground">{{ label }}</span>
        <edge-shad-button
          v-if="hasImageValue"
          type="button"
          size="sm"
          variant="ghost"
          class="ml-auto h-6 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
          :aria-label="`Clear ${label}`"
          title="Clear this field without deleting the image from the media library"
          @click.stop="clearImage"
        >
          <X class="h-3 w-3" />Clear image
        </edge-shad-button>
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
              :show-cms-site-filter="true"
              cms-site-only-title="Current Site"
              :select-mode="true"
              :default-tags="props.schema.tags"
              :image-variant="resolvedImageVariant"
              @select="selectImage"
            />
            <edge-cms-media-manager
              v-else
              :site="props.site"
              :show-cms-site-filter="true"
              cms-site-only-title="Current Site"
              :select-mode="true"
              :image-variant="resolvedImageVariant"
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
      <edge-shad-input v-model="modelValue" :name="field" :label="label" :placeholder="props.placeholder" />
    </div>
  </div>
</template>
