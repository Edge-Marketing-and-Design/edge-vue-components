// Runtime package/env inputs. Only source text, manifests and lock metadata are
// read; application modules and historical package code never execute.
const fs = require('node:fs')
const path = require('node:path')
const { builtinModules } = require('node:module')
const { parseEnv } = require('node:util')
const { createHash } = require('node:crypto')
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex')
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))

function createRuntimeInputs({ sourceDir, allFiles, ignoredEnvironmentKeys = [] }) {
  const ignored = new Set(ignoredEnvironmentKeys)
  const readJson = file => JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'))
  const manifest = readJson('package.json')
  let lock = null
  try { lock = readJson('package-lock.json') } catch { /* Missing/invalid locks remain conservative below. */ }
  const sections = ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta']
  const sharedManifest = Object.fromEntries(Object.entries(manifest).filter(([key]) => !sections.includes(key)))
  const envFiles = allFiles.filter(file => path.dirname(file) === sourceDir && /^\.env(?:\..+)?$/.test(path.basename(file)) && !['.env.dev', '.env.local'].includes(path.basename(file)))
    .map(file => [path.relative(sourceDir, file), parseEnv(fs.readFileSync(file, 'utf8'))])
  const memo = new Map()
  const validLock = [2, 3].includes(lock?.lockfileVersion) && lock.packages && typeof lock.packages === 'object'
  function locate(name, from = '') {
    let directory = from
    while (directory && directory !== '.') {
      const candidate = `${directory}/node_modules/${name}`
      if (lock.packages[candidate]) return candidate
      directory = path.posix.dirname(directory)
    }
    return lock.packages[`node_modules/${name}`] ? `node_modules/${name}` : null
  }
  function dependency(name) {
    if (memo.has(name)) return memo.get(name)
    if (!validLock) return null
    const location = locate(name)
    if (!location) return null
    const seen = new Set(), tuples = []
    let unresolved = false
    function visit(at) {
      if (seen.has(at)) return
      seen.add(at)
      const entry = lock.packages[at]
      if (entry?.link || /^(?:file:|link:|workspace:)/.test(entry?.resolved || ''))
        throw new Error(`Cannot prove immutable lock inputs for local runtime package ${name}; use a published locked package before deploying.`)
      if (!entry || (entry.bundledDependencies && !Array.isArray(entry.bundledDependencies))) { unresolved = true; return }
      tuples.push([at, sorted(Object.fromEntries(Object.entries(entry).filter(([key]) => !['dev', 'devOptional', 'license', 'funding', 'deprecated'].includes(key))))])
      const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies }
      for (const next of Object.keys(deps).sort()) {
        const found = locate(next, at)
        if (found) visit(found)
        else if (!Object.hasOwn(entry.optionalDependencies || {}, next) && !entry.peerDependenciesMeta?.[next]?.optional) unresolved = true
      }
    }
    visit(location)
    const declared = Object.fromEntries(sections.filter(section => manifest[section]?.[name] !== undefined).map(section => [section, manifest[section][name]]))
    const result = unresolved ? null : { version: String(lock.packages[location].version || ''), hash: hash([declared, tuples.sort(([a], [b]) => a.localeCompare(b))]) }
    memo.set(name, result)
    return result
  }
  return (graph, conservative = false) => {
    const fallback = conservative || !!graph?.fallbacks?.length
    const names = fallback ? [...new Set(sections.flatMap(section => Object.keys(manifest[section] || {})))]
      : [...new Set((graph?.externals || []).filter(specifier => !builtins.has(specifier) && !specifier.startsWith('node:')).map(packageName))]
    const packages = {}, environment = {}, configuration = { 'package runtime/build settings': hash(sharedManifest) }
    for (const name of names.sort()) {
      const input = dependency(name)
      if (input) packages[name] = input
      else {
        // Never skip a runtime change because a package or peer cannot be resolved.
        configuration['unresolved package/lock inputs'] = hash([manifest, lock])
        packages[name] = { version: '(unresolved)', hash: hash([manifest, lock]) }
      }
    }
    // Lock format changes can change install semantics even if entries match.
    configuration['package-lock format'] = hash(lock?.lockfileVersion ?? null)
    // Third-party SDKs read environment variables internally, outside our source
    // graph. Keep production values global rather than guessing their consumers.
    // Parse values so comments/formatting do not cause a deployment.
    for (const [file, values] of envFiles) {
      for (const name of Object.keys(values).sort()) if (!ignored.has(name)) environment[`${file}:${name}`] = hash(values[name])
    }
    // Runtime overrides are already value-hashed by the handler tracer.
    for (const [name, valueHash] of graph?.environment || []) environment[`runtime:${name}`] = valueHash
    return { configuration: sorted(configuration), packages: sorted(packages), environment: sorted(environment) }
  }
}

function describeInputChanges(before, after) {
  if (!before || !after) return []
  const changes = []
  for (const kind of ['configuration', 'environment', 'packages', 'sources']) {
    for (const name of new Set([...Object.keys(before[kind] || {}), ...Object.keys(after[kind] || {})])) {
      const old = before[kind]?.[name], next = after[kind]?.[name]
      if (JSON.stringify(old) === JSON.stringify(next)) continue
      if (kind === 'packages') changes.push(`package ${name}: ${old?.version || '(not used)'} -> ${next?.version || '(not used)'}${old?.version === next?.version ? ' (locked dependencies changed)' : ''}`)
      else changes.push(`${kind === 'environment' ? 'environment key' : kind === 'sources' ? 'source' : 'configuration'} ${name}`)
    }
  }
  return changes.sort()
}
module.exports = { createRuntimeInputs, describeInputChanges }
