/* global edgeGlobal */
import { computed, onUnmounted, ref, watch } from 'vue'

const normalizeText = value => String(value || '').trim()

const orgUsersSnapshotRefs = new Map()

const normalizeRoles = (roles) => {
  if (Array.isArray(roles))
    return roles
  if (roles && typeof roles === 'object')
    return Object.values(roles)
  return []
}

const orgUserMeta = (user = {}) => {
  const rootMeta = { ...(user || {}) }
  const meta = rootMeta.meta
  delete rootMeta.docId
  delete rootMeta.id
  delete rootMeta.userId
  delete rootMeta.stagedDocId
  delete rootMeta.uid
  delete rootMeta.roles
  delete rootMeta.specialPermissions
  delete rootMeta.meta
  let nestedMeta = {}
  if (meta && typeof meta === 'object')
    nestedMeta = meta
  return {
    ...rootMeta,
    ...nestedMeta,
  }
}

export const normalizedOrgUserId = user => normalizeText(user?.userId)

export const normalizedOrgUserName = (user) => {
  const meta = user?.meta || {}
  return normalizeText(meta.name || user?.name || meta.email || user?.email || normalizedOrgUserId(user))
}

export const useNormalizedOrgUsers = (edgeFirebase) => {
  const orgId = computed(() => normalizeText(edgeGlobal.edgeState.currentOrganization))
  const orgUsersPath = computed(() => orgId.value ? `organizations/${orgId.value}/users` : '')
  const activeOrgUsersPath = ref('')
  const stateUsers = computed(() => Object.values(edgeFirebase?.state?.users || {}))
  const stateUsersHaveAssignableShape = computed(() =>
    stateUsers.value.some(user => Object.prototype.hasOwnProperty.call(user || {}, 'roles')),
  )

  const rawOrgUsers = computed(() => {
    const path = orgUsersPath.value
    return path ? Object.values(edgeFirebase?.data?.[path] || {}) : []
  })

  const normalizeStateUser = (user) => {
    const userId = normalizedOrgUserId(user)
    return {
      ...user,
      auditUid: normalizeText(user?.uid),
      docId: normalizeText(user?.docId),
      uid: userId,
      userId,
      meta: orgUserMeta(user),
      role: normalizeText(user?.role || user?.meta?.role),
      roles: normalizeRoles(user?.roles),
      source: 'state-users',
    }
  }

  const normalizeOrgUser = (user) => {
    const userId = normalizedOrgUserId(user)
    return {
      ...user,
      auditUid: normalizeText(user?.uid),
      docId: normalizeText(user?.docId || user?.id || user?.stagedDocId),
      uid: userId,
      userId,
      meta: orgUserMeta(user),
      role: normalizeText(user?.role || user?.meta?.role),
      roles: normalizeRoles(user?.roles),
      source: 'org-users',
    }
  }

  const normalizedUsers = computed(() => {
    const source = stateUsersHaveAssignableShape.value ? stateUsers.value : rawOrgUsers.value
    const usersById = new Map()
    source.forEach((rawUser) => {
      const user = stateUsersHaveAssignableShape.value
        ? normalizeStateUser(rawUser)
        : normalizeOrgUser(rawUser)
      if (!user.userId || usersById.has(user.userId))
        return
      usersById.set(user.userId, user)
    })
    return Array.from(usersById.values())
  })

  const stopOrgUsersSnapshot = async (path) => {
    if (!path)
      return
    const currentCount = orgUsersSnapshotRefs.get(path) || 0
    if (currentCount <= 1) {
      orgUsersSnapshotRefs.delete(path)
      if (activeOrgUsersPath.value === path)
        activeOrgUsersPath.value = ''
      await edgeFirebase.stopSnapshot(path)
      return
    }
    orgUsersSnapshotRefs.set(path, currentCount - 1)
    if (activeOrgUsersPath.value === path)
      activeOrgUsersPath.value = ''
  }

  const startOrgUsersSnapshot = async () => {
    if (!orgUsersPath.value || stateUsersHaveAssignableShape.value)
      return
    if (activeOrgUsersPath.value === orgUsersPath.value)
      return
    if (activeOrgUsersPath.value)
      await stopOrgUsersSnapshot(activeOrgUsersPath.value)
    const currentCount = orgUsersSnapshotRefs.get(orgUsersPath.value) || 0
    orgUsersSnapshotRefs.set(orgUsersPath.value, currentCount + 1)
    activeOrgUsersPath.value = orgUsersPath.value
    if (currentCount > 0)
      return
    await edgeFirebase.startSnapshot(orgUsersPath.value)
  }

  const stopWatcher = watch([orgUsersPath, stateUsersHaveAssignableShape], async ([nextPath, hasAssignableShape]) => {
    if (activeOrgUsersPath.value && (activeOrgUsersPath.value !== nextPath || hasAssignableShape))
      await stopOrgUsersSnapshot(activeOrgUsersPath.value)
    if (!hasAssignableShape)
      await startOrgUsersSnapshot()
  }, { immediate: true })

  onUnmounted(async () => {
    stopWatcher()
    await stopOrgUsersSnapshot(activeOrgUsersPath.value)
  })

  return {
    normalizedUsers,
    normalizedOrgUsers: normalizedUsers,
    normalizedOrgUserId,
    normalizedOrgUserName,
    orgUsersPath,
    stateUsersHaveAssignableShape,
  }
}
