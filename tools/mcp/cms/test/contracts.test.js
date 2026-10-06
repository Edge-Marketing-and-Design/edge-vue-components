import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CONTRACT_KINDS, contractKinds, contractPath, readContract } from '../src/contracts.js'

// The server resolves the Hub root the same way (src/server.js repoRoot).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')

test('every contract kind resolves to a file in this checkout', async () => {
  assert.ok(contractKinds().length >= 4)
  for (const kind of contractKinds()) {
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
    assert.equal(result.markdown, file)
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

test('an unknown kind lists the known ones instead of throwing', async () => {
  const result = await readContract({ kind: 'menus', repoRoot })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown-kind')
  assert.deepEqual(result.kinds, contractKinds())
  assert.match(result.message, /blocks, operations, themes, sites-and-pages, posts/)
})
