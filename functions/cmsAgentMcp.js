// Remote CMS MCP: the Hub's agent tools over MCP Streamable HTTP, stateless,
// so any Cloud Run instance answers any request. The client sends its Hub
// connection credential (Authorization: Bearer cmsac.…) on every request; the
// server issues and renews the 15-minute cmsas.… sessions itself and runs
// the same code as cms-agentConnection and cms-agentOperation in-process, so
// every call re-runs their checks (connection not revoked or expired, the
// creator's current Hub roles, organization and site scope, per-operation
// permissions). Tool names and schemas come from the shared definitions in
// helpers/cmsAgentMcpTools.mjs, which the local MCP also uses.
// Keep identical in functions/.
const { db, onRequest, HttpsError, logger } = require('./config.js')
const { issueAgentSession, organizationPage, verifyConnection } = require('./cmsAgentConnections.js')
const { agentErrorResponse, handleAgentRequest } = require('./cmsAgentKeys.js')

const CLIENT = 'edge-cms-remote-mcp'
const SERVER_INFO = { name: 'edge-cms', version: '0.1.0' }
// Renew a cached session this long before it expires.
const RENEW_MS = 60 * 1000
const SITE_READS = ['preview', 'readiness', 'pages', 'page']

const definitionsPromise = Promise.all([import('./helpers/cmsAgentMcpTools.mjs'), import('./helpers/cmsOperations.mjs')])

const jsonResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const refusal = (error) => {
  const { status, body } = agentErrorResponse(error)
  return { ...body, httpStatus: status }
}

// The tool handlers for one verified connection. Sessions are cached per
// instance by connection and target; the cache only saves session writes,
// since every call is checked again by the Hub code.
const createRemoteCms = ({ now = Date.now, issueSession = issueAgentSession, handle = handleAgentRequest, listOrganizations = organizationPage } = {}) => {
  const sessions = new Map()
  const sessionFor = async (connection, target, { fresh = false } = {}) => {
    const key = [connection.id, target.orgId, target.scope, target.siteId || ''].join('|')
    const cached = sessions.get(key)
    if (!fresh && cached && Date.parse(cached.expiresAt) - RENEW_MS > now())
      return { session: cached, reused: true }
    sessions.delete(key)
    const session = await issueSession(connection, target)
    sessions.set(key, session)
    return { session, reused: false }
  }

  // The target named by a cms_open_session handle, or the explicit orgId
  // with the scope and site the request needs.
  const targetFor = async (connection, { sessionId, orgId }, scope, siteId) => {
    if (!sessionId) {
      if (!orgId)
        throw new HttpsError('invalid-argument', 'Pass orgId (from cms_agent_organizations) or a sessionId from cms_open_session.')
      return { orgId, scope, ...(scope === 'site' ? { siteId } : {}) }
    }
    const snap = await db.collection('agent-sessions').doc(String(sessionId)).get()
    const session = snap.exists ? snap.data() : null
    if (!session || session.connectionId !== connection.id)
      throw new HttpsError('permission-denied', 'Unknown sessionId. Open one with cms_open_session, or leave it out and pass orgId.')
    if (orgId && orgId !== session.orgId)
      throw new HttpsError('permission-denied', 'This request does not match the selected organization/site session. Open a separate session for another target.')
    return { orgId: session.orgId, scope: session.scope, ...(session.siteId ? { siteId: session.siteId } : {}) }
  }

  // One cms-agentOperation action as a site or organization session.
  const call = async (connection, input, body) => {
    const type = body.operation?.type || ''
    const siteScoped = SITE_READS.includes(body.action) || type.startsWith('page.') || type === 'site.update'
    const siteId = (body.action === 'check' || body.action === 'run') ? body.operation?.siteId : body.siteId
    const target = await targetFor(connection, input, siteScoped ? 'site' : 'organization', siteId)
    const request = { ...body, orgId: target.orgId, client: CLIENT }
    let { session, reused } = await sessionFor(connection, target)
    try {
      return await handle({ header: `Bearer ${session.token}`, body: request })
    }
    catch (error) {
      // A cached session the Hub no longer accepts: issue a new one once.
      if (!reused || error?.code !== 'unauthenticated')
        throw error
      ;({ session } = await sessionFor(connection, target, { fresh: true }))
      return handle({ header: `Bearer ${session.token}`, body: request })
    }
  }

  const tool = run => async (input) => {
    try {
      return jsonResult({ ok: true, ...await run(input), httpStatus: 200 })
    }
    catch (error) {
      return jsonResult(refusal(error))
    }
  }

  const handlers = connection => ({
    cms_agent_organizations: tool(input => listOrganizations(connection.data.createdBy, input)),
    cms_open_session: tool(async ({ orgId, scope, siteId }) => {
      const { session } = await sessionFor(connection, { orgId, scope, ...(siteId ? { siteId } : {}) })
      const { token: _token, ...safe } = session
      return safe
    }),
    cms_check_operation: tool(input => call(connection, input, { action: 'check', operation: input.operation })),
    cms_run_operation: tool(input => call(connection, input, { action: 'run', operation: input.operation, checksum: input.checksum })),
    cms_preview_url: tool(({ siteId, pageId, source, blockDrafts, viewport, width, ...input }) => call(connection, input, { action: 'preview', siteId, pageId, source, blockDrafts, ...(viewport ? { viewport } : {}), ...(width ? { width } : {}) })),
    cms_site_readiness: tool(({ siteId, ...input }) => call(connection, input, { action: 'readiness', siteId })),
    cms_list_pages: tool(({ siteId, ...input }) => call(connection, input, { action: 'pages', siteId })),
    cms_get_page: tool(({ siteId, pageId, source, includeValues, includeSchema, ...input }) => call(connection, input, { action: 'page', siteId, pageId, source, includeValues, includeSchema })),
  })

  return { handlers, sessions }
}

