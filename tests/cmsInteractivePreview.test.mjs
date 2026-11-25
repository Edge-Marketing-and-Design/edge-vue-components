import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveDataSource, renderTemplateAsync } from '@edgedev/template-engine'
import { distinctSourceRecords, loadBlockSources } from '../lib/cmsDataSourceRecords.js'
import { prepareCmsCollectionPreview } from '../lib/cmsCollectionPreview.js'

const emptyKv = { binding: { get: async () => null, list: async () => ({ keys: [], list_complete: true }) } }

test('emulator distinct values match the published engine, including arrays, missing and non-scalar values', async () => {
  const records = [{ values: ['MT', 'ID', '', null, {}] }, { values: ['MT', 'WA', false, 2] }, {}, { values: { bad: true } }]
  const expected = await resolveDataSource({ name: 'choices', source: { value: records, distinct: 'values' }, clientOptions: emptyKv })
  assert.deepEqual(distinctSourceRecords(records, 'values'), expected)
  assert.deepEqual(distinctSourceRecords([{ office: { state: 'MT' } }], 'office.state'), ['MT'])
  assert.throws(() => distinctSourceRecords([], '__proto__.name'), /safe field path/)
})

test('legacy canvas meta uses resolveDataSource to retain distinct in KV mode', async () => {
  let called = 0
  const loaded = await loadBlockSources({
    block: { templateVersion: 1, meta: { states: { type: 'array', collection: { path: 'agents', uniqueKey: 'org' }, distinct: 'officeStates' } } },
    orgId: 'org', kvOptions: {},
    engine: {
      resolveDataSource: async ({ source }) => { called++; assert.equal(source.distinct, 'officeStates'); return ['ID', 'MT'] },
      hydrateValues: async () => { throw Error('Legacy hydration loses distinct') },
    },
  })
  assert.equal(called, 1)
  assert.deepEqual(loaded.values.states, ['ID', 'MT'])
  assert.equal(loaded.sources[0].loadedFrom, 'kv')
})

test('emulator source loading returns scalar choices instead of agent records', async () => {
  const records = [{ officeStates: ['MT', 'ID'] }, { officeStates: ['MT'] }]
  const ref = { limit: () => ref, get: async () => ({ docs: records.map((data, index) => ({ id: String(index), data: () => data })) }) }
  const result = await loadBlockSources({ block: { templateVersion: 1, meta: { states: { collection: { path: 'agents' }, distinct: 'officeStates' } } }, orgId: 'org', db: { collection: () => ref } })
  assert.deepEqual(result.values.states, ['ID', 'MT'])
})

const source = (rows) => ({ value: rows, query: [{ field: 'agent', operator: '==', value: true }], order: [{ field: 'name', direction: 'asc' }], interactive: { fields: ['agent', 'name'], pageSize: 1, filters: { name: { default: '' } } } })
const template = '<select>{{{#collectionOptions {"source":"offices","label":"name","value":"docId"} }}}</select>{{{#collectionResults {"source":"agents"} }}}<div>{{#for agent in items}}<h3>{{ agent.name }}</h3>{{/for}}{{{#if {"cond":"item.total == 0"} }}}Empty{{{/if}}}</div>{{{/collectionResults}}}'
const render = async (rows, offices = []) => {
  const preview = await prepareCmsCollectionPreview(template, { agents: source(rows), offices: { value: offices } })
  return preview.restore(await renderTemplateAsync(preview.template, { sensitive: 'OUTER_SCOPE_SECRET', secret: 'OUTER_SCOPE_SECRET' }, {}, { templateVersion: 2, dataSources: preview.dataSources, hydrateOptions: null }))
}

test('canvas options and results render from already loaded records with native filtering, ordering and paging', async () => {
  const html = await render([{ name: 'Zed', agent: true }, { name: 'Amy', agent: true }, { name: 'Excluded', agent: false }], [{ name: '<Main>', docId: 'a"b' }])
  assert.match(html, /<h3>Amy<\/h3>/)
  assert.doesNotMatch(html, /Zed|Excluded|Empty|aria-busy="true"/)
  assert.match(html, /<option value="a&quot;b">&lt;Main&gt;<\/option>/)
  assert.match(html, /aria-busy="false"/)
})

