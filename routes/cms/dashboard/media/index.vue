<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const state = reactive({
  mounted: false,
})

useEdgeCmsDialogPositionFix()

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
    <edge-cms-media-manager :include-files="true" :mark-pdf-as-flipbook="true" />
  </div>
</template>

<style>

</style>
