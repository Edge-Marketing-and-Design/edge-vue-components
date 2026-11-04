// Project-scoped cloud state. The constructor does no I/O; plan mode is read-only.
const { execFileSync } = require('node:child_process')
const { readSourceArchive } = require('./function-deploy-source.cjs')

class CloudApiError extends Error {
  constructor(status, operation) { super(`${operation} failed (HTTP ${status})`); this.status = status }
}

class DeployCloud {
  constructor({ projectId, bucket, location, fetchImpl = fetch, tokenProvider, commandRunner = execFileSync } = {}) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId || '')) throw new Error('Invalid deployment project ID')
    this.projectId = projectId
    this.bucket = bucket || `${projectId}-hub-deploy-state`
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(this.bucket)) throw new Error('Invalid deployment state bucket')
    this.location = location || 'us-central1'
    this.fetch = fetchImpl
    this.commandRunner = commandRunner
    this.tokenProvider = tokenProvider || (() => execFileSync('gcloud', ['auth', 'print-access-token', '--project', projectId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
    this.stateName = 'functions/state-v1.json'
    this.lockName = 'functions/deploy-lock.json'
  }
  async request(url, { method = 'GET', body, optional404 = false } = {}) {
    if (!this.token || Date.now() > this.tokenExpires) {
      this.token = await this.tokenProvider()
      this.tokenExpires = Date.now() + 40 * 60 * 1000
    }
    const response = await this.fetch(url, {
      method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
    })
    if (optional404 && response.status === 404) return null
    if (!response.ok) throw new CloudApiError(response.status, `${method} ${new URL(url).pathname}`)
    if (response.status === 204) return null
    return response.json()
  }
  objectUrl(name) { return `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(name)}` }
  async upload(name, value, generation) {
    return this.request(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=${generation}`, { method: 'POST', body: value })
  }
  async ensureBucket({ create = false } = {}) {
    const project = await this.request(`https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}`)
    let bucket = await this.request(`https://storage.googleapis.com/storage/v1/b/${this.bucket}`, { optional404: true })
    if (!bucket && create) {
      try {
        bucket = await this.request(`https://storage.googleapis.com/storage/v1/b?project=${this.projectId}`, {
          method: 'POST', body: { name: this.bucket, location: this.location, iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } },
        })
      } catch (error) {
        if (error.status !== 409) throw error
        bucket = await this.request(`https://storage.googleapis.com/storage/v1/b/${this.bucket}`)
      }
    }
    if (!bucket) return false
    if (String(bucket.projectNumber) !== String(project.projectNumber)
      || bucket.iamConfiguration?.publicAccessPrevention !== 'enforced'
      || bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true)
      throw new Error('Deployment state bucket must belong to this project and enforce public access prevention and uniform bucket access')
    return true
  }
  async readState() {
    const metadata = await this.request(this.objectUrl(this.stateName), { optional404: true })
    if (!metadata) return { state: null, generation: '0' }
    const state = await this.request(`${this.objectUrl(this.stateName)}?alt=media&generation=${metadata.generation}`)
    return { state, generation: metadata.generation }
  }
  async writeState(state, generation) {
    const result = await this.upload(this.stateName, state, generation)
    return result.generation
  }
  async assertNoDeploymentLock() {
    const lock = await this.request(`${this.objectUrl(this.lockName)}?alt=media`, { optional404: true })
    if (!lock) return
    const machine = typeof lock.owner === 'string' ? lock.owner.split(':')[0] : ''
    const started = typeof lock.startedAt === 'string' && Number.isFinite(Date.parse(lock.startedAt))
      ? ` (started ${new Date(lock.startedAt).toISOString()})` : ''
    throw new Error(`Another deployment holds the lock${machine ? ` on ${machine}` : ''}${started}. Try again after it finishes.`)
  }
  async acquireLock(owner) {
    try {
      const lock = await this.upload(this.lockName, { owner, startedAt: new Date().toISOString() }, '0')
      return lock.generation
    } catch (error) {
      if (error.status === 412) {
        await this.assertNoDeploymentLock()
        throw new Error('Another deployment acquired the lock. Try again after it finishes.')
      }
      throw error
    }
  }
  async releaseLock(generation) {
    await this.request(`${this.objectUrl(this.lockName)}?ifGenerationMatch=${generation}`, { method: 'DELETE' })
  }
  async listFunctions() {
    const functions = {}
    // Gen 2 API lists both generations, distinguished by environment.
    let pageToken = ''
    do {
      const result = await this.request(`https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/-/functions?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
      if (result.unreachable?.length) throw new Error('Some Function regions are unreachable; refusing incomplete inventory')
      for (const item of result.functions || []) {
        const [, region, name] = item.name.match(/\/locations\/([^/]+)\/functions\/([^/]+)$/) || []
        if (!region || !name) throw new Error('Invalid remote Function identity')
        functions[`${region}/${name}`] = item
      }
      pageToken = result.nextPageToken || ''
    } while (pageToken)
    return functions
  }
  async describeSource(remote) {
    const source = remote?.buildConfig?.sourceProvenance?.resolvedStorageSource
    if (!source?.bucket || !source.object || !/^\d+$/.test(source.generation || ''))
      throw new Error('Missing immutable deployed source provenance')
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?generation=${encodeURIComponent(source.generation)}`
    const metadata = await this.request(url)
    if (metadata.bucket !== source.bucket || metadata.name !== source.object || String(metadata.generation) !== String(source.generation) || !metadata.md5Hash)
      throw new Error('Deployed source metadata does not match its provenance')
    return { ...source, generation: String(source.generation), md5Hash: metadata.md5Hash, size: metadata.size }
  }
  async readSource(descriptor) { return readSourceArchive(this, descriptor) }
  async assertHealthy(item, remote) {
    if (!remote || remote.state !== 'ACTIVE') throw new Error(`${item.name} is not ACTIVE after deployment`)
    if (item.platform !== 'gcfv2') return
    const service = remote.serviceConfig?.service
    if (!service?.startsWith(`projects/${this.projectId}/locations/${item.region}/services/`)) throw new Error(`No matching Cloud Run service for ${item.name}`)
    const ready = await this.request(`https://run.googleapis.com/v2/${service}`)
    if (ready.terminalCondition?.state !== 'CONDITION_SUCCEEDED'
      || !ready.latestCreatedRevision || ready.latestCreatedRevision !== ready.latestReadyRevision)
      throw new Error(`${item.name} latest Cloud Run revision is not ready; not checkpointing this batch`)
  }
  async ensureInvoker(item, remote, log = console.log) {
    const gen2 = item.platform === 'gcfv2'
    const resource = gen2 ? remote.serviceConfig?.service : remote.name
    if (!resource) throw new Error(`Missing service identity for ${item.name}`)
    const url = gen2 ? `https://run.googleapis.com/v2/${resource}:getIamPolicy` : `https://cloudfunctions.googleapis.com/v1/${resource}:getIamPolicy`
    const policy = await this.request(url)
    const role = gen2 ? 'roles/run.invoker' : 'roles/cloudfunctions.invoker'
    if (policy.bindings?.some(binding => binding.role === role && !binding.condition && binding.members?.includes('allUsers'))) {
      log(`  ${item.name} (${item.region}): invoker already set`)
      return
    }
    this.commandRunner('gcloud', ['functions', 'add-invoker-policy-binding', item.name, gen2 ? '--gen2' : '--no-gen2', '--project', this.projectId, '--region', item.region, '--member=allUsers', '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'] })
    log(`  ${item.name} (${item.region}): invoker repaired`)
  }
}

module.exports = { DeployCloud, CloudApiError }
