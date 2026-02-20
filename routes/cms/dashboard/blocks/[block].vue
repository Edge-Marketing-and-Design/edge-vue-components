<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const route = useRoute()
const state = reactive({
  mounted: false,
  head: null,
})

useEdgeCmsDialogPositionFix()

definePageMeta({
  middleware: 'auth',
})

const blockId = computed(() => {
  if (route.params.block) {
    return route.params.block
  }
  return ''
})

onMounted(() => {
  state.mounted = true
})

useHead(() => (state.head || {}))

const setHead = (newHead) => {
  state.head = newHead
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-block-editor
      :block-id="blockId"
      @head="setHead"
    />
  </div>
</template>
