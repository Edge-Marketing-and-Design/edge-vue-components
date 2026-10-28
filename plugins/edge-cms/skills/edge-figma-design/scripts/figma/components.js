// Builds the component kit on the current page (the "Site — New Blocks" page):
// line icons, image and logo placeholders, and the repeatable item components
// that become CMS array items. Every card, row, tier, prize or tile on every
// page is an instance of one of these, which is what keeps pages consistent.
//
// Run after setup.js and after the core is installed, with the blocks page
// as the current page:
//
//   const build = <this function>;
//   return await build(figma, L, { x: 0, y: 0 });
//
// It saves the registry (name -> node id) under the 'comps' key and the page id
// into the config, so later calls get the components as L.C['item/...'].
// To add a component later, call mkItem from a small script using the same
// pattern, then L.save('comps', ...) with the new id.
async function buildComponents(figma, L, o = {}) {
  const page = figma.currentPage
  const cfg = L.cfg
  cfg.componentsPage = page.id
  figma.root.setSharedPluginData('edgesite', 'config', JSON.stringify(cfg))
  const comps = L.load('comps') || {}
  const x0 = o.x ?? 0
  const y0 = o.y ?? 0

  // ---- icons (Lucide paths, 24px, 2px stroke) ------------------------------
  const ICONS = {
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    beer: '<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>',
    crosshair: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>',
    fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
    backpack: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8M8 18h8M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    tent: '<path d="M3.5 21 14 3M20.5 21 10 3M15.5 21 12 15l-3.5 6M2 21h20"/>',
    footprints: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4M4 13h4"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    graduation: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    'file-pdf': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'arrow-up-right': '<path d="M7 7h10v10M7 17 17 7"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    'trending-up': '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
    'id-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M16 10h2M16 14h2M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 11 5 12 8c1-3 2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  }
  const iconHolder = figma.createAutoLayout('HORIZONTAL', { name: 'Kit / Icons' })
  iconHolder.layoutWrap = 'WRAP'
  iconHolder.itemSpacing = iconHolder.counterAxisSpacing = 24
  iconHolder.resize(640, 100)
  iconHolder.layoutSizingHorizontal = 'FIXED'
  iconHolder.paddingTop = iconHolder.paddingBottom = iconHolder.paddingLeft = iconHolder.paddingRight = 32
  L.fill(iconHolder, 'surface')
  iconHolder.x = x0; iconHolder.y = y0 - 1200
  for (const [k, body] of Object.entries(ICONS)) {
    if (comps['icon/' + k]) continue
    const f = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>')
    iconHolder.appendChild(f)
    const c = figma.createComponentFromNode(f)
    c.name = 'icon/' + k
    c.fills = []
    c.clipsContent = false
    for (const ch of c.children) ch.constraints = { horizontal: 'SCALE', vertical: 'SCALE' }
    L.recolor(c, 'secondary', 1)
    c.description = 'Lucide-style line icon, 2px stroke, colored with tokens.'
    comps[c.name] = c.id
    L.C[c.name] = c
  }

  // ---- placeholders ---------------------------------------------------------
  const ph = figma.createAutoLayout('HORIZONTAL', { name: 'Kit / Placeholders' })
  ph.itemSpacing = 32
  ph.paddingTop = ph.paddingBottom = ph.paddingLeft = ph.paddingRight = 32
  L.fill(ph, 'primary')
  ph.x = x0; ph.y = y0 - 500
  const mkPh = async (name, dark, logo) => {
    const f = L.AL(ph, 'VERTICAL', { name, gap: 8, main: 'CENTER', cross: 'CENTER', w: logo ? 192 : 320, h: logo ? 128 : 200, clip: true })
    if (logo) { if (dark) { L.fill(f, 'onPrimary', 0.05); L.stroke(f, 'onPrimary', 0.3, 2, true) } else { L.fill(f, 'textMuted', 0.04); L.stroke(f, 'textMuted', 0.4, 2, true) } L.rad(f, 'tile') }
    else if (dark) { L.fill(f, 'onPrimary', 0.05); L.stroke(f, 'onPrimary', 0.1, 1); L.rad(f, 'tile') }
    else { L.fill(f, 'surfaceAlt', 1); L.rad(f, 'card') }
    const col = dark ? 'onPrimary' : 'textMuted'
    const op = dark ? (logo ? 0.5 : 0.3) : 0.7
    L.ico(f, 'image', 32, col, op)
    await L.T(f, logo ? 'Logo' : 'Photo coming', 'Label', [col, op], { name: 'label', align: 'CENTER' })
    const c = figma.createComponentFromNode(f)
    c.name = name
    c.description = logo ? 'Logo placeholder (dashed). Instance name: Logo (<owner>).' : 'Image placeholder ("Photo coming"). Instance name: Image (<shot id>: <description>).'
    comps[name] = c.id
    L.C[name] = c
  }
  await mkPh('ph/photo', false, false)
  await mkPh('ph/photo-dark', true, false)
  await mkPh('ph/logo', false, true)
  await mkPh('ph/logo-dark', true, true)

  // ---- item components ------------------------------------------------------
  const H = figma.createAutoLayout('HORIZONTAL', { name: 'Kit / Item components' })
  H.layoutWrap = 'WRAP'
  H.itemSpacing = 32
  H.counterAxisSpacing = 40
  H.resize(1560, 100)
  H.layoutSizingHorizontal = 'FIXED'
  H.paddingTop = H.paddingBottom = H.paddingLeft = H.paddingRight = 40
  L.fill(H, 'canvas')
  H.x = x0; H.y = y0
  const mk = async (name, dir, opts, build, desc) => {
    const f = L.AL(H, dir, opts)
    f.name = name
    await build(f)
    const c = figma.createComponentFromNode(f)
    c.name = name
    if (desc) c.description = desc
    comps[name] = c.id
    L.C[name] = c
    return c
  }
  const card = (extra = {}) => Object.assign({ bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card' }, extra)
  await mk('item/feature-card', 'VERTICAL', card({ w: 360, p: 32, gap: 16 }), async (f) => {
    L.badge(f, 'store', 52, ['secondary', 0.12], 'secondary')
    await L.T(f, 'Card title', 'H3 Small', 'heading', { name: 'title', fill: true })
    await L.T(f, 'Card body copy.', 'Body Card', 'text', { name: 'body', fill: true })
  }, 'Feature grid item (default): icon, title, body.')
  await mk('item/attraction-card', 'VERTICAL', card({ w: 360, clip: true }), async (f) => {
    L.photo(f, 'X-xx', 'photo', 360, 240, false, { fillW: true, r: 0 }).name = 'image'
    const c = L.AL(f, 'VERTICAL', { name: 'Content', p: [24, 28, 28, 28], gap: 8, fillW: true })
    const b = L.AL(c, 'HORIZONTAL', { name: 'Badge', p: [6, 14, 6, 14], bg: 'accent', r: 'pill' })
    await L.T(b, 'Badge', 'Label', 'onPrimary', { name: 'badge' })
    b.visible = false
    await L.T(c, 'Title', 'H3 Small', 'heading', { name: 'title', fill: true })
    await L.T(c, 'Body copy.', 'Body Card', 'text', { name: 'body', fill: true })
  }, 'Feature grid item (photo cards): photo top, optional badge, title, body.')
  await mk('item/attraction-featured', 'HORIZONTAL', card({ w: 740, clip: true }), async (f) => {
    L.photo(f, 'X-xx', 'photo', 360, 300, false, { fillH: true, r: 0 }).name = 'image'
    const c = L.AL(f, 'VERTICAL', { name: 'Content', p: [36, 36, 36, 36], gap: 12, fillW: true, main: 'CENTER' })
    c.layoutSizingVertical = 'FILL'
    const b = L.AL(c, 'HORIZONTAL', { name: 'Badge', p: [6, 14, 6, 14], bg: 'accent', r: 'pill' })
    await L.T(b, 'Badge', 'Label', 'onPrimary', { name: 'badge' })
    await L.T(c, 'Featured title', 'H3 Small', 'heading', { name: 'title', fill: true })
    await L.T(c, 'Body copy.', 'Body Card', 'text', { name: 'body', fill: true })
  }, 'Feature grid item (photo cards, featured=yes): wide card with badge.')
  await mk('item/numbered-row', 'HORIZONTAL', { w: 540, gap: 24, p: [28, 0, 28, 0] }, async (f) => {
    L.stroke(f, 'onPrimary', 0.12, 1)
    f.strokeTopWeight = 1; f.strokeBottomWeight = 0; f.strokeLeftWeight = 0; f.strokeRightWeight = 0
    await L.T(f, '01', 'Display Number', 'tertiary', { name: 'number' })
    await L.T(f, 'Reason copy.', 'Body', ['surfaceAlt', 0.9], { name: 'body', fill: true })
  }, 'Feature grid item (numbered): numeral + copy, for dark sections.')
  await mk('item/compact-tile', 'HORIZONTAL', card({ w: 540, p: 20, gap: 16, fx: null, r: 'tile' }), async (f) => {
    L.badge(f, 'crosshair', 44, ['secondary', 0.12], 'secondary')
    const c = L.AL(f, 'VERTICAL', { name: 'Text', gap: 4, fillW: true })
    await L.T(c, 'Category', 'Body Bold', 'heading', { name: 'title', fill: true })
    await L.T(c, 'One-line list.', 'Small', 'text', { name: 'body', fill: true })
  }, 'Feature grid item (compact): icon, bold category, one line.')
  await mk('item/stat-card', 'VERTICAL', card({ w: 270, p: 28, gap: 10 }), async (f) => {
    await L.T(f, '0', 'Display Number', 'secondary', { name: 'stat' })
    const b = L.badge(f, 'heart', 52, ['accent', 0.12], 'accent')
    b.name = 'statIcon'
    b.visible = false
    await L.T(f, 'Lead:', 'Body Bold', 'heading', { name: 'lead', fill: true })
    await L.T(f, 'Body copy.', 'Body Card', 'text', { name: 'body', fill: true })
  }, 'Feature grid item (stat): big number (or icon), bold lead, copy.')
  await mk('item/stat-tile', 'VERTICAL', { w: 257, p: 24, gap: 4, bg: 'surface', r: 'card', stroke: ['border', 1, 1] }, async (f) => {
    await L.T(f, '0', 'Display Number', 'secondary', { name: 'value' })
    await L.T(f, 'Label', 'Label Large', 'heading', { name: 'label', fill: true })
  }, 'Stat card: number over label.')
  await mk('item/pathway-card', 'VERTICAL', card({ w: 360, clip: true, fx: 'raised', stroke: null }), async (f) => {
    L.photo(f, 'X-xx', 'photo', 360, 220, false, { fillW: true, r: 0 }).name = 'image'
    const c = L.AL(f, 'VERTICAL', { name: 'Content', p: [28, 28, 32, 28], gap: 12, fillW: true })
    await L.T(c, 'Audience', 'H3 Small', 'heading', { name: 'label', fill: true })
    await L.T(c, 'Copy.', 'Body Card', 'text', { name: 'text', fill: true })
    const r = L.AL(c, 'HORIZONTAL', { name: 'Link', gap: 8, cross: 'CENTER', p: [8, 0, 0, 0] })
    await L.T(r, 'Learn more', 'Button', 'accent', { name: 'link' })
    L.ico(r, 'arrow-right', 18, 'accent')
  }, 'Pathways item (tall): photo strip, audience label, copy, arrow link.')
  await mk('item/pathway-compact', 'HORIZONTAL', card({ w: 360, p: 24, gap: 16, cross: 'CENTER' }), async (f) => {
    const c = L.AL(f, 'VERTICAL', { name: 'Text', gap: 4, fillW: true })
    await L.T(c, 'Audience', 'Card Title', 'heading', { name: 'label', fill: true })
    await L.T(c, 'Copy.', 'Small', 'text', { name: 'text', fill: true })
    L.badge(f, 'arrow-right', 40, 'accent', 'onPrimary')
  }, 'Pathways item (compact): link card with arrow.')
  await mk('item/fact', 'HORIZONTAL', { w: 340, gap: 16, cross: 'CENTER' }, async (f) => {
    L.badge(f, 'calendar', 56, ['accent', 0.12], 'accent')
    const c = L.AL(f, 'VERTICAL', { name: 'Text', gap: 2, fillW: true })
    await L.T(c, 'Label', 'Label', 'secondary', { name: 'label', fill: true })
    await L.T(c, 'Value', 'Card Title', 'heading', { name: 'value', fill: true })
  }, 'Event facts item: icon, label, value.')
  await mk('item/team-card', 'VERTICAL', card({ w: 360, p: 28, gap: 16 }), async (f) => {
    L.photo(f, 'X-xx', 'headshot', 304, 304, false, { fillW: true, r: 12 }).name = 'photo'
    const c = L.AL(f, 'VERTICAL', { name: 'Text', gap: 6, fillW: true })
    await L.T(c, 'Name', 'Card Title', 'heading', { name: 'name', fill: true })
    await L.T(c, 'Role', 'Label Large', 'text', { name: 'role', fill: true })
    const b = L.AL(c, 'VERTICAL', { name: 'Bio', p: [6, 0, 0, 0], fillW: true })
    await L.T(b, 'Bio.', 'Body Card', 'text', { name: 'bio', fill: true })
  }, 'Team item: photo (1:1), name, role, bio.')
  await mk('item/tier-card', 'VERTICAL', card({ w: 360, p: 36, gap: 6, r: 'panel' }), async (f) => {
    await L.T(f, 'Size', 'H3 Panel', 'heading', { name: 'size' })
    await L.T(f, 'Tier', 'Label Large', 'secondary', { name: 'name' })
    const pr = L.AL(f, 'VERTICAL', { name: 'Price', p: [18, 0, 0, 0], gap: 4, fillW: true })
    await L.T(pr, '$0', 'Display Number', 'heading', { name: 'price' })
    await L.T(pr, 'Member price', 'Body Bold', 'secondary', { name: 'member', fill: true })
    const d = L.AL(f, 'VERTICAL', { name: 'Divider wrap', p: [20, 0, 20, 0], fillW: true })
    L.AL(d, 'HORIZONTAL', { name: 'Divider', h: 1, fillW: true, bg: 'border' })
    await L.T(f, 'Note label', 'Label', 'textMuted', { name: 'revenueLabel', fill: true })
    await L.T(f, 'Note value', 'Card Title', 'heading', { name: 'revenue' })
  }, 'Pricing tier card. Featured tier = dark fill override.')
  await mk('item/prize-card', 'VERTICAL', { w: 360, p: 16, gap: 14, bg: ['onPrimary', 0.08], stroke: ['onPrimary', 0.15, 1], r: 'card' }, async (f) => {
    L.photo(f, 'X-xx', 'product', 328, 200, false, { fillW: true, r: 12 }).name = 'image'
    const t = L.AL(f, 'VERTICAL', { name: 'Text', p: [0, 8, 8, 8], fillW: true })
    await L.T(t, 'Prize', 'Body Bold', 'onPrimary', { name: 'name', fill: true })
  }, 'Product/prize item: image, name (glass card for dark sections).')
  await mk('item/logo-card', 'VERTICAL', card({ w: 270, p: 24, gap: 14, cross: 'CENTER' }), async (f) => {
    L.logo(f, 'Logo', 222, 110, false, { fillW: true }).name = 'logo'
    await L.T(f, 'Name', 'Body Bold', 'heading', { name: 'name', fill: true, align: 'CENTER' })
    await L.T(f, 'Link →', 'Label Large', 'secondary', { name: 'link' })
  }, 'Logo grid item: logo, optional name, optional link label.')
  await mk('item/exhibitor-card', 'VERTICAL', card({ w: 270, p: 20, gap: 10 }), async (f) => {
    L.logo(f, 'Logo', 230, 150, false, { fillW: true }).name = 'logo'
    await L.T(f, 'Name', 'Body Bold', 'heading', { name: 'name', fill: true })
    const pill = L.AL(f, 'HORIZONTAL', { name: 'Category', p: [4, 10, 4, 10], bg: ['secondary', 0.12], r: 'pill' })
    await L.T(pill, 'Category', 'Label', 'secondary', { name: 'category' })
    await L.T(f, 'Detail', 'Small', 'text', { name: 'booth' })
    await L.T(f, 'Website →', 'Label Large', 'secondary', { name: 'link' })
  }, 'Directory item: logo 3:2, name, category, detail, link.')
  await mk('item/topic-tile', 'VERTICAL', { w: 260, p: 24, gap: 14, cross: 'CENTER', bg: 'surface', r: 'card', stroke: ['border', 1, 2] }, async (f) => {
    const top = L.AL(f, 'HORIZONTAL', { name: 'Radio row', fillW: true, main: 'MAX' })
    const rd = L.AL(top, 'HORIZONTAL', { name: 'radio', w: 20, h: 20, r: 'pill', stroke: ['textMuted', 0.5, 2], main: 'CENTER', cross: 'CENTER' })
    L.AL(rd, 'HORIZONTAL', { name: 'radioDot', w: 10, h: 10, r: 'pill', bg: 'secondary' }).visible = false
    L.badge(f, 'ticket', 52, ['secondary', 0.12], 'secondary')
    await L.T(f, 'Topic', 'Body Bold', 'heading', { name: 'label', fill: true, align: 'CENTER' })
  }, 'Radio-style choice tile. Selected = secondary 2px border + dot.')
  await mk('item/resource-card', 'HORIZONTAL', card({ w: 540, p: 28, gap: 20, cross: 'CENTER' }), async (f) => {
    L.badge(f, 'file-pdf', 56, 'secondary', 'onPrimary')
    const c = L.AL(f, 'VERTICAL', { name: 'Text', gap: 6, fillW: true })
    await L.T(c, 'PDF', 'Label', 'textMuted', { name: 'type' })
    await L.T(c, 'Resource title', 'Card Title', 'heading', { name: 'title', fill: true })
    await L.T(c, 'Download PDF ↓', 'Label Large', 'secondary', { name: 'link' })
  }, 'Download/resource item: file-type icon, title, action link.')
  await mk('item/bullet', 'HORIZONTAL', { w: 420, gap: 12 }, async (f) => {
    const w = L.AL(f, 'VERTICAL', { name: 'Dot wrap', p: [10, 0, 0, 0] })
    L.AL(w, 'HORIZONTAL', { name: 'dot', w: 10, h: 10, r: 'pill', bg: 'accent' })
    await L.T(f, 'List item', 'Body', 'text', { name: 'text', fill: true })
  }, 'Dot bullet list item.')
  await mk('item/day-row', 'VERTICAL', { w: 300, gap: 2 }, async (f) => {
    await L.T(f, 'Day', 'Body Bold', 'heading', { name: 'day', fill: true })
    await L.T(f, 'Time', 'Body', 'text', { name: 'time', fill: true })
  }, 'Schedule row: day bold, hours.')
  await mk('item/pill', 'HORIZONTAL', { p: [10, 18, 10, 18], bg: 'tertiary', r: 'pill' }, async (f) => {
    await L.T(f, 'Badge', 'Label Large', 'onTertiary', { name: 'text' })
  }, 'Pill badge.')
  await mk('item/chip', 'HORIZONTAL', { p: [8, 16, 8, 16], bg: 'surface', r: 'pill', stroke: ['border', 1, 1] }, async (f) => {
    await L.T(f, 'Chip', 'Label Large', 'heading', { name: 'text' })
  }, 'Filter chip.')
  const yearRow = async (f, rev) => {
    const strip = async () => {
      const s = L.AL(f, 'HORIZONTAL', { name: 'Photo strip', gap: 12 })
      L.photo(s, 'X-xx', 'photo', 380, 285, false, { r: 16 }).name = 'photo1'
      const c = L.AL(s, 'VERTICAL', { name: 'Small photos', gap: 12 })
      L.photo(c, 'X-xx', 'photo', 136, 136, false, { r: 16 }).name = 'photo2'
      L.photo(c, 'X-xx', 'photo', 136, 137, false, { r: 16 }).name = 'photo3'
    }
    if (rev) await strip()
    const t = L.AL(f, 'VERTICAL', { name: 'Text', gap: 14, fillW: true })
    await L.T(t, '2025', 'Display Year', ['secondary', 0.25], { name: 'year' })
    await L.T(t, 'Title', 'H3 Panel', 'heading', { name: 'title', fill: true })
    const chip = L.AL(t, 'HORIZONTAL', { name: 'Location chip', p: [6, 14, 6, 14], gap: 6, cross: 'CENTER', r: 'pill', stroke: ['secondary', 0.5, 1] })
    L.ico(chip, 'map-pin', 14, 'secondary')
    await L.T(chip, 'Location', 'Label', 'secondary', { name: 'location' })
    const st = L.AL(t, 'HORIZONTAL', { name: 'Mini stats', gap: 32, p: [6, 0, 6, 0] })
    for (const i of [1, 2]) {
      const m = L.AL(st, 'VERTICAL', { name: 'Mini stat' })
      await L.T(m, '0', 'Display Number', 'secondary', { name: 'stat' + i + 'Value' })
      await L.T(m, 'label', 'Label', 'text', { name: 'stat' + i + 'Label' })
    }
    await L.T(t, 'Highlights', 'Body', 'text', { name: 'highlights', fill: true })
    if (!rev) await strip()
  }
  await mk('item/year-row', 'HORIZONTAL', { w: 1123, gap: 56, cross: 'CENTER' }, (f) => yearRow(f, false), 'Year/period recap row (text left, photos right).')
  await mk('item/year-row-reverse', 'HORIZONTAL', { w: 1123, gap: 56, cross: 'CENTER' }, (f) => yearRow(f, true), 'Year/period recap row, mirrored (photos left).')

  L.save('comps', comps)
  return { icons: iconHolder.id, placeholders: ph.id, items: H.id, count: Object.keys(comps).length }
}
