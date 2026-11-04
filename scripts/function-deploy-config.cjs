const fs = require('node:fs')
const path = require('node:path')

function readRetiredEnvironmentKeys(root) {
  const manifest = path.join(root, 'package.json')
  if (!fs.existsSync(manifest)) return []
  const config = JSON.parse(fs.readFileSync(manifest, 'utf8')).edgeDeploy
  if (config === undefined) return []
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('package.json edgeDeploy must be an object')
  const keys = config.retiredEnvironmentKeys === undefined ? [] : config.retiredEnvironmentKeys
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))
    throw new Error('package.json edgeDeploy.retiredEnvironmentKeys must be an array of environment variable names')
  return [...new Set(keys)]
}

module.exports = { readRetiredEnvironmentKeys }
