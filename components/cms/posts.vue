<script setup lang="js">
import { computed, inject, onBeforeMount, reactive, ref, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { ArrowDown, ArrowLeft, ArrowUp, Clock3, Eye, File, FileCheck, FilePen, FileWarning, FileX, GripVertical, History, Image, ImagePlus, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-vue-next'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  mode: {
    type: String,
    default: 'sidebar',
  },
  selectedPostId: {
    type: String,
    default: '',
  },
  listVariant: {
    type: String,
    default: 'sidebar',
  },
})

const emit = defineEmits(['updating', 'update:selectedPostId'])

const edgeFirebase = inject('edgeFirebase')
const cmsMultiOrg = useState('cmsMultiOrg', () => true)
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const isDevModeEnabled = computed(() => process.dev || Boolean(edgeGlobal.edgeState.devOverride))
const showDevOnlyActions = computed(() => edgeGlobal.allowMenuItem({ devOnly: true }, isAdmin.value))
const canOpenPreviewBlockContentEditor = computed(() => {
  if (!isAdmin.value)
    return false
  if (cmsMultiOrg.value)
    return true
  return isDevModeEnabled.value
})

const collection = computed(() => `sites/${props.site}/posts`)
const collectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${collection.value}`)

const publishedCollection = computed(() => `sites/${props.site}/published_posts`)
const publishedCollectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${publishedCollection.value}`)

const normalizeForCompare = (value) => {
  if (Array.isArray(value))
    return value.map(normalizeForCompare)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForCompare(value[key])
      return acc
    }, {})
  }
  return value
}

const stableSerialize = value => JSON.stringify(normalizeForCompare(value))
const areEqualNormalized = (a, b) => stableSerialize(a) === stableSerialize(b)

const normalizePostType = (value) => {
  const type = String(value || '').trim().toLowerCase()
  return type === 'event' ? 'event' : 'post'
}

const normalizeTemplatePageTypes = (value) => {
  const rawTypes = Array.isArray(value) ? value : [value]
  const normalized = rawTypes
    .map((typeValue) => {
      if (typeValue && typeof typeValue === 'object') {
        const objectValue = typeValue.name ?? typeValue.value ?? typeValue.title ?? typeValue.label ?? ''
        return String(objectValue || '')
      }
      return String(typeValue || '')
    })
    .map(typeValue => typeValue.trim().toLowerCase())
    .flatMap((typeValue) => {
      if (typeValue === 'page')
        return ['Page']
      if (typeValue === 'post')
        return ['Post']
      if (typeValue === 'both')
        return ['Page', 'Post']
      return []
    })

  const uniqueNormalized = [...new Set(normalized)]
  return uniqueNormalized.length ? uniqueNormalized : ['Page']
}

const POST_TYPE_OPTIONS = [
  { label: 'Post', value: 'post' },
  { label: 'Event', value: 'event' },
]
const POST_LIST_TYPE_FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Post', value: 'post' },
  { label: 'Event', value: 'event' },
]

const EVENT_STATUS_OPTIONS = [
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Completed', value: 'completed' },
]

const EVENT_STATUS_VALUES = new Set(EVENT_STATUS_OPTIONS.map(option => option.value))

const DEFAULT_TIMEZONE = (() => {
  if (typeof Intl !== 'undefined') {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (resolved)
      return resolved
  }
  return 'UTC'
})()

const CURRENT_USER_TIMEZONE = (() => {
  if (typeof Intl !== 'undefined') {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (resolved)
      return resolved
  }
  return DEFAULT_TIMEZONE
})()

const TIMEZONE_OPTIONS = (() => {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone').map(id => ({ label: id, value: id }))
  }
  return [{ label: 'UTC', value: 'UTC' }]
})()

const normalizeEventData = (event = {}) => {
  const normalized = { ...event }
  normalized.startAt = typeof normalized.startAt === 'string' ? normalized.startAt : ''
  normalized.endAt = typeof normalized.endAt === 'string' ? normalized.endAt : ''
  normalized.startAtUtc = typeof normalized.startAtUtc === 'string' ? normalized.startAtUtc : ''
  normalized.endAtUtc = typeof normalized.endAtUtc === 'string' ? normalized.endAtUtc : ''
  normalized.isPast = typeof normalized.isPast === 'boolean' ? normalized.isPast : false
  normalized.unpublishPastEvent = typeof normalized.unpublishPastEvent === 'boolean' ? normalized.unpublishPastEvent : true
  normalized.timezone = typeof normalized.timezone === 'string' ? normalized.timezone : ''
  normalized.timezone = normalized.timezone || DEFAULT_TIMEZONE
  normalized.locationName = typeof normalized.locationName === 'string' ? normalized.locationName : ''
  normalized.locationAddress = typeof normalized.locationAddress === 'string' ? normalized.locationAddress : ''
  normalized.isVirtual = typeof normalized.isVirtual === 'boolean' ? normalized.isVirtual : false
  normalized.meetingUrl = typeof normalized.meetingUrl === 'string' ? normalized.meetingUrl : ''
  normalized.registrationUrl = typeof normalized.registrationUrl === 'string' ? normalized.registrationUrl : ''
  normalized.capacity = typeof normalized.capacity === 'number' ? normalized.capacity : null
  normalized.status = EVENT_STATUS_VALUES.has(normalized.status) ? normalized.status : 'scheduled'
  return normalized
}

const ensurePostTypeAndEventDefaults = (doc) => {
  if (!doc || typeof doc !== 'object')
    return
  const desiredType = normalizePostType(doc.type)
  if (!doc.type || doc.type !== desiredType)
    doc.type = desiredType || 'post'

  let eventTarget = doc.event
  if (!eventTarget || typeof eventTarget !== 'object') {
    eventTarget = {}
    doc.event = eventTarget
  }

  if (typeof eventTarget.startAt !== 'string')
    eventTarget.startAt = ''
  if (typeof eventTarget.endAt !== 'string')
    eventTarget.endAt = ''
  if (typeof eventTarget.startAtUtc !== 'string')
    eventTarget.startAtUtc = ''
  if (typeof eventTarget.endAtUtc !== 'string')
    eventTarget.endAtUtc = ''
  if (typeof eventTarget.isPast !== 'boolean')
    eventTarget.isPast = false
  if (typeof eventTarget.unpublishPastEvent !== 'boolean')
    eventTarget.unpublishPastEvent = true
  eventTarget.timezone = eventTarget.timezone || DEFAULT_TIMEZONE
  if (typeof eventTarget.locationName !== 'string')
    eventTarget.locationName = ''
  if (typeof eventTarget.locationAddress !== 'string')
    eventTarget.locationAddress = ''
  if (typeof eventTarget.isVirtual !== 'boolean')
    eventTarget.isVirtual = false
  if (typeof eventTarget.meetingUrl !== 'string')
    eventTarget.meetingUrl = ''
  if (typeof eventTarget.registrationUrl !== 'string')
    eventTarget.registrationUrl = ''
  const parsedCapacity = Number(eventTarget.capacity)
  eventTarget.capacity = Number.isFinite(parsedCapacity) ? parsedCapacity : null
  eventTarget.status = EVENT_STATUS_VALUES.has(eventTarget.status) ? eventTarget.status : 'scheduled'
}

const eventComparable = (event) => {
  const normalized = normalizeEventData(event)
  return {
    startAt: normalized.startAt,
    endAt: normalized.endAt,
    startAtUtc: normalized.startAtUtc,
    endAtUtc: normalized.endAtUtc,
    isPast: normalized.isPast,
    unpublishPastEvent: normalized.unpublishPastEvent,
    timezone: normalized.timezone,
    locationName: normalized.locationName,
    locationAddress: normalized.locationAddress,
    isVirtual: normalized.isVirtual,
    meetingUrl: normalized.meetingUrl,
    registrationUrl: normalized.registrationUrl,
    capacity: normalized.capacity,
    status: normalized.status,
  }
}

const postDocComparable = (post) => {
  return {
    name: post?.name || '',
    title: post?.title || '',
    blurb: post?.blurb || '',
    tags: Array.isArray(post?.tags) ? post.tags : [],
    featuredImage: post?.featuredImage || '',
    content: Array.isArray(post?.content) ? post.content : (typeof post?.content === 'string' ? post.content : ''),
    structure: Array.isArray(post?.structure) ? post.structure : [],
    type: normalizePostType(post?.type),
    event: eventComparable(post?.event),
    publishAt: typeof post?.publishAt === 'string' ? post.publishAt : '',
    publishAtTimezone: typeof post?.publishAtTimezone === 'string' ? post.publishAtTimezone : '',
  }
}

const eventEndAtMs = (event = {}) => {
  const endAtUtc = String(event.endAtUtc || '').trim()
  if (endAtUtc) {
    const utcMs = Date.parse(endAtUtc)
    if (Number.isFinite(utcMs))
      return utcMs
  }
  const endAt = String(event.endAt || '').trim()
  if (!endAt)
    return Number.NaN
  const fallbackMs = Date.parse(endAt)
  return Number.isFinite(fallbackMs) ? fallbackMs : Number.NaN
}

const parseDateTimeLocal = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match)
    return null

  const [, year, month, day, hour, minute, second] = match
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second || 0),
  }
}

const getTimeZoneOffsetMinutes = (date, timeZone) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return (asIfUtc - date.getTime()) / 60000
}

const localDateTimeInTimeZoneToUtcIso = (localValue, timeZone) => {
  const parsed = parseDateTimeLocal(localValue)
  if (!parsed || !timeZone)
    return ''

  try {
    const localAsUtcMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second)
    let utcMs = localAsUtcMs

    for (let i = 0; i < 3; i++) {
      const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone)
      const candidateUtcMs = localAsUtcMs - offsetMinutes * 60 * 1000
      if (candidateUtcMs === utcMs)
        break
      utcMs = candidateUtcMs
    }

    return new Date(utcMs).toISOString()
  }
  catch {
    return ''
  }
}

const syncEventUtcFields = (doc) => {
  if (!doc || typeof doc !== 'object')
    return

  ensurePostTypeAndEventDefaults(doc)
  if (normalizePostType(doc.type) !== 'event')
    return

  const startAtUtc = localDateTimeInTimeZoneToUtcIso(doc.event.startAt, doc.event.timezone)
  const endAtUtc = localDateTimeInTimeZoneToUtcIso(doc.event.endAt, doc.event.timezone)
  const endAtMs = endAtUtc ? Date.parse(endAtUtc) : Number.NaN
  const isPast = Number.isFinite(endAtMs) ? endAtMs <= Date.now() : false
  if (doc.event.startAtUtc !== startAtUtc)
    doc.event.startAtUtc = startAtUtc
  if (doc.event.endAtUtc !== endAtUtc)
    doc.event.endAtUtc = endAtUtc
  if (doc.event.isPast !== isPast)
    doc.event.isPast = isPast
  if (typeof doc.event.unpublishPastEvent !== 'boolean')
    doc.event.unpublishPastEvent = true
}

const schemas = {
  posts: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
    title: z.string({
      required_error: 'Title is required',
    }).min(1, { message: 'Title is required' }),
    tags: z.array(z.string()).optional(),
    blurb: z.string({
      required_error: 'Content blurb is required',
    }).min(1, { message: 'Content blurb is required' }).max(500, { message: 'Content blurb must be at most 500 characters' }),
    content: z.union([z.array(z.any()), z.string()]).optional(),
    structure: z.array(z.any()).optional(),
    featuredImages: z.array(z.string()).optional(),
    publishAt: z.string().optional(),
    publishAtTimezone: z.string().optional(),
    type: z.enum(['post', 'event']).optional(),
    event: z.object({
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      startAtUtc: z.string().optional(),
      endAtUtc: z.string().optional(),
      isPast: z.boolean().optional(),
      unpublishPastEvent: z.boolean().optional(),
      timezone: z.string().optional(),
      locationName: z.string().optional(),
      locationAddress: z.string().optional(),
      isVirtual: z.boolean().optional(),
      meetingUrl: z.string().optional(),
      registrationUrl: z.string().optional(),
      capacity: z.number().optional(),
      status: z.enum(['scheduled', 'cancelled', 'completed']).optional(),
    }).optional(),
  }).superRefine((doc, ctx) => {
    if (normalizePostType(doc.type) !== 'event')
      return

    const startAt = String(doc.event?.startAt || '').trim()
    const endAt = String(doc.event?.endAt || '').trim()
    const isVirtual = Boolean(doc.event?.isVirtual)
    const locationName = String(doc.event?.locationName || '').trim()
    const locationAddress = String(doc.event?.locationAddress || '').trim()

    if (!startAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Start At is required for events',
        path: ['event', 'startAt'],
      })
    }

    if (!endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End At is required for events',
        path: ['event', 'endAt'],
      })
    }

    if (!isVirtual && !locationName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Location Name is required for in-person events',
        path: ['event', 'locationName'],
      })
    }

    if (!isVirtual && !locationAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Location Address is required for in-person events',
        path: ['event', 'locationAddress'],
      })
    }
  })),
}

const renameSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

const publishedPosts = computed(() => edgeFirebase.data?.[publishedCollectionKey.value] || {})

const hasPublishDiff = (postId, draftPostOverride = null) => {
  const publishedPost = publishedPosts.value?.[postId]
  const draftPost = draftPostOverride || edgeFirebase.data?.[collectionKey.value]?.[postId]
  if (!publishedPost && draftPost) {
    return true
  }
  if (publishedPost && !draftPost) {
    return true
  }
  if (publishedPost && draftPost) {
    return stableSerialize(postDocComparable(publishedPost)) !== stableSerialize(postDocComparable(draftPost))
  }
  return false
}

const getPublishState = (postId, draftPostOverride = null) => {
  const publishedPost = publishedPosts.value?.[postId]
  const draftPost = draftPostOverride || edgeFirebase.data?.[collectionKey.value]?.[postId]
  if (publishedPost && !draftPost)
    return 'publishedOnly'
  if (!publishedPost && draftPost)
    return 'unpublished'
  if (publishedPost && draftPost)
    return hasPublishDiff(postId, draftPost) ? 'publishedWithChanges' : 'published'
  return 'unpublished'
}

const getPublishBlockedReason = (postId, draftPostOverride = null, options = {}) => {
  const draftPost = draftPostOverride || edgeFirebase.data?.[collectionKey.value]?.[postId]
  if (!draftPost)
    return ''
  if (normalizePostType(draftPost.type) !== 'event')
    return ''
  const eventData = normalizeEventData(draftPost.event)
  const requestedMs = Number(options?.publishAtMs)
  const effectivePublishMs = Number.isFinite(requestedMs) ? requestedMs : Date.now()
  const endAtMs = eventEndAtMs(eventData)
  if (eventData.unpublishPastEvent && Number.isFinite(endAtMs) && endAtMs <= effectivePublishMs)
    return 'Cannot publish because this event is in the past while "Unpublish Past Event" is enabled.'
  return ''
}

const getPublishStatus = (postId, draftPostOverride = null) => {
  const status = getPublishState(postId, draftPostOverride)
  const publishBlockedReason = getPublishBlockedReason(postId, draftPostOverride)
  if (status === 'published') {
    return {
      label: 'Published',
      icon: 'published',
      canPublish: false,
      canUnpublish: true,
      badgeClass: 'text-emerald-700 dark:text-emerald-300',
      publishBlockedReason,
    }
  }
  if (status === 'publishedWithChanges') {
    return {
      label: 'Published (Unpublished Changes)',
      icon: 'changes',
      canPublish: !publishBlockedReason,
      canUnpublish: true,
      badgeClass: 'text-amber-700 dark:text-amber-300',
      publishBlockedReason,
    }
  }
  if (status === 'publishedOnly') {
    return {
      label: 'Published',
      icon: 'published',
      canPublish: false,
      canUnpublish: true,
      badgeClass: 'text-emerald-700 dark:text-emerald-300',
      publishBlockedReason,
    }
  }
  return {
    label: 'Unpublished',
    icon: 'unpublished',
    canPublish: !publishBlockedReason,
    canUnpublish: false,
    badgeClass: 'text-slate-600 dark:text-slate-300',
    publishBlockedReason,
  }
}

