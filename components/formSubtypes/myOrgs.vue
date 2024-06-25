<script setup>
import { Loader2, User } from 'lucide-vue-next'
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
})

const newItem = {
  name: '',
}

const addItem = () => {
  console.log(newItem)
  state.saveButton = 'Add Organization'
  state.workingItem = edgeGlobal.dupObject(newItem)
  state.workingItem.id = edgeGlobal.generateShortId()
  state.currentTitle = 'Add Organization'
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

const onSubmit = async () => {
  const registerSend = edgeGlobal.dupObject(register)
  state.loading = true
  if (state.saveButton === 'Add Organization') {
    registerSend.dynamicDocumentFieldValue = state.workingItem.name
  }
  else {
    registerSend.dynamicDocumentFieldValue = ''
    registerSend.registrationCode = state.workingItem.name
  }
  const results = await edgeFirebase.currentUserRegister(registerSend)
  edgeGlobal.getOrganizations(edgeFirebase)
  console.log(results)
  edgeGlobal.edgeState.changeTracker = {}
  state.dialog = false
  state.loading = false
}
const schema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Required',
  }),
}))
</script>

<template>
  <edge-shad-button v-if="props.item === null && props.passThroughProps" class="bg-slate-500 mx-2 h-6 text-xs" @click="addItem()">
    Add Organization
  </edge-shad-button>
  <edge-shad-button v-if="props.item === null" class="bg-slate-500 mx-2 h-6 text-xs" @click="joinOrg()">
    Join Organization
  </edge-shad-button>
  <div v-else class="flex w-full py-1 justify-between items-center">
    <Avatar class="handle pointer p-0 h-6 w-6 mr-2">
      <User width="18" height="18" />
    </Avatar>
    <div class="flex gap-2 mr-2 items-center">
      <div class="text-md text-bold mr-2">
        {{ props.item.name }}
      </div>
      <edge-chip v-if="edgeGlobal.edgeState.currentOrganization === props.item.docId" size="small" color="primary">
        Current
      </edge-chip>
      <edge-shad-button v-else class="bg-slate-500 h-6 text-xs" @click="edgeGlobal.setOrganization(props.item.docId, edgeFirebase)">
        Switch
      </edge-shad-button>
    </div>
    <div class="grow flex gap-2 justify-end">
      <edge-chip variant="outlined">
        {{ edgeGlobal.getRoleName(edgeFirebase.user.roles, props.item.docId) }}
      </edge-chip>
    </div>
    <edge-shad-button
      class="bg-red-400 mx-2 h-6 text-xs"
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
        <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.deleteDialog = false">
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
        <DialogFooter class="pt-6 flex justify-between">
          <edge-shad-button variant="destructive" @click="closeDialog">
            Close
          </edge-shad-button>
          <edge-shad-button
            :disabled="state.loading"
            class="text-white w-100 bg-slate-800 hover:bg-slate-400"
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
