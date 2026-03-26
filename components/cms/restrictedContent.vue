<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { LockKeyhole, Search, Settings2, ShieldCheck, Trash2, UserRoundCheck, Users } from 'lucide-vue-next'
import * as z from 'zod'

const props = defineProps({
  siteId: {
    type: String,
    required: true,
  },
  siteDoc: {
    type: Object,
    default: () => ({}),
  },
  canManage: {
    type: Boolean,
    default: false,
  },
})
const edgeFirebase = inject('edgeFirebase')
const { createRestrictedContentDefaults } = useSiteSettingsTemplate()

const MEMBER_STATUSES = ['active', 'paused', 'revoked']
const normalizeObject = (value) => {
  if (Array.isArray(value))
    return value.map(item => normalizeObject(item))
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeObject(value[key])
      return acc
    }, {})
  }
  return value
}

const buildRestrictedSettings = (value = {}) => {
  const normalizedValue = (value && typeof value === 'object') ? { ...value } : {}
  delete normalizedValue.stripePublishableKey
  return {
    ...createRestrictedContentDefaults(),
    ...normalizedValue,
    registrationPricing: 'paid',
    provider: 'stripe',
    defaultCurrency: 'USD',
    rules: normalizeRestrictedRules(normalizedValue.rules),
  }
}

const createRuleDoc = (value = {}, fallbackId = '') => {
  const normalizedValue = (value && typeof value === 'object') ? value : {}
  const id = String(normalizedValue.id || normalizedValue.docId || fallbackId || '').trim()
  return {
    id,
    name: String(normalizedValue.name || '').trim(),
    protected: true,
    allowRegistration: true,
    registrationMode: 'paid',
    currency: 'USD',
    registrationStripeProductId: String(normalizedValue.registrationStripeProductId || normalizedValue.stripeProductId || '').trim(),
  }
}

const normalizeRestrictedRules = (value = []) => {
  if (!Array.isArray(value))
    return []
  return value
    .map((item, index) => createRuleDoc(item, `rule-${index + 1}`))
    .filter(item => item.id)
}

const createStripeIntegrationDefaults = () => ({
  publishableKey: '',
  secretKey: '',
  webhookSecret: '',
})

const buildStripeIntegration = (value = {}) => {
  const normalizedValue = (value && typeof value === 'object') ? value : {}
  return {
    ...createStripeIntegrationDefaults(),
    ...normalizedValue,
  }
}

