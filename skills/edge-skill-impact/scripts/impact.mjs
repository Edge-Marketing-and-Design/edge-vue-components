#!/usr/bin/env node
// Which documents a code change may have made wrong, from the knowledge map
// (edge/skills/knowledge-map.json). Run from a Hub checkout:
//
//   node edge/skills/edge-skill-impact/scripts/impact.mjs            # this branch + working tree vs origin/main
//   node edge/skills/edge-skill-impact/scripts/impact.mjs --range A..B
//   node edge/skills/edge-skill-impact/scripts/impact.mjs --base main --json
//
// A range whose ends are edge-vue-components commits (the subtree's own
// history, as merged into a Hub) is compared against the Hub's `edge/` tree
// and reported with `edge/` paths.
//
// The report lists, per map area the change touches: the changed code, each
// document with whether the change edited it and what it currently says (the
// section's opening lines), the area's probe, and `needsReview` when code
// changed but none of the area's documents in this checkout did. A commit in
// the range with the trailer `Skill-Impact: none (<reason>)` records that a
// developer decided no document changes; it is reported, and the backstop
// test (edge/tests/skillImpact.test.mjs) accepts it. Changed files that look
// like system behavior but match no area are listed as `unmapped`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const git = (root, args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe'] })
const tryGit = (root, args) => {
  try {
    return git(root, args, { quiet: true })
  }
  catch {
    return null
  }
}

// ---- Matching (pure) ----

export const globToRegExp = (glob) => {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      out += '.*'
      i += 1
      if (glob[i + 1] === '/')
        i += 1
    }
    else if (char === '*') {
      out += '[^/]*'
    }
    else if (char === '?') {
      out += '[^/]'
    }
    else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

const codeEntries = area => (area.code || []).map(entry => (typeof entry === 'string' ? { path: entry } : entry))

// Whether a changed file counts for a code entry: its path matches, and with
// a diffPattern, one of its changed lines matches the pattern.
const entryMatches = (entry, change) => {
  if (!globToRegExp(entry.path).test(change.path))
    return false
  if (!entry.diffPattern)
    return true
  const pattern = new RegExp(entry.diffPattern)
  return (change.diffLines || []).some(line => pattern.test(line))
}

// Paths that look like shared system behavior, for the unmapped list.
export const SYSTEM_CODE = [
  'edge/lib/**',
  'edge/components/cms/**',
  'edge/composables/**',
  'edge/tools/mcp/cms/src/**',
  'functions/cms*.js',
  'functions/helpers/cms*',
  'edge/functions/**',
].map(globToRegExp)
// Copies and generated files: never a change of their own.
const COPIES = [
  /^edge\/functions\//,
  /^functions\/helpers\/cmsOperations\.mjs$/,
  /^functions\/helpers\/cmsBlockValidation\.mjs$/,
  /^functions\/helpers\/cmsAgentMcpTools\.mjs$/,
  /^edge\/plugins\/edge-cms\/skills\//,
  /^functions\/agent-contracts\//,
  /^functions\/agentGuide\//,
]

export const SKILL_IMPACT_TRAILER = /^Skill-Impact:\s*none\s*\((.+)\)\s*$/im

// The report for a set of changes.
// - map: the knowledge map
// - changes: [{ path, diffLines? }] (repo-relative)
// - messages: commit messages in the range (for the trailer)
// - readDocument(doc): the document's current text, or null
export const impactReport = ({ map, changes, messages = [], readDocument = () => null }) => {
  const changed = new Set(changes.map(change => change.path))
  const areas = []
  const matched = new Set()
  for (const area of map.areas || []) {
    const code = changes.filter(change => codeEntries(area).some(entry => entryMatches(entry, change)))
    if (!code.length)
      continue
    code.forEach(change => matched.add(change.path))
    const documents = (area.documents || []).map((doc) => {
      const local = !doc.repo
      const text = readDocument(doc)
      return {
        ...doc,
        changed: local ? changed.has(doc.path) : null,
        exists: text !== null,
        current: text === null ? null : sectionExcerpt(text, doc.section),
      }
    })
    const localDocs = documents.filter(doc => !doc.repo)
    areas.push({
      id: area.id,
      name: area.name,
      code: code.map(change => change.path),
      documents,
      ...(area.probe ? { probe: area.probe } : {}),
      needsReview: !localDocs.some(doc => doc.changed),
    })
  }
  const unmapped = changes
    .map(change => change.path)
    .filter(file => !matched.has(file) && !COPIES.some(pattern => pattern.test(file)) && SYSTEM_CODE.some(pattern => pattern.test(file)))
  const waivers = messages.map(message => message.match(SKILL_IMPACT_TRAILER)?.[1]).filter(Boolean)
  return {
    areas,
    unmapped,
    waivers,
    ok: waivers.length > 0 || areas.every(area => !area.needsReview),
  }
}

// A section's heading and opening lines, or the file's opening when no
// section is named. null when the section is missing.
export const sectionExcerpt = (text, section, lines = 12) => {
  const all = String(text).split('\n')
  if (!section)
    return all.slice(0, lines).join('\n')
  const start = all.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim() === section)
  if (start < 0)
    return null
  const level = all[start].match(/^#+/)[0].length
  const end = all.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line))
  return all.slice(start, end < 0 ? undefined : Math.min(end, start + lines)).join('\n')
}

// ---- Git ----

export const repoRoot = (cwd = process.cwd()) => git(cwd, ['rev-parse', '--show-toplevel']).trim()

