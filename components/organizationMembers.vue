<script setup>
// TODO: pass possible roles in prop
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  usersCollectionPath: {
    type: String,
    default: () => `organizations/${edgeGlobal.edgeState.currentOrganization}`,
  },
  metaFields: {
    type: Array,
    default: () => [
      {
        field: 'name',
        type: 'text',
        label: 'Name',
        cols: 12,
        value: '',
      },
    ],
  },
  newUserSchema: {
    type: Object,
    default: () =>
      toTypedSchema(
        z.object({
          meta: z.object({
            name: z
              .string({ required_error: 'Name is required' })
              .min(1, { message: 'Name is required' }),
            email: z
              .string({ required_error: 'Email is required' })
              .email({ message: 'Invalid email address' })
              .min(6, { message: 'Email must be at least 6 characters long' })
              .max(50, { message: 'Email must be less than 50 characters long' }),
          }),
          role: z
            .string({ required_error: 'Role is required' })
            .min(1, { message: 'Role is required' }),
        }),
      ),
  },
  updateUserSchema: {
    type: Object,
    default: () =>
      toTypedSchema(
        z.object({
          meta: z.object({
            name: z
              .string({ required_error: 'Name is required' })
              .min(1, { message: 'Name is required' }),
          }),
          role: z
            .string({ required_error: 'Role is required' })
            .min(1, { message: 'Role is required' }),
        }),
      ),
  },
})
// TODO: If a removed user no longer has roles to any organiztions, need to a create new organization for them with
// default name of "Personal". This will allow them to continue to use the app.

// TODO:  Add error/success to join/add organization.
const route = useRoute()
const edgeFirebase = inject('edgeFirebase')
const state = reactive({
  filter: '',
  workingItem: {},
  dialog: false,
  form: false,
  currentTitle: '',
  saveButton: 'Invite User',
  helpers: {
    submits: true,
  },
  deleteDialog: false,
  loading: false,
  newItem: {
    meta: {},
    role: '',
    isTemplate: false,
  },
  inviteOrgIds: [],
  editOrgIds: [],
  removeOrgIds: [],
  loaded: false,
})

const roleNamesOnly = computed(() => {
  return edgeGlobal.edgeState.userRoles.map((role) => {
    return role.name
  })
})

const edgeUsers = toRef(edgeFirebase.state, 'users')
const users = computed(() => Object.values(edgeUsers.value ?? {}))

const orgCollectionPath = orgId => `organizations-${String(orgId).replaceAll('/', '-')}`

const adminOrgOptions = computed(() => {
  const orgs = edgeGlobal.edgeState.organizations || []
  const roles = edgeFirebase?.user?.roles || []
  return orgs.filter(org =>
    roles.some(role => role.collectionPath === orgCollectionPath(org.docId) && role.role === 'admin'),
  )
})

const inviteOrgOptions = computed(() => adminOrgOptions.value)

const editOrgOptions = computed(() => adminOrgOptions.value)

const removeOrgOptions = computed(() => {
  const userRoles = state.workingItem?.roles || []
  return adminOrgOptions.value.filter(org =>
    userRoles.some(role => role.collectionPath.startsWith(orgCollectionPath(org.docId))),
  )
})

const showInviteOrgSelect = computed(() => inviteOrgOptions.value.length > 1)
const showEditOrgSelect = computed(() => editOrgOptions.value.length > 1)
const showRemoveOrgSelect = computed(() => removeOrgOptions.value.length > 1)

const selfRemoveBlocked = computed(() => {
  return state.workingItem.userId === edgeFirebase.user.uid
    && adminCount.value === 1
    && state.removeOrgIds.includes(edgeGlobal.edgeState.currentOrganization)
})

const WIDTHS = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
}

const numColsToTailwind = cols => WIDTHS[cols] || 'md:col-span-12'

// Helpers to read/write nested keys like "profile.firstName" on plain objects
function getByPath(obj, path, fallback = undefined) {
  if (!obj || !path)
    return fallback
  const parts = String(path).split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur))
      return fallback
    cur = cur[p]
  }
  return cur
}

function setByPath(obj, path, value) {
  if (!obj || !path)
    return
  const parts = String(path).split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]
    if (i === parts.length - 1) {
      cur[key] = value
    }
    else {
      if (cur[key] == null || typeof cur[key] !== 'object')
        cur[key] = {}
      cur = cur[key]
    }
  }
}

