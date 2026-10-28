<script setup>
import { AlertTriangle, Loader2, PlugZap } from 'lucide-vue-next'
import { agentKeyStatus, decideAgentAuthorization, describeAgentAuthorization, listAgentConnections, revokeAgentConnection } from '../../lib/cmsAgentKeyClient'

// The OAuth consent screen for agent sign-in (cms-agentOAuth redirects here
// with the authorize request), and, opened without a request, the signed-in
// person's own connected agents.
const AUTHORIZE_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope']

const edgeFirebase = inject('edgeFirebase')
const route = useRoute()
const state = reactive({ loading: false, busy: false, error: '', described: null, grants: [], selected: null })
const uid = computed(() => edgeFirebase.user?.uid)
const email = computed(() => edgeFirebase.user?.firebaseUser?.email || edgeFirebase.user?.firebaseUser?.providerData?.[0]?.email || '')
const request = computed(() => Object.fromEntries(AUTHORIZE_PARAMS.filter(name => typeof route.query[name] === 'string').map(name => [name, route.query[name]])))
const consent = computed(() => !!request.value.client_id)
const organizationSummary = computed(() => {
  const names = state.described?.organizations || []
  const count = `${names.length} ${names.length === 1 ? 'organization' : 'organizations'}`
  return names.length ? `${count} (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})` : count
})
const formatDate = value => value ? new Date(value).toLocaleString() : '—'

const describe = async () => {
  state.loading = true
  state.error = ''
  try {
    state.described = await describeAgentAuthorization({ edgeFirebase, request: request.value })
  }
  catch (error) {
    state.error = String(error?.message || 'This sign-in request is not valid.')
  }
  finally {
    state.loading = false
  }
}
const decide = async (allow) => {
  if (state.busy)
    return
  state.busy = true
  state.error = ''
  try {
    const { redirectUrl } = await decideAgentAuthorization({ edgeFirebase, request: request.value, allow })
    window.location.assign(redirectUrl)
  }
  catch (error) {
    state.error = String(error?.message || 'Could not finish the sign-in.')
    state.busy = false
  }
}
const switchAccount = async () => {
  await logOut(edgeFirebase, edgeGlobal)
  window.location.reload()
}

const loadGrants = async () => {
  state.loading = true
  state.error = ''
  try {
    const result = await listAgentConnections({ edgeFirebase })
    state.grants = (result.connections || []).filter(connection => connection.kind === 'oauth' && connection.createdBy === uid.value && agentKeyStatus(connection) === 'active')
  }
  catch (error) {
    state.error = String(error?.message || 'Could not load connected agents.')
  }
  finally {
    state.loading = false
  }
}
const disconnect = async () => {
  if (state.busy || !state.selected)
    return
  state.busy = true
  state.error = ''
  try {
    await revokeAgentConnection({ edgeFirebase, connectionId: state.selected.connectionId })
    state.selected = null
    await loadGrants()
  }
  catch (error) {
    state.error = String(error?.message || 'Could not disconnect.')
  }
  finally {
    state.busy = false
  }
}
const disconnectOpen = computed({
  get: () => !!state.selected,
  set: (value) => {
    if (!value && !state.busy)
      state.selected = null
  },
})

watch([uid, consent], ([value]) => {
  state.described = null
  state.grants = []
  if (!value)
    return
  if (consent.value)
    describe()
  else
    loadGrants()
}, { immediate: true })
</script>

