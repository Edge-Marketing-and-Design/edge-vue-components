import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const script = readFileSync(new URL('../edge-update-all.sh', import.meta.url), 'utf8')
const sharedIndex = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8')
const localIndex = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8')
const marker = 'EDGE_FUNCTIONS_INDEX_PATH="$edge_index" LOCAL_FUNCTIONS_INDEX_PATH="$local_index" node <<\'EOF\'\n'
const start = script.indexOf(marker)
assert.notEqual(start, -1)
const mergeSource = script.slice(start + marker.length, script.indexOf('\nEOF', start))

const migrate = (input) => {
  let result = input
  runInNewContext(mergeSource, {
    process: { env: { EDGE_FUNCTIONS_INDEX_PATH: 'edge-index', LOCAL_FUNCTIONS_INDEX_PATH: 'local-index' } },
    require: (name) => {
      assert.equal(name, 'fs')
      return {
        readFileSync: path => path === 'edge-index' ? sharedIndex : input,
        writeFileSync: (path, value) => {
          assert.equal(path, 'local-index')
          result = value
        },
      }
    },
  })
  return result
}

const firebaseBlock = registration => `// START @edge/firebase functions
${registration}
exports.edgeFirebase = require('./edgeFirebase')
// END @edge/firebase functions
`
const legacyRegistration = `const { kvMirrorRetryWorker } = require('./kv/kvRetryWorker')
exports.kvMirrorRetryWorker = kvMirrorRetryWorker`

test('index migration moves only the legacy worker registration and preserves app exports', () => {
  for (const registration of [legacyRegistration, 'exports.kvMirrorRetryWorker = require("./kv/kvRetryWorker").kvMirrorRetryWorker;', '']) {
    const input = `exports.custom = require('./custom')\n${firebaseBlock(registration)}\n// START EXTRA EDGE functions\nexports.oldShared = require('./oldShared')\n// END EXTRA EDGE functions\nexports.after = require('./after')\n`
    const output = migrate(input)
    assert.equal((output.match(/exports\.kvMirrorRetryWorker\s*=/g) || []).length, 1)
    assert.match(output, /exports\.custom = require\('\.\/custom'\)/)
    assert.match(output, /exports\.after = require\('\.\/after'\)/)
    assert.match(output, /exports\.edgeFirebase = require\('\.\/edgeFirebase'\)/)
    assert.ok(output.includes(sharedIndex.trim()))
    assert.doesNotMatch(output, /exports\.oldShared/)
    assert.equal(migrate(output), output)
  }
})

test('fresh and repeated updates preserve exactly one callable worker export', () => {
  const output = migrate(firebaseBlock(legacyRegistration))
  const worker = () => {}
  const exports = {}
  runInNewContext(output, {
    exports,
    require: name => name === './kv/kvRetryWorker' ? { kvMirrorRetryWorker: worker } : {},
  })
  assert.equal(exports.kvMirrorRetryWorker, worker)
  const afterOldPackageInstall = output.replace(
    /\/\/ START @edge\/firebase functions[\s\S]*?\/\/ END @edge\/firebase functions\n/,
    firebaseBlock(legacyRegistration),
  )
  assert.equal(migrate(afterOldPackageInstall), output)
  assert.equal(migrate(localIndex), localIndex)
})

test('the updater reconciles the index after package install hooks run', () => {
  const commands = script.slice(script.lastIndexOf('\nsync_edge_functions\n')).trim().split('\n')
  assert.ok(commands.lastIndexOf('merge_edge_functions_index') > commands.indexOf('install_edge_function_packages'))
})
