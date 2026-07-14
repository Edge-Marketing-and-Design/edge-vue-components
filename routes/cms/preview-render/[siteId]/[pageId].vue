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
  payload: null,
  renderContext: null,
  blockPending: {},
  blockLoaded: {},
})

const EDGE_CMS_PREVIEW_RENDER_SIGNATURE_SALT = 'edge-cms-preview-render-v1'

const siteId = computed(() => String(route.params.siteId || '').trim())
const pageId = computed(() => String(route.params.pageId || '').trim())
const previewSignature = computed(() => String(route.query.signature || '').trim())
const organizationId = computed(() => String(route.query.orgId || edgeGlobal.edgeState.currentOrganization || localStorage.getItem('organizationID') || '').trim())
const routeLastSegment = computed(() => String(route.query.routeLastSegment || '').trim())
const isThumbnailMode = computed(() => String(route.query.mode || '').trim() === 'thumbnail')
const previewSource = computed(() => String(route.query.source || '').trim() === 'published' ? 'published' : 'draft')
const orgPath = computed(() => organizationId.value ? `organizations/${organizationId.value}` : '')

const siteDoc = computed(() => state.payload?.site || null)
const pageDoc = computed(() => state.payload?.page || null)
const blocksCollection = computed(() => state.payload?.blocks || {})
const themeDoc = computed(() => state.payload?.theme || null)
const previewCollectionValues = computed(() => state.payload?.collectionValues || {})

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
  if (typeof blockRef === 'string' && blocksCollection.value?.[blockRef]) {
    const libraryBlock = blocksCollection.value[blockRef]
    return {
      content: libraryBlock.content || libraryBlock.template || '',
      templateVersion: Number(libraryBlock.templateVersion) === 2 ? 2 : 1,
      template: libraryBlock.template || '',
      schema: libraryBlock.schema || {},
      dataSources: libraryBlock.dataSources || {},
      values: libraryBlock.values || EMPTY_PREVIEW_VALUES,
      meta: libraryBlock.meta || EMPTY_PREVIEW_META,
    }
  }

  const block = resolveBlockSource(blockRef)
  if (!block)
    return null
  if (block.content) {
    return {
      content: block.content || block.template || '',
      templateVersion: Number(block.templateVersion) === 2 ? 2 : 1,
      template: block.template || '',
      schema: block.schema || {},
      dataSources: block.dataSources || {},
      values: block.values || EMPTY_PREVIEW_VALUES,
      meta: block.meta || EMPTY_PREVIEW_META,
    }
  }
  if (block.blockId && blocksCollection.value?.[block.blockId]) {
    const libraryBlock = blocksCollection.value[block.blockId]
    return {
      content: libraryBlock.content || libraryBlock.template || '',
      templateVersion: Number(libraryBlock.templateVersion) === 2 ? 2 : 1,
      template: libraryBlock.template || '',
      schema: libraryBlock.schema || {},
      dataSources: libraryBlock.dataSources || {},
      values: block.values || libraryBlock.values || EMPTY_PREVIEW_VALUES,
      meta: block.meta || libraryBlock.meta || EMPTY_PREVIEW_META,
    }
  }
  return null
}

const resolveBlockValuesForPreview = (blockRef, key) => {
  const block = resolveBlockForPreview(blockRef)
  if (!block)
    return EMPTY_PREVIEW_VALUES
  return {
    ...(block.values || EMPTY_PREVIEW_VALUES),
    ...(previewCollectionValues.value?.[key] || EMPTY_PREVIEW_VALUES),
  }
}

const hasExplicitPreviewSpan = (column) => {
  const span = column?.span
  return span !== null && span !== undefined && span !== '' && Number.isFinite(Number(span))
}

const hasPreviewSpans = row => (row?.columns || []).some(hasExplicitPreviewSpan)

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
  if (!hasExplicitPreviewSpan(column))
    return {}
  const span = Number(column?.span)
  const safeSpan = Math.min(Math.max(span, 1), 6)
  return { gridColumn: `span ${safeSpan} / span ${safeSpan}` }
}

const previewBlockKey = (row, rowIndex, column, colIndex, blockIdx) => {
  return `${row?.id || rowIndex}:${column?.id || colIndex}:${blockIdx}`
}

const previewBlockKeys = computed(() => {
  const keys = []
  previewRows.value.forEach((row, rowIndex) => {
    (row.columns || []).forEach((column, colIndex) => {
      (column.blocks || []).forEach((blockRef, blockIdx) => {
        if (resolveBlockForPreview(blockRef))
          keys.push(previewBlockKey(row, rowIndex, column, colIndex, blockIdx))
      })
    })
  })
  return keys
})

const previewReady = computed(() => {
  if (state.loading || state.error || !pageDoc.value || !previewThemeReady.value)
    return false
  const keys = previewBlockKeys.value
  if (!keys.length)
    return true
  return keys.every(key => state.blockLoaded[key] && !state.blockPending[key])
})

