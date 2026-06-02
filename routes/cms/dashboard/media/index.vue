<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  mounted: false,
})

useEdgeCmsDialogPositionFix()

const currentUserHasRoleAt = (suffix, roles = ['user', 'writer', 'editor', 'admin']) => {
  const orgId = edgeGlobal.edgeState.currentOrganization
  const orgPath = `organizations-${String(orgId || '').replaceAll('/', '-')}`
  const collectionPath = suffix ? `${orgPath}-${suffix}` : orgPath
  return (edgeFirebase?.user?.roles || []).some(role =>
    role.collectionPath === collectionPath && roles.includes(role.role),
  )
}

const canEditMedia = computed(() =>
  currentUserHasRoleAt('', ['admin'])
  || currentUserHasRoleAt('global-media', ['editor', 'admin']),
)

definePageMeta({
  middleware: 'auth',
})

onMounted(() => {
  state.mounted = true
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-media-manager
      :include-files="true"
      :read-only="!canEditMedia"
      :mark-pdf-as-flipbook="true"
      media-type-default="images"
    />
  </div>
</template>

<style>

</style>
