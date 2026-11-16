import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const kvMirrorSource = await readFile(new URL('../../functions/kv/kvMirror.js', import.meta.url), 'utf8')
const edgeKvMirrorSource = await readFile(new URL('../functions/kv/kvMirror.js', import.meta.url), 'utf8')
const retryWorkerSource = await readFile(new URL('../../functions/kv/kvRetryWorker.js', import.meta.url), 'utf8')
const edgeRetryWorkerSource = await readFile(new URL('../functions/kv/kvRetryWorker.js', import.meta.url), 'utf8')
const protocolSource = await readFile(new URL('../../functions/kv/kvMirrorProtocol.js', import.meta.url), 'utf8')
const edgeProtocolSource = await readFile(new URL('../functions/kv/kvMirrorProtocol.js', import.meta.url), 'utf8')
const followupSource = await readFile(new URL('../../functions/kv/kvMirrorFollowups.js', import.meta.url), 'utf8')
const edgeFollowupSource = await readFile(new URL('../functions/kv/kvMirrorFollowups.js', import.meta.url), 'utf8')

const loadCommonJs = ({ source, requires }) => {
  const module = { exports: {} }
  const context = vm.createContext({
    Buffer,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    console,
    module,
    exports: module.exports,
    process: { env: {} },
    require: (specifier) => {
      if (Object.prototype.hasOwnProperty.call(requires, specifier))
        return requires[specifier]
      throw new Error(`Unexpected require: ${specifier}`)
    },
  })
  vm.runInContext(source, context)
  return module.exports
}

const protocolExports = loadCommonJs({
  source: protocolSource,
  requires: {
    'node:crypto': {
      createHash,
      randomUUID: () => 'completion-generation',
    },
  },
})

const SOURCE_PATH = 'organizations/org-1/agents/agent-1'

const makeSnapshot = (exists, data = null, timestamp = '2026-07-17T12:00:00.000Z', path = SOURCE_PATH) => ({
  exists,
  data: () => data,
  ref: { path },
  updateTime: {
    toMillis: () => Date.parse(timestamp),
  },
})

const makeEvent = ({
  id = 'event-agent-1',
  before = makeSnapshot(false),
  after = makeSnapshot(true, { name: 'Agent' }),
} = {}) => ({
  id,
  params: { orgId: 'org-1', agentId: 'agent-1' },
  data: { before, after },
})

const makeMirrorHarness = ({ failIndexWrite = false, failFollowup = false, failCanonicalWrite = false, queueWriter } = {}) => {
  const operations = []
  const queued = []
  const followups = []
  let currentSnapshot = makeSnapshot(true, { name: 'Agent' })
  const logger = { log() {}, warn() {}, error() {} }
  const kv = {
    async get() {
      return null
    },
    async put(key, value, opts) {
      operations.push({ op: 'put', key, value, opts })
      if (failCanonicalWrite && key.startsWith('agents:'))
        throw new Error('socket hang up')
    },
    async putIndexMeta(key, metadata) {
      operations.push({ op: 'putIndexMeta', key, metadata })
      if (failIndexWrite)
        throw new Error('index write failed')
    },
    async del(key) {
      operations.push({ op: 'del', key })
    },
  }
  const db = {
    doc: () => ({ get: async () => currentSnapshot }),
    collection: collection => ({
      async add(value) {
        queued.push({ collection, value })
        if (queueWriter)
          await queueWriter(collection, value)
      },
    }),
  }
  const exports = loadCommonJs({
    source: kvMirrorSource,
    requires: {
      '../config.js': {
        onDocumentWritten: (_options, handler) => handler,
        db,
        Firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
        logger,
      },
      './kvClient': kv,
      './kvMirrorProtocol': protocolExports,
      './kvMirrorFollowups': {
        async runKvMirrorFollowup(operation) {
          followups.push(operation)
          if (failFollowup)
            throw new Error('follow-up failed')
        },
      },
    },
  })
  return {
    exports,
    followups,
    operations,
    queued,
    setCurrentSnapshot(value) {
      currentSnapshot = value
    },
  }
}

const flattenPhases = phases => Array.from(phases || []).flatMap(phase => Array.from(Array.isArray(phase) ? phase : phase.operations))

