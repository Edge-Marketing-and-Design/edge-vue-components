import { computed } from 'vue'

export const useEdgeCmsAccess = (edgeFirebase, currentOrganization) => {
  const rolePathForOrg = orgId => `organizations-${String(orgId || '').replaceAll('/', '-')}`

  const currentUserIsRootAdmin = computed(() =>
    (edgeFirebase?.user?.roles || []).some(role =>
      String(role?.collectionPath || '').trim() === '-' && role?.role === 'admin',
    ),
  )

  const currentUserHasRoleAt = (orgId, suffix, roles = ['user', 'writer', 'editor', 'admin']) => {
    const orgPath = rolePathForOrg(orgId)
    const collectionPath = suffix ? `${orgPath}-${suffix}` : orgPath
    return (edgeFirebase?.user?.roles || []).some(role =>
      role.collectionPath === collectionPath && roles.includes(role.role),
    )
  }

  const currentUserIsOrgAdmin = computed(() =>
    currentOrganization.value
    && (currentUserIsRootAdmin.value || currentUserHasRoleAt(currentOrganization.value, '', ['admin'])),
  )

  return {
    currentUserIsRootAdmin,
    currentUserIsOrgAdmin,
    currentUserHasRoleAt,
  }
}
