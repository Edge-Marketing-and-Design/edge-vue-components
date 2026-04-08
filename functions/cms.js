const axios = require('axios')
const Stripe = require('stripe')
const {
  logger,
  admin,
  db,
  pubsub,
  onCall,
  HttpsError,
  onDocumentUpdated,
  onDocumentWritten,
  onDocumentDeleted,
  onDocumentCreated,
  onMessagePublished,
  onSchedule,
  onRequest,
  Firestore,
  permissionCheck,
} = require('./config.js')

const { createKvMirrorHandler } = require('./kv/kvMirror')

const SITE_AI_TOPIC = 'site-ai-bootstrap'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const HISTORY_API_KEY = process.env.HISTORY_API_KEY || ''
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || ''
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
const CLOUDFLARE_PAGES_API_TOKEN = process.env.CLOUDFLARE_PAGES_API_TOKEN || ''
const CLOUDFLARE_PAGES_PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || ''
const DOMAIN_REGISTRY_COLLECTION = 'domain-registry'

const SITE_STRUCTURED_DATA_TEMPLATE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': '{{cms-site}}#website',
  'name': '',
  'url': '{{cms-site}}',
  'description': '',
  'publisher': {
    '@type': 'Organization',
    'name': '',
    'logo': {
      '@type': 'ImageObject',
      'url': '{{cms-logo}}',
    },
  },
  'sameAs': [],
}, null, 2)

const PAGE_STRUCTURED_DATA_TEMPLATE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': '{{cms-site}}#webpage',
  'name': '',
  'url': '{{cms-url}}',
  'description': '',
  'isPartOf': {
    '@id': '{{cms-site}}#website',
  },
}, null, 2)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const allowCors = (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return true
  }
  return false
}

const parseBody = (req) => {
  if (!req?.body)
    return null
  if (typeof req.body === 'object')
    return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    }
    catch {
      return null
    }
  }
  return null
}

const getForwardedFor = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  if (!forwarded)
    return ''
  if (Array.isArray(forwarded))
    return forwarded.join(', ')
  return String(forwarded)
}

const getClientIp = (req) => {
  const forwarded = getForwardedFor(req)
  if (forwarded)
    return forwarded.split(',')[0].trim()
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || ''
}

const parseBrowser = (ua) => {
  if (!ua)
    return ''
  if (/Edg\//i.test(ua))
    return 'Edge'
  if (/OPR\//i.test(ua))
    return 'Opera'
  if (/Chrome\//i.test(ua))
    return 'Chrome'
  if (/Firefox\//i.test(ua))
    return 'Firefox'
  if (/Safari\//i.test(ua) && /Version\//i.test(ua))
    return 'Safari'
  return 'Other'
}

const parseOs = (ua) => {
  if (!ua)
    return ''
  if (/Windows NT/i.test(ua))
    return 'Windows'
  if (/Mac OS X/i.test(ua))
    return 'macOS'
  if (/Android/i.test(ua))
    return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua))
    return 'iOS'
  if (/Linux/i.test(ua))
    return 'Linux'
  return 'Other'
}

const SITE_USER_META_FIELDS = [
  'contactEmail',
  'contactPhone',
  'socialFacebook',
  'socialInstagram',
  'socialTwitter',
  'socialLinkedIn',
  'socialYouTube',
  'socialTikTok',
]
const DEFAULT_CONTACT_FORM_SUBJECT = 'Contact Form Submission'

const pickSyncFields = (source = {}) => {
  const payload = {}
  for (const field of SITE_USER_META_FIELDS) {
    payload[field] = source?.[field] ?? ''
  }
  return payload
}

const buildUpdateDiff = (current = {}, next = {}) => {
  const update = {}
  for (const [key, value] of Object.entries(next)) {
    if (current?.[key] !== value) {
      update[key] = value
    }
  }
  return update
}

const normalizeForStableCompare = (value) => {
  if (Array.isArray(value))
    return value.map(item => normalizeForStableCompare(item))
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForStableCompare(value[key])
      return acc
    }, {})
  }
  return value
}

const stableSerialize = value => JSON.stringify(normalizeForStableCompare(value))

const resolveStagedUserRef = async (userIdOrDocId) => {
  if (!userIdOrDocId)
    return null

  const byDocRef = db.collection('staged-users').doc(userIdOrDocId)
  const byDocSnap = await byDocRef.get()
  if (byDocSnap.exists)
    return byDocRef

  const querySnap = await db.collection('staged-users')
    .where('userId', '==', userIdOrDocId)
    .limit(1)
    .get()

  if (querySnap.empty)
    return null

  return querySnap.docs[0].ref
}

const parseDevice = (ua, headers) => {
  const mobileHint = headers['sec-ch-ua-mobile']
  if (mobileHint === '?1')
    return 'mobile'
  if (mobileHint === '?0')
    return 'desktop'
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua || ''))
    return 'mobile'
  return 'desktop'
}

const getOrgIdFromPath = (path) => {
  const trimmed = String(path || '').split('?')[0]
  const parts = trimmed.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'history')
    return ''
  return parts[2] || ''
}

const getApiKey = (req) => {
  const headers = req.headers || {}
  const headerKey = String(headers['x-api-key'] || '').trim()
  const authHeader = String(headers.authorization || '').trim()
  if (authHeader.toLowerCase().startsWith('bearer '))
    return authHeader.slice(7).trim()
  return headerKey
}

const normalizeEmail = (value) => {
  if (!value)
    return ''
  const trimmed = String(value).trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : ''
}

const normalizeEmailList = (value) => {
  if (Array.isArray(value))
    return value.map(item => normalizeEmail(item)).filter(Boolean)
  const single = normalizeEmail(value)
  return single ? [single] : []
}

const syncAudienceHistoryUuidForUser = async ({
  orgId,
  siteId,
  userId,
  historyUuid,
}) => {
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  const normalizedUserId = String(userId || '').trim()
  const normalizedHistoryUuid = String(historyUuid || '').trim()
  if (!normalizedOrgId || !normalizedSiteId || !normalizedUserId || !normalizedHistoryUuid)
    return

  const userSnap = await db.collection('users').doc(normalizedUserId).get()
  if (!userSnap.exists) {
    logger.warn('History sync user not found', { orgId: normalizedOrgId, siteId: normalizedSiteId, userId: normalizedUserId })
    return
  }

  const userData = userSnap.data() || {}
  const email = normalizeEmail(userData?.meta?.email || userData?.email || userData?.contactEmail || '')
  const name = String(userData?.meta?.name || userData?.name || '').trim()
  if (!email) {
    logger.warn('History sync user email missing', { orgId: normalizedOrgId, siteId: normalizedSiteId, userId: normalizedUserId })
    return
  }

  const audienceUsersRef = db.collection('organizations').doc(normalizedOrgId)
    .collection('sites').doc(normalizedSiteId)
    .collection('audience-users')
  const audienceByEmailSnap = await audienceUsersRef.where('email', '==', email).limit(1).get()
  const nowMs = Date.now()

  if (!audienceByEmailSnap.empty) {
    const audienceDoc = audienceByEmailSnap.docs[0]
    const audienceData = audienceDoc.data() || {}
    const updatePayload = {
      email,
      history_uuid: Firestore.FieldValue.arrayUnion(normalizedHistoryUuid),
      last_updated: nowMs,
    }
    if (name && !String(audienceData.name || '').trim())
      updatePayload.name = name
    if (!String(audienceData.authUid || '').trim())
      updatePayload.authUid = normalizedUserId
    await audienceDoc.ref.set(updatePayload, { merge: true })
    return
  }

  await audienceUsersRef.add({
    name,
    email,
    authUid: normalizedUserId,
    history_uuid: [normalizedHistoryUuid],
    doc_created_at: nowMs,
    last_updated: nowMs,
  })
}

const normalizeDomain = (value) => {
  if (!value)
    return ''
  let normalized = String(value).trim().toLowerCase()
  if (!normalized)
    return ''
  if (normalized.includes('://')) {
    try {
      normalized = new URL(normalized).host
    }
    catch {
      normalized = normalized.split('://').pop() || normalized
    }
  }
  normalized = normalized.split('/')[0] || ''
  if (normalized.startsWith('[')) {
    const closingIndex = normalized.indexOf(']')
    if (closingIndex !== -1)
      normalized = normalized.slice(0, closingIndex + 1)
  }
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    normalized = normalized.split(':')[0] || ''
  }
  return normalized.replace(/\.+$/g, '')
}

const stripIpv6Brackets = (value) => {
  const text = String(value || '').trim()
  if (text.startsWith('[') && text.endsWith(']'))
    return text.slice(1, -1)
  return text
}

const isIpv4Address = (value) => {
  const parts = String(value || '').split('.')
  if (parts.length !== 4)
    return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part))
      return false
    const num = Number(part)
    return num >= 0 && num <= 255
  })
}

const isIpv6Address = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (!normalized.includes(':'))
    return false
  return /^[0-9a-f:]+$/.test(normalized)
}

const isIpAddress = (value) => {
  if (!value)
    return false
  const normalized = stripIpv6Brackets(value)
  return isIpv4Address(normalized) || isIpv6Address(normalized)
}

const getCloudflareApexDomain = (domain) => {
  if (!domain)
    return ''
  if (domain.startsWith('www.'))
    return domain.slice(4)
  return domain
}

const shouldDisplayDomainDnsRecords = (domain) => {
  const normalizedDomain = normalizeDomain(domain)
  const apexDomain = getCloudflareApexDomain(normalizedDomain)
  if (!apexDomain)
    return false
  if (apexDomain === 'localhost' || apexDomain.endsWith('.localhost'))
    return false
  if (isIpAddress(apexDomain))
    return false
  if (apexDomain.endsWith('.dev'))
    return false
  return true
}

const shouldSyncCloudflareDomain = (domain) => {
  if (!domain)
    return false
  if (!shouldDisplayDomainDnsRecords(domain))
    return false
  if (CLOUDFLARE_PAGES_PROJECT) {
    const pagesDomain = `${CLOUDFLARE_PAGES_PROJECT}.pages.dev`
    if (domain === pagesDomain || domain === `www.${pagesDomain}`)
      return false
  }
  return true
}

const getCloudflarePagesDomain = (domain) => {
  if (!domain)
    return ''
  if (domain.startsWith('www.'))
    return domain
  return `www.${domain}`
}

const getCloudflarePagesTarget = () => {
  if (!CLOUDFLARE_PAGES_PROJECT)
    return ''
  return `${CLOUDFLARE_PAGES_PROJECT}.pages.dev`
}

const buildDomainDnsPayload = (domain, pagesTarget = '') => {
  const normalizedDomain = normalizeDomain(domain)
  const apexDomain = getCloudflareApexDomain(normalizedDomain)
  const wwwDomain = getCloudflarePagesDomain(apexDomain)
  const target = pagesTarget || getCloudflarePagesTarget()
  const dnsEligible = shouldDisplayDomainDnsRecords(apexDomain)

  return {
    domain: normalizedDomain,
    apexDomain,
    wwwDomain,
    dnsEligible,
    dnsRecords: {
      target,
      www: {
        type: 'CNAME',
        name: 'www',
        host: wwwDomain,
        value: target,
        enabled: dnsEligible && !!target,
      },
      apex: {
        type: 'CNAME',
        name: '@',
        host: apexDomain,
        value: target,
        enabled: dnsEligible && !!target,
      },
    },
  }
}

const isCloudflareDomainAlreadyExistsError = (status, errors = [], message = '') => {
  if (status === 409)
    return true
  const errorMessages = errors.map(err => String(err?.message || '').toLowerCase())
  if (errorMessages.some(text => text.includes('already exists')))
    return true
  if (errorMessages.some(text => text.includes('already added')))
    return true
  const lowerMessage = String(message || '').toLowerCase()
  return lowerMessage.includes('already exists') || lowerMessage.includes('already added')
}