const sortedFilteredUsers = computed(() => {
  const filter = String(state.filter || '').toLowerCase()

  const getLastName = (fullName) => {
    if (!fullName)
      return ''
    const parts = String(fullName).trim().split(/\s+/)
    return parts[parts.length - 1] || ''
  }

  return users.value
    .filter((user) => {
      const name = String(user?.meta?.name || '')
      return name.toLowerCase().includes(filter)
    })
    .sort((a, b) => {
      const lastA = getLastName(a?.meta?.name).toLowerCase()
      const lastB = getLastName(b?.meta?.name).toLowerCase()
      return lastA.localeCompare(lastB)
    })
})

const adminCount = computed(() => {
  return users.value.filter((item) => {
    return item.roles.find((role) => {
      return role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-') && role.role === 'admin'
    })
  }).length
})

const addItem = () => {
  state.saveButton = 'Invite User'
  const newItem = edgeGlobal.dupObject(state.newItem)
  newItem.meta.email = ''
  state.workingItem = newItem
  state.workingItem.id = edgeGlobal.generateShortId()
  state.currentTitle = 'Invite User'
  state.inviteOrgIds = [edgeGlobal.edgeState.currentOrganization]
  state.editOrgIds = []
  state.dialog = true
}

const editItem = (item) => {
  state.currentTitle = item.meta.name
  state.saveButton = 'Update User'
  state.workingItem = edgeGlobal.dupObject(item)
  state.workingItem.meta = edgeGlobal.dupObject(item.meta)
  state.workingItem.role = edgeGlobal.getRoleName(item.roles, edgeGlobal.edgeState.currentOrganization)
  state.editOrgIds = editOrgOptions.value
    .filter(org => state.workingItem.roles.some(role => role.collectionPath.startsWith(orgCollectionPath(org.docId))))
    .map(org => org.docId)
  const newItemKeys = Object.keys(state.newItem)
  newItemKeys.forEach((key) => {
    if (!state.workingItem?.[key]) {
      state.workingItem[key] = state.newItem[key]
    }
    if (key === 'meta') {
      const metaKeys = Object.keys(state.newItem.meta)
      metaKeys.forEach((metaKey) => {
        if (!state.workingItem?.meta?.[metaKey]) {
          state.workingItem.meta[metaKey] = state.newItem.meta[metaKey]
        }
      })
    }
  })
  console.log('Working Item:', state.workingItem)
  state.dialog = true
}

const deleteConfirm = (item) => {
  state.currentTitle = item.name
  state.workingItem = edgeGlobal.dupObject(item)
  state.removeOrgIds = [edgeGlobal.edgeState.currentOrganization]
  state.deleteDialog = true
}

