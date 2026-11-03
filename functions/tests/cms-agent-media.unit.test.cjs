const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const path = require('node:path')
const { existsSync } = require('node:fs')
// Shared tests run against the Hub's deployable copy after Edge sync.
const functionRoot = existsSync(path.join(__dirname, '../config.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../../../functions')
const { createFakeDb } = require('./support/fakeFirestore.cjs')

class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// cmsAgentMedia.js loaded against an in-memory Firestore and Storage.
const setup = ({ seed = {}, fetchSource, canDo } = {}) => {
  const fake = createFakeDb({
    'users/owner': { roles: [] },
    'organizations/a': { name: 'Org A' },
    'organizations/a/sites/s': { name: 'Site A' },
    'agent-connections/c1': { createdBy: 'owner', expiresAt: '2999-01-01T00:00:00.000Z', revokedAt: null },
    ...seed,
  })
  const denied = new Set()
  const configPath = require.resolve(path.join(functionRoot, 'config.js'))
  const modulePath = require.resolve(path.join(functionRoot, 'cmsAgentMedia.js'))
  const original = require.cache[configPath]
  require.cache[configPath] = {
    id: configPath,
    loaded: true,
    exports: {
      admin: {},
      db: fake.db,
      HttpsError,
      logger: { log() {}, error() {}, warn() {} },
      onRequest: (_, handler) => handler,
      permissionCheck: async (uid, action, target) => uid === 'owner' && !denied.has(`${action}:${target}`),
    },
  }
  delete require.cache[modulePath]
  const media = require(modulePath)
  delete require.cache[modulePath]
  if (original)
    require.cache[configPath] = original
  else
    delete require.cache[configPath]

  const objects = new Map()
  const bucket = () => ({
    file: name => ({
      async save(bytes, options) {
        objects.set(name, { bytes, options })
      },
    }),
  })
  const fetched = []
  const sources = new Map()
  const defaultFetch = async (url) => {
    fetched.push(url)
    if (!sources.has(url))
      throw Object.assign(new Error('The source answered HTTP 404.'), { problemCode: 'fetch-failed' })
    return { bytes: sources.get(url), finalUrl: url, contentType: 'image/png' }
  }
  const clock = { now: Date.parse('2026-11-03T12:00:00.000Z') }
  // Cloudflare finishes while the tool waits: the webhook writes variants.
  const finish = new Set()
  const sleep = async (ms) => {
    clock.now += ms
    for (const [docPath, data] of fake.docs) {
      if (docPath.startsWith('organizations/a/files/') && finish.has(data.fileName) && !data.cloudflareImageVariants)
        fake.docs.set(docPath, { ...data, cloudflareImageVariants: [`https://imagedelivery.net/h/${data.docId}/public`, `https://imagedelivery.net/h/${data.docId}/thumbnail`], edgeMediaImageState: { status: 'complete' } })
    }
  }
  const service = media.createAgentMedia({
    fetchSource: fetchSource || defaultFetch,
    bucket,
    canDo: canDo || (async (uid, action, target) => uid === 'owner' && !denied.has(`${action}:${target}`)),
    now: () => clock.now,
    sleep,
    uploadUrl: () => 'https://upload.test/cmsAgentMediaUpload',
  })
  return { ...fake, media, service, objects, fetched, sources, clock, finish, denied }
}

const png = (width = 640, height = 480, salt = 0) => {
  const bytes = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[39] = salt
  return bytes
}
const jpeg = () => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x2C, 0x01, 0x90, 0x03, 0x00, 0x00, 0x00, 0x00])
const gif = () => Buffer.from('GIF89a\x20\x00\x10\x00\x00\x00\x00', 'latin1')
const webp = () => {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUIntLE(99, 24, 3)
  bytes.writeUIntLE(49, 27, 3)
  return bytes
}
const caller = { connectionId: 'c1', client: 'edge-cms-remote-mcp' }
const filesIn = env => [...env.docs.entries()].filter(([key]) => key.startsWith('organizations/a/files/'))

test('blocked addresses: private, loopback, link-local, metadata and reserved ranges', () => {
  const { media } = setup()
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '2002:a00:1::1', 'ff02::1', 'not-an-ip'])
    assert.equal(media.isBlockedAddress(address), true, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.69', '2606:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(media.isBlockedAddress(address), false, address)
})

