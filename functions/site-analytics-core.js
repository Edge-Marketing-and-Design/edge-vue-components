const ALLOWED_RANGE_DAYS = Object.freeze([7, 30, 90])

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const round = (value, digits = 0) => {
  const multiplier = 10 ** digits
  return Math.round(toNumber(value) * multiplier) / multiplier
}

const normalizeHostname = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw)
    return ''

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return String(url.hostname || '').trim().toLowerCase().replace(/\.+$/g, '')
  }
  catch {
    return raw
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/\.+$/g, '')
  }
}

const normalizeSiteHostnames = value => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map(normalizeHostname)
    .filter(Boolean),
))

const getZoneCandidates = (hostname) => {
  const labels = normalizeHostname(hostname).split('.').filter(Boolean)
  if (labels.length < 2)
    return []

  const candidates = []
  for (let index = 0; index <= labels.length - 2; index += 1)
    candidates.push(labels.slice(index).join('.'))
  return candidates
}

const toDateKey = date => date.toISOString().slice(0, 10)

const addUtcDays = (date, amount) => {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

const buildDateRange = (rangeDaysInput, nowInput = new Date()) => {
  const requestedDays = Number(rangeDaysInput)
  const days = ALLOWED_RANGE_DAYS.includes(requestedDays) ? requestedDays : 30
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput)
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = addUtcDays(end, -(days - 1))
  const comparisonEnd = addUtcDays(start, -1)
  const comparisonStart = addUtcDays(comparisonEnd, -(days - 1))

  return {
    days,
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    comparisonStartDate: toDateKey(comparisonStart),
    comparisonEndDate: toDateKey(comparisonEnd),
  }
}

const percentChange = (current, previous) => {
  const currentValue = toNumber(current)
  const previousValue = toNumber(previous)
  if (previousValue === 0)
    return null
  return round(((currentValue - previousValue) / previousValue) * 100, 1)
}

const fillDailySeries = ({ rows = [], startDate, endDate, mapper }) => {
  const valuesByDate = new Map()
  for (const row of rows) {
    const date = String(row?.dimensions?.date || '').trim()
    if (date)
      valuesByDate.set(date, mapper(row))
  }

  const output = []
  let cursor = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  while (cursor <= end) {
    const date = toDateKey(cursor)
    output.push({ date, ...(valuesByDate.get(date) || mapper(null)) })
    cursor = addUtcDays(cursor, 1)
  }
  return output
}

const sumRows = (rows, getter) => rows.reduce((total, row) => total + toNumber(getter(row)), 0)

const normalizeBreakdown = (rows, dimensionKey, valueGetter, emptyLabel = 'Unknown') => {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const rawLabel = String(row?.dimensions?.[dimensionKey] || '').trim()
      return {
        label: rawLabel || emptyLabel,
        value: toNumber(valueGetter(row)),
      }
    })
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = values.reduce((sum, item) => sum + item.value, 0)
  return values.map(item => ({
    ...item,
    percent: total > 0 ? round((item.value / total) * 100, 1) : 0,
  }))
}

const normalizeTopPages = (rows) => {
  const values = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const path = String(row?.dimensions?.requestPath || '').trim() || '/'
      return {
        label: path,
        path,
        value: toNumber(row?.count),
        visits: toNumber(row?.sum?.visits),
      }
    })
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = values.reduce((sum, item) => sum + item.value, 0)
  return values.map(item => ({
    ...item,
    percent: total > 0 ? round((item.value / total) * 100, 1) : 0,
  }))
}

const normalizeWebVital = (sum = {}, key) => {
  const good = toNumber(sum[`${key}Good`])
  const needsImprovement = toNumber(sum[`${key}NeedsImprovement`])
  const poor = toNumber(sum[`${key}Poor`])
  const total = toNumber(sum[`${key}Total`]) || good + needsImprovement + poor
  return {
    good,
    needsImprovement,
    poor,
    total,
    goodPercent: total > 0 ? round((good / total) * 100, 1) : null,
  }
}

