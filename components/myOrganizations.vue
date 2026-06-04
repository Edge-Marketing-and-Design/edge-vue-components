<script setup>
import { Building2, Check, ChevronLeft, ChevronRight, Loader2, Plus, Repeat2, Search, X } from 'lucide-vue-next'
import { computed, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'

const props = defineProps({
  registrationCode: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    default: 'My Organizations',
  },
  subscribeOptions: {
    type: Array,
    default: () => [],
  },
  orgFields: {
    type: [Array, Object],
    required: true,
  },
  formSchema: {
    type: Object,
    required: true,
  },
  fieldSections: {
    type: Array,
    default: () => [],
  },
  sectionDisplay: {
    type: String,
    default: 'none',
  },
  sectionHeader: {
    type: String,
    default: '',
  },
  renderUnsectionedFieldsWhenSectioned: {
    type: Boolean,
    default: false,
  },
  featureAccessConfig: {
    type: Object,
    default: null,
  },
})

const edgeFirebase = inject('edgeFirebase')
const route = useRoute()

const state = reactive({
  loaded: false,
  loading: false,
  nameSearch: '',
  currentPageNameFilter: '',
  appliedNameSearch: '',
  staticSearch: null,
  selectedOrgId: '',
  dialog: false,
  deleteDialog: false,
  currentTitle: '',
  saveButton: 'Add Organization',
  workingItem: {},
  bringUserIds: [],
})

const register = reactive({
  registrationCode: props.registrationCode,
  dynamicDocumentFieldValue: '',
})

const newItem = {
  name: '',
}

const roles = computed(() => edgeFirebase.user.roles || [])
const hasDashAccess = computed(() => roles.value.some(role => String(role?.collectionPath || '').trim() === '-'))
const rootRole = computed(() => roles.value.find(role => String(role?.collectionPath || '').trim() === '-'))
const hasRootWriteAccess = computed(() =>
  roles.value.some(role =>
    String(role?.collectionPath || '').trim() === '-'
    && ['admin', 'editor', 'writer'].includes(String(role?.role || '').trim()),
  ),
)
const users = computed(() => Object.values(edgeFirebase.state?.users || {}))
const bringUserOptions = computed(() => users.value.filter(user => user.userId !== edgeFirebase.user.uid))
const showBringUsers = computed(() => state.saveButton === 'Add Organization' && bringUserOptions.value.length > 0)

const filterOrganizationsByName = (items, searchValue = state.nameSearch) => {
  const filter = String(searchValue || '').trim().toLowerCase()
  if (!filter)
    return items
  return items.filter(org => String(org?.name || '').toLowerCase().includes(filter))
}

const staticOrganizations = computed(() => filterOrganizationsByName(Object.values(state.staticSearch?.results?.data || {}), state.currentPageNameFilter))

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
const orgCollectionPath = orgId => `organizations-${String(orgId).replaceAll('/', '-')}`
const materializeRoles = (roleItems, orgId) =>
  (roleItems || [])
    .filter(role => role?.collectionPath && role?.role)
    .map(role => ({
      collectionPath: String(role.collectionPath || '').replace(/organizationDocPath/g, orgCollectionPath(orgId)),
      role: role.role,
    }))
const roleSatisfies = (sourceRole, targetRole) =>
  sourceRole.collectionPath === targetRole.collectionPath
  && (roleStrength[sourceRole.role] || 0) >= (roleStrength[targetRole.role] || 0)
const roleSetContains = (sourceRoles, targetRoles) =>
  targetRoles.every(target =>
    sourceRoles.some(role => roleSatisfies(role, target)),
  )
const featureAdminControlLabel = feature =>
  (feature.areas || []).length ? (feature.adminLabel || 'Admin') : (feature.editLabel || 'Edit')
