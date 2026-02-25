<script setup lang="js">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { ArrowLeft, CircleAlert, FileCheck, FilePenLine, FileStack, FolderCog, FolderDown, FolderUp, FolderX, Inbox, Loader2, Mail, MailOpen, MoreHorizontal, Upload } from 'lucide-vue-next'
import { useStructuredDataTemplates } from '@/edge/composables/structuredDataTemplates'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: false,
    default: '',
  },
  disableAddSiteForNonAdmin: {
    type: Boolean,
    required: false,
    default: false,
  },
})
const edgeFirebase = inject('edgeFirebase')
const { createDefaults: createSiteSettingsDefaults, createNewDocSchema: createSiteSettingsNewDocSchema } = useSiteSettingsTemplate()
const { buildPageStructuredData } = useStructuredDataTemplates()

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
const isJsonInvalid = (value) => {
  if (value === null || value === undefined)
    return false
  if (typeof value === 'object')
    return false
  const text = String(value).trim()
  if (!text)
    return false
  try {
    JSON.parse(text)
    return false
  }
  catch {
    return true
  }
}

const isTemplateSite = computed(() => props.site === 'templates')
const router = useRouter()

const SUBMISSION_IGNORE_FIELDS = new Set(['orgId', 'siteId', 'pageId', 'blockId'])
const SUBMISSION_LABEL_KEYS = ['name', 'fullName', 'firstName', 'lastName', 'email', 'phone']
const SUBMISSION_MESSAGE_KEYS = ['message', 'comments', 'notes', 'inquiry', 'details']

const state = reactive({
  filter: '',
  userFilter: 'all',
  newDocs: {
    sites: createSiteSettingsNewDocSchema(),
    pages: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Name' }, cols: '12', value: '' },
      content: { value: [] },
      postContent: { value: [] },
      structure: { value: [] },
      postStructure: { value: [] },
      metaTitle: { value: '' },
      metaDescription: { value: '' },
      structuredData: { value: buildPageStructuredData() },
    },
  },
  mounted: false,
  page: {},
  menus: { 'Site Root': [], 'Not In Menu': [] },
  saving: false,
  siteSettings: false,
  hasError: false,
  updating: false,
  aiSectionOpen: false,
  selectedPostId: '',
  viewMode: 'pages',
  submissionFilter: '',
  selectedSubmissionId: '',
  publishSiteLoading: false,
  importingPages: false,
  importPageDocIdDialogOpen: false,
  importPageDocIdValue: '',
  importPageConflictDialogOpen: false,
  importPageConflictDocId: '',
  importPageErrorDialogOpen: false,
  importPageErrorMessage: '',
})

const pageImportInputRef = ref(null)
const pageImportDocIdResolver = ref(null)
const pageImportConflictResolver = ref(null)

const pageInit = {
  name: '',
  content: [],
  blockIds: [],
  metaTitle: '',
  metaDescription: '',
  structuredData: buildPageStructuredData(),
}

const schemas = {
  sites: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
    domains: z
      .array(z.string().max(45, 'Each domain must be 45 characters or fewer'))
      .refine(arr => !!(arr && arr[0] && String(arr[0]).trim().length), {
        message: 'At least one domain is required',
        path: ['domains', 0],
      }),
    forwardApex: z.boolean().optional(),
    contactEmail: z.string().optional(),
    contactPhone: z.string().optional(),
    theme: z.string({
      required_error: 'Theme is required',
    }).min(1, { message: 'Theme is required' }),
    allowedThemes: z.array(z.string()).optional(),
    logo: z.string().optional(),
    logoLight: z.string().optional(),
    logoText: z.string().optional(),
    logoType: z.enum(['image', 'text']).optional(),
    brandLogoDark: z.string().optional(),
    brandLogoLight: z.string().optional(),
    favicon: z.string().optional(),
    menuPosition: z.enum(['left', 'center', 'right']).optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    structuredData: z.string().optional(),
    trackingFacebookPixel: z.string().optional(),
    trackingGoogleAnalytics: z.string().optional(),
    trackingAdroll: z.string().optional(),
    socialFacebook: z.string().optional(),
    socialInstagram: z.string().optional(),
    socialTwitter: z.string().optional(),
    socialLinkedIn: z.string().optional(),
    socialYouTube: z.string().optional(),
    socialTikTok: z.string().optional(),
    aiAgentUserId: z.string().optional(),
    aiInstructions: z.string().optional(),
  })),
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const isAdmin = computed(() => {
  return edgeGlobal.isAdminGlobal(edgeFirebase).value
})
const currentOrgRoleName = computed(() => {
  return String(edgeGlobal.getRoleName(edgeFirebase?.user?.roles || [], edgeGlobal.edgeState.currentOrganization) || '').toLowerCase()
})
const isOrgAdmin = computed(() => {
  return currentOrgRoleName.value === 'admin'
})
const canCreateSite = computed(() => {
  if (!props.disableAddSiteForNonAdmin)
    return true
  return isOrgAdmin.value
})
const cmsMultiOrg = useState('cmsMultiOrg', () => false)
const canEditSiteSettings = computed(() => {
  if (!cmsMultiOrg.value)
    return true
  return currentOrgRoleName.value === 'admin' || currentOrgRoleName.value === 'site admin'
})
const useMenuPublishLabels = computed(() => {
  return cmsMultiOrg.value && !canEditSiteSettings.value
})
const cmsSiteTabs = useState('cmsSiteTabs', () => ({
  pages: true,
  posts: true,
  inbox: true,
}))
const cmsTabAccess = computed(() => {
  const normalized = {
    pages: cmsSiteTabs.value?.pages !== false,
    posts: cmsSiteTabs.value?.posts !== false,
    inbox: cmsSiteTabs.value?.inbox !== false,
  }
  if (!normalized.pages && !normalized.posts && !normalized.inbox) {
    normalized.inbox = true
  }
  return normalized
})
const canViewPagesTab = computed(() => cmsTabAccess.value.pages)
const canViewPostsTab = computed(() => cmsTabAccess.value.posts)
const canViewInboxTab = computed(() => cmsTabAccess.value.inbox)
const hidePublishStatusAndActions = computed(() => cmsMultiOrg.value && !canViewPagesTab.value)
const defaultViewMode = computed(() => {
  if (canViewPagesTab.value)
    return 'pages'
  if (canViewPostsTab.value)
    return 'posts'
  if (canViewInboxTab.value)
    return 'submissions'
  return 'pages'
})

const siteData = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site] || {}
})
const publishedSiteSettings = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site] || {}
})
const domainError = computed(() => {
  return String(publishedSiteSettings.value?.domainError || '').trim()
})

