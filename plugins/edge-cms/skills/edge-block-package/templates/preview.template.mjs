// Renders the generated blocks with their defaults into preview/index.html. Not an upload input.
// Serve the importfiles folder (python3 -m http.server) and open <package>/preview/index.html at desktop and phone widths.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaults, renderBlock } from './validate-common.mjs'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const readJson = relativePath => JSON.parse(readFileSync(resolve(packageRoot, relativePath), 'utf8'))
const manifest = readJson('manifest.json')
const themeSetup = '__THEME_SETUP__' // folder holding theme.json and head.json for the preview shell, or empty
// Theme `apply` rules are not used: the Hub and the public renderer ignore them, and each block sets its own base font and text color.
const theme = (themeSetup && existsSync(resolve(packageRoot, themeSetup, 'theme.json'))) ? readJson(resolve(themeSetup, 'theme.json')) : { extend: {} }
const head = (themeSetup && existsSync(resolve(packageRoot, themeSetup, 'head.json'))) ? readJson(resolve(themeSetup, 'head.json')) : { link: [] }
const extraCssFile = resolve(packageRoot, themeSetup || '.', 'extra.css')
const extraCss = existsSync(extraCssFile) ? readFileSync(extraCssFile, 'utf8') : ''

// Override defaults per block for the preview (for example packaged media paths), and supply sample data-source records.
const previewValues = {}
const sampleSources = {}

const sections = []
for (const entry of manifest.blocks) {
  const block = readJson(entry.file)
  const values = { ...defaults(block), ...(previewValues[block.docId] || {}) }
  const html = (await renderBlock(block, { values, sources: sampleSources })).replace('{{ loading }}', 'hidden').replace('{{ loaded }}', '')
  sections.push(`<p class="bg-white px-4 py-1 font-mono text-xs text-black">${block.docId}</p>\n${html}`)
}
const links = (head.link || []).map(link => `<link${Object.entries(link).map(([k, v]) => ` ${k}="${v}"`).join('')}>`).join('\n')
mkdirSync(resolve(packageRoot, 'preview'), { recursive: true })
writeFileSync(resolve(packageRoot, 'preview/index.html'), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>__PACKAGE__ preview</title><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config = { theme: { extend: ${JSON.stringify(theme.extend || {})} } }</script>${links}<style>${extraCss}</style></head><body>${sections.join('\n')}</body></html>\n`)
console.log('Wrote preview/index.html')