const deleteAction = async () => {
  const targetUserId = state.workingItem.docId || state.workingItem.userId
  const selectedOrgIds = state.removeOrgIds.length > 0
    ? state.removeOrgIds
    : [edgeGlobal.edgeState.currentOrganization]
  const userRoles = state.workingItem.roles.filter((role) => {
    return selectedOrgIds.some(orgId => role.collectionPath.startsWith(orgCollectionPath(orgId)))
  })
  for (const role of userRoles) {
    await edgeFirebase.removeUserRoles(targetUserId, role.collectionPath)
    // console.log(role.collectionPath)
  }
  state.deleteDialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const closeDialog = () => {
  state.dialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const disableTracking = computed(() => {
  return state.saveButton === 'Invite User'
})

const updateInviteOrgSelection = (orgId, checked) => {
  const selections = new Set(state.inviteOrgIds)
  if (checked) {
    selections.add(orgId)
  }
  else {
    selections.delete(orgId)
  }
  state.inviteOrgIds = Array.from(selections)
}

const updateEditOrgSelection = (orgId, checked) => {
  const selections = new Set(state.editOrgIds)
  if (checked) {
    selections.add(orgId)
  }
  else {
    selections.delete(orgId)
  }
  state.editOrgIds = Array.from(selections)
}

const updateRemoveOrgSelection = (orgId, checked) => {
  const selections = new Set(state.removeOrgIds)
  if (checked) {
    selections.add(orgId)
  }
  else {
    selections.delete(orgId)
  }
  state.removeOrgIds = Array.from(selections)
}

const onSubmit = async () => {
  state.loading = true
  const selectedOrgIds = state.inviteOrgIds.length > 0
    ? state.inviteOrgIds
    : [edgeGlobal.edgeState.currentOrganization]
  const roles = selectedOrgIds.flatMap((orgId) => {
    const userRoles = edgeGlobal.orgUserRoles(orgId)
    const roleMatch = userRoles.find(role => role.name === state.workingItem.role)
    return roleMatch ? roleMatch.roles : []
  })
  if (state.saveButton === 'Invite User') {
    if (!state.workingItem.isTemplate) {
      await edgeFirebase.addUser({ roles, meta: state.workingItem.meta })
    }
    else {
      await edgeFirebase.addUser({ roles, meta: state.workingItem.meta, isTemplate: true })
    }
  }
  else {
    const targetUserId = state.workingItem.docId || state.workingItem.userId
    const selectedOrgIds = state.editOrgIds
    for (const org of editOrgOptions.value) {
      const orgId = org.docId
      const orgPath = orgCollectionPath(orgId)
      const shouldHave = selectedOrgIds.includes(orgId)
      const existingRoles = state.workingItem.roles.filter(role =>
        role.collectionPath.startsWith(orgPath),
      )
      if (!shouldHave && existingRoles.length > 0) {
        for (const role of existingRoles) {
          await edgeFirebase.removeUserRoles(targetUserId, role.collectionPath)
        }
        continue
      }
      if (shouldHave) {
        const orgRoles = edgeGlobal.orgUserRoles(orgId)
        const roleMatch = orgRoles.find(role => role.name === state.workingItem.role)
        if (!roleMatch)
          continue
        for (const role of existingRoles) {
          if (!roleMatch.roles.some(r => r.collectionPath === role.collectionPath && r.role === role.role)) {
            await edgeFirebase.removeUserRoles(targetUserId, role.collectionPath)
          }
        }
        for (const role of roleMatch.roles) {
          if (!existingRoles.some(r => r.collectionPath === role.collectionPath && r.role === role.role)) {
            await edgeFirebase.storeUserRoles(targetUserId, role.collectionPath, role.role)
          }
        }
      }
    }
    const stagedUserId = state.workingItem.docId
    console.log('Staged User ID:', stagedUserId)
    console.log('Updating meta:', state.workingItem.meta)
    await edgeFirebase.setUserMeta(state.workingItem.meta, '', stagedUserId)
  }
  edgeGlobal.edgeState.changeTracker = {}
  state.loading = false
  state.dialog = false
}

const computedUserSchema = computed(() =>
  state.saveButton === 'Invite User'
    ? props.newUserSchema
    : props.updateUserSchema,
)

const currentOrganization = computed(() => {
  if (edgeGlobal.edgeState.organizations.length > 0) {
    if (edgeGlobal.edgeState.currentOrganization && edgeFirebase?.data[`organizations/${edgeGlobal.edgeState.currentOrganization}`]) {
      return edgeFirebase?.data[`organizations/${edgeGlobal.edgeState.currentOrganization}`]
    }
  }
  return ''
})

onBeforeMount(async () => {
  props.metaFields.forEach((field) => {
    const keys = field.field.split('.')
    let current = state.newItem.meta

    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        console.log(`Setting ${key} to ${field.value}`)
        current[key] = field.value
      }
      else {
        if (!current[key]) {
          current[key] = {}
        }
        current = current[key]
      }
    })
  })
  await edgeFirebase.startUsersSnapshot(props.usersCollectionPath)
  state.loaded = true
})
</script>

