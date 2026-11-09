import { collectionContract, collectionSelection, filterCollectionCandidates, prepareCollectionTemplate, renderTemplateAsync } from '@edgedev/template-engine'

const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fieldAt = (record, path) => {
  if (typeof path !== 'string' || !/^[\w-]+(?:\.[\w-]+)*$/.test(path) || path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key)))
    throw new Error('Invalid collection preview option field')
  return path.split('.').reduce((value, key) => value != null && Object.hasOwn(value, key) ? value[key] : undefined, record)
}

// Render the initial snapshot with records the Hub already authorized and loaded.
// Keep generated HTML out of the surrounding template parser; record contents
// must never become a second authored template. No browser state/API is installed.
export async function prepareCmsCollectionPreview(template, dataSources = {}) {
  const prepared = prepareCollectionTemplate(template, dataSources)
  const fragments = []
  const stash = (html) => {
    const marker = `\uE000CMS_COLLECTION_PREVIEW_${fragments.length}\uE001`
    fragments.push(html)
    return marker
  }
  const pattern = /\{\{\{#collection(Results|Options)\s+(\{[^\n]*?\})\s*\}\}\}/g
  let output = '', last = 0
  for (const match of prepared.template.matchAll(pattern)) {
    output += prepared.template.slice(last, match.index)
    last = match.index + match[0].length
    const declaration = JSON.parse(match[2])
    const source = prepared.dataSources[declaration.source]
    if (!source)
      throw new Error('Unknown collection preview source')
    const rows = Array.isArray(source.value) ? source.value : []
    if (match[1] === 'Options') {
      // Validate paths even for an empty collection.
      fieldAt({}, declaration.label)
      fieldAt({}, declaration.value)
      output += stash(rows.map(row => `<option value="${escape(fieldAt(row, declaration.value))}">${escape(fieldAt(row, declaration.label))}</option>`).join(''))
    }
    else {
      const config = collectionContract(source)
      const selection = collectionSelection(config)
      const result = filterCollectionCandidates(rows, config, selection)
      const html = await renderTemplateAsync(config.template, result, {}, { templateVersion: 2 })
      output += stash(`<div data-cms-collection-results="${escape(declaration.source)}" aria-busy="false">${html}</div>`)
    }
  }
  output += prepared.template.slice(last)
  return {
    template: output,
    dataSources: prepared.dataSources,
    restore: html => html.replace(/\uE000CMS_COLLECTION_PREVIEW_(\d+)\uE001/g, (_, index) => fragments[Number(index)]),
  }
}

// Older deployed loaders hydrate only a singleton index result. Ask the same
// authorized loader for an explicit canonical batch when an interactive list
// still contains metadata without its required query fields. No private client
// KV credentials and no invented eligibility fields are introduced.
export async function hydrateCmsPreviewCandidates(values, sources, load, definitions = sources) {
  const requests = {}
  for (const [name, source] of Object.entries(sources || {})) {
    if (!source?.interactive || source.canonical !== true)
      continue
    const rows = Array.isArray(values?.[name]) ? values[name] : []
    const definition = definitions[name] || source
    const config = collectionContract({ ...definition, interactive: { ...definition.interactive, template: definition.interactive.template || '<span></span>' } })
    const selection = collectionSelection(config)
    const query = config.query.filter((entry) => {
      const names = [...JSON.stringify(entry).matchAll(/\{filters\.([\w-]+)\}/g)].map(match => match[1])
      return names.every(name => Array.isArray(selection[name]) ? selection[name].length > 0 : Boolean(selection[name]))
    }).map(entry => entry.field)
    const needsRecords = rows.some(row => typeof row?.canonical === 'string'
      && query.some(path => fieldAt(row, path) === undefined))
    if (!needsRecords)
      continue
    const keys = [...new Set(rows.map(row => row?.canonical).filter(key => typeof key === 'string' && key))]
    if (!keys.length)
      continue
    requests[name] = {
      ...source,
      canonicalLookup: { key: keys },
      collection: { ...source.collection, canonicalLookup: { key: keys }, query: [], order: [] },
      queryItems: {},
      query: [],
      order: [],
      limit: keys.length,
    }
  }
  if (!Object.keys(requests).length)
    return values
  const resolved = await load(requests)
  return { ...values, ...resolved }
}
