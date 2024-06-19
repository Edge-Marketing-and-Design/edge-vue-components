<script setup>
import { computed, defineProps, inject, reactive } from 'vue'
import { User } from 'lucide-vue-next'
// TODO: If a removed user no longer has roles to any organiztions, need to a create new organization for them with
// default name of "Personal". This will allow them to continue to use the app.

// TODO:  Finish user setup.
// TODO:  Add error/success to join/add organization.

// TODO: Put git in this folder in FormFling... merge ionic package with this one...
// perhaps components keep name but are in seperate folders that a var uses to point to the correct folder.

// TODO MAKE app.vue component differnt for ionic and vuetify
// todo same with pages that get coppied into the project.
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

// const edgeGlobal = inject('edgeGlobal')
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
})

const roleNamesOnly = computed(() => {
  return edgeGlobal.edgeState.userRoles.map((role) => {
    return role.name
  })
})

const newItem = {
  name: '',
  email: '',
  role: 'User',
}

// computed property gets count of admin users in organization
const adminCount = computed(() => {
  return props.items.filter((item) => {
    return item.roles.find((role) => {
      return role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-') && role.role === 'admin'
    })
  }).length
})

const addItem = () => {
  state.saveButton = 'Invite User'
  state.workingItem = edgeGlobal.dupObject(newItem)
  state.workingItem.id = edgeGlobal.generateShortId()
  state.currentTitle = 'Invite User'
  state.dialog = true
}

