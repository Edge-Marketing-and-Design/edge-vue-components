#!/usr/bin/env node
// Serves an exported site folder on localhost the way a static host would
// (folder/index.html for /folder/, 404.html for missing paths), for review.
// Usage: node serve.mjs --dir <export>/site [--port 4321]
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const argv = process.argv.slice(2)
const option = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback)
const root = resolve(option('dir', '.'))
const port = Number(option('port', 4321))
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.mp4': 'video/mp4' }

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, path)
  if (existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html')
  let status = 200
  if (!file.startsWith(root) || !existsSync(file)) {
    file = join(root, '404.html')
    status = 404
  }
  res.writeHead(status, { 'content-type': types[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/`))
