<script setup>
import { defineProps, inject, onBeforeMount, watch } from 'vue'
const props = defineProps({
  type: {
    type: String,
    default: 'login',
  },
  registrationCode: {
    type: String,
    default: '',
  },
  providers: {
    type: Array,
    default: () => ['email'],
  },
  title: {
    type: String,
    default: 'Organization',
  },
  joinMessage: {
    type: String,
    default: 'Join an existing organization',
  },
  termsLinks: {
    type: String,
    default: '',
  },
  singleOrganization: {
    type: Boolean,
    default: false,
  },
  showRequestedOrgId: {
    type: Boolean,
    default: false,
  },
  requestedOrgIdLabel: {
    type: String,
    default: 'Organization ID',
  },
  primaryButtonClasses: {
    type: String,
    default: '',
  },
  secondaryButtonClasses: {
    type: String,
    default: 'w-full',
  },
})

const emit = defineEmits(['update:auth'])

const edgeFirebase = inject('edgeFirebase')
const config = useRuntimeConfig()
const { singleOrg: envSingleOrg } = useEdgeOrgMode()
const effectiveSingleOrganization = computed(() => envSingleOrg.value || props.singleOrganization)
const effectiveRegistrationCode = computed(() =>
  effectiveSingleOrganization.value ? '' : (props.registrationCode || config.public.registrationCode || ''),
)

let activeLoginKey = ''
let completedLoginKey = ''
let activeLoginPromise = null

const getLoginKey = () => {
  const rolesKey = (edgeFirebase.user?.roles || [])
    .map(role => `${role.collectionPath || ''}:${role.role || ''}`)
    .join('|')
  return [
    edgeFirebase.user?.loggedIn === true ? '1' : '0',
    edgeFirebase.user?.uid || '',
    rolesKey,
    edgeGlobal.edgeState.currentOrganization || '',
  ].join('::')
}

const doLogin = async () => {
  const loginKey = getLoginKey()
  if (completedLoginKey === loginKey)
    return
  if (activeLoginPromise && activeLoginKey === loginKey)
    return activeLoginPromise

  activeLoginKey = loginKey
  activeLoginPromise = (async () => {
    edgeGlobal.edgeState.user = edgeFirebase.user
    emit('update:auth', edgeFirebase.user)
    if (edgeFirebase.user.loggedIn) {
      await edgeGlobal.getOrganizations(edgeFirebase)
      const storedOrganization = localStorage.getItem('organizationID')
      if (storedOrganization && edgeGlobal.edgeState.organizations.some(org => org.docId === storedOrganization)) {
        await edgeGlobal.setOrganization(storedOrganization, edgeFirebase)
      }
      else if (edgeGlobal.edgeState.currentOrganization) {
        await edgeGlobal.setOrganization(edgeGlobal.edgeState.currentOrganization, edgeFirebase)
      }
      else if (edgeGlobal.edgeState.organizations.length > 0) {
        await edgeGlobal.setOrganization(edgeGlobal.edgeState.organizations[0].docId, edgeFirebase)
      }
    }
    completedLoginKey = loginKey
  })()

  try {
    await activeLoginPromise
  }
  finally {
    if (activeLoginKey === loginKey)
      activeLoginPromise = null
  }
}
onBeforeMount(() => {
  doLogin()
})
watch(() => [
  edgeFirebase.user?.loggedIn,
  edgeFirebase.user?.uid,
  edgeFirebase.user?.roles?.length,
], async () => {
  doLogin()
})
</script>

<template>
  <edge-auth-login
    v-if="props.type === 'login'"
    :providers="props.providers"
    :primary-button-classes="props.primaryButtonClasses"
    :secondary-button-classes="props.secondaryButtonClasses"
  >
    <slot />
  </edge-auth-login>
  <edge-auth-register
    v-else-if="props.type === 'register'"
    :single-organization="effectiveSingleOrganization"
    :registration-code="effectiveRegistrationCode"
    :title="props.title"
    :join-message="props.joinMessage"
    :providers="props.providers"
    :terms-links="props.termsLinks"
    :show-requested-org-id="props.showRequestedOrgId"
    :requested-org-id-label="props.requestedOrgIdLabel"
    :primary-button-classes="props.primaryButtonClasses"
    :secondary-button-classes="props.secondaryButtonClasses"
  >
    <slot />
  </edge-auth-register>
</template>

<style lang="scss" scoped>

</style>
