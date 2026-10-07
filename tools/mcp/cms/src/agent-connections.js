import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function resolveConnectionKey({ env = process.env, config = {}, readFileImpl = readFile, homeDir = os.homedir() } = {}) {
  const fromEnv = String(env.EDGE_CMS_AGENT_CONNECTION || '').trim()
  if (fromEnv)
    return fromEnv
  const file = String(config.agentConnectionFile || '').trim()
  if (!file)
    return null
  try {
    return String(await readFileImpl(file.startsWith('~/') ? path.join(homeDir, file.slice(2)) : file, 'utf8')).trim() || null
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return null
    throw new Error('Could not read the configured agent connection file.')
  }
}

export function createConnectionClient({ endpoint, getConnectionKey, fetchImpl = globalThis.fetch, now = Date.now }) {
  const sessions = new Map()
  const post = async (body) => {
    const credential = await getConnectionKey()
    if (!credential)
      return { ok: false, code: 'no-agent-connection', message: 'Create a connection in the Hub (Dev Mode > Agent Keys) and install its credential outside Git.' }
    let response
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${credential}` }, body: JSON.stringify(body) })
    }
    catch {
      return { ok: false, code: 'unreachable', message: 'Could not reach the Hub connection endpoint.' }
    }
    try {
      return { ...await response.json(), httpStatus: response.status }
    }
    catch {
      return { ok: false, httpStatus: response.status, code: 'bad-response', message: 'The Hub connection endpoint did not return JSON.' }
    }
  }
  const issueSession = async (target) => {
    const result = await post({ action: 'session', ...target })
    if (!result.ok)
      return result
    if (result.orgId !== target.orgId || result.siteId !== (target.siteId || null) || result.scope !== target.scope || !/^cmsas\.[a-f0-9]{40}\.[A-Za-z0-9_-]{43}$/.test(result.token || '') || !(Date.parse(result.expiresAt) > now()))
      return { ok: false, code: 'invalid-session', message: 'The Hub returned a session with an unexpected target or credential.' }
    return result
  }
  return {
    organizations: (options = {}) => post({ action: 'organizations', ...options }),
    async open({ orgId, siteId, scope }) {
      if (!orgId || !['organization', 'site'].includes(scope) || (scope === 'site' && !siteId) || (scope === 'organization' && siteId))
        return { ok: false, code: 'invalid-target', message: 'Name the organization and scope explicitly; site scope also requires a site id.' }
      const target = { orgId, scope, ...(siteId ? { siteId } : {}) }
      const result = await issueSession(target)
      if (!result.ok)
        return result
      const sessionId = randomUUID()
      sessions.set(sessionId, { target, result })
      const { token: _token, sessionId: _hubSessionId, ...safe } = result
      return { ...safe, sessionId }
    },
    async credential(sessionId, body) {
      const session = sessions.get(sessionId)
      if (!session)
        return { ok: false, code: 'session-required', message: 'Open an explicit target with cms_open_session and pass its sessionId.' }
      const targetSite = ['check', 'run'].includes(body.action) ? body.operation?.siteId : body.siteId
      const type = body.operation?.type || ''
      const siteOperation = ['preview', 'readiness'].includes(body.action) || type.startsWith('page.') || type === 'site.update'
      if (body.orgId !== session.target.orgId || (session.target.scope === 'site' && (!siteOperation || targetSite !== session.target.siteId)) || (session.target.scope === 'organization' && siteOperation))
        return { ok: false, code: 'session-target-mismatch', message: 'This request does not match the selected organization/site session. Open a separate session for another target.' }
      if (Date.parse(session.result.expiresAt) <= now() + 30000) {
        // Refresh only this handle's immutable target; never a global active org.
        const refreshed = await issueSession(session.target)
        if (!refreshed.ok)
          return refreshed
        session.result = refreshed
      }
      return { ok: true, token: session.result.token }
    },
  }
}