const addCloudflarePagesDomain = async (domain, context = {}) => {
  if (!CF_ACCOUNT_ID || !CLOUDFLARE_PAGES_API_TOKEN || !CLOUDFLARE_PAGES_PROJECT) {
    logger.warn('Cloudflare Pages domain sync skipped: missing env vars', {
      domain,
      missingAccount: !CF_ACCOUNT_ID,
      missingToken: !CLOUDFLARE_PAGES_API_TOKEN,
      missingProject: !CLOUDFLARE_PAGES_PROJECT,
      ...context,
    })
    return { ok: false, error: 'Cloudflare Pages env vars missing.' }
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${CLOUDFLARE_PAGES_PROJECT}/domains`
  try {
    const response = await axios.post(url, { name: domain }, {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_PAGES_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    if (response?.data?.success) {
      logger.log('Cloudflare Pages domain added', { domain, ...context })
      return { ok: true }
    }
    logger.warn('Cloudflare Pages domain add response not successful', {
      domain,
      errors: response?.data?.errors || [],
      ...context,
    })
    return { ok: false, error: 'Cloudflare Pages domain add response not successful.' }
  }
  catch (error) {
    const status = error?.response?.status || 0
    const errors = error?.response?.data?.errors || []
    const message = error?.message || 'Unknown error'
    const alreadyExists = isCloudflareDomainAlreadyExistsError(status, errors, message)
    if (alreadyExists) {
      logger.log('Cloudflare Pages domain already exists', { domain, ...context })
      return { ok: true }
    }
    logger.error('Cloudflare Pages domain add error', { domain, status, errors, message, ...context })
    const errorMessage = errors.length
      ? errors.map(err => err?.message).filter(Boolean).join('; ')
      : message
    return { ok: false, error: errorMessage || 'Cloudflare Pages domain add error.' }
  }
}

const removeCloudflarePagesDomain = async (domain, context = {}) => {
  if (!CF_ACCOUNT_ID || !CLOUDFLARE_PAGES_API_TOKEN || !CLOUDFLARE_PAGES_PROJECT) {
    logger.warn('Cloudflare Pages domain removal skipped: missing env vars', {
      domain,
      missingAccount: !CF_ACCOUNT_ID,
      missingToken: !CLOUDFLARE_PAGES_API_TOKEN,
      missingProject: !CLOUDFLARE_PAGES_PROJECT,
      ...context,
    })
    return { ok: false, error: 'Cloudflare Pages env vars missing.' }
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${CLOUDFLARE_PAGES_PROJECT}/domains/${domain}`
  try {
    const response = await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_PAGES_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    if (response?.data?.success) {
      logger.log('Cloudflare Pages domain removed', { domain, ...context })
      return { ok: true }
    }
    logger.warn('Cloudflare Pages domain removal response not successful', {
      domain,
      errors: response?.data?.errors || [],
      ...context,
    })
    return { ok: false, error: 'Cloudflare Pages domain removal response not successful.' }
  }
  catch (error) {
    const status = error?.response?.status || 0
    const errors = error?.response?.data?.errors || []
    const message = error?.message || 'Unknown error'
    const alreadyMissing = status === 404
      || errors.some(err => String(err?.message || '').toLowerCase().includes('not found'))
    if (alreadyMissing) {
      logger.log('Cloudflare Pages domain already removed', { domain, ...context })
      return { ok: true }
    }
    logger.error('Cloudflare Pages domain removal error', { domain, status, errors, message, ...context })
    const errorMessage = errors.length
      ? errors.map(err => err?.message).filter(Boolean).join('; ')
      : message
    return { ok: false, error: errorMessage || 'Cloudflare Pages domain removal error.' }
  }
}

const cleanupOwnedPublishedSiteDomains = async (sitePath, { orgId, siteId } = {}) => {
  const normalizedSitePath = String(sitePath || '').trim()
  if (!normalizedSitePath)
    return

  const registrySnap = await db.collection(DOMAIN_REGISTRY_COLLECTION)
    .where('sitePath', '==', normalizedSitePath)
    .get()

  if (registrySnap.empty)
    return

  const removeDomains = Array.from(new Set(
    registrySnap.docs
      .flatMap((doc) => {
        const data = doc.data() || {}
        const normalizedDomain = normalizeDomain(data.domain || doc.id)
        const apexDomain = normalizeDomain(data.apexDomain || getCloudflareApexDomain(normalizedDomain))
        const wwwDomain = normalizeDomain(data.wwwDomain || getCloudflarePagesDomain(apexDomain))
        return [wwwDomain, apexDomain]
      })
      .filter(domain => shouldSyncCloudflareDomain(domain)),
  ))

  if (removeDomains.length) {
    await Promise.all(removeDomains.map(domain => removeCloudflarePagesDomain(domain, {
      orgId,
      siteId,
      trigger: 'published-site-settings-delete',
    })))
  }

  const batch = db.batch()
  registrySnap.docs.forEach((doc) => {
    batch.delete(doc.ref)
  })
  await batch.commit()
}

const shouldSyncFirebaseAuthDomain = (domain) => {
  const normalized = normalizeDomain(domain)
  if (!normalized)
    return false
  if (isIpAddress(normalized))
    return false
  if (normalized === 'localhost' || normalized.endsWith('.localhost'))
    return false
  return true
}

const extractFirebaseAuthDomainsFromRawDomains = (rawDomains = []) => {
  const normalizedDomains = Array.isArray(rawDomains) ? rawDomains : []
  return Array.from(new Set(
    normalizedDomains
      .map(domain => normalizeDomain(domain))
      .filter(Boolean)
      .flatMap((domain) => {
        const apexDomain = getCloudflareApexDomain(domain)
        const wwwDomain = getCloudflarePagesDomain(apexDomain)
        return [apexDomain, wwwDomain]
      })
      .map(domain => normalizeDomain(domain))
      .filter(domain => domain && shouldSyncFirebaseAuthDomain(domain)),
  ))
}

const getFirebaseProjectId = () => {
  return String(
    process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || admin.app()?.options?.projectId
    || '',
  ).trim()
}

const getAdminAccessToken = async () => {
  const credential = admin.app()?.options?.credential
  if (!credential || typeof credential.getAccessToken !== 'function')
    throw new Error('Admin credential does not support getAccessToken().')
  const tokenResult = await credential.getAccessToken()
  const accessToken = String(tokenResult?.access_token || tokenResult?.accessToken || '').trim()
  if (!accessToken)
    throw new Error('Unable to obtain Google API access token from admin credential.')
  return accessToken
}

const syncFirebaseAuthorizedDomainsForMembership = async ({
  addDomains = [],
  removeDomains = [],
  context = {},
} = {}) => {
  const domainsToAdd = Array.from(new Set((Array.isArray(addDomains) ? addDomains : []).map(domain => normalizeDomain(domain)).filter(domain => domain && shouldSyncFirebaseAuthDomain(domain))))
  const domainsToRemoveCandidates = Array.from(new Set((Array.isArray(removeDomains) ? removeDomains : []).map(domain => normalizeDomain(domain)).filter(domain => domain && shouldSyncFirebaseAuthDomain(domain))))

  if (!domainsToAdd.length && !domainsToRemoveCandidates.length)
    return { ok: true, added: [], removed: [], total: 0 }

  const projectId = getFirebaseProjectId()
  if (!projectId) {
    logger.warn('Skipping Firebase Auth authorized domain membership sync: missing project id', context)
    return { ok: false, added: [], removed: [], total: 0, error: 'Missing Firebase project id.' }
  }

  const accessToken = await getAdminAccessToken()
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  const currentResponse = await axios.get(configUrl, { headers })
  const currentAuthorizedDomains = Array.isArray(currentResponse?.data?.authorizedDomains)
    ? currentResponse.data.authorizedDomains.map(value => String(value || '').trim()).filter(Boolean)
    : []
  const nextSet = new Set(currentAuthorizedDomains)

  domainsToAdd.forEach(domain => nextSet.add(domain))

  const removableDomains = domainsToRemoveCandidates
  removableDomains.forEach(domain => nextSet.delete(domain))

  const nextAuthorizedDomains = Array.from(nextSet).sort((a, b) => a.localeCompare(b))
  const changed = nextAuthorizedDomains.length !== currentAuthorizedDomains.length
    || nextAuthorizedDomains.some((domain, index) => domain !== currentAuthorizedDomains[index])

  if (!changed)
    return { ok: true, added: [], removed: [], total: nextAuthorizedDomains.length }

  await axios.patch(`${configUrl}?updateMask=authorizedDomains`, {
    authorizedDomains: nextAuthorizedDomains,
  }, { headers })

  const addedDomains = domainsToAdd.filter(domain => !currentAuthorizedDomains.includes(domain))
  const removedDomains = removableDomains.filter(domain => currentAuthorizedDomains.includes(domain))
  logger.log('Synced Firebase Auth authorized domains for memberships', {
    ...context,
    addedDomains,
    removedDomains,
    totalAuthorizedDomains: nextAuthorizedDomains.length,
  })

  return {
    ok: true,
    added: addedDomains,
    removed: removedDomains,
    total: nextAuthorizedDomains.length,
  }
}

const collectFormEntries = (data) => {
  if (!data || typeof data !== 'object')
    return []

  const entries = []
  const seen = new Set()
  const ignore = new Set(['orgId', 'siteId', 'pageId', 'blockId'])

  const addEntry = (key, value) => {
    if (!key)
      return
    const normalizedKey = String(key).trim()
    if (!normalizedKey)
      return
    const lowerKey = normalizedKey.toLowerCase()
    if (ignore.has(normalizedKey) || ignore.has(lowerKey))
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
    for (const field of fields) {
      if (!field)
        continue
      const name = field.field || field.name || field.fieldName || field.label || field.title
      const value = field.value ?? field.fieldValue ?? field.val
      addEntry(name, value)
    }
  }

  addArrayFields(data.fields)
  addArrayFields(data.formFields)
  addArrayFields(data.formData)

  if (data.fields && typeof data.fields === 'object' && !Array.isArray(data.fields)) {
    for (const [key, value] of Object.entries(data.fields)) {
      addEntry(key, value)
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'fields' || key === 'formFields' || key === 'formData')
      continue
    addEntry(key, value)
  }

  return entries
}

const getReplyToEmail = (data, entries) => {
  if (data && typeof data === 'object') {
    const directKey = Object.keys(data).find(key => key.toLowerCase() === 'email')
    if (directKey) {
      const direct = normalizeEmail(data[directKey])
      if (direct)
        return direct
    }
  }

  const entry = entries.find(item => item.key.toLowerCase() === 'email')
  return normalizeEmail(entry?.value)
}

const getContactFormSubject = (data, entries) => {
  if (data && typeof data === 'object') {
    const directKey = Object.keys(data).find(key => key.toLowerCase() === 'subject')
    if (directKey) {
      const direct = String(data[directKey] || '').trim()
      if (direct)
        return direct
    }
  }

  const entry = entries.find(item => item.key.toLowerCase() === 'subject')
  const value = String(entry?.value || '').trim()
  return value || DEFAULT_CONTACT_FORM_SUBJECT
}

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const formatValue = (value) => {
  if (value === undefined || value === null)
    return ''
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const getPublishedEmailTo = async (orgId, siteId, pageId, blockId) => {
  if (!orgId || !siteId || !pageId || !blockId)
    return []
  const publishedRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('published').doc(pageId)
  const snap = await publishedRef.get()
  if (!snap.exists)
    return []
  const data = snap.data() || {}
  const content = Array.isArray(data.content) ? data.content : []
  const block = content.find(item => String(item?.id || '') === blockId || String(item?.blockId || '') === blockId)
  if (!block)
    return []
  const emailTo = block?.values?.emailTo ?? block?.emailTo ?? ''
  return normalizeEmailList(emailTo)
}

const getSiteSettingsEmail = async (orgId, siteId) => {
  if (!orgId || !siteId)
    return ''
  const publishedRef = db.collection('organizations').doc(orgId).collection('published-site-settings').doc(siteId)
  const publishedSnap = await publishedRef.get()
  const publishedEmail = normalizeEmail(publishedSnap?.data()?.contactEmail)
  if (publishedEmail)
    return publishedEmail
  const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
  const siteSnap = await siteRef.get()
  return normalizeEmail(siteSnap?.data()?.contactEmail)
}

const sendContactFormEmail = async ({
  to,
  replyTo,
  subject,
  entries,
  orgId,
  siteId,
  pageId,
  blockId,
}) => {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    logger.error('SendGrid config missing')
    return
  }
  const recipients = normalizeEmailList(to)
  if (!recipients.length)
    return

  const fieldLines = entries.length
    ? entries.map(entry => `- ${entry.key}: ${formatValue(entry.value)}`)
    : ['- (no fields provided)']
  const textBody = fieldLines.join('\n')

  const htmlFields = entries.length
    ? entries
      .map(entry => `<li><strong>${escapeHtml(entry.key)}:</strong> ${escapeHtml(formatValue(entry.value))}</li>`)
      .join('')
    : '<li>(no fields provided)</li>'
  const htmlBody = `
    <div>
      <h2>${escapeHtml(subject || DEFAULT_CONTACT_FORM_SUBJECT)}</h2>
      <ul>${htmlFields}</ul>
    </div>
  `

  await axios.post('https://api.sendgrid.com/v3/mail/send', {
    personalizations: [{ to: recipients.map(email => ({ email })), subject: subject || DEFAULT_CONTACT_FORM_SUBJECT }],
    from: { email: SENDGRID_FROM_EMAIL },
    reply_to: { email: replyTo || SENDGRID_FROM_EMAIL },
    content: [
      { type: 'text/plain', value: textBody },
      { type: 'text/html', value: htmlBody },
    ],
  }, {
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

exports.trackHistory = onRequest(async (req, res) => {
  if (allowCors(req, res))
    return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!HISTORY_API_KEY) {
    logger.error('HISTORY_API_KEY not configured')
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  if (getApiKey(req) !== HISTORY_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const orgId = getOrgIdFromPath(req.path || req.url || '')
  if (!orgId) {
    res.status(400).json({ error: 'Missing org id in route' })
    return
  }

  const payload = parseBody(req)
  if (!payload) {
    res.status(400).json({ error: 'Invalid JSON payload' })
    return
  }

  const uuid = typeof payload.uuid === 'string' ? payload.uuid.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  const data = payload.data ?? null

  if (!action) {
    res.status(400).json({ error: 'Missing action' })
    return
  }

  const historyRef = db.collection('organizations').doc(orgId).collection('lead-history')
  const docRef = uuid ? historyRef.doc(uuid) : historyRef.doc()
  const now = Firestore.FieldValue.serverTimestamp()

  const headers = req.headers || {}
  const userAgent = String(headers['user-agent'] || '')
  const historyBase = {
    ip: getClientIp(req),
    ipForwardedFor: getForwardedFor(req),
    userAgent,
    browser: parseBrowser(userAgent),
    os: parseOs(userAgent),
    device: parseDevice(userAgent, headers),
    platformHint: String(headers['sec-ch-ua-platform'] || ''),
    browserHint: String(headers['sec-ch-ua'] || ''),
    acceptLanguage: String(headers['accept-language'] || ''),
    referrer: String(headers.referer || headers.referrer || ''),
  }

  try {
    let exists = false
    if (uuid) {
      const snap = await docRef.get()
      exists = snap.exists
    }

    const updateData = {
      ...historyBase,
      updatedAt: now,
      lastActionAt: now,
      lastAction: action,
      lastData: data,
    }
    if (!exists) {
      updateData.createdAt = now
      updateData.firstActionAt = now
    }

    await docRef.set(updateData, { merge: true })
    await docRef.collection('actions').add({
      action,
      data,
      timestamp: now,
    })
    const siteId = typeof data?.siteId === 'string' ? data.siteId.trim() : ''
    const authUserId = typeof data?.userId === 'string'
      ? data.userId.trim()
      : (typeof data?.uid === 'string' ? data.uid.trim() : '')
    if (siteId && authUserId) {
      try {
        await syncAudienceHistoryUuidForUser({
          orgId,
          siteId,
          userId: authUserId,
          historyUuid: docRef.id,
        })
      }
      catch (error) {
        logger.error('Failed to sync audience history_uuid', error)
      }
    }
    if (siteId) {
      await db.collection('organizations').doc(orgId)
        .collection('sites').doc(siteId)
        .collection('lead-actions')
        .add({
          action,
          data,
          timestamp: now,
          uuid: docRef.id,
        })
    }

    if (action === 'Contact Form' && data && typeof data === 'object') {
      const siteId = typeof data.siteId === 'string' ? data.siteId.trim() : ''
      const pageId = typeof data.pageId === 'string' ? data.pageId.trim() : ''
      const blockId = typeof data.blockId === 'string' ? data.blockId.trim() : ''

      if (!siteId) {
        logger.warn('Contact form missing siteId', { siteId, pageId, blockId })
      }
      else {
        try {
          const entries = collectFormEntries(data)
          const replyTo = getReplyToEmail(data, entries)
          const subject = getContactFormSubject(data, entries)
          const blockEmails = await getPublishedEmailTo(orgId, siteId, pageId, blockId)
          const fallbackEmail = await getSiteSettingsEmail(orgId, siteId)
          const emailTo = blockEmails.length ? blockEmails : (fallbackEmail ? [fallbackEmail] : [])

          if (!emailTo.length) {
            logger.warn('Contact form email not found', { orgId, siteId, pageId, blockId })
          }
          else {
            await sendContactFormEmail({
              to: emailTo,
              replyTo,
              subject,
              entries,
              orgId,
              siteId,
              pageId,
              blockId,
            })
          }
        }
        catch (err) {
          logger.error('Contact form email failed', err)
        }
      }
    }

    res.json({ uuid: docRef.id })
  }
  catch (err) {
    logger.error('trackHistory failed', err)
    res.status(500).json({ error: 'Failed to record history' })
  }
})

const getTimestampMillis = (value) => {
  if (!value)
    return null
  if (typeof value.toMillis === 'function')
    return value.toMillis()
  if (typeof value === 'number')
    return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    if (admin?.firestore?.Timestamp && value instanceof admin.firestore.Timestamp)
      return value.toMillis()
    if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number')
      return value.seconds * 1000 + value.nanoseconds / 1e6
  }
  return null
}

const cloneValue = (val) => {
  if (val === null || typeof val !== 'object')
    return val
  if (admin?.firestore?.Timestamp && val instanceof admin.firestore.Timestamp)
    return val
  if (val instanceof Date)
    return new Date(val.getTime())
  if (Array.isArray(val))
    return val.map(cloneValue)
  const cloned = {}
  for (const [key, value] of Object.entries(val)) {
    cloned[key] = cloneValue(value)
  }
  return cloned
}

const replaceSyncedBlockIfOlder = (blocks, blockId, sourceBlock, sourceMillis) => {
  let updated = false
  for (let i = 0; i < blocks.length; i++) {
    const currentBlock = blocks[i]
    if (currentBlock?.blockId !== blockId)
      continue
    const currentMillis = getTimestampMillis(currentBlock.blockUpdatedAt)
    if (currentMillis !== null && currentMillis >= sourceMillis)
      continue
    const cloned = cloneValue(sourceBlock)
    // Preserve the per-page block instance id so layout references remain valid.
    cloned.id = currentBlock?.id || cloned.id
    blocks[i] = cloned
    updated = true
  }
  return updated
}

const collectSyncedBlocks = (content, postContent) => {
  const syncedBlocks = new Map()
  const blocks = [
    ...(Array.isArray(content) ? content : []),
    ...(Array.isArray(postContent) ? postContent : []),
  ]

  for (const block of blocks) {
    if (!block?.synced || !block.blockId)
      continue
    const millis = getTimestampMillis(block.blockUpdatedAt)
    if (millis === null)
      continue
    const existing = syncedBlocks.get(block.blockId)
    if (!existing || millis > existing.millis)
      syncedBlocks.set(block.blockId, { block, millis })
  }

  return syncedBlocks
}

const BLOCK_META_EXCLUDE_KEYS = new Set(['limit'])

const updateBlocksInArray = (blocks, blockId, beforeData, afterData) => {
  let touched = false
  const beforeMeta = beforeData?.meta || {}
  const afterMeta = afterData?.meta || {}
  for (const block of blocks) {
    if (block?.blockId !== blockId)
      continue

    if (afterData.content !== undefined)
      block.content = afterData.content

    block.meta = block.meta || {}
    const srcMeta = afterMeta
    for (const key of Object.keys(srcMeta)) {
      block.meta[key] = block.meta[key] || {}
      const src = srcMeta[key] || {}
      const previousTemplateQueryItems = (beforeMeta[key]?.queryItems && typeof beforeMeta[key].queryItems === 'object')
        ? beforeMeta[key].queryItems
        : {}
      const nextTemplateQueryItems = (src.queryItems && typeof src.queryItems === 'object')
        ? src.queryItems
        : {}
      for (const metaKey of Object.keys(src)) {
        if (metaKey === 'queryItems') {
          const existingQueryItems = (block.meta[key].queryItems && typeof block.meta[key].queryItems === 'object')
            ? block.meta[key].queryItems
            : {}
          const deletedTemplateKeys = Object.keys(previousTemplateQueryItems)
            .filter(queryKey => !Object.prototype.hasOwnProperty.call(nextTemplateQueryItems, queryKey))
          const nextQueryItems = { ...existingQueryItems }
          for (const queryKey of deletedTemplateKeys)
            delete nextQueryItems[queryKey]
          block.meta[key].queryItems = {
            ...nextQueryItems,
            ...nextTemplateQueryItems,
          }
          continue
        }
        if (BLOCK_META_EXCLUDE_KEYS.has(metaKey))
          continue
        block.meta[key][metaKey] = src[metaKey]
      }
    }

    touched = true
  }
  return touched
}

const buildPageBlockUpdate = (pageData, blockId, beforeData, afterData) => {
  const pageContent = Array.isArray(pageData.content) ? [...pageData.content] : []
  const pagePostContent = Array.isArray(pageData.postContent) ? [...pageData.postContent] : []

  const contentTouched = updateBlocksInArray(pageContent, blockId, beforeData, afterData)
  const postContentTouched = updateBlocksInArray(pagePostContent, blockId, beforeData, afterData)

  return {
    touched: contentTouched || postContentTouched,
    content: pageContent,
    postContent: pagePostContent,
  }
}

const getNextVersion = (value) => {
  const numericVersion = Number(value)
  if (!Number.isFinite(numericVersion))
    return 1
  return Math.max(0, Math.trunc(numericVersion)) + 1
}

const syncPageVersionMaps = async ({ orgId, siteId, pageId, version }) => {
  if (!orgId || !siteId || !pageId)
    return

  const orgRef = db.collection('organizations').doc(orgId)
  const sitesRef = orgRef.collection('sites').doc(siteId)
  const publishedSettingsRef = orgRef.collection('published-site-settings').doc(siteId)

  await Promise.all([
    sitesRef.set({
      pageVersions: {
        [pageId]: version,
      },
    }, { merge: true }),
    publishedSettingsRef.set({
      pageVersions: {
        [pageId]: version,
      },
    }, { merge: true }),
  ])
}

exports.blockUpdated = onDocumentUpdated({ document: 'organizations/{orgId}/blocks/{blockId}', timeoutSeconds: 180 }, async (event) => {
  const change = event.data
  const blockId = event.params.blockId
  const orgId = event.params.orgId
  const beforeData = change.before.data() || {}
  const afterData = change.after.data() || {}

  const sites = await db.collection('organizations').doc(orgId).collection('sites').get()
  if (sites.empty)
    logger.log(`No sites found in org ${orgId}`)

  const processedSiteIds = new Set()

  const updateDocsForSiteCollection = async (siteId, {
    collectionName,
    publishedCollectionName = '',
    docLabel = 'doc',
    updatePublished = true,
    scopeLabel,
  }) => {
    const pagesSnap = await db.collection('organizations').doc(orgId)
      .collection('sites').doc(siteId)
      .collection(collectionName)
      .where('blockIds', 'array-contains', blockId)
      .get()

    if (pagesSnap.empty) {
      logger.log(`No ${collectionName} found using block ${blockId} in ${scopeLabel}`)
      return
    }

    for (const pageDoc of pagesSnap.docs) {
      const pageData = pageDoc.data() || {}
      const { touched, content, postContent } = buildPageBlockUpdate(pageData, blockId, beforeData, afterData)

      if (!touched) {
        logger.log(`${docLabel} ${pageDoc.id} has no matching block ${blockId} in ${scopeLabel}`)
        continue
      }

      const shouldTrackPageVersion = collectionName === 'pages'
      const nextVersion = shouldTrackPageVersion ? getNextVersion(pageData?.version) : null
      const draftUpdate = shouldTrackPageVersion
        ? { content, postContent, version: nextVersion }
        : { content, postContent }

      await pageDoc.ref.update(draftUpdate)

      if (updatePublished && publishedCollectionName) {
        const publishedRef = db.collection('organizations').doc(orgId)
          .collection('sites').doc(siteId)
          .collection(publishedCollectionName).doc(pageDoc.id)

        const publishedDoc = await publishedRef.get()
        if (publishedDoc.exists) {
          const publishedUpdate = shouldTrackPageVersion
            ? { content, postContent, version: nextVersion }
            : { content, postContent }
          await publishedRef.update(publishedUpdate)
        }

        if (shouldTrackPageVersion) {
          await syncPageVersionMaps({
            orgId,
            siteId,
            pageId: pageDoc.id,
            version: nextVersion,
          })
        }
      }

      logger.log(`Updated ${docLabel} ${pageDoc.id} in ${scopeLabel} with new block ${blockId} content`)
    }
  }

  for (const siteDoc of sites.docs) {
    const siteId = siteDoc.id
    processedSiteIds.add(siteId)
    const updatePublished = siteId !== 'templates'
    const scopeLabel = siteId === 'templates'
      ? `templates site (org ${orgId})`
      : `site ${siteId} (org ${orgId})`

    await updateDocsForSiteCollection(siteId, {
      collectionName: 'pages',
      publishedCollectionName: 'published',
      docLabel: 'page',
      updatePublished,
      scopeLabel,
    })

    await updateDocsForSiteCollection(siteId, {
      collectionName: 'posts',
      publishedCollectionName: 'published_posts',
      docLabel: 'post',
      updatePublished,
      scopeLabel,
    })
  }

  if (!processedSiteIds.has('templates')) {
    await updateDocsForSiteCollection('templates', {
      collectionName: 'pages',
      publishedCollectionName: 'published',
      docLabel: 'page',
      updatePublished: false,
      scopeLabel: `templates site (org ${orgId})`,
    })

    await updateDocsForSiteCollection('templates', {
      collectionName: 'posts',
      publishedCollectionName: 'published_posts',
      docLabel: 'post',
      updatePublished: false,
      scopeLabel: `templates site (org ${orgId})`,
    })
  }
})

exports.fontFileUpdated = onDocumentUpdated({ document: 'organizations/{orgId}/files/{fileId}', timeoutSeconds: 180 }, async (event) => {
  const before = event.data.before.data() || {}
  const after = event.data.after.data() || {}
  const orgId = event.params.orgId

  if (!after?.uploadCompletedToR2 || !after?.r2URL)
    return

  // Only act on font uploads that were tagged for themes
  const meta = after.meta || {}
  const themeId = meta.themeId
  if (!themeId || !meta.cmsFont)
    return

  if (meta.autoLink === false)
    return

  if (before.uploadCompletedToR2 === after.uploadCompletedToR2 && before.r2URL === after.r2URL)
    return

  try {
    const themeRef = db.collection('organizations').doc(orgId).collection('themes').doc(themeId)
    const themeSnap = await themeRef.get()
    if (!themeSnap.exists) {
      logger.warn(`fontFileUpdated: theme ${themeId} not found in org ${orgId}`)
      return
    }

    const themeData = themeSnap.data() || {}
    let headJson = {}
    try {
      headJson = JSON.parse(themeData.headJSON || '{}') || {}
    }
    catch (e) {
      headJson = {}
    }

    const links = Array.isArray(headJson.link) ? [...headJson.link] : []
    const href = after.r2URL
    const alreadyLinked = links.some(link => link && link.href === href)
    if (alreadyLinked)
      return

    const linkEntry = {
      rel: 'preload',
      as: 'font',
      href,
      crossorigin: '',
    }
    if (after.contentType)
      linkEntry.type = after.contentType

    links.push(linkEntry)
    headJson.link = links

    await themeRef.set({
      headJSON: JSON.stringify(headJson, null, 2),
    }, { merge: true })

    logger.log(`fontFileUpdated: appended font link for ${href} to theme ${themeId} in org ${orgId}`)
  }
  catch (error) {
    logger.error('fontFileUpdated error', error)
  }
})

const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean')
    return value
  return fallback
}

const eventEndAtMs = (eventData = {}) => {
  const endAtUtc = String(eventData.endAtUtc || '').trim()
  if (endAtUtc) {
    const utcMs = Date.parse(endAtUtc)
    if (Number.isFinite(utcMs))
      return utcMs
  }

  const endAt = String(eventData.endAt || '').trim()
  if (!endAt)
    return Number.NaN
  const fallbackMs = Date.parse(endAt)
  return Number.isFinite(fallbackMs) ? fallbackMs : Number.NaN
}

const canPublishEventAt = (postData = {}, publishAtMs = Date.now()) => {
  const rawType = String(postData?.type || 'post').trim().toLowerCase()
  if (rawType !== 'event')
    return { allowed: true, reason: '' }

  const eventData = (postData && typeof postData.event === 'object') ? postData.event : {}
  const unpublishPastEvent = toBool(eventData.unpublishPastEvent, true)
  if (!unpublishPastEvent)
    return { allowed: true, reason: '' }

  const endAtMs = eventEndAtMs(eventData)
  if (!Number.isFinite(endAtMs))
    return { allowed: true, reason: '' }

  if (endAtMs <= publishAtMs) {
    return {
      allowed: false,
      reason: 'Event endAt is earlier than publishAt while unpublishPastEvent is enabled.',
    }
  }
  return { allowed: true, reason: '' }
}

const yyyyMM = (d) => {
  const dt = d ? new Date(d) : new Date()
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const h = String(dt.getUTCHours()).padStart(2, '0')
  const min = String(dt.getUTCMinutes()).padStart(2, '0')
  return `${y}${m}${h}${min}`
}
// Canonical + indices for posts
exports.onPostWritten = createKvMirrorHandler({
  document: 'organizations/{orgId}/sites/{siteId}/published_posts/{postId}',

  makeCanonicalKey: ({ orgId, siteId, postId }) =>
    `posts:${orgId}:${siteId}:${postId}`,

  makeIndexKeys: ({ orgId, siteId, postId }, data) => {
    const keys = []

    // by tag
    const tags = Array.isArray(data?.tags) ? data.tags : []
    for (const t of tags) {
      const st = slug(t)
      if (st)
        keys.push(`idx:posts:tags:${orgId}:${siteId}:${st}:${postId}`)
    }

    // by type
    const rawType = String(data?.type || 'post').trim().toLowerCase()
    if (rawType) {
      keys.push(`idx:posts:type:${orgId}:${siteId}:${slug(rawType)}:${postId}`)
    }

    const eventData = (data && typeof data.event === 'object') ? data.event : {}
    const startAtValue = String(eventData.startAt || '').trim()
    if (startAtValue) {
      keys.push(`idx:posts:startAt:${orgId}:${siteId}:${startAtValue}:${postId}`)
      keys.push(`idx:posts:event.startAt:${orgId}:${siteId}:${startAtValue}:${postId}`)
    }
    const endAtValue = String(eventData.endAt || '').trim()
    if (endAtValue) {
      keys.push(`idx:posts:endAt:${orgId}:${siteId}:${endAtValue}:${postId}`)
      keys.push(`idx:posts:event.endAt:${orgId}:${siteId}:${endAtValue}:${postId}`)
    }
    const isPastValue = toBool(eventData.isPast, false) ? 'true' : 'false'
    keys.push(`idx:posts:isPast:${orgId}:${siteId}:${isPastValue}:${postId}`)
    keys.push(`idx:posts:event.isPast:${orgId}:${siteId}:${isPastValue}:${postId}`)

    // by date (archive buckets)
    const pub = data?.publishedAt || data?.doc_created_at || data?.createdAt || null
    if (pub)
      keys.push(`idx:posts:dates:${orgId}:${siteId}:${yyyyMM(pub)}:${postId}`)

    // by slug (direct lookup)
    if (data?.name)
      keys.push(`idx:posts:name:${orgId}:${siteId}:${data.name}`)

    return keys
  },

  // store full document as-is
  serialize: data => JSON.stringify(data),

  // tiny metadata so you can render lists without N GETs (stored in meta:{key})
  makeMetadata: (data) => {
    const eventData = (data && typeof data.event === 'object') ? data.event : {}
    const startAt = String(eventData.startAt || '')
    const endAt = String(eventData.endAt || '')
    return {
      title: data?.title || '',
      blurb: data?.blurb || '',
      doc_created_at: data?.doc_created_at || '',
      featuredImage: data?.featuredImage || '',
      name: data?.name || '',
      type: (String(data?.type || 'post').trim().toLowerCase() || 'post'),
      event: {
        startAt,
        endAt,
        isPast: toBool(eventData.isPast, false),
        locationName: String(eventData.locationName || ''),
      },
    }
  },

  timeoutSeconds: 180,
})

exports.syncPastPublishedEvents = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 540 },
  async () => {
    const pageSize = 250
    let scanned = 0
    let eventDocs = 0
    let updated = 0
    let updatedPosts = 0
    let unpublished = 0
    let lastDoc = null

    while (true) {
      let query = db.collectionGroup('published_posts')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(pageSize)

      if (lastDoc)
        query = query.startAfter(lastDoc)

      const snap = await query.get()
      if (snap.empty)
        break

      let batch = db.batch()
      let ops = 0

      for (const docSnap of snap.docs) {
        scanned += 1
        const data = docSnap.data() || {}
        const rawType = String(data?.type || 'post').trim().toLowerCase()
        if (rawType !== 'event')
          continue
        eventDocs += 1
        const pathParts = String(docSnap.ref.path || '').split('/').filter(Boolean)
        const hasPostPath = pathParts.length === 6 && pathParts[0] === 'organizations' && pathParts[2] === 'sites' && pathParts[4] === 'published_posts'
        const postRef = hasPostPath
          ? db.collection('organizations').doc(pathParts[1]).collection('sites').doc(pathParts[3]).collection('posts').doc(pathParts[5])
          : null

        const eventData = (data && typeof data.event === 'object') ? data.event : {}
        const endAtMs = eventEndAtMs(eventData)
        const isPast = Number.isFinite(endAtMs) ? endAtMs <= Date.now() : false
        const unpublishPastEvent = toBool(eventData.unpublishPastEvent, true)
        const needsIsPastUpdate = toBool(eventData.isPast, false) !== isPast
        const needsUnpublishDefault = typeof eventData.unpublishPastEvent !== 'boolean'

        if (isPast && unpublishPastEvent) {
          batch.delete(docSnap.ref)
          unpublished += 1
          ops += 1

          if (postRef && (needsIsPastUpdate || needsUnpublishDefault)) {
            const postUpdates = {}
            if (needsIsPastUpdate)
              postUpdates['event.isPast'] = isPast
            if (needsUnpublishDefault)
              postUpdates['event.unpublishPastEvent'] = true
            batch.set(postRef, postUpdates, { merge: true })
            updatedPosts += 1
            ops += 1
          }
        }
        else {
          if (needsIsPastUpdate || needsUnpublishDefault) {
            const updates = {}
            if (needsIsPastUpdate)
              updates['event.isPast'] = isPast
            if (needsUnpublishDefault)
              updates['event.unpublishPastEvent'] = true
            batch.update(docSnap.ref, updates)
            updated += 1
            ops += 1

            if (postRef) {
              batch.set(postRef, updates, { merge: true })
              updatedPosts += 1
              ops += 1
            }
          }
        }

        if (ops >= 400) {
          await batch.commit()
          batch = db.batch()
          ops = 0
        }
      }

      if (ops > 0)
        await batch.commit()

      lastDoc = snap.docs[snap.docs.length - 1]
      if (snap.size < pageSize)
        break
    }

    logger.log('syncPastPublishedEvents complete', {
      scanned,
      eventDocs,
      updated,
      updatedPosts,
      unpublished,
    })
  },
)

exports.publishScheduledPosts = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 540 },
  async () => {
    const pageSize = 200
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()

    let scanned = 0
    let withSchedule = 0
    let published = 0
    let skipped = 0
    let unscheduled = 0

    let lastDoc = null

    for (;;) {
      let query = db.collectionGroup('posts')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(pageSize)

      if (lastDoc)
        query = query.startAfter(lastDoc)

      const snap = await query.get()

      if (snap.empty)
        break

      let batch = db.batch()
      let ops = 0

      for (const draftSnap of snap.docs) {
        scanned += 1
        const draftData = draftSnap.data() || {}
        const publishAtRaw = String(draftData.publishAt || '').trim()
        if (!publishAtRaw)
          continue
        withSchedule += 1
        const publishAtMs = publishAtRaw ? Date.parse(publishAtRaw) : Number.NaN
        const effectivePublishMs = Number.isFinite(publishAtMs) ? publishAtMs : nowMs
        const isDue = Number.isFinite(publishAtMs) ? publishAtMs <= nowMs : true
        if (!isDue)
          continue

        const pathParts = draftSnap.ref.path.split('/')
        if (pathParts.length !== 6) {
          batch.update(draftSnap.ref, {
            publishAt: Firestore.FieldValue.delete(),
            publishAtTimezone: Firestore.FieldValue.delete(),
          })
          unscheduled += 1
          ops += 1
          continue
        }
        const orgId = pathParts[1]
        const siteId = pathParts[3]
        const postId = pathParts[5]

        const canPublish = canPublishEventAt(draftData, effectivePublishMs)
        if (!canPublish.allowed) {
          batch.update(draftSnap.ref, {
            publishAt: Firestore.FieldValue.delete(),
            publishAtTimezone: Firestore.FieldValue.delete(),
            publishAtError: canPublish.reason,
          })
          skipped += 1
          unscheduled += 1
          ops += 1
        }
        else {
          const publishedRef = db.collection('organizations').doc(orgId)
            .collection('sites').doc(siteId)
            .collection('published_posts').doc(postId)

          const publishedAtMillis = Number.isFinite(effectivePublishMs) ? effectivePublishMs : nowMs
          const publishedAtIso = new Date(publishedAtMillis).toISOString()
          const publishPayload = { ...draftData }
          delete publishPayload.publishAt
          delete publishPayload.publishAtTimezone
          publishPayload.doc_created_at = Number.isFinite(publishedAtMillis) ? publishedAtMillis : nowMs
          publishPayload.publishAtError = ''
          publishPayload.publishedAt = publishedAtIso

          batch.set(publishedRef, publishPayload, { merge: false })
          batch.update(draftSnap.ref, {
            doc_created_at: Number.isFinite(publishedAtMillis) ? publishedAtMillis : nowMs,
            publishedAt: publishedAtIso,
            publishAt: Firestore.FieldValue.delete(),
            publishAtTimezone: Firestore.FieldValue.delete(),
            publishAtError: Firestore.FieldValue.delete(),
          })
          published += 1
          unscheduled += 1
          ops += 2
        }

        if (ops >= 400) {
          await batch.commit()
          batch = db.batch()
          ops = 0
        }
      }

      if (ops > 0)
        await batch.commit()

      lastDoc = snap.docs[snap.docs.length - 1]
      if (snap.size < pageSize)
        break
    }

    logger.log('publishScheduledPosts complete', {
      scanned,
      withSchedule,
      published,
      skipped,
      unscheduled,
      nowIso,
    })
  },
)

// start delete later
exports.reindexPublishedPostsToKv = onCall({ timeoutSeconds: 540 }, async (request) => {
  assertCallableUser(request)

  const pageSize = 200
  let scanned = 0
  let rewritten = 0
  let syncedPosts = 0
  let lastDoc = null

  for (;;) {
    let query = db.collectionGroup('published_posts')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize)

    if (lastDoc)
      query = query.startAfter(lastDoc)

    const snap = await query.get()
    if (snap.empty)
      break

    let batch = db.batch()
    let ops = 0

    for (const docSnap of snap.docs) {
      scanned += 1
      const currentSendToKv = Number(docSnap.get('sendToKV'))
      const nextSendToKv = Number.isFinite(currentSendToKv) ? currentSendToKv + 1 : 1
      batch.set(docSnap.ref, { sendToKV: nextSendToKv }, { merge: true })
      const segments = String(docSnap.ref.path || '').split('/').filter(Boolean)
      if (segments.length === 6 && segments[0] === 'organizations' && segments[2] === 'sites' && segments[4] === 'published_posts') {
        const orgId = segments[1]
        const siteId = segments[3]
        const postId = segments[5]
        const postRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('posts').doc(postId)
        batch.set(postRef, { sendToKV: nextSendToKv }, { merge: true })
        syncedPosts += 1
        ops += 1
      }
      rewritten += 1
      ops += 1

      if (ops >= 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }

    if (ops > 0)
      await batch.commit()

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.size < pageSize)
      break
  }

  logger.log('reindexPublishedPostsToKv complete', { scanned, rewritten, syncedPosts })
  return { ok: true, scanned, rewritten, syncedPosts }
})
// end delete later

exports.onSiteWritten = createKvMirrorHandler({
  document: 'organizations/{orgId}/published-site-settings/{siteId}',
  makeCanonicalKey: ({ orgId, siteId }) =>
    `sites:${orgId}:${siteId}`,
  makeIndexKeys: ({ orgId, siteId }, data) => {
    const keys = []
    const siteDocId = slug(siteId)
    if (siteDocId)
      keys.push(`idx:sites:docId:${orgId}:${siteDocId}:${siteId}`)
    const domains = Array.isArray(data?.domains) ? data.domains : []
    for (const domain of domains) {
      const st = slug(domain)
      keys.push(`idx:sites:domains:${st}`)
    }
    return keys
  },
  serialize: data => JSON.stringify(data),
  timeoutSeconds: 180,
})

exports.onUserWritten = createKvMirrorHandler({
  document: 'organizations/{orgId}/users/{userId}',
  makeCanonicalKey: ({ orgId, userId }) =>
    `users:${orgId}:${userId}`,
  makeIndexKeys: async ({ orgId, userId }, data) => {
    const keys = []
    const resolvedUserId = slug(data?.userId) || slug(userId)
    if (resolvedUserId)
      keys.push(`idx:users:userId:${orgId}:${resolvedUserId}`)
    return keys
  },
  serialize: data => JSON.stringify(data),
  makeMetadata: data => ({
    title: data?.title || '',
    contactPhone: data?.contactPhone || data?.phone || '',
    contactEmail: data?.contactEmail || data?.email || '',
    doc_created_at: data?.doc_created_at || '',
    featuredImage: data?.featuredImage || '',
    name: data?.name || '',
  }),
  timeoutSeconds: 180,
})

exports.onThemeWritten = createKvMirrorHandler({
  document: 'organizations/{orgId}/themes/{themeId}',
  makeCanonicalKey: ({ orgId, themeId }) =>
    `themes:${orgId}:${themeId}`,
  serialize: data => JSON.stringify({ theme: JSON.parse(data.theme), headJSON: JSON.parse(data.headJSON), extraCSS: data.extraCSS }),
  timeoutSeconds: 180,
})

exports.onPublishedPageWritten = createKvMirrorHandler({
  document: 'organizations/{orgId}/sites/{siteId}/published/{pageId}',
  makeCanonicalKey: ({ orgId, siteId, pageId }) =>
    `pages:${orgId}:${siteId}:${pageId}`,
  timeoutSeconds: 180,
})

exports.syncPublishedSyncedBlocks = onDocumentWritten({ document: 'organizations/{orgId}/sites/{siteId}/published/{pageId}', timeoutSeconds: 180 }, async (event) => {
  const change = event.data
  if (!change.after.exists)
    return

  const orgId = event.params.orgId
  const siteId = event.params.siteId
  const pageId = event.params.pageId
  const data = change.after.data() || {}
  const syncedBlocks = collectSyncedBlocks(data.content, data.postContent)

  if (!syncedBlocks.size)
    return

  const publishedRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('published')
  const draftRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('pages')

  for (const [blockId, { block: sourceBlock, millis: sourceMillis }] of syncedBlocks.entries()) {
    const publishedSnap = await publishedRef.where('blockIds', 'array-contains', blockId).get()
    if (publishedSnap.empty)
      continue

    for (const publishedDoc of publishedSnap.docs) {
      if (publishedDoc.id === pageId)
        continue

      const publishedData = publishedDoc.data() || {}
      const publishedContent = Array.isArray(publishedData.content) ? [...publishedData.content] : []
      const publishedPostContent = Array.isArray(publishedData.postContent) ? [...publishedData.postContent] : []

      const updatedContent = replaceSyncedBlockIfOlder(publishedContent, blockId, sourceBlock, sourceMillis)
      const updatedPostContent = replaceSyncedBlockIfOlder(publishedPostContent, blockId, sourceBlock, sourceMillis)

      if (!updatedContent && !updatedPostContent)
        continue

      await publishedDoc.ref.update({ content: publishedContent, postContent: publishedPostContent })

      logger.log(`Synced published block ${blockId} from page ${pageId} to published page ${publishedDoc.id} in site ${siteId} (org ${orgId})`)
    }

    const draftSnap = await draftRef.where('blockIds', 'array-contains', blockId).get()
    if (!draftSnap.empty) {
      for (const draftDoc of draftSnap.docs) {
        if (draftDoc.id === pageId)
          continue

        const draftData = draftDoc.data() || {}
        const draftContent = Array.isArray(draftData.content) ? [...draftData.content] : []
        const draftPostContent = Array.isArray(draftData.postContent) ? [...draftData.postContent] : []

        const updatedDraftContent = replaceSyncedBlockIfOlder(draftContent, blockId, sourceBlock, sourceMillis)
        const updatedDraftPostContent = replaceSyncedBlockIfOlder(draftPostContent, blockId, sourceBlock, sourceMillis)

        if (!updatedDraftContent && !updatedDraftPostContent)
          continue

        await draftDoc.ref.update({ content: draftContent, postContent: draftPostContent })
        logger.log(`Synced published block ${blockId} from page ${pageId} to draft page ${draftDoc.id} in site ${siteId} (org ${orgId})`)
      }
    }
  }
})

exports.onPageUpdated = onDocumentWritten({ document: 'organizations/{orgId}/sites/{siteId}/pages/{pageId}', timeoutSeconds: 180 }, async (event) => {
  const change = event.data
  const orgId = event.params.orgId
  const siteId = event.params.siteId
  const pageId = event.params.pageId
  const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
  const pageData = change.after.exists ? (change.after.data() || {}) : {}

  if (change.after.exists) {
    const lastModified = pageData.last_updated
      ?? pageData.doc_updated_at
      ?? pageData.updatedAt
      ?? pageData.doc_created_at
      ?? (change.after.updateTime ? change.after.updateTime.toMillis() : Date.now())

    await siteRef.set({
      pageLastModified: {
        [pageId]: lastModified,
      },
    }, { merge: true })
  }

  if (!change.after.exists)
    return

  const content = Array.isArray(pageData.content) ? pageData.content : []
  const postContent = Array.isArray(pageData.postContent) ? pageData.postContent : []

  const syncedBlocks = collectSyncedBlocks(content, postContent)

  if (!syncedBlocks.size)
    return

  const pagesRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('pages')

  for (const [blockId, { block: sourceBlock, millis: sourceMillis }] of syncedBlocks.entries()) {
    const pagesSnap = await pagesRef.where('blockIds', 'array-contains', blockId).get()
    if (pagesSnap.empty)
      continue

    for (const pageDoc of pagesSnap.docs) {
      if (pageDoc.id === pageId)
        continue

      const pageData = pageDoc.data() || {}
      const pageContent = Array.isArray(pageData.content) ? [...pageData.content] : []
      const pagePostContent = Array.isArray(pageData.postContent) ? [...pageData.postContent] : []

      const updatedContent = replaceSyncedBlockIfOlder(pageContent, blockId, sourceBlock, sourceMillis)
      const updatedPostContent = replaceSyncedBlockIfOlder(pagePostContent, blockId, sourceBlock, sourceMillis)

      if (!updatedContent && !updatedPostContent)
        continue

      await pageDoc.ref.update({ content: pageContent, postContent: pagePostContent })

      logger.log(`Synced block ${blockId} to page ${pageDoc.id} in site ${siteId} (org ${orgId})`)
    }
  }
})

