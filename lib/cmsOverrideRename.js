// The public renderer resolves an override block from the block name copied
// into each page instance at placement. Renaming the library block does not
// rename existing instances, so new placements can silently fall back to the
// block's CMS HTML. Callers confirm such renames before writing.

const normalizeName = value => String(value ?? '').trim()

export const getOverrideRenameChange = (storedDoc, nextDoc) => {
  if (storedDoc?.isOverrideBlock !== true)
    return null
  const fromName = normalizeName(storedDoc.name)
  const toName = normalizeName(nextDoc?.name)
  if (!fromName || fromName === toName)
    return null
  return { fromName, toName }
}

// Runs `write` unless the change renames an override block and `confirm`
// declines it. A declined rename resolves to `{ cancelled: true }` without
// writing.
export const guardOverrideRename = async ({ storedDoc, nextDoc, confirm, write }) => {
  const change = getOverrideRenameChange(storedDoc, nextDoc)
  if (change && await confirm(change) !== true)
    return { cancelled: true }
  return write()
}
