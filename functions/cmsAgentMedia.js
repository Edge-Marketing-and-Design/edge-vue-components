// Agent media uploads (docs/features/cms/remote-mcp-media-design.md): images
// an agent adds to an organization's media library, from a public URL the
// server fetches or a local file the agent PUTs to a one-time upload link
// (agentMediaUpload, deployed as cmsAgentMediaUpload). Either way the
// bytes go through the Hub's own upload path: the same file document and
// Storage object as edgeFirebase.uploadFile from the media manager, so toR2,
// Edge Media and the media webhook (edgeMedia.js) make the R2 copy and the
// Cloudflare Images variants exactly as for a Hub upload. The only addition
// is `agentUpload`, the provenance used for deduplication.
//
// Runs as the connection's creator with their current Hub rights; every
// upload call is recorded in cms-operations as media.upload.
// Keep identical in functions/.
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const { admin, db, onRequest, HttpsError, logger, permissionCheck } = require('./config.js')

const MAX_BYTES = 10 * 1024 * 1024
// Cloudflare Images refuses larger images.
const MAX_SIDE = 12000
const MAX_PIXELS = 100 * 1000 * 1000
const MAX_SOURCES = 10
const MAX_TAGS = 10
const DAILY_LIMIT = 200
const FETCH_TIMEOUT_MS = 20000
const FETCH_CONCURRENCY = 3
const MAX_REDIRECTS = 5
const UPLOAD_LINK_MS = 15 * 60 * 1000
const DEFAULT_WAIT_SECONDS = 30
const MAX_WAIT_SECONDS = 60
// The whole call must finish inside cms-agentOperation's 120 s.
const CALL_BUDGET_MS = 100000
const FIND_SCAN_LIMIT = 2000
const FIND_MAX = 100
const USER_AGENT = 'EdgeCMS-MediaImport/1.0'
const DOC_ID_PATTERN = /^[^/]{1,1500}$/
const UPLOAD_TOKEN_PATTERN = /^cmsmu\.([A-Za-z0-9]{20})\.([A-Za-z0-9_-]{43})$/
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const text = value => String(value ?? '').trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const orgRefOf = orgId => db.collection('organizations').doc(orgId)
const filesOf = orgId => orgRefOf(orgId).collection('files')
const uploads = () => db.collection('agent-media-uploads')

const requireDocId = (value, label) => {
  const id = text(value)
  if (!id || !DOC_ID_PATTERN.test(id) || id === '.' || id === '..')
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

// ---- Addresses ----

const IPV4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const ipv4Number = address => address.split('.').reduce((total, part) => total * 256 + Number(part), 0)
const ipv4Blocked = (address) => {
  const value = ipv4Number(address)
  return IPV4_BLOCKED.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base) / 2 ** (32 - bits)))
}

// The eight 16-bit groups of an IPv6 address.
const ipv6Groups = (address) => {
  let value = address.toLowerCase().split('%')[0]
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const number = ipv4Number(dotted[1])
    value = `${value.slice(0, -dotted[1].length)}${Math.floor(number / 65536).toString(16)}:${(number % 65536).toString(16)}`
  }
  const [head, tail] = value.split('::')
  const left = head ? head.split(':') : []
  const right = tail === undefined ? [] : (tail ? tail.split(':') : [])
  const fill = value.includes('::') ? Array(8 - left.length - right.length).fill('0') : []
  return [...left, ...fill, ...right].map(group => Number.parseInt(group || '0', 16))
}

