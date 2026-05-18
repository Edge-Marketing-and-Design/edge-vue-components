const AWS = require('aws-sdk')
const fetch = require('node-fetch')

const { Firestore, admin, db, logger, onDocumentDeleted, onDocumentUpdated, onObjectDeleted, onObjectFinalized, onRequest, onSchedule } = require('./config.js')

const EDGE_MEDIA_API_URL = String(process.env.EDGE_MEDIA_API_URL || 'https://edge-media-api.edge-marketing.workers.dev').replace(/\/+$/, '')
const EDGE_MEDIA_API_KEY = String(process.env.EDGE_MEDIA_API_KEY || '').trim()
const EDGE_MEDIA_DEFAULT_FORMAT = String(process.env.EDGE_MEDIA_DEFAULT_FORMAT || 'jpg').trim().toLowerCase()
const EDGE_MEDIA_DEFAULT_DPI = Number(process.env.EDGE_MEDIA_DEFAULT_DPI || 200)
const EDGE_MEDIA_LEGACY_IMPORT_BATCH_SIZE = Number(process.env.EDGE_MEDIA_LEGACY_IMPORT_BATCH_SIZE || 25)
const LEGACY_IMPORT_MIGRATION_ID = 'edgeMediaLegacyPublicationsImport'

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp']

const getR2Client = () => new AWS.S3({
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  region: 'auto',
})

const isImagePath = (value) => {
  const ext = String(value || '').toLowerCase().split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || ''
  return imageExtensions.includes(ext)
}

const isImageFileData = (fileData = {}) => {
  const contentType = String(fileData?.contentType || fileData?.meta?.contentType || '').toLowerCase()
  if (contentType.startsWith('image/'))
    return true

  return isImagePath(fileData?.fileName)
    || isImagePath(fileData?.name)
    || isImagePath(fileData?.filePath)
    || isImagePath(fileData?.r2FilePath)
}

const getWebhookUrl = (organization, fileDocId, type = 'image') => {
  const webhookBase = String(process.env.FIREBASE_WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!webhookBase)
    throw new Error('Missing FIREBASE_WEBHOOK_BASE_URL.')

  return `${webhookBase}/api/edge-media?organization=${encodeURIComponent(organization)}&fileDocId=${encodeURIComponent(fileDocId)}&type=${encodeURIComponent(type)}`
}

const getFileRef = (organization, fileDocId) => {
  return db.collection('organizations').doc(organization).collection('files').doc(fileDocId)
}

const cleanPath = value => String(value || '').trim().replace(/^\/+/, '')

const isPdfFile = (data) => {
  const contentType = String(data?.contentType || data?.meta?.contentType || '').toLowerCase()
  if (contentType)
    return contentType === 'application/pdf'

  const names = [
    data?.fileName,
    data?.filename,
    data?.name,
    data?.filePath,
    data?.r2FilePath,
    data?.meta?.fileName,
    data?.meta?.name,
  ].filter(Boolean)

  return names.some(name => String(name).toLowerCase().split('?')[0].endsWith('.pdf'))
}

const hasPublicationMeta = (data) => {
  const meta = (data && typeof data.meta === 'object') ? data.meta : {}
  return meta.flipbook === true || meta.cmsmedia === true
}

const getInputKey = data => cleanPath(data?.r2FilePath)

const buildOutputPrefix = (inputKey) => {
  const key = cleanPath(inputKey)
  const slashIndex = key.lastIndexOf('/')
  const directory = slashIndex >= 0 ? key.slice(0, slashIndex + 1) : ''
  const filename = slashIndex >= 0 ? key.slice(slashIndex + 1) : key
  const baseName = filename.replace(/\.pdf$/i, '').replace(/\/+$/, '')
  return `${directory}${baseName}/`
}

const pageNumber = key => Number(String(key || '').match(/(\d+)/)?.[1] || Number.POSITIVE_INFINITY)

const sortedOutputEntries = outputs => Object.entries(outputs || {})
  .filter(([key]) => /^page-\d+$/i.test(String(key || '')))
  .sort((a, b) => pageNumber(a[0]) - pageNumber(b[0]))

const getVariant = (output, name) => {
  const variants = output?.variants
  if (!variants)
    return ''
  if (Array.isArray(variants))
    return String(variants.find(variant => String(variant || '').includes(`/${name}`)) || '')
  if (typeof variants === 'object')
    return String(variants[name] || '')
  return ''
}

const getFirstVariant = (output) => {
  const variants = output?.variants
  if (Array.isArray(variants))
    return String(variants[0] || '')
  if (variants && typeof variants === 'object')
    return String(Object.values(variants).find(Boolean) || '')
  return ''
}

const outputPublicUrl = output => getVariant(output, 'public') || getFirstVariant(output)

const outputHighResUrl = output => getVariant(output, 'highres') || getVariant(output, 'public') || getFirstVariant(output)

