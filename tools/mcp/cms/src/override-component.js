// cms_override_component (local only): the emd-cms-front Vue component the
// public site renders for an override block, read from the renderer checkout
// the server uses (EDGE_CMS_RENDERER_REPO), with:
// - a field comparison: the values, meta and Data Sources the component reads
//   against the block's schema and sources;
// - whether the deployed public site has the component (its override
//   manifest) and whether the local file differs from the deployed commit.
// Reads only. Writing or changing a component is a task in emd-cms-front.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveOverrideFromComponents } from '../../../../lib/cmsAgentReads.js'

const execFileAsync = promisify(execFile)
const MAX_SOURCE_BYTES = 200 * 1024
const MANIFEST_TIMEOUT_MS = 5000
const PARTS = ['values', 'meta', 'dataSources']
const IDENTIFIER = '[A-Za-z_$][\\w$]*'
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

// What a component's source reads from its `block` prop, by part:
// block.values.x, props.block?.meta?.x, block.dataSources.x, and aliases
// such as `const values = computed(() => props.block?.values || {})` used as
// values.value.x (script) or values.x (template).
export function extractComponentReads(sources) {
  const reads = Object.fromEntries(PARTS.map(part => [part, new Set()]))
  let dynamic = false
  for (const source of sources) {
    const text = String(source || '')
    const direct = new RegExp(`\\bblock(?:\\.value)?\\??\\.(values|meta|dataSources)\\??\\.(${IDENTIFIER})`, 'g')
    for (const [, part, field] of text.matchAll(direct))
      reads[part].add(field)
    if (new RegExp(`\\bblock(?:\\.value)?\\??\\.(?:values|meta|dataSources)\\??\\.?\\[`).test(text))
      dynamic = true
    const aliases = new RegExp(`\\b(?:const|let)\\s+(${IDENTIFIER})\\s*=\\s*(?:computed\\(\\s*\\(\\)\\s*=>\\s*)?(?:props\\.)?block(?:\\.value)?\\??\\.(values|meta|dataSources)\\b`, 'g')
    for (const [, alias, part] of text.matchAll(aliases)) {
      for (const [, field] of text.matchAll(new RegExp(`(?<![\\w$.])${alias}(?:\\.value)?\\??\\.(${IDENTIFIER})`, 'g'))) {
        if (field !== 'value')
          reads[part].add(field)
      }
      if (new RegExp(`(?<![\\w$.])${alias}(?:\\.value)?\\??\\.?\\[`).test(text))
        dynamic = true
    }
  }
  return { ...Object.fromEntries(PARTS.map(part => [part, [...reads[part]].sort()])), dynamic }
}

// The block's fields: Template v2 schema keys (else the v1 values keys), and
// its sources (v2 dataSources, else v1 meta entries with a collection or api).
export function blockFields(block) {
  const v2 = Number(block?.templateVersion) === 2
  const values = Object.keys(v2 && isObject(block?.schema) ? block.schema : (isObject(block?.values) ? block.values : {}))
  const sources = v2
    ? Object.keys(isObject(block?.dataSources) ? block.dataSources : {})
    : Object.entries(isObject(block?.meta) ? block.meta : {}).filter(([, entry]) => isObject(entry) && (isObject(entry.collection) || typeof entry.api === 'string')).map(([name]) => name)
  return { templateVersion: v2 ? 2 : 1, values: values.sort(), sources: sources.sort() }
}

export function compareComponentFields(componentReads, block) {
  const fields = blockFields(block)
  const readSources = [...new Set([...componentReads.dataSources, ...componentReads.meta])]
  return {
    templateVersion: fields.templateVersion,
    componentReads: { values: componentReads.values, meta: componentReads.meta, dataSources: componentReads.dataSources },
    missingInBlock: {
      values: componentReads.values.filter(field => !fields.values.includes(field)),
      sources: readSources.filter(name => !fields.sources.includes(name)),
    },
    unusedByComponent: {
      values: fields.values.filter(field => !componentReads.values.includes(field)),
      sources: fields.sources.filter(name => !readSources.includes(name)),
    },
    note: componentReads.dynamic
      ? 'The component also reads fields by computed name (block.values[...]); those are not listed.'
      : 'Read from the component and the files it imports from its own folder; values reached another way (passed to a composable as a whole object, for example) are not listed.',
  }
}

// The component and the .js/.ts files it imports from its own folder.
async function readComponentSources(file) {
  const main = await readFile(file, 'utf8')
  const files = [{ file, source: main }]
  for (const [, specifier] of main.matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/g)) {
    for (const candidate of [specifier, `${specifier}.js`, `${specifier}.ts`]) {
      if (!/\.(?:js|ts|mjs)$/.test(candidate))
        continue
      try {
        files.push({ file: path.resolve(path.dirname(file), candidate), source: await readFile(path.resolve(path.dirname(file), candidate), 'utf8') })
        break
      }
      catch {}
    }
  }
  return files
}