exports.onPageDeleted = onDocumentDeleted({ document: 'organizations/{orgId}/sites/{siteId}/pages/{pageId}', timeoutSeconds: 180 }, async (event) => {
  const orgId = event.params.orgId
  const siteId = event.params.siteId
  const pageId = event.params.pageId
  const publishedRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('published').doc(pageId)
  await publishedRef.delete()
  const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
  try {
    await siteRef.update({
      [`pageLastModified.${pageId}`]: Firestore.FieldValue.delete(),
    })
  }
  catch (error) {
    logger.warn('Failed to remove pageLastModified for deleted page', { orgId, siteId, pageId, error: error?.message })
  }
})

exports.onSiteDeleted = onDocumentDeleted({ document: 'organizations/{orgId}/sites/{siteId}', timeoutSeconds: 180 }, async (event) => {
  // delete documents in sites/{siteId}/published
  const orgId = event.params.orgId
  const siteId = event.params.siteId

  // delete documents in sites/{siteId}/pages
  const pagesRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('pages')
  const pagesDocs = await pagesRef.listDocuments()
  for (const doc of pagesDocs) {
    await doc.delete()
  }

  // delete the published-site-settings document
  const siteSettingsRef = db.collection('organizations').doc(orgId).collection('published-site-settings').doc(siteId)
  await siteSettingsRef.delete()
})

const isFillableMeta = (meta) => {
  if (!meta)
    return false
  if (meta.api || meta.collection)
    return false
  return true
}

const normalizeOptionValue = (value, options = [], valueKey = 'value', titleKey = 'title') => {
  if (value === null || value === undefined)
    return null
  const stringVal = String(value).trim().toLowerCase()
  for (const option of options) {
    const optValue = option?.[valueKey]
    const optTitle = option?.[titleKey]
    if (stringVal === String(optValue).trim().toLowerCase() || stringVal === String(optTitle).trim().toLowerCase())
      return optValue
  }
  return null
}

const sanitizeArrayWithSchema = (schema = [], arr) => {
  if (!Array.isArray(arr))
    return []
  return arr
    .map((item) => {
      if (!item || typeof item !== 'object')
        return null
      const clean = {}
      for (const schemaItem of schema) {
        const val = item[schemaItem.field]
        if (val === null || val === undefined)
          continue
        if (typeof val === 'string')
          clean[schemaItem.field] = val
        else if (typeof val === 'number')
          clean[schemaItem.field] = val
        else if (typeof val === 'boolean')
          clean[schemaItem.field] = val
        else
          clean[schemaItem.field] = JSON.stringify(val)
      }
      return Object.keys(clean).length ? clean : null
    })
    .filter(Boolean)
}

const sanitizeValueForMeta = (type, value, meta) => {
  switch (type) {
    case 'number': {
      const num = Number(value)
      return Number.isFinite(num) ? num : null
    }
    case 'json': {
      if (value == null)
        return null
      if (typeof value === 'object')
        return JSON.stringify(value)
      const str = String(value).trim()
      if (!str)
        return null
      try {
        JSON.parse(str)
        return str
      }
      catch {
        return str
      }
    }
    case 'array': {
      if (meta?.schema)
        return sanitizeArrayWithSchema(meta.schema, value)
      if (!Array.isArray(value))
        return []
      return value.map(v => String(v || '')).filter(Boolean)
    }
    case 'option': {
      if (meta?.option?.options)
        return normalizeOptionValue(value, meta.option.options, meta.option.optionsValue, meta.option.optionsKey)
      return typeof value === 'string' ? value : null
    }
    case 'richtext':
    case 'textarea':
    case 'text':
    default:
      return typeof value === 'string' ? value : ((value === null || value === undefined) ? null : String(value))
  }
}

const clampText = (value, max) => {
  if (!value)
    return ''
  const str = String(value).replace(/\s+/g, ' ').trim()
  if (str.length <= max)
    return str
  return `${str.slice(0, max)}...`
}

const normalizePromptValue = (value) => {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'string')
    return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

const summarizeBlocksForSeo = (blocks = []) => {
  if (!Array.isArray(blocks) || blocks.length === 0)
    return ''
  const summaries = []
  blocks.forEach((block, index) => {
    const values = block?.values || {}
    const lines = []
    const blockLabel = block?.name || block?.title || block?.heading || block?.label || block?.blockId || block?.id || ''

    const inlineFields = {
      name: block?.name,
      title: block?.title,
      heading: block?.heading,
      label: block?.label,
      text: block?.text,
      body: block?.body,
      content: block?.content,
    }

    for (const [key, val] of Object.entries(inlineFields)) {
      const normalized = normalizePromptValue(val)
      if (!normalized)
        continue
      lines.push(`- ${key}: ${clampText(normalized, 280)}`)
    }

    for (const [key, val] of Object.entries(values)) {
      const normalized = normalizePromptValue(val)
      if (!normalized)
        continue
      lines.push(`- ${key}: ${clampText(normalized, 280)}`)
    }
    if (!lines.length)
      return
    const label = blockLabel || `block-${index + 1}`
    summaries.push(`Block ${index + 1} (${label})\n${lines.join('\n')}`)
  })
  return summaries.join('\n\n')
}

const shouldUpdateSiteStructuredData = (siteData = {}) => {
  const raw = siteData?.structuredData
  if (!raw || (typeof raw === 'string' && !raw.trim()))
    return true
  let parsed = null
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    }
    catch {
      return false
    }
  }
  else if (typeof raw === 'object') {
    parsed = raw
  }
  if (!parsed)
    return false
  const name = String(parsed.name || '').trim()
  const url = String(parsed.url || '').trim()
  const description = String(parsed.description || '').trim()
  const publisherName = String(parsed.publisher?.name || '').trim()
  const logoUrl = String(parsed.publisher?.logo?.url || '').trim()
  const sameAs = Array.isArray(parsed.sameAs) ? parsed.sameAs.filter(Boolean) : []
  return !name && !url && !description && !publisherName && !logoUrl && sameAs.length === 0
}

const callOpenAiForPageSeo = async ({
  siteData,
  pageData,
  pageId,
  blockSummary,
  includeSiteStructuredData,
}) => {
  if (!OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY not set')

  const pageStructuredTemplate = PAGE_STRUCTURED_DATA_TEMPLATE
  const siteStructuredTemplate = includeSiteStructuredData ? SITE_STRUCTURED_DATA_TEMPLATE : ''

  const responseShape = includeSiteStructuredData
    ? '{"metaTitle":"...","metaDescription":"...","structuredData":{...},"siteStructuredData":{...}}'
    : '{"metaTitle":"...","metaDescription":"...","structuredData":{...}}'

  const system = [
    'You are an SEO assistant updating a CMS page.',
    'Use the provided page content and block values.',
    'Base the meta description and structured data description on the block content summary.',
    'Return JSON only using the specified response shape.',
    'Meta title: concise, <= 60 characters.',
    'Meta description: <= 160 characters, sentence case.',
    'Structured data must match the provided template shape.',
    'Preserve CMS tokens like {{cms-site}}, {{cms-url}}, and {{cms-logo}} exactly as-is.',
  ].join(' ')

  const user = [
    `Site name: ${siteData?.name || 'n/a'}`,
    `Domains: ${(Array.isArray(siteData?.domains) ? siteData.domains.join(', ') : '') || 'n/a'}`,
    `Page name: ${pageData?.name || pageId || 'n/a'}`,
    `Page slug/id: ${pageId || 'n/a'}`,
    `Existing meta title: ${pageData?.metaTitle || ''}`,
    `Existing meta description: ${pageData?.metaDescription || ''}`,
    `Existing structured data: ${pageData?.structuredData || ''}`,
    '',
    'Structured data templates (keep keys; fill in values):',
    `Page: ${pageStructuredTemplate}`,
    includeSiteStructuredData ? `Site: ${siteStructuredTemplate}` : '',
    '',
    'Block content summary:',
    clampText(blockSummary || 'n/a', 8000),
    '',
    `Return JSON only with this shape: ${responseShape}`,
  ].filter(Boolean).join('\n')

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenAI error ${resp.status}: ${txt}`)
  }

  const json = await resp.json()
  const content = json?.choices?.[0]?.message?.content || '{}'
  try {
    return JSON.parse(content)
  }
  catch (err) {
    logger.error('Failed to parse OpenAI response', err)
    return {}
  }
}

const buildFieldsList = (pagesSnap, siteData = {}) => {
  const descriptors = []
  const descriptorMap = new Map()

  const siteMetaTargets = [
    ['metaTitle', 'text', 'Site Meta Title'],
    ['metaDescription', 'text', 'Site Meta Description'],
    ['structuredData', 'json', 'Site Structured Data (JSON-LD)'],
  ]
  for (const [field, type, title] of siteMetaTargets) {
    const path = `site.meta.${field}`
    const descriptor = {
      path,
      pageId: null,
      pageName: siteData?.name || 'Site',
      location: 'siteMeta',
      blockIndex: -1,
      blockId: 'meta',
      field,
      type,
      title,
      option: null,
      schema: null,
    }
    descriptors.push(descriptor)
    descriptorMap.set(path, descriptor)
  }

  for (const pageDoc of pagesSnap.docs) {
    const pageId = pageDoc.id
    const pageData = pageDoc.data() || {}
    const pageName = pageData.name || pageId
    const metaTargets = [
      ['metaTitle', 'text', 'Meta Title'],
      ['metaDescription', 'text', 'Meta Description'],
      ['structuredData', 'json', 'Structured Data (JSON-LD)'],
    ]
    for (const [field, type, title] of metaTargets) {
      const path = `${pageId}.meta.${field}`
      const descriptor = {
        path,
        pageId,
        pageName,
        location: 'pageMeta',
        blockIndex: -1,
        blockId: 'meta',
        field,
        type,
        title,
        option: null,
        schema: null,
      }
      descriptors.push(descriptor)
      descriptorMap.set(path, descriptor)
    }

    const locations = [
      ['content', Array.isArray(pageData.content) ? pageData.content : []],
      ['postContent', Array.isArray(pageData.postContent) ? pageData.postContent : []],
    ]

    for (const [location, blocks] of locations) {
      blocks.forEach((block, blockIndex) => {
        const meta = block?.meta || {}
        const values = block?.values || {}
        const blockId = block?.blockId || `block-${blockIndex}`
        for (const [field, cfg] of Object.entries(meta)) {
          if (!isFillableMeta(cfg))
            continue
          const type = cfg.type || 'text'
          const path = `${pageId}.${location}.${blockId}.${field}`
          const descriptor = {
            path,
            pageId,
            pageName,
            location,
            blockIndex,
            blockId,
            field,
            type,
            title: cfg.title || field,
            option: cfg.option || null,
            schema: Array.isArray(cfg.schema) ? cfg.schema : null,
          }
          descriptors.push(descriptor)
          descriptorMap.set(path, descriptor)
        }
      })
    }
  }

  return { descriptors, descriptorMap }
}

const formatFieldPrompt = (descriptor) => {
  const parts = [
    `- path: ${descriptor.path}`,
    `  page: ${descriptor.pageName}`,
    `  field: ${descriptor.title || descriptor.field}`,
    `  type: ${descriptor.type}`,
  ]
  if (descriptor.option?.options?.length) {
    const opts = descriptor.option.options
      .map(opt => `${opt?.[descriptor.option.optionsValue || 'value']} (${opt?.[descriptor.option.optionsKey || 'title'] || ''})`)
      .join(', ')
    parts.push(`  options: ${opts}`)
  }
  if (descriptor.schema?.length) {
    const schemaFields = descriptor.schema.map(s => `${s.field}:${s.type}`).join(', ')
    parts.push(`  array schema: ${schemaFields}`)
  }
  return parts.join('\n')
}

const summarizeAgentMeta = (meta = {}) => {
  const entries = []
  for (const [key, val] of Object.entries(meta)) {
    if (val == null)
      continue
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (!str.trim())
      continue
    // Trim extremely long fields to avoid prompt bloat
    const trimmed = str.length > 400 ? `${str.slice(0, 400)}...` : str
    entries.push(`${key}: ${trimmed}`)
  }
  return entries
}

const summarizeAgentRoot = (agent = {}) => {
  const entries = []
  for (const [key, val] of Object.entries(agent)) {
    if (key === 'meta' || key === 'userId' || key === 'uid')
      continue
    if (val == null)
      continue
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (!str.trim())
      continue
    const trimmed = str.length > 400 ? `${str.slice(0, 400)}...` : str
    entries.push(`${key}: ${trimmed}`)
  }
  return entries
}

const callOpenAiForSiteBootstrap = async ({ siteData, agentData, instructions, fields }) => {
  if (!OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY not set')
  if (!fields || fields.length === 0)
    return {}

  const siteSummary = [
    `Site name: ${siteData?.name || 'n/a'}`,
    `Domains: ${(Array.isArray(siteData?.domains) ? siteData.domains.join(', ') : '') || 'n/a'}`,
  ].join('\n')

  const rootLines = agentData ? summarizeAgentRoot(agentData) : []
  const metaLines = agentData ? summarizeAgentMeta(agentData.meta || {}) : []
  const agentSummary = agentData
    ? [
    `Agent name: ${agentData.meta?.name || agentData.name || agentData.userId || ''}`,
    `Title: ${agentData.meta?.title || ''}`,
    `Bio: ${agentData.meta?.bio || ''}`,
    `Phone: ${agentData.meta?.phone || ''}`,
    `Email: ${agentData.meta?.email || ''}`,
    rootLines.length ? 'Additional agent fields:' : '',
    ...rootLines,
    metaLines.length ? 'Additional agent meta:' : '',
    ...metaLines,
      ].filter(Boolean).join('\n')
    : 'Agent data: n/a'

  const fieldPrompts = fields.map(formatFieldPrompt).join('\n')
  const structuredDataInstructions = [
    'Structured data templates (keep keys; fill in values):',
    `Site: ${SITE_STRUCTURED_DATA_TEMPLATE}`,
    `Page: ${PAGE_STRUCTURED_DATA_TEMPLATE}`,
  ].join('\n')

  const system = [
    'You are a website copywriter tasked with pre-filling CMS blocks for a brand-new site.',
    'Use the provided site/agent context and instructions.',
    'Keep outputs concise, professional, and free of placeholder words like "lorem ipsum".',
    'Return JSON only, with this shape: {"fields": {"<path>": <value>}}.',
    'For text/richtext/textarea: short, readable copy. For numbers: numeric only.',
    'For arrays without schema: array of short strings. For arrays with schema: array of objects matching the schema fields.',
    'For option fields: return one of the allowed option values (not the label).',
    'If you truly cannot infer a value, return an empty string for that key.',
    'For structuredData fields: return a JSON object matching the provided template shape.',
    'Preserve CMS tokens like {{cms-site}}, {{cms-url}}, and {{cms-logo}} exactly as-is.',
    'All content, including meta titles/descriptions and structured data, should be optimized for maximum SEO performance.',
  ].join(' ')

  const user = [
    siteSummary,
    `AI instructions: ${instructions || 'n/a'}`,
    agentSummary,
    '',
    structuredDataInstructions,
    '',
    'Fields to fill:',
    fieldPrompts,
  ].join('\n')

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenAI error ${resp.status}: ${txt}`)
  }

  const json = await resp.json()
  const content = json?.choices?.[0]?.message?.content || '{}'
  try {
    return JSON.parse(content)
  }
  catch (err) {
    logger.error('Failed to parse OpenAI response', err)
    return {}
  }
}

const applyAiResults = (descriptorMap, pagesSnap, aiResults, siteData = {}) => {
  if (!aiResults || typeof aiResults.fields !== 'object')
    return { pageUpdates: {}, siteUpdates: {} }

  const pageUpdates = {}
  const siteUpdates = {}
  const pageDocsMap = new Map()
  for (const doc of pagesSnap.docs)
    pageDocsMap.set(doc.id, doc.data() || {})

  for (const [path, value] of Object.entries(aiResults.fields)) {
    const descriptor = descriptorMap.get(path)
    if (!descriptor)
      continue

    const sanitized = sanitizeValueForMeta(descriptor.type, value, { option: descriptor.option, schema: descriptor.schema })
    if (sanitized === null || sanitized === undefined)
      continue
    if (Array.isArray(sanitized) && sanitized.length === 0)
      continue
    if (typeof sanitized === 'string' && sanitized.trim().length === 0)
      continue

    if (descriptor.location === 'siteMeta') {
      if (descriptor.field === 'structuredData')
        siteUpdates.structuredData = sanitized
      else if (descriptor.field === 'metaTitle')
        siteUpdates.metaTitle = sanitized
      else if (descriptor.field === 'metaDescription')
        siteUpdates.metaDescription = sanitized
      continue
    }

    const pageData = pageDocsMap.get(descriptor.pageId) || {}
    if (!pageUpdates[descriptor.pageId]) {
      pageUpdates[descriptor.pageId] = {
        content: Array.isArray(pageData.content) ? JSON.parse(JSON.stringify(pageData.content)) : [],
        postContent: Array.isArray(pageData.postContent) ? JSON.parse(JSON.stringify(pageData.postContent)) : [],
        metaTitle: pageData.metaTitle || '',
        metaDescription: pageData.metaDescription || '',
        structuredData: pageData.structuredData || '',
      }
    }

    if (descriptor.location === 'pageMeta') {
      if (descriptor.field === 'metaTitle')
        pageUpdates[descriptor.pageId].metaTitle = sanitized
      else if (descriptor.field === 'metaDescription')
        pageUpdates[descriptor.pageId].metaDescription = sanitized
      else if (descriptor.field === 'structuredData')
        pageUpdates[descriptor.pageId].structuredData = sanitized
      continue
    }

    const targetBlocks = descriptor.location === 'postContent' ? pageUpdates[descriptor.pageId].postContent : pageUpdates[descriptor.pageId].content
    const block = targetBlocks[descriptor.blockIndex]
    if (!block)
      continue
    block.values = block.values || {}
    block.values[descriptor.field] = sanitized
  }

  return { pageUpdates, siteUpdates }
}

const stripCodeFences = (text) => {
  if (!text)
    return ''
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

const extractJsonFromText = (text) => {
  const cleaned = stripCodeFences(text)
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace)
    return null
  const candidate = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    return JSON.parse(candidate)
  }
  catch {
    return null
  }
}

const parseAiJson = (text) => {
  if (!text)
    return null
  try {
    return JSON.parse(stripCodeFences(text))
  }
  catch {
    return extractJsonFromText(text)
  }
}

const buildBlockAiPrompt = ({
  blockId,
  blockName,
  content,
  fields,
  currentValues,
  meta,
  instructions,
}) => {
  const fieldLines = fields
    .map(field => `- ${field.id} (${field.type || 'text'}): ${field.label || ''}`)
    .join('\n')

  return [
    `Block ID: ${blockId}`,
    `Block Name: ${blockName || 'n/a'}`,
    '',
    'Selected fields:',
    fieldLines || '- none',
    '',
    'Block content (reference only):',
    content || 'n/a',
    '',
    'Field metadata (JSON):',
    JSON.stringify(meta || {}),
    '',
    'Current field values (JSON):',
    JSON.stringify(currentValues || {}),
    '',
    `Instructions: ${instructions || 'n/a'}`,
    '',
    'Return ONLY valid JSON.',
    'The response should be a JSON object where keys are the selected field ids.',
    'You must return values for every selected field. Do not omit any field.',
    'If unsure, make a best-guess value instead of leaving it blank.',
    'For richtext, return HTML strings. For textarea, return plain text.',
    'For arrays, return an array that matches the schema when possible.',
  ].join('\n')
}

const assertCallableUser = (request) => {
  if (!request?.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
}

const getRestrictedSiteRefs = (orgId, siteId) => {
  const orgRef = db.collection('organizations').doc(orgId)
  const siteRef = orgRef.collection('sites').doc(siteId)
  return {
    orgRef,
    siteRef,
    audienceUsersRef: siteRef.collection('audience-users'),
    privateStripeRef: siteRef.collection('private-integrations').doc('stripe'),
  }
}

const buildRestrictedRegistrationEmailIndexDocId = (email) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail)
    return ''
  return encodeURIComponent(normalizedEmail)
}

const getRestrictedRegistrationEmailIndexRef = (orgId, siteId, email) => {
  const emailDocId = buildRestrictedRegistrationEmailIndexDocId(email)
  if (!emailDocId)
    return null
  return db.collection('organizations').doc(orgId)
    .collection('sites').doc(siteId)
    .collection('private-restricted-registration-email-index')
    .doc(emailDocId)
}

const getGlobalRestrictedRegistrationEmailIndexRef = (email) => {
  const emailDocId = buildRestrictedRegistrationEmailIndexDocId(email)
  if (!emailDocId)
    return null
  return db.collection('private-restricted-registration-email-index').doc(emailDocId)
}

const getGlobalRestrictedRegistrationAuthIndexRef = (uid) => {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid)
    return null
  return db.collection('private-restricted-registration-auth-index').doc(normalizedUid)
}

const reserveGlobalRestrictedRegistrationDocId = async ({
  email,
  authUid = '',
  preferredDocId = '',
}) => {
  const normalizedEmail = normalizeEmail(email)
  const normalizedAuthUid = String(authUid || '').trim()
  const normalizedPreferredDocId = String(preferredDocId || '').trim()
  if (!normalizedEmail)
    return normalizedPreferredDocId

  const emailIndexRef = getGlobalRestrictedRegistrationEmailIndexRef(normalizedEmail)
  const authIndexRef = getGlobalRestrictedRegistrationAuthIndexRef(normalizedAuthUid)
  if (!emailIndexRef)
    return normalizedPreferredDocId

  return db.runTransaction(async (transaction) => {
    const now = Date.now()
    const emailIndexSnap = await transaction.get(emailIndexRef)
    const authIndexSnap = authIndexRef ? await transaction.get(authIndexRef) : null

    const emailIndexedDocId = String(emailIndexSnap.data()?.docId || '').trim()
    const authIndexedDocId = String(authIndexSnap?.data()?.docId || '').trim()

    let nextDocId = normalizedPreferredDocId || authIndexedDocId || emailIndexedDocId
    if (!nextDocId)
      nextDocId = db.collection('staged-users').doc().id

    transaction.set(emailIndexRef, {
      email: normalizedEmail,
      docId: nextDocId,
      doc_created_at: Number(emailIndexSnap.data()?.doc_created_at || now),
      last_updated: now,
    }, { merge: true })

    if (authIndexRef) {
      transaction.set(authIndexRef, {
        uid: normalizedAuthUid,
        email: normalizedEmail,
        docId: nextDocId,
        doc_created_at: Number(authIndexSnap?.data()?.doc_created_at || now),
        last_updated: now,
      }, { merge: true })
    }

    return nextDocId
  })
}

const reserveRestrictedRegistrationDocId = async ({
  orgId,
  siteId,
  email,
  preferredDocId = '',
}) => {
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  const normalizedEmail = normalizeEmail(email)
  const normalizedPreferredDocId = String(preferredDocId || '').trim()
  if (!normalizedOrgId || !normalizedSiteId || !normalizedEmail)
    return normalizedPreferredDocId

  const emailIndexRef = getRestrictedRegistrationEmailIndexRef(normalizedOrgId, normalizedSiteId, normalizedEmail)
  if (!emailIndexRef)
    return normalizedPreferredDocId

  if (normalizedPreferredDocId) {
    await emailIndexRef.set({
      email: normalizedEmail,
      docId: normalizedPreferredDocId,
      last_updated: Date.now(),
    }, { merge: true })
    return normalizedPreferredDocId
  }

  return db.runTransaction(async (transaction) => {
    const now = Date.now()
    const indexSnap = await transaction.get(emailIndexRef)
    const indexedDocId = String(indexSnap.data()?.docId || '').trim()
    if (indexedDocId) {
      transaction.set(emailIndexRef, {
        email: normalizedEmail,
        last_updated: now,
      }, { merge: true })
      return indexedDocId
    }

    const nextDocId = db.collection('staged-users').doc().id
    transaction.set(emailIndexRef, {
      email: normalizedEmail,
      docId: nextDocId,
      doc_created_at: now,
      last_updated: now,
    }, { merge: true })
    return nextDocId
  })
}

const getRestrictedSiteContext = async (orgId, siteId) => {
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  if (!normalizedOrgId || !normalizedSiteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')

  const { siteRef } = getRestrictedSiteRefs(normalizedOrgId, normalizedSiteId)
  const siteSnap = await siteRef.get()
  if (!siteSnap.exists)
    throw new HttpsError('not-found', 'Site not found.')

  const siteData = siteSnap.data() || {}
  const restrictedContent = (siteData.restrictedContent && typeof siteData.restrictedContent === 'object')
    ? siteData.restrictedContent
    : {}
  if (!restrictedContent.enabled)
    throw new HttpsError('failed-precondition', 'Restricted content is not enabled for this site.')

  return {
    siteRef,
    siteData,
    restrictedContent,
  }
}

const normalizeRestrictedRuleForFunction = (value = {}, fallbackId = '') => {
  const normalizedValue = (value && typeof value === 'object') ? value : {}
  const id = String(normalizedValue.id || normalizedValue.docId || fallbackId || '').trim()
  const stripeSource = String(normalizedValue.stripeSource || normalizedValue.registrationStripeSource || '').trim().toLowerCase()
  const registrationStripePrices = Array.isArray(normalizedValue.registrationStripePrices)
    ? normalizedValue.registrationStripePrices
    : (Array.isArray(normalizedValue.stripePrices) ? normalizedValue.stripePrices : [])
  const registrationStripeCoupons = Array.isArray(normalizedValue.registrationStripeCoupons)
    ? normalizedValue.registrationStripeCoupons
    : (Array.isArray(normalizedValue.stripeCoupons) ? normalizedValue.stripeCoupons : [])
  const normalizeInterval = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    return ['day', 'week', 'month', 'year'].includes(normalized) ? normalized : 'month'
  }
  return {
    id,
    name: String(normalizedValue.name || '').trim(),
    protected: normalizedValue.protected !== false,
    allowRegistration: Boolean(normalizedValue.allowRegistration),
    registrationMode: normalizedValue.registrationMode === 'paid' ? 'paid' : 'free',
    stripeSource: ['imported', 'managed'].includes(stripeSource) ? stripeSource : '',
    registrationStripeProductId: String(normalizedValue.registrationStripeProductId || normalizedValue.stripeProductId || '').trim(),
    registrationStripeImage: String(normalizedValue.registrationStripeImage || normalizedValue.stripeImage || '').trim(),
    registrationStripePrices: registrationStripePrices
      .map((item) => {
        const normalizedItem = (item && typeof item === 'object') ? item : {}
        return {
          priceId: String(normalizedItem.priceId || normalizedItem.id || '').trim(),
          title: String(normalizedItem.title || '').trim(),
          description: String(normalizedItem.description || '').trim(),
          amount: Number.isFinite(Number(normalizedItem.amount ?? normalizedItem.unitAmount))
            ? Number(normalizedItem.amount ?? normalizedItem.unitAmount)
            : 0,
          currency: String(normalizedItem.currency || 'usd').trim().toLowerCase() || 'usd',
          interval: normalizeInterval(normalizedItem.interval || normalizedItem.recurringInterval),
          intervalCount: Number.isFinite(Number(normalizedItem.intervalCount || normalizedItem.recurringIntervalCount))
            ? Math.max(1, Math.trunc(Number(normalizedItem.intervalCount || normalizedItem.recurringIntervalCount)))
            : 1,
          seats: Number.isFinite(Number(normalizedItem.seats || normalizedItem.quantity))
            ? Math.max(1, Math.trunc(Number(normalizedItem.seats || normalizedItem.quantity)))
            : 1,
        }
      }),
    registrationStripeCoupons: registrationStripeCoupons
      .map((item) => {
        const normalizedItem = (item && typeof item === 'object') ? item : {}
        const discountType = String(normalizedItem.discountType || '').trim().toLowerCase()
        const expiresMode = String(normalizedItem.expiresMode || '').trim().toLowerCase()
        return {
          couponId: String(normalizedItem.couponId || normalizedItem.id || '').trim(),
          promotionCodeId: String(normalizedItem.promotionCodeId || '').trim(),
          promoCode: String(normalizedItem.promoCode || normalizedItem.promotionCode || normalizedItem.code || '').trim(),
          title: String(normalizedItem.title || '').trim(),
          discountType: discountType === 'amount' ? 'amount' : 'percent',
          percentOff: Number.isFinite(Number(normalizedItem.percentOff))
            ? Number(normalizedItem.percentOff)
            : 10,
          amountOff: Number.isFinite(Number(normalizedItem.amountOff))
            ? Number(normalizedItem.amountOff)
            : 0,
          expiresMode: expiresMode === 'date' ? 'date' : 'never',
          expiresAt: String(normalizedItem.expiresAt || '').trim(),
        }
      })
      .filter((item) => {
        if (item.couponId || item.promoCode)
          return true
        if (item.discountType === 'amount')
          return Number(item.amountOff || 0) > 0
        return Number(item.percentOff || 0) > 0
      }),
  }
}

const getRestrictedRuleContext = async (orgId, siteId, ruleId, options = {}) => {
  const requireAllowRegistration = options.requireAllowRegistration !== false
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or ruleId.')

  const { siteRef, siteData, restrictedContent } = await getRestrictedSiteContext(orgId, siteId)

  const rules = Array.isArray(restrictedContent.rules) ? restrictedContent.rules : []
  const normalizedRules = rules
    .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
    .filter(item => item.id)
  const rule = normalizedRules.find(item => item.id === normalizedRuleId)
  if (!rule)
    throw new HttpsError('not-found', 'Restriction rule not found.')
  if (!rule.protected)
    throw new HttpsError('failed-precondition', 'This rule is not enforcing access right now.')
  if (requireAllowRegistration && !rule.allowRegistration)
    throw new HttpsError('failed-precondition', 'Registration is not allowed for this rule.')

  const effectiveRegistrationMode = rule.registrationMode === 'paid'
    ? 'paid'
    : 'free'

  return {
    siteRef,
    siteData,
    restrictedContent,
    rule,
    effectiveRegistrationMode,
  }
}