test('deployable and shared KV mirror protocol files remain identical', () => {
  assert.equal(kvMirrorSource, edgeKvMirrorSource)
  assert.equal(retryWorkerSource, edgeRetryWorkerSource)
  assert.equal(protocolSource, edgeProtocolSource)
  assert.equal(followupSource, edgeFollowupSource)
})

test('canonical keys resolve to organization and site collection scopes', () => {
  assert.equal(protocolExports.collectionScopeFromCanonicalKey('agents:org-1:agent-1'), 'agents:org-1')
  assert.equal(protocolExports.collectionScopeFromCanonicalKey('pages:org-1:site-1:page-1'), 'pages:org-1:site-1')
  assert.equal(protocolExports.collectionScopeFromCanonicalKey('invalid'), '')
})

test('collection generations use a bounded shard vector and completion generations', () => {
  const version = protocolExports.createCollectionVersionOperation({
    event: { id: 'event-new' },
    canonicalKey: 'agents:org-1:agent-1',
    deleted: false,
  })
  const materialized = protocolExports.materializeCollectionVersionOperation(version)

  assert.match(version.key, /^kv-version:agents:org-1:shard:\d{3}$/)
  assert.equal(version.op, 'putCollectionVersion')
  assert.equal(version.metadata.eventId, 'event-new')
  assert.equal(materialized.op, 'put')
  assert.match(materialized.opts.metadata.generation, /^event-new\.completion-generation$/)
  assert.ok(Number.isFinite(Date.parse(materialized.opts.metadata.changedAt)))

  const shardKeys = new Set(Array.from({ length: 128 }, (_, index) =>
    protocolExports.createCollectionVersionOperation({
      event: { id: `event-${index}` },
      canonicalKey: `agents:org-1:agent-${index}`,
      deleted: false,
    }).key))
  assert.ok(shardKeys.size > 32)
  assert.ok(shardKeys.size <= 64)
})

test('indexed mirrors publish their collection generation after record, index, and manifest writes', async () => {
  const harness = makeMirrorHarness()
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
    makeIndexKeys: ({ orgId, agentId }) => [`idx:agents:name:${orgId}:agent:${agentId}`],
    makeMetadata: data => ({ name: data.name }),
  })
  const event = makeEvent()
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.deepEqual(harness.operations.map(operation => operation.op), [
    'put',
    'putIndexMeta',
    'put',
    'put',
  ])
  assert.equal(harness.operations[0].key, 'agents:org-1:agent-1')
  assert.equal(harness.operations[1].key, 'idx:agents:name:org-1:agent:agent-1')
  assert.equal(harness.operations[2].key, 'idx:manifest:agents:org-1:agent-1')
  assert.match(harness.operations[3].key, /^kv-version:agents:org-1:shard:/)
  assert.deepEqual(harness.queued, [])
})

