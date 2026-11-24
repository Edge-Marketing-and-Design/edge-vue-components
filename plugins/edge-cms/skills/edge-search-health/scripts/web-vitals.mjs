#!/usr/bin/env node
// Real-user Core Web Vitals from the Chrome UX Report (CrUX): the 75th
// percentile Google grades on, for the whole site and for pages with enough
// traffic, phone and desktop. Search Console's Core Web Vitals report uses
// the same data, grouped by similar URLs.
//
//   node edge/skills/edge-search-health/scripts/web-vitals.mjs --host www.example.com [--pages /,/about/]
//
// Needs a Google API key restricted to the Chrome UX Report API, from
// EDGE_PAGESPEED_API_KEY or ~/.config/edge-search-console/pagespeed-api-key
// (reference/search-console-setup.md). The key is never printed.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const API_KEY_FILE = join(homedir(), '.config', 'edge-search-console', 'pagespeed-api-key')

// Google's thresholds: good up to the first value, poor above the second.
export const THRESHOLDS = {
  largest_contentful_paint: { label: 'LCP', unit: 'ms', good: 2500, poor: 4000 },
  interaction_to_next_paint: { label: 'INP', unit: 'ms', good: 200, poor: 500 },
  cumulative_layout_shift: { label: 'CLS', unit: '', good: 0.1, poor: 0.25 },
}

export const loadApiKey = (explicit = '') => {
  if (explicit)
    return explicit
  if (process.env.EDGE_PAGESPEED_API_KEY)
    return process.env.EDGE_PAGESPEED_API_KEY.trim()
  if (existsSync(API_KEY_FILE)) {
    const key = readFileSync(API_KEY_FILE, 'utf8').trim()
    if (/^AIza[\w-]{35}$/.test(key))
      return key
  }
  return ''
}

export const rate = (metric, value) => {
  const threshold = THRESHOLDS[metric]
  if (value === undefined || value === null)
    return null
  return Number(value) <= threshold.good ? 'good' : Number(value) <= threshold.poor ? 'needs-improvement' : 'poor'
}

// { metric: { p75, rating } } from a CrUX record.
export const summarizeRecord = record => Object.fromEntries(Object.keys(THRESHOLDS)
  .filter(metric => record?.metrics?.[metric]?.percentiles?.p75 !== undefined)
  .map((metric) => {
    const p75 = Number(record.metrics[metric].percentiles.p75)
    return [metric, { p75, rating: rate(metric, p75) }]
  }))

export const queryCrux = async (target, { key, formFactor = 'PHONE', fetcher = fetch } = {}) => {
  const response = await fetcher(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...target, formFactor }),
  })
  if (response.status === 404)
    return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(`Chrome UX Report ${response.status}: ${data.error?.message || response.statusText}`)
  return data.record
}

// Problems per metric: poor is an error, needs improvement a warning.
export const judgeVitals = (scope, formFactor, summary, url = '') => Object.entries(summary)
  .filter(([, { rating }]) => rating !== 'good')
  .map(([metric, { p75, rating }]) => ({
    severity: rating === 'poor' ? 'error' : 'warning',
    code: `cwv-${THRESHOLDS[metric].label.toLowerCase()}`,
    url,
    detail: `${scope} ${formFactor.toLowerCase()}: ${THRESHOLDS[metric].label} ${THRESHOLDS[metric].unit === 'ms' ? `${(p75 / 1000).toFixed(2)} s` : p75} is ${rating.replace('-', ' ')} (good ≤ ${THRESHOLDS[metric].unit === 'ms' ? `${THRESHOLDS[metric].good / 1000} s` : THRESHOLDS[metric].good}, poor > ${THRESHOLDS[metric].unit === 'ms' ? `${THRESHOLDS[metric].poor / 1000} s` : THRESHOLDS[metric].poor})`,
  }))

export const checkWebVitals = async ({ origin, urls = [], key = loadApiKey(), fetcher = fetch }) => {
  if (!key)
    return { available: false, problems: [{ severity: 'warning', code: 'cwv-unavailable', detail: 'No Chrome UX Report API key; real-user Core Web Vitals were not checked (reference/search-console-setup.md).' }] }
  const site = {}
  const pages = []
  const problems = []
  for (const formFactor of ['PHONE', 'DESKTOP']) {
    const record = await queryCrux({ origin }, { key, formFactor, fetcher })
    site[formFactor] = record ? { ...summarizeRecord(record), period: record.collectionPeriod } : null
    if (record)
      problems.push(...judgeVitals('Site', formFactor, summarizeRecord(record)))
  }
  for (const url of urls) {
    const record = await queryCrux({ url }, { key, formFactor: 'PHONE', fetcher })
    const summary = record ? summarizeRecord(record) : null
    pages.push({ url, phone: summary })
    if (summary)
      problems.push(...judgeVitals(new URL(url).pathname, 'PHONE', summary, url))
  }
  return { available: true, site, pages, problems }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const host = value('--host')
  if (!host) {
    console.error('Usage: web-vitals.mjs --host www.example.com [--pages /,/about/]')
    process.exit(2)
  }
  try {
    const origin = `https://${host}`
    const urls = (value('--pages') || '').split(',').map(page => page.trim()).filter(Boolean).map(page => new URL(page, `${origin}/`).href)
    console.log(JSON.stringify(await checkWebVitals({ origin, urls }), null, 2))
  }
  catch (error) {
    console.error(error.message)
    process.exit(2)
  }
}
