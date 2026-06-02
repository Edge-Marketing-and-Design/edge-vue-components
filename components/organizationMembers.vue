<script setup>
// TODO: pass possible roles in prop
import { toTypedSchema } from '@vee-validate/zod'
import { ArrowLeft, Check, Loader2, Trash2, User, X } from 'lucide-vue-next'
import * as z from 'zod'
const props = defineProps({
  usersCollectionPath: {
    type: String,
    default: () => `organizations/${edgeGlobal.edgeState.currentOrganization}`,
  },
  defaultImageTags: {
    type: Array,
    default: () => [
      'Headshots',
    ],
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
  featureAccessConfig: {
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
  roleFilter: 'all',
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
    featureAccess: {},
    isTemplate: false,
  },
  inviteOrgIds: [],
  editOrgIds: [],
  removeOrgIds: [],
  loaded: false,
  memberDetailTab: 'details',
})

const roleNamesOnly = computed(() => {
  return edgeGlobal.edgeState.userRoles.map((role) => {
    return role.name
  })
})

const edgeUsers = toRef(edgeFirebase.state, 'users')
const users = computed(() => Object.values(edgeUsers.value ?? {}))

const orgCollectionPath = orgId => `organizations-${String(orgId).replaceAll('/', '-')}`

const useFeatureAccess = computed(() => props.featureAccessConfig?.enabled === true)

const enabledFeatureAccessFeatures = computed(() =>
  (props.featureAccessConfig?.features || []).filter(feature => feature?.enabled !== false),
)

const roleStrength = {
  user: 1,
  writer: 2,
  editor: 3,
  admin: 4,
}

const materializeRole = (role, orgId) => ({
  collectionPath: String(role.collectionPath || '').replace(/organizationDocPath/g, orgCollectionPath(orgId)),
  role: role.role,
})

const materializeRoles = (roles, orgId) =>
  (roles || [])
    .filter(role => role?.collectionPath && role?.role)
    .map(role => materializeRole(role, orgId))

const mergeRoles = (roles) => {
  const byPath = new Map()
  roles.forEach((role) => {
    if (!role?.collectionPath || !role?.role)
      return
    const existing = byPath.get(role.collectionPath)
    if (!existing || (roleStrength[role.role] || 0) > (roleStrength[existing.role] || 0))
      byPath.set(role.collectionPath, role)
  })
  return Array.from(byPath.values())
}

const roleSatisfies = (sourceRole, targetRole) =>
  sourceRole.collectionPath === targetRole.collectionPath
  && (roleStrength[sourceRole.role] || 0) >= (roleStrength[targetRole.role] || 0)

const roleSetContains = (sourceRoles, targetRoles) =>
  targetRoles.every(target =>
    sourceRoles.some(role => roleSatisfies(role, target)),
  )

const createDefaultFeatureAccess = () => {
  const access = {
    orgAdmin: false,
    features: {},
  }

  enabledFeatureAccessFeatures.value.forEach((feature) => {
    const featureAccess = {
      enabled: feature.defaultEnabled === true,
      admin: false,
      areas: {},
    }
    ;(feature.areas || []).forEach((area) => {
      featureAccess.areas[area.key] = {
        view: false,
        edit: false,
      }
    })
    access.features[feature.key] = featureAccess
  })

  return access
}

const buildFeatureAccessFromRoles = (roles, orgId) => {
  const access = createDefaultFeatureAccess()
  const normalizedRoles = roles || []
  const orgAdminRoleName = props.featureAccessConfig?.orgAdminRoleName || 'Admin'
  access.orgAdmin = edgeGlobal.getRoleName(normalizedRoles, orgId) === orgAdminRoleName

  enabledFeatureAccessFeatures.value.forEach((feature) => {
    const featureAccess = access.features[feature.key]
    if (!featureAccess)
      return

    const adminRoles = materializeRoles(feature.adminRoles, orgId)
    featureAccess.admin = adminRoles.length > 0 && roleSetContains(normalizedRoles, adminRoles)
    const sharedRoles = materializeRoles(feature.sharedRoles, orgId)
    const hasSharedAccess = sharedRoles.length > 0 && roleSetContains(normalizedRoles, sharedRoles)

    let hasAnyAreaAccess = false
    ;(feature.areas || []).forEach((area) => {
      const areaAccess = featureAccess.areas[area.key]
      if (!areaAccess)
        return
      const viewRoles = materializeRoles(area.viewRoles, orgId)
      const editRoles = materializeRoles(area.editRoles, orgId)
      areaAccess.edit = editRoles.length > 0 && roleSetContains(normalizedRoles, editRoles)
      areaAccess.view = areaAccess.edit || (viewRoles.length > 0 && roleSetContains(normalizedRoles, viewRoles))
      if (area?.accessMode === 'allow' && areaAccess.view)
        areaAccess.edit = true
      hasAnyAreaAccess = hasAnyAreaAccess || areaAccess.view || areaAccess.edit
    })

    featureAccess.enabled = featureAccess.admin || hasSharedAccess || hasAnyAreaAccess || feature.defaultEnabled === true
  })

  return access
}

const featureHasEditAccess = featureAccess =>
  Object.values(featureAccess?.areas || {}).some(area => area?.edit === true)

const featureUsesHeaderViewControl = feature =>
  !(feature.areas || []).length && (feature.sharedRoles || []).length > 0

const featureAdminControlLabel = feature =>
  (feature.areas || []).length ? (feature.adminLabel || 'Admin') : (feature.editLabel || 'Edit')

const areaUsesAllowControl = area => area?.accessMode === 'allow'

const buildFeatureAccessRoles = (orgId, access) => {
  if (!useFeatureAccess.value)
    return null

  if (access?.orgAdmin) {
    const orgRoles = edgeGlobal.orgUserRoles(orgId)
    const orgAdminRoleName = props.featureAccessConfig?.orgAdminRoleName || 'Admin'
    return orgRoles.find(role => role.name === orgAdminRoleName)?.roles || []
  }

  const roles = materializeRoles(props.featureAccessConfig?.baseRoles || [], orgId)
  enabledFeatureAccessFeatures.value.forEach((feature) => {
    const featureAccess = access?.features?.[feature.key]
    if (!featureAccess?.enabled)
      return

    if (featureAccess.admin) {
      roles.push(...materializeRoles(feature.adminRoles, orgId))
      return
    }

    roles.push(...materializeRoles(feature.sharedRoles, orgId))
    if (featureHasEditAccess(featureAccess))
      roles.push(...materializeRoles(feature.editSharedRoles, orgId))

    ;(feature.areas || []).forEach((area) => {
      const areaAccess = featureAccess.areas?.[area.key]
      if (!areaAccess?.view && !areaAccess?.edit)
        return
      if (areaAccess.edit)
        roles.push(...materializeRoles(area.editRoles, orgId))
      else
        roles.push(...materializeRoles(area.viewRoles, orgId))
    })
  })

  return mergeRoles(roles)
}

const summarizeFeatureAccess = (roles, orgId) => {
  if (!useFeatureAccess.value)
    return String(edgeGlobal.getRoleName(roles, orgId) || '').trim()

  const access = buildFeatureAccessFromRoles(roles, orgId)
  if (access.orgAdmin)
    return props.featureAccessConfig?.orgAdminLabel || props.featureAccessConfig?.orgAdminRoleName || 'Admin'

  const labels = []
  enabledFeatureAccessFeatures.value.forEach((feature) => {
    const featureAccess = access.features?.[feature.key]
    if (!featureAccess?.enabled)
      return
    if (featureAccess.admin) {
      labels.push(`${feature.label} ${featureAdminControlLabel(feature)}`)
      return
    }
    const areaLabels = (feature.areas || [])
      .filter(area => featureAccess.areas?.[area.key]?.view || featureAccess.areas?.[area.key]?.edit)
      .map((area) => {
        const areaAccess = featureAccess.areas?.[area.key]
        if (areaUsesAllowControl(area))
          return area.label
        return `${area.label} ${areaAccess.edit ? 'edit' : 'view'}`
      })
    const sharedRoles = materializeRoles(feature.sharedRoles, orgId)
    const hasSharedAccess = sharedRoles.length > 0 && roleSetContains(roles || [], sharedRoles)
    if (areaLabels.length)
      labels.push(`${feature.label}: ${areaLabels.join(', ')}`)
    else if (hasSharedAccess)
      labels.push(`${feature.label} view`)
  })

  return labels.join(' / ') || 'No access'
}

const updateFeatureAccessRole = () => {
  if (!useFeatureAccess.value)
    return
  state.workingItem.role = summarizeFeatureAccess(
    buildFeatureAccessRoles(edgeGlobal.edgeState.currentOrganization, state.workingItem.featureAccess) || [],
    edgeGlobal.edgeState.currentOrganization,
  )
}

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
const showOrganizationAccessTab = computed(() =>
  (state.saveButton === 'Invite User' && showInviteOrgSelect.value)
  || (state.saveButton !== 'Invite User' && showEditOrgSelect.value),
)

const organizationAccessTitle = computed(() =>
  state.saveButton === 'Invite User' ? 'Add to organizations' : 'Organizations',
)

const adminCount = computed(() => {
  return users.value.filter((item) => {
    return item.roles.find((role) => {
      return role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-') && role.role === 'admin'
    })
  }).length
})

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

const userRoleName = (user) => {
  return summarizeFeatureAccess(user?.roles, edgeGlobal.edgeState.currentOrganization)
}

const selectedRole = computed(() => {
  if (state.roleFilter === 'all' || state.roleFilter === 'no-role')
    return ''
  return String(state.roleFilter || '').trim()
})

const roleFilterOptions = computed(() => {
  const allRoleNames = Array.from(new Set([
    ...roleNamesOnly.value,
    ...users.value.map(user => userRoleName(user)),
  ]
    .map(name => String(name || '').trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))

  return [
    { name: 'All Roles', docId: 'all' },
    { name: 'No Role', docId: 'no-role' },
    ...allRoleNames.map(role => ({ name: role, docId: role })),
  ]
})

const usersByRoleFilter = computed(() => {
  if (state.roleFilter === 'all')
    return users.value
  if (state.roleFilter === 'no-role')
    return users.value.filter(user => !userRoleName(user))
  if (!selectedRole.value)
    return users.value
  return users.value.filter(user => userRoleName(user) === selectedRole.value)
})

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

  return usersByRoleFilter.value
    .filter((user) => {
      const name = String(user?.meta?.name || '').toLowerCase()
      const email = String(user?.meta?.email || '').toLowerCase()
      return name.includes(filter) || email.includes(filter)
    })
    .sort((a, b) => {
      const lastA = getLastName(a?.meta?.name).toLowerCase()
      const lastB = getLastName(b?.meta?.name).toLowerCase()
      return lastA.localeCompare(lastB)
    })
})
const shownCount = computed(() => sortedFilteredUsers.value.length)
const visibleCount = computed(() => usersByRoleFilter.value.length)
const totalLoadedCount = computed(() => users.value.length)
const hiddenBySearchCount = computed(() => Math.max(visibleCount.value - shownCount.value, 0))

