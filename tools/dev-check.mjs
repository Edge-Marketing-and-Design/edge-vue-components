#!/usr/bin/env node
// Checks that this machine gives a Hub session only that Hub's CMS tools and
// the Edge skills from the checkout (edge/skills/README.md,
// edge/tools/mcp/cms/README.md "Developer setup"). Run from a Hub checkout:
//
//   node edge/tools/dev-check.mjs            all checks
//   node edge/tools/dev-check.mjs --offline  skip `claude mcp list` and the database read checks
//
// Exits 1 when a check fails. Warnings don't fail it.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { edgeSkillNames, linkDrift } from '../skills/link-skills.mjs'

const expandHome = (file, home) => file.replace(/^~(?=$|\/)/, home)
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
const read = file => { try { return readFileSync(file, 'utf8') } catch { return '' } }
const dirs = dir => { try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] } }

// TOML tables as { name: body }; enough for ~/.codex/config.toml headers.
export function tomlTables(text) {
  const tables = {}
  let name = ''
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) { name = header[1].trim(); tables[name] = ''; continue }
    if (name) tables[name] += `${line}\n`
  }
  return tables
}

const CMS_HINT = /cms-agentMcp|firebase|firestore|edge-?cms|tools\/mcp\/cms/i

// Every check as { ok: true|false|'warn', name, detail }.
export async function runChecks({ hubRoot, home = homedir(), env = process.env, claudeMcpList = null, probeRead = null }) {
  const results = []
  const add = (ok, name, detail = '') => results.push({ ok, name, detail })
  const skills = await edgeSkillNames(path.join(hubRoot, 'edge', 'skills'))

  // 1. The Hub's own skill links.
  const drift = await linkDrift(hubRoot, skills)
  add(drift.length === 0, 'Hub skill links match edge/skills',
    drift.length ? `${drift.map(d => `${d.dir}/${d.name}: ${d.problem}`).join('; ')}. Run node edge/skills/link-skills.mjs` : '')

  // 2. Personal copies of Edge skills, which load in every session.
  const copies = ['.claude/skills', '.codex/skills', '.agents/skills']
    .flatMap(dir => skills.filter(name => existsSync(path.join(home, dir, name))).map(name => `~/${dir}/${name}`))
  add(copies.length === 0, 'No personal copies of Edge skills', copies.length ? `remove ${copies.join(', ')}` : '')

  // 3. The edge-cms plugin and account skills: claude.ai org plugin, the
  // CLI's synced copies, Codex plugin.
  const synced = [
    ...dirs(path.join(home, '.claude/plugins/synced')).filter(org => existsSync(path.join(home, '.claude/plugins/synced', org, 'edge-cms')))
      .map(org => `~/.claude/plugins/synced/${org}/edge-cms`),
    ...dirs(path.join(home, '.claude/skills/synced')).flatMap(org => skills.filter(name => existsSync(path.join(home, '.claude/skills/synced', org, name)))
      .map(name => `~/.claude/skills/synced/${org}/${name}`)),
  ]
  add(synced.length === 0, 'No edge-cms plugin or Edge account skill synced by the claude CLI',
    synced.length ? `uninstall the plugin / delete the account skill in claude.ai, then delete ${synced.join(', ')}` : '')

  const codexTables = tomlTables(read(path.join(home, '.codex/config.toml')))
  const codexPlugin = Object.keys(codexTables).filter(name => /^plugins\."edge-cms@/.test(name) && !/enabled\s*=\s*false/.test(codexTables[name]))
  add(codexPlugin.length === 0, 'No edge-cms plugin in Codex', codexPlugin.length ? `remove [${codexPlugin.join('], [')}] from ~/.codex/config.toml` : '')

  // 4. User-level servers that reach a Hub load in every repository.
  const codexServers = Object.keys(codexTables)
    .filter(name => /^mcp_servers\.[^.]+$/.test(name))
    .filter(name => CMS_HINT.test(name) || CMS_HINT.test(codexTables[name]) || CMS_HINT.test(codexTables[`${name}.env`] ?? ''))
    .filter(name => !/enabled\s*=\s*false/.test(codexTables[name]))
  add(codexServers.length === 0, 'No Hub servers in ~/.codex/config.toml',
    codexServers.length ? `remove [${codexServers.join('], [')}]; each Hub's .codex/config.toml supplies its own` : '')

  const claudeJson = readJson(path.join(home, '.claude.json')) ?? {}
  const claudeServers = Object.entries(claudeJson.mcpServers ?? {})
    .filter(([name, config]) => CMS_HINT.test(name) || CMS_HINT.test(JSON.stringify(config)))
    .map(([name]) => name)
  add(claudeServers.length === 0, 'No Hub servers in ~/.claude.json', claudeServers.length ? `remove ${claudeServers.join(', ')} (claude mcp remove <name> -s user)` : '')

  // 5. claude.ai connectors and plugin servers, as the CLI sees them.
  if (claudeMcpList === null)
    add('warn', 'claude.ai connectors not checked', 'run without --offline, with the claude CLI on PATH')
  else {
    const remote = claudeMcpList.split('\n').filter(line => /cms-agentMcp|^plugin:edge-cms:/.test(line)).map(line => line.split(':').slice(0, line.startsWith('plugin:') ? 3 : 1).join(':'))
    add(remote.length === 0, 'No remote CMS connector or edge-cms plugin server', remote.length ? `remove ${remote.join(', ')} in claude.ai Settings, Connectors (or the plugin)` : '')
  }

  // 6. The Hub's own CMS servers: the person's Hub connection and Google
  // sign-in (edge/tools/mcp/cms/README.md, Credentials), renderer checkout, Node.
  const servers = Object.entries(readJson(path.join(hubRoot, '.mcp.json'))?.mcpServers ?? {})
    .filter(([, config]) => /tools\/mcp\/cms\/launch\.sh/.test(JSON.stringify(config.args ?? [])))
  if (!servers.length) add(false, 'The Hub starts its CMS server', '.mcp.json has no server using edge/tools/mcp/cms/launch.sh')
  const adcFile = env.GOOGLE_APPLICATION_CREDENTIALS || path.join(home, '.config/gcloud/application_default_credentials.json')
  let signInChecked = false
  for (const [name, server] of servers) {
    const configFile = server.env?.EDGE_CMS_MCP_CONFIG
    const config = configFile ? readJson(path.resolve(hubRoot, configFile)) ?? {} : {}
    if (config.requireEmulator || server.env?.FIRESTORE_EMULATOR_HOST) continue
    const connection = config.agentConnectionFile
    if (connection) {
      const found = existsSync(expandHome(connection, home))
      add(found, `Hub connection for ${name}`, found ? '' : `missing ${connection}: in the Hub open Agent keys (/app/dashboard/agent-keys), create a Hub connection for you and this computer, and save its credential to that file (chmod 600)`)
    }
    const key = server.env?.EDGE_CMS_MCP_CREDENTIALS || config.credentialsFile
    if (key) {
      const found = existsSync(expandHome(key, home))
      add(found, `Key file for ${name}`, found ? '' : `missing ${key}: remove it from the Hub's config to read as your Google sign-in, or install the key`)
      continue
    }
    if (!signInChecked) {
      signInChecked = true
      add(existsSync(adcFile), 'Google sign-in for database reads', existsSync(adcFile) ? '' : 'run gcloud auth application-default login with the Google account that has access to the Hubs\' Firebase projects')
    }
    if (probeRead && existsSync(adcFile) && config.projectId) {
      const error = await probeRead(config.projectId)
      add(!error, `Your Google sign-in can read ${config.projectId}`, error ? `${error}. Ask for access to the ${config.projectId} Firebase project, or run gcloud auth application-default login with the account that has it` : '')
    }
  }
  const main = mainCheckout(hubRoot)
  const renderer = env.EDGE_CMS_RENDERER_REPO || path.join(main, '..', 'emd-cms-front')
  add(existsSync(renderer) ? true : 'warn', 'emd-cms-front checkout for the CMS server', existsSync(renderer) ? '' : `missing ${renderer}: clone emd-cms-front there, or set EDGE_CMS_RENDERER_REPO`)
  const nvmrc = read(path.join(hubRoot, '.nvmrc')).replace(/[\sv]/g, '')
  if (nvmrc) {
    const node = path.join(home, '.nvm/versions/node', `v${nvmrc}`, 'bin/node')
    add(existsSync(node) ? true : 'warn', `Node ${nvmrc} (.nvmrc) installed with nvm`, existsSync(node) ? '' : `nvm install ${nvmrc}`)
  }
  if (!existsSync(path.join(main, 'edge/tools/mcp/cms/node_modules')))
    add('warn', 'CMS server dependencies installed', `launch.sh installs them on first start, or run npm --prefix edge/tools/mcp/cms install in ${main}`)
  return results
}

// The main checkout (worktrees share its node_modules and renderer path).
function mainCheckout(hubRoot) {
  const dotGit = path.join(hubRoot, '.git')
  const text = read(dotGit)
  const gitdir = text.match(/^gitdir:\s*(.+)$/m)?.[1]
  if (!gitdir) return hubRoot
  const common = path.resolve(hubRoot, gitdir, read(path.join(path.resolve(hubRoot, gitdir), 'commondir')).trim() || '..')
  return path.dirname(common)
}

// Reads the project's root collection list as the Google sign-in, with the
// CMS server's own firebase-admin. Resolves to null, or the error message.
const PROBE = `
const [packageJson, projectId] = process.argv.slice(1)
const admin = require('node:module').createRequire(packageJson)('firebase-admin')
admin.initializeApp({ projectId })
admin.firestore().listCollections().then(() => process.exit(0), (error) => {
  console.error(String(error.message || error).split('\\n')[0])
  process.exit(1)
})`
const probeProject = hubRoot => projectId => new Promise((resolve) => {
  const packageJson = path.join(mainCheckout(hubRoot), 'edge/tools/mcp/cms/package.json')
  if (!existsSync(path.join(path.dirname(packageJson), 'node_modules')))
    return resolve(null)
  execFile(process.execPath, ['-e', PROBE, packageJson, projectId], { timeout: 45000 },
    (error, _stdout, stderr) => resolve(error ? (String(stderr).trim() || error.message).slice(0, 200) : null))
})

const claudeList = () => new Promise(resolve => {
  execFile('claude', ['mcp', 'list'], { timeout: 90000, maxBuffer: 4 << 20 }, (error, stdout) => resolve(error && !stdout ? null : stdout))
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const offline = process.argv.includes('--offline')
  const results = await runChecks({ hubRoot, claudeMcpList: offline ? null : await claudeList(), probeRead: offline ? null : probeProject(hubRoot) })
  for (const r of results)
    console.log(`${r.ok === true ? 'ok  ' : r.ok === 'warn' ? 'warn' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  const failed = results.filter(r => r.ok === false).length
  console.log(failed ? `\n${failed} check(s) failed.` : '\nNo failures.')
  console.log('Also check one new session per client: only this Hub\'s CMS servers, and each Edge skill once, without an edge-cms: prefix.')
  process.exit(failed ? 1 : 0)
}
