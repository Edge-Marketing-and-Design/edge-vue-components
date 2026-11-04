<script setup>
import { ArrowLeft, CalendarClock, CalendarDays, Check, Eye, FileText, History, Loader2, Plus, Save, Trash2 } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { buildPostTypeFields, buildTypedPost, getPostPath, postTypeSchema, preparePostTypePage, setPostPath, withPostProjection } from '../../lib/cmsPostTypes'
import { buildCmsPostLiveUrl } from '../../lib/cmsPostRoutes'
import { buildPostEntryPreviewBlock, postEntryPreviewRows } from '../../lib/cmsPostEntryPreview'
import { normalizePostEvent, postEventPublishProblem } from '../../lib/cmsPostEvents.mjs'
import { slugify, uniquePostSlug } from '../../lib/cmsOperations'
import { findCmsPageRoute } from '../../lib/cmsPublishedSitePreview'

const props = defineProps({ site: { type: String, required: true }, definition: { type: Object, required: true }, theme: { type: Object, default: null }, canManageRestrictions: { type: Boolean, default: false } })
const edgeFirebase = inject('edgeFirebase')
const origin = inject('cmsPublishedSiteOrigin', ref(''))
const collection = computed(() => `sites/${props.site}/posts`)
const base = computed(() => `${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}`)
const path = computed(() => `${base.value}/posts`)
const snapshots = computed(() => edgeFirebase.data?.[`${base.value}/published_posts`] || {})
const publishedPages = computed(() => edgeFirebase.data?.[`${base.value}/published`] || {})
const records = computed(() => Object.entries(edgeFirebase.data?.[path.value] || {}).filter(([, post]) => post.postTypeId === props.definition.id).map(([id, post]) => ({ ...post, docId: id })))
const selected = ref('')
const search = ref('')
const saving = ref(false)
const error = ref('')
const editingFields = ref('')
const fieldDraft = ref({})
const schedule = ref('')
const publishOpen = ref(false)
const eventOpen = ref(false)
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const localDateInput = (value) => {
  const date = value ? new Date(value) : new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const deleteOpen = ref(false)
const sessionPage = ref(null)
const eventType = computed(() => (sessionPage.value || props.definition.page)?.postType?.event === true)
const editorRevision = ref(0)
const historyOpen = ref(false)
const historyLoading = ref(false)
const historyItems = ref([])
const historySelected = ref('')
const compareOpen = ref(false)
const restoreOpen = ref(false)
const discardPublishedOpen = ref(false)
const loading = ref(false)
const fields = computed(() => buildPostTypeFields(sessionPage.value || props.definition.page))
const visible = computed(() => records.value.filter(post => `${post.title} ${post.name} ${post.blurb}`.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => (b.doc_created_at || 0) - (a.doc_created_at || 0)))
const sourcePost = computed(() => records.value.find(post => post.docId === selected.value))
const blockRows = computed(() => postEntryPreviewRows(sessionPage.value))
const schema = toTypedSchema(z.object({ title: z.string().min(1, 'Title is required'), name: z.string().min(1, 'URL slug is required'), blurb: z.string().min(1, 'Preview text is required').max(500) }).passthrough())
const initial = computed(() => {
  const doc = { title: '', name: '', blurb: '', tags: [], featuredImage: '', postTypeId: props.definition.id, postTypeSchema: postTypeSchema(sessionPage.value || props.definition.page), type: props.definition.type }
  if (eventType.value)
    doc.event = normalizePostEvent({}, userTimezone)
  for (const field of fields.value) setPostPath(doc, field.field, field.default)
  return Object.fromEntries(Object.entries(doc).map(([key, value]) => [key, { value }]))
},
)
const siteDoc = computed(() => edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site] || {})
const typeTheme = computed(() => {
  if (props.theme)
    return props.theme
  const theme = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[siteDoc.value.theme]
  try {
    const parsed = typeof theme?.theme === 'string' ? JSON.parse(theme.theme) : (theme?.theme || null)
    return parsed ? { ...parsed, extraCSS: theme?.extraCSS || '' } : null
  }
  catch {
    return null
  }
},
)
const unsaved = ref(false)
const discardOpen = ref(false)
const lastAutoSlug = ref('')
const manualSlug = ref(false)
const open = (id) => {
  error.value = ''
  manualSlug.value = id !== 'new'
  lastAutoSlug.value = ''
  sessionPage.value = preparePostTypePage(props.definition.page, props.definition.id)
  selected.value = id
  schedule.value = localDateInput(sourcePost.value?.publishAt || sourcePost.value?.publishedAt)
  publishOpen.value = false
  eventOpen.value = false
}
watch(() => [props.site, props.definition.id], () => {
  selected.value = ''
  error.value = ''
},
)
onBeforeMount(async () => {
  loading.value = true
  try {
    for (const relative of ['posts', 'published_posts', 'published']) {
      const key = `${base.value}/${relative}`
      if (!edgeFirebase.data?.[key])
        await edgeFirebase.startSnapshot(key)
    }
  }
  catch (err) {
    error.value = err.message
  }
  finally {
    loading.value = false
  }
},
)
const updateWorkingDoc = (doc) => {
  if (selected.value !== 'new' || doc?.docId || !doc)
    return
  if (doc.name && doc.name !== lastAutoSlug.value)
    manualSlug.value = true
  if (manualSlug.value)
    return
  const titleSlug = slugify(doc.title)
  if (!titleSlug)
    return
  const taken = new Set(Object.values(edgeFirebase.data?.[path.value] || {}).map(post => post.name))
  const next = uniquePostSlug(titleSlug, taken)
  lastAutoSlug.value = next
  if (doc.name !== next)
    doc.name = next
}