const submissionsCollection = computed(() => `sites/${props.site}/lead-actions`)
const isViewingSubmissions = computed(() => state.viewMode === 'submissions')
const submissionsMap = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/${submissionsCollection.value}`] || {}
})
const selectedSubmission = computed(() => {
  return submissionsMap.value?.[state.selectedSubmissionId] || null
})
const unreadSubmissionsCount = computed(() => {
  return Object.values(submissionsMap.value || {}).filter((item) => {
    if (item?.action !== 'Contact Form')
      return false
    return !item.readAt
  }).length
})

const formatSubmissionValue = (value) => {
  if (value === undefined || value === null)
    return ''
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

const collectSubmissionEntries = (data) => {
  if (!data || typeof data !== 'object')
    return []
  const entries = []
  const seen = new Set()
  const addEntry = (key, value) => {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey)
      return
    const lowerKey = normalizedKey.toLowerCase()
    if (SUBMISSION_IGNORE_FIELDS.has(normalizedKey) || SUBMISSION_IGNORE_FIELDS.has(lowerKey))
      return
    if (value === undefined || value === null || value === '')
      return
    if (seen.has(lowerKey))
      return
    entries.push({ key: normalizedKey, value })
    seen.add(lowerKey)
  }

  const addArrayFields = (fields) => {
    if (!Array.isArray(fields))
      return
    fields.forEach((field) => {
      if (!field)
        return
      const name = field.field || field.name || field.fieldName || field.label || field.title
      const value = field.value ?? field.fieldValue ?? field.val
      addEntry(name, value)
    })
  }

  addArrayFields(data.fields)
  addArrayFields(data.formFields)
  addArrayFields(data.formData)

  if (data.fields && typeof data.fields === 'object' && !Array.isArray(data.fields)) {
    Object.entries(data.fields).forEach(([key, value]) => addEntry(key, value))
  }

  Object.entries(data).forEach(([key, value]) => {
    if (key === 'fields' || key === 'formFields' || key === 'formData')
      return
    addEntry(key, value)
  })

  return entries.sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

const getSubmissionLabel = (data) => {
  if (!data || typeof data !== 'object')
    return 'Contact Form Submission'
  const name = [data.firstName, data.lastName].filter(Boolean).join(' ').trim()
  if (name)
    return name
  const direct = SUBMISSION_LABEL_KEYS.find(key => String(data[key] || '').trim().length)
  if (direct)
    return String(data[direct]).trim()
  return 'Contact Form Submission'
}

const getSubmissionMessage = (data) => {
  if (!data || typeof data !== 'object')
    return ''
  const direct = SUBMISSION_MESSAGE_KEYS.find(key => String(data[key] || '').trim().length)
  if (direct)
    return String(data[direct]).trim()
  return ''
}

const formatSubmissionKey = (key) => {
  return String(key || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, str => str.toUpperCase())
}

const getSubmissionEntriesPreview = (data, limit = 6) => {
  return collectSubmissionEntries(data).slice(0, limit)
}

const formatSubmissionTimestamp = (timestamp) => {
  const date = timestamp?.toDate?.() || (timestamp ? new Date(timestamp) : null)
  if (!date || Number.isNaN(date.getTime()))
    return ''
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const isSubmissionUnread = item => item && item.action === 'Contact Form' && !item.readAt

const markSubmissionRead = async (docId) => {
  const item = submissionsMap.value?.[docId]
  if (!item || !isSubmissionUnread(item))
    return
  try {
    await edgeFirebase.changeDoc(
      `${edgeGlobal.edgeState.organizationDocPath}/${submissionsCollection.value}`,
      docId,
      { readAt: new Date().toISOString() },
    )
  }
  catch (error) {
    console.error('Failed to mark submission as read', error)
  }
}

const markSubmissionUnread = async (docId) => {
  const item = submissionsMap.value?.[docId]
  if (!item || isSubmissionUnread(item))
    return
  try {
    await edgeFirebase.changeDoc(
      `${edgeGlobal.edgeState.organizationDocPath}/${submissionsCollection.value}`,
      docId,
      { readAt: null },
    )
  }
  catch (error) {
    console.error('Failed to mark submission as unread', error)
  }
}

const getSubmissionSortTime = (item) => {
  const date = item?.timestamp?.toDate?.() || (item?.timestamp ? new Date(item.timestamp) : null)
  if (!date || Number.isNaN(date.getTime()))
    return 0
  return date.getTime()
}

const sortedSubmissionIds = computed(() => {
  return Object.values(submissionsMap.value || {})
    .filter(item => item?.docId)
    .map(item => ({ id: item.docId, time: getSubmissionSortTime(item) }))
    .sort((a, b) => b.time - a.time)
    .map(item => item.id)
})

const themeCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`] || {}
})

const deriveThemeLabel = (doc = {}) => {
  return doc?.name
    || doc?.title
    || doc?.theme?.name
    || doc?.theme?.title
    || doc?.meta?.name
    || doc?.meta?.title
    || ''
}

