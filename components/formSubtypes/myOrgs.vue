<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps({
  item: {
    type: Object,
    default: null,
  },
  items: {
    type: Array,
    default: () => [],
  },
  passThroughProps: {
    type: [Number, String, Array, Object, Boolean],
    required: false,
  },
})

const edgeFirebase = inject('edgeFirebase')
const router = useRouter()

const state = reactive({
  workingItem: {},
  dialog: false,
  form: false,
  currentTitle: '',
  saveButton: 'Add Organization',
  helpers: {
    submits: true,
  },
  deleteDialog: false,
  loading: false,
  bringUserIds: [],
})

const edgeUsers = toRef(edgeFirebase.state, 'users')
const users = computed(() => Object.values(edgeUsers.value ?? {}))

const bringUserOptions = computed(() => {
  return users.value.filter(user => user.userId !== edgeFirebase.user.uid)
})

const showBringUsers = computed(() => {
  return state.saveButton === 'Add Organization' && bringUserOptions.value.length > 0
})

const newItem = {
  name: '',
}

const startUsersSnapshot = async () => {
  if (!edgeGlobal.edgeState.currentOrganization)
    return
  await edgeFirebase.startUsersSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}`)
}

const addItem = () => {
  console.log(newItem)
  state.saveButton = 'Add Organization'
  state.workingItem = edgeGlobal.dupObject(newItem)
  state.workingItem.id = edgeGlobal.generateShortId()
  state.currentTitle = 'Add Organization'
  state.bringUserIds = []
  state.dialog = true
}

const joinOrg = () => {
  state.saveButton = 'Join Organization'
  state.workingItem = edgeGlobal.dupObject(newItem)
  state.workingItem.id = edgeGlobal.generateShortId()
  state.currentTitle = 'Join Organization'
  state.dialog = true
}

const deleteConfirm = (item) => {
  state.currentTitle = item.name
  state.workingItem = edgeGlobal.dupObject(item)
  state.deleteDialog = true
}

const deleteAction = async () => {
  await edgeFirebase.removeUser(state.workingItem.docId)
  state.deleteDialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const closeDialog = () => {
  state.dialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const register = reactive({
  registrationCode: props.passThroughProps,
  dynamicDocumentFieldValue: '',
})

const updateBringUserSelection = (docId, checked) => {
  const selections = new Set(state.bringUserIds)
  if (checked) {
    selections.add(docId)
  }
  else {
    selections.delete(docId)
  }
  state.bringUserIds = Array.from(selections)
}

const addUsersToOrganization = async (orgId) => {
  if (!orgId || state.bringUserIds.length === 0)
    return
  const targetUsers = users.value.filter(user => state.bringUserIds.includes(user.docId))
  for (const user of targetUsers) {
    const roleName = edgeGlobal.getRoleName(user.roles, edgeGlobal.edgeState.currentOrganization)
    const resolvedRoleName = roleName === 'Unknown' ? 'User' : roleName
    const orgRoles = edgeGlobal.orgUserRoles(orgId)
    const roleMatch = orgRoles.find(role => role.name === resolvedRoleName)
    if (!roleMatch)
      continue
    for (const role of roleMatch.roles) {
      await edgeFirebase.storeUserRoles(user.docId, role.collectionPath, role.role)
    }
  }
}

const waitForNewOrgRole = async (previousOrgPaths) => {
  const maxAttempts = 30
  const delayMs = 300
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentOrgRoles = edgeFirebase.user.roles.filter(role => role.collectionPath.startsWith('organizations-'))
    const newOrgRole = currentOrgRoles.find(role => !previousOrgPaths.includes(role.collectionPath))
    if (newOrgRole) {
      return newOrgRole
    }
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  return null
}

onBeforeMount(async () => {
  await startUsersSnapshot()
})

watch(() => edgeGlobal.edgeState.currentOrganization, async (nextOrg, prevOrg) => {
  if (nextOrg && nextOrg !== prevOrg) {
    await startUsersSnapshot()
  }
})

const onSubmit = async () => {
  const registerSend = edgeGlobal.dupObject(register)
  state.loading = true
  const existingOrgPaths = edgeFirebase.user.roles
    .filter(role => role.collectionPath.startsWith('organizations-'))
    .map(role => role.collectionPath)
  if (state.saveButton === 'Add Organization') {
    registerSend.dynamicDocumentFieldValue = state.workingItem.name
  }
  else {
    registerSend.dynamicDocumentFieldValue = ''
    registerSend.registrationCode = state.workingItem.name
  }
  const results = await edgeFirebase.currentUserRegister(registerSend)
  await edgeGlobal.getOrganizations(edgeFirebase)
  if (state.saveButton === 'Add Organization') {
    const newOrgRole = await waitForNewOrgRole(existingOrgPaths)
    const newOrgId = newOrgRole?.collectionPath?.replace('organizations-', '')
    if (newOrgId) {
      await addUsersToOrganization(newOrgId)
    }
  }
  console.log(results)
  edgeGlobal.edgeState.changeTracker = {}
  state.dialog = false
  state.loading = false
}

const switchOrganization = async (orgId) => {
  if (!orgId || orgId === edgeGlobal.edgeState.currentOrganization)
    return

  const preLoginRoute = useState('preLoginRoute')
  preLoginRoute.value = '/app'
  await edgeGlobal.setOrganization(orgId, edgeFirebase)
  await router.push('/app/dashboard')
}
const schema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Required',
  }).min(1, { message: 'Required' }),
}))
</script>

<template>
  <edge-shad-button v-if="props.item === null && props.passThroughProps" class="mx-2 h-9 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" @click="addItem()">
    Add Organization
  </edge-shad-button>
  <edge-shad-button v-if="props.item === null" class="mx-2 h-9 border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900" @click="joinOrg()">
    Join Organization
  </edge-shad-button>
  <div v-else class="flex w-full items-center justify-between gap-3 border-b border-slate-200/80 py-3 last:border-b-0 dark:border-slate-700">
    <Avatar class="mr-2 h-8 w-8 border border-slate-200 bg-slate-100 p-0 dark:border-slate-700 dark:bg-slate-800">
      <User width="18" height="18" />
    </Avatar>
    <div class="mr-2 flex min-w-0 items-center gap-2">
      <div class="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
        {{ props.item.name }}
      </div>
      <span
        v-if="edgeGlobal.edgeState.currentOrganization === props.item.docId"
        class="inline-flex h-6 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        Current
      </span>
      <edge-shad-button v-else class="h-8 bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" @click.stop.prevent="switchOrganization(props.item.docId)">
        Switch
      </edge-shad-button>
    </div>
    <div class="flex grow justify-end gap-2">
      <span class="inline-flex h-6 items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {{ edgeGlobal.getRoleName(edgeFirebase.user.roles, props.item.docId) }}
      </span>
    </div>
    <edge-shad-button
      class="mx-2 h-7 border-red-200 bg-red-50 text-xs text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
      variant="outline"
      @click.stop="deleteConfirm(props.item)"
    >
      Leave
    </edge-shad-button>
  </div>

  <edge-shad-dialog v-model="state.deleteDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          Leave Organization
        </DialogTitle>
      </DialogHeader>
      <DialogDescription />
      <h3 v-if="edgeGlobal.getRoleName(edgeFirebase.user.roles, state.workingItem.docId) === 'User'">
        Are you sure you want to leave the organization "{{ state.currentTitle }}"? You will no longer have access to any of the organization's data.
      </h3>
      <h3 v-else>
        As an admin, you cannot leave the organization "{{ state.currentTitle }}" from this screen. Please go to the organization's members page to remove yourself.
      </h3>
      <DialogFooter class="pt-6 flex justify-between">
        <edge-shad-button class="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" variant="outline" @click="state.deleteDialog = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button
          v-if="edgeGlobal.getRoleName(edgeFirebase.user.roles, state.workingItem.docId) === 'User'"
          class="w-full"
          variant="destructive"
          @click="deleteAction()"
        >
          Leave
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.dialog">
    <DialogContent>
      <edge-shad-form :schema="schema" @submit="onSubmit">
        <DialogHeader>
          <DialogTitle>
            {{ state.currentTitle }}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription />
        <edge-g-input
          v-model="state.workingItem.name"
          name="name"
          :disable-tracking="true"
          field-type="text"
          :label="state.saveButton === 'Add Organization' ? 'Name' : 'Registration Code'"
          :parent-tracker-id="`myOrgs-${state.workingItem.id}`"
        />

        <template v-if="state.saveButton === 'Add Organization'">
          Please enter the name of the organization you would like to create.
        </template>
        <template v-else>
          To join an existing organization, please enter the registration code provided by the organization.
        </template>
        <div v-if="showBringUsers" class="mt-4 w-full">
          <div class="text-sm font-medium text-slate-950 dark:text-slate-100">
            Users to bring over (you will be added automatically)
          </div>
          <div class="mt-2 w-full flex flex-wrap gap-2">
            <div v-for="user in bringUserOptions" :key="user.docId" class="flex-1 min-w-[220px]">
              <edge-shad-checkbox
                :name="`bring-user-${user.docId}`"
                :model-value="state.bringUserIds.includes(user.docId)"
                @update:model-value="val => updateBringUserSelection(user.docId, val)"
              >
                {{ user.meta.name }}
              </edge-shad-checkbox>
            </div>
          </div>
        </div>
        <DialogFooter class="pt-6 flex justify-between">
          <edge-shad-button variant="outline" class="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="closeDialog">
            Close
          </edge-shad-button>
          <edge-shad-button
            :disabled="state.loading"
            class="w-100 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            type="submit"
          >
            <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
            {{ state.saveButton }}
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>
</template>

<style lang="scss" scoped>
.pointer {
  cursor: move;
}
</style>
