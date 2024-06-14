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
    default: 'text-white w-full bg-slate-800 hover:bg-slate-400',
  },
  secondaryButtonClasses: {
    type: String,
    default: 'bg-slate-400 w-full text-black hover:bg-slate-100',
  },
})

const emit = defineEmits(['update:auth'])

const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const doLogin = async () => {
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
}
onBeforeMount(() => {
  doLogin()
})
watch(edgeFirebase.user, async () => {
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
    :single-organization="props.singleOrganization"
    :registration-code="props.registrationCode"
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
