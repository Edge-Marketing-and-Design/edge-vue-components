const installations = new WeakMap()
const methods = ['success', 'error', 'info', 'warning', 'dismiss']

// The host owns presentation, queueing and the return value of each method.
export function installEdgeFirebaseToast(edgeFirebase, backend) {
  if (!edgeFirebase || typeof edgeFirebase !== 'object')
    throw new TypeError('A Firebase instance is required to install toast delivery.')
  for (const method of methods) {
    if (typeof backend?.[method] !== 'function')
      throw new TypeError(`The toast backend must implement ${method}().`)
  }

  let installation = installations.get(edgeFirebase)
  if (!installation) {
    installation = { backend, adapter: {} }
    for (const method of methods)
      installation.adapter[method] = (...args) => installation.backend[method](...args)
    installations.set(edgeFirebase, installation)
  }
  installation.backend = backend
  edgeFirebase.toast = installation.adapter
  return installation.adapter
}
