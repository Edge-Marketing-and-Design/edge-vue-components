#!/usr/bin/env node
// Builds the static runtime (edge-standalone.js and its lazy chunks) from a
// renderer checkout's own client helpers, so an export always matches the
// renderer that served the site. export-site.mjs runs it for every export.
// The renderer is private and edge/ is public: never commit the built output.
// Usage: node build-runtime.mjs --renderer <emd-cms-front checkout> --out <dir>
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argIndex = process.argv.indexOf('--renderer')
const renderer = resolve(argIndex > -1 ? process.argv[argIndex + 1] : '../emd-cms-front')
const outIndex = process.argv.indexOf('--out')
if (outIndex < 0) {
  console.error('Pass --out <dir> for the built runtime.')
  process.exit(1)
}
const dist = resolve(process.argv[outIndex + 1])
if (!existsSync(join(renderer, 'app/plugins/cmsNav.client.ts'))) {
  console.error(`No emd-cms-front checkout at ${renderer}. Pass --renderer <path>.`)
  process.exit(1)
}
const pnpm = join(renderer, 'node_modules/.pnpm')
if (!existsSync(pnpm)) {
  console.error('Install the renderer first (pnpm install in emd-cms-front).')
  process.exit(1)
}
const esbuildDir = readdirSync(pnpm).filter(name => /^esbuild@\d/.test(name)).sort().pop()
const esbuild = createRequire(join(pnpm, esbuildDir, 'node_modules/esbuild/package.json'))('esbuild')

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: renderer }).toString().trim()
const dirty = execFileSync('git', ['status', '--porcelain', 'app', 'shared'], { cwd: renderer }).toString().trim()
const result = await esbuild.build({
  entryPoints: [join(here, 'entry.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: dist,
  entryNames: 'edge-standalone',
  chunkNames: 'chunk-[hash]',
  minify: true,
  target: 'es2020',
  write: false,
  tsconfigRaw: {},
  loader: { '.css': 'empty' },
  nodePaths: [join(renderer, 'node_modules')],
  alias: {
    '~': join(renderer, 'app'),
    '~~': renderer,
    'vue': join(here, 'vue-shim.js'),
  },
  inject: [join(here, 'nuxt-shim.js')],
  define: {
    'import.meta.hot': 'undefined',
    'import.meta.client': 'true',
    'import.meta.server': 'false',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'warning',
})
const source = `emd-cms-front ${commit}${dirty ? ' (with uncommitted changes)' : ''}`
const banner = `/* Edge CMS standalone runtime, built from ${source}. */\n`
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
let total = 0
for (const file of result.outputFiles) {
  const text = file.path.endsWith('edge-standalone.js') ? banner + file.text : file.text
  writeFileSync(file.path, text)
  total += file.contents.length
}
console.log(`Wrote ${result.outputFiles.length} files (${Math.round(total / 1024)} KB) to ${dist} from ${source}`)
