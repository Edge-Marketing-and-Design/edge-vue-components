// Hub-side calls for agent keys (docs/data-contracts/cms-operations/README.md,
// Agent keys). The Firestore wrapper (`edgeFirebase`) is passed in, so this
// stays testable without Vue.

const callableData = response => ((response && typeof response === 'object' && 'data' in response) ? response.data : response) || {}

export const AGENT_KEY_LIFETIMES = Object.freeze([7, 30, 90])

export const createAgentKey = async ({ edgeFirebase, orgId, name, expiresInDays }) =>
  callableData(await edgeFirebase.runFunction('cms-createAgentKey', { orgId, name, expiresInDays }))

export const listAgentKeys = async ({ edgeFirebase, orgId }) =>
  callableData(await edgeFirebase.runFunction('cms-listAgentKeys', { orgId }))

export const revokeAgentKey = async ({ edgeFirebase, orgId, keyId }) =>
  callableData(await edgeFirebase.runFunction('cms-revokeAgentKey', { orgId, keyId }))

// 'revoked', 'expired' or 'active'.
export const agentKeyStatus = (key, now = Date.now()) => {
  if (key?.revokedAt)
    return 'revoked'
  if (!key?.expiresAt || Date.parse(key.expiresAt) <= now)
    return 'expired'
  return 'active'
}

// The endpoint an agent calls with a key, for a Firebase project.
export const agentOperationEndpoint = projectId => `https://us-central1-${projectId}.cloudfunctions.net/cms-agentOperation`
