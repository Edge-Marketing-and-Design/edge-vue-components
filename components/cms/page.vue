<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  site: {
    type: String,
    required: true,
  },
  page: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['head'])

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  newDocs: {
    pages: {
      name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Name' }, cols: '12', value: '' },
      content: { value: [] },
      postContent: { value: [] },
    },
  },
  editMode: false,
  workingDoc: {},
})

const schemas = {
  pages: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}

const deleteBlock = (blockId, slotProps, post = false) => {
  console.log('Deleting block with ID:', blockId)
  if (post) {
    const index = slotProps.workingDoc.postContent.findIndex(block => block.id === blockId)
    if (index !== -1) {
      slotProps.workingDoc.postContent.splice(index, 1)
    }
    return
  }
  const index = slotProps.workingDoc.content.findIndex(block => block.id === blockId)
  if (index !== -1) {
    slotProps.workingDoc.content.splice(index, 1)
  }
}

const blockPick = (block, index, slotProps, post = false) => {
  const generatedId = edgeGlobal.generateShortId()
  block.id = generatedId
  if (index === 0 || index) {
    if (post) {
      slotProps.workingDoc.postContent.splice(index, 0, block)
    }
    else {
      slotProps.workingDoc.content.splice(index, 0, block)
    }
  }
}

onMounted(() => {
  if (props.page === 'new') {
    state.editMode = true
  }
})

const editorDocUpdates = (workingDoc) => {
  const blockIds = workingDoc.content.map(block => block.blockId).filter(id => id)
  const postBlockIds = workingDoc.postContent ? workingDoc.postContent.map(block => block.blockId).filter(id => id) : []
  blockIds.push(...postBlockIds)
  const uniqueBlockIds = [...new Set(blockIds)]
  state.workingDoc.blockIds = uniqueBlockIds
}

const pageName = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page]?.name || ''
})

const theme = computed(() => {
  const theme = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site]?.theme || ''
  console.log(`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}`)
  let themeContents = null
  if (theme) {
    themeContents = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.theme || null
  }
  if (themeContents) {
    return JSON.parse(themeContents)
  }
  return null
})

const headObject = computed(() => {
  const theme = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`]?.[props.site]?.theme || ''
  try {
    return JSON.parse(edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/themes`]?.[theme]?.headJSON || '{}')
  }
  catch (e) {
    return {}
  }
})

watch(headObject, (newHeadElements) => {
  emit('head', newHeadElements)
}, { immediate: true, deep: true })

const isPublishedPageDiff = (pageId) => {
  const publishedPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]
  const draftPage = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[pageId]
  if (!publishedPage && draftPage) {
    return true
  }
  if (publishedPage && !draftPage) {
    return true
  }
  if (publishedPage && draftPage) {
    return JSON.stringify({ content: publishedPage.content, postContent: publishedPage.postContent, metaTitle: publishedPage.metaTitle, metaDescription: publishedPage.metaDescription, structuredData: publishedPage.structuredData }) !== JSON.stringify({ content: draftPage.content, postContent: draftPage.postContent, metaTitle: draftPage.metaTitle, metaDescription: draftPage.metaDescription, structuredData: draftPage.structuredData })
  }
  return false
}

const lastPublishedTime = (pageId) => {
  const timestamp = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/published`]?.[pageId]?.last_updated
  if (!timestamp)
    return 'Never'
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const currentPage = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites/${props.site}/pages`]?.[props.page] || null
})

watch (currentPage, (newPage) => {
  state.workingDoc.last_updated = newPage?.last_updated
  state.workingDoc.metaTitle = newPage?.metaTitle
  state.workingDoc.metaDescription = newPage?.metaDescription
  state.workingDoc.structuredData = newPage?.structuredData
}, { immediate: true, deep: true })
</script>

