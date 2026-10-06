// Parses the JSON config inside a template tag, such as
// `{{{#if {"cond":"photo.size == 'large'"}}}}` or `{{{#text {"field":"title"}}}}`.
// Strict JSON first, as the template engine's own parseConfig does; only then
// the legacy loose form (unquoted keys, single-quoted strings). Converting
// quotes first breaks valid configs whose values contain a quoted string, so
// conditions like the one above silently never matched in the Hub.

export const normalizeConfigLiteral = str => String(str || '')
  // Quote bare keys: { title: "x" } -> { "title": "x" }.
  .replace(/(\{|,)\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
  // Allow single-quoted strings.
  .replace(/'/g, '"')

export const safeParseTagConfig = (raw) => {
  try {
    return JSON.parse(raw)
  }
  catch {
    // Fall back to the legacy loose form below.
  }
  try {
    return JSON.parse(normalizeConfigLiteral(raw))
  }
  catch {
    return null
  }
}