const areaUsesAllowControl = area => area?.accessMode === 'allow'
const summarizeFeatureAccess = (roleItems, orgId) => {
  if (!useFeatureAccess.value)
    return ''

  const orgAdminRoleName = props.featureAccessConfig?.orgAdminRoleName || 'Admin'
  if (edgeGlobal.getRoleName(roleItems, orgId) === orgAdminRoleName)
    return props.featureAccessConfig?.orgAdminLabel || orgAdminRoleName

  const labels = []
  enabledFeatureAccessFeatures.value.forEach((feature) => {
    const adminRoles = materializeRoles(feature.adminRoles, orgId)
    if (adminRoles.length > 0 && roleSetContains(roleItems || [], adminRoles)) {
      labels.push(`${feature.label} ${featureAdminControlLabel(feature)}`)
      return
    }

    const areaLabels = (feature.areas || [])
      .filter((area) => {
        const viewRoles = materializeRoles(area.viewRoles, orgId)
        const editRoles = materializeRoles(area.editRoles, orgId)
        return (viewRoles.length > 0 && roleSetContains(roleItems || [], viewRoles))
          || (editRoles.length > 0 && roleSetContains(roleItems || [], editRoles))
      })
      .map((area) => {
        if (areaUsesAllowControl(area))
          return area.label
        const editRoles = materializeRoles(area.editRoles, orgId)
        const hasEditAccess = editRoles.length > 0 && roleSetContains(roleItems || [], editRoles)
        return `${area.label} ${hasEditAccess ? 'edit' : 'view'}`
      })

    const sharedRoles = materializeRoles(feature.sharedRoles, orgId)
    const hasSharedAccess = sharedRoles.length > 0 && roleSetContains(roleItems || [], sharedRoles)
    if (areaLabels.length)
      labels.push(`${feature.label}: ${areaLabels.join(', ')}`)
    else if (hasSharedAccess)
      labels.push(`${feature.label} ${feature.viewLabel || 'view'}`)
  })

  return labels.join(' / ')
}

const roleNameForOrg = (orgId) => {
  const roleName = edgeGlobal.getRoleName(roles.value, orgId)
  if (roleName !== 'Unknown')
    return roleName
  const featureSummary = summarizeFeatureAccess(roles.value, orgId)
  if (featureSummary)
    return featureSummary
  if (hasDashAccess.value)
    return rootRole.value?.role ? `Root ${rootRole.value.role}` : '-'
  return roleName
}

const canEditOrg = (org) => {
  if (!org?.docId)
    return false
  if (hasRootWriteAccess.value)
    return true
  const orgPath = `organizations-${String(org.docId || '').replaceAll('/', '-')}`
  if (roles.value.some(role =>
    role.collectionPath === orgPath && ['admin', 'editor', 'writer'].includes(String(role.role || '').trim()),
  )) {
    return true
  }
  const roleName = String(roleNameForOrg(org.docId) || '').trim().toLowerCase()
  return roleName === 'admin'
}

const normalOrganizations = computed(() => {
  return filterOrganizationsByName(edgeGlobal.edgeState.organizations || [])
})

const organizations = computed(() => hasDashAccess.value ? staticOrganizations.value : normalOrganizations.value)
const selectedOrg = computed(() => organizations.value.find(org => org.docId === state.selectedOrgId) || null)
const selectedOrgDocPath = computed(() => state.selectedOrgId ? `organizations/${state.selectedOrgId}` : '')
const selectedOrgData = computed(() =>
  (selectedOrgDocPath.value && edgeFirebase.data?.[selectedOrgDocPath.value])
    ? edgeFirebase.data[selectedOrgDocPath.value]
    : selectedOrg.value,
)
const selectedRoleName = computed(() => selectedOrg.value ? roleNameForOrg(selectedOrg.value.docId) : '')
const selectedCanEdit = computed(() => selectedOrg.value && canEditOrg(selectedOrg.value))
const selectedCanOpenSettings = computed(() => selectedCanEdit.value)
const selectedIsCurrentOrg = computed(() => selectedOrg.value?.docId === edgeGlobal.edgeState.currentOrganization)
const totalLoadedCount = computed(() => hasDashAccess.value ? (state.staticSearch?.results?.total || 0) : (edgeGlobal.edgeState.organizations?.length || 0))
const shownCount = computed(() => organizations.value.length)
const hiddenBySearchCount = computed(() => Math.max((edgeGlobal.edgeState.organizations?.length || 0) - shownCount.value, 0))
const staticPageNumber = computed(() => Math.max(state.staticSearch?.results?.pagination?.length || 1, 1))

