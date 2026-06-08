<script setup>
const route = useRoute()
const edgeFirebase = inject('edgeFirebase')

definePageMeta({
  layout: false,
})

const state = reactive({
  bootstrapped: false,
  loading: true,
  error: '',
  renderContext: null,
})

const EDGE_CMS_PREVIEW_RENDER_SIGNATURE_SALT = 'edge-cms-preview-render-v1'

const siteId = computed(() => String(route.params.siteId || '').trim())
const pageId = computed(() => String(route.params.pageId || '').trim())
const previewSignature = computed(() => String(route.query.signature || '').trim())
const organizationId = computed(() => String(route.query.orgId || edgeGlobal.edgeState.currentOrganization || localStorage.getItem('organizationID') || '').trim())
const routeLastSegment = computed(() => String(route.query.routeLastSegment || '').trim())

const orgPath = computed(() => organizationId.value ? `organizations/${organizationId.value}` : '')
const siteDoc = computed(() => orgPath.value ? edgeFirebase.data?.[`${orgPath.value}/sites`]?.[siteId.value] || null : null)
const pageDoc = computed(() => orgPath.value ? edgeFirebase.data?.[`${orgPath.value}/sites/${siteId.value}/pages`]?.[pageId.value] || null : null)
const blocksCollection = computed(() => orgPath.value ? edgeFirebase.data?.[`${orgPath.value}/blocks`] || {} : {})
const themeCollection = computed(() => orgPath.value ? edgeFirebase.data?.[`${orgPath.value}/themes`] || {} : {})
const themeDoc = computed(() => {
  const themeId = String(siteDoc.value?.theme || '').trim()
  return themeId ? themeCollection.value?.[themeId] || null : null
})

const normalizeForCompare = (value) => {
  if (Array.isArray(value))
    return value.map(normalizeForCompare)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeForCompare(value[key])
      return acc
    }, {})
  }
  return value
}

const stableSerialize = value => JSON.stringify(normalizeForCompare(value))

const createPreviewSignatureHash = (value) => {
  const input = stableSerialize(value)
  let hash = 5381
  for (let index = 0; index < input.length; index++)
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index)
  return String(hash >>> 0)
}

const expectedPreviewSignature = computed(() => {
  if (!organizationId.value || !siteId.value || !pageId.value)
    return ''
  return createPreviewSignatureHash({
    salt: EDGE_CMS_PREVIEW_RENDER_SIGNATURE_SALT,
    orgId: organizationId.value,
    siteId: siteId.value,
    pageId: pageId.value,
  })
})

const parseThemeDoc = (themeDoc) => {
  const rawTheme = themeDoc?.theme
  if (!rawTheme)
    return null
  const extraCSS = typeof themeDoc?.extraCSS === 'string' ? themeDoc.extraCSS : ''
  try {
    const parsed = typeof rawTheme === 'string' ? JSON.parse(rawTheme) : rawTheme
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    return { ...parsed, extraCSS }
  }
  catch {
    return null
  }
}

const previewTheme = computed(() => {
  return parseThemeDoc(themeDoc.value) || null
})

const previewThemeReady = computed(() => {
  return !String(siteDoc.value?.theme || '').trim() || !!previewTheme.value
})

