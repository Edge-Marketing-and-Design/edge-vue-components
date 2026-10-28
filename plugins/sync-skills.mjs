#!/usr/bin/env node
// Copies the skills the edge-cms plugin ships from edge/skills into
// edge/plugins/edge-cms/skills. edge/skills stays the source; plugins can't
// link outside their own folder. Run after editing one of these skills;
// --check only reports drift (edge/tests/pluginSkills.test.mjs runs it).
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const PLUGIN_SKILLS = ['edge-block-package', 'edge-design-to-site', 'edge-figma-design', 'vue-to-block-migrator']

const edgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(edgeRoot, 'skills')
const target = path.join(edgeRoot, 'plugins/edge-cms/skills')

async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const name = path.join(prefix, entry.name)
    if (entry.isDirectory())
      files.push(...await listFiles(path.join(dir, entry.name), name))
    else
      files.push(name)
  }
  return files.sort()
}

// Paths under the plugin's skills folder that are missing, stale or extra.
export async function skillDrift() {
  const expected = (await Promise.all(PLUGIN_SKILLS.map(async name =>
    (await listFiles(path.join(source, name))).map(file => path.join(name, file))))).flat()
  const present = await listFiles(target)
  const drift = []
  for (const file of expected) {
    const [want, have] = await Promise.all([
      readFile(path.join(source, file)),
      readFile(path.join(target, file)).catch(() => null),
    ])
    if (!have || !want.equals(have))
      drift.push(file)
  }
  drift.push(...present.filter(file => !expected.includes(file)))
  return drift
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const drift = await skillDrift()
    if (drift.length) {
      console.error(`edge/plugins/edge-cms/skills is out of date: ${drift.join(', ')}. Run node edge/plugins/sync-skills.mjs.`)
      process.exit(1)
    }
    console.log('edge/plugins/edge-cms/skills matches edge/skills.')
  }
  else {
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    for (const name of PLUGIN_SKILLS)
      await cp(path.join(source, name), path.join(target, name), { recursive: true })
    console.log(`Copied ${PLUGIN_SKILLS.join(', ')} into edge/plugins/edge-cms/skills.`)
  }
}