test('URLs: http(s) on 80/443 to public hosts only, without credentials', () => {
  const { media } = setup()
  const refused = value => assert.throws(() => media.checkUrl(value), error => error.problemCode !== undefined, value)
  for (const value of ['ftp://example.com/a.png', 'file:///etc/passwd', 'https://user:pw@example.com/a.png', 'https://example.com:8443/a.png', 'http://localhost/a.png', 'http://metadata.google.internal/', 'http://printer.local/a.png', 'http://169.254.169.254/latest', 'http://[::1]/a.png', 'http://10.0.0.1/a.png', 'not a url'])
    refused(value)
  assert.equal(media.checkUrl('https://example.com/a.png#x').href, 'https://example.com/a.png')
})

test('the fetcher checks every redirect hop and every DNS answer, and stops at the size cap', async (t) => {
  const { media } = setup()
  const server = http.createServer((req, res) => {
    if (req.url === '/ok.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png())
    }
    else if (req.url === '/to-private') {
      res.writeHead(302, { location: `http://private.test:${server.address().port}/ok.png` })
      res.end()
    }
    else if (req.url === '/to-ok') {
      res.writeHead(301, { location: '/ok.png' })
      res.end()
    }
    else if (req.url.startsWith('/loop')) {
      res.writeHead(302, { location: `/loop${Number(req.url.slice(5) || 0) + 1}` })
      res.end()
    }
    else if (req.url === '/big') {
      res.writeHead(200)
      res.end(Buffer.alloc(5000))
    }
    else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  // In the test, 127.0.0.1 stands for a public address; 10.x is private.
  const answers = { 'images.test': ['127.0.0.1'], 'private.test': ['10.0.0.7'], 'mixed.test': ['127.0.0.1', '10.0.0.8'] }
  const lookup = (hostname, options, callback) => {
    const list = answers[hostname]
    if (!list)
      return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
    callback(null, list.map(address => ({ address, family: 4 })))
  }
  const fetchSource = media.createSourceFetcher({ lookup, blocked: address => address !== '127.0.0.1', ports: [port], maxBytes: 1000 })
  const base = `http://images.test:${port}`

  const ok = await fetchSource(`${base}/to-ok`)
  assert.deepEqual(ok.bytes, png())
  assert.equal(ok.finalUrl, `${base}/ok.png`)
  await assert.rejects(fetchSource(`${base}/to-private`), { problemCode: 'blocked-address' })
  await assert.rejects(fetchSource(`http://mixed.test:${port}/ok.png`), { problemCode: 'blocked-address' })
  await assert.rejects(fetchSource(`${base}/loop0`), { problemCode: 'too-many-redirects' })
  await assert.rejects(fetchSource(`${base}/big`), { problemCode: 'too-large' })
  await assert.rejects(fetchSource(`${base}/missing.png`), { problemCode: 'fetch-failed' })
  await assert.rejects(fetchSource(`http://127.0.0.2:${port}/ok.png`), { problemCode: 'blocked-address' }, 'literal addresses are checked without DNS')
})

test('image types come from the bytes; SVG, unknown types and oversized images are refused', () => {
  const { media } = setup()
  assert.deepEqual(media.inspectImage(png(640, 480)), { kind: 'png', ext: 'png', contentType: 'image/png', width: 640, height: 480 })
  assert.deepEqual(media.inspectImage(jpeg()), { kind: 'jpeg', ext: 'jpg', contentType: 'image/jpeg', width: 400, height: 300 })
  assert.deepEqual(media.inspectImage(gif()), { kind: 'gif', ext: 'gif', contentType: 'image/gif', width: 32, height: 16 })
  assert.deepEqual(media.inspectImage(webp()), { kind: 'webp', ext: 'webp', contentType: 'image/webp', width: 100, height: 50 })
  assert.throws(() => media.inspectImage(Buffer.from('\uFEFF  <?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), { problemCode: 'svg-unsupported' })
  assert.throws(() => media.inspectImage(Buffer.from('<html>not an image</html>')), { problemCode: 'unsupported-type' })
  assert.throws(() => media.inspectImage(Buffer.alloc(0)), { problemCode: 'unsupported-type' })
  assert.throws(() => media.inspectImage(png(13000, 10)), { problemCode: 'too-large' })
  assert.throws(() => media.inspectImage(png(11000, 11000)), { problemCode: 'too-large' })
})

test('a URL upload makes the same file document and Storage object as a Hub upload', async () => {
  const env = setup()
  env.sources.set('https://old.example/img/Hero Shot.JPG', png())
  env.finish.add('Hero-Shot.png')
  const result = await env.service.upload({ uid: 'owner', orgId: 'a', body: { siteId: 's', tags: ['HERO', 'HERO', ' Home '], sources: [{ url: 'https://old.example/img/Hero Shot.JPG' }] }, caller })
  const [entry] = result.files
  assert.equal(entry.status, 'ready')
  assert.equal(entry.deduplicated, false)
  assert.equal(entry.url, `https://imagedelivery.net/h/${entry.fileId}/public`)
  assert.deepEqual(Object.keys(entry.variants), ['public', 'thumbnail'])
  assert.equal(result.next, undefined)

  const doc = env.docs.get(`organizations/a/files/${entry.fileId}`)
  const filePath = `organizations-a-images/${entry.fileId}-Hero-Shot.png`
  assert.deepEqual(Object.keys(doc).sort(), ['agentUpload', 'cloudflareImageVariants', 'contentType', 'directory', 'docId', 'edgeMediaImageState', 'fileName', 'filePath', 'fileSize', 'isPublic', 'meta', 'name', 'orgId', 'r2FilePath', 'r2URL', 'toR2', 'uploadCompleted', 'uploadCompletedToR2', 'uploadStatus', 'uploadTime'])
  assert.equal(doc.contentType, 'image/png')
  assert.equal(doc.directory, 'images')
  assert.equal(doc.filePath, filePath)
  assert.equal(doc.toR2, true)
  assert.equal(doc.isPublic, false)
  assert.equal(doc.uploadCompleted, true)
  assert.deepEqual(doc.uploadStatus, { success: true, message: 'File uploaded successfully.', meta: { file: filePath, fileDocId: entry.fileId } })
  assert.deepEqual(doc.meta, { tags: ['HERO', 'Home'], cmsmedia: true, cmssite: ['s'] })
  assert.equal(doc.agentUpload.sourceUrl, 'https://old.example/img/Hero%20Shot.JPG')
  assert.equal(doc.agentUpload.connectionId, 'c1')
  assert.match(doc.agentUpload.sha256, /^[a-f0-9]{64}$/)

  const object = env.objects.get(filePath)
  assert.deepEqual(object.bytes, png())
  assert.equal(object.options.contentType, 'image/png')
  assert.deepEqual(object.options.metadata.metadata, { orgId: 'a', uid: 'owner', contentType: 'image/png', fileName: 'Hero-Shot.png', name: 'Hero-Shot.png', fileSize: '40', directory: 'images', fileDocId: entry.fileId, filePath, r2FilePath: '', r2URL: '', isPublic: '', toR2: 'true' })

  const [audit] = [...env.docs.entries()].filter(([key]) => key.startsWith('cms-operations/')).map(([, value]) => value)
  assert.equal(audit.type, 'media.upload')
  assert.equal(audit.via, 'agent')
  assert.equal(audit.runBy, 'owner')
  assert.equal(audit.agentConnectionId, 'c1')
  assert.deepEqual(audit.result.files.map(file => [file.fileId, file.status]), [[entry.fileId, 'ready']])
  assert.equal(env.docs.get('agent-media-usage/a-2026-11-03').count, 1)
})

test('uploads deduplicate by source URL and by content, adding missing tags', async () => {
  const env = setup()
  env.sources.set('https://old.example/a.png', png())
  env.sources.set('https://cdn.old.example/copy-of-a.png', png())
  const first = (await env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['HERO'], sources: [{ url: 'https://old.example/a.png' }], waitSeconds: 0 }, caller })).files[0]
  assert.equal(first.status, 'processing')
  assert.deepEqual(env.docs.get(`organizations/a/files/${first.fileId}`).meta.cmssite, ['all'])

  const again = (await env.service.upload({ uid: 'owner', orgId: 'a', body: { siteId: 's', tags: ['BANNER'], sources: [{ url: 'https://old.example/a.png#top' }], waitSeconds: 0 }, caller })).files[0]
  assert.equal(again.fileId, first.fileId)
  assert.equal(again.deduplicated, true)
  assert.deepEqual(env.fetched, ['https://old.example/a.png'], 'a known source URL is not fetched again')
  assert.deepEqual(env.docs.get(`organizations/a/files/${first.fileId}`).meta, { tags: ['HERO', 'BANNER'], cmsmedia: true, cmssite: ['all', 's'] })

  const copy = (await env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['HERO'], sources: [{ url: 'https://cdn.old.example/copy-of-a.png' }], waitSeconds: 0 }, caller })).files[0]
  assert.equal(copy.fileId, first.fileId, 'same bytes from another URL')
  assert.equal(copy.deduplicated, true)
  assert.equal(filesIn(env).length, 1)

  // A failed upload is not reused.
  const failedPath = `organizations/a/files/${first.fileId}`
  env.docs.set(failedPath, { ...env.docs.get(failedPath), edgeMediaImageState: { status: 'failed', errorMessage: 'boom' } })
  const retried = (await env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['HERO'], sources: [{ url: 'https://old.example/a.png' }], waitSeconds: 0 }, caller })).files[0]
  assert.notEqual(retried.fileId, first.fileId)
  assert.equal(filesIn(env).length, 2)
})

