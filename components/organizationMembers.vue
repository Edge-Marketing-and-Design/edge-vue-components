<script setup>
// TODO: pass possible roles in prop
import { toTypedSchema } from '@vee-validate/zod'
import { ArrowLeft, Loader2, Trash2, User } from 'lucide-vue-next'
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
  metaFieldsSchema: {
    type: Object,
    default: null,
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

const emailDisabledHint = 'This field is tied to the user\'s username and can only be changed by them.'

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

const disabledNoteText = 'Contact admin to change.'

const getDisabledNote = (field) => {
  if (!field?.disabled)
    return ''
  return field?.disabledNote || disabledNoteText
}

const mergeDisabledNote = (text, field) => {
  const note = getDisabledNote(field)
  if (!note)
    return text || ''
  if (text)
    return `${text} ${note}`
  return note
}

const userKey = (user) => {
  return user?.docId || user?.userId || user?.id || user?.uid || ''
}

const PROFILE_IMAGE_SIZE = 96
const PROFILE_IMAGE_VARIANT = `width=${PROFILE_IMAGE_SIZE},height=${PROFILE_IMAGE_SIZE},fit=cover,quality=85`

const profileImageUrl = (url) => {
  if (!url || typeof url !== 'string')
    return ''
  if (url.includes('/cdn-cgi/image/'))
    return url
  if (url.includes('width=') && url.includes('height='))
    return url
  if (url.endsWith('/thumbnail'))
    return url.replace(/\/thumbnail$/, `/${PROFILE_IMAGE_VARIANT}`)
  return url
}

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
  newItem.meta.name = ''
  newItem.meta.profilephoto = ''
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

const roleSchema = z
  .string({ required_error: 'Role is required' })
  .min(1, { message: 'Role is required' })

const baseMetaSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, { message: 'Name is required' }),
  email: z
    .string({ required_error: 'Email is required' })
    .email({ message: 'Invalid email address' })
    .min(6, { message: 'Email must be at least 6 characters long' })
    .max(50, { message: 'Email must be less than 50 characters long' }),
})

const buildMetaSchema = () => {
  const extra = props.metaFieldsSchema
  if (!extra)
    return baseMetaSchema
  if (extra?.shape && typeof extra.shape === 'object')
    return baseMetaSchema.merge(extra)
  if (typeof extra === 'object')
    return baseMetaSchema.extend(extra)
  return baseMetaSchema
}

const computedNewUserSchema = computed(() => {
  if (!props.metaFieldsSchema)
    return props.newUserSchema
  return toTypedSchema(z.object({ meta: buildMetaSchema(), role: roleSchema }))
})

const computedUpdateUserSchema = computed(() => {
  if (!props.metaFieldsSchema)
    return props.updateUserSchema
  return toTypedSchema(z.object({ meta: buildMetaSchema(), role: roleSchema }))
})

