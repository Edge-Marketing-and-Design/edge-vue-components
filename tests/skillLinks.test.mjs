import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LINK_DIRS, edgeSkillNames, linkDrift, linkSkills } from '../skills/link-skills.mjs'

// A Hub-shaped folder: edge/skills with two skills and a non-skill file.
async function fakeHub() {
  const hub = await mkdtemp(path.join(tmpdir(), 'edge-skill-links-'))
  for (const name of ['alpha', 'beta']) {
    await mkdir(path.join(hub, 'edge/skills', name), { recursive: true })
    await writeFile(path.join(hub, 'edge/skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  await writeFile(path.join(hub, 'edge/skills/README.md'), 'not a skill\n')
  return hub
}

test('edge/skills lists only folders with a SKILL.md', async () => {
  const names = await edgeSkillNames()
  assert.ok(names.includes('edge-block-package'))
  assert.ok(!names.includes('README.md') && !names.includes('knowledge-map.json'))
})

test('links every skill into .claude/skills and .agents/skills as relative links', async t => {
  const hub = await fakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))
  assert.equal((await linkDrift(hub)).length, 4)
  assert.deepEqual(await linkSkills(hub), [])
  assert.deepEqual(await linkDrift(hub), [])
  for (const dir of LINK_DIRS) {
    assert.equal(await readlink(path.join(hub, dir, 'alpha')), '../../edge/skills/alpha')
    assert.match(await readFile(path.join(hub, dir, 'beta/SKILL.md'), 'utf8'), /name: beta/)
  }
})

test('repairs wrong links, removes links to deleted skills, keeps a Hub\'s own skills', async t => {
  const hub = await fakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))
  await linkSkills(hub)
  await mkdir(path.join(hub, '.agents/skills/hub-own'), { recursive: true })
  await rm(path.join(hub, '.claude/skills/alpha'))
  await symlink('../../somewhere/else', path.join(hub, '.claude/skills/alpha'))
  await symlink('../../edge/skills/gone', path.join(hub, '.claude/skills/gone'))
  assert.deepEqual((await linkDrift(hub)).map(d => `${d.name}:${d.fix}`).sort(), ['alpha:replace', 'gone:remove'])
  assert.deepEqual(await linkSkills(hub), [])
  assert.deepEqual(await linkDrift(hub), [])
  assert.equal(await lstat(path.join(hub, '.claude/skills/gone')).catch(() => null), null)
  assert.ok((await lstat(path.join(hub, '.agents/skills/hub-own'))).isDirectory())
})

test('a real folder holding a skill\'s name is reported, not replaced', async t => {
  const hub = await fakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))
  await mkdir(path.join(hub, '.claude/skills/alpha'), { recursive: true })
  const left = await linkSkills(hub)
  assert.deepEqual(left.map(d => `${d.dir}/${d.name}`), ['.claude/skills/alpha'])
  assert.ok((await lstat(path.join(hub, '.claude/skills/alpha'))).isDirectory())
})
