import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const sources = ['../../functions/cms.js', '../functions/cms.js'].map(path => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), 'utf8'),
}))

const createRegistrar = (source, { registrable = true, registrationError = '' } = {}) => {
  const start = source.indexOf('exports.registrarRegisterDomain = onCall(')
  const end = source.indexOf('\nexports.registrarListOrgDomains', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const requests = []
  const writes = []
  const context = {
    exports: {},
    onCall: handler => handler,
    assertCallableUser: () => {},
    assertOrgAdminAccess: async () => {},
    normalizeDomain: value => value.trim().toLowerCase(),
    isLikelyDomainName: () => true,
    HttpsError: class extends Error {
      constructor(code, message) {
        super(message)
        this.code = code
      }
    },
    cloudflareRegistrarRequest: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)))
      if (request.endpoint === 'domain-check')
        return { domains: [{ name: 'example.com', registrable, reason: 'unavailable' }] }
      if (registrationError)
        throw new Error(registrationError)
      return { domain_name: 'example.com', status: 'active', auto_renew: true }
    },
    parseCloudflareErrorMessage: error => error.message,
    buildDomainsRegisteredPayload: payload => payload,
    DOMAINS_REGISTERED_COLLECTION: 'domains-registered',
    Firestore: { FieldValue: { serverTimestamp: () => 'server-timestamp' } },
  }
  const ref = {
    collection: () => ref,
    doc: () => ref,
    set: async payload => writes.push(payload),
  }
  context.db = ref
  runInNewContext(source.slice(start, end), context)
  return { register: context.exports.registrarRegisterDomain, requests, writes }
}

const request = {
  auth: { uid: 'admin-1' },
  data: { uid: 'admin-1', orgId: 'org-1', domain: 'example.com' },
}

for (const { path, source } of sources) {
  test(`${path}: new registrations explicitly enable auto-renew`, async () => {
    const registrar = createRegistrar(source)
    await registrar.register(request)

    assert.deepEqual(registrar.requests, [
      { method: 'post', endpoint: 'domain-check', data: { domains: ['example.com'] } },
      { method: 'post', endpoint: 'registrations', data: { domain_name: 'example.com', auto_renew: true } },
    ])
    assert.equal(registrar.writes.length, 1)
    assert.equal(registrar.writes[0].registration.auto_renew, true)
  })

  test(`${path}: unavailable domains are not purchased`, async () => {
    const registrar = createRegistrar(source, { registrable: false })
    await assert.rejects(registrar.register(request), { code: 'failed-precondition' })
    assert.equal(registrar.requests.length, 1)
    assert.equal(registrar.writes.length, 0)
  })

  test(`${path}: provider limit errors are returned without retrying or saving`, async () => {
    const message = 'Domain limit reached: you cannot register more than 100 domains.'
    const registrar = createRegistrar(source, { registrationError: message })
    await assert.rejects(registrar.register(request), { code: 'failed-precondition', message })
    assert.equal(registrar.requests.length, 2)
    assert.equal(registrar.writes.length, 0)
  })
}

test('deployable and shared CMS functions remain identical', () => {
  assert.equal(sources[0].source, sources[1].source)
})