const membersCollection = computed(() => `sites/${props.siteId}/audience-users`)
const membersCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${membersCollection.value}`)
const pagesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/pages`)
const postsCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/posts`)
const audienceUsersCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/audience-users`)
const stripeIntegrationCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/private-integrations`)

const sitePages = computed(() => edgeFirebase.data?.[pagesCollectionPath.value] || {})
const sitePosts = computed(() => edgeFirebase.data?.[postsCollectionPath.value] || {})
const audienceUsers = computed(() => edgeFirebase.data?.[audienceUsersCollectionPath.value] || {})
const stripeIntegrationDoc = computed(() => edgeFirebase.data?.[stripeIntegrationCollectionPath.value]?.stripe || {})

const currentSettings = computed(() => buildRestrictedSettings(props.siteDoc?.restrictedContent))
const currentStripeIntegration = computed(() => buildStripeIntegration({
  publishableKey: props.siteDoc?.restrictedContent?.stripePublishableKey || '',
  ...stripeIntegrationDoc.value,
}))

const state = reactive({
  activeTab: 'members',
  settings: buildRestrictedSettings(),
  stripeIntegration: createStripeIntegrationDefaults(),
  ruleFilter: '',
  memberFilter: '',
  selectedRuleId: '',
  selectedMemberId: '',
  settingsSaving: false,
  stripeSaving: false,
  ruleWorkingDoc: createRuleDoc(),
  ruleSubmitting: false,
  ruleError: '',
  membersLoading: false,
  membersLoadingMore: false,
  ruleDeleteDialogOpen: false,
  ruleDeleteDocId: '',
  ruleDeleteSubmitting: false,
})

const memberSchema = toTypedSchema(z.object({
  audienceUserId: z.string().optional(),
  status: z.string({
    required_error: 'Status is required',
  }).min(1, { message: 'Status is required' }),
}))

const memberDocSchema = {
  name: { value: '' },
  email: { value: '' },
  audienceUserId: { value: '' },
  status: { value: 'active' },
  accessRuleIds: { value: [] },
  expiresAt: { value: '' },
  notes: { value: '' },
}

const currentRules = computed(() => {
  return normalizeRestrictedRules(state.settings.rules)
})

const ruleTagItems = computed(() => {
  return currentRules.value
    .map(item => ({
      value: item.id,
      label: item.name || item.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const filteredRules = computed(() => {
  const filter = String(state.ruleFilter || '').trim().toLowerCase()
  return currentRules.value
    .filter((item) => {
      if (!item?.id)
        return false
      if (!filter)
        return true
      const haystack = [
        item?.name,
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return haystack.includes(filter)
    })
    .sort((a, b) => String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || '')))
})

const getAudienceUserLabel = (audienceUserId) => {
  if (!audienceUserId)
    return ''
  const item = audienceUsers.value?.[audienceUserId]
  return item?.name || item?.email || audienceUserId
}

const getMemberHeaderTitle = (workingDoc = {}, fallbackTitle = '') => {
  const name = String(workingDoc?.name || '').trim()
  if (name)
    return name

  const email = String(workingDoc?.email || '').trim()
  if (email)
    return email

  const audienceUserId = String(workingDoc?.audienceUserId || '').trim()
  const audienceLabel = getAudienceUserLabel(audienceUserId)
  if (audienceLabel)
    return audienceLabel

  const fallback = String(fallbackTitle || '').trim()
  if (fallback)
    return fallback

  return 'Member'
}

const getRuleLabel = (ruleId) => {
  if (!ruleId)
    return ''
  const item = currentRules.value.find(candidate => candidate.id === ruleId)
  return item?.name || ruleId
}

const getBlockProtectionPlanId = (block) => {
  if (!block || typeof block !== 'object')
    return ''
  const protection = (block.protection && typeof block.protection === 'object') ? block.protection : null
  if (!protection || protection.enabled !== true)
    return ''
  if (String(protection.access || '').trim() !== 'paidPlan')
    return ''
  return String(protection.ruleId || '').trim()
}

const getBlockProtectionLabel = (block) => {
  if (!block || typeof block !== 'object')
    return 'Block'
  return String(block?.name || block?.blockId || block?.id || 'Block').trim() || 'Block'
}

const clearBlockPlanReference = (block, removedPlanId) => {
  if (!block || typeof block !== 'object')
    return { changed: false, block }

  const protection = (block.protection && typeof block.protection === 'object') ? block.protection : null
  if (!protection)
    return { changed: false, block }

  if (String(protection.access || '').trim() !== 'paidPlan')
    return { changed: false, block }
  if (String(protection.ruleId || '').trim() !== removedPlanId)
    return { changed: false, block }

  return {
    changed: true,
    block: {
      ...block,
      protection: {
        ...protection,
        enabled: false,
        access: 'loggedIn',
        ruleId: '',
        alternateBlockId: '',
      },
    },
  }
}

const clearPlanFromBlockList = (blocks = [], removedPlanId) => {
  if (!Array.isArray(blocks) || !removedPlanId)
    return { changed: false, blocks }

  let changed = false
  const nextBlocks = blocks.map((block) => {
    const result = clearBlockPlanReference(block, removedPlanId)
    if (result.changed)
      changed = true
    return result.block
  })

  return {
    changed,
    blocks: changed ? nextBlocks : blocks,
  }
}

const buildRuleUsage = (ruleId) => {
  const normalizedRuleId = String(ruleId || '').trim()
  const usage = []
  if (!normalizedRuleId)
    return usage

  Object.values(sitePages.value || {})
    .filter(item => item?.docId)
    .sort((a, b) => String(a?.name || a?.docId || '').localeCompare(String(b?.name || b?.docId || '')))
    .forEach((page) => {
      const listBlocks = Array.isArray(page?.content) ? page.content : []
      listBlocks.forEach((block) => {
        if (getBlockProtectionPlanId(block) !== normalizedRuleId)
          return
        usage.push({
          id: `page:list:${page.docId}:${String(block?.id || block?.blockId || '').trim()}`,
          type: 'Page Block',
          targetType: 'page',
          docId: page.docId,
          label: `${page.name || page.docId} - ${getBlockProtectionLabel(block)}`,
        })
      })

      const detailBlocks = Array.isArray(page?.postContent) ? page.postContent : []
      detailBlocks.forEach((block) => {
        if (getBlockProtectionPlanId(block) !== normalizedRuleId)
          return
        usage.push({
          id: `page:detail:${page.docId}:${String(block?.id || block?.blockId || '').trim()}`,
          type: 'Detail Block',
          targetType: 'page',
          docId: page.docId,
          label: `${page.name || page.docId} - ${getBlockProtectionLabel(block)}`,
        })
      })
    })

  Object.values(sitePosts.value || {})
    .filter(item => item?.docId)
    .sort((a, b) => String(a?.title || a?.name || a?.docId || '').localeCompare(String(b?.title || b?.name || b?.docId || '')))
    .forEach((post) => {
      const postBlocks = Array.isArray(post?.content) ? post.content : []
      postBlocks.forEach((block) => {
        if (getBlockProtectionPlanId(block) !== normalizedRuleId)
          return
        usage.push({
          id: `post:${post.docId}:${String(block?.id || block?.blockId || '').trim()}`,
          type: 'Post Block',
          targetType: 'post',
          docId: post.docId,
          label: `${post.title || post.name || post.docId} - ${getBlockProtectionLabel(block)}`,
        })
      })
    })

  return usage
}

const pendingRuleDeleteUsage = computed(() => {
  return buildRuleUsage(state.ruleDeleteDocId)
})

const selectedRuleSavedDoc = computed(() => {
  if (!state.selectedRuleId || state.selectedRuleId === 'new')
    return createRuleDoc(state.ruleWorkingDoc, state.ruleWorkingDoc.id)
  return createRuleDoc(currentRules.value.find(item => item.id === state.selectedRuleId), state.selectedRuleId)
})

const ruleDirty = computed(() => {
  return JSON.stringify(normalizeObject(createRuleDoc(state.ruleWorkingDoc, state.ruleWorkingDoc.id))) !== JSON.stringify(normalizeObject(selectedRuleSavedDoc.value))
})

const filteredMembers = computed(() => {
  const filter = String(state.memberFilter || '').trim().toLowerCase()
  const mergedMembers = Object.values(audienceUsers.value || {})
    .map((audienceUser) => {
      const docId = String(audienceUser?.docId || '').trim()
      if (!docId)
        return null
      return {
        ...audienceUser,
        docId,
        audienceUserId: String(audienceUser?.audienceUserId || docId).trim(),
        status: String(audienceUser?.status || 'active').trim() || 'active',
        accessRuleIds: Array.isArray(audienceUser?.accessRuleIds) ? audienceUser.accessRuleIds : [],
        expiresAt: String(audienceUser?.expiresAt || '').trim(),
        notes: String(audienceUser?.notes || '').trim(),
      }
    })
    .filter(Boolean)

  return mergedMembers
    .filter((item) => {
      if (!item?.docId)
        return false
      if (!filter)
        return true
      const haystack = [
        item?.audienceUserId,
        getAudienceUserLabel(item?.audienceUserId),
        ...(Array.isArray(item?.accessRuleIds) ? item.accessRuleIds.map(ruleId => getRuleLabel(ruleId)) : []),
        item?.status,
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return haystack.includes(filter)
    })
    .sort((a, b) => getAudienceUserLabel(a?.audienceUserId).localeCompare(getAudienceUserLabel(b?.audienceUserId)))
})

const memberTotal = computed(() => Object.keys(audienceUsers.value || {}).length)
const canLoadMoreMembers = computed(() => false)

const settingsDirty = computed(() => {
  return JSON.stringify(normalizeObject(buildRestrictedSettings(state.settings))) !== JSON.stringify(normalizeObject(currentSettings.value))
})

const stripeDirty = computed(() => {
  return JSON.stringify(normalizeObject(buildStripeIntegration(state.stripeIntegration))) !== JSON.stringify(normalizeObject(currentStripeIntegration.value))
})

const normalizeRuleForSite = (value = {}) => {
  const nextRule = createRuleDoc(value, value?.id || value?.docId || '')
  nextRule.protected = true
  nextRule.allowRegistration = true
  nextRule.registrationMode = 'paid'
  return nextRule
}

const statusClass = (status) => {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'revoked')
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
  if (normalized === 'paused')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
}

const syncSettingsFromSiteDoc = () => {
  state.settings = buildRestrictedSettings(props.siteDoc?.restrictedContent)
}

const syncStripeIntegrationFromDoc = () => {
  state.stripeIntegration = buildStripeIntegration(currentStripeIntegration.value)
}

const persistRestrictedSettings = async (nextSettings, options = {}) => {
  const nextVersion = Number.isFinite(Number(props.siteDoc?.version))
    ? Math.max(0, Math.trunc(Number(props.siteDoc.version))) + 1
    : 1
  await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.siteId, {
    restrictedContent: buildRestrictedSettings(nextSettings),
    version: nextVersion,
  })
  if (options?.syncState !== false)
    state.settings = buildRestrictedSettings(nextSettings)
}

const saveSettings = async () => {
  if (!props.canManage || state.settingsSaving)
    return
  state.settingsSaving = true
  try {
    await persistRestrictedSettings(state.settings)
  }
  finally {
    state.settingsSaving = false
  }
}

const resetSettings = () => {
  syncSettingsFromSiteDoc()
}

const saveStripeIntegration = async () => {
  if (!props.canManage || state.stripeSaving)
    return
  state.stripeSaving = true
  try {
    await edgeFirebase.storeDoc(stripeIntegrationCollectionPath.value, buildStripeIntegration(state.stripeIntegration), 'stripe')
  }
  finally {
    state.stripeSaving = false
  }
}

const resetStripeIntegration = () => {
  syncStripeIntegrationFromDoc()
}

const loadInitialMembers = async () => {
  if (!props.canManage)
    return
  state.membersLoading = true
  state.selectedMemberId = ''
  state.membersLoading = false
}

const loadMoreMembers = async () => {
  return
}

const handleMemberSaved = ({ docId, data }) => {
  if (!docId || !data)
    return
}

const startSnapshots = async () => {
  if (!props.canManage)
    return
  const tasks = []
  if (!edgeFirebase.data?.[pagesCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(pagesCollectionPath.value))
  if (!edgeFirebase.data?.[postsCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(postsCollectionPath.value))
  if (!edgeFirebase.data?.[audienceUsersCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(audienceUsersCollectionPath.value))
  if (!edgeFirebase.data?.[stripeIntegrationCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(stripeIntegrationCollectionPath.value))
  if (tasks.length)
    await Promise.allSettled(tasks)
}

const restartSnapshotForPath = async (nextPath, previousPath) => {
  const normalizedNextPath = String(nextPath || '').trim()
  const normalizedPreviousPath = String(previousPath || '').trim()

  if (normalizedPreviousPath && normalizedPreviousPath !== normalizedNextPath)
    await edgeFirebase.stopSnapshot(normalizedPreviousPath)

  if (!props.canManage || !normalizedNextPath)
    return

  if (!edgeFirebase.data?.[normalizedNextPath])
    await edgeFirebase.startSnapshot(normalizedNextPath)
}

const stopSnapshots = async () => {
  const tasks = []
  if (pagesCollectionPath.value)
    tasks.push(edgeFirebase.stopSnapshot(pagesCollectionPath.value))
  if (postsCollectionPath.value)
    tasks.push(edgeFirebase.stopSnapshot(postsCollectionPath.value))
  if (audienceUsersCollectionPath.value)
    tasks.push(edgeFirebase.stopSnapshot(audienceUsersCollectionPath.value))
  if (stripeIntegrationCollectionPath.value)
    tasks.push(edgeFirebase.stopSnapshot(stripeIntegrationCollectionPath.value))
  await Promise.allSettled(tasks)
}

const openNewRule = async () => {
  state.selectedRuleId = 'new'
  state.ruleWorkingDoc = createRuleDoc({
    id: `rule-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    protected: true,
    allowRegistration: true,
    registrationMode: 'paid',
    registrationStripeProductId: '',
  })
  state.ruleError = ''
}

