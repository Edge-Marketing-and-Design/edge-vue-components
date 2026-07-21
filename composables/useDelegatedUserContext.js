/* global edgeGlobal */
import { computed, watch } from 'vue'
import { useNormalizedOrgUsers } from './useNormalizedOrgUsers'
import { useState } from '#imports'

const normalizeText = value => String(value || '').trim()

const normalizeRoles = (roles) => {
  if (Array.isArray(roles))
    return roles
  if (roles && typeof roles === 'object')
    return Object.values(roles)
  return []
}

const getMemberUserId = member => normalizeText(member?.userId)

const memberMatchesUserId = (member, userId) => Boolean(getMemberUserId(member) && getMemberUserId(member) === normalizeText(userId))

const getMemberName = (member) => {
  const meta = member?.meta || {}
  return normalizeText(meta.name || member?.name || meta.email || member?.email || getMemberUserId(member))
}

const splitCsvValues = (value) => {
  if (Array.isArray(value))
    return value.flatMap(item => splitCsvValues(item)).filter(Boolean)
  const normalized = normalizeText(value)
  if (!normalized)
    return []
  return normalized.split(',').map(normalizeText).filter(Boolean)
}

const getMemberLegacyIds = (member) => {
  const meta = member?.meta || {}
  return [...new Set([
    ...splitCsvValues(member?.user_id || member?.userIdLegacy),
    ...splitCsvValues(meta?.user_id || meta?.userIdLegacy),
  ])]
}

