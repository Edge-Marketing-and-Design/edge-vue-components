<script setup>
import { Building2, Check, ChevronLeft, ChevronRight, ChevronsUpDown, CircleUser, Group, Loader2, LogOut, Repeat2, Search, Settings, Settings2, User, Users } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
const props = defineProps({
  title: {
    type: String,
    default: 'Organization',
  },
  buttonClass: {
    type: String,
    default: '',
  },
  iconClass: {
    type: String,
    default: '',
  },
  singleOrg: {
    type: Boolean,
    default: false,
  },
})
const edgeFirebase = inject('edgeFirebase')
const cmsMultiOrg = useState('cmsMultiOrg', () => false)
const { singleOrg: envSingleOrg } = useEdgeOrgMode()
const effectiveSingleOrg = computed(() => envSingleOrg.value || props.singleOrg)
const isAdmin = computed(() => {
  const orgRole = edgeFirebase?.user?.roles.find(role =>
    role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'),
  )

  return orgRole && orgRole.role === 'admin'
})
const currentOrgRoleName = computed(() => {
  return String(edgeGlobal.getRoleName(edgeFirebase?.user?.roles || [], edgeGlobal.edgeState.currentOrganization) || '').trim().toLowerCase()
})
const canManageAudienceUsers = computed(() => {
  if (!cmsMultiOrg.value)
    return currentOrgRoleName.value === 'admin'
  return currentOrgRoleName.value === 'admin' || currentOrgRoleName.value === 'site admin'
})
const orgPicker = reactive({
  nameSearch: '',
  currentPageNameFilter: '',
  appliedNameSearch: '',
  loading: false,
  staticSearch: null,
})
const roles = computed(() => edgeFirebase?.user?.roles || [])
const hasRootOrgAccess = computed(() => roles.value.some(role => String(role?.collectionPath || '').trim() === '-'))
const normalOrganizations = computed(() => edgeGlobal.edgeState.organizations || [])
const filterOrganizationsByName = (items, searchValue = orgPicker.nameSearch) => {
  const filter = String(searchValue || '').trim().toLowerCase()
  if (!filter)
    return items
  return items.filter(org => String(org?.name || '').toLowerCase().includes(filter))
}
const staticOrganizations = computed(() => filterOrganizationsByName(Object.values(orgPicker.staticSearch?.results?.data || {}), orgPicker.currentPageNameFilter))
const visibleOrganizations = computed(() => hasRootOrgAccess.value ? staticOrganizations.value : filterOrganizationsByName(normalOrganizations.value))
const currentOrg = computed(() =>
  normalOrganizations.value.find(org => org.docId === edgeGlobal.edgeState.currentOrganization)
  || Object.values(orgPicker.staticSearch?.results?.data || {}).find(org => org.docId === edgeGlobal.edgeState.currentOrganization),
)
const currentOrgName = computed(() => currentOrg.value?.name || 'Organization')
const hasMultipleOrgs = computed(() => hasRootOrgAccess.value || normalOrganizations.value.length > 1)
const orgDialogOpen = ref(false)
const switchingOrgId = ref('')
const route = useRoute()
const router = useRouter()

const staticPageNumber = computed(() => Math.max(orgPicker.staticSearch?.results?.pagination?.length || 1, 1))
const totalLoadedCount = computed(() => hasRootOrgAccess.value ? (orgPicker.staticSearch?.results?.total || 0) : normalOrganizations.value.length)
const shownCount = computed(() => visibleOrganizations.value.length)
const hiddenBySearchCount = computed(() => Math.max(normalOrganizations.value.length - shownCount.value, 0))

const loadStaticOrganizations = async () => {
  if (!hasRootOrgAccess.value || orgPicker.loading)
    return

  orgPicker.loading = true
  orgPicker.appliedNameSearch = String(orgPicker.nameSearch || '').trim()
  try {
    const search = new edgeFirebase.SearchStaticData()
    const query = orgPicker.appliedNameSearch
      ? [
          { field: 'name', operator: '>=', value: orgPicker.appliedNameSearch },
          { field: 'name', operator: '<=', value: `${orgPicker.appliedNameSearch}\uF8FF` },
        ]
      : []
    await search.getData('organizations', query, [{ field: 'name', direction: 'asc' }], 100)
    orgPicker.staticSearch = search
  }
  finally {
    orgPicker.loading = false
  }
}

const nextStaticPage = async () => {
  if (!orgPicker.staticSearch || orgPicker.staticSearch.results.staticIsLastPage || orgPicker.loading)
    return
  orgPicker.loading = true
  try {
    await orgPicker.staticSearch.next()
  }
  finally {
    orgPicker.loading = false
  }
}

const prevStaticPage = async () => {
  if (!orgPicker.staticSearch || orgPicker.staticSearch.results.staticIsFirstPage || orgPicker.loading)
    return
  orgPicker.loading = true
  try {
    await orgPicker.staticSearch.prev()
  }
  finally {
    orgPicker.loading = false
  }
}