const openRule = async (docId) => {
  if (!docId)
    return
  state.selectedRuleId = docId
  state.ruleWorkingDoc = createRuleDoc(currentRules.value.find(item => item.id === docId), docId)
  state.ruleError = ''
}

const closeRuleEditor = () => {
  state.selectedRuleId = ''
  state.ruleWorkingDoc = createRuleDoc()
  state.ruleError = ''
}

const openDeleteRuleDialog = async (docId) => {
  if (!docId)
    return
  state.ruleDeleteDocId = docId
  state.ruleDeleteDialogOpen = true
}

const closeDeleteRuleDialog = () => {
  if (state.ruleDeleteSubmitting)
    return
  state.ruleDeleteDialogOpen = false
  state.ruleDeleteDocId = ''
}

const saveRule = async () => {
  if (!state.selectedRuleId || state.ruleSubmitting)
    return
  const nextRule = normalizeRuleForSite({
    ...state.ruleWorkingDoc,
    id: state.ruleWorkingDoc.id || state.selectedRuleId,
  })
  if (!nextRule.name) {
    state.ruleError = 'Plan name is required.'
    return
  }
  state.ruleSubmitting = true
  state.ruleError = ''
  try {
    const nextRules = normalizeRestrictedRules(currentRules.value.filter(item => item.id !== nextRule.id).concat(nextRule))
    const nextSettings = buildRestrictedSettings({
      ...state.settings,
      rules: nextRules,
    })
    await persistRestrictedSettings(nextSettings)
    state.selectedRuleId = nextRule.id
    state.ruleWorkingDoc = createRuleDoc(nextRule, nextRule.id)
  }
  catch (error) {
    state.ruleError = String(error?.message || 'Unable to save this plan right now.')
  }
  finally {
    state.ruleSubmitting = false
  }
}

