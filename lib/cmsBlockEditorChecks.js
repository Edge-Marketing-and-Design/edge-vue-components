// Saved-block advice uses allowed themes, while a release uses each actual
// destination's theme. Neither path validates renderer-owned Vue placeholders.
import { validateBlock, themeNameFindings, templateClassStrings } from './cmsBlockValidation.js'
import { buildReleaseThemeContexts, contextualBlockThemeWarnings } from './cmsBlockReleaseChecks.js'

export const validateEditorBlock = async (doc, { themes = {}, ...options } = {}) => {
  if (doc?.isOverrideBlock === true)
    return { valid: true, errors: [], warnings: [], info: [], contentChecksSkipped: 'override' }

  const result = await validateBlock(doc, options)
  const themeContexts = buildReleaseThemeContexts({ targets: [], themes, blockThemes: Array.isArray(doc?.themes) ? doc.themes : [] })
  return {
    ...result,
    warnings: contextualBlockThemeWarnings({ doc: doc || {}, originalWarnings: result.warnings, themeContexts, themeNameFindings, templateClassStrings })
      .map(issue => ({ ...issue, severity: 'warning' })),
  }
}
