const { createHash, randomUUID } = require('node:crypto')
const { domainToASCII } = require('node:url')
const { createCollectionVersionOperation, materializeCollectionVersionOperation } = require('./kvMirrorProtocol')

const LEASE_MS = 240000 // Longer than every 180-second caller's lifetime.
const REQUEST_TIMEOUT_MS = 15000
const LOCK_PATH = 'cms-site-resolution-locks/writer'
const httpOptions = { timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: 0 }
const sorted = values => [...new Set(values)].sort()
const slug = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
const stable = value => JSON.stringify(value, function (key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item))
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
  return item
})
const hash = value => createHash('sha256').update(stable(value)).digest('hex')
const statePath = siteKey => `cms-site-resolution/${hash(siteKey)}`
const sourcePath = (orgId, siteId) => `organizations/${orgId}/published-site-settings/${siteId}`
const siteKeyFor = (orgId, siteId) => `sites:${orgId}:${siteId}`
const resolutionKey = host => `site-resolution:v1:${host}`
const disabledRecord = () => ({ schemaVersion: 1, status: 'disabled', orgId: null, siteId: null, siteKey: null, revision: null, publishedAt: null })

function normalizeHostname(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`)
    if (url.username || url.password) return ''
    const host = url.hostname.toLowerCase().replace(/\.+$/, '')
    const ascii = domainToASCII(host)
    return ascii && ascii.length <= 253 ? ascii : ''
  }
  catch { return '' }
}

// Matches the Hub's existing domain connector: both apex and www are served;
// forwardApex/canonicalDomain decide redirects, not which site owns the request.
function servedHosts(value) {
  const host = normalizeHostname(value)
  if (!host) return []
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host]
  const apex = host.replace(/^www\./, '')
  return [apex, `www.${apex}`]
}

function ownerOf(data) {
  const match = String(data?.sitePath || '').match(/^organizations\/([^/]+)\/published-site-settings\/([^/]+)$/)
  if (!match) return null
  if ((data.orgId && data.orgId !== match[1]) || (data.siteId && data.siteId !== match[2])) return null
  return { orgId: match[1], siteId: match[2], path: data.sitePath }
}

async function loadOwners(db) {
  const registry = await db.collection('domain-registry').get()
  const owners = new Map()
  for (const doc of registry.docs) {
    const data = doc.data() || {}
    const owner = ownerOf(data)
    for (const host of servedHosts(data.domain || doc.id)) {
      // Invalid or conflicting registry entries fail closed. Never guess an org.
      const previous = owners.get(host)
      owners.set(host, !owner || (owners.has(host) && previous?.path !== owner.path) ? null : owner)
    }
  }
  return owners
}

function timestamp(snapshot) {
  const time = snapshot?.updateTime
  const ms = typeof time?.toMillis === 'function' ? time.toMillis() : Date.parse(String(time || ''))
  return Number.isFinite(ms) ? ms : 0
}

async function loadPublication(db, orgId, siteId) {
  const site = await db.doc(sourcePath(orgId, siteId)).get()
  if (!site.exists) return null
  const pages = await db.collection(`organizations/${orgId}/sites/${siteId}/published`).get()
  const data = { ...(site.data() || {}) }
  delete data.cacheVerification
  delete data.revision
  delete data.publishedAt
  // Page removal otherwise leaves an obsolete pageVersions entry. Resolve the
  // current published pages rather than depending on every UI writer doing it.
  const sourcePageVersions = data.pageVersions || {}
  data.pageVersions = Object.fromEntries(pages.docs.map(page => [page.id, page.data()?.version ?? data.pageVersions?.[page.id] ?? 1]))
  const dependencies = pages.docs.map(page => [page.id, hash(page.data())]).sort(([a], [b]) => a.localeCompare(b))
  const revision = `sha256:${hash({ site: data, sourcePageVersions, pages: dependencies })}`
  const publishedAt = new Date(Math.max(timestamp(site), ...pages.docs.map(timestamp))).toISOString()
  const siteKey = siteKeyFor(orgId, siteId)
  return { orgId, siteId, siteKey, revision, publishedAt, data, document: { ...data, revision, publishedAt }, hosts: sorted((Array.isArray(data.domains) ? data.domains : []).flatMap(servedHosts)) }
}

// Every caller (including legacy queued site writes) enters the same global
// lease. The registry shares host keys across organizations, so per-site locks
// alone cannot prevent an old owner's cleanup overwriting a new owner's record.
async function reconcileSiteResolution({ db, kv, orgId, siteId, touchedHosts = [], now = Date.now, owner = randomUUID() }) {
  if (!orgId || !siteId || [orgId, siteId].some(id => /[/:]/.test(id))) throw new Error('Invalid site resolution identity.')
  const lock = db.doc(LOCK_PATH)
  await db.runTransaction(async transaction => {
    const current = (await transaction.get(lock)).data() || {}
    if (current.owner && current.expiresAt > now()) throw new Error('Site resolution writer is busy; retry.')
    transaction.set(lock, { owner, expiresAt: now() + LEASE_MS })
  })
  let success = false
  const checkLease = async () => {
    const state = (await lock.get()).data() || {}
    if (state.owner !== owner || state.expiresAt <= now() + REQUEST_TIMEOUT_MS)
      throw new Error('Site resolution lease expired or changed; retry.')
  }
  const put = async (key, value, opts = {}) => { await checkLease(); await kv.put(key, value, { ...opts, ...httpOptions }) }
  const del = async key => { await checkLease(); await kv.del(key, httpOptions) }
  const get = async key => { await checkLease(); return kv.get(key, 'json', httpOptions) }
  const processed = new Map()
  try {
    const mirrorSite = async (org, site) => {
      const key = siteKeyFor(org, site)
      if (processed.has(key)) return processed.get(key)
      const ref = db.doc(statePath(key))
      const previous = (await ref.get()).data() || {}
      const publication = await loadPublication(db, org, site)
      const registryOwners = await loadOwners(db)
      const indexKeys = publication ? sorted([
        `idx:sites:docId:${org}:${slug(site)}:${site}`,
        ...(Array.isArray(publication.data.domains) ? publication.data.domains : []).filter(domain => registryOwners.get(normalizeHostname(domain))?.path === sourcePath(org, site)).map(domain => `idx:sites:domains:${slug(domain)}`),
      ]) : []
      const manifest = await get(`idx:manifest:${key}`)
      const oldIndexes = sorted([...(previous.indexKeys || []), ...(previous.pendingIndexKeys || []), ...(manifest?.indexKeys || [])])
      const hosts = sorted([...(previous.hosts || []), ...(previous.pendingHosts || []), ...(publication?.hosts || [])])
      // Durable intent survives a crash between an external PUT and checkpoint.
      await checkLease()
      await ref.set({ orgId: org, siteId: site, siteKey: key, pendingHosts: hosts, pendingIndexKeys: sorted([...oldIndexes, ...indexKeys]) }, { merge: true })
      let canonicalChanged = !publication && (previous.completed !== true || previous.revision !== null || !!(previous.pendingHosts?.length || previous.pendingIndexKeys?.length))
      if (publication) {
        // Retry-uncertain writes must be replayed. Completed identical writes can
        // be skipped without reading the full site back out of KV.
        const unchanged = previous.revision === publication.revision && previous.completed === true
          && !(previous.pendingHosts?.length || previous.pendingIndexKeys?.length)
        if (unchanged && previous.publishedAt) {
          publication.publishedAt = previous.publishedAt
          publication.document.publishedAt = previous.publishedAt
        }
        canonicalChanged = !unchanged
        if (canonicalChanged) await put(key, publication.document, { metadata: { canonical: key } })
        for (const index of indexKeys) {
          if (!unchanged || !oldIndexes.includes(index)) await put(index, '1', { metadata: { canonical: key } })
        }
      }
      else if (canonicalChanged) await del(key)
      // Legacy domain indexes are compatibility-only, but never remove another
      // owner's index during domain transfer.
      const owners = await loadOwners(db)
      for (const index of oldIndexes.filter(index => !indexKeys.includes(index))) {
        if (index.startsWith('idx:sites:domains:')) {
          const suffix = index.slice('idx:sites:domains:'.length)
          if ([...owners.entries()].some(([host, current]) => slug(host) === suffix && current && current.path !== sourcePath(org, site))) continue
        }
        await del(index)
      }
      if (publication) {
        const nextManifest = { indexKeys, metadataHash: stable({ canonical: key }) }
        if (stable(manifest) !== stable(nextManifest)) await put(`idx:manifest:${key}`, nextManifest)
      }
      else if (canonicalChanged || manifest) await del(`idx:manifest:${key}`)
      const result = { ref, key, publication, hosts, indexKeys, canonicalChanged }
      processed.set(key, result)
      return result
    }

    const main = await mirrorSite(orgId, siteId)
    const candidates = new Set([...main.hosts, ...touchedHosts.flatMap(servedHosts)])
    // Current registry entries may provide aliases whose spelling is absent in
    // the site event. Ownership still requires a currently published domain.
    for (const [host, current] of await loadOwners(db)) {
      if (current?.path === sourcePath(orgId, siteId)) candidates.add(host)
    }
    const visited = new Set()
    while ([...candidates].some(host => !visited.has(host))) {
      const host = [...candidates].find(host => !visited.has(host))
      visited.add(host)
      const current = (await loadOwners(db)).get(host)
      let value = disabledRecord()
      if (current) {
        const target = await mirrorSite(current.orgId, current.siteId)
        for (const other of target.hosts) candidates.add(other)
        const publication = target.publication
        if (publication?.hosts.includes(host)) {
          const latest = await loadPublication(db, current.orgId, current.siteId)
          if (latest?.revision !== publication.revision) throw new Error('Published site changed during resolution; retry current state.')
          value = { schemaVersion: 1, status: 'active', orgId: current.orgId, siteId: current.siteId, siteKey: publication.siteKey, revision: publication.revision, publishedAt: publication.publishedAt }
        }
      }
      // Resolve every host from current ownership, including cleanup candidates.
      // A late event for an old site can therefore repair, never disable, a new owner.
      if (stable(await get(resolutionKey(host))) !== stable(value)) await put(resolutionKey(host), value)
    }
    for (const result of processed.values()) {
      const { ref, publication, indexKeys } = result
      if (result.canonicalChanged) {
        const operation = materializeCollectionVersionOperation(createCollectionVersionOperation({
          event: { id: publication?.revision || owner }, canonicalKey: result.key, deleted: !publication,
        }))
        await put(operation.key, operation.value, operation.opts)
      }
      await checkLease()
      await ref.set({ hosts: publication?.hosts || [], indexKeys, revision: publication?.revision || null, publishedAt: publication?.publishedAt || null, completed: true, pendingHosts: [], pendingIndexKeys: [] }, { merge: true })
    }
    success = true
    return { siteKey: siteKeyFor(orgId, siteId), hosts: candidates.size }
  }
  finally {
    // An HTTP timeout is ambiguous. Do not immediately let another writer race
    // an upstream request which may still be finishing; retain its lease.
    if (success) await db.runTransaction(async transaction => {
      const state = (await transaction.get(lock)).data() || {}
      if (state.owner === owner) transaction.set(lock, { owner: '', expiresAt: 0 })
    })
  }
}

async function runSiteResolution(options) {
  if (['1', 'true', 'yes'].includes(String(process.env.KV_MIRROR_DISABLED || '').trim().toLowerCase())) return { disabled: true }
  const { db } = require('../config.js')
  const kv = require('./kvClient')
  return reconcileSiteResolution({ db, kv, ...options })
}

module.exports = { reconcileSiteResolution, runSiteResolution, normalizeHostname, servedHosts, loadPublication, resolutionKey, statePath, LOCK_PATH, LEASE_MS, REQUEST_TIMEOUT_MS }