const buildPages = outputs => sortedOutputEntries(outputs)
  .map(([, output]) => outputPublicUrl(output))
  .filter(Boolean)

const buildHighResImages = outputs => sortedOutputEntries(outputs)
  .map(([pageName, output]) => {
    const url = outputHighResUrl(output)
    return url ? { pageName, url } : null
  })
  .filter(Boolean)

const generateSlug = async (organization, name, fileDocId) => {
  const fallback = `publication-${Date.now()}`
  const baseSlug = (String(name || '').trim() || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || fallback

  let slug = baseSlug
  let counter = 1
  while (true) {
    const snapshot = await db.collection('organizations').doc(organization).collection('files').where('slug', '==', slug).limit(1).get()
    const takenByOtherDoc = snapshot.docs.some(doc => doc.id !== fileDocId)
    if (!takenByOtherDoc)
      return slug
    slug = `${baseSlug}-${counter}`
    counter += 1
  }
}

const mergeOutputs = (existing, next) => ({
  ...((existing && typeof existing === 'object') ? existing : {}),
  ...((next && typeof next === 'object') ? next : {}),
})

const getLegacyPageImages = (data) => {
  const pageImages = data?.ccState?.cFImages || data?.ccState?.cfImages
  return (pageImages && typeof pageImages === 'object') ? pageImages : {}
}

const normalizeLegacyVariants = (legacyPage = {}) => {
  const variants = legacyPage?.variants || {}
  const normalized = {
    thumbnail: getVariant({ variants }, 'thumbnail'),
    public: getVariant({ variants }, 'public'),
    highres: getVariant({ variants }, 'highres'),
  }
  const first = getFirstVariant({ variants })
  if (!normalized.public && first)
    normalized.public = first
  if (!normalized.thumbnail && normalized.public)
    normalized.thumbnail = normalized.public
  if (!normalized.highres && normalized.public)
    normalized.highres = normalized.public

  return Object.fromEntries(
    Object.entries(normalized)
      .filter(([, url]) => String(url || '').startsWith('https://')),
  )
}

const getCloudflareImageIdFromUrl = (url) => {
  try {
    const parsed = new URL(String(url || ''))
    const parts = parsed.pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? parts[1] : ''
  }
  catch {
    return ''
  }
}

const buildLegacyImportPages = (fileData) => {
  return sortedOutputEntries(getLegacyPageImages(fileData))
    .map(([, pageData]) => {
      const variants = normalizeLegacyVariants(pageData)
      const cfImagesId = String(pageData?.cfImagesId || pageData?.id || getCloudflareImageIdFromUrl(variants.public || variants.thumbnail || variants.highres) || '').trim()
      if (!cfImagesId || !Object.keys(variants).length)
        return null
      return { cfImagesId, variants }
    })
    .filter(Boolean)
}

const normalizeImageJob = (job = {}, r2Path = '') => {
  const result = job.result || job
  const meta = result.meta || job.meta || {}
  const outputs = result.outputs || {}
  const imageOutput = outputs.image || result.image || {}
  const rawVariants = result.variants || imageOutput.variants || []
  const variants = Array.isArray(rawVariants)
    ? rawVariants
    : Object.values(rawVariants || {}).filter(Boolean)
  const responseId = result.id || job.id || null
  const isImageJob = result.type === 'image' || job.type === 'image'
  const jobId = meta.jobId || result.jobId || job.jobId || (isImageJob ? responseId : null)
  const cloudflareImageId = result.cloudflareImageId || imageOutput.cfImagesId || (variants.length ? result.id : '')
  const resolvedR2Path = result.inputKey || result.r2Path || imageOutput.r2Path || imageOutput.originalR2Path || meta.r2Path || meta.inputKey || r2Path
  return {
    id: jobId,
    type: result.type || job.type || 'image',
    status: result.status || job.status || 'queued',
    r2Path: resolvedR2Path,
    inputKey: result.inputKey || meta.inputKey || resolvedR2Path,
    sourceType: result.sourceType || meta.uploadType || '',
    bucket: result.bucket || meta.inputBucket || 'files',
    resolvedOutputPrefix: result.resolvedOutputPrefix || '',
    outputs,
    cloudflareImageId,
    variants,
    meta,
  }
}

const buildImageStateUpdate = (job, r2Path, status = '') => {
  const normalized = normalizeImageJob(job, r2Path)
  return {
    edgeMediaImageState: {
      id: normalized.id,
      type: 'image',
      status: status || normalized.status,
      r2Path: normalized.r2Path,
      inputKey: normalized.inputKey,
      sourceType: normalized.sourceType,
      bucket: normalized.bucket,
      resolvedOutputPrefix: normalized.resolvedOutputPrefix,
      outputs: normalized.outputs,
      cloudflareImageId: normalized.cloudflareImageId,
      variants: normalized.variants,
      meta: normalized.meta,
      errorMessage: '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }
}

const buildCompletedImageUpdate = (job, r2Path) => {
  const normalized = normalizeImageJob(job, r2Path)
  return {
    cloudflareImageId: normalized.cloudflareImageId,
    cloudflareImageVariants: normalized.variants,
    cloudflareUploadCompleted: true,
    retryImages: false,
    edgeMediaImageState: {
      id: normalized.id,
      type: 'image',
      status: 'complete',
      r2Path: normalized.r2Path,
      inputKey: normalized.inputKey,
      sourceType: normalized.sourceType,
      bucket: normalized.bucket,
      resolvedOutputPrefix: normalized.resolvedOutputPrefix,
      outputs: normalized.outputs,
      cloudflareImageId: normalized.cloudflareImageId,
      variants: normalized.variants,
      meta: normalized.meta,
      errorMessage: '',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }
}

const buildStorageMetadata = (existingMetadata, job, r2FilePath, r2URL) => {
  const normalized = normalizeImageJob(job, r2FilePath)
  return {
    metadata: {
      ...existingMetadata,
      r2FilePath,
      r2URL,
      uploadCompletedToR2: 'true',
      r2ProcessCompleted: 'true',
      edgeMediaImageJobId: normalized.id,
    },
  }
}

const buildCompletedStorageMetadata = (existingMetadata, job, r2FilePath, r2URL) => {
  const normalized = normalizeImageJob(job, r2FilePath)
  return {
    metadata: {
      ...existingMetadata,
      r2FilePath,
      r2URL,
      uploadCompletedToR2: 'true',
      r2ProcessCompleted: 'true',
      edgeMediaImageJobId: normalized.id,
      cloudflareImageId: normalized.cloudflareImageId,
      cloudflareImageVariants: normalized.variants,
      cloudflareUploadCompleted: true,
    },
  }
}

const startImageJob = async ({ organization, fileDocId, r2Path }) => {
  if (!EDGE_MEDIA_API_KEY)
    throw new Error('Missing EDGE_MEDIA_API_KEY.')

  const response = await fetch(`${EDGE_MEDIA_API_URL}/images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EDGE_MEDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      r2Path,
      webhookUrl: getWebhookUrl(organization, fileDocId),
    }),
  })

  const data = await response.json()
  if (!response.ok || data?.success === false) {
    const errorMessages = (data?.errors || [])
      .map(error => error.message || 'Unknown error')
      .join('; ')
    throw new Error(errorMessages || data?.error?.message || `Edge Media image upload failed: ${response.statusText}`)
  }

  return data
}

const postEdgeMediaJson = async (path, payload) => {
  if (!EDGE_MEDIA_API_KEY)
    throw new Error('Missing EDGE_MEDIA_API_KEY.')

  const response = await fetch(`${EDGE_MEDIA_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EDGE_MEDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.success === false) {
    const errorMessages = (data?.errors || [])
      .map(error => error.message || 'Unknown error')
      .join('; ')
    throw new Error(errorMessages || data?.error?.message || `Edge Media request failed: ${response.statusText}`)
  }

  return data
}

const startPublicationJob = async (organization, fileDocId, fileData) => {
  const inputKey = getInputKey(fileData)
  if (!inputKey)
    throw new Error('Missing R2 PDF path on file document.')

  return postEdgeMediaJson('/pdf-to-images', {
    inputKey,
    outputPrefix: buildOutputPrefix(inputKey),
    webhookUrl: getWebhookUrl(organization, fileDocId, 'publication'),
    format: EDGE_MEDIA_DEFAULT_FORMAT === 'png' ? 'png' : 'jpg',
    dpi: Number.isFinite(EDGE_MEDIA_DEFAULT_DPI) ? EDGE_MEDIA_DEFAULT_DPI : 200,
  })
}

const importLegacyPublicationJob = async (fileData) => {
  return postEdgeMediaJson('/pdf-to-images/import', {
    inputKey: getInputKey(fileData),
    pages: buildLegacyImportPages(fileData),
  })
}

const deleteR2File = async (filePath) => {
  if (!filePath)
    return

  const r2 = getR2Client()
  try {
    await r2.deleteObject({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'files',
      Key: filePath,
    }).promise()
    logger.info('File deleted from Cloudflare R2', { filePath })
  }
  catch (error) {
    logger.error('Error deleting file from Cloudflare R2', { filePath, error: error?.message || String(error) })
  }
}

const deleteEdgeMediaJob = async (jobId) => {
  if (!jobId || !EDGE_MEDIA_API_KEY)
    return false

  const response = await fetch(`${EDGE_MEDIA_API_URL}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${EDGE_MEDIA_API_KEY}`,
    },
  })

  if (!response.ok)
    throw new Error(`Failed to delete Edge Media job: ${response.statusText}`)

  return true
}

const deleteCloudflareImage = async (imageId) => {
  if (!imageId || !process.env.CF_IMAGES_TOKEN || !process.env.CF_ACCOUNT_ID)
    return false

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/images/v1/${imageId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.CF_IMAGES_TOKEN}`,
      },
    },
  )

  if (!response.ok)
    throw new Error(`Failed to delete Cloudflare image: ${response.statusText}`)

  return true
}

const uploadToCloudflareVideo = async ({ r2FilePath, r2URL, fileDocId, orgId, fileSize }) => {
  const cleanedr2FilePath = r2FilePath
    .replaceAll('/', '-')
    .replace('.firebasestorage.app-organizations', '')

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/stream/copy`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CF_IMAGES_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: r2URL,
        meta: {
          name: cleanedr2FilePath,
          orgId,
          fileDocId,
          fileName: cleanedr2FilePath,
          fileSize,
        },
        allowDownloads: true,
      }),
    },
  )

  const result = await response.json()
  if (!result.success) {
    const errorMessages = (result.errors || [])
      .map(error => error.message || 'Unknown error')
      .join('; ')
    throw new Error(`Cloudflare Stream upload failed: ${errorMessages}`)
  }

  const { uid, preview, playback, thumbnail } = result.result
  return { id: uid, preview, playback, thumbnail }
}

