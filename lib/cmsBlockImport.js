// Import-screen decisions around the shared block validator.

// Until the production block audit is reviewed, shared-validator findings are
// advisory: they are listed after import but never block a file. The Hub's
// existing hard failures (missing keys, invalid type or themes) still reject
// files regardless of this flag.
export const ENFORCE_SHARED_BLOCK_VALIDATION = false

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
