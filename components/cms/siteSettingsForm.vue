<script setup lang="js">
import { CircleAlert } from 'lucide-vue-next'

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
  domainError: {
    type: String,
    default: '',
  },
  settingsOpen: {
    type: Boolean,
    default: true,
  },
})

const edgeFirebase = inject('edgeFirebase')

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

const isLightName = (value) => {
  if (!value)
    return false
  return String(value).toLowerCase().includes('light')
}

const previewBackgroundClass = value => (isLightName(value) ? 'bg-neutral-900/90' : 'bg-neutral-100')

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

const domainError = computed(() => String(props.domainError || '').trim())
const serverPagesProject = ref('')
const domainRegistry = ref({})
const loadingDomainRegistry = ref(false)
const hasLoadedDomainRegistry = ref(false)
const pagesProject = computed(() => String(serverPagesProject.value || '').trim())
const pagesDomain = computed(() => (pagesProject.value ? `${pagesProject.value}.pages.dev` : '(CLOUDFLARE_PAGES_PROJECT).pages.dev'))
const forwardApexEnabled = computed({
  get: () => props.settings?.forwardApex !== false,
  set: (value) => {
    props.settings.forwardApex = !!value
  },
})

const normalizeDomain = (value) => {
  if (!value)
    return ''
  let normalized = String(value).trim().toLowerCase()
  if (!normalized)
    return ''
  if (normalized.includes('://')) {
    try {
      normalized = new URL(normalized).host
    }
    catch {
      normalized = normalized.split('://').pop() || normalized
    }
  }
  normalized = normalized.split('/')[0] || ''
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    normalized = normalized.split(':')[0] || ''
  }
  return normalized.replace(/\.+$/g, '')
}

const isIpv4Address = (value) => {
  const parts = String(value || '').split('.')
  if (parts.length !== 4)
    return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part))
      return false
    const num = Number(part)
    return num >= 0 && num <= 255
  })
}

const isIpv6Address = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (!normalized.includes(':'))
    return false
  return /^[0-9a-f:]+$/.test(normalized)
}

const isIpAddress = value => isIpv4Address(value) || isIpv6Address(value)

const shouldDisplayDomainDnsRecords = (domain) => {
  if (!domain)
    return false
  if (domain.includes('localhost'))
    return false
  if (isIpAddress(domain))
    return false
  if (domain.endsWith('.dev'))
    return false
  return true
}

const getCloudflareApexDomain = (domain) => {
  if (!domain)
    return ''
  if (domain.startsWith('www.'))
    return domain.slice(4)
  return domain
}

const getCloudflarePagesDomain = (domain) => {
  if (!domain)
    return ''
  if (domain.startsWith('www.'))
    return domain
  return `www.${domain}`
}

const normalizedDomains = computed(() => {
  const values = Array.isArray(props.settings?.domains) ? props.settings.domains : []
  return Array.from(new Set(values.map(normalizeDomain).filter(Boolean)))
})

const dnsEligibleDomains = computed(() => normalizedDomains.value.filter(shouldDisplayDomainDnsRecords))

const organizationId = computed(() => String(edgeGlobal?.edgeState?.currentOrganization || '').trim())
const shouldShowDomainRegistryLoading = computed(() => {
  if (!normalizedDomains.value.length)
    return false
  return loadingDomainRegistry.value || !hasLoadedDomainRegistry.value
})
const DOMAIN_REGISTRY_POLL_MS = 2500
let domainRegistryPollTimer = null

const buildFallbackDomainEntry = (domain) => {
  const apexDomain = getCloudflareApexDomain(domain)
  const wwwDomain = getCloudflarePagesDomain(apexDomain)
  const target = pagesDomain.value
  const hasTarget = !!String(target || '').trim()
  return {
    domain,
    apexDomain,
    wwwDomain,
    apexAttempted: false,
    apexAdded: false,
    apexError: '',
    dnsGuidance: 'Add the www CNAME record. Apex is unavailable; forward apex to www.',
    dnsRecords: {
      target,
      www: {
        type: 'CNAME',
        name: 'www',
        host: wwwDomain,
        value: target,
        enabled: hasTarget,
      },
      apex: {
        type: 'CNAME',
        name: '@',
        host: apexDomain,
        value: target,
        enabled: false,
      },
    },
  }
}

