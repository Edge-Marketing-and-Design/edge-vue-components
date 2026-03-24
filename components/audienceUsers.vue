<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { Mail, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-vue-next'
import * as z from 'zod'

const edgeFirebase = inject('edgeFirebase')

const cmsMultiOrg = useState('cmsMultiOrg', () => false)

const currentOrgRoleName = computed(() => {
  return String(edgeGlobal.getRoleName(edgeFirebase?.user?.roles || [], edgeGlobal.edgeState.currentOrganization) || '').trim().toLowerCase()
})

const canManageAudienceUsers = computed(() => {
  if (!cmsMultiOrg.value)
    return currentOrgRoleName.value === 'admin'
  return currentOrgRoleName.value === 'admin' || currentOrgRoleName.value === 'site admin'
})

const state = reactive({
  filter: '',
  statusFilter: 'all',
  selectedDocId: '',
})

const statusOptions = ['all', 'active', 'invited', 'disabled']

const newDocSchema = {
  name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'The name this person will recognize.' }, cols: '12', value: '' },
  email: { bindings: { 'field-type': 'text', 'label': 'Email', 'helper': 'The email address this person will use.' }, cols: '12', value: '' },
  authUid: { bindings: { 'field-type': 'text', 'label': 'Firebase Auth UID', 'helper': 'Optional. Leave this blank unless this person already has an account.' }, cols: '12', value: '' },
  status: { bindings: { 'field-type': 'select', 'label': 'Status', 'items': ['active', 'invited', 'disabled'] }, cols: '6', value: 'active' },
  billingStripeCustomerId: { bindings: { 'field-type': 'text', 'label': 'Stripe Customer ID', 'helper': 'Optional. Use this only if you already have a Stripe customer for this person.' }, cols: '6', value: '' },
  notes: { bindings: { 'field-type': 'textarea', 'label': 'Notes', 'helper': 'Private notes for your team.' }, cols: '12', value: '' },
}

const audienceUserSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
  email: z.string({
    required_error: 'Email is required',
  }).email({ message: 'Enter a valid email address' }),
  status: z.string({
    required_error: 'Status is required',
  }).min(1, { message: 'Status is required' }),
}))

const collectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/audience-users`)
const audienceUsers = computed(() => edgeFirebase.data?.[collectionPath.value] || {})

const filteredAudienceUsers = computed(() => {
  const filter = String(state.filter || '').trim().toLowerCase()
  return Object.values(audienceUsers.value || {})
    .filter((item) => {
      if (!item?.docId)
        return false
      if (state.statusFilter !== 'all' && String(item?.status || 'active') !== state.statusFilter)
        return false
      if (!filter)
        return true
      const haystack = [
        item?.name,
        item?.email,
        item?.authUid,
        item?.billingStripeCustomerId,
        item?.stripeCustomerId,
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return haystack.includes(filter)
    })
    .sort((a, b) => String(a?.name || a?.email || a?.docId || '').localeCompare(String(b?.name || b?.email || b?.docId || '')))
})

const startAudienceUsersSnapshot = async () => {
  if (!canManageAudienceUsers.value)
    return
  if (!edgeFirebase.data?.[collectionPath.value])
    await edgeFirebase.startSnapshot(collectionPath.value)
}

const stopAudienceUsersSnapshot = async () => {
  if (!collectionPath.value)
    return
  try {
    await edgeFirebase.stopSnapshot(collectionPath.value)
  }
  catch {
  }
}

const openNewAudienceUser = () => {
  state.selectedDocId = 'new'
}

const openAudienceUser = (docId) => {
  if (!docId)
    return
  state.selectedDocId = docId
}

const closeAudienceUserEditor = () => {
  state.selectedDocId = ''
}

const deleteAudienceUser = async (docId) => {
  if (!docId)
    return
  await edgeFirebase.removeDoc(collectionPath.value, docId)
  if (state.selectedDocId === docId)
    state.selectedDocId = ''
}

const syncAudienceUserWorkingDoc = (workingDoc) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return
  if (!workingDoc.billingStripeCustomerId && workingDoc.stripeCustomerId)
    workingDoc.billingStripeCustomerId = workingDoc.stripeCustomerId
  if (Object.prototype.hasOwnProperty.call(workingDoc, 'stripeCustomerId'))
    delete workingDoc.stripeCustomerId
}

const statusClass = (status) => {
  const normalized = String(status || 'active').toLowerCase()
  if (normalized === 'disabled')
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
  if (normalized === 'invited')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
}

watch(canManageAudienceUsers, async (allowed) => {
  if (allowed) {
    await startAudienceUsersSnapshot()
    return
  }
  state.selectedDocId = ''
  await stopAudienceUsersSnapshot()
}, { immediate: true })

watch(audienceUsers, (items) => {
  if (state.selectedDocId === 'new' || !state.selectedDocId)
    return
  if (!items?.[state.selectedDocId])
    state.selectedDocId = ''
}, { deep: true })

onBeforeUnmount(async () => {
  await stopAudienceUsersSnapshot()
})
</script>

<template>
  <div class="flex flex-col gap-4 h-[calc(100vh-92px)]">
    <Card v-if="!canManageAudienceUsers" class="border border-border/60 bg-card">
      <CardContent class="py-12 text-center text-sm text-muted-foreground">
        You do not have permission to manage people for this organization.
      </CardContent>
    </Card>

    <template v-else>
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Users class="h-5 w-5" />
            Audience Users
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Add the people who should be able to access restricted content. These people are separate from CMS and admin users.
          </p>
        </div>
        <edge-shad-button class="gap-2 bg-slate-800 text-white hover:bg-slate-700" @click="openNewAudienceUser">
          <UserPlus class="h-4 w-4" />
          Add Audience User
        </edge-shad-button>
      </div>

      <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card class="min-h-0 border border-border/60 bg-card">
          <CardHeader class="space-y-3">
            <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck class="h-4 w-4" />
              Directory
              <span class="text-xs font-normal text-muted-foreground">
                {{ filteredAudienceUsers.length }} users
              </span>
            </div>
            <edge-shad-input
              v-model="state.filter"
              name="audience-user-filter"
              label=""
              placeholder="Search name or email..."
            >
              <template #icon>
                <Search class="h-4 w-4" />
              </template>
            </edge-shad-input>
            <edge-shad-select
              v-model="state.statusFilter"
              name="audience-user-status-filter"
              label="Status"
              :items="statusOptions"
            />
          </CardHeader>
          <CardContent class="min-h-0 overflow-y-auto space-y-2">
            <button
              v-for="item in filteredAudienceUsers"
              :key="item.docId"
              type="button"
              class="w-full rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-muted/60"
              :class="state.selectedDocId === item.docId ? 'border-primary/70 bg-muted/70 shadow-sm' : 'border-border/60 bg-background'"
              @click="openAudienceUser(item.docId)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-foreground">
                    {{ item.name || item.email || item.docId }}
                  </div>
                  <div class="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Mail class="h-3.5 w-3.5 shrink-0" />
                    <span class="truncate">{{ item.email || 'No email added' }}</span>
                  </div>
                  <div v-if="item.authUid" class="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    <ShieldCheck class="h-3.5 w-3.5 shrink-0" />
                    <span class="truncate">{{ item.authUid }}</span>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="rounded-full px-2 py-1 text-[10px] font-semibold uppercase" :class="statusClass(item.status)">
                    {{ item.status || 'active' }}
                  </span>
                  <edge-shad-button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8 text-muted-foreground hover:text-destructive"
                    @click.stop="deleteAudienceUser(item.docId)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </edge-shad-button>
                </div>
              </div>
            </button>

            <div v-if="!filteredAudienceUsers.length" class="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
              No people have been added yet.
            </div>
          </CardContent>
        </Card>

        <Card class="min-h-0 border border-border/60 bg-card">
          <CardContent class="h-full min-h-0 p-0">
            <edge-editor
              v-if="state.selectedDocId"
              collection="audience-users"
              :doc-id="state.selectedDocId"
              :schema="audienceUserSchema"
              :new-doc-schema="newDocSchema"
              :show-footer="false"
              class="h-full border-none bg-transparent px-0 pt-0 shadow-none"
              card-content-class="px-6"
              :save-function-override="closeAudienceUserEditor"
              @working-doc="syncAudienceUserWorkingDoc"
            >
              <template #header-start="slotProps">
                <Users class="mr-2 h-4 w-4" />
                {{ slotProps.title }}
              </template>
              <template #header-end="slotProps">
                <edge-shad-button
                  class="bg-red-700 uppercase h-8 hover:bg-red-500 w-24"
                  @click="slotProps.onCancel"
                >
                  {{ slotProps.unsavedChanges ? 'Cancel' : 'Close' }}
                </edge-shad-button>
                <edge-shad-button
                  type="submit"
                  class="bg-slate-800 uppercase h-8 hover:bg-slate-700 w-24 text-white"
                  :disabled="slotProps.submitting"
                  @click="slotProps.onSubmit()"
                >
                  Save
                </edge-shad-button>
              </template>
            </edge-editor>

            <div v-else class="flex h-full items-center justify-center p-8">
              <div class="max-w-md text-center">
                <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Users class="h-6 w-6" />
                </div>
                <h3 class="text-lg font-semibold text-foreground">
                  Select an audience user
                </h3>
                <p class="mt-2 text-sm text-muted-foreground">
                  Use this area for the people who may need access to restricted content. You can choose what they can access at the site level.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
