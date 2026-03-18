export const useJsonFileSave = () => {
  const jsonFileType = {
    description: 'JSON Files',
    accept: {
      'application/json': ['.json'],
    },
  }

  const writeJsonFile = async (fileHandle, payload) => {
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(payload, null, 2))
    await writable.close()
  }

  const isExportCanceled = options => options?.shouldCancel?.() === true
  const notifyExportProgress = (options, payload) => options?.onProgress?.(payload)

  const saveJsonFile = async (payload, suggestedName = 'export.json', options = {}) => {
    if (typeof window === 'undefined')
      return false
    if (isExportCanceled(options))
      return false

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        notifyExportProgress(options, {
          phase: 'selecting-location',
          completed: 0,
          total: 1,
          current: 1,
          suggestedName,
        })
        const fileHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [jsonFileType],
        })
        if (isExportCanceled(options))
          return false
        notifyExportProgress(options, {
          phase: 'saving',
          completed: 0,
          total: 1,
          current: 1,
          suggestedName,
        })
        await writeJsonFile(fileHandle, payload)
        notifyExportProgress(options, {
          phase: 'saved',
          completed: 1,
          total: 1,
          current: 1,
          suggestedName,
        })
        return true
      }
      catch (error) {
        if (error?.name === 'AbortError')
          return false
        throw error
      }
    }

    const jsonText = JSON.stringify(payload, null, 2)
    const blob = new Blob([jsonText], { type: 'application/json' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = suggestedName
    notifyExportProgress(options, {
      phase: 'saving',
      completed: 0,
      total: 1,
      current: 1,
      suggestedName,
    })
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
    notifyExportProgress(options, {
      phase: 'saved',
      completed: 1,
      total: 1,
      current: 1,
      suggestedName,
    })
    return true
  }

  const saveJsonFiles = async (entries = [], options = {}) => {
    if (typeof window === 'undefined')
      return 0

    const normalizedEntries = entries.filter(entry => entry?.suggestedName)
    if (!normalizedEntries.length)
      return 0
    if (isExportCanceled(options))
      return 0

    if (typeof window.showDirectoryPicker === 'function') {
      try {
        notifyExportProgress(options, {
          phase: 'selecting-location',
          completed: 0,
          total: normalizedEntries.length,
          current: 0,
          suggestedName: '',
        })
        const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
        let savedCount = 0
        for (const [index, entry] of normalizedEntries.entries()) {
          if (isExportCanceled(options))
            break
          notifyExportProgress(options, {
            phase: 'saving',
            completed: savedCount,
            total: normalizedEntries.length,
            current: index + 1,
            suggestedName: entry.suggestedName,
          })
          const fileHandle = await directoryHandle.getFileHandle(entry.suggestedName, { create: true })
          await writeJsonFile(fileHandle, entry.payload)
          savedCount += 1
          notifyExportProgress(options, {
            phase: 'saved',
            completed: savedCount,
            total: normalizedEntries.length,
            current: index + 1,
            suggestedName: entry.suggestedName,
          })
        }
        return savedCount
      }
      catch (error) {
        if (error?.name === 'AbortError')
          return 0
        throw error
      }
    }

    let savedCount = 0
    for (const [index, entry] of normalizedEntries.entries()) {
      if (isExportCanceled(options))
        break
      notifyExportProgress(options, {
        phase: 'selecting-location',
        completed: savedCount,
        total: normalizedEntries.length,
        current: index + 1,
        suggestedName: entry.suggestedName,
      })
      const saved = await saveJsonFile(entry.payload, entry.suggestedName)
      if (!saved)
        break
      savedCount += 1
      notifyExportProgress(options, {
        phase: 'saved',
        completed: savedCount,
        total: normalizedEntries.length,
        current: index + 1,
        suggestedName: entry.suggestedName,
      })
    }
    return savedCount
  }

  return {
    saveJsonFile,
    saveJsonFiles,
  }
}
