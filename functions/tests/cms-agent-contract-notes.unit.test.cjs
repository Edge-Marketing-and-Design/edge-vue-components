const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { existsSync } = require('node:fs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')
const { createFakeDb } = require('./support/fakeFirestore.cjs')

class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const setup = ({ developers = ['dev'] } = {}) => {
  const fake = createFakeDb({})
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const modulePath = require.resolve(path.join(functionRoot, 'cmsAgentContractNotes.js'))
  const original = require.cache[configPath]
  require.cache[configPath] = {
    id: configPath,
    loaded: true,
    exports: {
      db: fake.db,
      HttpsError,
      onCall: (_options, handler) => handler,
      permissionCheck: async (uid, _action, collectionPath) => collectionPath === 'agent-contract-notes' && developers.includes(uid),
    },
  }
  delete require.cache[modulePath]
  const notes = require(modulePath)
  delete require.cache[modulePath]
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]
  return { ...fake, notes }
}
const call = (handler, data = {}, uid = 'dev') => handler({ auth: { uid }, data: { uid, ...data } })

test('notes are for signed-in developers with access to the collection', async () => {
  const env = setup()
  for (const name of ['listAgentContractNotes', 'setAgentContractNote', 'clearAgentContractNote']) {
    await assert.rejects(env.notes[name]({ data: {} }), { code: 'unauthenticated' }, name)
    await assert.rejects(env.notes[name]({ auth: { uid: 'dev' }, data: { uid: 'other' } }), { code: 'permission-denied' }, name)
    await assert.rejects(call(env.notes[name], { key: 'problem:theme.live', text: 'x' }, 'editor'), { code: 'permission-denied' }, name)
  }
  assert.equal(env.writes.length, 0)
})

test('a note must name a real operation, input or problem code, with text up to the limit', async () => {
  const env = setup()
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  await assert.rejects(call(env.notes.setAgentContractNote, { key: 'problem:not-a-code', text: 'x' }), { code: 'invalid-argument' })
  await assert.rejects(call(env.notes.setAgentContractNote, { key: 'field:page.setValues.nope', text: 'x' }), { code: 'invalid-argument' })
  await assert.rejects(call(env.notes.setAgentContractNote, { key: 'problem:theme.live', text: '  ' }), { code: 'invalid-argument' })
  await assert.rejects(call(env.notes.setAgentContractNote, { key: 'problem:theme.live', text: 'x'.repeat(core.CONTRACT_NOTE_MAX + 1) }), { code: 'invalid-argument' })
  assert.equal(env.writes.length, 0)
  const listed = await call(env.notes.listAgentContractNotes)
  assert.equal(listed.defaults['problem:theme.live'], core.CMS_OPERATION_PROBLEMS['theme.live'])
  assert.equal(listed.defaults['operation:page.setValues'], core.CMS_OPERATION_SPECS['page.setValues'].summary)
  assert.ok('field:page.setValues.replace' in listed.defaults)
  assert.deepEqual(listed.notes, [])
})

test('setting and clearing keep earlier versions, and the served contract uses the current note', async () => {
  const env = setup()
  const core = await import(path.join(functionRoot, 'helpers/cmsOperations.mjs'))
  const key = 'problem:theme.live'
  await call(env.notes.setAgentContractNote, { key, text: ' Propose it instead. ' })
  await call(env.notes.setAgentContractNote, { key, text: 'Use theme.propose; a person applies it in the theme editor.' }, 'dev')
  let stored = env.docs.get(`agent-contract-notes/${key}`)
  assert.equal(stored.text, 'Use theme.propose; a person applies it in the theme editor.')
  assert.equal(stored.updatedBy, 'dev')
  assert.deepEqual(stored.history.map(entry => entry.text), ['Propose it instead.'])

  const served = await env.notes.readContractNotes()
  assert.deepEqual(served, { [key]: stored.text })
  const markdown = core.withGeneratedOperations(core.OPERATIONS_CONTRACT_MARKER, served)
  assert.ok(markdown.includes('| `theme.live` | Use theme.propose; a person applies it in the theme editor. |'))
  assert.ok(!markdown.includes(core.CMS_OPERATION_PROBLEMS['theme.live']))

  await call(env.notes.clearAgentContractNote, { key })
  stored = env.docs.get(`agent-contract-notes/${key}`)
  assert.equal(stored.text, null)
  assert.equal(stored.history.length, 2)
  assert.deepEqual(await env.notes.readContractNotes(), {}, 'a cleared note falls back to the default')
  await assert.rejects(call(env.notes.clearAgentContractNote, { key }), { code: 'not-found' })
})

test('the contract reader caches notes for a minute, and a change on this instance refreshes it', async () => {
  const env = setup()
  const now = Date.now()
  assert.deepEqual(await env.notes.readContractNotes({ now }), {})
  env.docs.set('agent-contract-notes/problem:move.no-change', { text: 'Already there.' })
  assert.deepEqual(await env.notes.readContractNotes({ now: now + 1000 }), {}, 'cached')
  assert.deepEqual(await env.notes.readContractNotes({ now: now + 61000 }), { 'problem:move.no-change': 'Already there.' })
  await call(env.notes.setAgentContractNote, { key: 'operation:page.moveBlock', text: 'Reorder rows.' })
  assert.equal((await env.notes.readContractNotes({ now: now + 62000 }))['operation:page.moveBlock'], 'Reorder rows.')
})
