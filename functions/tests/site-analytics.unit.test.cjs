const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildDateRange,
  getZoneCandidates,
  normalizeHostname,
  normalizeRumAnalytics,
  normalizeSiteHostnames,
  normalizeZoneAnalytics,
  percentChange,
} = require('../site-analytics-core')

test('normalizes site hostnames without collapsing www into the apex host', () => {
  assert.equal(normalizeHostname('https://WWW.Example.com/path?q=1'), 'www.example.com')
  assert.deepEqual(normalizeSiteHostnames([
    'https://www.example.com/path',
    'www.example.com.',
    'blog.example.com:443',
  ]), ['www.example.com', 'blog.example.com'])
  assert.deepEqual(getZoneCandidates('news.blog.example.com'), [
    'news.blog.example.com',
    'blog.example.com',
    'example.com',
  ])
})

test('builds bounded UTC date and comparison ranges', () => {
  assert.deepEqual(buildDateRange(7, new Date('2026-07-09T22:30:00-04:00')), {
    days: 7,
    startDate: '2026-07-04',
    endDate: '2026-07-10',
    comparisonStartDate: '2026-06-27',
    comparisonEndDate: '2026-07-03',
  })
  assert.equal(buildDateRange(365, new Date('2026-07-09T12:00:00Z')).days, 30)
})

test('normalizes hostname-scoped RUM analytics and fills missing days', () => {
  const range = {
    days: 3,
    startDate: '2026-07-01',
    endDate: '2026-07-03',
  }
  const normalized = normalizeRumAnalytics({
    currentSeries: [
      { count: 20, avg: { sampleInterval: 10 }, sum: { visits: 10 }, dimensions: { date: '2026-07-01' } },
      { count: 10, avg: { sampleInterval: 10 }, sum: { visits: 10 }, dimensions: { date: '2026-07-03' } },
    ],
    previousTotals: [{ count: 15, sum: { visits: 5 }, avg: { sampleInterval: 5 } }],
    topPages: [
      { count: 10, sum: { visits: 4 }, dimensions: { requestPath: '/about' } },
      { count: 20, sum: { visits: 9 }, dimensions: { requestPath: '/' } },
    ],
    referrers: [
      { count: 12, sum: { visits: 8 }, dimensions: { refererHost: '' } },
      { count: 6, sum: { visits: 4 }, dimensions: { refererHost: 'google.com' } },
    ],
    countries: [{ count: 30, dimensions: { countryName: 'US' } }],
    devices: [{ count: 30, dimensions: { deviceType: 'desktop' } }],
    browsers: [{ count: 30, dimensions: { userAgentBrowser: 'Chrome' } }],
    operatingSystems: [{ count: 30, dimensions: { userAgentOS: 'Windows' } }],
    webVitals: [{
      avg: { sampleInterval: 10 },
      quantiles: {
        largestContentfulPaintP75: 2200,
        interactionToNextPaintP75: 180,
        cumulativeLayoutShiftP75: 0.08,
      },
      sum: {
        lcpGood: 8,
        lcpNeedsImprovement: 2,
        lcpPoor: 0,
        lcpTotal: 10,
        inpGood: 9,
        inpNeedsImprovement: 1,
        inpPoor: 0,
        inpTotal: 10,
        clsGood: 10,
        clsNeedsImprovement: 0,
        clsPoor: 0,
        clsTotal: 10,
      },
    }],
  }, range)

  assert.equal(normalized.hasData, true)
  assert.equal(normalized.sampled, true)
  assert.deepEqual(normalized.totals, { pageViews: 30, visits: 20, viewsPerVisit: 1.5 })
  assert.equal(normalized.comparison.pageViews, 100)
  assert.deepEqual(normalized.trend[1], { date: '2026-07-02', pageViews: 0, visits: 0 })
  assert.deepEqual(normalized.topPages.map(item => [item.path, item.value, item.visits]), [
    ['/', 20, 9],
    ['/about', 10, 4],
  ])
  assert.equal(normalized.referrers[0].label, 'Direct')
  assert.equal(normalized.webVitals.lcp.goodPercent, 80)
})

test('normalizes zone-wide operational analytics without calling it hostname traffic', () => {
  const range = {
    days: 2,
    startDate: '2026-07-01',
    endDate: '2026-07-02',
  }
  const normalized = normalizeZoneAnalytics({
    currentZone: [
      {
        dimensions: { date: '2026-07-01' },
        sum: {
          requests: 100,
          pageViews: 20,
          bytes: 1000,
          cachedRequests: 40,
          countryMap: [{ clientCountryName: 'US', requests: 60 }],
          browserMap: [{ uaBrowserFamily: 'Chrome', pageViews: 10 }],
          responseStatusMap: [{ edgeResponseStatus: 200, requests: 90 }],
        },
        uniq: { uniques: 10 },
      },
      {
        dimensions: { date: '2026-07-02' },
        sum: {
          requests: 50,
          pageViews: 10,
          bytes: 500,
          cachedRequests: 20,
          countryMap: [{ clientCountryName: 'US', requests: 30 }],
          browserMap: [{ uaBrowserFamily: 'Chrome', pageViews: 5 }],
          responseStatusMap: [{ edgeResponseStatus: 404, requests: 5 }],
        },
        uniq: { uniques: 6 },
      },
    ],
    previousZone: [{ sum: { requests: 75, pageViews: 15, bytes: 700, cachedRequests: 15 }, uniq: { uniques: 8 } }],
  }, range)

  assert.equal(normalized.scope, 'zone')
  assert.deepEqual(normalized.totals, {
    requests: 150,
    pageViews: 30,
    bytes: 1500,
    cachedRequests: 60,
    cacheRate: 40,
    averageDailyUniqueVisitors: 8,
  })
  assert.equal(normalized.comparison.requests, 100)
  assert.equal(normalized.countries[0].value, 90)
  assert.deepEqual(normalized.statuses.map(item => item.label), ['200', '404'])
})

test('returns null comparison when the previous period is zero', () => {
  assert.equal(percentChange(10, 0), null)
  assert.equal(percentChange(75, 50), 50)
})