const domainDnsEntries = computed(() => {
  return dnsEligibleDomains.value.map((domain) => {
    const fallback = buildFallbackDomainEntry(domain)
    const value = domainRegistry.value?.[domain] || {}
    const dnsRecords = {
      ...fallback.dnsRecords,
      ...(value.dnsRecords || {}),
      www: {
        ...fallback.dnsRecords.www,
        ...(value?.dnsRecords?.www || {}),
      },
      apex: {
        ...fallback.dnsRecords.apex,
        ...(value?.dnsRecords?.apex || {}),
      },
    }
    const apexAdded = value?.apexAdded === true
    return {
      ...fallback,
      ...value,
      dnsRecords,
      apexAdded,
      apexAttempted: value?.apexAttempted === true,
      apexError: String(value?.apexError || '').trim(),
      dnsGuidance: String(value?.dnsGuidance || '').trim()
        || (apexAdded ? '' : fallback.dnsGuidance),
    }
  })
})

const fetchDomainRegistry = async (options = {}) => {
  const { background = false } = options
  if (!edgeFirebase?.runFunction)
    return
  const domains = normalizedDomains.value
  if (!background)
    loadingDomainRegistry.value = true
  try {
    const response = await edgeFirebase.runFunction('cms-getCloudflarePagesProject', {
      orgId: organizationId.value,
      siteId: props.siteId || '',
      domains,
    })
    serverPagesProject.value = String(response?.data?.project || '').trim()
    const nextRegistry = response?.data?.domainRegistry
    if (domains.length && nextRegistry && typeof nextRegistry === 'object')
      domainRegistry.value = nextRegistry
    else
      domainRegistry.value = {}
    hasLoadedDomainRegistry.value = true
  }
  catch {
    serverPagesProject.value = ''
    domainRegistry.value = {}
    hasLoadedDomainRegistry.value = true
  }
  finally {
    if (!background)
      loadingDomainRegistry.value = false
  }
}

const stopDomainRegistryPolling = () => {
  if (domainRegistryPollTimer) {
    clearInterval(domainRegistryPollTimer)
    domainRegistryPollTimer = null
  }
}

const startDomainRegistryPolling = () => {
  stopDomainRegistryPolling()
  if (!props.settingsOpen)
    return
  if (!normalizedDomains.value.length)
    return
  domainRegistryPollTimer = setInterval(() => {
    fetchDomainRegistry({ background: true }).catch(() => {})
  }, DOMAIN_REGISTRY_POLL_MS)
}

watch(() => `${props.siteId}:${organizationId.value}:${normalizedDomains.value.join('|')}`, async () => {
  hasLoadedDomainRegistry.value = false
  await fetchDomainRegistry()
  startDomainRegistryPolling()
})

