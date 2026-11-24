// Read-only Google access tokens for the Search Console API, without
// dependencies. Accepts either credential file Google issues:
//   - a service account key ({ "type": "service_account", ... }), added as a
//     user on each Search Console property; best for scheduled runs
//   - an authorized-user file from `gcloud auth application-default login`
//     ({ "type": "authorized_user", ... }); uses the person's own access
// The file comes from --credentials, EDGE_SEARCH_CONSOLE_CREDENTIALS, or
// ~/.config/edge-search-console/credentials.json. It is never printed, copied
// or committed; errors name the file and Google's error code only.
import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const DEFAULT_CREDENTIALS = join(homedir(), '.config', 'edge-search-console', 'credentials.json')

export const credentialsPath = (explicit = '') =>
  explicit || process.env.EDGE_SEARCH_CONSOLE_CREDENTIALS || DEFAULT_CREDENTIALS

export const loadCredentials = (path = credentialsPath()) => {
  if (!existsSync(path))
    throw Object.assign(new Error(`No Search Console credentials at ${path}. See edge/skills/edge-search-health/reference/search-console-setup.md.`), { code: 'no-credentials' })
  let credentials
  try {
    credentials = JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    throw new Error(`${path} is not a JSON credentials file.`)
  }
  if (credentials.type === 'service_account' && credentials.client_email && credentials.private_key)
    return credentials
  if (credentials.type === 'authorized_user' && credentials.refresh_token && credentials.client_id && credentials.client_secret)
    return credentials
  throw new Error(`${path} is neither a service account key nor an authorized-user file.`)
}

const base64url = value => Buffer.from(value).toString('base64url')

// A signed JWT assertion for the OAuth token endpoint.
export const serviceAccountAssertion = (credentials, scope = SEARCH_CONSOLE_SCOPE, now = Math.floor(Date.now() / 1000)) => {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: credentials.private_key_id }))
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${signer.sign(credentials.private_key).toString('base64url')}`
}

export const getAccessToken = async (credentials, { scope = SEARCH_CONSOLE_SCOPE, fetcher = fetch } = {}) => {
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token'
  const body = credentials.type === 'service_account'
    ? new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(credentials, scope) })
    : new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.client_id, client_secret: credentials.client_secret, refresh_token: credentials.refresh_token })
  const response = await fetcher(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    const hint = data.error === 'invalid_grant'
      ? ' The login expired or was revoked: sign in again (reference/search-console-setup.md).'
      : ''
    throw new Error(`Google token request failed (${response.status} ${data.error || ''}).${hint}`)
  }
  if (credentials.type === 'authorized_user' && data.scope && !data.scope.split(' ').some(granted => granted === SEARCH_CONSOLE_SCOPE || granted === 'https://www.googleapis.com/auth/webmasters'))
    throw new Error('This login does not include Search Console access. Sign in again with the webmasters.readonly scope (reference/search-console-setup.md).')
  return data.access_token
}