<template>
  <div class="mx-auto w-full max-w-lg p-4 md:p-8">
    <section v-if="consent" class="space-y-5 rounded-lg border bg-card p-6" aria-labelledby="agent-authorize-title">
      <div class="flex items-center gap-3">
        <PlugZap class="h-6 w-6 text-muted-foreground" />
        <h1 id="agent-authorize-title" class="text-xl font-semibold">
          Connect an agent to this Hub
        </h1>
      </div>
      <p class="text-sm text-muted-foreground">
        Signed in as <span class="font-medium text-foreground">{{ email || uid }}</span> ·
        <button type="button" class="underline" @click="switchAccount">
          Use another account
        </button>
      </p>
      <div v-if="state.error" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ state.error }}
      </div>
      <div v-if="state.loading" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" /> Checking the request…
      </div>
      <template v-else-if="state.described">
        <div class="space-y-1">
          <p class="text-3xl font-semibold" data-testid="agent-client-host">
            {{ state.described.client.host }}
          </p>
          <p class="text-sm text-muted-foreground">
            calls itself “{{ state.described.client.name }}” and wants access to CMS content in this Hub.
            You’ll go back to <span class="font-medium text-foreground">{{ state.described.redirectHost }}</span>.
          </p>
        </div>
        <div v-if="state.described.loopback" role="alert" class="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>This hands access to a program on this computer. Only continue if you just started sign-in from {{ state.described.client.name }} on this computer.</span>
        </div>
        <div class="space-y-2 text-sm">
          <p>
            It can read and draft CMS content (blocks, themes, sites, pages and posts) in the organizations you can edit, with your Hub rights:
            <span class="font-medium">{{ organizationSummary }}</span>.
          </p>
          <p>
            It can’t publish pages or posts, release blocks, or change a live theme. Every change is a draft recorded under your name.
          </p>
          <p class="text-muted-foreground">
            It stays connected while you use it ({{ state.described.idleDays }} days without use ends it), for up to {{ state.described.maxDays }} days. Disconnect it any time under Connected agents on this page.
          </p>
        </div>
        <p v-if="!state.described.organizations.length" class="text-sm text-red-700">
          You don’t have CMS edit access in any organization, so there is nothing to connect.
        </p>
        <div class="flex justify-end gap-2">
          <edge-shad-button variant="outline" :disabled="state.busy" @click="decide(false)">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="gap-2" :disabled="state.busy || !state.described.organizations.length" @click="decide(true)">
            <Loader2 v-if="state.busy" class="h-4 w-4 animate-spin" /> Allow
          </edge-shad-button>
        </div>
      </template>
    </section>

    <section v-else class="space-y-4 rounded-lg border bg-card p-6" aria-labelledby="agent-grants-title">
      <h1 id="agent-grants-title" class="text-xl font-semibold">
        Connected agents
      </h1>
      <p class="text-sm text-muted-foreground">
        Apps you signed in to this Hub with, such as Claude. Disconnecting stops them on their next request.
      </p>
      <div v-if="state.error" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ state.error }}
      </div>
      <div v-if="state.loading" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" /> Loading…
      </div>
      <p v-else-if="!state.grants.length" class="text-sm text-muted-foreground">
        No connected agents.
      </p>
      <ul v-else class="space-y-2" aria-label="Connected agents">
        <li v-for="grant in state.grants" :key="grant.connectionId" class="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              {{ grant.name }} · {{ grant.client?.host }}
            </p>
            <p class="text-xs text-muted-foreground">
              Connected {{ formatDate(grant.createdAt) }} · Last used {{ formatDate(grant.lastUsedAt) }} · Ends {{ formatDate(grant.expiresAt) }} without use
            </p>
          </div>
          <edge-shad-button variant="outline" size="sm" :disabled="state.busy" @click="state.selected = grant">
            Disconnect
          </edge-shad-button>
        </li>
      </ul>
      <edge-shad-dialog v-model="disconnectOpen">
        <DialogContent class="pt-8">
          <DialogHeader>
            <DialogTitle>Disconnect “{{ state.selected?.name }}”?</DialogTitle>
            <DialogDescription>
              It stops on its next request. Drafts it made stay. To use it again, sign in from the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <edge-shad-button variant="outline" :disabled="state.busy" @click="state.selected = null">
              Cancel
            </edge-shad-button>
            <edge-shad-button variant="destructive" :disabled="state.busy" @click="disconnect">
              Disconnect
            </edge-shad-button>
          </DialogFooter>
        </DialogContent>
      </edge-shad-dialog>
    </section>
  </div>
</template>