const deleteRule = async () => {
  const docId = String(state.ruleDeleteDocId || '').trim()
  if (!docId || state.ruleDeleteSubmitting)
    return
  state.ruleDeleteSubmitting = true
  try {
    const pageUpdates = Object.values(sitePages.value || {})
      .filter(item => item?.docId)
      .flatMap((page) => {
        const listResult = clearPlanFromBlockList(page?.content, docId)
        const detailResult = clearPlanFromBlockList(page?.postContent, docId)
        const update = {}
        if (listResult.changed)
          update.content = listResult.blocks
        if (detailResult.changed)
          update.postContent = detailResult.blocks
        if (!Object.keys(update).length)
          return []
        return [edgeFirebase.changeDoc(pagesCollectionPath.value, page.docId, update)]
      })

    const postUpdates = Object.values(sitePosts.value || {})
      .filter(item => item?.docId)
      .flatMap((post) => {
        const contentResult = clearPlanFromBlockList(post?.content, docId)
        if (!contentResult.changed)
          return []
        return [edgeFirebase.changeDoc(postsCollectionPath.value, post.docId, { content: contentResult.blocks })]
      })

    const loadedMemberUpdates = filteredMembers.value
      .filter(item => Array.isArray(item?.accessRuleIds) && item.accessRuleIds.includes(docId))
      .map((member) => {
        const nextAccessRuleIds = member.accessRuleIds.filter(ruleId => ruleId !== docId)
        return edgeFirebase.changeDoc(membersCollectionPath.value, member.docId, { accessRuleIds: nextAccessRuleIds })
      })

    if (pageUpdates.length || postUpdates.length || loadedMemberUpdates.length)
      await Promise.all([...pageUpdates, ...postUpdates, ...loadedMemberUpdates])

    const nextRules = normalizeRestrictedRules(currentRules.value.filter(item => item.id !== docId))
    const nextSettings = buildRestrictedSettings({
      ...state.settings,
      rules: nextRules,
    })
    await persistRestrictedSettings(nextSettings)
    if (state.selectedRuleId === docId)
      state.selectedRuleId = ''
    state.ruleWorkingDoc = createRuleDoc()
    state.ruleError = ''
    state.ruleDeleteDialogOpen = false
    state.ruleDeleteDocId = ''
  }
  finally {
    state.ruleDeleteSubmitting = false
  }
}

const openNewMember = () => {
  state.selectedMemberId = 'new'
}

const openMember = (docId) => {
  if (!docId)
    return
  state.selectedMemberId = docId
}

const closeMemberEditor = () => {
  state.selectedMemberId = ''
}

const deleteMember = async (docId) => {
  if (!docId)
    return
  await edgeFirebase.removeDoc(audienceUsersCollectionPath.value, docId)
  if (state.selectedMemberId === docId)
    state.selectedMemberId = ''
}

watch(() => props.canManage, async (allowed) => {
  if (allowed) {
    await startSnapshots()
    await loadInitialMembers()
    return
  }
  state.selectedRuleId = ''
  state.selectedMemberId = ''
  await stopSnapshots()
}, { immediate: true })

watch(() => props.siteDoc?.restrictedContent, (_nextValue, previousValue) => {
  if (previousValue === undefined || !settingsDirty.value)
    syncSettingsFromSiteDoc()
}, { immediate: true, deep: true })