const buildRestrictedMemberPayload = ({
  existingMember = null,
  audienceUserId,
  ruleId,
  status,
  paymentStatus,
  markPaid = false,
  markPending = false,
  clearPending = false,
  clearPaid = false,
  now = Date.now(),
}) => {
  const existingAccessRuleIds = Array.isArray(existingMember?.accessRuleIds) ? existingMember.accessRuleIds : []
  let accessRuleIds = [...existingAccessRuleIds]
  const existingPaidAccessRuleIds = Array.isArray(existingMember?.paidAccessRuleIds) ? existingMember.paidAccessRuleIds : []
  const existingPendingPaymentRuleIds = Array.isArray(existingMember?.pendingPaymentRuleIds) ? existingMember.pendingPaymentRuleIds : []
  let paidAccessRuleIds = [...existingPaidAccessRuleIds]
  let pendingPaymentRuleIds = [...existingPendingPaymentRuleIds]

  if (markPaid && ruleId && !paidAccessRuleIds.includes(ruleId))
    paidAccessRuleIds.push(ruleId)
  if (clearPaid && ruleId)
    paidAccessRuleIds = paidAccessRuleIds.filter(item => item !== ruleId)

  if (markPaid && ruleId && !accessRuleIds.includes(ruleId))
    accessRuleIds.push(ruleId)
  if (clearPaid && ruleId)
    accessRuleIds = accessRuleIds.filter(item => item !== ruleId)

  if (markPending && ruleId && !pendingPaymentRuleIds.includes(ruleId))
    pendingPaymentRuleIds.push(ruleId)
  if (clearPending && ruleId)
    pendingPaymentRuleIds = pendingPaymentRuleIds.filter(item => item !== ruleId)

  return {
    audienceUserId,
    accessRuleIds,
    status: String(existingMember?.status || '').trim() || status,
    expiresAt: String(existingMember?.expiresAt || '').trim(),
    notes: String(existingMember?.notes || '').trim(),
    paidAccessRuleIds,
    pendingPaymentRuleIds,
    doc_created_at: Number(existingMember?.doc_created_at || now),
    last_updated: now,
  }
}

const findAudienceUserByEmail = async (audienceUsersRef, email) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail)
    return null
  const snap = await audienceUsersRef.where('email', '==', normalizedEmail).limit(1).get()
  if (snap.empty)
    return null
  return snap.docs[0]
}

const resolveAuthUserUidByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail)
    return ''
  try {
    const authUser = await admin.auth().getUserByEmail(normalizedEmail)
    return String(authUser?.uid || '').trim()
  }
  catch (error) {
    if (error?.code === 'auth/user-not-found')
      return ''
    throw error
  }
}

const grantRestrictedAudiencePathToUser = async ({ uid, permissionPath, email }) => {
  const normalizedUid = String(uid || '').trim()
  const normalizedPermissionPath = String(permissionPath || '').trim()
  if (!normalizedUid || !normalizedPermissionPath)
    return

  const userRef = db.collection('users').doc(normalizedUid)
  const userSnap = await userRef.get()
  const userData = userSnap.exists ? (userSnap.data() || {}) : {}
  const nextRoles = (userData.roles && typeof userData.roles === 'object' && !Array.isArray(userData.roles))
    ? { ...userData.roles }
    : {}
  nextRoles[normalizedPermissionPath] = {
    collectionPath: normalizedPermissionPath,
    role: 'user',
  }
  const nextCollectionPaths = Array.isArray(userData.collectionPaths)
    ? [...userData.collectionPaths]
    : []
  if (!nextCollectionPaths.includes(normalizedPermissionPath))
    nextCollectionPaths.push(normalizedPermissionPath)

  const updatePayload = {
    roles: nextRoles,
    collectionPaths: nextCollectionPaths,
    last_updated: Date.now(),
  }

  if (userSnap.exists) {
    await userRef.set(updatePayload, { merge: true })
  }
  else {
    await userRef.set({
      userId: normalizedUid,
      meta: {
        email: normalizeEmail(email),
      },
      ...updatePayload,
    }, { merge: true })
  }
}

const resolveAudienceUserForAuth = async (orgId, siteId, authUid) => {
  const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
  const audienceUsersRef = siteRef.collection('audience-users')
  const byAuthUid = await audienceUsersRef.where('authUid', '==', authUid).limit(1).get()
  if (!byAuthUid.empty)
    return byAuthUid.docs[0]

  const userSnap = await db.collection('users').doc(authUid).get()
  const stagedDocId = String(userSnap.data()?.stagedDocId || '').trim()
  if (stagedDocId) {
    const directAudienceSnap = await audienceUsersRef.doc(stagedDocId).get()
    if (directAudienceSnap.exists)
      return directAudienceSnap

    const byStagedId = await audienceUsersRef.where('stagedUserId', '==', stagedDocId).limit(1).get()
    if (!byStagedId.empty)
      return byStagedId.docs[0]
  }

  return null
}

const buildSeatOwnerKey = (ownerAudienceUserId, ruleId) => {
  const ownerId = String(ownerAudienceUserId || '').trim()
  const normalizedRuleId = String(ruleId || '').trim()
  if (!ownerId || !normalizedRuleId)
    return ''
  return `${ownerId}:${normalizedRuleId}`
}

const normalizeSeatOwnersByRule = (member = {}) => {
  const next = {}
  const raw = (member?.seatOwnersByRule && typeof member.seatOwnersByRule === 'object' && !Array.isArray(member.seatOwnersByRule))
    ? member.seatOwnersByRule
    : {}
  Object.keys(raw).forEach((ruleId) => {
    const normalizedRuleId = String(ruleId || '').trim()
    if (!normalizedRuleId)
      return
    const item = raw[ruleId]
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return
    const ownerAudienceUserId = String(item.ownerAudienceUserId || item.seatOwnerAudienceUserId || '').trim()
    if (!ownerAudienceUserId)
      return
    next[normalizedRuleId] = {
      ownerAudienceUserId,
      ownerAuthUid: String(item.ownerAuthUid || item.seatOwnerAuthUid || '').trim(),
      ownerName: String(item.ownerName || item.seatOwnerName || '').trim(),
      ownerEmail: String(item.ownerEmail || item.seatOwnerEmail || '').trim(),
      assignedAt: Number(item.assignedAt || 0) || 0,
    }
  })

  const legacyRuleId = String(member?.seatOwnerRuleId || '').trim()
  const legacyOwnerAudienceUserId = String(member?.seatOwnerAudienceUserId || '').trim()
  if (legacyRuleId && legacyOwnerAudienceUserId && !next[legacyRuleId]) {
    next[legacyRuleId] = {
      ownerAudienceUserId: legacyOwnerAudienceUserId,
      ownerAuthUid: String(member?.seatOwnerAuthUid || '').trim(),
      ownerName: String(member?.seatOwnerName || '').trim(),
      ownerEmail: String(member?.seatOwnerEmail || '').trim(),
      assignedAt: 0,
    }
  }

  return next
}

const getSeatOwnerForRule = (member = {}, ruleId = '') => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return null
  const map = normalizeSeatOwnersByRule(member)
  return map[normalizedRuleId] || null
}

const getSeatOwnerKeys = (member = {}) => {
  const byRule = normalizeSeatOwnersByRule(member)
  const keys = Object.keys(byRule)
    .map(ruleId => buildSeatOwnerKey(byRule[ruleId]?.ownerAudienceUserId, ruleId))
    .filter(Boolean)
  const explicitKeys = Array.isArray(member?.seatOwnerKeys)
    ? member.seatOwnerKeys.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return Array.from(new Set([...keys, ...explicitKeys]))
}

const getRestrictedSeatContextFromMember = (member = {}, preferredRuleId = '') => {
  const paidRuleIds = Array.isArray(member?.paidAccessRuleIds)
    ? member.paidAccessRuleIds.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const normalizedPreferredRuleId = String(preferredRuleId || '').trim()
  const ownershipMap = normalizeSeatOwnersByRule(member)
  const candidateRuleIds = normalizedPreferredRuleId
    ? [normalizedPreferredRuleId]
    : paidRuleIds
  const manageableRuleId = candidateRuleIds.find((ruleId) => {
    const ownerForRule = ownershipMap[ruleId]
    const isSeatChildForRule = Boolean(ownerForRule?.ownerAudienceUserId)
    if (isSeatChildForRule)
      return false
    const planState = getPlanStateForRule(member, ruleId)
    const quantity = Number.isFinite(Number(planState?.quantity))
      ? Math.max(1, Math.trunc(Number(planState.quantity)))
      : 1
    const paymentStatus = String(planState?.paymentStatus || '').trim().toLowerCase()
    const paymentPaused = planState?.paymentPaused === true
    const effectivePaymentStatus = paymentPaused && paymentStatus === 'paid'
      ? 'paused'
      : (paymentStatus || 'not_required')
    return quantity > 1 && ['paid', 'paused'].includes(effectivePaymentStatus)
  }) || ''
  const seatRuleId = manageableRuleId || normalizedPreferredRuleId || paidRuleIds[0] || ''
  const planState = getPlanStateForRule(member, seatRuleId)
  const ownerForRule = getSeatOwnerForRule(member, seatRuleId)
  const isSeatChild = Boolean(ownerForRule?.ownerAudienceUserId)
  const seatLimit = Number.isFinite(Number(planState?.quantity))
    ? Math.max(1, Math.trunc(Number(planState.quantity)))
    : (Number.isFinite(Number(member?.registrationPaymentQuantity))
        ? Math.max(1, Math.trunc(Number(member.registrationPaymentQuantity)))
        : 1)
  const paymentStatus = String(planState?.paymentStatus || '').trim().toLowerCase()
    || String(member?.registrationPaymentStatus || '').trim().toLowerCase()
  const paymentPaused = planState?.paymentPaused === true || member?.registrationPaymentPaused === true
  const effectivePaymentStatus = paymentPaused && paymentStatus === 'paid'
    ? 'paused'
    : (paymentStatus || 'not_required')
  const hasPaidAccessForRule = Boolean(seatRuleId && paidRuleIds.includes(seatRuleId))
  const canManageSeats = seatLimit > 1
    && hasPaidAccessForRule
    && !isSeatChild
    && ['paid', 'paused'].includes(effectivePaymentStatus)

  return {
    seatRuleId,
    seatLimit,
    paymentStatus: effectivePaymentStatus,
    isSeatChild,
    canManageSeats,
  }
}

const buildRestrictedPlanArray = async ({
  rules = [],
  memberData = {},
  blocked = false,
  audienceUsersRef = null,
  audienceUserId = '',
}) => {
  const paidRules = (Array.isArray(rules) ? rules : [])
    .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
    .filter(item => item.id && item.registrationMode === 'paid')
  if (!paidRules.length)
    return []

  const accessRuleIds = new Set(Array.isArray(memberData?.accessRuleIds) ? memberData.accessRuleIds.filter(Boolean) : [])
  const manualAccessRuleIds = new Set(Array.isArray(memberData?.manualAccessRuleIds) ? memberData.manualAccessRuleIds.filter(Boolean) : [])
  const paidAccessRuleIds = new Set(Array.isArray(memberData?.paidAccessRuleIds) ? memberData.paidAccessRuleIds.filter(Boolean) : [])
  const pendingPaymentRuleIds = new Set(Array.isArray(memberData?.pendingPaymentRuleIds) ? memberData.pendingPaymentRuleIds.filter(Boolean) : [])

  const ownerId = String(audienceUserId || '').trim()
  const relatedRules = paidRules.filter((rule) => {
    const ruleId = String(rule.id || '').trim()
    if (!ruleId)
      return false
    const isAssigned = accessRuleIds.has(ruleId)
    const isManualOverride = manualAccessRuleIds.has(ruleId)
    const isPaid = paidAccessRuleIds.has(ruleId)
    const paymentPending = pendingPaymentRuleIds.has(ruleId)
    if (isPaid || isManualOverride || (isAssigned && !paymentPending))
      return true
    const planState = getPlanStateForRule(memberData, ruleId)
    const planStatus = String(planState?.paymentStatus || '').trim().toLowerCase()
    return ['paid', 'paused'].includes(planStatus)
  })
  if (!relatedRules.length)
    return []

  return Promise.all(relatedRules.map(async (rule) => {
    const ruleId = String(rule.id || '').trim()
    const planState = getPlanStateForRule(memberData, ruleId)
    const isAssigned = accessRuleIds.has(ruleId)
    const isManualOverride = manualAccessRuleIds.has(ruleId)
    const isPaid = paidAccessRuleIds.has(ruleId)
    const paymentPending = pendingPaymentRuleIds.has(ruleId)
    const hasAccess = !blocked && (isPaid || isManualOverride || (isAssigned && !paymentPending))
    const paymentStatus = String(planState.paymentStatus || (isPaid ? 'paid' : (paymentPending ? 'pending' : 'not_required'))).trim().toLowerCase()
    const seatLimit = Number.isFinite(Number(planState.quantity))
      ? Math.max(1, Math.trunc(Number(planState.quantity)))
      : 1
    const ownerKey = buildSeatOwnerKey(ownerId, ruleId)
    let planSeatMembers = []
    if (audienceUsersRef && ownerKey) {
      const seatChildrenSnap = await audienceUsersRef.where('seatOwnerKeys', 'array-contains', ownerKey).get()
      planSeatMembers = seatChildrenSnap.docs
        .filter(doc => doc.id !== ownerId)
        .map((doc) => {
          const item = doc.data() || {}
          const childPlanState = getPlanStateForRule(item, ruleId)
          return {
            audienceUserId: doc.id,
            docId: doc.id,
            name: String(item.name || '').trim(),
            email: String(item.email || '').trim(),
            status: String(item.status || '').trim().toLowerCase() || 'inactive',
            registrationPaymentStatus: String(childPlanState?.paymentStatus || '').trim().toLowerCase(),
            seatOwnerRuleId: ruleId,
          }
        })
        .sort((a, b) => String(a.name || a.email || a.docId).localeCompare(String(b.name || b.email || b.docId)))
    }
    const activePlanSeatMembers = planSeatMembers.filter((item) => {
      const childStatus = String(item.status || '').trim().toLowerCase()
      return childStatus !== 'revoked'
    })
    const isSeatChild = Boolean(getSeatOwnerForRule(memberData, ruleId)?.ownerAudienceUserId)
    const canManageSeats = !isSeatChild
      && isPaid
      && seatLimit > 1
      && ['paid', 'paused'].includes(paymentStatus)
    const seatsUsed = seatLimit > 1
      ? (1 + activePlanSeatMembers.length)
      : 1

    return {
      ruleId,
      ruleName: String(rule.name || ruleId).trim(),
      requiresPayment: true,
      hasAccess,
      isAssigned,
      isPaid,
      isManualOverride,
      paymentPending,
      paymentStatus,
      paymentPaused: planState.paymentPaused === true,
      stripeSubscriptionId: String(planState.stripeSubscriptionId || '').trim(),
      stripePriceId: String(planState.stripePriceId || '').trim(),
      currentPeriodEnd: Number(planState.currentPeriodEnd || 0) || 0,
      cancelAt: Number(planState.cancelAt || 0) || 0,
      currency: String(planState.currency || '').trim().toLowerCase(),
      interval: String(planState.interval || '').trim().toLowerCase(),
      intervalCount: Number(planState.intervalCount || 0) || 0,
      quantity: Number(planState.quantity || 0) || 0,
      baseAmountCents: Number(planState.baseAmountCents || 0) || 0,
      discountAmountCents: Number(planState.discountAmountCents || 0) || 0,
      amountCents: Number(planState.amountCents || 0) || 0,
      couponCode: String(planState.couponCode || '').trim(),
      couponLabel: String(planState.couponLabel || '').trim(),
      canManageSeats,
      seatLimit,
      seatsUsed,
      seatMembers: planSeatMembers,
    }
  }))
}

const listSeatChildrenForOwner = async ({ audienceUsersRef, ownerAudienceUserId, seatRuleId = '' }) => {
  const ownerId = String(ownerAudienceUserId || '').trim()
  const normalizedSeatRuleId = String(seatRuleId || '').trim()
  if (!ownerId || !normalizedSeatRuleId)
    return []
  const ownerKey = buildSeatOwnerKey(ownerId, normalizedSeatRuleId)
  const snap = await audienceUsersRef.where('seatOwnerKeys', 'array-contains', ownerKey).get()
  return snap.docs.filter(doc => doc.id !== ownerId)
}

const buildStripePriceSummary = (price) => {
  if (!price)
    return null
  return {
    id: price.id,
    currency: price.currency || 'usd',
    unitAmount: Number(price.unit_amount || 0),
    nickname: price.nickname || '',
    recurring: price.recurring
      ? {
          interval: price.recurring.interval || '',
          intervalCount: Number(price.recurring.interval_count || 1),
        }
      : null,
  }
}

const STRIPE_CMS_MANAGED_METADATA_KEY = 'cmsManaged'
const STRIPE_CMS_ORG_METADATA_KEY = 'cmsOrgId'
const STRIPE_CMS_SITE_METADATA_KEY = 'cmsSiteId'
const STRIPE_CMS_RULE_METADATA_KEY = 'cmsRuleId'

const isStripeObjectManagedForSite = (metadata = {}, orgId, siteId) => {
  if (!metadata || typeof metadata !== 'object')
    return false
  return String(metadata[STRIPE_CMS_MANAGED_METADATA_KEY] || '').toLowerCase() === 'true'
    && String(metadata[STRIPE_CMS_ORG_METADATA_KEY] || '').trim() === String(orgId || '').trim()
    && String(metadata[STRIPE_CMS_SITE_METADATA_KEY] || '').trim() === String(siteId || '').trim()
}

const isStripeObjectManagedForRule = (metadata = {}, orgId, siteId, ruleId) => {
  return isStripeObjectManagedForSite(metadata, orgId, siteId)
    && String(metadata[STRIPE_CMS_RULE_METADATA_KEY] || '').trim() === String(ruleId || '').trim()
}

const getStripeClientForSite = async (orgId, siteId) => {
  const { privateStripeRef } = getRestrictedSiteRefs(orgId, siteId)
  const stripeSnap = await privateStripeRef.get()
  if (!stripeSnap.exists)
    throw new HttpsError('failed-precondition', 'Stripe is not configured for this site.')

  const stripeConfig = stripeSnap.data() || {}
  const stripeSecretKey = String(stripeConfig.secretKey || '').trim()
  if (!stripeSecretKey)
    throw new HttpsError('failed-precondition', 'Stripe secret key is missing for this site.')
  return new Stripe(stripeSecretKey)
}

const deriveFileNameFromUrl = (url, fallback = 'site-logo') => {
  try {
    const pathname = String(new URL(url).pathname || '')
    const base = pathname.split('/').pop() || ''
    const clean = String(base).trim()
    if (clean)
      return clean
  }
  catch {}
  return fallback
}

const ensureImageFileExtension = (name, contentType = '') => {
  const normalizedName = String(name || '').trim() || 'site-logo'
  if (/\.[A-Za-z0-9]+$/.test(normalizedName))
    return normalizedName
  const normalizedType = String(contentType || '').trim().toLowerCase()
  if (normalizedType.includes('image/png'))
    return `${normalizedName}.png`
  if (normalizedType.includes('image/jpeg') || normalizedType.includes('image/jpg'))
    return `${normalizedName}.jpg`
  if (normalizedType.includes('image/webp'))
    return `${normalizedName}.webp`
  if (normalizedType.includes('image/gif'))
    return `${normalizedName}.gif`
  return `${normalizedName}.png`
}

const syncStripeBrandingLogoForSite = async ({ stripe, siteData }) => {
  const logoUrl = String(siteData?.logo || siteData?.logoLight || '').trim()
  if (!logoUrl) {
    return {
      applied: false,
      reason: 'no-site-logo',
      logoUrl: '',
    }
  }

  const response = await fetch(logoUrl)
  if (!response.ok) {
    throw new HttpsError('failed-precondition', `Unable to download site logo (${response.status}).`)
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw new HttpsError('failed-precondition', 'Site logo URL is not an image.')
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (!buffer.length) {
    throw new HttpsError('failed-precondition', 'Site logo file is empty.')
  }

  const logoFile = await stripe.files.create({
    purpose: 'business_logo',
    file: {
      data: buffer,
      name: ensureImageFileExtension(deriveFileNameFromUrl(logoUrl), contentType),
      type: contentType || 'image/png',
    },
  })
  const logoFileId = String(logoFile?.id || '').trim()
  if (!logoFileId)
    throw new HttpsError('internal', 'Stripe branding logo upload failed.')

  const account = await stripe.accounts.retrieve()
  const accountId = String(account?.id || '').trim()
  if (!accountId)
    throw new HttpsError('internal', 'Unable to resolve Stripe account for branding update.')

  await stripe.accounts.update(accountId, {
    settings: {
      branding: {
        logo: logoFileId,
      },
    },
  })

  return {
    applied: true,
    reason: '',
    logoUrl,
    logoFileId,
    accountId,
  }
}

const restrictedContentManageRoles = new Set(['admin', 'manager'])

const canManageRestrictedContentForSite = async (uid, orgId, siteId) => {
  const normalizedUid = String(uid || '').trim()
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  if (!normalizedUid || !normalizedOrgId || !normalizedSiteId)
    return false

  const targetCollectionPath = `organizations-${normalizedOrgId}-sites-${normalizedSiteId}`
  const userSnap = await db.collection('users').doc(normalizedUid).get()
  if (!userSnap.exists)
    return false

  const userData = userSnap.data() || {}
  const roleEntries = (userData.roles && typeof userData.roles === 'object' && !Array.isArray(userData.roles))
    ? Object.values(userData.roles)
    : []

  return roleEntries.some((roleEntry) => {
    if (!roleEntry || typeof roleEntry !== 'object')
      return false

    const roleCollectionPath = String(roleEntry.collectionPath || '').trim()
    if (!roleCollectionPath || !targetCollectionPath.startsWith(roleCollectionPath))
      return false

    const roleName = String(roleEntry.role || '').trim().toLowerCase()
    return restrictedContentManageRoles.has(roleName)
  })
}

const ensureRestrictedSiteWritePermission = async (uid, orgId, siteId) => {
  const allowed = await canManageRestrictedContentForSite(uid, orgId, siteId)
  if (!allowed)
    throw new HttpsError('permission-denied', 'Not allowed to manage restricted content for this site.')
}

const upsertManagedStripeMetadata = async ({ stripe, orgId, siteId, ruleId, productId, priceId, couponId, promotionCodeId }) => {
  const metadataPatch = {
    [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
    [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
    [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
    [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
  }
  if (productId)
    await stripe.products.update(productId, { metadata: metadataPatch })
  if (priceId)
    await stripe.prices.update(priceId, { metadata: metadataPatch })
  if (couponId)
    await stripe.coupons.update(couponId, { metadata: metadataPatch })
  if (promotionCodeId)
    await stripe.promotionCodes.update(promotionCodeId, { metadata: metadataPatch })
}

const getStripeMetadata = (object = {}) => {
  if (object?.metadata && typeof object.metadata === 'object' && Object.keys(object.metadata).length)
    return object.metadata

  if (object?.subscription_details?.metadata && typeof object.subscription_details.metadata === 'object')
    return object.subscription_details.metadata

  return {}
}

const extractStripeMetadataFromRawWebhookBody = (req) => {
  try {
    const rawBody = Buffer.isBuffer(req?.rawBody)
      ? req.rawBody.toString('utf8')
      : (typeof req?.rawBody === 'string' ? req.rawBody : '')
    const parsed = rawBody ? JSON.parse(rawBody) : (req?.body && typeof req.body === 'object' ? req.body : null)
    if (!parsed || typeof parsed !== 'object')
      return {}
    const object = parsed?.data?.object || {}
    return getStripeMetadata(object)
  }
  catch {
    return {}
  }
}

const resolveRuleStripeImage = (rule = {}) => {
  const explicit = String(rule?.registrationStripeImage || '').trim()
  if (explicit)
    return explicit

  return ''
}

const toStripeCouponRedeemBy = (expiresAt) => {
  const normalized = String(expiresAt || '').trim()
  if (!normalized)
    return null
  const millis = Date.parse(`${normalized}T23:59:59.000Z`)
  if (!Number.isFinite(millis))
    return null
  return Math.floor(millis / 1000)
}

const normalizeCouponConfigForStripe = (option = {}) => {
  const discountType = String(option?.discountType || '').trim().toLowerCase() === 'amount' ? 'amount' : 'percent'
  const percentOff = Number(option?.percentOff || 0)
  const amountOff = Number(option?.amountOff || 0)
  const expiresMode = String(option?.expiresMode || '').trim().toLowerCase() === 'date' ? 'date' : 'never'
  const expiresAt = String(option?.expiresAt || '').trim()
  const promoCode = String(option?.promoCode || '').trim()
  const redeemBy = expiresMode === 'date' ? toStripeCouponRedeemBy(expiresAt) : null
  return {
    discountType,
    percentOff: Number.isFinite(percentOff) ? percentOff : 0,
    amountOff: Number.isFinite(amountOff) ? amountOff : 0,
    expiresMode,
    expiresAt,
    promoCode,
    redeemBy,
  }
}

const stripeCouponMatchesConfig = (coupon = {}, config = {}) => {
  if (!coupon || coupon.deleted)
    return false
  if (config.discountType === 'amount') {
    const expectedAmountOff = Math.round(Number(config.amountOff || 0) * 100)
    if (!Number.isFinite(expectedAmountOff) || expectedAmountOff <= 0)
      return false
    if (Number(coupon.amount_off || 0) !== expectedAmountOff)
      return false
    if (String(coupon.currency || '').toLowerCase() !== 'usd')
      return false
  }
  else {
    const expectedPercent = Number(config.percentOff || 0)
    if (!Number.isFinite(expectedPercent) || expectedPercent <= 0 || expectedPercent > 100)
      return false
    if (Number(coupon.percent_off || 0) !== expectedPercent)
      return false
  }
  if (String(coupon.duration || '') !== 'forever')
    return false
  if (config.redeemBy) {
    if (Number(coupon.redeem_by || 0) !== Number(config.redeemBy))
      return false
  }
  else if (coupon.redeem_by !== null && coupon.redeem_by !== undefined) {
    return false
  }
  return true
}

const stripePromotionCodeMatchesConfig = (promotionCode = {}, config = {}, couponId, orgId, siteId, ruleId) => {
  if (!promotionCode || !promotionCode.id)
    return false
  if (promotionCode.active !== true)
    return false
  if (String(promotionCode.coupon?.id || promotionCode.coupon || '').trim() !== String(couponId || '').trim())
    return false
  if (String(promotionCode.code || '').trim().toLowerCase() !== String(config.promoCode || '').trim().toLowerCase())
    return false
  return isStripeObjectManagedForRule(promotionCode.metadata, orgId, siteId, ruleId)
}

const updateRestrictedMemberPaymentState = async ({
  orgId,
  siteId,
  audienceUserId,
  ruleId,
  paymentStatus,
  billingSnapshot = null,
  paymentPaused,
  grantPaidAccess = false,
  revokePaidAccess = false,
}) => {
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  const normalizedAudienceUserId = String(audienceUserId || '').trim()
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedOrgId || !normalizedSiteId || !normalizedAudienceUserId || !normalizedRuleId)
    return

  const { audienceUsersRef } = getRestrictedSiteRefs(normalizedOrgId, normalizedSiteId)
  const memberRef = audienceUsersRef.doc(normalizedAudienceUserId)
  const memberSnap = await memberRef.get()
  const memberData = memberSnap.exists ? (memberSnap.data() || {}) : {}
  const normalizedPaymentStatus = String(paymentStatus || '').trim().toLowerCase()
  const now = Date.now()

  const registrationPlanStates = getRegistrationPlanStates(memberData)
  const existingPlanState = getPlanStateForRule(memberData, normalizedRuleId)
  const snapshotPatch = (billingSnapshot && typeof billingSnapshot === 'object' && !Array.isArray(billingSnapshot))
    ? buildPlanStateFromBillingSnapshot(billingSnapshot)
    : {}
  const nextPlanState = {
    ...existingPlanState,
    ...snapshotPatch,
    paymentStatus: normalizedPaymentStatus || String(existingPlanState.paymentStatus || '').trim().toLowerCase() || 'pending',
    paymentPaused: typeof paymentPaused === 'boolean'
      ? paymentPaused
      : (existingPlanState.paymentPaused === true),
    lastUpdated: now,
  }
  registrationPlanStates[normalizedRuleId] = nextPlanState

  await memberRef.set({
    ...buildRestrictedMemberPayload({
      existingMember: memberData,
      audienceUserId: normalizedAudienceUserId,
      ruleId: normalizedRuleId,
      status: String(memberData.status || '').trim() || 'active',
      paymentStatus: normalizedPaymentStatus,
      markPaid: grantPaidAccess,
      markPending: !grantPaidAccess && !revokePaidAccess && normalizedPaymentStatus === 'pending',
      clearPending: grantPaidAccess || revokePaidAccess,
      clearPaid: revokePaidAccess,
      now,
    }),
    registrationPlanStates,
    last_updated: now,
  }, { merge: true })
}

const subscriptionStatusRank = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  const ranking = {
    active: 0,
    trialing: 1,
    past_due: 2,
    unpaid: 3,
    incomplete: 4,
    incomplete_expired: 5,
    canceled: 6,
  }
  if (Number.isInteger(ranking[normalized]))
    return ranking[normalized]
  return 99
}

const subscriptionMatchesRule = (subscription = {}, { orgId, siteId, ruleId, rulePriceIds, ruleProductId }) => {
  if (!subscription || !subscription.id)
    return false

  const metadata = (subscription.metadata && typeof subscription.metadata === 'object') ? subscription.metadata : {}
  if (isStripeObjectManagedForRule(metadata, orgId, siteId, ruleId))
    return true

  if (
    String(metadata.orgId || '').trim() === String(orgId || '').trim()
    && String(metadata.siteId || '').trim() === String(siteId || '').trim()
    && String(metadata.ruleId || '').trim() === String(ruleId || '').trim()
  ) {
    return true
  }

  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : []
  for (const item of items) {
    const priceId = String(item?.price?.id || '').trim()
    if (priceId && rulePriceIds.has(priceId))
      return true

    const productId = String(item?.price?.product || '').trim()
    if (productId && ruleProductId && productId === ruleProductId)
      return true
  }

  return false
}

const pickSubscriptionForRule = (subscriptions = [], context = {}) => {
  if (!Array.isArray(subscriptions) || !subscriptions.length)
    return null
  const matches = subscriptions
    .filter(item => subscriptionMatchesRule(item, context))
    .sort((a, b) => {
      const rankDiff = subscriptionStatusRank(a?.status) - subscriptionStatusRank(b?.status)
      if (rankDiff !== 0)
        return rankDiff

      const aEnds = Number(a?.current_period_end || 0)
      const bEnds = Number(b?.current_period_end || 0)
      if (aEnds !== bEnds)
        return bEnds - aEnds

      const aCreated = Number(a?.created || 0)
      const bCreated = Number(b?.created || 0)
      return bCreated - aCreated
    })
  return matches[0] || null
}

const parseStripeActionDateToUnix = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized)
    return 0
  const timestamp = Date.parse(`${normalized}T23:59:59.000Z`)
  if (!Number.isFinite(timestamp))
    return 0
  return Math.floor(timestamp / 1000)
}

const toStripeAmountCents = (value) => {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount))
    return 0
  return Math.max(0, Math.round(amount))
}

