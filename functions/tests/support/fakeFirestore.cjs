// Minimal in-memory Firestore for trigger and callable unit tests.
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
// Stands in for Firestore.FieldValue.delete() in update() calls.
const DELETE_FIELD = Object.freeze({ __fakeFirestoreDelete: true })
const isDeleteField = value => Boolean(value) && value.__fakeFirestoreDelete === true
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const deepMerge = (target, source) => {
  const next = { ...(target || {}) }
  for (const [key, value] of Object.entries(source || {}))
    next[key] = (isObject(value) && isObject(next[key])) ? deepMerge(next[key], value) : clone(value)
  return next
}

// It covers nested collection/doc refs (with generated ids), array-contains
// and equality queries, batches, and transactions. Transaction and batch
// writes are buffered and applied only when the callback or commit succeeds,
// as Firestore does.
const createFakeDb = (seed = {}) => {
  const docs = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]))
  const writes = []
  const hooks = { beforeTransactionGet: null }

  // Refs, snapshots and queries refer to each other, so declare them first.
  let snapshot
  let collectionRef
  const applyUpdate = (path, data) => {
    if (!docs.has(path))
      throw new Error(`No document to update: ${path}`)
    const next = { ...docs.get(path), ...clone(data) }
    for (const [key, value] of Object.entries(next)) {
      if (isDeleteField(value))
        delete next[key]
    }
    docs.set(path, next)
    writes.push({ type: 'update', path, data: clone(data) })
  }
  const applySet = (path, data, options = {}) => {
    docs.set(path, options.merge ? deepMerge(docs.get(path), data) : clone(data))
    writes.push({ type: 'set', path, data: clone(data) })
  }
  const docRef = (path) => {
    const ref = {
      path,
      id: path.split('/').pop(),
      collection: name => collectionRef(`${path}/${name}`),
      async get() { return snapshot(path) },
      async update(data) { applyUpdate(path, data) },
      async set(data, options = {}) { applySet(path, data, options) },
    }
    return ref
  }
  snapshot = (path) => {
    const exists = docs.has(path)
    return { id: path.split('/').pop(), ref: docRef(path), exists, data: () => (exists ? clone(docs.get(path)) : undefined) }
  }
  const query = (path, filters = [], limit = Infinity, cursor = '', ordered = false) => ({
    where: (field, op, value) => query(path, [...filters, { field, op, value }], limit, cursor, ordered),
    limit: count => query(path, filters, count, cursor, ordered),
    orderBy: () => query(path, filters, limit, cursor, true),
    startAfter: id => query(path, filters, limit, id, ordered),
    count: () => ({
      async get() {
        const { size } = await query(path, filters, limit).get()
        return { data: () => ({ count: size }) }
      },
    }),
    async get() {
      const paths = [...docs.keys()]
      if (ordered)
        paths.sort()
      const matches = paths
        .filter(docPath => !cursor || docPath.split('/').pop() > cursor)
        .filter(docPath => docPath.startsWith(`${path}/`) && !docPath.slice(path.length + 1).includes('/'))
        .filter(docPath => filters.every(({ field, op, value }) => {
          const fieldValue = docs.get(docPath)?.[field]
          if (op === 'array-contains')
            return Array.isArray(fieldValue) && fieldValue.includes(value)
          if (op === '==')
            return fieldValue === value
          throw new Error(`Unsupported operator ${op}`)
        }))
        .slice(0, limit)
        .map(snapshot)
      return { empty: matches.length === 0, size: matches.length, docs: matches }
    },
  })
  let generatedIds = 0
  collectionRef = path => ({
    ...query(path),
    doc: id => docRef(`${path}/${id === undefined ? `generated-${++generatedIds}` : id}`),
  })

  const bufferedWriter = () => {
    const pending = []
    return {
      pending,
      update: (ref, data) => { pending.push(() => applyUpdate(ref.path, data)) },
      set: (ref, data, options) => { pending.push(() => applySet(ref.path, data, options)) },
      commit: () => pending.splice(0).forEach(write => write()),
    }
  }

  const db = {
    collection: name => collectionRef(name),
    async runTransaction(callback) {
      const writer = bufferedWriter()
      const transaction = {
        async get(target) {
          if (hooks.beforeTransactionGet)
            hooks.beforeTransactionGet(target.path)
          return target.get()
        },
        update: writer.update,
        set: writer.set,
      }
      const result = await callback(transaction)
      writer.commit()
      return result
    },
    batch() {
      const writer = bufferedWriter()
      return {
        update: writer.update,
        set: writer.set,
        async commit() {
          writer.commit()
        },
      }
    },
  }
  return { db, docs, writes, hooks }
}

module.exports = { DELETE_FIELD, clone, createFakeDb }