export const useDelegatedUserContext = (edgeFirebase, options = {}) => {
  const selectedByOrg = useState('edgeDelegatedUserByOrg', () => ({}))
  const legacyStoragePrefix = normalizeText(options.legacyStoragePrefix)

  const actorUserId = computed(() => normalizeText(edgeFirebase?.user?.uid))
  const orgId = computed(() => normalizeText(edgeGlobal.edgeState.currentOrganization))
  const storageKey = computed(() => {
    if (!orgId.value || !actorUserId.value)
      return ''
    return `edge:delegatedUser:${orgId.value}:${actorUserId.value}`
  })
  const legacyStorageKey = computed(() => {
    if (!legacyStoragePrefix || !orgId.value || !actorUserId.value)
      return ''
    return `${legacyStoragePrefix}:${orgId.value}:${actorUserId.value}`
  })
  const {
    normalizedUsers,
  } = useNormalizedOrgUsers(edgeFirebase)
  const orgMembers = computed(() => normalizedUsers.value)
  const currentMember = computed(() => {
    const actor = actorUserId.value
    if (!actor)
      return null
    const member = orgMembers.value.find(item => memberMatchesUserId(item, actor)) || {}
    const memberRoles = normalizeRoles(member?.roles)
    const currentUser = edgeFirebase?.user || {}
    const currentUserMeta = currentUser?.meta || {}
    const memberMeta = member?.meta || {}
    return {
      ...member,
      uid: normalizeText(member?.userId || currentUser?.uid || actor),
      userId: normalizeText(member?.userId || currentUser?.uid || actor),
      roles: memberRoles.length ? memberRoles : normalizeRoles(currentUser?.roles),
      meta: {
        ...currentUserMeta,
        ...memberMeta,
      },
      delegateForUserIds: member?.delegateForUserIds
        || memberMeta?.delegateForUserIds
        || currentUser?.delegateForUserIds
        || currentUserMeta?.delegateForUserIds
        || member?.assistantForUserIds
        || memberMeta?.assistantForUserIds
        || currentUser?.assistantForUserIds
        || currentUserMeta?.assistantForUserIds
        || [],
    }
  })

  const getMemberRoleName = (member) => {
    const explicitRole = normalizeText(member?.role || member?.meta?.role)
    if (explicitRole)
      return explicitRole
    return normalizeText(edgeGlobal.getRoleName(normalizeRoles(member?.roles), orgId.value))
  }

  const getDelegateUserIds = (member) => {
    const raw = member?.delegateForUserIds || member?.meta?.delegateForUserIds || []
    if (Array.isArray(raw))
      return [...new Set(raw.map(normalizeText).filter(Boolean))]
    return normalizeText(raw).split(',').map(normalizeText).filter(Boolean)
  }

  const currentRoleName = computed(() => getMemberRoleName(currentMember.value))
  const canDelegate = computed(() => getDelegateUserIds(currentMember.value).length > 0)
  const delegatedUserIds = computed(() => canDelegate.value ? getDelegateUserIds(currentMember.value) : [])
  const availableDelegatedUsers = computed(() => {
    const assigned = new Set(delegatedUserIds.value)
    if (!assigned.size)
      return []
    const usersById = new Map()
    orgMembers.value
      .filter(member => assigned.has(getMemberUserId(member)))
      .forEach((member) => {
        const userId = getMemberUserId(member)
        if (!userId || usersById.has(userId))
          return
        usersById.set(userId, {
          name: getMemberName(member),
          userId,
          member,
        })
      })
    return [...usersById.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  const selectedDelegatedUserId = computed({
    get() {
      return normalizeText(selectedByOrg.value?.[storageKey.value])
    },
    set(value) {
      if (!storageKey.value)
        return
      const next = normalizeText(value)
      selectedByOrg.value = {
        ...(selectedByOrg.value || {}),
        [storageKey.value]: next,
      }
      try {
        if (next)
          localStorage.setItem(storageKey.value, next)
        else
          localStorage.removeItem(storageKey.value)
      }
      catch (_error) {}
    },
  })

  const hydrateSelectedUser = () => {
    if (!storageKey.value || selectedDelegatedUserId.value)
      return
    try {
      selectedDelegatedUserId.value = normalizeText(localStorage.getItem(storageKey.value))
        || normalizeText(localStorage.getItem(legacyStorageKey.value))
    }
    catch (_error) {}
  }

  const effectiveUserId = computed(() => {
    if (currentRoleName.value.toLowerCase() === 'assistant' && !canDelegate.value)
      return ''
    if (!canDelegate.value)
      return actorUserId.value
    const assigned = delegatedUserIds.value
    if (!assigned.length)
      return actorUserId.value
    const selected = selectedDelegatedUserId.value
    if (selected && assigned.includes(selected))
      return selected
    return assigned[0] || actorUserId.value
  })
  const delegatedUserId = computed(() => {
    const effective = effectiveUserId.value
    return (effective && effective !== actorUserId.value) ? effective : ''
  })
  const effectiveUser = computed(() =>
    availableDelegatedUsers.value.find(user => user.userId === effectiveUserId.value) || null,
  )
  const effectiveUserMember = computed(() => {
    const userId = effectiveUserId.value
    if (!userId)
      return null
    return orgMembers.value.find(member => memberMatchesUserId(member, userId)) || null
  })
  const effectiveUserLegacyUserIds = computed(() => getMemberLegacyIds(effectiveUserMember.value || {}))
  const effectiveUserName = computed(() => effectiveUser.value?.name || '')
  const isDelegated = computed(() => Boolean(delegatedUserId.value))
  const showDelegatedUserSelector = computed(() => canDelegate.value && availableDelegatedUsers.value.length > 0)

  watch(
    [storageKey, availableDelegatedUsers],
    () => {
      hydrateSelectedUser()
      if (!canDelegate.value)
        return
      const assigned = delegatedUserIds.value
      if (!assigned.length)
        return
      if (!selectedDelegatedUserId.value || !assigned.includes(selectedDelegatedUserId.value))
        selectedDelegatedUserId.value = assigned[0]
    },
    { immediate: true },
  )

  return {
    actorUserId,
    availableDelegatedUsers,
    canDelegate,
    currentMember,
    currentRoleName,
    delegatedUserId,
    delegatedUserIds,
    effectiveUser,
    effectiveUserId,
    effectiveUserLegacyUserIds,
    effectiveUserMember,
    effectiveUserName,
    isDelegated,
    selectedDelegatedUserId,
    showDelegatedUserSelector,
  }
}
