<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import { ChevronDown, GripVertical, LockKeyhole, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2, UserRoundCheck, Users } from 'lucide-vue-next'
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
const STRIPE_INTERVAL_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
]
const STRIPE_COUPON_DISCOUNT_TYPE_OPTIONS = [
  { value: 'percent', label: 'Percent (%)' },
  { value: 'amount', label: 'Fixed Amount ($)' },
]
const STRIPE_COUPON_EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never Expires' },
  { value: 'date', label: 'Expires on Date' },
]
const STRIPE_USD_MONEY_MASK = {
  preProcess: val => String(val || '').replace(/[$,]/g, ''),
  postProcess: (val) => {
    if (!val)
      return ''
    const sub = 3 - (String(val).includes('.') ? String(val).length - String(val).indexOf('.') : 0)
    return Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(val).slice(0, sub ? -sub : undefined)
  },
}
const createRulePriceClientId = () => globalThis.crypto?.randomUUID?.() || `price-opt-${Date.now()}-${Math.random().toString(16).slice(2)}`
const createRuleCouponClientId = () => globalThis.crypto?.randomUUID?.() || `coupon-opt-${Date.now()}-${Math.random().toString(16).slice(2)}`
const createRulePriceOption = (value = {}) => {
  const normalizedValue = (value && typeof value === 'object') ? value : {}
  const rawAmount = normalizedValue.amount ?? normalizedValue.unitAmount
  const amount = Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : 0
  const interval = String(normalizedValue.interval || normalizedValue.recurringInterval || 'month').trim().toLowerCase()
  const intervalCount = Number.isFinite(Number(normalizedValue.intervalCount || normalizedValue.recurringIntervalCount))
    ? Math.max(1, Math.trunc(Number(normalizedValue.intervalCount || normalizedValue.recurringIntervalCount)))
    : 1
  const seats = Number.isFinite(Number(normalizedValue.seats || normalizedValue.quantity))
    ? Math.max(1, Math.trunc(Number(normalizedValue.seats || normalizedValue.quantity)))
    : 1
  return {
    _cid: String(normalizedValue._cid || normalizedValue.clientId || createRulePriceClientId()),
    priceId: String(normalizedValue.priceId || normalizedValue.id || '').trim(),
    title: String(normalizedValue.title || '').trim(),
    description: String(normalizedValue.description || '').trim(),
    amount,
    currency: String(normalizedValue.currency || 'usd').trim().toLowerCase() || 'usd',
    interval: ['day', 'week', 'month', 'year'].includes(interval) ? interval : 'month',
    intervalCount,
    seats,
  }
}

const normalizeRulePriceOptions = (value = []) => {
  if (!Array.isArray(value))
    return []
  return value.map(item => createRulePriceOption(item))
}

const createRuleCouponOption = (value = {}) => {
  const normalizedValue = (value && typeof value === 'object') ? value : {}
  const discountType = String(normalizedValue.discountType || '').trim().toLowerCase()
  const expiresMode = String(normalizedValue.expiresMode || '').trim().toLowerCase()
  return {
    _cid: String(normalizedValue._cid || normalizedValue.clientId || createRuleCouponClientId()),
    couponId: String(normalizedValue.couponId || normalizedValue.id || '').trim(),
    promotionCodeId: String(normalizedValue.promotionCodeId || '').trim(),
    promoCode: String(normalizedValue.promoCode || normalizedValue.promotionCode || normalizedValue.code || '').trim(),
    title: String(normalizedValue.title || '').trim(),
    discountType: ['percent', 'amount'].includes(discountType) ? discountType : 'percent',
    percentOff: Number.isFinite(Number(normalizedValue.percentOff))
      ? Number(normalizedValue.percentOff)
      : 10,
    amountOff: Number.isFinite(Number(normalizedValue.amountOff))
      ? Number(normalizedValue.amountOff)
      : 0,
    expiresMode: ['never', 'date'].includes(expiresMode) ? expiresMode : 'never',
    expiresAt: String(normalizedValue.expiresAt || '').trim(),
  }
}

const normalizeRuleCouponOptions = (value = []) => {
  if (!Array.isArray(value))
    return []
  return value.map(item => createRuleCouponOption(item))
}

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
    registrationStripeImage: String(normalizedValue.registrationStripeImage || normalizedValue.stripeImage || '').trim(),
    registrationStripePrices: normalizeRulePriceOptions(normalizedValue.registrationStripePrices || normalizedValue.stripePrices || []),
    registrationStripeCoupons: normalizeRuleCouponOptions(normalizedValue.registrationStripeCoupons || normalizedValue.stripeCoupons || []),
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

const isStripeIntegrationEmpty = (value = {}) => {
  const normalized = buildStripeIntegration(value)
  return !String(normalized.publishableKey || '').trim()
    && !String(normalized.secretKey || '').trim()
    && !String(normalized.webhookSecret || '').trim()
}

const isStripeIntegrationConfigured = (value = {}) => {
  const normalized = buildStripeIntegration(value)
  return Boolean(
    String(normalized.publishableKey || '').trim()
    && String(normalized.secretKey || '').trim()
    && String(normalized.webhookSecret || '').trim()
  )
}

const membersCollection = computed(() => `sites/${props.siteId}/audience-users`)
const membersCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${membersCollection.value}`)
const pagesCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/pages`)
const postsCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/posts`)
const audienceUsersCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/audience-users`)
const stripeIntegrationCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.siteId}/private-integrations`)
const publishedSiteSettingsCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`)

const pickStripeIntegrationDoc = (value = {}) => {
  const normalized = (value && typeof value === 'object') ? value : {}
  const directStripe = normalized?.stripe
  if (directStripe && typeof directStripe === 'object')
    return directStripe

  const candidates = Object.values(normalized)
    .filter(item => item && typeof item === 'object')
    .filter(item => item.publishableKey || item.secretKey || item.webhookSecret)

  if (!candidates.length)
    return {}

  candidates.sort((a, b) => {
    const aUpdated = Number(a?.doc_updated_at || a?.docUpdatedAt || a?.doc_created_at || a?.docCreatedAt || 0)
    const bUpdated = Number(b?.doc_updated_at || b?.docUpdatedAt || b?.doc_created_at || b?.docCreatedAt || 0)
    return bUpdated - aUpdated
  })

  return candidates[0] || {}
}

const sitePages = computed(() => edgeFirebase.data?.[pagesCollectionPath.value] || {})
const sitePosts = computed(() => edgeFirebase.data?.[postsCollectionPath.value] || {})
const stripeIntegrationDoc = computed(() => pickStripeIntegrationDoc(edgeFirebase.data?.[stripeIntegrationCollectionPath.value] || {}))

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
  memberSearch: null,
  memberRows: [],
  memberSearchDebounce: null,
  ruleDeleteDialogOpen: false,
  ruleDeleteDocId: '',
  ruleDeleteSubmitting: false,
  memberDeleteDialogOpen: false,
  memberDeleteDocId: '',
  memberDeleteDisplayName: '',
  memberDeleteSubmitting: false,
  seatMemberName: '',
  seatMemberEmail: '',
  seatMemberSubmitting: false,
  memberStripeActionDialogOpen: false,
  memberStripeActionType: '',
  memberStripeActionAudienceUserId: '',
  memberStripeActionMemberName: '',
  memberStripeActionRuleId: '',
  memberStripeActionDate: '',
  memberStripeActionNoEnd: false,
  memberStripeActionSubmitting: false,
  memberStripeActionError: '',
  stripePlanDetailsDialogOpen: false,
  stripePlanDetailsAudienceUserId: '',
  stripePlanDetailsRuleId: '',
  rulePriceDialogOpen: false,
  rulePriceDialogIndex: -1,
  rulePriceDialogDraft: createRulePriceOption(),
  rulePriceDialogAmountInput: '',
  rulePriceDialogPriceIdReadonly: false,
  rulePriceDeleteDialogOpen: false,
  rulePriceDeleteIndex: -1,
  ruleCouponDialogOpen: false,
  ruleCouponDialogIndex: -1,
  ruleCouponDialogDraft: createRuleCouponOption(),
  ruleCouponDialogAmountInput: '',
  ruleCouponDeleteDialogOpen: false,
  ruleCouponDeleteIndex: -1,
  stripeCatalogDialogOpen: false,
  stripeCatalogLoading: false,
  stripeCatalogProducts: [],
  stripeCatalogSelections: {},
  stripeCatalogImporting: false,
  ruleStripeSyncing: false,
  ruleStripeSyncError: '',
  ruleImagePickerOpen: false,
  stripeSettingsOpen: true,
  stripeSettingsTouched: false,
})

const memberSchema = toTypedSchema(z.object({
  audienceUserId: z.string().optional(),
  status: z.string({
    required_error: 'Status is required',
  }).min(1, { message: 'Status is required' }),
}))

const memberDocSchema = {
  memberSource: { value: 'manual' },
  name: { value: '' },
  email: { value: '' },
  audienceUserId: { value: '' },
  status: { value: 'active' },
  manualAccessRuleIds: { value: [] },
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

const normalizeMemberRow = (member = {}) => {
  const docId = String(member?.docId || '').trim()
  if (!docId)
    return null
  const rawPlanStates = (member?.registrationPlanStates && typeof member.registrationPlanStates === 'object' && !Array.isArray(member.registrationPlanStates))
    ? member.registrationPlanStates
    : {}
  const registrationPlanStates = {}
  Object.keys(rawPlanStates).forEach((ruleId) => {
    const normalizedRuleId = String(ruleId || '').trim()
    if (!normalizedRuleId)
      return
    const plan = rawPlanStates[ruleId]
    if (!plan || typeof plan !== 'object' || Array.isArray(plan))
      return
    registrationPlanStates[normalizedRuleId] = {
      stripeSubscriptionId: String(plan?.stripeSubscriptionId || '').trim(),
      stripePriceId: String(plan?.stripePriceId || '').trim(),
      currentPeriodEnd: Number.isFinite(Number(plan?.currentPeriodEnd))
        ? Math.max(0, Math.trunc(Number(plan.currentPeriodEnd)))
        : 0,
      cancelAt: Number.isFinite(Number(plan?.cancelAt))
        ? Math.max(0, Math.trunc(Number(plan.cancelAt)))
        : 0,
      currency: String(plan?.currency || 'usd').trim().toLowerCase() || 'usd',
      interval: String(plan?.interval || '').trim().toLowerCase(),
      intervalCount: Number.isFinite(Number(plan?.intervalCount))
        ? Math.max(1, Math.trunc(Number(plan.intervalCount)))
        : 1,
      quantity: Number.isFinite(Number(plan?.quantity))
        ? Math.max(1, Math.trunc(Number(plan.quantity)))
        : 1,
      baseAmountCents: Number.isFinite(Number(plan?.baseAmountCents))
        ? Math.max(0, Math.round(Number(plan.baseAmountCents)))
        : 0,
      discountAmountCents: Number.isFinite(Number(plan?.discountAmountCents))
        ? Math.max(0, Math.round(Number(plan.discountAmountCents)))
        : 0,
      amountCents: Number.isFinite(Number(plan?.amountCents))
        ? Math.max(0, Math.round(Number(plan.amountCents)))
        : 0,
      couponCode: String(plan?.couponCode || '').trim(),
      couponLabel: String(plan?.couponLabel || '').trim(),
      paymentStatus: String(plan?.paymentStatus || '').trim().toLowerCase(),
      paymentPaused: plan?.paymentPaused === true,
    }
  })
  return {
    ...member,
    docId,
    audienceUserId: String(member?.audienceUserId || docId).trim(),
    status: String(member?.status || 'active').trim() || 'active',
    accessRuleIds: Array.isArray(member?.accessRuleIds) ? member.accessRuleIds : [],
    manualAccessRuleIds: Array.isArray(member?.manualAccessRuleIds) ? member.manualAccessRuleIds : [],
    paidAccessRuleIds: Array.isArray(member?.paidAccessRuleIds) ? member.paidAccessRuleIds : [],
    pendingPaymentRuleIds: Array.isArray(member?.pendingPaymentRuleIds) ? member.pendingPaymentRuleIds : [],
    notes: String(member?.notes || '').trim(),
    authUid: String(member?.authUid || '').trim(),
    stagedUserId: String(member?.stagedUserId || '').trim(),
    memberSource: String(member?.memberSource || member?.source || '').trim(),
    billingStripeCustomerId: String(member?.billingStripeCustomerId || '').trim(),
    registrationPlanStates,
    manual: member?.manual === true,
  }
}

const getPlanStateForMemberRule = (member = {}, ruleId = '') => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return null
  const planStates = (member?.registrationPlanStates && typeof member.registrationPlanStates === 'object' && !Array.isArray(member.registrationPlanStates))
    ? member.registrationPlanStates
    : {}
  return (planStates[normalizedRuleId] && typeof planStates[normalizedRuleId] === 'object') ? planStates[normalizedRuleId] : null
}

