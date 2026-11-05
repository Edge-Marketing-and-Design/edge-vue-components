// Pure local dependency selection. No Function handlers or cloud APIs run here.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parse } = require('acorn')
const { createHandlerTracer } = require('./function-deploy-dependencies.cjs')
const { createRuntimeInputs, describeInputChanges } = require('./function-deploy-runtime-inputs.cjs')

const { readRetiredEnvironmentKeys } = require('./function-deploy-config.cjs')

const VERSION = 7
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, VERSION]
const fingerprintAtVersion = (item, version) => version === 1 ? item.legacyFingerprint
  : version === 2 ? item.moduleFingerprint : version === 3 ? item.handlerV3Fingerprint
    : version === 4 ? item.handlerV4Fingerprint : version === 5 ? item.handlerV5Fingerprint : version === 6 ? item.handlerV6Fingerprint : item.fingerprint
const transientInput = file => /^(?:\.DS_Store|\.env\.(?:dev|local)|[a-z0-9-]+-debug(?:\.[^.]+)*\.log)$/.test(path.basename(file))
const digest = value => createHash('sha256').update(value).digest('hex')
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const value of Object.values(node))
    if (Array.isArray(value)) value.forEach(child => walk(child, visit))
    else if (value && typeof value === 'object') walk(value, visit)
}
const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null
const requirePath = node => node?.type === 'CallExpression' && node.callee?.name === 'require' ? literal(node.arguments[0]) : null
const property = node => node?.computed ? literal(node.property) : node?.property?.name

