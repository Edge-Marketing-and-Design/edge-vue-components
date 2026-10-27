// Cloudflare Pages domain registration is not the same as activation. Keep
// provider calls bounded and never trust a cached "Added" flag as current state.
function createDomainConnection({ axios, accountId, token, project, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const configured = Boolean(accountId && token && project)
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(project)}/domains`
  const errorMessage = error => (error?.response?.data?.errors || []).map(item => item.message).filter(Boolean).join('; ') || error?.message || 'Cloudflare domain request failed.'
  async function request(method, domain) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await axios.request({
          method, url: method === 'POST' ? base : `${base}/${encodeURIComponent(domain)}`,
          ...(method === 'POST' ? { data: { name: domain } } : {}),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 8000,
        })
        if (!response?.data?.success)
          throw new Error((response?.data?.errors || []).map(item => item.message).filter(Boolean).join('; ') || 'Cloudflare did not accept the domain request.')
        return response.data.result || {}
      }
      catch (error) {
        const status = Number(error?.response?.status || 0)
        // GET/PATCH are safe to repeat. A POST timeout can have succeeded;
        // resolve its uncertain result with GET instead of sending it twice.
        if (method !== 'POST' && attempt < 1 && (!status || status === 429 || status >= 500)) {
          await sleep(300)
          continue
        }
        throw error
      }
    }
  }
  function result(data) {
    const status = String(data.status || 'pending').toLowerCase()
    const validation = data.validation_data || {}
    const verification = data.verification_data || {}
    const providerError = [validation.error_message, verification.error_message].filter(Boolean).join('; ')
    const failed = ['error', 'failed', 'blocked', 'deactivated'].includes(status) || Boolean(providerError)
    const error = providerError || (failed ? `Cloudflare reported domain status: ${status}.` : '')
    return { ok: true, active: status === 'active' && !failed, status: failed ? 'failed' : status === 'active' ? 'active' : 'pending', providerStatus: status, validationStatus: validation.status || '', verificationStatus: verification.status || '', error, checkedAt: new Date().toISOString() }
  }
  async function read(domain) {
    if (!configured)
      return { ok: false, active: false, status: 'failed', error: 'Cloudflare Pages domain configuration is missing.', checkedAt: new Date().toISOString() }
    try { return result(await request('GET', domain)) }
    catch (error) {
      return { ok: false, active: false, status: Number(error?.response?.status) === 404 ? 'missing' : 'failed', error: errorMessage(error), checkedAt: new Date().toISOString() }
    }
  }
  async function ensure(domain) {
    const current = await read(domain)
    if (current.status !== 'missing') return current
    try { await request('POST', domain) }
    catch (error) {
      // A conflict or timeout is only success if the following read confirms it.
      const after = await read(domain)
      return after.ok ? after : { ...after, error: errorMessage(error) }
    }
    return read(domain)
  }
  async function verify(domain, current, { retry = true } = {}) {
    if (!current?.ok || current.active || !retry) return current
    try {
      await request('PATCH', domain)
      let state = await read(domain)
      // Brief bounded follow-up, not a fixed DNS-propagation delay.
      for (let attempt = 0; attempt < 2 && state.ok && state.status === 'pending'; attempt++) {
        await sleep(1000)
        state = await read(domain)
      }
      return state
    }
    catch (error) { return { ...current, active: false, status: 'failed', error: errorMessage(error), checkedAt: new Date().toISOString() } }
  }
  return { read, ensure, verify }
}

function connectionFields(www, apex, dns) {
  const states = [www, apex].filter(Boolean)
  const errors = [...states.map(state => state.error), dns?.error].filter(Boolean)
  const failed = states.some(state => !state.ok || ['failed', 'missing'].includes(state.status)) || (dns?.attempted && !dns.ok)
  return {
    connectionStatus: failed ? 'failed' : states.every(state => state.active) ? 'active' : 'pending',
    connectionError: errors.join('; '),
    connectionCheckedAt: new Date().toISOString(),
    wwwStatus: www?.status || 'unknown', apexStatus: apex?.status || 'unknown',
    wwwProviderStatus: www?.providerStatus || '', apexProviderStatus: apex?.providerStatus || '',
  }
}

async function normalizeStoredSiteDomains({ db, ref, normalize }) {
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists)
      return false
    const data = snap.data() || {}
    // A telemetry-only document must not acquire domain settings.
    if (!Object.prototype.hasOwnProperty.call(data, 'domains'))
      return false
    const normalized = normalize(data)
    if (Object.entries(normalized).every(([key, value]) => JSON.stringify(data[key]) === JSON.stringify(value)))
      return false
    transaction.set(ref, normalized, { merge: true })
    return true
  })
}

module.exports = { createDomainConnection, connectionFields, normalizeStoredSiteDomains }