const formatRegistrationPaymentStatus = (value) => {
  const status = String(value || '').trim().toLowerCase()
  if (!status)
    return ''
  const labels = {
    paid: 'Paid',
    pending: 'Pending Payment',
    failed: 'Payment Failed',
    paused: 'Paused',
    cancelled: 'Cancelled',
    not_required: 'Not Required',
  }
  return labels[status] || status.replace(/_/g, ' ')
}

const isStripeBillingPaused = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  const paymentStatus = String(planState?.paymentStatus || '').trim().toLowerCase()
  return planState?.paymentPaused === true || paymentStatus === 'paused'
}

const isStripeSubscriptionCancelled = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  const paymentStatus = String(planState?.paymentStatus || '').trim().toLowerCase()
  return paymentStatus === 'cancelled' || paymentStatus === 'canceled'
}

const getDateInputToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getDateInputFromUnix = (unixValue) => {
  const unix = Number(unixValue || 0)
  if (!Number.isFinite(unix) || unix <= 0)
    return ''
  const date = new Date(unix * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeMemberStripeActionType = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (['cancel', 'pause', 'resume', 'update_duration'].includes(normalized))
    return normalized
  return ''
}

const getMemberStripeActionRuleLabel = (ruleId) => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return ''
  const item = currentRules.value.find(candidate => candidate.id === normalizedRuleId)
  return item?.name || normalizedRuleId
}

const getMemberDisplayName = (member = {}) => {
  const name = String(member?.name || '').trim()
  if (name)
    return name
  const email = String(member?.email || '').trim()
  if (email)
    return email
  const audienceUserId = String(member?.audienceUserId || member?.docId || '').trim()
  if (audienceUserId)
    return getAudienceUserLabel(audienceUserId) || audienceUserId
  return 'Member'
}

const getMemberPaidPlanEntries = (member = {}) => {
  const paidRuleIds = Array.isArray(member?.paidAccessRuleIds) ? member.paidAccessRuleIds.filter(Boolean) : []
  return paidRuleIds
    .map((ruleId) => {
      const planState = getPlanStateForMemberRule(member, ruleId)
      if (!planState)
        return null
      return {
        ruleId,
        ruleLabel: getRuleLabel(ruleId),
        paymentStatus: String(planState.paymentStatus || '').trim().toLowerCase(),
        paymentPaused: planState.paymentPaused === true,
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.ruleLabel || a.ruleId).localeCompare(String(b.ruleLabel || b.ruleId)))
}

const openStripePlanDetailsDialog = (member = {}, ruleId = '') => {
  const audienceUserId = String(member?.audienceUserId || member?.docId || '').trim()
  const normalizedRuleId = String(ruleId || '').trim()
  if (!audienceUserId || !normalizedRuleId)
    return
  state.stripePlanDetailsAudienceUserId = audienceUserId
  state.stripePlanDetailsRuleId = normalizedRuleId
  state.stripePlanDetailsDialogOpen = true
}

const closeStripePlanDetailsDialog = () => {
  state.stripePlanDetailsDialogOpen = false
  state.stripePlanDetailsAudienceUserId = ''
  state.stripePlanDetailsRuleId = ''
}

const refreshSelectedMemberEditor = async () => {
  const currentId = String(state.selectedMemberId || '').trim()
  if (!currentId || currentId === 'new')
    return
  state.selectedMemberId = ''
  await nextTick()
  state.selectedMemberId = currentId
}

const stripePlanDetailsMember = computed(() => {
  const audienceUserId = String(state.stripePlanDetailsAudienceUserId || '').trim()
  if (!audienceUserId)
    return null
  return (state.memberRows || []).find(item => String(item?.docId || item?.audienceUserId || '').trim() === audienceUserId) || null
})

const stripePlanDetailsRuleLabel = computed(() => getRuleLabel(state.stripePlanDetailsRuleId))

const formatStripeMoneyFromCents = (amountCents = 0, currency = 'usd') => {
  const amount = Number(amountCents || 0) / 100
  const normalizedCurrency = String(currency || 'usd').trim().toUpperCase() || 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: normalizedCurrency }).format(amount)
  }
  catch {
    return `$${amount.toFixed(2)}`
  }
}

const formatStripeUnixDate = (value) => {
  const unix = Number(value || 0)
  if (!Number.isFinite(unix) || unix <= 0)
    return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(unix * 1000))
  }
  catch {
    return ''
  }
}

const getStripeCurrentDurationLabel = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  return formatStripeUnixDate(planState?.currentPeriodEnd)
}

const getStripeScheduledDurationLabel = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  return formatStripeUnixDate(planState?.cancelAt)
}

const formatStripeBillingCycle = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  const amountCents = Number(planState?.amountCents || 0)
  const currency = String(planState?.currency || 'usd').trim()
  const interval = String(planState?.interval || '').trim().toLowerCase()
  const intervalCount = Number.isFinite(Number(planState?.intervalCount))
    ? Math.max(1, Math.trunc(Number(planState.intervalCount)))
    : 1
  if (!amountCents || !interval)
    return ''
  const amountLabel = formatStripeMoneyFromCents(amountCents, currency)
  const suffix = intervalCount > 1 ? `${intervalCount} ${interval}s` : interval
  return `${amountLabel} / ${suffix}`
}

const formatStripeCouponSummary = (member = {}, ruleId = '') => {
  const planState = getPlanStateForMemberRule(member, ruleId)
  const discountCents = Number(planState?.discountAmountCents || 0)
  if (!discountCents)
    return ''
  const currency = String(planState?.currency || 'usd').trim()
  const code = String(planState?.couponCode || '').trim()
  const label = String(planState?.couponLabel || '').trim()
  const discountLabel = formatStripeMoneyFromCents(discountCents, currency)
  if (code)
    return `${code} (${discountLabel} off)`
  if (label)
    return `${label} (${discountLabel} off)`
  return `${discountLabel} off`
}

const openMemberStripeActionDialog = ({ action, member, ruleId }) => {
  const normalizedAction = normalizeMemberStripeActionType(action)
  const normalizedRuleId = String(ruleId || '').trim()
  const audienceUserId = String(member?.audienceUserId || member?.docId || '').trim()
  if (!normalizedAction || !normalizedRuleId || !audienceUserId)
    return
  state.memberStripeActionType = normalizedAction
  state.memberStripeActionRuleId = normalizedRuleId
  state.memberStripeActionAudienceUserId = audienceUserId
  state.memberStripeActionMemberName = getMemberDisplayName(member)
  const existingCancelAt = Number(getPlanStateForMemberRule(member, normalizedRuleId)?.cancelAt || 0)
  state.memberStripeActionNoEnd = normalizedAction === 'update_duration' ? existingCancelAt <= 0 : false
  state.memberStripeActionDate = normalizedAction === 'update_duration'
    ? (existingCancelAt > 0 ? getDateInputFromUnix(existingCancelAt) : getDateInputToday())
    : ''
  state.memberStripeActionError = ''
  state.stripePlanDetailsDialogOpen = false
  state.memberStripeActionDialogOpen = true
}

const closeMemberStripeActionDialog = (force = false) => {
  if (state.memberStripeActionSubmitting && !force)
    return
  state.memberStripeActionDialogOpen = false
  state.memberStripeActionType = ''
  state.memberStripeActionRuleId = ''
  state.memberStripeActionAudienceUserId = ''
  state.memberStripeActionMemberName = ''
  state.memberStripeActionDate = ''
  state.memberStripeActionNoEnd = false
  state.memberStripeActionError = ''
}

const memberStripeActionDialogTitle = computed(() => {
  if (state.memberStripeActionType === 'cancel')
    return 'Cancel Stripe Subscription?'
  if (state.memberStripeActionType === 'pause')
    return 'Pause Stripe Subscription?'
  if (state.memberStripeActionType === 'resume')
    return 'Resume Stripe Subscription?'
  if (state.memberStripeActionType === 'update_duration')
    return 'Update Subscription End Date?'
  return 'Confirm Stripe Action'
})

const memberStripeActionDialogDescription = computed(() => {
  const label = getMemberStripeActionRuleLabel(state.memberStripeActionRuleId)
  if (state.memberStripeActionType === 'cancel')
    return `This cancels billing now for ${label}. Access will be removed when Stripe confirms cancellation.`
  if (state.memberStripeActionType === 'pause')
    return `This pauses billing for ${label} on Stripe until you resume it there.`
  if (state.memberStripeActionType === 'resume')
    return `This resumes billing for ${label} on Stripe.`
  if (state.memberStripeActionType === 'update_duration')
    return `Set an end date for ${label}. Stripe will cancel the subscription on that date.`
  return 'Continue with this Stripe update?'
})

const canSubmitMemberStripeAction = computed(() => {
  if (state.memberStripeActionSubmitting)
    return false
  if (!state.memberStripeActionAudienceUserId || !state.memberStripeActionRuleId || !state.memberStripeActionType)
    return false
  if (state.memberStripeActionType === 'update_duration')
    return state.memberStripeActionNoEnd || Boolean(String(state.memberStripeActionDate || '').trim())
  return true
})

const submitMemberStripeAction = async () => {
  if (!canSubmitMemberStripeAction.value)
    return
  const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
  const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
  if (!uid || !orgId || !props.siteId)
    return

  state.memberStripeActionSubmitting = true
  state.memberStripeActionError = ''
  try {
    const payload = {
      uid,
      orgId,
      siteId: props.siteId,
      audienceUserId: state.memberStripeActionAudienceUserId,
      ruleId: state.memberStripeActionRuleId,
      action: state.memberStripeActionType,
    }
    if (state.memberStripeActionType === 'update_duration') {
      payload.noEnd = state.memberStripeActionNoEnd === true
      if (!payload.noEnd)
        payload.effectiveDate = String(state.memberStripeActionDate || '').trim()
    }

    const response = await edgeFirebase.runFunction('cms-restrictedContentManageStripeSubscription', payload)
    const result = response?.data || response || {}
    if (result?.success === false)
      throw new Error(String(result?.message || 'Unable to update Stripe subscription right now.'))

    edgeFirebase?.toast?.success?.(String(result?.message || 'Stripe subscription updated.'))
    await loadInitialMembers()
    closeMemberStripeActionDialog(true)
    await refreshSelectedMemberEditor()
  }
  catch (error) {
    state.memberStripeActionError = String(error?.message || 'Unable to update Stripe subscription right now.')
    edgeFirebase?.toast?.error?.(state.memberStripeActionError)
  }
  finally {
    state.memberStripeActionSubmitting = false
  }
}

const hasStripeMemberInfo = (member = {}) => {
  const paidRuleIds = Array.isArray(member?.paidAccessRuleIds) ? member.paidAccessRuleIds.filter(Boolean) : []
  return Boolean(
    String(member?.billingStripeCustomerId || '').trim()
    || paidRuleIds.length
  )
}

const getAudienceUserLabel = (audienceUserId) => {
  if (!audienceUserId)
    return ''
  const item = (state.memberRows || []).find(member => member?.docId === audienceUserId || member?.audienceUserId === audienceUserId)
  return item?.name || item?.email || audienceUserId
}

const getAudienceUserDocId = (member = {}) => {
  return String(member?.audienceUserId || member?.docId || '').trim()
}

