<script setup>
import { Activity, AlertTriangle, BarChart3, Gauge, Globe2, Loader2, MonitorSmartphone, RefreshCw } from 'lucide-vue-next'
import { LineChart } from '@/components/ui/chart-line'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  siteDoc: {
    type: Object,
    default: () => ({}),
  },
})

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  selectedHostname: '',
  rangeDays: 30,
  loading: false,
  error: '',
  dashboard: null,
})

const rangeOptions = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
]

let requestId = 0

const normalizeHostname = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw)
    return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return String(url.hostname || '').trim().toLowerCase().replace(/\.+$/g, '')
  }
  catch {
    return raw.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0].replace(/\.+$/g, '')
  }
}

const hostnames = computed(() => Array.from(new Set(
  (Array.isArray(props.siteDoc?.domains) ? props.siteDoc.domains : [])
    .map(normalizeHostname)
    .filter(Boolean),
)))

const hostnameOptions = computed(() => hostnames.value.map(hostname => ({
  label: hostname,
  value: hostname,
})))

const webAnalytics = computed(() => state.dashboard?.webAnalytics || null)
const zoneAnalytics = computed(() => state.dashboard?.zoneAnalytics || null)
const hasWebAnalytics = computed(() => webAnalytics.value?.hasData === true)
const hasZoneAnalytics = computed(() => zoneAnalytics.value?.hasData === true)
const hasAnyData = computed(() => hasWebAnalytics.value || hasZoneAnalytics.value)

const hasMetricValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))

const formatNumber = value => hasMetricValue(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value))
  : '—'

const formatDecimal = (value, digits = 2) => hasMetricValue(value)
  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value))
  : '—'

const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes))
    return '—'
  if (bytes < 1024)
    return `${formatNumber(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1024
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${formatDecimal(amount, amount >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

const comparisonLabel = (value) => {
  if (!hasMetricValue(value))
    return 'No prior-period comparison'
  const numeric = Number(value)
  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${formatNumber(numeric)}% vs prior period`
}

const metricCards = computed(() => {
  const rumTotals = webAnalytics.value?.totals || {}
  const rumComparison = webAnalytics.value?.comparison || {}
  const zoneTotals = zoneAnalytics.value?.totals || {}
  const zoneComparison = zoneAnalytics.value?.comparison || {}
  const useRum = hasWebAnalytics.value
  return [
    {
      label: useRum ? 'Page views' : 'Zone page views',
      value: useRum ? rumTotals.pageViews : zoneTotals.pageViews,
      comparison: useRum ? rumComparison.pageViews : zoneComparison.pageViews,
      note: useRum ? 'Hostname-scoped Web Analytics' : 'All traffic in the Cloudflare zone',
    },
    {
      label: 'Visits',
      value: useRum ? rumTotals.visits : null,
      comparison: useRum ? rumComparison.visits : null,
      note: useRum ? 'Entry sessions detected by Cloudflare' : 'Requires Cloudflare Web Analytics',
    },
    {
      label: 'Views per visit',
      value: useRum ? rumTotals.viewsPerVisit : null,
      comparison: null,
      format: 'decimal',
      note: useRum ? 'Page views divided by visits' : 'Requires Cloudflare Web Analytics',
    },
    {
      label: 'Avg. daily visitors',
      value: hasZoneAnalytics.value ? zoneTotals.averageDailyUniqueVisitors : null,
      comparison: zoneComparison.averageDailyUniqueVisitors,
      note: hasZoneAnalytics.value ? 'Zone-wide daily unique visitors' : 'Requires Zone Analytics Read',
    },
  ]
})

const trendData = computed(() => {
  if (hasWebAnalytics.value) {
    return (webAnalytics.value?.trend || []).map(item => ({
      'date': item.date,
      'Page views': Number(item.pageViews || 0),
      'Visits': Number(item.visits || 0),
    }))
  }
  return (zoneAnalytics.value?.trend || []).map(item => ({
    'date': item.date,
    'Zone page views': Number(item.pageViews || 0),
    'Zone requests': Number(item.requests || 0),
  }))
})

const trendCategories = computed(() => hasWebAnalytics.value
  ? ['Page views', 'Visits']
  : ['Zone page views', 'Zone requests'])

const formatChartDate = (value) => {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime()))
    return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

const formatRefreshedAt = computed(() => {
  const value = state.dashboard?.refreshedAt
  if (!value)
    return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return ''
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
})

