<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const route = useRoute()

// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  mounted: false,
})

useEdgeCmsDialogPositionFix()

const page = computed(() => {
  if (route.params?.page) {
    return route.params.page
  }
  return ''
})

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
    <edge-cms-site
      site="templates"
      :page="page"
    />
  </div>
</template>
