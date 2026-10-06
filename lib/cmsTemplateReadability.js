// Format only the editor's view of a single-line template. Template tokens
// are opaque to HTML formatting: keep their exact spelling and quoted JSON.
export const prepareTemplateReadability = (value) => {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))
    return null
  const prefix = 'CMSREADABILITYTOKEN'
  if (value.includes(prefix))
    return null
  const tokens = []
  let masked = ''
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('{{', cursor)
    if (start < 0) {
      masked += value.slice(cursor)
      break
    }
    masked += value.slice(cursor, start)
    const width = value.startsWith('{{{', start) ? 3 : 2
    let depth = 0
    let quote = ''
    let end = start + width
    for (; end < value.length; end++) {
      const char = value[end]
      if (quote) {
        if (char === '\\') end++
        else if (char === quote) quote = ''
      }
      else if (char === '"' || char === "'") quote = char
      else if (depth === 0 && value.startsWith('}'.repeat(width), end)) break
      else if (char === '{') depth++
      else if (char === '}') depth--
    }
    if (end >= value.length || depth !== 0)
      return null
    const token = value.slice(start, end + width)
    const marker = `${prefix}${tokens.length}END`
    // Comments give control tags their own lines; expressions remain inline.
    // Within an HTML tag use plain markers, including attribute conditions.
    const insideTag = masked.lastIndexOf('<') > masked.lastIndexOf('>')
    const control = /^\{\{\{?\s*(?:[#/]|else\b)/.test(token)
    const placeholder = control && !insideTag ? `<!--${marker}-->` : marker
    tokens.push({ placeholder, token })
    masked += placeholder
    cursor = end + width
  }
  return { masked, tokens }
}

export const restoreTemplateReadability = (formatted, prepared) => {
  let result = formatted
  for (const { placeholder, token } of prepared.tokens) {
    if (result.split(placeholder).length !== 2)
      return null
    result = result.replace(placeholder, () => token)
  }
  return result
}

// Monaco formats whitespace; preserve the original source offsets for the
// block editor's field/loop tools while the formatted view is still unedited.
export const templateSourceOffset = (source, display, offset) => {
  let original = 0
  let shown = 0
  while (shown < offset && original < source.length) {
    if (source[original] === display[shown]) { original++; shown++ }
    else if (/\s/.test(display[shown])) shown++
    else if (/\s/.test(source[original])) original++
    else return offset
  }
  return original
}

export const formatSingleLineTemplate = async (value, formatHtml) => {
  const prepared = prepareTemplateReadability(value)
  if (!prepared)
    return value
  const formatted = await formatHtml(prepared.masked)
  const restored = restoreTemplateReadability(formatted, prepared)
  // Never accept non-whitespace changes from the formatter.
  return restored && restored.replace(/\s/g, '') === value.replace(/\s/g, '') ? restored : value
}