// True for any address a server-side fetch must not reach: loopback,
// private, link-local (the 169.254.169.254 metadata address), CGNAT,
// documentation, multicast and reserved ranges. IPv6 is allowed only in
// global unicast (2000::/3), minus documentation and 6to4, and IPv4-mapped
// addresses are judged as IPv4.
const isBlockedAddress = (address) => {
  const family = net.isIP(String(address || ''))
  if (family === 4)
    return ipv4Blocked(address)
  if (family !== 6)
    return true
  const groups = ipv6Groups(address)
  const mapped = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xFFFF
  if (mapped)
    return ipv4Blocked(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`)
  if ((groups[0] & 0xE000) !== 0x2000)
    return true
  return (groups[0] === 0x2001 && groups[1] === 0x0DB8) || groups[0] === 0x2002
}

const BLOCKED_HOSTS = /(^|\.)(localhost|internal|local|localdomain)$/i

const refusal = (code, message) => Object.assign(new Error(message), { problemCode: code })

// A lookup for http(s).request that refuses a host when any of its
// addresses is blocked, so the connection only goes to an address that
// passed the check (no DNS rebinding between check and connect).
const guardedLookup = ({ lookup = dns.lookup, blocked = isBlockedAddress } = {}) => (hostname, options, callback) => {
  lookup(hostname, { all: true, family: 0 }, (error, addresses) => {
    if (error)
      return callback(error)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
    if (!list.length || list.some(entry => blocked(entry.address)))
      return callback(refusal('blocked-address', `${hostname} resolves to an address the server may not fetch.`))
    if (options?.all)
      return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

// Checks a URL before each request (the first and every redirect hop).
const checkUrl = (value, { ports = [80, 443], blocked = isBlockedAddress } = {}) => {
  let url
  try {
    url = new URL(String(value || ''))
  }
  catch {
    throw refusal('invalid-url', `Not a valid URL: ${String(value || '').slice(0, 200)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw refusal('invalid-url', 'Only http and https URLs can be fetched.')
  if (url.username || url.password)
    throw refusal('invalid-url', 'URLs with a user name or password are refused.')
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!ports.includes(port))
    throw refusal('blocked-address', `Port ${port} is not allowed; use 80 or 443.`)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTS.test(host))
    throw refusal('blocked-address', `${host} is not a public host.`)
  if (net.isIP(host) && blocked(host))
    throw refusal('blocked-address', `${host} is not a public address.`)
  url.hash = ''
  return url
}

// Fetches a public image URL: follows up to five redirects by hand, checking
// every hop, sends no cookies or credentials, and stops reading at the size
// cap. Resolves { bytes, finalUrl, contentType }.
const createSourceFetcher = ({ lookup = dns.lookup, blocked = isBlockedAddress, ports = [80, 443], timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) => {
  const safeLookup = guardedLookup({ lookup, blocked })
  const once = url => new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method: 'GET',
      lookup: safeLookup,
      agent: false,
      headers: { 'user-agent': USER_AGENT, 'accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5' },
    }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        resolve({ redirect: response.headers.location })
        return
      }
      if (status !== 200) {
        response.resume()
        reject(refusal('fetch-failed', `The source answered HTTP ${status}.`))
        return
      }
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy()
        reject(refusal('too-large', `The image is over ${maxBytes / 1024 / 1024} MB.`))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          response.destroy()
          reject(refusal('too-large', `The image is over ${maxBytes / 1024 / 1024} MB.`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: text(response.headers['content-type']) }))
      response.on('error', error => reject(refusal('fetch-failed', `Reading the source failed: ${error.message}`)))
    })
    request.on('error', error => reject(error.problemCode ? error : refusal('fetch-failed', `Fetching the source failed: ${error.message}`)))
    request.end()
  })
  return async (source) => {
    let url = checkUrl(source, { ports, blocked })
    const deadline = Date.now() + timeoutMs
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw refusal('fetch-failed', 'The source took too long.')
      let timer
      const result = await Promise.race([
        once(url),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(refusal('fetch-failed', 'The source took too long.')), remaining)
        }),
      ]).finally(() => clearTimeout(timer))
      if (!result.redirect)
        return { ...result, finalUrl: url.href }
      url = checkUrl(new URL(result.redirect, url).href, { ports, blocked })
    }
    throw refusal('too-many-redirects', `The source redirected more than ${MAX_REDIRECTS} times.`)
  }
}

// ---- Image types ----

const TYPES = {
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  png: { ext: 'png', contentType: 'image/png' },
  gif: { ext: 'gif', contentType: 'image/gif' },
  webp: { ext: 'webp', contentType: 'image/webp' },
}

const jpegSize = (bytes) => {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset++
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker))
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    offset += 2 + length
  }
  return { width: 0, height: 0 }
}

const webpSize = (bytes) => {
  const chunk = bytes.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && bytes.length >= 30)
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21)
    return { width: 1 + (bits & 0x3FFF), height: 1 + ((bits >> 14) & 0x3FFF) }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30)
    return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF }
  return { width: 0, height: 0 }
}

