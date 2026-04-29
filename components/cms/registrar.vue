<script setup>
import { Globe, Link2, Loader2, Pencil, Plus, RefreshCw, Search, Unlink2 } from 'lucide-vue-next'

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  domainInput: '',
  filter: '',
  loading: false,
  syncing: false,
  checking: false,
  registering: false,
  attachingDomains: {},
  detachingDomains: {},
  checkResult: null,
  message: '',
  messageType: '',
  siteDialogOpen: false,
  siteDialogDomain: '',
  siteDialogCurrentSiteName: '',
  siteDialogSelectedSiteId: '',
  detachDialogOpen: false,
  detachDialogDomain: '',
  detachDialogSiteName: '',
})

const currentOrgId = computed(() => String(edgeGlobal?.edgeState?.currentOrganization || '').trim())
const currentUid = computed(() => String(edgeFirebase?.user?.uid || '').trim())
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const showDevOnlyActions = computed(() => edgeGlobal.allowMenuItem({ devOnly: true }, isAdmin.value))
const orgDocPath = computed(() => String(edgeGlobal?.edgeState?.organizationDocPath || '').trim())
const registeredDomainsPath = computed(() => orgDocPath.value ? `${orgDocPath.value}/domains-registered` : '')
const domainRegistryPath = computed(() => orgDocPath.value ? `${orgDocPath.value}/domain-registry` : '')
const sitesPath = computed(() => orgDocPath.value ? `${orgDocPath.value}/sites` : '')
const snapshotPaths = computed(() => [
  registeredDomainsPath.value,
  domainRegistryPath.value,
  sitesPath.value,
].filter(Boolean))
const snapshotContext = computed(() => ({
  isAdmin: isAdmin.value,
  paths: snapshotPaths.value,
}))

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

const isIpAddress = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized)
    return false
  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
  if (ipv4Pattern.test(normalized))
    return true
  const ipv6Pattern = /^[a-fA-F0-9:]+$/
  return normalized.includes(':') && ipv6Pattern.test(normalized)
}

const shouldExcludeDomainFromList = (value) => {
  const normalized = normalizeDomain(value)
  if (!normalized)
    return true
  if (isIpAddress(normalized))
    return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost'))
    return true
  if (normalized.endsWith('.dev'))
    return true
  return false
}

const setMessage = (message, type = 'info') => {
  state.message = String(message || '').trim()
  state.messageType = String(type || 'info').trim()
}

const clearMessage = () => {
  state.message = ''
  state.messageType = ''
}

const parseFunctionError = (error, fallback = 'Request failed.') => {
  const message = String(
    error?.message
    || error?.details?.message
    || error?.details
    || fallback,
  ).trim()
  return message || fallback
}

const snapshotCollectionItems = (path) => {
  const data = edgeFirebase?.data?.[path] || {}
  return Object.values(data)
    .filter(Boolean)
    .map(item => ({ ...item, docId: item.docId || item.id }))
}

const startRegistrarSnapshots = async () => {
  if (!isAdmin.value || !snapshotPaths.value.length)
    return

  state.loading = true
  try {
    const tasks = snapshotPaths.value
      .filter(path => !edgeFirebase.data?.[path])
      .map(path => edgeFirebase.startSnapshot(path))
    const results = tasks.length ? await Promise.allSettled(tasks) : []
    const rejected = results.find(result => result.status === 'rejected')
    if (rejected)
      throw rejected.reason
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to load domain registrar data.'), 'error')
  }
  finally {
    state.loading = false
  }
}

const stopRegistrarSnapshots = async (paths = []) => {
  const tasks = paths
    .filter(Boolean)
    .map(path => edgeFirebase.stopSnapshot(path))
  if (tasks.length)
    await Promise.allSettled(tasks)
}

const syncFromRegistry = async () => {
  if (!currentOrgId.value || !isAdmin.value)
    return
  if (!currentUid.value)
    return

  state.syncing = true
  clearMessage()

  try {
    await edgeFirebase.runFunction('cms-registrarSyncRegisteredFromRegistry', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
    })
    setMessage('Domain registry status refreshed.', 'success')
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to refresh domain registry status.'), 'error')
  }
  finally {
    state.syncing = false
  }
}

