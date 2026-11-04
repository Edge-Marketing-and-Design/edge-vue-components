import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// There is no default key file: each Hub names its own read-only key in its
// .mcp.json (EDGE_CMS_MCP_CREDENTIALS) or MCP config (credentialsFile), so a
// server never falls back to another Hub's key.
export const CREDENTIALS_NOT_CONFIGURED = 'not-configured'

const expandHome = (filePath, homeDir) => (filePath.startsWith('~/') ? path.join(homeDir, filePath.slice(2)) : filePath)

// Chooses the credentials the MCP uses, in order:
// 1. EDGE_CMS_MCP_CREDENTIALS (or CLEARWATER_FIRESTORE_MCP_CREDENTIALS), 2. GOOGLE_APPLICATION_CREDENTIALS,
// 3. config credentialsFile.
// Without any of them the result is `not-configured`: the server reports it
// and runs on Application Default Credentials (the operator's gcloud login;
// the emulators ignore credentials). A configured path that does not exist is
// an error, not a silent fallback to personal credentials.
export function resolveCredentials({
  env = process.env,
  configFile = '',
  homeDir = os.homedir(),
  fileExists = existsSync,
  readJson = filePath => JSON.parse(readFileSync(filePath, 'utf8')),
} = {}) {
  const explicit = [
    ['EDGE_CMS_MCP_CREDENTIALS', env.EDGE_CMS_MCP_CREDENTIALS],
    ['CLEARWATER_FIRESTORE_MCP_CREDENTIALS', env.CLEARWATER_FIRESTORE_MCP_CREDENTIALS],
    ['GOOGLE_APPLICATION_CREDENTIALS', env.GOOGLE_APPLICATION_CREDENTIALS],
  ].find(([, value]) => String(value || '').trim())

  let source
  let filePath
  if (explicit) {
    source = `env:${explicit[0]}`
    filePath = expandHome(String(explicit[1]).trim(), homeDir)
    if (!fileExists(filePath))
      throw new Error(`${explicit[0]} points to a missing credentials file: ${filePath}`)
  }
  else if (String(configFile || '').trim()) {
    source = 'config:credentialsFile'
    filePath = expandHome(String(configFile).trim(), homeDir)
    if (!fileExists(filePath))
      throw new Error(`The MCP config's credentialsFile points to a missing credentials file: ${filePath}`)
  }
  else {
    return { source: CREDENTIALS_NOT_CONFIGURED, filePath: '', account: '', readOnlyServiceAccount: false }
  }

  const key = readJson(filePath)
  if (key?.type !== 'service_account')
    throw new Error(`Credentials file is not a service account key: ${filePath}`)
  return { source, filePath, account: String(key.client_email || ''), readOnlyServiceAccount: true, key }
}

// Safe to include in tool results: no key material or file path.
export const describeCredentials = credentials => ({
  source: credentials.source,
  account: credentials.account || 'application default credentials',
  ...(credentials.source === CREDENTIALS_NOT_CONFIGURED ? { note: 'No read-only key is configured for this Hub: set EDGE_CMS_MCP_CREDENTIALS in its .mcp.json (or credentialsFile in its MCP config).' } : {}),
  readOnlyServiceAccount: credentials.readOnlyServiceAccount,
})