const selectInitialOrganization = async () => {
  const currentOrgId = edgeGlobal.edgeState.currentOrganization
  const currentInList = organizations.value.find(org => org.docId === currentOrgId)
  const nextOrg = currentInList || organizations.value[0] || null
  if (nextOrg)
    await selectOrganization(nextOrg)
  else
    state.selectedOrgId = ''
}

const loadStaticOrganizations = async () => {
  if (!hasDashAccess.value)
    return
  state.loading = true
  state.appliedNameSearch = String(state.nameSearch || '').trim()

  const search = new edgeFirebase.SearchStaticData()
  const query = state.appliedNameSearch
    ? [
        { field: 'name', operator: '>=', value: state.appliedNameSearch },
        { field: 'name', operator: '<=', value: `${state.appliedNameSearch}\uF8FF` },
      ]
    : []
  try {
    await search.getData('organizations', query, [{ field: 'name', direction: 'asc' }], 100)
    state.staticSearch = search
  }
  finally {
    state.loading = false
  }
  await selectInitialOrganization()
}

const nextStaticPage = async () => {
  if (!state.staticSearch || state.staticSearch.results.staticIsLastPage || state.loading)
    return
  state.loading = true
  await state.staticSearch.next()
  state.loading = false
  await selectInitialOrganization()
}

const prevStaticPage = async () => {
  if (!state.staticSearch || state.staticSearch.results.staticIsFirstPage || state.loading)
    return
  state.loading = true
  await state.staticSearch.prev()
  state.loading = false
  await selectInitialOrganization()
}

async function selectOrganization(org) {
  if (!org?.docId)
    return
  state.selectedOrgId = org.docId
  if (!edgeFirebase.data?.[`organizations/${org.docId}`])
    await edgeFirebase.startDocumentSnapshot('organizations', org.docId)
}

const switchToSelectedOrganization = async () => {
  if (!selectedOrg.value?.docId || selectedIsCurrentOrg.value)
    return
  state.loading = true
  await edgeGlobal.setOrganization(selectedOrg.value.docId, edgeFirebase)
  state.loading = false
}

const addItem = () => {
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
  state.bringUserIds = []
  state.dialog = true
}

const closeDialog = () => {
  state.dialog = false
  edgeGlobal.edgeState.changeTracker = {}
}

const deleteConfirm = (item) => {
  state.currentTitle = item.name
  state.workingItem = edgeGlobal.dupObject(item)
  state.deleteDialog = true
}

const deleteAction = async () => {
  const orgId = String(state.workingItem?.docId || '').trim()
  const stagedDocId = String(edgeFirebase.user?.stagedDocId || '').trim()
  const orgPath = `organizations-${orgId}`
  const removableRoles = roles.value.filter(role =>
    role.collectionPath === orgPath || String(role.collectionPath || '').startsWith(`${orgPath}-`),
  )
  for (const role of removableRoles)
    await edgeFirebase.removeUserRoles(stagedDocId, role.collectionPath.replaceAll('-', '/'))
  state.deleteDialog = false
  edgeGlobal.edgeState.changeTracker = {}
  await edgeGlobal.getOrganizations(edgeFirebase)
  if (hasDashAccess.value)
    await loadStaticOrganizations()
  else
    await selectInitialOrganization()
}

const updateBringUserSelection = (docId, checked) => {
  const selections = new Set(state.bringUserIds)
  if (checked)
    selections.add(docId)
  else
    selections.delete(docId)
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
    for (const role of roleMatch.roles)
      await edgeFirebase.storeUserRoles(user.docId, role.collectionPath, role.role)
  }
}

const waitForNewOrgRole = async (previousOrgPaths) => {
  const maxAttempts = 30
  const delayMs = 300
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentOrgRoles = roles.value.filter(role => role.collectionPath.startsWith('organizations-'))
    const newOrgRole = currentOrgRoles.find(role => !previousOrgPaths.includes(role.collectionPath))
    if (newOrgRole)
      return newOrgRole
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  return null
}

