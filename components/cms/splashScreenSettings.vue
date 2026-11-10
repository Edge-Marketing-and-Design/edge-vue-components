<script setup>
import { ImagePlus } from 'lucide-vue-next'
import { splashThemeColors } from '../../lib/cmsSplashScreen'

const props = defineProps({
  settings: { type: Object, required: true },
  theme: { type: [Object, String], default: null },
  siteId: { type: String, default: '' },
  enableMediaPicker: { type: Boolean, default: false },
})
const pickerOpen = ref(false)
const previewPlatform = ref('ios')
const previewImage = computed(() => previewPlatform.value === 'android' ? props.settings.appIcon : props.settings.splashImage)
const imageFailed = ref(false)
const imageLoading = ref(false)
const colors = computed(() => splashThemeColors(props.theme))
const selectedColor = computed(() => colors.value.find(item => item.name === props.settings.splashBackgroundColor))
const missingColor = computed(() => Boolean(props.settings.splashBackgroundColor && !selectedColor.value))
const previewBackground = computed(() => selectedColor.value?.color || '#ffffff')
watch([previewPlatform, previewImage], ([, url]) => {
  imageFailed.value = false
  imageLoading.value = Boolean(url)
}, { immediate: true })
</script>

<template>
  <div class="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div class="min-w-0 space-y-6">
      <div class="space-y-2">
        <h3 class="text-base font-semibold">Splash screen</h3>
        <p class="text-sm text-muted-foreground">A splash screen appears while your site opens from an installed home-screen shortcut. Choose artwork and a background that feel like your brand.</p>
        <p class="text-xs text-muted-foreground">The final appearance depends on the device and browser. This preview shows your current selections, including unsaved changes.</p>
      </div>
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">iOS splash image</span>
          <edge-shad-button v-if="props.settings.splashImage" type="button" variant="ghost" size="sm" @click="props.settings.splashImage = ''">Remove</edge-shad-button>
        </div>
        <button v-if="props.enableMediaPicker" type="button" class="flex w-full items-center justify-center gap-3 rounded-md border border-dashed border-input bg-muted/30 px-4 py-6 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="pickerOpen = true">
          <ImagePlus class="h-5 w-5 shrink-0" />
          {{ props.settings.splashImage ? 'Change splash image' : 'Select splash image' }}
        </button>
        <edge-shad-input v-else v-model="props.settings.splashImage" name="splashImage" label="Splash image URL" placeholder="https://..." />
        <p class="text-xs text-muted-foreground">Use high-resolution artwork, ideally at least 1024px on its longest side. Transparent artwork works well on a colored background. The image is centered and kept in proportion.</p>
      </div>
      <fieldset class="space-y-3">
        <legend class="text-sm font-medium">Background color</legend>
        <p class="text-xs text-muted-foreground">Choose a color from this site's theme. Updating that theme color also updates the splash background.</p>
        <div v-if="colors.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label v-for="item in colors" :key="item.name" class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm" :class="props.settings.splashBackgroundColor === item.name ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'">
            <input v-model="props.settings.splashBackgroundColor" type="radio" name="splashBackgroundColor" :value="item.name" class="accent-primary">
            <span class="h-5 w-5 shrink-0 rounded border border-black/10" :style="{ backgroundColor: item.color }" aria-hidden="true" />
            <span class="break-all">{{ item.name }}</span>
          </label>
        </div>
        <p v-else class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No theme colors are available. Select a theme with defined colors in Appearance.</p>
        <p v-if="missingColor" role="status" class="text-sm text-amber-700 dark:text-amber-400">The saved color “{{ props.settings.splashBackgroundColor }}” is unavailable in this theme. Choose another color. The preview uses white until then.</p>
        <edge-shad-button v-if="props.settings.splashBackgroundColor" type="button" size="sm" variant="ghost" @click="props.settings.splashBackgroundColor = ''">Clear color selection</edge-shad-button>
        <p v-if="!props.settings.splashBackgroundColor" class="text-xs text-muted-foreground">No background selected. White is shown in the preview.</p>
      </fieldset>
    </div>
    <div class="space-y-3">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Home-screen launch preview</p>
      <div class="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1" role="group" aria-label="Preview device">
        <edge-shad-button v-for="platform in ['ios', 'android']" :key="platform" type="button" size="sm" :variant="previewPlatform === platform ? 'default' : 'ghost'" :aria-pressed="previewPlatform === platform" @click="previewPlatform = platform">{{ platform === 'ios' ? 'iOS' : 'Android' }}</edge-shad-button>
      </div>
      <p v-if="previewPlatform === 'android'" class="text-sm text-muted-foreground">Android uses your app icon. Set or change it in the <strong class="font-medium text-foreground">Branding</strong> tab.</p>
      <div class="mx-auto w-full max-w-[260px] rounded-[2.25rem] border-[7px] border-slate-800 bg-slate-800 p-0.5 shadow-md">
        <div class="relative flex aspect-[9/18] items-center justify-center overflow-hidden rounded-[1.7rem] p-8" :style="{ backgroundColor: previewBackground }">
          <div class="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-slate-800" :class="previewPlatform === 'ios' ? 'h-4 w-20' : 'h-2 w-2'" aria-hidden="true" />
          <img v-if="previewImage && !imageFailed" :key="previewPlatform + previewImage" :src="previewImage" :alt="previewPlatform === 'android' ? 'App icon from Branding' : 'Selected iOS splash artwork'" class="object-contain" :class="previewPlatform === 'android' ? 'h-24 w-24' : 'max-h-[190px] max-w-full'" @load="imageLoading = false" @error="imageFailed = true; imageLoading = false">
          <span v-else class="rounded-md border border-dashed border-slate-400 bg-white/90 p-4 text-center text-xs text-slate-600">{{ imageFailed ? 'Image could not be loaded. Choose another image.' : previewPlatform === 'android' ? 'Choose an app icon in Branding to preview Android.' : 'Choose an image to preview your iOS splash screen.' }}</span>
        </div>
      </div>
      <p class="text-center text-xs text-muted-foreground">Illustrative preview. Device layout may vary.</p>
      <p v-if="imageLoading" role="status" class="text-center text-xs text-muted-foreground">Loading artwork…</p>
      <p v-if="imageFailed" role="alert" class="text-sm text-destructive">{{ previewPlatform === 'android' ? 'The app icon could not be loaded. Check it in Branding.' : 'The selected splash image could not be loaded.' }}</p>
    </div>
    <Dialog v-model:open="pickerOpen">
      <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-hidden">
        <DialogHeader><DialogTitle>Select splash image</DialogTitle><DialogDescription>Choose artwork from your media library.</DialogDescription></DialogHeader>
        <edge-cms-media-manager :site="props.siteId" :select-mode="true" @select="url => { props.settings.splashImage = url; pickerOpen = false }" />
      </DialogContent>
    </Dialog>
  </div>
</template>
