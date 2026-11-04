import assert from 'node:assert/strict'
import test from 'node:test'
import { collectInstanceDocuments, compareInstances, firstDifference, normalizeHtml } from '../src/compare-instances.js'

// The Hub's engine, resolved from the Hub checkout's node_modules.
const { pageRender } = await import('@edgedev/template-engine')

// Expected results below are written by hand from the fixtures, not taken
// from earlier runs.
const ORG = 'org1'
const page = (siteId, collection, docId, content) => ({ siteId, collection, docId, name: docId, data: { content } })
const compare = input => compareInstances({ orgId: ORG, blockId: 'hero', pageRender, ...input })

const V1_HERO = {
  content: '<section><h2>{{{#text {"field":"title","value":"Default title"}}}}</h2></section>',
  values: { title: '' },
  meta: {},
}
const V2_HERO = {
  content: '<section><h2>{{{#text {"field":"title","value":"Default title"}}}}</h2></section>',
  template: '<section><h2>{{ title }}</h2></section>',
  templateVersion: 2,
  schema: { title: { type: 'text', label: 'Title', value: 'Default title' } },
  dataSources: {},
  values: {},
  meta: {},
}

test('v1 to v2: the converted template renders every instance the same', async () => {
  const instance = values => ({ id: `i-${JSON.stringify(values)}`, blockId: 'hero', ...V1_HERO, values })
  const documents = [
    page('s1', 'pages', 'home', [instance({ title: 'Hello' })]),
    page('s1', 'published', 'home', [instance({ title: 'Hello' })]),
    // Never saved a title: v1's inline default and v2's schema default agree.
    page('s2', 'pages', 'about', [instance({})]),
  ]
  const result = await compare({ library: V1_HERO, proposed: V2_HERO, documents })
  assert.deepEqual(result.counts, { instances: 3, distinctRenders: 2, rendered: 2, identical: 3, different: 0, failed: 0, unchecked: 0 })
  assert.deepEqual(result.differences, [])
  assert.deepEqual(result.bySite.map(({ siteId, collection, instances, distinctRenders, identical }) => [siteId, collection, instances, distinctRenders, identical]), [
    ['s1', 'pages', 1, 1, 1],
    ['s1', 'published', 1, 1, 1],
    ['s2', 'pages', 1, 1, 1],
  ])
  assert.equal(result.driftedCopies.count, 0)
})

test('v2 to v2: a markup change is reported for each instance with an excerpt', async () => {
  const proposed = { ...V2_HERO, template: '<section class="hero"><h2>{{ title }}</h2></section>' }
  const documents = [page('s1', 'pages', 'home', [{ id: 'a', blockId: 'hero', ...V2_HERO, values: { title: 'Hello' } }])]
  const result = await compare({ library: V2_HERO, proposed, documents })
  assert.equal(result.counts.different, 1)
  assert.equal(result.counts.identical, 0)
  assert.equal(result.differences.length, 1)
  const [difference] = result.differences
  assert.equal(difference.siteId, 's1')
  assert.equal(difference.docId, 'home')
  assert.equal(difference.instanceId, 'a')
  assert.equal(difference.at, '<section'.length)
  assert.equal(difference.before, '<section><h2>Hello</h2></section>')
  assert.equal(difference.after, '<section class="hero"><h2>Hello</h2></section>')
})

test('an instance with a drifted markup copy is listed and rendered from its own copy', async () => {
  const older = { ...V2_HERO, template: '<section><h3>{{ title }}</h3></section>' }
  const documents = [
    page('s1', 'pages', 'home', [{ id: 'current', blockId: 'hero', ...V2_HERO, values: { title: 'A' } }]),
    page('s1', 'pages', 'old', [{ id: 'drifted', blockId: 'hero', ...older, values: { title: 'A' } }]),
  ]
  // The proposal is the released definition itself: only the drifted copy
  // changes.
  const result = await compare({ library: V2_HERO, proposed: V2_HERO, documents })
  assert.equal(result.driftedCopies.count, 1)
  assert.deepEqual(result.driftedCopies.instances, [{ siteId: 's1', collection: 'pages', docId: 'old', docName: 'old', instanceId: 'drifted' }])
  assert.equal(result.counts.identical, 1)
  assert.equal(result.counts.different, 1)
  assert.equal(result.differences[0].instanceId, 'drifted')
  assert.match(result.differences[0].before, /<h3>A<\/h3>/)
  assert.match(result.differences[0].after, /<h2>A<\/h2>/)
})

test('values in a field the proposed schema drops are listed', async () => {
  const library = { ...V2_HERO, template: '<section><h2>{{ title }}</h2><p>{{ subtitle }}</p></section>', schema: { ...V2_HERO.schema, subtitle: { type: 'text', value: '' } } }
  const documents = [
    page('s1', 'pages', 'a', [{ id: 'x', blockId: 'hero', ...library, values: { title: 'T', subtitle: 'kept text' } }]),
    page('s1', 'pages', 'b', [{ id: 'y', blockId: 'hero', ...library, values: { title: 'T', subtitle: '' } }]),
  ]
  const result = await compare({ library, proposed: V2_HERO, documents })
  assert.deepEqual(result.removedFieldValues, [{ field: 'subtitle', instances: 1, examples: [{ siteId: 's1', collection: 'pages', docId: 'a', docName: 'a', instanceId: 'x' }] }])
  // The filled subtitle disappears; the empty one renders an empty <p>,
  // which is gone too.
  assert.equal(result.counts.different, 2)
})

