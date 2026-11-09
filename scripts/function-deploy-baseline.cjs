// Recover legacy handler baselines from immutable deployed source archives.
// No historical application code executes. No checkout/cloud state is written.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readRetiredEnvironmentKeys } = require('./function-deploy-config.cjs')
const { VERSION, buildInventory, fingerprintAtVersion } = require('./function-deploy-plan.cjs')

async function recoverBaselines({ root, endpoints, environment, inventory, state, remote, cloud, externalInputs = [], log = () => {} }) {
  if (!state) return {}
  const retiredEnvironmentKeys = readRetiredEnvironmentKeys(root)
  const pending = Object.keys(inventory).filter(key => {
    const previous = state.functions?.[key], version = previous?.fingerprintVersion || state.version
    return previous && [1, 2, 3, 4, 5, 6, 7].includes(version) && version < VERSION
      && remote[key]?.state === 'ACTIVE' && remote[key].updateTime === previous.remoteUpdateTime
  })
  const descriptors = new Map(), groups = new Map(), recovered = {}
  let next = 0
  // Bound independent metadata reads. Archives with identical verified object
  // checksums are downloaded/analyzed once, even across a large deployment.
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (next < pending.length) {
      const key = pending[next++]
      try {
        const descriptor = await cloud.describeSource(remote[key])
        descriptors.set(key, descriptor)
        const group = `${descriptor.md5Hash}:${descriptor.size}`
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group).push(key)
      } catch { /* Missing proof keeps the endpoint pending. */ }
    }
  }))
  const additional = [...new Set(['firebase.json', '.firebaserc', ...externalInputs])]
  for (const relative of additional) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || !relative || relative === '.')
      throw new Error('Invalid historical deployment input path')
  }
  for (const keys of groups.values()) {
    const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-function-baseline-'))
    try {
      const descriptor = descriptors.get(keys[0])
      const archive = await cloud.readSource(descriptor)
      fs.mkdirSync(path.join(snapshot, 'functions'))
      for (const file of archive.files) {
        const destination = path.resolve(snapshot, 'functions', file.path)
        if (!destination.startsWith(path.join(snapshot, 'functions') + path.sep)) throw new Error('Invalid deployed source path')
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, file.content, { mode: file.mode })
      }
      // Repo-level inputs aren't in the Functions ZIP. They must still produce
      // the exact previously recorded hash; a changed config/env cannot pass.
      for (const relative of additional) {
        const source = path.join(root, relative), destination = path.join(snapshot, relative)
        if (!fs.existsSync(source)) continue
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.copyFileSync(source, destination)
        fs.chmodSync(destination, fs.statSync(source).mode & 0o777)
      }
      const names = new Set(keys.map(key => inventory[key].name))
      const selectedEndpoints = Object.fromEntries(Object.entries(endpoints).filter(([name]) => names.has(name)))
      const formats = [...new Set(keys.map(key => state.functions[key].fingerprintVersion || state.version))]
      const proof = buildInventory(snapshot, selectedEndpoints, environment, { formats, retiredEnvironmentKeys })
      if (proof.conservativeReasons.length) continue
      const matches = keys.filter(key => {
        const previous = state.functions[key], version = previous.fingerprintVersion || state.version
        return proof.inventory[key] && fingerprintAtVersion(proof.inventory[key], version) === previous.fingerprint
      })
      if (!matches.length) continue
      const matchedNames = new Set(matches.map(key => inventory[key].name))
      const handlers = buildInventory(snapshot, Object.fromEntries(Object.entries(selectedEndpoints).filter(([name]) => matchedNames.has(name))), environment, { formats: [VERSION], retiredEnvironmentKeys })
      if (handlers.conservativeReasons.length) continue
      for (const key of matches) {
        const previous = state.functions[key], source = descriptors.get(key)
        recovered[key] = {
          fingerprint: handlers.inventory[key].fingerprint, inputSummary: handlers.inventory[key].inputSummary,
          legacyFingerprint: previous.fingerprint, legacyVersion: previous.fingerprintVersion || state.version,
          sourceArchive: { bucket: source.bucket, object: source.object, generation: source.generation, sha256: archive.sha256 },
        }
      }
    } catch { log('  Could not prove a deployed source archive; its old checkpoints remain pending.') }
    finally { fs.rmSync(snapshot, { recursive: true, force: true }) }
  }
  if (Object.keys(recovered).length) log(`  Recovered ${Object.keys(recovered).length} old checkpoint(s) from exact matching deployed source archives.`)
  if (pending.length > Object.keys(recovered).length) log(`  ${pending.length - Object.keys(recovered).length} old checkpoint(s) have no exact deployed-source proof and remain pending.`)
  return recovered
}

module.exports = { recoverBaselines }