const lastPublishedTime = (postId) => {
  const publishedPost = publishedPosts.value?.[postId]
  const timestamp = publishedPost?.publishedAt || publishedPost?.last_updated || publishedPost?.doc_created_at || publishedPost?.createdAt
  if (!timestamp)
    return 'Never'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()))
    return 'Never'
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const state = reactive({
  editMode: false,
  sheetOpen: false,
  activePostId: '',
  editorKey: 0,
  editorHasUnsavedChanges: false,
  newPostDialogOpen: false,
  postTemplateFilter: 'quick-picks',
  selectedPostTemplateId: '__blank__',
  deleteDialog: false,
  postToDelete: null,
  editorDoc: null,
  internalSlugUpdate: false,
  slugManuallyEdited: false,
  lastAutoSlug: '',
  renameDialog: false,
  renamePost: null,
  renameValue: '',
  renameSubmitting: false,
  renameInternalUpdate: false,
  imageOpen: false,
  listSearch: '',
  listTypeFilter: 'all',
  reindexPublishedPostsLoading: false,
  publishAtInput: '',
  historyDialogOpen: false,
  historyLoading: false,
  historyRestoring: false,
  historyError: '',
  historyItems: [],
  historySelectedId: '',
  historyPreviewDoc: null,
  showHistoryDiffDialog: false,
  showStatusCompareDialog: false,
  newDocs: {
    posts: {
      name: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'text',
          'label': 'Name',
        },
      },
      title: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'text',
          'label': 'Title',
        },
      },
      tags: {
        value: [],
        cols: '12',
        bindings: {
          'field-type': 'tags',
          'value-as': 'array',
          'label': 'Tags',
          'placeholder': 'Add a tag',
        },
      },
      blurb: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'textarea',
          'label': 'Content Blurb / Preview',
          'rows': '8',
        },
      },
      content: {
        value: [],
      },
      structure: {
        value: [],
      },
      featuredImage: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'tags',
          'value-as': 'array',
          'label': 'Featured Images',
          'description': 'Enter image URLs or storage paths',
        },
      },
      publishAt: {
        value: '',
      },
      publishAtTimezone: {
        value: '',
      },
      type: {
        value: 'post',
      },
      event: {
        value: normalizeEventData(),
      },
    },
  },
})

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[collectionKey.value]) {
    await edgeFirebase.startSnapshot(collectionKey.value)
  }
  if (!edgeFirebase.data?.[publishedCollectionKey.value]) {
    await edgeFirebase.startSnapshot(publishedCollectionKey.value)
  }
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/sites`)
  }
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/themes`)
  }
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`]) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/blocks`)
  }
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`]) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)
  }
})

const posts = computed(() => edgeFirebase.data?.[collectionKey.value] || {})
const postTemplateCollectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)
const postTemplatesCollection = computed(() => edgeFirebase.data?.[postTemplateCollectionKey.value] || {})
const pendingNewPostTemplateState = useState('edge-cms-pending-new-post-template', () => ({}))
const postTemplatePreviewContextCache = useState('edge-cms-post-template-preview-context-cache', () => ({}))
const postTemplatePreviewContext = ref(null)
const selectedThemeId = computed(() => String(
  edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site]?.theme || '',
).trim())
const theme = computed(() => {
  const themeId = selectedThemeId.value
  if (!themeId)
    return null
  const themeDoc = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[themeId] || null
  const themeContents = themeDoc?.theme || null
  if (!themeContents)
    return null
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  try {
    const parsedTheme = typeof themeContents === 'string' ? JSON.parse(themeContents) : themeContents
    if (!parsedTheme || typeof parsedTheme !== 'object' || Array.isArray(parsedTheme))
      return null
    return { ...parsedTheme, extraCSS }
  }
  catch {
    return null
  }
})

const blocksCollection = computed(() => edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/blocks`] || {})

const themeColorMap = computed(() => {
  const map = {}
  const colors = theme.value?.extend?.colors
  if (!colors || typeof colors !== 'object')
    return map

  for (const [key, val] of Object.entries(colors)) {
    if (typeof val === 'string' && val !== '')
      map[key] = val
  }
  return map
})

const themeColorOptions = computed(() => {
  const colors = themeColorMap.value
  const options = Object.keys(colors || {}).map(color => ({ name: color, title: color.charAt(0).toUpperCase() + color.slice(1) }))
  return [{ name: 'transparent', title: 'Transparent' }, ...options]
})

const postTemplateStateKey = computed(() => {
  const orgId = String(edgeGlobal.edgeState.currentOrganization || 'no-org').trim() || 'no-org'
  const siteId = String(props.site || 'no-site').trim() || 'no-site'
  return `${orgId}:${siteId}`
})

const blankPostTemplateTile = {
  docId: '__blank__',
  name: 'Blank',
  description: 'Start a post from scratch.',
  content: [],
  structure: [],
  type: ['Post'],
}

const postTemplateCardItems = computed(() => {
  const templates = Object.entries(postTemplatesCollection.value)
    .map(([docId, doc]) => {
      const postContent = Array.isArray(doc?.postContent) ? edgeGlobal.dupObject(doc.postContent) : []
      const fallbackContent = Array.isArray(doc?.content) ? edgeGlobal.dupObject(doc.content) : []
      const postStructure = Array.isArray(doc?.postStructure) ? edgeGlobal.dupObject(doc.postStructure) : []
      const fallbackStructure = Array.isArray(doc?.structure) ? edgeGlobal.dupObject(doc.structure) : []
      const normalizedTemplateDoc = normalizePostBuilderDoc({
        content: postContent.length ? postContent : fallbackContent,
        structure: postStructure.length ? postStructure : fallbackStructure,
      }).normalized

      return {
        docId,
        ...(doc || {}),
        name: String(doc?.name || 'Untitled Template').trim() || 'Untitled Template',
        description: String(doc?.metaDescription || doc?.description || '').trim(),
        content: normalizedTemplateDoc.content,
        structure: normalizedTemplateDoc.structure,
        post: Boolean(doc?.post),
        type: normalizeTemplatePageTypes(doc?.type),
      }
    })
    .filter(template => template.type.includes('Post') && !template.post)
    .sort((left, right) => left.name.localeCompare(right.name))

  return [blankPostTemplateTile, ...templates]
})

const postTemplateFilterOptions = computed(() => {
  const tagSet = new Set()
  for (const template of postTemplateCardItems.value) {
    if (template.docId === blankPostTemplateTile.docId)
      continue
    for (const tag of template.tags || []) {
      const normalized = typeof tag === 'string' ? tag.trim() : ''
      if (!normalized || normalized.toLowerCase() === 'quick picks')
        continue
      tagSet.add(normalized)
    }
  }
  const tagOptions = Array.from(tagSet)
    .sort((a, b) => a.localeCompare(b))
    .map(tag => ({ label: tag, value: tag }))

  return [
    { label: 'Quick Picks', value: 'quick-picks' },
    ...tagOptions,
  ]
})

const postTemplateFilterMatches = (template, filterValue) => {
  if (template.docId === blankPostTemplateTile.docId)
    return true
  if (filterValue === 'all')
    return true
  if (filterValue === 'quick-picks')
    return Array.isArray(template.tags) && template.tags.map(tag => String(tag || '').toLowerCase()).includes('quick picks')
  return Array.isArray(template.tags) && template.tags.includes(filterValue)
}

const filteredPostTemplateCardItems = computed(() => {
  const templates = postTemplateCardItems.value
  const filterValue = state.postTemplateFilter
  const filtered = templates.filter(template => postTemplateFilterMatches(template, filterValue))

  if (filtered.length <= 1 && filterValue === 'quick-picks')
    return templates
  if (filtered.length <= 1 && filterValue !== 'all')
    return templates
  return filtered
})

const selectedPostTemplate = computed(() => {
  return postTemplateCardItems.value.find(template => template.docId === state.selectedPostTemplateId) || blankPostTemplateTile
})
const isPostTemplateSelected = templateId => state.selectedPostTemplateId === templateId
const postsList = computed(() =>
  Object.entries(posts.value)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.doc_created_at ?? 0) - (a.doc_created_at ?? 0)),
)
const hasPosts = computed(() => postsList.value.length > 0)
const filteredPostsList = computed(() => {
  const query = String(state.listSearch || '').trim().toLowerCase()
  const typeFilter = String(state.listTypeFilter || 'all').toLowerCase()

  return postsList.value.filter((post) => {
    const type = normalizePostType(post?.type)
    if (typeFilter !== 'all' && type !== typeFilter)
      return false

    if (!query)
      return true

    const haystack = [
      String(post?.title || ''),
      String(post?.name || ''),
      String(post?.blurb || ''),
      ...(Array.isArray(post?.tags) ? post.tags.map(tag => String(tag || '')) : []),
    ].join(' ').toLowerCase()

    return haystack.includes(query)
  })
})
const hasFilteredPosts = computed(() => filteredPostsList.value.length > 0)
const isCreating = computed(() => state.activePostId === 'new')
const isFullList = computed(() => props.mode === 'list' && props.listVariant === 'full')

const getPostSlug = post => (post?.name && (typeof post.name === 'string' ? post.name.trim() : ''))

const slugify = (value) => {
  if (!value)
    return ''
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const ensureUniqueSlug = (input, excludeId = '') => {
  let base = slugify(input)
  if (!base)
    base = 'post'
  const existing = new Set(
    postsList.value
      .filter(post => post.id !== excludeId)
      .map(post => getPostSlug(post))
      .filter(Boolean),
  )

  let candidate = base
  let suffix = 1
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const activePost = computed(() => {
  if (!state.activePostId || state.activePostId === 'new')
    return null
  return posts.value?.[state.activePostId] || null
})

const currentPostPath = computed(() => {
  const orgPath = String(edgeGlobal.edgeState.organizationDocPath || '').trim()
  const postId = String(state.activePostId || '').trim()
  if (!orgPath || !postId || postId === 'new')
    return ''
  return `${orgPath}/${collection.value}/${postId}`
})

const currentPostRelativePath = computed(() => {
  const postId = String(state.activePostId || '').trim()
  if (!postId || postId === 'new')
    return ''
  return `${collection.value}/${postId}`
})

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const getOptionTitle = (options = [], value, fallback = '—') => {
  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue)
    return fallback
  return options.find(option => option.name === normalizedValue)?.title || normalizedValue
}

const getRowLayoutValueLabel = (field, value) => {
  if (field === 'width') {
    const widthMap = [
      { name: 'full', title: 'Full width (100%)' },
      { name: 'max-w-screen-2xl', title: 'Max width 2XL' },
      { name: 'max-w-screen-xl', title: 'Max width XL' },
      { name: 'max-w-screen-lg', title: 'Max width LG' },
      { name: 'max-w-screen-md', title: 'Max width MD' },
      { name: 'max-w-screen-sm', title: 'Max width SM' },
    ]
    return getOptionTitle(widthMap, value, 'Full width (100%)')
  }
  if (field === 'gap') {
    const gapMap = [
      { name: '0', title: 'No gap' },
      { name: '2', title: 'Small' },
      { name: '4', title: 'Medium' },
      { name: '6', title: 'Large' },
      { name: '8', title: 'X-Large' },
    ]
    return getOptionTitle(gapMap, value, 'Medium')
  }
  if (field === 'verticalAlign') {
    const verticalMap = [
      { name: 'start', title: 'Top' },
      { name: 'center', title: 'Middle' },
      { name: 'end', title: 'Bottom' },
      { name: 'stretch', title: 'Stretch' },
    ]
    return getOptionTitle(verticalMap, value, 'Top')
  }
  if (field === 'mobileStack') {
    const mobileMap = [
      { name: 'normal', title: 'Left first' },
      { name: 'reverse', title: 'Right first' },
    ]
    return getOptionTitle(mobileMap, value, 'Left first')
  }
  if (field === 'background')
    return getOptionTitle(themeColorOptions.value, value || 'transparent', 'Transparent')
  return String(value ?? '—')
}

const getRowColumnLayoutLabel = (row) => {
  const spans = (row?.columns || [])
    .map(col => Number.isFinite(col?.span) ? col.span : null)
    .filter(Number.isFinite)
  if (spans.length)
    return spans.join(' / ')
  const count = row?.columns?.length || 0
  if (!count)
    return 'No columns'
  return `${count} column${count === 1 ? '' : 's'}`
}

const buildLayoutRowMap = (rows = []) => {
  const rowMap = new Map()
  if (!Array.isArray(rows))
    return rowMap

  rows.forEach((row, index) => {
    const rowId = String(row?.id || `row-${index}`)
    rowMap.set(rowId, {
      id: rowId,
      index,
      row,
    })
  })

  return rowMap
}

const buildLayoutChangeDetails = (baseRows = [], compareRows = []) => {
  const details = []
  const baseMap = buildLayoutRowMap(baseRows)
  const compareMap = buildLayoutRowMap(compareRows)
  const allRowIds = new Set([...baseMap.keys(), ...compareMap.keys()])

  for (const rowId of allRowIds) {
    const baseEntry = baseMap.get(rowId) || null
    const compareEntry = compareMap.get(rowId) || null

    if (!baseEntry && compareEntry) {
      details.push({
        key: `${rowId}:added`,
        label: `Row ${compareEntry.index + 1}`,
        base: 'Not present',
        compare: `Added (${getRowColumnLayoutLabel(compareEntry.row)})`,
      })
      continue
    }

    if (baseEntry && !compareEntry) {
      details.push({
        key: `${rowId}:removed`,
        label: `Row ${baseEntry.index + 1}`,
        base: `Removed (${getRowColumnLayoutLabel(baseEntry.row)})`,
        compare: 'Not present',
      })
      continue
    }

    if (baseEntry.index !== compareEntry.index) {
      details.push({
        key: `${rowId}:moved`,
        label: 'Row Order',
        base: `Row ${baseEntry.index + 1}`,
        compare: `Row ${compareEntry.index + 1}`,
      })
    }

    const rowLabel = `Row ${compareEntry.index + 1}`
    const fieldPairs = [
      ['width', 'Width'],
      ['gap', 'Gap'],
      ['verticalAlign', 'Vertical Alignment'],
      ['mobileStack', 'Stack Order'],
      ['background', 'Background'],
    ]

    fieldPairs.forEach(([field, label]) => {
      const baseValue = baseEntry.row?.[field]
      const compareValue = compareEntry.row?.[field]
      if (areEqualNormalized(baseValue, compareValue))
        return
      details.push({
        key: `${rowId}:${field}`,
        label: `${rowLabel}: ${label}`,
        base: getRowLayoutValueLabel(field, baseValue),
        compare: getRowLayoutValueLabel(field, compareValue),
      })
    })

    const baseColumnLayout = getRowColumnLayoutLabel(baseEntry.row)
    const compareColumnLayout = getRowColumnLayoutLabel(compareEntry.row)
    if (baseColumnLayout !== compareColumnLayout) {
      details.push({
        key: `${rowId}:columns`,
        label: `${rowLabel}: Columns`,
        base: baseColumnLayout,
        compare: compareColumnLayout,
      })
    }
  }

  return details
}

function mergeSyncedBlockMeta(currentMeta, existingMeta) {
  const nextMeta = edgeGlobal.dupObject(currentMeta || {})
  if (!isPlainObject(existingMeta))
    return nextMeta

  Object.entries(existingMeta).forEach(([key, value]) => {
    if (!isPlainObject(value) || !isPlainObject(value.queryItems))
      return
    if (!isPlainObject(nextMeta[key]))
      nextMeta[key] = {}
    nextMeta[key].queryItems = edgeGlobal.dupObject(value.queryItems)
  })

  return nextMeta
}

const resolveSyncedPostBlock = (block) => {
  if (!isPlainObject(block))
    return block

  const resolvedBlock = edgeGlobal.dupObject(block)
  const blockId = String(resolvedBlock.blockId || '').trim()
  if (!blockId)
    return resolvedBlock

  const currentBlockDoc = blocksCollection.value?.[blockId]
  if (!isPlainObject(currentBlockDoc))
    return resolvedBlock

  return {
    ...edgeGlobal.dupObject(currentBlockDoc),
    id: resolvedBlock.id,
    blockId,
    synced: resolvedBlock.synced ?? currentBlockDoc.synced ?? false,
    values: edgeGlobal.dupObject(resolvedBlock.values || {}),
    meta: mergeSyncedBlockMeta(currentBlockDoc.meta, resolvedBlock.meta),
  }
}

const resolveSyncedPostBlocks = (blocks = []) => {
  if (!Array.isArray(blocks))
    return []
  return blocks.map(block => resolveSyncedPostBlock(block))
}

const resolveSyncedPostDoc = (doc) => {
  if (!isPlainObject(doc))
    return doc

  const nextDoc = edgeGlobal.dupObject(doc)
  nextDoc.content = resolveSyncedPostBlocks(nextDoc.content)
  const blockIds = Array.isArray(nextDoc.content) ? nextDoc.content.map(block => block?.blockId).filter(Boolean) : []
  nextDoc.blockIds = [...new Set(blockIds)]
  return nextDoc
}

const buildComparablePostBlock = (block) => {
  if (!isPlainObject(block))
    return block

  const blockId = String(block.blockId || '').trim()
  const currentBlockDoc = blockId ? blocksCollection.value?.[blockId] : null
  if (blockId && isPlainObject(currentBlockDoc)) {
    const comparableMeta = {}
    Object.entries(block.meta || {}).forEach(([key, value]) => {
      if (isPlainObject(value) && isPlainObject(value.queryItems))
        comparableMeta[key] = { queryItems: edgeGlobal.dupObject(value.queryItems) }
    })
    return {
      id: String(block.id || ''),
      blockId,
      synced: block.synced ?? currentBlockDoc.synced ?? false,
      values: edgeGlobal.dupObject(block.values || {}),
      meta: comparableMeta,
    }
  }

  return edgeGlobal.dupObject(block)
}

const buildComparablePostDiffDoc = (doc) => {
  if (!doc || typeof doc !== 'object')
    return null

  const normalizedDoc = resolveSyncedPostDoc(normalizePostBuilderDoc(edgeGlobal.dupObject(doc)).normalized)

  return {
    title: normalizedDoc?.title || '',
    name: normalizedDoc?.name || '',
    blurb: normalizedDoc?.blurb || '',
    tags: Array.isArray(normalizedDoc?.tags) ? normalizedDoc.tags : [],
    featuredImage: normalizedDoc?.featuredImage || '',
    content: Array.isArray(normalizedDoc?.content) ? normalizedDoc.content.map(buildComparablePostBlock) : [],
    structure: Array.isArray(normalizedDoc?.structure) ? normalizedDoc.structure : [],
    type: normalizePostType(normalizedDoc?.type),
    event: eventComparable(normalizedDoc?.event),
    publishAt: typeof normalizedDoc?.publishAt === 'string' ? normalizedDoc.publishAt : '',
    publishAtTimezone: typeof normalizedDoc?.publishAtTimezone === 'string' ? normalizedDoc.publishAtTimezone : '',
  }
}

const currentHistoryCompareDoc = computed(() => resolveSyncedPostDoc(activePost.value))

const getHistorySnapshotState = (item) => {
  if (isPlainObject(item?.afterData))
    return 'afterData'
  if (isPlainObject(item?.beforeData))
    return 'beforeData'
  return ''
}

const getHistorySnapshotDoc = item => item?.[getHistorySnapshotState(item)] || null

const rawHistoryPreviewItems = computed(() => {
  return (state.historyItems || []).filter(item => !!getHistorySnapshotDoc(item))
})

const postDocsMatchForDiff = (baseDoc, compareDoc) => {
  return areEqualNormalized(
    buildComparablePostDiffDoc(baseDoc),
    buildComparablePostDiffDoc(compareDoc),
  )
}

const historyPreviewItems = computed(() => {
  const items = rawHistoryPreviewItems.value
  if (!items.length)
    return []

  const [firstItem, ...restItems] = items
  const firstHistoryDoc = getHistorySnapshotDoc(firstItem)
  if (firstHistoryDoc && postDocsMatchForDiff(firstHistoryDoc, activePost.value))
    return restItems

  return items
})

const selectedHistoryEntry = computed(() => {
  return historyPreviewItems.value.find(item => item.historyId === state.historySelectedId) || null
})

const historyVersionItems = computed(() => {
  return historyPreviewItems.value.map((item, index) => ({
    name: item.historyId,
    title: formatHistoryEntryLabel(item, index),
  }))
})

const renderedHistoryPreviewDoc = computed(() => {
  if (!isPlainObject(state.historyPreviewDoc))
    return null
  return resolveSyncedPostDoc(normalizePostBuilderDoc(edgeGlobal.dupObject(state.historyPreviewDoc)).normalized)
})

const activePostPublishStatus = computed(() => {
  if (!state.activePostId || state.activePostId === 'new') {
    return {
      label: 'Unpublished',
      icon: 'unpublished',
      canPublish: false,
      canUnpublish: false,
      badgeClass: 'text-slate-600 dark:text-slate-300',
      publishBlockedReason: '',
    }
  }
  return getPublishStatus(state.activePostId)
})

const publishedActivePost = computed(() => {
  if (!state.activePostId || state.activePostId === 'new')
    return null
  return publishedPosts.value?.[state.activePostId] || null
})

const unpublishedPostChangeDetails = computed(() => {
  return buildPostChangeDetails(publishedActivePost.value, activePost.value, {
    baseLabel: 'Published',
    compareLabel: 'Draft',
  })
})

const unsavedPostChangeDetails = computed(() => {
  return buildPostChangeDetails(activePost.value, state.editorDoc, {
    baseLabel: 'Saved',
    compareLabel: 'Current',
  })
})

const showingUnsavedPostChanges = computed(() => {
  return state.editorHasUnsavedChanges && unsavedPostChangeDetails.value.length > 0
})

const activePostChangeDetails = computed(() => {
  if (showingUnsavedPostChanges.value)
    return unsavedPostChangeDetails.value
  return unpublishedPostChangeDetails.value
})

const postChangesDialogTitle = computed(() => {
  return showingUnsavedPostChanges.value ? 'Unsaved Changes' : 'Unpublished Changes'
})

const postChangesDialogDescription = computed(() => {
  if (showingUnsavedPostChanges.value)
    return 'Review what changed in memory versus the saved post.'
  return `Review what changed since the last publish. Last Published: ${lastPublishedTime(state.activePostId)}`
})

const showPostStatusCompareLink = computed(() => {
  return showingUnsavedPostChanges.value || activePostPublishStatus.value.icon === 'changes'
})

const postStatusDisplayLabel = computed(() => {
  if (!showingUnsavedPostChanges.value)
    return activePostPublishStatus.value.label
  return activePostPublishStatus.value.icon === 'unpublished'
    ? 'Unpublished (Unsaved Changes)'
    : 'Published (Unsaved Changes)'
})

const openPostStatusCompareDialog = () => {
  if (!showPostStatusCompareLink.value)
    return
  state.showStatusCompareDialog = true
}

const formatIsoToDateTimeLocalInput = (isoString) => {
  const value = String(isoString || '').trim()
  if (!value)
    return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return ''
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

const nowDateTimeLocalInput = () => formatIsoToDateTimeLocalInput(new Date().toISOString())

const parseDateTimeLocalToUtcIso = (value) => {
  const text = String(value || '').trim()
  if (!text)
    return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime()))
    return ''
  return date.toISOString()
}

