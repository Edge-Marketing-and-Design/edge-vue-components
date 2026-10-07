<script setup>
import { Copy, Loader2, RefreshCw } from 'lucide-vue-next'
import { AGENT_KEY_LIFETIMES, agentKeyStatus, createAgentConnection, listAgentConnections, renewAgentConnection, revokeAgentConnection } from '../../lib/cmsAgentKeyClient'

const edgeFirebase = inject('edgeFirebase')
const formRef = ref(null)
const state = reactive({ connections: [], loading: false, busy: false, error: '', name: '', days: '30', created: null, copied: false, selected: null, action: '' })
const orgId = computed(() => edgeGlobal.edgeState.currentOrganization)
const uid = computed(() => edgeFirebase.user?.uid)
const lifetimeItems = AGENT_KEY_LIFETIMES.map(days => ({ name: String(days), title: `${days} days` }))
const labels = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }
const formatDate = value => value ? new Date(value).toLocaleString() : '—'
const load = async () => {
  const caller = uid.value
  state.loading = true
  state.error = ''
  try {
    const result = await listAgentConnections({ edgeFirebase })
    if (uid.value === caller)
      state.connections = result.connections || []
  }
  catch (error) {
    state.error = String(error?.message || 'Could not load connections.')
  }
  finally {
    state.loading = false
  }
}
const create = async () => {
  if (state.busy || !state.name.trim())
    return
  const caller = uid.value
  state.busy = true
  state.error = ''
  try {
    const created = await createAgentConnection({ edgeFirebase, orgId: orgId.value, name: state.name.trim(), expiresInDays: Number(state.days) })
    if (uid.value !== caller)
      return
    state.created = created
    state.copied = false
    state.name = ''
    formRef.value?.setFieldValue('agentConnectionName', '')
    await load()
  }
  catch (error) {
    state.error = String(error?.message || 'Could not create connection.')
  }
  finally {
    state.busy = false
  }
}
const copy = async () => {
  try {
    await navigator.clipboard.writeText(state.created.token)
    state.copied = true
  }
  catch {
    state.error = 'Copy failed. Store the displayed credential securely.'
  }
}
const manage = async () => {
  if (state.busy || !state.selected)
    return
  state.busy = true
  state.error = ''
  try {
    const connectionId = state.selected.connectionId
    if (state.action === 'renew')
      await renewAgentConnection({ edgeFirebase, orgId: orgId.value, connectionId, expiresInDays: Number(state.days) })
    else
      await revokeAgentConnection({ edgeFirebase, connectionId })
    state.selected = null
    await load()
  }
  catch (error) {
    state.error = String(error?.message || 'Could not update connection.')
  }
  finally {
    state.busy = false
  }
}
const createdOpen = computed({
  get: () => !!state.created,
  set: (value) => {
    if (!value)
      state.created = null
  },
})
const manageOpen = computed({
  get: () => !!state.selected,
  set: (value) => {
    if (!value && !state.busy)
      state.selected = null
  },
})
watch(uid, (value) => {
  state.created = null
  state.selected = null
  state.connections = []
  if (value)
    load()
}, { immediate: true })
</script>