const focusOrgPickerSearch = async () => {
  await nextTick()
  const focusInput = () => {
    const inputId = hasRootOrgAccess.value
      ? 'organizationSwitcherCurrentPageNameFilter'
      : 'organizationSwitcherNameSearch'
    document.getElementById(inputId)?.focus()
  }
  focusInput()
  window.setTimeout(focusInput, 50)
}

const openOrgDialog = async () => {
  if (effectiveSingleOrg.value)
    return
  if (hasMultipleOrgs.value) {
    orgDialogOpen.value = true
    await focusOrgPickerSearch()
    if (hasRootOrgAccess.value && !orgPicker.staticSearch)
      await loadStaticOrganizations()
  }
}

watch(orgDialogOpen, async (isOpen) => {
  if (isOpen)
    await focusOrgPickerSearch()
})

const selectOrg = async (orgId) => {
  if (switchingOrgId.value)
    return

  if (!orgId || orgId === edgeGlobal.edgeState.currentOrganization) {
    orgDialogOpen.value = false
    return
  }

  switchingOrgId.value = orgId
  try {
    const preLoginRoute = useState('preLoginRoute')
    preLoginRoute.value = '/app'
    await edgeGlobal.setOrganization(orgId, edgeFirebase)
    orgDialogOpen.value = false
    await router.push('/app/dashboard')
  }
  finally {
    switchingOrgId.value = ''
  }
}

const goTo = (path) => {
  router.push(path)
}

const currentRoutePath = computed(() => {
  const currentRoutePath = route.fullPath.endsWith('/') ? route.fullPath.substring(0, route.fullPath.length - 1) : route.fullPath
  return currentRoutePath
})

