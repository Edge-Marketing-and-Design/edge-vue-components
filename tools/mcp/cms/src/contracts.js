import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describeContract } from '../../../../lib/cmsAgentMcpTools.js'

// The data contracts an agent writes against, read from the Hub checkout the
// server runs in (the same root that resolves the renderer path). Nothing is
// copied anywhere else: the file under docs/data-contracts is the contract.
// Add a kind here when a new agent-facing contract lands.
export const CONTRACT_KINDS = Object.freeze({
  'blocks': 'docs/data-contracts/cms-blocks/README.md',
  'operations': 'docs/data-contracts/cms-operations/README.md',
  'themes': 'docs/data-contracts/cms-themes/README.md',
  'sites-and-pages': 'docs/data-contracts/cms-sites-and-pages/README.md',
  'posts': 'docs/data-contracts/cms-posts/README.md',
  'webcams': 'docs/data-contracts/webcams/README.md',
})

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
export async function readContract({ kind, section = '', repoRoot, rendererRoot, readFileImpl = readFile }) {
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
  const absolutePath = path.resolve(repoRoot, relativePath)
  let markdown
  try {
    markdown = await readFileImpl(absolutePath, 'utf8')
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: false,
        code: 'missing',
        message: `The ${key} contract is not in this checkout (${relativePath}). Pull the Hub branch that carries it.`,
        kind: key,
        path: relativePath,
      }
    }
    throw error
  }
  return describeContract(key, relativePath, markdown, section)
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