test('each source fails on its own; inline bytes, SVG and the daily limit are refused (fetched sources count)', async () => {
  const env = setup({ seed: { 'agent-media-usage/a-2026-11-03': { count: 197 } } })
  env.sources.set('https://old.example/logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
  env.sources.set('https://old.example/1.png', png(10, 10, 1))
  env.sources.set('https://old.example/2.png', png(10, 10, 2))
  env.sources.set('https://old.example/3.png', png(10, 10, 3))
  const { files } = await env.service.upload({
    uid: 'owner',
    orgId: 'a',
    body: {
      tags: ['X'],
      waitSeconds: 0,
      sources: [
        { url: 'https://old.example/logo.svg' },
        { base64: 'iVBORw0KGgo=' },
        { url: 'http://169.254.169.254/latest/meta-data' },
        { url: 'https://old.example/missing.png' },
        { url: 'https://old.example/1.png' },
        { url: 'https://old.example/2.png' },
        { url: 'https://old.example/3.png' },
      ],
    },
    caller,
  })
  assert.deepEqual(files.map(file => file.problemCode || file.status), ['svg-unsupported', 'inline-bytes-unsupported', 'blocked-address', 'fetch-failed', 'processing', 'daily-limit', 'daily-limit'])
  assert.equal(env.docs.get('agent-media-usage/a-2026-11-03').count, 200)
  assert.equal(filesIn(env).length, 1)
})

test('uploads need write on the organization\'s images and at least one tag', async () => {
  const env = setup()
  await assert.rejects(env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: [], sources: [{ url: 'https://old.example/a.png' }] }, caller }), { code: 'invalid-argument' })
  await assert.rejects(env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['X'], sources: [] }, caller }), { code: 'invalid-argument' })
  await assert.rejects(env.service.upload({ uid: 'owner', orgId: 'a', body: { siteId: 'nope', tags: ['X'], sources: [{ url: 'https://old.example/a.png' }] }, caller }), { code: 'not-found' })
  env.denied.add('write:organizations/a/images')
  await assert.rejects(env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['X'], sources: [{ url: 'https://old.example/a.png' }] }, caller }), { code: 'permission-denied' })
  assert.equal(env.fetched.length, 0)
})

