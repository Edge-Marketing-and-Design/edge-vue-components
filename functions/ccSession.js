const CloudConvert = require('cloudconvert')
const axios = require('axios')
const FormData = require('form-data')
const { Firestore, HttpsError, db, logger, onDocumentDeleted, onDocumentUpdated, onMessagePublished, onRequest, pubsub } = require('./config.js')

const cloudconvertApiKey = process.env.CLOUDCONVERT_LIVE_KEY || process.env.CLOUDCONVERT_API_KEY || ''
const CF_UPLOAD_MAX_ATTEMPTS = Number(process.env.CF_UPLOAD_MAX_ATTEMPTS || 6)

const getPdfUrl = (fileData) => {
  return String(fileData?.r2URL || fileData?.r2Url || '').trim()
}

const getCloudConvertErrorMessage = (error) => {
  const status = Number(error?.response?.status) || 0
  const data = error?.response?.data || {}
  const apiMessage = String(data?.message || data?.error || '').trim()
  const hasApiErrors = Array.isArray(data?.errors) && data.errors.length > 0
  const firstApiError = hasApiErrors
    ? String(data.errors[0]?.message || data.errors[0]?.code || '').trim()
    : ''
  const baseMessage = apiMessage || firstApiError || String(error?.message || 'CloudConvert request failed.')

  if (status === 402)
    return `CloudConvert billing/credits issue (HTTP 402): ${baseMessage}`

  if (status)
    return `CloudConvert API error (HTTP ${status}): ${baseMessage}`

  return baseMessage
}

const getCloudflareErrorMessage = (error) => {
  const status = Number(error?.response?.status) || 0
  const errorList = Array.isArray(error?.response?.data?.errors)
    ? error.response.data.errors.map(item => item?.message).filter(Boolean)
    : []
  const baseMessage = errorList.join('; ')
    || error?.response?.statusText
    || error?.message
    || 'Unknown error'
  if (status)
    return `HTTP ${status}: ${baseMessage}`
  return baseMessage
}

const isCloudflareThrottleError = (message) => {
  const text = String(message || '').toLowerCase()
  return text.includes('throttle')
    || text.includes('too many requests')
    || text.includes('rate limit')
    || text.includes('http 429')
    || text.includes('please wait')
}

const retryMinuteDelay = (attempt) => {
  if (attempt <= 1)
    return 1
  if (attempt <= 3)
    return 2
  return 5
}

const ensurePdfUrlReachable = async (pdfUrl) => {
  const validateStatus = () => true
  const timeout = 15000

  const headRes = await axios.head(pdfUrl, { validateStatus, timeout })
  if (headRes.status >= 200 && headRes.status < 400)
    return

  const fallbackGetRes = await axios.get(pdfUrl, {
    validateStatus,
    timeout,
    headers: {
      Range: 'bytes=0-1',
    },
  })
  if ([200, 206, 416].includes(fallbackGetRes.status))
    return

  throw new Error(`PDF source URL is not accessible (HTTP ${fallbackGetRes.status || headRes.status || 'unknown'}).`)
}

const getFileRef = (organization, fileDocId) => {
  return db.collection('organizations').doc(organization).collection('files').doc(fileDocId)
}

const toAbsoluteHttpUrl = (value) => {
  const raw = String(value || '').trim()
  if (!raw)
    return ''
  if (raw.startsWith('//'))
    return `https:${raw}`
  if (raw.startsWith('http://') || raw.startsWith('https://'))
    return raw
  return ''
}

const normalizeExportFile = (value) => {
  if (typeof value === 'string') {
    return {
      url: toAbsoluteHttpUrl(value),
      filename: '',
      size: 0,
    }
  }

  if (!value || typeof value !== 'object') {
    return {
      url: '',
      filename: '',
      size: 0,
    }
  }

  return {
    url: toAbsoluteHttpUrl(value.url || value.href || value.link || ''),
    filename: String(value.filename || value.name || ''),
    size: Number(value.size) || 0,
  }
}

