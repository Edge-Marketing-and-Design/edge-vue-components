<script setup>
import { Check, ChevronsUpDown, FileText } from 'lucide-vue-next'
import { postTypeIconOptions, postTypeIcons } from '../../lib/cmsPostTypeIcons'
import { buildPostTypeFields } from '../../lib/cmsPostTypes'
const props = defineProps({ modelValue: { type: Object, default: () => ({}) }, page: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const set = changes => emit('update:modelValue', { ...props.modelValue, ...changes })
const iconPickerOpen = ref(false)
const iconSearch = ref('')
const selectedIcon = computed(() => postTypeIconOptions.find(icon => icon.value === props.modelValue?.icon) || postTypeIconOptions[0])
const filteredIcons = computed(() => {
  const query = iconSearch.value.trim().toLowerCase().replace(/\s/g, '')
  return postTypeIconOptions.filter(icon => icon.value.toLowerCase().includes(query))
})
const selectIcon = (icon) => {
  set({ icon })
  iconPickerOpen.value = false
}
watch(iconPickerOpen, () => {
  iconSearch.value = ''
})

const fieldSummary = computed(() => {
  try {
    return { fields: buildPostTypeFields(props.page), error: '' }
  }
  catch (error) {
    return { fields: [], error: error.message }
  }
},
)
</script>

<template>
  <section v-if="page.post" class="space-y-4">
    <edge-shad-checkbox :model-value="modelValue?.enabled === true" name="custom-post-type" item-class="!mt-0" @update:model-value="value => set({ enabled: value === true })">
      <span class="block text-sm font-medium">Use as a custom post type</span>
      <span class="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">Add {{ page.name || 'this page' }} to this site's content menu. Its detail layout becomes the entry form.</span>
    </edge-shad-checkbox>
    <div v-if="modelValue?.enabled" class="space-y-3 pl-1">
      <div class="space-y-2">
        <span id="post-type-icon-label" class="text-sm font-medium">Menu icon</span>
        <Popover v-model:open="iconPickerOpen">
          <PopoverTrigger as-child>
            <edge-shad-button type="button" variant="outline" class="w-full justify-between font-normal" aria-labelledby="post-type-icon-label post-type-icon-value">
              <span id="post-type-icon-value" class="flex items-center gap-2">
                <component :is="postTypeIcons[selectedIcon.value] || FileText" class="h-4 w-4" aria-hidden="true" />
                {{ selectedIcon.label }}
              </span>
              <ChevronsUpDown class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </edge-shad-button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-[360px] max-w-[calc(100vw-2rem)] p-3">
            <edge-shad-input v-model="iconSearch" name="post-type-icon-search" label="Search icons" placeholder="Search icons…" />
            <div class="mt-3 grid max-h-72 grid-cols-3 gap-1 overflow-y-auto" aria-label="Menu icons">
              <edge-shad-button v-for="icon in filteredIcons" :key="icon.value" type="button" variant="ghost" class="relative h-20 flex-col gap-2 px-1 text-xs font-normal" :class="selectedIcon.value === icon.value ? 'bg-muted ring-1 ring-inset ring-border' : ''" :aria-pressed="selectedIcon.value === icon.value" @click="selectIcon(icon.value)">
                <component :is="postTypeIcons[icon.value]" class="h-5 w-5" aria-hidden="true" />
                <span class="text-center leading-tight">{{ icon.label }}</span>
                <Check v-if="selectedIcon.value === icon.value" class="absolute right-1 top-1 h-3 w-3" aria-hidden="true" />
              </edge-shad-button>
            </div>
            <p v-if="!filteredIcons.length" class="py-6 text-center text-sm text-muted-foreground">
              No icons match your search.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <edge-shad-checkbox :model-value="modelValue?.event === true" name="custom-post-type-event" item-class="!mt-0" @update:model-value="value => set({ event: value === true })">
        <span class="block text-sm font-medium">Event entries</span>
        <span class="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">Include event dates, location and registration details for this type.</span>
      </edge-shad-checkbox>
      <p v-if="fieldSummary.error" role="alert" class="text-sm text-destructive">
        {{ fieldSummary.error }}
      </p>
      <p v-else class="text-xs text-muted-foreground">
        {{ fieldSummary.fields.length }} editable content fields. Sitemap inclusion is managed in Site Settings.
      </p>
    </div>
  </section>
</template>
