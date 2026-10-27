const clean = value => String(value || '').trim()

async function verifyHistoryIdentity(payload, verifyIdToken) {
  const claimedUid = clean(payload.userId)
  const token = clean(payload.firebaseIdToken)
  if (!token) {
    if (claimedUid)
      throw Object.assign(new Error('A sign-in token is required for identified history.'), { status: 401 })
    return null
  }
  let decoded
  try {
    decoded = await verifyIdToken(token)
  }
  catch {
    throw Object.assign(new Error('Invalid sign-in token.'), { status: 401 })
  }
  const uid = clean(decoded.uid || decoded.sub)
  const email = clean(decoded.email).toLowerCase()
  if (!uid || !email.includes('@') || (claimedUid && uid !== claimedUid))
    throw Object.assign(new Error('Sign-in identity does not match the history request.'), { status: 401 })
  return { uid, email }
}

// The authenticated principal, not a browser's localStorage value, owns a
// signed-in history segment. Anonymous segments can be claimed on first login.
async function appendIdentityHistory({ db, historyRef, audienceRef, uuid, oldUuid, identity, action, data, base, now }) {
  const proposedRef = uuid ? historyRef.doc(uuid) : historyRef.doc()
  const freshRef = historyRef.doc()
  const actionId = historyRef.doc().id
  let selectedRef
  await db.runTransaction(async (transaction) => {
    let ref = proposedRef
    if (oldUuid) {
      const legacy = await transaction.get(historyRef.where('oldUuids', 'array-contains', oldUuid).limit(1))
      if (!legacy.empty)
        ref = legacy.docs[0].ref
    }
    const snapshot = await transaction.get(ref)
    const previous = snapshot.exists ? snapshot.data() : {}
    let owner = clean(previous.identityUserId)
    let ambiguous = false
    if ((uuid || oldUuid) && previous.identityVersion !== 1 && audienceRef) {
      const legacyOwners = await transaction.get(audienceRef.where('history_uuid', 'array-contains', ref.id).limit(2))
      ambiguous = legacyOwners.size > 1
      owner = clean(legacyOwners.docs[0]?.data()?.userId || legacyOwners.docs[0]?.data()?.authUid)
    }
    const rotate = ambiguous || Boolean(owner && owner !== clean(identity?.uid))
    if (rotate)
      ref = freshRef
    const update = {
      ...base,
      updatedAt: now,
      lastActionAt: now,
      lastAction: action,
      lastData: data,
      identityVersion: 1,
      identityUserId: identity?.uid || '',
    }
    if (!snapshot.exists || rotate) {
      update.createdAt = now
      update.firstActionAt = now
    }
    if (oldUuid && !rotate)
      update.oldUuids = (previous.oldUuids || []).includes(oldUuid) ? previous.oldUuids : [...(previous.oldUuids || []), oldUuid]
    const authenticated = identity ? { authenticatedUserId: identity.uid, authenticatedEmail: identity.email } : {}
    transaction.set(ref, update, { merge: true })
    transaction.set(ref.collection('actions').doc(actionId), { action, data, timestamp: now, ...authenticated })
    selectedRef = ref
  })
  return selectedRef
}

module.exports = { verifyHistoryIdentity, appendIdentityHistory }