test('redacted fields are removed from canonical values, metadata, indexes, and follow-up planning', async () => {
  const harness = makeMirrorHarness()
  const sourceData = {
    name: 'Public Agent',
    privateNotes: 'private-note-value',
    meta: {
      publicLabel: 'Public label',
      internalEmail: 'private-email@example.com',
    },
    contacts: [
      {
        type: 'office',
        email: 'private-office@example.com',
        phone: '406-555-0100',
      },
      {
        email: 'private-secondary@example.com',
      },
    ],
    privateContainer: {
      secret: 'private-container-value',
    },
    existingEmpty: {},
  }
  let canonicalInput = null
  let metadataInput = null
  let indexInput = null
  let followupInput = null
  let followupEventInput = null
  let followupEventPrivateField = 'not-called'
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }, data) => {
      canonicalInput = data
      return `agents:${orgId}:${agentId}`
    },
    redactedFields: [
      'privateNotes',
      'meta.internalEmail',
      'contacts.email',
      'privateContainer.secret',
      'notPresent.secret',
    ],
    makeIndexKeys: ({ orgId, agentId }, data) => {
      indexInput = data
      return [
        `idx:agents:name:${orgId}:${data.name}:${agentId}`,
        data.privateNotes ? `idx:agents:private:${orgId}:${data.privateNotes}:${agentId}` : '',
        data.contacts?.[0]?.email ? `idx:agents:email:${orgId}:${data.contacts[0].email}:${agentId}` : '',
      ]
    },
    makeMetadata: (data) => {
      metadataInput = data
      return {
        name: data.name,
        privateNotes: data.privateNotes,
        meta: data.meta,
        contacts: data.contacts,
      }
    },
    makeAfterMirrorOperation: ({ event: followupEvent, data }) => {
      followupInput = data
      followupEventInput = followupEvent.data.after.data()
      followupEventPrivateField = followupEvent.data.after.get('privateNotes')
      return {
        op: 'observeRedactedData',
        data,
      }
    },
  })
  const event = makeEvent({
    after: makeSnapshot(true, sourceData),
  })
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.equal(canonicalInput, sourceData)
  for (const callbackInput of [metadataInput, indexInput, followupInput]) {
    assert.notEqual(callbackInput, sourceData)
    assert.equal(Object.hasOwn(callbackInput, 'privateNotes'), false)
    assert.equal(Object.hasOwn(callbackInput.meta, 'internalEmail'), false)
    assert.equal(Object.hasOwn(callbackInput.contacts[0], 'email'), false)
    assert.equal(Object.hasOwn(callbackInput.contacts[1], 'email'), false)
    assert.equal(Object.hasOwn(callbackInput, 'privateContainer'), false)
    assert.deepEqual(Object.keys(callbackInput.existingEmpty), [])
  }
  assert.equal(Object.hasOwn(followupEventInput, 'privateNotes'), false)
  assert.equal(Object.hasOwn(followupEventInput.meta, 'internalEmail'), false)
  assert.equal(followupEventPrivateField, undefined)

  const canonicalWrite = harness.operations.find(operation => operation.key === 'agents:org-1:agent-1')
  const canonicalValue = JSON.parse(canonicalWrite.value)
  assert.deepEqual(canonicalValue, {
    name: 'Public Agent',
    meta: {
      publicLabel: 'Public label',
    },
    contacts: [
      {
        type: 'office',
        phone: '406-555-0100',
      },
      {},
    ],
    existingEmpty: {},
  })
  assert.equal(Object.hasOwn(canonicalWrite.opts.metadata, 'privateNotes'), false)
  assert.equal(Object.hasOwn(canonicalWrite.opts.metadata.meta, 'internalEmail'), false)
  assert.equal(Object.hasOwn(canonicalWrite.opts.metadata.contacts[0], 'email'), false)
  assert.equal(harness.operations.some(operation => operation.key.includes('private-')), false)
  assert.equal(harness.followups[0].data.privateNotes, undefined)

  assert.equal(sourceData.privateNotes, 'private-note-value')
  assert.equal(sourceData.meta.internalEmail, 'private-email@example.com')
  assert.equal(sourceData.contacts[0].email, 'private-office@example.com')
  assert.equal(sourceData.contacts[1].email, 'private-secondary@example.com')
  assert.equal(sourceData.privateContainer.secret, 'private-container-value')

  const operationText = JSON.stringify(harness.operations)
  for (const privateValue of [
    'private-note-value',
    'private-email@example.com',
    'private-office@example.com',
    'private-secondary@example.com',
    'private-container-value',
  ]) {
    assert.equal(operationText.includes(privateValue), false)
  }
})

test('redacted fields never enter queued complete-mirror retry payloads', async () => {
  const harness = makeMirrorHarness({ failIndexWrite: true })
  const sourceData = {
    name: 'Public Agent',
    privateNotes: 'queued-private-note-value',
    meta: {
      internalEmail: 'queued-private-email@example.com',
    },
  }
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
    redactedFields: ['privateNotes', 'meta.internalEmail'],
    makeIndexKeys: ({ orgId, agentId }) => [`idx:agents:name:${orgId}:agent:${agentId}`],
    makeMetadata: data => ({
      name: data.name,
      privateNotes: data.privateNotes,
      meta: data.meta,
    }),
    makeAfterMirrorOperation: ({ event: followupEvent, data }) => ({
      op: 'observeRedactedData',
      data,
      eventData: followupEvent.data.after.data(),
    }),
  })
  const event = makeEvent({
    after: makeSnapshot(true, sourceData),
  })
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.equal(harness.queued.length, 1)
  const queuedPayloadText = JSON.stringify(harness.queued[0].value.payload)
  assert.equal(queuedPayloadText.includes('queued-private-note-value'), false)
  assert.equal(queuedPayloadText.includes('queued-private-email@example.com'), false)
  assert.equal(queuedPayloadText.includes('"privateNotes"'), false)
  assert.equal(queuedPayloadText.includes('"internalEmail"'), false)
})

