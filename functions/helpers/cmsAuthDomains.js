const { randomUUID } = require('node:crypto')

const LEASE_MS = 240000 // Longer than the 180-second trigger timeout.
const REQUEST_TIMEOUT_MS = 20000
const sorted = values => [...new Set(values)].sort()
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))

// The registry is the current source of truth. Event domains only identify
// cleanup candidates, never whether a hostname is still needed by another site.
async function reconcileMembershipAuthDomains({ db, axios, projectId, getAccessToken, expandDomains, touchedDomains = [], logger, context = {}, now = Date.now, owner = randomUUID() }) {
  if (!projectId) throw new Error('Missing Firebase project id for Auth domain reconciliation.')
  const stateRef = db.collection('cms-auth-domain-sync').doc(projectId)
  const lease = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef)
    const current = snapshot.data() || {}
    if (current.leaseOwner && Number(current.leaseExpiresAt) > now())
      throw new Error('Firebase Auth domain reconciliation is busy; retry this event.')
    const leaseExpiresAt = now() + LEASE_MS
    transaction.set(stateRef, { leaseOwner: owner, leaseExpiresAt }, { merge: true })
    return { previousDomains: Array.isArray(current.managedDomains) ? current.managedDomains : [] }
  })

  const checkLease = async (transaction) => {
    const snapshot = await transaction.get(stateRef)
    const state = snapshot.data() || {}
    if (state.leaseOwner !== owner || Number(state.leaseExpiresAt) <= now() + REQUEST_TIMEOUT_MS)
      throw new Error('Firebase Auth domain reconciliation lease expired or changed; retry this event.')
  }

  try {
    const token = await getAccessToken()
    const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`
    const options = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
    const response = await axios.get(url, options)
    const current = response?.data?.authorizedDomains
    if (!Array.isArray(current) || current.some(domain => typeof domain !== 'string' || !domain.trim()))
      throw new Error('Firebase Auth returned an invalid authorizedDomains list; refusing to replace it.')

    // Read after the API GET to avoid using a registry snapshot from before a
    // slow request. Another registry change will deliver/retry another event.
    const registry = await db.collection('domain-registry').get()
    const required = sorted(registry.docs.flatMap(doc => {
      const data = doc.data() || {}
      return data.authEnabled === true ? expandDomains([data.domain || doc.id]) : []
    }))
    const requiredSet = new Set(required)
    const candidates = new Set([...lease.previousDomains, ...expandDomains(touchedDomains)])
    const removed = sorted(current.filter(domain => candidates.has(domain) && !requiredSet.has(domain)))
    const added = required.filter(domain => !current.includes(domain))
    const next = sorted([...current.filter(domain => !removed.includes(domain)), ...required])

    await db.runTransaction(checkLease)
    if (!same(current, next))
      await axios.patch(`${url}?updateMask=authorizedDomains`, { authorizedDomains: next }, options)

    // Only record successful reconciliation; a failed/uncertain PATCH leaves
    // the previous management ledger intact so the retry can converge safely.
    await db.runTransaction(async transaction => {
      await checkLease(transaction)
      transaction.set(stateRef, { managedDomains: required, syncedAt: new Date(now()).toISOString() }, { merge: true })
    })
    if (added.length || removed.length)
      logger.log('Synced Firebase Auth authorized domains for memberships', { ...context, addedDomains: added, removedDomains: removed, totalAuthorizedDomains: next.length })
    return { ok: true, added, removed, total: next.length }
  }
  finally {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(stateRef)
      if (snapshot.data()?.leaseOwner === owner)
        transaction.set(stateRef, { leaseOwner: '', leaseExpiresAt: 0 }, { merge: true })
    })
  }
}

module.exports = { reconcileMembershipAuthDomains, LEASE_MS, REQUEST_TIMEOUT_MS }
