const AUTH_ROOT_SELECTOR = '[data-cms-block-root], [data-cms-auth-root]'
const SHOW_LOGGED_IN_SELECTOR = '.cms-show-logged-in, [data-cms-show-logged-in]'
const SHOW_LOGGED_OUT_SELECTOR = '.cms-show-logged-out, [data-cms-show-logged-out]'
const HIDE_LOGGED_IN_SELECTOR = '.cms-hide-logged-in, [data-cms-hide-logged-in]'
const HIDE_LOGGED_OUT_SELECTOR = '.cms-hide-logged-out, [data-cms-hide-logged-out]'

const setElementVisible = (element, visible) => {
  element.classList.toggle('hidden', !visible)
  element.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

export const syncCmsPreviewAuthState = (root, loggedIn) => {
  if (!root || typeof loggedIn !== 'boolean')
    return

  const stateValue = loggedIn ? 'logged-in' : 'logged-out'
  root.setAttribute('data-cms-auth-state', stateValue)
  root.querySelectorAll(AUTH_ROOT_SELECTOR).forEach(authRoot => authRoot.setAttribute('data-cms-auth-state', stateValue))

  root.querySelectorAll(SHOW_LOGGED_IN_SELECTOR).forEach(element => setElementVisible(element, loggedIn))
  root.querySelectorAll(SHOW_LOGGED_OUT_SELECTOR).forEach(element => setElementVisible(element, !loggedIn))
  root.querySelectorAll(HIDE_LOGGED_IN_SELECTOR).forEach(element => setElementVisible(element, !loggedIn))
  root.querySelectorAll(HIDE_LOGGED_OUT_SELECTOR).forEach(element => setElementVisible(element, loggedIn))
}
