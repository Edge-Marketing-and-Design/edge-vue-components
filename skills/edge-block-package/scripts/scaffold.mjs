#!/usr/bin/env node
// Scaffold a block package from the skill templates and the project's PROJECT.md.
// Usage: node scaffold.mjs <package-name> [--dir <importfiles/project dir>]   (dir defaults to cwd)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const packageName = args.find(arg => !arg.startsWith('--'))
const dirIndex = args.indexOf('--dir')
const projectDir = resolve(dirIndex === -1 ? process.cwd() : args[dirIndex + 1])
if (!packageName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packageName)) {
  console.error('Usage: node scaffold.mjs <package-name> [--dir <importfiles/project dir>]  (kebab-case name, e.g. 02-home)')
  process.exit(2)
}
const projectFile = resolve(projectDir, 'PROJECT.md')
if (!existsSync(projectFile)) {
  console.error(`No PROJECT.md in ${projectDir}. Create one from ${resolve(skillRoot, 'templates/PROJECT.template.md')} first.`)
  process.exit(2)
}
const projectMd = readFileSync(projectFile, 'utf8')
const jsonMatch = projectMd.match(/```json project\s*([\s\S]*?)```/)
if (!jsonMatch) {
  console.error('PROJECT.md needs a ```json project fenced block.')
  process.exit(2)
}
const project = JSON.parse(jsonMatch[1])
for (const key of ['project', 'organizationId', 'siteId', 'themeId', 'themeName', 'blockPrefix', 'namePrefix', 'tags', 'validatorPath']) {
  if (project[key] === undefined || project[key] === '' || /^<.*>$/.test(String(project[key]))) {
    console.error(`PROJECT.md: fill in "${key}"`)
    process.exit(2)
  }
}

// A relative validatorPath is relative to the Hub checkout (hubPath), for
// example the Hub's shared import check, scripts/cms/validate-import.mjs.
const validatorPath = isAbsolute(project.validatorPath) ? project.validatorPath : resolve(project.hubPath || projectDir, project.validatorPath)

const target = resolve(projectDir, packageName)
if (existsSync(target)) {
  console.error(`${target} already exists; refusing to overwrite.`)
  process.exit(2)
}
mkdirSync(resolve(target, 'blocks'), { recursive: true })

const projectName = project.displayName || project.project
const themeSetup = project.themeSetupPackage ? resolve(projectDir, project.themeSetupPackage) : ''
const replacements = {
  __PROJECT_NAME__: projectName,
  __PACKAGE__: packageName,
  __DATE__: new Date().toISOString().slice(0, 10),
  __THEME_ID__: project.themeId,
  __THEME_NAME__: project.themeName,
  __ORG_ID__: project.organizationId,
  __SITE_ID__: project.siteId,
  __BLOCK_PREFIX__: project.blockPrefix,
  __NAME_PREFIX__: project.namePrefix,
  __TAGS__: JSON.stringify(project.tags),
  __BANNED__: JSON.stringify(project.bannedPhrases || []),
  __VALIDATOR__: validatorPath,
  __THEME_SETUP__: themeSetup ? relativeFrom(target, themeSetup) : '',
}
function relativeFrom(from, to) {
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++
  return [...Array(fromParts.length - i).fill('..'), ...toParts.slice(i)].join('/') || '.'
}
const fill = text => Object.entries(replacements).reduce((out, [key, value]) => out.replaceAll(key, value), text)
const files = [
  ['templates/generate-package.template.mjs', 'generate-package.mjs'],
  ['templates/validate-package.template.mjs', 'validate-package.mjs'],
  ['templates/preview.template.mjs', 'preview.mjs'],
  ['templates/README.template.md', 'README.md'],
]
for (const [source, destination] of files)
  writeFileSync(resolve(target, destination), fill(readFileSync(resolve(skillRoot, source), 'utf8')))
copyFileSync(resolve(skillRoot, 'scripts/validate-common.mjs'), resolve(target, 'validate-common.mjs'))
console.log(`Scaffolded ${target}`)
console.log('Next: replace the example block in generate-package.mjs, update expectedIds in validate-package.mjs, then run')
console.log(`  cd ${target} && node generate-package.mjs && node validate-package.mjs && node ${validatorPath} . && node preview.mjs`)