const parseHeadDoc = (doc) => {
  try {
    const parsed = JSON.parse(doc?.headJSON || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed
  }
  catch {}
  return {}
}

const previewHead = computed(() => parseHeadDoc(themeDoc.value))

useHead(() => previewHead.value || {})

const normalizePreviewColumns = (row) => {
  if (!Array.isArray(row?.columns) || !row.columns.length)
    return []
  return row.columns.map((column, idx) => ({
    id: column?.id || `${row?.id || 'row'}-col-${idx}`,
    span: Number(column?.span) || null,
    blocks: Array.isArray(column?.blocks) ? column.blocks.filter(Boolean) : [],
  }))
}

const previewRows = computed(() => {
  const doc = pageDoc.value || {}
  const structureRows = Array.isArray(doc.structure) ? doc.structure : []
  if (structureRows.length) {
    return structureRows
      .map((row, rowIndex) => ({
        id: row?.id || `${doc?.docId || pageId.value || 'page'}-row-${rowIndex}`,
        columns: normalizePreviewColumns(row),
      }))
      .filter(row => row.columns.length > 0)
  }

  const legacyBlocks = Array.isArray(doc.content) ? doc.content.filter(Boolean) : []
  if (!legacyBlocks.length)
    return []
  return [{
    id: `${doc?.docId || pageId.value || 'page'}-legacy-row`,
    columns: [{
      id: `${doc?.docId || pageId.value || 'page'}-legacy-col`,
      span: null,
      blocks: legacyBlocks,
    }],
  }]
})

const resolveBlockSource = (blockRef) => {
  if (!blockRef)
    return null
  if (typeof blockRef === 'object')
    return blockRef
  const lookupId = String(blockRef).trim()
  if (!lookupId)
    return null
  const templateBlocks = Array.isArray(pageDoc.value?.content) ? pageDoc.value.content : []
  return templateBlocks.find(block => block?.id === lookupId || block?.blockId === lookupId) || null
}

const EMPTY_PREVIEW_VALUES = {}
const EMPTY_PREVIEW_META = {}

const resolveBlockForPreview = (blockRef) => {
  const block = resolveBlockSource(blockRef)
  if (!block)
    return null
  if (block.content) {
    return {
      content: block.content,
      values: block.values || EMPTY_PREVIEW_VALUES,
      meta: block.meta || EMPTY_PREVIEW_META,
    }
  }
  if (block.blockId && blocksCollection.value?.[block.blockId]) {
    const libraryBlock = blocksCollection.value[block.blockId]
    return {
      content: libraryBlock.content,
      values: block.values || libraryBlock.values || EMPTY_PREVIEW_VALUES,
      meta: block.meta || libraryBlock.meta || EMPTY_PREVIEW_META,
    }
  }
  return null
}

const hasPreviewSpans = row => (row?.columns || []).some(column => Number.isFinite(Number(column?.span)))

const previewGridClass = (row) => {
  if (hasPreviewSpans(row))
    return 'grid grid-cols-1 sm:grid-cols-6 gap-4'
  const count = row?.columns?.length || 1
  const map = {
    1: 'grid grid-cols-1 gap-4',
    2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
    3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
    4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
    5: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4',
    6: 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4',
  }
  return map[count] || 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4'
}

const previewColumnStyle = (column) => {
  const span = Number(column?.span)
  if (!Number.isFinite(span))
    return {}
  const safeSpan = Math.min(Math.max(span, 1), 6)
  return { gridColumn: `span ${safeSpan} / span ${safeSpan}` }
}

const fetchPreviewContextForSite = async () => {
  if (!orgPath.value || !siteId.value)
    return null
  try {
    const staticSearch = new edgeFirebase.SearchStaticData()
    await staticSearch.getData(`${orgPath.value}/sites/${siteId.value}/published_posts`, [], [], 1)
    return Object.values(staticSearch.results?.data || {})[0] || null
  }
  catch {
    return null
  }
}

const loadPreviewData = async () => {
  state.loading = true
  state.error = ''
  try {
    state.bootstrapped = true

    if (!previewSignature.value) {
      state.error = 'Missing preview signature.'
      return
    }
    if (previewSignature.value !== expectedPreviewSignature.value) {
      state.error = 'Invalid preview signature.'
      return
    }
    if (!orgPath.value) {
      state.error = 'Missing organization for preview.'
      return
    }
    if (!siteId.value || !pageId.value) {
      state.error = 'Missing site or page id.'
      return
    }

    await Promise.all([
      edgeFirebase.startSnapshot(`${orgPath.value}/sites`),
      edgeFirebase.startSnapshot(`${orgPath.value}/sites/${siteId.value}/pages`),
      edgeFirebase.startSnapshot(`${orgPath.value}/themes`),
      edgeFirebase.startSnapshot(`${orgPath.value}/blocks`),
    ])
    state.renderContext = await fetchPreviewContextForSite()
  }
  catch (error) {
    state.error = error?.message || 'Unable to load preview.'
  }
  finally {
    state.loading = false
  }
}

onMounted(() => {
  loadPreviewData()
})

watch(() => [edgeFirebase?.user?.loggedIn, siteId.value, pageId.value], () => {
  if (state.bootstrapped)
    loadPreviewData()
})
</script>

<template>
  <main class="min-h-screen bg-white text-slate-950">
    <div v-if="state.loading" class="flex min-h-screen items-center justify-center text-sm text-slate-500">
      Loading preview...
    </div>

    <div v-else-if="state.error" class="flex min-h-screen items-center justify-center p-6 text-center text-sm text-red-600">
      {{ state.error }}
    </div>

    <div v-else-if="!pageDoc" class="flex min-h-screen items-center justify-center p-6 text-center text-sm text-slate-500">
      Page not found.
    </div>

    <div v-else-if="!previewThemeReady" class="flex min-h-screen items-center justify-center p-6 text-center text-sm text-slate-500">
      Loading theme...
    </div>

    <div v-else class="cms-preview-render-page cms-auth-preview-logged-in">
      <template v-if="previewRows.length">
        <div
          v-for="(row, rowIndex) in previewRows"
          :key="`${pageId}-row-${row.id || rowIndex}`"
          class="w-full"
        >
          <div :class="previewGridClass(row)">
            <div
              v-for="(column, colIndex) in row.columns"
              :key="`${pageId}-row-${row.id || rowIndex}-col-${column.id || colIndex}`"
              class="min-w-0"
              :style="previewColumnStyle(column)"
            >
              <div
                v-for="(blockRef, blockIdx) in column.blocks || []"
                :key="`${pageId}-row-${row.id || rowIndex}-col-${column.id || colIndex}-block-${blockIdx}`"
              >
                <edge-cms-block-api
                  v-if="resolveBlockForPreview(blockRef)"
                  :key="`${siteId}:${pageId}:${blockIdx}`"
                  :site-id="siteId"
                  :content="resolveBlockForPreview(blockRef).content"
                  :values="resolveBlockForPreview(blockRef).values"
                  :meta="resolveBlockForPreview(blockRef).meta"
                  :theme="previewTheme"
                  :render-context="state.renderContext"
                  :route-last-segment="routeLastSegment"
                  :standalone-preview="true"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="flex min-h-screen items-center justify-center text-sm text-slate-500">
        No blocks yet.
      </div>
    </div>
  </main>
</template>

<style scoped>
.cms-preview-render-page {
  width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
}

.cms-auth-preview-logged-in :deep(.cms-show-logged-out),
.cms-auth-preview-logged-in :deep([data-cms-show-logged-out]),
.cms-auth-preview-logged-in :deep(.cms-hide-logged-in),
.cms-auth-preview-logged-in :deep([data-cms-hide-logged-in]) {
  display: none !important;
}
</style>
