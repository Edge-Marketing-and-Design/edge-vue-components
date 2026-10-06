#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline/promises')

const ENV_KEY = 'NUXT_PUBLIC_CMS_FRONTEND_URL'
const assignment = /^[\t ]*(?:export[\t ]+)?NUXT_PUBLIC_CMS_FRONTEND_URL[\t ]*=[\t ]*(.*)$/gm

function readValue(text) {
  const matches = [...text.matchAll(assignment)]
  const raw = matches.at(-1)?.[1]?.trim() || ''
  if (/^["']/.test(raw))
    return raw.match(/^["'](.*?)["'](?:\s*#.*)?$/)?.[1]?.trim() || ''
  return raw.split(/\s+#/)[0].trim()
}

function validateUrl(value) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Enter an HTTP(S) CMS frontend URL without credentials, query parameters, or fragments.')
  return value.trim().replace(/\/+$/, '')
}

function addRuntimeConfig(source) {
  if (/\bcmsFrontendUrl\s*:/.test(source))
    return source
  const setting = "cmsFrontendUrl: process.env.NUXT_PUBLIC_CMS_FRONTEND_URL || '',"
  const publicBlock = /(\bruntimeConfig\s*:\s*\{\s*public\s*:\s*\{)/
  if (publicBlock.test(source))
    return source.replace(publicBlock, `$1\n      ${setting}`)
  if (!/\bruntimeConfig\s*:/.test(source) && /defineNuxtConfig\(\{/.test(source))
    return source.replace('defineNuxtConfig({', `defineNuxtConfig({\n  runtimeConfig: {\n    public: {\n      ${setting}\n    },\n  },`)
  throw new Error('Could not safely add public.cmsFrontendUrl to Nuxt config. Add it manually, then rerun the updater.')
}

async function promptUrl() {
  if (!process.stdin.isTTY)
    throw new Error(`${ENV_KEY} is missing. Run the updater interactively or set it in .env first.`)
  const input = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    while (true) {
      const value = await input.question('CMS frontend base URL for this Hub (for example https://your-cms.pages.dev): ')
      try {
        return validateUrl(value)
      }
      catch {
        console.log('A valid HTTP(S) URL is required. Press Ctrl+C to cancel.')
      }
    }
  }
  finally {
    input.close()
  }
}

async function configureCmsFrontend(projectRoot, { prompt = promptUrl, env = process.env } = {}) {
  const configPath = ['nuxt.config.ts', 'nuxt.config.js']
    .map(file => path.join(projectRoot, file)).find(file => fs.existsSync(file))
  if (!configPath)
    return { skipped: true }
  const originalConfig = fs.readFileSync(configPath, 'utf8')
  const config = addRuntimeConfig(originalConfig)
  const files = ['.env', '.env.dev'].map(file => {
    const filePath = path.join(projectRoot, file)
    const exists = fs.existsSync(filePath)
    const text = exists ? fs.readFileSync(filePath, 'utf8') : ''
    return { file, filePath, exists, text, value: readValue(text) }
  })
  const existing = files.find(file => file.value)?.value || env[ENV_KEY]
  const value = validateUrl(existing || await prompt())
  const changedFiles = []
  for (const file of files) {
    // Keep independently configured dev URLs and do not create an unused dev file.
    if (file.value || (file.file === '.env.dev' && !file.exists))
      continue
    const line = `${ENV_KEY}=${value}`
    const text = [...file.text.matchAll(assignment)].length
      ? file.text.replace(assignment, line)
      : `${file.text}${file.text && !file.text.endsWith('\n') ? '\n' : ''}${line}\n`
    fs.writeFileSync(file.filePath, text)
    changedFiles.push(file.file)
  }
  if (config !== originalConfig) {
    fs.writeFileSync(configPath, config)
    changedFiles.push(path.basename(configPath))
  }
  return { changedFiles }
}

module.exports = { configureCmsFrontend, readValue, addRuntimeConfig, validateUrl }

if (require.main === module) {
  configureCmsFrontend(path.resolve(process.argv[2] || '.'))
    .then(result => console.log(result.skipped
      ? 'CMS frontend setup skipped: no Nuxt config.'
      : result.changedFiles.length ? `CMS frontend configured: ${result.changedFiles.join(', ')}` : 'CMS frontend already configured.'))
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