const themeOptions = computed(() => {
  return Object.entries(themeCollection.value)
    .map(([value, doc]) => ({
      value,
      label: deriveThemeLabel(doc) || value,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const themeOptionsMap = computed(() => {
  const map = new Map()
  for (const option of themeOptions.value) {
    map.set(option.value, option)
  }
  return map
})

const orgUsers = computed(() => edgeFirebase.state?.users || {})
const userOptions = computed(() => {
  return Object.entries(orgUsers.value || {})
    .filter(([, user]) => Boolean(user?.userId))
    .map(([id, user]) => ({
      value: user?.userId,
      label: user?.meta?.name || user?.userId || id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
const authUid = computed(() => String(edgeFirebase?.user?.uid || '').trim())
const currentOrgUser = computed(() => {
  if (!authUid.value)
    return null
  const users = Object.values(orgUsers.value || {})
  return users.find((user) => {
    const userId = String(user?.userId || '').trim()
    const docId = String(user?.docId || '').trim()
    const uid = String(user?.uid || '').trim()
    return userId === authUid.value || docId === authUid.value || uid === authUid.value
  }) || null
})
const currentOrgUserId = computed(() => {
  return String(
    currentOrgUser.value?.userId
    || currentOrgUser.value?.docId
    || authUid.value
    || '',
  ).trim()
})
const currentUserOption = computed(() => {
  if (!currentOrgUserId.value)
    return null
  return {
    value: currentOrgUserId.value,
    label: currentOrgUser.value?.meta?.name || currentOrgUser.value?.meta?.email || currentOrgUserId.value,
  }
})
const shouldForceCurrentUserForNewSite = computed(() => !isAdmin.value && props.site === 'new')
const aiUserOptions = computed(() => {
  if (!shouldForceCurrentUserForNewSite.value)
    return userOptions.value
  return currentUserOption.value ? [currentUserOption.value] : []
})
const normalizeUserIds = items => (Array.isArray(items) ? items : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)
const getSiteUsersModel = (workingDoc) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return []
  const users = normalizeUserIds(workingDoc?.users)
  if (!shouldForceCurrentUserForNewSite.value)
    return users
  if (!currentOrgUserId.value)
    return users
  if (users.length === 1 && users[0] === currentOrgUserId.value)
    return users
  workingDoc.users = [currentOrgUserId.value]
  return workingDoc.users
}
const updateSiteUsersModel = (workingDoc, value) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return
  if (shouldForceCurrentUserForNewSite.value) {
    workingDoc.users = currentOrgUserId.value ? [currentOrgUserId.value] : []
    return
  }
  workingDoc.users = normalizeUserIds(value)
}

const themeItemsForAllowed = (allowed, current) => {
  const base = themeOptions.value
  const allowedList = Array.isArray(allowed) ? allowed.filter(Boolean) : []
  if (allowedList.length) {
    const allowedSet = new Set(allowedList)
    const filtered = base.filter(option => allowedSet.has(option.value))
    if (current && !allowedSet.has(current)) {
      const currentOption = themeOptionsMap.value.get(current)
      if (currentOption)
        filtered.push(currentOption)
    }
    return filtered
  }

  if (current) {
    const currentOption = themeOptionsMap.value.get(current)
    return currentOption ? [currentOption] : []
  }

  return []
}

const menuPositionOptions = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const isExternalLinkEntry = entry => entry?.item && typeof entry.item === 'object' && entry.item.type === 'external'

const TEMPLATE_PAGES_PATH = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/templates/pages`)
const seededSiteIds = new Set()

const slugify = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const titleFromSlug = (slug) => {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'New Page'
}

const ensureMenuBuckets = (menus) => {
  const normalized = (menus && typeof menus === 'object')
    ? edgeGlobal.dupObject(menus)
    : {}
  if (!Array.isArray(normalized['Site Root']))
    normalized['Site Root'] = []
  if (!Array.isArray(normalized['Not In Menu']))
    normalized['Not In Menu'] = []
  return normalized
}

const ensureUniqueSlug = (candidate, templateDoc, usedSlugs) => {
  const fallbackBase = slugify(templateDoc?.slug || templateDoc?.name || '')
  let base = (candidate && candidate.trim().length) ? slugify(candidate) : ''
  if (!base)
    base = fallbackBase || `page-${usedSlugs.size + 1}`
  let slugCandidate = base
  let suffix = 2
  while (usedSlugs.has(slugCandidate)) {
    slugCandidate = `${base}-${suffix}`
    suffix += 1
  }
  usedSlugs.add(slugCandidate)
  return slugCandidate
}

const cloneBlocks = (blocks = []) => {
  return Array.isArray(blocks) ? JSON.parse(JSON.stringify(blocks)) : []
}

const deriveBlockIdsFromDoc = (doc = {}) => {
  const collectBlocks = (blocks) => {
    if (!Array.isArray(blocks))
      return []
    return blocks
      .map(block => block?.blockId)
      .filter(Boolean)
  }

  const collectFromStructure = (structure) => {
    if (!Array.isArray(structure))
      return []
    const ids = []
    for (const row of structure) {
      for (const column of row?.columns || []) {
        if (Array.isArray(column?.blocks))
          ids.push(...column.blocks.filter(Boolean))
      }
    }
    return ids
  }

  const ids = new Set([
    ...collectBlocks(doc.content),
    ...collectBlocks(doc.postContent),
    ...collectFromStructure(doc.structure),
    ...collectFromStructure(doc.postStructure),
  ])
  return Array.from(ids)
}

const buildPagePayloadFromTemplateDoc = (templateDoc, slug, displayName = '') => {
  const timestamp = Date.now()
  const templateStructuredData = typeof templateDoc?.structuredData === 'string' ? templateDoc.structuredData.trim() : ''
  const payload = {
    name: displayName?.trim()?.length ? displayName : titleFromSlug(slug),
    slug,
    post: templateDoc?.post || false,
    content: cloneBlocks(templateDoc?.content),
    postContent: cloneBlocks(templateDoc?.postContent),
    structure: cloneBlocks(templateDoc?.structure),
    postStructure: cloneBlocks(templateDoc?.postStructure),
    blockIds: [],
    metaTitle: templateDoc?.metaTitle || '',
    metaDescription: templateDoc?.metaDescription || '',
    structuredData: templateStructuredData || buildPageStructuredData(),
    doc_created_at: timestamp,
    last_updated: timestamp,
  }
  payload.blockIds = deriveBlockIdsFromDoc(payload)
  return payload
}

const buildMenusFromDefaultPages = (defaultPages = []) => {
  if (!Array.isArray(defaultPages) || !defaultPages.length)
    return null
  const menus = { 'Site Root': [], 'Not In Menu': [] }
  const usedSlugs = new Set()
  for (const entry of defaultPages) {
    if (!entry?.pageId)
      continue
    const slug = ensureUniqueSlug(entry?.name || '', null, usedSlugs)
    menus['Site Root'].push({
      name: slug,
      item: entry.pageId,
      disableRename: !!entry?.disableRename,
      disableDelete: !!entry?.disableDelete,
    })
  }
  return menus
}

const deriveThemeMenus = (themeDoc = {}) => {
  if (themeDoc?.defaultMenus && Object.keys(themeDoc.defaultMenus || {}).length)
    return ensureMenuBuckets(themeDoc.defaultMenus)
  if (Array.isArray(themeDoc?.defaultPages) && themeDoc.defaultPages.length)
    return buildMenusFromDefaultPages(themeDoc.defaultPages)
  return null
}

const shouldApplyThemeSetting = (currentValue, baseValue) => {
  if (currentValue === undefined || currentValue === null)
    return true
  if (typeof currentValue === 'string')
    return !currentValue.trim() || areEqualNormalized(currentValue, baseValue)
  if (Array.isArray(currentValue))
    return currentValue.length === 0 || areEqualNormalized(currentValue, baseValue)
  if (typeof currentValue === 'object')
    return Object.keys(currentValue).length === 0 || areEqualNormalized(currentValue, baseValue)
  return areEqualNormalized(currentValue, baseValue)
}

const buildThemeSettingsPayload = (themeDoc = {}, siteDoc = {}) => {
  if (!themeDoc?.defaultSiteSettings || typeof themeDoc.defaultSiteSettings !== 'object' || Array.isArray(themeDoc.defaultSiteSettings))
    return {}
  const baseDefaults = createSiteSettingsDefaults()
  const payload = {}
  for (const [key, baseValue] of Object.entries(baseDefaults)) {
    if (!(key in themeDoc.defaultSiteSettings))
      continue
    let themeValue = themeDoc.defaultSiteSettings[key]
    if (key === 'structuredData' && typeof themeValue === 'string' && !themeValue.trim())
      themeValue = baseValue
    if (areEqualNormalized(themeValue, baseValue))
      continue
    if (shouldApplyThemeSetting(siteDoc?.[key], baseValue))
      payload[key] = themeValue
  }
  return payload
}

const ensureTemplatePagesSnapshot = async () => {
  if (!edgeFirebase.data?.[TEMPLATE_PAGES_PATH.value])
    await edgeFirebase.startSnapshot(TEMPLATE_PAGES_PATH.value)
  return edgeFirebase.data?.[TEMPLATE_PAGES_PATH.value] || {}
}

const duplicateEntriesWithPages = async (entries = [], options) => {
  const {
    templatePages,
    siteId,
    usedSlugs,
  } = options
  const next = []
  for (const entry of entries) {
    if (!entry || entry.item == null)
      continue
    if (isExternalLinkEntry(entry)) {
      next.push(edgeGlobal.dupObject(entry))
      continue
    }
    if (typeof entry.item === 'string' || entry.item === '') {
      const templateDoc = templatePages?.[entry.item] || null
      const slug = ensureUniqueSlug(entry.name || '', templateDoc, usedSlugs)
      const payload = buildPagePayloadFromTemplateDoc(templateDoc, slug, entry.name || '')
      try {
        const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${siteId}/pages`, payload)
        const docId = result?.meta?.docId
        if (docId) {
          next.push({
            ...entry,
            name: slug,
            item: docId,
          })
        }
      }
      catch (error) {
        console.error('Failed to duplicate template page for site seed', error)
      }
    }
    else if (typeof entry.item === 'object') {
      const folderName = Object.keys(entry.item || {})[0]
      if (!folderName)
        continue
      const children = await duplicateEntriesWithPages(entry.item[folderName], options)
      if (children.length) {
        next.push({
          ...entry,
          item: {
            [folderName]: children,
          },
        })
      }
    }
  }
  return next
}

const seedNewSiteFromTheme = async (siteId, themeId, siteDoc) => {
  if (!siteId || !themeId)
    return
  const themeDoc = themeCollection.value?.[themeId]
  if (!themeDoc)
    return
  const updatePayload = {}
  const themeMenus = deriveThemeMenus(themeDoc)
  if (themeMenus) {
    const templatePages = await ensureTemplatePagesSnapshot()
    const usedSlugs = new Set()
    const seededMenus = ensureMenuBuckets(themeMenus)
    seededMenus['Site Root'] = await duplicateEntriesWithPages(seededMenus['Site Root'], { templatePages, siteId, usedSlugs })
    seededMenus['Not In Menu'] = await duplicateEntriesWithPages(seededMenus['Not In Menu'], { templatePages, siteId, usedSlugs })
    updatePayload.menus = seededMenus
  }
  const settingsPayload = buildThemeSettingsPayload(themeDoc, siteDoc || {})
  Object.assign(updatePayload, settingsPayload)
  if (Object.keys(updatePayload).length)
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, siteId, updatePayload)
}

const handleNewSiteSaved = async ({ docId, data, collection }) => {
  if (props.site !== 'new')
    return
  if (collection !== 'sites')
    return
  if (!docId || seededSiteIds.has(docId))
    return
  const themeId = data?.theme
  if (!themeId)
    return
  seededSiteIds.add(docId)
  try {
    await seedNewSiteFromTheme(docId, themeId, data)
  }
  catch (error) {
    console.error('Failed to seed site from theme defaults', error)
    seededSiteIds.delete(docId)
  }
}

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/users`]) {
    await edgeFirebase.startUsersSnapshot(edgeGlobal.edgeState.organizationDocPath)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/published-site-settings`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/published-site-settings`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/pages`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/pages`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/themes`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/posts`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/posts`)
  }
  if (!edgeFirebase.data?.[`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published_posts`]) {
    await edgeFirebase.startSnapshot(`organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/published_posts`)
  }
  if (props.site !== 'templates') {
    const submissionsPath = `organizations/${edgeGlobal.edgeState.currentOrganization}/sites/${props.site}/lead-actions`
    if (!edgeFirebase.data?.[submissionsPath]) {
      await edgeFirebase.startSnapshot(submissionsPath, [{ field: 'action', operator: '==', value: 'Contact Form' }])
    }
  }
  state.mounted = true
})

const isSiteDiff = computed(() => {
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  if (!publishedSite && siteData.value) {
    return true
  }
  if (publishedSite && !siteData.value) {
    return true
  }
  if (publishedSite && siteData.value) {
    return !areEqualNormalized({
      domains: publishedSite.domains,
      menus: publishedSite.menus,
      theme: publishedSite.theme,
      allowedThemes: publishedSite.allowedThemes,
      logo: publishedSite.logo,
      logoLight: publishedSite.logoLight,
      logoText: publishedSite.logoText,
      logoType: publishedSite.logoType,
      brandLogoDark: publishedSite.brandLogoDark,
      brandLogoLight: publishedSite.brandLogoLight,
      favicon: publishedSite.favicon,
      menuPosition: publishedSite.menuPosition,
      forwardApex: publishedSite.forwardApex,
      contactEmail: publishedSite.contactEmail,
      contactPhone: publishedSite.contactPhone,
      metaTitle: publishedSite.metaTitle,
      metaDescription: publishedSite.metaDescription,
      structuredData: publishedSite.structuredData,
      trackingFacebookPixel: publishedSite.trackingFacebookPixel,
      trackingGoogleAnalytics: publishedSite.trackingGoogleAnalytics,
      trackingAdroll: publishedSite.trackingAdroll,
      socialFacebook: publishedSite.socialFacebook,
      socialInstagram: publishedSite.socialInstagram,
      socialTwitter: publishedSite.socialTwitter,
      socialLinkedIn: publishedSite.socialLinkedIn,
      socialYouTube: publishedSite.socialYouTube,
      socialTikTok: publishedSite.socialTikTok,
    }, {
      domains: siteData.value.domains,
      menus: siteData.value.menus,
      theme: siteData.value.theme,
      allowedThemes: siteData.value.allowedThemes,
      logo: siteData.value.logo,
      logoLight: siteData.value.logoLight,
      logoText: siteData.value.logoText,
      logoType: siteData.value.logoType,
      brandLogoDark: siteData.value.brandLogoDark,
      brandLogoLight: siteData.value.brandLogoLight,
      favicon: siteData.value.favicon,
      menuPosition: siteData.value.menuPosition,
      forwardApex: siteData.value.forwardApex,
      contactEmail: siteData.value.contactEmail,
      contactPhone: siteData.value.contactPhone,
      metaTitle: siteData.value.metaTitle,
      metaDescription: siteData.value.metaDescription,
      structuredData: siteData.value.structuredData,
      trackingFacebookPixel: siteData.value.trackingFacebookPixel,
      trackingGoogleAnalytics: siteData.value.trackingGoogleAnalytics,
      trackingAdroll: siteData.value.trackingAdroll,
      socialFacebook: siteData.value.socialFacebook,
      socialInstagram: siteData.value.socialInstagram,
      socialTwitter: siteData.value.socialTwitter,
      socialLinkedIn: siteData.value.socialLinkedIn,
      socialYouTube: siteData.value.socialYouTube,
      socialTikTok: siteData.value.socialTikTok,
    })
  }
  return false
})