// The image type from the file's own bytes (never the Content-Type header or
// the extension) and its pixel size, or a refusal. Only the types Edge Media
// makes Cloudflare Images variants of are accepted.
const inspectImage = (bytes) => {
  if (!bytes?.length)
    throw refusal('unsupported-type', 'The file is empty.')
  let kind = ''
  let size = { width: 0, height: 0 }
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    kind = 'jpeg'
    size = jpegSize(bytes)
  }
  else if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504E47 && bytes.readUInt32BE(4) === 0x0D0A1A0A) {
    kind = 'png'
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  else if (bytes.length > 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    kind = 'gif'
    size = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  else if (bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    kind = 'webp'
    size = webpSize(bytes)
  }
  if (!kind) {
    const head = bytes.toString('utf8', 0, Math.min(bytes.length, 1024)).replace(/^\uFEFF/, '').trimStart().toLowerCase()
    if (head.startsWith('<') && head.includes('<svg'))
      throw refusal('svg-unsupported', 'SVG is not accepted: it gets no Cloudflare Images variants. Convert it to PNG and upload the PNG.')
    throw refusal('unsupported-type', 'Only JPEG, PNG, GIF and WebP images are accepted.')
  }
  if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS)
    throw refusal('too-large', `The image is ${size.width}×${size.height}; Cloudflare Images takes at most ${MAX_SIDE} px a side and ${MAX_PIXELS / 1000000} megapixels.`)
  return { kind, ...TYPES[kind], ...size }
}

// A safe file name with the extension of the detected type.
const fileNameFor = (requested, fallback, ext) => {
  const base = text(requested || fallback).split(/[/\\]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '')
  const safe = base.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100)
  return `${safe || 'image'}.${ext}`
}

const nameFromUrl = (value) => {
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() || '')
  }
  catch {
    return ''
  }
}

// ---- Describing media ----

// { variantName: url } from the Cloudflare Images variant URLs.
const variantsOf = (data) => {
  const variants = Array.isArray(data?.cloudflareImageVariants) ? data.cloudflareImageVariants.filter(item => typeof item === 'string' && item) : []
  return Object.fromEntries(variants.map(url => [url.split('/').pop(), url]))
}

const statusOf = (data) => {
  if (Object.keys(variantsOf(data)).length)
    return 'ready'
  if (text(data?.edgeMediaImageState?.status).toLowerCase() === 'failed')
    return 'failed'
  return 'processing'
}

// What an agent places in an image field: the Cloudflare variant URL, only
// once it exists. The R2 original is never offered (the Hub's picker refuses
// it too, while variants are pending).
const describeFile = (fileId, data = {}) => {
  const variants = variantsOf(data)
  const status = statusOf(data)
  return {
    fileId,
    name: data.name || data.fileName || '',
    status,
    url: status === 'ready' ? (variants.public || Object.values(variants)[0]) : null,
    variants,
    contentType: data.contentType || '',
    tags: Array.isArray(data.meta?.tags) ? data.meta.tags : [],
    cmssite: Array.isArray(data.meta?.cmssite) ? data.meta.cmssite : [],
    sourceUrl: data.agentUpload?.sourceUrl || null,
    width: data.agentUpload?.width || null,
    height: data.agentUpload?.height || null,
    uploadTime: data.uploadTime || null,
    ...(status === 'failed' ? { message: text(data.edgeMediaImageState?.errorMessage) || 'Cloudflare processing failed.' } : {}),
  }
}

const isImageDoc = data => text(data?.contentType).toLowerCase().startsWith('image/')
  || /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(text(data?.fileName || data?.name))

// ---- Input ----

const normalizeTags = (value) => {
  const tags = [...new Set((Array.isArray(value) ? value : []).map(tag => text(tag).slice(0, 60)).filter(Boolean))]
  if (!tags.length)
    throw new HttpsError('invalid-argument', 'Pass at least one tag, as the Hub\'s upload dialog requires. Use the image field\'s `tags` option when it has one.')
  if (tags.length > MAX_TAGS)
    throw new HttpsError('invalid-argument', `Pass at most ${MAX_TAGS} tags.`)
  return tags
}