const getSeatRuleIdForMember = (member = {}) => {
  const paid = Array.isArray(member?.paidAccessRuleIds) ? member.paidAccessRuleIds.filter(Boolean) : []
  return String(paid[0] || '').trim()
}

const getSeatOwnersByRule = (member = {}) => {
  const next = {}
  const raw = (member?.seatOwnersByRule && typeof member.seatOwnersByRule === 'object' && !Array.isArray(member.seatOwnersByRule))
    ? member.seatOwnersByRule
    : {}
  for (const [ruleId, item] of Object.entries(raw)) {
    const normalizedRuleId = String(ruleId || '').trim()
    if (!normalizedRuleId || !item || typeof item !== 'object' || Array.isArray(item))
      continue
    const ownerAudienceUserId = String(item.ownerAudienceUserId || item.seatOwnerAudienceUserId || '').trim()
    if (!ownerAudienceUserId)
      continue
    next[normalizedRuleId] = {
      ownerAudienceUserId,
      ownerName: String(item.ownerName || item.seatOwnerName || '').trim(),
    }
  }

  const legacyRuleId = String(member?.seatOwnerRuleId || '').trim()
  const legacyOwnerAudienceUserId = String(member?.seatOwnerAudienceUserId || '').trim()
  if (legacyRuleId && legacyOwnerAudienceUserId && !next[legacyRuleId]) {
    next[legacyRuleId] = {
      ownerAudienceUserId: legacyOwnerAudienceUserId,
      ownerName: String(member?.seatOwnerName || '').trim(),
    }
  }

  return next
}

const getSeatOwnerForMemberRule = (member = {}, ruleId = '') => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return null
  const ownershipMap = getSeatOwnersByRule(member)
  return ownershipMap[normalizedRuleId] || null
}

const getSeatOwnerAudienceUserIdForMember = (member = {}) => {
  const seatRuleId = getSeatRuleIdForMember(member)
  if (seatRuleId) {
    const ownerForRule = getSeatOwnerForMemberRule(member, seatRuleId)
    if (ownerForRule?.ownerAudienceUserId)
      return String(ownerForRule.ownerAudienceUserId).trim()
  }
  const firstOwner = Object.values(getSeatOwnersByRule(member))[0]
  return String(firstOwner?.ownerAudienceUserId || '').trim()
}

const getSeatLimitForMember = (member = {}) => {
  const seatRuleId = getSeatRuleIdForMember(member)
  const quantity = Number(getPlanStateForMemberRule(member, seatRuleId)?.quantity || 0)
  if (!Number.isFinite(quantity))
    return 1
  return Math.max(1, Math.trunc(quantity))
}

const canManageSeatMembers = (member = {}) => {
  const seatRuleId = getSeatRuleIdForMember(member)
  const seatLimit = getSeatLimitForMember(member)
  const isSeatChild = Boolean(getSeatOwnerForMemberRule(member, seatRuleId)?.ownerAudienceUserId)
  const paymentStatus = String(getPlanStateForMemberRule(member, seatRuleId)?.paymentStatus || '').trim().toLowerCase()
  const paidRuleIds = Array.isArray(member?.paidAccessRuleIds) ? member.paidAccessRuleIds.filter(Boolean) : []
  return Boolean(
    seatRuleId
    && seatLimit > 1
    && !isSeatChild
    && paidRuleIds.includes(seatRuleId)
    && ['paid', 'paused'].includes(paymentStatus)
  )
}

const getManagedSeatMembers = (member = {}) => {
  const ownerId = getAudienceUserDocId(member)
  const seatRuleId = getSeatRuleIdForMember(member)
  if (!ownerId || !seatRuleId)
    return []
  return (state.memberRows || [])
    .filter((item) => {
      if (!item || getAudienceUserDocId(item) === ownerId)
        return false
      return String(getSeatOwnerForMemberRule(item, seatRuleId)?.ownerAudienceUserId || '').trim() === ownerId
    })
    .sort((a, b) => getMemberDisplayName(a).localeCompare(getMemberDisplayName(b)))
}

const getSeatUsageLabel = (member = {}) => {
  if (!canManageSeatMembers(member))
    return ''
  const seatLimit = getSeatLimitForMember(member)
  const used = 1 + getManagedSeatMembers(member).length
  return `${used} / ${seatLimit} seats used`
}

const getSeatOwnerLabel = (member = {}) => {
  const seatRuleId = getSeatRuleIdForMember(member)
  const ownerForRule = getSeatOwnerForMemberRule(member, seatRuleId)
  const ownerId = String(ownerForRule?.ownerAudienceUserId || '').trim()
  if (!ownerId)
    return ''
  const owner = (state.memberRows || []).find(item => getAudienceUserDocId(item) === ownerId)
  return owner ? getMemberDisplayName(owner) : (String(ownerForRule?.ownerName || '').trim() || ownerId)
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
  const mergedMembers = (state.memberRows || [])

  return mergedMembers
    .filter((item) => {
      if (!item?.docId)
        return false
      if (!filter)
        return true
      const haystack = [
        item?.audienceUserId,
        getAudienceUserLabel(item?.audienceUserId),
        ...(Array.isArray(item?.manualAccessRuleIds) ? item.manualAccessRuleIds.map(ruleId => getRuleLabel(ruleId)) : []),
        item?.status,
      ].map(value => String(value || '').toLowerCase()).join(' ')
      return haystack.includes(filter)
    })
    .sort((a, b) => getAudienceUserLabel(a?.audienceUserId).localeCompare(getAudienceUserLabel(b?.audienceUserId)))
})

const memberTotal = computed(() => {
  return (state.memberRows || []).length
})
const canLoadMoreMembers = computed(() => false)

const settingsDirty = computed(() => {
  return JSON.stringify(normalizeObject(buildRestrictedSettings(state.settings))) !== JSON.stringify(normalizeObject(currentSettings.value))
})

const stripeDirty = computed(() => {
  return JSON.stringify(normalizeObject(buildStripeIntegration(state.stripeIntegration))) !== JSON.stringify(normalizeObject(currentStripeIntegration.value))
})

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
  if (!state.stripeSettingsTouched)
    state.stripeSettingsOpen = !isStripeIntegrationConfigured(state.stripeIntegration)
}

const persistRestrictedSettings = async (nextSettings, options = {}) => {
  const normalizedNextSettings = buildRestrictedSettings(nextSettings)
  const nextVersion = Number.isFinite(Number(props.siteDoc?.version))
    ? Math.max(0, Math.trunc(Number(props.siteDoc.version))) + 1
    : 1
  await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.siteId, {
    restrictedContent: normalizedNextSettings,
    version: nextVersion,
  })

  try {
    const publishedDoc = await edgeFirebase.getDocData(publishedSiteSettingsCollectionPath.value, props.siteId)
    if (publishedDoc?.docId) {
      await edgeFirebase.changeDoc(publishedSiteSettingsCollectionPath.value, props.siteId, {
        restrictedContent: normalizedNextSettings,
      })
    }
  }
  catch (error) {
    console.warn('persistRestrictedSettings published rules sync skipped', error)
  }

  if (options?.syncState !== false)
    state.settings = normalizedNextSettings
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
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const payload = {
      docId: 'stripe',
      ...buildStripeIntegration(state.stripeIntegration),
      ...(uid ? { uid } : {}),
    }
    let result = null
    try {
      result = await edgeFirebase.storeDocRaw(stripeIntegrationCollectionPath.value, payload, 'stripe')
    }
    catch (rawError) {
      console.warn('saveStripeIntegration storeDocRaw failed, retrying storeDoc', rawError)
      result = await edgeFirebase.storeDoc(stripeIntegrationCollectionPath.value, payload)
    }
    if (result?.success === false)
      throw new Error(String(result?.message || 'Unable to save Stripe settings right now.'))
    state.stripeIntegration = buildStripeIntegration(payload)
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (uid && orgId && props.siteId) {
      try {
        const brandingResponse = await edgeFirebase.runFunction('cms-restrictedContentSyncStripeBranding', {
          uid,
          orgId,
          siteId: props.siteId,
        })
        const brandingResult = brandingResponse?.data || brandingResponse || {}
        if (brandingResult?.applied === true)
          edgeFirebase?.toast?.success?.('Stripe settings saved and Stripe branding logo synced from site logo.')
        else
          edgeFirebase?.toast?.success?.('Stripe settings saved.')
      }
      catch (brandingError) {
        console.error('saveStripeIntegration branding sync failed', brandingError)
        edgeFirebase?.toast?.success?.('Stripe settings saved.')
        edgeFirebase?.toast?.error?.(String(brandingError?.message || 'Stripe branding logo sync failed.'))
      }
    }
    else {
      edgeFirebase?.toast?.success?.('Stripe settings saved.')
    }
    await openStripeCatalogImportDialog()
  }
  catch (error) {
    console.error('saveStripeIntegration failed', error)
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to save Stripe settings right now.'))
  }
  finally {
    state.stripeSaving = false
  }
}

const resetStripeIntegration = () => {
  syncStripeIntegrationFromDoc()
}

const toggleStripeSettingsOpen = () => {
  state.stripeSettingsTouched = true
  state.stripeSettingsOpen = !state.stripeSettingsOpen
}

const getStripeCatalogSelectionState = (productId) => {
  const key = String(productId || '').trim()
  if (!key)
    return { selected: false, prices: {} }
  if (!state.stripeCatalogSelections[key])
    state.stripeCatalogSelections[key] = { selected: false, prices: {} }
  return state.stripeCatalogSelections[key]
}

const setStripeCatalogDefaults = (products = []) => {
  const nextSelections = {}
  products.forEach((product) => {
    const productId = String(product?.productId || '').trim()
    if (!productId)
      return
    const priceSelections = {}
    ;(Array.isArray(product?.prices) ? product.prices : []).forEach((price) => {
      const priceId = String(price?.id || '').trim()
      if (!priceId)
        return
      priceSelections[priceId] = Boolean(price?.managed)
    })
    nextSelections[productId] = {
      selected: Boolean(product?.managed),
      prices: priceSelections,
    }
  })
  state.stripeCatalogSelections = nextSelections
}

const openStripeCatalogImportDialog = async () => {
  state.stripeCatalogLoading = true
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (!uid || !orgId || !props.siteId)
      return
    const response = await edgeFirebase.runFunction('cms-restrictedContentGetStripeCatalog', {
      uid,
      orgId,
      siteId: props.siteId,
    })
    const result = response?.data || response || {}
    const products = Array.isArray(result?.products) ? result.products : []
    state.stripeCatalogProducts = products
    setStripeCatalogDefaults(products)
    state.stripeCatalogDialogOpen = true
  }
  catch (error) {
    console.error('openStripeCatalogImportDialog failed', error)
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to fetch Stripe catalog right now.'))
  }
  finally {
    state.stripeCatalogLoading = false
  }
}

const toggleStripeCatalogProduct = (productId, checked) => {
  const selection = getStripeCatalogSelectionState(productId)
  selection.selected = Boolean(checked)
}

const toggleStripeCatalogPrice = (productId, priceId, checked) => {
  const selection = getStripeCatalogSelectionState(productId)
  selection.prices[String(priceId || '').trim()] = Boolean(checked)
}

const importSelectedStripeCatalog = async () => {
  if (state.stripeCatalogImporting)
    return
  const selections = (state.stripeCatalogProducts || []).map((product) => {
    const productId = String(product?.productId || '').trim()
    const selection = getStripeCatalogSelectionState(productId)
    const selectedPriceIds = (Array.isArray(product?.prices) ? product.prices : [])
      .map(price => String(price?.id || '').trim())
      .filter(priceId => priceId && selection.prices[priceId] === true)
    if (!selection.selected || !productId || !selectedPriceIds.length)
      return null
    return {
      productId,
      name: String(product?.name || '').trim(),
      priceIds: selectedPriceIds,
    }
  }).filter(Boolean)

  if (!selections.length) {
    state.stripeCatalogDialogOpen = false
    return
  }

  state.stripeCatalogImporting = true
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    const response = await edgeFirebase.runFunction('cms-restrictedContentImportStripeCatalog', {
      uid,
      orgId,
      siteId: props.siteId,
      selections,
    })
    const result = response?.data || response || {}
    const importedRules = Array.isArray(result?.rules) ? result.rules : []
    if (importedRules.length) {
      const nextSettings = buildRestrictedSettings({
        ...state.settings,
        rules: importedRules,
      })
      state.settings = nextSettings
      await persistRestrictedSettings(nextSettings)
    }
    state.stripeCatalogDialogOpen = false
    edgeFirebase?.toast?.success?.(`Imported ${Number(result?.imported || 0)} Stripe products.`)
  }
  catch (error) {
    console.error('importSelectedStripeCatalog failed', error)
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to import Stripe catalog right now.'))
  }
  finally {
    state.stripeCatalogImporting = false
  }
}

