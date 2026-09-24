// A picked synced block may be cloned from an existing page instance, whose
// identity fields can be older than the library block. Refresh them from the
// library block so a stale instance cannot seed stale placements.
export const applyLibraryBlockIdentity = (instance, libraryBlock) => {
  instance.name = libraryBlock?.name
  instance.blockId = libraryBlock?.docId
  if (Object.prototype.hasOwnProperty.call(libraryBlock || {}, 'isOverrideBlock'))
    instance.isOverrideBlock = libraryBlock.isOverrideBlock === true
  else
    delete instance.isOverrideBlock
  return instance
}
