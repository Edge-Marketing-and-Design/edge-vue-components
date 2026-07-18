const { db, Firestore, logger } = require('../config.js')

async function bumpPublishedSiteVersionsForTheme({ orgId, themeId }) {
  const orgRef = db.collection('organizations').doc(orgId)
  const publishedSites = await orgRef.collection('published-site-settings')
    .where('theme', '==', themeId)
    .get()

  if (publishedSites.empty)
    return 0

  let batch = db.batch()
  let operationCount = 0
  let updatedSiteCount = 0

  for (const publishedSite of publishedSites.docs) {
    const versionUpdate = { version: Firestore.FieldValue.increment(1) }
    batch.set(publishedSite.ref, versionUpdate, { merge: true })
    batch.set(orgRef.collection('sites').doc(publishedSite.id), versionUpdate, { merge: true })
    operationCount += 2
    updatedSiteCount += 1

    if (operationCount >= 400) {
      await batch.commit()
      batch = db.batch()
      operationCount = 0
    }
  }

  if (operationCount > 0)
    await batch.commit()

  return updatedSiteCount
}

async function runKvMirrorFollowup(operation) {
  const op = String(operation?.op || '')
  if (!op)
    return null

  if (op === 'bumpPublishedSiteVersionsForTheme') {
    const orgId = String(operation?.orgId || '').trim()
    const themeId = String(operation?.themeId || '').trim()
    if (!orgId || !themeId)
      throw new Error('Invalid theme site-version follow-up')
    const updatedSiteCount = await bumpPublishedSiteVersionsForTheme({ orgId, themeId })
    logger.log('Theme mirror site version bump complete', { orgId, themeId, updatedSiteCount })
    return updatedSiteCount
  }

  throw new Error(`Unsupported KV mirror follow-up operation: ${op}`)
}

module.exports = { runKvMirrorFollowup }
