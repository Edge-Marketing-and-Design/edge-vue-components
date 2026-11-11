const { createHash, randomUUID } = require('node:crypto')
const { runSiteResolution, servedHosts, siteResolutionDisabled } = require('./siteResolution')

const PENDING_COLLECTION = 'cms-site-resolution-pending'
const QUIET_MS = 3000
const RETRY_MS = 60_000
const MAX_BATCH = 10
const START_BUDGET_MS = 90_000

async function enqueueSiteResolution({ db, arrayUnion, orgId, siteId, touchedHosts = [], now = Date.now }) {
  if (!orgId || !siteId || [orgId, siteId].some(id => /[/:]/.test(id)))
    throw new Error('Invalid site resolution identity.')
  const key = createHash('sha256').update(`sites:${orgId}:${siteId}`).digest('hex')
  const hosts = [...new Set(touchedHosts.flatMap(servedHosts))]
  await db.doc(`${PENDING_COLLECTION}/${key}`).set({
    orgId,
    siteId,
    generation: randomUUID(),
    readyAt: now() + QUIET_MS,
    ...(hosts.length ? { touchedHosts: arrayUnion(...hosts) } : {}),
  }, { merge: true })
}

// The worker may have reconciled a generation that was replaced while it ran.
// Never clear or delay a newer request, including its hostname cleanup hints.
async function settle(db, ref, generation, nextReadyAt) {
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.generation !== generation) return
    if (nextReadyAt === undefined) tx.delete(ref)
    else tx.update(ref, { readyAt: nextReadyAt })
  })
}

async function drainPendingSiteResolutions({ db, reconcile, logger, now = Date.now }) {
  const startedAt = now()
  const pending = await db.collection(PENDING_COLLECTION)
    .where('readyAt', '<=', startedAt).orderBy('readyAt').limit(MAX_BATCH).get()
  const result = { completed: 0, deferred: 0, failed: 0 }
  for (const queued of pending.docs) {
    if (now() - startedAt >= START_BUDGET_MS) break
    const request = (await queued.ref.get()).data()
    if (!request || request.readyAt > now()) continue
    const { orgId, siteId, touchedHosts = [], generation } = request
    try {
      const outcome = await reconcile({ orgId, siteId, touchedHosts })
      if (outcome?.disabled) break
    }
    catch (error) {
      if (error?.code === 'site-resolution-busy') {
        // The lease is global, so other sites cannot make progress either.
        result.deferred++
        break
      }
      if (error?.code === 'site-resolution-superseded') {
        result.deferred++
        continue
      }
      result.failed++
      logger.error('Site resolution reconciliation failed', {
        orgId, siteId, code: error?.code || null, status: error?.response?.status || null,
      })
      await settle(db, queued.ref, generation, now() + RETRY_MS)
      continue
    }
    await settle(db, queued.ref, generation)
    result.completed++
  }
  return result
}

async function requestSiteResolution(options) {
  if (siteResolutionDisabled()) return
  const { db, Firestore } = require('../config.js')
  await enqueueSiteResolution({ ...options, db, arrayUnion: (...hosts) => Firestore.FieldValue.arrayUnion(...hosts) })
}

async function runPendingSiteResolutions() {
  if (siteResolutionDisabled()) return
  const { db, logger } = require('../config.js')
  return drainPendingSiteResolutions({ db, logger, reconcile: runSiteResolution })
}

module.exports = { enqueueSiteResolution, drainPendingSiteResolutions, requestSiteResolution, runPendingSiteResolutions, PENDING_COLLECTION, QUIET_MS }
