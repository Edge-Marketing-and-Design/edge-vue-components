import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Developers read as themselves: with no key named, the server uses the
// person's own Google sign-in (Application Default Credentials, from
// `gcloud auth application-default login`), limited by their access to the
// Hub's Firebase project. A read-only service account key is optional (for
// automation); there is no default key file, so a server never picks up
// another Hub's key.
export const CREDENTIALS_GOOGLE_SIGN_IN = 'google-sign-in'

const expandHome = (filePath, homeDir) => (filePath.startsWith('~/') ? path.join(homeDir, filePath.slice(2)) : filePath)

// Chooses the credentials the MCP uses, in order:
// 1. EDGE_CMS_MCP_CREDENTIALS (or CLEARWATER_FIRESTORE_MCP_CREDENTIALS), 2. GOOGLE_APPLICATION_CREDENTIALS,
// 3. config credentialsFile.
// Without any of them the result is `google-sign-in`: the server runs on
// Application Default Credentials, the developer's own Google sign-in (the
// emulators ignore credentials). A configured path that does not exist is an
// error, not a silent fallback to the sign-in.
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
    return { source: CREDENTIALS_GOOGLE_SIGN_IN, filePath: '', account: '', readOnlyServiceAccount: false }
  }

  const key = readJson(filePath)
  if (key?.type !== 'service_account')
    throw new Error(`Credentials file is not a service account key: ${filePath}`)
  return { source, filePath, account: String(key.client_email || ''), readOnlyServiceAccount: true, key }
}

// Safe to include in tool results: no key material or file path.
export const describeCredentials = credentials => ({
  source: credentials.source,
  account: credentials.account || 'your Google sign-in (gcloud auth application-default login)',
  ...(credentials.source === CREDENTIALS_GOOGLE_SIGN_IN ? { note: 'Reads run as your own Google sign-in, with your access to this Hub\'s Firebase project. If reads fail with a credentials or permission error, run gcloud auth application-default login, or ask for access to the project.' } : {}),
  readOnlyServiceAccount: credentials.readOnlyServiceAccount,
})