const deleteCloudflareVideo = async (videoId) => {
  if (!videoId || !process.env.CF_IMAGES_TOKEN || !process.env.CF_ACCOUNT_ID)
    return false

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/stream/${videoId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.CF_IMAGES_TOKEN}`,
      },
    },
  )

  if (!response.ok)
    throw new Error(`Failed to delete Cloudflare video: ${response.statusText}`)

  return true
}

exports.toR2 = onObjectFinalized(
  {
    bucket: process.env.FIREBASE_STORAGE_BUCKET,
    region: process.env.FIREBASE_STORAGE_BUCKET_REGION,
    memory: '2GiB',
    cpu: 2,
    timeoutSeconds: 540,
  },
  async (event) => {
    const toR2 = event.data.metadata?.toR2
    if (!toR2)
      return

    const r2 = getR2Client()
    const fileBucket = event.data.bucket
    const filePath = event.data.name
    const r2FilePath = `${process.env.FIREBASE_STORAGE_BUCKET}/${event.data.metadata?.filePath}`
    const r2URL = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${r2FilePath}`
    const fileName = event.data.metadata?.fileName
    const fileSize = event.data.metadata?.fileSize
    const contentType = event.data.contentType || ''
    const fileDocId = event.data.metadata?.fileDocId
    const orgId = event.data.metadata?.orgId
    const bucket = admin.storage().bucket(fileBucket)
    const fileRef = bucket.file(filePath)
    const fileStream = fileRef.createReadStream()
    const docRef = getFileRef(orgId, fileDocId)

    try {
      await r2.upload({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'files',
        Key: r2FilePath,
        Body: fileStream,
        ContentType: contentType,
      }).promise()

      await docRef.set({ r2FilePath, r2URL, uploadCompletedToR2: true }, { merge: true })

      const blankBuffer = Buffer.from('')
      await fileRef.save(blankBuffer, {
        contentType: 'application/octet-stream',
      })

      let updatedMetadata = {
        metadata: {
          ...event.data.metadata,
          r2FilePath,
          r2URL,
          uploadCompletedToR2: 'true',
          r2ProcessCompleted: 'true',
        },
      }

      if (contentType.startsWith('image/') && EDGE_MEDIA_API_KEY) {
        try {
          const job = await startImageJob({ organization: orgId, fileDocId, r2Path: r2FilePath })
          updatedMetadata = buildStorageMetadata(event.data.metadata, job, r2FilePath, r2URL)
          await docRef.set(buildImageStateUpdate(job, r2FilePath, normalizeImageJob(job, r2FilePath).status), { merge: true })
        }
        catch (error) {
          logger.error('Edge Media image job start failed', {
            orgId,
            fileDocId,
            r2FilePath,
            error: error?.message || String(error),
          })
          await docRef.set({
            edgeMediaImageState: {
              status: 'failed',
              type: 'image',
              r2Path: r2FilePath,
              errorMessage: error?.message || String(error),
              failedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          }, { merge: true })
        }
      }

      if (contentType.startsWith('video/') && process.env.CF_IMAGES_TOKEN) {
        try {
          const cloudflareVideo = await uploadToCloudflareVideo({
            r2FilePath,
            r2URL,
            fileDocId,
            orgId,
            fileName,
            fileSize,
          })
          updatedMetadata = {
            metadata: {
              ...event.data.metadata,
              r2FilePath,
              r2URL,
              uploadCompletedToR2: 'true',
              r2ProcessCompleted: 'true',
              cloudflareVideoId: cloudflareVideo.id,
              cloudflareVideoPlayback: cloudflareVideo.playback,
              cloudflareVideoThumbnail: cloudflareVideo.thumbnail,
              cloudflareVideoPreview: cloudflareVideo.preview,
              cloudflareUploadCompleted: true,
            },
          }
          await docRef.set({
            cloudflareVideoId: cloudflareVideo.id,
            cloudflareVideoPlayback: cloudflareVideo.playback,
            cloudflareVideoThumbnail: cloudflareVideo.thumbnail,
            cloudflareVideoPreview: cloudflareVideo.preview,
            cloudflareUploadCompleted: true,
          }, { merge: true })
        }
        catch (error) {
          logger.error('Cloudflare Video Upload Failed', {
            orgId,
            fileDocId,
            r2FilePath,
            error: error?.message || String(error),
          })
        }
      }

      await fileRef.setMetadata(updatedMetadata)
      logger.info('File uploaded to Cloudflare R2', { fileName, r2FilePath })
    }
    catch (error) {
      await fileRef.setMetadata({
        metadata: {
          ...event.data.metadata,
          uploadCompletedToR2: 'false',
          r2ProcessCompleted: 'true',
        },
      })
      logger.error('Error uploading file to Cloudflare R2', { fileName, error: error?.message || String(error) })
    }
  },
)

