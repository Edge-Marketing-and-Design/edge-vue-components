import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describeContract } from '../../../../lib/cmsAgentMcpTools.js'
import { withGeneratedValidation } from '../../../../lib/cmsBlockValidation.js'
import { withGeneratedContract } from '../../../../lib/cmsOperations.js'

// The data contracts an agent writes against, read from the Hub checkout the
// server runs in (the same root that resolves the renderer path). The CMS
// contracts are shared Edge documents under edge/docs/data-contracts; a Hub
// may add its own notes in docs/data-contracts/<folder>/hub.md, served after
// the shared text as a "This Hub" section. Hub-only kinds (webcams) live in
// the Hub's docs/data-contracts. Add a kind here when a new agent-facing
// contract lands.
export const CONTRACT_KINDS = Object.freeze({
  'blocks': 'edge/docs/data-contracts/cms-blocks/README.md',
  'operations': 'edge/docs/data-contracts/cms-operations/README.md',
  'themes': 'edge/docs/data-contracts/cms-themes/README.md',
  'sites-and-pages': 'edge/docs/data-contracts/cms-sites-and-pages/README.md',
  'posts': 'edge/docs/data-contracts/cms-posts/README.md',
  'webcams': 'docs/data-contracts/webcams/README.md',
})

export const HUB_SECTION = 'This Hub'

// The Hub's additions to a shared contract, or null for a Hub-only kind.
export const hubAdditionPath = (relativePath) => {
  const match = String(relativePath || '').match(/^edge\/docs\/data-contracts\/([a-z-]+)\/README\.md$/)
  return match ? `docs/data-contracts/${match[1]}/hub.md` : null
}

// The public renderer's Template v2 guide, read from the emd-cms-front
// checkout (cmsRendererRepoPath) rather than the Hub.
export const RENDERER_KIND = 'renderer'
export const RENDERER_GUIDE = 'docs/cms-template-v2-blocks.md'

export const contractKinds = () => [...Object.keys(CONTRACT_KINDS), RENDERER_KIND]

export const contractPath = (kind) => {
  const key = String(kind || '').trim().toLowerCase()
  return CONTRACT_KINDS[key] || null
}

// Returns the contract's Markdown with its title, its `Last verified` line
// and the path it was read from. An unknown kind lists the known ones instead
// of throwing, so the caller sees what it can ask for.
export async function readContract({ kind, section = '', repoRoot, rendererRoot, readFileImpl = readFile, notes = {} }) {
  const key = String(kind || '').trim().toLowerCase()
  if (key === RENDERER_KIND)
    return readRendererGuide({ section, rendererRoot, readFileImpl })
  const relativePath = contractPath(key)
  if (!relativePath) {
    return {
      ok: false,
      code: 'unknown-kind',
      message: `Unknown contract kind "${kind}". Known kinds: ${contractKinds().join(', ')}.`,
      kinds: contractKinds(),
    }
  }
  const composed = await composeContract({ kind: key, repoRoot, readFileImpl })
  if (!composed.ok)
    return composed
  // Generated sections: document fields and operations from the shared CMS
  // code, block validation codes from the validator.
  return describeContract(key, composed.path, withGeneratedContract(withGeneratedValidation(composed.markdown), notes), section)
}

// The contract's Markdown as this Hub serves it: the shared text, then the
// Hub's additions under "## This Hub" when it has them. `path` names every
// file read. The sync script bundles this same text for the remote MCP.
export async function composeContract({ kind, repoRoot, readFileImpl = readFile }) {
  const key = String(kind || '').trim().toLowerCase()
  const relativePath = contractPath(key)
  if (!relativePath)
    return { ok: false, code: 'unknown-kind', message: `Unknown contract kind "${kind}".`, kind: key }
  const read = async (file) => {
    try {
      return await readFileImpl(path.resolve(repoRoot, file), 'utf8')
    }
    catch (error) {
      if (error?.code === 'ENOENT')
        return null
      throw error
    }
  }
  const markdown = await read(relativePath)
  if (markdown === null) {
    return {
      ok: false,
      code: 'missing',
      message: `The ${key} contract is not in this checkout (${relativePath}). Pull the Hub branch that carries it.`,
      kind: key,
      path: relativePath,
    }
  }
  const additionPath = hubAdditionPath(relativePath)
  const addition = additionPath ? await read(additionPath) : null
  if (!addition?.trim())
    return { ok: true, kind: key, path: relativePath, markdown }
  return {
    ok: true,
    kind: key,
    path: `${relativePath} + ${additionPath}`,
    markdown: `${markdown.trimEnd()}\n\n## ${HUB_SECTION}\n\n${addition.trim()}\n`,
  }
}

async function readRendererGuide({ section, rendererRoot, readFileImpl }) {
  const relativePath = `emd-cms-front:${RENDERER_GUIDE}`
  let markdown
  try {
    markdown = await readFileImpl(path.resolve(rendererRoot || '', RENDERER_GUIDE), 'utf8')
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: false,
        code: 'missing',
        message: `The renderer guide is not in the emd-cms-front checkout this server uses (${rendererRoot || 'not configured'}). Set cmsRendererRepoPath or EDGE_CMS_RENDERER_REPO.`,
        kind: RENDERER_KIND,
        path: relativePath,
      }
    }
    throw error
  }
  return describeContract(RENDERER_KIND, relativePath, markdown, section)
}