watch(
  () => activePost.value?.publishAt,
  (publishAt) => {
    state.publishAtInput = formatIsoToDateTimeLocalInput(publishAt) || nowDateTimeLocalInput()
  },
  { immediate: true },
)

const scheduledPublishBlockedReason = computed(() => {
  if (!state.activePostId || state.activePostId === 'new')
    return ''
  const publishAtIso = parseDateTimeLocalToUtcIso(state.publishAtInput)
  if (!publishAtIso)
    return ''
  const publishAtMs = Date.parse(publishAtIso)
  if (!Number.isFinite(publishAtMs))
    return 'Publish At must be a valid date and time.'

  const draftPost = posts.value?.[state.activePostId]
  if (!draftPost || normalizePostType(draftPost.type) !== 'event')
    return ''

  const eventData = normalizeEventData(draftPost.event)
  const endAtMs = eventEndAtMs(eventData)
  if (eventData.unpublishPastEvent && Number.isFinite(endAtMs) && endAtMs <= publishAtMs) {
    return 'Cannot schedule publish because event End At is before the scheduled Publish At while "Unpublish Past Event" is enabled.'
  }
  return ''
})

const editorOpen = computed(() => {
  if (props.mode === 'editor')
    return Boolean(props.selectedPostId)
  return state.sheetOpen
})

const sheetTitle = computed(() => {
  if (!editorOpen.value)
    return ''
  if (isCreating.value)
    return 'New Post'
  return activePost.value?.name || getPostSlug(activePost.value) || 'Edit Post'
})

const currentDocId = () => (state.activePostId && (state.activePostId !== 'new' ? state.activePostId : ''))

const getHistoryTimestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value?.millis === 'number' && Number.isFinite(value.millis))
    return value.millis
  const isoValue = String(value?.iso || value || '').trim()
  if (!isoValue)
    return null
  const parsed = Date.parse(isoValue)
  return Number.isFinite(parsed) ? parsed : null
}

const formatHistoryDate = (value) => {
  const millis = getHistoryTimestampMs(value)
  if (!millis)
    return 'Unknown date'
  return new Date(millis).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatHistoryEntryLabel(item, index = 0) {
  const dateLabel = formatHistoryDate(item?.createdAt)
  return dateLabel || `Entry ${index + 1}`
}

const cloneHistoryPreviewDoc = (doc) => {
  if (!isPlainObject(doc))
    return null
  return resolveSyncedPostDoc(normalizePostBuilderDoc(edgeGlobal.dupObject(doc)).normalized)
}

const syncHistoryPreviewDoc = (entry) => {
  state.historyPreviewDoc = cloneHistoryPreviewDoc(getHistorySnapshotDoc(entry))
}

const isHistoryItemArray = (value) => {
  if (!Array.isArray(value) || !value.length)
    return false
  return value.every((item) => {
    return item && typeof item === 'object' && (
      typeof item.historyId === 'string'
      || typeof item.path === 'string'
      || typeof item.relativePath === 'string'
    )
  })
}

const extractHistoryItemsFromResponse = (value, visited = new Set()) => {
  if (!value || typeof value !== 'object')
    return []
  if (visited.has(value))
    return []
  visited.add(value)

  if (isHistoryItemArray(value))
    return value

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nestedItems = extractHistoryItemsFromResponse(entry, visited)
      if (nestedItems.length)
        return nestedItems
    }
    return []
  }

  const priorityKeys = ['items', 'data', 'result']
  for (const key of priorityKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      continue
    const nestedItems = extractHistoryItemsFromResponse(value[key], visited)
    if (nestedItems.length)
      return nestedItems
  }

  for (const nestedValue of Object.values(value)) {
    const nestedItems = extractHistoryItemsFromResponse(nestedValue, visited)
    if (nestedItems.length)
      return nestedItems
  }

  return []
}

const loadPostHistoryFallbackItems = async () => {
  if (!edgeFirebase?.user?.uid || !edgeGlobal.edgeState.currentOrganization)
    return []

  const fallbackResponse = await edgeFirebase.runFunction('history-listHistory', {
    uid: edgeFirebase.user.uid,
    orgId: edgeGlobal.edgeState.currentOrganization,
    limit: 200,
  })
  const fallbackItems = extractHistoryItemsFromResponse(fallbackResponse)
  return fallbackItems.filter((item) => {
    const itemPath = String(item?.path || '').trim()
    const itemRelativePath = String(item?.relativePath || '').trim()
    return itemPath === currentPostPath.value || itemRelativePath === currentPostRelativePath.value
  })
}

const loadPostHistory = async () => {
  if (!edgeFirebase?.user?.uid || !currentPostPath.value)
    return

  state.historyLoading = true
  state.historyError = ''
  try {
    let items = []
    try {
      const response = await edgeFirebase.runFunction('history-listHistory', {
        uid: edgeFirebase.user.uid,
        path: currentPostPath.value,
        limit: 50,
      })
      items = extractHistoryItemsFromResponse(response)
    }
    catch (error) {
      console.warn('Direct post history lookup failed, falling back to org history lookup', error)
    }

    if (!items.length)
      items = await loadPostHistoryFallbackItems()

    state.historyItems = items
    const nextSelectedId = historyPreviewItems.value.find(item => item.historyId === state.historySelectedId)?.historyId
      || historyPreviewItems.value[0]?.historyId
      || ''
    state.historySelectedId = nextSelectedId
    syncHistoryPreviewDoc(selectedHistoryEntry.value)
  }
  catch (error) {
    console.error('Failed to load post history', error)
    state.historyItems = []
    state.historySelectedId = ''
    state.historyPreviewDoc = null
    state.historyError = 'Failed to load post history.'
  }
  finally {
    state.historyLoading = false
  }
}

const openHistoryDialog = async () => {
  if (!activePost.value || !currentPostPath.value || !edgeFirebase?.user?.uid)
    return
  state.historySelectedId = ''
  state.historyDialogOpen = true
  await loadPostHistory()
}

const closeHistoryDialog = () => {
  if (state.historyRestoring)
    return
  state.showHistoryDiffDialog = false
  state.historyDialogOpen = false
}

const notifySuccess = (message) => {
  edgeFirebase?.toast?.success?.(message)
}

const notifyError = (message) => {
  edgeFirebase?.toast?.error?.(message)
}

const restoreHistoryVersion = async () => {
  const historyEntry = selectedHistoryEntry.value
  if (!historyEntry?.historyId || !edgeFirebase?.user?.uid || !state.activePostId || state.activePostId === 'new')
    return

  state.historyRestoring = true
  state.historyError = ''
  try {
    const targetState = getHistorySnapshotState(historyEntry)
    await edgeFirebase.runFunction('history-restoreHistory', {
      uid: edgeFirebase.user.uid,
      historyId: historyEntry.historyId,
      targetState,
    })

    const restoredDoc = cloneHistoryPreviewDoc(getHistorySnapshotDoc(historyEntry))
    if (restoredDoc)
      await edgeFirebase.storeDoc(collectionKey.value, restoredDoc, state.activePostId)
    if (restoredDoc && posts.value)
      posts.value[state.activePostId] = edgeGlobal.dupObject(restoredDoc)
    state.editorDoc = restoredDoc ? edgeGlobal.dupObject(restoredDoc) : null
    state.editorHasUnsavedChanges = false
    state.editMode = false
    state.showHistoryDiffDialog = false
    state.historyDialogOpen = false
    state.editorKey += 1
    notifySuccess(`Restored post from ${formatHistoryEntryLabel(historyEntry)}.`)
  }
  catch (error) {
    console.error('Failed to restore post history version', error)
    state.historyError = 'Failed to restore this version.'
    notifyError('Failed to restore post history.')
  }
  finally {
    state.historyRestoring = false
  }
}

watch(
  () => state.editorDoc?.title,
  (newTitle) => {
    if (!state.editorDoc)
      return
    if (state.slugManuallyEdited && state.editorDoc.name)
      return
    if (!newTitle) {
      state.lastAutoSlug = ''
      return
    }
    const unique = ensureUniqueSlug(newTitle, currentDocId())
    state.internalSlugUpdate = true
    state.lastAutoSlug = unique
    state.editorDoc.name = unique
    state.internalSlugUpdate = false
  },
)

watch(
  () => state.editorDoc?.name,
  (newName) => {
    if (!state.editorDoc)
      return
    if (state.internalSlugUpdate) {
      state.internalSlugUpdate = false
      return
    }
    const sanitized = slugify(newName)
    if (!sanitized) {
      state.editorDoc.name = ''
      state.slugManuallyEdited = false
      state.lastAutoSlug = ''
      return
    }
    const unique = ensureUniqueSlug(sanitized, currentDocId())
    if (unique !== newName) {
      state.internalSlugUpdate = true
      state.editorDoc.name = unique
      return
    }
    state.editorDoc.name = unique
    if (unique !== state.lastAutoSlug)
      state.slugManuallyEdited = true
  },
)

watch(
  () => state.renameValue,
  (newVal) => {
    if (!state.renameDialog)
      return
    if (state.renameInternalUpdate) {
      state.renameInternalUpdate = false
      return
    }
    const sanitized = slugify(newVal)
    if (sanitized === newVal)
      return
    state.renameInternalUpdate = true
    state.renameValue = sanitized
  },
)

const formatTimestamp = (input) => {
  if (!input)
    return 'Not yet saved'
  try {
    return new Date(input).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }
  catch {
    return 'Not yet saved'
  }
}

const stringifyLimited = (value, limit = 600) => {
  if (value == null)
    return '—'
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return stringValue.length > limit ? `${stringValue.slice(0, limit)}...` : stringValue
  }
  catch {
    return '—'
  }
}

const summarizeBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0)
    return 'No blocks'
  const count = blocks.length
  return `${count} block${count === 1 ? '' : 's'}`
}

const summarizeChangeValue = (value, detailed = false) => {
  if (value == null || value === '')
    return '—'
  if (Array.isArray(value)) {
    return detailed ? stringifyLimited(value) : summarizeBlocks(value)
  }
  if (typeof value === 'object') {
    return stringifyLimited(value, detailed ? 900 : 180)
  }
  const stringVal = String(value).trim()
  return stringVal.length > (detailed ? 320 : 180) ? `${stringVal.slice(0, detailed ? 317 : 177)}...` : stringVal
}

const describeBlock = (block) => {
  if (!block)
    return 'Block'
  const type = block.component || block.type || block.layout || 'Block'
  const title = block?.values?.title || block?.values?.heading || block?.values?.label || block.title || block.heading || block.label || block.name || ''
  const parts = [type]
  if (title)
    parts.push(`“${String(title)}”`)
  return parts.filter(Boolean).join(' - ')
}

const getBlockChangeTypeLabel = (changeType) => {
  if (changeType === 'added')
    return 'Added'
  if (changeType === 'removed')
    return 'Removed'
  if (changeType === 'moved')
    return 'Moved'
  if (changeType === 'movedChanged')
    return 'Moved and Changed'
  return 'Changed'
}

const getBlockPositionLabel = (position) => {
  if (!position)
    return 'Not placed'
  const parts = [
    `Row ${position.rowIndex + 1}`,
    `Column ${position.colIndex + 1}`,
  ]
  if (position.columnBlockCount > 1)
    parts.push(`Position ${position.blockIndex + 1}`)
  return parts.join(', ')
}

const normalizeBlockPositionForDiff = (position) => {
  if (!position)
    return null
  return {
    rowIndex: Number.isFinite(position.rowIndex) ? position.rowIndex : null,
    colIndex: Number.isFinite(position.colIndex) ? position.colIndex : null,
    blockIndex: Number.isFinite(position.blockIndex) ? position.blockIndex : null,
  }
}

const buildBlockMap = (blocks = [], prefix = 'block') => {
  const map = new Map()
  blocks.forEach((block, index) => {
    const key = String(block?.id || `${prefix}-${index}`)
    map.set(key, block)
  })
  return map
}

const buildBlockPositionMap = (rows = []) => {
  const positions = new Map()
  if (!Array.isArray(rows))
    return positions

  rows.forEach((row, rowIndex) => {
    const columns = Array.isArray(row?.columns) ? row.columns : []
    columns.forEach((column, colIndex) => {
      const blockIds = Array.isArray(column?.blocks) ? column.blocks : []
      blockIds.forEach((blockId, blockIndex) => {
        const normalizedBlockId = String(blockId || '').trim()
        if (!normalizedBlockId || positions.has(normalizedBlockId))
          return
        positions.set(normalizedBlockId, {
          rowIndex,
          colIndex,
          blockIndex,
          columnBlockCount: blockIds.length,
        })
      })
    })
  })

  return positions
}

const stripStructureBlocks = (rows = []) => {
  if (!Array.isArray(rows))
    return []

  return rows.map((row) => {
    const normalizedRow = {
      ...(row || {}),
      columns: Array.isArray(row?.columns)
        ? row.columns.map((column) => {
          const nextColumn = { ...(column || {}) }
          delete nextColumn.blocks
          return nextColumn
        })
        : [],
    }
    return normalizedRow
  })
}