const loadInitialMembers = async () => {
  if (!props.canManage)
    return
  state.membersLoading = true
  try {
    const queryText = String(state.memberFilter || '').trim()
    const limit = 250
    const collectionPath = audienceUsersCollectionPath.value
    const buildPrefixFilters = field => (queryText
      ? [
          { field, operator: '>=', value: queryText },
          { field, operator: '<=', value: `${queryText}\uF8FF` },
        ]
      : [])

    const staticSearches = []
    const querySets = queryText
      ? [
          [{ field: 'status', operator: '!=', value: 'invited' }, ...buildPrefixFilters('name')],
          [{ field: 'status', operator: '!=', value: 'invited' }, ...buildPrefixFilters('email')],
        ]
      : [
          [{ field: 'status', operator: '!=', value: 'invited' }],
        ]

    const merged = {}
    for (const query of querySets) {
      const staticSearch = new edgeFirebase.SearchStaticData()
      staticSearches.push(staticSearch)
      await staticSearch.getData(collectionPath, query, [], limit)
      const rows = Object.values(staticSearch?.results?.data || {})
      rows.forEach((row) => {
        const normalized = normalizeMemberRow(row)
        if (normalized?.docId)
          merged[normalized.docId] = normalized
      })
    }
    state.memberSearch = staticSearches[0] || null
    state.memberRows = Object.values(merged)
      .sort((a, b) => getAudienceUserLabel(a?.docId).localeCompare(getAudienceUserLabel(b?.docId)))
  }
  finally {
    state.membersLoading = false
  }
}

const loadMoreMembers = async () => {
  return
}

const handleMemberSaved = ({ docId, data }) => {
  if (!docId || !data)
    return
  state.selectedMemberId = docId
  loadInitialMembers()
}

const startSnapshots = async () => {
  if (!props.canManage)
    return
  const tasks = []
  if (!edgeFirebase.data?.[pagesCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(pagesCollectionPath.value))
  if (!edgeFirebase.data?.[postsCollectionPath.value])
    tasks.push(edgeFirebase.startSnapshot(postsCollectionPath.value))
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
    registrationStripeImage: '',
    registrationStripePrices: [],
    registrationStripeCoupons: [],
  })
  state.ruleError = ''
  state.ruleStripeSyncError = ''
  state.ruleImagePickerOpen = false
}

const removeRulePriceOption = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripePrices))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripePrices.length)
    return
  state.ruleWorkingDoc.registrationStripePrices.splice(index, 1)
}

const openDeleteRulePriceOptionDialog = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripePrices))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripePrices.length)
    return
  state.rulePriceDeleteIndex = index
  state.rulePriceDeleteDialogOpen = true
}

const closeDeleteRulePriceOptionDialog = () => {
  state.rulePriceDeleteDialogOpen = false
  state.rulePriceDeleteIndex = -1
}

const confirmDeleteRulePriceOption = () => {
  if (state.rulePriceDeleteIndex < 0) {
    closeDeleteRulePriceOptionDialog()
    return
  }
  removeRulePriceOption(state.rulePriceDeleteIndex)
  closeDeleteRulePriceOptionDialog()
}

const openNewRulePriceOptionDialog = () => {
  state.rulePriceDialogIndex = -1
  state.rulePriceDialogDraft = createRulePriceOption()
  state.rulePriceDialogAmountInput = ''
  state.rulePriceDialogPriceIdReadonly = false
  state.rulePriceDialogOpen = true
}

const openEditRulePriceOptionDialog = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripePrices))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripePrices.length)
    return
  state.rulePriceDialogIndex = index
  state.rulePriceDialogDraft = createRulePriceOption(state.ruleWorkingDoc.registrationStripePrices[index])
  state.rulePriceDialogAmountInput = Number(state.rulePriceDialogDraft.amount || 0) > 0
    ? Number(state.rulePriceDialogDraft.amount).toFixed(2)
    : ''
  state.rulePriceDialogPriceIdReadonly = Boolean(String(state.rulePriceDialogDraft.priceId || '').trim())
  state.rulePriceDialogOpen = true
}

const closeRulePriceOptionDialog = () => {
  state.rulePriceDialogOpen = false
  state.rulePriceDialogIndex = -1
  state.rulePriceDialogDraft = createRulePriceOption()
  state.rulePriceDialogAmountInput = ''
  state.rulePriceDialogPriceIdReadonly = false
}

const parseRulePriceAmountInput = (value) => {
  const parsed = Number(String(value || '')
    .replace(/[^0-9.]/g, '')
    .replace(/^(\d*\.?\d*).*$/, '$1'))
  return Number.isFinite(parsed) ? parsed : 0
}

const getRuleCouponDialogValidation = (draft = state.ruleCouponDialogDraft) => {
  const coupon = createRuleCouponOption(draft)
  const amountOff = parseRulePriceAmountInput(state.ruleCouponDialogAmountInput)
  const errors = {
    title: '',
    promoCode: '',
    percentOff: '',
    amountOff: '',
    expiresAt: '',
  }
  if (!String(coupon.title || '').trim())
    errors.title = 'Title is required.'
  if (!String(coupon.promoCode || '').trim())
    errors.promoCode = 'Promo code is required.'
  if (coupon.discountType === 'percent') {
    if (!Number.isFinite(Number(coupon.percentOff)) || Number(coupon.percentOff) <= 0 || Number(coupon.percentOff) > 100)
      errors.percentOff = 'Enter a percent between 0 and 100.'
  }
  else if (!Number.isFinite(Number(amountOff)) || Number(amountOff) <= 0) {
    errors.amountOff = 'Enter an amount greater than 0.'
  }
  if (coupon.expiresMode === 'date' && !String(coupon.expiresAt || '').trim())
    errors.expiresAt = 'Expiration date is required.'

  return {
    errors,
    hasError: Object.values(errors).some(Boolean),
  }
}

const saveRulePriceOptionDialog = () => {
  const nextOption = createRulePriceOption(state.rulePriceDialogDraft)
  nextOption.amount = parseRulePriceAmountInput(state.rulePriceDialogAmountInput)
  nextOption.currency = 'usd'
  if (!nextOption.title) {
    state.ruleError = 'Price option title is required.'
    return
  }
  if (!Number.isFinite(Number(nextOption.amount)) || Number(nextOption.amount) <= 0) {
    state.ruleError = 'Price option amount must be greater than 0.'
    return
  }
  if (!Number.isFinite(Number(nextOption.seats)) || Number(nextOption.seats) < 1) {
    state.ruleError = 'Seats must be at least 1.'
    return
  }
  state.ruleError = ''
  if (!nextOption._cid)
    nextOption._cid = createRulePriceClientId()

  if (state.rulePriceDialogPriceIdReadonly)
    nextOption.priceId = String(state.rulePriceDialogDraft.priceId || '').trim()

  if (state.rulePriceDialogIndex >= 0 && state.rulePriceDialogIndex < (state.ruleWorkingDoc.registrationStripePrices || []).length)
    nextOption._cid = state.ruleWorkingDoc.registrationStripePrices[state.rulePriceDialogIndex]?._cid || nextOption._cid

  if (!Array.isArray(state.ruleWorkingDoc.registrationStripePrices))
    state.ruleWorkingDoc.registrationStripePrices = []

  if (state.rulePriceDialogIndex >= 0 && state.rulePriceDialogIndex < state.ruleWorkingDoc.registrationStripePrices.length) {
    state.ruleWorkingDoc.registrationStripePrices[state.rulePriceDialogIndex] = nextOption
  }
  else {
    state.ruleWorkingDoc.registrationStripePrices.push(nextOption)
  }
  closeRulePriceOptionDialog()
}

const removeRuleCouponOption = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripeCoupons))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripeCoupons.length)
    return
  state.ruleWorkingDoc.registrationStripeCoupons.splice(index, 1)
}

const openDeleteRuleCouponDialog = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripeCoupons))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripeCoupons.length)
    return
  state.ruleCouponDeleteIndex = index
  state.ruleCouponDeleteDialogOpen = true
}

const closeDeleteRuleCouponDialog = () => {
  state.ruleCouponDeleteDialogOpen = false
  state.ruleCouponDeleteIndex = -1
}

const confirmDeleteRuleCouponDialog = () => {
  if (state.ruleCouponDeleteIndex < 0) {
    closeDeleteRuleCouponDialog()
    return
  }
  removeRuleCouponOption(state.ruleCouponDeleteIndex)
  closeDeleteRuleCouponDialog()
}

const openNewRuleCouponDialog = () => {
  state.ruleCouponDialogIndex = -1
  state.ruleCouponDialogDraft = createRuleCouponOption()
  state.ruleCouponDialogAmountInput = ''
  state.ruleCouponDialogOpen = true
}

const openEditRuleCouponDialog = (index) => {
  if (!Array.isArray(state.ruleWorkingDoc.registrationStripeCoupons))
    return
  if (index < 0 || index >= state.ruleWorkingDoc.registrationStripeCoupons.length)
    return
  state.ruleCouponDialogIndex = index
  state.ruleCouponDialogDraft = createRuleCouponOption(state.ruleWorkingDoc.registrationStripeCoupons[index])
  state.ruleCouponDialogAmountInput = Number(state.ruleCouponDialogDraft.amountOff || 0) > 0
    ? Number(state.ruleCouponDialogDraft.amountOff).toFixed(2)
    : ''
  state.ruleCouponDialogOpen = true
}

const closeRuleCouponDialog = () => {
  state.ruleCouponDialogOpen = false
  state.ruleCouponDialogIndex = -1
  state.ruleCouponDialogDraft = createRuleCouponOption()
  state.ruleCouponDialogAmountInput = ''
}

const saveRuleCouponDialog = () => {
  const validation = getRuleCouponDialogValidation()
  if (validation.hasError)
    return
  const nextCoupon = createRuleCouponOption(state.ruleCouponDialogDraft)
  nextCoupon.amountOff = parseRulePriceAmountInput(state.ruleCouponDialogAmountInput)

  if (!Array.isArray(state.ruleWorkingDoc.registrationStripeCoupons))
    state.ruleWorkingDoc.registrationStripeCoupons = []

  if (state.ruleCouponDialogIndex >= 0 && state.ruleCouponDialogIndex < state.ruleWorkingDoc.registrationStripeCoupons.length) {
    nextCoupon._cid = state.ruleWorkingDoc.registrationStripeCoupons[state.ruleCouponDialogIndex]?._cid || nextCoupon._cid
    state.ruleWorkingDoc.registrationStripeCoupons[state.ruleCouponDialogIndex] = nextCoupon
  }
  else {
    state.ruleWorkingDoc.registrationStripeCoupons.push(nextCoupon)
  }
  closeRuleCouponDialog()
}

const openRule = async (docId) => {
  if (!docId)
    return
  state.selectedRuleId = docId
  state.ruleWorkingDoc = createRuleDoc(currentRules.value.find(item => item.id === docId), docId)
  state.ruleError = ''
  state.ruleStripeSyncError = ''
  state.ruleImagePickerOpen = false
}

