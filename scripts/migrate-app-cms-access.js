#!/usr/bin/env node
/* eslint-disable no-regex-spaces */
const fs = require('fs')
const path = require('path')

const targetArg = process.argv[2] || 'pages/app.vue'
const targetPath = path.resolve(process.cwd(), targetArg)

const startMarker = '// START EDGE CMS ACCESS'
const endMarker = '// END EDGE CMS ACCESS'
const devStartMarker = '// START EDGE DEV MODE TOGGLE'
const devEndMarker = '// END EDGE DEV MODE TOGGLE'
const devWatchStartMarker = '// START EDGE DEV MODE TOGGLE WATCH'
const devWatchEndMarker = '// END EDGE DEV MODE TOGGLE WATCH'
const composableImport = 'import { useEdgeCmsAccess } from \'@/edge/composables/useEdgeCmsAccess\''
const accessBlock = `${startMarker}
const {
  currentUserIsRootAdmin,
  currentUserIsOrgAdmin,
  currentUserHasRoleAt,
} = useEdgeCmsAccess(edgeFirebase, currentOrganization)
${endMarker}`
const devToggleBlock = `${devStartMarker}
const DEV_OVERRIDE_KEY = 'edgeDevOverride'

const canUseDevModeToggle = computed(() =>
  currentUserIsRootAdmin.value,
)
const canEvaluateDevModeAccess = computed(() => edgeFirebase?.user?.loggedIn === true)

const setDevOverride = (enabled) => {
  const nextEnabled = enabled === true && canUseDevModeToggle.value
  edgeGlobal.edgeState.devOverride = nextEnabled
  try {
    if (nextEnabled)
      localStorage.setItem(DEV_OVERRIDE_KEY, '1')
    else
      localStorage.removeItem(DEV_OVERRIDE_KEY)
  }
  catch (error) {
    console.warn('dev override write failed', error)
  }
  if (typeof menuBuilder === 'function')
    menuBuilder()
  if (typeof enforceFeatureRouteAccess === 'function')
    enforceFeatureRouteAccess()
}

const hydrateDevOverride = () => {
  let storedEnabled = false
  try {
    storedEnabled = localStorage.getItem(DEV_OVERRIDE_KEY) === '1'
  }
  catch (error) {
    console.warn('dev override read failed', error)
  }
  setDevOverride(storedEnabled)
}

const toggleDevOverride = () => {
  setDevOverride(!edgeGlobal.edgeState.devOverride)
}
${devEndMarker}`
const devWatchBlock = `${devWatchStartMarker}
onMounted(() => {
  if (canUseDevModeToggle.value)
    hydrateDevOverride()
  else if (canEvaluateDevModeAccess.value)
    setDevOverride(false)
})

watch([canUseDevModeToggle, canEvaluateDevModeAccess], ([canUseToggle, canEvaluate]) => {
  if (canUseToggle) {
    hydrateDevOverride()
    return
  }
  if (canEvaluate && edgeGlobal.edgeState.devOverride)
    setDevOverride(false)
})
${devWatchEndMarker}`
const devToggleButton = `<button
                  v-if="canUseDevModeToggle"
                  type="button"
                  class="inline-flex h-5 w-full items-center justify-center gap-1.5 rounded border px-1 text-[10px] font-semibold transition"
                  :class="edgeGlobal.edgeState.devOverride
                    ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900'"
                  @click="toggleDevOverride"
                >
                  <span
                    class="h-2 w-2 rounded-full"
                    :class="edgeGlobal.edgeState.devOverride ? 'bg-amber-500' : 'bg-slate-400'"
                  />
                  Dev Mode
                </button>`

const rootAdminTabsBranch = `  if (currentUserIsRootAdmin.value) {
    cmsSiteTabs.value = { ...DEFAULT_CMS_SITE_TABS }
    return
  }
`

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ensureComposableImport = (source) => {
  if (!source.includes('useEdgeCmsAccess(edgeFirebase, currentOrganization)'))
    return source
  if (source.includes(composableImport))
    return source

  const scriptSetupRe = /<script setup>\n/
  if (scriptSetupRe.test(source))
    return source.replace(scriptSetupRe, match => `${match}${composableImport}\n\n`)

  return source
}

const removeLegacyDevOverrideKey = (source) => {
  if (source.includes(devStartMarker))
    return source
  if (source.includes('canUseDevModeToggle'))
    return source
  return source.replace(/\nconst DEV_OVERRIDE_KEY = 'edgeDevOverride'\n/, '\n')
}

