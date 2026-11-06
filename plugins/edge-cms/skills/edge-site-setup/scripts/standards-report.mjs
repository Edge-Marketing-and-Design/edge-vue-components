#!/usr/bin/env node
// Evaluates a standards file (site-standards.json, or edge-site-launch's
// launch-standards.json) against what was gathered about a site:
//
//   node edge/skills/edge-site-setup/scripts/standards-report.mjs \
//     --standards edge/skills/edge-site-setup/site-standards.json \
//     --readiness readiness.json   # cms_site_readiness output
//     [--site site.json]           # the draft site document (firestore_get_document data)
//     [--answers answers.json]     # the setup answers (answers.template.json)
//     [--results results.json]     # launch: { "<item id>": { "ok": true|false, "evidence": "..." } }
//     [--json]
//
// Each item comes back `done`, `open` (with the reasons), `person` (a person
// does it; done only when results record it) or `unchecked` (nothing given
// to check it with). The exit code is 1 while any agent item is open or
// unchecked.
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const filled = value => !(value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length))
const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].map(String).sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].map(String).sort() : b)

// Page names in the site's menus (slugs and menu titles), for answers.pages.
const menuNames = (menus) => {
  const names = new Set()
  const visit = (entries) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const name of [entry?.name, entry?.menuTitle])
        if (name)
          names.add(String(name).toLowerCase())
      if (entry?.item && typeof entry.item === 'object' && entry.item.type !== 'external')
        Object.values(entry.item).forEach(visit)
    }
  }
  Object.values(menus && typeof menus === 'object' ? menus : {}).forEach(visit)
  return names
}

export const evaluateStandards = ({ standards, readiness = null, site = null, answers = null, results = {} }) => standards.items.map((item) => {
  const result = results[item.id]
  if (item.person) {
    if (result?.ok === true)
      return { id: item.id, rule: item.rule, status: 'done', evidence: result.evidence || '', person: true }
    return { id: item.id, rule: item.rule, status: 'person', person: true, ...(result?.evidence ? { evidence: result.evidence } : {}) }
  }
  const reasons = []
  let checked = false
  if (item.check?.readiness && readiness) {
    checked = true
    const scope = item.check.scope
    const hits = (readiness.items || []).filter(entry => item.check.readiness.includes(entry.code)
      && (scope === 'site' ? !entry.pageId : scope === 'pages' ? !!entry.pageId : true))
    reasons.push(...hits.map(entry => `${entry.code}: ${entry.message}`))
  }
  if (item.check?.answers && answers && site) {
    for (const field of item.check.answers.filter(name => filled(answers[name]))) {
      checked = true
      if (field === 'pages') {
        const names = menuNames(site.menus)
        const missing = answers.pages.filter(page => !names.has(String(page).toLowerCase()))
        if (missing.length)
          reasons.push(`pages missing from the menus: ${missing.join(', ')}`)
      }
      else if (field === 'sitemapPosts') {
        const stored = site.sitemap?.posts || {}
        const off = Object.entries(answers.sitemapPosts || {}).filter(([key, enabled]) => stored[key] !== enabled).map(([key]) => key)
        if (off.length)
          reasons.push(`sitemap choices differ from the answers: ${off.join(', ')} (site.settings sitemap.posts)`)
      }
      else if (!same(site[field], answers[field])) {
        reasons.push(`${field} is ${JSON.stringify(site[field] ?? null)}, the answers say ${JSON.stringify(answers[field])}`)
      }
    }
  }
  if (item.check?.results) {
    if (result) {
      checked = true
      if (result.ok !== true)
        reasons.push(result.evidence || 'failed')
    }
  }
  // An item that needs a recorded result stays unchecked without one, even
  // when its readiness codes are clear.
  if (!checked || (item.check?.results && !result && !reasons.length))
    return { id: item.id, rule: item.rule, status: 'unchecked' }
  return { id: item.id, rule: item.rule, status: reasons.length ? 'open' : 'done', ...(reasons.length ? { reasons } : {}), ...(result?.evidence && !reasons.length ? { evidence: result.evidence } : {}) }
})

export const formatStandards = (rows) => {
  const lines = ['| Item | Status | Detail |', '| --- | --- | --- |']
  for (const row of rows)
    lines.push(`| ${row.id} | ${row.status}${row.person ? ' (person)' : ''} | ${(row.reasons || [row.evidence || row.rule]).join('; ').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  const open = rows.filter(row => ['open', 'unchecked'].includes(row.status)).map(row => row.id)
  lines.push('', open.length ? `Open: ${open.join(', ')}` : 'Every agent item is done.')
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const read = (name) => {
    const at = args.indexOf(name)
    return at < 0 ? null : JSON.parse(readFileSync(args[at + 1], 'utf8'))
  }
  const standards = read('--standards')
  if (!standards) {
    console.error('--standards <file> is required.')
    process.exit(2)
  }
  const rows = evaluateStandards({ standards, readiness: read('--readiness'), site: read('--site'), answers: read('--answers'), results: read('--results') || {} })
  console.log(args.includes('--json') ? JSON.stringify(rows, null, 2) : formatStandards(rows))
  process.exitCode = rows.some(row => ['open', 'unchecked'].includes(row.status)) ? 1 : 0
}
