// Loaded on first request, not at module load, so other Functions don't initialize it.
const axios = () => require('axios')
const {
  db,
  HttpsError,
  logger,
  onCall,
  permissionCheck,
} = require('./config.js')
const {
  buildDateRange,
  getZoneCandidates,
  normalizeHostname,
  normalizeRumAnalytics,
  normalizeSiteHostnames,
  normalizeZoneAnalytics,
} = require('./site-analytics-core')

// Read at call time so loading this module does no startup work for other Functions.
const cloudflareAccountId = () => String(process.env.CF_ACCOUNT_ID || '').trim()
const cloudflareAnalyticsToken = () => String(
  process.env.CLOUDFLARE_ANALYTICS_API_TOKEN
  || process.env.CLOUDFLARE_PAGES_API_TOKEN
  || '',
).trim()
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'
const CLOUDFLARE_REQUEST_TIMEOUT_MS = 20000

const RUM_QUERY = `
query SiteAnalytics(
  $accountTag: string!
  $host: string!
  $start: Date!
  $end: Date!
  $previousStart: Date!
  $previousEnd: Date!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      currentSeries: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [date_ASC]
      ) {
        count
        avg { sampleInterval }
        sum { visits }
        dimensions { date }
      }
      previousTotals: rumPageloadEventsAdaptiveGroups(
        limit: 1
        filter: { date_geq: $previousStart, date_leq: $previousEnd, requestHost: $host, bot: 0 }
      ) {
        count
        avg { sampleInterval }
        sum { visits }
      }
      topPages: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [count_DESC]
      ) {
        count
        avg { sampleInterval }
        sum { visits }
        dimensions { requestPath }
      }
      referrers: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [sum_visits_DESC]
      ) {
        count
        avg { sampleInterval }
        sum { visits }
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { countryName }
      }
      devices: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { deviceType }
      }
      browsers: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { userAgentBrowser }
      }
      operatingSystems: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { userAgentOS }
      }
      webVitals: rumWebVitalsEventsAdaptiveGroups(
        limit: 1
        filter: { date_geq: $start, date_leq: $end, requestHost: $host, bot: 0 }
      ) {
        count
        avg { sampleInterval }
        quantiles {
          cumulativeLayoutShiftP75
          interactionToNextPaintP75
          largestContentfulPaintP75
        }
        sum {
          clsGood
          clsNeedsImprovement
          clsPoor
          clsTotal
          inpGood
          inpNeedsImprovement
          inpPoor
          inpTotal
          lcpGood
          lcpNeedsImprovement
          lcpPoor
          lcpTotal
        }
      }
    }
  }
}`

const ZONE_QUERY = `
query SiteZoneAnalytics(
  $zoneTag: string!
  $start: Date!
  $end: Date!
  $previousStart: Date!
  $previousEnd: Date!
) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      currentZone: httpRequests1dGroups(
        limit: 100
        filter: { date_geq: $start, date_leq: $end }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum {
          bytes
          cachedBytes
          cachedRequests
          pageViews
          requests
          browserMap { pageViews uaBrowserFamily }
          countryMap { clientCountryName requests }
          responseStatusMap { edgeResponseStatus requests }
        }
        uniq { uniques }
      }
      previousZone: httpRequests1dGroups(
        limit: 100
        filter: { date_geq: $previousStart, date_leq: $previousEnd }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum {
          bytes
          cachedBytes
          cachedRequests
          pageViews
          requests
        }
        uniq { uniques }
      }
    }
  }
}`

const cloudflareHeaders = () => ({
  'Authorization': `Bearer ${cloudflareAnalyticsToken()}`,
  'Content-Type': 'application/json',
})

const isPermissionMessage = value => /access|authoriz|permission|forbidden/i.test(String(value || ''))

