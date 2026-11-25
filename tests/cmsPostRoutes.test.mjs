import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildCmsPostLiveUrl, findFirstCmsPostRouteSegments, isCmsPostRoutePage } from '../lib/cmsPostRoutes.js'

const renderer = {
  blockId: 'shared-post-content-renderer',
  template: '{{#for post in source("posts")}}{{{#renderBlocks {"field":"post"} }}}{{/for}}',
  dataSources: {
    posts: { type: 'collection', path: 'posts' },
  },
}

test('Post route discovery ignores generic index/detail pages and selects the renderer-backed page', () => {
  const pages = {
    realEstate: {
      post: true,
      postContent: [{ blockId: 'clearwater-property-detail' }],
      postStructure: [{ id: 'detail-row' }],
    },
    blog: {
      post: true,
      postContent: [renderer],
      postStructure: [{ id: 'post-row' }],
    },
  }
  const menus = {
    main: [
      { name: 'real-estate', item: 'realEstate' },
      { name: 'blog', item: 'blog' },
    ],
  }

  assert.equal(isCmsPostRoutePage(pages.realEstate), false)
  assert.equal(isCmsPostRoutePage(pages.blog), true)
  assert.deepEqual(findFirstCmsPostRouteSegments(menus, pages), ['blog'])
})

test('Post route discovery does not depend on a project-specific renderer id', () => {
  assert.equal(isCmsPostRoutePage({
    post: true,
    postContent: [renderer],
  }), true)
  assert.equal(isCmsPostRoutePage({
    post: true,
    postContent: [{ blockId: 'vendor-specific-renderer' }],
  }), false)
})

test('Post route discovery supports a compatible renderer inside a menu folder', () => {
  const compatibleRenderer = {
    template: '{{{#renderBlocks {"field":"post"} }}}',
    dataSources: { current: { type: 'collection', path: 'posts' } },
  }
  const pages = { fieldNotes: { post: true, postContent: [compatibleRenderer] } }
  const menus = {
    main: [{ name: 'stories', item: { stories: [{ name: 'field-notes', item: 'fieldNotes' }] } }],
  }

  assert.deepEqual(findFirstCmsPostRouteSegments(menus, pages), ['stories', 'field-notes'])
})

test('Post live URL uses the Blog route and a canonical trailing slash', () => {
  assert.equal(buildCmsPostLiveUrl({
    origin: 'https://cmp-cms-front.pages.dev/',
    routeSegments: ['blog'],
    postSlug: 'top-7-home-issues-to-address-before-fall-to-protect-your-investment',
  }), 'https://cmp-cms-front.pages.dev/blog/top-7-home-issues-to-address-before-fall-to-protect-your-investment/')
})

test('both Post publish actions refresh embedded block definitions before writing', async () => {
  const source = await readFile(new URL('../components/cms/posts.vue', import.meta.url), 'utf8')
  const refreshedPublishWrites = source.match(/const publishedPost = resolveSyncedPostDoc\(edgeGlobal\.dupObject\(post \|\| \{\}\)\)/g) || []
  assert.equal(refreshedPublishWrites.length, 2)
  assert.doesNotMatch(source, /const publishedPost = edgeGlobal\.dupObject\(post \|\| \{\}\)/)
})