test('redacted delete follow-ups cannot read private fields from the before snapshot', async () => {
  const harness = makeMirrorHarness()
  let followupBeforeData = null
  let followupData = 'not-called'
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
    redactedFields: ['privateNotes'],
    makeAfterMirrorOperation: ({ event: followupEvent, data }) => {
      followupBeforeData = followupEvent.data.before.data()
      followupData = data
      return {
        op: 'observeRedactedDelete',
        beforeData: followupBeforeData,
      }
    },
  })
  const event = makeEvent({
    id: 'event-agent-redacted-delete',
    before: makeSnapshot(true, {
      name: 'Deleted Agent',
      privateNotes: 'deleted-private-value',
    }),
    after: makeSnapshot(false),
  })
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.equal(followupData, null)
  assert.equal(followupBeforeData.name, 'Deleted Agent')
  assert.equal(Object.hasOwn(followupBeforeData, 'privateNotes'), false)
  assert.equal(JSON.stringify(harness.followups).includes('deleted-private-value'), false)
})

test('field-based mirrors pass redactedFields through without changing unconfigured behavior', async () => {
  const harness = makeMirrorHarness()
  const sourceData = {
    name: 'Public Agent',
    privateNotes: 'field-helper-private-value',
  }
  const handler = harness.exports.createKvMirrorHandlerFromFields({
    documentPath: 'organizations/{orgId}/agents',
    uniqueKey: '{orgId}',
    keyCollectionName: 'agents',
    indexKeys: ['name', 'privateNotes'],
    metadataKeys: ['name', 'privateNotes'],
    redactedFields: ['privateNotes'],
  })
  const event = {
    id: 'event-agent-1',
    params: { orgId: 'org-1', docId: 'agent-1' },
    data: {
      before: makeSnapshot(false),
      after: makeSnapshot(true, sourceData),
    },
  }
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  const canonicalWrite = harness.operations.find(operation => operation.key === 'agents:org-1:agent-1')
  assert.deepEqual(JSON.parse(canonicalWrite.value), { name: 'Public Agent' })
  assert.equal(Object.hasOwn(canonicalWrite.opts.metadata, 'privateNotes'), false)
  assert.equal(harness.operations.some(operation => operation.key.includes('field-helper-private-value')), false)

  const unconfiguredHarness = makeMirrorHarness()
  const unconfiguredHandler = unconfiguredHarness.exports.createKvMirrorHandlerFromFields({
    documentPath: 'organizations/{orgId}/agents',
    uniqueKey: '{orgId}',
    keyCollectionName: 'agents',
    metadataKeys: ['name', 'privateNotes'],
  })
  unconfiguredHarness.setCurrentSnapshot(event.data.after)
  await unconfiguredHandler(event)
  const unconfiguredCanonical = unconfiguredHarness.operations.find(operation => operation.key === 'agents:org-1:agent-1')
  assert.deepEqual(JSON.parse(unconfiguredCanonical.value), sourceData)
  assert.equal(unconfiguredCanonical.opts.metadata.privateNotes, 'field-helper-private-value')
})

test('failed mirror pieces queue the complete logical plan and do not publish the generation early', async () => {
  const harness = makeMirrorHarness({ failIndexWrite: true })
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
    makeIndexKeys: ({ orgId, agentId }) => [`idx:agents:name:${orgId}:agent:${agentId}`],
  })
  const event = makeEvent()
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.equal(harness.operations.some(operation => operation.key.startsWith('kv-version:')), false)
  assert.equal(harness.queued.length, 1)
  const payload = harness.queued[0].value.payload
  assert.equal(payload.op, 'finalizeMirror')
  assert.deepEqual(flattenPhases(payload.phases).map(operation => operation.op), [
    'put',
    'putIndexMeta',
    'put',
  ])
  assert.equal(payload.sourceState.path, SOURCE_PATH)
  assert.equal(payload.sourceState.updateTimeMs, Date.parse('2026-07-17T12:00:00.000Z'))
  assert.equal(payload.versionOperation.op, 'putCollectionVersion')
})