const firstPart = computed(() => {
  const firstPart = route.path.split('/')[1]
  return `/${firstPart}`
})
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger v-bind="$attrs" class="flex flex-col items-center" as-child>
      <slot name="trigger">
        <Button size="icon" :class="cn('rounded-full', props.buttonClass)">
          <Settings2 :class="cn('h-5 w-5', props.iconClass)" />
        </Button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <!-- <DropdownMenuItem class="bg-accent"> -->
      <Card class="border-0 p-4 bg-popover shadow-none">
        <CardHeader class="p-0">
          <CardTitle>
            {{ edgeFirebase.user.meta.name }}
          </CardTitle>
          <CardDescription class="p-2">
            {{ edgeFirebase.user.firebaseUser.providerData[0].email }}
          </CardDescription>
        </CardHeader>
      </Card>
      <!-- </DropdownMenuItem> -->
      <DropdownMenuSeparator v-if="!effectiveSingleOrg" />
      <DropdownMenuLabel v-if="!effectiveSingleOrg" class="text-xs text-muted-foreground">
        {{ props.title }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-if="!effectiveSingleOrg"
        class="cursor-pointer text-foreground"
        :disabled="!hasMultipleOrgs"
        @click="openOrgDialog"
      >
        <span class="truncate max-w-[180px]">{{ currentOrgName }}</span>
        <span v-if="hasMultipleOrgs" class="ml-auto text-xs text-muted-foreground">Switch</span>
        <ChevronsUpDown v-if="hasMultipleOrgs" class="h-4 w-4 ml-2" />
      </DropdownMenuItem>
      <template v-if="isAdmin || canManageAudienceUsers">
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-xs text-muted-foreground">
          {{ props.title }} Settings
        </DropdownMenuLabel>
        <DropdownMenuItem
          v-if="isAdmin"
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/organization-settings` }"
          @click="goTo(`${firstPart}/account/organization-settings`)"
        >
          <Settings class="h-4 w-4 mr-2" />
          Settings
          <Check v-if="currentRoutePath === `${firstPart}/account/organization-settings`" class="h-3 w-3 mr-2 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="isAdmin"
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/organization-members` }"
          @click="goTo(`${firstPart}/account/organization-members`)"
        >
          <Users class="h-4 w-4 mr-2" />
          Members
          <Check v-if="currentRoutePath === `${firstPart}/account/organization-members`" class="h-3 w-3 mr-2 ml-auto" />
        </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs text-muted-foreground">
        My Settings
      </DropdownMenuLabel>
      <DropdownMenuItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/my-profile` }"
        @click="goTo(`${firstPart}/account/my-profile`)"
      >
        <User class="h-4 w-4 mr-2" />
        Profile
        <Check v-if="currentRoutePath === `${firstPart}/account/my-profile`" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/my-account` }"
        @click="goTo(`${firstPart}/account/my-account`)"
      >
        <CircleUser class="h-4 w-4 mr-2" />
        Account
        <Check v-if="currentRoutePath === `${firstPart}/account/my-account`" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="!effectiveSingleOrg"
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/my-organizations` }"
        @click="goTo(`${firstPart}/account/my-organizations`)"
      >
        <Group class="h-4 w-4 mr-2" />
        Organizations
        <Check v-if="currentRoutePath === `${firstPart}/account/my-organizations`" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="cursor-pointer" @click="logOut(edgeFirebase, edgeGlobal)">
        <LogOut class="h-4 w-4 mr-2" />
        Logout
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <edge-shad-dialog v-model="orgDialogOpen">
    <DialogContent class="left-0 top-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-slate-100 p-0 shadow-none sm:rounded-none dark:bg-slate-950">
      <div class="shrink-0 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-950">
        <div class="flex items-start justify-between gap-4 pr-10">
          <div class="flex min-w-0 items-start gap-4">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              <Building2 class="h-6 w-6" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <div class="text-sm text-slate-500 dark:text-slate-400">
                Account <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                <span class="font-medium text-slate-900 dark:text-slate-100">Organizations</span>
              </div>
              <DialogTitle class="mt-2 line-clamp-2 text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                Select Organization
              </DialogTitle>
              <DialogDescription class="mt-2 text-left text-sm text-slate-500 dark:text-slate-400">
                Switching updates the active organization for the dashboard.
              </DialogDescription>
            </div>
          </div>
        </div>
        <edge-shad-form>
          <div class="mt-5 flex w-full items-center gap-2">
            <div class="min-w-0 flex-1">
              <edge-shad-input
                v-model="orgPicker.nameSearch"
                label=""
                name="organizationSwitcherNameSearch"
                class="h-9 w-full"
                :placeholder="hasRootOrgAccess ? 'Search by name...' : 'Filter by name...'"
                aria-label="Filter organizations by name"
                @keydown.enter.prevent="hasRootOrgAccess ? loadStaticOrganizations() : null"
              />
            </div>
            <edge-shad-button
              v-if="hasRootOrgAccess"
              size="sm"
              type="button"
              class="h-9 shrink-0 bg-slate-900 text-xs text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              :disabled="orgPicker.loading"
              @click="loadStaticOrganizations"
            >
              <Loader2 v-if="orgPicker.loading" class="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <Search v-else class="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Search
            </edge-shad-button>
          </div>
          <div v-if="hasRootOrgAccess" class="mt-2">
            <edge-shad-input
              v-model="orgPicker.currentPageNameFilter"
              label=""
              name="organizationSwitcherCurrentPageNameFilter"
              class="h-9 w-full"
              placeholder="Filter current page by name..."
              aria-label="Filter current organization page by name"
            />
          </div>
        </edge-shad-form>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-6">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <button
            v-for="org in visibleOrganizations"
            :key="org.docId"
            type="button"
            class="group flex min-h-[132px] w-full flex-col items-start justify-between rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-900/80"
            :class="[
              org.docId === edgeGlobal.edgeState.currentOrganization ? 'border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/30 dark:ring-emerald-800' : '',
            ]"
            :disabled="Boolean(switchingOrgId)"
            @click="selectOrg(org.docId)"
          >
            <div class="flex w-full items-start gap-4">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <Loader2 v-if="switchingOrgId === org.docId" class="h-5 w-5 animate-spin" aria-hidden="true" />
                <Check v-else-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                <Building2 v-else class="h-5 w-5" aria-hidden="true" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="line-clamp-2 text-base font-semibold leading-snug text-slate-950 dark:text-slate-100">
                  {{ org.name || 'Organization' }}
                </div>
                <div class="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">
                  {{ org.docId }}
                </div>
              </div>
            </div>
            <div class="mt-4 flex w-full items-center justify-between gap-3">
              <Badge
                v-if="org.docId === edgeGlobal.edgeState.currentOrganization"
                variant="outline"
                class="rounded-md border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              >
                Current
              </Badge>
              <span v-else class="text-xs font-medium text-slate-500 transition group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200">
                Switch to Org
              </span>
              <Repeat2 v-if="org.docId !== edgeGlobal.edgeState.currentOrganization" class="ml-auto h-4 w-4 text-slate-400 transition group-hover:text-slate-700 dark:group-hover:text-slate-200" aria-hidden="true" />
            </div>
          </button>
          <div v-if="visibleOrganizations.length === 0" class="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            No organizations found.
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-950">
        <template v-if="hasRootOrgAccess">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">
              <div>{{ shownCount }} shown / {{ totalLoadedCount }} loaded</div>
              <div class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                Page {{ staticPageNumber }}<template v-if="orgPicker.appliedNameSearch">
                  · search: {{ orgPicker.appliedNameSearch }}
                </template>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <edge-shad-button size="icon" variant="outline" class="h-8 w-8" :disabled="orgPicker.loading || orgPicker.staticSearch?.results?.staticIsFirstPage" @click="prevStaticPage">
                <ChevronLeft class="h-4 w-4" aria-hidden="true" />
              </edge-shad-button>
              <edge-shad-button size="icon" variant="outline" class="h-8 w-8" :disabled="orgPicker.loading || orgPicker.staticSearch?.results?.staticIsLastPage" @click="nextStaticPage">
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
    </DialogContent>
  </edge-shad-dialog>
</template>