// A commit of the edge-vue-components history itself (merged into the Hub as
// a subtree): it has the shared files at its root, not under edge/.
const isSubtreeCommit = (root, ref) => tryGit(root, ['cat-file', '-e', `${ref}:edge`]) === null && tryGit(root, ['cat-file', '-e', `${ref}:lib/cmsOperations.js`]) !== null

const diffLinesByFile = (patch, prefix = '') => {
  const files = new Map()
  let current = null
  for (const line of patch.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (header) {
      current = `${prefix}${header[2]}`
      files.set(current, [])
      continue
    }
    if (current && /^[+-](?![+-]{2}\s)/.test(line))
      files.get(current).push(line.slice(1))
  }
  return [...files].map(([file, diffLines]) => ({ path: file, diffLines }))
}

const untrackedChanges = (root) => {
  const names = (tryGit(root, ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean)
  return names.map((file) => {
    let text = ''
    try {
      text = readFileSync(path.join(root, file), 'utf8')
    }
    catch {}
    return { path: file, diffLines: text.split('\n') }
  })
}

// Changed files with their changed lines.
// - range "A..B": A to B (subtree-aware)
// - otherwise: merge-base(base, HEAD) to the working tree, untracked files
//   included (base defaults to origin/main)
export const gitChanges = ({ root, range = null, base = 'origin/main' }) => {
  if (range) {
    const [from, to = 'HEAD'] = range.split('..')
    const fromSub = isSubtreeCommit(root, from)
    const toSub = isSubtreeCommit(root, to)
    if (fromSub && !toSub)
      return diffLinesByFile(git(root, ['diff', '--no-color', '--no-renames', from, `${to}:edge`]), 'edge/')
    if (!fromSub && toSub)
      return diffLinesByFile(git(root, ['diff', '--no-color', '--no-renames', `${from}:edge`, to]), 'edge/')
    return diffLinesByFile(git(root, ['diff', '--no-color', '--no-renames', from, to]), fromSub ? 'edge/' : '')
  }
  const mergeBase = tryGit(root, ['merge-base', base, 'HEAD'])
  if (!mergeBase)
    throw new Error(`No merge base with ${base}; fetch it or pass --range.`)
  const tracked = diffLinesByFile(git(root, ['diff', '--no-color', '--no-renames', mergeBase.trim()]))
  return [...tracked, ...untrackedChanges(root)]
}

export const commitMessages = ({ root, range = null, base = 'origin/main' }) => {
  const spec = range || `${base}..HEAD`
  const out = tryGit(root, ['log', '--format=%B%x00', spec])
  return out === null ? [] : out.split('\0').map(message => message.trim()).filter(Boolean)
}

export const loadMap = root => JSON.parse(readFileSync(path.join(root, 'edge/skills/knowledge-map.json'), 'utf8'))

// Sibling checkouts (emd-cms-front) sit next to the Hub's main checkout,
// which a worktree finds through its common git directory.
export const mainCheckout = (root) => {
  const common = tryGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return common ? path.dirname(common.trim()) : root
}
export const siblingRoot = root => path.dirname(mainCheckout(root))

export const documentReader = (root, ref = null) => (doc) => {
  if (doc.repo) {
    const file = path.join(siblingRoot(root), doc.repo, doc.path)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }
  if (ref) {
    const text = tryGit(root, ['show', `${ref}:${doc.path}`])
    if (text !== null)
      return text
    // An edge-vue-components commit holds edge/ files at its root.
    return doc.path.startsWith('edge/') ? tryGit(root, ['show', `${ref}:${doc.path.slice(5)}`]) : null
  }
  const file = path.join(root, doc.path)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

// ---- CLI ----

const formatReport = (report, { range, base }) => {
  const lines = [`Skill impact: ${range ? `range ${range}` : `this branch and working tree vs ${base}`}`]
  if (!report.areas.length)
    lines.push('', 'No mapped area changed.')
  for (const area of report.areas) {
    lines.push('', `## ${area.name} (${area.id})${area.needsReview ? ' - NEEDS REVIEW: no document in this checkout changed' : ''}`)
    lines.push(`Code: ${area.code.join(', ')}`)
    if (area.probe)
      lines.push(`Probe (shows the real behavior): node ${area.probe}`)
    for (const doc of area.documents) {
      const where = `${doc.repo ? `${doc.repo}:` : ''}${doc.path}${doc.section ? ` > ${doc.section}` : ''}`
      const status = doc.repo ? 'other repo' : (doc.changed ? 'changed' : 'unchanged')
      lines.push(`- [${status}] ${where}`, `  Says: ${doc.says}`)
      if (doc.current === null)
        lines.push(`  ${doc.exists ? 'Section not found: the map or the document needs an update.' : 'Not readable from this checkout.'}`)
    }
  }
  if (report.unmapped.length)
    lines.push('', '## Unmapped system code', ...report.unmapped.map(file => `- ${file}: propose a knowledge-map entry, or confirm it changes no documented behavior`))
  if (report.waivers.length)
    lines.push('', `Skill-Impact waivers: ${report.waivers.join('; ')}`)
  lines.push('', report.ok ? 'Result: every touched area has a document change or a waiver.' : 'Result: review the areas marked NEEDS REVIEW.')
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const range = value('--range')
  const base = value('--base') || 'origin/main'
  const root = repoRoot()
  const map = loadMap(root)
  const report = impactReport({
    map,
    changes: gitChanges({ root, range, base }),
    messages: commitMessages({ root, range, base }),
    readDocument: documentReader(root, range ? (range.split('..')[1] || 'HEAD') : null),
  })
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report, { range, base }))
  process.exitCode = report.ok ? 0 : 1
}
