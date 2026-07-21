'use strict'

const normalizeDomain = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/\.$/, '')
  }
  catch {
    return ''
  }
}

const isEligibleDomain = domain => Boolean(
  domain
  && domain.includes('.')
  && domain !== 'localhost'
  && !domain.endsWith('.localhost')
  && !domain.endsWith('.dev')
  && !/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)
  && !domain.includes(':'),
)

const shouldSyncPublishedSite = (before = {}, after = {}) => {
  const beforeDomains = JSON.stringify((before.domains || []).map(normalizeDomain).sort())
  const afterDomains = JSON.stringify((after.domains || []).map(normalizeDomain).sort())
  const publishVersionChanged = String(before.version || '') !== String(after.version || '')
  return beforeDomains !== afterDomains || publishVersionChanged
}

const getSiteZoneTag = site => String(site?.ruleset?.zone_tag || site?.zone_tag || '').trim()
const isWebAnalyticsSiteEnabled = site => Boolean(
  site
  && site?.ruleset?.enabled === true
  && site?.ruleset?.lite !== true
  && String(site?.site_token || '').trim(),
)

const zarazHostnamesForDomain = (domain, zoneName) => {
  const host = normalizeDomain(domain)
  const zone = normalizeDomain(zoneName)
  if (!host) return []
  if (zone && host === zone) return [zone, `www.${zone}`]
  return [host]
}

const hostnamesToRegex = hostnames => `^(${hostnames
  .map(host => String(host).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')})$`

module.exports = {
  getSiteZoneTag,
  isEligibleDomain,
  hostnamesToRegex,
  isWebAnalyticsSiteEnabled,
  normalizeDomain,
  shouldSyncPublishedSite,
  zarazHostnamesForDomain,
}
