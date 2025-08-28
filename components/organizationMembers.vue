<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
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
  loaded: false,
})

const roleNamesOnly = computed(() => {
  return edgeGlobal.edgeState.userRoles.map((role) => {
    return role.name
  })
})

const users = computed(() => {
  const otherUsers = Object.values(edgeFirebase.state.users)

  return otherUsers
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
  state.dialog = true
}

const editItem = (item) => {
  state.currentTitle = item.meta.name
  state.saveButton = 'Update User'
  state.workingItem = edgeGlobal.dupObject(item)
  state.workingItem.meta = edgeGlobal.dupObject(item.meta)
  state.workingItem.role = edgeGlobal.getRoleName(item.roles, edgeGlobal.edgeState.currentOrganization)
  const newItemKeys = Object.keys(state.newItem)
  newItemKeys.forEach((key) => {
    if (state.workingItem[key] === undefined) {
      state.workingItem[key] = state.newItem[key]
    }
  })
  state.dialog = true
}

const deleteConfirm = (item) => {
  state.currentTitle = item.name
  state.workingItem = edgeGlobal.dupObject(item)
  state.deleteDialog = true
}

const deleteAction = async () => {
  const userRoles = state.workingItem.roles.filter((role) => {
    return role.collectionPath.startsWith(edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'))
  })
  for (const role of userRoles) {
    await edgeFirebase.removeUserRoles(state.workingItem.docId, role.collectionPath)
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

const onSubmit = async () => {
  state.loading = true
  const userRoles = edgeGlobal.orgUserRoles(edgeGlobal.edgeState.currentOrganization)
  const roles = userRoles.find(role => role.name === state.workingItem.role).roles
  if (state.saveButton === 'Invite User') {
    if (!state.workingItem.isTemplate) {
      await edgeFirebase.addUser({ roles, meta: state.workingItem.meta })
    }
    else {
      await edgeFirebase.addUser({ roles, meta: state.workingItem.meta, isTemplate: true })
    }
  }
  else {
    const oldRoles = state.workingItem.roles.filter((role) => {
      return role.collectionPath.startsWith(edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'))
        && !roles.find(r => r.collectionPath === role.collectionPath)
    })

    for (const role of oldRoles) {
      await edgeFirebase.removeUserRoles(state.workingItem.docId, role.collectionPath)
    }

    for (const role of roles) {
      await edgeFirebase.storeUserRoles(state.workingItem.docId, role.collectionPath, role.role)
    }
    const stagedUserId = state.workingItem.docId
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

onBeforeMount(() => {
  props.metaFields.forEach((field) => {
    state.newItem.meta[field.field] = field.value
  })
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
      <div v-if="users.length > 0">
        <div v-for="user in users" :key="user.id" class="flex w-full py-2 justify-between items-center cursor-pointer" @click="editItem(user)">
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

          <h3 v-if="state.workingItem.userId === edgeFirebase.user.uid && adminCount > 1">
            Are you sure you want to remove yourself from the organization "{{ currentOrganization.name }}"? You will no longer have access to any of the organization's data.
          </h3>
          <h3 v-else-if="state.workingItem.userId === edgeFirebase.user.uid && adminCount === 1">
            You cannot remove yourself from this organization because you are the only admin. You can delete the organization or add another admin.
          </h3>
          <h3 v-else>
            Are you sure you want to remove "{{ state.workingItem.meta.name }}" from the organization "{{ currentOrganization.name }}"?
          </h3>
          <DialogFooter class="pt-6 flex justify-between">
            <edge-shad-button class="text-white  bg-slate-800 hover:bg-slate-400" @click="state.deleteDialog = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button
              :disabled="adminCount === 1 && state.workingItem.userId === edgeFirebase.user.uid"
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
        <DialogContent class="w-full max-w-[800px]">
          <edge-shad-form :initial-values="state.workingItem" :schema="computedUserSchema" @submit="onSubmit">
            <DialogHeader class="mb-4">
              <DialogTitle>
                {{ state.currentTitle }}
              </DialogTitle>
              <DialogDescription />
            </DialogHeader>
            <slot name="edit-fields" :working-item="state.workingItem">
              <div v-for="field in props.metaFields" :key="field.field" class="mb-3">
                <edge-g-input
                  v-model="state.workingItem.meta[field.field]"
                  :name="`meta.${field.field}`"
                  :field-type="field?.type"
                  :label="field?.label"
                  parent-tracker-id="user-settings"
                  :hint="field?.hint"
                  :disable-tracking="true"
                />
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
              <edge-g-input
                v-if="state.saveButton === 'Invite User'"
                v-model="state.workingItem.isTemplate"
                name="isTemplate"
                :disable-tracking="true"
                field-type="boolean"
                label="Template User"
                :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
              />
              <div class="mb-4" />
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