const buildBlockChangeDetails = (baseBlocks = [], compareBlocks = [], baseStructure = [], compareStructure = [], keyPrefix = 'blocks') => {
  const details = []
  const baseMap = buildBlockMap(baseBlocks, `${keyPrefix}-base`)
  const compareMap = buildBlockMap(compareBlocks, `${keyPrefix}-compare`)
  const basePositions = buildBlockPositionMap(baseStructure)
  const comparePositions = buildBlockPositionMap(compareStructure)
  const allBlockIds = new Set([
    ...baseMap.keys(),
    ...compareMap.keys(),
    ...basePositions.keys(),
    ...comparePositions.keys(),
  ])

  for (const blockId of allBlockIds) {
    const baseBlock = baseMap.get(blockId) || null
    const compareBlock = compareMap.get(blockId) || null
    const basePosition = basePositions.get(blockId) || null
    const comparePosition = comparePositions.get(blockId) || null
    const baseComparableBlock = buildComparablePostBlock(baseBlock)
    const compareComparableBlock = buildComparablePostBlock(compareBlock)
    const baseRenderBlock = resolveSyncedPostBlock(baseBlock)
    const compareRenderBlock = resolveSyncedPostBlock(compareBlock)

    if (!baseBlock && compareBlock) {
      details.push({
        key: `${keyPrefix}:added:${blockId}`,
        changeType: 'added',
        label: getBlockChangeTypeLabel('added'),
        blockLabel: describeBlock(compareBlock),
        baseBlock: null,
        compareBlock: compareRenderBlock,
        basePositionLabel: 'Not present',
        comparePositionLabel: getBlockPositionLabel(comparePosition),
        showPreview: true,
        sortPosition: comparePosition || basePosition || null,
      })
      continue
    }

    if (baseBlock && !compareBlock) {
      details.push({
        key: `${keyPrefix}:removed:${blockId}`,
        changeType: 'removed',
        label: getBlockChangeTypeLabel('removed'),
        blockLabel: describeBlock(baseBlock),
        baseBlock: baseRenderBlock,
        compareBlock: null,
        basePositionLabel: getBlockPositionLabel(basePosition),
        comparePositionLabel: 'Not present',
        showPreview: true,
        sortPosition: basePosition || comparePosition || null,
      })
      continue
    }

    const moved = !areEqualNormalized(
      normalizeBlockPositionForDiff(basePosition),
      normalizeBlockPositionForDiff(comparePosition),
    )
    const changed = !areEqualNormalized(baseComparableBlock, compareComparableBlock)
    if (!moved && !changed)
      continue

    let changeType = 'changed'
    if (moved && changed)
      changeType = 'movedChanged'
    else if (moved)
      changeType = 'moved'
    details.push({
      key: `${keyPrefix}:${changeType}:${blockId}`,
      changeType,
      label: getBlockChangeTypeLabel(changeType),
      blockLabel: describeBlock(compareBlock || baseBlock),
      baseBlock: baseRenderBlock,
      compareBlock: compareRenderBlock,
      basePositionLabel: getBlockPositionLabel(basePosition),
      comparePositionLabel: getBlockPositionLabel(comparePosition),
      showPreview: changeType !== 'moved',
      sortPosition: comparePosition || basePosition || null,
    })
  }

  return details.sort((a, b) => {
    const aPos = a.sortPosition || {}
    const bPos = b.sortPosition || {}
    const aRow = Number.isFinite(aPos.rowIndex) ? aPos.rowIndex : Number.MAX_SAFE_INTEGER
    const bRow = Number.isFinite(bPos.rowIndex) ? bPos.rowIndex : Number.MAX_SAFE_INTEGER
    if (aRow !== bRow)
      return aRow - bRow
    const aCol = Number.isFinite(aPos.colIndex) ? aPos.colIndex : Number.MAX_SAFE_INTEGER
    const bCol = Number.isFinite(bPos.colIndex) ? bPos.colIndex : Number.MAX_SAFE_INTEGER
    if (aCol !== bCol)
      return aCol - bCol
    const aBlock = Number.isFinite(aPos.blockIndex) ? aPos.blockIndex : Number.MAX_SAFE_INTEGER
    const bBlock = Number.isFinite(bPos.blockIndex) ? bPos.blockIndex : Number.MAX_SAFE_INTEGER
    if (aBlock !== bBlock)
      return aBlock - bBlock
    return String(a.blockLabel || '').localeCompare(String(b.blockLabel || ''))
  })
}

const buildPostChangeDetails = (baseDoc, compareDoc, { baseLabel, compareLabel } = {}) => {
  const changes = []
  const base = baseDoc ? resolveSyncedPostDoc(normalizePostBuilderDoc(edgeGlobal.dupObject(baseDoc)).normalized) : null
  const compare = compareDoc ? resolveSyncedPostDoc(normalizePostBuilderDoc(edgeGlobal.dupObject(compareDoc)).normalized) : null

  if (!base && !compare)
    return changes

  const compareField = (key, label, formatter = v => summarizeChangeValue(v, false)) => {
    const baseVal = base?.[key]
    const compareVal = compare?.[key]
    if (areEqualNormalized(baseVal, compareVal))
      return
    changes.push({
      key,
      label,
      baseLabel,
      compareLabel,
      base: formatter(baseVal),
      compare: formatter(compareVal),
    })
  }

  if (!base && compare) {
    changes.push({
      key: 'compare-only',
      label: compareLabel || 'Current',
      baseLabel,
      compareLabel,
      base: `No ${String(baseLabel || 'base').toLowerCase()} available`,
      compare: `${compareLabel || 'Current'} available`,
    })
  }
  if (base && !compare) {
    changes.push({
      key: 'base-only',
      label: baseLabel || 'Selected',
      baseLabel,
      compareLabel,
      base: `${baseLabel || 'Selected'} available`,
      compare: `No ${String(compareLabel || 'current').toLowerCase()} available`,
    })
  }

  const compareBlockArea = (keyPrefix, label, contentKey, structureKey, layoutLabel) => {
    const baseBlocks = Array.isArray(base?.[contentKey]) ? base[contentKey] : []
    const compareBlocks = Array.isArray(compare?.[contentKey]) ? compare[contentKey] : []
    const baseStructure = Array.isArray(base?.[structureKey]) ? base[structureKey] : []
    const compareStructure = Array.isArray(compare?.[structureKey]) ? compare[structureKey] : []
    const blockChanges = buildBlockChangeDetails(baseBlocks, compareBlocks, baseStructure, compareStructure, keyPrefix)

    if (blockChanges.length) {
      changes.push({
        key: `${keyPrefix}-blocks`,
        label,
        baseLabel,
        compareLabel,
        base: summarizeBlocks(baseBlocks),
        compare: summarizeBlocks(compareBlocks),
        blockChanges,
      })
    }

    const baseLayout = stripStructureBlocks(baseStructure)
    const compareLayout = stripStructureBlocks(compareStructure)
    if (!areEqualNormalized(baseLayout, compareLayout)) {
      changes.push({
        key: `${keyPrefix}-layout`,
        label: layoutLabel,
        baseLabel,
        compareLabel,
        layoutChanges: buildLayoutChangeDetails(baseStructure, compareStructure),
      })
    }
  }

  compareBlockArea('post', 'Blocks', 'content', 'structure', 'Layout')
  compareField('title', 'Title')
  compareField('name', 'Slug')
  compareField('blurb', 'Blurb', val => summarizeChangeValue(val, true))
  compareField('tags', 'Tags', val => summarizeChangeValue(val, true))
  compareField('featuredImage', 'Featured Image', val => summarizeChangeValue(val, true))
  compareField('type', 'Post Type')
  compareField('publishAt', 'Publish At', val => summarizeChangeValue(val, true))
  compareField('publishAtTimezone', 'Publish Timezone')
  compareField('event', 'Event Settings', val => summarizeChangeValue(val, true))

  return changes
}

const historyDiffDetails = computed(() => {
  return buildPostChangeDetails(getHistorySnapshotDoc(selectedHistoryEntry.value), currentHistoryCompareDoc.value, {
    baseLabel: 'Selected History',
    compareLabel: 'Current',
  })
})

const historyDiffCountLabel = computed(() => {
  if (!selectedHistoryEntry.value)
    return 'Select an entry'
  const count = historyDiffDetails.value.length
  if (count === 0)
    return 'No differences'
  if (count === 1)
    return '1 difference'
  return `${count} differences`
})

const hasHistoryDiff = computed(() => historyDiffDetails.value.length > 0)

watch(selectedHistoryEntry, (entry) => {
  syncHistoryPreviewDoc(entry)
})

watch(hasHistoryDiff, (nextValue) => {
  if (!nextValue)
    state.showHistoryDiffDialog = false
})

const formatEventDateTime = (input) => {
  const value = String(input || '').trim()
  if (!value)
    return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return value
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const postKey = post => post?.docId || post?.id || ''
const tagPreview = (tags = [], limit = 3) => {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : []
  return {
    visible: list.slice(0, limit),
    remaining: Math.max(list.length - limit, 0),
  }
}
const postFeaturedImage = (post) => {
  if (post?.featuredImage)
    return post.featuredImage
  if (Array.isArray(post?.featuredImages) && post.featuredImages[0])
    return post.featuredImages[0]
  return ''
}

const previewContent = (content) => {
  if (typeof content !== 'string')
    return ''
  const normalized = content.trim()
  if (!normalized)
    return ''
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized
}

const notifiedLegacyMigrationIds = new Set()
const LEGACY_POST_HTML_FIELD = 'legacyHtml'
const LEGACY_POST_HTML_BLOCK_CONTENT = `<section class="cms-block cms-block-legacy-post-html">
  {{{#richtext {"field":"legacyHtml","title":"Content","value":""}}}}
</section>`

const createPostRow = () => ({
  id: edgeGlobal.generateShortId(),
  width: 'full',
  gap: '4',
  verticalAlign: 'start',
  background: 'transparent',
  mobileStack: 'normal',
  columns: [{
    id: edgeGlobal.generateShortId(),
    span: 12,
    mobileOrder: 0,
    blocks: [],
  }],
})

const createLegacyHtmlLocalBlock = (legacyContent) => {
  const normalizedLegacyContent = String(legacyContent || '')
  return {
    id: edgeGlobal.generateShortId(),
    content: LEGACY_POST_HTML_BLOCK_CONTENT,
    values: {
      [LEGACY_POST_HTML_FIELD]: normalizedLegacyContent,
    },
    meta: {
      [LEGACY_POST_HTML_FIELD]: {
        type: 'richtext',
        title: 'Content',
      },
    },
  }
}

function normalizePostBuilderDoc(doc = {}) {
  ensurePostTypeAndEventDefaults(doc)
  const normalized = edgeGlobal.dupObject(doc || {})
  ensurePostTypeAndEventDefaults(normalized)
  const previousComparable = {
    content: normalized.content,
    structure: normalized.structure,
  }

  let migratedFromLegacyHtml = false
  let normalizedContent = []

  if (Array.isArray(normalized.content)) {
    normalizedContent = normalized.content
      .filter(block => block && typeof block === 'object')
      .map((block) => {
        const nextBlock = edgeGlobal.dupObject(block)
        if (!nextBlock.id)
          nextBlock.id = edgeGlobal.generateShortId()
        if (typeof nextBlock.content !== 'string')
          nextBlock.content = String(nextBlock.content || '')
        if (!nextBlock.values || typeof nextBlock.values !== 'object' || Array.isArray(nextBlock.values))
          nextBlock.values = {}
        if (!nextBlock.meta || typeof nextBlock.meta !== 'object' || Array.isArray(nextBlock.meta))
          nextBlock.meta = {}
        return nextBlock
      })
  }
  else {
    const legacyContent = typeof normalized.content === 'string' ? normalized.content : ''
    if (legacyContent.trim().length > 0) {
      normalizedContent = [createLegacyHtmlLocalBlock(legacyContent)]
      migratedFromLegacyHtml = true
    }
  }

  const contentIds = new Set(normalizedContent.map(block => block.id))
  let normalizedStructure = Array.isArray(normalized.structure)
    ? edgeGlobal.dupObject(normalized.structure)
    : []

  normalizedStructure = normalizedStructure
    .filter(row => row && typeof row === 'object')
    .map((row) => {
      const sourceColumn = Array.isArray(row.columns) ? row.columns[0] : null
      const sourceBlocks = Array.isArray(sourceColumn?.blocks) ? sourceColumn.blocks : []
      return {
        ...row,
        id: row.id || edgeGlobal.generateShortId(),
        width: 'full',
        mobileStack: 'normal',
        columns: [{
          id: sourceColumn?.id || edgeGlobal.generateShortId(),
          span: 12,
          mobileOrder: 0,
          blocks: sourceBlocks.filter(blockId => contentIds.has(blockId)),
        }],
      }
    })

  if (!normalizedStructure.length && normalizedContent.length) {
    const firstRow = createPostRow()
    firstRow.columns[0].blocks = normalizedContent.map(block => block.id)
    normalizedStructure = [firstRow]
  }

  const referencedIds = new Set()
  normalizedStructure.forEach((row) => {
    row.columns[0].blocks.forEach(blockId => referencedIds.add(blockId))
  })
  const orphanIds = normalizedContent.map(block => block.id).filter(blockId => !referencedIds.has(blockId))
  if (orphanIds.length) {
    if (!normalizedStructure.length)
      normalizedStructure = [createPostRow()]
    normalizedStructure[normalizedStructure.length - 1].columns[0].blocks.push(...orphanIds)
  }

  normalized.content = normalizedContent
  normalized.structure = normalizedStructure

  const nextComparable = {
    content: normalized.content,
    structure: normalized.structure,
  }

  return {
    normalized,
    changed: stableSerialize(previousComparable) !== stableSerialize(nextComparable),
    migratedFromLegacyHtml,
  }
}

const ensurePostBuilderDefaults = (workingDoc) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return
  const { normalized, changed } = normalizePostBuilderDoc(workingDoc)
  if (changed || !Array.isArray(workingDoc.content) || !Array.isArray(workingDoc.structure)) {
    workingDoc.content = normalized.content
    workingDoc.structure = normalized.structure
  }
}

const createNewPostDocSchema = (postDoc = {}) => {
  const normalizedTemplateDoc = normalizePostBuilderDoc({
    content: Array.isArray(postDoc?.content) ? edgeGlobal.dupObject(postDoc.content) : [],
    structure: Array.isArray(postDoc?.structure) ? edgeGlobal.dupObject(postDoc.structure) : [],
    type: normalizePostType(postDoc?.type),
    event: normalizeEventData(postDoc?.event),
  }).normalized

  return {
    name: {
      value: String(postDoc?.name || '').trim(),
      cols: '12',
      bindings: {
        'field-type': 'text',
        'label': 'Name',
      },
    },
    title: {
      value: String(postDoc?.title || '').trim(),
      cols: '12',
      bindings: {
        'field-type': 'text',
        'label': 'Title',
      },
    },
    tags: {
      value: Array.isArray(postDoc?.tags) ? edgeGlobal.dupObject(postDoc.tags) : [],
      cols: '12',
      bindings: {
        'field-type': 'tags',
        'value-as': 'array',
        'label': 'Tags',
        'placeholder': 'Add a tag',
      },
    },
    blurb: {
      value: String(postDoc?.blurb || '').trim(),
      cols: '12',
      bindings: {
        'field-type': 'textarea',
        'label': 'Content Blurb / Preview',
        'rows': '8',
      },
    },
    content: {
      value: normalizedTemplateDoc.content,
    },
    structure: {
      value: normalizedTemplateDoc.structure,
    },
    featuredImage: {
      value: String(postDoc?.featuredImage || '').trim(),
      cols: '12',
      bindings: {
        'field-type': 'tags',
        'value-as': 'array',
        'label': 'Featured Images',
        'description': 'Enter image URLs or storage paths',
      },
    },
    publishAt: {
      value: String(postDoc?.publishAt || '').trim(),
    },
    publishAtTimezone: {
      value: String(postDoc?.publishAtTimezone || '').trim(),
    },
    type: {
      value: normalizePostType(postDoc?.type),
    },
    event: {
      value: normalizeEventData(postDoc?.event),
    },
  }
}

const buildNewPostDocFromTemplate = (templateDoc) => {
  if (!templateDoc || templateDoc.docId === blankPostTemplateTile.docId)
    return {}

  const templateContent = Array.isArray(templateDoc?.content) ? edgeGlobal.dupObject(templateDoc.content) : []
  const templateStructure = Array.isArray(templateDoc?.structure) ? edgeGlobal.dupObject(templateDoc.structure) : []
  return {
    content: templateContent,
    structure: templateStructure,
    type: 'post',
    event: normalizeEventData(),
  }
}

const queuePendingNewPostTemplate = (templateDoc) => {
  pendingNewPostTemplateState.value[postTemplateStateKey.value] = edgeGlobal.dupObject(buildNewPostDocFromTemplate(templateDoc))
}

const consumePendingNewPostTemplate = () => {
  const queued = pendingNewPostTemplateState.value?.[postTemplateStateKey.value]
  if (pendingNewPostTemplateState.value && Object.prototype.hasOwnProperty.call(pendingNewPostTemplateState.value, postTemplateStateKey.value))
    delete pendingNewPostTemplateState.value[postTemplateStateKey.value]
  return queued ? edgeGlobal.dupObject(queued) : null
}

const applyNewPostTemplate = (templateDoc = null) => {
  state.newDocs.posts = createNewPostDocSchema(buildNewPostDocFromTemplate(templateDoc))
}

const preparePendingNewPostTemplate = () => {
  const queuedTemplate = consumePendingNewPostTemplate()
  state.newDocs.posts = createNewPostDocSchema(queuedTemplate || {})
}

const resetNewPostDialog = () => {
  state.postTemplateFilter = 'quick-picks'
  state.selectedPostTemplateId = blankPostTemplateTile.docId
}

const openNewPostDialog = () => {
  resetNewPostDialog()
  state.newPostDialogOpen = true
}

const closeNewPostDialog = () => {
  state.newPostDialogOpen = false
  resetNewPostDialog()
}

const templateHasPreview = template => Array.isArray(template?.content) && template.content.length > 0

const postTemplatePreviewRows = (template) => {
  const structureRows = Array.isArray(template?.structure) ? template.structure : []
  if (structureRows.length)
    return structureRows

  const legacyBlocks = Array.isArray(template?.content) ? template.content.filter(Boolean) : []
  if (!legacyBlocks.length)
    return []

  return [{
    id: `${template?.docId || 'template'}-legacy-row`,
    columns: [{
      id: `${template?.docId || 'template'}-legacy-col`,
      span: 12,
      blocks: legacyBlocks.map(block => block.id).filter(Boolean),
    }],
  }]
}

const resolveTemplateBlockForPreview = (template, blockRef) => {
  const lookupId = typeof blockRef === 'string' ? blockRef : (blockRef?.id || blockRef?.blockId || '')
  if (!lookupId)
    return null
  const templateBlocks = Array.isArray(template?.content) ? template.content : []
  return templateBlocks.find(block => block?.id === lookupId || block?.blockId === lookupId) || null
}

const previewGridClass = () => 'grid grid-cols-1 gap-4'
const previewColumnStyle = () => ({})