const checkDomain = async () => {
  const domain = normalizeDomain(state.domainInput)
  if (!domain) {
    setMessage('Enter a domain to check.', 'error')
    return
  }

  state.checking = true
  clearMessage()
  try {
    const response = await edgeFirebase.runFunction('cms-registrarCheckDomainAvailability', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
      domain,
    })
    state.checkResult = response?.data?.availability || null
    if (state.checkResult?.registrable) {
      setMessage(`"${domain}" is available to register.`, 'success')
    }
    else {
      const reason = state.checkResult?.reason ? ` (${state.checkResult.reason})` : ''
      setMessage(`"${domain}" is not registrable${reason}.`, 'error')
    }
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to check domain availability.'), 'error')
  }
  finally {
    state.checking = false
  }
}

const registerDomain = async () => {
  const domain = normalizeDomain(state.domainInput)
  if (!domain) {
    setMessage('Enter a domain to register.', 'error')
    return
  }

  state.registering = true
  clearMessage()
  try {
    await edgeFirebase.runFunction('cms-registrarRegisterDomain', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
      domain,
    })
    setMessage(`"${domain}" registration request submitted.`, 'success')
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to register domain.'), 'error')
  }
  finally {
    state.registering = false
  }
}

const attachDomainToSite = async ({ domain, siteId }) => {
  const normalizedDomain = normalizeDomain(domain)
  const normalizedSiteId = String(siteId || '').trim()

  if (!currentUid.value) {
    setMessage('You must be signed in to attach domains.', 'error')
    return false
  }
  if (!currentOrgId.value) {
    setMessage('Select an organization before attaching domains.', 'error')
    return false
  }
  if (!normalizedDomain || !normalizedSiteId) {
    setMessage('Select both a domain and a site before attaching.', 'error')
    return false
  }

  state.attachingDomains[normalizedDomain] = true
  clearMessage()
  try {
    const response = await edgeFirebase.runFunction('cms-registrarAttachDomainToSite', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
      siteId: normalizedSiteId,
      domain: normalizedDomain,
    })

    const publishedMissing = response?.data?.publishedMissing === true
    setMessage(
      publishedMissing
        ? 'Domain attached to draft site. This site has not been published yet, so no published settings were updated.'
        : 'Domain attached to draft and published site settings.',
      'success',
    )

    return true
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to attach domain to site.'), 'error')
    return false
  }
  finally {
    state.attachingDomains[normalizedDomain] = false
  }
}

const detachDomainFromSite = async ({ domain }) => {
  const normalizedDomain = normalizeDomain(domain)

  if (!currentUid.value) {
    setMessage('You must be signed in to detach domains.', 'error')
    return false
  }
  if (!currentOrgId.value) {
    setMessage('Select an organization before detaching domains.', 'error')
    return false
  }
  if (!normalizedDomain) {
    setMessage('Select a valid domain to detach.', 'error')
    return false
  }

  state.detachingDomains[normalizedDomain] = true
  clearMessage()
  try {
    const response = await edgeFirebase.runFunction('cms-registrarDetachDomainFromSite', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
      domain: normalizedDomain,
    })

    const detached = response?.data?.detached !== false
    setMessage(
      detached
        ? `"${normalizedDomain}" detached from site settings.`
        : (response?.data?.message || `"${normalizedDomain}" is not attached.`),
      detached ? 'success' : 'info',
    )

    return detached
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to detach domain from site.'), 'error')
    return false
  }
  finally {
    state.detachingDomains[normalizedDomain] = false
  }
}

const registeredDomains = computed(() => snapshotCollectionItems(registeredDomainsPath.value))
const domainRegistry = computed(() => snapshotCollectionItems(domainRegistryPath.value))
const sites = computed(() => snapshotCollectionItems(sitesPath.value))

const siteOptions = computed(() => {
  return sites.value
    .filter((site) => {
      const siteId = String(site?.docId || '').trim().toLowerCase()
      return siteId && siteId !== 'templates'
    })
    .map(site => ({
      title: site?.name || site?.docId || '',
      value: site?.docId || '',
    }))
})

const siteNameById = computed(() => {
  const map = new Map()
  for (const site of sites.value) {
    const siteId = String(site?.docId || '').trim()
    if (!siteId)
      continue
    map.set(siteId, String(site?.name || siteId).trim() || siteId)
  }
  return map
})

