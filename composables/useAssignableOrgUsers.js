/* global edgeGlobal */
import { computed } from 'vue'
import { useNormalizedOrgUsers } from './useNormalizedOrgUsers'

const normalizeText = value => String(value || '').trim()

const normalizeRoles = (roles) => {
  if (Array.isArray(roles))
    return roles
  if (roles && typeof roles === 'object')
    return Object.values(roles)
  return []
}

const getAssignableUserId = user => normalizeText(user?.userId)

const getAssignableUserName = (user) => {
  const meta = user?.meta || {}
  return normalizeText(meta.name || user?.name || meta.email || user?.email || getAssignableUserId(user))
}

export const useAssignableOrgUsers = (edgeFirebase) => {
  const orgId = computed(() => normalizeText(edgeGlobal.edgeState.currentOrganization))
  const {
    normalizedUsers,
    normalizedOrgUserId,
    normalizedOrgUserName,
    orgUsersPath,
    stateUsersHaveAssignableShape,
  } = useNormalizedOrgUsers(edgeFirebase)

  const getUserRoleName = (user) => {
    const explicitRole = normalizeText(user?.role || user?.meta?.role)
    if (explicitRole)
      return explicitRole
    return normalizeText(edgeGlobal.getRoleName(normalizeRoles(user?.roles), orgId.value))
  }

  const isAssignableUser = (user) => {
    const userId = getAssignableUserId(user)
    if (!userId)
      return false
    return getUserRoleName(user).toLowerCase() !== 'assistant'
  }

  const assignableUsers = computed(() => {
    const usersById = new Map()
    normalizedUsers.value.forEach((user) => {
      if (!isAssignableUser(user))
        return
      const userId = getAssignableUserId(user)
      if (usersById.has(userId))
        return
      usersById.set(userId, user)
    })
    return Array.from(usersById.values())
  })

  const assignableUserOptions = computed(() =>
    assignableUsers.value
      .map(user => ({
        value: getAssignableUserId(user),
        label: getAssignableUserName(user),
      }))
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''))),
  )

  const normalizedUserNameById = computed(() => {
    const map = {}
    normalizedUsers.value.forEach((user) => {
      const userId = getAssignableUserId(user)
      const name = getAssignableUserName(user)
      if (userId && name)
        map[userId] = name
    })
    return map
  })

  const assignableUserNameById = computed(() => {
    const map = {}
    assignableUsers.value.forEach((user) => {
      const userId = getAssignableUserId(user)
      const name = getAssignableUserName(user)
      if (userId && name)
        map[userId] = name
    })
    return map
  })

  const userIdAliases = computed(() => {
    const aliases = new Map()
    normalizedUsers.value.forEach((user) => {
      const userId = getAssignableUserId(user)
      if (!userId)
        return
      aliases.set(userId, userId)
      const docId = normalizeText(user?.docId)
      if (docId)
        aliases.set(docId, userId)
    })
    return aliases
  })

  return {
    assignableUsers,
    assignableUserOptions,
    assignableUserNameById,
    normalizedUsers,
    normalizedUserNameById,
    userIdAliases,
    getAssignableUserId,
    getAssignableUserName,
    normalizedOrgUserId,
    normalizedOrgUserName,
    orgUsersPath,
    stateUsersHaveAssignableShape,
    isAssignableUser,
  }
}