const closeRuleEditor = () => {
  state.selectedRuleId = ''
  state.ruleWorkingDoc = createRuleDoc()
  state.ruleError = ''
  state.ruleStripeSyncError = ''
  state.ruleImagePickerOpen = false
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

const formatRulePriceSummary = (priceOption = {}) => {
  const amount = Number(priceOption?.amount || 0)
  const currency = String(priceOption?.currency || 'usd').toUpperCase()
  const interval = String(priceOption?.interval || 'month').toLowerCase()
  const intervalCount = Math.max(1, Number(priceOption?.intervalCount || 1) || 1)
  const amountLabel = Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
  const intervalLabel = intervalCount > 1 ? `${intervalCount} ${interval}s` : interval
  const seats = Math.max(1, Number(priceOption?.seats || 1) || 1)
  const seatsLabel = seats === 1 ? '1 seat' : `${seats} seats`
  return `${amountLabel} ${currency} / ${intervalLabel} · ${seatsLabel}`
}

const normalizePriceOptionForSave = (option = {}) => {
  const normalized = createRulePriceOption(option)
  return {
    priceId: String(normalized.priceId || '').trim(),
    title: String(normalized.title || '').trim(),
    description: String(normalized.description || '').trim(),
    amount: Number.isFinite(Number(normalized.amount)) ? Number(normalized.amount) : 0,
    currency: 'usd',
    interval: ['day', 'week', 'month', 'year'].includes(String(normalized.interval || '').toLowerCase())
      ? String(normalized.interval || '').toLowerCase()
      : 'month',
    intervalCount: Number.isFinite(Number(normalized.intervalCount))
      ? Math.max(1, Math.trunc(Number(normalized.intervalCount)))
      : 1,
    seats: Number.isFinite(Number(normalized.seats))
      ? Math.max(1, Math.trunc(Number(normalized.seats)))
      : 1,
  }
}

const normalizeCouponOptionForSave = (option = {}) => {
  const normalized = createRuleCouponOption(option)
  return {
    couponId: String(normalized.couponId || '').trim(),
    promotionCodeId: String(normalized.promotionCodeId || '').trim(),
    promoCode: String(normalized.promoCode || '').trim(),
    title: String(normalized.title || '').trim(),
    discountType: normalized.discountType === 'amount' ? 'amount' : 'percent',
    percentOff: Number.isFinite(Number(normalized.percentOff))
      ? Number(normalized.percentOff)
      : 10,
    amountOff: Number.isFinite(Number(normalized.amountOff))
      ? Number(normalized.amountOff)
      : 0,
    expiresMode: normalized.expiresMode === 'date' ? 'date' : 'never',
    expiresAt: String(normalized.expiresAt || '').trim(),
  }
}

const normalizeRuleForSite = (value = {}) => {
  const nextRule = createRuleDoc(value, value?.id || value?.docId || '')
  nextRule.protected = true
  nextRule.allowRegistration = true
  nextRule.registrationMode = 'paid'
  nextRule.registrationStripeImage = String(nextRule.registrationStripeImage || '').trim()
  nextRule.registrationStripePrices = Array.isArray(nextRule.registrationStripePrices)
    ? nextRule.registrationStripePrices.map(item => normalizePriceOptionForSave(item))
    : []
  nextRule.registrationStripeCoupons = Array.isArray(nextRule.registrationStripeCoupons)
    ? nextRule.registrationStripeCoupons.map(item => normalizeCouponOptionForSave(item))
    : []
  return nextRule
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
  if (!Array.isArray(nextRule.registrationStripePrices) || !nextRule.registrationStripePrices.length) {
    state.ruleError = 'Add at least one Stripe price option.'
    return
  }
  state.ruleSubmitting = true
  state.ruleError = ''
  state.ruleStripeSyncError = ''
  try {
    const nextRules = normalizeRestrictedRules(currentRules.value.filter(item => item.id !== nextRule.id).concat(nextRule))
    const nextSettings = buildRestrictedSettings({
      ...state.settings,
      rules: nextRules,
    })
    await persistRestrictedSettings(nextSettings)
    await syncRuleToStripe(nextRule.id, { showToast: false })
    state.selectedRuleId = nextRule.id
    const savedRule = currentRules.value.find(item => item.id === nextRule.id) || nextRule
    state.ruleWorkingDoc = createRuleDoc(savedRule, nextRule.id)
    edgeFirebase?.toast?.success?.('Plan saved and synced to Stripe.')
  }
  catch (error) {
    state.ruleError = String(error?.message || 'Unable to save this plan right now.')
  }
  finally {
    state.ruleSubmitting = false
  }
}

async function syncRuleToStripe(ruleId, { showToast = true } = {}) {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId || normalizedRuleId === 'new')
    return null
  state.ruleStripeSyncing = true
  state.ruleStripeSyncError = ''
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (!uid || !orgId || !props.siteId)
      throw new Error('Missing context required to sync this plan.')

    const response = await edgeFirebase.runFunction('cms-restrictedContentSyncStripeRule', {
      uid,
      orgId,
      siteId: props.siteId,
      ruleId: normalizedRuleId,
    })
    const result = response?.data || response || {}
    const syncedRule = createRuleDoc(result?.rule || {}, normalizedRuleId)
    if (!syncedRule.id)
      throw new Error('Stripe sync succeeded but returned an invalid rule.')

    const nextRules = normalizeRestrictedRules(currentRules.value.map((item) => {
      if (item.id !== syncedRule.id)
        return item
      return syncedRule
    }))
    state.settings = buildRestrictedSettings({
      ...state.settings,
      rules: nextRules,
    })
    if (state.selectedRuleId === syncedRule.id)
      state.ruleWorkingDoc = createRuleDoc(syncedRule, syncedRule.id)

    const invalidCount = Array.isArray(result?.invalidPriceIds) ? result.invalidPriceIds.length : 0
    const invalidCouponCount = Array.isArray(result?.invalidCouponIds) ? result.invalidCouponIds.length : 0
    const invalidPromotionCodeCount = Array.isArray(result?.invalidPromotionCodeIds) ? result.invalidPromotionCodeIds.length : 0
    if (showToast) {
      if (invalidCount || invalidCouponCount || invalidPromotionCodeCount) {
        const parts = []
        if (invalidCount)
          parts.push(`${invalidCount} price ID${invalidCount === 1 ? '' : 's'}`)
        if (invalidCouponCount)
          parts.push(`${invalidCouponCount} coupon ID${invalidCouponCount === 1 ? '' : 's'}`)
        if (invalidPromotionCodeCount)
          parts.push(`${invalidPromotionCodeCount} promotion code${invalidPromotionCodeCount === 1 ? '' : 's'}`)
        edgeFirebase?.toast?.error?.(`Synced plan, but ${parts.join(' and ')} were invalid.`)
      }
      else
        edgeFirebase?.toast?.success?.(result?.createdProduct ? 'Stripe product created and synced.' : 'Stripe product synced.')
    }
    return result
  }
  catch (error) {
    console.error('syncRuleToStripe failed', error)
    state.ruleStripeSyncError = String(error?.message || 'Unable to sync this plan to Stripe right now.')
    if (showToast)
      edgeFirebase?.toast?.error?.(state.ruleStripeSyncError)
    throw error
  }
  finally {
    state.ruleStripeSyncing = false
  }
}

const deleteRule = async () => {
  const docId = String(state.ruleDeleteDocId || '').trim()
  if (!docId || state.ruleDeleteSubmitting)
    return
  state.ruleDeleteSubmitting = true
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (uid && orgId && props.siteId) {
      await edgeFirebase.runFunction('cms-restrictedContentDeleteStripeRule', {
        uid,
        orgId,
        siteId: props.siteId,
        ruleId: docId,
      })
    }

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
      .filter((item) => {
        return (Array.isArray(item?.accessRuleIds) && item.accessRuleIds.includes(docId))
          || (Array.isArray(item?.manualAccessRuleIds) && item.manualAccessRuleIds.includes(docId))
          || (Array.isArray(item?.paidAccessRuleIds) && item.paidAccessRuleIds.includes(docId))
          || (Array.isArray(item?.pendingPaymentRuleIds) && item.pendingPaymentRuleIds.includes(docId))
      })
      .map((member) => {
        const nextAccessRuleIds = member.accessRuleIds.filter(ruleId => ruleId !== docId)
        const nextManualAccessRuleIds = (Array.isArray(member.manualAccessRuleIds) ? member.manualAccessRuleIds : []).filter(ruleId => ruleId !== docId)
        const nextPaidAccessRuleIds = (Array.isArray(member.paidAccessRuleIds) ? member.paidAccessRuleIds : []).filter(ruleId => ruleId !== docId)
        const nextPendingPaymentRuleIds = (Array.isArray(member.pendingPaymentRuleIds) ? member.pendingPaymentRuleIds : []).filter(ruleId => ruleId !== docId)
        return edgeFirebase.changeDoc(membersCollectionPath.value, member.docId, {
          accessRuleIds: nextAccessRuleIds,
          manualAccessRuleIds: nextManualAccessRuleIds,
          paidAccessRuleIds: nextPaidAccessRuleIds,
          pendingPaymentRuleIds: nextPendingPaymentRuleIds,
        })
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
    state.ruleStripeSyncError = ''
    state.ruleDeleteDialogOpen = false
    state.ruleDeleteDocId = ''
    edgeFirebase?.toast?.success?.('Plan deleted and synced to Stripe.')
  }
  finally {
    state.ruleDeleteSubmitting = false
  }
}

const openNewMember = () => {
  state.seatMemberName = ''
  state.seatMemberEmail = ''
  state.selectedMemberId = 'new'
}

const openMember = (docId) => {
  if (!docId)
    return
  state.seatMemberName = ''
  state.seatMemberEmail = ''
  state.selectedMemberId = docId
}

const closeMemberEditor = () => {
  state.selectedMemberId = ''
}

const openDeleteMemberDialog = (docId) => {
  const normalizedDocId = String(docId || '').trim()
  if (!normalizedDocId)
    return
  const member = filteredMembers.value.find(item => String(item?.docId || '').trim() === normalizedDocId)
  state.memberDeleteDisplayName = getMemberDisplayName(member || { docId: normalizedDocId })
  state.memberDeleteDocId = normalizedDocId
  state.memberDeleteDialogOpen = true
}

const closeDeleteMemberDialog = () => {
  if (state.memberDeleteSubmitting)
    return
  state.memberDeleteDialogOpen = false
  state.memberDeleteDocId = ''
  state.memberDeleteDisplayName = ''
}

const deleteMember = async (docId) => {
  const normalizedDocId = String(docId || state.memberDeleteDocId || '').trim()
  if (!normalizedDocId || state.memberDeleteSubmitting)
    return
  state.memberDeleteSubmitting = true
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (!uid || !orgId || !props.siteId)
      throw new Error('Missing user or organization context.')

    const response = await edgeFirebase.runFunction('cms-restrictedContentDeleteAudienceMemberAccount', {
      uid,
      orgId,
      siteId: props.siteId,
      audienceUserId: normalizedDocId,
    })
    const result = response?.data || response || {}
    if (result?.success === false)
      throw new Error(String(result?.message || 'Unable to delete this member account.'))

    if (state.selectedMemberId === normalizedDocId)
      state.selectedMemberId = ''
    await loadInitialMembers()
    state.memberDeleteDialogOpen = false
    state.memberDeleteDocId = ''
    state.memberDeleteDisplayName = ''
    edgeFirebase?.toast?.success?.('Member removed from this site. Site Stripe subscriptions were cancelled and site access paths were removed.')
  }
  catch (error) {
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to delete this member account.'))
  }
  finally {
    state.memberDeleteSubmitting = false
  }
}