test('empty collection snapshot renders its authored empty state', async () => {
  assert.match(await render([]), /Empty/)
})

test('generated helper HTML is not re-evaluated with the outer template scope', async () => {
  const html = await render([{ name: '{{ sensitive }}', agent: true }], [{ docId: 'x', name: '{{ secret }}' }])
  assert.doesNotMatch(html, /OUTER_SCOPE_SECRET/)
  assert.match(html, /\{\{ secret \}\}/)
})

test('source loader copies stay byte-identical', async () => {
  const shared = await readFile(new URL('../lib/cmsDataSourceRecords.js', import.meta.url), 'utf8')
  for (const path of ['../../functions/helpers/cmsDataSourceRecords.mjs', '../functions/helpers/cmsDataSourceRecords.mjs'])
    assert.equal(await readFile(new URL(path, import.meta.url), 'utf8'), shared)
})

test('a one-record source limit retains every distinct choice in its catalog', async () => {
  const loaded = await loadBlockSources({
    block: { templateVersion: 1, meta: { specialties: { collection: { path: 'agent-directory-options', uniqueKey: 'org', canonicalLookup: { key: 'org:default' } }, distinct: 'specialties', limit: 1 } } },
    orgId: 'org', kvOptions: {}, engine: { resolveDataSource: async () => ['Land', 'Ranch', 'Waterfront'] },
  })
  assert.deepEqual(loaded.values.specialties, ['Land', 'Ranch', 'Waterfront'])
  assert.equal(loaded.sources[0].truncated, false)
  const result = await loadBlockSources({
    block: { templateVersion: 1, meta: { specialties: { collection: { path: 'agent-directory-options', uniqueKey: 'org', canonicalLookup: { key: 'org:default' } }, distinct: 'specialties', limit: 1 } } },
    orgId: 'org', db: { doc: () => ({ get: async () => ({ id: 'default', exists: true, data: () => ({ specialties: ['Land', 'Ranch', 'Waterfront'] }) }) }) },
  })
  assert.deepEqual(result.values.specialties, ['Land', 'Ranch', 'Waterfront'])
  assert.equal(result.sources[0].truncated, false)
})

test('interactive default loading binds the fallback index and never sends literal filter placeholders', async () => {
  const engine = await import('@edgedev/template-engine')
  const { prepareInteractivePreviewSource } = await import('../lib/cmsDataSourceRecords.js')
  const source = { type: 'collection', path: 'agents', canonical: true, queryItems: [{ officeIds: '{filters.office}' }], query: [{ field: 'agent', operator: '==', value: true }], interactive: { fields: ['agent', 'officeIds'], filters: { office: { default: '' } }, fallbackQueryItems: { agent: true }, maxCandidates: 200 } }
  const input = prepareInteractivePreviewSource(source, engine)
  assert.deepEqual(input.queryItems, { agent: true })
  assert.deepEqual(input.query, [])
  assert.equal(JSON.stringify(input.queryItems).includes('{filters.'), false)
  assert.equal(input.limit, 200)
  assert.equal(input.canonical, true)
  assert.deepEqual(source.queryItems, [{ officeIds: '{filters.office}' }])
})

