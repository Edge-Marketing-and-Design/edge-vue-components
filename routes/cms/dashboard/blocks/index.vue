<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const state = reactive({
  mounted: false,
  head: null,
})

useEdgeCmsDialogPositionFix()

definePageMeta({
  middleware: 'auth',
})

useHead(() => (state.head || {}))

onMounted(() => {
  state.mounted = true
})

const setHead = (newHead) => {
  state.head = newHead
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-blocks-manager @head="setHead" />
  </div>
</template>