function buildInventory(root, endpoints, env = process.env, { formats = SUPPORTED_VERSIONS, explain = false, retiredEnvironmentKeys = readRetiredEnvironmentKeys(root) } = {}) {
  const sourceDir = path.join(root, 'functions')
  const allFiles = []
  function list(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name) || /^firebase-debug/.test(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Functions source symlinks are unsupported: ${path.relative(root, file)}`)
      if (entry.isDirectory()) list(file)
      else allFiles.push(file)
    }
  }
  list(sourceDir)
  const fileInputs = new Map()
  const hashFiles = (files, legacy = false) => [...new Set(files)].filter(file => legacy || !transientInput(file)).sort().map((file) => {
    if (!fileInputs.has(file)) fileInputs.set(file, { mode: fs.statSync(file).mode & 0o777, hash: digest(fs.readFileSync(file)) })
    const { mode, hash } = fileInputs.get(file)
    return [path.relative(root, file), legacy ? mode : (mode & 0o111 ? 0o755 : 0o644), hash]
  })
  const asts = new Map()
  const dependencies = new Map()
  const runtimeAssets = new Map()
  const ownedAssets = new Set()
  const environmentNames = new Set(['NODE_ENV', 'FIREBASE_STORE_REGION', 'FIREBASE_STORAGE_BUCKET_REGION'])
  const uncertain = new Set()
  const externalInputs = new Set()
  function resolve(from, specifier) {
    if (!specifier.startsWith('.')) return null
    const base = path.resolve(path.dirname(from), specifier)
    if (!base.startsWith(path.resolve(root) + path.sep)) throw new Error('A dependency leaves the repository; cannot safely fingerprint it')
    const file = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`, path.join(base, 'index.js')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!file) uncertain.add(`Unresolved dependency: ${path.relative(root, from)} -> ${specifier}`)
    if (file && !file.startsWith(sourceDir + path.sep)) externalInputs.add(file)
    return file || null
  }
  // Scan production code, not tests, for literal dependencies and env overrides.
  function scan(file) {
    if (dependencies.has(file)) return
    const deps = []
    dependencies.set(file, deps)
    if (!/\.(?:js|cjs|mjs)$/.test(file)) return
    let ast
    try {
      ast = parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: file.endsWith('.mjs') ? 'module' : 'script', allowHashBang: true, ranges: true })
    } catch {
      uncertain.add(`Unparsed source: ${path.relative(root, file)}`)
      return
    }
    asts.set(file, ast)
    walk(ast, node => {
      let specifier
      if (node.type === 'CallExpression' && node.callee?.name === 'require') {
        specifier = literal(node.arguments[0])
        if (!specifier) uncertain.add(`Dynamic require: ${path.relative(root, file)}`)
      } else if (node.type === 'ImportExpression') {
        specifier = literal(node.source)
        if (!specifier) uncertain.add(`Dynamic import: ${path.relative(root, file)}`)
      } else if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)
        specifier = literal(node.source)
      if (specifier) {
        const dependency = resolve(file, specifier)
        if (dependency) {
          deps.push(dependency)
          if (!/\.(?:js|cjs|mjs)$/.test(dependency)) ownedAssets.add(dependency)
        }
      }
      // path.join(__dirname, 'literal', ...) names files read at runtime, such
      // as Markdown bundles, which the global asset hash leaves out.
      if (node.type === 'CallExpression' && node.callee?.object?.name === 'path'
        && ['join', 'resolve'].includes(property(node.callee)) && node.arguments[0]?.name === '__dirname'
        && node.arguments.length > 1 && node.arguments.slice(1).every(literal)) {
        const target = path.join(path.dirname(file), ...node.arguments.slice(1).map(literal))
        const files = allFiles.map(candidate => path.resolve(candidate)).filter(candidate => candidate === target || candidate.startsWith(target + path.sep))
        runtimeAssets.set(`${file}:${node.start}`, files)
        files.forEach(candidate => ownedAssets.add(candidate))
        deps.push(...files)
      }
      if (node.type === 'MemberExpression' && node.object?.type === 'MemberExpression'
        && node.object.object?.name === 'process' && property(node.object) === 'env') {
        const name = property(node)
        if (name) environmentNames.add(name)
        else uncertain.add('Dynamic process.env access')
      }
    })
    deps.forEach(scan)
  }
  const entry = path.join(sourceDir, 'index.js')
  scan(entry)
  const bindings = new Map()
  const groups = new Map()
  const resolveExpression = node => {
    const specifier = requirePath(node)
    if (specifier) return resolve(entry, specifier)
    if (node?.type === 'Identifier') return bindings.get(node.name)
    if (node?.type === 'MemberExpression') return resolveExpression(node.object)
    return null
  }
  for (const statement of asts.get(entry)?.body || []) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        const file = resolveExpression(declaration.init)
        if (!file) continue
        if (declaration.id.type === 'Identifier') bindings.set(declaration.id.name, file)
        else if (declaration.id.type === 'ObjectPattern')
          for (const item of declaration.id.properties) if (item.value?.type === 'Identifier') bindings.set(item.value.name, file)
      }
    }
    const expression = statement.expression
    if (expression?.type === 'AssignmentExpression' && expression.left?.object?.name === 'exports')
      groups.set(property(expression.left), resolveExpression(expression.right))
  }
  function closure(file, seen = new Set()) {
    if (!file || seen.has(file)) return seen
    seen.add(file)
    for (const dependency of dependencies.get(file) || []) closure(dependency, seen)
    return seen
  }
  // Preserve the old global asset set for exact legacy checkpoint proofs.
  // Current-format ownership is applied below, after dependency scanning.
  const assets = allFiles.filter(file => !/\.(?:js|cjs|mjs)$/.test(file)
    && !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path.relative(sourceDir, file))
    && !/\.md$|(?:^|\/)\.env\.dev$/.test(file))
  const configFiles = ['firebase.json', '.firebaserc'].map(file => path.join(root, file)).filter(fs.existsSync)
  for (const endpoint of Object.values(endpoints)) {
    const group = endpoint.entryPoint?.split('.')[0]
    if (!groups.get(group)) uncertain.add(`Unresolved endpoint group: ${group || '(missing)'}`)
  }
  const commonFiles = [entry, ...assets, ...configFiles, ...externalInputs,
    ...[...dependencies.get(entry) || []].filter(file => ![...groups.values()].includes(file)).flatMap(file => [...closure(file)])]
  const environment = [...environmentNames].sort().map(name => [name, digest(String(env[name] ?? ''))])
  const moduleCommon = {
    version: 2,
    configuration: hashFiles(commonFiles),
    environment,
  }
  // V1 is used only to prove an existing successful checkpoint still matches.
  // Never promote a mismatched legacy record merely to avoid a deployment.
  const legacyCommon = {
    version: 1,
    configuration: hashFiles(commonFiles, true),
    environment,
  }
  const fullFiles = allFiles.filter(file => !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path.relative(sourceDir, file)))
  const trace = createHandlerTracer({ root, asts, resolve, closure, hashFiles, digest, env, environmentNames, runtimeAssets, scopedRuntime: true })
  const traceV5 = createHandlerTracer({ root, asts, resolve, closure, hashFiles, digest, env, environmentNames, runtimeAssets })
  const traceV4 = createHandlerTracer({ root, asts, resolve, closure, hashFiles, digest, env, environmentNames, legacyV4: true })
  const traceV3 = createHandlerTracer({ root, asts, resolve, closure, hashFiles, digest, env, environmentNames, legacyV3: true })
  const legacyConfiguration = hashFiles([...assets, ...configFiles])
  // Runtime assets with known consumers follow those consumers. Unknown assets
  // and deployment/package/env configuration retain conservative global scope.
  const v5Configuration = hashFiles([...assets.filter(file => (!ownedAssets.has(file)
    && !/\.(?:js|cjs|mjs)\.(?:backup|bak)$/.test(file))
    || /^(?:package(?:-lock)?\.json|\.env(?:\..*)?)$/.test(path.basename(file))), ...configFiles])
  const configuration = v5Configuration.filter(([file]) => !/^functions\/(?:package(?:-lock)?\.json|\.env(?:\..*)?)$/.test(file))
  // Only exempt Hub-configured retired keys when no production source refers to them.
  const ignoredEnvironmentKeys = retiredEnvironmentKeys.filter(name => {
    let referenced = false
    for (const ast of asts.values()) walk(ast, node => {
      if ((node.type === 'Identifier' && node.name === name)
        || (node.type === 'Literal' && typeof node.value === 'string' && node.value.includes(name))) referenced = true
    })
    return !referenced
  })
  const runtimeInputs = formats.includes(VERSION) ? createRuntimeInputs({ sourceDir, allFiles, ignoredEnvironmentKeys }) : null
  const runtimeInputsV6 = formats.includes(6) ? createRuntimeInputs({ sourceDir, allFiles }) : null
  const inventory = {}
  for (const [name, endpoint] of Object.entries(endpoints)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new Error('Invalid discovered Function name')
    const regions = endpoint.region || [env.FIREBASE_STORE_REGION || 'us-west1']
    if (!Array.isArray(regions) || !regions.length || regions.some(region => !/^[a-z]+-[a-z]+\d$/.test(region)))
      throw new Error(`Unresolved regions for ${name}`)
    const inputs = uncertain.size ? fullFiles : [...closure(groups.get(endpoint.entryPoint?.split('.')[0]))]
    const files = hashFiles(inputs)
    const legacyFiles = hashFiles(inputs, true)
    const graph = formats.includes(VERSION) || formats.includes(6) ? trace(entry, endpoint.entryPoint) : null
    const graphV5 = formats.includes(5) ? traceV5(entry, endpoint.entryPoint) : null
    const graphV4 = formats.includes(4) ? traceV4(entry, endpoint.entryPoint) : null
    const graphV3 = formats.includes(3) ? traceV3(entry, endpoint.entryPoint) : null
    const inputSummary = runtimeInputs ? runtimeInputs(graph, uncertain.size > 0) : undefined
    const inputSummaryV6 = runtimeInputsV6 ? runtimeInputsV6(graph, uncertain.size > 0) : undefined
    for (const summary of [inputSummary, inputSummaryV6].filter(Boolean)) {
      for (const [file, mode, hash] of configuration) summary.configuration[file] = digest(stable([mode, hash]))
      const sources = new Map()
      for (const piece of uncertain.size ? hashFiles(fullFiles) : graph.pieces) {
        if (!sources.has(piece[0])) sources.set(piece[0], [])
        sources.get(piece[0]).push(piece)
      }
      summary.sources = Object.fromEntries([...sources].map(([file, pieces]) => [file, digest(stable(pieces))]))
    }
    const common = { version: VERSION, configuration, inputs: inputSummary }
    const handlerFiles = uncertain.size ? hashFiles(fullFiles) : graph?.pieces
    for (const region of regions) {
      inventory[`${region}/${name}`] = {
        name, region, platform: endpoint.platform,
        callable: !!endpoint.callableTrigger,
        eventTrigger: endpoint.eventTrigger || null,
        fingerprint: formats.includes(VERSION) ? digest(stable({ common, files: handlerFiles, endpoint })) : undefined,
        handlerV6Fingerprint: formats.includes(6) ? digest(stable({ common: { version: 6, configuration, inputs: inputSummaryV6 }, files: handlerFiles, endpoint })) : undefined,
        handlerV5Fingerprint: formats.includes(5) ? digest(stable({ common: { version: 5, configuration: v5Configuration, environment: uncertain.size ? environment : graphV5.environment }, files: uncertain.size ? hashFiles(fullFiles) : graphV5.pieces, endpoint })) : undefined,
        ...(inputSummary ? { inputSummary } : {}),
        handlerV4Fingerprint: graphV4 ? digest(stable({ common: { version: 4, configuration: legacyConfiguration, environment: uncertain.size ? environment : graphV4.environment }, files: uncertain.size ? hashFiles(fullFiles) : graphV4.pieces, endpoint })) : undefined,
        handlerV3Fingerprint: graphV3 ? digest(stable({ common: { version: 3, configuration: legacyConfiguration, environment: uncertain.size ? environment : graphV3.environment }, files: uncertain.size ? hashFiles(fullFiles) : graphV3.pieces, endpoint })) : undefined,
        moduleFingerprint: digest(stable({ common: moduleCommon, files, endpoint })),
        legacyFingerprint: digest(stable({ common: legacyCommon, files: legacyFiles, endpoint })),
        dependencyFallbacks: graph?.fallbacks || [],
        ...(explain ? { dependencyInputs: graph?.pieces, configuration, environment: graph?.environment } : {}),
      }
    }
  }
  if (!Object.keys(inventory).length) throw new Error('No Functions discovered; refusing an empty inventory')
  return { inventory, conservativeReasons: [...uncertain].sort(), externalInputs: [...externalInputs].map(file => path.relative(root, file)) }
}