const domainRows = computed(() => {
  const rowByDomain = new Map()

  for (const item of registeredDomains.value) {
    const domain = normalizeDomain(item?.domain)
    if (!domain)
      continue
    if (shouldExcludeDomainFromList(domain))
      continue

    rowByDomain.set(domain, {
      domain,
      isRegistered: true,
      hasRegistryDoc: false,
      registrationStatus: String(item?.status || 'active').trim().toLowerCase() || 'active',
      registrationState: String(item?.registrationState || 'registered_org').trim() || 'registered_org',
      registrationReason: '',
      dnsSyncError: '',
      attachedSiteId: '',
      attachedSiteName: '',
      provider: String(item?.provider || 'cloudflare').trim(),
      updatedAt: item?.updatedAt || null,
    })
  }

  for (const item of domainRegistry.value) {
    const domain = normalizeDomain(item?.domain)
    if (!domain)
      continue
    if (shouldExcludeDomainFromList(domain))
      continue

    const siteId = String(item?.siteId || '').trim()
    const siteName = String(item?.siteName || siteNameById.value.get(siteId) || '').trim()
    const existing = rowByDomain.get(domain)

    if (existing) {
      existing.hasRegistryDoc = true
      existing.registrationState = String(existing.registrationState || item?.registrationState || '').trim() || existing.registrationState
      existing.registrationReason = String(existing.registrationReason || item?.registrationReason || '').trim()
      existing.dnsSyncError = String(item?.dnsSyncError || '').trim()
      existing.attachedSiteId = siteId
      existing.attachedSiteName = siteName
      continue
    }

    rowByDomain.set(domain, {
      domain,
      isRegistered: false,
      hasRegistryDoc: true,
      registrationStatus: 'unregistered',
      registrationState: String(item?.registrationState || 'unknown').trim() || 'unknown',
      registrationReason: String(item?.registrationReason || '').trim(),
      dnsSyncError: String(item?.dnsSyncError || '').trim(),
      attachedSiteId: siteId,
      attachedSiteName: siteName,
      provider: '',
      updatedAt: item?.updatedAt || null,
    })
  }

  return Array.from(rowByDomain.values())
    .sort((a, b) => a.domain.localeCompare(b.domain))
})

const filteredDomainRows = computed(() => {
  const term = String(state.filter || '').trim().toLowerCase()
  if (!term)
    return domainRows.value

  return domainRows.value.filter((item) => {
    const haystack = [
      item.domain,
      item.attachedSiteName,
      item.attachedSiteId,
      item.registrationStatus,
      item.isRegistered ? 'registered' : 'not registered',
    ]
      .filter(Boolean)
      .map(value => String(value).toLowerCase())

    return haystack.some(value => value.includes(term))
  })
})

const shownCount = computed(() => filteredDomainRows.value.length)
const totalLoadedCount = computed(() => domainRows.value.length)
const hiddenBySearchCount = computed(() => Math.max(totalLoadedCount.value - shownCount.value, 0))

const isDomainAttaching = domain => Boolean(state.attachingDomains[normalizeDomain(domain)])
const isDomainDetaching = domain => Boolean(state.detachingDomains[normalizeDomain(domain)])
const isDomainBusy = domain => isDomainAttaching(domain) || isDomainDetaching(domain)

const getRegistrationBadgeClass = (item) => {
  if (String(item?.dnsSyncError || '').trim())
    return 'border-red-300 bg-red-50 text-red-700'
  if (item.isRegistered)
    return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (item.registrationState === 'not_registered')
    return 'border-amber-300 bg-amber-50 text-amber-700'
  if (item.registrationState === 'registered_external')
    return 'border-blue-300 bg-blue-50 text-blue-700'
  return 'border-slate-300 bg-slate-50 text-slate-700'
}

const getRegistrationLabel = (item) => {
  const dnsSyncError = String(item?.dnsSyncError || '').trim()
  if (dnsSyncError) {
    if (dnsSyncError.toLowerCase().includes('already has existing records')) {
      return 'DNS Error: already has existing records. Cloudflare admin must remove them.'
    }
    const compactError = dnsSyncError.replaceAll(/\s+/g, ' ').trim()
    const preview = compactError.length > 110 ? `${compactError.slice(0, 107)}...` : compactError
    return `DNS Error: ${preview}`
  }
  if (item.registrationState === 'registered_org')
    return 'Registered in this org'
  if (item.registrationState === 'not_registered')
    return 'Not registered'
  if (item.registrationState === 'registered_external')
    return 'Registered with another registrar'
  if (!item.isRegistered)
    return 'Registration status unknown'
  if (item.registrationStatus === 'active')
    return 'Registered in this org'
  return `Registered in this org (${item.registrationStatus || 'unknown'})`
}

const getAttachmentBadgeClass = item => item.attachedSiteId
  ? 'border-blue-300 bg-blue-50 text-blue-700'
  : 'border-slate-300 bg-slate-50 text-slate-600'

