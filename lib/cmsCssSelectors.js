// Split only selector-list commas, not escaped class characters or commas in
// functions/attribute values (for example clamp(...) and :is(...)).
export const splitCssSelectorList = (selector) => {
  const parts = []
  let start = 0
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote)
        quote = ''
      continue
    }
    if (char === '"' || char === "'")
      quote = char
    else if (char === '(' || char === '[')
      depth++
    else if (char === ')' || char === ']')
      depth--
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts.filter(Boolean)
}
