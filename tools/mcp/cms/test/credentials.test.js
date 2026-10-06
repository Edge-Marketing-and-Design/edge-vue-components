import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CREDENTIALS_FILE, describeCredentials, resolveCredentials } from '../src/credentials.js'

const key = { type: 'service_account', client_email: 'firebase-readonly-mcp@clearwater-hub.iam.gserviceaccount.com', private_key: 'secret' }
const resolveWith = ({ env = {}, files = {}, configFile = '' }) => resolveCredentials({
  env,
  configFile,
  homeDir: '/home/dev',
  fileExists: filePath => Object.hasOwn(files, filePath),
  readJson: filePath => files[filePath],
})

test('the conventional key file is used without any environment setup', () => {
  assert.equal(DEFAULT_CREDENTIALS_FILE, '~/.config/clearwater/firebase-readonly-mcp.json')
  const result = resolveWith({ files: { '/home/dev/.config/clearwater/firebase-readonly-mcp.json': key } })
  assert.equal(result.source, 'default-credentials-file')
  assert.equal(result.readOnlyServiceAccount, true)
  assert.equal(result.account, key.client_email)
})

test('explicit environment variables take precedence in order', () => {
  const files = { '/keys/mcp.json': key, '/keys/google.json': key, '/home/dev/.config/clearwater/firebase-readonly-mcp.json': key }
  assert.equal(resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '/keys/mcp.json', GOOGLE_APPLICATION_CREDENTIALS: '/keys/google.json' }, files }).filePath, '/keys/mcp.json')
  assert.equal(resolveWith({ env: { GOOGLE_APPLICATION_CREDENTIALS: '/keys/google.json' }, files }).source, 'env:GOOGLE_APPLICATION_CREDENTIALS')
  assert.equal(resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '~/keys.json' }, files: { '/home/dev/keys.json': key } }).filePath, '/home/dev/keys.json')
})

test('a configured path that does not exist fails instead of falling back to personal credentials', () => {
  assert.throws(() => resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '/missing.json' } }), /missing credentials file/)
})

test('without a key file the MCP reports Application Default Credentials', () => {
  const result = resolveWith({})
  assert.deepEqual(result, { source: 'application-default', filePath: '', account: '', readOnlyServiceAccount: false })
  assert.deepEqual(describeCredentials(result), { source: 'application-default', account: 'application default credentials', readOnlyServiceAccount: false })
})

test('a file that is not a service account key is rejected', () => {
  assert.throws(() => resolveWith({ files: { '/home/dev/.config/clearwater/firebase-readonly-mcp.json': { type: 'authorized_user' } } }), /not a service account key/)
})

test('the credential summary never exposes key material or the file path', () => {
  const summary = describeCredentials(resolveWith({ files: { '/home/dev/.config/clearwater/firebase-readonly-mcp.json': key } }))
  assert.deepEqual(summary, { source: 'default-credentials-file', account: key.client_email, readOnlyServiceAccount: true })
  assert.equal(JSON.stringify(summary).includes('secret'), false)
  assert.equal(JSON.stringify(summary).includes('/home/dev'), false)
})