const computeSubscriptionDiscountCents = (subscription = {}, baseAmountCents = 0) => {
  const discount = (subscription?.discount && typeof subscription.discount === 'object') ? subscription.discount : null
  const coupon = (discount?.coupon && typeof discount.coupon === 'object') ? discount.coupon : null
  if (!coupon)
    return 0

  const amountOff = toStripeAmountCents(coupon.amount_off)
  if (amountOff > 0)
    return Math.min(baseAmountCents, amountOff)

  const percentOff = Number(coupon.percent_off || 0)
  if (!Number.isFinite(percentOff) || percentOff <= 0)
    return 0

  return Math.min(baseAmountCents, Math.round(baseAmountCents * (percentOff / 100)))
}

const buildStripeSubscriptionBillingSnapshot = (subscription = {}) => {
  const firstItem = Array.isArray(subscription?.items?.data) ? subscription.items.data[0] : null
  const price = firstItem?.price || null
  const quantity = Number.isFinite(Number(firstItem?.quantity))
    ? Math.max(1, Math.trunc(Number(firstItem.quantity)))
    : 1
  const unitAmountCents = toStripeAmountCents(price?.unit_amount)
  const baseAmountCents = unitAmountCents * quantity
  const discountAmountCents = computeSubscriptionDiscountCents(subscription, baseAmountCents)
  const paymentAmountCents = Math.max(0, baseAmountCents - discountAmountCents)
  const coupon = subscription?.discount?.coupon || null

  return {
    registrationStripeSubscriptionId: String(subscription?.id || '').trim(),
    registrationStripePriceId: String(price?.id || '').trim(),
    registrationStripeCurrentPeriodEnd: Number(subscription?.current_period_end || 0) || 0,
    registrationStripeCancelAt: Number(subscription?.cancel_at || 0) || 0,
    registrationPaymentCurrency: String(price?.currency || 'usd').trim().toLowerCase() || 'usd',
    registrationPaymentInterval: String(price?.recurring?.interval || '').trim().toLowerCase(),
    registrationPaymentIntervalCount: Number.isFinite(Number(price?.recurring?.interval_count))
      ? Math.max(1, Math.trunc(Number(price.recurring.interval_count)))
      : 1,
    registrationPaymentQuantity: quantity,
    registrationPaymentBaseAmountCents: baseAmountCents,
    registrationPaymentDiscountAmountCents: discountAmountCents,
    registrationPaymentAmountCents: paymentAmountCents,
    registrationCouponCode: '',
    registrationCouponLabel: String(coupon?.name || coupon?.id || '').trim(),
  }
}

const buildStripeCheckoutBillingSnapshot = async ({ stripe, session = {}, metadata = {} }) => {
  const quantity = Number.isFinite(Number(metadata?.quantity))
    ? Math.max(1, Math.trunc(Number(metadata.quantity)))
    : 1
  const priceId = String(metadata?.stripePriceId || '').trim()
  const promotionCodeId = String(session?.total_details?.breakdown?.discounts?.[0]?.discount?.promotion_code || '').trim()
  const couponId = String(session?.total_details?.breakdown?.discounts?.[0]?.discount?.coupon || '').trim()
  let couponCode = ''
  let couponLabel = ''
  if (promotionCodeId) {
    try {
      const promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId)
      couponCode = String(promotionCode?.code || '').trim()
      if (!couponLabel)
        couponLabel = String(promotionCode?.code || '').trim()
    }
    catch {}
  }
  if (couponId) {
    try {
      const coupon = await stripe.coupons.retrieve(couponId)
      if (!couponLabel)
        couponLabel = String(coupon?.name || coupon?.id || '').trim()
    }
    catch {}
  }

  let price = null
  if (priceId) {
    try {
      price = await stripe.prices.retrieve(priceId)
    }
    catch {}
  }

  const currency = String(price?.currency || session?.currency || 'usd').trim().toLowerCase() || 'usd'
  const unitAmountCents = toStripeAmountCents(price?.unit_amount)
  const baseAmountCents = unitAmountCents > 0
    ? unitAmountCents * quantity
    : toStripeAmountCents(session?.amount_subtotal || session?.subtotal || 0)
  const discountAmountCents = toStripeAmountCents(session?.total_details?.amount_discount || 0)
  const totalFromSession = toStripeAmountCents(session?.amount_total || session?.total || 0)
  const paymentAmountCents = totalFromSession > 0 ? totalFromSession : Math.max(0, baseAmountCents - discountAmountCents)
  const subscriptionId = String(session?.subscription || '').trim()
  let subscription = null
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price'],
      })
    }
    catch {}
  }
  const subscriptionPeriodEnd = Number(subscription?.current_period_end || 0) || 0
  const subscriptionCancelAt = Number(subscription?.cancel_at || 0) || 0

  return {
    registrationStripeSubscriptionId: subscriptionId,
    registrationStripePriceId: priceId,
    registrationStripeCurrentPeriodEnd: subscriptionPeriodEnd,
    registrationStripeCancelAt: subscriptionCancelAt,
    registrationPaymentCurrency: currency,
    registrationPaymentInterval: String(price?.recurring?.interval || '').trim().toLowerCase(),
    registrationPaymentIntervalCount: Number.isFinite(Number(price?.recurring?.interval_count))
      ? Math.max(1, Math.trunc(Number(price.recurring.interval_count)))
      : 1,
    registrationPaymentQuantity: quantity,
    registrationPaymentBaseAmountCents: baseAmountCents,
    registrationPaymentDiscountAmountCents: discountAmountCents,
    registrationPaymentAmountCents: paymentAmountCents,
    registrationCouponCode: couponCode,
    registrationCouponLabel: couponLabel,
  }
}

const getRegistrationPlanStates = (member = {}) => {
  const raw = (member?.registrationPlanStates && typeof member.registrationPlanStates === 'object' && !Array.isArray(member.registrationPlanStates))
    ? member.registrationPlanStates
    : {}
  const next = {}
  Object.keys(raw).forEach((ruleId) => {
    const normalizedRuleId = String(ruleId || '').trim()
    if (!normalizedRuleId)
      return
    const item = raw[ruleId]
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return
    next[normalizedRuleId] = { ...item }
  })
  return next
}

const buildPlanStateFromBillingSnapshot = (billingSnapshot = {}) => ({
  stripeSubscriptionId: String(billingSnapshot.registrationStripeSubscriptionId || '').trim(),
  stripePriceId: String(billingSnapshot.registrationStripePriceId || '').trim(),
  currentPeriodEnd: Number(billingSnapshot.registrationStripeCurrentPeriodEnd || 0) || 0,
  cancelAt: Number(billingSnapshot.registrationStripeCancelAt || 0) || 0,
  currency: String(billingSnapshot.registrationPaymentCurrency || '').trim().toLowerCase(),
  interval: String(billingSnapshot.registrationPaymentInterval || '').trim().toLowerCase(),
  intervalCount: Number(billingSnapshot.registrationPaymentIntervalCount || 0) || 0,
  quantity: Number(billingSnapshot.registrationPaymentQuantity || 0) || 0,
  baseAmountCents: Number(billingSnapshot.registrationPaymentBaseAmountCents || 0) || 0,
  discountAmountCents: Number(billingSnapshot.registrationPaymentDiscountAmountCents || 0) || 0,
  amountCents: Number(billingSnapshot.registrationPaymentAmountCents || 0) || 0,
  couponCode: String(billingSnapshot.registrationCouponCode || '').trim(),
  couponLabel: String(billingSnapshot.registrationCouponLabel || '').trim(),
})

const getPlanStateForRule = (member = {}, ruleId = '') => {
  const normalizedRuleId = String(ruleId || '').trim()
  if (!normalizedRuleId)
    return {}
  const states = getRegistrationPlanStates(member)
  if (states[normalizedRuleId] && typeof states[normalizedRuleId] === 'object')
    return { ...states[normalizedRuleId] }

  const legacyRuleId = String(member?.registrationRuleId || '').trim()
  if (legacyRuleId !== normalizedRuleId)
    return {}

  return {
    paymentStatus: String(member?.registrationPaymentStatus || '').trim().toLowerCase(),
    paymentPaused: member?.registrationPaymentPaused === true,
    ...buildPlanStateFromBillingSnapshot(member),
  }
}

const syncSeatMembersFromOwner = async ({
  orgId,
  siteId,
  ownerAudienceUserId,
  ownerRuleId,
  paymentStatus,
  grantPaidAccess,
  revokePaidAccess,
  registrationPaymentPaused,
  ownerDataPatch = {},
}) => {
  const normalizedOwnerAudienceUserId = String(ownerAudienceUserId || '').trim()
  const normalizedOwnerRuleId = String(ownerRuleId || '').trim()
  if (!normalizedOwnerAudienceUserId || !normalizedOwnerRuleId)
    return 0

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  const seatChildrenDocs = await listSeatChildrenForOwner({
    audienceUsersRef,
    ownerAudienceUserId: normalizedOwnerAudienceUserId,
    seatRuleId: normalizedOwnerRuleId,
  })
  if (!seatChildrenDocs.length)
    return 0

  const now = Date.now()
  const statusValue = String(paymentStatus || '').trim().toLowerCase()
  const updates = seatChildrenDocs.map(async (docSnap) => {
    const member = docSnap.data() || {}
    const billingSnapshot = (ownerDataPatch && typeof ownerDataPatch === 'object' && !Array.isArray(ownerDataPatch))
      ? ownerDataPatch
      : {}
    const childPlanStates = getRegistrationPlanStates(member)
    const existingPlanState = getPlanStateForRule(member, normalizedOwnerRuleId)
    childPlanStates[normalizedOwnerRuleId] = {
      ...existingPlanState,
      ...buildPlanStateFromBillingSnapshot(billingSnapshot),
      paymentStatus: statusValue || String(existingPlanState.paymentStatus || '').trim().toLowerCase() || 'pending',
      paymentPaused: registrationPaymentPaused === true,
      lastUpdated: now,
    }
    const basePayload = buildRestrictedMemberPayload({
      existingMember: member,
      audienceUserId: docSnap.id,
      ruleId: normalizedOwnerRuleId,
      status: String(member.status || '').trim() || 'active',
      paymentStatus: statusValue || String(existingPlanState.paymentStatus || '').trim().toLowerCase() || 'pending',
      markPaid: grantPaidAccess === true,
      markPending: false,
      clearPending: true,
      clearPaid: revokePaidAccess === true,
      now,
    })
    await docSnap.ref.set({
      ...basePayload,
      registrationPlanStates: childPlanStates,
      last_updated: now,
    }, { merge: true })
  })

  await Promise.all(updates)
  return seatChildrenDocs.length
}

const cancelStripeCustomerSubscriptionsForSite = async ({ stripe, customerId, orgId, siteId }) => {
  const normalizedCustomerId = String(customerId || '').trim()
  const normalizedOrgId = String(orgId || '').trim()
  const normalizedSiteId = String(siteId || '').trim()
  if (!stripe || !normalizedCustomerId)
    return { cancelledIds: [], attemptedIds: [] }

  const response = await stripe.subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 100,
  })
  const subscriptions = Array.isArray(response?.data) ? response.data : []
  const attemptedIds = []
  const cancelledIds = []
  for (const subscription of subscriptions) {
    const subscriptionId = String(subscription?.id || '').trim()
    if (!subscriptionId)
      continue
    const status = String(subscription?.status || '').trim().toLowerCase()
    if (['canceled', 'incomplete_expired'].includes(status))
      continue

    const metadata = (subscription?.metadata && typeof subscription.metadata === 'object') ? subscription.metadata : {}
    const subscriptionOrgId = String(metadata.orgId || '').trim()
    const subscriptionSiteId = String(metadata.siteId || '').trim()
    if (normalizedOrgId && normalizedSiteId && (subscriptionOrgId !== normalizedOrgId || subscriptionSiteId !== normalizedSiteId))
      continue

    attemptedIds.push(subscriptionId)
    try {
      const cancelled = await stripe.subscriptions.cancel(subscriptionId)
      if (String(cancelled?.status || '').trim().toLowerCase() === 'canceled')
        cancelledIds.push(subscriptionId)
    }
    catch (error) {
      logger.warn('cancelStripeCustomerSubscriptions failed for one subscription', {
        customerId: normalizedCustomerId,
        subscriptionId,
        message: error?.message || String(error),
      })
    }
  }
  return { cancelledIds, attemptedIds }
}

exports.restrictedContentManageStripeSubscription = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const uid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const audienceUserId = String(data.audienceUserId || '').trim()
  const ruleId = String(data.ruleId || '').trim()
  const action = String(data.action || '').trim().toLowerCase()
  const effectiveDate = String(data.effectiveDate || '').trim()
  const noEnd = data.noEnd === true

  if (!orgId || !siteId || !audienceUserId || !ruleId || !action)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, audienceUserId, ruleId, or action.')
  if (!['cancel', 'pause', 'resume', 'update_duration'].includes(action))
    throw new HttpsError('invalid-argument', 'Invalid action for Stripe subscription update.')

  await ensureRestrictedSiteWritePermission(uid, orgId, siteId)
  const { rule, effectiveRegistrationMode } = await getRestrictedRuleContext(orgId, siteId, ruleId, { requireAllowRegistration: false })
  if (effectiveRegistrationMode !== 'paid')
    throw new HttpsError('failed-precondition', 'Only paid plans can be managed in Stripe.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  const memberRef = audienceUsersRef.doc(audienceUserId)
  const memberSnap = await memberRef.get()
  if (!memberSnap.exists)
    throw new HttpsError('not-found', 'Member not found.')

  const memberData = memberSnap.data() || {}
  const customerId = String(data.customerId || memberData.billingStripeCustomerId || '').trim()
  if (!customerId)
    throw new HttpsError('failed-precondition', 'Member does not have a Stripe customer id.')

  const stripe = await getStripeClientForSite(orgId, siteId)
  const subscriptionsResponse = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
    expand: ['data.items.data.price'],
  })
  const subscriptions = Array.isArray(subscriptionsResponse?.data) ? subscriptionsResponse.data : []
  const rulePriceIds = new Set(
    (Array.isArray(rule.registrationStripePrices) ? rule.registrationStripePrices : [])
      .map(item => String(item?.priceId || '').trim())
      .filter(Boolean),
  )
  const ruleProductId = String(rule.registrationStripeProductId || '').trim()
  const subscription = pickSubscriptionForRule(subscriptions, {
    orgId,
    siteId,
    ruleId,
    rulePriceIds,
    ruleProductId,
  })
  if (!subscription)
    throw new HttpsError('not-found', 'No Stripe subscription found for this member and plan.')

  let updatedSubscription = subscription
  let message = 'Stripe subscription updated.'
  if (action === 'cancel') {
    updatedSubscription = await stripe.subscriptions.cancel(subscription.id)
    const billingSnapshot = buildStripeSubscriptionBillingSnapshot(updatedSubscription)
    await updateRestrictedMemberPaymentState({
      orgId,
      siteId,
      audienceUserId,
      ruleId,
      paymentStatus: 'cancelled',
      billingSnapshot,
      paymentPaused: false,
      grantPaidAccess: false,
      revokePaidAccess: true,
    })
    message = 'Stripe subscription cancelled.'
  }
  else if (action === 'pause') {
    updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      pause_collection: {
        behavior: 'mark_uncollectible',
      },
    })
    const billingSnapshot = buildStripeSubscriptionBillingSnapshot(updatedSubscription)
    await updateRestrictedMemberPaymentState({
      orgId,
      siteId,
      audienceUserId,
      ruleId,
      paymentStatus: 'paused',
      billingSnapshot,
      paymentPaused: true,
      grantPaidAccess: true,
      revokePaidAccess: false,
    })
    message = 'Stripe subscription billing paused.'
  }
  else if (action === 'resume') {
    updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      pause_collection: null,
    })
    const resumedStatus = String(updatedSubscription?.status || '').trim().toLowerCase()
    const isActive = ['active', 'trialing'].includes(resumedStatus)
    const billingSnapshot = buildStripeSubscriptionBillingSnapshot(updatedSubscription)
    await updateRestrictedMemberPaymentState({
      orgId,
      siteId,
      audienceUserId,
      ruleId,
      paymentStatus: isActive ? 'paid' : (resumedStatus || 'pending'),
      billingSnapshot,
      paymentPaused: false,
      grantPaidAccess: isActive,
      revokePaidAccess: !isActive,
    })
    message = 'Stripe subscription billing resumed.'
  }
  else if (action === 'update_duration') {
    if (noEnd) {
      updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at: null,
        cancel_at_period_end: false,
      })
    }
    else {
      const cancelAt = parseStripeActionDateToUnix(effectiveDate)
      if (!cancelAt)
        throw new HttpsError('invalid-argument', 'Invalid effectiveDate. Use YYYY-MM-DD.')
      if (cancelAt <= Math.floor(Date.now() / 1000))
        throw new HttpsError('invalid-argument', 'End date must be in the future.')

      updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at: cancelAt,
        cancel_at_period_end: false,
      })
    }
    const billingSnapshot = buildStripeSubscriptionBillingSnapshot(updatedSubscription)
    const currentPlanState = getPlanStateForRule(memberData, ruleId)
    const resolvedStatus = String(currentPlanState.paymentStatus || '').trim().toLowerCase() || 'paid'
    await updateRestrictedMemberPaymentState({
      orgId,
      siteId,
      audienceUserId,
      ruleId,
      paymentStatus: resolvedStatus,
      billingSnapshot,
      paymentPaused: Boolean(updatedSubscription?.pause_collection && typeof updatedSubscription.pause_collection === 'object'),
      grantPaidAccess: false,
      revokePaidAccess: false,
    })
    message = noEnd
      ? 'Stripe subscription end date cleared.'
      : `Stripe subscription end date set to ${effectiveDate}.`
  }

  return {
    success: true,
    message,
    audienceUserId,
    ruleId,
    action,
    subscription: {
      id: String(updatedSubscription?.id || subscription.id || '').trim(),
      status: String(updatedSubscription?.status || '').trim().toLowerCase(),
      cancelAt: Number(updatedSubscription?.cancel_at || 0) || null,
      currentPeriodEnd: Number(updatedSubscription?.current_period_end || 0) || null,
      pauseCollection: updatedSubscription?.pause_collection || null,
    },
  }
})

exports.restrictedContentCreateStripePortalLink = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const callerUid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const requestedAudienceUserId = String(data.audienceUserId || '').trim()
  const returnUrl = String(data.returnUrl || '').trim()

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')
  if (!returnUrl)
    throw new HttpsError('invalid-argument', 'Missing returnUrl.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  let audienceUserId = requestedAudienceUserId
  let audienceSnap = null
  if (audienceUserId) {
    audienceSnap = await audienceUsersRef.doc(audienceUserId).get()
    if (!audienceSnap.exists)
      throw new HttpsError('not-found', 'Audience member not found.')
  }
  else {
    audienceSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
    if (!audienceSnap?.exists)
      throw new HttpsError('not-found', 'Audience member not found for current user.')
    audienceUserId = String(audienceSnap.id || '').trim()
  }

  const audienceUser = audienceSnap.data() || {}
  if (getSeatOwnerKeys(audienceUser).length)
    throw new HttpsError('failed-precondition', 'Seat-assigned users cannot manage billing. Billing is managed by the original purchaser.')
  const targetAuthUid = String(audienceUser.authUid || '').trim()
  const targetUserDocId = String(audienceUser.userId || '').trim()
  const isSelfRequest = Boolean(
    (targetAuthUid && targetAuthUid === callerUid)
    || (targetUserDocId && targetUserDocId === callerUid),
  )
  if (!isSelfRequest)
    await ensureRestrictedSiteWritePermission(callerUid, orgId, siteId)

  const stripeCustomerId = String(audienceUser.billingStripeCustomerId || '').trim()
  if (!stripeCustomerId)
    throw new HttpsError('failed-precondition', 'No Stripe customer is associated with this audience member.')

  const stripe = await getStripeClientForSite(orgId, siteId)
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })

  return {
    success: true,
    url: session.url,
    audienceUserId,
    stripeCustomerId,
  }
})

exports.restrictedContentUpdateAudienceMemberProfile = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const callerUid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const requestedAudienceUserId = String(data.audienceUserId || '').trim()
  const nextName = String(data.name || '').trim()

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')
  if (!nextName)
    throw new HttpsError('invalid-argument', 'Missing name.')
  if (nextName.length > 120)
    throw new HttpsError('invalid-argument', 'Name is too long.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  let audienceUserId = requestedAudienceUserId
  let audienceSnap = null
  if (audienceUserId) {
    audienceSnap = await audienceUsersRef.doc(audienceUserId).get()
    if (!audienceSnap.exists)
      throw new HttpsError('not-found', 'Audience member not found.')
  }
  else {
    audienceSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
    if (!audienceSnap?.exists)
      throw new HttpsError('not-found', 'Audience member not found for current user.')
    audienceUserId = String(audienceSnap.id || '').trim()
  }

  const audienceUser = audienceSnap.data() || {}
  const targetAuthUid = String(audienceUser.authUid || '').trim()
  const targetUserDocId = String(audienceUser.userId || '').trim()
  const isSelfUpdate = Boolean(
    (targetAuthUid && targetAuthUid === callerUid)
    || (targetUserDocId && targetUserDocId === callerUid),
  )
  if (!isSelfUpdate)
    await ensureRestrictedSiteWritePermission(callerUid, orgId, siteId)

  const now = Date.now()
  const stagedDocId = String(
    audienceUser.stagedUserId
    || audienceUser.docId
    || audienceUserId
    || '',
  ).trim()
  let stagedUserData = {}
  if (stagedDocId) {
    const stagedSnap = await db.collection('staged-users').doc(stagedDocId).get()
    if (stagedSnap.exists)
      stagedUserData = stagedSnap.data() || {}
  }
  const fallbackAuthUid = String(stagedUserData.userId || stagedUserData.uid || '').trim()
  const resolvedAuthUid = targetAuthUid || targetUserDocId || fallbackAuthUid

  await audienceUsersRef.doc(audienceUserId).set({
    name: nextName,
    last_updated: now,
  }, { merge: true })

  if (stagedDocId) {
    const stagedRef = db.collection('staged-users').doc(stagedDocId)
    await stagedRef.set({
      meta: {
        ...(stagedUserData.meta || {}),
        name: nextName,
      },
      last_updated: now,
    }, { merge: true })
  }

  if (resolvedAuthUid) {
    const userRef = db.collection('users').doc(resolvedAuthUid)
    const userSnap = await userRef.get()
    const userData = userSnap.exists ? (userSnap.data() || {}) : {}
    await userRef.set({
      userId: resolvedAuthUid,
      meta: {
        ...(userData.meta || {}),
        name: nextName,
      },
      last_updated: now,
    }, { merge: true })
  }

  return {
    success: true,
    audienceUserId,
    authUid: resolvedAuthUid,
    stagedUserId: stagedDocId,
    name: nextName,
    updatedBy: callerUid,
    selfUpdate: isSelfUpdate,
  }
})

exports.restrictedContentListSeatMembers = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const callerUid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const requestedOwnerAudienceUserId = String(data.ownerAudienceUserId || data.audienceUserId || '').trim()
  const requestedRuleId = String(data.ruleId || '').trim()

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  let ownerAudienceUserId = requestedOwnerAudienceUserId
  let ownerSnap = null
  if (ownerAudienceUserId) {
    ownerSnap = await audienceUsersRef.doc(ownerAudienceUserId).get()
    if (!ownerSnap.exists)
      throw new HttpsError('not-found', 'Seat owner not found.')
  }
  else {
    ownerSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
    if (!ownerSnap?.exists)
      throw new HttpsError('not-found', 'Audience member not found for current user.')
    ownerAudienceUserId = String(ownerSnap.id || '').trim()
  }

  const ownerData = ownerSnap.data() || {}
  const ownerAuthUid = String(ownerData.authUid || ownerData.userId || '').trim()
  const isSelfRequest = Boolean(ownerAuthUid && ownerAuthUid === callerUid)
  if (!isSelfRequest)
    await ensureRestrictedSiteWritePermission(callerUid, orgId, siteId)

  const seatContext = getRestrictedSeatContextFromMember(ownerData, requestedRuleId)
  const seatChildrenDocs = await listSeatChildrenForOwner({
    audienceUsersRef,
    ownerAudienceUserId,
    seatRuleId: seatContext.seatRuleId,
  })
  const seatMembers = seatChildrenDocs.map((doc) => {
    const item = doc.data() || {}
    return {
      audienceUserId: doc.id,
      docId: doc.id,
      name: String(item.name || '').trim(),
      email: String(item.email || '').trim(),
      status: String(item.status || '').trim().toLowerCase() || 'inactive',
      registrationPaymentStatus: String(item.registrationPaymentStatus || '').trim().toLowerCase() || '',
      paidAccessRuleIds: Array.isArray(item.paidAccessRuleIds) ? item.paidAccessRuleIds.filter(Boolean) : [],
      seatOwnerAudienceUserId: String(getSeatOwnerForRule(item, seatContext.seatRuleId)?.ownerAudienceUserId || '').trim(),
      seatOwnerRuleId: seatContext.seatRuleId,
      last_updated: Number(item.last_updated || 0) || 0,
    }
  })
  const activeSeatMembers = seatMembers.filter((item) => {
    const status = String(item.status || '').trim().toLowerCase()
    return status !== 'revoked'
  })
  const seatsUsed = 1 + activeSeatMembers.length

  return {
    success: true,
    owner: {
      audienceUserId: ownerAudienceUserId,
      name: String(ownerData.name || '').trim(),
      email: String(ownerData.email || '').trim(),
      authUid: ownerAuthUid,
      seatRuleId: seatContext.seatRuleId,
      seatLimit: seatContext.seatLimit,
      seatsUsed,
      canManageSeats: seatContext.canManageSeats,
      paymentStatus: seatContext.paymentStatus,
    },
    seatMembers,
  }
})

