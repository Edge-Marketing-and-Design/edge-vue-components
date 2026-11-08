#!/usr/bin/env node
// Dry-run by default. Queue publication reconciliation, never edit live drafts.
// node edge/scripts/backfill-site-resolution.cjs --project <id> [--apply --production]
const path = require('node:path')
const { createRequire } = require('node:module')

async function main(args = process.argv.slice(2)) {
  const projectIndex = args.indexOf('--project')
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : ''
  const apply = args.includes('--apply')
  const production = args.includes('--production')
  const known = new Set(['--project', projectId, '--apply', '--production'])
  if (!projectId || projectId.startsWith('--') || args.some(arg => !known.has(arg))) throw new Error('Usage: --project <id> [--apply --production]')
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  if (emulator && production) throw new Error('Refusing --production with FIRESTORE_EMULATOR_HOST set.')
  if (apply && !emulator && !production) throw new Error('Production writes require --apply --production.')
  const localRequire = createRequire(path.join(process.cwd(), 'functions/package.json'))
  const admin = localRequire('firebase-admin')
  const app = admin.initializeApp({ projectId }, 'site-resolution-backfill')
  const db = app.firestore()
  let total = 0
  const seen = new Set()
  const visit = async (orgId, siteId) => {
    if (!orgId || !siteId || seen.has(`${orgId}/${siteId}`)) return
    seen.add(`${orgId}/${siteId}`)
    if (apply) await db.collection('topic-queue').add({
      topic: process.env.KV_RETRY_TOPIC || 'kv-mirror-retry',
      payload: { op: 'reconcileSiteResolution', key: `sites:${orgId}:${siteId}`, orgId, siteId },
      minuteDelay: 0, retry: 0, timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    total += 1
    console.log(`${apply ? 'Queued' : 'Would queue'} ${orgId}/${siteId}`)
  }
  const scan = async (query, read) => {
    let cursor
    for (;;) {
      let next = query.orderBy(admin.firestore.FieldPath.documentId()).limit(100)
      if (cursor) next = next.startAfter(cursor)
      const batch = await next.get()
      for (const doc of batch.docs) await read(doc)
      if (batch.size < 100) break
      cursor = batch.docs[batch.docs.length - 1]
    }
  }
  try {
    await scan(db.collectionGroup('published-site-settings'), async doc => {
      const match = doc.ref.path.match(/^organizations\/([^/]+)\/published-site-settings\/([^/]+)$/)
      if (match) await visit(match[1], match[2])
    })
    // Previously managed but now unpublished sites need tombstone cleanup too.
    await scan(db.collection('cms-site-resolution'), doc => visit(doc.data().orgId, doc.data().siteId))
    console.log(`${apply ? 'Queued' : 'Dry run:'} ${total} site(s). ${emulator ? 'Emulator' : projectId}.`)
  }
  finally { await app.delete() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { main }
