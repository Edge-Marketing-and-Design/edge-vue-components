#!/usr/bin/env node
// Renders the Template v2 condition cases with the template engine this Hub
// installs and the one emd-cms-front installs (next to the Hub's main
// checkout), so the condition rule in the documents is checked against the
// engine rather than read. Run from a Hub checkout:
//   node edge/skills/edge-skill-impact/scripts/probe-conditions.mjs
// Prints, per engine, what each case renders empty and filled. The rule the
// documents state (blocks contract "Template v2 grammar the engine
// supports", edge-block-package template-v2-contract.md) must match.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mainCheckout, repoRoot, siblingRoot } from './impact.mjs'

export const CONDITION_CASES = [
  {
    id: 'top-level-item',
    template: '{{{#if {"cond":"item.attribution"} }}}<figcaption>{{ attribution }}</figcaption>{{{#else}}}<p>else</p>{{{/if}}}',
    empty: { attribution: '' },
    filled: { attribution: 'Photo: A. Person' },
  },
  {
    id: 'top-level-bare',
    template: '{{{#if {"cond":"attribution"} }}}<figcaption>{{ attribution }}</figcaption>{{{#else}}}<p>else</p>{{{/if}}}',
    empty: { attribution: '' },
    filled: { attribution: 'Photo: A. Person' },
  },
  {
    id: 'loop-item-schema-field',
    template: '{{#for post in posts}}{{{#if {"cond":"item.eyebrow"} }}}<span>{{ eyebrow }}</span>{{{#else}}}<p>else</p>{{{/if}}}{{/for}}',
    empty: { eyebrow: '', posts: [{ title: 'One' }] },
    filled: { eyebrow: 'News', posts: [{ title: 'One' }] },
  },
]

// Where an engine lives: the Hub (main checkout's node_modules when this is a
// worktree) and emd-cms-front.
export const engineLocations = (root) => {
  const candidates = [
    { name: 'hub', dir: root },
    { name: 'hub (main checkout)', dir: mainCheckout(root) },
    { name: 'emd-cms-front', dir: path.join(siblingRoot(root), 'emd-cms-front') },
  ]
  const found = []
  const seen = new Set()
  for (const { name, dir } of candidates) {
    const pkg = path.join(dir, 'node_modules/@edgedev/template-engine/package.json')
    if (!existsSync(pkg) || seen.has(pkg))
      continue
    seen.add(pkg)
    found.push({ name, pkg, version: JSON.parse(readFileSync(pkg, 'utf8')).version })
  }
  return found
}

const loadEngine = async (pkg) => {
  const require = createRequire(pkg)
  return import(pathToFileURL(require.resolve('@edgedev/template-engine')).href)
}

export const probeConditions = async (engine) => {
  const results = []
  for (const probe of CONDITION_CASES) {
    const render = values => engine.renderTemplateAsync(probe.template, values, {}, { templateVersion: 2 }).then(html => String(html).replace(/\s+/g, ' ').trim()).catch(error => `error: ${error.message}`)
    results.push({ id: probe.id, empty: await render(probe.empty), filled: await render(probe.filled) })
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot()
  const locations = engineLocations(root)
  if (!locations.length) {
    console.error('No @edgedev/template-engine found in this checkout, its main checkout or emd-cms-front. Install dependencies first.')
    process.exit(1)
  }
  for (const location of locations) {
    console.log(`\n${location.name}: @edgedev/template-engine ${location.version}`)
    for (const result of await probeConditions(await loadEngine(location.pkg)))
      console.log(`- ${result.id}: empty -> ${result.empty} | filled -> ${result.filled}`)
  }
}