const normalizeSources = (value) => {
  const sources = Array.isArray(value) ? value : []
  if (!sources.length || sources.length > MAX_SOURCES)
    throw new HttpsError('invalid-argument', `Pass 1 to ${MAX_SOURCES} sources.`)
  return sources.map((source) => {
    if (!source || typeof source !== 'object')
      throw new HttpsError('invalid-argument', 'Each source is { url } or { localFile: { name, size } }.')
    if (source.data || source.base64 || source.bytes)
      return { refused: { problemCode: 'inline-bytes-unsupported', message: 'Image bytes can\'t be sent in the tool call. Pass a public url, or a localFile to get an upload link.' } }
    if (source.url && source.localFile)
      throw new HttpsError('invalid-argument', 'A source is either a url or a localFile, not both.')
    if (source.localFile) {
      const name = text(source.localFile.name)
      const size = Number(source.localFile.size)
      if (!name)
        throw new HttpsError('invalid-argument', 'localFile.name is required.')
      return { localFile: { name, size: Number.isFinite(size) ? size : null }, name: text(source.name) || name }
    }
    if (!text(source.url))
      throw new HttpsError('invalid-argument', 'Each source needs a url or a localFile.')
    return { url: text(source.url), name: text(source.name) }
  })
}

// The source URL as stored and matched for deduplication.
const sourceKey = (value) => {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href
  }
  catch {
    return text(value)
  }
}

// ---- The service ----

