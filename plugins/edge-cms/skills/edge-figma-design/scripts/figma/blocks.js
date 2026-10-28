// Block builders: one function per block type, each drawing a full-width
// section from a data object. The same builder draws the block's frame on the
// "Site — New Blocks" page and every copy of it on the "Site — Pages" page, so
// a block looks identical everywhere it appears.
//
// Load after the core (key "blocks" in the project namespace):
//
//   const B = await eval('(' + figma.root.getSharedPluginData(cfg.ns, 'blocks') + ')')(figma, L)
//   const s = await B.pageHero(pageFrame, { name: 'acme-page-hero', eyebrow: '...', h: ['Line 1', 'Accent line'], accent: 1 })
//
// These builders are a starting kit drawn from the first site (Montana Outdoor
// Expo). Before building a new site, compare them with the anchor design and
// adjust spacing, sizes and treatments to match it (reference/figma-build.md).
// Data fields are documented above each builder. Text is always the approved
// copy; anything missing is passed as a TBD and drawn with L.tbd.
async function edgeFigmaBlocks(figma, L) {
  const B = {}

  // pageHero: interior hero. { name, eyebrow, h: [line1, line2, line3], accent: index of the
  // accent-colored line, body, primary, secondary, photo: [shotId, description] | null,
  // breadcrumb, mobile }. With a photo: ~520 tall, photo placeholder + overlay; without: dark + texture, ~360.
  B.pageHero = async (parent, d) => {
    const mob = !!d.mobile
    const s = L.section(parent, d.name || 'page-hero', d.photo ? 'none' : 'dark', { mobile: mob, pt: mob ? 72 : 96, pb: mob ? 72 : 96, cross: 'MIN' })
    s.primaryAxisAlignItems = 'CENTER'
    s.minHeight = d.photo ? (mob ? 560 : 520) : mob ? 320 : 360
    if (d.photo) {
      L.fill(s, 'primary')
      const ph = L.abs(s, figma.createAutoLayout('VERTICAL'), 'Image (' + d.photo[0] + ': ' + d.photo[1] + ')')
      ph.fills = []
      L.fill(ph, 'onPrimary', 0.05)
      ph.primaryAxisAlignItems = mob ? 'MAX' : 'CENTER'
      ph.counterAxisAlignItems = 'MAX'
      ph.paddingRight = mob ? 20 : 96
      ph.paddingBottom = mob ? 20 : 0
      const tag = L.AL(ph, 'VERTICAL', { name: 'Photo label', gap: 8, cross: 'CENTER' })
      L.ico(tag, 'image', 32, 'onPrimary', 0.35)
      await L.T(tag, 'Photo coming · ' + d.photo[0], 'Label', ['onPrimary', 0.35], { name: 'label' })
      L.heroOverlays.forEach((fills, k) => { const o = figma.createFrame(); o.fills = fills; L.abs(s, o, 'Overlay ' + (k + 1)) })
    }
    const c = L.AL(s, 'VERTICAL', { name: 'Content', fillW: true })
    if (d.breadcrumb) { const b = L.AL(c, 'HORIZONTAL', { name: 'Breadcrumb', p: [0, 0, 12, 0] }); await L.T(b, d.breadcrumb, 'Small', ['surfaceAlt', 0.6], { name: 'breadcrumb' }) }
    if (d.eyebrow) await L.T(c, d.eyebrow, 'Eyebrow', d.eyebrowColor || 'secondary', { name: 'eyebrow' })
    const hw = L.AL(c, 'VERTICAL', { name: 'Heading 1', p: [8, 0, 0, 0], fillW: true })
    const lines = d.h.filter((x) => x != null)
    const t = await L.T(hw, lines.join('\n'), mob ? 'H1 Mobile' : 'H1 Interior', 'onPrimary', { name: 'heading', w: mob ? 350 : 1000 })
    L.accentLine(t, lines, d.accent)
    if (d.body) { const bw = L.AL(c, 'VERTICAL', { name: 'Body', p: [20, 0, 0, 0] }); await L.T(bw, d.body, 'Body', ['surfaceAlt', 0.8], { name: 'body', w: mob ? 350 : 600 }) }
    if (d.primary || d.secondary) {
      const r = L.AL(c, 'HORIZONTAL', { name: 'Buttons', p: [32, 0, 0, 0], gap: 16, wrap: true, wrapGap: 12, fillW: mob })
      if (d.primary) await L.btn(r, d.primary, 'primary')
      if (d.secondary) await L.btn(r, d.secondary, 'outline')
    }
    L.fitAbs(s)
    return s
  }

  // featureGrid: header + cards. { name, style: default|attractions|numbered|compact|stat, bg,
  // eyebrow, h2, sub, intro (stat), align, footer, mobile, items: [...] }
  //   default:     { title, body, icon }
  //   attractions: { title, body, shot, desc, featured, badge }
  //   numbered:    { n, body, lead (bold phrase at the start of body), wide }
  //   compact:     { title, body|null, icon }
  //   stat:        { stat|null, color, icon (when no stat), lead, body }
  B.featureGrid = async (parent, d) => {
    const mob = !!d.mobile
    const st = d.style || 'default'
    const bg = d.bg || { default: 'light', attractions: 'tint', numbered: 'dark', compact: 'light', stat: 'light' }[st]
    const s = L.section(parent, d.name, bg, { mobile: mob, pad: mob ? 56 : 96 })
    const dark = bg === 'dark' || bg === 'pine'
    if (st === 'stat') {
      const h = L.AL(s, 'VERTICAL', { name: 'Section header', fillW: true, gap: 20 })
      if (d.intro) await L.T(h, d.intro, mob ? 'Body' : 'Lead', 'text', { name: 'intro', w: mob ? 350 : 720 })
      if (d.sub) await L.T(h, d.sub, 'Label Large', 'accent', { name: 'subheading' })
    } else await L.header(s, { eyebrow: d.eyebrow, h2: d.h2, sub: d.sub, dark, mobile: mob, align: d.align })
    const g = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Items', fillW: true, gap: st === 'numbered' ? 48 : st === 'compact' ? 16 : 24, wrap: !mob, wrapGap: st === 'numbered' ? 0 : st === 'compact' ? 16 : 24, main: st === 'numbered' || st === 'stat' ? 'MIN' : 'CENTER' })
    g.paddingTop = mob ? 32 : st === 'numbered' ? 40 : 56
    for (const it of d.items) {
      let inst
      const W = mob ? 350 : null
      if (st === 'default') inst = L.I('item/feature-card', g, { title: it.title, body: it.body }, { icon: it.icon, w: W || 358 })
      else if (st === 'attractions') {
        if (it.featured && !mob) inst = L.I('item/attraction-featured', g, { badge: it.badge || '', title: it.title, body: it.body }, { w: 740 })
        else {
          inst = L.I('item/attraction-card', g, { title: it.title, body: it.body }, { w: W || 358 })
          if (it.featured) { L.own(inst, 'Badge', null).visible = true; L.own(inst, 'badge').characters = it.badge || '' }
        }
        L.nameImg(inst, 'image', it.shot, it.desc)
      } else if (st === 'numbered') {
        inst = L.I('item/numbered-row', g, { number: it.n, body: it.body }, { w: W || (it.wide ? 1123 : 537) })
        if (it.lead) L.lead(L.own(inst, 'body'), it.lead)
      } else if (st === 'compact') inst = L.I('item/compact-tile', g, { title: it.title, body: it.body ?? null }, { icon: it.icon, w: W || 553 })
      else if (st === 'stat') {
        inst = L.I('item/stat-card', g, { stat: it.stat ?? null, lead: it.lead, body: it.body }, { w: W || 549, show: it.stat ? [] : ['statIcon'] })
        if (!it.stat && it.icon) L.swapIcon(inst, it.icon, 'icon', 'accent')
        if (it.color) L.fill(L.own(inst, 'stat'), it.color)
      }
      inst.name = 'Item / ' + (it.title || it.lead || it.n)
      if (mob) inst.layoutSizingHorizontal = 'FILL'
    }
    if (d.footer) { const f = L.AL(s, 'VERTICAL', { name: 'Footer line', p: [40, 0, 0, 0], fillW: true, cross: 'CENTER' }); await L.T(f, d.footer, 'Footer Line', 'heading', { name: 'footer', align: 'CENTER', fill: true }) }
    return s
  }

  // callout: statement band. { name, style: dark|accent|light-split, body (string, or string[] for
  // light-split), logo (owner), link, linkNote, button, h3 }
  B.callout = async (parent, d) => {
    const st = { pine: 'dark', orange: 'accent' }[d.style] || d.style
    if (st === 'dark') {
      const s = L.section(parent, d.name, 'dark', { pad: 80 })
      const r = L.AL(s, 'HORIZONTAL', { name: 'Row', fillW: true, gap: 56, cross: 'CENTER' })
      if (d.logo) L.logo(r, d.logo, 240, 160, true)
      const c = L.AL(r, 'VERTICAL', { name: 'Statement', gap: 24, fillW: true })
      await L.T(c, d.body, 'Statement', 'onPrimary', { name: 'body', fill: true })
      if (d.link) { const l = await L.link(c, d.link, 'tertiary'); l.name = 'Link / ' + d.link + (d.linkNote ? ' (' + d.linkNote + ')' : '') }
      return s
    }
    if (st === 'accent') {
      const s = L.section(parent, d.name, 'accent', { pad: 72 })
      const c = L.AL(s, 'VERTICAL', { name: 'Content', w: 860, gap: 32, cross: 'CENTER' })
      await L.T(c, d.body, 'Quote', 'onPrimary', { name: 'body', align: 'CENTER', fill: true })
      if (d.button) await L.btn(c, d.button, 'white')
      return s
    }
    const s = L.section(parent, d.name, 'light', { pad: 80 })
    const r = L.AL(s, 'HORIZONTAL', { name: 'Row', fillW: true, gap: 64, cross: 'CENTER' })
    const c = L.AL(r, 'VERTICAL', { name: 'Text', gap: 16, fillW: true })
    if (d.h3) await L.T(c, d.h3, 'H3 Panel', 'heading', { name: 'heading', fill: true })
    for (const p of [].concat(d.body)) await L.T(c, p, 'Body', 'text', { name: 'body', fill: true })
    if (d.button) { const bw = L.AL(c, 'HORIZONTAL', { name: 'Button wrap', p: [12, 0, 0, 0] }); await L.btn(bw, d.button, 'outlineLight', { arrow: 'arrow-up-right' }) }
    const card = L.AL(r, 'VERTICAL', { name: 'Logo card', w: 440, p: 40, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card', cross: 'CENTER' })
    if (d.logo) L.logo(card, d.logo, 360, 200, false)
    return s
  }

  // newsletter: { name, h2, body, button, bg, mobile, privacyTbd (default true) }
  B.newsletter = async (parent, d) => {
    const mob = !!d.mobile
    const s = L.section(parent, d.name || 'newsletter', d.bg || 'light', { mobile: mob, pad: mob ? 56 : 80 })
    const r = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Content', w: mob ? 350 : 896, gap: mob ? 28 : 48, cross: mob ? 'MIN' : 'CENTER' })
    const l = L.AL(r, 'VERTICAL', { name: 'Text', gap: 12, w: mob ? 350 : 420 })
    await L.T(l, d.h2, mob ? 'H3 Mobile' : 'H3 Panel', 'heading', { name: 'heading', fill: true })
    if (d.body) await L.T(l, d.body, 'Body Card', 'text', { name: 'body', fill: true })
    const f = L.AL(r, 'VERTICAL', { name: 'Form (cms-form)', gap: 12, fillW: !mob, w: mob ? 350 : undefined })
    const row = L.AL(f, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Fields', gap: 12, fillW: true, cross: mob ? 'MIN' : 'CENTER' })
    await L.input(row, d.placeholder || 'Email address')
    const b = await L.btn(row, d.button, 'primary')
    if (mob) b.layoutSizingHorizontal = 'FILL'
    if (d.privacyTbd !== false) await L.tbd(f, 'privacy line (optional)', { style: 'Small' })
    return s
  }

  // split: two-column text. { name, side: list|stats|none, bg, eyebrow, h2, body: [lead, ...paragraphs],
  // sideTitle, sideItems: [...], stats: [{ value, label, color }] }
  B.split = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'light', { pad: 96 })
    if (d.side === 'none') {
      const c = L.AL(s, 'VERTICAL', { name: 'Body', w: 720, gap: 20 })
      if (d.eyebrow) await L.T(c, d.eyebrow, 'Eyebrow', 'secondary', { name: 'eyebrow' })
      for (const [i, p] of d.body.entries()) await L.T(c, p, i === 0 ? 'Lead' : 'Body', i === 0 ? 'heading' : 'text', { name: i === 0 ? 'lead' : 'body', fill: true })
      return s
    }
    const r = L.AL(s, 'HORIZONTAL', { name: 'Row', fillW: true, gap: 56, cross: d.side === 'stats' ? 'CENTER' : 'MIN' })
    const left = L.AL(r, 'VERTICAL', { name: 'Left (7/12)', w: 620, gap: 20 })
    if (d.eyebrow) await L.T(left, d.eyebrow, 'Eyebrow', 'secondary', { name: 'eyebrow' })
    if (d.h2) await L.T(left, d.h2, 'H2 Section', 'heading', { name: 'heading', fill: true })
    for (const [i, p] of d.body.entries()) await L.T(left, p, i === 0 ? 'Lead' : 'Body', i === 0 ? 'heading' : 'text', { name: i === 0 ? 'lead' : 'body', fill: true })
    const right = L.AL(r, 'VERTICAL', { name: 'Right (5/12)', fillW: true, gap: 16 })
    if (d.side === 'list') {
      const card = L.AL(right, 'VERTICAL', { name: 'List card', fillW: true, p: 32, gap: 14, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card' })
      if (d.sideTitle) await L.T(card, d.sideTitle, 'Card Title', 'heading', { name: 'sideTitle', fill: true })
      const lst = L.AL(card, 'VERTICAL', { name: 'List', fillW: true, gap: 10, p: [6, 0, 0, 0] })
      for (const it of d.sideItems) L.I('item/bullet', lst, { text: it }, { fillW: true }).name = 'Item / ' + it
    }
    if (d.side === 'stats') for (const it of d.stats) { const t = L.I('item/stat-tile', right, { value: it.value, label: it.label }, { fillW: true }); if (it.color) L.fill(L.own(t, 'value'), it.color); t.name = 'Item / ' + it.value }
    return s
  }

  // pathways: audience routing. { name, style: tall|compact, bg, eyebrow, h2, intro,
  // items: [{ label, text, link, url, shot, desc }] }
  B.pathways = async (parent, d) => {
    const tall = d.style !== 'compact'
    const s = L.section(parent, d.name, d.bg || (tall ? 'dark' : 'light'), { pad: tall ? 96 : 80 })
    if (d.eyebrow || d.h2 || d.intro) {
      const h = await L.header(s, { eyebrow: d.eyebrow, h2: d.h2, dark: tall })
      if (d.intro) { const w = L.AL(h, 'VERTICAL', { name: 'Intro', fillW: true, cross: 'CENTER' }); await L.T(w, d.intro, 'Body', tall ? ['surfaceAlt', 0.8] : 'text', { name: 'intro', w: 720, align: 'CENTER' }) }
    }
    const row = L.AL(s, 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24 })
    row.paddingTop = d.eyebrow || d.h2 || d.intro ? 40 : 0
    for (const it of d.items) {
      let i
      if (tall) { i = L.I('item/pathway-card', row, { label: it.label, text: it.text, link: it.link }, { fillW: true, fillH: true }); L.nameImg(i, 'image', it.shot, it.desc) }
      else i = L.I('item/pathway-compact', row, { label: it.label, text: it.text ?? null }, { fillW: true, fillH: true })
      i.name = 'Item / ' + it.label + (it.url ? ' → ' + it.url : '')
    }
    return s
  }

  // eventFacts: { name, style: simple|detailed, cta, items }
  //   simple:   [{ label, value, icon }] in a floating card that overlaps the dark section above
  //   detailed: [{ label, icon, days: [[day, hours]] } | { label, icon, address, link } | { label, icon, price, priceNote, notes: [] }]
  B.eventFacts = async (parent, d) => {
    const vdiv = (p, h) => L.AL(p, 'VERTICAL', { name: 'Divider', w: 1, h, bg: 'border' })
    if (d.style !== 'detailed') {
      const s = L.section(parent, d.name, 'light', { pt: 0, pb: 72 })
      const band = figma.createFrame()
      L.abs(s, band, 'Overlap band (matches section above)')
      band.fills = []
      L.fill(band, 'primary')
      band.resize(s.width, 56)
      band.constraints = { horizontal: 'STRETCH', vertical: 'MIN' }
      s.insertChild(0, band)
      const card = L.AL(s, 'HORIZONTAL', { name: 'Facts card', fillW: true, p: [32, 40, 32, 40], gap: 32, bg: 'surface', r: 'card', fx: 'raised', cross: 'CENTER' })
      for (const [k, it] of d.items.entries()) {
        if (k > 0) vdiv(card, 64)
        L.I('item/fact', card, { label: it.label, value: it.value }, { icon: it.icon, iconColor: 'accent', fillW: true }).name = 'Item / ' + it.label
      }
      return s
    }
    const s = L.section(parent, d.name, 'light', { pad: 80 })
    const card = L.AL(s, 'HORIZONTAL', { name: 'Facts card', fillW: true, p: 40, gap: 40, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card' })
    for (const [k, it] of d.items.entries()) {
      if (k > 0) vdiv(card, 10).layoutSizingVertical = 'FILL'
      const c = L.AL(card, 'VERTICAL', { name: 'Item / ' + it.label, gap: 14, fillW: true })
      const h = L.AL(c, 'HORIZONTAL', { name: 'Header', gap: 14, cross: 'CENTER' })
      L.badge(h, it.icon, 48, ['accent', 0.12], 'accent')
      await L.T(h, it.label, 'H3 Small', 'heading', { name: 'label' })
      if (it.days) for (const dy of it.days) L.I('item/day-row', c, { day: dy[0], time: dy[1] }, { fillW: true }).name = 'Item / ' + dy[0]
      if (it.address) { await L.T(c, it.address, 'Body', 'text', { name: 'value', fill: true }); if (it.link) (await L.link(c, it.link, 'secondary', 'arrow-up-right')).name = 'Link / ' + it.link + ' (URL TBD)' }
      if (it.price) {
        const pr = L.AL(c, 'HORIZONTAL', { name: 'Price', gap: 10, cross: 'BASELINE' })
        await L.T(pr, it.price, 'Display Number', 'secondary', { name: 'price' })
        if (it.priceNote) await L.T(pr, it.priceNote, 'Body Bold', 'heading', { name: 'priceNote' })
        for (const n of it.notes || []) await L.T(c, n, 'Body', 'text', { name: 'note', fill: true })
      }
    }
    if (d.cta) { const w = L.AL(s, 'VERTICAL', { name: 'CTA', p: [32, 0, 0, 0], cross: 'CENTER', fillW: true }); await L.btn(w, d.cta, 'primary') }
    return s
  }

  // team: { name, eyebrow, h2, people: [{ name, role, bio, shot }] }
  B.team = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'tint', { pad: 96 })
    await L.header(s, { eyebrow: d.eyebrow, h2: d.h2 })
    const row = L.AL(s, 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24 })
    row.paddingTop = 56
    for (const p of d.people) {
      const i = L.I('item/team-card', row, { name: p.name, role: p.role, bio: p.bio }, { fillW: true, fillH: true })
      L.nameImg(i, 'photo', p.shot, 'Headshot: ' + p.name)
      i.name = 'Item / ' + p.name
    }
    return s
  }

  // pricing: tiered price cards. { name, h2, badge, revenueLabel (shared note label), mobile,
  // tiers: [{ name, size, price, member, revenue, featured }], included: [...], button }
  B.pricing = async (parent, d) => {
    const mob = !!d.mobile
    const s = L.section(parent, d.name, d.bg || 'tint', { mobile: mob, pad: mob ? 56 : 96 })
    await L.header(s, { h2: d.h2, mobile: mob })
    if (d.badge) { const bw = L.AL(s, 'VERTICAL', { name: 'Badge wrap', p: [20, 0, 0, 0], cross: 'CENTER', fillW: true }); L.I('item/pill', bw, { text: d.badge }).name = 'Badge' }
    const row = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Tiers', fillW: true, gap: 24 })
    row.paddingTop = mob ? 32 : 48
    for (const t of d.tiers) {
      const i = L.I('item/tier-card', row, { size: t.size, name: t.name, price: t.price, member: t.member ?? null, revenueLabel: d.revenueLabel ?? null, revenue: t.revenue ?? null }, { fillW: true })
      if (!mob) i.layoutSizingVertical = 'FILL'
      i.name = 'Item / ' + t.name + (t.featured ? ' (featured)' : '')
      if (t.featured) {
        L.fill(i, 'primary'); i.strokes = []; L.shadow(i, 'raised')
        for (const [k, v] of Object.entries({ size: 'onPrimary', name: 'tertiary', price: 'onPrimary', member: 'tertiary', revenue: 'onPrimary' })) L.fill(L.own(i, k), v)
        L.fill(L.own(i, 'revenueLabel'), 'surfaceAlt', 0.7)
        L.fill(L.own(i, 'Divider', null), 'onPrimary', 0.15)
      }
    }
    if (d.included && d.included.length) {
      const inc = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Included', fillW: true, gap: mob ? 10 : 48, wrap: !mob, wrapGap: 12 })
      inc.paddingTop = 48
      for (const t of d.included) { const b = L.I('item/bullet', inc, { text: t }, { w: mob ? 350 : 537 }); if (mob) b.layoutSizingHorizontal = 'FILL'; b.name = 'Item / ' + t.slice(0, 40) }
    }
    if (d.button) { const w = L.AL(s, 'VERTICAL', { name: 'CTA', p: [40, 0, 0, 0], cross: 'CENTER', fillW: true }); const bt = await L.btn(w, d.button, 'primary'); if (mob) bt.layoutSizingHorizontal = 'FILL' }
    return s
  }

  // prizes: featured item + grid (raffle, giveaway, products). { name, eyebrow, h2, intro,
  // prizeShot: [id, desc], ribbon, sponsor, badges: [...], prizes: [{ name, shot, desc }], note,
  // button, beneficiary, beneficiaryLine, mobile }
  B.prizes = async (parent, d) => {
    const mob = !!d.mobile
    const s = L.section(parent, d.name, d.bg || 'dark', { mobile: mob, pad: mob ? 56 : 96 })
    const top = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Featured', fillW: true, gap: mob ? 28 : 56, cross: 'CENTER' })
    const pc = L.AL(top, 'VERTICAL', { name: 'Featured card', w: mob ? 350 : 540, r: 'card', clip: true, bg: ['onPrimary', 0.06], stroke: ['onPrimary', 0.15, 1] })
    L.photo(pc, d.prizeShot[0], d.prizeShot[1], mob ? 350 : 540, mob ? 219 : 338, true, { fillW: true, r: 0 })
    if (d.ribbon) { const rb = L.AL(pc, 'HORIZONTAL', { name: 'Ribbon', p: [8, 16, 8, 16], bg: 'accent', r: 'pill' }); rb.layoutPositioning = 'ABSOLUTE'; rb.x = 16; rb.y = 16; await L.T(rb, d.ribbon, 'Label', 'onPrimary', { name: 'ribbon' }) }
    if (d.sponsor) { const lr = L.AL(pc, 'HORIZONTAL', { name: 'Sponsor', p: [16, 20, 16, 20], gap: 12, cross: 'CENTER', fillW: true }); L.logo(lr, d.sponsor, 220, 64, true) }
    const r = L.AL(top, 'VERTICAL', { name: 'Text', gap: 16, fillW: !mob, w: mob ? 350 : undefined })
    if (d.eyebrow) await L.T(r, d.eyebrow, 'Eyebrow', 'tertiary', { name: 'eyebrow' })
    if (d.h2) await L.T(r, d.h2, mob ? 'H2 Mobile' : 'H2 Section', 'onPrimary', { name: 'heading', fill: true })
    if (d.intro) await L.T(r, d.intro, 'Body', ['surfaceAlt', 0.85], { name: 'intro', fill: true })
    if (d.badges && d.badges.length) { const pr = L.AL(r, 'HORIZONTAL', { name: 'Badges', gap: 12, wrap: true, wrapGap: 10, fillW: true, p: [8, 0, 0, 0] }); for (const b of d.badges) L.I('item/pill', pr, { text: b }).name = 'Item / ' + b }
    const g = L.AL(s, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24, wrap: !mob, wrapGap: 24 })
    g.paddingTop = 56
    for (const p of d.prizes) { const i = L.I('item/prize-card', g, { name: p.name }, { w: mob ? 350 : 358 }); if (mob) i.layoutSizingHorizontal = 'FILL'; L.nameImg(i, 'image', p.shot, p.desc); i.name = 'Item / ' + p.name.slice(0, 40) }
    const n = L.AL(s, 'VERTICAL', { name: 'Purchase', p: [48, 0, 0, 0], gap: 24, cross: 'CENTER', fillW: true })
    if (d.note) await L.T(n, d.note, 'Body', ['surfaceAlt', 0.9], { name: 'note', w: mob ? 350 : 720, align: 'CENTER' })
    if (d.button) { const bt = await L.btn(n, d.button, 'primary'); if (mob) bt.layoutSizingHorizontal = 'FILL' }
    if (d.beneficiary) { const bf = L.AL(n, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Beneficiary', gap: 14, cross: 'CENTER', p: [8, 0, 0, 0] }); L.logo(bf, d.beneficiary, 240, 64, true); if (d.beneficiaryLine) await L.T(bf, d.beneficiaryLine, 'Small', ['surfaceAlt', 0.75], { name: 'beneficiaryLine' }) }
    return s
  }

  // logoGrid: { name, style: featured|grid, label, featured: { label, owner }, rowLabel, rowOwner,
  // h2, intro, link, count, tbd }
  B.logoGrid = async (parent, d) => {
    const ft = d.style === 'featured' || d.style === 'sponsor'
    const s = L.section(parent, d.name, d.bg || 'tint', { pad: ft ? 80 : 96 })
    if (ft) {
      if (d.label) await L.T(s, d.label, 'Footer Line', 'heading', { name: 'label', align: 'CENTER' })
      const f = L.AL(s, 'VERTICAL', { name: 'Featured', p: [32, 0, 0, 0], gap: 12, cross: 'CENTER', fillW: true })
      if (d.featured.label) await L.T(f, d.featured.label, 'Label', 'textMuted', { name: 'featuredLabel' })
      const c = L.AL(f, 'VERTICAL', { name: 'Featured logo card', p: [28, 40, 28, 40], gap: 12, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card', cross: 'CENTER' })
      L.logo(c, d.featured.owner, 380, 150)
      await L.T(c, d.featured.owner, 'Card Title', 'heading', { name: 'featuredName' })
      if (d.rowLabel) { const lw = L.AL(s, 'VERTICAL', { name: 'Row label', p: [36, 0, 12, 0], cross: 'CENTER', fillW: true }); await L.T(lw, d.rowLabel, 'Label', 'textMuted', { name: 'rowLabel' }) }
      const r = L.AL(s, 'HORIZONTAL', { name: 'Items', gap: 24, main: 'CENTER', fillW: true })
      for (let k = 1; k <= d.count; k++) { const i = L.I('item/logo-card', r, { name: null, link: null }, { w: 270 }); L.nameLogo(i, 'logo', d.rowOwner + ' ' + k); i.name = 'Item / ' + d.rowOwner + ' ' + k }
      return s
    }
    await L.header(s, { h2: d.h2, intro: d.intro })
    const g = L.AL(s, 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24, wrap: true, wrapGap: 24, main: 'CENTER' })
    g.paddingTop = 48
    for (let k = 1; k <= d.count; k++) { const i = L.I('item/logo-card', g, { name: null, link: d.link ?? null }, { w: 262 }); L.nameLogo(i, 'logo', (d.owner || 'Logo') + ' ' + k); i.name = 'Item / ' + (d.owner || 'Logo') + ' ' + k }
    if (d.tbd) { const t = L.AL(s, 'VERTICAL', { name: 'Note', p: [24, 0, 0, 0], cross: 'CENTER', fillW: true }); await L.tbd(t, d.tbd, { align: 'CENTER' }) }
    return s
  }

  // mediaCard: one large image in a card + button + caption (floor plan, map, menu).
  // { name, h2, shot: [id, desc], label, button, buttonIcon, captionTbd, bg }
  B.mediaCard = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'light', { pad: 96 })
    await L.header(s, { h2: d.h2 })
    const w = L.AL(s, 'VERTICAL', { name: 'Wrap', p: [48, 0, 0, 0], cross: 'CENTER', fillW: true })
    const card = L.AL(w, 'VERTICAL', { name: 'Card', w: 960, p: 24, gap: 20, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card', cross: 'CENTER' })
    const img = L.photo(card, d.shot[0], d.shot[1], 912, 570, false, { fillW: true, r: 12 })
    if (d.label) L.own(img, 'label').characters = d.label
    if (d.button) await L.btn(card, d.button, 'outlineLight', { arrow: d.buttonIcon || 'download' })
    if (d.captionTbd) await L.tbd(card, d.captionTbd, { align: 'CENTER' })
    return s
  }

  // directory: { name, h2, chips: [...], empty (message), populated (draw TBD sample cards) }
  B.directory = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'light', { pad: 96 })
    await L.header(s, { h2: d.h2 })
    if (d.chips && d.chips.length) {
      const cr = L.AL(s, 'HORIZONTAL', { name: 'Category chips', fillW: true, gap: 8, wrap: true, wrapGap: 8, main: 'CENTER' })
      cr.paddingTop = 32
      for (const c of d.chips) L.I('item/chip', cr, { text: c }).name = 'Chip / ' + c
    }
    if (d.populated) {
      const g = L.AL(s, 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24, wrap: true, wrapGap: 24 })
      g.paddingTop = 40
      for (let k = 1; k <= (d.count || 8); k++) { const i = L.I('item/exhibitor-card', g, { name: '[TBD: name]', category: '[TBD: category]', booth: '[TBD]', link: 'Website →' }, { w: 262 }); L.nameLogo(i, 'logo', 'Entry ' + k); i.name = 'Item / Entry ' + k + ' (TBD)' }
      return s
    }
    const ew = L.AL(s, 'VERTICAL', { name: 'Empty wrap', p: [40, 0, 0, 0], fillW: true })
    const e = L.AL(ew, 'VERTICAL', { name: 'Empty state', fillW: true, p: 56, gap: 12, cross: 'CENTER', bg: 'surface', r: 'card', stroke: ['textMuted', 0.3, 2, true] })
    L.badge(e, 'store', 56, ['secondary', 0.12], 'secondary')
    if (d.empty) await L.T(e, d.empty, 'Card Title', 'heading', { name: 'emptyMessage', align: 'CENTER' })
    await L.tbd(e, d.emptyTbd || 'directory entries', { align: 'CENTER', fill: false })
    return s
  }

  // contactForm: topic tiles + form. { name, lead, leadNote, topics: [{ label, icon }], button, success, mobile }
  B.contactForm = async (parent, d) => {
    const mob = !!d.mobile
    const s = L.section(parent, d.name, d.bg || 'tint', { mobile: mob, pad: mob ? 56 : 96 })
    if (d.lead) { const lw = L.AL(s, 'VERTICAL', { name: 'Lead', fillW: true, cross: 'CENTER' }); await L.T(lw, d.lead, mob ? 'Body' : 'Lead', 'heading', { name: 'lead' + (d.leadNote ? ' (' + d.leadNote + ')' : ''), align: 'CENTER', w: mob ? 350 : 720 }) }
    const tr = L.AL(s, 'HORIZONTAL', { name: 'Topics', fillW: true, gap: mob ? 12 : 20, wrap: mob, wrapGap: 12 })
    tr.paddingTop = 40
    for (const [k, tp] of d.topics.entries()) {
      const i = L.I('item/topic-tile', tr, { label: tp.label }, { icon: tp.icon, fillW: !mob, w: mob ? 169 : undefined })
      if (!mob) i.layoutSizingVertical = 'FILL'
      i.name = 'Item / ' + tp.label + (k === 0 ? ' (selected)' : '')
      if (k === 0) { L.stroke(i, 'secondary', 1, 2); L.own(i, 'radioDot', null).visible = true; L.stroke(L.own(i, 'radio', null), 'secondary', 1, 2) }
    }
    const fw = L.AL(s, 'VERTICAL', { name: 'Form wrap', p: [24, 0, 0, 0], fillW: true })
    const f = L.AL(fw, 'VERTICAL', { name: 'Form (cms-form)', fillW: true, p: mob ? 24 : 40, gap: 20, bg: 'surface', r: 'card', stroke: ['border', 1, 1], fx: 'card' })
    const field = async (p, label, ph, o = {}) => {
      const w = L.AL(p, 'VERTICAL', { name: 'Field / ' + label, gap: 8, fillW: true })
      await L.T(w, label, 'Label Large', 'heading', { name: 'fieldLabel' })
      const inp = await L.input(w, ph, o)
      if (o.select) { L.AL(inp, 'HORIZONTAL', { name: 'spacer', fillW: true }); L.ico(inp, 'chevron-down', 20, 'textMuted') }
      return w
    }
    const r1 = L.AL(f, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Row', fillW: true, gap: 20 })
    await field(r1, 'Name', '')
    await field(r1, 'Email', '')
    const r2 = L.AL(f, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Row', fillW: true, gap: 20 })
    await field(r2, 'Phone (optional)', '')
    await field(r2, 'Topic', d.topics[0].label, { select: true })
    await field(f, 'Message', '', { h: 160, top: true })
    const sr = L.AL(f, mob ? 'VERTICAL' : 'HORIZONTAL', { name: 'Submit row', fillW: true, gap: 16, cross: mob ? 'MIN' : 'CENTER' })
    const bt = await L.btn(sr, d.button || 'Send', 'primary')
    if (mob) bt.layoutSizingHorizontal = 'FILL'
    if (d.success) {
      const ok = L.AL(sr, 'HORIZONTAL', { name: 'Success message (state)', p: [12, 16, 12, 16], gap: 10, cross: 'CENTER', bg: ['secondary', 0.12], r: 'button' })
      L.ico(ok, 'message', 18, 'secondary')
      const t = await L.T(ok, d.success, 'Body Bold', 'primary', { name: 'successMessage' })
      if (mob) { ok.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL' }
    }
    return s
  }

  // recap: alternating rows. { name, years: [{ year, title, location, stats: [[value, label], [value, label]],
  // highlights | tbd, photos: [[id, desc] x3] }] }
  B.recap = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'tint', { pad: 96, gap: 96 })
    for (const [k, y] of d.years.entries()) {
      const i = L.I(k % 2 ? 'item/year-row-reverse' : 'item/year-row', s, { year: y.year, title: y.title, location: y.location, stat1Value: y.stats[0][0], stat1Label: y.stats[0][1], stat2Value: y.stats[1][0], stat2Label: y.stats[1][1], highlights: y.highlights || '[TBD: ' + y.tbd + ']' }, { fillW: true })
      if (!y.highlights) { const h = L.own(i, 'highlights'); h.name = 'TBD — ' + y.tbd; L.fill(h, 'textMuted') }
      y.photos.forEach((p, j) => L.nameImg(i, 'photo' + (j + 1), p[0], p[1]))
      i.name = 'Item / ' + y.title
    }
    return s
  }

  // resources: downloads grid. { name, h2, items: [{ type, icon, title, link }], tbd }
  B.resources = async (parent, d) => {
    const s = L.section(parent, d.name, d.bg || 'tint', { pad: 96 })
    await L.header(s, { h2: d.h2 })
    const g = L.AL(s, 'HORIZONTAL', { name: 'Items', fillW: true, gap: 24, wrap: true, wrapGap: 24 })
    g.paddingTop = 48
    for (const it of d.items) L.I('item/resource-card', g, { type: it.type, title: it.title, link: it.link }, { icon: it.icon, iconColor: 'onPrimary', w: 549 }).name = 'Item / ' + it.title.slice(0, 40)
    if (d.tbd !== false) { const t = L.AL(s, 'VERTICAL', { name: 'Note', p: [24, 0, 0, 0], cross: 'CENTER', fillW: true }); await L.tbd(t, d.tbd || 'file URLs', { align: 'CENTER' }) }
    return s
  }

  // Older names from the first site.
  B.booth = B.pricing
  B.raffle = B.prizes
  B.floorPlan = (parent, d) => B.mediaCard(parent, Object.assign({ shot: ['F-01', 'Floor plan'], label: 'Floor plan coming soon · F-01', button: d.button, captionTbd: 'caption / legend' }, d))
  B.yearRecap = B.recap
  return B
}