const getAttachmentLabel = (item) => {
  if (!item.attachedSiteId)
    return 'No site assigned'
  return item.attachedSiteName || item.attachedSiteId
}

const openSiteDialog = (item) => {
  const domain = normalizeDomain(item?.domain)
  if (!domain)
    return

  state.siteDialogDomain = domain
  state.siteDialogCurrentSiteName = getAttachmentLabel(item)
  state.siteDialogSelectedSiteId = String(item?.attachedSiteId || '').trim()
  state.siteDialogOpen = true
}

const saveSiteDialog = async () => {
  const domain = normalizeDomain(state.siteDialogDomain)
  const siteId = String(state.siteDialogSelectedSiteId || '').trim()
  if (!domain || !siteId)
    return

  const success = await attachDomainToSite({ domain, siteId })
  if (success)
    state.siteDialogOpen = false
}

const openDetachDialog = (item) => {
  const domain = normalizeDomain(item?.domain)
  if (!domain)
    return

  state.detachDialogDomain = domain
  state.detachDialogSiteName = getAttachmentLabel(item)
  state.detachDialogOpen = true
}

const confirmDetach = async () => {
  const domain = normalizeDomain(state.detachDialogDomain)
  if (!domain)
    return

  const success = await detachDomainFromSite({ domain })
  if (success)
    state.detachDialogOpen = false
}

watch(snapshotContext, async (nextContext, previousContext = {}) => {
  const nextPaths = nextContext.paths || []
  const previousPaths = previousContext.paths || []
  if (!nextContext.isAdmin) {
    await stopRegistrarSnapshots(previousPaths)
    return
  }
  if (!nextPaths.length)
    return
  await stopRegistrarSnapshots(previousPaths.filter(path => !nextPaths.includes(path)))
  await startRegistrarSnapshots()
}, { immediate: true })

onBeforeUnmount(async () => {
  await stopRegistrarSnapshots(snapshotPaths.value)
})
</script>

