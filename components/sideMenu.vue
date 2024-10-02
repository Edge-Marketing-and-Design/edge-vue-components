<script setup>
const props = defineProps({
  title: {
    type: String,
    default: 'Organization(s)',
  },
  menuItems: {
    type: Array,
    default: () => [],
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
  <Command class="h-full  rounded-none">
    <CommandList class="h-full max-h-full">
      <CommandItem value="header" class="!bg-transparent">
        <edge-user-menu button-class="w-6 h-6 bg-primary" icon-class="w-4 h-4" />
      </CommandItem>
      <CommandSeparator class="my-1" />
      <CommandItem
        v-for="(item, key) in props.menuItems"
        :key="key"
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === item.to }"
        :value="item.to"
        @click="goTo(item.to)"
      >
        <edge-tooltip>
          <component :is="item.icon" class="h-4 w-4 m-auto" />
          <template #content>
            {{ item.title }}
          </template>
        </edge-tooltip>
      </CommandItem>
      <CommandSeparator class="my-1" />
      <template v-if="isAdmin">
        <CommandItem
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === '/app/account/organization-settings' }"
          value="organization-settings"
          @click="goTo('/app/account/organization-settings')"
        >
          <edge-tooltip>
            <Settings class="h-4 w-4 m-auto" />
            <template #content>
              {{ props.title }} Settings
            </template>
          </edge-tooltip>
        </CommandItem>
        <CommandItem
          class="cursor-pointer"
          :class="{ 'bg-accent': currentRoutePath === '/app/account/organization-members' }"
          value="organization-members"
          @click="goTo('/app/account/organization-members')"
        >
          <edge-tooltip>
            <Users class="h-4 w-4 m-auto" />
            <template #content>
              Members
            </template>
          </edge-tooltip>
        </CommandItem>
      </template>
      <CommandItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-profile' }"
        value="my-profile"
        @click="goTo('/app/account/my-profile')"
      >
        <edge-tooltip>
          <User class="h-4 w-4 m-auto" />
          <template #content>
            Profile
          </template>
        </edge-tooltip>
      </CommandItem>
      <CommandItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-account' }"
        value="my-account"
        @click="goTo('/app/account/my-account')"
      >
        <edge-tooltip>
          <CircleUser class="h-4 w-4 m-auto" />
          <template #content>
            Account
          </template>
        </edge-tooltip>
      </CommandItem>
      <CommandItem
        class="cursor-pointer"
        :class="{ 'bg-accent': currentRoutePath === '/app/account/my-organizations' }"
        value="my-organizations"
        @click="goTo('/app/account/my-organizations')"
      >
        <edge-tooltip>
          <Group class="h-4 w-4 m-auto" />
          <template #content>
            My {{ props.title }}
          </template>
        </edge-tooltip>
      </CommandItem>
      <CommandSeparator class="my-1" />
      <CommandItem value="logout" class="cursor-pointer" @click="logOut(edgeFirebase, edgeGlobal)">
        <edge-tooltip>
          <LogOut class="h-4 w-4 m-auto" />
          <template #content>
            Log Out
          </template>
        </edge-tooltip>
      </CommandItem>
    </CommandList>
  </Command>
</template>