const userIsRegistered = user => Boolean(String(user?.userId || '').trim())

const getMemberHeaderTitle = (member) => {
  const meta = member?.meta || {}
  return String(meta.name || meta.email || '').trim() || 'New Member'
}

const getMemberHeaderSubtitle = (member) => {
  const email = String(member?.meta?.email || '').trim()
  return email || 'Email not set'
}

const userRowTone = (user) => {
  if (userIsRegistered(user))
    return 'border-l-4 border-l-[#003E52] bg-emerald-50/30'
  return 'bg-white dark:bg-slate-950'
}

const detailViewKey = computed(() => {
  if (!state.dialog)
    return 'member-empty'
  return `member-${userKey(state.workingItem) || state.workingItem?.id || 'new'}-${state.saveButton}`
})

const addItem = () => {
  state.saveButton = 'Invite User'
  const newItem = edgeGlobal.dupObject(state.newItem)
  newItem.meta.email = ''
  newItem.meta.name = ''
  newItem.meta.profilephoto = ''
  state.workingItem = newItem
  state.workingItem.id = edgeGlobal.generateShortId()
  if (useFeatureAccess.value) {
    state.workingItem.featureAccess = createDefaultFeatureAccess()
    updateFeatureAccessRole()
  }
  state.memberDetailTab = 'details'
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
  state.workingItem.role = userRoleName(item)
  if (useFeatureAccess.value)
    state.workingItem.featureAccess = buildFeatureAccessFromRoles(item.roles, edgeGlobal.edgeState.currentOrganization)
  state.memberDetailTab = 'details'
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
  }
  state.deleteDialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const closeDialog = () => {
  state.dialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

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

const setFeatureEnabled = (featureKey, checked) => {
  const featureAccess = state.workingItem.featureAccess?.features?.[featureKey]
  if (!featureAccess)
    return
  featureAccess.enabled = checked === true
  if (!featureAccess.enabled) {
    featureAccess.admin = false
    Object.values(featureAccess.areas || {}).forEach((area) => {
      area.view = false
      area.edit = false
    })
  }
  updateFeatureAccessRole()
}

const setFeatureAdmin = (featureKey, checked) => {
  const featureAccess = state.workingItem.featureAccess?.features?.[featureKey]
  if (!featureAccess)
    return
  featureAccess.admin = checked === true
  if (featureAccess.admin)
    featureAccess.enabled = true
  updateFeatureAccessRole()
}

const setFeatureAreaAccess = (featureKey, areaKey, accessKey, checked) => {
  const areaAccess = state.workingItem.featureAccess?.features?.[featureKey]?.areas?.[areaKey]
  const featureAccess = state.workingItem.featureAccess?.features?.[featureKey]
  if (!areaAccess || !featureAccess)
    return
  areaAccess[accessKey] = checked === true
  if (accessKey === 'edit' && checked)
    areaAccess.view = true
  if (accessKey === 'view' && !checked)
    areaAccess.edit = false
  if (areaAccess.view || areaAccess.edit)
    featureAccess.enabled = true
  updateFeatureAccessRole()
}

const setFeatureAreaAllowed = (featureKey, areaKey, checked) => {
  const areaAccess = state.workingItem.featureAccess?.features?.[featureKey]?.areas?.[areaKey]
  const featureAccess = state.workingItem.featureAccess?.features?.[featureKey]
  if (!areaAccess || !featureAccess)
    return
  areaAccess.view = checked === true
  areaAccess.edit = checked === true
  if (areaAccess.view || areaAccess.edit)
    featureAccess.enabled = true
  updateFeatureAccessRole()
}

const setOrgAdminAccess = (checked) => {
  if (!state.workingItem.featureAccess)
    state.workingItem.featureAccess = createDefaultFeatureAccess()
  state.workingItem.featureAccess.orgAdmin = checked === true
  updateFeatureAccessRole()
}

const onSubmit = async () => {
  state.loading = true
  const selectedOrgIds = state.inviteOrgIds.length > 0
    ? state.inviteOrgIds
    : [edgeGlobal.edgeState.currentOrganization]
  const roles = selectedOrgIds.flatMap((orgId) => {
    if (useFeatureAccess.value)
      return buildFeatureAccessRoles(orgId, state.workingItem.featureAccess) || []
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
        const nextRoles = useFeatureAccess.value
          ? buildFeatureAccessRoles(orgId, state.workingItem.featureAccess)
          : edgeGlobal.orgUserRoles(orgId).find(role => role.name === state.workingItem.role)?.roles
        if (!nextRoles)
          continue
        for (const role of existingRoles) {
          if (!nextRoles.some(r => r.collectionPath === role.collectionPath && r.role === role.role)) {
            await edgeFirebase.removeUserRoles(targetUserId, role.collectionPath)
          }
        }
        for (const role of nextRoles) {
          if (!existingRoles.some(r => r.collectionPath === role.collectionPath && r.role === role.role)) {
            await edgeFirebase.storeUserRoles(targetUserId, role.collectionPath, role.role)
          }
        }
      }
    }
    const stagedUserId = state.workingItem.docId
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

const extraMetaFields = computed(() =>
  (props.metaFields || []).filter(field => String(field?.field || '').trim() !== 'name'),
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
      <ResizablePanel class="bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-100 min-w-[400px]" :default-size="22" :min-size="30">
        <div class="flex flex-col h-full">
          <div class="px-3 py-3 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <component :is="edgeGlobal.iconFromMenu(route)" class="h-4 w-4" />
                <span>Members</span>
                <Badge variant="outline" class="rounded-full border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {{ shownCount }} / {{ totalLoadedCount }}
                </Badge>
              </div>
              <edge-shad-button size="sm" class="h-7 bg-slate-900 text-xs text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" @click="addItem()">
                Invite
              </edge-shad-button>
            </div>
            <edge-shad-form>
              <div class="mt-3 flex items-center gap-2">
                <div class="w-1/2 min-w-0">
                  <edge-shad-combobox
                    v-model="state.roleFilter"
                    :items="roleFilterOptions"
                    name="roleFilter"
                    item-title="name"
                    item-value="docId"
                    placeholder="Select role"
                    class="w-full !h-8"
                    aria-label="Filter members by role"
                  />
                </div>
                <div class="w-1/2 min-w-0">
                  <edge-shad-input
                    v-model="state.filter"
                    label=""
                    name="filter"
                    class="h-8 w-full"
                    placeholder="Filter members..."
                    aria-label="Filter members"
                  />
                </div>
              </div>
            </edge-shad-form>
          </div>
          <div class="flex-1 overflow-y-auto">
            <SidebarMenu class="px-2 py-2 space-y-0">
              <SidebarMenuItem
                v-for="user in sortedFilteredUsers"
                :key="userKey(user)"
              >
                <SidebarMenuButton
                  class="w-full !h-auto min-h-[145px] items-start rounded-none border-b border-slate-200/80 px-4 py-5 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                  :class="[
                    userRowTone(user),
                    state.dialog && userKey(state.workingItem) && userKey(state.workingItem) === userKey(user) ? 'bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100' : '',
                  ]"
                  @click="editItem(user)"
                >
                  <div class="flex w-full items-start gap-4" :class="!user.userId ? 'opacity-70' : ''">
                    <Avatar class="h-14 w-14 shrink-0 rounded-md border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden dark:border-slate-700 dark:bg-slate-900">
                      <img
                        v-if="user?.meta?.profilephoto"
                        :src="profileImageUrl(user.meta.profilephoto)"
                        alt=""
                        class="h-full w-full object-cover"
                      >
                      <User v-else width="24" height="24" />
                    </Avatar>
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-[15px] font-semibold leading-tight text-slate-950 dark:text-slate-100">
                          {{ user?.meta?.name || user?.meta?.email || 'Unnamed Member' }}
                        </span>
                        <edge-chip v-if="user.userId === edgeFirebase.user.uid">
                          You
                        </edge-chip>
                      </div>
                      <div class="mt-1 truncate text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                        {{ user?.meta?.email || 'No email available' }}
                      </div>
                      <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        <span>{{ user?.meta?.title || user?.meta?.title2 || 'No title set' }}</span>
                        <span aria-hidden="true">&bull;</span>
                        <span>{{ user?.meta?.phone || user?.meta?.contactPhone || 'No phone' }}</span>
                        <span v-if="!user.userId && user.docId" class="inline-flex items-center gap-1 whitespace-normal">
                          <span aria-hidden="true">&bull;</span>
                          {{ user.docId }}
                          <edge-clipboard-button class="relative top-[1px]" :text="user.docId" />
                        </span>
                      </div>
                      <div class="mt-2">
                        <Badge
                          variant="outline"
                          class="inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium normal-case leading-snug tracking-normal whitespace-normal text-left"
                          :class="userIsRegistered(user) ? 'border-emerald-200 bg-emerald-100 text-emerald-900' : 'border-amber-200 bg-amber-100 text-amber-900'"
                        >
                          <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" :class="userIsRegistered(user) ? 'bg-emerald-500' : 'bg-amber-500'" aria-hidden="true" />
                          {{ userIsRegistered(user) ? userRoleName(user) || 'No role' : 'Pending registration' }}
                        </Badge>
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
              </SidebarMenuItem>
              <div v-if="sortedFilteredUsers.length === 0" class="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
                No members found.
              </div>
            </SidebarMenu>
          </div>
          <div class="shrink-0 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              {{ shownCount }} shown / {{ totalLoadedCount }} loaded
            </div>
            <div class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              {{ hiddenBySearchCount }} hidden by search
            </div>
          </div>
        </div>
      </ResizablePanel>
      <ResizablePanel class="bg-slate-100 dark:bg-slate-950">
        <div class="org-members-detail-panel h-full flex flex-col bg-slate-100 dark:bg-slate-950">
          <Transition name="fade" mode="out-in">
            <div v-if="state.dialog" :key="detailViewKey" class="h-full flex flex-col">
              <edge-shad-form
                :key="userKey(state.workingItem) || state.workingItem?.id || 'member-form'"
                :initial-values="state.workingItem"
                :schema="computedUserSchema"
                class="org-members-detail-form flex flex-col h-full bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
                @submit="onSubmit"
              >
                <slot
                  name="edit-header"
                  :working-item="state.workingItem"
                  :close-dialog="closeDialog"
                  :current-title="state.currentTitle"
                  :loading="state.loading"
                  :save-button="state.saveButton"
                >
                  <div class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                    <div class="px-6 py-6">
                      <div class="text-sm text-slate-500 dark:text-slate-400">
                        Organizations <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                        <span class="font-medium text-slate-900 dark:text-slate-100">Members</span>
                        <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                        <span class="font-medium text-slate-900 dark:text-slate-100">{{ state.workingItem.role || 'Role not set' }}</span>
                      </div>
                      <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div class="min-w-0">
                          <h1 class="line-clamp-2 max-w-5xl text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                            {{ getMemberHeaderTitle(state.workingItem) }}
                          </h1>
                          <div class="mt-3 flex flex-wrap items-center gap-3 text-base text-slate-500 dark:text-slate-400">
                            <span>{{ getMemberHeaderSubtitle(state.workingItem) }}</span>
                            <span v-if="state.workingItem.role" aria-hidden="true">&middot;</span>
                            <span v-if="state.workingItem.role">{{ state.workingItem.role }}</span>
                          </div>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                          <edge-shad-button
                            variant="outline"
                            class="h-10 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                            :disabled="state.loading"
                            @click.prevent="closeDialog"
                          >
                            <X class="mr-2 h-4 w-4" aria-hidden="true" />
                            Close
                          </edge-shad-button>
                          <edge-shad-button
                            type="submit"
                            class="h-10 bg-slate-900 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                            :disabled="state.loading"
                          >
                            <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            <Check v-else class="mr-2 h-4 w-4" aria-hidden="true" />
                            {{ state.loading ? 'Saving...' : state.saveButton }}
                          </edge-shad-button>
                        </div>
                      </div>
                    </div>
                  </div>
                </slot>
                <div class="org-members-detail-body flex-1 overflow-y-auto bg-slate-100 p-6 space-y-4 dark:bg-slate-950">
                  <slot name="edit-fields" :working-item="state.workingItem">
                    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <Tabs class="w-full" :model-value="state.memberDetailTab" @update:model-value="state.memberDetailTab = $event">
                        <TabsList class="mb-4 grid w-full border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800" :class="showOrganizationAccessTab ? 'grid-cols-2' : 'grid-cols-1'">
                          <TabsTrigger value="details" class="text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900">
                            Member Details
                          </TabsTrigger>
                          <TabsTrigger
                            v-if="showOrganizationAccessTab"
                            value="organizations"
                            class="text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:data-[state=active]:bg-slate-100 dark:data-[state=active]:text-slate-900"
                          >
                            Organizations
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="details" class="space-y-4">
                          <div class="flex flex-col gap-4 md:flex-row md:items-stretch">
                            <div class="w-full md:w-[260px] self-stretch space-y-4">
                              <edge-image-picker
                                v-model="state.workingItem.meta.profilephoto"
                                label="Profile Photo"
                                dialog-title="Select Profile Photo"
                                site="clearwater-hub-images"
                                :default-tags="props.defaultImageTags"
                                height-class="h-full min-h-[180px]"
                                :include-cms-all="false"
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
                            </div>
                            <div class="flex-1 space-y-4">
                              <div v-if="useFeatureAccess" class="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                                <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                                  <div>
                                    <div class="text-sm font-semibold">
                                      Access
                                    </div>
                                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      {{ state.workingItem.role || 'No access' }}
                                    </div>
                                  </div>
                                  <edge-shad-checkbox
                                    name="org-admin-access"
                                    :model-value="state.workingItem.featureAccess?.orgAdmin === true"
                                    :disabled="state.workingItem.userId === edgeFirebase.user.uid"
                                    @update:model-value="setOrgAdminAccess"
                                  >
                                    {{ props.featureAccessConfig?.orgAdminLabel || 'Organization Admin' }}
                                  </edge-shad-checkbox>
                                </div>

                                <template v-if="!state.workingItem.featureAccess?.orgAdmin">
                                  <div
                                    v-for="feature in enabledFeatureAccessFeatures"
                                    :key="feature.key"
                                    class="m-4 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
                                  >
                                    <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-100 px-3 py-2 dark:bg-slate-800">
                                      <div>
                                        <span v-if="featureUsesHeaderViewControl(feature)" class="text-sm font-semibold">
                                          {{ feature.label }}
                                        </span>
                                        <edge-shad-checkbox
                                          v-else
                                          :name="`feature-${feature.key}`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.enabled === true"
                                          item-class="!border-0 !p-0 !mt-0 !rounded-none !bg-transparent"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin"
                                          @update:model-value="val => setFeatureEnabled(feature.key, val)"
                                        >
                                          <span class="text-sm font-semibold">{{ feature.label }}</span>
                                        </edge-shad-checkbox>
                                      </div>
                                      <div class="flex flex-wrap items-center gap-4">
                                        <edge-shad-checkbox
                                          v-if="featureUsesHeaderViewControl(feature)"
                                          :name="`feature-${feature.key}-view`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.enabled === true"
                                          item-class="!border-0 !p-0 !mt-0 !rounded-none !bg-transparent"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin"
                                          @update:model-value="val => setFeatureEnabled(feature.key, val)"
                                        >
                                          {{ feature.viewLabel || 'View' }}
                                        </edge-shad-checkbox>
                                        <edge-shad-checkbox
                                          :name="`feature-${feature.key}-admin`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.admin === true"
                                          item-class="!border-0 !p-0 !mt-0 !rounded-none !bg-transparent"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin || !state.workingItem.featureAccess?.features?.[feature.key]?.enabled"
                                          @update:model-value="val => setFeatureAdmin(feature.key, val)"
                                        >
                                          {{ featureAdminControlLabel(feature) }}
                                        </edge-shad-checkbox>
                                      </div>
                                    </div>

                                    <div
                                      v-if="state.workingItem.featureAccess?.features?.[feature.key]?.enabled && !state.workingItem.featureAccess?.features?.[feature.key]?.admin && (feature.areas || []).length"
                                      class="border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
                                    >
                                      <div
                                        class="grid border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400"
                                        :class="(feature.areas || []).some(areaUsesAllowControl) ? 'grid-cols-[minmax(0,1fr)_150px]' : 'grid-cols-[minmax(0,1fr)_96px_96px]'"
                                      >
                                        <div class="pl-4">
                                          Area
                                        </div>
                                        <div v-if="(feature.areas || []).some(areaUsesAllowControl)">
                                          Allow Access
                                        </div>
                                        <div v-if="!(feature.areas || []).some(areaUsesAllowControl)">
                                          View
                                        </div>
                                        <div v-if="!(feature.areas || []).some(areaUsesAllowControl)">
                                          Edit
                                        </div>
                                      </div>
                                      <div
                                        v-for="area in feature.areas || []"
                                        :key="area.key"
                                        class="grid items-center gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0 dark:border-slate-700"
                                        :class="areaUsesAllowControl(area) ? 'grid-cols-[minmax(0,1fr)_150px]' : 'grid-cols-[minmax(0,1fr)_96px_96px]'"
                                      >
                                        <div class="flex items-center gap-3 pl-4">
                                          <div class="h-6 border-l border-slate-300 dark:border-slate-600" aria-hidden="true" />
                                          <div class="text-sm">
                                            {{ area.label }}
                                          </div>
                                        </div>
                                        <edge-shad-checkbox
                                          v-if="areaUsesAllowControl(area)"
                                          :name="`feature-${feature.key}-${area.key}-allow`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.areas?.[area.key]?.view === true || state.workingItem.featureAccess?.features?.[feature.key]?.areas?.[area.key]?.edit === true"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin"
                                          aria-label="Allow access"
                                          @update:model-value="val => setFeatureAreaAllowed(feature.key, area.key, val)"
                                        >
                                          {{ area.accessLabel || 'Allow Access' }}
                                        </edge-shad-checkbox>
                                        <edge-shad-checkbox
                                          v-if="!areaUsesAllowControl(area)"
                                          :name="`feature-${feature.key}-${area.key}-view`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.areas?.[area.key]?.view === true"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin"
                                          aria-label="View access"
                                          @update:model-value="val => setFeatureAreaAccess(feature.key, area.key, 'view', val)"
                                        >
                                          View
                                        </edge-shad-checkbox>
                                        <edge-shad-checkbox
                                          v-if="!areaUsesAllowControl(area)"
                                          :name="`feature-${feature.key}-${area.key}-edit`"
                                          :model-value="state.workingItem.featureAccess?.features?.[feature.key]?.areas?.[area.key]?.edit === true"
                                          :disabled="state.workingItem.userId === edgeFirebase.user.uid || state.workingItem.featureAccess?.orgAdmin"
                                          aria-label="Edit access"
                                          @update:model-value="val => setFeatureAreaAccess(feature.key, area.key, 'edit', val)"
                                        >
                                          Edit
                                        </edge-shad-checkbox>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </div>
                              <edge-g-input
                                v-else
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
                          <Separator class="my-6" />
                          <div class="grid grid-cols-12 gap-2">
                            <div v-for="field in extraMetaFields" :key="field.field" class="mb-3 col-span-12" :class="numColsToTailwind(field.cols)">
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
                                :include-cms-all="false"
                                @update:model-value="val => setByPath(state.workingItem.meta, field.field, val)"
                              />
                              <p v-if="field?.type === 'imagePicker' && field?.disabled" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
                                <p v-if="mergeDisabledNote(field?.hint, field)" class="text-xs text-slate-500 dark:text-slate-400">
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
                        </TabsContent>

                        <TabsContent v-if="showOrganizationAccessTab" value="organizations">
                          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {{ organizationAccessTitle }}
                          </div>
                          <div class="mt-4 grid gap-3 md:grid-cols-2">
                            <template v-if="state.saveButton !== 'Invite User'">
                              <edge-shad-checkbox
                                v-for="org in editOrgOptions"
                                :key="org.docId"
                                :name="`edit-add-org-${org.docId}`"
                                :model-value="state.editOrgIds.includes(org.docId)"
                                @update:model-value="val => updateEditOrgSelection(org.docId, val)"
                              >
                                {{ org.name }}
                              </edge-shad-checkbox>
                            </template>
                            <template v-else>
                              <edge-shad-checkbox
                                v-for="org in inviteOrgOptions"
                                :key="org.docId"
                                :name="`invite-org-${org.docId}`"
                                :model-value="state.inviteOrgIds.includes(org.docId)"
                                @update:model-value="val => updateInviteOrgSelection(org.docId, val)"
                              >
                                {{ org.name }}
                              </edge-shad-checkbox>
                            </template>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </slot>
                </div>
              </edge-shad-form>
            </div>
            <div v-else :key="detailViewKey" class="p-4 text-center flex text-slate-500 h-[calc(100vh-4rem)] justify-center items-center overflow-y-auto bg-white dark:bg-slate-950 dark:text-slate-400">
              <div class="text-4xl">
                <ArrowLeft class="inline-block w-12 h-12 mr-2" /> Select a member to view details.
              </div>
            </div>
          </Transition>
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
