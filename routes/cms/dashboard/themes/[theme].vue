<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const route = useRoute()
const state = reactive({
  mounted: false,
})

useEdgeCmsDialogPositionFix()

definePageMeta({
  middleware: 'auth',
  head: null,
})

const themeId = computed(() => {
  if (route.params.theme) {
    return route.params.theme
  }
  return ''
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
    <edge-cms-theme-editor
      :theme-id="themeId"
      @head="setHead"
    />
  </div>
</template>
