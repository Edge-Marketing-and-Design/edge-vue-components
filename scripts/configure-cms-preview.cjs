#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const readline = require('node:readline/promises')
const { readValue, setValue, validateUrl } = require('./configure-cms-frontend.cjs')

const SECRET_KEY = 'CMS_PREVIEW_TOKEN_SECRET'
const URL_KEY = 'CMS_PREVIEW_RENDER_BASE_URL'
const CHECK_MARKER = '# START EDGE CMS PREVIEW CONFIG CHECK'
const readText = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''

function checkSettings(text, env = {}) {
  const secret = env[SECRET_KEY] || readValue(text, SECRET_KEY)
  const baseUrl = env[URL_KEY] || readValue(text, URL_KEY)
  if (!secret || secret.length < 32)
    throw new Error(`${SECRET_KEY} must have at least 32 characters. Run sh edge/edge-update-all.sh to configure production previews.`)
  try {
    validateUrl(baseUrl)
    if (new URL(baseUrl).pathname !== '/')
      throw new Error('not an origin')
  }
  catch {
    throw new Error(`${URL_KEY} must be the HTTP(S) Hub origin, not the public CMS renderer or a page path. Run sh edge/edge-update-all.sh.`)
  }
  return { secret, baseUrl }
}

async function promptHubUrl() {
  if (!process.stdin.isTTY)
    throw new Error(`${URL_KEY} is missing. Configure it or NUXT_PUBLIC_APP_URL, or run the updater interactively.`)
  const input = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    while (true) {
      const value = await input.question('Hub base URL for signed CMS draft previews (not the public renderer): ')
      try {
        const base = validateUrl(value)
        if (new URL(base).pathname === '/')
          return base
      }
      catch {}
      console.log('Enter the Hub HTTP(S) origin only. Press Ctrl+C to cancel.')
    }
  }
  finally {
    input.close()
  }
}

function addDeployCheck(source) {
  if (source.includes(CHECK_MARKER))
    return source
  // Match the actual deploy command, never a comment or a function definition.
  const command = /^([\t ]*)firebase deploy[^\n]*--only(?:[=\t ]+)["']?functions(?:[\t ,"']|$)[^\n]*$/m
  if (!command.test(source))
    throw new Error('Could not locate the Functions deploy command in deploy.sh. Add the CMS preview --check manually before deployment.')
  const guard = `${CHECK_MARKER}\nnode "$(dirname -- "$0")/edge/scripts/configure-cms-preview.cjs" --check "$(dirname -- "$0")"\n# END EDGE CMS PREVIEW CONFIG CHECK\n`
  return source.replace(command, match => `${guard}${match}`)
}

async function configureCmsPreview(projectRoot, { prompt = promptHubUrl, env = process.env } = {}) {
  if (!fs.existsSync(path.join(projectRoot, 'functions')))
    return { skipped: true }
  const envPath = path.join(projectRoot, 'functions/.env.prod')
  const original = readText(envPath)
  const existingSecret = readValue(original, SECRET_KEY)
  const existingUrl = readValue(original, URL_KEY)
  // Resolve and validate everything before writing or generating a secret.
  const baseUrl = existingUrl || env[URL_KEY]
    || env.NUXT_PUBLIC_APP_URL || env.VITE_APP_URL
    || readValue(readText(path.join(projectRoot, '.env')), 'NUXT_PUBLIC_APP_URL')
    || readValue(readText(path.join(projectRoot, '.env')), 'VITE_APP_URL')
    || await prompt()
  const secret = existingSecret || env[SECRET_KEY] || randomBytes(32).toString('hex')
  checkSettings(setValue(setValue('', SECRET_KEY, secret), URL_KEY, baseUrl))
  const deployPath = path.join(projectRoot, 'deploy.sh')
  const deploy = readText(deployPath)
  const nextDeploy = deploy ? addDeployCheck(deploy) : ''
  let next = original
  if (!existingSecret)
    next = setValue(next, SECRET_KEY, secret)
  if (!existingUrl)
    next = setValue(next, URL_KEY, validateUrl(baseUrl))
  const changedFiles = []
  if (next !== original) {
    fs.writeFileSync(envPath, next, { mode: 0o600 })
    changedFiles.push('functions/.env.prod')
  }
  if (nextDeploy !== deploy) {
    fs.writeFileSync(deployPath, nextDeploy)
    changedFiles.push('deploy.sh')
  }
  // No secret value is returned or logged.
  return { changedFiles }
}

module.exports = { configureCmsPreview, checkSettings, addDeployCheck }

if (require.main === module) {
  const check = process.argv[2] === '--check'
  const root = path.resolve(process.argv[check ? 3 : 2] || '.')
  const run = check
    ? async () => { checkSettings(readText(path.join(root, 'functions/.env.prod')), process.env); return 'CMS production preview settings verified.' }
    : async () => {
        const result = await configureCmsPreview(root)
        return result.skipped ? 'CMS preview setup skipped: no Functions directory.'
          : result.changedFiles.length ? `CMS preview setup updated: ${result.changedFiles.join(', ')} (secret not displayed).` : 'CMS preview already configured.'
      }
  run().then(message => console.log(message)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
