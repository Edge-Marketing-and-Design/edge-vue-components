// Reconcile only a published type's posts. Transactions always use the current
// published definition and current snapshot, never an event's stale payload.
const { buildPostKvMetadata } = require('./cmsPostKvMetadata')

async function refreshPostTypeMetadata({ db, siteRef, pageId, documentId, log = () => {} }) {
  const { postProjection } = await import('./cmsPostTypes.mjs')
  const pageRef = siteRef.collection('published').doc(pageId)
  const posts = siteRef.collection('published_posts')
  let cursor = null, updated = 0, skipped = 0
  for (;;) {
    let query = posts.where('postTypeId', '==', pageId).orderBy(documentId).limit(100)
    if (cursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const changed = await db.runTransaction(async transaction => {
        const [page, post] = await Promise.all([transaction.get(pageRef), transaction.get(doc.ref)])
        if (!page.exists || !post.exists || !page.data()?.postType?.enabled || post.data()?.postTypeId !== pageId) return false
        const projection = postProjection(page.data())
        if (JSON.stringify(post.data().postTypeProjection) === JSON.stringify(projection)) return false
        // Invalid/oversized metadata fails before any write. The prior version
        // remains intact, and a corrected publication/retry can resume safely.
        buildPostKvMetadata({ ...post.data(), postTypeProjection: projection }, { orgId: siteRef.path?.split('/')[1] || siteRef.parent?.parent?.id, siteId: siteRef.id, postId: doc.id })
        transaction.update(doc.ref, { postTypeProjection: projection })
        return true
      })
      if (changed) updated++
      else skipped++
    }
    cursor = snapshot.docs.at(-1)
    log({ updated, skipped, cursor: cursor.id })
  }
  return { updated, skipped }
}
module.exports = { refreshPostTypeMetadata }