const normalizeRumAnalytics = (accountData = {}, range) => {
  const rawSeries = Array.isArray(accountData.currentSeries) ? accountData.currentSeries : []
  const previousRow = Array.isArray(accountData.previousTotals) ? accountData.previousTotals[0] : null
  const webVitalRow = Array.isArray(accountData.webVitals) ? accountData.webVitals[0] : null
  const pageViews = sumRows(rawSeries, row => row?.count)
  const visits = sumRows(rawSeries, row => row?.sum?.visits)
  const previousPageViews = toNumber(previousRow?.count)
  const previousVisits = toNumber(previousRow?.sum?.visits)
  const sampleIntervals = [
    ...rawSeries.map(row => row?.avg?.sampleInterval),
    previousRow?.avg?.sampleInterval,
    webVitalRow?.avg?.sampleInterval,
  ].map(toNumber).filter(value => value > 0)
  const sampleInterval = sampleIntervals.length ? Math.max(...sampleIntervals) : 1

  const topPages = normalizeTopPages(accountData.topPages)

  const referrers = normalizeBreakdown(
    accountData.referrers,
    'refererHost',
    row => row?.sum?.visits,
    'Direct',
  )

  const quantiles = webVitalRow?.quantiles || {}
  const webVitalSum = webVitalRow?.sum || {}
  const webVitals = webVitalRow
    ? {
        lcp: {
          p75: toNumber(quantiles.largestContentfulPaintP75),
          ...normalizeWebVital(webVitalSum, 'lcp'),
        },
        inp: {
          p75: toNumber(quantiles.interactionToNextPaintP75),
          ...normalizeWebVital(webVitalSum, 'inp'),
        },
        cls: {
          p75: round(quantiles.cumulativeLayoutShiftP75, 3),
          ...normalizeWebVital(webVitalSum, 'cls'),
        },
      }
    : null

  return {
    hasData: pageViews > 0 || visits > 0,
    sampled: sampleInterval > 1,
    sampleInterval,
    totals: {
      pageViews,
      visits,
      viewsPerVisit: visits > 0 ? round(pageViews / visits, 2) : null,
    },
    comparison: {
      pageViews: percentChange(pageViews, previousPageViews),
      visits: percentChange(visits, previousVisits),
      previousPageViews,
      previousVisits,
    },
    trend: fillDailySeries({
      rows: rawSeries,
      startDate: range.startDate,
      endDate: range.endDate,
      mapper: row => ({
        pageViews: toNumber(row?.count),
        visits: toNumber(row?.sum?.visits),
      }),
    }),
    topPages,
    referrers,
    countries: normalizeBreakdown(accountData.countries, 'countryName', row => row?.count),
    devices: normalizeBreakdown(accountData.devices, 'deviceType', row => row?.count),
    browsers: normalizeBreakdown(accountData.browsers, 'userAgentBrowser', row => row?.count),
    operatingSystems: normalizeBreakdown(accountData.operatingSystems, 'userAgentOS', row => row?.count),
    webVitals,
  }
}

const aggregateMapRows = (rows, mapKey, dimensionKey, valueKey) => {
  const totals = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const item of Array.isArray(row?.sum?.[mapKey]) ? row.sum[mapKey] : []) {
      const label = String(item?.[dimensionKey] ?? '').trim() || 'Unknown'
      totals.set(label, (totals.get(label) || 0) + toNumber(item?.[valueKey]))
    }
  }
  const normalized = Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const total = normalized.reduce((sum, item) => sum + item.value, 0)
  return normalized.map(item => ({
    ...item,
    percent: total > 0 ? round((item.value / total) * 100, 1) : 0,
  }))
}

const normalizeZonePeriod = (rows = [], rangeDays = 1) => {
  const requests = sumRows(rows, row => row?.sum?.requests)
  const pageViews = sumRows(rows, row => row?.sum?.pageViews)
  const bytes = sumRows(rows, row => row?.sum?.bytes)
  const cachedRequests = sumRows(rows, row => row?.sum?.cachedRequests)
  const uniqueVisitorDays = (Array.isArray(rows) ? rows : [])
    .map(row => toNumber(row?.uniq?.uniques))
    .filter(value => value >= 0)
  const averageDailyUniqueVisitors = uniqueVisitorDays.length
    ? round(uniqueVisitorDays.reduce((sum, value) => sum + value, 0) / Math.max(toNumber(rangeDays), 1), 1)
    : 0

  return {
    requests,
    pageViews,
    bytes,
    cachedRequests,
    cacheRate: requests > 0 ? round((cachedRequests / requests) * 100, 1) : 0,
    averageDailyUniqueVisitors,
  }
}

const normalizeZoneAnalytics = (zoneData = {}, range) => {
  const currentRows = Array.isArray(zoneData.currentZone) ? zoneData.currentZone : []
  const previousRows = Array.isArray(zoneData.previousZone) ? zoneData.previousZone : []
  const current = normalizeZonePeriod(currentRows, range.days)
  const previous = normalizeZonePeriod(previousRows, range.days)

  return {
    hasData: current.requests > 0 || current.pageViews > 0,
    scope: 'zone',
    totals: current,
    comparison: {
      requests: percentChange(current.requests, previous.requests),
      pageViews: percentChange(current.pageViews, previous.pageViews),
      averageDailyUniqueVisitors: percentChange(
        current.averageDailyUniqueVisitors,
        previous.averageDailyUniqueVisitors,
      ),
    },
    trend: fillDailySeries({
      rows: currentRows,
      startDate: range.startDate,
      endDate: range.endDate,
      mapper: row => ({
        pageViews: toNumber(row?.sum?.pageViews),
        requests: toNumber(row?.sum?.requests),
      }),
    }),
    countries: aggregateMapRows(currentRows, 'countryMap', 'clientCountryName', 'requests').slice(0, 10),
    browsers: aggregateMapRows(currentRows, 'browserMap', 'uaBrowserFamily', 'pageViews').slice(0, 10),
    statuses: aggregateMapRows(currentRows, 'responseStatusMap', 'edgeResponseStatus', 'requests').slice(0, 12),
  }
}

module.exports = {
  ALLOWED_RANGE_DAYS,
  buildDateRange,
  getZoneCandidates,
  normalizeHostname,
  normalizeRumAnalytics,
  normalizeSiteHostnames,
  normalizeZoneAnalytics,
  percentChange,
}