<template>
  <edge-editor
    :collection="`sites/${site}/pages`"
    :doc-id="page"
    :schema="schemas.pages"
    :new-doc-schema="state.newDocs.pages"
    class="w-full mx-auto flex-1 bg-transparent flex flex-col border-none shadow-none pt-0"
    :show-footer="false"
    :save-redirect-override="`/app/dashboard/sites/${site}`"
    :no-close-after-save="true"
    :working-doc-overrides="state.workingDoc"
    @working-doc="editorDocUpdates"
  >
    <template #header="slotProps">
      <div class="relative flex items-center bg-secondary p-2 justify-between sticky top-0 z-10 bg-primary rounded h-[50px]">
        <span class="text-lg font-semibold whitespace-nowrap pr-1">{{ pageName }}</span>

        <div class="flex w-full items-center">
          <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />
          <div class="px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap text-center">
            <edge-chip v-if="isPublishedPageDiff(page)" class="bg-yellow-100 text-yellow-800">
              <div class="w-full">
                Unpublished Changes
              </div>
              <span class="text-[10px]">Last Published: {{ lastPublishedTime(page) }}</span>
            </edge-chip>
            <edge-chip v-else class="bg-green-100 text-green-800">
              <div class="w-full">
                Published
              </div>
              <span class="text-[10px]">Last Published: {{ lastPublishedTime(page) }}</span>
            </edge-chip>
          </div>
          <div class="w-full border-t border-gray-300 dark:border-white/15" aria-hidden="true" />

          <edge-shad-button variant="text" class="hover:text-primary/50 text-xs h-[26px] text-primary" @click="state.editMode = !state.editMode">
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
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            variant="text"
            class="hover:text-red-700/50 text-xs h-[26px] text-red-700"
            @click="slotProps.onCancel"
          >
            <X class="w-4 h-4" />
            Cancel
          </edge-shad-button>
          <edge-shad-button
            v-if="state.editMode || slotProps.unsavedChanges"
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
    </template>
    <template #main="slotProps">
      <Tabs class="w-full" default-value="list">
        <TabsList v-if="slotProps.workingDoc?.post" class="w-full mt-3 bg-primary rounded-sm">
          <TabsTrigger value="list">
            List Page
          </TabsTrigger>
          <TabsTrigger value="post">
            Post Page
          </TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Separator class="my-4" />
          <edge-button-divider v-if="state.editMode" class="my-2">
            <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => blockPick(block, 0, slotProps)" />
          </edge-button-divider>
          <div class="w-full mx-auto  bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
            <draggable
              v-if="slotProps.workingDoc?.content && slotProps.workingDoc.content.length > 0"
              v-model="slotProps.workingDoc.content"
              handle=".handle"
              item-key="id"
            >
              <template #item="{ element, index }">
                <div :key="element.id" class="">
                  <div :class="{ 'border-1 border-dotted py-1 mb-1': state.editMode }" class="flex w-full items-center w-full">
                    <div v-if="state.editMode" class="text-left px-2">
                      <Grip class="handle pointer" />
                    </div>
                    <div :class="state.editMode ? 'px-2 py-2 w-[98%]' : 'w-[100%]'">
                      <edge-cms-block
                        v-model="slotProps.workingDoc.content[index]"
                        :site-id="props.site"
                        :edit-mode="state.editMode"
                        :block-id="element.id" class=""
                        :theme="theme"
                        @delete="(block) => deleteBlock(block, slotProps)"
                      />
                    </div>
                  </div>
                  <div v-if="state.editMode" class="w-full">
                    <edge-button-divider class="my-2">
                      <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => blockPick(block, index + 1, slotProps)" />
                    </edge-button-divider>
                  </div>
                </div>
              </template>
            </draggable>
          </div>
        </TabsContent>
        <TabsContent value="post">
          <Separator class="my-4" />
          <edge-button-divider v-if="state.editMode" class="my-2">
            <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => blockPick(block, 0, slotProps, true)" />
          </edge-button-divider>
          <div class="w-full mx-auto  bg-white drop-shadow-[4px_4px_6px_rgba(0,0,0,0.5)] shadow-lg shadow-black/30">
            <draggable
              v-if="slotProps.workingDoc?.postContent && slotProps.workingDoc.postContent.length > 0"
              v-model="slotProps.workingDoc.postContent"
              handle=".handle"
              item-key="id"
            >
              <template #item="{ element, index }">
                <div :key="element.id" class="">
                  <div :class="{ 'border-1 border-dotted py-1 mb-1': state.editMode }" class="flex w-full items-center w-full">
                    <div v-if="state.editMode" class="text-left px-2">
                      <Grip class="handle pointer" />
                    </div>
                    <div :class="state.editMode ? 'px-2 py-2 w-[98%]' : 'w-[100%]'">
                      <edge-cms-block
                        v-model="slotProps.workingDoc.postContent[index]"
                        :edit-mode="state.editMode"
                        :block-id="element.id" class=""
                        :theme="theme"
                        :site-id="props.site"
                        @delete="(block) => deleteBlock(block, slotProps, true)"
                      />
                    </div>
                  </div>
                  <div v-if="state.editMode" class="w-full">
                    <edge-button-divider class="my-2">
                      <edge-cms-block-picker :site-id="props.site" :theme="theme" @pick="(block) => blockPick(block, index + 1, slotProps, true)" />
                    </edge-button-divider>
                  </div>
                </div>
              </template>
            </draggable>
          </div>
        </TabsContent>
      </Tabs>
    </template>
  </edge-editor>
</template>
