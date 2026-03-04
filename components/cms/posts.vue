<script setup lang="js">
import { computed, inject, onBeforeMount, reactive, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { ArrowDown, ArrowUp, Eye, File, FileCheck, FilePen, FileWarning, GripVertical, Image, ImagePlus, Loader2, MoreHorizontal, Pencil, Plus, Save, Trash2, X } from 'lucide-vue-next'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  mode: {
    type: String,
    default: 'sidebar',
  },
  selectedPostId: {
    type: String,
    default: '',
  },
  listVariant: {
    type: String,
    default: 'sidebar',
  },
})

const emit = defineEmits(['updating', 'update:selectedPostId'])

const edgeFirebase = inject('edgeFirebase')
const cmsMultiOrg = useState('cmsMultiOrg', () => true)
const isAdmin = computed(() => edgeGlobal.isAdminGlobal(edgeFirebase).value)
const isDevModeEnabled = computed(() => process.dev || Boolean(edgeGlobal.edgeState.devOverride))
const canOpenPreviewBlockContentEditor = computed(() => {
  if (!isAdmin.value)
    return false
  if (cmsMultiOrg.value)
    return true
  return isDevModeEnabled.value
})

const collection = computed(() => `sites/${props.site}/posts`)
const collectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${collection.value}`)

const publishedCollection = computed(() => `sites/${props.site}/published_posts`)
const publishedCollectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${publishedCollection.value}`)

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

const postDocComparable = (post) => {
  return {
    name: post?.name || '',
    title: post?.title || '',
    blurb: post?.blurb || '',
    tags: Array.isArray(post?.tags) ? post.tags : [],
    featuredImage: post?.featuredImage || '',
    content: Array.isArray(post?.content) ? post.content : (typeof post?.content === 'string' ? post.content : ''),
    structure: Array.isArray(post?.structure) ? post.structure : [],
  }
}

const schemas = {
  posts: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
    title: z.string({
      required_error: 'Title is required',
    }).min(1, { message: 'Title is required' }),
    tags: z.array(z.string()).optional(),
    blurb: z.string({
      required_error: 'Content blurb is required',
    }).min(1, { message: 'Content blurb is required' }).max(500, { message: 'Content blurb must be at most 500 characters' }),
    content: z.union([z.array(z.any()), z.string()]).optional(),
    structure: z.array(z.any()).optional(),
    featuredImages: z.array(z.string()).optional(),
  })),
}

const renameSchema = toTypedSchema(z.object({
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
}))

const isPublishedPostDiff = (postId) => {
  const publishedPost = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published_posts`]?.[postId]
  const draftPost = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/posts`]?.[postId]
  if (!publishedPost && draftPost) {
    return true
  }
  if (publishedPost && !draftPost) {
    return true
  }
  if (publishedPost && draftPost) {
    return stableSerialize(postDocComparable(publishedPost)) !== stableSerialize(postDocComparable(draftPost))
  }
  return false
}

const lastPublishedTime = (postId) => {
  const timestamp = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[postId]?.last_updated
  if (!timestamp)
    return 'Never'
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const state = reactive({
  editMode: false,
  sheetOpen: false,
  activePostId: '',
  deleteDialog: false,
  postToDelete: null,
  editorDoc: null,
  internalSlugUpdate: false,
  slugManuallyEdited: false,
  lastAutoSlug: '',
  renameDialog: false,
  renamePost: null,
  renameValue: '',
  renameSubmitting: false,
  renameInternalUpdate: false,
  imageOpen: false,
  newDocs: {
    posts: {
      name: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'text',
          'label': 'Name',
        },
      },
      title: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'text',
          'label': 'Title',
        },
      },
      tags: {
        value: [],
        cols: '12',
        bindings: {
          'field-type': 'tags',
          'value-as': 'array',
          'label': 'Tags',
          'placeholder': 'Add a tag',
        },
      },
      blurb: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'textarea',
          'label': 'Content Blurb / Preview',
          'rows': '8',
        },
      },
      content: {
        value: [],
      },
      structure: {
        value: [],
      },
      featuredImage: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'tags',
          'value-as': 'array',
          'label': 'Featured Images',
          'description': 'Enter image URLs or storage paths',
        },
      },
    },
  },
})

onBeforeMount(async () => {
  if (!edgeFirebase.data?.[collectionKey.value]) {
    await edgeFirebase.startSnapshot(collectionKey.value)
  }
  if (!edgeFirebase.data?.[publishedCollectionKey.value]) {
    await edgeFirebase.startSnapshot(publishedCollectionKey.value)
  }
})

const posts = computed(() => edgeFirebase.data?.[collectionKey.value] || {})
const postsList = computed(() =>
  Object.entries(posts.value)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.doc_created_at ?? 0) - (a.doc_created_at ?? 0)),
)
const hasPosts = computed(() => postsList.value.length > 0)
const isCreating = computed(() => state.activePostId === 'new')
const isFullList = computed(() => props.mode === 'list' && props.listVariant === 'full')

const getPostSlug = post => (post?.name && (typeof post.name === 'string' ? post.name.trim() : ''))