const addSeatManagedMember = async (ownerMember = {}) => {
  if (state.seatMemberSubmitting)
    return
  const ownerAudienceUserId = getAudienceUserDocId(ownerMember)
  if (!ownerAudienceUserId)
    return
  const seatRuleId = getSeatRuleIdForMember(ownerMember)
  if (!seatRuleId)
    return
  const name = String(state.seatMemberName || '').trim()
  const email = String(state.seatMemberEmail || '').trim().toLowerCase()
  if (!name || !email) {
    edgeFirebase?.toast?.error?.('Name and email are required.')
    return
  }

  state.seatMemberSubmitting = true
  try {
    const uid = String(edgeFirebase?.user?.uid || edgeFirebase?.user?.firebaseUser?.uid || '').trim()
    const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
    if (!uid || !orgId || !props.siteId)
      throw new Error('Missing user or organization context.')

    const response = await edgeFirebase.runFunction('cms-restrictedContentAddSeatMember', {
      uid,
      orgId,
      siteId: props.siteId,
      ownerAudienceUserId,
      name,
      email,
    })
    const result = response?.data || response || {}
    if (result?.success === false)
      throw new Error(String(result?.message || 'Unable to add seat member.'))

    state.seatMemberName = ''
    state.seatMemberEmail = ''
    await loadInitialMembers()
    edgeFirebase?.toast?.success?.('Member added under this paid seat owner.')
  }
  catch (error) {
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to add seat member.'))
  }
  finally {
    state.seatMemberSubmitting = false
  }
}

