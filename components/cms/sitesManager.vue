<script setup>
import { Loader2 } from 'lucide-vue-next'

const edgeFirebase = inject('edgeFirebase')
const isAiBusy = status => status === 'queued' || status === 'running'

const state = reactive({
  filter: '',
})

const isAdmin = computed(() => {
  return edgeGlobal.isAdminGlobal(edgeFirebase).value
})

const disableAddSiteForNonAdmin = true

const currentOrgRoleName = computed(() => {
  return String(edgeGlobal.getRoleName(edgeFirebase?.user?.roles || [], edgeGlobal.edgeState.currentOrganization) || '').toLowerCase()
})

const canAddSite = computed(() => {
  if (!disableAddSiteForNonAdmin)
    return true
  return currentOrgRoleName.value === 'admin'
})

const queryField = computed(() => {
  if (!isAdmin.value) {
    return 'users'
  }
  return ''
})

const queryValue = computed(() => {
  if (!isAdmin.value) {
    return [edgeFirebase?.user?.uid]
  }
  return ''
})

const queryOperator = computed(() => {
  if (!isAdmin.value) {
    return 'array-contains-any'
  }
  return ''
})
</script>

<template>
  <edge-dashboard
    :filter="state.filter"
    :query-field="queryField"
    :query-value="queryValue"
    :query-operator="queryOperator"
    collection="sites"
    class="flex-1 pt-0"
  >
    <template #header-end>
      <edge-shad-button
        v-if="canAddSite"
        class="uppercase bg-primary"
        to="/app/dashboard/sites/new"
      >
        Add Site
      </edge-shad-button>
      <div v-else class="hidden" />
    </template>
    <template #list="slotProps">
      <template v-for="item in slotProps.filtered" :key="item.docId">
        <edge-shad-button
          variant="text"
          class="cursor-pointer w-full flex justify-between items-center py-2 gap-3"
          :to="isAiBusy(item.aiBootstrapStatus) ? undefined : `/app/dashboard/sites/${item.docId}`"
          :disabled="isAiBusy(item.aiBootstrapStatus)"
        >
          <div>
            <Avatar class="cursor-pointer p-0 h-8 w-8 mr-2">
              <FilePenLine class="h-5 w-5" />
            </Avatar>
          </div>
          <div class="grow text-left">
            <div class="text-lg">
              {{ item.name }}
            </div>
            <div v-if="isAiBusy(item.aiBootstrapStatus)" class="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 class="h-3 w-3 animate-spin" />
              <span>AI is preparing this site</span>
            </div>
          </div>
          <div>
            <edge-shad-button
              size="icon"
              class="bg-slate-600 h-7 w-7"
              @click.stop="slotProps.deleteItem(item.docId)"
            >
              <Trash class="h-5 w-5" />
            </edge-shad-button>
          </div>
        </edge-shad-button>
        <Separator class="dark:bg-slate-600" />
      </template>
      <div
        v-if="slotProps.filtered.length === 0 && !isAdmin && disableAddSiteForNonAdmin"
        class="px-4 py-6 text-sm text-muted-foreground"
      >
        No sites are assigned to your account. Contact an organization admin to add a site for you.
      </div>
    </template>
  </edge-dashboard>
</template>
