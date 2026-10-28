import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { withGeneratedValidation } from '../../../../lib/cmsBlockValidation.js'
import { withGeneratedContract } from '../../../../lib/cmsOperations.js'
import { CONTRACT_KINDS, RENDERER_GUIDE, contractKinds, contractPath, readContract } from '../src/contracts.js'

// The server resolves the Hub root the same way (src/server.js repoRoot).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')

test('every contract kind resolves to a file in this checkout', async () => {
  assert.ok(contractKinds().length >= 4)
  for (const kind of Object.keys(CONTRACT_KINDS)) {
    const relativePath = contractPath(kind)
    assert.match(relativePath, /^docs\/data-contracts\/[a-z-]+\/README\.md$/)
    await access(path.resolve(repoRoot, relativePath))
  }
})

test('the returned text starts with the contract title and carries the path', async () => {
  for (const [kind, relativePath] of Object.entries(CONTRACT_KINDS)) {
    const result = await readContract({ kind, repoRoot })
    assert.equal(result.ok, true, `${kind}: ${result.message || ''}`)
    assert.equal(result.kind, kind)
    assert.equal(result.path, relativePath)
    const file = await readFile(path.resolve(repoRoot, relativePath), 'utf8')
    // Markers are replaced by the generated sections.
    assert.equal(result.markdown, withGeneratedContract(withGeneratedValidation(file)))
    assert.ok(!/<!-- (operations|fields|validation codes):/.test(result.markdown), `${kind} has no marker left`)
    assert.ok(result.title.length > 0, `${kind} has a title`)
    assert.ok(file.startsWith(`# ${result.title}`), `${kind} starts with its title`)
  }
})

test('kinds are case-insensitive and trimmed', async () => {
  const result = await readContract({ kind: ' Blocks ', repoRoot })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'blocks')
})

test('the Last verified line is returned when the contract has one', async () => {
  const files = {
    [path.resolve('/hub', CONTRACT_KINDS.blocks)]: '# CMS blocks\n\nStatus: in use.\n\nLast verified: 2026-10-06, abc1234\n\n## Storage\n',
    [path.resolve('/hub', CONTRACT_KINDS.themes)]: '# CMS themes\n\nNo verification line yet.\n',
  }
  const readFileImpl = async (file) => {
    if (file in files)
      return files[file]
    const error = new Error(`ENOENT: ${file}`)
    error.code = 'ENOENT'
    throw error
  }
  const verified = await readContract({ kind: 'blocks', repoRoot: '/hub', readFileImpl })
  assert.equal(verified.lastVerified, '2026-10-06, abc1234')
  assert.equal(verified.title, 'CMS blocks')
  const unverified = await readContract({ kind: 'themes', repoRoot: '/hub', readFileImpl })
  assert.equal(unverified.lastVerified, null)
  const missing = await readContract({ kind: 'posts', repoRoot: '/hub', readFileImpl })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  assert.equal(missing.path, CONTRACT_KINDS.posts)
})

test('a section narrows the contract to one heading', async () => {
  const markdown = '# Guide\n\nIntro.\n\n## Agent quick contract\n\nRules.\n\n## Data Sources\n\nSources.\n'
  const readFileImpl = async () => markdown
  const whole = await readContract({ kind: 'blocks', repoRoot: '/hub', readFileImpl })
  assert.deepEqual(whole.sections, ['Agent quick contract', 'Data Sources'])
  assert.equal(whole.markdown, markdown)
  const part = await readContract({ kind: 'blocks', section: 'data sources', repoRoot: '/hub', readFileImpl })
  assert.equal(part.section, 'Data Sources')
  assert.equal(part.markdown, '## Data Sources\n\nSources.')
  assert.equal(part.title, 'Guide')
  const unknown = await readContract({ kind: 'blocks', section: 'nope', repoRoot: '/hub', readFileImpl })
  assert.equal(unknown.code, 'unknown-section')
})

test('the renderer kind reads the guide from the emd-cms-front checkout', async () => {
  assert.ok(contractKinds().includes('renderer'))
  const readFileImpl = async (file) => {
    if (file === path.resolve('/front', RENDERER_GUIDE))
      return '# CMS Template v2 Blocks\n\n## Agent quick contract\n\nRead first.\n'
    const error = new Error(`ENOENT: ${file}`)
    error.code = 'ENOENT'
    throw error
  }
  const guide = await readContract({ kind: 'Renderer', section: 'Agent quick contract', repoRoot: '/hub', rendererRoot: '/front', readFileImpl })
  assert.equal(guide.ok, true)
  assert.equal(guide.path, `emd-cms-front:${RENDERER_GUIDE}`)
  assert.equal(guide.markdown, '## Agent quick contract\n\nRead first.')
  const missing = await readContract({ kind: 'renderer', repoRoot: '/hub', rendererRoot: '/elsewhere', readFileImpl })
  assert.equal(missing.code, 'missing')
})

test('an unknown kind lists the known ones instead of throwing', async () => {
  const result = await readContract({ kind: 'menus', repoRoot })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown-kind')
  assert.deepEqual(result.kinds, contractKinds())
  assert.match(result.message, /blocks, operations, themes, sites-and-pages, posts/)
})

test('explanation overrides replace the default text in the generated operations section', async () => {
  const result = await readContract({ kind: 'operations', repoRoot, notes: { 'problem:move.no-change': 'Already in place; nothing to do.' } })
  assert.equal(result.ok, true)
  assert.ok(result.markdown.includes('| `move.no-change` | Already in place; nothing to do. |'))
})
