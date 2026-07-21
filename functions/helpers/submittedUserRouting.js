const normalizeEmail = (value) => {
  const email = String(value || '').trim().toLowerCase()
  return (email.includes('@') && !email.includes('/')) ? email : ''
}

const normalizeUserId = value => String(value || '').trim()

const getNamedValue = (source, fieldName) => {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return ''
  const key = Object.keys(source).find(item => item.toLowerCase() === fieldName.toLowerCase())
  return key ? source[key] : ''
}

const getSubmittedUserId = (data) => {
  const direct = normalizeUserId(getNamedValue(data, 'userId'))
  if (direct)
    return direct

  for (const containerName of ['fields', 'formFields', 'formData']) {
    const container = getNamedValue(data, containerName)
    const objectValue = normalizeUserId(getNamedValue(container, 'userId'))
    if (objectValue)
      return objectValue
    if (!Array.isArray(container))
      continue
    for (const field of container) {
      const name = normalizeUserId(field?.field || field?.name || field?.fieldName || field?.key)
      if (name.toLowerCase() !== 'userid')
        continue
      const value = normalizeUserId(field?.value ?? field?.fieldValue ?? field?.val)
      if (value)
        return value
    }
  }
  return ''
}

const findUserByRegisteredId = async (collectionRef, userId) => {
  const snapshot = await collectionRef.where('userId', '==', userId).limit(1).get()
  if (snapshot.empty)
    return null
  const doc = snapshot.docs[0]
  return { docId: doc.id, ...(doc.data() || {}) }
}

const resolveSubmittedUserRouting = async ({ db, orgId, data }) => {
  const normalizedOrgId = String(orgId || '').trim()
  const userId = getSubmittedUserId(data)
  if (!normalizedOrgId || !userId)
    return null

  const orgUser = await findUserByRegisteredId(
    db.collection('organizations').doc(normalizedOrgId).collection('users'),
    userId,
  )
  if (!orgUser)
    return null

  const rootUser = await findUserByRegisteredId(db.collection('users'), userId)
  const meta = (rootUser?.meta && typeof rootUser.meta === 'object') ? rootUser.meta : {}
  const email = normalizeEmail(meta.contactEmail) || normalizeEmail(meta.email)
  if (!email)
    return null

  return {
    userId,
    email,
    orgUserDocId: orgUser.docId,
    rootUserDocId: rootUser.docId,
  }
}

module.exports = {
  getSubmittedUserId,
  normalizeEmail,
  resolveSubmittedUserRouting,
}
