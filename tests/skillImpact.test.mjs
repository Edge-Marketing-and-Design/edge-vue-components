// The skill impact backstop: a branch that changes code the knowledge map
// links to documents must change one of those documents too, or carry a
// commit trailer `Skill-Impact: none (<reason>)` (edge-skill-impact skill).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { commitMessages, gitChanges, globToRegExp, impactReport, repoRoot } from '../skills/edge-skill-impact/scripts/impact.mjs'

const edgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const map = JSON.parse(readFileSync(path.join(edgeRoot, 'skills/knowledge-map.json'), 'utf8'))

const fixtureMap = {
  areas: [
    { id: 'grammar', name: 'Grammar', code: ['edge/lib/cmsBlockValidation.js', { path: 'package.json', diffPattern: '@edgedev/template-engine' }], documents: [{ path: 'edge/docs/data-contracts/cms-blocks/README.md', section: 'Validation', says: 'codes' }, { repo: 'emd-cms-front', path: 'docs/guide.md', says: 'renderer' }] },
    { id: 'ops', name: 'Operations', code: ['functions/cms*.js'], documents: [{ path: 'edge/docs/data-contracts/cms-operations/README.md', says: 'operations' }] },
  ],
}

test('every map area names code and documents, and every local document and code path exists', () => {
  const ids = new Set()
  const hub = path.resolve(edgeRoot, '..')
  const inHub = existsSync(path.join(hub, 'edge/skills/knowledge-map.json'))
  for (const area of map.areas) {
    assert.ok(area.id && !ids.has(area.id), `unique id ${area.id}`)
    ids.add(area.id)
    assert.ok(area.code?.length && area.documents?.length, area.id)
    for (const doc of area.documents) {
      assert.ok(doc.says, `${area.id}: ${doc.path} says what it claims`)
      if (!doc.repo && inHub)
        assert.ok(existsSync(path.join(hub, doc.path)), `${area.id}: ${doc.path} exists`)
    }
    if (inHub) {
      for (const entry of area.code) {
        const glob = typeof entry === 'string' ? entry : entry.path
        if (!/[*?]/.test(glob) && glob.startsWith('edge/'))
          assert.ok(existsSync(path.join(hub, glob)), `${area.id}: ${glob} exists`)
      }
      if (area.probe)
        assert.ok(existsSync(path.join(hub, area.probe)), `${area.id}: probe ${area.probe} exists`)
    }
  }
})

test('globs match paths the way the map uses them', () => {
  assert.ok(globToRegExp('functions/kv/**').test('functions/kv/kvMirror.js'))
  assert.ok(globToRegExp('docs/data-contracts/*/collection.json').test('docs/data-contracts/press/collection.json'))
  assert.ok(!globToRegExp('functions/cms*.js').test('functions/helpers/cmsOperations.mjs'))
})

test('a mapped code change without a document change needs review; with one, or a waiver, it passes', () => {
  const code = [{ path: 'edge/lib/cmsBlockValidation.js', diffLines: ['x'] }]
  const missing = impactReport({ map: fixtureMap, changes: code })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.areas.map(area => [area.id, area.needsReview]), [['grammar', true]])
  assert.equal(missing.areas[0].documents[1].changed, null, 'documents in another repo are not counted either way')

  const withDoc = impactReport({ map: fixtureMap, changes: [...code, { path: 'edge/docs/data-contracts/cms-blocks/README.md' }] })
  assert.equal(withDoc.ok, true)

  const waived = impactReport({ map: fixtureMap, changes: code, messages: ['Rename a helper\n\nSkill-Impact: none (internal rename, no behavior change)'] })
  assert.equal(waived.ok, true)
  assert.deepEqual(waived.waivers, ['internal rename, no behavior change'])
})

test('a diffPattern counts only matching changes, and unmapped system code is listed', () => {
  const unrelated = impactReport({ map: fixtureMap, changes: [{ path: 'package.json', diffLines: ['"vue": "3.5.1"'] }] })
  assert.deepEqual(unrelated.areas, [])
  const engine = impactReport({ map: fixtureMap, changes: [{ path: 'package.json', diffLines: ['"@edgedev/template-engine": "26.11.0"'] }] })
  assert.deepEqual(engine.areas.map(area => area.id), ['grammar'])
  const unmapped = impactReport({ map: fixtureMap, changes: [{ path: 'edge/lib/cmsNewThing.js' }, { path: 'edge/functions/cmsOperations.js' }, { path: 'README.md' }] })
  assert.deepEqual(unmapped.unmapped, ['edge/lib/cmsNewThing.js'], 'copies and non-system files are not listed')
})

// The backstop on this branch: against origin/main when the Hub checkout has
// it (skipped in the standalone edge-vue-components repository or a shallow
// clone without it).
test('this branch changes the documents of every mapped area it changes, or records why not', (t) => {
  let root
  try {
    root = repoRoot(edgeRoot)
  }
  catch {
    return t.skip('not a git checkout')
  }
  if (!existsSync(path.join(root, 'edge/skills/knowledge-map.json')))
    return t.skip('not a Hub checkout')
  let changes
  try {
    changes = gitChanges({ root })
  }
  catch (error) {
    return t.skip(error.message)
  }
  const report = impactReport({ map, changes, messages: commitMessages({ root }) })
  const pending = report.areas.filter(area => area.needsReview).map(area => `${area.id} (${area.code.join(', ')})`)
  assert.ok(report.ok, `Mapped code changed with no document change: ${pending.join('; ')}. Run the edge-skill-impact skill, or add "Skill-Impact: none (<reason>)" to a commit message.`)
})