const buildPages = (cfImages, suffix) => {
  if (!cfImages || typeof cfImages !== 'object')
    return []

  return Object.entries(cfImages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, pageData]) => {
      const variants = Array.isArray(pageData?.variants) ? pageData.variants : []
      return variants.find(variant => String(variant).includes(suffix)) || variants[0] || ''
    })
    .filter(Boolean)
}

const buildHighResImages = (cfImages) => {
  if (!cfImages || typeof cfImages !== 'object')
    return []

  return Object.entries(cfImages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pageName, pageData]) => {
      const variants = Array.isArray(pageData?.variants) ? pageData.variants : []
      const url = variants.find(variant => String(variant).includes('/highres')) || variants[0] || ''
      if (!url)
        return null
      return {
        pageName,
        url,
      }
    })
    .filter(Boolean)
}

const isPdfFile = (data) => {
  const contentType = String(data?.contentType || data?.meta?.contentType || '').toLowerCase()
  if (contentType) {
    return contentType === 'application/pdf'
  }

  const nameCandidates = [
    data?.fileName,
    data?.filename,
    data?.name,
    data?.meta?.fileName,
    data?.meta?.name,
  ].filter(Boolean)

  for (const name of nameCandidates) {
    if (String(name).toLowerCase().endsWith('.pdf'))
      return true
  }

  const pdfUrl = String(getPdfUrl(data) || '').split('?')[0].toLowerCase()
  return !!pdfUrl && pdfUrl.endsWith('.pdf')
}

const isBlankString = (value) => {
  return String(value || '').trim().length === 0
}

const hasPublicationMeta = (data) => {
  const meta = (data && typeof data.meta === 'object')
    ? data.meta
    : {}
  const cmsmedia = meta?.cmsmedia === true
  const cmssite = Array.isArray(meta?.cmssite) ? meta.cmssite : []
  const hasAllSite = cmssite.length === 1 && cmssite[0] === 'all'
  return cmsmedia && hasAllSite
}

const deleteCloudflareImages = async (cfImages) => {
  if (!cfImages || typeof cfImages !== 'object')
    return

  const API_TOKEN = process.env.CF_IMAGES_TOKEN || ''
  const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
  if (!API_TOKEN || !ACCOUNT_ID)
    return

  const deletions = Object.values(cfImages).map(async (imageData) => {
    const imageId = imageData?.id
    if (!imageId)
      return
    try {
      await axios.delete(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1/${imageId}`, {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      })
    }
    catch (error) {
      logger.error('Failed to delete Cloudflare image', { imageId, error: error?.message || String(error) })
    }
  })

  await Promise.all(deletions)
}

const uploadToCloudflare = async (fileData, organization, fileDocId) => {
  const normalized = normalizeExportFile(fileData)
  const url = normalized.url
  const filename = normalized.filename
  const size = normalized.size

  if (!url) {
    throw new Error('Missing URL for Cloudflare image upload.')
  }

  const API_TOKEN = process.env.CF_IMAGES_TOKEN || ''
  const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
  if (!API_TOKEN || !ACCOUNT_ID) {
    throw new Error('Cloudflare Images credentials are missing.')
  }

  const metadata = {
    organization,
    fileDocId,
    filename,
    size,
  }

  const formData = new FormData()
  formData.append('url', url)
  formData.append('metadata', JSON.stringify(metadata))

  try {
    const result = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`, formData, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        ...formData.getHeaders(),
      },
    })
    const { result: imageData, success, errors } = result?.data || {}

    if (!success) {
      const errorMessage = Array.isArray(errors) ? errors.map(error => error?.message || 'Unknown error').join('; ') : 'Unknown error'
      throw new Error(`Upload to Cloudflare failed: ${errorMessage}`)
    }

    return {
      id: imageData?.id || '',
      variants: Array.isArray(imageData?.variants) ? imageData.variants : [],
      meta: imageData?.meta || {},
    }
  }
  catch (error) {
    const errorMessage = getCloudflareErrorMessage(error)
    throw new Error(`Upload to Cloudflare failed: ${errorMessage}`)
  }
}

