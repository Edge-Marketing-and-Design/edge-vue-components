// Core helpers for drawing an Edge site in Figma: token-bound paints, text with
// text styles, auto-layout frames, buttons, icons, image and logo placeholders,
// section backgrounds, component instances, anchor duplication.
//
// Install once per Figma file (see reference/figma-build.md, "Installing the
// library"): store this function's source in root shared plugin data under the
// project namespace, key "core". Every later use_figma call loads it with:
//
//   const cfg = JSON.parse(figma.root.getSharedPluginData('edgesite', 'config'))
//   const L = await eval('(' + figma.root.getSharedPluginData(cfg.ns, 'core') + ')')(figma, cfg)
//
// cfg (stored as JSON under 'edgesite' / 'config'):
// {
//   ns: 'edgesite',                 // plugin data namespace for this file
//   tokens: 'ACME Tokens',           // variable collection created by setup.js
//   stylePrefix: 'ACME/',            // text style prefix created by setup.js
//   componentsPage: '12:34',         // page holding icon/ph/item components (components.js sets it)
//   desktopWidth: 1171, mobileWidth: 390, padX: 24, mobilePadX: 20,
//   darkTexture: '7:3',              // optional: node cloned behind dark sections (e.g. a topo pattern)
//   lightPaintsFrom: '5:1462',       // optional: node whose non-solid fills are layered on light sections
//   heroOverlayFrom: ['5:833'],      // optional: nodes whose fills become the photo-hero overlay
// }
async function edgeFigmaCore(figma, cfg) {
  if (!cfg) cfg = JSON.parse(figma.root.getSharedPluginData('edgesite', 'config'))
  const L = { cfg }
  // Hidden layers inside instances are skipped by find* unless this is false.
  figma.skipInvisibleInstanceChildren = false
  const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === cfg.tokens)
  if (!col) throw new Error('Token collection not found: ' + cfg.tokens + ' (run setup.js first)')
  const mode = col.modes[0].modeId
  const vars = {}
  for (const v of await Promise.all(col.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)))) vars[v.name.replace(/^color\//, '')] = v
  L.vars = vars
  const styles = {}
  for (const s of await figma.getLocalTextStylesAsync()) if (s.name.startsWith(cfg.stylePrefix)) styles[s.name.slice(cfg.stylePrefix.length)] = s
  L.styles = styles
  const fonts = [...new Set(Object.values(styles).map((s) => s.fontName.family + '|' + s.fontName.style)), 'Inter|Regular']
  await Promise.all(fonts.map((f) => { const [family, style] = f.split('|'); return figma.loadFontAsync({ family, style }) }))
  L.boldFont = styles['Body Bold'] ? styles['Body Bold'].fontName : null
  if (L.boldFont) await figma.loadFontAsync(L.boldFont)

  // ---- paints -------------------------------------------------------------
  // Opaque paints are bound to the token. Translucent paints are plain colors:
  // Figma drops the opacity of variable-bound paints inside component
  // instances (and on a node's first assignment), so a bound 12% tint renders
  // solid. See reference/figma-gotchas.md.
  L.cs = (x) => (Array.isArray(x) ? x : [x, 1])
  L.val = (name) => { const v = vars[name]; if (!v) throw new Error('No token ' + name); return v.valuesByMode[mode] }
  L.P = (name) => { const c = L.val(name); return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: 1 }, 'color', vars[name]) }
  L.raw = (name, op) => { const c = L.val(name); return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: op } }
  L.paint = (n, prop, list) => { n[prop] = list.map((x) => ((x[1] ?? 1) < 1 ? L.raw(x[0], x[1]) : L.P(x[0]))); return n }
  L.fill = (n, name, op = 1) => L.paint(n, 'fills', [[name, op]])
  L.stroke = (n, name, op = 1, w = 1, dash) => { L.paint(n, 'strokes', [[name, op]]); n.strokeWeight = w; n.strokeAlign = 'INSIDE'; if (dash) n.dashPattern = [6, 4]; return n }
  L.rad = (n, key) => {
    if (typeof key === 'number') { n.cornerRadius = key; return n }
    const v = vars['radius/' + key]
    for (const f of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) n.setBoundVariable(f, v)
    return n
  }
  const pc = L.val('primary'); const ac = L.val('accent')
  L.shadow = (n, kind = 'card') => {
    const k = { card: [{ r: pc.r, g: pc.g, b: pc.b, a: 0.06 }, 2, 8], raised: [{ r: pc.r, g: pc.g, b: pc.b, a: 0.12 }, 12, 32], btn: [{ r: ac.r, g: ac.g, b: ac.b, a: 0.3 }, 6, 16] }[kind]
    n.effects = [{ type: 'DROP_SHADOW', color: k[0], offset: { x: 0, y: k[1] }, radius: k[2], spread: 0, visible: true, blendMode: 'NORMAL' }]
    return n
  }

  // ---- frames and text ----------------------------------------------------
  const isAL = (p) => p && p.layoutMode && p.layoutMode !== 'NONE'
  L.isAL = isAL
  L.AL = (parent, dir = 'VERTICAL', o = {}) => {
    const f = figma.createAutoLayout(dir)
    f.fills = []
    f.name = o.name || (dir === 'VERTICAL' ? 'Stack' : 'Row')
    if (parent) parent.appendChild(f)
    f.itemSpacing = o.gap ?? 0
    if (o.p != null) {
      const p = Array.isArray(o.p) ? o.p : [o.p, o.p, o.p, o.p]
      const q = p.length === 2 ? [p[0], p[1], p[0], p[1]] : p
      f.paddingTop = q[0]; f.paddingRight = q[1]; f.paddingBottom = q[2]; f.paddingLeft = q[3]
    }
    if (o.w != null) { f.resize(o.w, Math.max(f.height, 1)); f.layoutSizingHorizontal = 'FIXED' }
    if (o.h != null) { f.resize(f.width, o.h); f.layoutSizingVertical = 'FIXED' }
    if (o.fillW && isAL(parent)) f.layoutSizingHorizontal = 'FILL'
    if (o.fillH && isAL(parent)) f.layoutSizingVertical = 'FILL'
    if (o.main) f.primaryAxisAlignItems = o.main
    if (o.cross) f.counterAxisAlignItems = o.cross
    if (o.wrap) { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = o.wrapGap ?? o.gap ?? 0 }
    if (o.bg) { const [n, op] = L.cs(o.bg); L.fill(f, n, op) }
    if (o.r != null) L.rad(f, o.r)
    if (o.stroke) { const [n, op, w, d] = o.stroke; L.stroke(f, n, op ?? 1, w ?? 1, d) }
    if (o.fx) L.shadow(f, o.fx)
    f.clipsContent = !!o.clip
    return f
  }
  L.T = async (parent, chars, style, color, o = {}) => {
    if (!styles[style]) throw new Error('No text style ' + cfg.stylePrefix + style)
    const t = figma.createText()
    if (parent) parent.appendChild(t)
    await t.setTextStyleIdAsync(styles[style].id)
    t.characters = chars
    const [cn, cop] = L.cs(color)
    L.paint(t, 'fills', [[cn, cop]])
    t.name = o.name || chars.slice(0, 48)
    if (o.align) t.textAlignHorizontal = o.align
    if (o.w) { t.textAutoResize = 'HEIGHT'; t.resize(o.w, Math.max(t.height, 1)) }
    if (o.fill && isAL(parent)) { t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL' }
    return t
  }
  L.setText = async (n, chars) => {
    const segs = n.characters.length ? n.getStyledTextSegments(['fontName']) : []
    await Promise.all(segs.map((s) => figma.loadFontAsync(s.fontName)))
    n.characters = chars
    return n
  }
  // Missing content is a visible, muted, findable layer: "TBD — <what>".
  L.tbd = async (parent, text, o = {}) => L.T(parent, '[TBD: ' + text + ']', o.style || 'Body Card', o.dark ? ['surfaceAlt', 0.65] : 'textMuted', { name: 'TBD — ' + text, fill: o.fill !== false, align: o.align })
  L.accentLine = (t, lines, idx) => {
    if (idx == null || idx < 0 || idx >= lines.length) return
    let s = 0
    for (let k = 0; k < idx; k++) s += lines[k].length + 1
    t.setRangeFills(s, s + lines[idx].length, [L.P('accent')])
  }
  L.lead = (t, phrase, color = 'tertiary') => {
    const i = t.characters.indexOf(phrase)
    if (i < 0) return
    if (L.boldFont) t.setRangeFontName(i, i + phrase.length, L.boldFont)
    t.setRangeFills(i, i + phrase.length, [L.P(color)])
  }

  // ---- components ---------------------------------------------------------
  L.save = (k, v) => figma.root.setSharedPluginData(cfg.ns, k, JSON.stringify(v))
  L.load = (k) => { const s = figma.root.getSharedPluginData(cfg.ns, k); return s ? JSON.parse(s) : null }
  L.C = {}
  const reg = L.load('comps')
  if (reg && cfg.componentsPage) {
    const pg = await figma.getNodeByIdAsync(cfg.componentsPage)
    await pg.loadAsync()
    const ns = await Promise.all(Object.values(reg).map((id) => figma.getNodeByIdAsync(id)))
    Object.keys(reg).forEach((k, i) => { if (ns[i]) L.C[k] = ns[i] })
  }
  // A layer that belongs to this instance, not to an instance nested in it
  // (a card's "label" text must not match its photo placeholder's "label").
  L.own = (i, k, type = 'TEXT') => i.findAll((n) => (type == null || n.type === type) && n.name === k).find((n) => {
    let p = n.parent
    while (p && p.id !== i.id) { if (p.type === 'INSTANCE') return false; p = p.parent }
    return true
  })
  L.recolor = (n, color, op = 1) => {
    const vs = n.type === 'VECTOR' ? [n] : n.findAll((x) => ['VECTOR', 'ELLIPSE', 'RECTANGLE', 'POLYGON', 'LINE'].includes(x.type))
    for (const v of vs) if (v.strokes.length) L.paint(v, 'strokes', [[color, op]])
    return n
  }
  L.ico = (parent, name, size = 24, color = 'secondary', op = 1) => {
    const c = L.C['icon/' + name]
    if (!c) throw new Error('No icon ' + name)
    const i = c.createInstance()
    if (parent) parent.appendChild(i)
    i.name = 'icon'
    if (size !== 24) i.resize(size, size)
    L.recolor(i, color, op)
    return i
  }
  L.badge = (parent, name, size = 48, bg = ['secondary', 0.12], color = 'secondary', op = 1) => {
    const b = L.AL(parent, 'HORIZONTAL', { name: 'Icon badge', w: size, h: size, main: 'CENTER', cross: 'CENTER', bg, r: 'pill' })
    L.ico(b, name, Math.round(size / 2), color, op)
    return b
  }
  L.swapIcon = (inst, iconName, layer = 'icon', color) => {
    const ic = inst.findOne((n) => n.type === 'INSTANCE' && n.name === layer)
    if (!ic) return
    const v = ic.findOne((x) => x.type === 'VECTOR' && x.strokes.length)
    const keep = v ? v.strokes : null
    ic.swapComponent(L.C['icon/' + iconName])
    if (color) { const [c, op] = L.cs(color); L.recolor(ic, c, op) } else if (keep) for (const x of ic.findAll((x) => x.type === 'VECTOR' && x.strokes.length)) x.strokes = keep
  }
  L.I = (name, parent, texts = {}, o = {}) => {
    const c = L.C[name]
    if (!c) throw new Error('No component ' + name)
    const i = c.createInstance()
    if (parent) parent.appendChild(i)
    if (o.name) i.name = o.name
    for (const [k, v] of Object.entries(texts)) {
      const t = L.own(i, k)
      if (!t) throw new Error(name + ' has no text layer ' + k)
      if (v === null) t.visible = false
      else t.characters = v
    }
    for (const h of o.hide || []) { const n = L.own(i, h, null); if (n) n.visible = false }
    for (const s of o.show || []) { const n = L.own(i, s, null); if (n) n.visible = true }
    if (o.icon) L.swapIcon(i, o.icon, 'icon', o.iconColor)
    if (o.fillW && isAL(parent)) i.layoutSizingHorizontal = 'FILL'
    if (o.fillH && isAL(parent)) i.layoutSizingVertical = 'FILL'
    if (o.w) i.resize(o.w, i.height)
    return i
  }
  L.photo = (parent, shot, desc, w, h, dark = false, o = {}) => {
    const i = L.I(dark ? 'ph/photo-dark' : 'ph/photo', parent, { label: 'Photo coming · ' + shot })
    i.name = 'Image (' + shot + ': ' + desc + ')'
    i.resize(w, h)
    if (o.fillW && isAL(parent)) i.layoutSizingHorizontal = 'FILL'
    if (o.fillH && isAL(parent)) i.layoutSizingVertical = 'FILL'
    if (o.r != null) i.cornerRadius = o.r
    return i
  }
  L.logo = (parent, owner, w, h, dark = false, o = {}) => {
    const i = L.I(dark ? 'ph/logo-dark' : 'ph/logo', parent, { label: o.label || owner })
    i.name = 'Logo (' + owner + ')'
    i.resize(w, h)
    if (o.fillW && isAL(parent)) i.layoutSizingHorizontal = 'FILL'
    return i
  }
  L.nameImg = (inst, layer, shot, desc) => {
    const n = L.own(inst, layer, null)
    if (!n) throw new Error('No image layer ' + layer)
    n.name = 'Image (' + shot + ': ' + desc + ')'
    const l = n.findOne((x) => x.type === 'TEXT' && x.name === 'label')
    if (l) l.characters = 'Photo coming · ' + shot
    return n
  }
  L.nameLogo = (inst, layer, owner) => {
    const n = L.own(inst, layer, null)
    n.name = 'Logo (' + owner + ')'
    const l = n.findOne((x) => x.type === 'TEXT' && x.name === 'label')
    if (l) l.characters = owner
    return n
  }
  // Restore translucent paints an instance lost: copy opacity from the main
  // component wherever the color matches. Run in a SEPARATE use_figma call
  // after a build call; fixes made in the creating call do not stick.
  L.syncTranslucent = (root) => {
    const near = (a, b) => Math.abs(a.r - b.r) < 0.02 && Math.abs(a.g - b.g) < 0.02 && Math.abs(a.b - b.b) < 0.02
    let fixed = 0
    const sync = (m, i) => {
      for (const prop of ['fills', 'strokes']) {
        if (!(prop in m) || !Array.isArray(m[prop]) || !Array.isArray(i[prop]) || m[prop].length !== i[prop].length) continue
        let ch = false
        const nw = i[prop].map((p, k) => {
          const q = m[prop][k]
          if (q.type === 'SOLID' && p.type === 'SOLID' && (q.opacity ?? 1) < 0.999 && Math.abs((p.opacity ?? 1) - (q.opacity ?? 1)) > 0.01 && near(p.color, q.color)) { ch = true; return { type: 'SOLID', color: q.color, opacity: q.opacity, visible: q.visible !== false, blendMode: q.blendMode || 'NORMAL' } }
          return p
        })
        if (ch) { i[prop] = nw; fixed++ }
      }
      if ('children' in m && 'children' in i && (m.type !== 'INSTANCE' || (m.mainComponent && i.mainComponent && m.mainComponent.id === i.mainComponent.id))) m.children.forEach((c, k) => { if (i.children[k]) sync(c, i.children[k]) })
    }
    for (const inst of root.findAllWithCriteria({ types: ['INSTANCE'] })) if (inst.mainComponent) sync(inst.mainComponent, inst)
    return fixed
  }

  // ---- buttons and links --------------------------------------------------
  L.btn = async (parent, label, kind = 'primary', o = {}) => {
    const lg = o.size !== 'sm'
    const b = L.AL(parent, 'HORIZONTAL', { name: 'Button / ' + label, p: lg ? [16, 32, 16, 32] : [12, 24, 12, 24], gap: 10, cross: 'CENTER', main: 'CENTER', r: 'button' })
    const map = { primary: ['accent', 'onPrimary'], secondary: ['secondary', 'onPrimary'], dark: ['primary', 'onPrimary'], white: ['surface', 'accent'], outline: [null, 'surfaceAlt'], outlineLight: [null, 'primary'] }
    const [bg, fg] = map[kind] || map.primary
    if (bg) L.fill(b, bg)
    if (kind === 'outline') L.stroke(b, 'surfaceAlt', 0.4, 2)
    if (kind === 'outlineLight') L.stroke(b, 'primary', 0.25, 2)
    if (kind === 'primary') L.shadow(b, 'btn')
    await L.T(b, label, lg ? 'Button Large' : 'Button', fg, { name: 'label' })
    if (o.arrow) L.ico(b, o.arrow === true ? 'arrow-right' : o.arrow, 18, fg)
    if (o.fillW && isAL(parent)) b.layoutSizingHorizontal = 'FILL'
    return b
  }
  L.link = async (parent, label, color = 'secondary', icon = 'arrow-right') => {
    const r = L.AL(parent, 'HORIZONTAL', { name: 'Link / ' + label, gap: 8, cross: 'CENTER' })
    await L.T(r, label, 'Button', color, { name: 'linkLabel' })
    if (icon) L.ico(r, icon, 18, color)
    return r
  }
  L.input = async (parent, placeholder, o = {}) => {
    const f = L.AL(parent, 'HORIZONTAL', { name: 'Input / ' + (placeholder || 'field'), p: [0, 20, 0, 20], h: o.h || 56, cross: o.top ? 'MIN' : 'CENTER', bg: 'surface', stroke: ['border', 1, 1], r: 'button', fillW: o.fillW !== false })
    if (o.top) f.paddingTop = 16
    await L.T(f, placeholder, 'Body', 'textMuted', { name: 'placeholder' })
    return f
  }

  // ---- sections and backgrounds -------------------------------------------
  // Backgrounds: 'dark' (primary + optional texture), 'light' (canvas + optional
  // anchor paints), 'tint' (canvas + surfaceAlt 25%), 'accent', 'none'.
  const BG = { pine: 'dark', canvas: 'light', sand: 'tint', orange: 'accent' }
  L.lightPaints = []
  if (cfg.lightPaintsFrom) { const n = await figma.getNodeByIdAsync(cfg.lightPaintsFrom); if (n) L.lightPaints = n.fills.filter((p) => p.type !== 'SOLID').map((p) => JSON.parse(JSON.stringify(p))) }
  L.textureSrc = cfg.darkTexture ? await figma.getNodeByIdAsync(cfg.darkTexture) : null
  L.heroOverlays = []
  for (const id of cfg.heroOverlayFrom || []) { const n = await figma.getNodeByIdAsync(id); if (n) L.heroOverlays.push(n.fills.map((p) => JSON.parse(JSON.stringify(p)))) }
  if (!L.heroOverlays.length) {
    L.heroOverlays.push([{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: pc.r, g: pc.g, b: pc.b, a: 0.95 } }, { position: 0.6, color: { r: pc.r, g: pc.g, b: pc.b, a: 0.6 } }, { position: 1, color: { r: pc.r, g: pc.g, b: pc.b, a: 0.3 } }], visible: true, opacity: 1, blendMode: 'NORMAL' }])
  }
  L.abs = (s, node, name) => {
    s.appendChild(node)
    node.layoutPositioning = 'ABSOLUTE'
    node.x = 0; node.y = 0
    node.resize(s.width, s.height)
    node.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
    if (name) node.name = name
    return node
  }
  L.fitAbs = (s) => { for (const c of s.children) if (c.layoutPositioning === 'ABSOLUTE' && c.constraints && c.constraints.horizontal === 'STRETCH') { c.x = 0; c.y = 0; c.resize(s.width, s.height) } }
  L.texture = (s) => {
    if (!L.textureSrc) return null
    const r = L.textureSrc.clone()
    s.insertChild(0, r)
    r.name = 'Background Texture'
    r.layoutPositioning = 'ABSOLUTE'
    r.x = 0; r.y = 0
    r.resize(s.width, Math.max(s.height, 1))
    r.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
    return r
  }
  L.section = (parent, name, bg, o = {}) => {
    bg = BG[bg] || bg
    const mob = !!o.mobile
    const W = o.width || (mob ? cfg.mobileWidth || 390 : cfg.desktopWidth || 1171)
    const padX = o.padX ?? (mob ? cfg.mobilePadX ?? 20 : cfg.padX ?? 24)
    const pad = o.pad ?? (mob ? 56 : 80)
    const s = figma.createAutoLayout('VERTICAL')
    s.name = name || 'Section'
    if (parent) parent.appendChild(s)
    s.resize(W, 100)
    s.layoutSizingHorizontal = 'FIXED'
    s.layoutSizingVertical = 'HUG'
    s.paddingTop = o.pt ?? pad; s.paddingBottom = o.pb ?? pad
    s.paddingLeft = s.paddingRight = padX
    s.itemSpacing = o.gap ?? 0
    s.counterAxisAlignItems = o.cross || 'CENTER'
    s.clipsContent = true
    if (bg === 'dark') { L.fill(s, 'primary'); L.texture(s) }
    else if (bg === 'light') { L.fill(s, 'canvas'); s.fills = [...s.fills, ...L.lightPaints] }
    else if (bg === 'tint') L.paint(s, 'fills', [['canvas', 1], ['surfaceAlt', 0.25]])
    else if (bg === 'accent') L.fill(s, 'accent')
    else s.fills = []
    return s
  }
  L.header = async (parent, o) => {
    const c = o.align !== 'LEFT'
    const dark = o.dark
    const al = c ? 'CENTER' : 'LEFT'
    const h = L.AL(parent, 'VERTICAL', { name: 'Section header', gap: 8, fillW: !o.w, w: o.w, cross: c ? 'CENTER' : 'MIN' })
    if (o.eyebrow) await L.T(h, o.eyebrow, 'Eyebrow', dark ? 'tertiary' : 'secondary', { name: 'eyebrow', align: al })
    if (o.h2) await L.T(h, o.h2, o.h2Style || (o.mobile ? 'H2 Mobile' : 'H2 Section'), dark ? 'onPrimary' : 'heading', { name: 'heading', fill: true, align: al })
    if (o.sub) { const w = L.AL(h, 'VERTICAL', { name: 'Sub-heading', p: [8, 0, 0, 0], cross: c ? 'CENTER' : 'MIN' }); await L.T(w, o.sub, 'Label Large', dark ? 'tertiary' : 'accent', { name: 'subheading', align: al }) }
    if (o.intro) { const w = L.AL(h, 'VERTICAL', { name: 'Intro', p: [12, 0, 0, 0], fillW: true, cross: c ? 'CENTER' : 'MIN' }); await L.T(w, o.intro, 'Body', dark ? ['surfaceAlt', 0.8] : 'text', { name: 'intro', align: al, w: o.introW || (o.mobile ? 350 : 640) }) }
    return h
  }
  L.page = (name, x, y, w) => {
    const f = figma.createAutoLayout('VERTICAL')
    f.name = name
    f.resize(w || cfg.desktopWidth || 1171, 100)
    f.layoutSizingHorizontal = 'FIXED'
    f.layoutSizingVertical = 'HUG'
    L.fill(f, 'canvas')
    f.x = x; f.y = y
    f.clipsContent = true
    return f
  }
  L.rightmost = () => { let m = 0; for (const c of figma.currentPage.children) m = Math.max(m, c.x + c.width); return m }

  // ---- duplicating anchor sections ------------------------------------------
  // clone() lands on the current page, never inside the anchor frame. map(id)
  // finds the clone's counterpart of an anchor node by index path, so map every
  // node you need BEFORE inserting or removing children (paths shift).
  L.path = (root, node) => { const p = []; let n = node; while (n && n.id !== root.id) { const par = n.parent; p.unshift(par.children.indexOf(n)); n = par } return p }
  L.at = (root, path) => path.reduce((n, i) => n.children[i], root)
  L.dup = async (origId, parent) => {
    const o = await figma.getNodeByIdAsync(origId)
    const c = o.clone()
    if (parent) parent.appendChild(c)
    return { node: c, orig: o, map: async (id) => L.at(c, L.path(o, await figma.getNodeByIdAsync(id))) }
  }
  // Anchor buttons are often fixed-size frames; make them hug longer labels.
  L.hugBtn = (f, px = 32, py = 16) => {
    if (f.layoutMode === 'NONE') f.layoutMode = 'HORIZONTAL'
    f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO'
    f.paddingLeft = f.paddingRight = px; f.paddingTop = f.paddingBottom = py
    f.primaryAxisAlignItems = 'CENTER'; f.counterAxisAlignItems = 'CENTER'
    const t = f.findOne((n) => n.type === 'TEXT')
    if (t) t.textAutoResize = 'WIDTH_AND_HEIGHT'
    return f
  }
  // Make a duplicated list section hug its content (after removing items or
  // adding answers). Do NOT use on charts or anything aligned to a fixed height.
  L.hugAll = (root) => {
    for (const f of [root, ...root.findAll((n) => n.type === 'FRAME' && n.layoutMode && n.layoutMode !== 'NONE' && n.layoutMode !== 'GRID')]) {
      if (f.layoutMode === 'VERTICAL') f.primaryAxisSizingMode = 'AUTO'
      else if (f.layoutMode === 'HORIZONTAL') f.counterAxisSizingMode = 'AUTO'
    }
  }
  return L
}