test('mirror plans are built before any writes occur', async () => {
  const harness = makeMirrorHarness()
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
    makeIndexKeys: () => {
      throw new Error('index planning failed')
    },
  })
  const event = makeEvent()
  harness.setCurrentSnapshot(event.data.after)
  await assert.rejects(handler(event), /index planning failed/)
  assert.deepEqual(harness.operations, [])
  assert.deepEqual(harness.queued, [])
})

test('superseded source events are skipped before writing to KV', async () => {
  const harness = makeMirrorHarness()
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
  })
  const event = makeEvent()
  harness.setCurrentSnapshot(makeSnapshot(true, { name: 'Newer Agent' }, '2026-07-17T12:01:00.000Z'))
  await handler(event)
  assert.deepEqual(harness.operations, [])
  assert.deepEqual(harness.queued, [])
})

test('deletes publish a generation marked as deleted after the canonical removal', async () => {
  const harness = makeMirrorHarness()
  const handler = harness.exports.createKvMirrorHandler({
    document: 'organizations/{orgId}/agents/{agentId}',
    makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
  })
  const event = makeEvent({
    id: 'event-agent-deleted',
    before: makeSnapshot(true, { name: 'Agent' }),
    after: makeSnapshot(false),
  })
  harness.setCurrentSnapshot(event.data.after)
  await handler(event)

  assert.deepEqual(harness.operations.map(operation => operation.op), ['del', 'put'])
  assert.equal(harness.operations[0].key, 'agents:org-1:agent-1')
  assert.match(harness.operations[1].key, /^kv-version:agents:org-1:shard:/)
  assert.equal(harness.operations[1].opts.metadata.deleted, true)
  assert.deepEqual(harness.queued, [])
})

const makeRetryHarness = ({ currentSnapshot, failFollowup = false, failIndexWrite = false, queueWriter } = {}) => {
  const timeline = []
  const queued = []
  const kv = {
    async put(key) {
      timeline.push({ op: 'put', key })
    },
    async putIndexMeta(key) {
      timeline.push({ op: 'putIndexMeta', key })
      if (failIndexWrite)
        throw new Error('socket hang up')
    },
    async del(key) {
      timeline.push({ op: 'del', key })
    },
  }
  const retryExports = loadCommonJs({
    source: retryWorkerSource,
    requires: {
      '../config.js': {
        onMessagePublished: (_options, handler) => handler,
        db: {
          doc: () => ({ get: async () => currentSnapshot }),
          collection: collection => ({
            async add(value) {
              queued.push({ collection, value })
              if (queueWriter)
                await queueWriter(collection, value)
            },
          }),
        },
        Firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
        logger: { log() {}, warn() {}, error() {} },
      },
      './kvClient': kv,
      './kvMirrorProtocol': protocolExports,
      './kvMirrorFollowups': {
        async runKvMirrorFollowup(operation) {
          timeline.push({ op: 'followup', key: operation.op })
          if (failFollowup)
            throw new Error('follow-up failed')
        },
      },
    },
  })
  return { queued, retryExports, timeline }
}

const makeFinalizationPayload = () => ({
  op: 'finalizeMirror',
  key: 'kv-version:agents:org-1:shard:001',
  sourceState: {
    path: SOURCE_PATH,
    exists: true,
    updateTimeMs: Date.parse('2026-07-17T12:00:00.000Z'),
  },
  phases: [
    [{ op: 'put', key: 'agents:org-1:agent-1', value: '{}' }],
    [{ op: 'putIndexMeta', key: 'idx:agents:name:org-1:agent:agent-1', metadata: {} }],
  ],
  afterOperation: { op: 'bumpPublishedSiteVersionsForTheme', orgId: 'org-1', themeId: 'theme-1' },
  versionOperation: protocolExports.createCollectionVersionOperation({
    event: { id: 'event-agent-1' },
    canonicalKey: 'agents:org-1:agent-1',
    deleted: false,
  }),
})

