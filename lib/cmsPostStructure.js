const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const createPostColumn = (createId, span = 12, mobileOrder = 0) => ({
  id: createId(),
  span,
  mobileOrder,
  blocks: [],
})

const createPostRow = createId => ({
  id: createId(),
  width: 'full',
  gap: '4',
  verticalAlign: 'start',
  background: 'transparent',
  mobileStack: 'normal',
  columns: [createPostColumn(createId)],
})

export const collectCmsPostStructureBlockIds = (structure = []) => {
  const blockIds = new Set()
  for (const row of Array.isArray(structure) ? structure : []) {
    for (const column of Array.isArray(row?.columns) ? row.columns : []) {
      for (const blockId of Array.isArray(column?.blocks) ? column.blocks : [])
        blockIds.add(blockId)
    }
  }
  return blockIds
}

export const normalizeCmsPostStructure = ({ structure = [], contentIds = [], createId }) => {
  if (typeof createId !== 'function')
    throw new TypeError('normalizeCmsPostStructure requires createId')

  const availableBlockIds = new Set(Array.isArray(contentIds) ? contentIds : [])
  const normalizedRows = (Array.isArray(structure) ? structure : [])
    .filter(isPlainObject)
    .map((row) => {
      const sourceColumns = (Array.isArray(row.columns) && row.columns.length)
        ? row.columns
        : [{}]
      const columns = sourceColumns.map((sourceColumn, columnIndex) => {
        const column = isPlainObject(sourceColumn) ? sourceColumn : {}
        const blocks = Array.isArray(column.blocks) ? column.blocks : []
        return {
          ...column,
          id: column.id || createId(),
          span: Object.prototype.hasOwnProperty.call(column, 'span')
            ? column.span
            : (sourceColumns.length === 1 ? 12 : null),
          mobileOrder: Object.prototype.hasOwnProperty.call(column, 'mobileOrder')
            ? column.mobileOrder
            : columnIndex,
          blocks: blocks.filter(blockId => availableBlockIds.has(blockId)),
        }
      })

      return {
        ...row,
        id: row.id || createId(),
        width: row.width || 'full',
        gap: row.gap || '4',
        verticalAlign: row.verticalAlign || 'start',
        background: (typeof row.background === 'string' && row.background)
          ? row.background
          : 'transparent',
        mobileStack: row.mobileStack || 'normal',
        columns,
      }
    })

  if (!normalizedRows.length && availableBlockIds.size) {
    const row = createPostRow(createId)
    row.columns[0].blocks = [...availableBlockIds]
    normalizedRows.push(row)
  }

  const referencedBlockIds = collectCmsPostStructureBlockIds(normalizedRows)
  const orphanBlockIds = [...availableBlockIds].filter(blockId => !referencedBlockIds.has(blockId))
  if (orphanBlockIds.length) {
    if (!normalizedRows.length)
      normalizedRows.push(createPostRow(createId))
    normalizedRows.at(-1).columns[0].blocks.push(...orphanBlockIds)
  }

  return normalizedRows
}

export const filterCmsPostContentToStructure = (content = [], structure = []) => {
  const usedBlockIds = collectCmsPostStructureBlockIds(structure)
  return (Array.isArray(content) ? content : []).filter(block => usedBlockIds.has(block?.id))
}

export const insertCmsPostBlockReference = (structure = [], rowIndex, columnIndex, insertIndex, blockId) => {
  const column = structure?.[rowIndex]?.columns?.[columnIndex]
  if (!column || !Array.isArray(column.blocks))
    return false
  const safeInsertIndex = Math.min(Math.max(Number(insertIndex) || 0, 0), column.blocks.length)
  column.blocks.splice(safeInsertIndex, 0, blockId)
  return true
}

export const removeCmsPostBlockReferences = (structure = [], blockId) => {
  for (const row of Array.isArray(structure) ? structure : []) {
    for (const column of Array.isArray(row?.columns) ? row.columns : []) {
      if (Array.isArray(column.blocks))
        column.blocks = column.blocks.filter(id => id !== blockId)
    }
  }
}
