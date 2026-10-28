// Explanation overrides for the generated operations contract
// (docs/features/cms/agent-contracts-design.md, phase 3). Each note replaces
// one piece of default text from CMS_OPERATION_SPECS: an operation's summary
// (`operation:<type>`), an input's note (`field:<type>.<input>`) or a problem
// code's explanation (`problem:<code>`). Notes change wording only; the checks
// never read them. cms_contract applies them when it serves the contract.
//
// Stored in the top-level agent-contract-notes collection, which only the
// Functions and people with a role on it (root admins) can write under the
// generic rules. Each note keeps its last 10 versions.
// Keep identical in functions/.
const { db, onCall, HttpsError, permissionCheck } = require('./config.js')

const NOTES = 'agent-contract-notes'
const HISTORY = 10
// cms_contract reads notes at most this often per instance.
const CACHE_MS = 60 * 1000

const corePromise = import('./helpers/cmsOperations.mjs')
let cache = null

const assertCaller = (request) => {
  if (!request.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
  return request.auth.uid
}
const assertAllowed = async (uid, action) => {
  if (!await permissionCheck(uid, action, NOTES))
    throw new HttpsError('permission-denied', 'Only developers with access to agent contract notes can do this.')
}

// { key: text } for every note with text, for cms_contract.
const readContractNotes = async ({ now = Date.now() } = {}) => {
  if (cache && now - cache.at < CACHE_MS)
    return cache.notes
  const snapshot = await db.collection(NOTES).get()
  const notes = {}
  for (const doc of snapshot.docs) {
    const text = doc.data()?.text
    if (typeof text === 'string' && text.trim())
      notes[doc.id] = text.trim()
  }
  cache = { at: now, notes }
  return notes
}

// Every overridable key with its default text, and the notes that override them.
exports.listAgentContractNotes = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  await assertAllowed(uid, 'read')
  const core = await corePromise
  const snapshot = await db.collection(NOTES).get()
  const notes = snapshot.docs.map(doc => ({ key: doc.id, ...doc.data() }))
  return { defaults: core.contractNoteDefaults(), notes }
})

// Sets (text) or clears (text null) one note, keeping the previous version.
const writeNote = async (uid, key, text) => {
  const ref = db.collection(NOTES).doc(key)
  const at = new Date().toISOString()
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const current = snap.exists ? snap.data() : null
    const previous = (current && typeof current.text === 'string') ? [{ text: current.text, updatedBy: current.updatedBy || null, updatedAt: current.updatedAt || null }] : []
    const history = [...previous, ...(Array.isArray(current?.history) ? current.history : [])].slice(0, HISTORY)
    transaction.set(ref, { key, text, updatedBy: uid, updatedAt: at, history })
  })
  cache = null
  return { key, text, updatedBy: uid, updatedAt: at }
}

exports.setAgentContractNote = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  await assertAllowed(uid, 'write')
  const core = await corePromise
  const key = typeof request.data.key === 'string' ? request.data.key.trim() : ''
  const problems = core.contractNoteProblems(key, request.data.text)
  if (problems.length)
    throw new HttpsError('invalid-argument', problems.join(' '))
  return writeNote(uid, key, request.data.text.trim())
})

exports.clearAgentContractNote = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = assertCaller(request)
  await assertAllowed(uid, 'write')
  const key = typeof request.data.key === 'string' ? request.data.key.trim() : ''
  const snap = (key && !key.includes('/')) ? await db.collection(NOTES).doc(key).get() : null
  if (!snap?.exists || typeof snap.data()?.text !== 'string')
    throw new HttpsError('not-found', `No note for "${key}".`)
  return writeNote(uid, key, null)
})

// For cms-agentMcp and tests.
exports.readContractNotes = readContractNotes