test('mirror finalization retries complete the plan and follow-up before publishing the generation', async () => {
  const harness = makeRetryHarness({ currentSnapshot: makeSnapshot(true, { name: 'Agent' }) })
  await harness.retryExports.kvMirrorRetryWorker({
    data: { message: { json: makeFinalizationPayload() } },
  })

  assert.deepEqual(harness.timeline.map(item => item.op), [
    'put',
    'putIndexMeta',
    'followup',
    'put',
  ])
  assert.match(harness.timeline[3].key, /^kv-version:agents:org-1:shard:/)
  assert.deepEqual(harness.queued, [])
})

test('stale mirror finalization retries are discarded without changing KV', async () => {
  const harness = makeRetryHarness({
    currentSnapshot: makeSnapshot(true, { name: 'Newer Agent' }, '2026-07-17T12:01:00.000Z'),
  })
  await harness.retryExports.kvMirrorRetryWorker({
    data: { message: { json: makeFinalizationPayload() } },
  })
  assert.deepEqual(harness.timeline, [])
  assert.deepEqual(harness.queued, [])
})

test('failed retry follow-ups requeue the complete finalization', async () => {
  const harness = makeRetryHarness({
    currentSnapshot: makeSnapshot(true, { name: 'Agent' }),
    failFollowup: true,
  })
  await harness.retryExports.kvMirrorRetryWorker({
    data: { message: { json: makeFinalizationPayload() } },
  })
  assert.equal(harness.queued.length, 1)
  assert.equal(harness.queued[0].value.payload.op, 'finalizeMirror')
  assert.equal(harness.queued[0].value.payload.attempt, 1)
  assert.equal(harness.timeline.some(item => item.key?.startsWith('kv-version:')), false)
})

const assertNoNestedArrays = (value) => {
  if (!value || typeof value !== 'object')
    return
  if (Array.isArray(value))
    assert.equal(value.some(Array.isArray), false, 'Firestore cannot store arrays directly inside arrays')
  for (const child of Object.values(value))
    assertNoNestedArrays(child)
}

const mirrorOptions = {
  document: 'organizations/{orgId}/agents/{agentId}',
  makeCanonicalKey: ({ orgId, agentId }) => `agents:${orgId}:${agentId}`,
  makeIndexKeys: ({ orgId, agentId }) => [`idx:agents:name:${orgId}:agent:${agentId}`],
}

test('a canonical network failure queues Firestore-safe phases and replay publishes generation last', async () => {
  const mirror = makeMirrorHarness({ failCanonicalWrite: true })
  await mirror.exports.createKvMirrorHandler(mirrorOptions)(makeEvent())
  assert.equal(mirror.queued.length, 1)
  const payload = mirror.queued[0].value.payload
  assertNoNestedArrays(payload)
  assert.equal(payload.phases.length, 3)
  const retry = makeRetryHarness({ currentSnapshot: makeSnapshot(true) })
  await retry.retryExports.kvMirrorRetryWorker({ data: { message: { json: payload } } })
  assert.deepEqual(retry.timeline.map(item => item.op), ['put', 'putIndexMeta', 'put', 'put'])
  assert.match(retry.timeline.at(-1).key, /^kv-version:/)
  assert.equal(retry.queued.length, 0)
})