const setPreviewBlockPending = (key, pending) => {
  if (!key)
    return
  if (pending) {
    state.blockPending[key] = true
    delete state.blockLoaded[key]
    return
  }
  delete state.blockPending[key]
}

const setPreviewBlockLoaded = (key) => {
  if (!key || state.blockPending[key])
    return
  state.blockLoaded[key] = true
}

const mergePreviewCollection = (collectionPath, docs) => {
  if (!collectionPath || !docs || typeof docs !== 'object')
    return
  if (!edgeFirebase.data)
    edgeFirebase.data = {}
  edgeFirebase.data[collectionPath] = {
    ...(edgeFirebase.data[collectionPath] || {}),
    ...docs,
  }
}

const hydratePreviewCollections = (payload) => {
  if (!orgPath.value || !payload)
    return
  const site = payload.site || null
  const page = payload.page || null
  const theme = payload.theme || null
  const themeId = String(site?.theme || '').trim()

  if (site)
    mergePreviewCollection(`${orgPath.value}/sites`, { [siteId.value]: site })
  if (page)
    mergePreviewCollection(`${orgPath.value}/sites/${siteId.value}/pages`, { [pageId.value]: page })
  if (themeId && theme)
    mergePreviewCollection(`${orgPath.value}/themes`, { [themeId]: theme })
  mergePreviewCollection(`${orgPath.value}/blocks`, payload.blocks || {})
}

const setPreviewOrganizationContext = () => {
  if (!organizationId.value)
    return
  edgeGlobal.edgeState.currentOrganization = organizationId.value
  edgeGlobal.edgeState.organizationDocPath = orgPath.value
  if (import.meta.client)
    localStorage.setItem('organizationID', organizationId.value)
}

const loadPreviewData = async () => {
  state.loading = true
  state.error = ''
  state.payload = null
  state.blockPending = {}
  state.blockLoaded = {}
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
    if (!organizationId.value) {
      state.error = 'Missing organization for preview.'
      return
    }
    if (!siteId.value || !pageId.value) {
      state.error = 'Missing site or page id.'
      return
    }

    setPreviewOrganizationContext()

    const response = await edgeFirebase.runFunction('cms-getPreviewRenderPayload', {
      orgId: organizationId.value,
      siteId: siteId.value,
      pageId: pageId.value,
      signature: previewSignature.value,
      source: previewSource.value,
      routeLastSegment: routeLastSegment.value,
    })
    state.payload = response?.data || response || null
    state.renderContext = state.payload?.renderContext || null
    hydratePreviewCollections(state.payload)
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

watch(() => [organizationId.value, siteId.value, pageId.value, previewSignature.value, previewSource.value], () => {
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

    <div
      v-else
      :class="isThumbnailMode ? 'cms-preview-thumbnail-capture cms-auth-preview-logged-in' : 'cms-preview-render-page cms-auth-preview-logged-in'"
      :data-preview-ready="previewReady ? 'true' : 'false'"
    >
      <div :class="isThumbnailMode ? 'cms-preview-render-page cms-preview-thumbnail-content' : ''">
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
                    :key="`${siteId}:${pageId}:${previewBlockKey(row, rowIndex, column, colIndex, blockIdx)}`"
                    :site-id="siteId"
                    :content="resolveBlockForPreview(blockRef).content"
                    :template-version="resolveBlockForPreview(blockRef).templateVersion"
                    :template="resolveBlockForPreview(blockRef).template"
                    :schema="resolveBlockForPreview(blockRef).schema"
                    :data-sources="resolveBlockForPreview(blockRef).dataSources"
                    :values="resolveBlockValuesForPreview(blockRef, previewBlockKey(row, rowIndex, column, colIndex, blockIdx))"
                    :meta="resolveBlockForPreview(blockRef).meta"
                    :theme="previewTheme"
                    :render-context="state.renderContext"
                    :route-last-segment="routeLastSegment"
                    :standalone-preview="true"
                    @pending="setPreviewBlockPending(previewBlockKey(row, rowIndex, column, colIndex, blockIdx), $event)"
                    @loaded="setPreviewBlockLoaded(previewBlockKey(row, rowIndex, column, colIndex, blockIdx))"
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
    </div>
  </main>
</template>

<style scoped>
.cms-preview-render-page {
  box-sizing: border-box;
  width: 1600px;
  min-height: 820px;
  padding: 1.5rem;
  overflow-x: hidden;
}

.cms-preview-thumbnail-capture {
  width: 600px;
  height: 800px;
  overflow: hidden;
  background: #fff;
}

.cms-preview-thumbnail-content {
  transform: scale(0.375);
  transform-origin: top left;
}

.cms-auth-preview-logged-in :deep(.cms-show-logged-out),
.cms-auth-preview-logged-in :deep([data-cms-show-logged-out]),
.cms-auth-preview-logged-in :deep(.cms-hide-logged-in),
.cms-auth-preview-logged-in :deep([data-cms-hide-logged-in]) {
  display: none !important;
}
</style>
