<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const edgeFirebase = inject('edgeFirebase')
const router = useRouter()

const state = reactive({
  mounted: false,
})
const currentUserHasDomainsRole = (roles) => {
  const orgId = edgeGlobal.edgeState.currentOrganization
  const orgPath = `organizations-${String(orgId || '').replaceAll('/', '-')}`
  return (edgeFirebase?.user?.roles || []).some(role =>
    role.collectionPath === `${orgPath}-domains` && roles.includes(role.role),
  )
}
const canViewDomains = computed(() => {
  return Boolean(
    edgeGlobal.isAdminGlobal(edgeFirebase).value
    || currentUserHasDomainsRole(['user', 'editor', 'admin']),
  )
})

useEdgeCmsDialogPositionFix()

definePageMeta({
  middleware: 'auth',
})

onMounted(() => {
  state.mounted = true
})

watchEffect(() => {
  if (!state.mounted)
    return
  if (canViewDomains.value)
    return
  router.replace('/app/dashboard/sites')
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-registrar />
  </div>
</template>
