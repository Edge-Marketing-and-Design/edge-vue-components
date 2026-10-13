/* global edgeGlobal */
import { computed, inject } from 'vue'
import { organizationBlockTags } from '../lib/cmsBlockTags'

// The active organization's block tag list, from the organization snapshot
// the Hub keeps for every organization the user belongs to. Empty means
// unrestricted.
export const useCmsBlockTagList = () => {
  const edgeFirebase = inject('edgeFirebase')
  return computed(() => {
    const orgId = String(edgeGlobal.edgeState.currentOrganization || '').trim()
    return orgId ? organizationBlockTags(edgeFirebase?.data?.[`organizations/${orgId}`]) : []
  })
}
