#!/usr/bin/env node
/* eslint-disable no-regex-spaces */
const fs = require('fs')
const path = require('path')

const targetArg = process.argv[2] || 'pages/app.vue'
const targetPath = path.resolve(process.cwd(), targetArg)

const startMarker = '// START EDGE CMS ACCESS'
const endMarker = '// END EDGE CMS ACCESS'
const composableImport = 'import { useEdgeCmsAccess } from \'@/edge/composables/useEdgeCmsAccess\''
const accessBlock = `${startMarker}
const {
  currentUserIsRootAdmin,
  currentUserIsOrgAdmin,
  currentUserHasRoleAt,
} = useEdgeCmsAccess(edgeFirebase, currentOrganization)
${endMarker}`

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

const replaceMarkedBlock = (source) => {
  const markerRe = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`)
  if (markerRe.test(source))
    return source.replace(markerRe, accessBlock)
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
let next = replaceMarkedBlock(original)
next = replaceLegacyAccessBlock(next)
next = applyRootAdminTabsBranch(next)
next = ensureComposableImport(next)

if (next === original) {
  console.log(`No changes needed: ${targetPath}`)
  process.exit(0)
}

fs.writeFileSync(targetPath, next.endsWith('\n') ? next : `${next}\n`)
console.log(`Updated ${targetPath}`)
