const AWS = require('aws-sdk')
const fetch = require('node-fetch')

const { admin, db, logger, onDocumentDeleted, onDocumentUpdated, onObjectDeleted, onObjectFinalized, onRequest } = require('./config.js')

const EDGE_MEDIA_API_URL = String(process.env.EDGE_MEDIA_API_URL || 'https://edge-media-api.edge-marketing.workers.dev').replace(/\/+$/, '')
const EDGE_MEDIA_API_KEY = String(process.env.EDGE_MEDIA_API_KEY || '').trim()

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

const getWebhookUrl = (organization, fileDocId) => {
  const webhookBase = String(process.env.FIREBASE_WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!webhookBase)
    throw new Error('Missing FIREBASE_WEBHOOK_BASE_URL.')

  return `${webhookBase}/api/edge-media?organization=${encodeURIComponent(organization)}&fileDocId=${encodeURIComponent(fileDocId)}&type=image`
}

const getFileRef = (organization, fileDocId) => {
  return db.collection('organizations').doc(organization).collection('files').doc(fileDocId)
}

const normalizeImageJob = (job = {}, r2Path = '') => {
  const result = job.result || job
  const meta = result.meta || job.meta || {}
  const variants = result.variants || []
  const responseId = result.id || job.id || null
  const isImageJob = result.type === 'image' || job.type === 'image'
  const jobId = meta.jobId || result.jobId || job.jobId || (isImageJob ? responseId : null)
  const cloudflareImageId = result.cloudflareImageId || (variants.length ? result.id : '')
  return {
    id: jobId,
    type: result.type || job.type || 'image',
    status: result.status || job.status || 'queued',
    r2Path: result.inputKey || result.r2Path || meta.r2Path || meta.inputKey || r2Path,
    inputKey: result.inputKey || meta.inputKey || r2Path,
    sourceType: result.sourceType || meta.uploadType || '',
    bucket: result.bucket || meta.inputBucket || 'files',
    resolvedOutputPrefix: result.resolvedOutputPrefix || '',
    outputs: result.outputs || {},
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
  const status = String(eventData.status || eventData.event || eventData.type || '').toLowerCase()
  const job = eventData.job || eventData.result || eventData
  const normalized = normalizeImageJob(job, eventData.r2Path || job.inputKey || '')
  const docRef = getFileRef(organization, fileDocId)

  try {
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
    const legacyImageId = String(fileData?.cloudflareImageId || '').trim()
    const videoId = String(fileData?.cloudflareVideoId || '').trim()

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