exports.restrictedContentAddSeatMember = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const callerUid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const requestedOwnerAudienceUserId = String(data.ownerAudienceUserId || data.audienceUserId || '').trim()
  const name = String(data.name || '').trim()
  const email = normalizeEmail(data.email)

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')
  if (!name || !email)
    throw new HttpsError('invalid-argument', 'Missing name or email.')
  if (name.length > 120)
    throw new HttpsError('invalid-argument', 'Name is too long.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  let ownerAudienceUserId = requestedOwnerAudienceUserId
  let ownerSnap = null
  if (ownerAudienceUserId) {
    ownerSnap = await audienceUsersRef.doc(ownerAudienceUserId).get()
    if (!ownerSnap.exists)
      throw new HttpsError('not-found', 'Seat owner not found.')
  }
  else {
    ownerSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
    if (!ownerSnap?.exists)
      throw new HttpsError('not-found', 'Audience member not found for current user.')
    ownerAudienceUserId = String(ownerSnap.id || '').trim()
  }

  const ownerData = ownerSnap.data() || {}
  const ownerAuthUid = String(ownerData.authUid || ownerData.userId || '').trim()
  const isSelfRequest = Boolean(ownerAuthUid && ownerAuthUid === callerUid)
  if (!isSelfRequest)
    await ensureRestrictedSiteWritePermission(callerUid, orgId, siteId)
  if (getSeatOwnerKeys(ownerData).length) {
    throw new HttpsError('failed-precondition', 'Only the original purchaser can assign seat members.')
  }

  const seatContext = getRestrictedSeatContextFromMember(ownerData)
  if (!seatContext.canManageSeats || !seatContext.seatRuleId)
    throw new HttpsError('failed-precondition', 'This member does not have extra paid seats available to assign.')

  const ownerStripeCustomerId = String(ownerData.billingStripeCustomerId || '').trim()
  if (!ownerStripeCustomerId)
    throw new HttpsError('failed-precondition', 'Owner does not have an active Stripe customer for seat management.')

  const seatChildrenDocs = await listSeatChildrenForOwner({
    audienceUsersRef,
    ownerAudienceUserId,
    seatRuleId: seatContext.seatRuleId,
  })
  const activeChildrenCount = seatChildrenDocs.filter((doc) => {
    const member = doc.data() || {}
    return String(member.status || '').trim().toLowerCase() !== 'revoked'
  }).length

  const existingAudienceSnapByEmail = await findAudienceUserByEmail(audienceUsersRef, email)
  const existingAudience = existingAudienceSnapByEmail?.exists ? (existingAudienceSnapByEmail.data() || {}) : {}
  const existingAudienceUserId = String(existingAudienceSnapByEmail?.id || '').trim()
  const existingSeatOwner = getSeatOwnerForRule(existingAudience, seatContext.seatRuleId)
  const existingSeatOwnerId = String(existingSeatOwner?.ownerAudienceUserId || '').trim()
  const existingSeatRuleId = String(existingSeatOwner ? seatContext.seatRuleId : '').trim()
  const isAlreadyOwnedByThisSeat = Boolean(
    existingAudienceUserId
    && existingSeatOwnerId === ownerAudienceUserId
    && existingSeatRuleId === seatContext.seatRuleId,
  )

  if (!isAlreadyOwnedByThisSeat) {
    const seatsUsed = 1 + activeChildrenCount
    if (seatsUsed >= seatContext.seatLimit) {
      throw new HttpsError('failed-precondition', `Seat limit reached (${seatContext.seatLimit}). Remove someone before adding another member.`)
    }
  }

  const existingPaidRuleIds = Array.isArray(existingAudience.paidAccessRuleIds) ? existingAudience.paidAccessRuleIds : []
  const hasIndependentPaidPlan = Boolean(
    existingAudienceUserId
    && (
      existingPaidRuleIds.includes(seatContext.seatRuleId)
    )
    && !isAlreadyOwnedByThisSeat,
  )
  if (hasIndependentPaidPlan) {
    throw new HttpsError('already-exists', 'This email already has its own paid subscription. Ask them to cancel it before assigning this seat.')
  }

  const existingAuthUidByEmail = await resolveAuthUserUidByEmail(email)
  const linkedAuthUid = existingAuthUidByEmail
    || String(existingAudience.authUid || existingAudience.userId || '').trim()

  let docId = existingAudienceUserId
  docId = await reserveGlobalRestrictedRegistrationDocId({
    email,
    authUid: linkedAuthUid,
    preferredDocId: docId,
  })
  if (!docId)
    throw new HttpsError('internal', 'Unable to reserve global registration record for this email.')

  docId = await reserveRestrictedRegistrationDocId({
    orgId,
    siteId,
    email,
    preferredDocId: docId,
  })
  if (!docId)
    throw new HttpsError('internal', 'Unable to reserve registration record for this email.')

  const now = Date.now()
  const audienceUserDocPermissionPath = `organizations-${orgId}-sites-${siteId}-audience-users-${docId}`
  const stagedUserRef = db.collection('staged-users').doc(docId)
  const stagedUserSnap = await stagedUserRef.get()
  const stagedUserData = stagedUserSnap.exists ? (stagedUserSnap.data() || {}) : {}
  const stagedRoles = (stagedUserData.roles && typeof stagedUserData.roles === 'object' && !Array.isArray(stagedUserData.roles))
    ? { ...stagedUserData.roles }
    : {}
  stagedRoles[audienceUserDocPermissionPath] = {
    collectionPath: audienceUserDocPermissionPath,
    role: 'user',
  }
  const stagedCollectionPaths = Array.isArray(stagedUserData.collectionPaths)
    ? [...stagedUserData.collectionPaths]
    : []
  if (!stagedCollectionPaths.includes(audienceUserDocPermissionPath))
    stagedCollectionPaths.push(audienceUserDocPermissionPath)

  await stagedUserRef.set({
    docId,
    ...(linkedAuthUid
      ? {
          uid: linkedAuthUid,
          userId: linkedAuthUid,
        }
      : {}),
    meta: {
      ...(stagedUserData.meta || {}),
      name,
      email,
    },
    roles: stagedRoles,
    collectionPaths: stagedCollectionPaths,
    specialPermissions: (stagedUserData.specialPermissions && typeof stagedUserData.specialPermissions === 'object')
      ? stagedUserData.specialPermissions
      : {},
    doc_created_at: Number(stagedUserData.doc_created_at || now),
    last_updated: now,
  }, { merge: true })

  const memberRef = audienceUsersRef.doc(docId)
  const memberSnap = await memberRef.get()
  const memberData = memberSnap.exists ? (memberSnap.data() || {}) : existingAudience
  const childSeatOwnersByRule = normalizeSeatOwnersByRule(memberData)
  childSeatOwnersByRule[seatContext.seatRuleId] = {
    ownerAudienceUserId,
    ownerAuthUid,
    ownerName: String(ownerData.name || '').trim(),
    ownerEmail: String(ownerData.email || '').trim(),
    assignedAt: now,
  }
  const childSeatOwnerKeys = Object.keys(childSeatOwnersByRule)
    .map(ruleId => buildSeatOwnerKey(childSeatOwnersByRule[ruleId]?.ownerAudienceUserId, ruleId))
    .filter(Boolean)
  const childPlanStates = getRegistrationPlanStates(memberData)
  const ownerPlanState = getPlanStateForRule(ownerData, seatContext.seatRuleId)
  childPlanStates[seatContext.seatRuleId] = {
    ...ownerPlanState,
    paymentStatus: String(ownerPlanState.paymentStatus || seatContext.paymentStatus || 'paid').trim().toLowerCase(),
    paymentPaused: ownerPlanState.paymentPaused === true,
    quantity: Number(ownerPlanState.quantity || seatContext.seatLimit || 1) || 1,
    lastUpdated: now,
  }
  const ownerPlanStateSnapshot = childPlanStates[seatContext.seatRuleId]
  await memberRef.set({
    docId,
    stagedUserId: docId,
    name,
    email,
    authUid: linkedAuthUid || String(memberData.authUid || '').trim(),
    userId: linkedAuthUid || String(memberData.userId || '').trim(),
    status: String(memberData.status || '').trim() || 'active',
    seatOwnersByRule: childSeatOwnersByRule,
    seatOwnerKeys: childSeatOwnerKeys,
    billingStripeCustomerId: String(memberData.billingStripeCustomerId || '').trim(),
    registrationPlanStates: childPlanStates,
    doc_created_at: Number(memberData.doc_created_at || now),
    last_updated: now,
  }, { merge: true })

  await memberRef.set(buildRestrictedMemberPayload({
    existingMember: memberData,
    audienceUserId: docId,
    ruleId: seatContext.seatRuleId,
    status: String(memberData.status || '').trim() || 'active',
    paymentStatus: seatContext.paymentStatus || 'paid',
    markPaid: true,
    markPending: false,
    clearPending: true,
    clearPaid: false,
    now,
  }), { merge: true })

  if (linkedAuthUid) {
    await grantRestrictedAudiencePathToUser({
      uid: linkedAuthUid,
      permissionPath: audienceUserDocPermissionPath,
      email,
    })
  }

  return {
    success: true,
    audienceUserId: docId,
    ownerAudienceUserId,
    seatRuleId: seatContext.seatRuleId,
    seatLimit: seatContext.seatLimit,
    seatsUsed: isAlreadyOwnedByThisSeat ? (1 + activeChildrenCount) : (2 + activeChildrenCount),
    alreadyManaged: isAlreadyOwnedByThisSeat,
  }
})

exports.restrictedContentDeleteAudienceMemberAccount = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const callerUid = String(request.auth.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const requestedAudienceUserId = String(data.audienceUserId || '').trim()

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')

  const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  let audienceUserId = requestedAudienceUserId
  let audienceSnap = null
  if (audienceUserId) {
    audienceSnap = await audienceUsersRef.doc(audienceUserId).get()
    if (!audienceSnap.exists)
      throw new HttpsError('not-found', 'Audience member not found.')
  }
  else {
    audienceSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
    if (!audienceSnap?.exists)
      throw new HttpsError('not-found', 'Audience member not found for current user.')
    audienceUserId = String(audienceSnap.id || '').trim()
  }

  const audienceUser = audienceSnap.data() || {}
  const targetAuthUid = String(audienceUser.authUid || '').trim()
  const targetUserDocId = String(audienceUser.userId || '').trim()
  const isSelfDelete = Boolean(
    (targetAuthUid && targetAuthUid === callerUid)
    || (targetUserDocId && targetUserDocId === callerUid),
  )
  const requestedRuleId = String(data.ruleId || '').trim()
  const canManageSiteRestrictedContent = await canManageRestrictedContentForSite(callerUid, orgId, siteId)
  let seatOwnerRuleIdsToRemove = []
  let isSeatOwnerDelete = false
  let isFullDelete = isSelfDelete || canManageSiteRestrictedContent
  if (!isSelfDelete) {
    if (!canManageSiteRestrictedContent) {
      const callerAudienceSnap = await resolveAudienceUserForAuth(orgId, siteId, callerUid)
      if (!callerAudienceSnap?.exists)
        throw new HttpsError('permission-denied', 'Not allowed to manage restricted content for this site.')

      const callerAudienceUserId = String(callerAudienceSnap.id || '').trim()
      const callerAudienceData = callerAudienceSnap.data() || {}
      const targetSeatOwnersByRule = normalizeSeatOwnersByRule(audienceUser)
      seatOwnerRuleIdsToRemove = Object.entries(targetSeatOwnersByRule)
        .filter(([, owner]) => {
          const ownerAudienceUserId = String(owner?.ownerAudienceUserId || '').trim()
          const ownerAuthUid = String(owner?.ownerAuthUid || '').trim()
          return (
            (ownerAudienceUserId && callerAudienceUserId && ownerAudienceUserId === callerAudienceUserId)
            || (ownerAuthUid && ownerAuthUid === callerUid)
          )
        })
        .map(([ruleId]) => String(ruleId || '').trim())
        .filter(Boolean)

      if (!seatOwnerRuleIdsToRemove.length) {
        const callerPaidRuleIds = Array.isArray(callerAudienceData.paidAccessRuleIds)
          ? callerAudienceData.paidAccessRuleIds.map(item => String(item || '').trim()).filter(Boolean)
          : []
        const callerOwnerKeys = callerPaidRuleIds
          .map(ruleId => buildSeatOwnerKey(callerAudienceUserId, ruleId))
          .filter(Boolean)
        const targetSeatOwnerKeys = getSeatOwnerKeys(audienceUser)
        seatOwnerRuleIdsToRemove = targetSeatOwnerKeys
          .filter(key => callerOwnerKeys.includes(key))
          .map((key) => {
            const value = String(key || '')
            const separatorIndex = value.indexOf(':')
            if (separatorIndex < 0)
              return ''
            return String(value.slice(separatorIndex + 1) || '').trim()
          })
          .filter(Boolean)
      }

      if (requestedRuleId)
        seatOwnerRuleIdsToRemove = seatOwnerRuleIdsToRemove.filter(ruleId => ruleId === requestedRuleId)

      seatOwnerRuleIdsToRemove = Array.from(new Set(seatOwnerRuleIdsToRemove))
      isSeatOwnerDelete = seatOwnerRuleIdsToRemove.length > 0
      isFullDelete = false
    }

    if (!canManageSiteRestrictedContent && !isSeatOwnerDelete)
      throw new HttpsError('permission-denied', 'Not allowed to manage restricted content for this site.')
  }

  if (isSeatOwnerDelete && !isFullDelete && !isSelfDelete) {
    const nextAccessRuleIds = (Array.isArray(audienceUser.accessRuleIds) ? audienceUser.accessRuleIds : [])
      .map(item => String(item || '').trim())
      .filter(ruleId => ruleId && !seatOwnerRuleIdsToRemove.includes(ruleId))
    const nextPaidAccessRuleIds = (Array.isArray(audienceUser.paidAccessRuleIds) ? audienceUser.paidAccessRuleIds : [])
      .map(item => String(item || '').trim())
      .filter(ruleId => ruleId && !seatOwnerRuleIdsToRemove.includes(ruleId))
    const nextPendingPaymentRuleIds = (Array.isArray(audienceUser.pendingPaymentRuleIds) ? audienceUser.pendingPaymentRuleIds : [])
      .map(item => String(item || '').trim())
      .filter(ruleId => ruleId && !seatOwnerRuleIdsToRemove.includes(ruleId))
    const nextSeatOwnersByRule = normalizeSeatOwnersByRule(audienceUser)
    seatOwnerRuleIdsToRemove.forEach((ruleId) => {
      delete nextSeatOwnersByRule[ruleId]
    })
    const nextSeatOwnerKeys = Object.keys(nextSeatOwnersByRule)
      .map(ruleId => buildSeatOwnerKey(nextSeatOwnersByRule[ruleId]?.ownerAudienceUserId, ruleId))
      .filter(Boolean)
    const currentPlanStates = getRegistrationPlanStates(audienceUser)
    seatOwnerRuleIdsToRemove.forEach((ruleId) => {
      if (ruleId in currentPlanStates)
        delete currentPlanStates[ruleId]
    })
    const ruleContextIds = Array.from(new Set([
      ...nextAccessRuleIds,
      ...nextPaidAccessRuleIds,
      ...nextPendingPaymentRuleIds,
      ...Object.keys(currentPlanStates),
    ]))
    const hasAnyNonSeatOwnedRule = ruleContextIds.some((ruleId) => {
      const normalizedRuleId = String(ruleId || '').trim()
      if (!normalizedRuleId)
        return false
      return !String(nextSeatOwnersByRule?.[normalizedRuleId]?.ownerAudienceUserId || '').trim()
    })

    await audienceUsersRef.doc(audienceUserId).set({
      accessRuleIds: Array.from(new Set(nextAccessRuleIds)),
      paidAccessRuleIds: Array.from(new Set(nextPaidAccessRuleIds)),
      pendingPaymentRuleIds: Array.from(new Set(nextPendingPaymentRuleIds)),
      seatOwnersByRule: nextSeatOwnersByRule,
      seatOwnerKeys: Array.from(new Set(nextSeatOwnerKeys)),
      registrationPlanStates: currentPlanStates,
      billingStripeCustomerId: hasAnyNonSeatOwnedRule
        ? String(audienceUser.billingStripeCustomerId || '').trim()
        : '',
      last_updated: Date.now(),
    }, { merge: true })

    return {
      success: true,
      audienceUserId,
      selfDelete: false,
      fullDelete: false,
      removalMode: 'seat_unassign',
      removedRuleIds: seatOwnerRuleIdsToRemove,
      deletedBy: callerUid,
    }
  }

  const stagedDocId = String(
    audienceUser.stagedUserId
    || audienceUser.docId
    || audienceUserId
    || '',
  ).trim()
  let stagedUserData = {}
  if (stagedDocId) {
    const stagedSnap = await db.collection('staged-users').doc(stagedDocId).get()
    if (stagedSnap.exists)
      stagedUserData = stagedSnap.data() || {}
  }

  const fallbackAuthUid = String(stagedUserData.userId || stagedUserData.uid || '').trim()
  const resolvedAuthUid = targetAuthUid || targetUserDocId || fallbackAuthUid
  const normalizedAudienceEmail = normalizeEmail(audienceUser.email || stagedUserData?.meta?.email || '')
  const stripeCustomerId = String(audienceUser.billingStripeCustomerId || '').trim()
  const audienceUserDocPermissionPath = `organizations-${orgId}-sites-${siteId}-audience-users-${audienceUserId}`

  let stripeCancelledSubscriptions = []
  let stripeAttemptedSubscriptions = []
  if (stripeCustomerId) {
    try {
      const stripe = await getStripeClientForSite(orgId, siteId)
      const cancelResult = await cancelStripeCustomerSubscriptionsForSite({
        stripe,
        customerId: stripeCustomerId,
        orgId,
        siteId,
      })
      stripeCancelledSubscriptions = cancelResult.cancelledIds
      stripeAttemptedSubscriptions = cancelResult.attemptedIds
    }
    catch (stripeError) {
      logger.error('restrictedContentDeleteAudienceMemberAccount Stripe cleanup failed', {
        orgId,
        siteId,
        audienceUserId,
        stripeCustomerId,
        message: stripeError?.message || String(stripeError),
      })
    }
  }

  await audienceUsersRef.doc(audienceUserId).delete()

  if (stagedDocId) {
    const stagedRef = db.collection('staged-users').doc(stagedDocId)
    const stagedSnap = await stagedRef.get()
    if (stagedSnap.exists) {
      const staged = stagedSnap.data() || {}
      const nextRoles = (staged.roles && typeof staged.roles === 'object' && !Array.isArray(staged.roles))
        ? { ...staged.roles }
        : {}
      if (audienceUserDocPermissionPath in nextRoles)
        delete nextRoles[audienceUserDocPermissionPath]
      const nextCollectionPaths = (Array.isArray(staged.collectionPaths) ? staged.collectionPaths : [])
        .filter(path => String(path || '').trim() !== audienceUserDocPermissionPath)
      await stagedRef.set({
        roles: nextRoles,
        collectionPaths: nextCollectionPaths,
        last_updated: Date.now(),
      }, { merge: true })
    }
  }

  if (resolvedAuthUid) {
    const userRef = db.collection('users').doc(resolvedAuthUid)
    const userSnap = await userRef.get()
    if (userSnap.exists) {
      const userData = userSnap.data() || {}
      const nextRoles = (userData.roles && typeof userData.roles === 'object' && !Array.isArray(userData.roles))
        ? { ...userData.roles }
        : {}
      if (audienceUserDocPermissionPath in nextRoles)
        delete nextRoles[audienceUserDocPermissionPath]
      const nextCollectionPaths = (Array.isArray(userData.collectionPaths) ? userData.collectionPaths : [])
        .filter(path => String(path || '').trim() !== audienceUserDocPermissionPath)
      await userRef.set({
        roles: nextRoles,
        collectionPaths: nextCollectionPaths,
        last_updated: Date.now(),
      }, { merge: true })
    }
  }

  const siteEmailIndexRef = getRestrictedRegistrationEmailIndexRef(orgId, siteId, normalizedAudienceEmail)
  if (siteEmailIndexRef)
    await siteEmailIndexRef.delete().catch(() => {})

  return {
    success: true,
    audienceUserId,
    stagedUserId: stagedDocId,
    authUid: resolvedAuthUid,
    stripeCustomerId,
    stripeAttemptedSubscriptions,
    stripeCancelledSubscriptions,
    removedPermissionPath: audienceUserDocPermissionPath,
    deletedBy: callerUid,
    selfDelete: isSelfDelete,
  }
})

exports.restrictedContentBeginRegistration = onCall(async (request) => {
  const fail = (errorCode, message) => ({
    success: false,
    errorCode: String(errorCode || 'internal'),
    message: String(message || 'Unable to begin registration right now.'),
  })

  const data = request.data || {}
  const requestAuthUid = String(request?.auth?.uid || '').trim()
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const ruleId = String(data.ruleId || '').trim()
  const name = String(data.name || '').trim()
  const hasProvidedName = Boolean(name)
  const email = normalizeEmail(data.email)

  if (!orgId || !siteId || !email)
    return fail('invalid-argument', 'Missing orgId, siteId, or email.')

  try {
    const { restrictedContent } = await getRestrictedSiteContext(orgId, siteId)
    const normalizedRules = (Array.isArray(restrictedContent.rules) ? restrictedContent.rules : [])
      .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
      .filter(item => item.id)
    const hasRuleId = Boolean(ruleId)
    const { rule, effectiveRegistrationMode } = hasRuleId
      ? await getRestrictedRuleContext(orgId, siteId, ruleId, { requireAllowRegistration: false })
      : { rule: null, effectiveRegistrationMode: 'free' }
    const { audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
    const now = Date.now()
    const audienceUserSnap = await findAudienceUserByEmail(audienceUsersRef, email)
    let docId = String(audienceUserSnap?.id || '').trim()
    const existingAuthUidByEmail = await resolveAuthUserUidByEmail(email)
    const linkedAuthUid = existingAuthUidByEmail || requestAuthUid

    if (existingAuthUidByEmail && !requestAuthUid && !docId && restrictedContent.allowSelfRegistration === false)
      return fail('no-self-registration', 'Self registration is not allowed for this site.')
    if (existingAuthUidByEmail && !requestAuthUid)
      return fail('unauthenticated', 'This email already has an account. Please log in first and continue.')
    if (existingAuthUidByEmail && requestAuthUid && existingAuthUidByEmail !== requestAuthUid)
      return fail('permission-denied', 'Signed-in account does not match this email.')

    if (audienceUserSnap?.exists) {
      const audienceUser = audienceUserSnap.data() || {}
      const audienceAuthUid = String(audienceUser.authUid || '').trim()
      if (audienceAuthUid && !requestAuthUid)
        return fail('unauthenticated', 'This email already has an account. Please log in first and continue.')
      if (audienceAuthUid && requestAuthUid && audienceAuthUid !== requestAuthUid)
        return fail('permission-denied', 'Signed-in account does not match this email.')
    }

    if (!docId && restrictedContent.allowSelfRegistration === false)
      return fail('no-self-registration', 'Self registration is not allowed for this site.')

    if (!docId && linkedAuthUid) {
      const stagedRefByAuth = await resolveStagedUserRef(linkedAuthUid)
      if (stagedRefByAuth?.id)
        docId = String(stagedRefByAuth.id || '').trim()
    }

    docId = await reserveGlobalRestrictedRegistrationDocId({
      email,
      authUid: linkedAuthUid,
      preferredDocId: docId,
    })
    if (!docId)
      return fail('internal', 'Unable to reserve global staged user record for this email.')

    docId = await reserveRestrictedRegistrationDocId({
      orgId,
      siteId,
      email,
      preferredDocId: docId,
    })
    if (!docId)
      return fail('internal', 'Unable to reserve registration record for this email.')

    const stagedUserRef = db.collection('staged-users').doc(docId)
    const stagedUserSnap = await stagedUserRef.get()
    const stagedUserData = stagedUserSnap.exists ? (stagedUserSnap.data() || {}) : {}
    const stagedUserId = String(stagedUserData.userId || '').trim()
    if (stagedUserId && linkedAuthUid && stagedUserId !== linkedAuthUid)
      return fail('permission-denied', 'Existing registration is linked to another account.')
    if (stagedUserId && !linkedAuthUid)
      return fail('unauthenticated', 'This email already has an account. Please log in first and continue.')

    const audienceUserDocPermissionPath = `organizations-${orgId}-sites-${siteId}-audience-users-${docId}`
    const stagedRoles = (stagedUserData.roles && typeof stagedUserData.roles === 'object' && !Array.isArray(stagedUserData.roles))
      ? { ...stagedUserData.roles }
      : {}
    stagedRoles[audienceUserDocPermissionPath] = {
      collectionPath: audienceUserDocPermissionPath,
      role: 'user',
    }
    const stagedCollectionPaths = Array.isArray(stagedUserData.collectionPaths)
      ? [...stagedUserData.collectionPaths]
      : []
    if (!stagedCollectionPaths.includes(audienceUserDocPermissionPath))
      stagedCollectionPaths.push(audienceUserDocPermissionPath)

    if (!stagedUserSnap.exists) {
      await stagedUserRef.set({
        docId,
        uid: linkedAuthUid || '',
        userId: linkedAuthUid || '',
        meta: {
          ...(hasProvidedName ? { name } : {}),
          email,
        },
        roles: stagedRoles,
        collectionPaths: stagedCollectionPaths,
        specialPermissions: {},
        doc_created_at: now,
        last_updated: now,
      })
    }
    else {
      await stagedUserRef.set({
        meta: {
          ...(stagedUserData.meta || {}),
          ...(hasProvidedName ? { name } : {}),
          email,
        },
        ...(linkedAuthUid && !stagedUserId
          ? {
              uid: linkedAuthUid,
              userId: linkedAuthUid,
            }
          : {}),
        roles: stagedRoles,
        collectionPaths: stagedCollectionPaths,
        last_updated: now,
      }, { merge: true })
    }

    const audienceUserDocSnap = await audienceUsersRef.doc(docId).get()
    const existingAudienceUser = audienceUserDocSnap.exists
      ? (audienceUserDocSnap.data() || {})
      : (audienceUserSnap?.exists ? (audienceUserSnap.data() || {}) : {})
    const existingAudienceAuthUid = String(existingAudienceUser.authUid || '').trim()
    await audienceUsersRef.doc(docId).set({
      docId,
      ...(hasProvidedName ? { name } : {}),
      email,
      authUid: linkedAuthUid || existingAudienceAuthUid,
      userId: linkedAuthUid || String(existingAudienceUser.userId || '').trim(),
      stagedUserId: docId,
      status: String(existingAudienceUser.status || '').trim() || 'invited',
      billingStripeCustomerId: String(existingAudienceUser.billingStripeCustomerId || '').trim(),
      notes: String(existingAudienceUser.notes || '').trim(),
      doc_created_at: Number(existingAudienceUser.doc_created_at || now),
      last_updated: now,
    }, { merge: true })

    const memberRef = audienceUsersRef.doc(docId)
    const memberSnap = await memberRef.get()
    const memberData = memberSnap.exists ? (memberSnap.data() || {}) : {}
    const currentMemberStatus = String(memberData.status || '').trim().toLowerCase()
    if (currentMemberStatus === 'revoked') {
      return fail('permission-denied', 'Access for this email has been revoked. Please contact support.')
    }
    const promoteToActive = Boolean(requestAuthUid) && (!currentMemberStatus || currentMemberStatus === 'invited')
    const payloadExistingMember = promoteToActive
      ? {
          ...memberData,
          status: '',
        }
      : memberData

    await memberRef.set(buildRestrictedMemberPayload({
      existingMember: payloadExistingMember,
      audienceUserId: docId,
      ruleId: hasRuleId && effectiveRegistrationMode === 'paid' ? rule.id : '',
      status: promoteToActive ? 'active' : (String(memberData.status || '').trim() || 'active'),
      paymentStatus: 'not_required',
      markPaid: false,
      markPending: false,
      clearPending: false,
      now,
    }), { merge: true })

    if (linkedAuthUid) {
      await grantRestrictedAudiencePathToUser({
        uid: linkedAuthUid,
        permissionPath: audienceUserDocPermissionPath,
        email,
      })
    }

    if (requestAuthUid) {
      const refreshedMemberSnap = await memberRef.get()
      const refreshedMember = refreshedMemberSnap.exists ? (refreshedMemberSnap.data() || {}) : {}
      const status = String(refreshedMember.status || '').trim().toLowerCase() || 'inactive'
      const blocked = status === 'revoked' || status === 'paused'
      const accessRuleIds = Array.isArray(refreshedMember.accessRuleIds) ? refreshedMember.accessRuleIds.filter(Boolean) : []
      const manualAccessRuleIds = Array.isArray(refreshedMember.manualAccessRuleIds) ? refreshedMember.manualAccessRuleIds.filter(Boolean) : []
      const paidRuleIds = Array.isArray(refreshedMember.paidAccessRuleIds) ? refreshedMember.paidAccessRuleIds.filter(Boolean) : []
      const pendingRuleIds = Array.isArray(refreshedMember.pendingPaymentRuleIds) ? refreshedMember.pendingPaymentRuleIds.filter(Boolean) : []
      const activeRuleId = hasRuleId && effectiveRegistrationMode === 'paid' ? String(rule?.id || '').trim() : ''
      const isAssigned = activeRuleId ? accessRuleIds.includes(activeRuleId) : false
      const isManualOverride = activeRuleId ? manualAccessRuleIds.includes(activeRuleId) : false
      const isPaid = activeRuleId ? paidRuleIds.includes(activeRuleId) : false
      const paymentPending = activeRuleId ? pendingRuleIds.includes(activeRuleId) : false
      const hasAccess = !blocked && (isPaid || isManualOverride || (isAssigned && !paymentPending))
      const planArray = await buildRestrictedPlanArray({
        rules: normalizedRules,
        memberData: refreshedMember,
        blocked,
        audienceUsersRef,
        audienceUserId: docId,
      })

      const response = {
        success: true,
        audienceUserId: docId,
        memberId: docId,
        registrationMode: effectiveRegistrationMode,
        status,
        planArray,
      }

      if (activeRuleId) {
        response.ruleAccess = {
          ruleId: activeRuleId,
          requiresPayment: true,
          hasAccess,
          isPaid,
          isManualOverride,
          paymentPending,
          status,
        }
      }

      return response
    }

    return {
      success: true,
      registrationCode: docId,
      audienceUserId: docId,
      memberId: docId,
      registrationMode: effectiveRegistrationMode,
      planArray: [],
    }
  }
  catch (error) {
    logger.error('restrictedContentBeginRegistration failed', error)
    if (error instanceof HttpsError)
      return fail(error.code, error.message)
    return fail('internal', String(error?.message || 'Unable to begin registration right now.'))
  }
})

exports.restrictedContentGetUserRuleAccess = onCall(async (request) => {
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const userId = String(data.userId || '').trim()

  if (!request?.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (!orgId || !siteId || !userId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or userId.')
  if (userId !== request.auth.uid)
    throw new HttpsError('permission-denied', 'userId must match the authenticated user.')

  const { siteRef, audienceUsersRef } = getRestrictedSiteRefs(orgId, siteId)
  const siteSnap = await siteRef.get()
  if (!siteSnap.exists)
    throw new HttpsError('not-found', 'Site not found.')

  const siteData = siteSnap.data() || {}
  const restrictedContent = (siteData.restrictedContent && typeof siteData.restrictedContent === 'object')
    ? siteData.restrictedContent
    : {}
  const configuredRuleIds = new Set(
    (Array.isArray(restrictedContent.rules) ? restrictedContent.rules : [])
      .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
      .filter(item => item.id)
      .map(item => item.id),
  )

  const audienceUserSnap = await resolveAudienceUserForAuth(orgId, siteId, userId)
  if (!audienceUserSnap?.exists) {
    return {
      success: true,
      userId,
      audienceUserId: '',
      status: 'inactive',
      registrationPaymentStatus: 'not_required',
      ruleIds: [],
      paidRuleIds: [],
      pendingPaymentRuleIds: [],
      rules: {},
    }
  }

  const audienceUserId = audienceUserSnap.id
  const audienceUser = audienceUserSnap.data() || {}
  const audienceAuthUid = String(audienceUser.authUid || '').trim()
  if (!audienceAuthUid || audienceAuthUid !== userId) {
    await audienceUsersRef.doc(audienceUserId).set({
      authUid: userId,
      userId,
      last_updated: Date.now(),
    }, { merge: true })
  }

  const memberData = audienceUserSnap.data() || {}
  const status = String(memberData.status || '').trim().toLowerCase() || 'inactive'
  const registrationPlanStates = getRegistrationPlanStates(memberData)
  const registrationPaymentStatus = (() => {
    const statuses = Object.values(registrationPlanStates)
      .map(item => String(item?.paymentStatus || '').trim().toLowerCase())
      .filter(Boolean)
    if (!statuses.length)
      return 'not_required'
    if (statuses.includes('paid'))
      return 'paid'
    if (statuses.includes('paused'))
      return 'paused'
    if (statuses.includes('pending'))
      return 'pending'
    if (statuses.includes('failed'))
      return 'failed'
    if (statuses.includes('cancelled') || statuses.includes('canceled'))
      return 'cancelled'
    return statuses[0]
  })()
  const rawRuleIds = Array.isArray(memberData.accessRuleIds) ? memberData.accessRuleIds.filter(Boolean) : []
  const manualRuleIdsRaw = Array.isArray(memberData.manualAccessRuleIds) ? memberData.manualAccessRuleIds.filter(Boolean) : []
  const paidRuleIdsRaw = Array.isArray(memberData.paidAccessRuleIds) ? memberData.paidAccessRuleIds.filter(Boolean) : []
  const pendingRuleIdsRaw = Array.isArray(memberData.pendingPaymentRuleIds) ? memberData.pendingPaymentRuleIds.filter(Boolean) : []
  const paidSet = new Set(paidRuleIdsRaw)
  const pendingSet = new Set(pendingRuleIdsRaw)
  const blocked = status === 'revoked' || status === 'paused'
  const filteredRawRuleIds = rawRuleIds.filter(ruleId => configuredRuleIds.has(ruleId))
  const manualRuleIds = manualRuleIdsRaw.filter(ruleId => configuredRuleIds.has(ruleId))
  const legacyAssignedRuleIds = filteredRawRuleIds.filter(ruleId => !pendingSet.has(ruleId))
  const grantedRuleIds = Array.from(new Set([
    ...manualRuleIds,
    ...paidRuleIdsRaw.filter(ruleId => configuredRuleIds.has(ruleId)),
    ...legacyAssignedRuleIds,
  ]))
  const ruleIds = blocked ? [] : grantedRuleIds
  const paidRuleIds = filteredRawRuleIds.filter(ruleId => paidSet.has(ruleId))
  const pendingPaymentRuleIds = filteredRawRuleIds.filter(ruleId => pendingSet.has(ruleId))
  const rules = {}
  Array.from(new Set([...filteredRawRuleIds, ...manualRuleIds])).forEach((ruleId) => {
    rules[ruleId] = {
      hasAccess: ruleIds.includes(ruleId),
      isPaid: paidSet.has(ruleId),
      isManualOverride: manualRuleIds.includes(ruleId),
      paymentPending: pendingSet.has(ruleId),
    }
  })

  return {
    success: true,
    userId,
    audienceUserId,
    status,
    registrationPaymentStatus,
    ruleIds,
    manualAccessRuleIds: manualRuleIds,
    paidRuleIds,
    pendingPaymentRuleIds,
    rules,
  }
})

exports.restrictedContentGetStripeCatalog = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')

  await ensureRestrictedSiteWritePermission(request.auth.uid, orgId, siteId)
  const stripe = await getStripeClientForSite(orgId, siteId)

  const productsResponse = await stripe.products.list({ limit: 100, active: true })
  const products = Array.isArray(productsResponse?.data) ? productsResponse.data : []
  const catalog = await Promise.all(products.map(async (product) => {
    const pricesResponse = await stripe.prices.list({ product: product.id, limit: 100, active: true })
    const prices = Array.isArray(pricesResponse?.data) ? pricesResponse.data : []
    return {
      productId: String(product.id || '').trim(),
      name: String(product.name || '').trim(),
      description: String(product.description || '').trim(),
      image: Array.isArray(product.images) && product.images.length ? String(product.images[0] || '').trim() : '',
      managed: isStripeObjectManagedForSite(product.metadata, orgId, siteId),
      prices: prices.map((price) => {
        const summary = buildStripePriceSummary(price) || {}
        return {
          ...summary,
          managed: isStripeObjectManagedForSite(price.metadata, orgId, siteId),
        }
      }).filter(price => price?.id),
    }
  }))

  return {
    success: true,
    products: catalog
      .filter(item => item.productId && item.prices.length)
      .sort((a, b) => String(a.name || a.productId).localeCompare(String(b.name || b.productId))),
  }
})

exports.restrictedContentSyncStripeBranding = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')

  await ensureRestrictedSiteWritePermission(request.auth.uid, orgId, siteId)
  const { siteRef } = getRestrictedSiteRefs(orgId, siteId)
  const siteSnap = await siteRef.get()
  if (!siteSnap.exists)
    throw new HttpsError('not-found', 'Site not found.')
  const siteData = siteSnap.data() || {}
  const stripe = await getStripeClientForSite(orgId, siteId)
  const result = await syncStripeBrandingLogoForSite({ stripe, siteData })
  return {
    success: true,
    ...result,
  }
})

