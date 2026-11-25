// Converts the rich text a CMS post stores (paragraphs, headings, lists,
// links, images, emphasis, quotes) to Markdown. Anything it does not know is
// reduced to its text; the post's JSON keeps the original HTML.
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' }
const decode = text => text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code) => {
  if (code[0] === '#')
    return String.fromCodePoint(code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
  return entities[code.toLowerCase()] ?? whole
})
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i')) || [])[1] || ''

export const htmlToMarkdown = (html) => {
  let md = String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\r?\n/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, ' ')
  md = md.replace(/<img\b[^>]*>/gi, tag => `![${attr(tag, 'alt')}](${attr(tag, 'src')})`)
  md = md.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs, text) => {
    const href = attr(attrs, 'href')
    return href ? `[${text}](${href})` : text
  })
  md = md.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => text.trim() ? `**${text.trim()}**` : text)
  md = md.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => text.trim() ? `*${text.trim()}*` : text)
  md = md.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  md = md.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${'#'.repeat(Number(level))} ${text.trim()}\n\n`)
  md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n\n> ${text.replace(/<\/?p\b[^>]*>/gi, ' ').trim()}\n\n`)
  md = md.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, type, items) => {
    let index = 0
    const lines = [...items.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(([, text]) => `${type.toLowerCase() === 'ol' ? `${++index}.` : '-'} ${text.replace(/<\/?p\b[^>]*>/gi, ' ').trim()}`)
    return `\n\n${lines.join('\n')}\n\n`
  })
  md = md.replace(/<br\s*\/?>/gi, '  \n')
  md = md.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n')
  md = md.replace(/<\/(p|div|section|article|figure|figcaption|table|tr)>/gi, '\n\n')
  md = md.replace(/<[^>]+>/g, '')
  md = decode(md)
  return md
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, match => (match.length >= 2 ? '  ' : '')).replace(/^[ \t]+(?=\S)/, ''))
    .join('\n')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