const editItem = (item) => {
  state.currentTitle = item.name
  state.saveButton = 'Update User'
  state.workingItem = edgeGlobal.dupObject(item)
  state.workingItem.name = item.meta.name
  state.workingItem.role = edgeGlobal.getRoleName(props.item.roles, edgeGlobal.edgeState.currentOrganization)
  const newItemKeys = Object.keys(newItem)
  newItemKeys.forEach((key) => {
    if (state.workingItem[key] === undefined) {
      state.workingItem[key] = newItem[key]
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
  await edgeFirebase.removeUser(state.workingItem.docId)
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

const onSubmit = async (event) => {
  const results = await event
  if (results.valid) {
    const userRoles = edgeGlobal.orgUserRoles(edgeGlobal.edgeState.currentOrganization)
    const roles = userRoles.find(role => role.name === state.workingItem.role).roles
    if (state.saveButton === 'Invite User') {
      edgeFirebase.addUser({ roles, meta: { name: state.workingItem.name, email: state.workingItem.email } })
    }
    else {
      const oldRoles = state.workingItem.roles.filter((role) => {
        return role.collectionPath.startsWith(edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'))
      })

      for (const role of oldRoles) {
        await edgeFirebase.removeUserRoles(state.workingItem.docId, role.collectionPath)
      }

      for (const role of roles) {
        await edgeFirebase.storeUserRoles(state.workingItem.docId, role.collectionPath, role.role)
      }
    }
    edgeGlobal.edgeState.changeTracker = {}
    state.dialog = false
  }
}
</script>

<template>
  <edge-shad-button v-if="props.item === null" class="bg-slate-500 mx-2 h-6 text-xs" @click="addItem()">
    Invite Member
  </edge-shad-button>
  <div v-else class="flex w-full py-1 justify-between items-center cursor-pointer" @click="editItem(props.item)">
    <Avatar class="handle pointer p-0 h-6 w-6 mr-2">
      <User width="18" height="18" />
    </Avatar>
    <div class="flex gap-2 mr-2">
      <edge-chip class="bg-secondary">
        {{ props.item.meta.name }}
      </edge-chip>
      <edge-chip v-if="props.item.userId === edgeFirebase.user.uid" class="bg-success">
        You
      </edge-chip>
      <edge-chip v-if="!props.item.userId" class="bg-warning">
        Invited, Not Registered
      </edge-chip>
    </div>
    <div class="grow flex gap-2 justify-end">
      <edge-chip variant="outlined">
        {{ edgeGlobal.getRoleName(props.item.roles, edgeGlobal.edgeState.currentOrganization) }}
      </edge-chip>
      <template v-if="!props.item.userId">
        <edge-chip>
          Registration Code: {{ props.item.docId }}
        </edge-chip>
        <edge-clipboard-button :text="props.item.docId" />
      </template>
    </div>
    <v-btn
      color="secondary"
      variant="text"
      :disabled="items.length === 1"
      @click.stop="deleteConfirm(props.item)"
    >
      <span v-if="props.item.userId === edgeFirebase.user.uid">Leave</span>
      <span v-else>Remove</span>
    </v-btn>
  </div>
  <v-dialog
    v-model="state.deleteDialog"
    persistent
    max-width="600"
    transition="fade-transition"
  >
    <v-card>
      <v-toolbar flat>
        <v-icon class="mx-4">
          mdi-list-box
        </v-icon>
        <span v-if="state.workingItem.userId === edgeFirebase.user.uid">
          Remove Yourself?
        </span>
        <span v-else>
          Remove "{{ state.workingItem.meta.name }}"
        </span>
        <v-spacer />

        <v-btn
          type="submit"
          color="primary"
          icon
          @click="state.deleteDialog = false"
        >
          <v-icon> mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-card-text>
        <h3 v-if="state.workingItem.userId === edgeFirebase.user.uid && adminCount > 1">
          Are you sure you want to remove yourself from the organization "{{ edgeGlobal.currentOrganizationObject.name }}"? You will no longer have access to any of the organization's data.
        </h3>
        <h3 v-else-if="state.workingItem.userId === edgeFirebase.user.uid && adminCount === 1">
          You cannot remove yourself from this organization because you are the only admin. You can delete the organization or add another admin.
        </h3>
        <h3 v-else>
          Are you sure you want to remove "{{ state.workingItem.meta.name }}" from the organization "{{ edgeGlobal.currentOrganizationObject.name }}"?
        </h3>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="blue-darken-1"
          variant="text"
          @click="state.deleteDialog = false"
        >
          Cancel
        </v-btn>
        <v-btn
          :disabled="adminCount === 1 && state.workingItem.userId === edgeFirebase.user.uid"
          type="submit"
          color="error"
          variant="text"
          @click="deleteAction()"
        >
          <span v-if="state.workingItem.userId === edgeFirebase.user.uid">
            Leave
          </span>
          <span v-else>
            Remove
          </span>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog
    v-model="state.dialog"
    persistent
    max-width="800"
    transition="fade-transition"
  >
    <v-card>
      <v-form
        v-model="state.form"
        validate-on="submit"
        @submit.prevent="onSubmit"
      >
        <v-toolbar flat>
          <v-icon class="mx-4">
            mdi-list-box
          </v-icon>
          {{ state.currentTitle }}
          <v-spacer />

          <v-btn
            type="submit"
            color="primary"
            variant="text"
          >
            {{ state.saveButton }}
          </v-btn>
        </v-toolbar>
        <v-card-text>
          <edge-g-input
            v-model="state.workingItem.name"
            name="name"
            :disable-tracking="true"
            field-type="text"
            :rules="[edgeGlobal.edgeRules.required]"
            label="Name"
            :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
            :disabled="state.saveButton !== 'Invite User'"
          />
          <edge-g-input
            v-if="state.saveButton === 'Invite User'"
            v-model="state.workingItem.email"
            name="email"
            :disable-tracking="true"
            field-type="text"
            label="Email"
            :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
          />
          <edge-g-input
            v-model="state.workingItem.role"
            name="role"
            :disable-tracking="disableTracking"
            :items="roleNamesOnly"
            field-type="select"
            label="Role"
            :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="blue-darken-1"
            variant="text"
            @click="closeDialog"
          >
            Close
          </v-btn>
          <v-btn
            type="submit"
            color="primary"
            variant="text"
          >
            {{ state.saveButton }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<style lang="scss" scoped>
.pointer {
  cursor: move;
}
</style>