exports.restrictedContentImportStripeCatalog = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const selections = Array.isArray(data.selections) ? data.selections : []
  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')
  if (!selections.length)
    return { success: true, imported: 0, rules: [] }

  await ensureRestrictedSiteWritePermission(request.auth.uid, orgId, siteId)
  const stripe = await getStripeClientForSite(orgId, siteId)
  const { siteRef, siteData, restrictedContent } = await getRestrictedSiteContext(orgId, siteId)
  const existingRules = (Array.isArray(restrictedContent.rules) ? restrictedContent.rules : [])
    .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
    .filter(item => item.id)

  const rulesById = existingRules.reduce((acc, rule) => {
    acc[rule.id] = rule
    return acc
  }, {})

  let imported = 0
  for (const selection of selections) {
    const productId = String(selection?.productId || '').trim()
    const selectedPriceIds = Array.isArray(selection?.priceIds)
      ? selection.priceIds.map(item => String(item || '').trim()).filter(Boolean)
      : []
    if (!productId || !selectedPriceIds.length)
      continue

    const product = await stripe.products.retrieve(productId)
    if (!product || product.deleted)
      continue

    const existingRule = existingRules.find(rule => String(rule.registrationStripeProductId || '').trim() === productId)
    const ruleId = String(selection?.ruleId || existingRule?.id || productId || `rule-${Date.now()}`).trim()
    const ruleName = String(existingRule?.name || selection?.name || product?.name || '').trim() || ruleId

    const nextPriceOptions = []
    for (const priceId of selectedPriceIds) {
      let price
      try {
        price = await stripe.prices.retrieve(priceId)
      }
      catch {
        continue
      }
      if (!price || price.deleted || !price.active)
        continue
      if (String(price.product || '').trim() !== productId)
        continue
      const existingPriceOption = Array.isArray(existingRule?.registrationStripePrices)
        ? existingRule.registrationStripePrices.find(item => String(item?.priceId || '').trim() === priceId)
        : null
      nextPriceOptions.push({
        priceId,
        title: String(existingPriceOption?.title || price?.nickname || ruleName).trim(),
        description: String(existingPriceOption?.description || '').trim(),
        amount: Number.isFinite(Number(existingPriceOption?.amount))
          ? Number(existingPriceOption.amount)
          : Number(price?.unit_amount || 0) / 100,
        currency: String(existingPriceOption?.currency || price?.currency || 'usd').trim().toLowerCase() || 'usd',
        interval: ['day', 'week', 'month', 'year'].includes(String(existingPriceOption?.interval || price?.recurring?.interval || '').toLowerCase())
          ? String(existingPriceOption?.interval || price?.recurring?.interval || '').toLowerCase()
          : 'month',
        intervalCount: Number.isFinite(Number(existingPriceOption?.intervalCount))
          ? Math.max(1, Math.trunc(Number(existingPriceOption.intervalCount)))
          : Math.max(1, Math.trunc(Number(price?.recurring?.interval_count || 1))),
        seats: Number.isFinite(Number(existingPriceOption?.seats || existingPriceOption?.quantity))
          ? Math.max(1, Math.trunc(Number(existingPriceOption.seats || existingPriceOption.quantity)))
          : 1,
      })
    }

    if (!nextPriceOptions.length)
      continue

    rulesById[ruleId] = {
      ...(rulesById[ruleId] || {}),
      id: ruleId,
      name: ruleName,
      protected: true,
      allowRegistration: true,
      registrationMode: 'paid',
      stripeSource: 'imported',
      registrationStripeProductId: productId,
      registrationStripeImage: String(existingRule?.registrationStripeImage || '').trim()
        || (Array.isArray(product.images) && product.images.length ? String(product.images[0] || '').trim() : ''),
      registrationStripePrices: nextPriceOptions,
      registrationStripeCoupons: Array.isArray(existingRule?.registrationStripeCoupons)
        ? existingRule.registrationStripeCoupons
        : [],
    }
    imported++
  }

  const nextRules = Object.values(rulesById)
    .map(item => normalizeRestrictedRuleForFunction(item, item.id))
    .filter(item => item.id)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))

  const nextRestrictedContent = {
    ...(restrictedContent || {}),
    rules: nextRules,
  }
  const nextVersion = Number.isFinite(Number(siteData?.version))
    ? Math.max(0, Math.trunc(Number(siteData.version))) + 1
    : 1
  await siteRef.set({
    restrictedContent: nextRestrictedContent,
    version: nextVersion,
  }, { merge: true })

  return {
    success: true,
    imported,
    rules: nextRules,
  }
})

exports.restrictedContentSyncStripeRule = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const ruleId = String(data.ruleId || '').trim()
  if (!orgId || !siteId || !ruleId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or ruleId.')

  await ensureRestrictedSiteWritePermission(request.auth.uid, orgId, siteId)
  const stripe = await getStripeClientForSite(orgId, siteId)
  const { siteRef, siteData, restrictedContent } = await getRestrictedSiteContext(orgId, siteId)

  const rules = (Array.isArray(restrictedContent.rules) ? restrictedContent.rules : [])
    .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
    .filter(item => item.id)
  const existingRule = rules.find(item => item.id === ruleId)
  if (!existingRule)
    throw new HttpsError('not-found', 'Paid access plan was not found.')
  if (existingRule.registrationMode !== 'paid')
    throw new HttpsError('failed-precondition', 'Only paid access plans can be synced to Stripe.')

  const ruleName = String(existingRule.name || existingRule.id || '').trim() || existingRule.id
  const ruleImage = resolveRuleStripeImage(existingRule, siteData)
  let productId = String(existingRule.registrationStripeProductId || '').trim()
  let createdProduct = false
  let product = null

  if (productId) {
    try {
      product = await stripe.products.retrieve(productId)
      if (product?.deleted)
        product = null
    }
    catch {
      product = null
    }
  }

  if (!product) {
    const created = await stripe.products.create({
      name: ruleName,
      ...(ruleImage ? { images: [ruleImage] } : {}),
      metadata: {
        [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
        [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
        [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
        [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
      },
    })
    productId = String(created?.id || '').trim()
    if (!productId)
      throw new HttpsError('internal', 'Stripe product could not be created.')
    createdProduct = true
  }
  else {
    const updatePayload = {
      name: ruleName,
      // Stripe treats an empty string as "clear this field".
      // Empty arrays can be dropped by request serialization.
      images: ruleImage ? [ruleImage] : '',
      metadata: {
        [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
        [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
        [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
        [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
      },
    }
    await stripe.products.update(productId, updatePayload)
  }

  const nextPriceOptions = Array.isArray(existingRule.registrationStripePrices)
    ? existingRule.registrationStripePrices
    : []
  const invalidPriceIds = []
  const syncedPriceOptions = []
  for (const option of nextPriceOptions) {
    let priceId = String(option?.priceId || '').trim()
    const amount = Number(option?.amount || 0)
    const intervalCount = Math.max(1, Number(option?.intervalCount || 1) || 1)
    const interval = ['day', 'week', 'month', 'year'].includes(String(option?.interval || '').toLowerCase())
      ? String(option?.interval || '').toLowerCase()
      : 'month'
    const currency = String(option?.currency || 'usd').trim().toLowerCase() || 'usd'
    const title = String(option?.title || '').trim()
    const description = String(option?.description || '').trim()
    const seats = Number.isFinite(Number(option?.seats || option?.quantity))
      ? Math.max(1, Math.trunc(Number(option.seats || option.quantity)))
      : 1

    let price
    if (priceId) {
      try {
        price = await stripe.prices.retrieve(priceId)
      }
      catch {
        invalidPriceIds.push(priceId)
      }
    }

    if (!price || price.deleted || String(price.product || '').trim() !== productId) {
      const unitAmount = Math.round(amount * 100)
      if (!Number.isFinite(unitAmount) || unitAmount <= 0)
        continue
      const createdPrice = await stripe.prices.create({
        product: productId,
        currency,
        unit_amount: unitAmount,
        recurring: {
          interval,
          interval_count: intervalCount,
        },
        ...(title ? { nickname: title } : {}),
        metadata: {
          [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
          [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
          [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
          [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
        },
      })
      priceId = String(createdPrice?.id || '').trim()
      price = createdPrice
    }

    if (!priceId || !price || price.deleted || String(price.product || '').trim() !== productId)
      continue

    await upsertManagedStripeMetadata({ stripe, orgId, siteId, ruleId, priceId })
    syncedPriceOptions.push({
      priceId,
      title,
      description,
      amount: Number.isFinite(amount) ? amount : 0,
      currency,
      interval,
      intervalCount,
      seats,
    })
  }

  const nextCouponOptions = Array.isArray(existingRule.registrationStripeCoupons)
    ? existingRule.registrationStripeCoupons
    : []
  const invalidCouponIds = []
  const invalidPromotionCodeIds = []
  const syncedCouponOptions = []
  for (const option of nextCouponOptions) {
    const normalizedOption = normalizeCouponConfigForStripe(option)
    if (!normalizedOption.promoCode)
      continue
    let couponId = String(option?.couponId || '').trim()
    let coupon = null
    if (couponId) {
      try {
        coupon = await stripe.coupons.retrieve(couponId)
      }
      catch {
        invalidCouponIds.push(couponId)
      }
    }

    const shouldCreateCoupon = !coupon
      || coupon.deleted
      || !isStripeObjectManagedForRule(coupon.metadata, orgId, siteId, ruleId)
      || !stripeCouponMatchesConfig(coupon, normalizedOption)

    if (shouldCreateCoupon) {
      const createPayload = {
        duration: 'forever',
        ...(String(option?.title || '').trim() ? { name: String(option.title || '').trim() } : {}),
        metadata: {
          [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
          [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
          [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
          [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
        },
      }
      if (normalizedOption.discountType === 'amount') {
        const amountOff = Math.round(Number(normalizedOption.amountOff || 0) * 100)
        if (!Number.isFinite(amountOff) || amountOff <= 0)
          continue
        createPayload.amount_off = amountOff
        createPayload.currency = 'usd'
      }
      else {
        const percentOff = Number(normalizedOption.percentOff || 0)
        if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100)
          continue
        createPayload.percent_off = percentOff
      }
      if (normalizedOption.redeemBy)
        createPayload.redeem_by = normalizedOption.redeemBy

      const createdCoupon = await stripe.coupons.create(createPayload)
      couponId = String(createdCoupon?.id || '').trim()
      coupon = createdCoupon
    }
    else if (couponId) {
      await upsertManagedStripeMetadata({ stripe, orgId, siteId, ruleId, couponId })
    }

    if (!couponId)
      continue

    let promotionCodeId = String(option?.promotionCodeId || '').trim()
    let promotionCode = null
    if (promotionCodeId) {
      try {
        promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId)
      }
      catch {
        invalidPromotionCodeIds.push(promotionCodeId)
      }
    }

    const needsPromotionCode = !stripePromotionCodeMatchesConfig(
      promotionCode,
      normalizedOption,
      couponId,
      orgId,
      siteId,
      ruleId,
    )

    if (needsPromotionCode) {
      if (promotionCode && promotionCode.id && promotionCode.active === true && isStripeObjectManagedForRule(promotionCode.metadata, orgId, siteId, ruleId)) {
        try {
          await stripe.promotionCodes.update(String(promotionCode.id || '').trim(), { active: false })
        }
        catch {
          // no-op
        }
      }
      try {
        const createdPromotionCode = await stripe.promotionCodes.create({
          coupon: couponId,
          code: normalizedOption.promoCode,
          ...(normalizedOption.redeemBy ? { expires_at: normalizedOption.redeemBy } : {}),
          metadata: {
            [STRIPE_CMS_MANAGED_METADATA_KEY]: 'true',
            [STRIPE_CMS_ORG_METADATA_KEY]: String(orgId || ''),
            [STRIPE_CMS_SITE_METADATA_KEY]: String(siteId || ''),
            [STRIPE_CMS_RULE_METADATA_KEY]: String(ruleId || ''),
          },
        })
        promotionCodeId = String(createdPromotionCode?.id || '').trim()
        promotionCode = createdPromotionCode
      }
      catch {
        invalidPromotionCodeIds.push(normalizedOption.promoCode)
        continue
      }
    }
    else if (promotionCodeId) {
      await upsertManagedStripeMetadata({ stripe, orgId, siteId, ruleId, promotionCodeId })
    }

    syncedCouponOptions.push({
      couponId,
      promotionCodeId,
      promoCode: normalizedOption.promoCode,
      title: String(option?.title || coupon?.name || '').trim(),
      discountType: normalizedOption.discountType,
      percentOff: normalizedOption.discountType === 'percent'
        ? Number(normalizedOption.percentOff || 0)
        : 0,
      amountOff: normalizedOption.discountType === 'amount'
        ? Number(normalizedOption.amountOff || 0)
        : 0,
      expiresMode: normalizedOption.redeemBy ? 'date' : 'never',
      expiresAt: normalizedOption.redeemBy ? String(normalizedOption.expiresAt || '').trim() : '',
    })
  }

  await upsertManagedStripeMetadata({ stripe, orgId, siteId, ruleId, productId })

  const updatedRule = normalizeRestrictedRuleForFunction({
    ...existingRule,
    stripeSource: 'managed',
    registrationStripeProductId: productId,
    registrationStripeImage: ruleImage,
    registrationStripePrices: syncedPriceOptions,
    registrationStripeCoupons: syncedCouponOptions,
  }, existingRule.id)

  const nextRules = rules.map((item) => {
    if (item.id !== ruleId)
      return item
    return updatedRule
  })

  const nextVersion = Number.isFinite(Number(siteData?.version))
    ? Math.max(0, Math.trunc(Number(siteData.version))) + 1
    : 1

  await siteRef.set({
    restrictedContent: {
      ...(restrictedContent || {}),
      rules: nextRules,
    },
    version: nextVersion,
  }, { merge: true })

  return {
    success: true,
    createdProduct,
    rule: updatedRule,
    invalidPriceIds,
    invalidCouponIds,
    invalidPromotionCodeIds,
  }
})

exports.restrictedContentDeleteStripeRule = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const ruleId = String(data.ruleId || '').trim()
  if (!orgId || !siteId || !ruleId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or ruleId.')

  await ensureRestrictedSiteWritePermission(request.auth.uid, orgId, siteId)
  const { restrictedContent } = await getRestrictedSiteContext(orgId, siteId)
  const rules = (Array.isArray(restrictedContent.rules) ? restrictedContent.rules : [])
    .map((item, index) => normalizeRestrictedRuleForFunction(item, `rule-${index + 1}`))
    .filter(item => item.id)
  const existingRule = rules.find(item => item.id === ruleId)
  if (!existingRule) {
    return {
      success: true,
      skipped: true,
      archivedProduct: false,
      archivedPriceIds: [],
      invalidPriceIds: [],
    }
  }
  if (existingRule.stripeSource === 'imported') {
    return {
      success: true,
      skipped: true,
      localOnly: true,
      archivedProduct: false,
      archivedPriceIds: [],
      invalidPriceIds: [],
      archiveErrors: [],
    }
  }

  let stripe = null
  try {
    stripe = await getStripeClientForSite(orgId, siteId)
  }
  catch (error) {
    if (error instanceof HttpsError && error.code === 'failed-precondition') {
      return {
        success: true,
        skipped: true,
        archivedProduct: false,
        archivedPriceIds: [],
        invalidPriceIds: [],
      }
    }
    throw error
  }

  const archivedPriceIds = []
  const invalidPriceIds = []
  const archiveErrors = []
  let encounteredDefaultPriceConstraint = false
  const priceOptions = Array.isArray(existingRule.registrationStripePrices)
    ? existingRule.registrationStripePrices
    : []

  for (const option of priceOptions) {
    const priceId = String(option?.priceId || '').trim()
    if (!priceId)
      continue
    let price = null
    try {
      price = await stripe.prices.retrieve(priceId)
    }
    catch {
      invalidPriceIds.push(priceId)
      continue
    }
    if (!price || price.deleted || !isStripeObjectManagedForRule(price.metadata, orgId, siteId, ruleId))
      continue
    try {
      await stripe.prices.update(priceId, { active: false })
      archivedPriceIds.push(priceId)
    }
    catch (error) {
      const message = String(error?.raw?.message || error?.message || '').trim()
      if (message.toLowerCase().includes('default price of its product'))
        encounteredDefaultPriceConstraint = true
      archiveErrors.push({
        type: 'price',
        id: priceId,
        message,
      })
    }
  }

  let archivedProduct = false
  const productId = String(existingRule.registrationStripeProductId || '').trim()
  if (productId) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (product && !product.deleted && isStripeObjectManagedForRule(product.metadata, orgId, siteId, ruleId)) {
        if (!encounteredDefaultPriceConstraint) {
          await stripe.products.update(productId, { active: false })
          archivedProduct = true
        }
      }
    }
    catch (error) {
      const message = String(error?.raw?.message || error?.message || '').trim()
      archiveErrors.push({
        type: 'product',
        id: productId,
        message,
      })
    }
  }

  return {
    success: true,
    archivedProduct,
    archivedPriceIds,
    invalidPriceIds,
    archiveErrors,
    skipped: !archivedProduct && !archivedPriceIds.length,
  }
})

exports.restrictedContentCreateStripeLink = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const ruleId = String(data.ruleId || '').trim()
  const requestedPriceId = String(data.priceId || '').trim()
  const successUrl = String(data.successUrl || data.returnUrl || '').trim()
  const cancelUrl = String(data.cancelUrl || data.returnUrl || '').trim()

  if (!orgId || !siteId || !ruleId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or ruleId.')
  if (!requestedPriceId)
    throw new HttpsError('invalid-argument', 'Missing priceId for paid checkout.')
  if (!successUrl || !cancelUrl)
    throw new HttpsError('invalid-argument', 'Missing successUrl or cancelUrl.')

  const { rule, effectiveRegistrationMode } = await getRestrictedRuleContext(orgId, siteId, ruleId)
  if (effectiveRegistrationMode !== 'paid')
    throw new HttpsError('failed-precondition', 'This rule does not require payment.')

  const { audienceUsersRef, privateStripeRef } = getRestrictedSiteRefs(orgId, siteId)
  const audienceUserSnap = await resolveAudienceUserForAuth(orgId, siteId, request.auth.uid)
  if (!audienceUserSnap?.exists)
    throw new HttpsError('not-found', 'No audience user was found for the current account.')

  const audienceUserId = audienceUserSnap.id
  const audienceUser = audienceUserSnap.data() || {}
  if (!audienceUser.authUid || audienceUser.authUid !== request.auth.uid) {
    await audienceUsersRef.doc(audienceUserId).set({
      authUid: request.auth.uid,
      last_updated: Date.now(),
    }, { merge: true })
  }

  const stripeSnap = await privateStripeRef.get()
  if (!stripeSnap.exists)
    throw new HttpsError('failed-precondition', 'Stripe is not configured for this site.')

  const stripeConfig = stripeSnap.data() || {}
  const stripeSecretKey = String(stripeConfig.secretKey || '').trim()
  if (!stripeSecretKey)
    throw new HttpsError('failed-precondition', 'Stripe secret key is missing for this site.')

  const stripe = new Stripe(stripeSecretKey)
  const configuredPriceOptions = Array.isArray(rule.registrationStripePrices) ? rule.registrationStripePrices : []
  const configuredPriceIds = Array.from(new Set(configuredPriceOptions.map(item => String(item?.priceId || '').trim()).filter(Boolean)))
  const configuredPriceLookup = configuredPriceOptions.reduce((acc, item) => {
    const priceId = String(item?.priceId || '').trim()
    if (priceId && !acc[priceId])
      acc[priceId] = item
    return acc
  }, {})

  let prices = []
  if (configuredPriceIds.length) {
    const retrieved = await Promise.all(configuredPriceIds.map(async (priceId) => {
      try {
        const price = await stripe.prices.retrieve(priceId)
        return (price && price.active) ? price : null
      }
      catch (error) {
        return null
      }
    }))
    prices = retrieved.filter(Boolean)
    if (!prices.length)
      throw new HttpsError('failed-precondition', 'No active Stripe prices were found for this rule.')
  }
  else {
    if (!rule.registrationStripeProductId)
      throw new HttpsError('failed-precondition', 'This rule does not have Stripe prices configured.')
    const pricesResponse = await stripe.prices.list({
      product: rule.registrationStripeProductId,
      active: true,
      limit: 100,
    })
    prices = Array.isArray(pricesResponse.data) ? pricesResponse.data.filter(Boolean) : []
    if (!prices.length)
      throw new HttpsError('failed-precondition', 'No active Stripe prices were found for this product.')
  }

  const selectedPrice = prices.find(price => price.id === requestedPriceId) || null

  if (!selectedPrice)
    throw new HttpsError('failed-precondition', 'Selected priceId is not active or not configured for this rule.')

  let customerId = String(audienceUser.billingStripeCustomerId || '').trim()
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: String(audienceUser.email || request.auth.token?.email || '').trim() || undefined,
      name: String(audienceUser.name || request.auth.token?.name || '').trim() || undefined,
      metadata: {
        orgId,
        siteId,
        audienceUserId,
        ruleId,
      },
    })
    customerId = customer.id
    await audienceUsersRef.doc(audienceUserId).set({
      billingStripeCustomerId: customerId,
      authUid: request.auth.uid,
      last_updated: Date.now(),
    }, { merge: true })
  }

  const memberRef = audienceUsersRef.doc(audienceUserId)
  const memberSnap = await memberRef.get()
  const memberData = memberSnap.exists ? (memberSnap.data() || {}) : {}
  await memberRef.set(buildRestrictedMemberPayload({
    existingMember: memberData,
    audienceUserId,
    ruleId: rule.id,
    status: String(memberData.status || '').trim() || 'active',
    paymentStatus: 'pending',
    markPending: true,
    now: Date.now(),
  }), { merge: true })

  const selectedPriceConfig = configuredPriceLookup[selectedPrice.id] || null
  const resolvedStripeProductId = String(rule.registrationStripeProductId || selectedPrice?.product || '').trim()
  const quantity = Number.isFinite(Number(selectedPriceConfig?.seats || selectedPriceConfig?.quantity))
    ? Math.max(1, Math.trunc(Number(selectedPriceConfig.seats || selectedPriceConfig.quantity)))
    : Math.max(1, Math.trunc(Number(data.quantity || 1) || 1))
  const pendingPlanStates = getRegistrationPlanStates(memberData)
  const existingPendingPlanState = getPlanStateForRule(memberData, rule.id)
  pendingPlanStates[rule.id] = {
    ...existingPendingPlanState,
    paymentStatus: 'pending',
    paymentPaused: false,
    stripePriceId: selectedPrice.id,
    quantity,
    interval: String(selectedPrice?.recurring?.interval || '').trim().toLowerCase(),
    intervalCount: Number.isFinite(Number(selectedPrice?.recurring?.interval_count))
      ? Math.max(1, Math.trunc(Number(selectedPrice.recurring.interval_count)))
      : 1,
    currency: String(selectedPrice?.currency || 'usd').trim().toLowerCase(),
    lastUpdated: Date.now(),
  }
  await memberRef.set({
    registrationPlanStates: pendingPlanStates,
    last_updated: Date.now(),
  }, { merge: true })

  const session = await stripe.checkout.sessions.create({
    mode: selectedPrice.recurring ? 'subscription' : 'payment',
    allow_promotion_codes: true,
    customer: customerId,
    line_items: [{
      price: selectedPrice.id,
      quantity,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: `${orgId}:${siteId}:${rule.id}:${audienceUserId}`,
    metadata: {
      orgId,
      siteId,
      ruleId: rule.id,
      audienceUserId,
      memberId: audienceUserId,
      uid: request.auth.uid,
      stripeProductId: resolvedStripeProductId,
      stripePriceId: selectedPrice.id,
      stripePriceTitle: String(selectedPriceConfig?.title || '').trim(),
      quantity: String(quantity),
    },
    subscription_data: selectedPrice.recurring
      ? {
          metadata: {
            orgId,
            siteId,
            ruleId: rule.id,
            audienceUserId,
            memberId: audienceUserId,
            uid: request.auth.uid,
            stripeProductId: resolvedStripeProductId,
            stripePriceId: selectedPrice.id,
            stripePriceTitle: String(selectedPriceConfig?.title || '').trim(),
            quantity: String(quantity),
          },
        }
      : undefined,
    payment_intent_data: !selectedPrice.recurring
      ? {
          metadata: {
            orgId,
            siteId,
            ruleId: rule.id,
            audienceUserId,
            memberId: audienceUserId,
            uid: request.auth.uid,
            stripeProductId: resolvedStripeProductId,
            stripePriceId: selectedPrice.id,
            stripePriceTitle: String(selectedPriceConfig?.title || '').trim(),
            quantity: String(quantity),
          },
        }
      : undefined,
  })

  return {
    success: true,
    requiresPriceSelection: false,
    url: session.url,
    customerId,
    price: buildStripePriceSummary(selectedPrice),
    priceConfig: selectedPriceConfig
      ? {
          priceId: selectedPrice.id,
          title: String(selectedPriceConfig.title || '').trim(),
          description: String(selectedPriceConfig.description || '').trim(),
          seats: quantity,
        }
      : null,
  }
})

exports.restrictedContentStripeWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed.')
    return
  }

  const queryOrgId = String(req.query.orgId || req.query.org || '').trim()
  const querySiteId = String(req.query.siteId || req.query.site || '').trim()
  const rawMetadata = extractStripeMetadataFromRawWebhookBody(req)
  const routeOrgId = queryOrgId || String(rawMetadata.orgId || '').trim()
  const routeSiteId = querySiteId || String(rawMetadata.siteId || '').trim()

  if (!routeOrgId || !routeSiteId) {
    res.status(400).send('Missing orgId or siteId.')
    return
  }

  try {
    const { privateStripeRef } = getRestrictedSiteRefs(routeOrgId, routeSiteId)
    const stripeSnap = await privateStripeRef.get()
    if (!stripeSnap.exists) {
      res.status(404).send('Stripe config not found.')
      return
    }

    const stripeConfig = stripeSnap.data() || {}
    const stripeSecretKey = String(stripeConfig.secretKey || '').trim()
    const webhookSecret = String(stripeConfig.webhookSecret || '').trim()
    if (!stripeSecretKey || !webhookSecret) {
      res.status(412).send('Stripe webhook is not configured for this site.')
      return
    }

    const stripe = new Stripe(stripeSecretKey)
    let event
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], webhookSecret)
    }
    catch (error) {
      logger.error('restrictedContentStripeWebhook signature verification failed', error)
      res.status(400).send(`Webhook Error: ${error.message}`)
      return
    }

    const object = event.data?.object || {}
    const metadata = getStripeMetadata(object)
    const metadataOrgId = String(metadata.orgId || '').trim() || routeOrgId
    const metadataSiteId = String(metadata.siteId || '').trim() || routeSiteId
    const { audienceUsersRef } = getRestrictedSiteRefs(metadataOrgId, metadataSiteId)
    const audienceUserId = String(metadata.audienceUserId || '').trim()
    const ruleId = String(metadata.ruleId || '').trim()
    const customerId = String(object.customer || '').trim()

    if (customerId && audienceUserId) {
      await audienceUsersRef.doc(audienceUserId).set({
        billingStripeCustomerId: customerId,
        last_updated: Date.now(),
      }, { merge: true })
    }

    if (metadataOrgId && metadataSiteId && audienceUserId && ruleId) {
      if (event.type === 'checkout.session.completed') {
        const paymentStatus = String(object.payment_status || '').trim().toLowerCase()
        const shouldGrant = paymentStatus === 'paid' || String(object.mode || '').trim() === 'subscription'
        const resolvedPaymentStatus = shouldGrant ? 'paid' : (paymentStatus || 'pending')
        const billingSnapshot = await buildStripeCheckoutBillingSnapshot({
          stripe,
          session: object,
          metadata,
        })
        await updateRestrictedMemberPaymentState({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          audienceUserId,
          ruleId,
          paymentStatus: resolvedPaymentStatus,
          billingSnapshot,
          paymentPaused: false,
          grantPaidAccess: shouldGrant,
          revokePaidAccess: false,
        })
        await syncSeatMembersFromOwner({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          ownerAudienceUserId: audienceUserId,
          ownerRuleId: ruleId,
          paymentStatus: resolvedPaymentStatus,
          grantPaidAccess: shouldGrant,
          revokePaidAccess: false,
          registrationPaymentPaused: false,
          ownerDataPatch: {
            ...billingSnapshot,
            billingStripeCustomerId: customerId,
          },
        })
      }

      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscriptionStatus = String(object.status || '').trim().toLowerCase()
        const isPaused = Boolean(object.pause_collection && typeof object.pause_collection === 'object')
        const isActive = ['active', 'trialing'].includes(subscriptionStatus) && !isPaused
        const resolvedPaymentStatus = isPaused ? 'paused' : (isActive ? 'paid' : (subscriptionStatus || 'cancelled'))
        const billingSnapshot = buildStripeSubscriptionBillingSnapshot(object)
        await updateRestrictedMemberPaymentState({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          audienceUserId,
          ruleId,
          paymentStatus: resolvedPaymentStatus,
          billingSnapshot,
          paymentPaused: isPaused,
          grantPaidAccess: isPaused || isActive,
          revokePaidAccess: !isPaused && !isActive,
        })
        await syncSeatMembersFromOwner({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          ownerAudienceUserId: audienceUserId,
          ownerRuleId: ruleId,
          paymentStatus: resolvedPaymentStatus,
          grantPaidAccess: isPaused || isActive,
          revokePaidAccess: !isPaused && !isActive,
          registrationPaymentPaused: isPaused,
          ownerDataPatch: {
            ...billingSnapshot,
            billingStripeCustomerId: customerId,
          },
        })
      }

      if (event.type === 'invoice.payment_failed') {
        await updateRestrictedMemberPaymentState({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          audienceUserId,
          ruleId,
          paymentStatus: 'failed',
          paymentPaused: false,
          grantPaidAccess: false,
          revokePaidAccess: true,
        })
        await syncSeatMembersFromOwner({
          orgId: metadataOrgId,
          siteId: metadataSiteId,
          ownerAudienceUserId: audienceUserId,
          ownerRuleId: ruleId,
          paymentStatus: 'failed',
          grantPaidAccess: false,
          revokePaidAccess: true,
          registrationPaymentPaused: false,
          ownerDataPatch: {
            billingStripeCustomerId: customerId,
          },
        })
      }
    }

    res.status(200).json({ received: true })
  }
  catch (error) {
    logger.error('restrictedContentStripeWebhook failed', error)
    res.status(500).send('Webhook processing failed.')
  }
})

exports.updateSeoFromAi = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const auth = request.auth
  const { orgId, siteId, pageId } = data
  if (!orgId || !siteId || !pageId)
    throw new HttpsError('invalid-argument', 'Missing orgId, siteId, or pageId')
  const allowed = await permissionCheck(auth.uid, 'write', `organizations/${orgId}/sites/${siteId}/pages`)
  if (!allowed)
    throw new HttpsError('permission-denied', 'Not allowed to update page SEO')

  const pageRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId).collection('pages').doc(pageId)
  const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
  const [pageSnap, siteSnap] = await Promise.all([pageRef.get(), siteRef.get()])
  if (!pageSnap.exists)
    throw new HttpsError('not-found', 'Page not found')
  const pageData = pageSnap.data() || {}
  const siteData = siteSnap.exists ? (siteSnap.data() || {}) : {}

  const blockSummary = [
    'Index blocks:',
    summarizeBlocksForSeo(pageData.content),
    '',
    'Post blocks:',
    summarizeBlocksForSeo(pageData.postContent),
  ].filter(Boolean).join('\n')

  const includeSiteStructuredData = shouldUpdateSiteStructuredData(siteData)
  const aiResults = await callOpenAiForPageSeo({
    siteData,
    pageData,
    pageId,
    blockSummary,
    includeSiteStructuredData,
  })

  const pageUpdates = {}
  const metaTitle = sanitizeValueForMeta('text', aiResults?.metaTitle)
  const metaDescription = sanitizeValueForMeta('text', aiResults?.metaDescription)
  const structuredData = sanitizeValueForMeta('json', aiResults?.structuredData)
  if (metaTitle)
    pageUpdates.metaTitle = metaTitle
  if (metaDescription)
    pageUpdates.metaDescription = metaDescription
  if (structuredData)
    pageUpdates.structuredData = structuredData

  const siteUpdates = {}
  if (includeSiteStructuredData) {
    const siteStructuredData = sanitizeValueForMeta('json', aiResults?.siteStructuredData)
    if (siteStructuredData)
      siteUpdates.structuredData = siteStructuredData
  }

  if (Object.keys(pageUpdates).length > 0)
    await pageRef.set(pageUpdates, { merge: true })
  if (includeSiteStructuredData && Object.keys(siteUpdates).length > 0)
    await siteRef.set(siteUpdates, { merge: true })

  return {
    pageId,
    metaTitle: pageUpdates.metaTitle || '',
    metaDescription: pageUpdates.metaDescription || '',
    structuredData: pageUpdates.structuredData || '',
    siteStructuredDataUpdated: includeSiteStructuredData && !!siteUpdates.structuredData,
    siteStructuredData: siteUpdates.structuredData || '',
  }
})