const slugify = (value) => {
  if (!value)
    return ''
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const ensureUniqueSlug = (input, excludeId = '') => {
  let base = slugify(input)
  if (!base)
    base = 'post'
  const existing = new Set(
    postsList.value
      .filter(post => post.id !== excludeId)
      .map(post => getPostSlug(post))
      .filter(Boolean),
  )

  let candidate = base
  let suffix = 1
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const activePost = computed(() => {
  if (!state.activePostId || state.activePostId === 'new')
    return null
  return posts.value?.[state.activePostId] || null
})

const editorOpen = computed(() => {
  if (props.mode === 'editor')
    return Boolean(props.selectedPostId)
  return state.sheetOpen
})

const sheetTitle = computed(() => {
  if (!editorOpen.value)
    return ''
  if (isCreating.value)
    return 'New Post'
  return activePost.value?.name || getPostSlug(activePost.value) || 'Edit Post'
})

const currentDocId = () => (state.activePostId && (state.activePostId !== 'new' ? state.activePostId : ''))

watch(
  () => state.editorDoc?.title,
  (newTitle) => {
    if (!state.editorDoc)
      return
    if (state.slugManuallyEdited && state.editorDoc.name)
      return
    if (!newTitle) {
      state.lastAutoSlug = ''
      return
    }
    const unique = ensureUniqueSlug(newTitle, currentDocId())
    state.internalSlugUpdate = true
    state.lastAutoSlug = unique
    state.editorDoc.name = unique
    state.internalSlugUpdate = false
  },
)

watch(
  () => state.editorDoc?.name,
  (newName) => {
    if (!state.editorDoc)
      return
    if (state.internalSlugUpdate) {
      state.internalSlugUpdate = false
      return
    }
    const sanitized = slugify(newName)
    if (!sanitized) {
      state.editorDoc.name = ''
      state.slugManuallyEdited = false
      state.lastAutoSlug = ''
      return
    }
    const unique = ensureUniqueSlug(sanitized, currentDocId())
    if (unique !== newName) {
      state.internalSlugUpdate = true
      state.editorDoc.name = unique
      return
    }
    state.editorDoc.name = unique
    if (unique !== state.lastAutoSlug)
      state.slugManuallyEdited = true
  },
)

watch(
  () => state.renameValue,
  (newVal) => {
    if (!state.renameDialog)
      return
    if (state.renameInternalUpdate) {
      state.renameInternalUpdate = false
      return
    }
    const sanitized = slugify(newVal)
    if (sanitized === newVal)
      return
    state.renameInternalUpdate = true
    state.renameValue = sanitized
  },
)

const formatTimestamp = (input) => {
  if (!input)
    return 'Not yet saved'
  try {
    return new Date(input).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }
  catch {
    return 'Not yet saved'
  }
}

const postKey = post => post?.docId || post?.id || ''
const tagPreview = (tags = [], limit = 3) => {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : []
  return {
    visible: list.slice(0, limit),
    remaining: Math.max(list.length - limit, 0),
  }
}
const postFeaturedImage = (post) => {
  if (post?.featuredImage)
    return post.featuredImage
  if (Array.isArray(post?.featuredImages) && post.featuredImages[0])
    return post.featuredImages[0]
  return ''
}

const previewContent = (content) => {
  if (typeof content !== 'string')
    return ''
  const normalized = content.trim()
  if (!normalized)
    return ''
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized
}

const notifiedLegacyMigrationIds = new Set()
const LEGACY_POST_HTML_FIELD = 'legacyHtml'
const LEGACY_POST_HTML_BLOCK_CONTENT = `<section class="cms-block cms-block-legacy-post-html">
  {{{#richtext {"field":"legacyHtml","title":"Content","value":""}}}}
</section>`

const createPostRow = () => ({
  id: edgeGlobal.generateShortId(),
  width: 'full',
  gap: '4',
  verticalAlign: 'start',
  background: 'transparent',
  mobileStack: 'normal',
  columns: [{
    id: edgeGlobal.generateShortId(),
    span: 12,
    mobileOrder: 0,
    blocks: [],
  }],
})

const createLegacyHtmlLocalBlock = (legacyContent) => {
  const normalizedLegacyContent = String(legacyContent || '')
  return {
    id: edgeGlobal.generateShortId(),
    content: LEGACY_POST_HTML_BLOCK_CONTENT,
    values: {
      [LEGACY_POST_HTML_FIELD]: normalizedLegacyContent,
    },
    meta: {
      [LEGACY_POST_HTML_FIELD]: {
        type: 'richtext',
        title: 'Content',
      },
    },
  }
}

const normalizePostBuilderDoc = (doc = {}) => {
  const normalized = edgeGlobal.dupObject(doc || {})
  const previousComparable = {
    content: normalized.content,
    structure: normalized.structure,
  }

  let migratedFromLegacyHtml = false
  let normalizedContent = []

  if (Array.isArray(normalized.content)) {
    normalizedContent = normalized.content
      .filter(block => block && typeof block === 'object')
      .map((block) => {
        const nextBlock = edgeGlobal.dupObject(block)
        if (!nextBlock.id)
          nextBlock.id = edgeGlobal.generateShortId()
        if (typeof nextBlock.content !== 'string')
          nextBlock.content = String(nextBlock.content || '')
        if (!nextBlock.values || typeof nextBlock.values !== 'object' || Array.isArray(nextBlock.values))
          nextBlock.values = {}
        if (!nextBlock.meta || typeof nextBlock.meta !== 'object' || Array.isArray(nextBlock.meta))
          nextBlock.meta = {}
        return nextBlock
      })
  }
  else {
    const legacyContent = typeof normalized.content === 'string' ? normalized.content : ''
    if (legacyContent.trim().length > 0) {
      normalizedContent = [createLegacyHtmlLocalBlock(legacyContent)]
      migratedFromLegacyHtml = true
    }
  }

  const contentIds = new Set(normalizedContent.map(block => block.id))
  let normalizedStructure = Array.isArray(normalized.structure)
    ? edgeGlobal.dupObject(normalized.structure)
    : []

  normalizedStructure = normalizedStructure
    .filter(row => row && typeof row === 'object')
    .map((row) => {
      const sourceColumn = Array.isArray(row.columns) ? row.columns[0] : null
      const sourceBlocks = Array.isArray(sourceColumn?.blocks) ? sourceColumn.blocks : []
      return {
        ...row,
        id: row.id || edgeGlobal.generateShortId(),
        width: 'full',
        mobileStack: 'normal',
        columns: [{
          id: sourceColumn?.id || edgeGlobal.generateShortId(),
          span: 12,
          mobileOrder: 0,
          blocks: sourceBlocks.filter(blockId => contentIds.has(blockId)),
        }],
      }
    })

  if (!normalizedStructure.length && normalizedContent.length) {
    const firstRow = createPostRow()
    firstRow.columns[0].blocks = normalizedContent.map(block => block.id)
    normalizedStructure = [firstRow]
  }

  const referencedIds = new Set()
  normalizedStructure.forEach((row) => {
    row.columns[0].blocks.forEach(blockId => referencedIds.add(blockId))
  })
  const orphanIds = normalizedContent.map(block => block.id).filter(blockId => !referencedIds.has(blockId))
  if (orphanIds.length) {
    if (!normalizedStructure.length)
      normalizedStructure = [createPostRow()]
    normalizedStructure[normalizedStructure.length - 1].columns[0].blocks.push(...orphanIds)
  }

  normalized.content = normalizedContent
  normalized.structure = normalizedStructure

  const nextComparable = {
    content: normalized.content,
    structure: normalized.structure,
  }

  return {
    normalized,
    changed: stableSerialize(previousComparable) !== stableSerialize(nextComparable),
    migratedFromLegacyHtml,
  }
}

const ensurePostBuilderDefaults = (workingDoc) => {
  if (!workingDoc || typeof workingDoc !== 'object')
    return
  const { normalized, changed } = normalizePostBuilderDoc(workingDoc)
  if (changed || !Array.isArray(workingDoc.content) || !Array.isArray(workingDoc.structure)) {
    workingDoc.content = normalized.content
    workingDoc.structure = normalized.structure
  }
}

const postBlockIndex = (workingDoc, blockId) => {
  return Array.isArray(workingDoc?.content)
    ? workingDoc.content.findIndex(block => block?.id === blockId)
    : -1
}

const addPostRow = (workingDoc, insertIndex = null) => {
  ensurePostBuilderDefaults(workingDoc)
  if (!Array.isArray(workingDoc.structure))
    workingDoc.structure = []
  const row = createPostRow()
  if (Number.isInteger(insertIndex) && insertIndex >= 0 && insertIndex <= workingDoc.structure.length)
    workingDoc.structure.splice(insertIndex, 0, row)
  else
    workingDoc.structure.push(row)
}

const movePostRow = (workingDoc, rowIndex, direction) => {
  ensurePostBuilderDefaults(workingDoc)
  const rows = Array.isArray(workingDoc?.structure) ? workingDoc.structure : []
  const targetIndex = rowIndex + direction
  if (targetIndex < 0 || targetIndex >= rows.length)
    return
  const [row] = rows.splice(rowIndex, 1)
  rows.splice(targetIndex, 0, row)
}

const cleanupOrphanPostBlocks = (workingDoc) => {
  ensurePostBuilderDefaults(workingDoc)
  const used = new Set()
  for (const row of workingDoc.structure || []) {
    for (const blockId of row?.columns?.[0]?.blocks || [])
      used.add(blockId)
  }
  workingDoc.content = (workingDoc.content || []).filter(block => used.has(block.id))
}

const removePostRow = (workingDoc, rowIndex) => {
  ensurePostBuilderDefaults(workingDoc)
  if (!Array.isArray(workingDoc?.structure))
    return
  workingDoc.structure.splice(rowIndex, 1)
  cleanupOrphanPostBlocks(workingDoc)
}

const addPostBlockToRow = (workingDoc, rowIndex, insertIndex, block) => {
  ensurePostBuilderDefaults(workingDoc)
  const row = workingDoc?.structure?.[rowIndex]
  const col = row?.columns?.[0]
  if (!col)
    return
  const preparedBlock = edgeGlobal.dupObject(block || {})
  preparedBlock.id = edgeGlobal.generateShortId()
  if (!preparedBlock.values || typeof preparedBlock.values !== 'object' || Array.isArray(preparedBlock.values))
    preparedBlock.values = {}
  if (!preparedBlock.meta || typeof preparedBlock.meta !== 'object' || Array.isArray(preparedBlock.meta))
    preparedBlock.meta = {}
  if (typeof preparedBlock.content !== 'string')
    preparedBlock.content = String(preparedBlock.content || '')

  workingDoc.content.push(preparedBlock)
  col.blocks.splice(insertIndex, 0, preparedBlock.id)
}

const removePostBlockFromStructure = (workingDoc, blockId) => {
  for (const row of workingDoc?.structure || []) {
    if (row?.columns?.[0]?.blocks)
      row.columns[0].blocks = row.columns[0].blocks.filter(id => id !== blockId)
  }
}

const deletePostBlock = (workingDoc, blockId) => {
  ensurePostBuilderDefaults(workingDoc)
  if (Array.isArray(workingDoc.content)) {
    const index = workingDoc.content.findIndex(block => block?.id === blockId)
    if (index !== -1)
      workingDoc.content.splice(index, 1)
  }
  removePostBlockFromStructure(workingDoc, blockId)
}

const resetEditorTracking = () => {
  state.editMode = false
  state.editorDoc = null
  state.slugManuallyEdited = false
  state.internalSlugUpdate = false
  state.lastAutoSlug = ''
}

const openNewPost = () => {
  if (props.mode === 'list') {
    emit('update:selectedPostId', 'new')
    return
  }
  state.activePostId = 'new'
  resetEditorTracking()
  state.sheetOpen = true
}

const editPost = (postId) => {
  if (props.mode === 'list') {
    emit('update:selectedPostId', postId)
    return
  }
  state.editMode = false
  state.activePostId = postId
  state.slugManuallyEdited = true
  state.internalSlugUpdate = false
  state.lastAutoSlug = getPostSlug(posts.value?.[postId]) || ''
  state.sheetOpen = true
}

const closeSheet = () => {
  state.sheetOpen = false
  state.activePostId = ''
  resetEditorTracking()
  if (props.mode === 'editor')
    emit('update:selectedPostId', '')
}

const handlePostSaved = () => {
  console.log('Post saved')
}

const onWorkingDocUpdate = (doc) => {
  if (doc && typeof doc === 'object') {
    const { normalized, changed, migratedFromLegacyHtml } = normalizePostBuilderDoc(doc)
    if (changed) {
      doc.content = normalized.content
      doc.structure = normalized.structure
    }
    if (migratedFromLegacyHtml) {
      const migrationId = String(state.activePostId || 'new')
      if (!notifiedLegacyMigrationIds.has(migrationId)) {
        notifiedLegacyMigrationIds.add(migrationId)
        edgeFirebase?.toast?.success?.('Legacy post HTML migrated to a local rich text block.')
      }
    }
  }

  state.editorDoc = doc
  if (!state.slugManuallyEdited && doc?.name)
    state.lastAutoSlug = doc.name
}

watch(
  () => props.selectedPostId,
  (next) => {
    if (props.mode !== 'editor')
      return
    if (!next) {
      closeSheet()
      return
    }
    if (next === 'new') {
      state.activePostId = 'new'
      resetEditorTracking()
      state.sheetOpen = true
      return
    }
    state.activePostId = next
    state.editMode = false
    state.slugManuallyEdited = true
    state.internalSlugUpdate = false
    state.lastAutoSlug = getPostSlug(posts.value?.[next]) || ''
    state.sheetOpen = true
  },
  { immediate: true },
)

const openRenameDialog = (post) => {
  const slug = getPostSlug(post)
  const fallback = slug || ensureUniqueSlug(post?.title || post?.name || 'post', post?.id)
  state.renamePost = {
    id: post.id,
    title: post.title || '',
    currentSlug: slug,
  }
  state.renameSubmitting = false
  state.renameInternalUpdate = true
  state.renameValue = fallback
  state.renameInternalUpdate = false
  state.renameDialog = true
}

const closeRenameDialog = () => {
  state.renameDialog = false
  state.renamePost = null
  state.renameValue = ''
  state.renameSubmitting = false
}

const renamePostAction = async () => {
  if (!state.renamePost?.id)
    return closeRenameDialog()

  state.renameSubmitting = true

  let desired = slugify(state.renameValue || state.renamePost.currentSlug || state.renamePost.title || 'post')
  if (!desired)
    desired = 'post'

  const unique = ensureUniqueSlug(desired, state.renamePost.id)

  if (unique === state.renamePost.currentSlug) {
    state.renameSubmitting = false
    closeRenameDialog()
    return
  }

  try {
    await edgeFirebase.changeDoc(collectionKey.value, state.renamePost.id, { name: unique })
    state.renameValue = unique
    closeRenameDialog()
  }
  catch (error) {
    console.error('Failed to rename post:', error)
    state.renameSubmitting = false
  }
}

const showDeleteDialog = (post) => {
  state.postToDelete = {
    id: post.id,
    name: post.title || getPostSlug(post) || 'Untitled Post',
  }
  state.deleteDialog = true
}

const deletePost = async () => {
  const target = state.postToDelete
  if (!target?.id) {
    state.deleteDialog = false
    return
  }

  const postId = target.id
  try {
    await edgeFirebase.removeDoc(collectionKey.value, postId)
    await edgeFirebase.removeDoc(publishedCollectionKey.value, postId)
    if (state.activePostId === postId)
      closeSheet()
  }
  catch (error) {
    console.error('Failed to delete post:', error)
  }
  finally {
    state.deleteDialog = false
    state.postToDelete = null
  }
}

const addTag = async (tag) => {
  console.log('Tag to add:', tag)
}

const getTagsFromPosts = computed(() => {
  const tagMap = new Map()
  postsList.value.forEach((post) => {
    if (Array.isArray(post.tags)) {
      post.tags.forEach((tag) => {
        if (tag && typeof tag === 'string' && !tagMap.has(tag)) {
          tagMap.set(tag, { name: tag, title: tag })
        }
      })
    }
  })
  return Array.from(tagMap.values()).sort((a, b) => a.title.localeCompare(b.title))
})

const publishPost = async (postId) => {
  emit('updating', true)
  if (!postId)
    return
  const post = posts.value?.[postId]
  if (!post)
    return
  try {
    await edgeFirebase.storeDoc(publishedCollectionKey.value, post)
  }
  catch (error) {
    console.error('Failed to publish post:', error)
  }
  emit('updating', false)
}

const unPublishPost = async (postId) => {
  if (!postId)
    return
  try {
    await edgeFirebase.removeDoc(publishedCollectionKey.value, postId)
  }

  catch (error) {
    console.error('Failed to unpublish post:', error)
  }
}
</script>

<template>
  <div
    v-if="props.mode !== 'editor'"
    :class="isFullList ? 'h-full min-h-0 flex flex-col gap-4 overflow-hidden' : 'space-y-4 h-full min-h-0 overflow-y-auto'"
  >
    <edge-shad-button
      variant="outline"
      :class="isFullList ? 'h-8 px-3' : 'w-full mt-2 py-0 h-[28px]'"
      @click="openNewPost"
    >
      <Plus class="h-4 w-4" />
      New Post
    </edge-shad-button>

    <div
      v-if="isFullList"
      class="rounded-lg border bg-card overflow-hidden flex flex-col h-[calc(100vh-180px)] max-h-[calc(100vh-180px)]"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
        <div class="text-sm font-semibold">
          Posts
        </div>
        <div class="text-xs text-muted-foreground">
          {{ postsList.length }} total
        </div>
      </div>
      <div
        v-if="hasPosts"
        class="divide-y overflow-y-auto h-[calc(100vh-260px)] max-h-[calc(100vh-260px)]"
      >
        <div
          v-for="post in postsList"
          :key="post.id"
          class="px-4 py-3 hover:bg-muted/40 cursor-pointer"
          @click="editPost(post.id)"
        >
          <div class="flex items-start gap-4">
            <div class="h-16 w-20 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
              <img
                v-if="postFeaturedImage(post)"
                :src="postFeaturedImage(post)"
                alt=""
                class="h-full w-full object-cover"
              >
              <Image v-else class="h-6 w-6 text-muted-foreground/60" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-sm font-medium text-foreground truncate">
                    {{ post.title || post.name || 'Untitled Post' }}
                  </div>
                  <div class="text-xs text-muted-foreground line-clamp-2">
                    {{ previewContent(post.blurb || post.content) || 'No content yet.' }}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <edge-shad-button variant="ghost" size="icon" class="h-8 w-8" @click.stop>
                      <MoreHorizontal class="h-4 w-4" />
                    </edge-shad-button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem @click="openRenameDialog(post)">
                      <FilePen class="h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="isPublishedPostDiff(postKey(post))" @click="publishPost(postKey(post))">
                      <FileCheck class="h-4 w-4" />
                      Publish
                    </DropdownMenuItem>
                    <DropdownMenuItem v-else @click="unPublishPost(postKey(post))">
                      <FileWarning class="h-4 w-4" />
                      Unpublish
                    </DropdownMenuItem>
                    <DropdownMenuItem class="text-destructive" @click="showDeleteDialog(post)">
                      <Trash2 class="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <div class="flex items-center gap-1">
                  <FileWarning v-if="isPublishedPostDiff(postKey(post))" class="h-3.5 w-3.5 text-yellow-600" />
                  <FileCheck v-else class="h-3.5 w-3.5 text-green-700" />
                  <span>{{ isPublishedPostDiff(postKey(post)) ? 'Draft' : 'Published' }}</span>
                </div>
                <span>{{ formatTimestamp(post.last_updated || post.doc_created_at) }}</span>
                <div v-if="Array.isArray(post.tags) && post.tags.length" class="flex flex-wrap items-center gap-1">
                  <span
                    v-for="tag in tagPreview(post.tags).visible"
                    :key="tag"
                    class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-if="tagPreview(post.tags).remaining"
                    class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    +{{ tagPreview(post.tags).remaining }}
                  </span>
                </div>
                <span v-if="Array.isArray(post.featuredImages) && post.featuredImages.length">
                  {{ post.featuredImages.length }} featured image{{ post.featuredImages.length > 1 ? 's' : '' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      >
        <File class="h-8 w-8 text-muted-foreground/60" />
        <div class="space-y-1">
          <h3 class="text-base font-medium">
            No posts yet
          </h3>
          <p class="text-sm text-muted-foreground">
            Create your first post to start publishing content.
          </p>
        </div>
        <edge-shad-button variant="outline" class="gap-2" @click="openNewPost">
          <Plus class="h-4 w-4" />
          New Post
        </edge-shad-button>
      </div>
    </div>

    <div v-else>
      <div v-if="hasPosts" class="space-y-2 hidden">
        <SidebarMenuItem v-for="post in postsList" :key="post.id">
          <SidebarMenuButton class="!px-0 hover:!bg-transparent" @click="editPost(post.id)">
            <div class="h-8 w-8 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
              <img
                v-if="postFeaturedImage(post)"
                :src="postFeaturedImage(post)"
                alt=""
                class="h-full w-full object-cover"
              >
              <Image v-else class="h-4 w-4 text-muted-foreground/60" />
            </div>
            <FileWarning v-if="isPublishedPostDiff(postKey(post))" class="!text-yellow-600 ml-2" />
            <FileCheck v-else class="text-xs !text-green-700 font-normal ml-2" />
            <div class="ml-2 flex flex-col text-left">
              <span class="text-sm font-medium">{{ post.name || 'Untitled Post' }}</span>
            </div>
          </SidebarMenuButton>
          <SidebarGroupAction class="absolute right-2 top-0 hover:!bg-transparent">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuAction>
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem @click="openRenameDialog(post)">
                  <FilePen class="h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem v-if="isPublishedPostDiff(postKey(post))" @click="publishPost(postKey(post))">
                  <FileCheck class="h-4 w-4" />
                  Publish
                </DropdownMenuItem>
                <DropdownMenuItem v-else @click="unPublishPost(postKey(post))">
                  <FileWarning class="h-4 w-4" />
                  Unpublish
                </DropdownMenuItem>

                <DropdownMenuItem class="text-destructive" @click="showDeleteDialog(post)">
                  <Trash2 class="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupAction>
          <div class="w-full pl-7 pb-2 text-xs text-muted-foreground cursor-pointer" @click="editPost(post.id)">
            <div>{{ formatTimestamp(post.last_updated || post.doc_created_at) }}</div>
            <div v-if="Array.isArray(post.tags) && post.tags.length" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="tag in tagPreview(post.tags).visible"
                :key="tag"
                class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
              >
                {{ tag }}
              </span>
              <span
                v-if="tagPreview(post.tags).remaining"
                class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                +{{ tagPreview(post.tags).remaining }}
              </span>
            </div>
            <div v-if="Array.isArray(post.featuredImages) && post.featuredImages.length" class="mt-1 text-[11px]">
              {{ post.featuredImages.length }} featured image{{ post.featuredImages.length > 1 ? 's' : '' }}
            </div>
          </div>
          <Separator class="my-2" />
        </SidebarMenuItem>
      </div>

      <div
        v-else
        class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 px-6 py-10 text-center"
      >
        <File class="h-8 w-8 text-muted-foreground/60" />
        <div class="space-y-1">
          <h3 class="text-base font-medium">
            No posts yet
          </h3>
          <p class="text-sm text-muted-foreground">
            Create your first post to start publishing content.
          </p>
        </div>
        <edge-shad-button variant="outline" class="gap-2" @click="openNewPost">
          <Plus class="h-4 w-4" />
          New Post
        </edge-shad-button>
      </div>
    </div>
  </div>

  <edge-shad-dialog v-model="state.deleteDialog">
    <DialogContent class="pt-10">
      <DialogHeader>
        <DialogTitle class="text-left">
          Delete "{{ state.postToDelete?.name || 'this post' }}"?
        </DialogTitle>
        <DialogDescription>
          This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="flex justify-between pt-2">
        <edge-shad-button variant="outline" @click="state.deleteDialog = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button variant="destructive" class="w-full" @click="deletePost">
          Delete
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>

  <edge-shad-dialog v-model="state.renameDialog">
    <DialogContent class="pt-10">
      <edge-shad-form :schema="renameSchema" @submit="renamePostAction">
        <DialogHeader>
          <DialogTitle class="text-left">
            Rename "{{ state.renamePost?.title || state.renamePost?.currentSlug || 'Post' }}"
          </DialogTitle>
          <DialogDescription>
            Update the slug used in URLs. Existing links will change after renaming.
          </DialogDescription>
        </DialogHeader>
        <edge-shad-input v-model="state.renameValue" name="name" label="Name" />
        <DialogFooter class="flex justify-between pt-2">
          <edge-shad-button variant="outline" @click="closeRenameDialog">
            Cancel
          </edge-shad-button>
          <edge-shad-button
            type="submit"
            class="w-full bg-slate-800 text-white hover:bg-slate-400"
            :disabled="state.renameSubmitting"
          >
            <Loader2 v-if="state.renameSubmitting" class="h-4 w-4 animate-spin" />
            <span v-else>Rename</span>
          </edge-shad-button>
        </DialogFooter>
      </edge-shad-form>
    </DialogContent>
  </edge-shad-dialog>

  <template v-if="props.mode === 'editor'">
    <div v-if="editorOpen" class="h-full flex flex-col bg-background px-0">
      <edge-editor
        v-if="editorOpen"
        :collection="collection"
        :doc-id="state.activePostId"
        :schema="schemas.posts"
        :new-doc-schema="state.newDocs.posts"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0 px-0"
        card-content-class="px-0"
        :show-header="true"
        :no-close-after-save="true"
        :save-function-override="handlePostSaved"
        @working-doc="onWorkingDocUpdate"
      >
        <template #header="slotProps">
          <div class="relative flex items-center bg-secondary p-2 justify-between sticky top-0 z-50 bg-primary rounded h-[50px]">
            <span class="text-lg font-semibold whitespace-nowrap pr-1">{{ sheetTitle }}</span>
            <div class="flex w-full items-center">
              <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />
              <div class="flex items-center gap-1 pr-3">
                <edge-shad-button
                  type="button"
                  variant="text"
                  class="hover:text-primary/50 text-xs h-[26px] text-primary"
                  @click="state.editMode = !state.editMode"
                >
                  <template v-if="state.editMode">
                    <Eye class="w-4 h-4" />
                    Preview Mode
                  </template>
                  <template v-else>
                    <Pencil class="w-4 h-4" />
                    Edit Mode
                  </template>
                </edge-shad-button>
                <edge-shad-button
                  v-if="!slotProps.unsavedChanges"
                  variant="text"
                  class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
                  @click="closeSheet"
                >
                  <X class="w-4 h-4" />
                  Close
                </edge-shad-button>
                <edge-shad-button
                  v-else
                  variant="text"
                  class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
                  @click="closeSheet"
                >
                  <X class="w-4 h-4" />
                  Cancel
                </edge-shad-button>
                <edge-shad-button
                  v-if="isCreating || slotProps.unsavedChanges"
                  variant="text"
                  type="submit"
                  class="bg-secondary hover:text-primary/50 text-xs h-[26px] text-primary"
                  :disabled="slotProps.submitting"
                >
                  <Loader2 v-if="slotProps.submitting" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                  <span>Save</span>
                </edge-shad-button>
              </div>
            </div>
          </div>
        </template>
        <template #main="slotProps">
          <div class="p-6 h-[calc(100vh-122px)] overflow-y-auto">
            <div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div class="space-y-6">
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Post Details
                  </div>
                  <edge-shad-input
                    v-model="slotProps.workingDoc.name"
                    name="name"
                    label="Name (slug used in URL)"
                  />
                  <edge-shad-input
                    v-model="slotProps.workingDoc.title"
                    name="title"
                    label="Title"
                    :disabled="slotProps.submitting"
                  />
                  <edge-shad-select-tags
                    v-model="slotProps.workingDoc.tags"
                    name="tags"
                    label="Tags"
                    placeholder="Add a tag"
                    :disabled="slotProps.submitting"
                    :items="getTagsFromPosts"
                    :allow-additions="true"
                    @add="addTag"
                  />
                </div>
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Featured Image
                  </div>
                  <div class="relative bg-muted/50 py-2 h-48 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer">
                    <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer rounded-lg">
                      <Dialog v-model:open="state.imageOpen">
                        <DialogTrigger as-child>
                          <edge-shad-button variant="outline" class="bg-white text-black hover:bg-gray-200">
                            <ImagePlus class="h-5 w-5" />
                            Select Image
                          </edge-shad-button>
                        </DialogTrigger>
                        <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Select Image</DialogTitle>
                            <DialogDescription />
                          </DialogHeader>
                          <edge-cms-media-manager
                            :site="props.site"
                            :select-mode="true"
                            @select="(url) => { slotProps.workingDoc.featuredImage = url; state.imageOpen = false; }"
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                    <img v-if="slotProps.workingDoc.featuredImage" :src="slotProps.workingDoc.featuredImage" class="mb-2 max-h-40 mx-auto object-contain">
                    <span v-else class="text-sm text-muted-foreground italic">No featured image selected</span>
                  </div>
                </div>
              </div>
              <div class="space-y-6">
                <div class="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Content
                  </div>
                  <edge-shad-textarea
                    v-model="slotProps.workingDoc.blurb"
                    name="blurb"
                    label="Content Blurb / Preview"
                    :disabled="slotProps.submitting"
                    rows="6"
                  />
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Content
                      </div>
                      <edge-shad-button
                        v-if="state.editMode"
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc)"
                      >
                        Add Row
                      </edge-shad-button>
                    </div>

                    <div
                      v-if="!slotProps.workingDoc?.structure || slotProps.workingDoc.structure.length === 0"
                      :class="state.editMode ? 'flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50' : 'flex items-center justify-between rounded-md px-4 py-3 bg-gray-50/60'"
                    >
                      <div class="text-sm text-gray-700">
                        {{ state.editMode ? 'No rows yet. Add your first full-width row.' : 'No rows to preview yet.' }}
                      </div>
                      <edge-shad-button
                        v-if="state.editMode"
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc)"
                      >
                        Add Row
                      </edge-shad-button>
                    </div>

                    <div v-for="(row, rowIndex) in slotProps.workingDoc.structure || []" :key="row.id || rowIndex" class="space-y-2">
                      <div v-if="state.editMode" class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                          <edge-shad-button
                            type="button"
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === 0"
                            @click="movePostRow(slotProps.workingDoc, rowIndex, -1)"
                          >
                            <ArrowUp class="h-4 w-4" />
                          </edge-shad-button>
                          <edge-shad-button
                            type="button"
                            variant="outline"
                            size="icon"
                            class="h-8 w-8"
                            :disabled="rowIndex === (slotProps.workingDoc?.structure?.length || 0) - 1"
                            @click="movePostRow(slotProps.workingDoc, rowIndex, 1)"
                          >
                            <ArrowDown class="h-4 w-4" />
                          </edge-shad-button>
                        </div>
                        <edge-shad-button
                          type="button"
                          variant="destructive"
                          size="icon"
                          class="h-8 w-8 text-white"
                          @click="removePostRow(slotProps.workingDoc, rowIndex)"
                        >
                          <Trash2 class="h-4 w-4" />
                        </edge-shad-button>
                      </div>

                      <div :class="state.editMode ? 'rounded-md border border-dashed border-gray-200 bg-white/90 p-3 space-y-2' : 'rounded-md bg-white/90 p-3 space-y-2'">
                        <edge-button-divider v-if="state.editMode" class="my-1">
                          <edge-cms-block-picker
                            :site-id="props.site"
                            :allowed-types="['Post']"
                            @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, 0, block)"
                          />
                        </edge-button-divider>
                        <draggable
                          v-model="row.columns[0].blocks"
                          :disabled="!state.editMode"
                          :group="{ name: 'post-doc-blocks', pull: true, put: true }"
                          :item-key="blockId => blockId"
                          handle=".block-drag-handle"
                          ghost-class="block-ghost"
                          chosen-class="block-dragging"
                          drag-class="block-dragging"
                        >
                          <template #item="{ element: blockId, index: blockPosition }">
                            <div class="space-y-2">
                              <div class="relative group">
                                <edge-cms-block
                                  v-if="postBlockIndex(slotProps.workingDoc, blockId) !== -1"
                                  v-model="slotProps.workingDoc.content[postBlockIndex(slotProps.workingDoc, blockId)]"
                                  :site-id="props.site"
                                  :edit-mode="state.editMode"
                                  :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                                  :override-clicks-in-edit-mode="state.editMode"
                                  :contain-fixed="true"
                                  :block-id="blockId"
                                  @delete="() => deletePostBlock(slotProps.workingDoc, blockId)"
                                />
                                <div v-if="state.editMode" class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30">
                                  <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                                    <GripVertical class="w-4 h-4" />
                                  </div>
                                </div>
                              </div>
                              <div v-if="state.editMode && row.columns[0].blocks.length > blockPosition + 1" class="w-full">
                                <edge-button-divider class="my-2">
                                  <edge-cms-block-picker
                                    :site-id="props.site"
                                    :allowed-types="['Post']"
                                    @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, blockPosition + 1, block)"
                                  />
                                </edge-button-divider>
                              </div>
                            </div>
                          </template>
                        </draggable>
                        <edge-button-divider v-if="state.editMode && row.columns[0].blocks.length > 0" class="my-1">
                          <edge-cms-block-picker
                            :site-id="props.site"
                            :allowed-types="['Post']"
                            @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, row.columns[0].blocks.length, block)"
                          />
                        </edge-button-divider>
                      </div>

                      <edge-button-divider v-if="state.editMode && rowIndex < (slotProps.workingDoc?.structure?.length || 0) - 1" class="my-2">
                        <edge-shad-button
                          type="button"
                          size="sm"
                          class="h-8 text-xs bg-secondary text-primary"
                          @click="addPostRow(slotProps.workingDoc, rowIndex + 1)"
                        >
                          Add Row
                        </edge-shad-button>
                      </edge-button-divider>
                    </div>

                    <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0" class="my-2">
                      <edge-shad-button
                        type="button"
                        size="sm"
                        class="h-8 text-xs bg-secondary text-primary"
                        @click="addPostRow(slotProps.workingDoc, slotProps.workingDoc.structure.length)"
                      >
                        Add Row
                      </edge-shad-button>
                    </edge-button-divider>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div />
        </template>
      </edge-editor>
    </div>
  </template>
  <Sheet v-else v-model:open="state.sheetOpen">
    <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
      <SheetHeader>
        <SheetTitle>{{ sheetTitle }}</SheetTitle>
      </SheetHeader>
      <edge-editor
        v-if="editorOpen"
        :collection="collection"
        :doc-id="state.activePostId"
        :schema="schemas.posts"
        :new-doc-schema="state.newDocs.posts"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0"
        card-content-class="px-0"
        :show-header="false"
        :no-close-after-save="true"
        :save-function-override="handlePostSaved"
        @working-doc="onWorkingDocUpdate"
      >
        <template #main="slotProps">
          <div class="p-6 space-y-4  h-[calc(100vh-122px)] overflow-y-auto">
            <div class="flex justify-end">
              <edge-shad-button
                type="button"
                variant="text"
                class="hover:text-primary/50 text-xs h-[26px] text-primary"
                @click="state.editMode = !state.editMode"
              >
                <template v-if="state.editMode">
                  <Eye class="w-4 h-4" />
                  Preview Mode
                </template>
                <template v-else>
                  <Pencil class="w-4 h-4" />
                  Edit Mode
                </template>
              </edge-shad-button>
            </div>
            <edge-shad-input
              v-model="slotProps.workingDoc.name"
              name="name"
              label="Name"
            />
            <edge-shad-input
              v-model="slotProps.workingDoc.title"
              name="title"
              label="Title"
              :disabled="slotProps.submitting"
            />
            <div class="relative bg-muted py-2 h-48 rounded-md flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer">
              <div class="bg-black/80 absolute left-0 top-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-10 cursor-pointer">
                <Dialog v-model:open="state.imageOpen">
                  <DialogTrigger as-child>
                    <edge-shad-button variant="outline" class="bg-white text-black hover:bg-gray-200">
                      <ImagePlus class="h-5 w-5" />
                      Select Image
                    </edge-shad-button>
                  </DialogTrigger>
                  <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Select Image</DialogTitle>
                      <DialogDescription />
                    </DialogHeader>
                    <edge-cms-media-manager
                      :site="props.site"
                      :select-mode="true"
                      @select="(url) => { slotProps.workingDoc.featuredImage = url; state.imageOpen = false; }"
                    />
                  </DialogContent>
                </Dialog>
              </div>
              <img v-if="slotProps.workingDoc.featuredImage" :src="slotProps.workingDoc.featuredImage" class="mb-2 max-h-40 mx-auto object-contain">
              <span v-else class="text-sm text-muted-foreground italic">No featured image selected, click to select</span>
            </div>
            <edge-shad-select-tags
              v-model="slotProps.workingDoc.tags"
              name="tags"
              label="Tags"
              placeholder="Add a tag"
              :disabled="slotProps.submitting"
              :items="getTagsFromPosts"
              :allow-additions="true"
              @add="addTag"
            />
            <edge-shad-textarea
              v-model="slotProps.workingDoc.blurb"
              name="blurb"
              label="Content Blurb / Preview"
              :disabled="slotProps.submitting"
              rows="8"
            />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Content
                </div>
                <edge-shad-button
                  v-if="state.editMode"
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc)"
                >
                  Add Row
                </edge-shad-button>
              </div>

              <div
                v-if="!slotProps.workingDoc?.structure || slotProps.workingDoc.structure.length === 0"
                :class="state.editMode ? 'flex items-center justify-between border border-dashed border-gray-300 rounded-md px-4 py-3 bg-gray-50' : 'flex items-center justify-between rounded-md px-4 py-3 bg-gray-50/60'"
              >
                <div class="text-sm text-gray-700">
                  {{ state.editMode ? 'No rows yet. Add your first full-width row.' : 'No rows to preview yet.' }}
                </div>
                <edge-shad-button
                  v-if="state.editMode"
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc)"
                >
                  Add Row
                </edge-shad-button>
              </div>

              <div v-for="(row, rowIndex) in slotProps.workingDoc.structure || []" :key="row.id || rowIndex" class="space-y-2">
                <div v-if="state.editMode" class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <edge-shad-button
                      type="button"
                      variant="outline"
                      size="icon"
                      class="h-8 w-8"
                      :disabled="rowIndex === 0"
                      @click="movePostRow(slotProps.workingDoc, rowIndex, -1)"
                    >
                      <ArrowUp class="h-4 w-4" />
                    </edge-shad-button>
                    <edge-shad-button
                      type="button"
                      variant="outline"
                      size="icon"
                      class="h-8 w-8"
                      :disabled="rowIndex === (slotProps.workingDoc?.structure?.length || 0) - 1"
                      @click="movePostRow(slotProps.workingDoc, rowIndex, 1)"
                    >
                      <ArrowDown class="h-4 w-4" />
                    </edge-shad-button>
                  </div>
                  <edge-shad-button
                    type="button"
                    variant="destructive"
                    size="icon"
                    class="h-8 w-8 text-white"
                    @click="removePostRow(slotProps.workingDoc, rowIndex)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </edge-shad-button>
                </div>

                <div :class="state.editMode ? 'rounded-md border border-dashed border-gray-200 bg-white/90 p-3 space-y-2' : 'rounded-md bg-white/90 p-3 space-y-2'">
                  <edge-button-divider v-if="state.editMode" class="my-1">
                    <edge-cms-block-picker
                      :site-id="props.site"
                      :allowed-types="['Post']"
                      @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, 0, block)"
                    />
                  </edge-button-divider>
                  <draggable
                    v-model="row.columns[0].blocks"
                    :disabled="!state.editMode"
                    :group="{ name: 'post-doc-blocks', pull: true, put: true }"
                    :item-key="blockId => blockId"
                    handle=".block-drag-handle"
                    ghost-class="block-ghost"
                    chosen-class="block-dragging"
                    drag-class="block-dragging"
                  >
                    <template #item="{ element: blockId, index: blockPosition }">
                      <div class="space-y-2">
                        <div class="relative group">
                          <edge-cms-block
                            v-if="postBlockIndex(slotProps.workingDoc, blockId) !== -1"
                            v-model="slotProps.workingDoc.content[postBlockIndex(slotProps.workingDoc, blockId)]"
                            :site-id="props.site"
                            :edit-mode="state.editMode"
                            :allow-preview-content-edit="!state.editMode && canOpenPreviewBlockContentEditor"
                            :override-clicks-in-edit-mode="state.editMode"
                            :contain-fixed="true"
                            :block-id="blockId"
                            @delete="() => deletePostBlock(slotProps.workingDoc, blockId)"
                          />
                          <div v-if="state.editMode" class="block-drag-handle pointer-events-none absolute inset-x-0 top-2 flex justify-center opacity-0 transition group-hover:opacity-100 z-30">
                            <div class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/90 shadow px-2 py-1 text-gray-700 cursor-grab">
                              <GripVertical class="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                        <div v-if="state.editMode && row.columns[0].blocks.length > blockPosition + 1" class="w-full">
                          <edge-button-divider class="my-2">
                            <edge-cms-block-picker
                              :site-id="props.site"
                              :allowed-types="['Post']"
                              @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, blockPosition + 1, block)"
                            />
                          </edge-button-divider>
                        </div>
                      </div>
                    </template>
                  </draggable>
                  <edge-button-divider v-if="state.editMode && row.columns[0].blocks.length > 0" class="my-1">
                    <edge-cms-block-picker
                      :site-id="props.site"
                      :allowed-types="['Post']"
                      @pick="(block) => addPostBlockToRow(slotProps.workingDoc, rowIndex, row.columns[0].blocks.length, block)"
                    />
                  </edge-button-divider>
                </div>

                <edge-button-divider v-if="state.editMode && rowIndex < (slotProps.workingDoc?.structure?.length || 0) - 1" class="my-2">
                  <edge-shad-button
                    type="button"
                    size="sm"
                    class="h-8 text-xs bg-secondary text-primary"
                    @click="addPostRow(slotProps.workingDoc, rowIndex + 1)"
                  >
                    Add Row
                  </edge-shad-button>
                </edge-button-divider>
              </div>

              <edge-button-divider v-if="state.editMode && slotProps.workingDoc?.structure && slotProps.workingDoc.structure.length > 0" class="my-2">
                <edge-shad-button
                  type="button"
                  size="sm"
                  class="h-8 text-xs bg-secondary text-primary"
                  @click="addPostRow(slotProps.workingDoc, slotProps.workingDoc.structure.length)"
                >
                  Add Row
                </edge-shad-button>
              </edge-button-divider>
            </div>
          </div>
          <SheetFooter class="pt-2 flex justify-between">
            <edge-shad-button variant="destructive" class="text-white" @click="state.sheetOpen = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button :disabled="slotProps.submitting" type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
              <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
              Save
            </edge-shad-button>
          </SheetFooter>
        </template>
        <template #footer>
          <div />
        </template>
      </edge-editor>
    </SheetContent>
  </Sheet>
</template>