test('new phase objects and legacy flat operations preserve follow-up and generation ordering', async () => {
  for (const format of ['objects', 'flat']) {
    const original = makeFinalizationPayload()
    const payload = format === 'objects'
      ? protocolExports.serializeKvRetryPayload(original)
      : { ...original, phases: undefined, operations: original.phases.flat() }
    const retry = makeRetryHarness({ currentSnapshot: makeSnapshot(true) })
    await retry.retryExports.kvMirrorRetryWorker({ data: { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') } } })
    assert.deepEqual(retry.timeline.map(item => item.op), ['put', 'putIndexMeta', 'followup', 'put'])
    assert.match(retry.timeline.at(-1).key, /^kv-version:/)
    assert.equal(retry.queued.length, 0)
  }
})

test('legacy and current failed retries requeue and dead-letter using Firestore-safe phases', async () => {
  for (const legacy of [true, false]) {
    for (const attempt of [0, 8]) {
      const original = { ...makeFinalizationPayload(), attempt }
      const payload = legacy ? original : protocolExports.serializeKvRetryPayload(original)
      const retry = makeRetryHarness({ currentSnapshot: makeSnapshot(true), failIndexWrite: true })
      await retry.retryExports.kvMirrorRetryWorker({ data: { message: { json: payload } } })
      assert.equal(retry.queued.length, 1)
      const queued = retry.queued[0]
      assert.equal(queued.collection, attempt === 8 ? 'kv-retry-dead' : 'topic-queue')
      assert.equal(queued.value.payload.attempt, attempt + 1)
      assertNoNestedArrays(queued.value)
      assert.equal(retry.timeline.some(item => item.op === 'followup' || item.key.startsWith('kv-version:')), false)
      assert.equal(Array.isArray(original.phases[0]), true, 'serialization must not mutate the incoming message')
    }
  }
})

test('malformed phases fail before any writes or generation advancement', async () => {
  for (const invalidPhase of [null, {}, { operations: 'invalid' }, { operations: [null] }, { operations: [{ op: 'put', key: '' }] }]) {
    const payload = makeFinalizationPayload()
    payload.phases.push(invalidPhase)
    const retry = makeRetryHarness({ currentSnapshot: makeSnapshot(true) })
    await retry.retryExports.kvMirrorRetryWorker({ data: { message: { json: payload } } })
    assert.deepEqual(retry.timeline, [])
    assert.equal(retry.queued.length, 1)
    assertNoNestedArrays(retry.queued[0].value)
  }
})

test('ordinary retry operations keep their existing payload shape', () => {
  for (const op of ['put', 'putIndexMeta', 'del', 'putCollectionVersion']) {
    const payload = { op, key: 'test-key' }
    assert.equal(protocolExports.serializeKvRetryPayload(payload), payload)
  }
})

test('Firestore emulator rejects the old shape and persists initial retry, requeue, dead letter and replay', {
  skip: !process.env.KV_RETRY_TEST_EMULATOR_HOST,
}, async () => {
  const host = process.env.KV_RETRY_TEST_EMULATOR_HOST
  assert.match(host, /^127\.0\.0\.1:\d+$/, 'integration test must use a loopback emulator')
  const require = createRequire(new URL('../../functions/package.json', import.meta.url))
  const { Firestore } = require('@google-cloud/firestore')
  const db = new Firestore({ projectId: 'demo-kv-mirror-retry', host, ssl: false })
  const saved = []
  const queueWriter = async (collection, value) => {
    const ref = await db.collection(collection).add(JSON.parse(JSON.stringify(value)))
    saved.push((await ref.get()).data())
  }
  try {
    await assert.rejects(db.collection('topic-queue').add({ payload: makeFinalizationPayload() }), /nested|array|INVALID_ARGUMENT/i)
    const mirror = makeMirrorHarness({ failCanonicalWrite: true, queueWriter })
    await mirror.exports.createKvMirrorHandler(mirrorOptions)(makeEvent())
    assert.equal(saved.length, 1)
    const retry = makeRetryHarness({ currentSnapshot: makeSnapshot(true), failIndexWrite: true, queueWriter })
    await retry.retryExports.kvMirrorRetryWorker({ data: { message: { json: saved[0].payload } } })
    assert.equal(saved.length, 2)
    assert.equal(saved[1].payload.attempt, 1)
    const recovered = makeRetryHarness({ currentSnapshot: makeSnapshot(true) })
    await recovered.retryExports.kvMirrorRetryWorker({ data: { message: { json: saved[1].payload } } })
    assert.deepEqual(recovered.timeline.map(item => item.op), ['put', 'putIndexMeta', 'put', 'put'])
    assert.match(recovered.timeline.at(-1).key, /^kv-version:/)
    await retry.retryExports.kvMirrorRetryWorker({ data: { message: { json: { ...makeFinalizationPayload(), attempt: 8 } } } })
    assert.equal(saved.length, 3)
    assert.equal(saved[2].payload.attempt, 9)
    assert.equal(retry.queued.at(-1).collection, 'kv-retry-dead')
  }
  finally {
    await db.terminate()
  }
})