const dateRangeLabel = computed(() => {
  const range = state.dashboard?.range
  if (!range?.startDate || !range?.endDate)
    return ''
  const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${formatter.format(new Date(`${range.startDate}T00:00:00`))} – ${formatter.format(new Date(`${range.endDate}T00:00:00`))}`
})

const vitalCards = computed(() => {
  const vitals = webAnalytics.value?.webVitals
  if (!vitals)
    return []
  return [
    {
      label: 'Largest Contentful Paint',
      shortLabel: 'LCP',
      value: vitals.lcp?.p75,
      display: `${formatDecimal(vitals.lcp?.p75, 0)} ms`,
      goodPercent: vitals.lcp?.goodPercent,
      status: Number(vitals.lcp?.p75) <= 2500 ? 'Good' : Number(vitals.lcp?.p75) <= 4000 ? 'Needs improvement' : 'Poor',
    },
    {
      label: 'Interaction to Next Paint',
      shortLabel: 'INP',
      value: vitals.inp?.p75,
      display: `${formatDecimal(vitals.inp?.p75, 0)} ms`,
      goodPercent: vitals.inp?.goodPercent,
      status: Number(vitals.inp?.p75) <= 200 ? 'Good' : Number(vitals.inp?.p75) <= 500 ? 'Needs improvement' : 'Poor',
    },
    {
      label: 'Cumulative Layout Shift',
      shortLabel: 'CLS',
      value: vitals.cls?.p75,
      display: formatDecimal(vitals.cls?.p75, 3),
      goodPercent: vitals.cls?.goodPercent,
      status: Number(vitals.cls?.p75) <= 0.1 ? 'Good' : Number(vitals.cls?.p75) <= 0.25 ? 'Needs improvement' : 'Poor',
    },
  ].filter(item => Number.isFinite(Number(item.value)) && Number(item.value) > 0)
})

const sourceNotices = computed(() => state.dashboard?.unavailable || [])

const userFacingError = (error) => {
  const message = String(error?.message || '').trim()
  const knownMessages = [
    'Cloudflare analytics credentials are not configured.',
    'Cloudflare zone lookup requires Zone Read permission.',
    'This site hostname is not in the configured Cloudflare account.',
    'Add a domain to this site before viewing analytics.',
  ]
  return knownMessages.find(item => message.includes(item))
    || 'Unable to load Cloudflare analytics right now. Please try again.'
}

const loadDashboard = async () => {
  const hostname = state.selectedHostname
  const orgId = String(edgeGlobal?.edgeState?.currentOrganization || '').trim()
  const uid = String(edgeFirebase?.user?.uid || '').trim()
  if (!hostname || !orgId || !uid || !props.site)
    return

  const currentRequestId = ++requestId
  state.loading = true
  state.error = ''
  try {
    const response = await edgeFirebase.runFunction('siteAnalytics-getDashboard', {
      uid,
      orgId,
      siteId: props.site,
      hostname,
      rangeDays: Number(state.rangeDays),
    })
    if (currentRequestId !== requestId)
      return
    state.dashboard = response?.data || response || null
  }
  catch (error) {
    if (currentRequestId !== requestId)
      return
    state.dashboard = null
    state.error = userFacingError(error)
  }
  finally {
    if (currentRequestId === requestId)
      state.loading = false
  }
}

const setRangeDays = (value) => {
  const days = Number(value)
  state.rangeDays = [7, 30, 90].includes(days) ? days : 30
}

watch(hostnames, (nextHostnames) => {
  if (nextHostnames.includes(state.selectedHostname))
    return
  state.selectedHostname = nextHostnames[0] || ''
}, { immediate: true })

watch(
  () => [state.selectedHostname, state.rangeDays, props.site],
  ([hostname]) => {
    if (hostname)
      loadDashboard()
  },
  { immediate: true },
)

onUnmounted(() => {
  requestId += 1
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-6">
    <div class="mx-auto max-w-[1600px] space-y-5">
      <div class="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <BarChart3 class="h-5 w-5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
            <h1 class="text-xl font-semibold">
              Analytics
            </h1>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Cloudflare traffic and visitor insights for {{ state.selectedHostname || 'this site' }}.
          </p>
          <p v-if="dateRangeLabel" class="mt-1 text-xs text-muted-foreground">
            {{ dateRangeLabel }}<span v-if="formatRefreshedAt"> · Refreshed {{ formatRefreshedAt }}</span>
          </p>
        </div>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <edge-shad-select
            v-if="hostnameOptions.length > 1"
            v-model="state.selectedHostname"
            name="analyticsHostname"
            label="Hostname"
            :items="hostnameOptions"
            item-title="label"
            item-value="value"
            class="min-w-[220px]"
          />
          <div v-else-if="state.selectedHostname" class="min-w-[220px]">
            <div class="mb-1 text-xs font-medium text-muted-foreground">
              Hostname
            </div>
            <div class="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm">
              {{ state.selectedHostname }}
            </div>
          </div>
          <edge-shad-select
            :model-value="state.rangeDays"
            name="analyticsRange"
            label="Date range"
            :items="rangeOptions"
            item-title="label"
            item-value="value"
            class="min-w-[170px]"
            @update:model-value="setRangeDays"
          />
          <edge-shad-button
            type="button"
            variant="outline"
            class="h-10 gap-2"
            :disabled="state.loading || !state.selectedHostname"
            aria-label="Refresh analytics"
            @click="loadDashboard"
          >
            <Loader2 v-if="state.loading" class="h-4 w-4 animate-spin" aria-hidden="true" />
            <RefreshCw v-else class="h-4 w-4" aria-hidden="true" />
            Refresh
          </edge-shad-button>
        </div>
      </div>

      <Card v-if="!hostnames.length" class="border-dashed">
        <CardContent class="flex flex-col items-center gap-2 py-12 text-center">
          <Globe2 class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 class="font-semibold">
            Add a site domain first
          </h2>
          <p class="max-w-xl text-sm text-muted-foreground">
            Analytics can load after this site has a hostname that belongs to the configured Cloudflare account.
          </p>
        </CardContent>
      </Card>

      <Card v-else-if="state.error" class="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
        <CardContent class="flex items-start gap-3 py-5">
          <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-300" aria-hidden="true" />
          <div>
            <h2 class="font-semibold text-red-900 dark:text-red-100">
              Analytics unavailable
            </h2>
            <p class="mt-1 text-sm text-red-800 dark:text-red-200">
              {{ state.error }}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card v-else-if="state.loading && !state.dashboard">
        <CardContent class="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <Loader2 class="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading Cloudflare analytics…
        </CardContent>
      </Card>

      <template v-else-if="state.dashboard">
        <div
          v-if="state.dashboard.message"
          class="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
          :class="state.dashboard.status === 'unavailable'
            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{{ state.dashboard.message }}</p>
            <ul v-if="sourceNotices.length" class="mt-2 list-disc space-y-1 pl-4 text-xs">
              <li v-for="notice in sourceNotices" :key="notice.source">
                {{ notice.message }}
              </li>
            </ul>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card v-for="metric in metricCards" :key="metric.label">
            <CardContent class="p-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ metric.label }}
              </div>
              <div class="mt-2 text-3xl font-semibold tabular-nums">
                {{ metric.format === 'decimal' ? formatDecimal(metric.value) : formatNumber(metric.value) }}
              </div>
              <div class="mt-2 text-xs text-muted-foreground">
                {{ comparisonLabel(metric.comparison) }}
              </div>
              <div class="mt-1 text-[11px] text-muted-foreground">
                {{ metric.note }}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card v-if="hasAnyData">
          <CardHeader>
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle class="text-lg">
                  Traffic over time
                </CardTitle>
                <CardDescription>
                  {{ hasWebAnalytics ? 'Hostname-scoped visitor activity' : 'Zone-wide HTTP traffic fallback' }}
                </CardDescription>
              </div>
              <span
                v-if="webAnalytics?.sampled"
                class="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cloudflare sampled estimate
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <LineChart
              :data="trendData"
              index="date"
              :categories="trendCategories"
              :colors="['#0f172a', '#3b82f6']"
              :x-formatter="value => formatChartDate(trendData[value]?.date || '')"
              :y-formatter="value => formatNumber(value)"
              class="h-[320px]"
            />
          </CardContent>
        </Card>

        <div v-if="hasWebAnalytics" class="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle class="text-lg">
                Top pages
              </CardTitle>
              <CardDescription>Most-viewed hostname paths.</CardDescription>
            </CardHeader>
            <CardContent>
              <div v-if="webAnalytics.topPages?.length" class="space-y-4">
                <div v-for="item in webAnalytics.topPages" :key="item.path" class="space-y-1.5">
                  <div class="flex items-center justify-between gap-3 text-sm">
                    <span class="min-w-0 truncate font-medium" :title="item.path">{{ item.path }}</span>
                    <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatNumber(item.value) }} views</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div class="h-full rounded-full bg-slate-800 dark:bg-slate-300" :style="{ width: `${Math.max(item.percent, 2)}%` }" />
                  </div>
                </div>
              </div>
              <p v-else class="py-8 text-center text-sm text-muted-foreground">
                No page data for this range.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-lg">
                Traffic sources
              </CardTitle>
              <CardDescription>Visits by referring hostname.</CardDescription>
            </CardHeader>
            <CardContent>
              <div v-if="webAnalytics.referrers?.length" class="space-y-4">
                <div v-for="item in webAnalytics.referrers" :key="item.label" class="space-y-1.5">
                  <div class="flex items-center justify-between gap-3 text-sm">
                    <span class="min-w-0 truncate font-medium" :title="item.label">{{ item.label }}</span>
                    <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatNumber(item.value) }} visits</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div class="h-full rounded-full bg-blue-500" :style="{ width: `${Math.max(item.percent, 2)}%` }" />
                  </div>
                </div>
              </div>
              <p v-else class="py-8 text-center text-sm text-muted-foreground">
                No referral data for this range.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card v-else-if="hasZoneAnalytics" class="border-dashed">
          <CardContent class="flex items-start gap-3 py-5">
            <Activity class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 class="font-semibold">
                Page and source detail needs Web Analytics
              </h2>
              <p class="mt-1 text-sm text-muted-foreground">
                Zone traffic is available, but exact hostname paths, referrers, devices, and operating systems require Cloudflare Web Analytics and Account Analytics Read permission.
              </p>
            </div>
          </CardContent>
        </Card>

        <div v-if="hasWebAnalytics" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card
            v-for="section in [
              { key: 'countries', title: 'Countries', icon: Globe2 },
              { key: 'devices', title: 'Devices', icon: MonitorSmartphone },
              { key: 'browsers', title: 'Browsers', icon: Activity },
              { key: 'operatingSystems', title: 'Operating systems', icon: Gauge },
            ]"
            :key="section.key"
          >
            <CardHeader class="pb-3">
              <CardTitle class="flex items-center gap-2 text-base">
                <component :is="section.icon" class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {{ section.title }}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div v-if="webAnalytics[section.key]?.length" class="space-y-3">
                <div v-for="item in webAnalytics[section.key].slice(0, 6)" :key="item.label">
                  <div class="flex items-center justify-between gap-2 text-xs">
                    <span class="truncate font-medium" :title="item.label">{{ item.label }}</span>
                    <span class="tabular-nums text-muted-foreground">{{ formatNumber(item.value) }}</span>
                  </div>
                  <div class="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div class="h-full rounded-full bg-slate-600 dark:bg-slate-400" :style="{ width: `${Math.max(item.percent, 2)}%` }" />
                  </div>
                </div>
              </div>
              <p v-else class="py-5 text-center text-xs text-muted-foreground">
                No data
              </p>
            </CardContent>
          </Card>
        </div>

        <Card v-if="vitalCards.length">
          <CardHeader>
            <CardTitle class="text-lg">
              Core Web Vitals
            </CardTitle>
            <CardDescription>75th-percentile real-user performance for this hostname.</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4 md:grid-cols-3">
            <div v-for="vital in vitalCards" :key="vital.shortLabel" class="rounded-lg border border-border/70 p-4">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ vital.shortLabel }}</span>
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-800">{{ vital.status }}</span>
              </div>
              <div class="mt-2 text-2xl font-semibold tabular-nums">
                {{ vital.display }}
              </div>
              <div class="mt-1 text-xs text-muted-foreground">
                {{ vital.label }}
              </div>
              <div v-if="vital.goodPercent !== null" class="mt-3 text-xs text-muted-foreground">
                {{ formatNumber(vital.goodPercent) }}% of measurements rated good
              </div>
            </div>
          </CardContent>
        </Card>

        <Card v-if="hasZoneAnalytics">
          <CardHeader>
            <CardTitle class="text-lg">
              Cloudflare zone health
            </CardTitle>
            <CardDescription>
              Operational HTTP totals for {{ state.dashboard.zone?.name }}. These include the entire zone, assets, and automated traffic.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-5">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-lg border border-border/70 p-4">
                <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Requests
                </div>
                <div class="mt-2 text-2xl font-semibold tabular-nums">
                  {{ formatNumber(zoneAnalytics.totals.requests) }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 p-4">
                <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Data transfer
                </div>
                <div class="mt-2 text-2xl font-semibold tabular-nums">
                  {{ formatBytes(zoneAnalytics.totals.bytes) }}
                </div>
              </div>
              <div class="rounded-lg border border-border/70 p-4">
                <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cached requests
                </div>
                <div class="mt-2 text-2xl font-semibold tabular-nums">
                  {{ formatNumber(zoneAnalytics.totals.cacheRate) }}%
                </div>
              </div>
            </div>
            <div v-if="zoneAnalytics.statuses?.length">
              <h3 class="mb-3 text-sm font-semibold">
                Response status distribution
              </h3>
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div v-for="status in zoneAnalytics.statuses" :key="status.label" class="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                  <span class="font-mono font-medium">HTTP {{ status.label }}</span>
                  <span class="tabular-nums text-muted-foreground">{{ formatNumber(status.value) }}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card v-if="!hasAnyData && state.dashboard.status === 'no-data'" class="border-dashed">
          <CardContent class="flex flex-col items-center gap-2 py-12 text-center">
            <BarChart3 class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 class="font-semibold">
              No analytics data yet
            </h2>
            <p class="max-w-2xl text-sm text-muted-foreground">
              Cloudflare recognizes this hostname, but no traffic was returned for the selected range. Web Analytics may still need to be enabled for the site.
            </p>
          </CardContent>
        </Card>
      </template>
    </div>
  </div>
</template>
