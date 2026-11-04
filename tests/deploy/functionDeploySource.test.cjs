const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { decodeSourceZip, readSourceArchive } = require('../../scripts/function-deploy-source.cjs')
const { DeployCloud } = require('../../scripts/function-deploy-cloud.cjs')

// One deterministic stored ZIP entry, including its Unix mode and CRC.
function zipFile(name, text = 'exports.value = 1', mode = 0o100644) {
  const filename = Buffer.from(name), data = Buffer.from(text)
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  crc = (crc ^ 0xffffffff) >>> 0
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26)
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16)
  return Buffer.concat([local, filename, data, central, filename, end])
}

test('ZIP decoding preserves source bytes and executable bits without executing code', async () => {
  const files = await decodeSourceZip(zipFile('index.js', 'throw new Error("do not execute")', 0o100755))
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'index.js')
  assert.equal(files[0].mode, 0o755)
  assert.equal(files[0].content.toString(), 'throw new Error("do not execute")')
})
test('ZIP decoding rejects traversal, absolute paths, symlinks and malformed archives', async () => {
  for (const buffer of [zipFile('../outside.js'), zipFile('/outside.js'), zipFile('link.js', 'target', 0o120777), Buffer.from('not a zip')])
    await assert.rejects(decodeSourceZip(buffer))
})
test('downloads use immutable object generations and verify size/checksum before decoding', async () => {
  const buffer = zipFile('index.js')
  const descriptor = { bucket: 'source-bucket', object: 'function/source.zip', generation: '12', size: String(buffer.length), md5Hash: createHash('md5').update(buffer).digest('base64') }
  const cloud = { token: 'test-token', fetch: async url => { assert.ok(url.includes('generation=12')); return new Response(buffer) } }
  const archive = await readSourceArchive(cloud, descriptor)
  assert.match(archive.sha256, /^[a-f0-9]{64}$/)
  assert.equal(archive.files[0].path, 'index.js')
  await assert.rejects(readSourceArchive(cloud, { ...descriptor, md5Hash: 'incorrect' }), /checksum/)
  await assert.rejects(readSourceArchive(cloud, { ...descriptor, size: '999999999' }), /too large/)
})
test('cloud source descriptors require resolved generation and matching metadata', async () => {
  const cloud = new DeployCloud({ projectId: 'test-project' })
  const remote = { buildConfig: { sourceProvenance: { resolvedStorageSource: { bucket: 'source-bucket', object: 'source.zip', generation: '12' } } } }
  cloud.request = async () => ({ bucket: 'source-bucket', name: 'source.zip', generation: '12', size: '100', md5Hash: 'hash' })
  assert.equal((await cloud.describeSource(remote)).generation, '12')
  await assert.rejects(cloud.describeSource({}), /provenance/)
  cloud.request = async () => ({ bucket: 'source-bucket', name: 'source.zip', generation: '13', md5Hash: 'hash' })
  await assert.rejects(cloud.describeSource(remote), /does not match/)
})