const createSourceError = (source, error) => {
  const graphQlMessages = Array.isArray(error?.response?.data?.errors)
    ? error.response.data.errors.map(item => item?.message).filter(Boolean)
    : []
  const rawMessage = graphQlMessages.join('; ') || error?.message || ''
  const permission = Number(error?.response?.status || 0) === 401
    || Number(error?.response?.status || 0) === 403
    || isPermissionMessage(rawMessage)

  if (source === 'webAnalytics') {
    return {
      source,
      reason: permission ? 'permission' : 'query-failed',
      message: permission
        ? 'Cloudflare Web Analytics requires Account Analytics Read permission.'
        : 'Cloudflare Web Analytics is temporarily unavailable.',
    }
  }

  return {
    source,
    reason: permission ? 'permission' : 'query-failed',
    message: permission
      ? 'Cloudflare zone analytics requires Zone Analytics Read permission.'
      : 'Cloudflare zone analytics is temporarily unavailable.',
  }
}

const executeGraphQl = async (query, variables) => {
  const response = await axios().post(
    `${CLOUDFLARE_API_BASE}/graphql`,
    { query, variables },
    {
      headers: cloudflareHeaders(),
      timeout: CLOUDFLARE_REQUEST_TIMEOUT_MS,
    },
  )
  const errors = Array.isArray(response?.data?.errors) ? response.data.errors.filter(Boolean) : []
  if (errors.length) {
    const error = new Error(errors.map(item => item?.message).filter(Boolean).join('; ') || 'Cloudflare GraphQL query failed.')
    error.response = { status: response?.status, data: { errors } }
    throw error
  }
  return response?.data?.data || {}
}

const findCloudflareZone = async (hostname) => {
  for (const candidate of getZoneCandidates(hostname)) {
    const response = await axios().get(`${CLOUDFLARE_API_BASE}/zones`, {
      headers: cloudflareHeaders(),
      params: {
        'name': candidate,
        'account.id': cloudflareAccountId(),
        'per_page': 5,
      },
      timeout: CLOUDFLARE_REQUEST_TIMEOUT_MS,
    })
    const zones = Array.isArray(response?.data?.result) ? response.data.result : []
    const match = zones.find(zone => normalizeHostname(zone?.name) === candidate)
    if (response?.data?.success && match?.id) {
      return {
        id: String(match.id),
        name: normalizeHostname(match.name),
        status: String(match.status || ''),
      }
    }
  }
  return null
}

const unwrapAccountData = data => data?.viewer?.accounts?.[0] || {}
const unwrapZoneData = data => data?.viewer?.zones?.[0] || {}

const buildDashboardStatus = ({ rum, zone, unavailable }) => {
  const hasData = rum?.hasData || zone?.hasData
  if (hasData && unavailable.length)
    return 'partial'
  if (hasData)
    return 'ready'
  if (unavailable.some(item => item.reason === 'permission' || item.reason === 'query-failed'))
    return 'unavailable'
  return 'no-data'
}

const dashboardMessage = (status) => {
  if (status === 'partial')
    return 'Some Cloudflare analytics are unavailable, so this dashboard is showing the data that could be loaded.'
  if (status === 'unavailable')
    return 'Cloudflare analytics could not be loaded. Review the API token permissions shown below.'
  if (status === 'no-data')
    return 'No analytics data was found for this hostname and date range. Cloudflare Web Analytics may not be enabled yet.'
  return ''
}

