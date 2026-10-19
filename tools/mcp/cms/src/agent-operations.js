// Draft-only CMS operations through the Hub's agent endpoint
// (cms-agentOperation), with an agent key a developer created in the Hub
// (Dev Mode > Agent Keys). The endpoint can only check and run the CMS
// operations and read sites, pages and posts; nothing here can publish a
// page or post or release a block.
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const expandHome = (filePath, homeDir) => (filePath.startsWith('~/') ? path.join(homeDir, filePath.slice(2)) : filePath)

export const MAX_OPERATION_FILE_BYTES = 2 * 1024 * 1024

// An operation read from a local JSON file, so a large operation (a whole
// block definition) reaches the Hub exactly as a script wrote it instead of
// being retyped into the tool call. The file must be a .json file inside one
// of `roots` (the Hub checkout, the block workspace, the temp directory).
// Returns { ok: true, operation, source } or a refusal like the Hub's.
export async function loadOperationFile(file, { roots = [], baseDir = process.cwd(), homeDir = os.homedir(), readFileImpl = readFile, realpathImpl = realpath, statImpl = stat } = {}) {
  const refuse = (code, message) => ({ ok: false, httpStatus: 0, code, message, details: null })
  const requested = String(file || '').trim()
  if (!requested.toLowerCase().endsWith('.json'))
    return refuse('operation-file-invalid', `operationFile must be a .json file: ${requested || '(empty)'}`)
  let resolved
  try {
    resolved = await realpathImpl(path.resolve(baseDir, expandHome(requested, homeDir)))
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return refuse('operation-file-missing', `operationFile does not exist: ${requested}`)
    throw error
  }
  const allowedRoots = []
  for (const root of roots.filter(Boolean)) {
    try {
      allowedRoots.push(await realpathImpl(path.resolve(baseDir, root)))
    }
    catch {}
  }
  const inside = allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))
  if (!inside)
    return refuse('operation-file-outside', `operationFile must be inside the Hub checkout, the block workspace or the temp directory: ${resolved}`)
  const { size } = await statImpl(resolved)
  if (size > MAX_OPERATION_FILE_BYTES)
    return refuse('operation-file-invalid', `operationFile is ${size} bytes; the limit is ${MAX_OPERATION_FILE_BYTES}.`)
  const text = String(await readFileImpl(resolved, 'utf8'))
  let operation
  try {
    operation = JSON.parse(text)
  }
  catch (error) {
    return refuse('operation-file-invalid', `operationFile is not valid JSON: ${error.message}`)
  }
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof operation.type !== 'string')
    return refuse('operation-file-invalid', 'operationFile must hold one operation object with a "type".')
  return {
    ok: true,
    operation,
    source: { path: resolved, bytes: size, sha256: createHash('sha256').update(text).digest('hex') },
  }
}

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

// check(orgId, operation) and run(orgId, operation, checksum), and the
// reads preview, readiness, pages, page, posts and post. Each result is
// the Hub's JSON answer plus `httpStatus`; refusals come back as
// { ok: false, httpStatus, code, message, details } so the agent can see why
// and fix the operation.
export function createAgentOperationClient({ endpoint, getKey, connections, fetchImpl = globalThis.fetch, client = 'edge-cms-mcp' }) {
  const post = async (body, sessionId) => {
    let key
    if (connections) {
      const credential = await connections.credential(sessionId, body)
      if (!credential.ok)
        return { ...credential, httpStatus: credential.httpStatus || 0, details: null }
      key = credential.token
    }
    else {
      key = await getKey()
    }
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
    check: (orgId, operation, sessionId) => post({ orgId, action: 'check', operation }, sessionId),
    run: (orgId, operation, checksum, sessionId) => post({ orgId, action: 'run', operation, checksum }, sessionId),
    preview: (orgId, siteId, pageId, source = 'draft', blockDrafts = true, { viewport, width, sessionId } = {}) => post({ orgId, action: 'preview', siteId, pageId, source, blockDrafts, ...(viewport ? { viewport } : {}), ...(width ? { width } : {}) }, sessionId),
    readiness: (orgId, siteId, sessionId) => post({ orgId, action: 'readiness', siteId }, sessionId),
    pages: (orgId, siteId, sessionId) => post({ orgId, action: 'pages', siteId }, sessionId),
    page: (orgId, siteId, pageId, { source = 'draft', includeValues = true, includeSchema = false, sessionId } = {}) => post({ orgId, action: 'page', siteId, pageId, source, includeValues, includeSchema }, sessionId),
    posts: (orgId, siteId, { type, tag, limit, startAfter, sessionId } = {}) => post({ orgId, action: 'posts', siteId, ...(type ? { type } : {}), ...(tag ? { tag } : {}), ...(limit ? { limit } : {}), ...(startAfter ? { startAfter } : {}) }, sessionId),
    post: (orgId, siteId, postId, { source = 'draft', includeValues = true, includeSchema = false, sessionId } = {}) => post({ orgId, action: 'post', siteId, postId, source, includeValues, includeSchema }, sessionId),
  }
}
