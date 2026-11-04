import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { listCallableFunctions } = createRequire(import.meta.url)('../../scripts/list-callable-functions.cjs')

test('discovers direct and forwarded callable names without including HTTP or event triggers', () => {
  const sources = {
    '/fixture/index.js': `exports.cms = require('./cms')\nexports.flat = require('./keys').list\nexports.direct = onCall(() => {})`,
    '/fixture/cms.js': `const keys = require('./keys')\nexports.listAgentKeys = keys.list\nexports.createAgentKey = keys.create\nexports.agentOperation = keys.http\nexports.worker = onMessagePublished({}, () => {})\nexports.local = onCall({}, () => {})\nexports.nested = require('./nested')`,
    '/fixture/keys.js': `exports.list = onCall({}, () => {})\nexports.create = onCall({}, () => {})\nexports.http = onRequest({}, () => {})`,
    '/fixture/nested.js': `const cycle = require('./cms')\nexports.back = cycle.listAgentKeys\nexports.loop = cycle.nested\nexports.handler = onCall({}, () => {})`,
  }
  assert.deepEqual(listCallableFunctions('/fixture/index.js', file => {
    assert.ok(Object.hasOwn(sources, file), file)
    return sources[file]
  }), ['cms-createAgentKey', 'cms-listAgentKeys', 'cms-local', 'cms-nested-back', 'cms-nested-handler', 'direct', 'flat'])
})

test('production discovery includes all Agent Keys callables but not the bearer HTTP endpoint', () => {
  const names = listCallableFunctions(fileURLToPath(new URL('../../../functions/index.js', import.meta.url)))
  for (const name of ['cms-createAgentKey', 'cms-listAgentKeys', 'cms-revokeAgentKey', 'cms-executeBlockRelease', 'edgeFirebase-recordLoginAttempt'])
    assert.ok(names.includes(name), name)
  assert.ok(!names.includes('cms-agentOperation'))
  assert.ok(!names.includes('cms-blockReleaseWorker'))
  const deploy = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
  assert.ok(deploy.includes('node edge/scripts/deploy-functions.cjs'))
  const planner = readFileSync(new URL('../../scripts/function-deploy-plan.cjs', import.meta.url), 'utf8')
  assert.ok(planner.includes('callable: !!endpoint.callableTrigger'))
})
