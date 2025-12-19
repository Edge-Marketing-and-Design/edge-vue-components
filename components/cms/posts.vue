<script setup lang="js">
import { computed, inject, onBeforeMount, reactive, ref, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { File, FileCheck, FilePen, FileWarning, Image, ImagePlus, Loader2, MoreHorizontal, Plus, Save, Trash2, X } from 'lucide-vue-next'

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

const collection = computed(() => `sites/${props.site}/posts`)
const collectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${collection.value}`)

const publishedCollection = computed(() => `sites/${props.site}/published_posts`)
const publishedCollectionKey = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/${publishedCollection.value}`)

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
    content: z.string({
      required_error: 'Content is required',
    }).min(1, { message: 'Content is required' }),
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
    return JSON.stringify({ name: publishedPost.name, content: publishedPost.content, blurb: publishedPost.blurb, tags: publishedPost.tags, title: publishedPost.title, featuredImages: publishedPost.featuredImages }) !== JSON.stringify({ name: draftPost.name, content: draftPost.content, blurb: draftPost.blurb, tags: draftPost.tags, title: draftPost.title, featuredImages: draftPost.featuredImages })
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
  contentImageDialog: false,
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
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'textarea',
          'label': 'Content',
          'rows': '8',
        },
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

const contentEditor = ref(null)

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

const resetEditorTracking = () => {
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

const openContentImageDialog = () => {
  state.contentImageDialog = true
}

const handleContentImageSelect = (url) => {
  if (url && contentEditor.value?.insertImage) {
    contentEditor.value.insertImage(url)
  }
  state.contentImageDialog = false
}

const onWorkingDocUpdate = (doc) => {
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
  <div v-if="props.mode !== 'editor'" class="space-y-4">
    <edge-shad-button
      variant="outline"
      :class="isFullList ? 'h-8 px-3' : 'w-full mt-2 py-0 h-[28px]'"
      @click="openNewPost"
    >
      <Plus class="h-4 w-4" />
      New Post
    </edge-shad-button>

    <div v-if="isFullList" class="rounded-lg border bg-card overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
        <div class="text-sm font-semibold">
          Posts
        </div>
        <div class="text-xs text-muted-foreground">
          {{ postsList.length }} total
        </div>
      </div>
      <div v-if="hasPosts" class="divide-y">
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
        class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
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
                  <edge-shad-html
                    ref="contentEditor"
                    v-model="slotProps.workingDoc.content"
                    height-class="h-[calc(100vh-490px)]"
                    :enabled-toggles="['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline', 'image']"
                    name="content"
                    label="Content"
                    :disabled="slotProps.submitting"
                    @request-image="openContentImageDialog"
                  />
                  <Dialog v-model:open="state.contentImageDialog">
                    <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Select Image</DialogTitle>
                        <DialogDescription />
                      </DialogHeader>
                      <edge-cms-media-manager
                        :site="props.site"
                        :select-mode="true"
                        @select="handleContentImageSelect"
                      />
                    </DialogContent>
                  </Dialog>
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
            <edge-shad-html
              ref="contentEditor"
              v-model="slotProps.workingDoc.content"
              :enabled-toggles="['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline', 'image']"
              name="content"
              label="Content"
              :disabled="slotProps.submitting"
              @request-image="openContentImageDialog"
            />
            <Dialog v-model:open="state.contentImageDialog">
              <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Select Image</DialogTitle>
                  <DialogDescription />
                </DialogHeader>
                <edge-cms-media-manager
                  :site="props.site"
                  :select-mode="true"
                  @select="handleContentImageSelect"
                />
              </DialogContent>
            </Dialog>
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
