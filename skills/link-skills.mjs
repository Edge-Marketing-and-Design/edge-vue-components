#!/usr/bin/env node
// Links every skill in edge/skills into the Hub that contains this edge/
// folder, so Claude Code (.claude/skills) and Codex (.agents/skills) load the
// skills of the checkout and branch the session runs in. Each link is a
// relative symlink, committed in the Hub:
//
//   .claude/skills/<name> -> ../../edge/skills/<name>
//   .agents/skills/<name> -> ../../edge/skills/<name>
//
// Other entries in those folders (a Hub's own skills) are left alone.
//
//   node edge/skills/link-skills.mjs            create, repair or remove links
//   node edge/skills/link-skills.mjs --check    report drift only; exit 1 on any
//   --hub <dir>                                 Hub root (default: the folder above edge/)
//
// Run it after a subtree update adds, renames or removes a skill, and commit
// the links. The Hub's own test runs --check.
import { lstat, mkdir, readdir, readlink, rm, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const LINK_DIRS = ['.claude/skills', '.agents/skills']

const edgeSkills = path.dirname(fileURLToPath(import.meta.url))

// Skill folders in edge/skills: directories with a SKILL.md.
export async function edgeSkillNames(skillsDir = edgeSkills) {
  const names = []
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (await stat(path.join(skillsDir, entry.name, 'SKILL.md')).catch(() => null))
      names.push(entry.name)
  }
  return names.sort()
}

const target = name => path.posix.join('..', '..', 'edge', 'skills', name)
const edgeLink = /^\.\.\/\.\.\/edge\/skills\/([^/]+)$/

// Differences between the Hub's link folders and edge/skills, as
// { dir, name, problem, fix } where fix is 'create' | 'replace' | 'remove' | null
// (null: something else holds the name; a person decides).
export async function linkDrift(hubRoot, names) {
  names ??= await edgeSkillNames(path.join(hubRoot, 'edge', 'skills'))
  const drift = []
  for (const dir of LINK_DIRS) {
    const folder = path.join(hubRoot, dir)
    for (const name of names) {
      const file = path.join(folder, name)
      const info = await lstat(file).catch(() => null)
      if (!info)
        drift.push({ dir, name, problem: 'missing', fix: 'create' })
      else if (!info.isSymbolicLink())
        drift.push({ dir, name, problem: 'a file or folder, not a link, holds this name', fix: null })
      else if (await readlink(file) !== target(name))
        drift.push({ dir, name, problem: `links to ${await readlink(file)}`, fix: 'replace' })
    }
    // Links into edge/skills for skills that no longer exist.
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isSymbolicLink() || names.includes(entry.name)) continue
      if (edgeLink.test(await readlink(path.join(folder, entry.name))))
        drift.push({ dir, name: entry.name, problem: 'links to a skill edge/skills no longer has', fix: 'remove' })
    }
  }
  return drift
}

// Applies every fix it can. Returns the drift it could not fix.
export async function linkSkills(hubRoot) {
  const left = []
  for (const item of await linkDrift(hubRoot)) {
    const file = path.join(hubRoot, item.dir, item.name)
    if (item.fix === null) { left.push(item); continue }
    if (item.fix !== 'create') await rm(file, { force: true })
    if (item.fix !== 'remove') {
      await mkdir(path.dirname(file), { recursive: true })
      await symlink(target(item.name), file)
    }
  }
  return left
}

const describe = item => `${item.dir}/${item.name}: ${item.problem}`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const hubAt = args.indexOf('--hub')
  const hubRoot = path.resolve(hubAt === -1 ? path.join(edgeSkills, '..', '..') : args[hubAt + 1])
  if (args.includes('--check')) {
    const drift = await linkDrift(hubRoot)
    if (drift.length) {
      console.error(`Edge skill links are out of date in ${hubRoot}:\n  ${drift.map(describe).join('\n  ')}\nRun node edge/skills/link-skills.mjs and commit the links.`)
      process.exit(1)
    }
    console.log(`Edge skill links in ${hubRoot} match edge/skills.`)
  }
  else {
    const left = await linkSkills(hubRoot)
    if (left.length) {
      console.error(`Left as they are (move or rename them, then run again):\n  ${left.map(describe).join('\n  ')}`)
      process.exit(1)
    }
    console.log(`Linked ${(await edgeSkillNames(path.join(hubRoot, 'edge', 'skills'))).join(', ')} into ${LINK_DIRS.join(' and ')} of ${hubRoot}.`)
  }
}
