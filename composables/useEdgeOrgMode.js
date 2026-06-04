import { computed } from 'vue'
import { useRuntimeConfig } from '#imports'

export const useEdgeOrgMode = () => {
  const config = useRuntimeConfig()

  const singleOrg = computed(() =>
    String(config.public.singleOrg || '').trim().toLowerCase() === 'true',
  )

  const cmsMultiOrg = computed(() => !singleOrg.value)

  const shouldHideForSingleOrg = (item = {}) => {
    if (!singleOrg.value)
      return false
    return String(item?.to || '').replace(/\/$/, '') === '/app/account/my-organizations'
  }

  const filterSingleOrgMenuItems = (items = []) => {
    if (!Array.isArray(items))
      return []
    return items
      .filter(item => !shouldHideForSingleOrg(item))
      .map(item => ({
        ...item,
        submenu: Array.isArray(item.submenu)
          ? filterSingleOrgMenuItems(item.submenu)
          : item.submenu,
      }))
  }

  return {
    singleOrg,
    cmsMultiOrg,
    filterSingleOrgMenuItems,
    shouldHideForSingleOrg,
  }
}