const onSubmit = async () => {
  const registerSend = edgeGlobal.dupObject(register)
  state.loading = true
  const existingOrgPaths = roles.value
    .filter(role => role.collectionPath.startsWith('organizations-'))
    .map(role => role.collectionPath)

  if (state.saveButton === 'Add Organization') {
    registerSend.dynamicDocumentFieldValue = state.workingItem.name
  }
  else {
    registerSend.dynamicDocumentFieldValue = ''
    registerSend.registrationCode = state.workingItem.name
  }

  await edgeFirebase.currentUserRegister(registerSend)
  await edgeGlobal.getOrganizations(edgeFirebase)

  if (state.saveButton === 'Add Organization') {
    const newOrgRole = await waitForNewOrgRole(existingOrgPaths)
    const newOrgId = newOrgRole?.collectionPath?.replace('organizations-', '')
    if (newOrgId)
      await addUsersToOrganization(newOrgId)
  }

  edgeGlobal.edgeState.changeTracker = {}
  state.dialog = false
  state.loading = false
  if (hasDashAccess.value)
    await loadStaticOrganizations()
  else
    await selectInitialOrganization()
}

const refreshOrganizations = async () => {
  await edgeGlobal.getOrganizations(edgeFirebase)
  if (hasDashAccess.value)
    await loadStaticOrganizations()
  else
    await selectInitialOrganization()
}

watch(roles, async () => {
  state.loaded = false
  await refreshOrganizations()
  await nextTick()
  state.loaded = true
})

watch(
  () => edgeGlobal.edgeState.currentOrganization,
  (nextOrg) => {
    if (nextOrg && !state.selectedOrgId)
      state.selectedOrgId = nextOrg
  },
)

onBeforeMount(async () => {
  await refreshOrganizations()
  state.loaded = true
})
</script>

