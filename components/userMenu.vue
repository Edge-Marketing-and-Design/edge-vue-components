<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
  title: {
    type: String,
    default: 'Organization(s)',
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
      <Card class="border-0 p-2 bg-popover shadow-none">
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
      <template v-for="org in edgeGlobal.edgeState.organizations">
        <DropdownMenuItem
          v-if="!props.singleOrg"
          :key="org.docId"
          class="cursor-pointer"
          :class="{ 'bg-accent': org.docId === edgeGlobal.edgeState.currentOrganization }"
          @click="edgeGlobal.setOrganization(org.docId, edgeFirebase)"
        >
          {{ org.name }}
          <Check v-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="h-3 w-3 mr-2 ml-auto" />
          <div v-else class="h-3 w-3 mr-2" />
        </DropdownMenuItem>
      </template>
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
</template>