const publishSiteSettings = async () => {
  console.log('Publishing site settings for site:', props.site)
  await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`, siteData.value)
}

const discardSiteSettings = async () => {
  console.log('Discarding site settings for site:', props.site)
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  if (publishedSite) {
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, {
      domains: publishedSite.domains || [],
      menus: publishedSite.menus || {},
      theme: publishedSite.theme || '',
      allowedThemes: publishedSite.allowedThemes || [],
      logo: publishedSite.logo || '',
      logoLight: publishedSite.logoLight || '',
      logoText: publishedSite.logoText || '',
      logoType: publishedSite.logoType || 'image',
      brandLogoDark: publishedSite.brandLogoDark || '',
      brandLogoLight: publishedSite.brandLogoLight || '',
      favicon: publishedSite.favicon || '',
      menuPosition: publishedSite.menuPosition || '',
      forwardApex: publishedSite.forwardApex !== false,
      contactEmail: publishedSite.contactEmail || '',
      contactPhone: publishedSite.contactPhone || '',
      metaTitle: publishedSite.metaTitle || '',
      metaDescription: publishedSite.metaDescription || '',
      structuredData: publishedSite.structuredData || '',
      trackingFacebookPixel: publishedSite.trackingFacebookPixel || '',
      trackingGoogleAnalytics: publishedSite.trackingGoogleAnalytics || '',
      trackingAdroll: publishedSite.trackingAdroll || '',
      socialFacebook: publishedSite.socialFacebook || '',
      socialInstagram: publishedSite.socialInstagram || '',
      socialTwitter: publishedSite.socialTwitter || '',
      socialLinkedIn: publishedSite.socialLinkedIn || '',
      socialYouTube: publishedSite.socialYouTube || '',
      socialTikTok: publishedSite.socialTikTok || '',
    })
  }
}

const unPublishSite = async () => {
  console.log('Unpublishing site:', props.site)
  const pages = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  for (const pageId of Object.keys(pages)) {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageId)
  }
  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`, props.site)
}

const publishSite = async () => {
  for (const [pageId, pageData] of Object.entries(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {})) {
    await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`, pageData)
  }
}

const publishSiteAndSettings = async () => {
  if (state.publishSiteLoading)
    return
  state.publishSiteLoading = true
  try {
    await publishSiteSettings()
    await publishSite()
  }
  finally {
    state.publishSiteLoading = false
  }
}

const pages = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
})

const publishedPages = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
})

const pageRouteBase = computed(() => {
  return props.site === 'templates'
    ? '/app/dashboard/templates'
    : `/app/dashboard/sites/${props.site}`
})

const pageList = computed(() => {
  return Object.entries(pages.value || {})
    .map(([id, data]) => ({
      id,
      name: data?.name || 'Untitled Page',
      lastUpdated: data?.last_updated || data?.doc_created_at,
    }))
    .sort((a, b) => (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0))
})

const INVALID_PAGE_IMPORT_MESSAGE = 'Invalid file. Please import a valid page file.'
const pageImportCollectionPath = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`)

const readTextFile = file => new Promise((resolve, reject) => {
  if (typeof FileReader === 'undefined') {
    reject(new Error('File import is only available in the browser.'))
    return
  }
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Could not read the selected file.'))
  reader.readAsText(file)
})

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const normalizeImportedPageDoc = (payload, fallbackDocId = '') => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  if (payload.document && typeof payload.document === 'object' && !Array.isArray(payload.document)) {
    const normalized = { ...payload.document }
    if (!normalized.docId && payload.docId)
      normalized.docId = payload.docId
    if (!normalized.docId && fallbackDocId)
      normalized.docId = fallbackDocId
    return normalized
  }

  const normalized = { ...payload }
  if (!normalized.docId && fallbackDocId)
    normalized.docId = fallbackDocId
  return normalized
}

const cloneSchemaValue = (value) => {
  if (isPlainObject(value) || Array.isArray(value))
    return edgeGlobal.dupObject(value)
  return value
}

const getDocDefaultsFromSchema = (schema = {}) => {
  const defaults = {}
  for (const [key, schemaEntry] of Object.entries(schema || {})) {
    const hasValueProp = isPlainObject(schemaEntry) && Object.prototype.hasOwnProperty.call(schemaEntry, 'value')
    const baseValue = hasValueProp ? schemaEntry.value : schemaEntry
    defaults[key] = cloneSchemaValue(baseValue)
  }
  return defaults
}

const getPageDocDefaults = () => getDocDefaultsFromSchema(state.newDocs?.pages || {})

const isBlankString = value => String(value || '').trim() === ''

const applyImportedPageSeoDefaults = (doc) => {
  if (!isPlainObject(doc))
    return doc

  if (isBlankString(doc.structuredData))
    doc.structuredData = buildPageStructuredData()

  if (doc.post && isBlankString(doc.postStructuredData))
    doc.postStructuredData = doc.structuredData || buildPageStructuredData()

  return doc
}

const validateImportedPageDoc = (doc) => {
  if (!isPlainObject(doc))
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  const requiredKeys = Object.keys(state.newDocs?.pages || {})
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(doc, key))
  if (missing.length)
    throw new Error(INVALID_PAGE_IMPORT_MESSAGE)

  return doc
}

const normalizeMenusForImport = (menus) => {
  const normalized = isPlainObject(menus) ? edgeGlobal.dupObject(menus) : {}
  if (!Array.isArray(normalized['Site Root']))
    normalized['Site Root'] = []
  if (!Array.isArray(normalized['Not In Menu']))
    normalized['Not In Menu'] = []
  return normalized
}

const walkMenuEntries = (items, callback) => {
  if (!Array.isArray(items))
    return
  for (const entry of items) {
    if (!entry || typeof entry !== 'object')
      continue
    callback(entry)
    if (isPlainObject(entry.item)) {
      for (const nested of Object.values(entry.item)) {
        if (Array.isArray(nested))
          walkMenuEntries(nested, callback)
      }
    }
  }
}

const menuIncludesDocId = (menus, docId) => {
  let found = false
  const checkEntry = (entry) => {
    if (found)
      return
    if (typeof entry?.item === 'string' && entry.item === docId)
      found = true
  }
  for (const menuItems of Object.values(menus || {})) {
    walkMenuEntries(menuItems, checkEntry)
    if (found)
      return true
  }
  return false
}

const collectMenuPageNames = (menus) => {
  const names = new Set()
  const collectEntry = (entry) => {
    if (typeof entry?.item !== 'string')
      return
    const name = String(entry?.name || '').trim()
    if (name)
      names.add(name)
  }
  for (const menuItems of Object.values(menus || {}))
    walkMenuEntries(menuItems, collectEntry)
  return names
}

const slugifyMenuPageName = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'page'
}