export async function readOverrideManifest(url, { fetchImpl = globalThis.fetch } = {}) {
  if (!url)
    return { ok: false, status: 'unchecked', reason: 'No override manifest URL: set cmsRendererManifestUrl in the MCP config or CMS_RENDERER_MANIFEST_URL.' }
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS), headers: { accept: 'application/json' } })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body?.components))
      throw new Error('no components list')
    return { ok: true, url, commit: String(body.commit || '') || null, builtAt: String(body.builtAt || '') || null, components: body.components.filter(item => typeof item === 'string') }
  }
  catch (error) {
    return { ok: false, status: 'renderer-manifest-unavailable', reason: `The override manifest (${url}) could not be read: ${error?.message || error}.` }
  }
}

const defaultGit = async (cwd, args) => (await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim()

// Whether the local file is the deployed one: the same path in the manifest,
// and no commits or local changes to it since the deployed commit.
async function compareWithDeployed({ rendererRepoPath, relativePath, manifest, git }) {
  if (!manifest.ok)
    return { status: manifest.status, reason: manifest.reason }
  const repoPath = `app/blocks/${relativePath}`
  const deployed = manifest.components.includes(relativePath)
  const result = { deployed, deployedCommit: manifest.commit, builtAt: manifest.builtAt }
  try {
    result.localCommit = await git(rendererRepoPath, ['rev-parse', 'HEAD'])
    result.localChanges = Boolean(await git(rendererRepoPath, ['status', '--porcelain', '--', repoPath]))
    if (!manifest.commit) {
      result.sameAsDeployed = null
      result.reason = 'The manifest names no commit.'
    }
    else {
      try {
        await git(rendererRepoPath, ['cat-file', '-e', `${manifest.commit}^{commit}`])
        const changed = await git(rendererRepoPath, ['diff', '--name-only', manifest.commit, 'HEAD', '--', repoPath])
        result.sameAsDeployed = deployed && !changed && !result.localChanges
        if (changed)
          result.reason = 'The local checkout has commits to this file that are not deployed (or the deploy is newer than the checkout).'
      }
      catch {
        result.sameAsDeployed = null
        result.reason = `The deployed commit ${manifest.commit} is not in the local checkout: fetch emd-cms-front.`
      }
    }
  }
  catch (error) {
    result.sameAsDeployed = null
    result.reason = `git failed in ${rendererRepoPath}: ${error?.message || error}`
  }
  return result
}

export async function describeOverrideComponent({
  rendererRepoPath,
  orgId,
  block = null,
  blockName,
  themeName = '',
  listComponents,
  manifestUrl = '',
  fetchImpl = globalThis.fetch,
  git = defaultGit,
  rendererStatus = null,
}) {
  const components = await listComponents()
  const base = { rendererRepoPath, ...(rendererStatus ? { rendererCheckout: rendererStatus } : {}) }
  if (components === null)
    return { ok: false, status: 'renderer-repo-unavailable', message: `No emd-cms-front checkout at ${rendererRepoPath} (EDGE_CMS_RENDERER_REPO).`, ...base }
  const resolution = resolveOverrideFromComponents(components, { orgId, blockName, themeId: themeName, isOverrideBlock: block ? block.isOverrideBlock === true : null })
  const manifest = await readOverrideManifest(manifestUrl, { fetchImpl })
  const deployedResolution = manifest.ok ? resolveOverrideFromComponents(manifest.components, { orgId, blockName, themeId: themeName, isOverrideBlock: block ? block.isOverrideBlock === true : null }) : null
  const result = {
    ok: true,
    blockName,
    themeName: themeName || null,
    isOverrideBlock: block ? block.isOverrideBlock === true : null,
    status: resolution.status,
    candidateNames: resolution.candidateNames,
    matches: resolution.matches.map(match => match.relativePath),
    ...(resolution.unflaggedMatch ? { unflaggedMatch: resolution.unflaggedMatch } : {}),
    deployedSite: deployedResolution
      ? { status: deployedResolution.status, file: deployedResolution.selectedMatch?.relativePath || null, commit: manifest.commit, builtAt: manifest.builtAt }
      : { status: manifest.status, reason: manifest.reason },
    ...base,
  }
  const selected = resolution.selectedMatch
  if (!selected) {
    result.message = resolution.status === 'ambiguous-vue-override'
      ? 'Several components match this block; the public site cannot pick one. Rename one of them.'
      : 'No component in the local checkout matches this block: the public site would show its CMS HTML.'
    return result
  }
  const file = path.join(rendererRepoPath, 'app/blocks', selected.relativePath)
  const sources = await readComponentSources(file)
  const source = sources[0].source
  result.component = {
    file: selected.relativePath,
    scope: selected.scope || null,
    absolutePath: file,
    importsRead: sources.slice(1).map(entry => path.relative(path.join(rendererRepoPath, 'app/blocks'), entry.file).split(path.sep).join('/')),
    bytes: Buffer.byteLength(source),
    source: Buffer.byteLength(source) > MAX_SOURCE_BYTES ? Buffer.from(source).subarray(0, MAX_SOURCE_BYTES).toString('utf8') : source,
    sourceTruncated: Buffer.byteLength(source) > MAX_SOURCE_BYTES,
  }
  if (block)
    result.fields = compareComponentFields(extractComponentReads(sources.map(entry => entry.source)), block)
  else
    result.fields = { componentReads: extractComponentReads(sources.map(entry => entry.source)), note: 'No library block was given (docId): nothing to compare the fields with.' }
  result.deployment = await compareWithDeployed({ rendererRepoPath, relativePath: selected.relativePath, manifest, git })
  return result
}
