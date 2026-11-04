// The freshness result launch.sh passes in EDGE_CMS_CHECKOUT_STATUS (JSON):
// { hub: { state, branch, behind, ... }, renderer: { ... }, dependencies,
// checkedAt }. When the Hub or the emd-cms-front checkout is behind
// origin/main, cms_guide, cms_contract and cms_agent_organizations carry one
// notice saying so. Nothing is blocked: every write still goes through the
// Hub's own checks.

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

export function parseCheckoutStatus(raw) {
  if (!String(raw || '').trim())
    return null
  try {
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

const describe = (label, entry) => {
  if (!isObject(entry) || entry.state !== 'behind')
    return ''
  const count = Number(entry.behind) || 0
  const where = entry.branch && entry.branch !== 'main' ? `branch ${entry.branch}` : 'main'
  const reason = entry.detail ? ` (${entry.detail})` : ''
  return `The ${label} checkout (${where}) is ${count} commit${count === 1 ? '' : 's'} behind origin/main${reason}.`
}

// One notice for the whole server, or null when everything is current.
export function checkoutNotice(status) {
  if (!isObject(status))
    return null
  const parts = [describe('Hub', status.hub), describe('emd-cms-front', status.renderer)].filter(Boolean)
  if (status.dependencies === 'install-failed')
    parts.push('npm ci for the CMS MCP failed at startup; it runs on the dependencies already installed.')
  if (!parts.length)
    return null
  return {
    message: `${parts.join(' ')} This server's guide, contracts, validator and local checks come from that checkout and may be out of date; the Hub still checks every write. Update the checkout (or merge main into the branch) and restart the server.`,
    hub: status.hub || null,
    renderer: status.renderer || null,
    checkedAt: status.checkedAt || null,
  }
}

// Adds `checkoutNotice` to a tool result object when there is one.
export const withCheckoutNotice = (result, notice) => (notice && isObject(result) ? { checkoutNotice: notice, ...result } : result)
