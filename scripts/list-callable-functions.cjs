// Discover callable exports without loading handlers or initializing Firebase.
const fs = require('node:fs')
const path = require('node:path')

function listCallableFunctions(indexPath, readSource = file => fs.readFileSync(file, 'utf8')) {
  const modules = new Map()
  const localPath = (file, relative) => {
    const resolved = path.resolve(path.dirname(file), relative)
    return path.extname(resolved) ? resolved : `${resolved}.js`
  }
  function parse(file) {
    if (modules.has(file)) return modules.get(file)
    const source = readSource(file)
    const imports = new Map()
    const exports = new Map()
    for (const match of source.matchAll(/^\s*const\s+(\w+)\s*=\s*require\(\s*['"](\.\/[^'"]+)['"]\s*\)/gm))
      imports.set(match[1], localPath(file, match[2]))
    for (const match of source.matchAll(/^\s*exports\.(\w+)\s*=\s*([^\n]+)/gm)) {
      const [, name, expression] = match
      if (/^onCall\s*\(/.test(expression)) {
        exports.set(name, { callable: true })
        continue
      }
      const required = expression.match(/^require\(\s*['"](\.\/[^'"]+)['"]\s*\)(?:\.(\w+))?/)
      if (required) {
        exports.set(name, { file: localPath(file, required[1]), member: required[2] })
        continue
      }
      const forwarded = expression.match(/^(\w+)\.(\w+)\s*;?\s*$/)
      if (forwarded && imports.has(forwarded[1]))
        exports.set(name, { file: imports.get(forwarded[1]), member: forwarded[2] })
    }
    modules.set(file, exports)
    return exports
  }
  function resolve(file, name, visiting = new Set()) {
    const key = `${file}:${name}`
    if (visiting.has(key)) return []
    const entry = parse(file).get(name)
    if (!entry) return []
    if (entry.callable) return ['']
    const next = new Set([...visiting, key])
    if (entry.member) return resolve(entry.file, entry.member, next)
    return [...parse(entry.file).keys()].flatMap(child =>
      resolve(entry.file, child, next).map(suffix => suffix ? `${child}-${suffix}` : child))
  }
  const root = path.resolve(indexPath)
  return [...new Set([...parse(root).keys()].flatMap(name =>
    resolve(root, name).map(suffix => suffix ? `${name}-${suffix}` : name)))].sort()
}

if (require.main === module)
  console.log(listCallableFunctions(path.resolve(__dirname, '../../functions/index.js')).join('\n'))

module.exports = { listCallableFunctions }