const makeUniqueMenuPageName = (value, existingNames = new Set()) => {
  const base = slugifyMenuPageName(value)
  let candidate = base
  let suffix = 2
  while (existingNames.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const addImportedPageToSiteMenu = (docId, pageName = '') => {
  if (isTemplateSite.value)
    return

  const nextDocId = String(docId || '').trim()
  if (!nextDocId)
    return

  const menus = normalizeMenusForImport(siteData.value?.menus || state.menus)
  if (menuIncludesDocId(menus, nextDocId)) {
    state.menus = menus
    return
  }

  const existingNames = collectMenuPageNames(menus)
  const menuName = makeUniqueMenuPageName(pageName || nextDocId, existingNames)
  menus['Site Root'].push({ name: menuName, item: nextDocId })
  state.menus = menus
}

const makeRandomPageDocId = (docsMap = {}) => {
  let nextDocId = String(edgeGlobal.generateShortId() || '').trim()
  while (!nextDocId || docsMap[nextDocId])
    nextDocId = String(edgeGlobal.generateShortId() || '').trim()
  return nextDocId
}

const makeImportedPageNameForNew = (baseName, docsMap = {}) => {
  const normalizedBase = String(baseName || '').trim() || 'page'
  const existingNames = new Set(
    Object.values(docsMap || {})
      .map(doc => String(doc?.name || '').trim().toLowerCase())
      .filter(Boolean),
  )

  let suffix = 1
  let candidate = `${normalizedBase}-${suffix}`
  while (existingNames.has(candidate.toLowerCase())) {
    suffix += 1
    candidate = `${normalizedBase}-${suffix}`
  }
  return candidate
}

const requestPageImportDocId = (initialValue = '') => {
  state.importPageDocIdValue = String(initialValue || '')
  state.importPageDocIdDialogOpen = true
  return new Promise((resolve) => {
    pageImportDocIdResolver.value = resolve
  })
}

const resolvePageImportDocId = (value = '') => {
  const resolver = pageImportDocIdResolver.value
  pageImportDocIdResolver.value = null
  state.importPageDocIdDialogOpen = false
  if (resolver)
    resolver(String(value || '').trim())
}

const requestPageImportConflict = (docId) => {
  state.importPageConflictDocId = String(docId || '')
  state.importPageConflictDialogOpen = true
  return new Promise((resolve) => {
    pageImportConflictResolver.value = resolve
  })
}

const resolvePageImportConflict = (action = 'cancel') => {
  const resolver = pageImportConflictResolver.value
  pageImportConflictResolver.value = null
  state.importPageConflictDialogOpen = false
  if (resolver)
    resolver(action)
}

const getImportDocId = async (incomingDoc, fallbackDocId = '') => {
  let nextDocId = String(incomingDoc?.docId || '').trim()
  if (!nextDocId)
    nextDocId = await requestPageImportDocId(fallbackDocId)
  if (!nextDocId)
    throw new Error('Import canceled. A docId is required.')
  if (nextDocId.includes('/'))
    throw new Error('docId cannot include "/".')
  return nextDocId
}

const openImportErrorDialog = (message) => {
  state.importPageErrorMessage = String(message || 'Failed to import page.')
  state.importPageErrorDialogOpen = true
}

const triggerPageImport = () => {
  pageImportInputRef.value?.click()
}

const importSinglePageFile = async (file, existingPages = {}, fallbackDocId = '') => {
  const fileText = await readTextFile(file)
  const parsed = JSON.parse(fileText)
  const importedDoc = applyImportedPageSeoDefaults(validateImportedPageDoc(normalizeImportedPageDoc(parsed, fallbackDocId)))
  const incomingDocId = await getImportDocId(importedDoc, fallbackDocId)
  let targetDocId = incomingDocId
  let importDecision = 'create'

  if (existingPages[targetDocId]) {
    const decision = await requestPageImportConflict(targetDocId)
    if (decision === 'cancel')
      return
    if (decision === 'new') {
      targetDocId = makeRandomPageDocId(existingPages)
      importedDoc.name = makeImportedPageNameForNew(importedDoc.name || incomingDocId, existingPages)
      importDecision = 'new'
    }
    else {
      importDecision = 'overwrite'
    }
  }

  const payload = { ...getPageDocDefaults(), ...importedDoc, docId: targetDocId }
  await edgeFirebase.storeDoc(pageImportCollectionPath.value, payload, targetDocId)
  existingPages[targetDocId] = payload
  addImportedPageToSiteMenu(targetDocId, payload.name)

  if (importDecision === 'overwrite')
    edgeFirebase?.toast?.success?.(`Overwrote page "${targetDocId}".`)
  else if (importDecision === 'new')
    edgeFirebase?.toast?.success?.(`Imported page as new "${targetDocId}".`)
  else
    edgeFirebase?.toast?.success?.(`Imported page "${targetDocId}".`)
}

const handlePageImport = async (event) => {
  const input = event?.target
  const files = Array.from(input?.files || [])
  if (!files.length)
    return

  state.importingPages = true
  const existingPages = { ...(pages.value || {}) }
  try {
    if (!edgeFirebase.data?.[pageImportCollectionPath.value])
      await edgeFirebase.startSnapshot(pageImportCollectionPath.value)

    for (const file of files) {
      try {
        await importSinglePageFile(file, existingPages, '')
      }
      catch (error) {
        console.error('Failed to import page file', error)
        const message = error?.message || 'Failed to import page file.'
        if (/^Import canceled\./i.test(message))
          continue
        if (error instanceof SyntaxError || message === INVALID_PAGE_IMPORT_MESSAGE)
          openImportErrorDialog(INVALID_PAGE_IMPORT_MESSAGE)
        else
          openImportErrorDialog(message)
      }
    }
  }
  finally {
    state.importingPages = false
    if (input)
      input.value = ''
  }
}

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

const isPublishedPageDiff = (pageId) => {
  const publishedPage = publishedPages.value?.[pageId]
  const draftPage = pages.value?.[pageId]
  if (!publishedPage && draftPage) {
    return true
  }
  if (publishedPage && !draftPage) {
    return true
  }
  if (publishedPage && draftPage) {
    return !areEqualNormalized(
      {
        content: publishedPage.content,
        postContent: publishedPage.postContent,
        structure: publishedPage.structure,
        postStructure: publishedPage.postStructure,
        metaTitle: publishedPage.metaTitle,
        metaDescription: publishedPage.metaDescription,
        structuredData: publishedPage.structuredData,
        postMetaTitle: publishedPage.postMetaTitle,
        postMetaDescription: publishedPage.postMetaDescription,
        postStructuredData: publishedPage.postStructuredData,
      },
      {
        content: draftPage.content,
        postContent: draftPage.postContent,
        structure: draftPage.structure,
        postStructure: draftPage.postStructure,
        metaTitle: draftPage.metaTitle,
        metaDescription: draftPage.metaDescription,
        structuredData: draftPage.structuredData,
        postMetaTitle: draftPage.postMetaTitle,
        postMetaDescription: draftPage.postMetaDescription,
        postStructuredData: draftPage.postStructuredData,
      },
    )
  }
  return false
}

const pageStatusLabel = pageId => (isPublishedPageDiff(pageId) ? 'Draft' : 'Published')
const hasSelection = computed(() => Boolean(props.page) || Boolean(state.selectedPostId))
const showSplitView = computed(() => isTemplateSite.value || (canViewPagesTab.value && (state.viewMode === 'pages' || hasSelection.value)))
const isEditingPost = computed(() => canViewPostsTab.value && state.viewMode === 'posts' && Boolean(state.selectedPostId))

const ensureValidViewMode = () => {
  let nextMode = state.viewMode
  if (nextMode === 'pages' && !canViewPagesTab.value)
    nextMode = defaultViewMode.value
  if (nextMode === 'posts' && !canViewPostsTab.value)
    nextMode = defaultViewMode.value
  if (nextMode === 'submissions' && !canViewInboxTab.value)
    nextMode = defaultViewMode.value

  if (state.viewMode !== nextMode)
    state.viewMode = nextMode

  if (state.viewMode !== 'posts') {
    state.selectedPostId = ''
  }
  if (state.viewMode !== 'submissions') {
    state.selectedSubmissionId = ''
  }
  if (props.page && state.viewMode !== 'pages') {
    router.replace(pageRouteBase.value)
  }
}

const setViewMode = (mode) => {
  if (mode === 'pages' && !canViewPagesTab.value)
    return
  if (mode === 'posts' && !canViewPostsTab.value)
    return
  if (mode === 'submissions' && !canViewInboxTab.value)
    return
  if (state.viewMode === mode)
    return
  state.viewMode = mode
  state.selectedPostId = ''
  if (mode !== 'submissions')
    state.selectedSubmissionId = ''
  if (props.page)
    router.replace(pageRouteBase.value)
}

const handlePostSelect = (postId) => {
  if (!postId)
    return
  if (!canViewPostsTab.value)
    return
  state.selectedPostId = postId
  state.viewMode = 'posts'
  if (props.page)
    router.replace(pageRouteBase.value)
}

const clearPostSelection = () => {
  state.selectedPostId = ''
}

watch(() => state.importPageDocIdDialogOpen, (open) => {
  if (!open && pageImportDocIdResolver.value) {
    const resolver = pageImportDocIdResolver.value
    pageImportDocIdResolver.value = null
    resolver('')
  }
})

watch(() => state.importPageConflictDialogOpen, (open) => {
  if (!open && pageImportConflictResolver.value) {
    const resolver = pageImportConflictResolver.value
    pageImportConflictResolver.value = null
    resolver('cancel')
  }
})

watch (() => siteData.value, () => {
  if (isTemplateSite.value)
    return
  if (siteData.value?.menus) {
    console.log('Loading menus from site data')
    state.saving = true
    state.menus = JSON.parse(JSON.stringify(siteData.value.menus))
    state.saving = false
  }
}, { immediate: true, deep: true })

const buildTemplateMenus = (pagesCollection) => {
  const items = Object.entries(pagesCollection || {})
    .map(([id, doc]) => ({
      name: doc?.name || 'Untitled Page',
      item: id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    'Site Root': items,
  }
}

watch(pages, (pagesCollection) => {
  if (!isTemplateSite.value)
    return
  const nextMenu = buildTemplateMenus(pagesCollection)
  if (areEqualNormalized(state.menus, nextMenu))
    return
  state.menus = nextMenu
}, { immediate: true, deep: true })

watch(() => props.page, (next) => {
  if (next) {
    state.selectedPostId = ''
    if (canViewPagesTab.value) {
      state.viewMode = 'pages'
    }
    else {
      state.viewMode = defaultViewMode.value
      if (props.page)
        router.replace(pageRouteBase.value)
    }
    return
  }
  if (state.selectedPostId && canViewPostsTab.value) {
    state.viewMode = 'posts'
    return
  }
  ensureValidViewMode()
})

watch(cmsTabAccess, () => {
  ensureValidViewMode()
}, { immediate: true, deep: true })

watch(canEditSiteSettings, (allowed) => {
  if (!allowed && state.siteSettings) {
    state.siteSettings = false
  }
}, { immediate: true })

watch([isViewingSubmissions, sortedSubmissionIds], () => {
  if (!isViewingSubmissions.value)
    return
  const ids = sortedSubmissionIds.value
  if (!ids.length) {
    state.selectedSubmissionId = ''
    return
  }
  if (!state.selectedSubmissionId || !submissionsMap.value?.[state.selectedSubmissionId]) {
    state.selectedSubmissionId = ids[0]
    markSubmissionRead(ids[0])
  }
}, { immediate: true })

watch(() => state.menus, async (newVal) => {
  if (areEqualNormalized(siteData.value.menus, newVal)) {
    return
  }
  if (!state.mounted) {
    return
  }
  if (state.saving) {
    return
  }
  state.saving = true
  // todo loop through menus and if any item is a blank string use the name {name:'blah', item: ''} and used edgeFirebase to add that page and wait for complete and put docId as value of item
  const newPage = JSON.parse(JSON.stringify(pageInit))
  for (const [menuName, items] of Object.entries(newVal)) {
    for (const [index, item] of items.entries()) {
      if (isExternalLinkEntry(item))
        continue
      if (typeof item.item === 'string') {
        if (item.item === '') {
          newPage.name = item.name
          console.log('Creating new page for menu item:', item)
          const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, newPage)
          const docId = result?.meta?.docId
          item.item = docId
        }
        else {
          if (item.name === 'Deleting...') {
            await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, item.item)
            state.menus[menuName].splice(index, 1)
          }
        }
      }
      if (typeof item.item === 'object' && !isExternalLinkEntry(item)) {
        for (const [subMenuName, subItems] of Object.entries(item.item)) {
          for (const [subIndex, subItem] of subItems.entries()) {
            if (isExternalLinkEntry(subItem))
              continue
            if (typeof subItem.item === 'string') {
              if (subItem.item === '') {
                newPage.name = subItem.name
                const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, newPage)
                const docId = result?.meta?.docId
                subItem.item = docId
              }
              else {
                if (subItem.name === 'Deleting...') {
                  await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`, subItem.item)
                  state.menus[menuName][index].item[subMenuName].splice(subIndex, 1)
                }
              }
            }
          }
        }
        if (Object.keys(item.item).length === 0) {
          state.menus[menuName].splice(index, 1)
        }
      }
    }
  }
  if (!isTemplateSite.value)
    await edgeFirebase.changeDoc(`${edgeGlobal.edgeState.organizationDocPath}/sites`, props.site, { menus: state.menus })
  state.saving = false
}, { deep: true })

const formErrors = (error) => {
  console.log('Form errors:', error)
  console.log(Object.values(error))
  if (Object.values(error).length > 0) {
    console.log('Form errors found')
    state.hasError = true
    console.log(state.hasError)
  }
  state.hasError = false
}

const onSubmit = () => {
  if (!state.hasError) {
    state.siteSettings = false
  }
}

const isAllPagesPublished = computed(() => {
  const pagesData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  return Object.keys(pagesData).length === Object.keys(publishedData).length
})

const isSiteSettingPublished = computed(() => {
  const publishedSite = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site]
  return !!publishedSite
})

const isAnyPagesDiff = computed(() => {
  const pagesData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`] || {}
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  for (const [pageId, pageData] of Object.entries(pagesData)) {
    const publishedPage = publishedData?.[pageId]
    if (!publishedPage) {
      return true
    }
    if (!areEqualNormalized(
      {
        content: pageData.content,
        postContent: pageData.postContent,
        structure: pageData.structure,
        postStructure: pageData.postStructure,
        metaTitle: pageData.metaTitle,
        metaDescription: pageData.metaDescription,
        structuredData: pageData.structuredData,
        postMetaTitle: pageData.postMetaTitle,
        postMetaDescription: pageData.postMetaDescription,
        postStructuredData: pageData.postStructuredData,
      },
      {
        content: publishedPage.content,
        postContent: publishedPage.postContent,
        structure: publishedPage.structure,
        postStructure: publishedPage.postStructure,
        metaTitle: publishedPage.metaTitle,
        metaDescription: publishedPage.metaDescription,
        structuredData: publishedPage.structuredData,
        postMetaTitle: publishedPage.postMetaTitle,
        postMetaDescription: publishedPage.postMetaDescription,
        postStructuredData: publishedPage.postStructuredData,
      },
    )) {
      return true
    }
  }
  return false
})

const isAnyPagesPublished = computed(() => {
  const publishedData = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`] || {}
  return Object.keys(publishedData).length > 0
})

const pageSettingsUpdated = async (pageData) => {
  console.log('Page settings updated:', pageData)
  state.updating = true
  await nextTick()
  state.updating = false
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-editor
      v-if="!props.page && props.site === 'new' && canCreateSite"
      collection="sites"
      :doc-id="props.site"
      :schema="schemas.sites"
      :new-doc-schema="state.newDocs.sites"
      class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none"
      :show-footer="false"
      @saved="handleNewSiteSaved"
    >
      <template #header-start="slotProps">
        <FilePenLine class="mr-2" />
        {{ slotProps.title }}
      </template>
      <template #header-end="slotProps">
        <edge-shad-button
          v-if="!slotProps.unsavedChanges"
          to="/app/dashboard/sites"
          class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Close
        </edge-shad-button>
        <edge-shad-button
          v-else
          to="/app/dashboard/sites"
          class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Cancel
        </edge-shad-button>
        <edge-shad-button
          type="submit"
          class="bg-slate-500 uppercase h-8 hover:bg-slate-400 w-20"
        >
          Save
        </edge-shad-button>
      </template>
      <template #main="slotProps">
        <div class="flex-col flex gap-4 mt-4">
          <edge-shad-input
            v-model="slotProps.workingDoc.name"
            name="name"
            label="Name"
            placeholder="Enter name"
            class="w-full"
          />
          <edge-shad-tags
            v-model="slotProps.workingDoc.domains"
            name="domains"
            label="Domains"
            placeholder="Add or remove domains"
            class="w-full"
          />
          <edge-shad-select-tags
            v-if="isAdmin"
            :model-value="Array.isArray(slotProps.workingDoc.allowedThemes) ? slotProps.workingDoc.allowedThemes : []"
            name="allowedThemes"
            label="Allowed Themes"
            placeholder="Select allowed themes"
            class="w-full"
            :items="themeOptions"
            item-title="label"
            item-value="value"
            @update:model-value="(value) => {
              const normalized = Array.isArray(value) ? value : []
              slotProps.workingDoc.allowedThemes = normalized
              if (normalized.length && !normalized.includes(slotProps.workingDoc.theme)) {
                slotProps.workingDoc.theme = normalized[0] || ''
              }
            }"
          />
          <edge-shad-select
            :model-value="slotProps.workingDoc.theme || ''"
            name="theme"
            label="Theme"
            placeholder="Select a theme"
            class="w-full"
            :items="themeItemsForAllowed(isAdmin ? slotProps.workingDoc.allowedThemes : themeOptions.map(option => option.value), slotProps.workingDoc.theme)"
            item-title="label"
            item-value="value"
            @update:model-value="value => (slotProps.workingDoc.theme = value || '')"
          />
          <edge-shad-select-tags
            v-if="!cmsMultiOrg && Object.keys(orgUsers).length > 0"
            :model-value="getSiteUsersModel(slotProps.workingDoc)"
            :disabled="shouldForceCurrentUserForNewSite || !edgeGlobal.isAdminGlobal(edgeFirebase).value"
            :items="userOptions"
            name="users"
            label="Users"
            item-title="label"
            item-value="value"
            placeholder="Select users"
            class="w-full"
            :multiple="true"
            @update:model-value="value => updateSiteUsersModel(slotProps.workingDoc, value)"
          />
          <div class="rounded-lg border border-dashed border-slate-200 p-4 ">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-foreground">
                  AI (optional)
                </div>
                <p class="text-xs text-muted-foreground">
                  Include user data and instructions for the first AI-generated version of the site.
                </p>
              </div>
              <!-- <edge-shad-switch
                v-model="state.aiSectionOpen"
                name="enableAi"
                label="Add AI details"
              /> -->
            </div>
            <div class="space-y-3">
              <edge-shad-select
                v-if="!cmsMultiOrg"
                :model-value="slotProps.workingDoc.aiAgentUserId || ''"
                name="aiAgentUserId"
                label="User Data for AI to use to build initial site"
                placeholder="- select one -"
                class="w-full"
                :items="aiUserOptions"
                item-title="label"
                item-value="value"
                @update:model-value="value => (slotProps.workingDoc.aiAgentUserId = value || '')"
              />
              <edge-shad-textarea
                v-model="slotProps.workingDoc.aiInstructions"
                name="aiInstructions"
                label="Additional AI instructions"
                placeholder="Share any goals, tone, or details the AI should prioritize"
                class="w-full"
              />
            </div>
          </div>
        </div>
      </template>
    </edge-editor>
    <div v-else-if="!props.page && props.site === 'new' && !canCreateSite" class="p-6 text-sm text-red-600">
      Only organization admins can create sites.
    </div>
    <div v-else class="flex flex-col h-[calc(100vh-58px)] overflow-hidden">
      <div
        class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2 border bg-secondary"
        :class="isTemplateSite ? 'min-h-[68px]' : ''"
      >
        <div class="flex items-center gap-3">
          <FileStack class="w-5 h-5" />
          <span class="text-lg font-normal">
            {{ siteData.name || 'Templates' }}
          </span>
        </div>
        <div class="flex justify-center">
          <div v-if="!isTemplateSite && (canViewPagesTab || canViewPostsTab || canViewInboxTab)" class="flex items-center rounded-full border border-border bg-background p-1 shadow-sm">
            <edge-shad-button
              v-if="canViewPagesTab"
              variant="ghost"
              size="sm"
              class="h-8 px-4 text-xs gap-2 rounded-full"
              :class="state.viewMode === 'pages' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="setViewMode('pages')"
            >
              <FileStack class="h-4 w-4" />
              Pages
            </edge-shad-button>
            <edge-shad-button
              v-if="canViewPostsTab"
              variant="ghost"
              size="sm"
              class="h-8 px-4 text-xs gap-2 rounded-full"
              :class="state.viewMode === 'posts' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="setViewMode('posts')"
            >
              <FilePenLine class="h-4 w-4" />
              Posts
            </edge-shad-button>
            <edge-shad-button
              v-if="canViewInboxTab"
              variant="ghost"
              size="sm"
              class="h-8 px-4 text-xs gap-2 rounded-full"
              :class="state.viewMode === 'submissions' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="setViewMode('submissions')"
            >
              <Inbox class="h-4 w-4" />
              Inbox
              <span
                v-if="unreadSubmissionsCount"
                class="ml-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground"
              >
                {{ unreadSubmissionsCount }}
              </span>
            </edge-shad-button>
          </div>
        </div>
        <div class="flex items-center gap-3 justify-end">
          <input
            ref="pageImportInputRef"
            type="file"
            multiple
            accept=".json,application/json"
            class="hidden"
            @change="handlePageImport"
          >
          <edge-shad-button
            type="button"
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :disabled="state.importingPages"
            title="Import Page"
            aria-label="Import Page"
            @click="triggerPageImport"
          >
            <Loader2 v-if="state.importingPages" class="h-3.5 w-3.5 animate-spin" />
            <Upload v-else class="h-3.5 w-3.5" />
          </edge-shad-button>
          <template v-if="!isTemplateSite && !hidePublishStatusAndActions">
            <Transition name="fade" mode="out-in">
              <div v-if="isSiteDiff || isAnyPagesDiff" key="unpublished" class="flex gap-2 items-center">
                <div class="flex gap-1 items-center bg-yellow-100 text-xs py-1 px-3 text-yellow-800 rounded">
                  <CircleAlert class="!text-yellow-800 w-3 h-6" />
                  <span class="font-medium text-[10px]">
                    {{ isSiteDiff ? (useMenuPublishLabels ? 'Unpublished Menu' : 'Unpublished Settings') : 'Unpublished Pages' }}
                  </span>
                </div>
                <edge-shad-button
                  class="h-8 px-4 text-xs gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  :disabled="state.publishSiteLoading"
                  @click="publishSiteAndSettings"
                >
                  <Loader2 v-if="state.publishSiteLoading" class="h-3.5 w-3.5 animate-spin" />
                  <FolderUp v-else class="h-3.5 w-3.5" />
                  Publish Site
                </edge-shad-button>
              </div>
              <div v-else key="published" class="flex gap-1 items-center bg-green-100 text-xs py-1 px-3 text-green-800 rounded">
                <FileCheck class="!text-green-800 w-3 h-6" />
                <span class="font-medium text-[10px]">
                  {{ useMenuPublishLabels ? 'Menu Published' : 'Settings Published' }}
                </span>
              </div>
            </Transition>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <edge-shad-button variant="outline" size="icon" class="h-9 w-9">
                  <MoreHorizontal />
                </edge-shad-button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuLabel class="flex items-center gap-2">
                  <FileStack class="w-5 h-5" />{{ siteData.name || 'Templates' }}
                </DropdownMenuLabel>

                <DropdownMenuSeparator v-if="isSiteDiff" />
                <DropdownMenuLabel v-if="isSiteDiff" class="flex items-center gap-2">
                  Site Settings
                </DropdownMenuLabel>

                <DropdownMenuItem v-if="isSiteDiff" class="pl-4 text-xs" @click="publishSiteSettings">
                  <FolderUp />
                  Publish
                </DropdownMenuItem>
                <DropdownMenuItem v-if="isSiteDiff && isSiteSettingPublished" class="pl-4 text-xs" @click="discardSiteSettings">
                  <FolderX />
                  Discard Changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem v-if="isAnyPagesDiff" @click="publishSite">
                  <FolderUp />
                  Publish All Pages
                </DropdownMenuItem>
                <DropdownMenuItem v-if="isSiteSettingPublished || isAnyPagesPublished" @click="unPublishSite">
                  <FolderDown />
                  Unpublish Site
                </DropdownMenuItem>

                <DropdownMenuItem v-if="canEditSiteSettings" @click="state.siteSettings = true">
                  <FolderCog />
                  <span>Settings</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
        </div>
      </div>
      <div class="flex-1 min-h-0">
        <Transition name="fade" mode="out-in">
          <div v-if="isViewingSubmissions" class="flex-1 overflow-y-auto p-6">
            <edge-dashboard
              :collection="submissionsCollection"
              query-field="action"
              query-value="Contact Form"
              query-operator="=="
              :filter="state.submissionFilter"
              :filter-fields="['data.name', 'data.fullName', 'data.firstName', 'data.lastName', 'data.email', 'data.phone', 'data.message', 'data.comments', 'data.notes']"
              sort-field="timestamp"
              sort-direction="desc"
              class="pt-0 flex-1"
            >
              <template #header-start>
                <Inbox class="mr-2 h-4 w-4" />
                Submissions
                <!-- <span class="ml-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Contact Form
                </span> -->
              </template>
              <template #header-center>
                <div class="w-full px-4 md:px-6">
                  <edge-shad-input
                    v-model="state.submissionFilter"
                    name="submissionFilter"
                    placeholder="Search submissions..."
                    class="w-full"
                  />
                </div>
              </template>
              <template #header-end="slotProps">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ slotProps.recordCount }} total • {{ unreadSubmissionsCount }} unread
                </span>
              </template>
              <template #list="slotProps">
                <div class="grid gap-4 pt-4 w-full md:grid-cols-[320px_minmax(0,1fr)]">
                  <div class="space-y-2">
                    <div
                      v-for="item in slotProps.filtered"
                      :key="item.docId"
                      role="button"
                      tabindex="0"
                      class="group rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-muted/60"
                      :class="state.selectedSubmissionId === item.docId ? 'border-primary/70 bg-muted/70 shadow-sm' : 'border-border/60 bg-card'"
                      @click="state.selectedSubmissionId = item.docId; markSubmissionRead(item.docId)"
                      @keyup.enter="state.selectedSubmissionId = item.docId; markSubmissionRead(item.docId)"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-semibold text-foreground">
                            {{ getSubmissionLabel(item.data) }}
                          </div>
                          <div v-if="item.data?.pageName" class="truncate text-xs text-muted-foreground">
                            {{ item.data.pageName }}
                          </div>
                        </div>
                        <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span v-if="isSubmissionUnread(item)" class="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                            Unread
                          </span>
                          <span>{{ formatSubmissionTimestamp(item.timestamp) }}</span>
                        </div>
                      </div>
                      <div v-if="getSubmissionMessage(item.data)" class="mt-2 text-xs text-muted-foreground line-clamp-2">
                        {{ getSubmissionMessage(item.data) }}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Card v-if="selectedSubmission" class="border border-border/70 bg-card/95 shadow-sm">
                      <CardHeader class="flex flex-col gap-2">
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <CardTitle class="text-xl">
                              {{ getSubmissionLabel(selectedSubmission.data) }}
                            </CardTitle>
                            <CardDescription class="text-xs">
                              {{ formatSubmissionTimestamp(selectedSubmission.timestamp) }}
                            </CardDescription>
                          </div>
                          <div class="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <span>
                              {{ selectedSubmission.data?.pageName || selectedSubmission.data?.pageId || 'Site submission' }}
                            </span>
                            <edge-shad-button
                              v-if="isSubmissionUnread(selectedSubmission)"
                              size="sm"
                              variant="outline"
                              class="h-7 gap-2 text-[11px]"
                              @click="markSubmissionRead(selectedSubmission.docId)"
                            >
                              <MailOpen class="h-3.5 w-3.5" />
                              Mark read
                            </edge-shad-button>
                            <edge-shad-button
                              v-else
                              size="sm"
                              variant="outline"
                              class="h-7 gap-2 text-[11px]"
                              @click="markSubmissionUnread(selectedSubmission.docId)"
                            >
                              <Mail class="h-3.5 w-3.5" />
                              Mark unread
                            </edge-shad-button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent class="space-y-4">
                        <div
                          v-if="getSubmissionMessage(selectedSubmission.data)"
                          class="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-foreground"
                        >
                          {{ getSubmissionMessage(selectedSubmission.data) }}
                        </div>
                        <div class="grid gap-3 md:grid-cols-2">
                          <div
                            v-for="entry in collectSubmissionEntries(selectedSubmission.data)"
                            :key="entry.key"
                            class="rounded-lg border border-border/60 bg-background p-3"
                          >
                            <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {{ formatSubmissionKey(entry.key) }}
                            </div>
                            <div class="mt-1 text-sm text-foreground break-words">
                              {{ formatSubmissionValue(entry.value) }}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card v-else class="border border-dashed border-border/80 bg-muted/30">
                      <CardContent class="py-12 text-center text-sm text-muted-foreground">
                        Select a submission to view details.
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </template>
            </edge-dashboard>
          </div>
          <div v-else-if="isEditingPost" class="w-full h-full">
            <edge-cms-posts
              mode="editor"
              :site="props.site"
              :selected-post-id="state.selectedPostId"
              @update:selected-post-id="clearPostSelection"
            />
          </div>
          <ResizablePanelGroup v-else-if="showSplitView" direction="horizontal" class="w-full h-full flex-1 min-h-0">
            <ResizablePanel class="bg-primary-foreground text-black min-h-0 overflow-hidden" :default-size="16">
              <SidebarGroup class="mt-0 pt-0 h-full min-h-0">
                <SidebarGroupContent class="h-full min-h-0 overflow-y-auto">
                  <SidebarMenu class="pb-4">
                    <template v-if="isTemplateSite || (canViewPagesTab && state.viewMode === 'pages')">
                      <edge-cms-menu
                        v-if="state.menus"
                        v-model="state.menus"
                        :site="props.site"
                        :page="props.page"
                        :is-template-site="isTemplateSite"
                        :theme-options="themeOptions"
                        @page-settings-update="pageSettingsUpdated"
                      />
                    </template>
                    <template v-else>
                      <edge-cms-posts
                        mode="list"
                        list-variant="sidebar"
                        :site="props.site"
                        @updating="isUpdating => state.updating = isUpdating"
                        @update:selected-post-id="handlePostSelect"
                      />
                    </template>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </ResizablePanel>
            <ResizablePanel ref="mainPanel" class="min-h-0">
              <Transition name="fade" mode="out-in">
                <div v-if="props.page && !state.updating" :key="props.page" class="max-h-[calc(100vh-100px)] overflow-y-auto w-full">
                  <NuxtPage class="flex flex-col flex-1 px-0 mx-0 pt-0" />
                </div>
                <div v-else class="p-4 text-center flex text-slate-500 h-[calc(100vh-4rem)] justify-center items-center overflow-y-auto">
                  <div class="text-4xl">
                    <ArrowLeft class="inline-block w-12 h-12 mr-2" /> Select a page to get started.
                  </div>
                </div>
              </Transition>
            </ResizablePanel>
          </ResizablePanelGroup>
          <div v-else class="flex-1 overflow-y-auto p-6">
            <div class="mx-auto w-full max-w-5xl space-y-6">
              <edge-cms-posts
                mode="list"
                list-variant="full"
                :site="props.site"
                @updating="isUpdating => state.updating = isUpdating"
                @update:selected-post-id="handlePostSelect"
              />
            </div>
          </div>
        </Transition>
      </div>
    </div>
    <edge-shad-dialog v-model="state.importPageDocIdDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Enter Page Doc ID
          </DialogTitle>
          <DialogDescription>
            This file does not include a <code>docId</code>. Enter the doc ID you want to import into this site.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input
          v-model="state.importPageDocIdValue"
          name="site-page-import-doc-id"
          label="Doc ID"
          placeholder="example-page-id"
        />
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolvePageImportDocId('')">
            Cancel
          </edge-shad-button>
          <edge-shad-button @click="resolvePageImportDocId(state.importPageDocIdValue)">
            Continue
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importPageConflictDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Page Already Exists
          </DialogTitle>
          <DialogDescription>
            <code>{{ state.importPageConflictDocId }}</code> already exists in this {{ isTemplateSite ? 'template library' : 'site' }}. Choose to overwrite it or import as a new page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button variant="outline" @click="resolvePageImportConflict('cancel')">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="outline" @click="resolvePageImportConflict('new')">
            Add As New
          </edge-shad-button>
          <edge-shad-button @click="resolvePageImportConflict('overwrite')">
            Overwrite
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <edge-shad-dialog v-model="state.importPageErrorDialogOpen">
      <DialogContent class="pt-8">
        <DialogHeader>
          <DialogTitle class="text-left">
            Import Failed
          </DialogTitle>
          <DialogDescription class="text-left">
            {{ state.importPageErrorMessage }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2">
          <edge-shad-button @click="state.importPageErrorDialogOpen = false">
            Close
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
    <Sheet v-if="canEditSiteSettings" v-model:open="state.siteSettings">
      <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>{{ siteData.name || 'Site' }}</SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <edge-editor
          collection="sites"
          :doc-id="props.site"
          :schema="schemas.sites"
          :new-doc-schema="state.newDocs.sites"
          class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none px-0 mx-0 shadow-none"
          :show-footer="false"
          :show-header="false"
          :save-function-override="onSubmit"
          card-content-class="px-0"
          @error="formErrors"
        >
          <template #main="slotProps">
            <div class="p-6 h-[calc(100vh-140px)] overflow-y-auto">
              <edge-cms-site-settings-form
                :settings="slotProps.workingDoc"
                :theme-options="themeOptions"
                :user-options="userOptions"
                :has-users="Object.keys(orgUsers).length > 0"
                :show-users="!cmsMultiOrg"
                :show-theme-fields="true"
                :is-admin="isAdmin"
                :enable-media-picker="true"
                :site-id="props.site"
                :domain-error="domainError"
                :settings-open="state.siteSettings"
              />
            </div>
            <SheetFooter class="pt-2 flex justify-between">
              <edge-shad-button variant="destructive" class="text-white" @click="state.siteSettings = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button :disabled="slotProps.submitting || isJsonInvalid(slotProps.workingDoc?.structuredData)" type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
                <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
                Update
              </edge-shad-button>
            </SheetFooter>
          </template>
        </edge-editor>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
