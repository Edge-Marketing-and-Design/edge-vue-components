<script setup>
import { useEdgeCmsDialogPositionFix } from '~/edge/composables/useEdgeCmsDialogPositionFix'

const edgeFirebase = inject('edgeFirebase')
const router = useRouter()

const state = reactive({
  mounted: false,
})
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)

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
  if (isAdmin.value)
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