const copyCouponPromoCode = async (coupon = {}) => {
  const code = String(coupon?.promoCode || '').trim()
  if (!code) {
    edgeFirebase?.toast?.error?.('No promo code to copy.')
    return
  }
  try {
    if (globalThis?.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(code)
    }
    else {
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    edgeFirebase?.toast?.success?.(`Promo code copied: ${code}`)
  }
  catch (error) {
    edgeFirebase?.toast?.error?.(String(error?.message || 'Unable to copy promo code.'))
  }
}

watch(() => props.canManage, async (allowed) => {
  if (allowed) {
    await startSnapshots()
    await loadInitialMembers()
    return
  }
  state.stripeSettingsTouched = false
  state.stripeSettingsOpen = true
  state.selectedRuleId = ''
  state.selectedMemberId = ''
  await stopSnapshots()
}, { immediate: true })

watch(() => props.siteId, () => {
  state.stripeSettingsTouched = false
  state.stripeSettingsOpen = !isStripeIntegrationConfigured(currentStripeIntegration.value)
}, { immediate: true })

watch(() => props.siteDoc?.restrictedContent, (_nextValue, previousValue) => {
  if (previousValue === undefined || !settingsDirty.value)
    syncSettingsFromSiteDoc()
}, { immediate: true, deep: true })

watch(currentStripeIntegration, (_nextValue, previousValue) => {
  if (previousValue === undefined || !stripeDirty.value || isStripeIntegrationEmpty(state.stripeIntegration))
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

watch(stripeIntegrationCollectionPath, async (nextPath, previousPath) => {
  await restartSnapshotForPath(nextPath, previousPath)
})

watch(membersCollectionPath, async () => {
  state.selectedMemberId = ''
  if (props.canManage)
    await loadInitialMembers()
})

watch(() => state.memberFilter, () => {
  if (state.memberSearchDebounce)
    clearTimeout(state.memberSearchDebounce)
  state.memberSearchDebounce = setTimeout(() => {
    loadInitialMembers()
  }, 250)
})

onBeforeUnmount(async () => {
  if (state.memberSearchDebounce)
    clearTimeout(state.memberSearchDebounce)
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
    <edge-shad-dialog v-model="state.memberDeleteDialogOpen">
      <DialogContent class="pt-10">
        <DialogHeader>
          <DialogTitle class="text-left">
            Remove Member From This Site?
          </DialogTitle>
          <DialogDescription class="text-left">
            This removes this member from this site and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <div>
            Member:
            <span class="font-semibold">{{ state.memberDeleteDisplayName || state.memberDeleteDocId }}</span>
          </div>
          <div>If this member has a Stripe subscription for this site, it will be cancelled.</div>
          <div>This member will lose access to paid and restricted content on this site.</div>
          <div>Their account and memberships on other sites will stay active.</div>
          <div>This action cannot be undone.</div>
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" :disabled="state.memberDeleteSubmitting" @click="closeDeleteMemberDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-red-700 text-white hover:bg-red-600" :disabled="state.memberDeleteSubmitting" @click="deleteMember()">
            Delete Account
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.memberStripeActionDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            {{ memberStripeActionDialogTitle }}
          </DialogTitle>
          <DialogDescription class="text-left">
            {{ memberStripeActionDialogDescription }}
          </DialogDescription>
        </DialogHeader>
        <div class="text-sm text-muted-foreground">
          Member:
          <span class="font-semibold text-foreground">{{ state.memberStripeActionMemberName || state.memberStripeActionAudienceUserId }}</span>
        </div>
        <div v-if="state.memberStripeActionType === 'update_duration'" class="space-y-2">
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input
              v-model="state.memberStripeActionNoEnd"
              type="checkbox"
            >
            No end date
          </label>
          <edge-shad-datepicker
            v-if="!state.memberStripeActionNoEnd"
            v-model="state.memberStripeActionDate"
            name="restricted-member-stripe-action-date"
            label="End Date"
          />
          <div class="text-xs text-muted-foreground">
            <span v-if="state.memberStripeActionNoEnd">This keeps the subscription ongoing with no scheduled end.</span>
            <span v-else>Stripe cancels this subscription at the end of the selected date.</span>
          </div>
        </div>
        <div v-if="state.memberStripeActionError" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
          {{ state.memberStripeActionError }}
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" :disabled="state.memberStripeActionSubmitting" @click="closeMemberStripeActionDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-slate-800 text-white hover:bg-slate-700" :disabled="!canSubmitMemberStripeAction" @click="submitMemberStripeAction">
            Confirm
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>

    <edge-shad-dialog v-model="state.stripePlanDetailsDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {{ stripePlanDetailsRuleLabel || state.stripePlanDetailsRuleId || 'Plan Details' }}
          </DialogTitle>
          <DialogDescription>
            Stripe details for this paid plan.
          </DialogDescription>
        </DialogHeader>
        <div v-if="stripePlanDetailsMember" class="space-y-2 text-xs text-muted-foreground">
          <div class="text-sm font-medium text-foreground">
            {{ getMemberDisplayName(stripePlanDetailsMember) }}
          </div>
          <div v-if="stripePlanDetailsMember.billingStripeCustomerId" class="break-all">
            Customer ID: <span class="font-medium text-foreground">{{ stripePlanDetailsMember.billingStripeCustomerId }}</span>
          </div>
          <div>
            Payment Status:
            <span class="font-medium text-foreground">
              {{ formatRegistrationPaymentStatus(getPlanStateForMemberRule(stripePlanDetailsMember, state.stripePlanDetailsRuleId)?.paymentStatus) || 'Unknown' }}
            </span>
          </div>
          <div v-if="getStripeCurrentDurationLabel(stripePlanDetailsMember, state.stripePlanDetailsRuleId)">
            Current Period Ends:
            <span class="font-medium text-foreground">{{ getStripeCurrentDurationLabel(stripePlanDetailsMember, state.stripePlanDetailsRuleId) }}</span>
          </div>
          <div v-if="getStripeScheduledDurationLabel(stripePlanDetailsMember, state.stripePlanDetailsRuleId)">
            Scheduled End Date:
            <span class="font-medium text-foreground">{{ getStripeScheduledDurationLabel(stripePlanDetailsMember, state.stripePlanDetailsRuleId) }}</span>
          </div>
          <div v-if="formatStripeBillingCycle(stripePlanDetailsMember, state.stripePlanDetailsRuleId)">
            Per Cycle:
            <span class="font-medium text-foreground">{{ formatStripeBillingCycle(stripePlanDetailsMember, state.stripePlanDetailsRuleId) }}</span>
          </div>
          <div v-if="formatStripeCouponSummary(stripePlanDetailsMember, state.stripePlanDetailsRuleId)">
            Coupon:
            <span class="font-medium text-foreground">{{ formatStripeCouponSummary(stripePlanDetailsMember, state.stripePlanDetailsRuleId) }}</span>
          </div>
        </div>
        <DialogFooter class="gap-2">
          <edge-shad-button
            v-if="stripePlanDetailsMember"
            type="button"
            variant="outline"
            @click="openMemberStripeActionDialog({ action: 'cancel', member: stripePlanDetailsMember, ruleId: state.stripePlanDetailsRuleId })"
          >
            Cancel Subscription
          </edge-shad-button>
          <edge-shad-button
            v-if="stripePlanDetailsMember"
            type="button"
            variant="outline"
            @click="openMemberStripeActionDialog({ action: isStripeBillingPaused(stripePlanDetailsMember, state.stripePlanDetailsRuleId) ? 'resume' : 'pause', member: stripePlanDetailsMember, ruleId: state.stripePlanDetailsRuleId })"
          >
            {{ isStripeBillingPaused(stripePlanDetailsMember, state.stripePlanDetailsRuleId) ? 'Resume Payment' : 'Pause Payment' }}
          </edge-shad-button>
          <edge-shad-button
            v-if="stripePlanDetailsMember"
            type="button"
            variant="outline"
            @click="openMemberStripeActionDialog({ action: 'update_duration', member: stripePlanDetailsMember, ruleId: state.stripePlanDetailsRuleId })"
          >
            Update Duration
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.rulePriceDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            {{ state.rulePriceDialogIndex >= 0 ? 'Edit Stripe Price Option' : 'Add Stripe Price Option' }}
          </DialogTitle>
          <DialogDescription class="text-left">
            Configure plan pricing here. Stripe price id is generated during plan save sync.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div v-if="state.rulePriceDialogIndex >= 0 && String(state.rulePriceDialogDraft.priceId || '').trim()" class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Stripe Price ID: <span class="font-medium text-foreground">{{ state.rulePriceDialogDraft.priceId }}</span>
          </div>
          <edge-shad-input
            v-model="state.rulePriceDialogDraft.title"
            name="restricted-rule-price-dialog-title"
            label="Title"
            placeholder="Pro Plan"
          />
          <edge-shad-input
            v-model="state.rulePriceDialogAmountInput"
            name="restricted-rule-price-dialog-amount"
            label="Amount (USD)"
            placeholder="10.00"
            description="Enter what the member pays (for example 10 or 10.99)."
            :mask-options="STRIPE_USD_MONEY_MASK"
          />
          <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_140px]">
            <edge-shad-select
              v-model="state.rulePriceDialogDraft.interval"
              name="restricted-rule-price-dialog-interval"
              label="Billing Interval"
              :items="STRIPE_INTERVAL_OPTIONS"
              item-title="label"
              item-value="value"
            />
            <edge-shad-input
              v-model.number="state.rulePriceDialogDraft.intervalCount"
              name="restricted-rule-price-dialog-interval-count"
              type="number"
              label="Interval Count"
              placeholder="1"
            />
            <edge-shad-input
              v-model.number="state.rulePriceDialogDraft.seats"
              name="restricted-rule-price-dialog-seats"
              type="number"
              label="Seats"
              placeholder="1"
            />
          </div>
          <div class="text-xs text-muted-foreground">
            Interval Count is how often Stripe bills for this price. Example: Monthly + 1 bills every month, Monthly + 3 bills every 3 months. Seats is how many units are charged at checkout.
          </div>
          <edge-shad-textarea
            v-model="state.rulePriceDialogDraft.description"
            name="restricted-rule-price-dialog-description"
            label="Description"
            placeholder="Describe what this option includes."
          />
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeRulePriceOptionDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-slate-800 text-white hover:bg-slate-700" :disabled="!String(state.rulePriceDialogDraft.title || '').trim() || parseRulePriceAmountInput(state.rulePriceDialogAmountInput) <= 0" @click="saveRulePriceOptionDialog">
            Save Option
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.rulePriceDeleteDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Delete Stripe Price Option?
          </DialogTitle>
          <DialogDescription class="text-left">
            This removes the option from this paid access plan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeDeleteRulePriceOptionDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-red-700 text-white hover:bg-red-600" @click="confirmDeleteRulePriceOption">
            Delete Option
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.ruleCouponDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            {{ state.ruleCouponDialogIndex >= 0 ? 'Edit Stripe Coupon' : 'Add Stripe Coupon' }}
          </DialogTitle>
          <DialogDescription class="text-left">
            Configure discount type and expiration. Stripe coupon id is generated on save.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div v-if="state.ruleCouponDialogIndex >= 0 && String(state.ruleCouponDialogDraft.couponId || '').trim()" class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Stripe Coupon ID: <span class="font-medium text-foreground">{{ state.ruleCouponDialogDraft.couponId }}</span>
          </div>
          <div v-if="state.ruleCouponDialogIndex >= 0 && String(state.ruleCouponDialogDraft.promotionCodeId || '').trim()" class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Stripe Promotion Code ID: <span class="font-medium text-foreground">{{ state.ruleCouponDialogDraft.promotionCodeId }}</span>
          </div>
          <edge-shad-input
            v-model="state.ruleCouponDialogDraft.title"
            name="restricted-rule-coupon-dialog-title"
            label="Title"
            placeholder="Spring Promo"
          />
          <div v-if="getRuleCouponDialogValidation().errors.title" class="text-xs text-red-600">
            {{ getRuleCouponDialogValidation().errors.title }}
          </div>
          <edge-shad-input
            v-model="state.ruleCouponDialogDraft.promoCode"
            name="restricted-rule-coupon-dialog-promo-code"
            label="Promo Code"
            placeholder="SPRING25"
          />
          <div v-if="getRuleCouponDialogValidation().errors.promoCode" class="text-xs text-red-600">
            {{ getRuleCouponDialogValidation().errors.promoCode }}
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <edge-shad-select
              v-model="state.ruleCouponDialogDraft.discountType"
              name="restricted-rule-coupon-dialog-discount-type"
              label="Discount Type"
              :items="STRIPE_COUPON_DISCOUNT_TYPE_OPTIONS"
              item-title="label"
              item-value="value"
            />
            <edge-shad-select
              v-model="state.ruleCouponDialogDraft.expiresMode"
              name="restricted-rule-coupon-dialog-expires-mode"
              label="Expiration"
              :items="STRIPE_COUPON_EXPIRY_OPTIONS"
              item-title="label"
              item-value="value"
            />
          </div>
          <div v-if="state.ruleCouponDialogDraft.discountType === 'percent'">
            <edge-shad-input
              v-model.number="state.ruleCouponDialogDraft.percentOff"
              name="restricted-rule-coupon-dialog-percent-off"
              type="number"
              label="Percent Off"
              placeholder="10"
            />
            <div v-if="getRuleCouponDialogValidation().errors.percentOff" class="text-xs text-red-600">
              {{ getRuleCouponDialogValidation().errors.percentOff }}
            </div>
          </div>
          <div v-else>
            <edge-shad-input
              v-model="state.ruleCouponDialogAmountInput"
              name="restricted-rule-coupon-dialog-amount-off"
              label="Amount Off (USD)"
              placeholder="10.00"
              :mask-options="STRIPE_USD_MONEY_MASK"
            />
            <div v-if="getRuleCouponDialogValidation().errors.amountOff" class="text-xs text-red-600">
              {{ getRuleCouponDialogValidation().errors.amountOff }}
            </div>
          </div>
          <div v-if="state.ruleCouponDialogDraft.expiresMode === 'date'">
            <edge-shad-input
              v-model="state.ruleCouponDialogDraft.expiresAt"
              name="restricted-rule-coupon-dialog-expires-at"
              type="date"
              label="Expires On"
            />
            <div v-if="getRuleCouponDialogValidation().errors.expiresAt" class="text-xs text-red-600">
              {{ getRuleCouponDialogValidation().errors.expiresAt }}
            </div>
          </div>
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeRuleCouponDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-slate-800 text-white hover:bg-slate-700" :disabled="getRuleCouponDialogValidation().hasError" @click="saveRuleCouponDialog">
            Save Coupon
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.ruleCouponDeleteDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Delete Stripe Coupon?
          </DialogTitle>
          <DialogDescription class="text-left">
            This removes the coupon from this paid access plan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeDeleteRuleCouponDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button class="bg-red-700 text-white hover:bg-red-600" @click="confirmDeleteRuleCouponDialog">
            Delete Coupon
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.stripeCatalogDialogOpen">
      <DialogContent class="max-w-4xl pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Import Stripe Products & Prices
          </DialogTitle>
          <DialogDescription class="text-left">
            Choose which Stripe products and prices should be added to Paid Access Plans.
          </DialogDescription>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-y-auto">
          <div v-if="state.stripeCatalogLoading" class="py-8 text-sm text-muted-foreground">
            Loading Stripe catalog...
          </div>
          <div v-else-if="!state.stripeCatalogProducts.length" class="py-8 text-sm text-muted-foreground">
            No Stripe products with active prices were found.
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="product in state.stripeCatalogProducts"
              :key="product.productId"
              class="rounded-lg border border-border/60 bg-background p-3"
            >
              <label class="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  :checked="Boolean(getStripeCatalogSelectionState(product.productId).selected)"
                  class="mt-1"
                  @change="toggleStripeCatalogProduct(product.productId, $event.target?.checked)"
                >
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-foreground">
                    {{ product.name || product.productId }}
                  </div>
                  <div class="truncate text-xs text-muted-foreground">
                    {{ product.productId }}
                  </div>
                </div>
              </label>
              <div class="mt-2 space-y-2 pl-6">
                <label
                  v-for="price in (Array.isArray(product.prices) ? product.prices : [])"
                  :key="price.id"
                  class="flex cursor-pointer items-start gap-2 rounded border border-border/50 p-2"
                >
                  <input
                    type="checkbox"
                    :checked="Boolean(getStripeCatalogSelectionState(product.productId).prices[String(price.id || '').trim()])"
                    class="mt-1"
                    @change="toggleStripeCatalogPrice(product.productId, price.id, $event.target?.checked)"
                  >
                  <div class="min-w-0">
                    <div class="truncate text-xs font-semibold text-foreground">
                      {{ price.nickname || price.id }}
                    </div>
                    <div class="truncate text-[11px] text-muted-foreground">
                      {{ price.id }} · {{ (Number(price.unitAmount || 0) / 100).toFixed(2) }} {{ String(price.currency || 'usd').toUpperCase() }}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" :disabled="state.stripeCatalogImporting" @click="state.stripeCatalogDialogOpen = false">
            Skip
          </edge-shad-button>
          <edge-shad-button class="bg-slate-800 text-white hover:bg-slate-700" :disabled="state.stripeCatalogImporting" @click="importSelectedStripeCatalog">
            Import Selected
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
                      :disabled="state.stripeSaving || state.stripeCatalogLoading"
                      @click="openStripeCatalogImportDialog"
                    >
                      Import from Stripe
                    </edge-shad-button>
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
                    <edge-shad-button
                      variant="ghost"
                      class="h-8 gap-1 px-2 text-xs"
                      @click="toggleStripeSettingsOpen"
                    >
                      <ChevronDown class="h-4 w-4 transition-transform" :class="state.stripeSettingsOpen ? '' : '-rotate-90'" />
                      {{ state.stripeSettingsOpen ? 'Collapse' : 'Expand' }}
                    </edge-shad-button>
                  </div>
                </div>
                <div v-if="state.stripeSettingsOpen" class="grid gap-3 lg:grid-cols-3">
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
                <div v-if="state.stripeSettingsOpen" class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div class="font-semibold text-foreground">
                    Webhook setup help
                  </div>
                  <div class="mt-1">
                    Do not send all events. Enable only:
                  </div>
                  <div class="mt-1">
                    <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, <code>checkout.session.async_payment_failed</code>, <code>customer.subscription.updated</code>, and <code>customer.subscription.deleted</code>.
                  </div>
                </div>
                <div v-else class="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {{ isStripeIntegrationConfigured(state.stripeIntegration) ? 'Stripe is configured.' : 'Stripe setup is incomplete. Expand to finish setup.' }}
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
                      <div v-if="item.registrationStripeProductId" class="mt-1 truncate text-[11px] text-muted-foreground">
                        {{ item.registrationStripeProductId }}
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
                    <div class="min-w-0">
                      <div class="flex min-w-0 items-center text-sm font-semibold text-foreground">
                        <ShieldCheck class="mr-2 h-4 w-4" />
                        <span class="truncate">{{ state.selectedRuleId === 'new' ? 'New Plan' : (state.ruleWorkingDoc.name || 'Edit Plan') }}</span>
                      </div>
                      <div v-if="state.ruleWorkingDoc.registrationStripeProductId" class="mt-1 truncate text-[11px] text-muted-foreground">
                        Stripe Product ID: {{ state.ruleWorkingDoc.registrationStripeProductId }}
                      </div>
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
                      :key="`rule-form-${state.selectedRuleId || 'none'}`"
                      :initial-values="{
                        'restricted-rule-name': state.ruleWorkingDoc.name,
                      }"
                    >
                      <div class="space-y-4 px-6 pb-6 pt-6">
                        <edge-shad-input
                          v-model="state.ruleWorkingDoc.name"
                          name="restricted-rule-name"
                          label="Name"
                          description="This is the same rule name used everywhere else in the system."
                        />
                        <div v-if="state.ruleError" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
                          {{ state.ruleError }}
                        </div>
                        <div v-if="state.ruleStripeSyncError" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                          {{ state.ruleStripeSyncError }}
                        </div>
                        <div class="grid gap-4 lg:grid-cols-3">
                          <div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                            <div class="flex items-center justify-between gap-3">
                              <div>
                                <div class="text-sm font-semibold text-foreground">
                                  Stripe Price Options
                                </div>
                                <p class="text-xs text-muted-foreground">
                                  Add one or more app-defined price options. Stripe price ids are generated on save.
                                </p>
                              </div>
                              <edge-shad-button type="button" class="h-8 gap-2 bg-slate-800 text-white hover:bg-slate-700" @click="openNewRulePriceOptionDialog">
                                <Plus class="h-4 w-4" />
                                Add Price
                              </edge-shad-button>
                            </div>

                            <div v-if="Array.isArray(state.ruleWorkingDoc.registrationStripePrices) && state.ruleWorkingDoc.registrationStripePrices.length" class="space-y-3">
                              <draggable
                                v-model="state.ruleWorkingDoc.registrationStripePrices"
                                item-key="_cid"
                                handle=".handle"
                                class="space-y-2"
                              >
                                <template #item="{ element, index }">
                                  <div class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background p-3">
                                    <div class="flex min-w-0 items-center gap-2">
                                      <button type="button" class="handle inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                                        <GripVertical class="h-4 w-4" />
                                      </button>
                                      <div class="min-w-0">
                                        <button type="button" class="min-w-0 truncate text-left text-sm font-medium text-foreground hover:underline" @click="openEditRulePriceOptionDialog(index)">
                                          {{ String(element?.title || '').trim() || `Option ${index + 1}` }}
                                        </button>
                                        <div class="truncate text-[11px] text-muted-foreground">
                                          {{ formatRulePriceSummary(element) }}
                                          <span v-if="String(element?.priceId || '').trim()"> · {{ element.priceId }}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div class="flex items-center gap-1">
                                      <edge-shad-button type="button" size="icon" variant="ghost" class="h-7 w-7" @click="openEditRulePriceOptionDialog(index)">
                                        <Settings2 class="h-4 w-4" />
                                      </edge-shad-button>
                                      <edge-shad-button type="button" size="icon" variant="ghost" class="h-7 w-7 text-red-600 hover:text-red-500" @click="openDeleteRulePriceOptionDialog(index)">
                                        <Trash2 class="h-4 w-4" />
                                      </edge-shad-button>
                                    </div>
                                  </div>
                                </template>
                              </draggable>
                            </div>

                            <div v-else class="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                              No Stripe prices added yet.
                            </div>
                          </div>

                          <div class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
                            <label class="text-sm font-semibold text-foreground flex items-center justify-between">
                              Stripe Product Image
                              <edge-shad-button
                                v-if="props.siteId"
                                type="button"
                                variant="link"
                                class="h-auto px-0 text-sm"
                                @click="state.ruleImagePickerOpen = !state.ruleImagePickerOpen"
                              >
                                {{ state.ruleImagePickerOpen ? 'Hide picker' : 'Select image' }}
                              </edge-shad-button>
                            </label>
                            <div class="flex items-center gap-3">
                              <img
                                v-if="state.ruleWorkingDoc.registrationStripeImage"
                                :src="state.ruleWorkingDoc.registrationStripeImage"
                                alt="Stripe product image"
                                class="h-14 w-14 rounded-md border border-border object-cover"
                              >
                              <div class="min-w-0 flex-1 text-xs text-muted-foreground">
                                {{ state.ruleWorkingDoc.registrationStripeImage || 'No image selected. If blank, Stripe product image is cleared.' }}
                              </div>
                              <edge-shad-button
                                v-if="state.ruleWorkingDoc.registrationStripeImage"
                                type="button"
                                variant="ghost"
                                class="h-8"
                                @click="state.ruleWorkingDoc.registrationStripeImage = ''"
                              >
                                Remove
                              </edge-shad-button>
                            </div>
                            <edge-shad-input
                              v-model="state.ruleWorkingDoc.registrationStripeImage"
                              name="restricted-rule-image"
                              label="Image URL"
                              placeholder="https://..."
                            />
                            <div v-if="state.ruleImagePickerOpen && props.siteId" class="rounded-lg border border-dashed border-border/70 p-2">
                              <edge-cms-media-manager
                                :site="props.siteId"
                                :select-mode="true"
                                @select="(url) => {
                                  state.ruleWorkingDoc.registrationStripeImage = String(url || '').trim()
                                  state.ruleImagePickerOpen = false
                                }"
                              />
                            </div>
                          </div>

                          <div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                            <div class="flex items-center justify-between gap-3">
                              <div>
                                <div class="text-sm font-semibold text-foreground">
                                  Stripe Coupons
                                </div>
                                <p class="text-xs text-muted-foreground">
                                  Add optional coupon codes or IDs linked to this plan.
                                </p>
                              </div>
                              <edge-shad-button type="button" class="h-8 gap-2 bg-slate-800 text-white hover:bg-slate-700" @click="openNewRuleCouponDialog">
                                <Plus class="h-4 w-4" />
                                Add Coupon
                              </edge-shad-button>
                            </div>

                            <div v-if="Array.isArray(state.ruleWorkingDoc.registrationStripeCoupons) && state.ruleWorkingDoc.registrationStripeCoupons.length" class="space-y-2">
                              <div
                                v-for="(coupon, index) in state.ruleWorkingDoc.registrationStripeCoupons"
                                :key="coupon._cid || `${coupon.couponId}-${index}`"
                                class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background p-3"
                              >
                                <div class="min-w-0">
                                  <button type="button" class="min-w-0 truncate text-left text-sm font-medium text-foreground hover:underline" @click="openEditRuleCouponDialog(index)">
                                    {{ String(coupon?.title || '').trim() || `Coupon ${index + 1}` }}
                                  </button>
                                  <div class="truncate text-[11px] text-muted-foreground">
                                    {{ coupon.discountType === 'amount' ? `${Number(coupon.amountOff || 0).toFixed(2)} USD off` : `${Number(coupon.percentOff || 0)}% off` }}
                                    <span> · {{ coupon.expiresMode === 'date' ? `Expires ${coupon.expiresAt || '-'}` : 'No expiration' }}</span>
                                    <span v-if="String(coupon?.couponId || '').trim()"> · Coupon: {{ coupon.couponId }}</span>
                                  </div>
                                  <div v-if="String(coupon?.promoCode || '').trim()" class="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{{ coupon.promoCode }}</span>
                                    <edge-shad-button
                                      type="button"
                                      variant="ghost"
                                      class="h-6 px-2 text-[10px]"
                                      @click.stop="copyCouponPromoCode(coupon)"
                                    >
                                      Copy
                                    </edge-shad-button>
                                  </div>
                                </div>
                                <div class="flex items-center gap-1">
                                  <edge-shad-button type="button" size="icon" variant="ghost" class="h-7 w-7" @click="openEditRuleCouponDialog(index)">
                                    <Settings2 class="h-4 w-4" />
                                  </edge-shad-button>
                                  <edge-shad-button type="button" size="icon" variant="ghost" class="h-7 w-7 text-red-600 hover:text-red-500" @click="openDeleteRuleCouponDialog(index)">
                                    <Trash2 class="h-4 w-4" />
                                  </edge-shad-button>
                                </div>
                              </div>
                            </div>

                            <div v-else class="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                              No coupons added yet.
                            </div>
                          </div>
                        </div>
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
                <div class="flex items-center gap-2">
                  <edge-shad-form :initial-values="{ 'restricted-member-filter': state.memberFilter }" class="min-w-0 flex-1">
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
                  <edge-shad-button
                    type="button"
                    size="icon"
                    variant="outline"
                    class="h-9 w-9 shrink-0"
                    :disabled="state.membersLoading || state.membersLoadingMore"
                    @click="loadInitialMembers"
                  >
                    <RefreshCw class="h-4 w-4" :class="state.membersLoading ? 'animate-spin' : ''" />
                  </edge-shad-button>
                </div>
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
                        {{ Array.isArray(item.manualAccessRuleIds) ? item.manualAccessRuleIds.length : 0 }} manual override plan{{ (Array.isArray(item.manualAccessRuleIds) ? item.manualAccessRuleIds.length : 0) === 1 ? '' : 's' }}
                      </div>
                      <div v-if="Array.isArray(item.manualAccessRuleIds) && item.manualAccessRuleIds.length" class="mt-2 flex flex-wrap gap-1">
                        <span
                          v-for="ruleId in item.manualAccessRuleIds.slice(0, 3)"
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
                        @click.stop="openDeleteMemberDialog(item.docId)"
                      >
                        <Trash2 class="h-4 w-4" />
                      </edge-shad-button>
                    </div>
                  </div>
                  <div v-if="hasStripeMemberInfo(item)" class="mt-2 w-full rounded-md border border-border/60 bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
                    <div class="truncate">
                      Paid Plans:
                      <span class="font-medium text-foreground">
                        {{
                          getMemberPaidPlanEntries(item).length
                            ? getMemberPaidPlanEntries(item).map(plan => plan.ruleLabel).join(', ')
                            : 'None'
                        }}
                      </span>
                    </div>
                    <div v-if="item.billingStripeCustomerId" class="truncate">
                      Customer: <span class="font-medium text-foreground">{{ item.billingStripeCustomerId }}</span>
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
                        'restricted-member-rule-ids': slotProps.workingDoc.manualAccessRuleIds,
                        'restricted-member-notes': slotProps.workingDoc.notes,
                      }"
                    >
                      <div class="space-y-4 pt-6 pb-6">
                        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
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
                          <edge-shad-select
                            v-model="slotProps.workingDoc.status"
                            name="restricted-member-status"
                            label="Status"
                            :items="MEMBER_STATUSES"
                          />
                        </div>
                        <div
                          v-if="slotProps.workingDoc.audienceUserId"
                          class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground"
                        >
                          {{ getAudienceUserLabel(slotProps.workingDoc.audienceUserId) }}
                        </div>
                        <div
                          v-if="hasStripeMemberInfo(slotProps.workingDoc)"
                          class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm"
                        >
                          <div class="text-xs font-semibold uppercase tracking-wide text-foreground">
                            Stripe
                          </div>
                          <div v-if="slotProps.workingDoc.billingStripeCustomerId" class="text-xs text-muted-foreground break-all">
                            Customer ID: <span class="font-medium text-foreground">{{ slotProps.workingDoc.billingStripeCustomerId }}</span>
                          </div>
                          <div class="space-y-2">
                            <div class="text-[11px] font-medium text-foreground">
                              Paid Plans
                            </div>
                            <div
                              v-if="getMemberPaidPlanEntries(slotProps.workingDoc).length"
                              class="space-y-2"
                            >
                              <div
                                v-for="plan in getMemberPaidPlanEntries(slotProps.workingDoc)"
                                :key="`paid-plan-${plan.ruleId}`"
                                class="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/70 p-2"
                              >
                                <div class="min-w-0 text-xs">
                                  <div class="truncate font-medium text-foreground">
                                    {{ plan.ruleLabel }}
                                  </div>
                                  <div class="truncate text-muted-foreground">
                                    {{ formatRegistrationPaymentStatus(plan.paymentStatus) || 'Paid' }}
                                  </div>
                                </div>
                                <edge-shad-button
                                  type="button"
                                  variant="outline"
                                  class="h-7 px-2 text-[11px]"
                                  @click="openStripePlanDetailsDialog(slotProps.workingDoc, plan.ruleId)"
                                >
                                  View
                                </edge-shad-button>
                              </div>
                            </div>
                            <div v-else class="text-xs text-muted-foreground">
                              No paid plans.
                            </div>
                          </div>
                          <div
                            v-if="getSeatOwnerAudienceUserIdForMember(slotProps.workingDoc)"
                            class="rounded-md border border-border/60 bg-background/70 p-2 text-xs text-muted-foreground"
                          >
                            Seat Owner:
                            <span class="font-medium text-foreground">{{ getSeatOwnerLabel(slotProps.workingDoc) }}</span>
                            <edge-shad-button
                              type="button"
                              variant="outline"
                              class="ml-2 h-6 px-2 text-[10px]"
                              @click="openMember(getSeatOwnerAudienceUserIdForMember(slotProps.workingDoc))"
                            >
                              Open
                            </edge-shad-button>
                          </div>
                          <div
                            v-if="canManageSeatMembers(slotProps.workingDoc)"
                            class="space-y-2 rounded-md border border-border/60 bg-background/70 p-2"
                          >
                            <div class="text-[11px] font-semibold text-foreground">
                              Managed Seat Members
                            </div>
                            <div class="text-[11px] text-muted-foreground">
                              {{ getSeatUsageLabel(slotProps.workingDoc) }}
                            </div>
                            <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                              <edge-shad-input
                                v-model="state.seatMemberName"
                                name="restricted-seat-member-name"
                                label="Name"
                                placeholder="Jane Doe"
                              />
                              <edge-shad-input
                                v-model="state.seatMemberEmail"
                                name="restricted-seat-member-email"
                                label="Email"
                                placeholder="jane@example.com"
                              />
                              <div class="flex items-end">
                                <edge-shad-button
                                  type="button"
                                  class="h-8 bg-slate-800 px-3 text-white hover:bg-slate-700"
                                  :disabled="state.seatMemberSubmitting"
                                  @click="addSeatManagedMember(slotProps.workingDoc)"
                                >
                                  {{ state.seatMemberSubmitting ? 'Adding...' : 'Add Member' }}
                                </edge-shad-button>
                              </div>
                            </div>
                            <div
                              v-if="getManagedSeatMembers(slotProps.workingDoc).length"
                              class="space-y-2"
                            >
                              <div
                                v-for="seatMember in getManagedSeatMembers(slotProps.workingDoc)"
                                :key="`seat-child-${seatMember.docId}`"
                                class="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-[11px]"
                              >
                                <div class="min-w-0">
                                  <div class="truncate font-medium text-foreground">
                                    {{ seatMember.name || seatMember.email || seatMember.docId }}
                                  </div>
                                  <div class="truncate text-muted-foreground">
                                    {{ seatMember.email || seatMember.docId }}
                                  </div>
                                </div>
                                <edge-shad-button
                                  type="button"
                                  variant="outline"
                                  class="h-6 px-2 text-[10px]"
                                  @click="openMember(seatMember.docId)"
                                >
                                  Open
                                </edge-shad-button>
                              </div>
                            </div>
                            <div v-else class="text-[11px] text-muted-foreground">
                              No members assigned yet.
                            </div>
                          </div>
                        </div>
                        <edge-shad-select-tags
                          v-model="slotProps.workingDoc.manualAccessRuleIds"
                          name="restricted-member-rule-ids"
                          label="Manual Plan Access Override"
                          placeholder="Select plans"
                          :items="ruleTagItems"
                          item-title="label"
                          item-value="value"
                          :allow-additions="false"
                        />
                        <div class="text-xs text-muted-foreground">
                          Use this to manually grant plan access regardless of payment state.
                        </div>
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