exports.updateFileDoc = onDocumentUpdated(
  { document: 'organizations/{orgId}/files/{docId}', timeoutSeconds: 180 },
  async (event) => {
    const change = event.data
    const orgId = event.params.orgId
    const docId = event.params.docId
    const before = change.before.data() || {}
    const after = change.after.data() || {}

    if (!isPdfFile(after) || !hasPublicationMeta(after))
      return

    const inputKey = getInputKey(after)
    if (!inputKey)
      return

    const previousInputKey = getInputKey(before)
    const previousRetryAt = Number(before?.edgeMediaRetryAt || before?.ccRetryAt) || 0
    const nextRetryAt = Number(after?.edgeMediaRetryAt || after?.ccRetryAt) || 0
    const retryRequested = nextRetryAt > 0 && nextRetryAt !== previousRetryAt
    const pdfReplaced = !!previousInputKey && previousInputKey !== inputKey
    const stateRemoved = !!before?.edgeMediaState && !after?.edgeMediaState
    const hasExistingState = !!after?.edgeMediaState
    const shouldStart = !hasExistingState || retryRequested || pdfReplaced || stateRemoved

    if (!shouldStart)
      return

    const fileRef = getFileRef(orgId, docId)
    const existingMeta = (after && typeof after.meta === 'object') ? after.meta : {}
    const fallbackDisplayName = String(after?.fileName || '').trim()

    await fileRef.set({
      ...((String(after?.name || '').trim() || !fallbackDisplayName) ? {} : { name: fallbackDisplayName }),
      meta: {
        ...existingMeta,
        cmsmedia: true,
        flipbook: true,
      },
      edgeMediaState: {
        id: null,
        status: 'queued',
        inputKey,
        outputPrefix: buildOutputPrefix(inputKey),
        errorMessage: '',
        processedPages: 0,
        pageCount: 0,
        outputs: {},
        stages: {
          uploaded: true,
          processing: false,
          finalized: false,
        },
      },
      totalPages: 0,
      pages: [],
      highResImages: [],
    }, { merge: true })

    try {
      const job = await startPublicationJob(orgId, docId, after)
      await fileRef.set({
        edgeMediaState: {
          ...job,
          id: job.id || null,
          status: job.status || 'queued',
          inputKey: job.inputKey || inputKey,
          outputPrefix: buildOutputPrefix(inputKey),
          resolvedOutputPrefix: job.resolvedOutputPrefix || '',
          errorMessage: '',
          processedPages: Number(job.processedPages) || 0,
          pageCount: Number(job.pageCount) || 0,
          outputs: job.outputs || {},
          stages: {
            uploaded: true,
            processing: false,
            finalized: false,
          },
        },
      }, { merge: true })
    }
    catch (error) {
      logger.error('Edge Media publication job creation failed', { orgId, docId, error: error?.message || String(error) })
      await fileRef.set({
        edgeMediaState: {
          status: 'failed',
          errorMessage: error?.message || 'Edge Media publication job creation failed.',
        },
      }, { merge: true })
    }
  },
)

