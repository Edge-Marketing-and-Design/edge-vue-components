<script setup>
import { Copy, KeyRound, Loader2, RefreshCw } from 'lucide-vue-next'
import {
  AGENT_KEY_LIFETIMES,
  agentKeyStatus,
  agentOperationEndpoint,
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
} from '../../lib/cmsAgentKeyClient'

// Agent keys let an agent (the MCP) run the draft-only CMS operations as
// you, in this organization. They never publish or release. The key is
// shown once, when it is created.
const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  loading: false,
  error: '',
  keys: [],
  isAdmin: false,
  name: '',
  days: '30',
  creating: false,
  created: null,
  copied: false,
  revokingId: '',
  confirmRevoke: null,
})

const orgId = computed(() => edgeGlobal.edgeState.currentOrganization)
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || ''
const functionsRegion = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'
const lifetimeItems = AGENT_KEY_LIFETIMES.map(days => ({ name: String(days), title: `${days} days` }))
const STATUS_LABELS = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }
const formatDate = value => (value ? new Date(value).toLocaleString() : '—')
const errorMessage = error => String(error?.message || error || 'Something went wrong.')

const load = async () => {
  state.loading = true
  state.error = ''
  try {
    const result = await listAgentKeys({ edgeFirebase, orgId: orgId.value })
    state.keys = result.keys || []
    state.isAdmin = result.isAdmin === true
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.loading = false
  }
}

const create = async () => {
  if (state.creating || !state.name.trim())
    return
  state.creating = true
  state.error = ''
  try {
    state.created = await createAgentKey({ edgeFirebase, orgId: orgId.value, name: state.name.trim(), expiresInDays: Number(state.days) })
    state.copied = false
    state.name = ''
    await load()
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.creating = false
  }
}

const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(state.created?.token || '')
    state.copied = true
  }
  catch {
    state.copied = false
  }
}

const revoke = async () => {
  const key = state.confirmRevoke
  if (!key)
    return
  state.revokingId = key.keyId
  state.error = ''
  try {
    await revokeAgentKey({ edgeFirebase, orgId: orgId.value, keyId: key.keyId })
    state.confirmRevoke = null
    await load()
  }
  catch (error) {
    state.error = errorMessage(error)
  }
  finally {
    state.revokingId = ''
  }
}

const createdOpen = computed({
  get: () => !!state.created,
  set: (value) => {
    if (!value)
      state.created = null
  },
})
const revokeOpen = computed({
  get: () => !!state.confirmRevoke,
  set: (value) => {
    if (!value)
      state.confirmRevoke = null
  },
})

watch(orgId, (value) => {
  state.created = null
  state.confirmRevoke = null
  if (value)
    load()
}, { immediate: true })
</script>