const createAgentMedia = ({
  fetchSource = createSourceFetcher(),
  bucket = () => admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || undefined),
  canDo = permissionCheck,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  uploadUrl = () => text(process.env.CMS_AGENT_MEDIA_UPLOAD_URL) || `https://${text(process.env.FUNCTIONS_REGION) || 'us-west1'}-${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT}.cloudfunctions.net/cmsAgentMediaUpload`,
} = {}) => {
  const requireUpload = async (uid, orgId) => {
    if (!await canDo(uid, 'write', `organizations/${orgId}/images`))
      throw new HttpsError('permission-denied', 'Not allowed to upload media in this organization.')
  }

  // Reserves `count` of the organization's daily uploads; returns how many
  // were granted.
  const reserve = async (orgId, count) => {
    if (!count)
      return 0
    const day = new Date(now()).toISOString().slice(0, 10)
    const ref = db.collection('agent-media-usage').doc(`${orgId}-${day}`)
    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref)
      const used = Number(snap.exists ? snap.data().count : 0) || 0
      const granted = Math.max(0, Math.min(count, DAILY_LIMIT - used))
      if (granted)
        transaction.set(ref, { orgId, day, count: used + granted, updatedAt: new Date(now()).toISOString() }, { merge: true })
      return granted
    })
  }

  // A previous agent upload of the same source or bytes, unless its
  // processing failed. Missing tags and the site are added to it.
  const findExisting = async (orgId, field, value, { tags, site }) => {
    if (!value)
      return null
    const snap = await filesOf(orgId).where(`agentUpload.${field}`, '==', value).limit(5).get()
    const doc = snap.docs.find(item => statusOf(item.data()) !== 'failed')
    if (!doc)
      return null
    const data = doc.data()
    const currentTags = Array.isArray(data.meta?.tags) ? data.meta.tags : []
    const currentSites = Array.isArray(data.meta?.cmssite) ? data.meta.cmssite : []
    const nextTags = [...new Set([...currentTags, ...tags])]
    const nextSites = [...new Set([...currentSites, site])]
    if (nextTags.length !== currentTags.length || nextSites.length !== currentSites.length) {
      await doc.ref.set({ meta: { tags: nextTags, cmssite: nextSites } }, { merge: true })
      data.meta = { ...data.meta, tags: nextTags, cmssite: nextSites }
    }
    return { ...describeFile(doc.id, data), deduplicated: true }
  }

  // The Hub's upload, server-side: edgeFirebase.uploadFile's file document,
  // Storage path and custom metadata, then its final update. toR2 takes it
  // from there.
  const ingest = async ({ orgId, uid, bytes, image, name, tags, site, provenance }) => {
    const docRef = filesOf(orgId).doc()
    const fileDocId = docRef.id
    const fileName = name
    const filePath = `organizations-${orgId}-images/${fileDocId}-${fileName}`
    await docRef.set({
      orgId,
      contentType: image.contentType,
      uploadCompletedToR2: false,
      fileName,
      name: fileName,
      fileSize: bytes.length,
      directory: 'images',
      filePath: '',
      r2FilePath: '',
      r2URL: '',
      isPublic: false,
      toR2: true,
      uploadCompleted: false,
      uploadTime: now(),
    })
    await docRef.set({ orgId, docId: fileDocId, filePath }, { merge: true })
    await bucket().file(filePath).save(bytes, {
      resumable: false,
      contentType: image.contentType,
      metadata: {
        metadata: {
          orgId,
          uid,
          contentType: image.contentType,
          fileName,
          name: fileName,
          fileSize: String(bytes.length),
          directory: 'images',
          fileDocId,
          filePath,
          r2FilePath: '',
          r2URL: '',
          isPublic: '',
          toR2: 'true',
        },
      },
    })
    const uploadStatus = { success: true, message: 'File uploaded successfully.', meta: { file: filePath, fileDocId } }
    await docRef.set({
      orgId,
      docId: fileDocId,
      uploadStatus,
      uploadCompleted: true,
      meta: { tags, cmsmedia: true, cmssite: [site] },
      agentUpload: { ...provenance, sha256: sha256(bytes), width: image.width || null, height: image.height || null, uploadedAt: new Date(now()).toISOString() },
    }, { merge: true })
    return fileDocId
  }

  // Reads the new files until each is ready or failed, or the time is up.
  const waitForFiles = async (orgId, entries, deadline) => {
    const pending = () => entries.filter(entry => entry.fileId && entry.status === 'processing')
    while (pending().length && now() < deadline) {
      await sleep(1000)
      for (const entry of pending()) {
        const snap = await filesOf(orgId).doc(entry.fileId).get()
        if (snap.exists)
          Object.assign(entry, describeFile(entry.fileId, snap.data()), { deduplicated: entry.deduplicated })
      }
    }
  }

  const record = async ({ orgId, uid, caller, sources, tags, site, entries }) => {
    try {
      await db.collection('cms-operations').add({
        orgId,
        type: 'media.upload',
        checksum: null,
        runBy: uid,
        runAt: new Date(now()).toISOString(),
        via: 'agent',
        agentKeyId: caller.connectionId ? null : (caller.keyId || null),
        agentConnectionId: caller.connectionId || null,
        client: text(caller.client).slice(0, 100),
        status: 'applied',
        operation: { type: 'media.upload', tags, siteId: site, sources },
        result: { files: entries.map(entry => ({ fileId: entry.fileId || null, sourceUrl: entry.sourceUrl || null, localFile: entry.localFile || null, status: entry.status, deduplicated: Boolean(entry.deduplicated), problemCode: entry.problemCode || null })) },
      })
    }
    catch (error) {
      logger.warn('Agent media audit write failed', { orgId, error: error?.message })
    }
  }

  // One fetched or PUT image through deduplication by hash and the ingest.
  const store = async ({ orgId, uid, bytes, requestedName, fallbackName, tags, site, provenance }) => {
    const image = inspectImage(bytes)
    const existing = await findExisting(orgId, 'sha256', sha256(bytes), { tags, site })
    if (existing)
      return existing
    const name = fileNameFor(requestedName, fallbackName, image.ext)
    const fileId = await ingest({ orgId, uid, bytes, image, name, tags, site, provenance })
    return { fileId, name, status: 'processing', url: null, variants: {}, tags, cmssite: [site], width: image.width || null, height: image.height || null, deduplicated: false }
  }

  // A one-time link the agent PUTs a local file to (agentMediaUpload).
  const issueUploadLink = async ({ orgId, uid, caller, source, tags, site }) => {
    const { name, size } = source.localFile
    if (/\.svgz?$/i.test(name))
      throw refusal('svg-unsupported', 'SVG is not accepted: it gets no Cloudflare Images variants. Convert it to PNG and upload the PNG.')
    if (!/\.(jpe?g|png|gif|webp)$/i.test(name))
      throw refusal('unsupported-type', 'Only JPEG, PNG, GIF and WebP images are accepted.')
    if (size !== null && size > MAX_BYTES)
      throw refusal('too-large', `The image is over ${MAX_BYTES / 1024 / 1024} MB.`)
    const id = [...randomBytes(20)].map(byte => ALPHANUMERIC[byte % ALPHANUMERIC.length]).join('')
    const secret = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now() + UPLOAD_LINK_MS).toISOString()
    await uploads().doc(id).set({
      orgId,
      uid,
      tokenHash: sha256(secret),
      expiresAt,
      createdAt: new Date(now()).toISOString(),
      status: 'awaiting',
      localFile: name,
      name: source.name || name,
      tags,
      site,
      agentKeyId: caller.connectionId ? null : (caller.keyId || null),
      agentConnectionId: caller.connectionId || null,
      client: text(caller.client).slice(0, 100),
    })
    const token = `cmsmu.${id}.${secret}`
    const url = uploadUrl()
    return {
      localFile: name,
      status: 'awaiting-upload',
      fileId: null,
      upload: {
        method: 'PUT',
        url,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        expiresAt,
        curl: `curl -sS -X PUT -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/octet-stream' --data-binary @'<path to ${name}>' '${url}'`,
        note: 'Single use, for this file only, until expiresAt. The response is the upload result; then wait for status "ready" with cms_find_media and its fileId.',
      },
    }
  }

  // POST action media-upload: { sources, tags, siteId?, waitSeconds? }.
  const upload = async ({ uid, orgId, body, caller = {} }) => {
    const started = now()
    await requireUpload(uid, orgId)
    const tags = normalizeTags(body.tags)
    const site = body.siteId ? requireDocId(body.siteId, 'site id') : 'all'
    if (site !== 'all' && !(await orgRefOf(orgId).collection('sites').doc(site).get()).exists)
      throw new HttpsError('not-found', `Site "${site}" does not exist in this organization.`)
    const sources = normalizeSources(body.sources)
    const waitSeconds = Math.max(0, Math.min(MAX_WAIT_SECONDS, Number.isFinite(Number(body.waitSeconds)) ? Number(body.waitSeconds) : DEFAULT_WAIT_SECONDS))
    const entries = sources.map(source => ({ ...(source.url ? { sourceUrl: sourceKey(source.url) } : {}), ...(source.localFile ? { localFile: source.localFile.name } : {}) }))
    const fail = (index, error) => {
      if (!error?.problemCode)
        logger.error('Agent media upload failed', { orgId, error: error?.message })
      Object.assign(entries[index], { status: 'refused', fileId: null, url: null, problemCode: error?.problemCode || 'upload-failed', message: error?.problemCode ? error.message : 'The upload failed.' })
    }

    // Already uploaded from the same URL: no fetch.
    const toFetch = []
    for (const [index, source] of sources.entries()) {
      if (source.refused) {
        fail(index, refusal(source.refused.problemCode, source.refused.message))
        continue
      }
      if (source.localFile) {
        try {
          Object.assign(entries[index], await issueUploadLink({ orgId, uid, caller, source, tags, site }))
        }
        catch (error) {
          fail(index, error)
        }
        continue
      }
      try {
        checkUrl(source.url)
        const existing = await findExisting(orgId, 'sourceUrl', entries[index].sourceUrl, { tags, site })
        if (existing)
          Object.assign(entries[index], existing)
        else
          toFetch.push(index)
      }
      catch (error) {
        fail(index, error)
      }
    }

    const granted = await reserve(orgId, toFetch.length)
    toFetch.slice(granted).forEach(index => fail(index, refusal('daily-limit', `This organization has reached its ${DAILY_LIMIT} agent uploads for today.`)))
    const queue = toFetch.slice(0, granted)
    const worker = async () => {
      while (queue.length) {
        const index = queue.shift()
        const source = sources[index]
        try {
          const fetched = await fetchSource(source.url)
          Object.assign(entries[index], await store({
            orgId,
            uid,
            bytes: fetched.bytes,
            requestedName: source.name,
            fallbackName: nameFromUrl(fetched.finalUrl) || nameFromUrl(source.url),
            tags,
            site,
            provenance: { sourceUrl: entries[index].sourceUrl, finalUrl: fetched.finalUrl, connectionId: caller.connectionId || null, client: text(caller.client).slice(0, 100) },
          }))
        }
        catch (error) {
          fail(index, error)
        }
      }
    }
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker))
    await waitForFiles(orgId, entries, Math.min(now() + waitSeconds * 1000, started + CALL_BUDGET_MS))
    await record({ orgId, uid, caller, sources: sources.map(source => source.url || (source.localFile && `local:${source.localFile.name}`) || 'inline'), tags, site, entries })
    return {
      files: entries,
      ...(entries.some(entry => entry.status === 'processing') ? { next: 'Some images are still processing. Call cms_find_media with their fileIds until status is "ready", then use url (or variants[the field\'s variant]).' } : {}),
      ...(entries.some(entry => entry.status === 'awaiting-upload') ? { uploadNext: 'PUT each local file to its upload.url with its upload.headers (upload.curl), then wait for "ready" with cms_find_media.' } : {}),
    }
  }

  // The PUT to a one-time upload link.
  const receive = async ({ header, bytes, caller = {} }) => {
    const match = UPLOAD_TOKEN_PATTERN.exec(text(header).replace(/^Bearer\s+/i, ''))
    if (!match)
      throw new HttpsError('unauthenticated', 'A valid upload link token is required.')
    const ref = uploads().doc(match[1])
    const link = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref)
      const data = snap.exists ? snap.data() : null
      const expected = Buffer.from(String(data?.tokenHash || ''), 'hex')
      const actual = Buffer.from(sha256(match[2]), 'hex')
      if (!data || expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw new HttpsError('unauthenticated', 'Invalid upload link token.')
      if (data.status !== 'awaiting')
        throw new HttpsError('failed-precondition', 'This upload link was already used. Ask cms_upload_media for a new one.')
      if (!(Date.parse(data.expiresAt) > now()))
        throw new HttpsError('unauthenticated', 'This upload link expired. Ask cms_upload_media for a new one.')
      transaction.update(ref, { status: 'used', usedAt: new Date(now()).toISOString() })
      return data
    })
    const { orgId, uid } = link
    // The connection (or key) and the creator's rights, checked again now.
    const parent = link.agentConnectionId
      ? await db.collection('agent-connections').doc(link.agentConnectionId).get()
      : (link.agentKeyId ? await db.collection('agent-keys').doc(link.agentKeyId).get() : null)
    const parentData = parent?.exists ? parent.data() : null
    if (!parentData || parentData.revokedAt || !(Date.parse(parentData.expiresAt) > now()))
      throw new HttpsError('unauthenticated', 'The connection that asked for this link was revoked or expired.')
    await requireUpload(uid, orgId)
    const entry = { localFile: link.localFile }
    try {
      if (!bytes?.length)
        throw refusal('unsupported-type', 'The upload was empty: send the file as the request body.')
      if (bytes.length > MAX_BYTES)
        throw refusal('too-large', `The image is over ${MAX_BYTES / 1024 / 1024} MB.`)
      if (!await reserve(orgId, 1))
        throw refusal('daily-limit', `This organization has reached its ${DAILY_LIMIT} agent uploads for today.`)
      Object.assign(entry, await store({
        orgId,
        uid,
        bytes,
        requestedName: link.name,
        fallbackName: link.localFile,
        tags: link.tags,
        site: link.site,
        provenance: { sourceUrl: null, localFile: link.localFile, connectionId: link.agentConnectionId || null, client: link.client || text(caller.client) },
      }))
      await ref.update({ fileId: entry.fileId })
    }
    catch (error) {
      if (!error?.problemCode)
        throw error
      Object.assign(entry, { status: 'refused', fileId: null, url: null, problemCode: error.problemCode, message: error.message })
    }
    await waitForFiles(orgId, [entry], now() + 20000)
    await record({ orgId, uid, caller: { connectionId: link.agentConnectionId, keyId: link.agentKeyId, client: link.client }, sources: [`local:${link.localFile}`], tags: link.tags, site: link.site, entries: [entry] })
    return { files: [entry] }
  }

  // POST action media-find: { fileIds? | sourceUrl? | query?, tags?,
  // siteId?, limit?, startAfter? }. Image media only, newest first.
  const find = async ({ uid, orgId, body }) => {
    if (!await canDo(uid, 'read', `organizations/${orgId}/files`))
      throw new HttpsError('permission-denied', 'Not allowed to read media in this organization.')
    const limit = Math.max(1, Math.min(FIND_MAX, Number(body.limit) || 50))
    const fileIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.map(id => text(id)).filter(Boolean))] : []
    if (fileIds.length) {
      if (fileIds.length > FIND_MAX)
        throw new HttpsError('invalid-argument', `Pass at most ${FIND_MAX} fileIds.`)
      const files = []
      const missing = []
      for (const id of fileIds) {
        const snap = await filesOf(orgId).doc(requireDocId(id, 'file id')).get()
        if (snap.exists)
          files.push(describeFile(id, snap.data()))
        else
          missing.push(id)
      }
      return { files, missing, scanTruncated: false }
    }
    let docs
    let scanTruncated = false
    if (text(body.sourceUrl)) {
      docs = (await filesOf(orgId).where('agentUpload.sourceUrl', '==', sourceKey(body.sourceUrl)).limit(20).get()).docs
    }
    else {
      docs = (await filesOf(orgId).limit(FIND_SCAN_LIMIT + 1).get()).docs
      scanTruncated = docs.length > FIND_SCAN_LIMIT
      docs = docs.slice(0, FIND_SCAN_LIMIT)
    }
    const query = text(body.query).toLowerCase()
    const tags = Array.isArray(body.tags) ? body.tags.map(tag => text(tag).toLowerCase()).filter(Boolean) : []
    const site = text(body.siteId)
    const matches = docs
      .map(doc => ({ id: doc.id, data: doc.data() || {} }))
      .filter(({ data }) => isImageDoc(data))
      .filter(({ data }) => !query || `${data.name || ''} ${data.fileName || ''}`.toLowerCase().includes(query))
      .filter(({ data }) => !tags.length || (Array.isArray(data.meta?.tags) && data.meta.tags.some(tag => tags.includes(text(tag).toLowerCase()))))
      .filter(({ data }) => !site || (Array.isArray(data.meta?.cmssite) && (data.meta.cmssite.includes(site) || data.meta.cmssite.includes('all'))))
      .sort((a, b) => (Number(b.data.uploadTime) || 0) - (Number(a.data.uploadTime) || 0) || (a.id < b.id ? -1 : 1))
    const start = body.startAfter ? matches.findIndex(item => item.id === text(body.startAfter)) + 1 : 0
    const page = matches.slice(start, start + limit)
    return {
      files: page.map(({ id, data }) => describeFile(id, data)),
      total: matches.length,
      nextStartAfter: start + limit < matches.length ? (page[page.length - 1]?.id || null) : null,
      scanTruncated,
    }
  }

  return { upload, receive, find }
}

