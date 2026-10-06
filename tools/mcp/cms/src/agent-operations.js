// Draft-only CMS operations through the Hub's agent endpoint
// (cms-agentOperation), with an agent key a developer created in the Hub
// (Dev Mode > Agent Keys). The endpoint can only check and run the CMS
// operations; nothing here can publish a page or release a block.
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const expandHome = (filePath, homeDir) => (filePath.startsWith('~/') ? path.join(homeDir, filePath.slice(2)) : filePath)

// The key, from EDGE_CMS_AGENT_KEY or the file named by the config's
// agentKeyFile. Null when neither is set.
export async function resolveAgentKey({ env = process.env, config = {}, homeDir = os.homedir(), readFileImpl = readFile } = {}) {
  const fromEnv = String(env.EDGE_CMS_AGENT_KEY || '').trim()
  if (fromEnv)
    return fromEnv
  const file = String(config.agentKeyFile || '').trim()
  if (!file)
    return null
  try {
    return String(await readFileImpl(expandHome(file, homeDir), 'utf8')).trim() || null
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return null
    throw error
  }
}

export function agentEndpoint({ env = process.env, config = {} } = {}) {
  return String(env.EDGE_CMS_AGENT_ENDPOINT || config.agentEndpoint || '').trim()
    || `https://us-central1-${config.projectId}.cloudfunctions.net/cms-agentOperation`
}

const NO_KEY_MESSAGE = 'No agent key is configured. Create one in the Hub (Dev Mode > Agent Keys), then set EDGE_CMS_AGENT_KEY for the MCP or save it to the file named by agentKeyFile in the MCP config.'

// check(orgId, operation) and run(orgId, operation, checksum). Each result is
// the Hub's JSON answer plus `httpStatus`; refusals come back as
// { ok: false, httpStatus, code, message, details } so the agent can see why
// and fix the operation.
export function createAgentOperationClient({ endpoint, getKey, fetchImpl = globalThis.fetch, client = 'edge-cms-mcp' }) {
  const post = async (body) => {
    const key = await getKey()
    if (!key)
      return { ok: false, httpStatus: 0, code: 'no-agent-key', message: NO_KEY_MESSAGE, details: null }
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
        body: JSON.stringify({ ...body, client }),
      })
    }
    catch (error) {
      return { ok: false, httpStatus: 0, code: 'unreachable', message: `Could not reach ${endpoint}: ${error.message}`, details: null }
    }
    let payload
    try {
      payload = await response.json()
    }
    catch {
      payload = { ok: false, code: 'bad-response', message: `The endpoint returned HTTP ${response.status} without JSON.` }
    }
    return { ...payload, httpStatus: response.status }
  }
  return {
    endpoint,
    check: (orgId, operation) => post({ orgId, action: 'check', operation }),
    run: (orgId, operation, checksum) => post({ orgId, action: 'run', operation, checksum }),
    preview: (orgId, siteId, pageId, source = 'draft', blockDrafts = true, { viewport, width } = {}) => post({ orgId, action: 'preview', siteId, pageId, source, blockDrafts, ...(viewport ? { viewport } : {}), ...(width ? { width } : {}) }),
    readiness: (orgId, siteId) => post({ orgId, action: 'readiness', siteId }),
  }
}
