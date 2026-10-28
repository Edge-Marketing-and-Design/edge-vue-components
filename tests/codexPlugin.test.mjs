import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The Codex package of edge-cms, checked against the rules Codex applies when
// it loads a plugin (openai/codex codex-rs: core-plugins/src/manifest.rs,
// codex-mcp/src/plugin_config.rs, config/src/mcp_types.rs, as of 2026-10-28).
// A real Codex install is checked only at Codex setup.
const root = fileURLToPath(new URL('../plugins/edge-cms/', import.meta.url))
const readJson = async file => JSON.parse(await readFile(`${root}${file}`, 'utf8'))
const MANIFEST_FIELDS = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills', 'mcpServers', 'apps', 'hooks', 'interface', 'extensions']
const INTERFACE_FIELDS = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'websiteURL', 'privacyPolicyURL', 'termsOfServiceURL', 'defaultPrompt', 'brandColor', 'composerIcon', 'logo', 'logoDark', 'screenshots']
// The HTTP fields of Codex's MCP server config, which refuses unknown fields.
const HTTP_SERVER_FIELDS = ['type', 'url', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'http_headers_helper', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'scopes', 'oauth', 'oauth_resource']
// Manifest paths must start with ./ and stay inside the plugin.
const pluginPath = (value) => {
  assert.match(value, /^\.\/./, `${value} must start with ./`)
  assert.ok(!value.split('/').includes('..'), `${value} must stay inside the plugin`)
  return `${root}${value.slice(2)}`
}

test('the Codex manifest uses only fields Codex reads, with valid paths and prompts', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json')
  const claude = await readJson('.claude-plugin/plugin.json')
  assert.deepEqual(Object.keys(manifest).filter(key => !MANIFEST_FIELDS.includes(key)), [])
  assert.equal(manifest.name, claude.name, 'one plugin name for both clients')
  assert.match(manifest.name, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
  assert.equal(manifest.description, claude.description)
  assert.ok(existsSync(pluginPath(manifest.skills)))
  assert.ok(existsSync(pluginPath(manifest.mcpServers)))
  assert.deepEqual(Object.keys(manifest.interface).filter(key => !INTERFACE_FIELDS.includes(key)), [])
  assert.ok(manifest.interface.displayName)
  assert.ok(manifest.interface.defaultPrompt.length <= 3)
  for (const prompt of manifest.interface.defaultPrompt)
    assert.ok(prompt.length <= 128, prompt)
})

test('Codex gets the same skills as the Claude plugin', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json')
  const skills = (await readdir(pluginPath(manifest.skills), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(skills, ['edge-block-package', 'edge-design-to-site', 'edge-figma-design', 'vue-to-block-migrator'])
  for (const skill of skills) {
    const text = await readFile(`${pluginPath(manifest.skills)}${skill}/SKILL.md`, 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] || ''
    const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1].trim()
    const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1].trim()
    assert.equal(name, skill)
    assert.ok(name.length <= 64)
    assert.ok(description && description.length <= 1024, `${skill} description`)
  }
})

// Codex's server config refuses the Claude-only headersHelper, so Codex has
// its own file, and signs in with OAuth (its client id is on the Hub's
// allowlist in cmsAgentOAuth.js) instead of reading the credential file.
test('the Codex MCP file declares the same Hub server with OAuth and no credential', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json')
  const codex = (await readJson(manifest.mcpServers.slice(2))).mcpServers
  const claude = (await readJson('.mcp.json')).mcpServers
  assert.deepEqual(Object.keys(codex), Object.keys(claude))
  const server = codex['edge-cms']
  assert.deepEqual(Object.keys(server).filter(key => !HTTP_SERVER_FIELDS.includes(key)), [])
  assert.equal(server.type, 'http')
  assert.equal(server.url, claude['edge-cms'].url.replace(/^\$\{EDGE_CMS_HUB_URL:-(.+)\}$/, '$1'))
  assert.equal(server.oauth_resource, server.url)
  assert.deepEqual(server.scopes, ['cms-drafts'])
  assert.equal(server.bearer_token_env_var, undefined)
  assert.equal(server.http_headers, undefined)
})
