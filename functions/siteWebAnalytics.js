'use strict'

const { createHash } = require('node:crypto')

const {
  db,
  HttpsError,
  logger,
  onCall,
  onDocumentWritten,
  permissionCheck,
} = require('./config.js')

const CF_ACCOUNT_ID = String(process.env.CF_ACCOUNT_ID || '').trim()
const CF_TOKEN = String(process.env.CLOUDFLARE_PAGES_API_TOKEN || '').trim()
const API_BASE = 'https://api.cloudflare.com/client/v4'
const DOMAIN_REGISTRY_COLLECTION = 'cms-domain-registry'
const {
  getSiteZoneTag,
  hostnamesToRegex,
  isEligibleDomain,
  isWebAnalyticsSiteEnabled,
  normalizeDomain,
  shouldSyncPublishedSite,
  zarazHostnamesForDomain,
} = require('./site-web-analytics-core')

async function cloudflareRequest(path, options = {}) {
  if (!CF_ACCOUNT_ID || !CF_TOKEN)
    throw new Error('Cloudflare Web Analytics is not configured.')
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map(error => error?.message).filter(Boolean).join('; ')
    const error = new Error(message || `Cloudflare request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return payload
}

async function findZone(domain) {
  const labels = domain.replace(/^www\./, '').split('.')
  for (let index = 0; index < labels.length - 1; index += 1) {
    const name = labels.slice(index).join('.')
    const payload = await cloudflareRequest(`/zones?account.id=${encodeURIComponent(CF_ACCOUNT_ID)}&name=${encodeURIComponent(name)}&status=active&per_page=1`)
    const zone = Array.isArray(payload?.result) ? payload.result[0] : null
    if (zone?.id) return zone
  }
  return null
}

async function zoneHasProxiedHostname(zoneId, domain) {
  const payload = await cloudflareRequest(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}&per_page=100`)
  return (payload?.result || []).some(record => record?.proxied === true)
}

async function listAnalyticsSites() {
  const sites = []
  for (let page = 1; page <= 100; page += 1) {
    const payload = await cloudflareRequest(`/accounts/${CF_ACCOUNT_ID}/rum/site_info/list?page=${page}&per_page=50`)
    sites.push(...(Array.isArray(payload?.result) ? payload.result : []))
    const totalPages = Number(payload?.result_info?.total_pages || 1)
    if (page >= totalPages) break
  }
  return sites
}

const normalizeZarazConfig = config => ({
  ...(config || {}),
  dataLayer: Boolean(config?.dataLayer),
  debugKey: config?.debugKey || '',
  settings: config?.settings || {},
  tools: config?.tools || {},
  triggers: config?.triggers || {},
  variables: config?.variables || {},
  zarazVersion: Number(config?.zarazVersion || 0),
})

async function getZarazConfig(zoneId) {
  const current = await cloudflareRequest(`/zones/${zoneId}/settings/zaraz/config`)
  if (current?.result) return normalizeZarazConfig(current.result)
  const defaults = await cloudflareRequest(`/zones/${zoneId}/settings/zaraz/default`)
  if (defaults?.result) return normalizeZarazConfig(defaults.result)
  throw new Error('Cloudflare Zaraz configuration is empty.')
}

const zarazInstallId = domain => createHash('sha256')
  .update(normalizeDomain(domain))
  .digest('hex')
  .slice(0, 12)

async function publishZarazConfig(zoneId, description) {
  try {
    await cloudflareRequest(`/zones/${zoneId}/settings/zaraz/publish`, {
      method: 'POST',
      body: JSON.stringify(description),
    })
  }
  catch (error) {
    if (!String(error?.message || '').includes('workflow is not preview')) throw error
  }
}

