<script setup>
import { ExternalLink, ImagePlus, Loader2 } from 'lucide-vue-next'
import { buildCmsBrandingIconPreview } from '../../lib/cmsBrandingIconPreview'

const props = defineProps({
  settings: { type: Object, required: true },
  canChooseAppIcon: { type: Boolean, default: false },
})
const emit = defineEmits(['chooseAppIcon'])
const runtimeConfig = useRuntimeConfig()
const icons = computed(() => buildCmsBrandingIconPreview(props.settings, runtimeConfig.public.cmsFrontendUrl))
const enlarged = ref(false)
const imageStates = reactive({})
const groups = [
  { id: 'favicons', title: 'Browser & Apple icons', description: 'Browser icons use the favicon, then the logo. Apple touch uses the app icon first, then the favicon and logo.' },
  { id: 'app', title: 'Installed-app icons', description: 'Previews the selected app icon. Choose dedicated artwork to see the installed-app sizes.' },
]
const imageState = icon => imageStates[icon.url] || { status: icon.url ? 'loading' : 'unavailable' }
const loaded = (icon, event) => {
  imageStates[icon.url] = { status: 'loaded', width: event.target.naturalWidth, height: event.target.naturalHeight }
}
const displaySize = icon => enlarged.value ? Math.max(icon.size || 128, 128) : (icon.size || 128)
const logos = computed(() => [
  { name: 'Dark logo', source: props.settings.logo, dark: false },
  { name: 'Light logo', source: props.settings.logoLight, dark: true },
  { name: 'App icon', source: props.settings.appIcon, dark: false },
].filter(logo => logo.source))
</script>

<template>
  <DialogContent class="inset-0 left-0 top-0 translate-x-0 translate-y-0 w-screen max-w-none h-dvh max-h-none rounded-none sm:rounded-none flex flex-col overflow-hidden p-0">
    <DialogHeader class="shrink-0 border-b px-6 pt-6 pb-4 pr-12">
      <DialogTitle>Branding icon preview</DialogTitle>
      <DialogDescription>Generated from your current selections, including unsaved changes. Previewing does not save or publish.</DialogDescription>
    </DialogHeader>
    <div class="min-h-0 overflow-y-auto p-6 space-y-6">
      <div v-if="logos.length" class="grid gap-3 sm:grid-cols-2">
        <div v-for="logo in logos" :key="logo.name" class="rounded-lg border overflow-hidden">
          <div class="flex h-24 items-center justify-center p-4" :class="logo.dark ? 'bg-slate-950' : 'bg-white'">
            <img :src="logo.source" :alt="logo.name" class="max-h-full max-w-full object-contain" @error="imageStates[logo.source] = { status: 'failed' }">
          </div>
          <p class="border-t px-3 py-2 text-xs text-muted-foreground">{{ logo.name }} · Original artwork<span v-if="imageStates[logo.source]?.status === 'failed'" class="text-destructive"> · Unable to load</span></p>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-muted-foreground">{{ enlarged ? 'Small icons enlarged for inspection.' : 'Actual size in CSS pixels. Large icons may scroll horizontally.' }}</p>
        <div class="inline-flex rounded-md border p-1" role="group" aria-label="Icon preview size">
          <edge-shad-button type="button" size="sm" :variant="!enlarged ? 'secondary' : 'ghost'" :aria-pressed="!enlarged" @click="enlarged = false">Actual size</edge-shad-button>
          <edge-shad-button type="button" size="sm" :variant="enlarged ? 'secondary' : 'ghost'" :aria-pressed="enlarged" @click="enlarged = true">Enlarged</edge-shad-button>
        </div>
      </div>
      <section v-for="group in groups" :key="group.id" class="space-y-3" :aria-label="group.title">
        <div>
          <h3 class="font-semibold text-sm">{{ group.title }}</h3>
          <p class="text-xs text-muted-foreground mt-1">{{ group.description }}</p>
        </div>
        <div v-if="group.id === 'app' && !icons.some(icon => icon.group === 'app')" class="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center">
          <ImagePlus class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p class="text-sm font-medium">Choose an app icon</p>
          <p class="max-w-md text-sm text-muted-foreground">Select app artwork in Branding to preview the 192 × 192 and 512 × 512 versions. The logo fallback is not shown here.</p>
          <edge-shad-button v-if="props.canChooseAppIcon" type="button" variant="outline" @click="emit('chooseAppIcon')">Select app icon</edge-shad-button>
        </div>
        <div v-else class="grid gap-3" :class="group.id === 'app' ? 'lg:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5'">
          <article v-for="icon in icons.filter(item => item.group === group.id)" :key="`${icon.id}:${icon.url}`" class="min-w-0 overflow-hidden rounded-lg border bg-card">
            <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <p class="text-sm font-medium">{{ icon.label }}</p>
                <p class="text-xs font-mono text-muted-foreground">{{ icon.size ? `${icon.size} × ${icon.size} px` : 'Any size (original)' }}</p>
              </div>
              <a v-if="icon.url" :href="icon.url" target="_blank" rel="noopener noreferrer" class="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" :aria-label="`Open ${icon.label} ${icon.size || 'original'} image`" title="Open generated image"><ExternalLink class="h-4 w-4" /></a>
            </div>
            <div class="overflow-auto bg-white p-4" :class="group.id === 'app' ? 'max-h-[560px]' : 'h-52'">
              <div class="flex min-h-36 min-w-full w-fit items-center justify-center">
                <p v-if="!icon.url" class="max-w-56 text-center text-xs text-slate-600">Image preview unavailable. Check the selected source and CMS frontend URL.</p>
                <p v-else-if="imageState(icon).status === 'failed'" role="status" class="text-center text-xs text-destructive">Unable to load this image. Check the source or open the generated image.</p>
                <div v-else class="relative shrink-0">
                  <div v-if="imageState(icon).status === 'loading'" class="absolute inset-0 flex items-center justify-center" role="status" :aria-label="`Loading ${icon.label} ${icon.size || 'original'}`"><Loader2 class="h-4 w-4 animate-spin text-slate-500" /></div>
                  <img :src="icon.url" :alt="`${icon.label}, ${icon.size ? `${icon.size} by ${icon.size} pixels` : 'original size'}`" :width="displaySize(icon)" :height="displaySize(icon)" class="block max-w-none object-contain" :style="{ width: `${displaySize(icon)}px`, height: `${displaySize(icon)}px`, imageRendering: enlarged && icon.size && icon.size < 96 ? 'pixelated' : 'auto' }" @load="loaded(icon, $event)" @error="imageStates[icon.url] = { status: 'failed' }">
                </div>
              </div>
            </div>
            <div class="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
              <p>{{ icon.sourceLabel }}</p>
              <p>{{ icon.treatment }}</p>
              <p v-if="imageState(icon).status === 'loaded'">Returned file: {{ imageState(icon).width }} × {{ imageState(icon).height }} px</p>
              <p v-if="!icon.transformed">The renderer uses the original image rather than generating this size.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  </DialogContent>
</template>