const loadPostTemplatePreviewContext = async () => {
  const siteId = String(props.site || '').trim()
  if (!siteId) {
    postTemplatePreviewContext.value = null
    return
  }

  const cacheKey = `${edgeGlobal.edgeState.currentOrganization}:${siteId}`
  const cached = postTemplatePreviewContextCache.value?.[cacheKey]
  if (cached && typeof cached === 'object') {
    postTemplatePreviewContext.value = edgeGlobal.dupObject(cached)
    return
  }

  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    await staticSearch.getData(`${edgeGlobal.edgeState.organizationDocPath}/sites/${siteId}/published_posts`, [], [], 1)
    const firstPost = Object.values(staticSearch.results?.data || {})[0] || null
    if (firstPost && typeof firstPost === 'object') {
      postTemplatePreviewContextCache.value[cacheKey] = edgeGlobal.dupObject(firstPost)
      postTemplatePreviewContext.value = edgeGlobal.dupObject(firstPost)
      return
    }
  }
  catch (error) {
    console.error('Failed to load post template preview context', error)
  }

  postTemplatePreviewContext.value = null
}

const postBlockIndex = (workingDoc, blockId) => {
  return Array.isArray(workingDoc?.content)
    ? workingDoc.content.findIndex(block => block?.id === blockId)
    : -1
}

const addPostRow = (workingDoc, insertIndex = null) => {
  ensurePostBuilderDefaults(workingDoc)
  if (!Array.isArray(workingDoc.structure))
    workingDoc.structure = []
  const row = createPostRow()
  if (Number.isInteger(insertIndex) && insertIndex >= 0 && insertIndex <= workingDoc.structure.length)
    workingDoc.structure.splice(insertIndex, 0, row)
  else
    workingDoc.structure.push(row)
}

const movePostRow = (workingDoc, rowIndex, direction) => {
  ensurePostBuilderDefaults(workingDoc)
  const rows = Array.isArray(workingDoc?.structure) ? workingDoc.structure : []
  const targetIndex = rowIndex + direction
  if (targetIndex < 0 || targetIndex >= rows.length)
    return
  const [row] = rows.splice(rowIndex, 1)
  rows.splice(targetIndex, 0, row)
}

const cleanupOrphanPostBlocks = (workingDoc) => {
  ensurePostBuilderDefaults(workingDoc)
  const used = new Set()
  for (const row of workingDoc.structure || []) {
    for (const blockId of row?.columns?.[0]?.blocks || [])
      used.add(blockId)
  }
  workingDoc.content = (workingDoc.content || []).filter(block => used.has(block.id))
}

const removePostRow = (workingDoc, rowIndex) => {
  ensurePostBuilderDefaults(workingDoc)
  if (!Array.isArray(workingDoc?.structure))
    return
  workingDoc.structure.splice(rowIndex, 1)
  cleanupOrphanPostBlocks(workingDoc)
}

const addPostBlockToRow = (workingDoc, rowIndex, insertIndex, block) => {
  ensurePostBuilderDefaults(workingDoc)
  const row = workingDoc?.structure?.[rowIndex]
  const col = row?.columns?.[0]
  if (!col)
    return
  const preparedBlock = edgeGlobal.dupObject(block || {})
  preparedBlock.id = edgeGlobal.generateShortId()
  if (!preparedBlock.values || typeof preparedBlock.values !== 'object' || Array.isArray(preparedBlock.values))
    preparedBlock.values = {}
  if (!preparedBlock.meta || typeof preparedBlock.meta !== 'object' || Array.isArray(preparedBlock.meta))
    preparedBlock.meta = {}
  if (typeof preparedBlock.content !== 'string')
    preparedBlock.content = String(preparedBlock.content || '')

  workingDoc.content.push(preparedBlock)
  col.blocks.splice(insertIndex, 0, preparedBlock.id)
}

const removePostBlockFromStructure = (workingDoc, blockId) => {
  for (const row of workingDoc?.structure || []) {
    if (row?.columns?.[0]?.blocks)
      row.columns[0].blocks = row.columns[0].blocks.filter(id => id !== blockId)
  }
}

const deletePostBlock = (workingDoc, blockId) => {
  ensurePostBuilderDefaults(workingDoc)
  if (Array.isArray(workingDoc.content)) {
    const index = workingDoc.content.findIndex(block => block?.id === blockId)
    if (index !== -1)
      workingDoc.content.splice(index, 1)
  }
  removePostBlockFromStructure(workingDoc, blockId)
}

const resetEditorTracking = () => {
  state.editMode = false
  state.editorDoc = null
  state.slugManuallyEdited = false
  state.internalSlugUpdate = false
  state.lastAutoSlug = ''
}

const openNewPost = () => {
  openNewPostDialog()
}

const startNewPostFromTemplate = () => {
  const templateDoc = selectedPostTemplate.value
  if (props.mode === 'list') {
    queuePendingNewPostTemplate(templateDoc)
    emit('update:selectedPostId', 'new')
    closeNewPostDialog()
    return
  }

  applyNewPostTemplate(templateDoc)
  state.activePostId = 'new'
  resetEditorTracking()
  state.sheetOpen = true
  closeNewPostDialog()
}

const editPost = (postId) => {
  if (props.mode === 'list') {
    emit('update:selectedPostId', postId)
    return
  }
  state.editMode = false
  state.activePostId = postId
  state.slugManuallyEdited = true
  state.internalSlugUpdate = false
  state.lastAutoSlug = getPostSlug(posts.value?.[postId]) || ''
  state.sheetOpen = true
}

const closeSheet = () => {
  state.sheetOpen = false
  state.activePostId = ''
  state.newDocs.posts = createNewPostDocSchema()
  resetEditorTracking()
  state.editorHasUnsavedChanges = false
  state.historyDialogOpen = false
  state.historyError = ''
  state.historyItems = []
  state.historySelectedId = ''
  state.historyPreviewDoc = null
  state.showHistoryDiffDialog = false
  if (props.mode === 'editor')
    emit('update:selectedPostId', '')
}

const handlePostSaved = () => {
  console.log('Post saved')
}

const handleEditorUnsavedChanges = (changes) => {
  state.editorHasUnsavedChanges = changes === true
}

const onWorkingDocUpdate = (doc) => {
  if (doc && typeof doc === 'object') {
    syncEventUtcFields(doc)
    const savedDocId = String(doc.docId || '').trim()
    if (savedDocId && state.activePostId === 'new')
      state.activePostId = savedDocId
    const { normalized, changed, migratedFromLegacyHtml } = normalizePostBuilderDoc(doc)
    if (changed) {
      doc.content = normalized.content
      doc.structure = normalized.structure
    }
    const blockIds = [...new Set((doc.content || []).map(block => block?.blockId).filter(id => id))]
    const currentBlockIds = Array.isArray(doc.blockIds) ? doc.blockIds : []
    const blockIdsChanged = blockIds.length !== currentBlockIds.length
      || blockIds.some((id, index) => id !== currentBlockIds[index])
    if (blockIdsChanged)
      doc.blockIds = blockIds
    if (migratedFromLegacyHtml) {
      const migrationId = String(state.activePostId || 'new')
      if (!notifiedLegacyMigrationIds.has(migrationId)) {
        notifiedLegacyMigrationIds.add(migrationId)
        edgeFirebase?.toast?.success?.('Legacy post HTML migrated to a local rich text block.')
      }
    }
  }

  state.editorDoc = doc
  if (!state.slugManuallyEdited && doc?.name)
    state.lastAutoSlug = doc.name
}

watch(
  () => props.selectedPostId,
  (next) => {
    if (props.mode !== 'editor')
      return
    if (!next) {
      closeSheet()
      return
    }
    if (next === 'new') {
      preparePendingNewPostTemplate()
      state.activePostId = 'new'
      resetEditorTracking()
      state.sheetOpen = true
      return
    }
    state.activePostId = next
    state.editMode = false
    state.slugManuallyEdited = true
    state.internalSlugUpdate = false
    state.lastAutoSlug = getPostSlug(posts.value?.[next]) || ''
    state.sheetOpen = true
  },
  { immediate: true },
)

watch(
  [() => edgeGlobal.edgeState.currentOrganization, () => props.site],
  async () => {
    await loadPostTemplatePreviewContext()
  },
  { immediate: true },
)

watch(filteredPostTemplateCardItems, (templates) => {
  if (!templates.some(template => template.docId === state.selectedPostTemplateId))
    state.selectedPostTemplateId = blankPostTemplateTile.docId
})

const openRenameDialog = (post) => {
  const slug = getPostSlug(post)
  const fallback = slug || ensureUniqueSlug(post?.title || post?.name || 'post', post?.id)
  state.renamePost = {
    id: post.id,
    title: post.title || '',
    currentSlug: slug,
  }
  state.renameSubmitting = false
  state.renameInternalUpdate = true
  state.renameValue = fallback
  state.renameInternalUpdate = false
  state.renameDialog = true
}

const closeRenameDialog = () => {
  state.renameDialog = false
  state.renamePost = null
  state.renameValue = ''
  state.renameSubmitting = false
}

const renamePostAction = async () => {
  if (!state.renamePost?.id)
    return closeRenameDialog()

  state.renameSubmitting = true

  let desired = slugify(state.renameValue || state.renamePost.currentSlug || state.renamePost.title || 'post')
  if (!desired)
    desired = 'post'

  const unique = ensureUniqueSlug(desired, state.renamePost.id)

  if (unique === state.renamePost.currentSlug) {
    state.renameSubmitting = false
    closeRenameDialog()
    return
  }

  try {
    await edgeFirebase.changeDoc(collectionKey.value, state.renamePost.id, { name: unique })
    state.renameValue = unique
    closeRenameDialog()
  }
  catch (error) {
    console.error('Failed to rename post:', error)
    state.renameSubmitting = false
  }
}

const showDeleteDialog = (post) => {
  state.postToDelete = {
    id: post.id,
    name: post.title || getPostSlug(post) || 'Untitled Post',
  }
  state.deleteDialog = true
}

const deletePost = async () => {
  const target = state.postToDelete
  if (!target?.id) {
    state.deleteDialog = false
    return
  }

  const postId = target.id
  try {
    await edgeFirebase.removeDoc(collectionKey.value, postId)
    await edgeFirebase.removeDoc(publishedCollectionKey.value, postId)
    if (state.activePostId === postId)
      closeSheet()
  }
  catch (error) {
    console.error('Failed to delete post:', error)
  }
  finally {
    state.deleteDialog = false
    state.postToDelete = null
  }
}

const addTag = async (tag) => {
  console.log('Tag to add:', tag)
}

const getTagsFromPosts = computed(() => {
  const tagMap = new Map()
  postsList.value.forEach((post) => {
    if (Array.isArray(post.tags)) {
      post.tags.forEach((tag) => {
        if (tag && typeof tag === 'string' && !tagMap.has(tag)) {
          tagMap.set(tag, { name: tag, title: tag })
        }
      })
    }
  })
  return Array.from(tagMap.values()).sort((a, b) => a.title.localeCompare(b.title))
})

const publishPost = async (postId) => {
  if (!postId)
    return
  const post = posts.value?.[postId]
  if (!post)
    return
  const publishBlockedReason = getPublishBlockedReason(postId, post)
  if (publishBlockedReason) {
    edgeFirebase?.toast?.error?.(publishBlockedReason)
    return
  }
  emit('updating', true)
  try {
    const publishedAtIso = new Date().toISOString()
    const publishedAtMillis = Date.parse(publishedAtIso)
    const publishedPost = edgeGlobal.dupObject(post || {})
    delete publishedPost.publishAt
    publishedPost.doc_created_at = Number.isFinite(publishedAtMillis) ? publishedAtMillis : Date.now()
    publishedPost.publishedAt = publishedAtIso
    await edgeFirebase.storeDoc(publishedCollectionKey.value, publishedPost)
    const draftPublishUpdate = {
      doc_created_at: Number.isFinite(publishedAtMillis) ? publishedAtMillis : Date.now(),
      publishedAt: publishedAtIso,
    }
    if (typeof post?.publishAt === 'string' && post.publishAt.trim()) {
      draftPublishUpdate.publishAt = ''
      draftPublishUpdate.publishAtTimezone = ''
      state.publishAtInput = ''
    }
    await edgeFirebase.changeDoc(collectionKey.value, postId, draftPublishUpdate)
  }
  catch (error) {
    console.error('Failed to publish post:', error)
  }
  finally {
    emit('updating', false)
  }
}

const publishPostAt = async (postId, publishedAtIso) => {
  if (!postId)
    return

  const post = posts.value?.[postId]
  if (!post)
    return

  const publishBlockedReason = getPublishBlockedReason(postId, post)
  if (publishBlockedReason) {
    edgeFirebase?.toast?.error?.(publishBlockedReason)
    return
  }

  const publishedAtMillis = Date.parse(publishedAtIso)
  if (!Number.isFinite(publishedAtMillis)) {
    edgeFirebase?.toast?.error?.('Publish At must be a valid date/time.')
    return
  }

  emit('updating', true)
  try {
    const publishedPost = edgeGlobal.dupObject(post || {})
    delete publishedPost.publishAt
    publishedPost.doc_created_at = publishedAtMillis
    publishedPost.publishedAt = publishedAtIso
    await edgeFirebase.storeDoc(publishedCollectionKey.value, publishedPost)
    await edgeFirebase.changeDoc(collectionKey.value, postId, {
      doc_created_at: publishedAtMillis,
      publishedAt: publishedAtIso,
      publishAt: '',
      publishAtTimezone: '',
      publishAtError: '',
    })
    state.publishAtInput = ''
  }
  catch (error) {
    console.error('Failed to publish post:', error)
  }
  finally {
    emit('updating', false)
  }
}

const schedulePostPublish = async (postId) => {
  if (!postId)
    return
  const post = posts.value?.[postId]
  if (!post)
    return

  const publishAtIso = parseDateTimeLocalToUtcIso(state.publishAtInput)
  if (!publishAtIso) {
    edgeFirebase?.toast?.error?.('Select a valid Publish At date/time.')
    return
  }
  const publishAtMs = Date.parse(publishAtIso)
  if (!Number.isFinite(publishAtMs)) {
    edgeFirebase?.toast?.error?.('Publish At must be a valid date/time.')
    return
  }
  if (scheduledPublishBlockedReason.value) {
    edgeFirebase?.toast?.error?.(scheduledPublishBlockedReason.value)
    return
  }

  if (publishAtMs <= Date.now()) {
    await publishPostAt(postId, publishAtIso)
    return
  }

  emit('updating', true)
  try {
    await edgeFirebase.changeDoc(collectionKey.value, postId, {
      publishAt: publishAtIso,
      publishAtTimezone: CURRENT_USER_TIMEZONE,
    })
    edgeFirebase?.toast?.success?.(`Scheduled publish for ${new Date(publishAtIso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`)
  }
  catch (error) {
    console.error('Failed to schedule post publish:', error)
    edgeFirebase?.toast?.error?.('Failed to schedule publish.')
  }
  finally {
    emit('updating', false)
  }
}

const clearScheduledPublish = async (postId) => {
  if (!postId)
    return
  emit('updating', true)
  try {
    await edgeFirebase.changeDoc(collectionKey.value, postId, {
      publishAt: '',
      publishAtTimezone: '',
      publishAtError: '',
    })
    state.publishAtInput = nowDateTimeLocalInput()
    edgeFirebase?.toast?.success?.('Scheduled publish cleared.')
  }
  catch (error) {
    console.error('Failed to clear scheduled publish:', error)
    edgeFirebase?.toast?.error?.('Failed to clear scheduled publish.')
  }
  finally {
    emit('updating', false)
  }
}

const unPublishPost = async (postId) => {
  if (!postId)
    return
  try {
    await edgeFirebase.removeDoc(publishedCollectionKey.value, postId)
  }

  catch (error) {
    console.error('Failed to unpublish post:', error)
  }
}

const reindexPublishedPostsToKv = async () => {
  if (state.reindexPublishedPostsLoading || !edgeFirebase?.user?.uid)
    return

  state.reindexPublishedPostsLoading = true
  try {
    const response = await edgeFirebase.runFunction('cms-reindexPublishedPostsToKv', {
      uid: edgeFirebase.user.uid,
    })
    const scanned = Number(response?.data?.scanned || 0)
    const rewritten = Number(response?.data?.rewritten || 0)
    edgeFirebase?.toast?.success?.(`Reindexed ${rewritten} published posts to KV${scanned ? ` (${scanned} scanned)` : ''}.`)
  }
  catch (error) {
    console.error('Failed to reindex published posts to KV:', error)
    edgeFirebase?.toast?.error?.('Failed to reindex published posts to KV.')
  }
  finally {
    state.reindexPublishedPostsLoading = false
  }
}
</script>