// The MCP server for one request: the remote subset of the shared tools.
const buildServer = async (connection, remote) => {
  const [{ cmsAgentToolDefinitions }, { CMS_OPERATION_TYPES }] = await definitionsPromise
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
  const { z } = require('zod')
  const server = new McpServer(SERVER_INFO)
  const handlers = remote.handlers(connection)
  for (const { name, ...definition } of cmsAgentToolDefinitions({ z, operationTypes: CMS_OPERATION_TYPES, remote: true })) {
    if (!handlers[name])
      throw new Error(`No remote handler for the CMS tool ${name}.`)
    server.registerTool(name, definition, handlers[name])
  }
  return server
}

const rpcError = (res, status, message, headers = {}) => {
  res.status(status)
  for (const [name, value] of Object.entries(headers))
    res.set(name, value)
  res.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
}

// Serves one MCP request. Exported for tests with an injected remote.
const serveMcp = async (req, res, remote) => {
  if (req.method !== 'POST') {
    rpcError(res, 405, 'This MCP server is stateless: send JSON-RPC messages with POST.', { Allow: 'POST' })
    return
  }
  const header = req.get ? req.get('authorization') : req.headers?.authorization
  let connection
  try {
    connection = await verifyConnection(header)
  }
  catch (error) {
    const { status, body } = agentErrorResponse(error)
    const challenge = status === 401 ? { 'WWW-Authenticate': 'Bearer error="invalid_token"' } : {}
    rpcError(res, status, body.message, challenge)
    return
  }
  const { WebStandardStreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')
  const server = await buildServer(connection, remote)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  try {
    await server.connect(transport)
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    const host = headers.get('host') || 'localhost'
    const response = await transport.handleRequest(new Request(`https://${host}${req.originalUrl || req.url || '/'}`, { method: 'POST', headers }), { parsedBody: req.body })
    res.status(response.status)
    response.headers.forEach((value, name) => res.set(name, value))
    res.send(Buffer.from(await response.arrayBuffer()))
  }
  finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

const remote = createRemoteCms()

// Long timeout: tool calls such as readiness read a whole site.
exports.agentMcp = onRequest({ timeoutSeconds: 540, memory: '512MiB' }, async (req, res) => {
  try {
    await serveMcp(req, res, remote)
  }
  catch (error) {
    logger.error('Agent MCP request failed', { error: error?.message })
    if (!res.headersSent)
      rpcError(res, 500, 'The MCP request failed.')
  }
})

// For tests.
exports.createRemoteCms = createRemoteCms
exports.serveMcp = serveMcp
