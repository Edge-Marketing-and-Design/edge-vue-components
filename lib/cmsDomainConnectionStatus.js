// Missing activation data is unknown, not pending verification. Older deployed
// APIs expose registration flags without a live activation status.
export function getCmsDomainConnectionStatus(domains = [], registry = {}) {
  const entries = [...new Set(domains)].map(domain => registry[domain])
  const failures = entries.filter(entry => entry?.connectionStatus === 'failed')
  const pending = entries.filter(entry => entry?.connectionStatus === 'pending')
  return {
    status: failures.length ? 'failed' : pending.length ? 'pending'
      : entries.length && entries.every(entry => entry?.connectionStatus === 'active') ? 'active' : 'unknown',
    error: failures.map(entry => entry.connectionError || '').filter(Boolean).join('; '),
    checkedAt: entries.map(entry => entry?.connectionCheckedAt).filter(Boolean).sort().pop() || '',
  }
}
