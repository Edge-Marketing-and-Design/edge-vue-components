import assert from 'node:assert/strict'
import test from 'node:test'
import { CREDENTIALS_GOOGLE_SIGN_IN, describeCredentials, resolveCredentials } from '../src/credentials.js'

const key = { type: 'service_account', client_email: 'firebase-readonly-mcp@clearwater-hub.iam.gserviceaccount.com', private_key: 'secret' }
const resolveWith = ({ env = {}, files = {}, configFile = '' }) => resolveCredentials({
  env,
  configFile,
  homeDir: '/home/dev',
  fileExists: filePath => Object.hasOwn(files, filePath),
  readJson: filePath => files[filePath],
})

test('without a named key the server reads as the developer\'s Google sign-in; another Hub\'s key on disk is never picked up', () => {
  const result = resolveWith({ files: { '/home/dev/.config/clearwater/firebase-readonly-mcp.json': key } })
  assert.deepEqual(result, { source: CREDENTIALS_GOOGLE_SIGN_IN, filePath: '', account: '', readOnlyServiceAccount: false })
  const summary = describeCredentials(result)
  assert.equal(summary.source, 'google-sign-in')
  assert.equal(summary.readOnlyServiceAccount, false)
  assert.match(summary.account, /Google sign-in/)
  assert.match(summary.note, /gcloud auth application-default login/)
})

test('EDGE_CMS_MCP_CREDENTIALS names the key', () => {
  const result = resolveWith({ env: { EDGE_CMS_MCP_CREDENTIALS: '~/.config/clearwater/firebase-readonly-mcp.json' }, files: { '/home/dev/.config/clearwater/firebase-readonly-mcp.json': key } })
  assert.equal(result.source, 'env:EDGE_CMS_MCP_CREDENTIALS')
  assert.equal(result.readOnlyServiceAccount, true)
  assert.equal(result.account, key.client_email)
})

test('explicit environment variables take precedence in order', () => {
  const files = { '/keys/edge.json': key, '/keys/mcp.json': key, '/keys/google.json': key }
  assert.equal(resolveWith({ env: { EDGE_CMS_MCP_CREDENTIALS: '/keys/edge.json', CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '/keys/mcp.json' }, files }).filePath, '/keys/edge.json')
  assert.equal(resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '/keys/mcp.json', GOOGLE_APPLICATION_CREDENTIALS: '/keys/google.json' }, files }).filePath, '/keys/mcp.json')
  assert.equal(resolveWith({ env: { GOOGLE_APPLICATION_CREDENTIALS: '/keys/google.json' }, files }).source, 'env:GOOGLE_APPLICATION_CREDENTIALS')
  assert.equal(resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '~/keys.json' }, files: { '/home/dev/keys.json': key } }).filePath, '/home/dev/keys.json')
  assert.equal(resolveWith({ env: { EDGE_CMS_MCP_CREDENTIALS: '/keys/edge.json' }, configFile: '/keys/mcp.json', files }).source, 'env:EDGE_CMS_MCP_CREDENTIALS')
})

test('a config credentialsFile is used when no environment variable is set', () => {
  const result = resolveWith({ configFile: '~/keys/hub.json', files: { '/home/dev/keys/hub.json': key } })
  assert.equal(result.source, 'config:credentialsFile')
  assert.equal(result.filePath, '/home/dev/keys/hub.json')
})

test('a configured path that does not exist fails instead of falling back to personal credentials', () => {
  assert.throws(() => resolveWith({ env: { CLEARWATER_FIRESTORE_MCP_CREDENTIALS: '/missing.json' } }), /missing credentials file/)
  assert.throws(() => resolveWith({ configFile: '/missing.json' }), /credentialsFile points to a missing credentials file/)
})

test('a file that is not a service account key is rejected', () => {
  assert.throws(() => resolveWith({ env: { EDGE_CMS_MCP_CREDENTIALS: '/k.json' }, files: { '/k.json': { type: 'authorized_user' } } }), /not a service account key/)
})

test('the credential summary never exposes key material or the file path', () => {
  const summary = describeCredentials(resolveWith({ env: { EDGE_CMS_MCP_CREDENTIALS: '/home/dev/k.json' }, files: { '/home/dev/k.json': key } }))
  assert.deepEqual(summary, { source: 'env:EDGE_CMS_MCP_CREDENTIALS', account: key.client_email, readOnlyServiceAccount: true })
  assert.equal(JSON.stringify(summary).includes('secret'), false)
  assert.equal(JSON.stringify(summary).includes('/home/dev'), false)
})
