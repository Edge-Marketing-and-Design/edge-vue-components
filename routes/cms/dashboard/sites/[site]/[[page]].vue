<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const route = useRoute()

// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  mounted: false,
  head: null,
})

useEdgeCmsDialogPositionFix()

const page = computed(() => {
  if (route.params?.page) {
    return route.params.page
  }
  return ''
})

const site = computed(() => {
  if (route.params?.site) {
    return route.params.site
  }
  return ''
})

definePageMeta({
  middleware: 'auth',
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
    <edge-cms-page
      :site="site"
      :page="page"
      @head="setHead"
    />
  </div>
</template>