const agentMedia = createAgentMedia()

// PUT <one-time upload link> with Authorization: Bearer cmsmu.… and the
// image as the body. Answers like cms_upload_media for that one file.
const serveUpload = async (req, res, media = agentMedia) => {
  if (req.method !== 'PUT' && req.method !== 'POST') {
    res.status(405).set('Allow', 'PUT').json({ ok: false, code: 'method-not-allowed', message: 'PUT the image file as the request body.' })
    return
  }
  try {
    const bytes = Buffer.isBuffer(req.rawBody) ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
    const result = await media.receive({ header: req.get ? req.get('authorization') : req.headers?.authorization, bytes, caller: { client: req.get ? req.get('user-agent') : '' } })
    res.status(200).json({ ok: true, ...result })
  }
  catch (error) {
    const code = error?.code ? String(error.code) : 'internal'
    const status = { 'invalid-argument': 400, 'unauthenticated': 401, 'permission-denied': 403, 'not-found': 404, 'failed-precondition': 409 }[code] || 500
    if (status === 500)
      logger.error('Agent media upload link failed', { error: error?.message })
    res.status(status).json({ ok: false, code, message: status === 500 ? 'The upload failed.' : String(error.message || '') })
  }
}

exports.agentMediaUpload = onRequest({ timeoutSeconds: 120, memory: '512MiB' }, (req, res) => serveUpload(req, res))

exports.agentMedia = agentMedia
// For tests.
exports.createAgentMedia = createAgentMedia
exports.createSourceFetcher = createSourceFetcher
exports.serveUpload = serveUpload
exports.isBlockedAddress = isBlockedAddress
exports.checkUrl = checkUrl
exports.inspectImage = inspectImage
exports.describeFile = describeFile
exports.MEDIA_LIMITS = { MAX_BYTES, MAX_SOURCES, DAILY_LIMIT, MAX_SIDE, MAX_PIXELS }
