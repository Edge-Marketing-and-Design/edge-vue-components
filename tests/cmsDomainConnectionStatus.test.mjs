import assert from 'node:assert/strict'
import test from 'node:test'
import { getCmsDomainConnectionStatus } from '../lib/cmsDomainConnectionStatus.js'

test('missing and legacy activation fields do not claim verification is pending', () => {
  for (const entry of [undefined, {}, { wwwAdded: true, apexAdded: true, dnsSyncSucceeded: true }, { connectionStatus: 'unknown' }])
    assert.equal(getCmsDomainConnectionStatus(['example.com'], { 'example.com': entry }).status, 'unknown')
  assert.equal(getCmsDomainConnectionStatus().status, 'unknown')
})
test('only explicit pending data produces the yellow verification state', () => {
  assert.equal(getCmsDomainConnectionStatus(['example.com'], { 'example.com': { connectionStatus: 'pending' } }).status, 'pending')
})
test('confirmed active ignores stale DNS or site setup errors', () => {
  const value = getCmsDomainConnectionStatus(['example.com'], { 'example.com': { connectionStatus: 'active', connectionError: 'old DNS error' } })
  assert.equal(value.status, 'active')
  assert.equal(value.error, '')
})
test('current failures take priority over pending domains, while incomplete data stays unknown', () => {
  const result = getCmsDomainConnectionStatus(['a', 'b'], { a: { connectionStatus: 'pending' }, b: { connectionStatus: 'failed', connectionError: 'Missing binding' } })
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'Missing binding')
  assert.equal(getCmsDomainConnectionStatus(['a', 'b'], { a: { connectionStatus: 'active' } }).status, 'unknown')
})