exports.getCloudflarePagesProject = onCall(async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const orgId = String(data.orgId || '').trim()
  const siteId = String(data.siteId || '').trim()
  const rawDomains = Array.isArray(data.domains) ? data.domains : []
  const normalizedDomains = Array.from(new Set(rawDomains.map(normalizeDomain).filter(Boolean)))
  const pagesTarget = getCloudflarePagesTarget()

  if (!CLOUDFLARE_PAGES_PROJECT)
    logger.warn('CLOUDFLARE_PAGES_PROJECT is not set.')

  const domainRegistry = {}
  if (orgId && siteId && normalizedDomains.length) {
    const allowed = await permissionCheck(request.auth.uid, 'read', `organizations/${orgId}/sites`)
    if (!allowed)
      throw new HttpsError('permission-denied', 'Not allowed to read site settings')

    await Promise.all(normalizedDomains.map(async (domain) => {
      const registryRef = db.collection(DOMAIN_REGISTRY_COLLECTION).doc(domain)
      const registrySnap = await registryRef.get()
      const fallback = buildDomainDnsPayload(domain, pagesTarget)
      if (!registrySnap.exists) {
        domainRegistry[domain] = {
          ...fallback,
          apexAttempted: false,
          apexAdded: false,
          apexError: '',
          dnsGuidance: fallback.dnsEligible
            ? 'Add the www CNAME. Apex is unavailable; forward apex to www.'
            : 'DNS records are not shown for localhost, IP addresses, or .dev domains.',
        }
        return
      }

      const value = registrySnap.data() || {}
      domainRegistry[domain] = {
        ...fallback,
        ...value,
        dnsRecords: {
          ...fallback.dnsRecords,
          ...(value.dnsRecords || {}),
          www: {
            ...fallback.dnsRecords.www,
            ...(value?.dnsRecords?.www || {}),
          },
          apex: {
            ...fallback.dnsRecords.apex,
            ...(value?.dnsRecords?.apex || {}),
          },
        },
      }
    }))
  }

  return {
    project: CLOUDFLARE_PAGES_PROJECT || '',
    pagesDomain: pagesTarget,
    domainRegistry,
  }
})

exports.generateBlockFields = onCall({ timeoutSeconds: 180 }, async (request) => {
  assertCallableUser(request)
  const data = request.data || {}
  const auth = request.auth
  const { orgId, blockId, blockName, content, fields, currentValues, meta, instructions } = data
  if (!orgId || !blockId)
    throw new HttpsError('invalid-argument', 'Missing orgId or blockId')
  if (!Array.isArray(fields) || fields.length === 0)
    throw new HttpsError('invalid-argument', 'No fields selected')
  if (!OPENAI_API_KEY)
    throw new HttpsError('failed-precondition', 'OPENAI_API_KEY not set')

  const allowed = await permissionCheck(auth.uid, 'write', `organizations/${orgId}/blocks`)
  if (!allowed)
    throw new HttpsError('permission-denied', 'Not allowed to update blocks')

  const filteredFields = fields.filter(field => field.type !== 'image'
    && field.type !== 'color'
    && !/url/i.test(field.id)
    && !/color/i.test(field.id))
  if (filteredFields.length === 0)
    throw new HttpsError('invalid-argument', 'No eligible fields selected')

  const systemPrompt = 'You are a helpful assistant that writes content for CMS block fields.'
  const userPrompt = buildBlockAiPrompt({
    blockId,
    blockName,
    content,
    fields: filteredFields,
    currentValues,
    meta,
    instructions,
  })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new HttpsError('internal', `OpenAI error ${response.status}: ${text}`)
  }

  const json = await response.json()
  const contentText = json?.choices?.[0]?.message?.content || ''
  const parsed = parseAiJson(contentText)
  if (!parsed || typeof parsed !== 'object') {
    logger.error('AI response parse failed', { contentText })
    throw new HttpsError('internal', 'Failed to parse AI response')
  }

  const allowedFields = new Set(filteredFields.map(field => field.id))
  const filtered = {}
  Object.keys(parsed).forEach((key) => {
    if (allowedFields.has(key))
      filtered[key] = parsed[key]
  })

  return {
    fields: filtered,
  }
})

exports.siteAiBootstrapEnqueue = onDocumentCreated(
  { document: 'organizations/{orgId}/sites/{siteId}', timeoutSeconds: 180 },
  async (event) => {
    const { orgId, siteId } = event.params
    if (!orgId || !siteId || siteId === 'templates')
      return
    const data = event.data?.data() || {}
    if (!data.aiAgentUserId && !data.aiInstructions)
      return
    const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
    await siteRef.set({ aiBootstrapStatus: 'queued' }, { merge: true })
    await pubsub.topic(SITE_AI_TOPIC).publishMessage({ json: { orgId, siteId, attempt: 0 } })
    logger.info('Enqueued AI bootstrap for site', { orgId, siteId })
  },
)

exports.syncUserMetaFromPublishedSiteSettings = onDocumentWritten(
  { document: 'organizations/{orgId}/published-site-settings/{siteId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    if (!change?.after?.exists)
      return

    const siteData = change.after.data() || {}
    const users = Array.isArray(siteData.users) ? siteData.users : []
    const primaryUser = users[0]
    if (!primaryUser)
      return

    const userRef = await resolveStagedUserRef(primaryUser)
    if (!userRef) {
      logger.log('syncUserMetaFromPublishedSiteSettings: no staged user found', { primaryUser })
      return
    }

    const userSnap = await userRef.get()
    const userData = userSnap.data() || {}
    const currentMeta = userData.meta || {}
    const targetMeta = pickSyncFields(siteData)
    const metaDiff = buildUpdateDiff(currentMeta, targetMeta)
    if (!Object.keys(metaDiff).length)
      return

    const updatePayload = {}
    for (const [key, value] of Object.entries(metaDiff)) {
      updatePayload[`meta.${key}`] = value
    }

    await userRef.update(updatePayload)
    logger.log('syncUserMetaFromPublishedSiteSettings: updated user meta', {
      siteId: event.params.siteId,
      orgId: event.params.orgId,
      userId: userRef.id,
      fields: Object.keys(updatePayload),
    })
  },
)

exports.syncPublishedRestrictedContentFromSite = onDocumentWritten(
  { document: 'organizations/{orgId}/sites/{siteId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    if (!change?.after?.exists)
      return

    const orgId = event.params.orgId
    const siteId = event.params.siteId
    if (!orgId || !siteId || siteId === 'templates')
      return

    const beforeRestricted = change.before?.data()?.restrictedContent
    const afterRestricted = change.after.data()?.restrictedContent
    if (stableSerialize(beforeRestricted) === stableSerialize(afterRestricted))
      return

    const publishedRef = db.collection('organizations').doc(orgId).collection('published-site-settings').doc(siteId)
    const publishedSnap = await publishedRef.get()
    if (!publishedSnap.exists)
      return

    await publishedRef.set({
      restrictedContent: (afterRestricted && typeof afterRestricted === 'object') ? afterRestricted : {},
    }, { merge: true })
  },
)

exports.ensurePublishedSiteDomains = onDocumentWritten(
  { document: 'organizations/{orgId}/published-site-settings/{siteId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    if (!change?.after?.exists) {
      await cleanupOwnedPublishedSiteDomains(change?.before?.ref?.path, {
        orgId: event.params.orgId,
        siteId: event.params.siteId,
      })
      return
    }

    const orgId = event.params.orgId
    const siteId = event.params.siteId
    const siteRef = change.after.ref
    const siteData = change.after.data() || {}
    const beforeData = change.before?.data?.() || {}
    const membershipEnabled = Boolean(siteData?.restrictedContent?.enabled)
    const rawDomains = Array.isArray(siteData.domains) ? siteData.domains : []
    const normalizedDomains = Array.from(new Set(rawDomains.map(normalizeDomain).filter(Boolean)))
    const beforeRawDomains = Array.isArray(beforeData.domains) ? beforeData.domains : []
    const beforeNormalizedDomains = Array.from(new Set(beforeRawDomains.map(normalizeDomain).filter(Boolean)))

    const removedDomains = beforeNormalizedDomains.filter(domain => !normalizedDomains.includes(domain))
    const removedOwnedDomains = []
    for (const domain of removedDomains) {
      const registryRef = db.collection(DOMAIN_REGISTRY_COLLECTION).doc(domain)
      const registrySnap = await registryRef.get()
      if (!registrySnap.exists)
        continue
      const registryData = registrySnap.data() || {}
      if (registryData.sitePath === siteRef.path) {
        await registryRef.delete()
        removedOwnedDomains.push(domain)
      }
    }

    const conflictDomains = []
    for (const domain of normalizedDomains) {
      const registryRef = db.collection(DOMAIN_REGISTRY_COLLECTION).doc(domain)
      let conflict = false

      await db.runTransaction(async (transaction) => {
        const registrySnap = await transaction.get(registryRef)
        if (!registrySnap.exists) {
          transaction.set(registryRef, {
            domain,
            orgId,
            siteId,
            sitePath: siteRef.path,
            authEnabled: membershipEnabled,
            updatedAt: Firestore.FieldValue.serverTimestamp(),
          })
          return
        }

        const registryData = registrySnap.data() || {}
        if (registryData.sitePath === siteRef.path) {
          transaction.set(registryRef, {
            domain,
            orgId,
            siteId,
            sitePath: siteRef.path,
            authEnabled: membershipEnabled,
            updatedAt: Firestore.FieldValue.serverTimestamp(),
          }, { merge: true })
          return
        }

        conflict = true
      })

      if (conflict)
        conflictDomains.push(domain)
    }

    let filteredDomains = normalizedDomains
    if (conflictDomains.length) {
      const conflictSet = new Set(conflictDomains)
      const nextRawDomains = rawDomains.filter(value => !conflictSet.has(normalizeDomain(value)))
      const conflictLabel = conflictDomains.length > 1 ? 'Domains' : 'Domain'
      const conflictSuffix = conflictDomains.length > 1 ? 'those domains' : 'that domain'
      await siteRef.set({
        domains: nextRawDomains,
        domainError: `${conflictLabel} "${conflictDomains.join(', ')}" removed because another site is already using ${conflictSuffix}.`,
      }, { merge: true })
      filteredDomains = normalizedDomains.filter(domain => !conflictSet.has(domain))
    }

    const pagesTarget = getCloudflarePagesTarget()
    const registryStateByDomain = new Map()
    const syncPlanMap = new Map()
    for (const domain of filteredDomains) {
      const dnsPayload = buildDomainDnsPayload(domain, pagesTarget)
      registryStateByDomain.set(domain, {
        ...dnsPayload,
        wwwAdded: false,
        wwwError: '',
        apexAttempted: false,
        apexAdded: false,
        apexError: '',
        dnsGuidance: dnsPayload.dnsEligible
          ? 'Add the www CNAME record. Apex is unavailable; forward apex to www.'
          : 'DNS records are not shown for localhost, IP addresses, or .dev domains.',
      })

      const apexDomain = dnsPayload.apexDomain
      if (!apexDomain)
        continue
      const existingPlan = syncPlanMap.get(apexDomain) || {
        apexDomain,
        wwwDomain: dnsPayload.wwwDomain,
        domains: new Set(),
      }
      existingPlan.domains.add(domain)
      syncPlanMap.set(apexDomain, existingPlan)
    }

    const syncPlans = Array.from(syncPlanMap.values())
      .filter(plan => shouldSyncCloudflareDomain(plan.wwwDomain))
      .map(plan => ({ ...plan, domains: Array.from(plan.domains) }))

    const removeDomains = Array.from(new Set(
      removedOwnedDomains
        .flatMap((domain) => {
          const apexDomain = getCloudflareApexDomain(domain)
          const wwwDomain = getCloudflarePagesDomain(apexDomain)
          return [wwwDomain, apexDomain]
        })
        .filter(domain => shouldSyncCloudflareDomain(domain)),
    ))
    if (removeDomains.length) {
      await Promise.all(removeDomains.map(domain => removeCloudflarePagesDomain(domain, { orgId, siteId })))
    }

    const syncResults = await Promise.all(syncPlans.map(async (plan) => {
      const wwwResult = await addCloudflarePagesDomain(plan.wwwDomain, { orgId, siteId, variant: 'www' })
      let apexAttempted = false
      let apexResult = { ok: false, error: '' }
      if (shouldSyncCloudflareDomain(plan.apexDomain)) {
        apexAttempted = true
        apexResult = await addCloudflarePagesDomain(plan.apexDomain, { orgId, siteId, variant: 'apex' })
      }
      return {
        ...plan,
        apexAttempted,
        wwwResult,
        apexResult,
      }
    }))

    for (const plan of syncResults) {
      const wwwAdded = !!plan.wwwResult?.ok
      const wwwError = wwwAdded ? '' : String(plan.wwwResult?.error || 'Failed to add www domain.')
      const apexAdded = !!plan.apexResult?.ok
      const apexError = apexAdded
        ? ''
        : (plan.apexAttempted ? String(plan.apexResult?.error || 'Failed to add apex domain.') : '')

      for (const domain of plan.domains) {
        const current = registryStateByDomain.get(domain) || buildDomainDnsPayload(domain, pagesTarget)
        const dnsGuidance = !current.dnsEligible
          ? 'DNS records are not shown for localhost, IP addresses, or .dev domains.'
          : (apexAdded
              ? 'Apex and www were added to Cloudflare Pages. Add both DNS records if your provider requires manual setup.'
              : 'Add the www CNAME record. Apex is unavailable; forward apex to www.')
        const nextDnsRecords = {
          ...(current.dnsRecords || {}),
          apex: {
            ...(current?.dnsRecords?.apex || {}),
            enabled: !!current.dnsEligible && !!current?.dnsRecords?.apex?.value && apexAdded,
          },
          www: {
            ...(current?.dnsRecords?.www || {}),
            enabled: !!current.dnsEligible && !!current?.dnsRecords?.www?.value,
          },
        }

        registryStateByDomain.set(domain, {
          ...current,
          dnsRecords: nextDnsRecords,
          wwwAdded,
          wwwError,
          apexAttempted: !!plan.apexAttempted,
          apexAdded,
          apexError,
          dnsGuidance,
        })
      }
    }

    if (registryStateByDomain.size) {
      for (const [domain, value] of registryStateByDomain.entries()) {
        const registryRef = db.collection(DOMAIN_REGISTRY_COLLECTION).doc(domain)
        const payload = {
          domain,
          orgId,
          siteId,
          sitePath: siteRef.path,
          authEnabled: membershipEnabled,
          updatedAt: Firestore.FieldValue.serverTimestamp(),
          apexDomain: value.apexDomain || '',
          wwwDomain: value.wwwDomain || '',
          dnsEligible: !!value.dnsEligible,
          apexAttempted: !!value.apexAttempted,
          apexAdded: !!value.apexAdded,
          wwwAdded: !!value.wwwAdded,
          dnsRecords: value.dnsRecords || {},
          dnsGuidance: value.dnsGuidance || '',
        }
        payload.apexError = value.apexError ? value.apexError : Firestore.FieldValue.delete()
        payload.wwwError = value.wwwError ? value.wwwError : Firestore.FieldValue.delete()
        await registryRef.set(payload, { merge: true })
      }
    }

    const failed = syncResults.filter(item => !item.wwwResult?.ok)
    if (!failed.length) {
      if (!conflictDomains.length && siteData.domainError) {
        await siteRef.set({ domainError: Firestore.FieldValue.delete() }, { merge: true })
      }
      return
    }

    const errorDomains = failed.map(item => item.wwwDomain)
    const errorDetails = failed
      .map(item => item.wwwResult?.error)
      .filter(Boolean)
      .join('; ')
    const cloudflareMessage = `Cloudflare domain sync failed for "${errorDomains.join(', ')}". ${errorDetails || 'Check function logs.'}`.trim()
    const combinedMessage = conflictDomains.length
      ? `${cloudflareMessage} Conflicts detected for "${conflictDomains.join(', ')}".`
      : cloudflareMessage
    if (siteData.domainError !== combinedMessage) {
      await siteRef.set({ domainError: combinedMessage }, { merge: true })
    }
  },
)

exports.syncFirebaseAuthDomainsFromDomainRegistry = onDocumentWritten(
  { document: `${DOMAIN_REGISTRY_COLLECTION}/{domain}`, timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    const beforeData = change?.before?.data?.() || {}
    const afterData = change?.after?.data?.() || {}

    const beforeDomain = normalizeDomain(beforeData.domain || event.params.domain || '')
    const afterDomain = normalizeDomain(afterData.domain || event.params.domain || '')
    const beforeAuthEnabled = Boolean(beforeData.authEnabled)
    const afterAuthEnabled = Boolean(afterData.authEnabled)

    const beforeAuthDomains = beforeAuthEnabled ? extractFirebaseAuthDomainsFromRawDomains([beforeDomain]) : []
    const afterAuthDomains = afterAuthEnabled ? extractFirebaseAuthDomainsFromRawDomains([afterDomain]) : []
    const addDomains = afterAuthDomains.filter(domain => !beforeAuthDomains.includes(domain))
    const removeDomains = beforeAuthDomains.filter(domain => !afterAuthDomains.includes(domain))

    if (!addDomains.length && !removeDomains.length)
      return

    try {
      await syncFirebaseAuthorizedDomainsForMembership({
        addDomains,
        removeDomains,
        context: {
          trigger: 'domain-registry-write',
          domainDoc: event.params.domain,
          beforeAuthEnabled,
          afterAuthEnabled,
        },
      })
    }
    catch (error) {
      logger.error('Failed to sync Firebase Auth domains from domain registry', {
        domainDoc: event.params.domain,
        addDomains,
        removeDomains,
        message: error?.message || String(error),
      })
      throw error
    }
  },
)

exports.syncSiteSettingsFromUserMeta = onDocumentWritten(
  { document: 'staged-users/{stagedId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    if (!change?.after?.exists)
      return

    const beforeMeta = (change.before.data() || {}).meta || {}
    const afterMeta = (change.after.data() || {}).meta || {}
    const metaDiff = buildUpdateDiff(pickSyncFields(beforeMeta), pickSyncFields(afterMeta))
    if (!Object.keys(metaDiff).length)
      return

    const stagedId = event.params.stagedId
    const authUserId = change.after.data()?.userId
    const userIds = Array.from(new Set([stagedId, authUserId].filter(Boolean)))
    if (!userIds.length)
      return

    const matchedSites = new Map()
    for (const userId of userIds) {
      const snap = await db.collectionGroup('sites')
        .where('users', 'array-contains', userId)
        .get()

      if (snap.empty)
        continue

      for (const doc of snap.docs) {
        matchedSites.set(doc.ref.path, { doc, userId })
      }
    }

    if (!matchedSites.size)
      return

    for (const { doc, userId } of matchedSites.values()) {
      const siteData = doc.data() || {}
      const users = Array.isArray(siteData.users) ? siteData.users : []
      if (!users.length || users[0] !== userId)
        continue

      const siteUpdate = buildUpdateDiff(siteData, pickSyncFields(afterMeta))
      if (!Object.keys(siteUpdate).length)
        continue

      await doc.ref.update(siteUpdate)

      const orgDoc = doc.ref.parent.parent
      const orgId = orgDoc?.id
      const siteId = doc.id
      if (orgId) {
        const publishedRef = db.collection('organizations').doc(orgId).collection('published-site-settings').doc(siteId)
        const publishedSnap = await publishedRef.get()
        if (publishedSnap.exists) {
          await publishedRef.update(siteUpdate)
        }
      }

      logger.log('syncSiteSettingsFromUserMeta: updated site settings from user meta', {
        siteId,
        orgId: orgId || '',
        userId,
        fields: Object.keys(siteUpdate),
      })
    }
  },
)

const setAiStatus = async (siteRef, status) => {
  try {
    await siteRef.set({ aiBootstrapStatus: status }, { merge: true })
  }
  catch (err) {
    logger.warn('Failed to set AI status', { status, error: err?.message })
  }
}

exports.siteAiBootstrapWorker = onMessagePublished(
  { topic: SITE_AI_TOPIC, retry: true, timeoutSeconds: 540, memory: '1GiB' },
  async (event) => {
    const msg = event.data?.message?.json || {}
    const { orgId, siteId } = msg
    const attempt = msg.attempt || 0
    if (!orgId || !siteId || siteId === 'templates')
      return

    const siteRef = db.collection('organizations').doc(orgId).collection('sites').doc(siteId)
    const siteSnap = await siteRef.get()
    if (!siteSnap.exists)
      return
    const siteData = siteSnap.data() || {}
    if (!siteData.aiAgentUserId && !siteData.aiInstructions)
      return
    await setAiStatus(siteRef, 'running')

    const pagesRef = siteRef.collection('pages')
    let pagesSnap = await pagesRef.get()
    if (pagesSnap.empty) {
      await sleep(5000)
      pagesSnap = await pagesRef.get()
    }
    if (pagesSnap.empty) {
      if (attempt < 5) {
        await pubsub.topic(SITE_AI_TOPIC).publishMessage({ json: { orgId, siteId, attempt: attempt + 1 } })
        logger.warn('No pages found yet for AI bootstrap, requeued', { orgId, siteId, attempt })
      }
      else {
        await setAiStatus(siteRef, 'failed')
      }
      return
    }

    let agentData = null
    if (siteData.aiAgentUserId) {
      const usersRef = db.collection('organizations').doc(orgId).collection('users')
      const agentQuery = await usersRef.where('userId', '==', siteData.aiAgentUserId).limit(1).get()
      if (!agentQuery.empty) {
        agentData = agentQuery.docs[0].data()
      }
    }

    const { descriptors, descriptorMap } = buildFieldsList(pagesSnap, siteData)
    if (!descriptors.length) {
      logger.info('No eligible fields to fill for AI bootstrap', { orgId, siteId })
      return
    }

    let aiResults = {}
    try {
      aiResults = await callOpenAiForSiteBootstrap({
        siteData,
        agentData,
        instructions: siteData.aiInstructions,
        fields: descriptors,
      })
    }
    catch (err) {
      logger.error('AI bootstrap failed', { orgId, siteId, error: err?.message })
      await setAiStatus(siteRef, 'failed')
      return
    }

    const { pageUpdates, siteUpdates } = applyAiResults(descriptorMap, pagesSnap, aiResults, siteData)
    const pageIds = Object.keys(pageUpdates)
    const siteFields = Object.keys(siteUpdates)
    if (!pageIds.length && !siteFields.length) {
      logger.info('AI bootstrap returned no applicable updates', { orgId, siteId })
      await setAiStatus(siteRef, 'completed')
      return
    }

    if (siteFields.length)
      await siteRef.update(siteUpdates)

    for (const pageId of pageIds) {
      const update = pageUpdates[pageId]
      await siteRef.collection('pages').doc(pageId).update({
        content: update.content,
        postContent: update.postContent,
        metaTitle: update.metaTitle,
        metaDescription: update.metaDescription,
        structuredData: update.structuredData,
      })
    }

    logger.info('AI bootstrap applied', { orgId, siteId, pagesUpdated: pageIds.length, siteUpdated: siteFields.length > 0 })
    await setAiStatus(siteRef, 'completed')
  },
)