<template>
  <section class="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="agent-connections-title">
    <div class="flex items-center justify-between gap-3">
      <h3 id="agent-connections-title" class="text-lg font-semibold">
        Hub connections
      </h3>
      <edge-shad-button variant="outline" class="gap-2" :disabled="state.loading || state.busy" @click="load">
        <Loader2 v-if="state.loading" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" /> Refresh
      </edge-shad-button>
    </div>
    <p class="max-w-3xl text-sm text-muted-foreground">
      Connect each person and device once. The agent can discover organizations you currently have CMS edit access to,
      including new organizations. Each job selects an organization and site and gets a short-lived credential for that
      target. Renew here without changing the installed credential. Revoking a connection stops its sessions.
      Connections can edit drafts; they cannot publish pages or release blocks.
    </p>
    <div v-if="state.error" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ state.error }}
    </div>
    <edge-shad-form ref="formRef" class="flex flex-wrap items-end gap-3" @submit="create">
      <div class="min-w-[16rem] flex-1">
        <edge-shad-input v-model="state.name" name="agentConnectionName" label="Person / device" placeholder="For example: Dustin’s MacBook" />
      </div>
      <div class="w-40">
        <edge-shad-select v-model="state.days" name="agentConnectionDays" label="Connection lifetime" :items="lifetimeItems" />
      </div>
      <edge-shad-button type="submit" class="gap-2" :disabled="state.busy || !state.name.trim()">
        <Loader2 v-if="state.busy" class="h-4 w-4 animate-spin" /> Create connection
      </edge-shad-button>
    </edge-shad-form>
    <p v-if="!state.loading && !state.connections.length" class="text-sm text-muted-foreground">
      No connections yet.
    </p>
    <ul v-else class="space-y-2" aria-label="Agent connections">
      <li v-for="connection in state.connections" :key="connection.connectionId" class="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
        <div class="space-y-1">
          <p class="text-sm font-medium">
            {{ connection.name }} · {{ labels[agentKeyStatus(connection)] }}
          </p>
          <p class="text-xs text-muted-foreground">
            Expires {{ formatDate(connection.expiresAt) }} · Last used {{ formatDate(connection.lastUsedAt) }} · …{{ connection.hint }}
          </p>
          <p v-if="connection.createdBy !== uid" class="text-xs text-muted-foreground">
            Owner {{ connection.createdBy }}
          </p>
        </div>
        <div v-if="!connection.revokedAt" class="flex gap-2">
          <edge-shad-button v-if="connection.createdBy === uid" variant="outline" size="sm" :disabled="state.busy" @click="state.selected = connection; state.action = 'renew'">
            Renew
          </edge-shad-button>
          <edge-shad-button variant="outline" size="sm" :disabled="state.busy" @click="state.selected = connection; state.action = 'revoke'">
            Revoke
          </edge-shad-button>
        </div>
      </li>
    </ul>
    <edge-shad-dialog v-model="createdOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle>Store your connection credential</DialogTitle>
          <DialogDescription>
            This is the only time it is shown. Install it in the connection file configured for this Hub’s MCP, outside the repository. Keep it private. Future renewals happen here in the Hub.
          </DialogDescription>
        </DialogHeader>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded border bg-muted px-2 py-1 text-xs" data-testid="agent-connection-token">{{ state.created?.token }}</code>
          <edge-shad-button size="sm" variant="outline" class="gap-2" @click="copy">
            <Copy class="h-4 w-4" /> {{ state.copied ? 'Copied' : 'Copy' }}
          </edge-shad-button>
        </div>
        <p class="text-sm text-muted-foreground">
          Expires {{ formatDate(state.created?.expiresAt) }}. Access follows your current Hub permissions.
        </p>
        <DialogFooter>
          <edge-shad-button @click="state.created = null">
            I’ve stored it
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="manageOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle>{{ state.action === 'renew' ? 'Renew' : 'Revoke' }} “{{ state.selected?.name }}”?</DialogTitle>
          <DialogDescription>
            {{ state.action === 'renew' ? 'Extend this connection without replacing its installed credential.' : 'Stop this connection and every session it issued. Existing draft content stays.' }}
          </DialogDescription>
        </DialogHeader>
        <edge-shad-select v-if="state.action === 'renew'" v-model="state.days" name="renewConnectionDays" label="Renew for" :items="lifetimeItems" />
        <DialogFooter>
          <edge-shad-button variant="outline" :disabled="state.busy" @click="state.selected = null">
            Cancel
          </edge-shad-button>
          <edge-shad-button :variant="state.action === 'revoke' ? 'destructive' : 'default'" :disabled="state.busy" @click="manage">
            {{ state.action === 'renew' ? 'Renew connection' : 'Revoke connection' }}
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </section>
</template>
