import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { getDomain } from 'tldts'

const source = readFileSync(new URL('../components/cms/registrar.vue', import.meta.url), 'utf8')
const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
const orgPath = 'organizations/test-org'
const registeredPath = `${orgPath}/domains-registered`
const registryPath = `${orgPath}/domain-registry`
const sitesPath = `${orgPath}/sites`

const createRegistrar = () => {
  let enterPage
  let leavePage
  const starts = []
  const stops = []
  const calls = []
  const edgeFirebase = {
    user: { uid: 'admin-1' },
    data: { [registeredPath]: {}, [registryPath]: {}, [sitesPath]: {} },
    startSnapshot: async (path) => { starts.push(path) },
    stopSnapshot: async (path) => { stops.push(path) },
    runFunction: async (name, data) => { calls.push({ name, data }) },
  }
  const context = {
    getDomain,
    inject: () => edgeFirebase,
    reactive: value => value,
    computed: getter => ({ get value() { return getter() } }),
    watch: (_source, callback) => { enterPage = callback },
    onBeforeUnmount: (callback) => { leavePage = callback },
    edgeGlobal: {
      edgeState: { currentOrganization: 'test-org', organizationDocPath: orgPath },
      isAdminGlobal: () => ({ value: true }),
      allowMenuItem: () => true,
    },
  }
  const component = runInNewContext(`${script}\n;({
    shouldExcludeDomainFromList, snapshotContext, domainRows,
    getRegistrationLabel, syncFromRegistry, state,
  })`, context)
  return {
    ...component,
    edgeFirebase,
    starts,
    stops,
    calls,
    enter: () => enterPage(component.snapshotContext.value),
    leave: () => leavePage(),
  }
}

test('registrar hides subdomains while preserving registrable multi-label suffixes', () => {
  const registrar = createRegistrar()
  for (const domain of ['example.com', 'example.co.uk', 'example.com.au'])
    assert.equal(registrar.shouldExcludeDomainFromList(domain), false, domain)
  for (const domain of [
    'expedition.example.com', 'geocache.example.com', 'www.example.com',
    'www.example.co.uk', 'a.b.example.com.au', 'shop.github.io',
    'co.uk', 'localhost', '127.0.0.1', 'preview.pages.dev', '',
  ])
    assert.equal(registrar.shouldExcludeDomainFromList(domain), true, domain)
})

test('both registrar data sources hide subdomains without changing site or DNS records', () => {
  const registrar = createRegistrar()
  const { data } = registrar.edgeFirebase
  data[registeredPath] = {
    root: { domain: 'example.com', status: 'active' },
    subdomain: { domain: 'www.example.com', status: 'active' },
  }
  data[registryPath] = {
    root: { domain: 'example.com', siteId: 'site-1', dnsSyncSucceeded: true },
    subdomain: { domain: 'expedition.example.com', siteId: 'site-1', dnsSyncSucceeded: true },
    external: { domain: 'example.co.uk', registrationState: 'registered_external' },
  }
  data[sitesPath] = { 'site-1': { docId: 'site-1', name: 'Example site', domains: ['example.com', 'expedition.example.com'] } }
  const before = JSON.stringify(data)

  assert.deepEqual(Array.from(registrar.domainRows.value, row => row.domain), ['example.co.uk', 'example.com'])
  const root = registrar.domainRows.value.find(row => row.domain === 'example.com')
  assert.equal(root.attachedSiteName, 'Example site')
  assert.equal(root.dnsSyncSucceeded, true)
  assert.equal(JSON.stringify(data), before)
})

test('entering and revisiting the page starts live snapshots even with cached data', async () => {
  const registrar = createRegistrar()
  const paths = [registeredPath, registryPath, sitesPath]
  await registrar.enter()
  assert.deepEqual(registrar.starts, paths)
  registrar.leave()
  assert.deepEqual(registrar.stops, paths)
  await registrar.enter()
  assert.deepEqual(registrar.starts, [...paths, ...paths])
  assert.equal(registrar.state.loading, false)
})

test('registry sync reloads snapshots and replaces a stale not-registered badge', async () => {
  const registrar = createRegistrar()
  registrar.edgeFirebase.data[registryPath] = {
    root: { domain: 'example.com', registrationState: 'not_registered' },
  }
  assert.equal(registrar.getRegistrationLabel(registrar.domainRows.value[0]), 'Not registered')
  registrar.edgeFirebase.startSnapshot = async (path) => {
    assert.equal(registrar.calls.length, 1, 'refresh must follow the callable')
    registrar.starts.push(path)
    if (path === registeredPath)
      registrar.edgeFirebase.data[path] = { root: { domain: 'example.com', status: 'active' } }
  }

  await registrar.syncFromRegistry()
  assert.deepEqual(registrar.starts, [registeredPath, registryPath, sitesPath])
  assert.equal(registrar.calls[0].name, 'cms-registrarSyncRegisteredFromRegistry')
  assert.equal(registrar.calls[0].data.orgId, 'test-org')
  assert.equal(registrar.getRegistrationLabel(registrar.domainRows.value[0]), 'Registered in this org')
  assert.equal(registrar.state.messageType, 'success')
  assert.equal(registrar.state.syncing, false)
})

test('snapshot refresh errors are not overwritten with a sync success message', async () => {
  const registrar = createRegistrar()
  registrar.edgeFirebase.startSnapshot = async () => {
    throw new Error('Unable to refresh records')
  }
  await registrar.syncFromRegistry()
  assert.equal(registrar.state.messageType, 'error')
  assert.equal(registrar.state.message, 'Unable to refresh records')
  assert.equal(registrar.state.syncing, false)
  assert.equal(registrar.state.loading, false)
})

test('failed registry calls preserve the error and do not reload snapshots', async () => {
  const registrar = createRegistrar()
  registrar.edgeFirebase.runFunction = async () => {
    throw new Error('Registry sync failed')
  }
  await registrar.syncFromRegistry()
  assert.equal(registrar.state.messageType, 'error')
  assert.equal(registrar.state.message, 'Registry sync failed')
  assert.equal(registrar.state.syncing, false)
  assert.deepEqual(registrar.starts, [])
})