test('a Data Source block gets the same records on both sides, cut to each instance\'s limit', async () => {
  const library = {
    template: '<ul>{{#for post in source("posts")}}<li>{{ post.title }}</li>{{/for}}</ul>',
    templateVersion: 2,
    schema: {},
    dataSources: { posts: { type: 'collection', path: 'posts', limit: 3 } },
    values: {},
    meta: {},
  }
  const records = { posts: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] }
  const instance = (id, meta) => ({ id, blockId: 'hero', ...library, meta })
  const documents = [
    page('s1', 'pages', 'home', [instance('all', {})]),
    // A per-page limit of 1 stays on the instance.
    page('s1', 'pages', 'blog', [instance('one', { posts: { limit: 1 } })]),
  ]
  const same = await compare({ library, proposed: library, documents, sourceRecords: records })
  assert.equal(same.counts.identical, 2)
  const changed = await compare({ library, proposed: { ...library, template: library.template.replace('<li>', '<li class="card">') }, documents, sourceRecords: records })
  assert.equal(changed.counts.different, 2)
  const byInstance = Object.fromEntries(changed.differences.map(item => [item.instanceId, item]))
  assert.equal(byInstance.all.before, '<ul><li>One</li><li>Two</li><li>Three</li></ul>')
  assert.equal(byInstance.one.before, '<ul><li>One</li></ul>')
  assert.equal(byInstance.one.after, '<ul><li class="card">One</li></ul>')
})

test('without sourceRecords, sample records cover the fields either template reads', async () => {
  const library = {
    template: '<ul>{{#for post in source("posts")}}<li>{{ post.title }}</li>{{/for}}</ul>',
    templateVersion: 2,
    schema: {},
    dataSources: { posts: { type: 'collection', path: 'posts' } },
    values: {},
    meta: {},
  }
  const proposed = { ...library, template: '<ul>{{#for post in source("posts")}}<li>{{ post.title }} {{ post.date }}</li>{{/for}}</ul>' }
  const result = await compare({ library, proposed, documents: [page('s1', 'pages', 'home', [{ id: 'a', blockId: 'hero', ...library }])] })
  assert.equal(result.counts.different, 1)
  assert.equal(result.differences[0].before, '<ul><li>1</li><li></li></ul>')
  assert.equal(result.differences[0].after, '<ul><li>1 1</li><li></li></ul>')
})

test('distinct renders beyond maxRenders are counted as unchecked', async () => {
  const documents = [page('s1', 'pages', 'home', ['A', 'B', 'C'].map(title => ({ id: title, blockId: 'hero', ...V2_HERO, values: { title } })))]
  const result = await compare({ library: V2_HERO, proposed: V2_HERO, documents, maxRenders: 2 })
  assert.equal(result.counts.rendered, 2)
  assert.equal(result.counts.unchecked, 1)
})

test('html normalization and the difference excerpt', () => {
  assert.equal(normalizeHtml('<a class="x {{ loading }}">\n  <b> t </b>\n</a>'), '<a class="x"><b> t </b></a>')
  assert.equal(normalizeHtml('<div><!-- iterate with {{item}} --><p>x</p></div>'), '<div><p>x</p></div>')
  assert.deepEqual(firstDifference('abc', 'abd'), { at: 2, before: 'abc', after: 'abd' })
})

test('collectInstanceDocuments queries each collection by blockIds and skips published templates', async () => {
  const queries = []
  const docs = {
    'organizations/org1/sites/s1/pages': [{ id: 'home', data: { name: 'Home', content: [] } }],
  }
  const db = {
    collection: path => ({
      limit: () => ({ get: async () => ({ size: 1, docs: [{ id: 's1' }] }) }),
      where: (field, op, value) => ({
        limit: () => ({
          get: async () => {
            queries.push([path, field, op, value])
            const list = docs[path] || []
            return { size: list.length, docs: list.map(doc => ({ id: doc.id, data: () => doc.data })) }
          },
        }),
      }),
    }),
  }
  const found = await collectInstanceDocuments({ db, orgId: 'org1', blockId: 'hero' })
  assert.deepEqual(queries.map(([path]) => path), [
    'organizations/org1/sites/s1/pages',
    'organizations/org1/sites/s1/published',
    'organizations/org1/sites/s1/posts',
    'organizations/org1/sites/s1/published_posts',
    'organizations/org1/sites/templates/pages',
  ])
  assert.ok(queries.every(([, field, op, value]) => field === 'blockIds' && op === 'array-contains' && value === 'hero'))
  assert.deepEqual(found.documents, [{ siteId: 's1', collection: 'pages', docId: 'home', name: 'Home', data: { name: 'Home', content: [] } }])
})