async function upsertZarazBeacon({ domain, zone, siteToken }) {
  if (!siteToken) throw new Error('Cloudflare did not return a Web Analytics beacon token.')
  const config = await getZarazConfig(zone.id)
  const hostnames = zarazHostnamesForDomain(domain, zone.name)
  const suffix = zarazInstallId(domain)
  const toolId = `edgeCmsWebAnalytics_${suffix}`
  const triggerId = `edgeCmsWebAnalyticsPageview_${suffix}`
  const actionId = `edgeCmsWebAnalyticsBeacon_${suffix}`
  const htmlCode = `<script>(function(){var token="${siteToken}";if(document.querySelector('script[data-edge-cms-web-analytics="'+token+'"]'))return;var script=document.createElement('script');script.defer=true;script.src='https://static.cloudflareinsights.com/beacon.min.js';script.dataset.cfBeacon=JSON.stringify({token:token});script.dataset.edgeCmsWebAnalytics=token;document.head.appendChild(script)})()</script>`
  const nextConfig = {
    ...config,
    settings: {
      ...config.settings,
      autoInjectScript: true,
    },
    tools: {
      ...config.tools,
      [toolId]: {
        blockingTriggers: [],
        component: 'html',
        defaultFields: {},
        enabled: true,
        name: `Edge CMS Web Analytics: ${domain}`,
        permissions: ['execute_unsafe_scripts'],
        settings: {},
        type: 'component',
        actions: {
          [actionId]: {
            actionType: 'event',
            blockingTriggers: [],
            data: {
              __zaraz_setting_name: 'Edge CMS Web Analytics Beacon',
              htmlCode,
            },
            firingTriggers: [triggerId],
          },
        },
      },
    },
    triggers: {
      ...config.triggers,
      [triggerId]: {
        clientRules: [],
        description: `Cloudflare Web Analytics beacon for ${hostnames.join(', ')}`,
        excludeRules: [],
        loadRules: [
          {
            id: 'edgeCmsWebAnalyticsPageview',
            match: '{{ client.__zarazTrack }}',
            op: 'EQUALS',
            value: 'Pageview',
          },
          {
            id: 'edgeCmsWebAnalyticsHostname',
            match: '{{ system.page.url.hostname }}',
            op: 'MATCH_REGEX',
            value: hostnamesToRegex(hostnames),
          },
        ],
        name: `Edge CMS Web Analytics: ${domain}`,
      },
    },
  }
  await cloudflareRequest(`/zones/${zone.id}/settings/zaraz/config`, {
    method: 'PUT',
    body: JSON.stringify(nextConfig),
  })
  await publishZarazConfig(zone.id, `Install Cloudflare Web Analytics beacon for ${domain}`)
  return { hostnames, toolId }
}

async function writeStatus(domain, status, context = {}) {
  const ownership = context.orgId && context.siteId
    ? {
        domain,
        orgId: context.orgId,
        siteId: context.siteId,
        sitePath: `organizations/${context.orgId}/published-site-settings/${context.siteId}`,
      }
    : {}
  const ref = db.collection(DOMAIN_REGISTRY_COLLECTION).doc(domain)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const existingPath = String(snapshot.data()?.sitePath || '')
    if (existingPath && ownership.sitePath && existingPath !== ownership.sitePath)
      return
    transaction.set(ref, {
      ...(!snapshot.exists ? ownership : {}),
      webAnalytics: {
        ...status,
        updatedAt: new Date(),
      },
    }, { merge: true })
  })
}

