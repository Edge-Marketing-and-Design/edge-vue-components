<script setup lang="js">
import { computed, inject, onBeforeMount, reactive, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { File, FileCheck, FilePen, FileWarning, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-vue-next'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['updating'])

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
    return JSON.stringify({ name: publishedPost.name, content: publishedPost.content, tags: publishedPost.tags, title: publishedPost.title, featuredImages: publishedPost.featuredImages }) !== JSON.stringify({ name: draftPost.name, content: draftPost.content, tags: draftPost.tags, title: draftPost.title, featuredImages: draftPost.featuredImages })
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
      content: {
        value: '',
        cols: '12',
        bindings: {
          'field-type': 'textarea',
          'label': 'Content',
          'rows': '8',
        },
      },
      featuredImages: {
        value: [],
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

const sheetTitle = computed(() => {
  if (!state.sheetOpen)
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
  state.activePostId = 'new'
  resetEditorTracking()
  state.sheetOpen = true
}

const editPost = (postId) => {
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
}

const handlePostSaved = () => {
  console.log('Post saved')
  closeSheet()
}

const onWorkingDocUpdate = (doc) => {
  state.editorDoc = doc
  if (!state.slugManuallyEdited && doc?.name)
    state.lastAutoSlug = doc.name
}

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
  <div class="space-y-4">
    <edge-shad-button variant="outline" class="w-full mt-2 py-0 h-[28px]" @click="openNewPost">
      <Plus class="h-4 w-4" />
      New Post
    </edge-shad-button>

    <div v-if="hasPosts" class="space-y-2">
      <SidebarMenuItem v-for="post in postsList" :key="post.id">
        <SidebarMenuButton class="!px-0 hover:!bg-transparent" @click="editPost(post.id)">
          <FileWarning v-if="isPublishedPostDiff(post.docId)" class="!text-yellow-600" />
          <FileCheck v-else class="text-xs !text-green-700 font-normal" />
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
              <DropdownMenuItem v-if="isPublishedPostDiff(post.docId)" @click="publishPost(post.docId)">
                <FileCheck class="h-4 w-4" />
                Publish
              </DropdownMenuItem>
              <DropdownMenuItem v-else @click="unPublishPost(post.docId)">
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
              v-for="tag in post.tags"
              :key="tag"
              class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
            >
              {{ tag }}
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

  <Sheet v-model:open="state.sheetOpen">
    <SheetContent side="left" class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
      <SheetHeader>
        <SheetTitle>{{ sheetTitle }}</SheetTitle>
      </SheetHeader>
      <edge-editor
        v-if="state.sheetOpen"
        :collection="collection"
        :doc-id="state.activePostId"
        :schema="schemas.posts"
        :new-doc-schema="state.newDocs.posts"
        class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0"
        card-content-class="px-0"
        :show-header="false"
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
            <edge-shad-html v-model="slotProps.workingDoc.content" :enabled-toggles="['bold', 'italic', 'strike', 'bulletlist', 'orderedlist', 'underline']" name="content" label="Content" :disabled="slotProps.submitting" />
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