const computedUserSchema = computed(() =>
  state.saveButton === 'Invite User'
    ? computedNewUserSchema.value
    : computedUpdateUserSchema.value,
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
  <div v-if="state.loaded" class="w-full flex-1 min-h-0 h-[calc(100vh-58px)] overflow-hidden">
    <ResizablePanelGroup direction="horizontal" class="w-full h-full flex-1">
      <ResizablePanel class="bg-sidebar text-sidebar-foreground min-w-[400px]" :default-size="22" :min-size="30">
        <div class="flex flex-col h-full">
          <div class="px-3 py-3 border-b border-sidebar-border bg-sidebar/90">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <component :is="edgeGlobal.iconFromMenu(route)" class="h-4 w-4" />
                <span>Members</span>
              </div>
              <edge-shad-button size="sm" class="h-7 text-xs bg-primary" @click="addItem()">
                Invite
              </edge-shad-button>
            </div>
            <Input
              v-model="state.filter"
              class="mt-3 h-8 w-full"
              placeholder="Filter members..."
            />
          </div>
          <div class="flex-1 overflow-y-auto">
            <SidebarMenu class="px-2 py-2 space-y-0">
              <SidebarMenuItem
                v-for="user in sortedFilteredUsers"
                :key="userKey(user)"
              >
                <SidebarMenuButton
                  class="w-full !h-auto items-start px-3 py-2"
                  :class="state.dialog && userKey(state.workingItem) && userKey(state.workingItem) === userKey(user) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''"
                  @click="editItem(user)"
                >
                  <div class="flex w-full items-start gap-3" :class="!user.userId ? 'opacity-70' : ''">
                  <Avatar class="h-12 w-12 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden">
                      <img
                        v-if="user?.meta?.profilephoto"
                        :src="profileImageUrl(user.meta.profilephoto)"
                        alt=""
                        class="h-full w-full object-cover"
                      >
                      <User v-else width="24" height="24" />
                    </Avatar>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium leading-snug whitespace-normal uppercase">
                          {{ user?.meta?.name || user?.meta?.email || 'Unnamed Member' }}
                        </span>
                        <!-- <span v-if="!user.userId" class="text-[10px] uppercase tracking-wide text-muted-foreground">
                          -
                        </span> -->
                        <edge-chip v-if="user.userId === edgeFirebase.user.uid">
                          You
                        </edge-chip>
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground leading-snug">
                        <span class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                          {{ edgeGlobal.getRoleName(user.roles, edgeGlobal.edgeState.currentOrganization) }}
                        </span>
                        <span v-if="!user.userId && user.docId" class="inline-flex items-center gap-1 whitespace-normal">
                          {{ user.docId }}
                          <edge-clipboard-button class="relative top-[1px]" :text="user.docId" />
                        </span>
                      </div>
                    </div>
                    <edge-shad-button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7 text-destructive/80 hover:text-destructive"
                      @click.stop="deleteConfirm(user)"
                    >
                      <Trash2 class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                </SidebarMenuButton>
                <Separator class="my-1" />
              </SidebarMenuItem>
              <div v-if="sortedFilteredUsers.length === 0" class="px-4 py-6 text-xs text-muted-foreground">
                No members found.
              </div>
            </SidebarMenu>
          </div>
        </div>
      </ResizablePanel>
      <ResizablePanel class="bg-background">
        <div class="h-full flex flex-col">
          <div v-if="state.dialog" class="h-full flex flex-col">
            <edge-shad-form
              :key="userKey(state.workingItem) || state.workingItem?.id || 'member-form'"
              :initial-values="state.workingItem"
              :schema="computedUserSchema"
              class="flex flex-col h-full"
              @submit="onSubmit"
            >
              <div class="flex items-center justify-between border-b bg-secondary px-4 py-3">
                <div class="text-sm font-semibold">
                  {{ state.currentTitle || 'Member' }}
                </div>
                <div class="flex items-center gap-2">
                  <edge-shad-button variant="text" class="text-xs text-red-700" @click="closeDialog">
                    Close
                  </edge-shad-button>
                  <edge-shad-button
                    type="submit"
                    class="text-xs bg-primary"
                    :disabled="state.loading"
                  >
                    <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                    {{ state.saveButton }}
                  </edge-shad-button>
                </div>
              </div>
              <div class="flex-1 overflow-y-auto p-6 space-y-4">
                <slot name="edit-fields" :working-item="state.workingItem">
                  <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Member Details
                    </div>
                    <div class="flex flex-col gap-4 md:flex-row md:items-stretch">
                      <div class="w-full md:w-[260px] self-stretch">
                        <edge-image-picker
                          v-model="state.workingItem.meta.profilephoto"
                          label="Profile Photo"
                          dialog-title="Select Profile Photo"
                          site="clearwater-hub-images"
                          :default-tags="['Agents']"
                          height-class="h-full min-h-[180px]"
                        />
                      </div>
                      <div class="flex-1 space-y-4">
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
                        <edge-g-input
                          v-model="state.workingItem.meta.name"
                          name="meta.name"
                          :disable-tracking="true"
                          field-type="text"
                          label="Name"
                          :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
                        />
                        <edge-g-input
                          v-model="state.workingItem.meta.email"
                          name="meta.email"
                          :disable-tracking="true"
                          field-type="text"
                          label="Email"
                          :disabled="state.saveButton !== 'Invite User'"
                          :hint="state.saveButton !== 'Invite User' ? emailDisabledHint : ''"
                          :persistent-hint="state.saveButton !== 'Invite User'"
                          :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
                        />
                    <edge-g-input
                      v-model="state.workingItem.meta.phone"
                      name="meta.phone"
                      :disable-tracking="true"
                      field-type="text"
                      label="Phone"
                      :mask-options="{ mask: '(###) ###-####' }"
                      :parent-tracker-id="`inviteUser-${state.workingItem.id}`"
                    />
                      </div>
                    </div>
                  </div>
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
                  <Separator class="my-6" />
                  <div class="grid grid-cols-12 gap-2">
                    <div v-for="field in props.metaFields" :key="field.field" class="mb-3 col-span-12" :class="numColsToTailwind(field.cols)">
                      <!-- Use explicit model binding so dotted paths (e.g., "address.street") work -->
                      <edge-image-picker
                        v-if="field?.type === 'imagePicker'"
                        :model-value="getByPath(state.workingItem.meta, field.field, '')"
                        :label="field?.label || 'Photo'"
                        :dialog-title="field?.dialogTitle || 'Select Image'"
                        :site="field?.site || 'clearwater-hub-images'"
                        :default-tags="field?.tags || []"
                        :height-class="field?.heightClass || 'h-[160px]'"
                        :disabled="field?.disabled || false"
                        @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                      />
                      <p v-if="field?.type === 'imagePicker' && field?.disabled" class="mt-1 text-xs text-muted-foreground">
                        {{ getDisabledNote(field) }}
                      </p>
                      <div v-else-if="field?.type === 'richText'" class="member-richtext">
                        <edge-shad-html
                          :model-value="getByPath(state.workingItem.meta, field.field, '')"
                          :name="`meta.${field.field}`"
                          :label="field?.label"
                          :disabled="field?.disabled || false"
                          :description="mergeDisabledNote(field?.description, field)"
                          :enabled-toggles="field?.enabledToggles || ['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline']"
                          @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                        />
                      </div>
                      <edge-shad-select-tags
                        v-else-if="field?.type === 'selectTags'"
                        :model-value="getByPath(state.workingItem.meta, field.field, [])"
                        :name="`meta.${field.field}`"
                        :label="field?.label"
                        :description="mergeDisabledNote(field?.description, field)"
                        :items="field?.items || []"
                        :item-title="field?.itemTitle || 'title'"
                        :item-value="field?.itemValue || 'name'"
                        :allow-additions="field?.allowAdditions || false"
                        :placeholder="field?.placeholder"
                        :disabled="field?.disabled || false"
                        @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                      />
                      <div v-else-if="field?.type === 'boolean'" class="space-y-1 -mt-3">
                        <div class="text-sm font-medium leading-none opacity-0 select-none h-4">
                          {{ field?.label || '' }}
                        </div>
                        <edge-g-input
                          :model-value="getByPath(state.workingItem.meta, field.field, false)"
                          :name="`meta.${field.field}`"
                          :field-type="field?.type"
                          :label="field?.label"
                          parent-tracker-id="user-settings"
                          :disable-tracking="true"
                          :disabled="field?.disabled || false"
                          @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                        />
                        <p v-if="mergeDisabledNote(field?.hint, field)" class="text-xs text-muted-foreground">
                          {{ mergeDisabledNote(field?.hint, field) }}
                        </p>
                      </div>
                    <edge-g-input
                      v-else-if="field?.type === 'textarea'"
                      :model-value="getByPath(state.workingItem.meta, field.field, '')"
                      :name="`meta.${field.field}`"
                      :field-type="field?.type"
                      :label="field?.label"
                      parent-tracker-id="user-settings"
                      :hint="mergeDisabledNote(field?.hint, field)"
                      :persistent-hint="Boolean(mergeDisabledNote(field?.hint, field))"
                      :disable-tracking="true"
                      :bindings="{ class: 'h-60' }"
                      :mask-options="field?.maskOptions"
                      :disabled="field?.disabled || false"
                      @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                    />
                      <edge-shad-tags
                        v-else-if="field?.type === 'tags' || field?.type === 'commaTags'"
                        :model-value="getByPath(state.workingItem.meta, field.field, '')"
                        :name="`meta.${field.field}`"
                        :field-type="field?.type"
                        :label="field?.label"
                        parent-tracker-id="user-settings"
                        :description="mergeDisabledNote(field?.description || field?.hint, field)"
                        :disable-tracking="true"
                        :disabled="field?.disabled || false"
                        @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                      />
                  <edge-g-input
                    v-else
                    :model-value="getByPath(state.workingItem.meta, field.field, '')"
                    :name="`meta.${field.field}`"
                    :field-type="field?.type"
                    :label="field?.label"
                    parent-tracker-id="user-settings"
                    :hint="mergeDisabledNote(field?.hint, field)"
                    :persistent-hint="Boolean(mergeDisabledNote(field?.hint, field))"
                    :disable-tracking="true"
                    :mask-options="field?.maskOptions"
                    :disabled="field?.disabled || false"
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
              </div>
            </edge-shad-form>
          </div>
          <div v-else class="p-4 text-center flex text-slate-500 h-[calc(100vh-4rem)] justify-center items-center overflow-y-auto">
            <div class="text-4xl">
              <ArrowLeft class="inline-block w-12 h-12 mr-2" /> Select a member to view details.
            </div>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

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
  </div>
</template>

<style lang="scss" scoped>
:deep(.member-richtext .tiptap) {
  min-height: 220px;
  padding: 0.75rem 1rem;
}

:deep(.member-richtext .tiptap p) {
  margin-top: 0;
  margin-bottom: 1rem;
}
</style>
