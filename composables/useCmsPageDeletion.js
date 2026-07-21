const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)

const cloneValue = (value) => {
  if (Array.isArray(value))
    return value.map(cloneValue)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)]),
    )
  }
  return value
}

const isExternalLinkEntry = entry => isRecord(entry?.item) && entry.item.type === 'external'

export const removeCmsPageFromMenuItems = (items, pageId) => {
  if (!Array.isArray(items))
    return []

  return items
    .map((entry) => {
      if (!isRecord(entry))
        return cloneValue(entry)
      if (isExternalLinkEntry(entry))
        return cloneValue(entry)
      if (typeof entry.item === 'string')
        return entry.item === pageId ? null : cloneValue(entry)
      if (isRecord(entry.item)) {
        const nextEntry = cloneValue(entry)
        for (const [folderSlug, nestedItems] of Object.entries(nextEntry.item))
          nextEntry.item[folderSlug] = removeCmsPageFromMenuItems(nestedItems, pageId)
        return nextEntry
      }
      return cloneValue(entry)
    })
    .filter(Boolean)
}

export const removeCmsPageFromMenus = (menus, pageId, { ensureRootMenus = false } = {}) => {
  const nextMenus = isRecord(menus) ? cloneValue(menus) : {}
  for (const [menuName, items] of Object.entries(nextMenus))
    nextMenus[menuName] = removeCmsPageFromMenuItems(items, pageId)

  if (ensureRootMenus) {
    if (!Array.isArray(nextMenus['Site Root']))
      nextMenus['Site Root'] = []
    if (!Array.isArray(nextMenus['Not In Menu']))
      nextMenus['Not In Menu'] = []
  }

  return nextMenus
}

export const assertCmsActionSucceeded = (result, fallbackMessage) => {
  if (result?.success)
    return result
  throw new Error(result?.message || fallbackMessage || 'The CMS action failed.')
}
