// Stands in for the Nuxt app the renderer's client plugins expect, so the
// same DOM helpers run on a static page with no Nuxt, router or Hub calls.
const hooks = new Map()

export const nuxtApp = {
  hook(name, fn) {
    if (!hooks.has(name))
      hooks.set(name, [])
    hooks.get(name).push(fn)
  },
  provide(name, value) {
    nuxtApp[`$${name}`] = value
  },
  async callHook(name) {
    for (const fn of hooks.get(name) || [])
      await fn()
  },
}

export const defineNuxtPlugin = setup => setup
export const useNuxtApp = () => nuxtApp
export const useRouter = () => ({ afterEach: () => () => {}, beforeEach: () => () => {} })
export const useRoute = () => ({
  path: window.location.pathname,
  fullPath: window.location.pathname + window.location.search,
  query: Object.fromEntries(new URLSearchParams(window.location.search)),
})
export const useRuntimeConfig = () => ({ public: { edgeProject: 'standalone', lucideCdnUrl: '' }, app: { baseURL: '/' } })
export const useState = (_key, init) => ({ value: typeof init === 'function' ? init() : init })
