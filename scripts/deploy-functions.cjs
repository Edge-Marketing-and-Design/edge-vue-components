const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const { createRequire } = require('node:module')
const { VERSION, buildInventory, makePlan } = require('./function-deploy-plan.cjs')
const { DeployCloud } = require('./function-deploy-cloud.cjs')
const { recoverBaselines } = require('./function-deploy-baseline.cjs')

function discoverEndpoints(root, projectId) {
  const functionsDir = path.join(root, 'functions')
  const localRequire = createRequire(path.join(functionsDir, 'package.json'))
  let sdkRoot = path.dirname(localRequire.resolve('firebase-functions'))
  while (!fs.existsSync(path.join(sdkRoot, 'package.json'))) {
    const parent = path.dirname(sdkRoot)
    if (parent === sdkRoot) throw new Error('Unable to locate Firebase SDK discovery')
    sdkRoot = parent
  }
  const loader = path.join(sdkRoot, 'lib/runtime/loader.js')
  const marker = '__HUB_DEPLOY_ENDPOINTS__'
  const script = `require(${JSON.stringify(loader)}).loadStack(${JSON.stringify(functionsDir)}).then(stack => { process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(stack.endpoints), () => process.exit(0)) }).catch(() => process.exit(1))`
  let output
  try { output = execFileSync(process.execPath, ['-e', script], {
    cwd: functionsDir, timeout: 60000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: 'production', GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString() } catch { throw new Error('Local Firebase endpoint discovery failed; check installed Functions dependencies and production configuration') }
  const offset = output.lastIndexOf(marker)
  if (offset < 0) throw new Error('Firebase discovery did not return endpoints')
  try { return JSON.parse(output.slice(offset + marker.length)) } catch { throw new Error('Invalid Firebase discovery metadata') }
}

function runFirebase(args, root) {
  return new Promise((resolve, reject) => {
    const child = spawn('firebase', args, { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' })
    const interrupt = () => child.kill('SIGTERM')
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
    child.once('error', error => { cleanup(); reject(error) })
    child.once('exit', (code, signal) => {
      cleanup()
      if (code === 0) resolve()
      else reject(new Error(`Function batch failed (${signal || code}); it remains pending for the next deploy`))
    })
  })
}

function firebaseBatchArgs({ batch, inventory, remote, projectId }) {
  const args = ['deploy', '--only', batch.map(name => `functions:${name}`).join(','), '--project', projectId, '--non-interactive']
  const needsRetryConfirmation = Object.entries(inventory).some(([key, item]) => batch.includes(item.name)
    && item.eventTrigger?.retry === true
    && remote[key]?.eventTrigger?.retryPolicy !== 'RETRY_POLICY_RETRY')
  if (!needsRetryConfirmation) return args

  // Firebase's --force accepts retry policies, but also skips deletion and
  // unsafe-migration prompts. Its name selectors also match hyphenated children.
  // Verify every matched remote endpoint before enabling it for this batch.
  const matchesSelector = name => batch.some(selected => name === selected || name.startsWith(`${selected}-`))
  for (const item of Object.values(inventory)) {
    if (matchesSelector(item.name) && !batch.includes(item.name))
      throw new Error(`Cannot accept retry policy: Firebase's selector also matches ${item.name}, which is outside this batch`)
  }
  for (const [key, deployed] of Object.entries(remote)) {
    const name = key.slice(key.indexOf('/') + 1)
    if (!matchesSelector(name)) continue
    const local = inventory[key]
    if (!local || !batch.includes(local.name))
      throw new Error(`Cannot accept retry policy: Firebase's selector also matches ${key}, which is outside this batch or removed locally`)
    const environment = local.platform === 'gcfv2' ? 'GEN_2' : 'GEN_1'
    if (deployed.environment !== environment
      || (deployed.eventTrigger?.eventType || null) !== (local.eventTrigger?.eventType || null))
      throw new Error(`Cannot accept retry policy while changing the generation or trigger type of ${key}; deploy that migration explicitly`)
  }
  args.push('--force')
  return args
}

async function deployFunctions({ root, projectId, cloud, inventory, all = false, planOnly = false, runBatch = runFirebase, verifySource = () => {}, recoverBaseline = null, log = console.log }) {
  const bucketExists = await cloud.ensureBucket({ create: !planOnly })
  let lock = null
  if (!planOnly) lock = await cloud.acquireLock(`${os.hostname()}:${process.pid}:${randomUUID()}`)
  try {
    const saved = bucketExists ? await cloud.readState() : { state: null, generation: '0' }
    const remote = await cloud.listFunctions()
    // Validate existing state before attempting any historical recovery.
    makePlan({ projectId, inventory, state: saved.state, remote, all })
    const requireSourceProof = !!recoverBaseline && !all
    const baselines = requireSourceProof ? await recoverBaseline({ state: saved.state, remote, log }) : {}
    const plan = makePlan({ projectId, inventory, state: saved.state, remote, all, baselines, requireSourceProof })
    log(`Functions: ${plan.selectedNames.length} selected, ${Object.keys(inventory).length} regional endpoints inventoried; ${plan.batches.length} batch(es).`)
    if (!saved.state) log('No shared baseline: the first deployment selects all Functions.')
    const reasonCounts = {}
    for (const reasons of Object.values(plan.selectionReasons))
      for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
    for (const [reason, count] of Object.entries(reasonCounts)) log(`  Selection reason: ${reason} (${count} regional endpoint(s))`)
    for (const batch of plan.batches) log(`  ${batch.join(', ')}`)
    for (const [key, reasons] of Object.entries(plan.selectionReasons)) {
      log(`    ${key}: ${reasons.join('; ')}`)
      for (const change of plan.inputChanges?.[key] || []) log(`      ${change}`)
    }
    if (plan.baselineUpgrades.length) log(`  ${plan.baselineUpgrades.length} matching legacy checkpoint(s) can upgrade without deploying.`)
    if (planOnly) return plan
    if (!all && Object.values(plan.selectionReasons).some(reasons => reasons.includes('unverified legacy deployed source')))
      throw new Error('Legacy deployed source could not be verified. Resolve source-read permissions/configuration or explicitly request --all-functions; no checkpoints were promoted.')

    const state = saved.state ? {
      ...saved.state, version: VERSION,
      functions: Object.fromEntries(Object.entries(saved.state.functions).map(([key, entry]) => [key, {
        ...entry, fingerprintVersion: entry.fingerprintVersion || saved.state.version,
      }])),
    } : { version: VERSION, projectId, functions: {} }
    let generation = saved.generation
    if (saved.state && (saved.state.version !== VERSION || plan.baselineUpgrades.length || Object.keys(plan.baselineConversions).length)) {
      await verifySource()
      const latest = await cloud.listFunctions()
      for (const key of new Set([...plan.baselineUpgrades, ...Object.keys(plan.baselineConversions)])) {
        if (latest[key]?.state !== 'ACTIVE' || latest[key]?.updateTime !== saved.state.functions[key].remoteUpdateTime)
          throw new Error('Server Function changed during baseline recovery; no checkpoints were promoted. Rerun the plan.')
      }
      for (const [key, candidate] of Object.entries(plan.baselineConversions)) {
        state.functions[key] = { ...state.functions[key], fingerprint: candidate.fingerprint, fingerprintVersion: VERSION, inputSummary: candidate.inputSummary,
          reconciliation: { method: 'exact-deployed-source-fingerprint', sourceArchive: candidate.sourceArchive, previousFingerprintVersion: candidate.legacyVersion } }
      }
      for (const key of plan.baselineUpgrades) {
        state.functions[key] = { ...state.functions[key], fingerprint: inventory[key].fingerprint, fingerprintVersion: VERSION, inputSummary: inventory[key].inputSummary }
      }
      generation = await cloud.writeState(state, generation)
    }
    for (const [index, batch] of plan.batches.entries()) {
      log(`Deploying Functions batch ${index + 1}/${plan.batches.length}...`)
      await verifySource()
      const args = firebaseBatchArgs({ batch, inventory, remote, projectId })
      if (args.includes('--force')) log('Accepting the retry policies configured in the selected Functions; deletion and trigger/generation migration guards passed.')
      await runBatch(args, root)
      await verifySource()
      const updated = await cloud.listFunctions()
      const entries = Object.entries(inventory).filter(([, item]) => batch.includes(item.name))
      for (const [key, item] of entries) {
        await cloud.assertHealthy(item, updated[key])
        if (item.callable) await cloud.ensureInvoker(item, updated[key], log)
        if (!updated[key]?.updateTime) throw new Error(`Missing deployed version for ${item.name}`)
      }
      // No part of a failed batch is checkpointed. A retry may repeat successful
      // members of that batch, but never skips the failed ones.
      for (const [key, item] of entries) {
        state.functions[key] = { fingerprint: item.fingerprint, fingerprintVersion: VERSION, inputSummary: item.inputSummary, remoteUpdateTime: updated[key].updateTime, deployedAt: new Date().toISOString() }
      }
      generation = await cloud.writeState(state, generation)
    }
    return plan
  } finally {
    if (lock !== null) await cloud.releaseLock(lock)
  }
}

async function main(argv) {
  let projectId = ''
  let region = 'us-central1'
  let all = false
  let planOnly = false
  let checkLock = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--project') projectId = argv[++index]
    else if (arg === '--region') region = argv[++index]
    else if (arg === '--all-functions') all = true
    else if (arg === '--plan-functions') planOnly = true
    else if (arg === '--check-lock') checkLock = true
    else throw new Error(`Unknown Functions deployment argument: ${arg}`)
  }
  const root = path.resolve(__dirname, '../..')
  const cloud = new DeployCloud({ projectId, location: region, bucket: process.env.DEPLOY_STATE_BUCKET })
  if (checkLock) {
    await cloud.assertNoDeploymentLock()
    return
  }
  const endpoints = discoverEndpoints(root, projectId)
  const environment = { ...process.env, NODE_ENV: 'production' }
  const result = buildInventory(root, endpoints, environment)
  if (result.conservativeReasons.length) console.log(`Conservative source fingerprint: ${result.conservativeReasons.join('; ')}`)
  const verifySource = () => {
    const current = buildInventory(root, endpoints, environment)
    // Legacy hashes include volatile artifacts solely for checkpoint migration.
    // Only normalized production inputs guard a running deployment.
    const productionInventory = inventory => Object.fromEntries(Object.entries(inventory).map(([key, { legacyFingerprint, moduleFingerprint, handlerV3Fingerprint, handlerV4Fingerprint, handlerV5Fingerprint, handlerV6Fingerprint, ...item }]) => [key, item]))
    if (JSON.stringify(productionInventory(current.inventory)) !== JSON.stringify(productionInventory(result.inventory)))
      throw new Error('Function inputs changed while deploying; no checkpoint for the current batch. Commit/push changes and rerun.')
  }
  await deployFunctions({ root, projectId, cloud, inventory: result.inventory, all: all || result.conservativeReasons.length > 0, planOnly, verifySource,
    recoverBaseline: options => recoverBaselines({ root, endpoints, environment, inventory: result.inventory, externalInputs: result.externalInputs, cloud, ...options }) })
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Do not print captured discovery output, HTTP bodies or credential commands.
  console.error(`Functions deployment aborted: ${error.message}`)
  process.exitCode = 1
})
module.exports = { discoverEndpoints, deployFunctions, runFirebase, firebaseBatchArgs }