const isSlugTaken = async (orgId, slug) => {
  if (!slug)
    return false
  const snapshot = await db.collection('organizations').doc(orgId).collection('files').where('slug', '==', slug).limit(1).get()
  return !snapshot.empty
}

const generateSlug = async (organization, name) => {
  const normalizedName = String(name || '').trim()
  const fallback = `publication-${Date.now()}`
  const baseSlug = (normalizedName || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || fallback

  let slug = baseSlug
  let counter = 1
  while (await isSlugTaken(organization, slug)) {
    slug = `${baseSlug}-${counter}`
    counter += 1
  }
  return slug
}

const startCloudConvertSession = async (organization, fileDocId) => {
  const fileRef = getFileRef(organization, fileDocId)
  const fileSnap = await fileRef.get()
  const fileData = fileSnap.data() || {}
  const pdfUrl = getPdfUrl(fileData)
  if (!pdfUrl) {
    throw new Error('Missing PDF URL on file document.')
  }
  if (!cloudconvertApiKey) {
    throw new Error('Missing CLOUDCONVERT_LIVE_KEY/CLOUDCONVERT_API_KEY.')
  }

  const webhookBase = String(process.env.FIREBASE_WEBHOOK_BASE_URL || '').trim()
  if (!webhookBase) {
    throw new Error('Missing FIREBASE_WEBHOOK_BASE_URL.')
  }

  await ensurePdfUrlReachable(pdfUrl)

  const cloudConvert = new CloudConvert(cloudconvertApiKey)
  const webhookUrl = `${webhookBase}/api/cloudconvert?organization=${encodeURIComponent(organization)}&fileDocId=${encodeURIComponent(fileDocId)}`

  let job
  try {
    job = await cloudConvert.jobs.create({
      tasks: {
        import: {
          operation: 'import/url',
          url: encodeURI(pdfUrl),
        },
        convert: {
          operation: 'convert',
          input_format: 'pdf',
          output_format: 'png',
          engine: 'poppler',
          input: ['import'],
          pixel_density: 300,
          filename: 'page.png',
        },
        export: {
          operation: 'export/url',
          input: ['convert'],
          inline: false,
          archive_multiple_files: false,
        },
      },
      tag: `glossee-${organization}-${fileDocId}`,
      webhook_url: webhookUrl,
    })
  }
  catch (error) {
    throw new Error(getCloudConvertErrorMessage(error))
  }

  const jobStatus = String(job?.status || '').trim().toLowerCase()

  await fileRef.set({
    ccState: {
      job,
      status: jobStatus || 'converting',
      errorMessage: '',
      cfImages: {},
      stages: {
        uploaded: true,
        converted: false,
        finalized: false,
      },
    },
  }, { merge: true })
}

exports.updateFileDoc = onDocumentUpdated(
  { document: 'organizations/{orgId}/files/{docId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    const docId = event.params.docId
    const orgId = event.params.orgId
    const before = change.before.data() || {}
    const after = change.after.data() || {}

    const oldPdfUrl = getPdfUrl(before)
    const newPdfUrl = getPdfUrl(after)
    const hasNewPdf = !!newPdfUrl
    const hasExistingCcState = !!after?.ccState
    const pdfReplaced = !!oldPdfUrl && oldPdfUrl !== newPdfUrl
    const previousRetryAt = Number(before?.ccRetryAt) || 0
    const nextRetryAt = Number(after?.ccRetryAt) || 0
    const retryRequested = nextRetryAt > 0 && nextRetryAt !== previousRetryAt
    const ccStateRemoved = !!before?.ccState && !after?.ccState
    const shouldResetState = retryRequested || pdfReplaced || ccStateRemoved
    const shouldStart = hasNewPdf && (!hasExistingCcState || shouldResetState)

    if (!shouldStart || !isPdfFile(after))
      return

    const fileRef = getFileRef(orgId, docId)
    const hasBlankDisplayName = isBlankString(after?.name)
    const fallbackDisplayName = String(after?.fileName || '').trim()

    if (hasBlankDisplayName && fallbackDisplayName) {
      await fileRef.set({
        name: fallbackDisplayName,
      }, { merge: true })
    }

    if (!hasPublicationMeta(after)) {
      const existingMeta = (after && typeof after.meta === 'object')
        ? after.meta
        : {}
      await fileRef.set({
        meta: {
          ...existingMeta,
          cmsmedia: true,
          cmssite: ['all'],
        },
      }, { merge: true })
    }

    if (shouldResetState) {
      const previousCfImages = before?.ccState?.cfImages || after?.ccState?.cfImages || null
      if (previousCfImages) {
        await deleteCloudflareImages(previousCfImages)
      }

      await fileRef.set({
        ccState: {
          job: null,
          status: 'processing',
          errorMessage: '',
          cfImages: {},
          stages: {
            uploaded: true,
            converted: false,
            finalized: false,
          },
        },
        totalPages: 0,
        pages: [],
        highResImages: [],
      }, { merge: true })
    }

    try {
      await startCloudConvertSession(orgId, docId)
    }
    catch (error) {
      logger.error('CloudConvert session creation failed', { orgId, docId, error: error?.message || String(error) })
      await fileRef.set({
        ccState: {
          status: 'failed',
          errorMessage: error?.message || 'CloudConvert session creation failed.',
        },
      }, { merge: true })
    }
  },
)

exports.uploadDocumentDeleted = onDocumentDeleted(
  { document: 'organizations/{orgId}/files/{docId}', timeoutSeconds: 180 },
  async (event) => {
    const fileData = event.data.data() || {}
    if (fileData?.ccState?.cfImages) {
      await deleteCloudflareImages(fileData.ccState.cfImages)
    }
  },
)

exports.cloudconvertWebhook = onRequest(async (req, res) => {
  try {
    const organization = String(req.query?.organization || '').trim()
    const fileDocId = String(req.query?.fileDocId || '').trim()
    if (!organization || !fileDocId) {
      res.status(400).send('Missing organization or fileDocId.')
      return
    }

    const eventData = req.body || {}
    if (!eventData?.job) {
      res.status(400).send('Invalid payload.')
      return
    }

    const fileRef = getFileRef(organization, fileDocId)
    const jobStatus = String(eventData.job.status || '')

    await fileRef.set({
      ccState: {
        job: eventData.job,
      },
    }, { merge: true })

    if (jobStatus === 'finished') {
      const cloudConvert = new CloudConvert(cloudconvertApiKey)
      const exportUrls = cloudConvert.jobs.getExportUrls(eventData.job) || []

      await fileRef.set({
        totalPages: exportUrls.length,
        ccState: {
          status: exportUrls.length ? 'uploading images' : 'failed',
          errorMessage: exportUrls.length ? '' : 'CloudConvert returned zero pages.',
          stages: {
            converted: true,
          },
        },
      }, { merge: true })

      for (const [index, file] of exportUrls.entries()) {
        const pageName = `page-${String(index + 1).padStart(3, '0')}`
        const normalizedFile = normalizeExportFile(file)
        const payload = {
          url: normalizedFile.url || file,
          exportFile: file,
          organization,
          fileDocId,
          pageName,
          attempt: 0,
        }
        try {
          await pubsub.topic('upload-to-cloudflare').publishMessage({
            data: Buffer.from(JSON.stringify(payload)),
          })
        }
        catch (error) {
          await db.collection('topic-queue').add({
            topic: 'upload-to-cloudflare',
            payload,
            minuteDelay: 1,
            timestamp: Firestore.FieldValue.serverTimestamp(),
          })
          logger.error('Failed to publish upload-to-cloudflare message', {
            organization,
            fileDocId,
            pageName,
            error: error?.message || String(error),
          })
        }
      }
    }
    else if (jobStatus === 'failed') {
      await fileRef.set({
        ccState: {
          status: 'failed',
          errorMessage: eventData?.job?.error?.message || 'CloudConvert conversion failed.',
        },
      }, { merge: true })
    }
    else {
      await fileRef.set({
        ccState: {
          status: String(jobStatus || 'converting').toLowerCase(),
        },
      }, { merge: true })
    }

    res.status(200).send('OK')
  }
  catch (error) {
    logger.error('CloudConvert webhook failed', { error: error?.message || String(error) })
    res.status(500).send('Webhook processing failed.')
  }
})

exports.exportToCloudflare = onMessagePublished(
  { topic: 'upload-to-cloudflare', timeoutSeconds: 240, memory: '2GiB', concurrency: 2, maxInstances: 3 },
  async (event) => {
    const payload = event.data.message.json || {}
    const fileData = payload.exportFile || payload.url || payload.file || ''
    const normalizedFile = normalizeExportFile(fileData)
    const url = normalizedFile.url
    const organization = String(payload.organization || '').trim()
    const fileDocId = String(payload.fileDocId || '').trim()
    const pageName = String(payload.pageName || '').trim()
    const attempt = Number(payload.attempt || 0)
    if (!url || !organization || !fileDocId || !pageName) {
      logger.error('Invalid upload-to-cloudflare payload', payload)
      return
    }

    const fileRef = getFileRef(organization, fileDocId)
    try {
      const cfData = await uploadToCloudflare({
        ...normalizedFile,
        filename: normalizedFile.filename || pageName,
      }, organization, fileDocId)
      await fileRef.set({
        ccState: {
          cfImages: {
            [pageName]: {
              ...cfData,
              pageName,
            },
          },
        },
      }, { merge: true })

      const fileSnap = await fileRef.get()
      const currentFileData = fileSnap.data() || {}
      const cfImages = currentFileData?.ccState?.cfImages || {}
      const uploadedCount = Object.values(cfImages).filter(item => Array.isArray(item?.variants) && item.variants.length > 0).length
      const totalPages = Number(currentFileData?.totalPages) || 0

      if (totalPages > 0 && uploadedCount >= totalPages) {
        const currentSlug = String(currentFileData.slug || '').trim()
        const slug = currentSlug || await generateSlug(organization, currentFileData.name || currentFileData.fileName || fileDocId)
        const pages = buildPages(cfImages, '/public')
        const highResImages = buildHighResImages(cfImages)

        await fileRef.set({
          slug,
          pageEffect: currentFileData?.pageEffect || 'flip',
          pages,
          highResImages,
          ccState: {
            status: 'complete',
            errorMessage: '',
            stages: {
              finalized: true,
            },
          },
        }, { merge: true })
      }
      else {
        await fileRef.set({
          ccState: {
            status: totalPages > 0 ? `processing page ${uploadedCount} of ${totalPages}` : 'processing',
          },
        }, { merge: true })
      }
    }
    catch (error) {
      const errorMessage = error?.message || 'Failed to upload page image to Cloudflare.'
      if (isCloudflareThrottleError(errorMessage) && attempt < CF_UPLOAD_MAX_ATTEMPTS) {
        const nextAttempt = attempt + 1
        const minuteDelay = retryMinuteDelay(nextAttempt)
        const retryPayload = {
          ...payload,
          attempt: nextAttempt,
        }
        await db.collection('topic-queue').add({
          topic: 'upload-to-cloudflare',
          payload: retryPayload,
          minuteDelay,
          retry: 0,
          timestamp: Firestore.FieldValue.serverTimestamp(),
        })

        await fileRef.set({
          ccState: {
            status: 'uploading images',
            errorMessage: `Cloudflare throttled page uploads. Retrying ${pageName} (attempt ${nextAttempt}/${CF_UPLOAD_MAX_ATTEMPTS}).`,
          },
        }, { merge: true })
        return
      }

      await fileRef.set({
        ccState: {
          cfImages: {
            [pageName]: {
              pageName,
              error: errorMessage || 'Upload failed',
            },
          },
          status: 'failed',
          errorMessage: errorMessage || 'Failed to upload page image to Cloudflare.',
        },
      }, { merge: true })

      throw new HttpsError('internal', 'Failed to upload page image to Cloudflare.')
    }
  },
)