exports.getDashboard = onCall({ timeoutSeconds: 60 }, async (request) => {
  const authUid = String(request.auth?.uid || '').trim()
  if (!authUid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request.data?.uid !== authUid)
    throw new HttpsError('permission-denied', 'UID mismatch.')

  const orgId = String(request.data?.orgId || '').trim()
  const siteId = String(request.data?.siteId || '').trim()
  const requestedHostname = normalizeHostname(request.data?.hostname)
  const range = buildDateRange(request.data?.rangeDays)

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'orgId and siteId are required.')
  if (!cloudflareAccountId() || !cloudflareAnalyticsToken())
    throw new HttpsError('failed-precondition', 'Cloudflare analytics credentials are not configured.')

  const allowed = await permissionCheck(authUid, 'read', `organizations/${orgId}/sites-analytics`)
  if (!allowed)
    throw new HttpsError('permission-denied', 'Not allowed to view analytics for this site.')

  const siteSnap = await db.doc(`organizations/${orgId}/sites/${siteId}`).get()
  if (!siteSnap.exists)
    throw new HttpsError('not-found', 'Site not found.')

  const siteData = siteSnap.data() || {}
  const hostnames = normalizeSiteHostnames(siteData.domains)
  const hostname = requestedHostname || hostnames[0] || ''
  if (!hostname)
    throw new HttpsError('failed-precondition', 'Add a domain to this site before viewing analytics.')
  if (!hostnames.includes(hostname))
    throw new HttpsError('permission-denied', 'The requested hostname does not belong to this site.')

  let zone
  try {
    zone = await findCloudflareZone(hostname)
  }
  catch (error) {
    const permission = Number(error?.response?.status || 0) === 401
      || Number(error?.response?.status || 0) === 403
      || isPermissionMessage(error?.message)
    logger.warn('Cloudflare analytics zone lookup failed.', {
      orgId,
      siteId,
      hostname,
      status: Number(error?.response?.status || 0),
      permission,
    })
    throw new HttpsError(
      permission ? 'permission-denied' : 'unavailable',
      permission
        ? 'Cloudflare zone lookup requires Zone Read permission.'
        : 'Unable to verify this hostname with Cloudflare right now.',
    )
  }

  if (!zone)
    throw new HttpsError('failed-precondition', 'This site hostname is not in the configured Cloudflare account.')

  const dateVariables = {
    start: range.startDate,
    end: range.endDate,
    previousStart: range.comparisonStartDate,
    previousEnd: range.comparisonEndDate,
  }
  const [rumResult, zoneResult] = await Promise.allSettled([
    executeGraphQl(RUM_QUERY, {
      accountTag: cloudflareAccountId(),
      host: hostname,
      ...dateVariables,
    }),
    executeGraphQl(ZONE_QUERY, {
      zoneTag: zone.id,
      ...dateVariables,
    }),
  ])

  const unavailable = []
  let rum = null
  let zoneAnalytics = null

  if (rumResult.status === 'fulfilled') {
    rum = normalizeRumAnalytics(unwrapAccountData(rumResult.value), range)
  }
  else {
    const sourceError = createSourceError('webAnalytics', rumResult.reason)
    unavailable.push(sourceError)
    logger.warn('Cloudflare Web Analytics query failed.', {
      orgId,
      siteId,
      hostname,
      reason: sourceError.reason,
    })
  }

  if (zoneResult.status === 'fulfilled') {
    zoneAnalytics = normalizeZoneAnalytics(unwrapZoneData(zoneResult.value), range)
  }
  else {
    const sourceError = createSourceError('zoneAnalytics', zoneResult.reason)
    unavailable.push(sourceError)
    logger.warn('Cloudflare zone analytics query failed.', {
      orgId,
      siteId,
      hostname,
      reason: sourceError.reason,
    })
  }

  const status = buildDashboardStatus({ rum, zone: zoneAnalytics, unavailable })
  return {
    status,
    message: dashboardMessage(status),
    hostname,
    availableHostnames: hostnames,
    zone: {
      name: zone.name,
      status: zone.status,
    },
    range,
    source: {
      webAnalytics: {
        available: rumResult.status === 'fulfilled',
        hasData: Boolean(rum?.hasData),
      },
      zoneAnalytics: {
        available: zoneResult.status === 'fulfilled',
        hasData: Boolean(zoneAnalytics?.hasData),
        scope: 'zone',
      },
    },
    webAnalytics: rum,
    zoneAnalytics,
    unavailable,
    refreshedAt: new Date().toISOString(),
  }
})