<template>
  <div class="space-y-4 p-4 md:p-6">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Globe class="h-5 w-5" />
        <h2 class="text-xl font-semibold">
          Domain Registrar
        </h2>
      </div>
      <edge-shad-button
        v-if="showDevOnlyActions"
        variant="outline"
        class="gap-2"
        :disabled="state.loading || state.syncing || state.checking || state.registering"
        @click="syncFromRegistry"
      >
        <Loader2 v-if="state.syncing" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" />
        Sync Registry Status
      </edge-shad-button>
    </div>

    <div
      v-if="state.message"
      class="rounded-md border px-3 py-2 text-sm"
      :class="state.messageType === 'error'
        ? 'border-red-300 bg-red-50 text-red-700'
        : state.messageType === 'success'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-slate-300 bg-slate-50 text-slate-700'"
    >
      {{ state.message }}
    </div>

    <div v-if="!isAdmin" class="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-800">
      Admin access is required for domain registrar tools.
    </div>

    <template v-else>
      <div class="rounded-lg border bg-card p-4 space-y-3">
        <h3 class="font-semibold">
          Check and Register
        </h3>
        <edge-shad-input
          v-model="state.domainInput"
          name="registrar-domain"
          placeholder="example.com"
          label="Domain"
        />
        <div class="flex flex-wrap gap-2">
          <edge-shad-button
            class="bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            :disabled="state.checking || state.registering"
            @click="checkDomain"
          >
            <Loader2 v-if="state.checking" class="mr-2 h-4 w-4 animate-spin" />
            <Search v-else class="mr-2 h-4 w-4" />
            Check
          </edge-shad-button>
          <edge-shad-button
            :disabled="state.registering || state.checking"
            @click="registerDomain"
          >
            <Loader2 v-if="state.registering" class="mr-2 h-4 w-4 animate-spin" />
            <Plus v-else class="mr-2 h-4 w-4" />
            Register
          </edge-shad-button>
        </div>
        <div v-if="state.checkResult" class="rounded-md border p-3 text-sm">
          <div><span class="font-medium">Registrable:</span> {{ state.checkResult.registrable ? 'Yes' : 'No' }}</div>
          <div v-if="state.checkResult.tier">
            <span class="font-medium">Tier:</span> {{ state.checkResult.tier }}
          </div>
          <div v-if="state.checkResult.reason">
            <span class="font-medium">Reason:</span> {{ state.checkResult.reason }}
          </div>
          <div v-if="state.checkResult.pricing?.registration_cost">
            <span class="font-medium">Price:</span>
            {{ state.checkResult.pricing.currency || '' }} {{ state.checkResult.pricing.registration_cost }}
          </div>
        </div>
      </div>

      <div class="rounded-lg border bg-card overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/30 space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
          <div>
            <h3 class="font-semibold">
              Domains ({{ totalLoadedCount }})
            </h3>
            <p class="text-xs text-muted-foreground">
              Registered domains and org-attached domains in one list.
            </p>
          </div>
          <Input
            v-model="state.filter"
            class="h-8 w-full md:w-64"
            placeholder="Filter domains..."
            aria-label="Filter domains"
          />
        </div>

        <div v-if="state.loading" class="px-4 py-6 text-sm text-muted-foreground">
          Loading...
        </div>
        <div v-else-if="filteredDomainRows.length === 0" class="px-4 py-6 text-sm text-muted-foreground">
          No domains found for this org.
        </div>
        <div v-else class="divide-y">
          <div
            v-for="item in filteredDomainRows"
            :key="item.domain"
            class="px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
          >
            <div class="min-w-0 space-y-2">
              <div class="font-medium truncate">
                {{ item.domain }}
              </div>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="rounded-full border px-2 py-0.5" :class="getRegistrationBadgeClass(item)">
                  {{ getRegistrationLabel(item) }}
                </span>
                <span class="rounded-full border px-2 py-0.5" :class="getAttachmentBadgeClass(item)">
                  {{ getAttachmentLabel(item) }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 self-end md:self-center">
              <edge-tooltip>
                <edge-shad-button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  :disabled="isDomainBusy(item.domain)"
                  @click="openSiteDialog(item)"
                >
                  <Pencil v-if="item.attachedSiteId" class="h-4 w-4" />
                  <Plus v-else class="h-4 w-4" />
                </edge-shad-button>
                <template #content>
                  {{ item.attachedSiteId ? `Edit site for ${item.domain}` : `Assign site to ${item.domain}` }}
                </template>
              </edge-tooltip>

              <edge-tooltip>
                <edge-shad-button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8 text-destructive/80 hover:text-destructive"
                  :disabled="!item.attachedSiteId || isDomainBusy(item.domain)"
                  @click="openDetachDialog(item)"
                >
                  <Unlink2 class="h-4 w-4" />
                </edge-shad-button>
                <template #content>
                  {{ `Detach ${item.domain}` }}
                </template>
              </edge-tooltip>
            </div>
          </div>
        </div>

        <div class="border-t bg-muted/20 px-4 py-2">
          <div class="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{{ shownCount }} shown / {{ totalLoadedCount }} loaded</span>
            <span>{{ hiddenBySearchCount }} hidden by search</span>
          </div>
        </div>
      </div>
    </template>

    <edge-shad-dialog v-model="state.siteDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ state.siteDialogCurrentSiteName && state.siteDialogCurrentSiteName !== 'No site assigned' ? 'Edit Site Assignment' : 'Assign Site' }}</DialogTitle>
          <DialogDescription>
            {{ state.siteDialogDomain }}
          </DialogDescription>
        </DialogHeader>

        <edge-shad-select
          v-model="state.siteDialogSelectedSiteId"
          name="registrar-site-dialog"
          label="Site"
          placeholder="Select a site"
          :items="siteOptions"
          item-title="title"
          item-value="value"
        />

        <DialogFooter class="flex justify-between gap-2 pt-2">
          <edge-shad-button variant="outline" @click="state.siteDialogOpen = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            class="gap-2"
            :disabled="!state.siteDialogSelectedSiteId || isDomainAttaching(state.siteDialogDomain)"
            @click="saveSiteDialog"
          >
            <Loader2 v-if="isDomainAttaching(state.siteDialogDomain)" class="h-4 w-4 animate-spin" />
            <Link2 v-else class="h-4 w-4" />
            Save
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.detachDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detach Domain?</DialogTitle>
          <DialogDescription>
            Remove {{ state.detachDialogDomain }} from {{ state.detachDialogSiteName || 'the assigned site' }}.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter class="flex justify-between gap-2 pt-2">
          <edge-shad-button variant="outline" @click="state.detachDialogOpen = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            class="gap-2"
            :disabled="isDomainDetaching(state.detachDialogDomain)"
            @click="confirmDetach"
          >
            <Loader2 v-if="isDomainDetaching(state.detachDialogDomain)" class="h-4 w-4 animate-spin" />
            <Unlink2 v-else class="h-4 w-4" />
            Detach
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
