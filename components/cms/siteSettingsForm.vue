<script setup lang="js">
const props = defineProps({
  settings: {
    type: Object,
    required: true,
  },
  themeOptions: {
    type: Array,
    default: () => [],
  },
  userOptions: {
    type: Array,
    default: () => [],
  },
  hasUsers: {
    type: Boolean,
    default: false,
  },
  showUsers: {
    type: Boolean,
    default: false,
  },
  showThemeFields: {
    type: Boolean,
    default: true,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  enableMediaPicker: {
    type: Boolean,
    default: false,
  },
  siteId: {
    type: String,
    default: '',
  },
})

const state = reactive({
  logoPickerOpen: false,
  logoLightPickerOpen: false,
  brandLogoDarkPickerOpen: false,
  brandLogoLightPickerOpen: false,
  faviconPickerOpen: false,
})

const themeOptionsMap = computed(() => {
  const map = new Map()
  for (const option of props.themeOptions) {
    if (option?.value)
      map.set(option.value, option)
  }
  return map
})

const themeItemsForAllowed = (allowed, current) => {
  const base = props.themeOptions || []
  const allowedList = Array.isArray(allowed) ? allowed.filter(Boolean) : []
  if (allowedList.length) {
    const allowedSet = new Set(allowedList)
    const filtered = base.filter(option => allowedSet.has(option.value))
    if (current && !allowedSet.has(current)) {
      const currentOption = themeOptionsMap.value.get(current)
      if (currentOption)
        filtered.push(currentOption)
    }
    return filtered
  }

  if (current) {
    const currentOption = themeOptionsMap.value.get(current)
    return currentOption ? [currentOption] : []
  }

  return []
}

const menuPositionOptions = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]
</script>