<template>
  <div
    v-if="props.mode !== 'editor'"
    :class="isFullList ? 'h-full min-h-0 flex flex-col gap-4 overflow-hidden' : 'space-y-4 h-full min-h-0 overflow-y-auto'"
  >
    <edge-shad-button
      variant="outline"
      :class="isFullList ? 'h-8 px-3' : 'w-full mt-2 py-0 h-[28px]'"
      @click="openNewPost"
    >
      <Plus class="h-4 w-4" />
      New Post
    </edge-shad-button>

    <edge-shad-button
      v-if="showDevOnlyActions"
      variant="outline"
      :class="isFullList ? 'h-8 px-3' : 'w-full py-0 h-[28px]'"
      :disabled="state.reindexPublishedPostsLoading"
      @click="reindexPublishedPostsToKv"
    >
      <Loader2 v-if="state.reindexPublishedPostsLoading" class="h-4 w-4 animate-spin" />
      <FileWarning v-else class="h-4 w-4" />
      Reindex Published Posts KV
    </edge-shad-button>

    <div
      v-if="isFullList"
      class="rounded-lg border border-slate-300 bg-white/90 overflow-hidden flex flex-col h-[calc(100vh-220px)] dark:border-slate-700 dark:bg-slate-900/70"
    >
      <div class="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Posts
        </div>
        <div class="text-xs text-slate-600 dark:text-slate-300">
          {{ filteredPostsList.length }} shown / {{ postsList.length }} total
        </div>
      </div>
      <div class="grid grid-cols-1 gap-2 border-b border-slate-300 bg-slate-50 px-4 py-3 sm:grid-cols-[1fr_160px] dark:border-slate-700 dark:bg-slate-900/60">
        <edge-shad-input
          v-model="state.listSearch"
          name="post-list-search"
          label="Search"
          placeholder="Search title, slug, blurb, tags"
        />
        <edge-shad-select
          v-model="state.listTypeFilter"
          :items="POST_LIST_TYPE_FILTER_OPTIONS"
          item-title="label"
          item-value="value"
          name="post-list-type-filter"
          label="Type"
        />
      </div>
      <div
        v-if="hasFilteredPosts"
        class="divide-y overflow-y-auto h-[calc(100vh-260px)] max-h-[calc(100vh-260px)]"
      >
        <div
          v-for="post in filteredPostsList"
          :key="post.id"
          class="px-4 py-3 hover:bg-muted/40 cursor-pointer"
          @click="editPost(post.id)"
        >
          <div class="flex items-start gap-4">
            <div class="h-16 w-20 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
              <img
                v-if="postFeaturedImage(post)"
                :src="postFeaturedImage(post)"
                alt=""
                class="h-full w-full object-cover"
              >
              <Image v-else class="h-6 w-6 text-muted-foreground/60" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-sm font-medium text-foreground truncate">
                    {{ post.title || post.name || 'Untitled Post' }}
                  </div>
                  <div class="text-xs text-muted-foreground line-clamp-2">
                    {{ previewContent(post.blurb || post.content) || 'No content yet.' }}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <edge-shad-button variant="ghost" size="icon" class="h-8 w-8" @click.stop>
                      <MoreHorizontal class="h-4 w-4" />
                    </edge-shad-button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem @click="openRenameDialog(post)">
                      <FilePen class="h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="getPublishStatus(postKey(post), post).canPublish || getPublishStatus(postKey(post), post).publishBlockedReason"
                      :disabled="Boolean(getPublishStatus(postKey(post), post).publishBlockedReason)"
                      @click="publishPost(postKey(post))"
                    >
                      <FileCheck class="h-4 w-4" />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="post.publishAt" @click="clearScheduledPublish(postKey(post))">
                      <X class="h-4 w-4" />
                      Cancel Schedule
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="getPublishStatus(postKey(post), post).publishBlockedReason"
                      disabled
                      class="text-xs text-amber-700 dark:text-amber-300"
                    >
                      <FileWarning class="h-4 w-4" />
                      {{ getPublishStatus(postKey(post), post).publishBlockedReason }}
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="getPublishStatus(postKey(post), post).canUnpublish" @click="unPublishPost(postKey(post))">
                      <FileWarning class="h-4 w-4" />
                      Unpublish
                    </DropdownMenuItem>
                    <DropdownMenuItem class="text-destructive" @click="showDeleteDialog(post)">
                      <Trash2 class="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]"
                  :class="normalizePostType(post.type) === 'event'
                    ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                >
                  {{ normalizePostType(post.type) === 'event' ? 'Event' : 'Post' }}
                </span>
                <div class="flex items-center gap-1">
                  <FileWarning v-if="getPublishStatus(postKey(post), post).icon === 'changes'" class="h-3.5 w-3.5 text-yellow-600" />
                  <FileCheck v-else-if="getPublishStatus(postKey(post), post).icon === 'published'" class="h-3.5 w-3.5 text-green-700" />
                  <FileX v-else class="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
                  <span :class="getPublishStatus(postKey(post), post).badgeClass">{{ getPublishStatus(postKey(post), post).label }}</span>
                </div>
                <span>{{ formatTimestamp(post.publishedAt || post.last_updated || post.doc_created_at) }}</span>
                <span v-if="normalizePostType(post.type) === 'event'" class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {{ formatEventDateTime(post?.event?.startAt) }} - {{ formatEventDateTime(post?.event?.endAt) }}
                </span>
                <span v-if="post.publishAt" class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Clock3 class="h-3 w-3" />
                  Scheduled {{ formatTimestamp(post.publishAt) }}
                </span>
                <div v-if="Array.isArray(post.tags) && post.tags.length" class="flex flex-wrap items-center gap-1">
                  <span
                    v-for="tag in tagPreview(post.tags).visible"
                    :key="tag"
                    class="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-if="tagPreview(post.tags).remaining"
                    class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    +{{ tagPreview(post.tags).remaining }}
                  </span>
                </div>
                <span v-if="Array.isArray(post.featuredImages) && post.featuredImages.length">
                  {{ post.featuredImages.length }} featured image{{ post.featuredImages.length > 1 ? 's' : '' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      >
        <File class="h-8 w-8 text-muted-foreground/60" />
        <div class="space-y-1">
          <h3 class="text-base font-medium">
            {{ hasPosts ? 'No posts match filters' : 'No posts yet' }}
          </h3>
          <p class="text-sm text-muted-foreground">
            {{ hasPosts ? 'Adjust search or type filter to see more posts.' : 'Create your first post to start publishing content.' }}
          </p>
        </div>
        <edge-shad-button variant="outline" class="gap-2" @click="openNewPost">
          <Plus class="h-4 w-4" />
          New Post
        </edge-shad-button>
      </div>
    </div>

    <div v-else>
      <div v-if="hasFilteredPosts" class="space-y-2 hidden">
        <SidebarMenuItem v-for="post in filteredPostsList" :key="post.id">
          <SidebarMenuButton class="!px-0 hover:!bg-transparent" @click="editPost(post.id)">
            <div class="h-8 w-8 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
              <img
                v-if="postFeaturedImage(post)"
                :src="postFeaturedImage(post)"
                alt=""
                class="h-full w-full object-cover"
              >
              <Image v-else class="h-4 w-4 text-muted-foreground/60" />
            </div>
            <FileWarning v-if="getPublishStatus(postKey(post), post).icon === 'changes'" class="!text-yellow-600 ml-2" />
            <FileCheck v-else-if="getPublishStatus(postKey(post), post).icon === 'published'" class="text-xs !text-green-700 font-normal ml-2" />
            <FileX v-else class="text-xs text-slate-500 ml-2 dark:text-slate-300" />
            <div class="ml-2 flex flex-col text-left">
              <span class="text-sm font-medium">{{ post.name || 'Untitled Post' }}</span>
            </div>
          </SidebarMenuButton>
          <SidebarGroupAction class="absolute right-2 top-0 hover:!bg-transparent">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuAction>
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem @click="openRenameDialog(post)">
                  <FilePen class="h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="getPublishStatus(postKey(post), post).canPublish || getPublishStatus(postKey(post), post).publishBlockedReason"
                  :disabled="Boolean(getPublishStatus(postKey(post), post).publishBlockedReason)"
                  @click="publishPost(postKey(post))"
                >
                  <FileCheck class="h-4 w-4" />
                  Publish
                </DropdownMenuItem>
                <DropdownMenuItem v-if="post.publishAt" @click="clearScheduledPublish(postKey(post))">
                  <X class="h-4 w-4" />
                  Cancel Schedule
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="getPublishStatus(postKey(post), post).publishBlockedReason"
                  disabled
                  class="text-xs text-amber-700 dark:text-amber-300"
                >
                  <FileWarning class="h-4 w-4" />
                  {{ getPublishStatus(postKey(post), post).publishBlockedReason }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="getPublishStatus(postKey(post), post).canUnpublish" @click="unPublishPost(postKey(post))">
                  <FileWarning class="h-4 w-4" />
                  Unpublish
                </DropdownMenuItem>

                <DropdownMenuItem class="text-destructive" @click="showDeleteDialog(post)">
                  <Trash2 class="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupAction>
          <div class="w-full pl-7 pb-2 text-xs text-muted-foreground cursor-pointer" @click="editPost(post.id)">
            <div
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]"
              :class="normalizePostType(post.type) === 'event'
                ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'"
            >
              {{ normalizePostType(post.type) === 'event' ? 'Event' : 'Post' }}
            </div>
            <div>{{ formatTimestamp(post.publishedAt || post.last_updated || post.doc_created_at) }}</div>
            <div v-if="normalizePostType(post.type) === 'event'" class="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {{ formatEventDateTime(post?.event?.startAt) }} - {{ formatEventDateTime(post?.event?.endAt) }}
            </div>
            <div v-if="post.publishAt" class="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Clock3 class="h-3 w-3" />
              Scheduled {{ formatTimestamp(post.publishAt) }}
            </div>
            <div v-if="Array.isArray(post.tags) && post.tags.length" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="tag in tagPreview(post.tags).visible"
                :key="tag"
                class="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {{ tag }}
              </span>
              <span
                v-if="tagPreview(post.tags).remaining"
                class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                +{{ tagPreview(post.tags).remaining }}
              </span>
            </div>
            <div v-if="Array.isArray(post.featuredImages) && post.featuredImages.length" class="mt-1 text-[11px]">
              {{ post.featuredImages.length }} featured image{{ post.featuredImages.length > 1 ? 's' : '' }}
            </div>
          </div>
          <Separator class="my-2" />
        </SidebarMenuItem>
      </div>

      <div
        v-else
        class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 px-6 py-10 text-center"
      >
        <File class="h-8 w-8 text-muted-foreground/60" />
        <div class="space-y-1">
          <h3 class="text-base font-medium">
            {{ hasPosts ? 'No posts match filters' : 'No posts yet' }}
          </h3>
          <p class="text-sm text-muted-foreground">
            {{ hasPosts ? 'Adjust search or type filter to see more posts.' : 'Create your first post to start publishing content.' }}
          </p>
        </div>
        <edge-shad-button variant="outline" class="gap-2" @click="openNewPost">
          <Plus class="h-4 w-4" />
          New Post
        </edge-shad-button>
      </div>
    </div>
  </div>

  <edge-shad-dialog v-model="state.deleteDialog">
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle class="text-left">
          Delete "{{ state.postToDelete?.name || 'this post' }}"?
        </DialogTitle>
        <DialogDescription>
          This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="flex justify-between pt-2">
        <edge-shad-button variant="outline" @click="state.deleteDialog = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button variant="destructive" class="w-full" @click="deletePost">
          Delete
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.renameDialog">
    <DialogContent class="pt-10">
      <edge-shad-form :schema="renameSchema" @submit="renamePostAction">
        <DialogHeader>
          <DialogTitle class="text-left">
            Rename "{{ state.renamePost?.title || state.renamePost?.currentSlug || 'Post' }}"
          </DialogTitle>
          <DialogDescription>
            Update the slug used in URLs. Existing links will change after renaming.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input v-model="state.renameValue" name="name" label="Name" />
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeRenameDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            type="submit"
            class="w-full bg-slate-800 text-white hover:bg-slate-400"
            :disabled="state.renameSubmitting"
          >
            <Loader2 v-if="state.renameSubmitting" class="h-4 w-4 animate-spin" />
            <span v-else>Rename</span>
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.newPostDialogOpen">
    <DialogContent class="pt-6 w-full max-w-6xl h-[90vh] flex flex-col">
      <DialogHeader class="pb-2">
        <DialogTitle class="text-left">
          Create New Post
        </DialogTitle>
        <DialogDescription>
          Choose a post template or start from a blank post. Only post templates are shown here.
        </DialogDescription>
      </DialogHeader>
      <div class="w-full space-y-4">
        <edge-shad-select
          v-model="state.postTemplateFilter"
          label="Template Tags"
          :items="postTemplateFilterOptions"
          item-title="label"
          item-value="value"
          placeholder="Select tag"
        />
        <p class="text-xs text-muted-foreground">
          Filter templates by tag or choose Quick Picks for the most commonly used layouts.
        </p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pr-1">
        <div class="grid grid-cols-1 gap-3 auto-rows-fr pb-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            v-for="template in filteredPostTemplateCardItems"
            :key="template.docId"
            type="button"
            class="rounded-lg border bg-card p-3 text-left transition focus:outline-none focus-visible:ring-2 flex flex-col gap-3"
            :class="isPostTemplateSelected(template.docId) ? 'border-primary ring-2 ring-primary/50 shadow-lg' : 'border-border hover:border-primary/40'"
            :aria-pressed="isPostTemplateSelected(template.docId)"
            @click="state.selectedPostTemplateId = template.docId"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-semibold">{{ template.name }}</span>
              <File class="h-4 w-4 text-muted-foreground" />
            </div>
            <div class="template-scale-wrapper rounded-md border border-dashed border-border/60 bg-background/80">
              <div class="template-scale-inner">
                <div class="template-scale-content space-y-4">
                  <template v-if="template.docId === blankPostTemplateTile.docId">
                    <div class="mt-[100px] flex h-32 items-center justify-center text-[100px] text-muted-foreground">
                      Blank post
                    </div>
                  </template>
                  <template v-else-if="templateHasPreview(template)">
                    <div
                      v-for="(row, rowIndex) in postTemplatePreviewRows(template)"
                      :key="`${template.docId}-row-${row.id || rowIndex}`"
                      class="w-full"
                    >
                      <div :class="previewGridClass(row)">
                        <div
                          v-for="(column, colIndex) in row.columns"
                          :key="`${template.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}`"
                          class="min-w-0"
                          :style="previewColumnStyle(column)"
                        >
                          <div
                            v-for="(blockRef, blockIdx) in column.blocks || []"
                            :key="`${template.docId}-row-${row.id || rowIndex}-col-${column.id || colIndex}-block-${blockIdx}`"
                          >
                            <edge-cms-block-api
                              v-if="resolveTemplateBlockForPreview(template, blockRef)"
                              :content="resolveTemplateBlockForPreview(template, blockRef).content"
                              :values="resolveTemplateBlockForPreview(template, blockRef).values"
                              :meta="resolveTemplateBlockForPreview(template, blockRef).meta"
                              :theme="theme"
                              :site-id="props.site"
                              :render-context="postTemplatePreviewContext"
                              :isolated="true"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="mt-[100px] flex h-32 items-center justify-center text-[100px] text-muted-foreground">
                      No blocks yet
                    </div>
                  </template>
                </div>
              </div>
            </div>
            <p v-if="template.description" class="line-clamp-2 text-xs text-muted-foreground">
              {{ template.description }}
            </p>
          </button>
        </div>
      </div>
      <DialogFooter class="flex justify-between pt-2">
        <edge-shad-button variant="outline" @click="closeNewPostDialog">
          Cancel
        </edge-shad-button>
        <edge-shad-button
          class="w-full bg-slate-800 text-white hover:bg-slate-400"
          @click="startNewPostFromTemplate"
        >
          Continue
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.historyDialogOpen">
    <DialogContent class="w-full max-w-6xl">
      <DialogHeader>
        <DialogTitle class="text-left">
          Post History
        </DialogTitle>
        <DialogDescription class="text-left">
          Select a saved version, preview it, and restore it if needed.
        </DialogDescription>
      </DialogHeader>
      <div class="min-w-0 space-y-4">
        <div class="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
          <div class="flex min-w-0 flex-col justify-end">
            <edge-shad-combobox
              v-model="state.historySelectedId"
              name="postHistoryVersion"
              label="History Entry"
              :items="historyVersionItems"
              placeholder="Select a history entry"
              class="w-full"
              :disabled="state.historyLoading || state.historyRestoring || historyVersionItems.length === 0"
            />
          </div>
          <div class="flex min-w-0 flex-col justify-end">
            <edge-shad-button
              type="button"
              variant="outline"
              class="h-10 justify-between gap-3 px-3 text-left mb-1"
              :disabled="!selectedHistoryEntry || state.historyLoading || !hasHistoryDiff"
              @click="state.showHistoryDiffDialog = true"
            >
              <span class="truncate">{{ hasHistoryDiff ? 'View Diff' : 'No Differences' }}</span>
              <span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {{ historyDiffCountLabel }}
              </span>
            </edge-shad-button>
          </div>
        </div>

        <div v-if="state.historyError" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {{ state.historyError }}
        </div>

        <div
          v-if="state.editorHasUnsavedChanges"
          class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          There are unsaved changes. History compares saved versions of this post.
        </div>

        <div class="min-w-0 rounded-md border border-slate-300 bg-card dark:border-slate-700">
          <div
            v-if="state.historyLoading"
            class="flex h-[60vh] items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"
          >
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading history preview...
          </div>
          <div
            v-else-if="!state.historyPreviewDoc"
            class="flex h-[60vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
          >
            No older saved versions are available to preview.
          </div>
          <div
            v-else
            data-cms-preview-surface="post"
            data-cms-preview-mode="history"
            class="relative isolate h-[60vh] overflow-y-auto overflow-x-hidden bg-card p-6"
          >
            <div
              v-if="!renderedHistoryPreviewDoc?.structure?.length"
              class="flex min-h-[50vh] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              No rows in this version.
            </div>
            <div v-else class="space-y-4">
              <div
                v-for="(row, rowIndex) in renderedHistoryPreviewDoc.structure"
                :key="row.id || `history-post-row-${rowIndex}`"
                class="space-y-4"
              >
                <div
                  v-for="(blockId, blockPosition) in row?.columns?.[0]?.blocks || []"
                  :key="`history-post:${blockId}:${blockPosition}`"
                >
                  <edge-cms-block-api
                    v-if="postBlockIndex(renderedHistoryPreviewDoc, blockId) !== -1"
                    :site-id="props.site"
                    :content="renderedHistoryPreviewDoc.content[postBlockIndex(renderedHistoryPreviewDoc, blockId)]?.content"
                    :values="renderedHistoryPreviewDoc.content[postBlockIndex(renderedHistoryPreviewDoc, blockId)]?.values"
                    :meta="renderedHistoryPreviewDoc.content[postBlockIndex(renderedHistoryPreviewDoc, blockId)]?.meta"
                    :theme="theme"
                    :render-context="renderedHistoryPreviewDoc"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <DialogFooter class="pt-2 flex justify-between">
        <edge-shad-button variant="outline" :disabled="state.historyRestoring" @click="closeHistoryDialog">
          Cancel
        </edge-shad-button>
        <edge-shad-button
          :disabled="state.historyLoading || state.historyRestoring || !selectedHistoryEntry"
          @click="restoreHistoryVersion"
        >
          <Loader2 v-if="state.historyRestoring" class="mr-2 h-4 w-4 animate-spin" />
          <RotateCcw v-else class="mr-2 h-4 w-4" />
          Restore
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.showStatusCompareDialog">
    <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="text-left">
          {{ postChangesDialogTitle }}
        </DialogTitle>
        <DialogDescription class="text-left">
          {{ postChangesDialogDescription }}
        </DialogDescription>
      </DialogHeader>
      <div class="mt-2 flex-1 overflow-y-auto pr-1">
        <div v-if="activePostChangeDetails.length" class="space-y-3">
          <div
            v-for="change in activePostChangeDetails"
            :key="change.key"
            class="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 p-3 text-left"
          >
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {{ change.label }}
            </div>
            <div v-if="!change.layoutChanges?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.baseLabel || 'Published' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.base }}
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.compareLabel || 'Draft' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.compare }}
                </div>
              </div>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.baseLabel || 'Published' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:base`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.base }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.compareLabel || 'Draft' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:compare`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.compare }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.blockChanges?.length" class="mt-3 space-y-3">
              <div
                v-for="blockChange in change.blockChanges"
                :key="blockChange.key"
                class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    {{ blockChange.label }}
                  </span>
                  <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ blockChange.blockLabel }}</span>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <div><strong>{{ change.baseLabel || 'Published' }}:</strong> {{ blockChange.basePositionLabel }}</div>
                  <div><strong>{{ change.compareLabel || 'Draft' }}:</strong> {{ blockChange.comparePositionLabel }}</div>
                </div>
                <div v-if="blockChange.showPreview" class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.baseLabel || 'Published' }}
                    </div>
                    <div
                      data-cms-preview-surface="post"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.baseBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:base`"
                          :site-id="props.site"
                          :content="blockChange.baseBlock?.content"
                          :values="blockChange.baseBlock?.values"
                          :meta="blockChange.baseBlock?.meta"
                          :theme="theme"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.compareLabel || 'Draft' }}
                    </div>
                    <div
                      data-cms-preview-surface="post"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.compareBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:compare`"
                          :site-id="props.site"
                          :content="blockChange.compareBlock?.content"
                          :values="blockChange.compareBlock?.values"
                          :meta="blockChange.compareBlock?.meta"
                          :theme="theme"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.details?.length" class="mt-2 text-sm text-gray-700 dark:text-gray-300">
              <ul class="list-disc pl-5 space-y-1">
                <li v-for="(detail, detailIndex) in change.details" :key="`${change.key}-${detailIndex}`">
                  {{ detail }}
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-gray-600 dark:text-gray-300 text-left">
          No {{ showingUnsavedPostChanges ? 'unsaved' : 'unpublished' }} differences detected.
        </div>
      </div>
      <DialogFooter class="pt-4">
        <edge-shad-button class="w-full" variant="outline" @click="state.showStatusCompareDialog = false">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.showHistoryDiffDialog">
    <DialogContent class="max-w-[96vw] max-h-[97vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="text-left">
          History Diff
        </DialogTitle>
        <DialogDescription class="text-left">
          Review differences between the selected history entry and the current post.
        </DialogDescription>
      </DialogHeader>
      <div class="mt-2 flex-1 overflow-y-auto pr-1">
        <div v-if="historyDiffDetails.length" class="space-y-3">
          <div
            v-for="change in historyDiffDetails"
            :key="change.key"
            class="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 p-3 text-left"
          >
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {{ change.label }}
            </div>
            <div v-if="!change.layoutChanges?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.baseLabel || 'Selected History' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.base }}
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                  {{ change.compareLabel || 'Current' }}
                </div>
                <div class="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                  {{ change.compare }}
                </div>
              </div>
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.baseLabel || 'Selected History' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:base`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.base }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-2">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {{ change.compareLabel || 'Current' }}
                </div>
                <div class="space-y-2">
                  <div v-for="layoutChange in change.layoutChanges" :key="`${layoutChange.key}:compare`" class="rounded border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-gray-900/40 p-2">
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {{ layoutChange.label }}
                    </div>
                    <div class="mt-1 text-slate-900 dark:text-slate-100">
                      {{ layoutChange.compare }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.blockChanges?.length" class="mt-3 space-y-3">
              <div
                v-for="blockChange in change.blockChanges"
                :key="blockChange.key"
                class="rounded border border-gray-200 dark:border-white/15 bg-white/80 dark:bg-gray-800 p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    {{ blockChange.label }}
                  </span>
                  <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ blockChange.blockLabel }}</span>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <div><strong>{{ change.baseLabel || 'Selected History' }}:</strong> {{ blockChange.basePositionLabel }}</div>
                  <div><strong>{{ change.compareLabel || 'Current' }}:</strong> {{ blockChange.comparePositionLabel }}</div>
                </div>
                <div v-if="blockChange.showPreview" class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.baseLabel || 'Selected History' }}
                    </div>
                    <div
                      data-cms-preview-surface="post"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.baseBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:base`"
                          :content="blockChange.baseBlock?.content"
                          :values="blockChange.baseBlock?.values"
                          :meta="blockChange.baseBlock?.meta"
                          :theme="theme"
                          :site-id="props.site"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-[11px] uppercase tracking-wide text-gray-500">
                      {{ change.compareLabel || 'Current' }}
                    </div>
                    <div
                      data-cms-preview-surface="post"
                      data-cms-preview-mode="history"
                      class="relative isolate overflow-hidden rounded border border-gray-200 dark:border-white/15 bg-white dark:bg-gray-900"
                    >
                      <div v-if="blockChange.compareBlock" class="p-3">
                        <edge-cms-block-api
                          :key="`${blockChange.key}:compare`"
                          :content="blockChange.compareBlock?.content"
                          :values="blockChange.compareBlock?.values"
                          :meta="blockChange.compareBlock?.meta"
                          :theme="theme"
                          :site-id="props.site"
                        />
                      </div>
                      <div v-else class="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        Not present
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="change.details?.length" class="mt-2 text-sm text-gray-700 dark:text-gray-300">
              <ul class="list-disc pl-5 space-y-1">
                <li v-for="(detail, detailIndex) in change.details" :key="`${change.key}-${detailIndex}`">
                  {{ detail }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <DialogFooter class="pt-4">
        <edge-shad-button class="w-full" variant="outline" @click="state.showHistoryDiffDialog = false">
          Close
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <template v-if="props.mode === 'editor'">
    <div v-if="editorOpen" class="h-full flex flex-col bg-background px-0">
      <edge-editor
        v-if="editorOpen"
        :key="state.editorKey"
        :collection="collection"
        :doc-id="state.activePostId"
        :schema="schemas.posts"
        :new-doc-schema="state.newDocs.posts"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
        :class="!state.editMode ? 'cms-post-preview-mode' : ''"
        card-content-class="px-0"
        :show-header="true"
        :no-close-after-save="true"
        :save-function-override="handlePostSaved"
        @working-doc="onWorkingDocUpdate"
        @unsaved-changes="handleEditorUnsavedChanges"
      >
        <template #header="slotProps">
          <div class="relative flex flex-col gap-2 p-2 sticky top-0 z-50 rounded border border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex min-w-0 flex-1 items-center gap-2 pr-2">
                <edge-shad-button
                  type="button"
                  variant="text"
                  class="text-xs h-[26px] text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                  @click="closeSheet"
                >
                  <ArrowLeft class="w-4 h-4" />
                  Back
                </edge-shad-button>
                <span class="min-w-0 truncate pr-1 text-sm font-bold whitespace-nowrap sm:text-base">{{ sheetTitle }}</span>
              </div>
              <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <edge-shad-button
                  v-if="!slotProps.unsavedChanges"
                  variant="text"
                  class="h-[26px] shrink-0 text-xs text-red-700 hover:text-red-700/50"
                  @click="closeSheet"
                >
                  <X class="w-4 h-4" />
                  Close
                </edge-shad-button>
                <edge-shad-button
                  v-else
                  variant="text"
                  class="h-[26px] shrink-0 text-xs text-red-700 hover:text-red-700/50"
                  @click="closeSheet"
                >
                  <X class="w-4 h-4" />
                  Cancel
                </edge-shad-button>
                <edge-shad-button
                  v-if="isCreating || slotProps.unsavedChanges"
                  variant="text"
                  type="submit"
                  class="h-[26px] shrink-0 bg-slate-300 text-xs text-slate-900 hover:bg-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                  :disabled="slotProps.submitting"
                >
                  <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                  <span>Save</span>
                </edge-shad-button>
              </div>
            </div>
            <div class="flex w-full min-w-0 flex-wrap items-center justify-between gap-1 border border-stone-300/80 bg-stone-200/70 px-2 py-0.5 text-stone-700 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-200">
              <div class="flex flex-wrap items-center gap-1.5 text-gray-600 dark:text-gray-300 sm:pl-2 sm:pr-1 sm:whitespace-nowrap">
                <button
                  v-if="showPostStatusCompareLink"
                  type="button"
                  class="inline-flex items-center gap-1 text-[11px] font-medium leading-none text-amber-700 underline decoration-dashed underline-offset-4 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:text-xs"
                  @click="openPostStatusCompareDialog"
                >
                  <FileWarning v-if="showingUnsavedPostChanges || activePostPublishStatus.icon === 'changes'" class="h-3.5 w-3.5 shrink-0 text-yellow-600" />
                  <FileCheck v-else-if="activePostPublishStatus.icon === 'published'" class="h-3.5 w-3.5 shrink-0 text-green-700" />
                  <FileX v-else class="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-300" />
                  <span>{{ postStatusDisplayLabel }}</span>
                </button>
                <div
                  v-else
                  class="inline-flex items-center gap-1 text-[11px] font-medium leading-none sm:text-xs"
                  :class="showingUnsavedPostChanges ? 'text-amber-700 dark:text-amber-300' : activePostPublishStatus.badgeClass"
                >
                  <FileWarning v-if="showingUnsavedPostChanges || activePostPublishStatus.icon === 'changes'" class="h-3.5 w-3.5 shrink-0 text-yellow-600" />
                  <FileCheck v-else-if="activePostPublishStatus.icon === 'published'" class="h-3.5 w-3.5 shrink-0 text-green-700" />
                  <FileX v-else class="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-300" />
                  <span>{{ postStatusDisplayLabel }}</span>
                </div>
                <span class="text-[11px] leading-none text-gray-500 dark:text-gray-400">
                  Last Published: {{ lastPublishedTime(state.activePostId) }}
                </span>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-1">
                <edge-shad-button
                  v-if="!isCreating"
                  type="button"
                  variant="text"
                  class="h-[22px] shrink-0 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                  @click="openHistoryDialog"
                >
                  <History class="w-4 h-4" />
                  Versions
                </edge-shad-button>
                <edge-shad-button
                  type="button"
                  variant="text"
                  class="h-[22px] shrink-0 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                  @click="state.editMode = !state.editMode"
                >
                  <template v-if="state.editMode">
                    <Eye class="w-4 h-4" />
                    Preview Mode
                  </template>
                  <template v-else>
                    <Pencil class="w-4 h-4" />
                    Edit Mode
                  </template>
                </edge-shad-button>
              </div>
            </div>
          </div>
        </template>
        <template #main="slotProps">
          <div class="p-6 h-[calc(100vh-190px)] overflow-y-auto">
            <div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div class="space-y-6">
                <div class="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Publish
                  </div>
                  <div class="flex items-center gap-2 text-sm">
                    <FileWarning v-if="activePostPublishStatus.icon === 'changes'" class="h-4 w-4 text-yellow-600" />
                    <FileCheck v-else-if="activePostPublishStatus.icon === 'published'" class="h-4 w-4 text-green-700" />
                    <FileX v-else class="h-4 w-4 text-slate-500 dark:text-slate-300" />
                    <span :class="activePostPublishStatus.badgeClass">{{ activePostPublishStatus.label }}</span>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Last published: {{ lastPublishedTime(state.activePostId) }}
                  </div>
                  <div v-if="activePost?.publishAt" class="space-y-1 text-xs text-muted-foreground">
                    <div>Scheduled publish: {{ formatTimestamp(activePost.publishAt) }}</div>
                    <edge-shad-button
                      type="button"
                      size="sm"
                      variant="ghost"
                      class="h-6 px-2 text-[10px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      :disabled="slotProps.submitting || slotProps.unsavedChanges || !state.activePostId || state.activePostId === 'new'"
                      @click="clearScheduledPublish(state.activePostId)"
                    >
                      <X class="h-3 w-3" />
                      Clear
                    </edge-shad-button>
                  </div>
                  <div v-if="isCreating" class="text-xs text-amber-700 dark:text-amber-300">
                    Save this post before <strong>Publish Now</strong> and <strong>Schedule Publish</strong> are available.
                  </div>
                  <div v-if="slotProps.unsavedChanges" class="text-xs text-amber-700 dark:text-amber-300">
                    Save changes before publishing.
                  </div>
                  <div v-if="activePostPublishStatus.publishBlockedReason" class="text-xs text-amber-700 dark:text-amber-300">
                    {{ activePostPublishStatus.publishBlockedReason }}
                  </div>
                  <edge-shad-datetime
                    v-model="state.publishAtInput"
                    name="publish-at"
                    label="Publish At"
                    trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                    meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                    calendar-class="edge-cms-calendar-slate"
                    :disabled="slotProps.submitting || slotProps.unsavedChanges || !state.activePostId || state.activePostId === 'new'"
                  />
                  <div class="text-xs text-muted-foreground">
                    Pick date/time for scheduled publish. Use Publish Now to publish immediately.
                  </div>
                  <div v-if="scheduledPublishBlockedReason" class="text-xs text-amber-700 dark:text-amber-300">
                    {{ scheduledPublishBlockedReason }}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <edge-shad-button
                      v-if="activePostPublishStatus.canPublish || activePostPublishStatus.publishBlockedReason"
                      type="button"
                      size="sm"
                      class="w-full bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                      :disabled="slotProps.submitting || slotProps.unsavedChanges || !state.activePostId || state.activePostId === 'new' || Boolean(activePostPublishStatus.publishBlockedReason)"
                      @click="publishPost(state.activePostId)"
                    >
                      <FileCheck class="h-4 w-4" />
                      Publish Now
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="activePostPublishStatus.canPublish || activePostPublishStatus.publishBlockedReason"
                      type="button"
                      size="sm"
                      variant="outline"
                      class="w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      :disabled="slotProps.submitting || slotProps.unsavedChanges || !state.activePostId || state.activePostId === 'new' || Boolean(activePostPublishStatus.publishBlockedReason) || Boolean(scheduledPublishBlockedReason)"
                      @click="schedulePostPublish(state.activePostId)"
                    >
                      <FilePen class="h-4 w-4" />
                      Schedule Publish
                    </edge-shad-button>
                    <edge-shad-button
                      v-if="activePostPublishStatus.canUnpublish"
                      type="button"
                      size="sm"
                      variant="outline"
                      class="w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      :disabled="slotProps.submitting || !state.activePostId || state.activePostId === 'new'"
                      @click="unPublishPost(state.activePostId)"
                    >
                      <FileWarning class="h-4 w-4" />
                      Unpublish
                    </edge-shad-button>
                  </div>
                </div>
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Post Details
                  </div>
                  <edge-shad-input
                    v-model="slotProps.workingDoc.name"
                    name="name"
                    label="Name (slug used in URL)"
                  />
                  <edge-shad-input
                    v-model="slotProps.workingDoc.title"
                    name="title"
                    label="Title"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-select-tags
                    v-model="slotProps.workingDoc.tags"
                    name="tags"
                    label="Tags"
                    placeholder="Add a tag"
                    :disabled="slotProps.submitting"
                    :items="getTagsFromPosts"
                    :allow-additions="true"
                    @add="addTag"
                  />
                  <edge-shad-select
                    v-model="slotProps.workingDoc.type"
                    :items="POST_TYPE_OPTIONS"
                    item-title="label"
                    item-value="value"
                    name="type"
                    label="Post Type"
                    :disabled="slotProps.submitting"
                  />
                </div>
                <div
                  v-if="slotProps.workingDoc.type === 'event'"
                  class="rounded-xl border bg-card p-4 space-y-4 shadow-sm"
                >
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Event Details
                  </div>
                  <div
                    v-if="slotProps.workingDoc.event.isPast"
                    class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    This event is in the past.
                  </div>
                  <edge-shad-datetime
                    v-model="slotProps.workingDoc.event.startAt"
                    name="event.startAt"
                    label="Start At"
                    trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                    meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                    calendar-class="edge-cms-calendar-slate"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-datetime
                    v-model="slotProps.workingDoc.event.endAt"
                    name="event.endAt"
                    label="End At"
                    trigger-class="border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    meridiem-active-class="bg-slate-700 text-slate-100 hover:bg-slate-600 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                    meridiem-inactive-class="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    now-button-class="text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    done-button-class="border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                    calendar-class="edge-cms-calendar-slate"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-select
                    v-model="slotProps.workingDoc.event.timezone"
                    :items="TIMEZONE_OPTIONS"
                    item-title="label"
                    item-value="value"
                    name="event-timezone"
                    label="Timezone"
                    placeholder="Select timezone"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-checkbox
                    v-model="slotProps.workingDoc.event.isVirtual"
                    name="event.isVirtual"
                    label="Virtual Event"
                    class="!bg-slate-200 !border-slate-400 data-[state=checked]:!bg-slate-700 data-[state=checked]:!text-slate-100 dark:!bg-slate-700 dark:!border-slate-500 dark:data-[state=checked]:!bg-slate-200 dark:data-[state=checked]:!text-slate-900"
                    :disabled="slotProps.submitting"
                  >
                    This event is virtual (no physical location required).
                  </edge-shad-checkbox>
                  <edge-shad-checkbox
                    v-model="slotProps.workingDoc.event.unpublishPastEvent"
                    name="event.unpublishPastEvent"
                    label="Unpublish Past Event"
                    class="!bg-slate-200 !border-slate-400 data-[state=checked]:!bg-slate-700 data-[state=checked]:!text-slate-100 dark:!bg-slate-700 dark:!border-slate-500 dark:data-[state=checked]:!bg-slate-200 dark:data-[state=checked]:!text-slate-900"
                    :disabled="slotProps.submitting"
                  >
                    Unpublish Past Event
                  </edge-shad-checkbox>
                  <edge-shad-input
                    v-if="!slotProps.workingDoc.event.isVirtual"
                    v-model="slotProps.workingDoc.event.locationName"
                    name="event.locationName"
                    label="Location Name"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-textarea
                    v-if="!slotProps.workingDoc.event.isVirtual"
                    v-model="slotProps.workingDoc.event.locationAddress"
                    name="event.locationAddress"
                    label="Location Address"
                    :disabled="slotProps.submitting"
                    rows="3"
                  />
                  <div class="grid gap-4 md:grid-cols-2">
                    <edge-shad-input
                      v-model="slotProps.workingDoc.event.meetingUrl"
                      name="event-meeting-url"
                      label="Meeting URL"
                      type="url"
                      :disabled="slotProps.submitting"
                    />
                    <edge-shad-input
                      v-model="slotProps.workingDoc.event.registrationUrl"
                      name="event-registration-url"
                      label="Registration URL"
                      type="url"
                      :disabled="slotProps.submitting"
                    />
                  </div>
                  <div class="grid gap-4 md:grid-cols-2 items-center">
                    <edge-shad-input
                      v-model.number="slotProps.workingDoc.event.capacity"
                      name="event-capacity"
                      label="Capacity"
                      type="number"
                      :disabled="slotProps.submitting"
                    />
                    <edge-shad-select
                      v-model="slotProps.workingDoc.event.status"
                      :items="EVENT_STATUS_OPTIONS"
                      item-title="label"
                      item-value="value"
                      name="event-status"
                      label="Event Status"
                      :disabled="slotProps.submitting"
                    />
                  </div>
                </div>
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Featured Image
                  </div>
                  <div class="relative bg-muted/50 py-2 h-48 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer">
                    <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer rounded-lg">
                      <Dialog v-model:open="state.imageOpen">
                        <DialogTrigger as-child>
                          <edge-shad-button variant="outline" class="bg-white text-black hover:bg-gray-200">
                            <ImagePlus class="h-5 w-5" />
                            Select Image
                          </edge-shad-button>
                        </DialogTrigger>
                        <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Select Image</DialogTitle>
                            <DialogDescription />
                          </DialogHeader>
                          <edge-cms-media-manager
                            :site="props.site"
                            :select-mode="true"
                            @select="(url) => { slotProps.workingDoc.featuredImage = url; state.imageOpen = false; }"
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                    <img v-if="slotProps.workingDoc.featuredImage" :src="slotProps.workingDoc.featuredImage" class="mb-2 max-h-40 mx-auto object-contain">
                    <span v-else class="text-sm text-muted-foreground italic">No featured image selected</span>
                  </div>
                </div>
              </div>
              <div class="space-y-6">
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Content
                  </div>
                  <edge-shad-textarea
                    v-model="slotProps.workingDoc.blurb"
                    name="blurb"
                    label="Content Blurb / Preview"
                    :disabled="slotProps.submitting"
                    rows="6"
                  />
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Content
                      </div>
                      <edge-shad-button
                        v-if="state.editMode"
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc)"
                      >
                        Add Row
                      </edge-shad-button>
                    </div>

                    <div
                      v-if="!slotProps.workingDoc?.structure || slotProps.workingDoc.structure.length === 0"
                      :class="state.editMode ? 'flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50' : 'flex items-center justify-between rounded-md px-4 py-3 bg-gray-50/60'"
                    >
                      <div class="text-sm text-gray-700">
                        {{ state.editMode ? 'No rows yet. Add your first full-width row.' : 'No rows to preview yet.' }}
                      </div>
                      <edge-shad-button
                        v-if="state.editMode"
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc)"
                      >
                        Add Row
                      </edge-shad-button>
                    </div>

                    <div v-for="(row, rowIndex) in slotProps.workingDoc.structure || []" :key="row.id || rowIndex" class="space-y-2">
                      <div v-if="state.editMode" class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                          <edge-shad-button
                            type="button"
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === 0"
                            @click="movePostRow(slotProps.workingDoc, rowIndex, -1)"
                          >
                            <ArrowUp class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button
                            type="button"
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === (slotProps.workingDoc?.structure?.length || 0) - 1"
                            @click="movePostRow(slotProps.workingDoc, rowIndex, 1)"
                          >
                            <ArrowDown class="h-4 w-4" />
                          </edge-shad-button>
                        </div>
                        <edge-shad-button
                          type="button"
                          variant="destructive"
                          size="icon"
                          class="h-8 w-8 text-white"
                          @click="removePostRow(slotProps.workingDoc, rowIndex)"
                        >
                          <Trash2 class="h-4 w-4" />
                        </edge-shad-button>
                      </div>

                      <div
                        :class="state.editMode ? 'rounded-md border border-dashed border-gray-200 bg-white/90 p-3 space-y-2' : 'rounded-md bg-white/90 p-3 space-y-2'"
                        :data-cms-preview-surface="!state.editMode ? 'post' : null"
                      >
                        <edge-button-divider v-if="state.editMode" class="my-1">
                          <edge-cms-block-picker
                            :site-id="props.site"
                            :theme="theme"
                            :allowed-types="['Post']"
                            @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, 0, block)"
                          />
                        </edge-button-divider>
                        <draggable
                          v-model="row.columns[0].blocks"
                          :disabled="!state.editMode"
                          :group="{ name: 'post-doc-blocks', pull: true, put: true }"
                          :item-key="blockId => blockId"
                          handle=".block-drag-handle"
                          ghost-class="block-ghost"
                          chosen-class="block-dragging"
                          drag-class="block-dragging"
                        >
                          <template #item="{ element: blockId, index: blockPosition }">
                            <div class="space-y-2">
                              <div class="relative group">
                                <edge-cms-block
                                  v-if="postBlockIndex(slotProps.workingDoc, blockId) !== -1"
                                  v-model="slotProps.workingDoc.content[postBlockIndex(slotProps.workingDoc, blockId)]"
                                  :site-id="props.site"
                                  :render-context="slotProps.workingDoc"
                                  :edit-mode="state.editMode"
                                  :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                                  :override-clicks-in-edit-mode="state.editMode"
                                  :contain-fixed="true"
                                  :block-id="blockId"
                                  :theme="theme"
                                  @delete="() => deletePostBlock(slotProps.workingDoc, blockId)"
                                />
                                <div v-if="state.editMode" class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30">
                                  <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                                    <GripVertical class="w-4 h-4" />
                                  </div>
                                </div>
                              </div>
                              <div v-if="state.editMode && row.columns[0].blocks.length > blockPosition + 1" class="w-full">
                                <edge-button-divider class="my-2">
                                  <edge-cms-block-picker
                                    :site-id="props.site"
                                    :theme="theme"
                                    :allowed-types="['Post']"
                                    @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, blockPosition + 1, block)"
                                  />
                                </edge-button-divider>
                              </div>
                            </div>
                          </template>
                        </draggable>
                        <edge-button-divider v-if="state.editMode && row.columns[0].blocks.length > 0" class="my-1">
                          <edge-cms-block-picker
                            :site-id="props.site"
                            :theme="theme"
                            :allowed-types="['Post']"
                            @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, row.columns[0].blocks.length, block)"
                          />
                        </edge-button-divider>
                      </div>

                      <edge-button-divider v-if="state.editMode && rowIndex < (slotProps.workingDoc?.structure?.length || 0) - 1" class="my-2">
                        <edge-shad-button
                          type="button"
                          size="sm"
                          class="h-8 text-xs bg-secondary text-primary"
                          @click="addPostRow(slotProps.workingDoc, rowIndex + 1)"
                        >
                          Add Row
                        </edge-shad-button>
                      </edge-button-divider>
                    </div>

                    <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0" class="my-2">
                      <edge-shad-button
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc, slotProps.workingDoc.structure.length)"
                      >
                        Add Row
                      </edge-shad-button>
                    </edge-button-divider>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div />
        </template>
      </edge-editor>
    </div>
  </template>
  <Sheet v-else v-model:open="state.sheetOpen">
    <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
      <div class="relative flex items-center p-2 justify-between top-0 z-50 rounded h-[50px] border border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
        <span class="text-lg font-semibold whitespace-nowrap pr-1">{{ sheetTitle }}</span>
        <div class="w-full border-t border-stone-300 dark:border-stone-700" aria-hidden="true" />
      </div>
      <edge-editor
        v-if="editorOpen"
        :key="state.editorKey"
        :collection="collection"
        :doc-id="state.activePostId"
        :schema="schemas.posts"
        :new-doc-schema="state.newDocs.posts"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0"
        card-content-class="px-0"
        :show-header="false"
        :no-close-after-save="true"
        :save-function-override="handlePostSaved"
        @working-doc="onWorkingDocUpdate"
        @unsaved-changes="handleEditorUnsavedChanges"
      >
        <template #main="slotProps">
          <div class="p-6 space-y-4  h-[calc(100vh-122px)] overflow-y-auto">
            <div class="flex justify-end gap-2">
              <edge-shad-button
                v-if="!isCreating"
                type="button"
                variant="text"
                class="hover:text-slate-700 text-xs h-[26px] text-slate-600 dark:text-slate-300 dark:hover:text-slate-100"
                @click="openHistoryDialog"
              >
                <History class="w-4 h-4" />
                Versions
              </edge-shad-button>
              <edge-shad-button
                type="button"
                variant="text"
                class="hover:text-primary/50 text-xs h-[26px] text-primary"
                @click="state.editMode = !state.editMode"
              >
                <template v-if="state.editMode">
                  <Eye class="w-4 h-4" />
                  Preview Mode
                </template>
                <template v-else>
                  <Pencil class="w-4 h-4" />
                  Edit Mode
                </template>
              </edge-shad-button>
            </div>
            <edge-shad-input
              v-model="slotProps.workingDoc.name"
              name="name"
              label="Name"
            />
            <edge-shad-input
              v-model="slotProps.workingDoc.title"
              name="title"
              label="Title"
              :disabled="slotProps.submitting"
            />
            <div class="relative bg-muted py-2 h-48 rounded-md flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer">
              <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer">
                <Dialog v-model:open="state.imageOpen">
                  <DialogTrigger as-child>
                    <edge-shad-button variant="outline" class="bg-white text-black hover:bg-gray-200">
                      <ImagePlus class="h-5 w-5" />
                      Select Image
                    </edge-shad-button>
                  </DialogTrigger>
                  <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Select Image</DialogTitle>
                      <DialogDescription />
                    </DialogHeader>
                    <edge-cms-media-manager
                      :site="props.site"
                      :select-mode="true"
                      @select="(url) => { slotProps.workingDoc.featuredImage = url; state.imageOpen = false; }"
                    />
                  </DialogContent>
                </Dialog>
              </div>
              <img v-if="slotProps.workingDoc.featuredImage" :src="slotProps.workingDoc.featuredImage" class="mb-2 max-h-40 mx-auto object-contain">
              <span v-else class="text-sm text-muted-foreground italic">No featured image selected, click to select</span>
            </div>
            <edge-shad-select-tags
              v-model="slotProps.workingDoc.tags"
              name="tags"
              label="Tags"
              placeholder="Add a tag"
              :disabled="slotProps.submitting"
              :items="getTagsFromPosts"
              :allow-additions="true"
              @add="addTag"
            />
            <edge-shad-textarea
              v-model="slotProps.workingDoc.blurb"
              name="blurb"
              label="Content Blurb / Preview"
              :disabled="slotProps.submitting"
              rows="8"
            />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Content
                </div>
                <edge-shad-button
                  v-if="state.editMode"
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc)"
                >
                  Add Row
                </edge-shad-button>
              </div>

              <div
                v-if="!slotProps.workingDoc?.structure || slotProps.workingDoc.structure.length === 0"
                :class="state.editMode ? 'flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50' : 'flex items-center justify-between rounded-md px-4 py-3 bg-gray-50/60'"
              >
                <div class="text-sm text-gray-700">
                  {{ state.editMode ? 'No rows yet. Add your first full-width row.' : 'No rows to preview yet.' }}
                </div>
                <edge-shad-button
                  v-if="state.editMode"
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc)"
                >
                  Add Row
                </edge-shad-button>
              </div>

              <div v-for="(row, rowIndex) in slotProps.workingDoc.structure || []" :key="row.id || rowIndex" class="space-y-2">
                <div v-if="state.editMode" class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <edge-shad-button
                      type="button"
                      variant="outline"
                      size="icon"
                      class="h-8 w-8"
                      :disabled="rowIndex === 0"
                      @click="movePostRow(slotProps.workingDoc, rowIndex, -1)"
                    >
                      <ArrowUp class="h-4 w-4" />
                    </edge-shad-button>
                    <edge-shad-button
                      type="button"
                      variant="outline"
                      size="icon"
                      class="h-8 w-8"
                      :disabled="rowIndex === (slotProps.workingDoc?.structure?.length || 0) - 1"
                      @click="movePostRow(slotProps.workingDoc, rowIndex, 1)"
                    >
                      <ArrowDown class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                  <edge-shad-button
                    type="button"
                    variant="destructive"
                    size="icon"
                    class="h-8 w-8 text-white"
                    @click="removePostRow(slotProps.workingDoc, rowIndex)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </edge-shad-button>
                </div>

                <div :class="state.editMode ? 'rounded-md border border-dashed border-gray-200 bg-white/90 p-3 space-y-2' : 'rounded-md bg-white/90 p-3 space-y-2'">
                  <edge-button-divider v-if="state.editMode" class="my-1">
                    <edge-cms-block-picker
                      :site-id="props.site"
                      :theme="theme"
                      :allowed-types="['Post']"
                      @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, 0, block)"
                    />
                  </edge-button-divider>
                  <draggable
                    v-model="row.columns[0].blocks"
                    :disabled="!state.editMode"
                    :group="{ name: 'post-doc-blocks', pull: true, put: true }"
                    :item-key="blockId => blockId"
                    handle=".block-drag-handle"
                    ghost-class="block-ghost"
                    chosen-class="block-dragging"
                    drag-class="block-dragging"
                  >
                    <template #item="{ element: blockId, index: blockPosition }">
                      <div class="space-y-2">
                        <div class="relative group">
                          <edge-cms-block
                            v-if="postBlockIndex(slotProps.workingDoc, blockId) !== -1"
                            v-model="slotProps.workingDoc.content[postBlockIndex(slotProps.workingDoc, blockId)]"
                            :site-id="props.site"
                            :render-context="slotProps.workingDoc"
                            :edit-mode="state.editMode"
                            :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                            :override-clicks-in-edit-mode="state.editMode"
                            :contain-fixed="true"
                            :block-id="blockId"
                            :theme="theme"
                            @delete="() => deletePostBlock(slotProps.workingDoc, blockId)"
                          />
                          <div v-if="state.editMode" class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30">
                            <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                              <GripVertical class="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                        <div v-if="state.editMode && row.columns[0].blocks.length > blockPosition + 1" class="w-full">
                          <edge-button-divider class="my-2">
                            <edge-cms-block-picker
                              :site-id="props.site"
                              :theme="theme"
                              :allowed-types="['Post']"
                              @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, blockPosition + 1, block)"
                            />
                          </edge-button-divider>
                        </div>
                      </div>
                    </template>
                  </draggable>
                  <edge-button-divider v-if="state.editMode && row.columns[0].blocks.length > 0" class="my-1">
                    <edge-cms-block-picker
                      :site-id="props.site"
                      :theme="theme"
                      :allowed-types="['Post']"
                      @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, row.columns[0].blocks.length, block)"
                    />
                  </edge-button-divider>
                </div>

                <edge-button-divider v-if="state.editMode && rowIndex < (slotProps.workingDoc?.structure?.length || 0) - 1" class="my-2">
                  <edge-shad-button
                    type="button"
                    size="sm"
                    class="h-8 text-xs bg-secondary text-primary"
                    @click="addPostRow(slotProps.workingDoc, rowIndex + 1)"
                  >
                    Add Row
                  </edge-shad-button>
                </edge-button-divider>
              </div>

              <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0" class="my-2">
                <edge-shad-button
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc, slotProps.workingDoc.structure.length)"
                >
                  Add Row
                </edge-shad-button>
              </edge-button-divider>
            </div>
          </div>
          <SheetFooter class="pt-2 flex justify-between">
            <edge-shad-button variant="destructive" class="text-white" @click="state.sheetOpen = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button :disabled="slotProps.submitting" type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
              <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
              Save
            </edge-shad-button>
          </SheetFooter>
        </template>
        <template #footer>
          <div />
        </template>
      </edge-editor>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
.cms-post-preview-mode :deep([data-cms-preview-surface]) {
  color: initial !important;
}

.template-scale-wrapper {
  width: 100%;
  overflow: hidden;
  position: relative;
  border-radius: 0.5rem;
  height: 400px;
}

.template-scale-wrapper :deep(*) {
  pointer-events: none !important;
  user-select: none;
}

.template-scale-inner {
  transform-origin: top left;
  display: inline-block;
  width: 100%;
  height: 400px;
  overflow: hidden;
}

.template-scale-content {
  transform: scale(0.2);
  transform-origin: top left;
  width: 500%;
}
</style>