const save = async (doc) => {
  const current = edgeFirebase.data?.[`${base.value}/pages`]?.[props.definition.id]
  if (!current || postTypeSchema(current) !== postTypeSchema(sessionPage.value))
    throw new Error('The detail page changed. Reopen the post to load its latest fields.')
  const name = String(doc.name || '').trim().toLowerCase()
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name))
    throw new Error('Use letters, numbers, dashes or underscores for the URL slug.')
  const duplicates = Object.entries(edgeFirebase.data?.[path.value] || {}).some(([id, post]) => id !== doc.docId && post.name === name)
  if (duplicates)
    throw new Error('That URL slug is already used by another post in this site.')
  if (doc.restrictionRuleId && !(siteDoc.value.restrictedContent?.rules || []).some(rule => rule.id === doc.restrictionRuleId))
    throw new Error('Choose an existing access rule for this site.')
  const payload = buildTypedPost({ page: current, pageId: props.definition.id, post: { ...doc, name } })
  const result = await edgeFirebase.storeDoc(path.value, payload)
  if (result?.success === false)
    throw new Error(result.message || 'Unable to save post.')
  const id = result?.docId || result?.meta?.docId || payload.docId
  if (!id)
    throw new Error('Save did not return a post ID.')
  return { ...result, docId: id, data: { ...payload, docId: id } }
}
const saved = ({ docId }) => {
  selected.value = docId
  unsaved.value = false
}
const run = async (action) => {
  saving.value = true
  error.value = ''
  try {
    await action()
  }
  catch (err) {
    error.value = err.message
  }
  finally {
    saving.value = false
  }
}
const publish = (at = null) => run(async () => {
  const page = publishedPages.value[props.definition.id]
  const post = sourcePost.value
  if (!page?.postType?.enabled || (page.postType.event === true) !== eventType.value)
    throw new Error('Publish this type’s defining page and event setting before publishing its entries.')
  if (!post || unsaved.value)
    throw new Error('Save your changes before publishing.')
  const payload = withPostProjection(buildTypedPost({ page, pageId: props.definition.id, post }), page)
  const publishTime = at || new Date(schedule.value).toISOString()
  const blocked = postEventPublishProblem(payload, Date.parse(publishTime))
  if (blocked)
    throw new Error(blocked)
  payload.publishedAt = publishTime
  payload.doc_created_at = Date.parse(publishTime)
  const { validateTypedPostMetadata } = await import('../../lib/cmsPostTypes')
  validateTypedPostMetadata(payload, { orgId: edgeGlobal.edgeState.currentOrganization, siteId: props.site, postId: post.docId })
  delete payload.publishAt
  delete payload.publishAtTimezone
  const result = await edgeFirebase.storeDoc(`${base.value}/published_posts`, payload, post.docId)
  if (result?.success === false)
    throw new Error(result.message || 'Publishing failed.')
  await edgeFirebase.changeDoc(path.value, post.docId, { publishedAt: payload.publishedAt, doc_created_at: payload.doc_created_at, publishAt: '', publishAtTimezone: '' })
},
)
const unpublish = () => run(async () => {
  const result = await edgeFirebase.removeDoc(`${base.value}/published_posts`, selected.value)
  if (result?.success === false)
    throw new Error(result.message || 'Unpublishing failed.')
},
)
const schedulePost = () => run(async () => {
  if (!schedule.value || !Number.isFinite(Date.parse(schedule.value)))
    throw new Error('Select a publication date and time.')
  if (unsaved.value || !sourcePost.value)
    throw new Error('Save your changes before scheduling.')
  const page = publishedPages.value[props.definition.id]
  if (!page?.postType?.enabled || (page.postType.event === true) !== eventType.value)
    throw new Error('Publish this type’s defining page and event setting before scheduling its entries.')
  const blocked = postEventPublishProblem(sourcePost.value, Date.parse(schedule.value))
  if (blocked)
    throw new Error(blocked)
  if (Date.parse(schedule.value) <= Date.now()) {
    await publish(new Date(schedule.value).toISOString())
    return
  }
  await edgeFirebase.changeDoc(path.value, selected.value, { publishAt: new Date(schedule.value).toISOString(), publishAtTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  publishOpen.value = false
},
)
const remove = () => run(async () => {
  const unpublished = await edgeFirebase.removeDoc(`${base.value}/published_posts`, selected.value)
  if (unpublished?.success === false)
    throw new Error(unpublished.message || 'Unpublishing failed.')
  const result = await edgeFirebase.removeDoc(path.value, selected.value)
  if (result?.success === false)
    throw new Error(result.message || 'Deleting failed.')
  selected.value = ''
  deleteOpen.value = false
},
)
const pageBlock = id => (sessionPage.value?.postContent || []).find(block => block.id === id)
const blockFields = id => fields.value.filter(field => field.blockId === id)
const editFields = (id, doc) => {
  editingFields.value = id
  fieldDraft.value = edgeGlobal.dupObject(doc)
}
const applyFields = (doc) => {
  for (const field of blockFields(editingFields.value)) setPostPath(doc, field.field, getPostPath(fieldDraft.value, field.field) ?? field.default)
  editingFields.value = ''
}
const previewBlock = (id, doc) => buildPostEntryPreviewBlock(sessionPage.value, id, doc)
const readHistoryItems = (value) => {
  if (!value || typeof value !== 'object')
    return []
  if (Array.isArray(value))
    return value.filter(item => item && typeof item === 'object' && (item.afterData || item.beforeData))
  for (const key of ['items', 'data', 'result']) {
    const found = readHistoryItems(value[key])
    if (found.length)
      return found
  }
  return []
}
const showHistory = async () => {
  historyOpen.value = true
  historyLoading.value = true
  historySelected.value = ''
  try {
    const result = await edgeFirebase.runFunction('history-listHistory', { uid: edgeFirebase.user.uid, path: `${path.value}/${selected.value}`, limit: 50 })
    historyItems.value = readHistoryItems(result)
  }
  catch (err) {
    error.value = err.message
  }
  finally {
    historyLoading.value = false
  }
}
const historicalPost = computed(() => {
  const entry = historyItems.value.find((item, index) => String(item.historyId || index) === historySelected.value)
  return entry?.afterData || entry?.beforeData || null
},
)
const compareRows = (before, after) => {
  const paths = [...new Set(['title', 'name', 'blurb', 'tags', 'featuredImage', 'restrictionRuleId', 'event', ...fields.value.map(field => field.field)])]
  const display = value => value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return paths.filter(field => JSON.stringify(getPostPath(before, field)) !== JSON.stringify(getPostPath(after, field))).map(field => ({ field, before: display(getPostPath(before, field)), after: display(getPostPath(after, field)) }))
}
const restoreValues = snapshot => run(async () => {
  if (!snapshot || snapshot.postTypeId !== props.definition.id)
    throw new Error('That version belongs to a different post type.')
  await save({ ...snapshot, docId: selected.value })
  editorRevision.value++
  historyOpen.value = false
  restoreOpen.value = false
  discardPublishedOpen.value = false
},
)

const published = computed(() => snapshots.value[selected.value])
const status = computed(() => {
  if (!published.value)
    return 'Unpublished'
  const compare = (post) => {
    const result = { ...post }
    for (const key of ['publishedAt', 'doc_created_at', 'last_updated', 'uid', 'publishAt', 'publishAtTimezone', 'postTypeProjection']) delete result[key]
    return JSON.stringify(Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))))
  }
  return compare(sourcePost.value || {}) === compare(published.value) ? 'Published' : 'Published (Unpublished Changes)'
},
)
const publicationStatus = computed(() => ({
  label: status.value,
  icon: !published.value ? 'draft' : status.value === 'Published' ? 'published' : 'changes',
  badgeClass: 'text-muted-foreground',
  canPublish: true,
  canUnpublish: !!published.value,
  publishBlockedReason: (!publishedPages.value[props.definition.id]?.postType?.enabled || (publishedPages.value[props.definition.id]?.postType?.event === true) !== eventType.value) ? 'Publish this type’s defining page and event setting first.' : postEventPublishProblem(sourcePost.value),
}))
const clearSchedule = () => run(async () => {
  const result = await edgeFirebase.changeDoc(path.value, selected.value, { publishAt: '', publishAtTimezone: '', publishAtError: '' })
  schedule.value = localDateInput(sourcePost.value?.publishedAt)
  if (result?.success === false)
    throw new Error(result.message || 'Unable to clear schedule.')
})
const liveUrl = computed(() => {
  const settings = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/published-site-settings`]?.[props.site] || {}
  const route = findCmsPageRoute(settings.menus, props.definition.id)
  return buildCmsPostLiveUrl({ origin: origin.value, routeSegments: route === '/' ? ['home'] : (route || '').split('/').filter(Boolean), postSlug: sourcePost.value?.name })
},
)
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
    <div v-if="error" role="alert" class="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {{ error }}
    </div>
    <template v-if="!selected">
      <header class="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 class="text-xl font-semibold">
            {{ definition.name }}
          </h2><p class="mt-1 text-sm text-muted-foreground">
            {{ records.length }} {{ records.length === 1 ? 'entry' : 'entries' }}
          </p>
        </div>
        <edge-shad-button class="gap-2" @click="open('new')">
          <Plus class="h-4 w-4" />Add New
        </edge-shad-button>
      </header>
      <div v-if="loading" class="flex justify-center p-12" role="status">
        <Loader2 class="h-5 w-5 animate-spin" /><span class="sr-only">Loading entries</span>
      </div>
      <div v-else class="space-y-4 overflow-y-auto p-6">
        <edge-shad-input v-model="search" name="typed-post-search" :label="`Search ${definition.name}`" :placeholder="`Search ${definition.name.toLowerCase()}...`" />
        <p v-if="!visible.length" class="rounded-lg border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {{ search ? 'No matching entries.' : 'No entries yet. Add your first one.' }}
        </p>
        <div v-else class="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <button v-for="post in visible" :key="post.docId" type="button" class="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" @click="open(post.docId)">
            <img v-if="post.featuredImage" :src="post.featuredImage" alt="" class="h-14 w-20 rounded-md object-cover">
            <FileText v-else class="h-8 w-8 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="font-medium">
                {{ post.title }}
              </div><div class="truncate text-xs text-muted-foreground">
                {{ post.blurb }}
              </div>
            </div>
            <span class="text-xs text-muted-foreground">{{ snapshots[post.docId] ? 'Published' : post.publishAt ? 'Scheduled' : 'Draft' }}</span>
          </button>
        </div>
      </div>
    </template>
    <edge-editor v-else :key="`${definition.id}:${editorRevision}`" :collection="collection" :doc-id="selected" :schema="schema" :new-doc-schema="initial" :save-handler="save" class="min-h-0 flex-1 overflow-y-auto rounded-none border-0 shadow-none" :no-close-after-save="true" :show-header="true" :show-footer="false" card-content-class="px-0" @saved="saved" @working-doc="updateWorkingDoc" @unsaved-changes="value => unsaved = value">
      <template #header="slot">
        <div class="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background p-3">
          <div class="flex items-center gap-2">
            <edge-shad-button type="button" variant="ghost" size="sm" @click="unsaved ? discardOpen = true : selected = ''">
              <ArrowLeft class="mr-1 h-4 w-4" />{{ definition.name }}
            </edge-shad-button><span class="text-xs text-muted-foreground">{{ status }}</span><span v-if="unsaved" class="text-xs text-amber-700 dark:text-amber-300">Unsaved changes</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <edge-shad-button v-if="sourcePost" type="button" variant="ghost" size="sm" :disabled="unsaved || saving" @click="showHistory">
              <History class="mr-1 h-4 w-4" />History
            </edge-shad-button>
            <edge-shad-button v-if="published" type="button" variant="ghost" size="sm" :disabled="unsaved || saving" @click="compareOpen = true">
              Compare
            </edge-shad-button>
            <edge-shad-button v-if="published && status !== 'Published'" type="button" variant="ghost" size="sm" :disabled="unsaved || saving" @click="discardPublishedOpen = true">
              Discard changes
            </edge-shad-button>
            <edge-shad-button v-if="eventType" type="button" variant="outline" size="sm" @click="eventOpen = true">
              <CalendarDays class="mr-1 h-4 w-4" />Event details
            </edge-shad-button>
            <edge-shad-button type="button" variant="outline" size="sm" @click="publishOpen = true">
              <CalendarClock class="mr-1 h-4 w-4" />Publishing
            </edge-shad-button>
            <edge-shad-button v-if="published && liveUrl" as="a" :href="liveUrl" target="_blank" rel="noopener" variant="ghost" size="sm">
              <Eye class="mr-1 h-4 w-4" />View
            </edge-shad-button>
            <edge-shad-button v-if="sourcePost" type="button" variant="ghost" size="icon" aria-label="Delete post" :disabled="saving" @click="deleteOpen = true">
              <Trash2 class="h-4 w-4" />
            </edge-shad-button>
            <edge-shad-button type="submit" size="sm" :disabled="slot.submitting || saving || !slot.unsavedChanges">
              <Loader2 v-if="slot.submitting" class="mr-1 h-4 w-4 animate-spin" /><Save v-else class="mr-1 h-4 w-4" />Save
            </edge-shad-button>
          </div>
        </div>
      </template>
      <template #main="slot">
        <div class="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div class="min-w-0 space-y-4">
            <p class="px-1 text-xs text-muted-foreground">
              Select an area below to edit its content.
            </p>
            <div v-for="row in blockRows" :key="row.id" class="grid grid-cols-6" :class="[row.width, row.tailwindClasses]" :style="{ gap: `${Number(row.gap || 4) * 0.25}rem`, paddingTop: `${Number(row.paddingTop || 0) * 0.25}rem`, paddingBottom: `${Number(row.paddingBottom || 0) * 0.25}rem`, alignItems: row.verticalAlign || 'start' }">
              <div v-for="column in row.columns" :key="column.id" class="min-w-0 space-y-3" :style="{ gridColumn: `span ${Math.min(6, Math.max(1, Number(column.span) || 6))}` }">
                <div v-for="id in column.blocks" :key="id" class="group relative overflow-hidden rounded-md border border-border" :class="blockFields(id).length ? 'ring-primary/0 transition hover:ring-2 hover:ring-primary/40' : ''">
                  <edge-cms-block-api v-if="pageBlock(id)" v-bind="previewBlock(id, slot.workingDoc)" :site-id="site" :theme="typeTheme" :render-context="slot.workingDoc" />
                  <button v-if="blockFields(id).length" type="button" class="absolute inset-0 z-10 flex items-start justify-end p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" :aria-label="`Edit ${pageBlock(id)?.name || 'block'} content`" @click="editFields(id, slot.workingDoc)">
                    <span class="rounded-full bg-background/95 px-3 py-1 text-xs font-medium shadow">Edit content</span>
                  </button>
                </div>
              </div>
            </div>
            <p v-if="!fields.length" class="py-10 text-center text-sm text-muted-foreground">
              This detail page has no editable blocks yet. Add content blocks to the detail page to create its entry form.
            </p>
          </div>
          <aside class="space-y-4 rounded-lg border border-border bg-muted/20 p-4 self-start">
            <h3 class="text-sm font-semibold">
              Entry details
            </h3>
            <edge-shad-input v-model="slot.workingDoc.title" name="title" label="Title" />
            <edge-shad-input v-model="slot.workingDoc.name" name="name" label="URL slug" />
            <edge-shad-textarea v-model="slot.workingDoc.blurb" name="blurb" label="Preview text" :rows="4" />
            <edge-shad-tags v-model="slot.workingDoc.tags" name="tags" label="Tags" />
            <edge-shad-select v-if="canManageRestrictions && siteDoc.restrictedContent?.enabled" v-model="slot.workingDoc.restrictionRuleId" name="restrictionRuleId" label="Access" :items="[{ id: '', name: 'Public' }, ...(siteDoc.restrictedContent?.rules || [])]" item-title="name" item-value="id" />
            <edge-cms-block-input v-model="slot.workingDoc.featuredImage" field="featuredImage" type="image" label="Featured image" :site="site" />
          </aside>
        </div>
        <Dialog v-model:open="eventOpen">
          <DialogContent class="max-h-[85vh] max-w-xl overflow-y-auto">
            <DialogHeader><DialogTitle>Event details</DialogTitle><DialogDescription>Event dates, location and registration. Save the entry to keep these changes.</DialogDescription></DialogHeader>
            <edge-cms-post-event-fields v-if="slot.workingDoc.event" v-model="slot.workingDoc.event" :disabled="saving || slot.submitting" />
            <p v-else class="text-sm text-muted-foreground">
              This entry predates event support. Choose Add event details, then fill in its dates and location.
            </p>
            <edge-shad-button v-if="!slot.workingDoc.event" type="button" @click="slot.workingDoc.event = normalizePostEvent({}, userTimezone)">
              Add event details
            </edge-shad-button>
            <DialogFooter>
              <edge-shad-button type="button" variant="outline" @click="eventOpen = false">
                Done
              </edge-shad-button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet :open="!!editingFields" @update:open="value => { if (!value) editingFields = '' }">
          <SheetContent class="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader><SheetTitle>Edit content</SheetTitle><SheetDescription>Update the content for this entry.</SheetDescription></SheetHeader>
            <div class="space-y-5 py-6">
              <div v-for="field in blockFields(editingFields)" :key="field.field">
                <edge-cms-post-value-field :model-value="getPostPath(fieldDraft, field.field) ?? field.default" :field="field" :site="site" @update:model-value="value => setPostPath(fieldDraft, field.field, value)" />
              </div>
              <edge-shad-button type="button" class="w-full" @click="applyFields(slot.workingDoc)">
                <Check class="mr-2 h-4 w-4" />Apply content
              </edge-shad-button>
            </div>
          </SheetContent>
        </Sheet>
      </template>
      <template #footer />
    </edge-editor>
    <Dialog v-model:open="compareOpen">
      <DialogContent class="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Changes since publication</DialogTitle><DialogDescription>Published values compared with the saved draft.</DialogDescription></DialogHeader><p v-if="!compareRows(published, sourcePost).length" class="text-sm text-muted-foreground">
          No content changes.
        </p><div v-for="row in compareRows(published, sourcePost)" :key="row.field" class="space-y-2 border-b border-border py-3">
          <h4 class="text-sm font-medium">
            {{ row.field }}
          </h4><div class="grid grid-cols-2 gap-3 text-xs">
            <p class="break-words rounded bg-muted p-3 whitespace-pre-wrap">
              {{ row.before }}
            </p><p class="break-words rounded bg-primary/5 p-3 whitespace-pre-wrap">
              {{ row.after }}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="historyOpen">
      <DialogContent class="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Entry history</DialogTitle><DialogDescription>Review a saved version. Restoring updates the draft only.</DialogDescription></DialogHeader><Loader2 v-if="historyLoading" class="h-5 w-5 animate-spin" /><p v-else-if="!historyItems.length" class="text-sm text-muted-foreground">
          No earlier versions found.
        </p><edge-shad-select v-else v-model="historySelected" name="typed-history" label="Saved version" :items="historyItems.map((item, index) => ({ id: String(item.historyId || index), label: `${new Date(item.timestamp || item.createdAt || item.doc_created_at || 0).toLocaleString()} · ${item.action || 'Saved'}` }))" item-title="label" item-value="id" /><div v-if="historicalPost" class="space-y-3">
          <div v-for="row in compareRows(historicalPost, sourcePost)" :key="row.field" class="border-b border-border pb-3">
            <h4 class="text-sm font-medium">
              {{ row.field }}
            </h4><div class="mt-2 grid grid-cols-2 gap-3 text-xs">
              <p class="break-words whitespace-pre-wrap">
                {{ row.before }}
              </p><p class="break-words whitespace-pre-wrap">
                {{ row.after }}
              </p>
            </div>
          </div><edge-shad-button :disabled="saving" @click="restoreOpen = true">
            Restore this version
          </edge-shad-button>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog v-model:open="restoreOpen">
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Restore these saved values?</AlertDialogTitle><AlertDialogDescription>The current draft will be replaced. The published post stays unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction :disabled="saving" @click="restoreValues(historicalPost)">
            Restore draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog v-model:open="discardPublishedOpen">
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Discard unpublished changes?</AlertDialogTitle><AlertDialogDescription>The draft will return to its published values.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction :disabled="saving" @click="restoreValues(published)">
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog v-model:open="publishOpen">
      <DialogContent class="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Publishing</DialogTitle><DialogDescription>Publish now, choose a publication date, or schedule this entry.</DialogDescription></DialogHeader>
        <edge-cms-post-publishing v-model="schedule" :status="publicationStatus" :last-published="published?.publishedAt ? new Date(published.publishedAt).toLocaleString() : 'Never'" :scheduled-at="sourcePost?.publishAt || ''" :scheduled-label="sourcePost?.publishAt ? new Date(sourcePost.publishAt).toLocaleString() : ''" :busy="saving" :unsaved="unsaved" :is-new="!sourcePost" :schedule-blocked-reason="postEventPublishProblem(sourcePost, Date.parse(schedule))" :error="error || sourcePost?.publishAtError || ''" @publish="publish()" @schedule="schedulePost" @unpublish="unpublish" @clear="clearSchedule" />
      </DialogContent>
    </Dialog>
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete this entry?</AlertDialogTitle><AlertDialogDescription>This removes its draft and published version.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction :disabled="saving" @click="remove">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog v-model:open="discardOpen">
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your saved post will remain.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction @click="selected = ''; discardOpen = false">
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
