<script setup>
const route = useRoute()

// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  mounted: false,
})

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
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath && state.mounted"
  >
    <edge-cms-site
      :site="site"
      :page="page"
    />
  </div>
</template>