watch(() => props.settingsOpen, async (open) => {
  if (open) {
    hasLoadedDomainRegistry.value = false
    await fetchDomainRegistry()
    startDomainRegistryPolling()
  }
  else {
    stopDomainRegistryPolling()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  stopDomainRegistryPolling()
})

watch(() => props.settings?.forwardApex, (value) => {
  if (value === undefined)
    props.settings.forwardApex = true
}, { immediate: true })
</script>

<template>
  <Tabs class="w-full" default-value="general">
    <TabsList class="w-full mt-3 bg-secondary rounded-sm grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-1">
      <TabsTrigger value="general" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        General
      </TabsTrigger>
      <TabsTrigger value="domains" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        Domains
      </TabsTrigger>
      <TabsTrigger value="appearance" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        Appearance
      </TabsTrigger>
      <TabsTrigger value="branding" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        Branding
      </TabsTrigger>
      <TabsTrigger value="seo" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        SEO
      </TabsTrigger>
      <TabsTrigger value="tracking" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
        Tracking Pixels
      </TabsTrigger>
      <TabsTrigger value="social" class="w-full text-black data-[state=active]:bg-black data-[state=active]:text-white">
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
    <TabsContent value="domains" class="pt-4 space-y-4">
      <edge-shad-tags
        v-model="props.settings.domains"
        name="domains"
        label="Domains"
        placeholder="Add or remove domains"
        class="w-full"
      />
      <div class="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3">
        <edge-shad-switch
          v-model="forwardApexEnabled"
          name="forwardApex"
          label="Forward Apex (non-www) domains to www"
          class="w-full"
        >
          Use a single canonical host (www) to avoid duplicate URLs and consolidate SEO signals.
        </edge-shad-switch>
        <p class="text-xs text-amber-700 dark:text-amber-300">
          Warning: if your DNS provider already redirects www to non-www, this can create a redirect loop.
        </p>
      </div>
      <Alert v-if="domainError" variant="destructive">
        <CircleAlert class="h-4 w-4" />
        <AlertTitle>Domain error</AlertTitle>
        <AlertDescription class="text-sm">
          {{ domainError }}
        </AlertDescription>
      </Alert>
      <div class="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-foreground">
            Domain DNS records
          </div>
          <div class="text-xs text-muted-foreground">
            Target: <span class="font-mono">{{ pagesDomain }}</span>
          </div>
        </div>
        <p class="text-sm text-muted-foreground">
          Records are listed for each domain.
        </p>
        <p v-if="shouldShowDomainRegistryLoading" class="text-xs text-muted-foreground">
          Waiting for latest domain sync results...
        </p>
        <div v-if="!domainDnsEntries.length" class="text-sm text-muted-foreground italic">
          Add at least one valid domain to see DNS records.
        </div>
        <div
          v-for="entry in domainDnsEntries"
          :key="entry.domain"
          class="rounded-md border border-border/50 bg-background/70 p-3 space-y-3"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-semibold text-foreground font-mono">
              {{ entry.domain }}
            </div>
            <div class="text-xs">
              <span
                v-if="entry.apexAdded"
                class="rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1"
              >
                Apex added
              </span>
              <span
                v-else
                class="rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-1"
              >
                Apex not added
              </span>
            </div>
          </div>
          <div class="space-y-2 text-sm">
            <div class="grid grid-cols-[70px_1fr] gap-3">
              <div class="text-muted-foreground">CNAME</div>
              <div class="font-mono">
                {{ entry?.dnsRecords?.www?.name || 'www' }} → {{ entry?.dnsRecords?.www?.value || pagesDomain }}
              </div>
            </div>
            <div class="grid grid-cols-[70px_1fr] gap-3">
              <div class="text-muted-foreground">CNAME</div>
              <div class="font-mono">
                {{ entry?.dnsRecords?.apex?.name || '@' }} → {{ entry?.dnsRecords?.apex?.value || pagesDomain }}
              </div>
            </div>
          </div>
          <p v-if="entry.apexError" class="text-xs text-amber-700 dark:text-amber-300">
            {{ entry.apexError }}
          </p>
          <p v-if="!entry.apexAdded && entry.dnsGuidance" class="text-xs text-muted-foreground">
            {{ entry.dnsGuidance }}
          </p>
        </div>
      </div>
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
            <img
              :src="props.settings.logo"
              alt="Logo preview"
              :class="['max-h-16 max-w-[220px] h-auto w-auto rounded-md border border-border object-contain', previewBackgroundClass(props.settings.logo)]"
            >
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
            <img
              :src="props.settings.logoLight"
              alt="Light logo preview"
              :class="['max-h-16 max-w-[220px] h-auto w-auto rounded-md border border-border object-contain', previewBackgroundClass(props.settings.logoLight)]"
            >
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
              <img
                :src="props.settings.brandLogoDark"
                alt="Brand dark logo preview"
                :class="['max-h-16 max-w-[220px] h-auto w-auto rounded-md border border-border object-contain', previewBackgroundClass(props.settings.brandLogoDark)]"
              >
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
              <img
                :src="props.settings.brandLogoLight"
                alt="Brand light logo preview"
                :class="['max-h-16 max-w-[220px] h-auto w-auto rounded-md border border-border object-contain', previewBackgroundClass(props.settings.brandLogoLight)]"
              >
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
            <img
              :src="props.settings.favicon"
              alt="Favicon preview"
              :class="['max-h-12 max-w-12 h-auto w-auto rounded-md border border-border object-contain', previewBackgroundClass(props.settings.favicon)]"
            >
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
        <div class="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          CMS tokens in double curly braces are replaced on the front end.
          Example: <span v-pre class="font-semibold text-foreground">"{{cms-site}}"</span> for the site URL,
          <span v-pre class="font-semibold text-foreground">"{{cms-url}}"</span> for the page URL, and
          <span v-pre class="font-semibold text-foreground">"{{cms-logo}}"</span> for the logo URL. Keep the tokens intact.
        </div>
        <edge-cms-code-editor
          v-model="props.settings.structuredData"
          title="Structured Data (JSON-LD)"
          language="json"
          name="structuredData"
          validate-json
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
