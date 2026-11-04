// Read deployed source as data only. ZIP paths, modes and sizes are validated
// before a caller can materialize the files in a private temporary directory.
const { createHash } = require('node:crypto')
const yauzl = require('yauzl')
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024

function decodeSourceZip(buffer) {
  return new Promise((resolve, reject) => {
    if (buffer.length > MAX_SOURCE_BYTES) return reject(new Error('Deployed source archive is too large'))
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('Invalid deployed source archive'))
      const files = [], names = new Set()
      let total = 0
      const fail = () => { zip.close(); reject(new Error('Unsafe or unreadable deployed source archive')) }
      zip.on('error', fail)
      zip.on('end', () => resolve(files))
      zip.on('entry', (entry) => {
        const name = entry.fileName, mode = entry.externalFileAttributes >>> 16
        if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.split('/').includes('..')
          || names.has(name) || names.size >= 5000 || (mode & 0o170000) === 0o120000) return fail()
        names.add(name)
        if (name.endsWith('/')) { zip.readEntry(); return }
        total += entry.uncompressedSize
        if (total > MAX_EXPANDED_BYTES || name.split('/').includes('node_modules')) return fail()
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail()
          const chunks = []
          stream.on('data', chunk => chunks.push(chunk))
          stream.on('error', fail)
          stream.on('end', () => {
            files.push({ path: name, mode: mode & 0o111 ? 0o755 : 0o644, content: Buffer.concat(chunks) })
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

async function readSourceArchive(cloud, descriptor) {
  const { bucket, object, generation, md5Hash, size } = descriptor
  if (Number(size) > MAX_SOURCE_BYTES) throw new Error('Deployed source archive is too large')
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?generation=${encodeURIComponent(generation)}&alt=media`
  // Metadata request refreshed the token. Never expose response bodies, source
  // contents or authentication headers in logs/errors.
  const response = await cloud.fetch(url, { headers: { Authorization: `Bearer ${cloud.token}` }, signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Deployed source download failed (HTTP ${response.status})`)
  const chunks = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > MAX_SOURCE_BYTES) throw new Error('Deployed source archive is too large')
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  if (String(buffer.length) !== String(size) || !md5Hash || createHash('md5').update(buffer).digest('base64') !== md5Hash)
    throw new Error('Deployed source archive checksum mismatch')
  return { files: await decodeSourceZip(buffer), sha256: createHash('sha256').update(buffer).digest('hex') }
}

module.exports = { decodeSourceZip, readSourceArchive }
