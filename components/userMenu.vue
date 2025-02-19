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
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger class="flex flex-col items-center" as-child>
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
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs text-muted-foreground">
        {{ props.title }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="org in edgeGlobal.edgeState.organizations"
        :key="org.docId"
        class="cursor-pointer"
        :class="{ 'bg-accent': org.docId === edgeGlobal.edgeState.currentOrganization }"
        @click="edgeGlobal.setOrganization(org.docId, edgeFirebase)"
      >
        {{ org.name }}
        <Check v-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="h-3 w-3 mr-2 ml-auto" />
        <div v-else class="h-3 w-3 mr-2" />
      </DropdownMenuItem>
      <template v-if="isAdmin">
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-xs text-muted-foreground">
          {{ props.title }} Settings
        </DropdownMenuLabel>
        <DropdownMenuItem
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === '/app/account/organization-settings' }"
          @click="goTo('/app/account/organization-settings')"
        >
          <Settings class="h-4 w-4 mr-2" />
          Settings
          <Check v-if="currentRoutePath === '/app/account/organization-settings'" class="h-3 w-3 mr-2 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === '/app/account/organization-members' }"
          @click="goTo('/app/account/organization-members')"
        >
          <Users class="h-4 w-4 mr-2" />
          Members
          <Check v-if="currentRoutePath === '/app/account/organization-members'" class="h-3 w-3 mr-2 ml-auto" />
        </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs text-muted-foreground">
        My Settings
      </DropdownMenuLabel>
      <DropdownMenuItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-profile' }"
        @click="goTo('/app/account/my-profile')"
      >
        <User class="h-4 w-4 mr-2" />
        Profile
        <Check v-if="currentRoutePath === '/app/account/my-profile'" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-account' }"
        @click="goTo('/app/account/my-account')"
      >
        <CircleUser class="h-4 w-4 mr-2" />
        Account
        <Check v-if="currentRoutePath === '/app/account/my-account'" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-organizations' }"
        @click="goTo('/app/account/my-organizations')"
      >
        <Group class="h-4 w-4 mr-2" />
        Organizations
        <Check v-if="currentRoutePath === '/app/account/my-organizations'" class="h-3 w-3 mr-2 ml-auto" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="cursor-pointer" @click="logOut(edgeFirebase, edgeGlobal)">
        <LogOut class="h-4 w-4 mr-2" />
        Logout
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
