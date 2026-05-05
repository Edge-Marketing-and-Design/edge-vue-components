<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

useEdgeCmsDialogPositionFix()

const siteDeleteDisabled = ['q7FiUf9azXLLA4haKDWt']

definePageMeta({
  middleware: 'auth',
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-cms-sites-manager :site-delete-disabled="siteDeleteDisabled" />
  </div>
</template>
