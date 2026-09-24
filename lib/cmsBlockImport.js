// Import-screen decisions around the shared block validator.

// Shared-validator errors reject a file before anything is written; warnings
// are listed after import and never block. Enabled 2026-09-24 after the
// production block audit found no new-rule errors. The Hub's own hard
// failures (missing keys, invalid type or themes) apply regardless.
export const ENFORCE_SHARED_BLOCK_VALIDATION = true

// Unknown theme ids are resolved by their own confirmation, so they are not
// repeated in the findings list.
const HANDLED_ELSEWHERE = new Set(['themes.unknown'])

export const collectImportFindings = (result, { enforce = ENFORCE_SHARED_BLOCK_VALIDATION } = {}) => {
  const errors = (result?.errors || []).filter(issue => !HANDLED_ELSEWHERE.has(issue.code))
  const warnings = (result?.warnings || []).filter(issue => !HANDLED_ELSEWHERE.has(issue.code))
  return enforce
    ? { blocking: errors, notices: warnings }
    : { blocking: [], notices: [...errors, ...warnings] }
}

// Keeps the valid theme ids in order and reports the ones that will be dropped.
// Previously one unknown or empty id cleared every theme, valid ones included.
export const resolveImportedBlockThemes = (themes, knownThemeIds) => {
  const known = new Set(knownThemeIds || [])
  const kept = []
  const dropped = []
  for (const value of Array.isArray(themes) ? themes : []) {
    const themeId = String(value || '').trim()
    if (known.has(themeId)) {
      if (!kept.includes(themeId))
        kept.push(themeId)
    }
    else if (!dropped.includes(themeId)) {
      dropped.push(themeId)
    }
  }
  return { themes: kept, dropped }
}

// A rejected file's error carries its blocking findings so the results dialog
// can list each one.
export const createBlockCheckError = (blocking) => {
  const [first] = blocking
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : ''
  const error = new Error(`Block checks failed: ${first?.message || 'unknown error'}${more}`)
  error.issues = blocking
  return error
}
