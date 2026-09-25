import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Conventional location of the read-only service account key. Keeping the
// default here means no shell or app environment is needed for the MCP to
// run on read-only credentials.
export const DEFAULT_CREDENTIALS_FILE = '~/.config/clearwater/firebase-readonly-mcp.json'

const expandHome = (filePath, homeDir) => (filePath.startsWith('~/') ? path.join(homeDir, filePath.slice(2)) : filePath)

// Chooses the credentials the MCP uses, in order:
// 1. EDGE_CMS_MCP_CREDENTIALS (or CLEARWATER_FIRESTORE_MCP_CREDENTIALS), 2. GOOGLE_APPLICATION_CREDENTIALS,
// 3. config credentialsFile or the conventional key file,
// 4. Application Default Credentials (the operator's gcloud login).
// An explicitly configured path that does not exist is an error, not a
// silent fallback to personal credentials.
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
  else {
    const candidate = expandHome(String(configFile || DEFAULT_CREDENTIALS_FILE).trim(), homeDir)
    if (!fileExists(candidate))
      return { source: 'application-default', filePath: '', account: '', readOnlyServiceAccount: false }
    source = configFile ? 'config:credentialsFile' : 'default-credentials-file'
    filePath = candidate
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
  readOnlyServiceAccount: credentials.readOnlyServiceAccount,
})