watch(currentStripeIntegration, (_nextValue, previousValue) => {
  if (previousValue === undefined || !stripeDirty.value)
    syncStripeIntegrationFromDoc()
}, { immediate: true, deep: true })

watch(currentRules, (items) => {
  if (state.selectedRuleId && state.selectedRuleId !== 'new' && !items.find(item => item.id === state.selectedRuleId))
    closeRuleEditor()
}, { deep: true })

watch(pagesCollectionPath, async (nextPath, previousPath) => {
  await restartSnapshotForPath(nextPath, previousPath)
})

watch(postsCollectionPath, async (nextPath, previousPath) => {
  await restartSnapshotForPath(nextPath, previousPath)
})

watch(audienceUsersCollectionPath, async (nextPath, previousPath) => {
  await restartSnapshotForPath(nextPath, previousPath)
})

watch(stripeIntegrationCollectionPath, async (nextPath, previousPath) => {
  await restartSnapshotForPath(nextPath, previousPath)
})

watch(membersCollectionPath, async () => {
  state.selectedMemberId = ''
  if (props.canManage)
    await loadInitialMembers()
})

onBeforeUnmount(async () => {
  await stopSnapshots()
})
</script>

<template>
  <div class="flex h-[calc(100vh-140px)] flex-col gap-4 overflow-hidden">
    <edge-shad-dialog v-model="state.ruleDeleteDialogOpen">
      <DialogContent class="pt-10">
        <DialogHeader>
          <DialogTitle class="text-left">
            Delete Paid Access Plan?
          </DialogTitle>
          <DialogDescription class="text-left">
            This will delete the paid access plan and remove it from any pages and posts currently using it on this site.
          </DialogDescription>
        </DialogHeader>
        <div v-if="pendingRuleDeleteUsage.length" class="space-y-2">
          <div class="text-sm font-medium text-foreground">
            This paid access plan is currently used by:
          </div>
          <div class="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3">
            <div
              v-for="item in pendingRuleDeleteUsage"
              :key="item.id"
              class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2"
            >
              <div class="min-w-0 truncate text-sm text-foreground">
                {{ item.label }}
              </div>
              <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                {{ item.type }}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" :disabled="state.ruleDeleteSubmitting" @click="closeDeleteRuleDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-red-700 text-white hover:bg-red-600" :disabled="state.ruleDeleteSubmitting" @click="deleteRule">
            Delete Plan
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <Card v-if="!props.canManage" class="border border-border/60 bg-card">
      <CardContent class="py-12 text-center text-sm text-muted-foreground">
        You do not have permission to manage restrictions for this site.
      </CardContent>
    </Card>

    <template v-else>
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 text-xl font-semibold text-foreground">
            <LockKeyhole class="h-5 w-5" />
            Members
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Choose what content requires access and whether people can sign up.
          </p>
        </div>
      </div>

      <Tabs v-model="state.activeTab" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList class="sticky top-0 z-10 grid w-full shrink-0 grid-cols-3 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900">
          <TabsTrigger value="members" class="gap-2">
            <Users class="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="settings" class="gap-2">
            <Settings2 class="h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="rules" class="gap-2">
            <ShieldCheck class="h-4 w-4" />
            Paid Access Plans
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" class="mt-4 min-h-0 flex flex-1 overflow-y-auto">
          <Card class="min-h-0 flex flex-1 flex-col border border-border/60 bg-card">
            <CardHeader>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Restriction Settings</CardTitle>
                  <CardDescription>
                    Set the default access options for this site here. Individual plans are managed in the Paid Access Plans tab.
                  </CardDescription>
                </div>
                <div class="flex items-center gap-2">
                  <edge-shad-button
                    variant="outline"
                    :disabled="!settingsDirty || state.settingsSaving"
                    @click="resetSettings"
                  >
                    Reset
                  </edge-shad-button>
                  <edge-shad-button
                    class="bg-slate-800 text-white hover:bg-slate-700"
                    :disabled="!settingsDirty || state.settingsSaving"
                    @click="saveSettings"
                  >
                    Save Settings
                  </edge-shad-button>
                </div>
              </div>
            </CardHeader>
            <CardContent class="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <edge-shad-form
                :initial-values="{
                  'restricted-content-enabled': state.settings.enabled,
                  'restricted-content-allow-self-registration': state.settings.allowSelfRegistration,
                  'restricted-content-terms-url': state.settings.registrationTermsUrl,
                  'restricted-content-login-help': state.settings.loginHelpText,
                  'restricted-content-success-message': state.settings.registrationSuccessMessage,
                }"
              >
                <div class="space-y-4 rounded-lg border border-border/60 bg-background/70 p-4">
                  <div>
                    <div class="text-sm font-semibold text-foreground">
                      Site Defaults
                    </div>
                    <p class="mt-1 text-sm text-muted-foreground">
                      These settings control how sign-up works across this site.
                    </p>
                  </div>
                  <edge-cms-boolean-card
                    v-model="state.settings.allowSelfRegistration"
                    name="restricted-content-allow-self-registration"
                    label="Allow visitors to self register"
                    class="w-full"
                    checked-label="Allowed"
                    unchecked-label="Disabled"
                  >
                    When this is off, visitors cannot self register and must be added manually. Manual member emails must match the email they use to sign up.
                  </edge-cms-boolean-card>
                  <edge-shad-input
                    v-model="state.settings.registrationTermsUrl"
                    name="restricted-content-terms-url"
                    label="Registration Terms URL"
                    placeholder="https://example.com/terms"
                  />
                  <edge-shad-textarea
                    v-model="state.settings.loginHelpText"
                    name="restricted-content-login-help"
                    label="Login Help Text"
                  />
                  <edge-shad-textarea
                    v-model="state.settings.registrationSuccessMessage"
                    name="restricted-content-success-message"
                    label="Registration Success Message"
                  />
                  <div class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                    General access settings are saved with the site.
                  </div>
                </div>
              </edge-shad-form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" class="mt-4 min-h-0 flex flex-1 flex-col overflow-hidden">
          <edge-shad-form
            :initial-values="{
              'restricted-content-stripe-publishable-key': state.stripeIntegration.publishableKey,
              'restricted-content-stripe-secret-key': state.stripeIntegration.secretKey,
              'restricted-content-stripe-webhook-secret': state.stripeIntegration.webhookSecret,
            }"
          >
            <Card class="mb-4 shrink-0 border border-border/60 bg-card">
              <CardContent class="space-y-3 p-3">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-sm font-semibold text-foreground">
                      Stripe Settings
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <edge-shad-button
                      variant="outline"
                      :disabled="!stripeDirty || state.stripeSaving"
                      @click="resetStripeIntegration"
                    >
                      Reset Stripe
                    </edge-shad-button>
                    <edge-shad-button
                      class="bg-slate-800 text-white hover:bg-slate-700"
                      :disabled="!stripeDirty || state.stripeSaving"
                      @click="saveStripeIntegration"
                    >
                      Save Stripe
                    </edge-shad-button>
                  </div>
                </div>
                <div class="grid gap-3 lg:grid-cols-3">
                  <edge-shad-input
                    v-model="state.stripeIntegration.publishableKey"
                    name="restricted-content-stripe-publishable-key"
                    label="Stripe Publishable Key"
                    placeholder="pk_live_..."
                    :input-attrs="{
                      autocomplete: 'off',
                      autocapitalize: 'none',
                      autocorrect: 'off',
                      spellcheck: 'false',
                      'data-lpignore': 'true',
                      'data-1p-ignore': 'true',
                    }"
                  />
                  <edge-shad-input
                    v-model="state.stripeIntegration.secretKey"
                    name="restricted-content-stripe-secret-key"
                    type="password"
                    label="Stripe Secret Key"
                    placeholder="sk_live_..."
                    :input-attrs="{
                      autocomplete: 'new-password',
                      autocapitalize: 'none',
                      autocorrect: 'off',
                      spellcheck: 'false',
                      'data-lpignore': 'true',
                      'data-1p-ignore': 'true',
                    }"
                  />
                  <edge-shad-input
                    v-model="state.stripeIntegration.webhookSecret"
                    name="restricted-content-stripe-webhook-secret"
                    type="password"
                    label="Stripe Webhook Secret"
                    placeholder="whsec_..."
                    :input-attrs="{
                      autocomplete: 'new-password',
                      autocapitalize: 'none',
                      autocorrect: 'off',
                      spellcheck: 'false',
                      'data-lpignore': 'true',
                      'data-1p-ignore': 'true',
                    }"
                  />
                </div>
              </CardContent>
            </Card>
          </edge-shad-form>

          <div class="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
            <Card class="min-h-0 h-full border border-border/60 bg-card flex flex-col overflow-hidden">
              <CardHeader class="shrink-0 space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle class="text-base">
                      Paid Access Plans
                    </CardTitle>
                    <CardDescription>{{ filteredRules.length }} plans</CardDescription>
                  </div>
                  <edge-shad-button class="gap-2 bg-slate-800 text-white hover:bg-slate-700" @click="openNewRule">
                    <ShieldCheck class="h-4 w-4" />
                    Add Plan
                  </edge-shad-button>
                </div>
                <edge-shad-form :initial-values="{ 'restricted-rule-filter': state.ruleFilter }">
                  <edge-shad-input
                    v-model="state.ruleFilter"
                    name="restricted-rule-filter"
                    label=""
                    placeholder="Search plans..."
                  >
                    <template #icon>
                      <Search class="h-4 w-4" />
                    </template>
                  </edge-shad-input>
                </edge-shad-form>
              </CardHeader>
              <CardContent class="min-h-0 flex-1 space-y-2 overflow-y-auto">
                <button
                  v-for="item in filteredRules"
                  :key="item.id"
                  type="button"
                  class="w-full rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-muted/60"
                  :class="state.selectedRuleId === item.id ? 'border-primary/70 bg-muted/70 shadow-sm' : 'border-border/60 bg-background'"
                  @click="openRule(item.id)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate font-semibold text-foreground">
                        {{ item.name || item.id }}
                      </div>
                    </div>
                    <edge-shad-button
                      size="icon"
                      variant="ghost"
                      class="h-8 w-8 text-muted-foreground hover:text-destructive"
                      @click.stop="openDeleteRuleDialog(item.id)"
                    >
                      <Trash2 class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                </button>
                <div v-if="!filteredRules.length" class="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  No plans have been added yet.
                </div>
              </CardContent>
            </Card>

            <Card class="min-h-0 h-full border border-border/60 bg-card flex flex-col overflow-hidden">
              <CardContent class="h-full min-h-0 overflow-hidden p-0">
                <div v-if="state.selectedRuleId" class="flex h-full min-h-0 flex-col">
                  <div class="flex items-center justify-between border-b border-border/60 px-6 py-4">
                    <div class="flex min-w-0 items-center text-sm font-semibold text-foreground">
                      <ShieldCheck class="mr-2 h-4 w-4" />
                      <span class="truncate">{{ state.selectedRuleId === 'new' ? 'New Plan' : (state.ruleWorkingDoc.name || 'Edit Plan') }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <edge-shad-button
                        class="bg-red-700 uppercase h-8 hover:bg-red-500 w-24"
                        @click="closeRuleEditor"
                      >
                        {{ ruleDirty ? 'Cancel' : 'Close' }}
                      </edge-shad-button>
                      <edge-shad-button
                        type="button"
                        class="bg-slate-800 uppercase h-8 hover:bg-slate-700 w-24 text-white"
                        :disabled="state.ruleSubmitting"
                        @click="saveRule"
                      >
                        Save
                      </edge-shad-button>
                    </div>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto">
                    <edge-shad-form
                      :initial-values="{
                        'restricted-rule-name': state.ruleWorkingDoc.name,
                        'restricted-rule-stripe-product-id': state.ruleWorkingDoc.registrationStripeProductId,
                      }"
                    >
                      <div class="space-y-4 px-6 pb-6 pt-6">
                        <edge-shad-input
                          v-model="state.ruleWorkingDoc.name"
                          name="restricted-rule-name"
                          label="Plan Name"
                          description="Use one plan for any pages and posts that should share the same access."
                        />
                        <div v-if="state.ruleError" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
                          {{ state.ruleError }}
                        </div>
                        <edge-shad-input
                          v-model="state.ruleWorkingDoc.registrationStripeProductId"
                          name="restricted-rule-stripe-product-id"
                          type="text"
                          label="Stripe Product ID"
                          placeholder="prod_..."
                          description="Use the Stripe product for this offer so buyers can choose from that product's available pricing options."
                        />
                      </div>
                    </edge-shad-form>
                  </div>
                </div>

                <div v-else class="flex h-full items-center justify-center p-8">
                  <div class="max-w-md text-center">
                    <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <ShieldCheck class="h-6 w-6" />
                    </div>
                    <h3 class="text-lg font-semibold text-foreground">
                      Select a plan
                    </h3>
                    <p class="mt-2 text-sm text-muted-foreground">
                      Paid Access Plans act as reusable access groups that you can attach to pages and posts.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="members" class="mt-4 min-h-0 flex flex-1 flex-col overflow-hidden">
          <Card class="mb-4 shrink-0 border border-border/60 bg-card">
            <CardContent class="space-y-2 p-3">
              <edge-cms-boolean-card
                v-model="state.settings.enabled"
                name="restricted-content-enabled"
                label="Enable Site Membership"
                class="w-full"
                checked-label="Enabled"
                unchecked-label="Disabled"
              >
                When this is enabled, site login is enabled and blocks can be restricted to logged-in users.
              </edge-cms-boolean-card>
              <div class="flex justify-end gap-2">
                <edge-shad-button
                  variant="outline"
                  class="h-8"
                  :disabled="!settingsDirty || state.settingsSaving"
                  @click="resetSettings"
                >
                  Reset
                </edge-shad-button>
                <edge-shad-button
                  class="h-8 bg-slate-800 text-white hover:bg-slate-700"
                  :disabled="!settingsDirty || state.settingsSaving"
                  @click="saveSettings"
                >
                  Save Membership
                </edge-shad-button>
              </div>
            </CardContent>
          </Card>
          <div class="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
            <Card class="min-h-0 h-full border border-border/60 bg-card flex flex-col overflow-hidden">
              <CardHeader class="shrink-0 space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle class="text-base">
                      Site Memberships
                    </CardTitle>
                    <CardDescription>
                      {{ filteredMembers.length }} shown of {{ memberTotal }} members
                    </CardDescription>
                  </div>
                  <edge-shad-button class="gap-2 bg-slate-800 text-white hover:bg-slate-700" @click="openNewMember">
                    <UserRoundCheck class="h-4 w-4" />
                    Add Member
                  </edge-shad-button>
                </div>
                <edge-shad-form :initial-values="{ 'restricted-member-filter': state.memberFilter }">
                  <edge-shad-input
                    v-model="state.memberFilter"
                    name="restricted-member-filter"
                    label=""
                    placeholder="Filter loaded members..."
                  >
                    <template #icon>
                      <Search class="h-4 w-4" />
                    </template>
                  </edge-shad-input>
                </edge-shad-form>
              </CardHeader>
              <CardContent class="min-h-0 flex-1 space-y-2 overflow-y-auto">
                <div v-if="state.membersLoading" class="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  Loading members...
                </div>
                <button
                  v-for="item in filteredMembers"
                  :key="item.docId"
                  type="button"
                  class="w-full rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-muted/60"
                  :class="state.selectedMemberId === item.docId ? 'border-primary/70 bg-muted/70 shadow-sm' : 'border-border/60 bg-background'"
                  @click="openMember(item.docId)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate font-semibold text-foreground">
                        {{ item.name || item.email || getAudienceUserLabel(item.audienceUserId) || item.docId }}
                      </div>
                      <div class="mt-1 text-xs text-muted-foreground">
                        {{ Array.isArray(item.accessRuleIds) ? item.accessRuleIds.length : 0 }} assigned plan{{ (Array.isArray(item.accessRuleIds) ? item.accessRuleIds.length : 0) === 1 ? '' : 's' }}
                      </div>
                      <div v-if="Array.isArray(item.accessRuleIds) && item.accessRuleIds.length" class="mt-2 flex flex-wrap gap-1">
                        <span
                          v-for="ruleId in item.accessRuleIds.slice(0, 3)"
                          :key="ruleId"
                          class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                        >
                          {{ getRuleLabel(ruleId) }}
                        </span>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="rounded-full px-2 py-1 text-[10px] font-semibold uppercase" :class="statusClass(item.status)">
                        {{ item.status || 'active' }}
                      </span>
                      <edge-shad-button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 text-muted-foreground hover:text-destructive"
                        @click.stop="deleteMember(item.docId)"
                      >
                        <Trash2 class="h-4 w-4" />
                      </edge-shad-button>
                    </div>
                  </div>
                </button>
                <div v-if="!state.membersLoading && !filteredMembers.length" class="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  {{ state.memberFilter ? 'No loaded members match this search yet.' : 'No members have been added to this site yet.' }}
                </div>
                <div v-if="canLoadMoreMembers" class="pt-2">
                  <edge-shad-button
                    variant="outline"
                    class="w-full"
                    :disabled="state.membersLoadingMore"
                    @click="loadMoreMembers"
                  >
                    {{ state.membersLoadingMore ? 'Loading More...' : 'Load More Members' }}
                  </edge-shad-button>
                </div>
              </CardContent>
            </Card>

            <Card class="min-h-0 h-full border border-border/60 bg-card flex flex-col overflow-hidden">
              <CardContent class="h-full min-h-0 overflow-y-auto p-0">
                <edge-editor
                  v-if="state.selectedMemberId"
                  :collection="membersCollection"
                  :doc-id="state.selectedMemberId"
                  :schema="memberSchema"
                  :new-doc-schema="memberDocSchema"
                  new-title-override="New Member"
                  :show-footer="false"
                  class="h-full min-h-0 border-none bg-transparent px-0 pt-0 shadow-none"
                  card-content-class="px-6 pb-6"
                  :save-function-override="closeMemberEditor"
                  title-field="name"
                  @saved="handleMemberSaved"
                >
                  <template #header-start="slotProps">
                    <Users class="mr-2 h-4 w-4" />
                    {{ getMemberHeaderTitle(slotProps.workingDoc, slotProps.title) }}
                  </template>
                  <template #header-end="slotProps">
                    <edge-shad-button
                      class="bg-red-700 uppercase h-8 hover:bg-red-500 w-24"
                      @click="slotProps.onCancel"
                    >
                      {{ slotProps.unsavedChanges ? 'Cancel' : 'Close' }}
                    </edge-shad-button>
                    <edge-shad-button
                      type="submit"
                      class="bg-slate-800 uppercase h-8 hover:bg-slate-700 w-24 text-white"
                      :disabled="slotProps.submitting"
                    >
                      Save
                    </edge-shad-button>
                  </template>
                  <template #main="slotProps">
                    <edge-shad-form
                      :initial-values="{
                        'restricted-member-name': slotProps.workingDoc.name,
                        'restricted-member-email': slotProps.workingDoc.email,
                        'restricted-member-status': slotProps.workingDoc.status,
                        'restricted-member-expires-at': slotProps.workingDoc.expiresAt,
                        'restricted-member-rule-ids': slotProps.workingDoc.accessRuleIds,
                        'restricted-member-notes': slotProps.workingDoc.notes,
                      }"
                    >
                      <div class="space-y-4 pt-6 pb-6">
                        <div class="grid gap-4 md:grid-cols-2">
                          <edge-shad-input
                            v-model="slotProps.workingDoc.name"
                            name="restricted-member-name"
                            label="Name"
                            placeholder="Jane Doe"
                          />
                          <edge-shad-input
                            v-model="slotProps.workingDoc.email"
                            name="restricted-member-email"
                            label="Email"
                            placeholder="jane@example.com"
                            :disabled="Boolean(slotProps.workingDoc.userId || slotProps.workingDoc.authUid)"
                          />
                        </div>
                        <div
                          v-if="slotProps.workingDoc.audienceUserId"
                          class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground"
                        >
                          {{ getAudienceUserLabel(slotProps.workingDoc.audienceUserId) }}
                        </div>
                        <div class="grid gap-4 md:grid-cols-2">
                          <edge-shad-select
                            v-model="slotProps.workingDoc.status"
                            name="restricted-member-status"
                            label="Status"
                            :items="MEMBER_STATUSES"
                          />
                          <edge-shad-input
                            v-model="slotProps.workingDoc.expiresAt"
                            name="restricted-member-expires-at"
                            label="Expires At"
                            placeholder="2026-12-31"
                          />
                        </div>
                        <edge-shad-select-tags
                          v-model="slotProps.workingDoc.accessRuleIds"
                          name="restricted-member-rule-ids"
                          label="Assigned Plans"
                          placeholder="Select plans"
                          :items="ruleTagItems"
                          item-title="label"
                          item-value="value"
                          :allow-additions="false"
                        />
                        <edge-shad-textarea
                          v-model="slotProps.workingDoc.notes"
                          name="restricted-member-notes"
                          label="Notes"
                        />
                      </div>
                    </edge-shad-form>
                  </template>
                </edge-editor>

                <div v-else class="flex h-full items-center justify-center p-8">
                  <div class="max-w-md text-center">
                    <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <Users class="h-6 w-6" />
                    </div>
                    <h3 class="text-lg font-semibold text-foreground">
                      Select a member
                    </h3>
                    <p class="mt-2 text-sm text-muted-foreground">
                      Members are the people who can access the plans you assign on this site.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