<template>
  <Tabs class="w-full" default-value="general">
    <TabsList class="w-full gap-2 bg-muted/40 p-1 rounded-lg">
      <TabsTrigger value="general" class="text-sm uppercase font-medium">
        General
      </TabsTrigger>
      <TabsTrigger value="appearance" class="text-sm uppercase font-medium">
        Appearance
      </TabsTrigger>
      <TabsTrigger value="branding" class="text-sm uppercase font-medium">
        Branding
      </TabsTrigger>
      <TabsTrigger value="seo" class="text-sm uppercase font-medium">
        SEO
      </TabsTrigger>
      <TabsTrigger value="tracking" class="text-sm uppercase font-medium">
        Tracking Pixels
      </TabsTrigger>
      <TabsTrigger value="social" class="text-sm uppercase font-medium">
        Social Media
      </TabsTrigger>
    </TabsList>
    <TabsContent value="general" class="pt-4 space-y-4">
      <edge-shad-input
        v-model="props.settings.name"
        name="name"
        label="Name"
        placeholder="Enter name"
        class="w-full"
      />
      <edge-shad-tags
        v-model="props.settings.domains"
        name="domains"
        label="Domains"
        placeholder="Add or remove domains"
        class="w-full"
      />
      <edge-shad-input
        v-model="props.settings.contactEmail"
        name="contactEmail"
        label="Contact Email"
        placeholder="name@example.com"
        class="w-full"
      />
      <edge-shad-input
        v-model="props.settings.contactPhone"
        name="contactPhone"
        type="tel"
        label="Contact Phone"
        placeholder="(555) 555-5555"
        :mask-options="{ mask: '(###) ###-####' }"
        class="w-full"
      />
      <edge-shad-select-tags
        v-if="props.showUsers && props.hasUsers && props.isAdmin"
        v-model="props.settings.users"
        :items="props.userOptions"
        name="users"
        label="Users"
        item-title="label"
        item-value="value"
        placeholder="Select users"
        class="w-full"
        :multiple="true"
      />
      <p v-else-if="props.showUsers" class="text-sm text-muted-foreground">
        No organization users available for this site.
      </p>
    </TabsContent>
    <TabsContent value="appearance" class="pt-4 space-y-4">
      <edge-shad-select-tags
        v-if="props.showThemeFields && props.isAdmin"
        :model-value="Array.isArray(props.settings.allowedThemes) ? props.settings.allowedThemes : []"
        name="allowedThemes"
        label="Allowed Themes"
        placeholder="Select allowed themes"
        class="w-full"
        :items="props.themeOptions"
        item-title="label"
        item-value="value"
        @update:model-value="(value) => {
          const normalized = Array.isArray(value) ? value : []
          props.settings.allowedThemes = normalized
          if (normalized.length && !normalized.includes(props.settings.theme)) {
            props.settings.theme = normalized[0] || ''
          }
        }"
      />
      <edge-shad-select
        v-if="props.showThemeFields"
        :model-value="props.settings.theme || ''"
        name="theme"
        label="Theme"
        placeholder="Select a theme"
        class="w-full"
        :items="themeItemsForAllowed(props.settings.allowedThemes, props.settings.theme)"
        item-title="label"
        item-value="value"
        @update:model-value="value => (props.settings.theme = value || '')"
      />
      <edge-shad-select
        :model-value="props.settings.menuPosition || ''"
        name="menuPosition"
        label="Menu Position"
        placeholder="Select menu position"
        class="w-full"
        :items="menuPositionOptions"
        item-title="label"
        item-value="value"
        @update:model-value="value => (props.settings.menuPosition = value || '')"
      />
    </TabsContent>
    <TabsContent value="branding" class="pt-4 space-y-4">
      <div v-if="props.enableMediaPicker && props.siteId" class="space-y-2">
        <label class="text-sm font-medium text-foreground flex items-center justify-between">
          Dark logo
          <edge-shad-button
            type="button"
            variant="link"
            class="px-0 h-auto text-sm"
            @click="state.logoPickerOpen = !state.logoPickerOpen"
          >
            {{ state.logoPickerOpen ? 'Hide picker' : 'Select logo' }}
          </edge-shad-button>
        </label>
        <div class="flex items-center gap-4">
          <div v-if="props.settings.logo" class="flex items-center gap-3">
            <img :src="props.settings.logo" alt="Logo preview" class="h-16 w-auto rounded-md border border-border bg-muted object-contain">
            <edge-shad-button
              type="button"
              variant="ghost"
              class="h-8"
              @click="props.settings.logo = ''"
            >
              Remove
            </edge-shad-button>
          </div>
          <span v-else class="text-sm text-muted-foreground italic">No logo selected</span>
        </div>
        <div v-if="state.logoPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
          <edge-cms-media-manager
            :site="props.siteId"
            :select-mode="true"
            :default-tags="['Logos']"
            @select="(url) => {
              props.settings.logo = url
              state.logoPickerOpen = false
            }"
          />
        </div>
      </div>
      <edge-shad-input
        v-else
        v-model="props.settings.logo"
        name="logo"
        label="Dark logo URL"
        placeholder="https://..."
        class="w-full"
      />
      <div v-if="props.enableMediaPicker && props.siteId" class="space-y-2">
        <label class="text-sm font-medium text-foreground flex items-center justify-between">
          Light logo
          <edge-shad-button
            type="button"
            variant="link"
            class="px-0 h-auto text-sm"
            @click="state.logoLightPickerOpen = !state.logoLightPickerOpen"
          >
            {{ state.logoLightPickerOpen ? 'Hide picker' : 'Select logo' }}
          </edge-shad-button>
        </label>
        <div class="flex items-center gap-4">
          <div v-if="props.settings.logoLight" class="flex items-center gap-3">
            <img :src="props.settings.logoLight" alt="Light logo preview" class="h-16 w-auto rounded-md border border-border bg-muted object-contain">
            <edge-shad-button
              type="button"
              variant="ghost"
              class="h-8"
              @click="props.settings.logoLight = ''"
            >
              Remove
            </edge-shad-button>
          </div>
          <span v-else class="text-sm text-muted-foreground italic">No light logo selected</span>
        </div>
        <div v-if="state.logoLightPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
          <edge-cms-media-manager
            :site="props.siteId"
            :select-mode="true"
            :default-tags="['Logos']"
            @select="(url) => {
              props.settings.logoLight = url
              state.logoLightPickerOpen = false
            }"
          />
        </div>
      </div>
      <edge-shad-input
        v-else
        v-model="props.settings.logoLight"
        name="logoLight"
        label="Light logo URL"
        placeholder="https://..."
        class="w-full"
      />
      <div v-if="props.isAdmin" class="space-y-4 border border-dashed rounded-lg p-4">
        <div class="text-sm font-semibold text-foreground">
          Umbrella Brand
        </div>
        <div v-if="props.enableMediaPicker && props.siteId" class="space-y-2">
          <label class="text-sm font-medium text-foreground flex items-center justify-between">
            Dark brand logo
            <edge-shad-button
              type="button"
              variant="link"
              class="px-0 h-auto text-sm"
              @click="state.brandLogoDarkPickerOpen = !state.brandLogoDarkPickerOpen"
            >
              {{ state.brandLogoDarkPickerOpen ? 'Hide picker' : 'Select logo' }}
            </edge-shad-button>
          </label>
          <div class="flex items-center gap-4">
            <div v-if="props.settings.brandLogoDark" class="flex items-center gap-3">
              <img :src="props.settings.brandLogoDark" alt="Brand dark logo preview" class="h-16 w-auto rounded-md border border-border bg-muted object-contain">
              <edge-shad-button
                type="button"
                variant="ghost"
                class="h-8"
                @click="props.settings.brandLogoDark = ''"
              >
                Remove
              </edge-shad-button>
            </div>
            <span v-else class="text-sm text-muted-foreground italic">No brand dark logo selected</span>
          </div>
          <div v-if="state.brandLogoDarkPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
            <edge-cms-media-manager
              :site="props.siteId"
              :select-mode="true"
              :default-tags="['Logos']"
              @select="(url) => {
                props.settings.brandLogoDark = url
                state.brandLogoDarkPickerOpen = false
              }"
            />
          </div>
        </div>
        <edge-shad-input
          v-else
          v-model="props.settings.brandLogoDark"
          name="brandLogoDark"
          label="Dark brand logo URL"
          placeholder="https://..."
          class="w-full"
        />
        <div v-if="props.enableMediaPicker && props.siteId" class="space-y-2">
          <label class="text-sm font-medium text-foreground flex items-center justify-between">
            Light brand logo
            <edge-shad-button
              type="button"
              variant="link"
              class="px-0 h-auto text-sm"
              @click="state.brandLogoLightPickerOpen = !state.brandLogoLightPickerOpen"
            >
              {{ state.brandLogoLightPickerOpen ? 'Hide picker' : 'Select logo' }}
            </edge-shad-button>
          </label>
          <div class="flex items-center gap-4">
            <div v-if="props.settings.brandLogoLight" class="flex items-center gap-3">
              <img :src="props.settings.brandLogoLight" alt="Brand light logo preview" class="h-16 w-auto rounded-md border border-border bg-muted object-contain">
              <edge-shad-button
                type="button"
                variant="ghost"
                class="h-8"
                @click="props.settings.brandLogoLight = ''"
              >
                Remove
              </edge-shad-button>
            </div>
            <span v-else class="text-sm text-muted-foreground italic">No brand light logo selected</span>
          </div>
          <div v-if="state.brandLogoLightPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
            <edge-cms-media-manager
              :site="props.siteId"
              :select-mode="true"
              :default-tags="['Logos']"
              @select="(url) => {
                props.settings.brandLogoLight = url
                state.brandLogoLightPickerOpen = false
              }"
            />
          </div>
        </div>
        <edge-shad-input
          v-else
          v-model="props.settings.brandLogoLight"
          name="brandLogoLight"
          label="Light brand logo URL"
          placeholder="https://..."
          class="w-full"
        />
      </div>
      <div v-if="props.enableMediaPicker && props.siteId" class="space-y-2">
        <label class="text-sm font-medium text-foreground flex items-center justify-between">
          Favicon
          <edge-shad-button
            type="button"
            variant="link"
            class="px-0 h-auto text-sm"
            @click="state.faviconPickerOpen = !state.faviconPickerOpen"
          >
            {{ state.faviconPickerOpen ? 'Hide picker' : 'Select favicon' }}
          </edge-shad-button>
        </label>
        <div class="flex items-center gap-4">
          <div v-if="props.settings.favicon" class="flex items-center gap-3">
            <img :src="props.settings.favicon" alt="Favicon preview" class="h-12 w-12 rounded-md border border-border bg-muted object-contain">
            <edge-shad-button
              type="button"
              variant="ghost"
              class="h-8"
              @click="props.settings.favicon = ''"
            >
              Remove
            </edge-shad-button>
          </div>
          <span v-else class="text-sm text-muted-foreground italic">No favicon selected</span>
        </div>
        <div v-if="state.faviconPickerOpen" class="mt-2 border border-dashed rounded-lg p-2">
          <edge-cms-media-manager
            :site="props.siteId"
            :select-mode="true"
            :default-tags="['Logos']"
            @select="(url) => {
              props.settings.favicon = url
              state.faviconPickerOpen = false
            }"
          />
        </div>
      </div>
      <edge-shad-input
        v-else
        v-model="props.settings.favicon"
        name="favicon"
        label="Favicon URL"
        placeholder="https://..."
        class="w-full"
      />
    </TabsContent>
    <TabsContent value="seo" class="pt-4">
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Default settings if the information is not entered on the page.
        </p>
        <edge-shad-input
          v-model="props.settings.metaTitle"
          label="Meta Title"
          name="metaTitle"
        />
        <edge-shad-textarea
          v-model="props.settings.metaDescription"
          label="Meta Description"
          name="metaDescription"
        />
        <edge-cms-code-editor
          v-model="props.settings.structuredData"
          title="Structured Data (JSON-LD)"
          language="json"
          name="structuredData"
          height="300px"
          class="mb-4 w-full"
        />
      </div>
    </TabsContent>
    <TabsContent value="tracking" class="pt-4">
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Add tracking IDs for this site.
        </p>
        <edge-shad-input
          v-model="props.settings.trackingFacebookPixel"
          label="Facebook Pixel ID"
          name="trackingFacebookPixel"
          placeholder="123456789012345"
        />
        <edge-shad-input
          v-model="props.settings.trackingGoogleAnalytics"
          label="Google Analytics ID"
          name="trackingGoogleAnalytics"
          placeholder="G-XXXXXXX"
        />
        <edge-shad-input
          v-model="props.settings.trackingAdroll"
          label="AdRoll ID"
          name="trackingAdroll"
          placeholder="ADROLL-ID"
        />
      </div>
    </TabsContent>
    <TabsContent value="social" class="pt-4">
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Add social media links for this site.
        </p>
        <edge-shad-input
          v-model="props.settings.socialFacebook"
          label="Facebook URL"
          name="socialFacebook"
          placeholder="https://facebook.com/yourpage"
        />
        <edge-shad-input
          v-model="props.settings.socialInstagram"
          label="Instagram URL"
          name="socialInstagram"
          placeholder="https://instagram.com/yourhandle"
        />
        <edge-shad-input
          v-model="props.settings.socialTwitter"
          label="X (Twitter) URL"
          name="socialTwitter"
          placeholder="https://x.com/yourhandle"
        />
        <edge-shad-input
          v-model="props.settings.socialLinkedIn"
          label="LinkedIn URL"
          name="socialLinkedIn"
          placeholder="https://linkedin.com/company/yourcompany"
        />
        <edge-shad-input
          v-model="props.settings.socialYouTube"
          label="YouTube URL"
          name="socialYouTube"
          placeholder="https://youtube.com/@yourchannel"
        />
        <edge-shad-input
          v-model="props.settings.socialTikTok"
          label="TikTok URL"
          name="socialTikTok"
          placeholder="https://tiktok.com/@yourhandle"
        />
      </div>
    </TabsContent>
  </Tabs>
</template>
