// A color choice is a theme token, never a copied color value.
export const splashThemeColors = (input) => {
  try {
    let theme = input?.theme ?? input
    if (typeof theme === 'string') theme = JSON.parse(theme)
    const colors = theme?.extend?.colors
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return []
    const choices = []
    const visit = (values, prefix = '') => {
      for (const [key, value] of Object.entries(values)) {
        const name = key === 'DEFAULT' ? prefix : [prefix, key].filter(Boolean).join('.')
        if (typeof value === 'string' && value.trim() && name) {
          choices.push({ name, color: value.trim() })
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          visit(value, name)
        }
      }
    }
    visit(colors)
    return choices
  } catch {
    return []
  }
}
