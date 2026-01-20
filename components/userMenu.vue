<script setup>
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
const isAdmin = computed(() => {
  const orgRole = edgeFirebase?.user?.roles.find(role =>
    role.collectionPath === edgeGlobal.edgeState.organizationDocPath.replaceAll('/', '-'),
  )

  return orgRole && orgRole.role === 'admin'
})
const organizations = computed(() => edgeGlobal.edgeState.organizations || [])
const currentOrg = computed(() => organizations.value.find(org => org.docId === edgeGlobal.edgeState.currentOrganization))
const currentOrgName = computed(() => currentOrg.value?.name || 'Organization')
const hasMultipleOrgs = computed(() => organizations.value.length > 1)
const orgDialogOpen = ref(false)
const openOrgDialog = () => {
  if (hasMultipleOrgs.value) {
    orgDialogOpen.value = true
  }
}
const selectOrg = (orgId) => {
  edgeGlobal.setOrganization(orgId, edgeFirebase)
  orgDialogOpen.value = false
}
const route = useRoute()
const router = useRouter()
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
      <DropdownMenuSeparator v-if="!props.singleOrg" />
      <DropdownMenuLabel v-if="!props.singleOrg" class="text-xs text-muted-foreground">
        {{ props.title }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-if="!props.singleOrg"
        class="cursor-pointer"
        :disabled="!hasMultipleOrgs"
        @click="openOrgDialog"
      >
        <span class="truncate max-w-[180px]">{{ currentOrgName }}</span>
        <span v-if="hasMultipleOrgs" class="ml-auto text-xs text-muted-foreground">Switch</span>
        <ChevronsUpDown v-if="hasMultipleOrgs" class="h-4 w-4 ml-2" />
      </DropdownMenuItem>
      <template v-if="isAdmin">
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-xs text-muted-foreground">
          {{ props.title }} Settings
        </DropdownMenuLabel>
        <DropdownMenuItem
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === `${firstPart}/account/organization-settings` }"
          @click="goTo(`${firstPart}/account/organization-settings`)"
        >
          <Settings class="h-4 w-4 mr-2" />
          Settings
          <Check v-if="currentRoutePath === `${firstPart}/account/organization-settings`" class="h-3 w-3 mr-2 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem
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
        v-if="!props.singleOrg"
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
    <DialogContent class="w-full max-w-3xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Select Organization</DialogTitle>
        <DialogDescription class="text-left">
          Choose an organization to switch context.
        </DialogDescription>
      </DialogHeader>
      <div class="mt-4 flex-1 overflow-y-auto">
        <div class="space-y-2">
          <edge-shad-button
            v-for="org in organizations"
            :key="org.docId"
            variant="ghost"
            class="w-full justify-between"
            @click="selectOrg(org.docId)"
          >
            <span class="truncate text-left">{{ org.name }}</span>
            <Check v-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="h-4 w-4" />
          </edge-shad-button>
        </div>
      </div>
    </DialogContent>
  </edge-shad-dialog>
</template>