exports.retryImageUpload = onDocumentUpdated(
  { document: 'organizations/{orgId}/files/{docId}', timeoutSeconds: 180 },
  async (event) => {
    const before = event.data.before.data() || {}
    const after = event.data.after.data() || {}
    const retryRequested = after.retryImages && before.retryImages !== after.retryImages
    if (!retryRequested)
      return

    const orgId = event.params.orgId
    const docId = event.params.docId
    const docRef = getFileRef(orgId, docId)
    const r2FilePath = String(after.r2FilePath || '').trim()
    const r2URL = String(after.r2URL || after.r2Url || '').trim()

    if (!isImageFileData(after) || !r2FilePath) {
      await docRef.set({
        retryImages: false,
        edgeMediaImageState: {
          ...((after.edgeMediaImageState && typeof after.edgeMediaImageState === 'object') ? after.edgeMediaImageState : {}),
          status: 'failed',
          errorMessage: 'Retry requires an image file document with r2FilePath.',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true })
      return
    }

    try {
      await docRef.set({
        edgeMediaImageState: {
          ...((after.edgeMediaImageState && typeof after.edgeMediaImageState === 'object') ? after.edgeMediaImageState : {}),
          status: 'processing',
          r2Path: r2FilePath,
          retryRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          errorMessage: '',
        },
      }, { merge: true })

      const job = await startImageJob({ organization: orgId, fileDocId: docId, r2Path: r2FilePath })
      await docRef.set({
        retryImages: false,
        ...buildImageStateUpdate(job, r2FilePath, normalizeImageJob(job, r2FilePath).status),
      }, { merge: true })

      if (after.filePath) {
        const bucket = admin.storage().bucket()
        const fileRef = bucket.file(after.filePath)
        const [exists] = await fileRef.exists()
        if (exists) {
          const [metadata] = await fileRef.getMetadata()
          await fileRef.setMetadata(buildStorageMetadata(metadata?.metadata || {}, job, r2FilePath, r2URL))
        }
      }
    }
    catch (error) {
      await docRef.set({
        retryImages: false,
        edgeMediaImageState: {
          ...((after.edgeMediaImageState && typeof after.edgeMediaImageState === 'object') ? after.edgeMediaImageState : {}),
          status: 'failed',
          r2Path: r2FilePath,
          errorMessage: error?.message || String(error),
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true })
      logger.error('Edge Media image retry failed', {
        orgId,
        docId,
        r2FilePath,
        error: error?.message || String(error),
      })
    }
  },
)

exports.importLegacyPublications = onSchedule(
  { schedule: 'every 15 minutes', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    const migrationRef = db.collection('_cms-migrations').doc(LEGACY_IMPORT_MIGRATION_ID)
    const migrationSnap = await migrationRef.get()
    const migration = migrationSnap.data() || {}
    if (migration.status === 'complete')
      return

    const hasConfiguredBatchSize = Number.isFinite(EDGE_MEDIA_LEGACY_IMPORT_BATCH_SIZE) && EDGE_MEDIA_LEGACY_IMPORT_BATCH_SIZE > 0
    const batchSize = hasConfiguredBatchSize
      ? EDGE_MEDIA_LEGACY_IMPORT_BATCH_SIZE
      : 25
    const snapshot = await db.collectionGroup('files')
      .where('ccState.status', '==', 'complete')
      .get()

    const docs = snapshot.docs
      .sort((left, right) => left.ref.path.localeCompare(right.ref.path))
      .filter((doc) => {
        const fileData = doc.data() || {}
        return !String(fileData?.edgeMediaState?.id || '').trim()
          && isPdfFile(fileData)
          && hasPublicationMeta(fileData)
          && !!getInputKey(fileData)
          && buildLegacyImportPages(fileData).length > 0
      })
      .slice(0, batchSize)

    if (!docs.length) {
      await migrationRef.set({
        status: 'complete',
        completedAt: Firestore.FieldValue.serverTimestamp(),
        updatedAt: Firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      logger.info('Edge Media legacy publication import completed', { migrationId: LEGACY_IMPORT_MIGRATION_ID })
      return
    }

    await migrationRef.set({
      status: 'running',
      startedAt: migration.startedAt || Firestore.FieldValue.serverTimestamp(),
      updatedAt: Firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const doc of docs) {
      const fileData = doc.data() || {}
      const orgId = doc.ref.parent.parent?.id || ''
      const docId = doc.id
      const inputKey = getInputKey(fileData)
      const pages = buildLegacyImportPages(fileData)
      const baseMigrationUpdate = {
        status: 'running',
        lastFilePath: doc.ref.path,
        lastInputKey: inputKey,
        updatedAt: Firestore.FieldValue.serverTimestamp(),
      }

      if (!orgId) {
        skipped += 1
        await migrationRef.set({
          ...baseMigrationUpdate,
          skipped: Number(migration.skipped || 0) + skipped,
        }, { merge: true })
        continue
      }

      try {
        const job = await importLegacyPublicationJob(fileData)
        const outputs = job.outputs || {}
        const pageCount = Number(job.pageCount) || pages.length
        await doc.ref.set({
          edgeMediaState: {
            ...job,
            id: job.id || null,
            status: 'complete',
            inputKey: job.inputKey || inputKey,
            resolvedOutputPrefix: job.resolvedOutputPrefix || '',
            pageCount,
            processedPages: Number(job.processedPages) || pageCount,
            outputs,
            errorMessage: '',
            importedFromLegacy: true,
            stages: {
              uploaded: true,
              processing: true,
              finalized: true,
            },
          },
          pages: buildPages(outputs),
          highResImages: buildHighResImages(outputs),
          totalPages: pageCount,
        }, { merge: true })

        sent += 1
        await migrationRef.set({
          ...baseMigrationUpdate,
          lastJobId: job.id || null,
          sent: Number(migration.sent || 0) + sent,
        }, { merge: true })
      }
      catch (error) {
        failed += 1
        await migrationRef.set({
          ...baseMigrationUpdate,
          failed: Number(migration.failed || 0) + failed,
          lastError: {
            filePath: doc.ref.path,
            message: error?.message || String(error),
          },
        }, { merge: true })
        logger.error('Edge Media legacy publication import failed', {
          orgId,
          docId,
          inputKey,
          error: error?.message || String(error),
        })
      }
    }

    await migrationRef.set({
      status: docs.length < batchSize ? 'complete' : 'running',
      sent: Number(migration.sent || 0) + sent,
      skipped: Number(migration.skipped || 0) + skipped,
      failed: Number(migration.failed || 0) + failed,
      completedAt: docs.length < batchSize ? Firestore.FieldValue.serverTimestamp() : null,
      updatedAt: Firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    logger.info('Edge Media legacy publication import run completed', {
      migrationId: LEGACY_IMPORT_MIGRATION_ID,
      sent,
      skipped,
      failed,
      processed: docs.length,
    })
  },
)

const handlePublicationWebhook = async ({ organization, fileDocId, eventData, res }) => {
  const eventName = String(eventData.event || '').trim()
  const status = String(eventData.status || '').trim().toLowerCase()
  const fileRef = getFileRef(organization, fileDocId)
  const fileSnap = await fileRef.get()
  const fileData = fileSnap.data() || {}
  const existingState = fileData.edgeMediaState || {}
  const payloadPageCount = Number(eventData.pageCount)
  const payloadProcessedPages = Number(eventData.processedPages)
  const pageCount = (Number.isFinite(payloadPageCount) && payloadPageCount > 0)
    ? payloadPageCount
    : (Number(existingState.pageCount) || 0)
  const processedPages = (Number.isFinite(payloadProcessedPages) && payloadProcessedPages >= 0)
    ? payloadProcessedPages
    : (Number(existingState.processedPages) || 0)

  if (eventName === 'processing_started') {
    await fileRef.set({
      edgeMediaState: {
        id: eventData.id || existingState.id || null,
        status: status || 'processing',
        inputKey: eventData.inputKey || existingState.inputKey || '',
        resolvedOutputPrefix: eventData.resolvedOutputPrefix || existingState.resolvedOutputPrefix || '',
        pageCount,
        processedPages,
        errorMessage: '',
        stages: {
          uploaded: true,
          processing: true,
          finalized: false,
        },
      },
    }, { merge: true })
    res.status(200).send('OK')
    return
  }

  if (eventName === 'page_complete') {
    const pageKey = String(eventData.pageKey || '').trim()
    if (!pageKey || !eventData.output) {
      res.status(400).send('Missing page output.')
      return
    }
    const outputs = mergeOutputs(existingState.outputs, { [pageKey]: eventData.output })
    const outputProcessedPages = Object.keys(outputs).filter(key => /^page-\d+$/i.test(key)).length
    await fileRef.set({
      edgeMediaState: {
        id: eventData.id || existingState.id || null,
        status: status || 'processing',
        pageCount,
        processedPages: processedPages || outputProcessedPages,
        outputs,
        errorMessage: '',
        stages: {
          uploaded: true,
          processing: true,
          finalized: false,
        },
      },
    }, { merge: true })
    res.status(200).send('OK')
    return
  }

  if (eventName === 'complete') {
    const outputs = mergeOutputs(existingState.outputs, eventData.outputs)
    const pages = buildPages(outputs)
    const highResImages = buildHighResImages(outputs)
    const completePageCount = pageCount || pages.length
    const currentSlug = String(fileData.slug || '').trim()
    const slug = currentSlug || await generateSlug(organization, fileData.name || fileData.fileName || fileDocId, fileDocId)

    await fileRef.set({
      slug,
      pageEffect: fileData?.pageEffect || 'flip',
      pages,
      highResImages,
      totalPages: completePageCount,
      edgeMediaState: {
        id: eventData.id || existingState.id || null,
        status: 'complete',
        resolvedOutputPrefix: eventData.resolvedOutputPrefix || existingState.resolvedOutputPrefix || '',
        pageCount: completePageCount,
        processedPages: processedPages || pages.length,
        outputs,
        errorMessage: '',
        stages: {
          uploaded: true,
          processing: true,
          finalized: true,
        },
      },
    }, { merge: true })
    res.status(200).send('OK')
    return
  }

  if (eventName === 'failed') {
    await fileRef.set({
      edgeMediaState: {
        id: eventData.id || existingState.id || null,
        status: 'failed',
        errorMessage: eventData?.error?.message || 'Edge Media conversion failed.',
        error: eventData.error || null,
        stages: {
          uploaded: true,
          processing: false,
          finalized: false,
        },
      },
    }, { merge: true })
    res.status(200).send('OK')
    return
  }

  await fileRef.set({
    edgeMediaState: {
      id: eventData.id || existingState.id || null,
      status: status || eventName || 'processing',
      pageCount,
      processedPages,
    },
  }, { merge: true })
  res.status(200).send('OK')
}

exports.mediaWebhook = onRequest({ timeoutSeconds: 180 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed.')
    return
  }

  const organization = String(req.query.organization || req.body?.organization || '').trim()
  const fileDocId = String(req.query.fileDocId || req.body?.fileDocId || '').trim()
  if (!organization || !fileDocId) {
    res.status(400).send('Missing organization or fileDocId.')
    return
  }

  const eventData = req.body || {}
  const webhookType = String(req.query.type || eventData.type || '').trim().toLowerCase()
  const status = String(eventData.status || eventData.event || eventData.type || '').toLowerCase()
  const job = eventData.job || eventData.result || eventData
  const normalized = normalizeImageJob(job, eventData.r2Path || job.inputKey || '')
  const docRef = getFileRef(organization, fileDocId)

  try {
    if (webhookType === 'publication') {
      await handlePublicationWebhook({ organization, fileDocId, eventData, res })
      return
    }

    if (status === 'processing_started' || status === 'processing' || status === 'queued') {
      await docRef.set(buildImageStateUpdate(job, normalized.r2Path, status === 'processing_started' ? 'processing' : status), { merge: true })
      res.status(200).send('OK')
      return
    }

    if (status === 'complete' || status === 'completed') {
      await docRef.set(buildCompletedImageUpdate(job, normalized.r2Path), { merge: true })
      const docSnap = await docRef.get()
      const fileData = docSnap.data() || {}
      if (fileData.filePath) {
        const fileRef = admin.storage().bucket().file(fileData.filePath)
        const [exists] = await fileRef.exists()
        if (exists) {
          const [metadata] = await fileRef.getMetadata()
          await fileRef.setMetadata(buildCompletedStorageMetadata(
            metadata?.metadata || {},
            job,
            normalized.r2Path,
            fileData.r2URL || fileData.r2Url || '',
          ))
        }
      }
      res.status(200).send('OK')
      return
    }

    if (status === 'failed' || status === 'error') {
      await docRef.set({
        retryImages: false,
        edgeMediaImageState: {
          id: normalized.id,
          type: 'image',
          status: 'failed',
          r2Path: normalized.r2Path,
          inputKey: normalized.inputKey,
          errorMessage: eventData.error?.message || eventData.message || 'Edge Media image processing failed.',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true })
      res.status(200).send('OK')
      return
    }

    res.status(400).send('Unsupported webhook event.')
  }
  catch (error) {
    logger.error('Edge Media image webhook failed', {
      organization,
      fileDocId,
      status,
      error: error?.message || String(error),
    })
    res.status(500).send('Webhook failed.')
  }
})

exports.uploadDocumentDeleted = onDocumentDeleted(
  { document: 'organizations/{orgId}/files/{docId}', timeoutSeconds: 180 },
  async (event) => {
    const fileData = event.data.data() || {}
    const imageJobId = String(fileData?.edgeMediaImageState?.id || '').trim()
    const publicationJobId = String(fileData?.edgeMediaState?.id || '').trim()
    const legacyImageId = String(fileData?.cloudflareImageId || '').trim()
    const videoId = String(fileData?.cloudflareVideoId || '').trim()

    if (publicationJobId)
      await deleteEdgeMediaJob(publicationJobId)

    if (imageJobId) {
      await deleteEdgeMediaJob(imageJobId)
    }
    else if (legacyImageId) {
      await deleteCloudflareImage(legacyImageId)
    }

    if (videoId)
      await deleteCloudflareVideo(videoId)
  },
)

exports.fileDeleted = onObjectDeleted(
  { region: process.env.FIREBASE_STORAGE_BUCKET_REGION },
  async (event) => {
    const fileBucket = event.data.bucket
    const filePath = event.data.name

    if (fileBucket && filePath) {
      const [replacementExists] = await admin.storage().bucket(fileBucket).file(filePath).exists()
      if (replacementExists) {
        logger.info('Skipping stale R2 delete cleanup because a replacement object already exists', { filePath })
        return
      }
    }

    const toR2 = event.data.metadata?.toR2
    if (!toR2 || event.data.metadata?.r2ProcessCompleted !== 'true')
      return

    await deleteR2File(event.data.metadata?.r2FilePath)
  },
)