<template>
  <Card v-if="state.loaded" class="w-full flex-1 bg-muted/50 mx-auto w-full border-none shadow-none pt-2">
    <slot name="header" :add-item="addItem">
      <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-6">
        <template #start>
          <slot name="header-start">
            <component :is="edgeGlobal.iconFromMenu(route)" class="mr-2" />
            <span class="capitalize">Members</span>
          </slot>
        </template>
        <template #center>
          <slot name="header-center">
            <div class="w-full px-6" />
          </slot>
        </template>
        <template #end>
          <slot name="header-end" :add-item="addItem">
            <edge-shad-button class="bg-primary mx-2 h-6 text-xs" @click="addItem()">
              Invite Member
            </edge-shad-button>
          </slot>
        </template>
      </edge-menu>
    </slot>
    <CardContent class="p-3 w-full overflow-y-auto scroll-area">
      <Input
        v-model="state.filter"
        class="mb-2"
        placeholder="Filter members..."
      />
      <div v-if="sortedFilteredUsers.length > 0">
        <div v-for="user in sortedFilteredUsers" :key="user.id" class="flex w-full py-2 justify-between items-center cursor-pointer" @click="editItem(user)">
          <slot name="user" :user="user">
            <Avatar class="handle pointer p-0 h-6 w-6 mr-2">
              <User width="18" height="18" />
            </Avatar>
            <div class="flex gap-2 mr-2 items-center">
              <div class="text-md text-bold mr-2">
                {{ user.meta.name }}
              </div>
              <edge-chip v-if="user.userId === edgeFirebase.user.uid">
                You
              </edge-chip>
              <!-- <edge-chip v-if="!user.userId" class="bg-primary">
                Invited, Not Registered
              </edge-chip> -->
            </div>
            <div class="grow flex gap-2 justify-end">
              <template v-if="!user.userId">
                <edge-chip class="bg-slate-600 w-[200px]">
                  {{ user.docId }}
                  <edge-clipboard-button class="relative ml-1 top-[2px] mt-0" :text="user.docId" />
                </edge-chip>
              </template>
              <edge-chip>
                {{ edgeGlobal.getRoleName(user.roles, edgeGlobal.edgeState.currentOrganization) }}
              </edge-chip>
            </div>
            <edge-shad-button
              :disabled="users.length === 1"
              class="bg-red-400 mx-2 h-6 w-[80px] text-xs"
              variant="outline"
              @click.stop="deleteConfirm(user)"
            >
              <span v-if="user.userId === edgeFirebase.user.uid">Leave</span>
              <span v-else>Remove</span>
            </edge-shad-button>
          </slot>
        </div>
      </div>
      <edge-shad-dialog
        v-model="state.deleteDialog"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span v-if="state.workingItem.userId === edgeFirebase.user.uid">
                Remove Yourself?
              </span>
              <span v-else>
                Remove "{{ state.workingItem.meta.name }}"
              </span>
            </DialogTitle>
            <DialogDescription />
          </DialogHeader>

          <h3 v-if="selfRemoveBlocked">
            You cannot remove yourself from this organization because you are the only admin. You can delete the organization or add another admin.
          </h3>
          <h3 v-else-if="state.workingItem.userId === edgeFirebase.user.uid">
            <span v-if="showRemoveOrgSelect">Select the organizations you want to leave.</span>
            <span v-else>Are you sure you want to remove yourself from the organization "{{ currentOrganization.name }}"? You will no longer have access to any of the organization's data.</span>
          </h3>
          <h3 v-else>
            <span v-if="showRemoveOrgSelect">Select the organizations you want to remove "{{ state.workingItem.meta.name }}" from.</span>
            <span v-else>Are you sure you want to remove "{{ state.workingItem.meta.name }}" from the organization "{{ currentOrganization.name }}"?</span>
          </h3>
          <div v-if="showRemoveOrgSelect" class="mt-4 w-full flex flex-wrap gap-2">
            <div v-for="org in removeOrgOptions" :key="org.docId" class="flex-1 min-w-[220px]">
              <edge-shad-checkbox
                :name="`remove-org-${org.docId}`"
                :model-value="state.removeOrgIds.includes(org.docId)"
                @update:model-value="val => updateRemoveOrgSelection(org.docId, val)"
              >
                {{ org.name }}
              </edge-shad-checkbox>
            </div>
          </div>
          <DialogFooter class="pt-6 flex justify-between">
            <edge-shad-button class="text-white  bg-slate-800 hover:bg-slate-400" @click="state.deleteDialog = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button
              :disabled="selfRemoveBlocked"
              class="w-full"
              variant="destructive"
              @click="deleteAction()"
            >
              <span v-if="state.workingItem.userId === edgeFirebase.user.uid">
                Leave
              </span>
              <span v-else>
                Remove
              </span>
            </edge-shad-button>
          </DialogFooter>
        </DialogContent>
      </edge-shad-dialog>
      <edge-shad-dialog
        v-model="state.dialog"
      >
        <DialogContent class="w-full max-w-[1200px]">
          <edge-shad-form :initial-values="state.workingItem" :schema="computedUserSchema" @submit="onSubmit">
            <DialogHeader class="mb-4">
              <DialogTitle>
                {{ state.currentTitle }}
              </DialogTitle>
              <DialogDescription />
            </DialogHeader>
            <slot name="edit-fields" :working-item="state.workingItem">
              <edge-g-input
                v-model="state.workingItem.role"
                name="role"
                :disable-tracking="true"
                :items="roleNamesOnly"
                field-type="select"
                label="Role"
                :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
                :disabled="state.workingItem.userId === edgeFirebase.user.uid"
              />
              <div v-if="state.saveButton !== 'Invite User' && showEditOrgSelect" class="mt-4 w-full">
                <div class="text-sm font-medium text-foreground">
                  Organizations
                </div>
                <div class="mt-2 w-full flex flex-wrap gap-2">
                  <div v-for="org in editOrgOptions" :key="org.docId" class="flex-1 min-w-[220px]">
                    <edge-shad-checkbox
                      :name="`edit-add-org-${org.docId}`"
                      :model-value="state.editOrgIds.includes(org.docId)"
                      @update:model-value="val => updateEditOrgSelection(org.docId, val)"
                    >
                      {{ org.name }}
                    </edge-shad-checkbox>
                  </div>
                </div>
              </div>
              <div v-if="state.saveButton === 'Invite User' && showInviteOrgSelect" class="mt-4 w-full">
                <div class="text-sm font-medium text-foreground">
                  Add to organizations
                </div>
                <div class="mt-2 w-full flex flex-wrap gap-2">
                  <div v-for="org in inviteOrgOptions" :key="org.docId" class="flex-1 min-w-[220px]">
                    <edge-shad-checkbox
                      :name="`invite-org-${org.docId}`"
                      :model-value="state.inviteOrgIds.includes(org.docId)"
                      @update:model-value="val => updateInviteOrgSelection(org.docId, val)"
                    >
                      {{ org.name }}
                    </edge-shad-checkbox>
                  </div>
                </div>
              </div>
              <edge-g-input
                v-if="state.saveButton === 'Invite User'"
                v-model="state.workingItem.meta.email"
                name="meta.email"
                :disable-tracking="true"
                field-type="text"
                label="Email"
                :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
              />
              <Separator class="my-6" />
              <div class="grid grid-cols-12 gap-2">
                <div v-for="field in props.metaFields" :key="field.field" class="mb-3 col-span-12" :class="numColsToTailwind(field.cols)">
                  <!-- Use explicit model binding so dotted paths (e.g., "address.street") work -->
                  <edge-g-input
                    v-if="field?.type === 'textarea'"
                    :model-value="getByPath(state.workingItem.meta, field.field, '')"
                    :name="`meta.${field.field}`"
                    :field-type="field?.type"
                    :label="field?.label"
                    parent-tracker-id="user-settings"
                    :hint="field?.hint"
                    :disable-tracking="true"
                    :bindings="{ class: 'h-60' }"
                    @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                  />
                  <edge-shad-tags
                    v-else-if="field?.type === 'tags' || field?.type === 'commaTags'"
                    :model-value="getByPath(state.workingItem.meta, field.field, '')"
                    :name="`meta.${field.field}`"
                    :field-type="field?.type"
                    :label="field?.label"
                    parent-tracker-id="user-settings"
                    :hint="field?.hint"
                    :disable-tracking="true"
                    @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                  />
                  <edge-g-input
                    v-else
                    :model-value="getByPath(state.workingItem.meta, field.field, '')"
                    :name="`meta.${field.field}`"
                    :field-type="field?.type"
                    :label="field?.label"
                    parent-tracker-id="user-settings"
                    :hint="field?.hint"
                    :disable-tracking="true"
                    @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                  />
                </div>
              </div>

              <edge-g-input
                v-if="state.saveButton === 'Invite User'"
                v-model="state.workingItem.isTemplate"
                name="isTemplate"
                :disable-tracking="true"
                field-type="boolean"
                label="Template User"
                :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
              />
            </slot>
            <DialogFooter class="pt-6 flex justify-between">
              <edge-shad-button variant="destructive" @click="closeDialog">
                Cancel
              </edge-shad-button>
              <edge-shad-button
                :disabled="state.loading"
                class="text-white  w-100 bg-slate-800 hover:bg-slate-400"
                type="submit"
              >
                <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                {{ state.saveButton }}
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
        </DialogContent>
      </edge-shad-dialog>
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
