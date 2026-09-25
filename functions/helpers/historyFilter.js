// Which document writes the history trigger records. Keep identical to
// edge/functions/helpers/historyFilter.js.

// Fields whose changes alone don't make a history entry, by rule match. For
// library blocks these are the revision and release pointers the CMS writes
// on every draft save, discard and release; definition and metadata changes
// are still recorded. A rule can add its own `ignoreFields`.
const DEFAULT_IGNORE_FIELDS = Object.freeze({
  'blocks/*': Object.freeze(['releasedRevision', 'draftRevision', 'lastRevisionNumber', 'activeReleaseId', 'lastReleaseId', 'canary']),
})

const ignoredFieldsFor = rule => new Set([
  ...(DEFAULT_IGNORE_FIELDS[String(rule?.match || '').trim()] || []),
  ...(Array.isArray(rule?.ignoreFields) ? rule.ignoreFields.map(field => String(field)) : []),
])

// Key-order independent comparison of Firestore values (Timestamps compare
// by their JSON form).
const stableStringify = (value) => {
  if (value && typeof value.toMillis === 'function')
    return `ts:${value.toMillis()}`
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  return JSON.stringify(value === undefined ? null : value)
}

// True when an update changed only ignored fields.
const onlyIgnoredFieldsChanged = (beforeData, afterData, ignored) => {
  if (!ignored.size || !beforeData || !afterData)
    return false
  const keys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)])
  const changed = [...keys].filter(key => stableStringify(beforeData[key]) !== stableStringify(afterData[key]))
  return changed.length > 0 && changed.every(key => ignored.has(key))
}

module.exports = { DEFAULT_IGNORE_FIELDS, ignoredFieldsFor, onlyIgnoredFieldsChanged, stableStringify }
