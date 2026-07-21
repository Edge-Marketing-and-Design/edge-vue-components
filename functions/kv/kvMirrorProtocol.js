const { createHash, randomUUID } = require('node:crypto')

const configuredVersionShardCount = Number(process.env.KV_MIRROR_VERSION_SHARDS)
const hasConfiguredVersionShardCount = Number.isFinite(configuredVersionShardCount)
  && configuredVersionShardCount >= 1
  && configuredVersionShardCount <= 256
const VERSION_SHARD_COUNT = hasConfiguredVersionShardCount
  ? Math.floor(configuredVersionShardCount)
  : 64

function collectionScopeFromCanonicalKey(canonicalKey) {
  const segments = String(canonicalKey || '').split(':').filter(Boolean)
  if (segments.length < 2)
    return ''
  segments.pop()
  return segments.join(':')
}

function snapshotUpdateTimeMs(snapshot) {
  const value = snapshot?.updateTime
  const millis = typeof value?.toMillis === 'function'
    ? value.toMillis()
    : Date.parse(String(value || ''))
  return (Number.isFinite(millis) && millis >= 0) ? Math.trunc(millis) : null
}

function sourceStateFromEvent(event) {
  const after = event?.data?.after
  const before = event?.data?.before
  const exists = Boolean(after?.exists)
  const snapshot = exists ? after : before
  const path = String(snapshot?.ref?.path || '').trim()
  if (!path)
    return null
  return {
    path,
    exists,
    updateTimeMs: exists ? snapshotUpdateTimeMs(after) : null,
  }
}

async function isSourceStateCurrent(db, source) {
  if (!source?.path || typeof db?.doc !== 'function')
    return true
  const snapshot = await db.doc(source.path).get()
  if (Boolean(snapshot?.exists) !== Boolean(source.exists))
    return false
  if (!source.exists)
    return true
  return snapshotUpdateTimeMs(snapshot) === source.updateTimeMs
}

function safeGenerationId(value) {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return normalized || randomUUID()
}

function collectionVersionShard(canonicalKey) {
  const digest = createHash('sha256').update(String(canonicalKey || '')).digest()
  return digest.readUInt32BE(0) % VERSION_SHARD_COUNT
}

function createCollectionVersionOperation({ event, canonicalKey, deleted }) {
  const scope = collectionScopeFromCanonicalKey(canonicalKey)
  if (!scope)
    return null

  const shard = collectionVersionShard(canonicalKey)
  return {
    op: 'putCollectionVersion',
    key: `kv-version:${scope}:shard:${String(shard).padStart(3, '0')}`,
    value: '1',
    metadata: {
      scope,
      shard,
      eventId: safeGenerationId(event?.id),
      deleted: Boolean(deleted),
    },
    source: 'kvMirrorVersion',
  }
}

function materializeCollectionVersionOperation(operation) {
  const metadata = (operation?.metadata && typeof operation.metadata === 'object')
    ? operation.metadata
    : {}
  return {
    ...operation,
    op: 'put',
    opts: {
      metadata: {
        ...metadata,
        generation: `${safeGenerationId(metadata.eventId)}.${randomUUID()}`,
        changedAt: new Date().toISOString(),
      },
    },
  }
}

module.exports = {
  collectionScopeFromCanonicalKey,
  collectionVersionShard,
  createCollectionVersionOperation,
  isSourceStateCurrent,
  materializeCollectionVersionOperation,
  sourceStateFromEvent,
}