const replaceMarkedBlock = (source) => {
  const markerRe = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`)
  if (markerRe.test(source))
    return source.replace(markerRe, accessBlock)
  return source
}

const replaceMarkedDevToggleBlock = (source) => {
  const markerRe = new RegExp(`${escapeRegExp(devStartMarker)}[\\s\\S]*?${escapeRegExp(devEndMarker)}`)
  if (markerRe.test(source))
    return source.replace(markerRe, devToggleBlock)
  return source
}

const replaceLegacyAccessBlock = (source) => {
  if (source.includes(startMarker))
    return source

  const legacyRe = /const rolePathForOrg = orgId => `organizations-\$\{String\(orgId \|\| ''\)\.replaceAll\('\/', '-'\)\}`\n\nconst currentUserIsRootAdmin = computed\(\(\) =>\n  \(edgeFirebase\?\.user\?\.roles \|\| \[\]\)\.some\(role =>\n    String\(role\?\.collectionPath \|\| ''\)\.trim\(\) === '-' && role\?\.role === 'admin',\n  \),\n\)\n\nconst currentUserHasRoleAt = \(orgId, suffix, roles = \['user', 'writer', 'editor', 'admin'\]\) => \{\n  const orgPath = rolePathForOrg\(orgId\)\n  const collectionPath = suffix \? `\$\{orgPath\}-\$\{suffix\}` : orgPath\n  return \(edgeFirebase\?\.user\?\.roles \|\| \[\]\)\.some\(role =>\n    role\.collectionPath === collectionPath && roles\.includes\(role\.role\),\n  \)\n\}\n\nconst currentUserIsOrgAdmin = computed\(\(\) =>\n  currentOrganization\.value\n  && \(currentUserIsRootAdmin\.value \|\| currentUserHasRoleAt\(currentOrganization\.value, '', \['admin'\]\)\),\n\)\n/
  if (legacyRe.test(source))
    return source.replace(legacyRe, accessBlock)

  const currentOrganizationRe = /const currentOrganization = computed\(\(\) => \{\n  return edgeGlobal\.edgeState\.currentOrganization\n\}\)\n/
  if (currentOrganizationRe.test(source))
    return source.replace(currentOrganizationRe, match => `${match}\n${accessBlock}\n`)

  return source
}

const applyDevToggleBlock = (source) => {
  if (!source.includes('currentUserIsRootAdmin'))
    return source
  if (source.includes('canUseDevModeToggle') && !source.includes(devStartMarker))
    return source
  if (source.includes(devStartMarker))
    return replaceMarkedDevToggleBlock(source)

  const accessRe = new RegExp(`${escapeRegExp(endMarker)}\\n`)
  if (accessRe.test(source))
    return source.replace(accessRe, match => `${match}\n${devToggleBlock}\n`)

  return source
}

const applyDevWatchBlock = (source) => {
  if (!source.includes('canUseDevModeToggle'))
    return source

  const markerRe = new RegExp(`${escapeRegExp(devWatchStartMarker)}[\\s\\S]*?${escapeRegExp(devWatchEndMarker)}`)
  if (markerRe.test(source))
    return source.replace(markerRe, devWatchBlock)
  if (source.includes('hydrateDevOverride()'))
    return source

  const mountedRe = /onMounted\(\(\) => \{\n/
  if (mountedRe.test(source))
    return source.replace(mountedRe, `${devWatchBlock}\n\nonMounted(() => {\n`)

  const scriptEndRe = /\n<\/script>/
  if (scriptEndRe.test(source))
    return source.replace(scriptEndRe, `\n${devWatchBlock}\n</script>`)

  return source
}

const applyDevToggleButton = (source) => {
  if (!source.includes('canUseDevModeToggle') || source.includes('@click="toggleDevOverride"'))
    return source

  const logoRe = /(<img[^>\n]*alt="Edge Logo"[^>]*>\n)/
  if (logoRe.test(source))
    return source.replace(logoRe, match => `${match}${devToggleButton}\n`)

  const headerRe = /(<template #header>\s*[\s\S]*?)(<\/template>)/
  if (headerRe.test(source))
    return source.replace(headerRe, (_, before, after) => `${before}${devToggleButton}\n${after}`)

  return source
}

const applyRootAdminTabsBranch = (source) => {
  if (!source.includes('currentUserIsRootAdmin'))
    return source
  if (source.includes('if (currentUserIsRootAdmin.value)'))
    return source

  const noOrgBranchRe = /const applyCmsSiteTabsByRole = \(\) => \{\n  const orgId = currentOrganization\.value\n  if \(!orgId\) \{\n    cmsSiteTabs\.value = \{ \.\.\.DEFAULT_CMS_SITE_TABS \}\n    return\n  \}\n/
  if (!noOrgBranchRe.test(source))
    return source

  return source.replace(noOrgBranchRe, match => `${match}${rootAdminTabsBranch}`)
}

if (!fs.existsSync(targetPath)) {
  console.error(`Cannot find ${targetPath}`)
  process.exit(1)
}

const original = fs.readFileSync(targetPath, 'utf8')
let next = removeLegacyDevOverrideKey(original)
next = replaceMarkedBlock(next)
next = replaceLegacyAccessBlock(next)
next = applyRootAdminTabsBranch(next)
next = applyDevToggleBlock(next)
next = applyDevWatchBlock(next)
next = applyDevToggleButton(next)
next = ensureComposableImport(next)

if (next === original) {
  console.log(`No changes needed: ${targetPath}`)
  process.exit(0)
}

fs.writeFileSync(targetPath, next.endsWith('\n') ? next : `${next}\n`)
console.log(`Updated ${targetPath}`)
