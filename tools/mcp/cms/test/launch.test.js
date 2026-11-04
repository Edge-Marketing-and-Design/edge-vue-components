import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// launch.sh against throwaway git repositories: an origin with main, a Hub
// checkout cloned from it, and an emd-cms-front checkout. The launcher runs
// with EDGE_CMS_LAUNCH_PRINT_STATUS=1, so it prints the status it would pass
// to the server instead of starting it.
const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../launch.sh')
const scratch = mkdtempSync(path.join(os.tmpdir(), 'edge-cms-launch-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()
let counter = 0

// An origin repository (bare) and a clone of it. The clone has the launcher at
// edge/tools/mcp/cms/launch.sh, like a Hub.
function makeRepo(name) {
  const dir = path.join(scratch, `${name}-${++counter}`)
  const origin = `${dir}-origin.git`
  const seed = `${dir}-seed`
  mkdirSync(seed, { recursive: true })
  git(seed, 'init', '-q', '-b', 'main')
  mkdirSync(path.join(seed, 'edge/tools/mcp/cms'), { recursive: true })
  copyFileSync(launcher, path.join(seed, 'edge/tools/mcp/cms/launch.sh'))
  writeFileSync(path.join(seed, 'README.md'), 'one\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-q', '-m', 'one')
  execFileSync('git', ['clone', '-q', '--bare', seed, origin])
  git(seed, 'remote', 'add', 'origin', origin)
  execFileSync('git', ['clone', '-q', origin, dir])
  return { dir, origin, seed }
}

// Adds `count` commits to origin/main.
function advanceOrigin({ seed }, count) {
  for (let index = 0; index < count; index++) {
    writeFileSync(path.join(seed, `change-${counter}-${index}.txt`), String(index))
    git(seed, 'add', '.')
    git(seed, 'commit', '-q', '-m', `change ${index}`)
  }
  git(seed, 'push', '-q', 'origin', 'main')
}

function launch(hubDir, renderer, extraEnv = {}) {
  const output = execFileSync('sh', [path.join(hubDir, 'edge/tools/mcp/cms/launch.sh')], {
    cwd: hubDir,
    env: { ...process.env, EDGE_CMS_LAUNCH_PRINT_STATUS: '1', EDGE_CMS_RENDERER_REPO: renderer, EDGE_CMS_FETCH_TIMEOUT: '5', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
  return JSON.parse(output)
}

test('a clean main that is behind is fast-forwarded, the renderer too', () => {
  const hub = makeRepo('hub')
  const front = makeRepo('front')
  advanceOrigin(hub, 3)
  advanceOrigin(front, 2)
  const status = launch(hub.dir, front.dir)
  assert.equal(status.hub.state, 'updated')
  assert.equal(status.hub.behind, 0)
  assert.equal(status.hub.detail, 'fast-forwarded 3 commits')
  assert.equal(git(hub.dir, 'rev-parse', 'HEAD'), git(hub.dir, 'rev-parse', 'origin/main'))
  assert.equal(status.renderer.state, 'updated')
  assert.equal(git(front.dir, 'rev-parse', 'HEAD'), git(front.dir, 'rev-parse', 'origin/main'))
  // Nothing new: current.
  assert.equal(launch(hub.dir, front.dir).hub.state, 'current')
})

test('a main with local changes is left alone and reported behind', () => {
  const hub = makeRepo('hub')
  const front = makeRepo('front')
  advanceOrigin(hub, 2)
  writeFileSync(path.join(hub.dir, 'README.md'), 'edited\n')
  const before = git(hub.dir, 'rev-parse', 'HEAD')
  const status = launch(hub.dir, front.dir)
  assert.equal(status.hub.state, 'behind')
  assert.equal(status.hub.behind, 2)
  assert.equal(status.hub.dirty, true)
  assert.match(status.hub.detail, /local changes/)
  assert.equal(git(hub.dir, 'rev-parse', 'HEAD'), before)
  assert.equal(status.renderer.state, 'current')
})

test('a feature worktree is never moved; it reports its branch and how far behind it is', () => {
  const hub = makeRepo('hub')
  const front = makeRepo('front')
  const worktree = path.join(scratch, `worktree-${counter}`)
  git(hub.dir, 'worktree', 'add', '-q', '-b', 'feature/x', worktree)
  advanceOrigin(hub, 4)
  const before = git(worktree, 'rev-parse', 'HEAD')
  const status = launch(worktree, front.dir)
  assert.equal(status.hub.state, 'behind')
  assert.equal(status.hub.branch, 'feature/x')
  assert.equal(status.hub.behind, 4)
  assert.match(status.hub.detail, /on feature\/x, not main/)
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), before)
})

test('without a network the fetch is skipped and nothing is moved', () => {
  const hub = makeRepo('hub')
  const front = makeRepo('front')
  advanceOrigin(hub, 1)
  git(hub.dir, 'fetch', '-q', 'origin', 'main')
  git(hub.dir, 'remote', 'set-url', 'origin', path.join(scratch, 'unreachable.git'))
  const before = git(hub.dir, 'rev-parse', 'HEAD')
  const status = launch(hub.dir, front.dir)
  assert.equal(status.hub.fetched, false)
  assert.match(status.hub.detail, /could not fetch/)
  // The last fetched origin/main still says how far behind it is; it is not
  // fast-forwarded without a fresh fetch.
  assert.equal(status.hub.state, 'behind')
  assert.equal(status.hub.behind, 1)
  assert.equal(git(hub.dir, 'rev-parse', 'HEAD'), before)
})

test('a missing renderer checkout is reported, not fatal', () => {
  const hub = makeRepo('hub')
  const status = launch(hub.dir, path.join(scratch, 'no-front'))
  assert.equal(status.renderer.state, 'missing')
  assert.equal(status.hub.state, 'current')
})

test('EDGE_CMS_FRESHNESS=off skips the fetch', () => {
  const hub = makeRepo('hub')
  const front = makeRepo('front')
  advanceOrigin(hub, 1)
  const status = launch(hub.dir, front.dir, { EDGE_CMS_FRESHNESS: 'off' })
  assert.equal(status.hub.fetched, false)
  assert.equal(status.hub.state, 'unchecked')
})