// An Express-like response for serveUpload.
const response = () => {
  const res = { statusCode: 0, body: null, headers: {} }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.set = (name, value) => {
    res.headers[name] = value
    return res
  }
  res.json = (data) => {
    res.body = data
    return res
  }
  return res
}
const put = async (env, token, bytes) => {
  const res = response()
  await env.media.serveUpload({ method: 'PUT', rawBody: bytes, get: name => (name === 'authorization' ? `Bearer ${token}` : 'curl/8') }, res, env.service)
  return res
}

test('a local file gets a one-time upload link that goes through the same path', async () => {
  const env = setup()
  const { files, uploadNext } = await env.service.upload({ uid: 'owner', orgId: 'a', body: { siteId: 's', tags: ['TEAM'], sources: [{ localFile: { name: 'headshot.jpeg', size: 22 } }, { localFile: { name: 'logo.svg' } }, { localFile: { name: 'huge.png', size: 11 * 1024 * 1024 } }] }, caller })
  assert.ok(uploadNext)
  const [link, svg, huge] = files
  assert.equal(link.status, 'awaiting-upload')
  assert.equal(link.upload.method, 'PUT')
  assert.equal(link.upload.url, 'https://upload.test/cmsAgentMediaUpload')
  assert.match(link.upload.curl, /--data-binary @'<path to headshot.jpeg>'/)
  assert.equal(svg.problemCode, 'svg-unsupported')
  assert.equal(huge.problemCode, 'too-large')
  const token = link.upload.headers.Authorization.replace('Bearer ', '')
  const [stored] = [...env.docs.entries()].filter(([key]) => key.startsWith('agent-media-uploads/')).map(([, value]) => value)
  assert.equal(stored.tokenHash.length, 64)
  assert.equal(JSON.stringify(stored).includes(token.split('.')[2]), false, 'only the hash is stored')

  assert.equal((await put(env, `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, jpeg())).statusCode, 401)
  env.finish.add('headshot.jpg')
  const res = await put(env, token, jpeg())
  assert.equal(res.statusCode, 200)
  const [entry] = res.body.files
  assert.equal(entry.status, 'ready')
  const doc = env.docs.get(`organizations/a/files/${entry.fileId}`)
  assert.equal(doc.fileName, 'headshot.jpg')
  assert.equal(doc.contentType, 'image/jpeg')
  assert.deepEqual(doc.meta, { tags: ['TEAM'], cmsmedia: true, cmssite: ['s'] })
  assert.equal(doc.agentUpload.localFile, 'headshot.jpeg')
  assert.ok(env.objects.has(`organizations-a-images/${entry.fileId}-headshot.jpg`))
  assert.equal((await put(env, token, jpeg())).statusCode, 409, 'single use')
})

test('upload links refuse expired links, revoked connections, lost rights and non-images', async () => {
  const env = setup()
  const linkFor = async (name = 'a.png') => (await env.service.upload({ uid: 'owner', orgId: 'a', body: { tags: ['X'], sources: [{ localFile: { name } }] }, caller })).files[0].upload.headers.Authorization.replace('Bearer ', '')

  const expiring = await linkFor()
  env.clock.now += 16 * 60 * 1000
  assert.equal((await put(env, expiring, png())).statusCode, 401)

  const svgBytes = await linkFor()
  const refused = await put(env, svgBytes, Buffer.from('<svg/>'))
  assert.equal(refused.statusCode, 200)
  assert.equal(refused.body.files[0].problemCode, 'svg-unsupported', 'the bytes decide, not the name')

  const lostRights = await linkFor()
  env.denied.add('write:organizations/a/images')
  assert.equal((await put(env, lostRights, png())).statusCode, 403)
  env.denied.clear()

  const revoked = await linkFor()
  env.docs.set('agent-connections/c1', { ...env.docs.get('agent-connections/c1'), revokedAt: '2026-11-03T12:00:00.000Z' })
  assert.equal((await put(env, revoked, png())).statusCode, 401)
  assert.equal(filesIn(env).length, 0)

  const getRes = response()
  await env.media.serveUpload({ method: 'GET', get: () => '' }, getRes, env.service)
  assert.equal(getRes.statusCode, 405)
})

test('find lists image media newest first by ids, source, name, tags and site', async () => {
  const env = setup({
    seed: {
      'organizations/a/files/old': { name: 'Team photo.jpg', fileName: 'team.jpg', contentType: 'image/jpeg', uploadTime: 1, meta: { tags: ['TEAM'], cmssite: ['all'] }, cloudflareImageVariants: ['https://imagedelivery.net/h/old/public'] },
      'organizations/a/files/new': { name: 'hero.png', fileName: 'hero.png', contentType: 'image/png', uploadTime: 3, meta: { tags: ['HERO'], cmssite: ['s'] }, edgeMediaImageState: { status: 'processing' } },
      'organizations/a/files/other': { name: 'hero-b.png', fileName: 'hero-b.png', contentType: 'image/png', uploadTime: 2, meta: { tags: ['HERO'], cmssite: ['t'] }, agentUpload: { sourceUrl: 'https://old.example/b.png' }, edgeMediaImageState: { status: 'failed', errorMessage: 'Bad image' } },
      'organizations/a/files/pdf': { name: 'menu.pdf', fileName: 'menu.pdf', contentType: 'application/pdf', uploadTime: 4, meta: { tags: ['HERO'] } },
    },
  })
  const find = body => env.service.find({ uid: 'owner', orgId: 'a', body })
  assert.deepEqual((await find({})).files.map(file => file.fileId), ['new', 'other', 'old'])
  assert.deepEqual((await find({ query: 'TEAM' })).files.map(file => [file.fileId, file.url]), [['old', 'https://imagedelivery.net/h/old/public']])
  assert.deepEqual((await find({ tags: ['hero'] })).files.map(file => [file.fileId, file.status, file.url]), [['new', 'processing', null], ['other', 'failed', null]])
  assert.deepEqual((await find({ siteId: 's' })).files.map(file => file.fileId), ['new', 'old'])
  assert.deepEqual((await find({ sourceUrl: 'https://old.example/b.png' })).files.map(file => [file.fileId, file.message]), [['other', 'Bad image']])
  const byId = await find({ fileIds: ['old', 'gone'] })
  assert.deepEqual([byId.files.map(file => file.fileId), byId.missing], [['old'], ['gone']])
  const first = await find({ limit: 2 })
  assert.equal(first.nextStartAfter, 'other')
  assert.deepEqual((await find({ limit: 2, startAfter: first.nextStartAfter })).files.map(file => file.fileId), ['old'])
  env.denied.add('read:organizations/a/files')
  await assert.rejects(find({}), { code: 'permission-denied' })
})