test('local preview loads canonical profiles when old deployed loader supplies metadata missing eligibility', async () => {
  const { prepareInteractivePreviewSource } = await import('../lib/cmsDataSourceRecords.js')
  const { hydrateCmsPreviewCandidates } = await import('../lib/cmsCollectionPreview.js')
  const engine = await import('@edgedev/template-engine')
  const original = { type: 'collection', path: 'agents', canonical: true, queryItems: [{ officeIds: '{filters.office}' }], query: [{ field: 'agent', operator: '==', value: true }], interactive: { fields: ['agent', 'officeIds', 'name'], filters: { office: { default: '' } }, fallbackQueryItems: { agent: true } } }
  const input = prepareInteractivePreviewSource(original, engine)
  let calls = 0
  const values = await hydrateCmsPreviewCandidates({ agents: [{ name: 'Sample Agent', canonical: 'agents:org:one' }] }, { agents: input }, async requests => {
    calls++
    assert.deepEqual(requests.agents.collection.canonicalLookup, { key: ['agents:org:one'] })
    assert.deepEqual(requests.agents.collection.query, [])
    return { agents: [{ name: 'Sample Agent', agent: true }] }
  }, { agents: original })
  assert.equal(calls, 1)
  const preview = await prepareCmsCollectionPreview('{{{#collectionResults {"source":"agents"} }}}{{#for agent in items}}<h3>{{ agent.name }}</h3>{{/for}}{{{#if {"cond":"item.total == 0"} }}}No matching agents{{{/if}}}{{{/collectionResults}}}', { agents: { ...original, value: values.agents } })
  const html = preview.restore(preview.template)
  assert.match(html, /Sample Agent/)
  assert.doesNotMatch(html, /No matching agents/)
  const unchanged = await hydrateCmsPreviewCandidates(values, { agents: input }, async () => { throw Error('Canonical records are already complete') }, { agents: original })
  assert.equal(unchanged, values)
})

test('actual legacy hydration plus the local compatibility path returns real matching cards', async () => {
  const engine = await import('@edgedev/template-engine')
  const { prepareInteractivePreviewSource } = await import('../lib/cmsDataSourceRecords.js')
  const { hydrateCmsPreviewCandidates } = await import('../lib/cmsCollectionPreview.js')
  const profiles = { 'agents:org:one': { name: 'One', agent: true }, 'agents:org:two': { name: 'Two', agent: true } }
  const binding = {
    list: async ({ prefix }) => ({ keys: Object.keys(profiles).map((key, index) => ({ name: `idx:agents:agent:org:true:${index}`, metadata: { canonical: key, name: profiles[key].name } })).filter(key => key.name.startsWith(prefix)), list_complete: true }),
    get: async key => Array.isArray(key) ? new Map(key.map(key => [key, profiles[key] ? JSON.stringify(profiles[key]) : null])) : (profiles[key] ? JSON.stringify(profiles[key]) : null),
  }
  const original = { type: 'collection', path: 'agents', canonical: true, queryItems: [{ officeIds: '{filters.office}' }], query: [{ field: 'agent', operator: '==', value: true }], interactive: { fields: ['agent', 'name', 'officeIds'], filters: { office: { default: '' } }, fallbackQueryItems: { agent: true } } }
  const normalized = prepareInteractivePreviewSource(original, engine)
  const meta = { agents: { ...normalized, type: 'array', collection: { path: 'agents', uniqueKey: 'org', query: [], order: [] } } }
  const legacyLoad = sources => engine.hydrateValues({ content: '{{{#array {"field":"agents"}}}}{{{/array}}}', meta: sources, values: {}, uniqueKey: 'org:site', clientOptions: { binding } })
  const metadata = await legacyLoad(meta)
  assert.equal(metadata.agents.length, 2)
  assert.equal(metadata.agents[0].agent, undefined)
  const full = await hydrateCmsPreviewCandidates(metadata, meta, legacyLoad, { agents: original })
  assert.equal(full.agents.length, 2)
  assert.equal(full.agents.every(row => row.agent === true), true)
  const preview = await prepareCmsCollectionPreview('{{{#collectionResults {"source":"agents"} }}}{{#for agent in items}}<h3>{{ agent.name }}</h3>{{/for}}{{{#if {"cond":"item.total == 0"} }}}No matching agents{{{/if}}}{{{/collectionResults}}}', { agents: { ...original, value: full.agents } })
  const html = preview.restore(preview.template)
  assert.match(html, /<h3>One<\/h3>/)
  assert.match(html, /<h3>Two<\/h3>/)
  assert.doesNotMatch(html, /No matching agents/)
})
