<script setup>
import { Globe, Link2, Loader2, Plus, RefreshCw, Search } from 'lucide-vue-next'

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  domainInput: '',
  attachDomain: '',
  attachSiteId: '',
  loading: false,
  checking: false,
  registering: false,
  attaching: false,
  checkResult: null,
  registeredDomains: [],
  domainRegistry: [],
  sites: [],
  message: '',
  messageType: '',
})

const currentOrgId = computed(() => String(edgeGlobal?.edgeState?.currentOrganization || '').trim())
const currentUid = computed(() => String(edgeFirebase?.user?.uid || '').trim())
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)

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

const refreshData = async ({ syncFromRegistry = false } = {}) => {
  if (!currentOrgId.value || !isAdmin.value)
    return
  if (!currentUid.value)
    return
  state.loading = true
  clearMessage()
  try {
    if (syncFromRegistry) {
      await edgeFirebase.runFunction('cms-registrarSyncRegisteredFromRegistry', {
        uid: currentUid.value,
        orgId: currentOrgId.value,
      })
    }

    const response = await edgeFirebase.runFunction('cms-registrarListOrgDomains', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
    })
    state.registeredDomains = Array.isArray(response?.data?.registeredDomains) ? response.data.registeredDomains : []
    state.domainRegistry = Array.isArray(response?.data?.domainRegistry) ? response.data.domainRegistry : []
    state.sites = Array.isArray(response?.data?.sites) ? response.data.sites : []
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to load domain registrar data.'), 'error')
  }
  finally {
    state.loading = false
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
    state.attachDomain = domain
    setMessage(`"${domain}" registration request submitted.`, 'success')
    await refreshData()
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to register domain.'), 'error')
  }
  finally {
    state.registering = false
  }
}

const attachDomainToSite = async () => {
  const domain = normalizeDomain(state.attachDomain)
  const siteId = String(state.attachSiteId || '').trim()
  if (!domain || !siteId) {
    setMessage('Select both a domain and a site before attaching.', 'error')
    return
  }

  state.attaching = true
  clearMessage()
  try {
    const response = await edgeFirebase.runFunction('cms-registrarAttachDomainToSite', {
      uid: currentUid.value,
      orgId: currentOrgId.value,
      siteId,
      domain,
    })
    const publishedMissing = response?.data?.publishedMissing === true
    setMessage(
      publishedMissing
        ? 'Domain attached to draft site. This site has not been published yet, so no published settings were updated.'
        : 'Domain attached to draft and published site settings.',
      'success',
    )
    await refreshData()
  }
  catch (error) {
    setMessage(parseFunctionError(error, 'Unable to attach domain to site.'), 'error')
  }
  finally {
    state.attaching = false
  }
}

const syncFromRegistry = async () => {
  await refreshData({ syncFromRegistry: true })
}

const siteOptions = computed(() => {
  return (Array.isArray(state.sites) ? state.sites : []).map(site => ({
    title: site?.name || site?.docId || '',
    value: site?.docId || '',
  }))
})

const registeredRows = computed(() => {
  const registryByDomain = new Map()
  for (const item of state.domainRegistry) {
    const domain = normalizeDomain(item?.domain)
    if (domain)
      registryByDomain.set(domain, item)
  }

  return (Array.isArray(state.registeredDomains) ? state.registeredDomains : []).map((item) => {
    const domain = normalizeDomain(item?.domain)
    const registry = registryByDomain.get(domain) || {}
    return {
      domain,
      status: String(item?.status || '').trim() || 'active',
      attachedSiteId: String(item?.attachedSiteId || registry?.siteId || '').trim(),
      attachedSiteName: String(item?.attachedSiteName || registry?.siteName || '').trim(),
    }
  })
})

const domainOptions = computed(() => {
  return registeredRows.value.map(item => ({
    title: item.domain,
    value: item.domain,
  }))
})

onMounted(async () => {
  await refreshData({ syncFromRegistry: true })
})

watch(currentOrgId, async (nextOrgId, previousOrgId) => {
  if (!nextOrgId || nextOrgId === previousOrgId)
    return
  await refreshData({ syncFromRegistry: true })
})

watch(currentUid, async (nextUid, previousUid) => {
  if (!nextUid || nextUid === previousUid)
    return
  await refreshData({ syncFromRegistry: true })
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
        class="bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
        :disabled="state.loading || state.checking || state.registering || state.attaching"
        @click="syncFromRegistry"
      >
        <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" />
        <RefreshCw v-else class="mr-2 h-4 w-4" />
        Sync
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
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-lg border bg-card p-4 space-y-3">
          <h3 class="font-semibold">
            Check and Register
          </h3>
          <edge-shad-input
            v-model="state.domainInput"
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

        <div class="rounded-lg border bg-card p-4 space-y-3">
          <h3 class="font-semibold">
            Attach Domain to Site
          </h3>
          <edge-shad-select
            v-model="state.attachDomain"
            label="Domain"
            placeholder="Select a registered domain"
            :items="domainOptions"
            item-title="title"
            item-value="value"
          />
          <edge-shad-select
            v-model="state.attachSiteId"
            label="Site"
            placeholder="Select a site"
            :items="siteOptions"
            item-title="title"
            item-value="value"
          />
          <edge-shad-button
            class="bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            :disabled="state.attaching"
            @click="attachDomainToSite"
          >
            <Loader2 v-if="state.attaching" class="mr-2 h-4 w-4 animate-spin" />
            <Link2 v-else class="mr-2 h-4 w-4" />
            Attach
          </edge-shad-button>
        </div>
      </div>

      <div class="rounded-lg border bg-card p-4 space-y-2">
        <h3 class="font-semibold">
          Registered Domains ({{ registeredRows.length }})
        </h3>
        <div v-if="state.loading" class="text-sm text-muted-foreground">
          Loading...
        </div>
        <div v-else-if="registeredRows.length === 0" class="text-sm text-muted-foreground">
          No registered domains found for this org.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="item in registeredRows"
            :key="item.domain"
            class="rounded-md border p-3 text-sm flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
          >
            <div class="font-medium">
              {{ item.domain }}
            </div>
            <div class="text-muted-foreground">
              Status: {{ item.status }}
            </div>
            <div class="text-muted-foreground">
              Attached: {{ item.attachedSiteName || item.attachedSiteId || 'Not attached' }}
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-lg border bg-card p-4 space-y-2">
        <h3 class="font-semibold">
          Domain Registry ({{ state.domainRegistry.length }})
        </h3>
        <div v-if="state.loading" class="text-sm text-muted-foreground">
          Loading...
        </div>
        <div v-else-if="state.domainRegistry.length === 0" class="text-sm text-muted-foreground">
          No domain-registry records found for this org.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="item in state.domainRegistry"
            :key="item.docId"
            class="rounded-md border p-3 text-sm flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
          >
            <div class="font-medium">
              {{ item.domain }}
            </div>
            <div class="text-muted-foreground">
              Site: {{ item.siteName || item.siteId || 'Unassigned' }}
            </div>
            <div class="text-muted-foreground">
              Auth: {{ item.authEnabled ? 'Enabled' : 'Disabled' }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
