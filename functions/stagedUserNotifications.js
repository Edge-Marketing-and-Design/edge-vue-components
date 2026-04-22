const axios = require('axios')
const {
  logger,
  db,
  onDocumentWritten,
  Firestore,
} = require('./config.js')

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || ''
const FIREBASE_WEBHOOK_BASE_URL = String(process.env.FIREBASE_WEBHOOK_BASE_URL || '').trim()

const normalizeEmail = (value) => {
  if (!value)
    return ''
  const trimmed = String(value).trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : ''
}

const escapeHtml = (value) => {
  const source = String(value || '')
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

const getCollectionPaths = (stagedUser = {}) => {
  const fromCollectionPaths = Array.isArray(stagedUser.collectionPaths)
    ? stagedUser.collectionPaths.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const rolesObject = (stagedUser.roles && typeof stagedUser.roles === 'object' && !Array.isArray(stagedUser.roles))
    ? stagedUser.roles
    : null
  const fromRoleValues = rolesObject
    ? Object.values(rolesObject)
      .map(role => String(role?.collectionPath || '').trim())
      .filter(Boolean)
    : []
  const fromRoleKeys = rolesObject
    ? Object.keys(rolesObject)
      .map(key => String(key || '').trim())
      .filter(Boolean)
    : []
  return [...new Set([...fromCollectionPaths, ...fromRoleValues, ...fromRoleKeys])]
}

const isTemplateStagedUser = (stagedId, stagedUser = {}) => {
  if (stagedUser.isTemplate === true)
    return true
  if (String(stagedUser.templateUserId || '').trim())
    return true
  if (String(stagedId || '').trim() === 'organization-registration-template')
    return true
  return false
}

const isRegisteredStagedUser = (stagedUser = {}) => {
  return Boolean(String(stagedUser?.userId || '').trim())
}

const isAudienceStagedUser = (stagedUser = {}) => {
  const paths = getCollectionPaths(stagedUser)
  return paths.some(path => path.includes('-audience-users-'))
}

const getOrgIdFromCollectionPath = (value) => {
  const path = String(value || '').trim()
  if (!path)
    return ''

  // Supports slash style paths like: organizations/{orgId}/users
  if (path.startsWith('organizations/')) {
    const parts = path.split('/')
    return String(parts[1] || '').trim()
  }

  // Supports dash style paths like:
  // - organizations-{orgId}
  // - organizations-{orgId}-blah-blah
  if (!path.startsWith('organizations-'))
    return ''

  const match = path.match(/^organizations-([^-\/]+)(?:-|$)/)
  return String(match?.[1] || '').trim()
}

const getOrgIdFromStagedUser = (stagedUser = {}) => {
  const paths = getCollectionPaths(stagedUser)
  for (const path of paths) {
    const orgId = getOrgIdFromCollectionPath(path)
    if (orgId)
      return orgId
  }
  return ''
}

const resolveOrganizationName = async (orgId) => {
  const normalizedOrgId = String(orgId || '').trim()
  if (!normalizedOrgId)
    return 'your organization'

  const orgSnap = await db.collection('organizations').doc(normalizedOrgId).get()
  if (!orgSnap.exists)
    return 'your organization'

  const orgData = orgSnap.data() || {}
  return String(orgData.name || orgData.organizationName || '').trim() || 'your organization'
}

const buildSignupUrl = (stagedId) => {
  const baseUrl = FIREBASE_WEBHOOK_BASE_URL.replace(/\/+$/, '')
  if (!baseUrl)
    return ''
  return `${baseUrl}/app/signup/?reg-code=${encodeURIComponent(String(stagedId || '').trim())}`
}

const sendStagedUserInviteEmail = async ({ to, orgName, signupUrl }) => {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    return {
      ok: false,
      status: null,
      message: 'SendGrid config missing',
    }
  }

  const recipient = normalizeEmail(to)
  if (!recipient) {
    return {
      ok: false,
      status: null,
      message: 'Missing recipient email',
    }
  }

  const safeOrgName = String(orgName || '').trim() || 'your organization'
  const safeOrgNameHtml = escapeHtml(safeOrgName)
  const safeSignupUrlHtml = escapeHtml(signupUrl)
  const subject = `A new account has been created for you on ${safeOrgName}`
  const textBody = [
    `A new account has been created for you on "${safeOrgName}".`,
    '',
    'Click here to complete your registration:',
    signupUrl,
  ].join('\n')

  const htmlBody = `
    <div>
      <p>A new account has been created for you on <strong>${safeOrgNameHtml}</strong>.</p>
      <p><a href="${safeSignupUrlHtml}">Click here to complete your registration</a></p>
    </div>
  `

  try {
    const response = await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: recipient }], subject }],
      from: { email: SENDGRID_FROM_EMAIL },
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html', value: htmlBody },
      ],
    }, {
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    return {
      ok: true,
      status: response?.status ?? 202,
      message: 'accepted',
      subject,
      recipient,
    }
  }
  catch (error) {
    const responseStatus = error?.response?.status ?? null
    const responseData = error?.response?.data || {}
    const responseErrors = Array.isArray(responseData?.errors) ? responseData.errors : []
    const firstMessage = String(responseErrors?.[0]?.message || error?.message || 'SendGrid request failed')
    return {
      ok: false,
      status: responseStatus,
      message: firstMessage,
      errors: responseErrors,
      subject,
      recipient,
    }
  }
}

exports.stagedUserInviteEmailOnCreate = onDocumentWritten(
  { document: 'staged-users/{stagedId}', timeoutSeconds: 180 },
  async (event) => {
    const stagedSnap = event.data?.after
    if (!stagedSnap?.exists)
      return

    const stagedId = String(event.params?.stagedId || '').trim()
    const stagedUser = stagedSnap.data() || {}
    const priorInviteEmail = stagedUser?.inviteEmail || {}
    if (priorInviteEmail?.sentAt || priorInviteEmail?.attemptedAt)
      return

    if (isTemplateStagedUser(stagedId, stagedUser))
      return

    if (isRegisteredStagedUser(stagedUser))
      return

    if (isAudienceStagedUser(stagedUser))
      return

    const email = normalizeEmail(stagedUser?.meta?.email || stagedUser?.email)
    if (!email)
      return

    const signupUrl = buildSignupUrl(stagedId)
    if (!signupUrl) {
      logger.error('stagedUserInviteEmailOnCreate: FIREBASE_WEBHOOK_BASE_URL is not configured', { stagedId })
      return
    }

    const orgId = getOrgIdFromStagedUser(stagedUser)
    if (!orgId) {
      logger.log('stagedUserInviteEmailOnCreate: waiting for org path on staged user', { stagedId })
      return
    }
    const orgName = await resolveOrganizationName(orgId)
    const sendgrid = await sendStagedUserInviteEmail({ to: email, orgName, signupUrl })

    await stagedSnap.ref.set({
      inviteEmail: {
        sendgrid,
        orgId,
        orgName,
        signupUrl,
        attemptedAt: Firestore.FieldValue.serverTimestamp(),
        ...(sendgrid.ok ? { sentAt: Firestore.FieldValue.serverTimestamp() } : {}),
      },
    }, { merge: true })

    if (!sendgrid.ok) {
      logger.error('stagedUserInviteEmailOnCreate: invite email failed', {
        stagedId,
        orgId,
        orgName,
        email,
        status: sendgrid.status,
        message: sendgrid.message,
      })
      return
    }

    logger.log('stagedUserInviteEmailOnCreate: invite email sent', {
      stagedId,
      orgId,
      orgName,
      email,
      status: sendgrid.status,
    })
  },
)
