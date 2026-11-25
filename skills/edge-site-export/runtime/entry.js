// Static runtime for an exported Edge CMS site. build-runtime.mjs bundles it
// from the public renderer's own client helpers (emd-cms-front), so nav,
// scroll reveal, countdown, form and carousel behavior match the live site.
import { nuxtApp } from './nuxt-shim.js'
import cmsNav from '~/plugins/cmsNav.client.ts'
import scrollReveal from '~/plugins/scrollReveal.client.ts'
import cmsCountdown from '~/plugins/cmsCountdown.client.ts'
import cmsForms from '~/plugins/cmsForms.client.ts'
import { initEmblaCarousels } from '~/composables/useEmblaCarousels.ts'

const config = () => window.EDGE_STANDALONE || {}
const CONTEXT_FIELDS = new Set(['orgId', 'siteId', 'pageId', 'blockId'])

const postFields = async (fields) => {
  const { formEndpoint, formFormat, formMissingMessage } = config()
  if (!formEndpoint)
    throw new Error(formMissingMessage || 'This form is not connected yet. Please contact us by email or phone.')
  const asJson = formFormat === 'json'
  const response = await fetch(formEndpoint, {
    method: 'POST',
    headers: asJson ? { 'Accept': 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    body: asJson ? JSON.stringify(fields) : new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value ?? '')])),
  })
  if (!response.ok)
    throw new Error('Submission failed, please try again.')
}

// Forms keep their markup, validation and messages; only delivery changes.
// The site owner sets formEndpoint (Formspree, Basin, their own script...) in
// assets/edge-standalone-config.js. Without one, the form shows its error state.
nuxtApp.provide('sendHistoryEvent', async (payload) => {
  const fields = Object.fromEntries(Object.entries(payload?.data || {}).filter(([key]) => !CONTEXT_FIELDS.has(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]))
  await postFields(fields)
  return { success: true, ok: true, accepted: true }
})


// Forms rendered by renderer components (no action, not a CMS form) lost the
// script that sent them. Send their fields to the same endpoint instead.
const enhancePlainForms = () => {
  for (const form of document.querySelectorAll('form:not([action]):not(.cms-form):not([data-cms-form]):not([data-edge-form])')) {
    form.setAttribute('data-edge-form', 'fallback')
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    status.className = 'edge-form-status'
    status.style.marginTop = '0.75rem'
    form.after(status)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!form.reportValidity())
        return
      const fields = { form: form.getAttribute('name') || form.id || document.title, url: window.location.href }
      for (const element of form.elements) {
        if (!element.name && !element.id && !element.type)
          continue
        if (['submit', 'button', 'reset', 'file'].includes(element.type) || ((element.type === 'checkbox' || element.type === 'radio') && !element.checked))
          continue
        const key = element.name || element.id || element.type
        if (element.value)
          fields[key] = fields[key] ? `${fields[key]}, ${element.value}` : element.value
      }
      const button = form.querySelector('[type="submit"]')
      if (button)
        button.disabled = true
      try {
        await postFields(fields)
        status.textContent = 'Thank you! Your message was sent.'
        form.reset()
      }
      catch (error) {
        status.textContent = error.message
      }
      finally {
        if (button)
          button.disabled = false
      }
    })
  }
}

const loadLucide = () => {
  const src = config().lucideUrl
  if (!src || !document.querySelector('[data-lucide]'))
    return
  const script = document.createElement('script')
  script.src = src
  script.onload = () => window.lucide?.createIcons?.()
  document.head.appendChild(script)
}

const start = async () => {
  for (const plugin of [cmsNav, scrollReveal, cmsCountdown, cmsForms]) {
    try {
      await plugin(nuxtApp)
    }
    catch (error) {
      console.error('Edge standalone helper failed:', error)
    }
  }
  await nuxtApp.callHook('app:mounted')
  await nuxtApp.callHook('page:finish')
  enhancePlainForms()
  initEmblaCarousels(document.body).catch(error => console.error('Carousel init failed:', error))
  loadLucide()
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start, { once: true })
else
  start()