<template>
  <div class="space-y-4 p-4 md:p-6">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <KeyRound class="h-5 w-5" aria-hidden="true" />
        <h2 class="text-xl font-semibold">
          Agent Keys
        </h2>
      </div>
      <edge-shad-button variant="outline" class="gap-2" :disabled="state.loading" @click="load">
        <Loader2 v-if="state.loading" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" />
        Refresh
      </edge-shad-button>
    </div>

    <edge-cms-agent-connections />

    <h3 class="text-lg font-semibold">
      Organization keys
    </h3>
    <p class="max-w-3xl text-sm text-muted-foreground">
      An agent key lets an agent, such as the Firebase MCP, build in this organization as you: create themes, draft pages,
      place blocks, fill in content and save block drafts. It can never publish a page or release a block. Each key works in
      one organization only, expires, and can be revoked at any time.
    </p>

    <div v-if="state.error" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ state.error }}
    </div>

    <form class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4" @submit.prevent="create">
      <div class="min-w-[16rem] flex-1">
        <edge-shad-input v-model="state.name" name="agentKeyName" label="Key name" placeholder="For example: MacBook MCP" />
      </div>
      <div class="w-40">
        <edge-shad-select v-model="state.days" name="agentKeyDays" label="Expires after" :items="lifetimeItems" />
      </div>
      <edge-shad-button type="submit" class="gap-2" :disabled="state.creating || !state.name.trim()">
        <Loader2 v-if="state.creating" class="h-4 w-4 animate-spin" />
        Create key
      </edge-shad-button>
    </form>

    <div class="rounded-lg border bg-card">
      <div v-if="state.loading && !state.keys.length" class="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" /> Loading keys…
      </div>
      <p v-else-if="!state.keys.length" class="p-4 text-sm text-muted-foreground">
        No agent keys yet.
      </p>
      <table v-else class="w-full text-left text-sm">
        <caption class="sr-only">
          Agent keys{{ state.isAdmin ? ' in this organization' : ' you created' }}
        </caption>
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="p-2">
              Name
            </th>
            <th class="p-2">
              Status
            </th>
            <th class="p-2">
              Created
            </th>
            <th class="p-2">
              Expires
            </th>
            <th class="p-2">
              Last used
            </th>
            <th class="p-2">
              Uses
            </th>
            <th class="p-2">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in state.keys" :key="key.keyId" class="border-t">
            <td class="p-2">
              <span class="font-medium">{{ key.name }}</span>
              <span class="block text-xs text-muted-foreground">…{{ key.hint }}<template v-if="state.isAdmin && key.createdBy"> · {{ key.createdBy }}</template></span>
            </td>
            <td class="p-2">
              {{ STATUS_LABELS[agentKeyStatus(key)] }}
            </td>
            <td class="p-2">
              {{ formatDate(key.createdAt) }}
            </td>
            <td class="p-2">
              {{ formatDate(key.expiresAt) }}
            </td>
            <td class="p-2">
              {{ formatDate(key.lastUsedAt) }}
            </td>
            <td class="p-2">
              {{ key.useCount }}
            </td>
            <td class="p-2 text-right">
              <edge-shad-button
                v-if="agentKeyStatus(key) === 'active'"
                type="button"
                size="sm"
                variant="outline"
                :disabled="state.revokingId === key.keyId"
                @click="state.confirmRevoke = key"
              >
                Revoke
              </edge-shad-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <edge-shad-dialog v-model="createdOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Copy your agent key now
          </DialogTitle>
          <DialogDescription class="space-y-2 text-left">
            <p>This is the only time the key is shown. Store it where the agent can read it, and don't share it.</p>
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3 text-sm">
          <div class="flex items-center gap-2">
            <code class="flex-1 break-all rounded border bg-muted px-2 py-1 text-xs" data-testid="agent-key-token">{{ state.created?.token }}</code>
            <edge-shad-button type="button" size="sm" variant="outline" class="gap-2" @click="copyToken">
              <Copy class="h-4 w-4" /> {{ state.copied ? 'Copied' : 'Copy' }}
            </edge-shad-button>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt class="text-muted-foreground">
              Organization
            </dt>
            <dd><code>{{ orgId }}</code></dd>
            <dt v-if="projectId" class="text-muted-foreground">
              Endpoint
            </dt>
            <dd v-if="projectId">
              <code class="break-all">{{ agentOperationEndpoint(projectId, functionsRegion) }}</code>
            </dd>
            <dt class="text-muted-foreground">
              Expires
            </dt>
            <dd>{{ formatDate(state.created?.expiresAt) }}</dd>
          </dl>
        </div>
        <DialogFooter class="pt-2">
          <edge-shad-button type="button" @click="state.created = null">
            I've stored it
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="revokeOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Revoke "{{ state.confirmRevoke?.name }}"?
          </DialogTitle>
          <DialogDescription class="text-left">
            Agents using this key stop working at once. Changes they already made stay as drafts.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button type="button" variant="outline" autofocus @click="state.confirmRevoke = null">
            Cancel
          </edge-shad-button>
          <edge-shad-button type="button" variant="destructive" :disabled="!!state.revokingId" @click="revoke">
            <Loader2 v-if="state.revokingId" class="mr-2 h-4 w-4 animate-spin" />
            Revoke key
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
