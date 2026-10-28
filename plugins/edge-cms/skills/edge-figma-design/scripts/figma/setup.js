// Creates the site's token collection (colors, radii) and text styles from the
// content plan's design language (section 2). Run once per Figma file, before
// the components. Paste the function into a use_figma call and run it:
//
//   const setup = <this function>;
//   return await setup(figma, SPEC);
//
// SPEC (every name below is used by components.js and blocks.js; keep them):
// {
//   collection: 'ACME Tokens',          // variable collection name
//   stylePrefix: 'ACME/',               // text style prefix
//   colors: { primary: ['#083D38', 'Dark section backgrounds'], ... },
//     required roles: primary onPrimary secondary tertiary onTertiary accent
//     canvas surface surfaceAlt text textMuted heading border success
//   radii: { button: 12, card: 16, panel: 24, tile: 12, sm: 8, pill: 9999 },
//   type: [ ['H1 Hero', 'Family', 'Style', size, lineHeight, letterSpacingPercent, 'UPPER'|'ORIGINAL'], ... ]
//     required names: H1 Hero, H1 Interior, H1 Mobile, H2 Section, H2 Mobile,
//     H3 Panel, H3 Mobile, H3 Small, Eyebrow, Display Number, Display Year,
//     Quote, Statement, Footer Line, Lead, Body, Body Card, Small, Card Title,
//     Body Bold, Label, Label Large, Nav Link, Button, Button Large
// }
async function setupTokens(figma, spec) {
  const hex = (x) => ({ r: parseInt(x.slice(1, 3), 16) / 255, g: parseInt(x.slice(3, 5), 16) / 255, b: parseInt(x.slice(5, 7), 16) / 255 })
  const existing = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === spec.collection)
  if (existing) throw new Error(`Collection "${spec.collection}" already exists; update it instead of re-running setup`)
  const col = figma.variables.createVariableCollection(spec.collection)
  col.renameMode(col.modes[0].modeId, 'Default')
  const mode = col.modes[0].modeId
  const ids = {}
  for (const [k, v] of Object.entries(spec.colors)) {
    const [value, desc] = Array.isArray(v) ? v : [v, '']
    const variable = figma.variables.createVariable('color/' + k, col, 'COLOR')
    variable.setValueForMode(mode, hex(value))
    if (desc) variable.description = desc
    variable.scopes = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR']
    ids[k] = variable.id
  }
  for (const [k, value] of Object.entries(spec.radii)) {
    const variable = figma.variables.createVariable('radius/' + k, col, 'FLOAT')
    variable.setValueForMode(mode, value)
    variable.scopes = ['CORNER_RADIUS']
    ids['radius/' + k] = variable.id
  }
  const fonts = [...new Set(spec.type.map((t) => t[1] + '|' + t[2]))]
  const available = new Set((await figma.listAvailableFontsAsync()).map((f) => f.fontName.family + '|' + f.fontName.style))
  const missing = fonts.filter((f) => !available.has(f))
  if (missing.length) throw new Error('Fonts not available in this file: ' + missing.join(', '))
  await Promise.all(fonts.map((f) => { const [family, style] = f.split('|'); return figma.loadFontAsync({ family, style }) }))
  const styleIds = {}
  for (const [name, family, style, size, lh, ls, textCase] of spec.type) {
    const s = figma.createTextStyle()
    s.name = spec.stylePrefix + name
    s.fontName = { family, style }
    s.fontSize = size
    s.lineHeight = { unit: 'PIXELS', value: lh }
    s.letterSpacing = { unit: 'PERCENT', value: ls }
    s.textCase = textCase || 'ORIGINAL'
    styleIds[name] = s.id
  }
  return { collection: col.id, variables: ids, styles: styleIds, fonts }
}