<template>
  <div v-if="state.loaded" class="w-full flex-1 min-h-0 h-[calc(100vh-58px)] overflow-hidden">
    <ResizablePanelGroup direction="horizontal" class="w-full h-full flex-1">
      <ResizablePanel class="min-w-[400px] bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-100" :default-size="30" :min-size="30">
        <div class="flex h-full flex-col">
          <div class="border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <component :is="edgeGlobal.iconFromMenu(route)" class="h-4 w-4" />
                <span>{{ props.title }}</span>
                <Badge variant="outline" class="rounded-full border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {{ shownCount }} / {{ totalLoadedCount }}
                </Badge>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <edge-shad-button v-if="props.registrationCode" size="sm" class="h-7 bg-slate-900 text-xs text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300" @click="addItem">
                  <Plus class="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Add
                </edge-shad-button>
                <edge-shad-button size="sm" variant="outline" class="h-7 border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="joinOrg">
                  Join
                </edge-shad-button>
              </div>
            </div>
            <edge-shad-form>
              <div class="mt-3 flex w-full items-center gap-2">
                <div class="min-w-0 flex-1">
                  <edge-shad-input
                    v-model="state.nameSearch"
                    label=""
                    name="organizationNameSearch"
                    class="h-8 w-full"
                    :placeholder="hasDashAccess ? 'Search by name...' : 'Filter by name...'"
                    aria-label="Filter organizations by name"
                    @keydown.enter.prevent="hasDashAccess ? loadStaticOrganizations() : null"
                  />
                </div>
                <edge-shad-button
                  v-if="hasDashAccess"
                  size="sm"
                  type="button"
                  class="h-8 shrink-0 bg-slate-900 text-xs text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                  :disabled="state.loading"
                  @click="loadStaticOrganizations"
                >
                  <Loader2 v-if="state.loading" class="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <Search v-else class="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Search
                </edge-shad-button>
              </div>
              <div v-if="hasDashAccess" class="mt-2">
                <edge-shad-input
                  v-model="state.currentPageNameFilter"
                  label=""
                  name="organizationCurrentPageNameFilter"
                  class="h-8 w-full"
                  placeholder="Filter current page by name..."
                  aria-label="Filter current organization page by name"
                />
              </div>
            </edge-shad-form>
          </div>

          <div class="flex-1 overflow-y-auto">
            <SidebarMenu class="space-y-0 px-2 py-2">
              <SidebarMenuItem v-for="org in organizations" :key="org.docId">
                <SidebarMenuButton
                  class="w-full !h-auto min-h-[96px] items-start rounded-none border-b border-slate-200/80 px-4 py-4 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                  :class="[
                    state.selectedOrgId === org.docId ? 'border-l-4 border-l-emerald-600 bg-emerald-50/70 text-slate-950 ring-1 ring-inset ring-slate-300 dark:bg-emerald-950/30 dark:text-slate-100 dark:ring-slate-700' : 'bg-white dark:bg-slate-950',
                  ]"
                  @click="selectOrganization(org)"
                >
                  <div class="flex w-full items-start gap-4">
                    <Avatar class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                      <Check v-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                      <Building2 v-else class="h-5 w-5 text-slate-500" aria-hidden="true" />
                    </Avatar>
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-[15px] font-semibold leading-tight text-slate-950 dark:text-slate-100">
                          {{ org.name || 'Organization' }}
                        </span>
                        <edge-chip v-if="org.docId === edgeGlobal.edgeState.currentOrganization">
                          Current
                        </edge-chip>
                      </div>
                      <div class="mt-1 truncate text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                        {{ org.docId }}
                      </div>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" class="rounded-md border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {{ roleNameForOrg(org.docId) }}
                        </Badge>
                      </div>
                    </div>
                    <edge-shad-button
                      size="sm"
                      variant="outline"
                      class="h-7 border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                      @click.stop="deleteConfirm(org)"
                    >
                      Leave
                    </edge-shad-button>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <div v-if="organizations.length === 0" class="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
                No organizations found.
              </div>
            </SidebarMenu>
          </div>

          <div class="shrink-0 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <template v-if="hasDashAccess">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">
                  <div>{{ shownCount }} shown / {{ totalLoadedCount }} matching</div>
                  <div class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    Page {{ staticPageNumber }}<template v-if="state.appliedNameSearch">
                      · search: {{ state.appliedNameSearch }}
                    </template>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <edge-shad-button size="icon" variant="outline" class="h-7 w-7" :disabled="state.loading || state.staticSearch?.results?.staticIsFirstPage" @click="prevStaticPage">
                    <ChevronLeft class="h-4 w-4" aria-hidden="true" />
                  </edge-shad-button>
                  <edge-shad-button size="icon" variant="outline" class="h-7 w-7" :disabled="state.loading || state.staticSearch?.results?.staticIsLastPage" @click="nextStaticPage">
                    <ChevronRight class="h-4 w-4" aria-hidden="true" />
                  </edge-shad-button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ shownCount }} shown / {{ totalLoadedCount }} available
              </div>
              <div class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                {{ hiddenBySearchCount }} hidden by filter
              </div>
            </template>
          </div>
        </div>
      </ResizablePanel>

      <ResizablePanel class="bg-slate-100 dark:bg-slate-950">
        <div class="h-full bg-slate-100 dark:bg-slate-950">
          <Transition name="fade" mode="out-in">
            <div v-if="selectedOrg" :key="`${selectedOrg.docId}-${selectedCanOpenSettings ? 'edit' : 'read'}`" class="h-full">
              <edge-organization-settings
                v-if="selectedCanOpenSettings"
                :subscribe-options="props.subscribeOptions"
                :form-schema="props.formSchema"
                :org-fields="props.orgFields"
                :organization-id="selectedOrg.docId"
                :organization-data="selectedOrgData"
                :show-close="true"
                :field-sections="props.fieldSections"
                :section-header="props.sectionHeader"
                :section-display="props.sectionDisplay"
                :render-unsectioned-fields-when-sectioned="props.renderUnsectionedFieldsWhenSectioned"
                class="h-full pt-0"
                @close="state.selectedOrgId = ''"
              >
                <template #header-actions>
                  <edge-shad-button
                    variant="outline"
                    class="h-10 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    :disabled="selectedIsCurrentOrg || state.loading"
                    @click.prevent="switchToSelectedOrganization"
                  >
                    <Repeat2 class="mr-2 h-4 w-4" aria-hidden="true" />
                    {{ selectedIsCurrentOrg ? 'Current Org' : 'Switch to Org' }}
                  </edge-shad-button>
                </template>
              </edge-organization-settings>
              <div v-else class="flex h-full flex-col">
                <div class="border-b border-slate-200 bg-white px-6 py-6 dark:border-slate-800 dark:bg-slate-950">
                  <div class="text-sm text-slate-500 dark:text-slate-400">
                    Account <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                    <span class="font-medium text-slate-900 dark:text-slate-100">My Organizations</span>
                  </div>
                  <div class="mt-4 flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <h1 class="line-clamp-2 text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                        {{ selectedOrg.name || 'Organization' }}
                      </h1>
                      <div class="mt-3 flex flex-wrap items-center gap-3 text-base text-slate-500 dark:text-slate-400">
                        <span>{{ selectedOrg.docId }}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>{{ selectedRoleName }}</span>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <edge-shad-button
                        variant="outline"
                        class="h-10 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        :disabled="selectedIsCurrentOrg || state.loading"
                        @click.prevent="switchToSelectedOrganization"
                      >
                        <Repeat2 class="mr-2 h-4 w-4" aria-hidden="true" />
                        {{ selectedIsCurrentOrg ? 'Current Org' : 'Switch to Org' }}
                      </edge-shad-button>
                      <edge-shad-button variant="outline" class="h-10 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="state.selectedOrgId = ''">
                        <X class="mr-2 h-4 w-4" aria-hidden="true" />
                        Close
                      </edge-shad-button>
                    </div>
                  </div>
                </div>
                <div class="flex-1 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">
                  <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Organization Access
                    </div>
                    <div class="mt-4 grid gap-4 md:grid-cols-2">
                      <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Current Role
                        </div>
                        <div class="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-100">
                          {{ selectedRoleName }}
                        </div>
                      </div>
                      <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Available Actions
                        </div>
                        <edge-shad-button variant="outline" class="mt-3 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70" @click="deleteConfirm(selectedOrg)">
                          Leave Organization
                        </edge-shad-button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else key="empty" class="flex h-full items-center justify-center bg-slate-100 p-6 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              Select an organization to view details.
            </div>
          </Transition>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

    <edge-shad-dialog v-model="state.deleteDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Leave Organization
          </DialogTitle>
        </DialogHeader>
        <DialogDescription />
        <h3 v-if="roleNameForOrg(state.workingItem.docId) === 'User'">
          Are you sure you want to leave the organization "{{ state.currentTitle }}"? You will no longer have access to any of the organization's data.
        </h3>
        <h3 v-else>
          As an admin, you cannot leave the organization "{{ state.currentTitle }}" from this screen. Please go to the organization's members page to remove yourself.
        </h3>
        <DialogFooter class="flex justify-between pt-6">
          <edge-shad-button class="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" variant="outline" @click="state.deleteDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            v-if="roleNameForOrg(state.workingItem.docId) === 'User'"
            class="w-full"
            variant="destructive"
            @click="deleteAction"
          >
            Leave
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.dialog">
      <DialogContent>
        <edge-shad-form @submit="onSubmit">
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
            <div class="mt-2 flex w-full flex-wrap gap-2">
              <div v-for="user in bringUserOptions" :key="user.docId" class="min-w-[220px] flex-1">
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
          <DialogFooter class="flex justify-between pt-6">
            <edge-shad-button variant="outline" class="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900" @click="closeDialog">
              Close
            </edge-shad-button>
            <edge-shad-button
              :disabled="state.loading"
              class="w-100 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              type="submit"
            >
              <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" />
              {{ state.saveButton }}
            </edge-shad-button>
          </DialogFooter>
        </edge-shad-form>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