async function ensureDomain(domain, existingSites = null, context = {}) {
  const host = normalizeDomain(domain)
  if (!isEligibleDomain(host)) {
    const result = { status: 'ineligible' }
    if (host) await writeStatus(host, result, context)
    return { domain: host, ...result }
  }
  try {
    const zone = await findZone(host)
    if (!zone) {
      const result = { status: 'not-in-account' }
      await writeStatus(host, result, context)
      return { domain: host, ...result }
    }
    if (!await zoneHasProxiedHostname(zone.id, host)) {
      const result = { status: 'not-proxied', zoneId: zone.id }
      await writeStatus(host, result, context)
      return { domain: host, ...result }
    }
    const sites = existingSites || await listAnalyticsSites()
    const existing = sites.find(site => getSiteZoneTag(site) === zone.id)
    let siteId = existing?.site_tag || existing?.id || ''
    let analyticsSite = existing
    if (!siteId) {
      const created = await cloudflareRequest(`/accounts/${CF_ACCOUNT_ID}/rum/site_info`, {
        method: 'POST',
        body: JSON.stringify({ auto_install: true, host, zone_tag: zone.id }),
      })
      siteId = created?.result?.site_tag || created?.result?.id || ''
      analyticsSite = created?.result || null
    }
    if (!siteId)
      throw new Error('Cloudflare did not return a Web Analytics site identifier.')
    const updated = await cloudflareRequest(`/accounts/${CF_ACCOUNT_ID}/rum/site_info/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({
        auto_install: true,
        enabled: true,
        lite: false,
        zone_tag: zone.id,
      }),
    })
    analyticsSite = updated?.result ? { ...(analyticsSite || {}), ...updated.result } : analyticsSite
    if (!isWebAnalyticsSiteEnabled(analyticsSite)) {
      const refreshed = await cloudflareRequest(`/accounts/${CF_ACCOUNT_ID}/rum/site_info/${siteId}`)
      analyticsSite = refreshed?.result ? { ...(analyticsSite || {}), ...refreshed.result } : analyticsSite
    }
    if (!isWebAnalyticsSiteEnabled(analyticsSite))
      throw new Error('Cloudflare Web Analytics is enabled but its beacon token is unavailable.')
    if (Array.isArray(sites) && !sites.some(site => getSiteZoneTag(site) === zone.id))
      sites.push(analyticsSite)
    const zaraz = await upsertZarazBeacon({ domain: host, zone, siteToken: analyticsSite.site_token })
    const result = {
      status: 'enabled',
      zoneId: zone.id,
      siteId,
      installMode: 'zaraz',
      zarazToolId: zaraz.toolId,
      hostnames: zaraz.hostnames,
    }
    await writeStatus(host, result, context)
    return { domain: host, ...result }
  }
  catch (error) {
    const status = [401, 403].includes(error?.status) ? 'permission-denied' : error?.status === 429 ? 'rate-limited' : 'error'
    await writeStatus(host, { status, message: String(error?.message || 'Cloudflare synchronization failed.').slice(0, 300) }, context)
    logger.error('Cloudflare Web Analytics synchronization failed', { domain: host, status, error: error?.message })
    return { domain: host, status }
  }
}

async function syncDomains(domains, context = {}) {
  const normalized = Array.from(new Set((domains || []).map(normalizeDomain).filter(Boolean)))
  let sites = null
  try { sites = await listAnalyticsSites() }
  catch (error) { logger.warn('Unable to preload Cloudflare Web Analytics sites', { error: error?.message }) }
  const results = []
  for (const domain of normalized) results.push(await ensureDomain(domain, sites, context))
  return results
}

async function isGlobalAdmin(uid) {
  const userSnap = await db.collection('users').doc(uid).get()
  if (!userSnap.exists) return false
  return Object.values(userSnap.data()?.roles || {}).some(role =>
    String(role?.collectionPath || '').trim() === '-'
    && String(role?.role || '').trim().toLowerCase() === 'admin',
  )
}

exports.syncPublishedSiteWebAnalytics = onDocumentWritten(
  { document: 'organizations/{orgId}/published-site-settings/{siteId}', timeoutSeconds: 300 },
  async (event) => {
    if (!event.data?.after?.exists) return
    const before = event.data.before?.data() || {}
    const after = event.data.after.data() || {}
    if (!shouldSyncPublishedSite(before, after)) return
    await syncDomains(after.domains, event.params)
  },
)

exports.retrySiteWebAnalytics = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = String(request.auth?.uid || '')
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required.')
  if (String(request.data?.uid || '') !== uid) throw new HttpsError('permission-denied', 'UID mismatch.')
  const orgId = String(request.data?.orgId || '').trim()
  const siteId = String(request.data?.siteId || '').trim()
  if (!orgId || !siteId) throw new HttpsError('invalid-argument', 'Missing orgId or siteId.')
  if (!await permissionCheck(uid, 'write', `organizations/${orgId}/sites/${siteId}`))
    throw new HttpsError('permission-denied', 'Not allowed to synchronize this site.')
  const snap = await db.collection('organizations').doc(orgId).collection('published-site-settings').doc(siteId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Published site settings were not found.')
  return { results: await syncDomains(snap.data()?.domains || [], { orgId, siteId }) }
})

exports.backfillSiteWebAnalytics = onCall({ timeoutSeconds: 540 }, async (request) => {
  const uid = String(request.auth?.uid || '')
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required.')
  if (String(request.data?.uid || '') !== uid) throw new HttpsError('permission-denied', 'UID mismatch.')
  if (!await isGlobalAdmin(uid))
    throw new HttpsError('permission-denied', 'Global admin access is required.')
  const limit = Math.min(Math.max(Number(request.data?.limit || 10), 1), 25)
  let query = db.collectionGroup('published-site-settings').orderBy('__name__').limit(limit)
  const cursor = String(request.data?.cursor || '').trim()
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.get()
  const results = []
  for (const doc of snapshot.docs) {
    const [, orgId, , siteId] = doc.ref.path.split('/')
    results.push({ path: doc.ref.path, results: await syncDomains(doc.data()?.domains || [], { orgId, siteId }) })
  }
  const nextCursor = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].ref.path : ''
  return { results, nextCursor, complete: !nextCursor }
})