function makePlan({ projectId, inventory, state, remote, all = false, baselines = {}, requireSourceProof = false }) {
  if (state && (!SUPPORTED_VERSIONS.includes(state.version) || state.projectId !== projectId || !state.functions || typeof state.functions !== 'object' || Array.isArray(state.functions)))
    throw new Error('Invalid deployment state or wrong project; refusing to skip Functions')
  const removed = Object.keys(state?.functions || {}).filter(key => !inventory[key])
  if (removed.length) throw new Error(`Previously tracked Functions were removed. Delete/migrate explicitly and reconcile state: ${removed.join(', ')}`)
  for (const entry of Object.values(state?.functions || {})) {
    if (!entry || typeof entry.fingerprint !== 'string' || !entry.fingerprint
      || typeof entry.remoteUpdateTime !== 'string' || !entry.remoteUpdateTime
      || !SUPPORTED_VERSIONS.includes(entry.fingerprintVersion || state.version))
      throw new Error('Invalid deployment state entry; refusing to skip Functions')
  }
  const selected = []
  const selectionReasons = {}
  const inputChanges = {}
  const baselineUpgrades = []
  const baselineConversions = {}
  for (const [key, item] of Object.entries(inventory)) {
    const previous = state?.functions[key]
    const previousVersion = previous && (previous.fingerprintVersion || state.version)
    const legacy = previousVersion && previousVersion < VERSION
    const candidate = baselines[key]
    const recovered = legacy && candidate?.legacyFingerprint === previous.fingerprint && candidate.legacyVersion === previousVersion
      && /^[a-f0-9]{64}$/.test(candidate.sourceArchive?.sha256 || '') && /^\d+$/.test(candidate.sourceArchive?.generation || '')
      && candidate.sourceArchive?.bucket && candidate.sourceArchive?.object && typeof candidate.fingerprint === 'string' && candidate.fingerprint
      && remote[key]?.state === 'ACTIVE' && remote[key].updateTime === previous.remoteUpdateTime
    if (recovered) baselineConversions[key] = candidate
    const expected = recovered ? item.fingerprint : fingerprintAtVersion(item, previousVersion)
    const checkpoint = recovered ? candidate.fingerprint : previous?.fingerprint
    const reasons = [
      all && 'forced deployment',
      previous?.redeployRequested && 'explicit redeployment requested',
      !previous && 'no successful checkpoint',
      legacy && requireSourceProof && !recovered && remote[key]?.state === 'ACTIVE'
        && remote[key].updateTime === previous.remoteUpdateTime && 'unverified legacy deployed source',
      previous && checkpoint !== expected && !(legacy && requireSourceProof && !recovered) && (recovered ? 'handler dependencies changed' : legacy ? 'legacy fingerprint changed' : 'production inputs changed'),
      !remote[key] && 'missing on server',
      remote[key] && remote[key].state !== 'ACTIVE' && 'server function not ACTIVE',
      previous && remote[key] && previous.remoteUpdateTime !== remote[key].updateTime && 'server changed outside checkpoint',
    ].filter(Boolean)
    if (reasons.length) {
      selected.push([key, item])
      selectionReasons[key] = reasons
      inputChanges[key] = describeInputChanges(recovered ? candidate.inputSummary : legacy ? undefined : previous?.inputSummary, item.inputSummary)
    }
    else if (legacy) {
      baselineUpgrades.push(key)
    }
  }
  const names = [...new Set(selected.map(([, item]) => item.name))].sort()
  const batches = []
  for (let offset = 0; offset < names.length; offset += 10) batches.push(names.slice(offset, offset + 10))
  return { selectedNames: names, batches, selectionReasons, inputChanges, baselineUpgrades, baselineConversions }
}

module.exports = { VERSION, buildInventory, makePlan, fingerprintAtVersion, digest, stable }
