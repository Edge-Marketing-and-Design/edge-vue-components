<script setup>
import { ImagePlus, Loader2, Square, SquareCheckBig } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const edgeFirebase = inject('edgeFirebase')
const route = useRoute()
const router = useRouter()

// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  filter: '',
  file: [],
  view: 'list',
  selected: [],
  selectAll: false,
  publishing: false,
  unpublishing: false,
  deleting: false,
  tags: [],
  workingDoc: null,
  editMedia: false,
  filterTags: [],
  newDocs: {
    media: {
      name: { value: '' },
      meta: { tags: [] },
    },
  },
  clearingTags: false,
})

const files = computed(() => {
  return edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/files`]
})

const filteredFiles = computed(() => {
  const list = Object.values(files.value || {})
  return list
    .filter(m =>
      !state.filter || m.name?.toLowerCase().includes(state.filter.toLowerCase()),
    )
    .sort((a, b) => (b.uploadTime || 0) - (a.uploadTime || 0))
})

const selectAll = computed(() => {
  return state.selectAll
})

watch(selectAll, (newValue) => {
  if (newValue) {
    state.selected = filteredFiles.value.map(item => item.docId)
  }
  else {
    state.selected = []
  }
})

const handleCheckboxChange = (checked, docId) => {
  console.log('Checkbox changed:', checked, docId)
  if (checked && !state.selected.includes(docId)) {
    state.selected.push(docId)
  }
  else if (!checked) {
    state.selected = state.selected.filter(id => id !== docId)
  }
}

const deleteSelected = async () => {
  console.log('Deleting selected files:', state.selected)
  state.deleting = true
  for (const docId of state.selected) {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/files`, docId)
  }
  state.selected = []
  state.selectAll = false
  state.deleting = false
}
const getTagsFromMedia = computed(() => {
  const tagsSet = new Set()
  Object.values(files.value || {}).forEach((file) => {
    console.log('File meta tags:', file.meta?.tags)
    if (file.meta?.tags && Array.isArray(file.meta.tags)) {
      file.meta.tags.forEach(tag => tagsSet.add(tag))
    }
  })
  console.log('Unique tags from media:', Array.from(tagsSet))
  return Array.from(tagsSet).map(tag => ({ name: tag, title: tag }))
})
const schemas = {
  media: toTypedSchema(z.object({
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Name is required' }),
  })),
}
const onSubmit = () => {
  state.workingDoc = null
  state.editMedia = false
}
const filters = computed(() => {
  const filters = [{ filterFields: ['name'], value: state.filter }]
  if (state.filterTags) {
    filters.push({ filterFields: ['meta.tags'], value: state.filterTags })
  }
  return filters
})
const clearTags = async () => {
  state.clearingTags = true
  console.log('Clearing tags')
  state.filterTags = []
  await nextTick()
  state.clearingTags = false
}
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
    class="w-full  mx-auto  bg-white rounded-[9.96px] px-0"
  >
    <edge-auto-file-upload
      v-model="state.file"
      name="file"
      :multiple="true"
      :accept="['image/jpg', 'image/jpeg', 'image/png', 'image/gif']"
      file-path="images"
      :r2="true"
      :disabled="state.tags.length === 0"
      disabled-text="Tags are required"
      class="w-full mx-auto border-dashed border-secondary bg-primary py-10 text-white rounded-[20px] my-3"
      :extra-meta="{ tags: state.tags, cmsmedia: true }"
    >
      <template #header>
        <edge-shad-form>
          <edge-shad-select-tags
            v-model="state.tags"
            :items="getTagsFromMedia"
            name="tags"
            placeholder="Select tags"
            :allow-additions="true"
            class="w-full max-w-[800px] mx-auto mb-5 text-black"
          />
        </edge-shad-form>
      </template>
      <template #title>
        <div class="flex items-center gap-2 justify-center gap-5">
          <div>
            <ImagePlus class="h-10 w-10" />
          </div>
          <div>
            <h1 class="text-white text-4xl font-[700] leading-none">
              Drag & Drop
            </h1>
          </div>
          <div class="text-xl pt-2  text-white font-sans font-semibold">
            OR
          </div>
        </div>
      </template>
      <template #description>
        <edge-shad-button class="bg-secondary mt-3 text-primary">
          Upload
        </edge-shad-button>
        <div class="hidden" />
      </template>
    </edge-auto-file-upload>
    <edge-dashboard
      :filter="state.filter"
      sort-field="uploadTime"
      query-field="meta.cmsmedia"
      :filters="filters"
      :query-value="true"
      header-class=""
      sort-direction="desc" class="w-full flex-1 border-none shadow-none  bg-white"
      collection="files"
    >
      <template #header>
        <edge-menu class="bg-transparent text-foreground border-none shadow-none px-2 rounded-none gap-1">
          <template #start>
            <div />
          </template>
          <template #center>
            <div class="w-full px-0">
              <edge-shad-form>
                <div class="flex justify-between items-center gap-2 w-full">
                  <div class="w-1/2">
                    <edge-shad-select
                      v-if="!state.clearingTags"
                      v-model="state.filterTags"
                      :multiple="true"
                      name="tags"
                      class="text-foreground w-full"
                      :items="getTagsFromMedia"
                      placeholder="Tags"
                    >
                      <template v-if="state.filterTags.length > 0" #icon>
                        <X class="h-5 w-5 text-muted-foreground cursor-pointer" @click="clearTags" />
                      </template>
                    </edge-shad-select>
                  </div>
                  <div class="w-1/2">
                    <edge-shad-input
                      v-model="state.filter"
                      label=""
                      name="filter"
                      class="text-foreground w-full"
                      placeholder="Search"
                    />
                  </div>
                </div>
              </edge-shad-form>
            </div>
          </template>
          <template #end>
            <div />
          </template>
        </edge-menu>
        <div class="flex justify-end gap-2 mt-2 px-3">
          <edge-shad-button
            class="w-[140px] h-[30px]"
            @click="state.selectAll = !state.selectAll"
          >
            <Square v-if="!state.selectAll" class="h-5 w-5" />
            <SquareCheckBig v-else class="h-5 w-5" />
            {{ state.selectAll ? 'Deselect All' : 'Select All' }}
          </edge-shad-button>
          <edge-shad-button
            variant="destructive"
            :disabled="state.deleting || state.selected.length === 0"
            class="h-[30px]"
            @click="deleteSelected"
          >
            <Loader2 v-if="state.deleting" class="animate-spin h-5 w-5 mr-2" />
            Delete Selected
          </edge-shad-button>
        </div>
      </template>
      <template #list="slotProps">
        <div class=" mx-auto px-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div v-for="item in slotProps.filtered" :key="item.docId" class="w-full cursor-pointer" @click="state.editMedia = true; state.workingDoc = item">
            <edge-cms-media-card
              :item="item"
              :selected="state.selected.includes(item.docId)"
              class="block w-full h-full"
              @select="(checked, docId) => handleCheckboxChange(checked, docId)"
              @delete="(docId) => slotProps.deleteItem(docId)"
            />
          </div>
        </div>
      </template>
    </edge-dashboard>
    <Sheet v-model:open="state.editMedia">
      <SheetContent class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl">
        <SheetHeader>
          <SheetTitle>{{ state.workingDoc?.fileName }}</SheetTitle>
          <SheetDescription>
            <img :src="edgeGlobal.getImage(state.workingDoc, 'public')" alt="" class="h-[450px] m-auto object-fit rounded-lg mb-4">
            Original Name: <span class="font-semibold">{{ state.workingDoc?.fileName }}</span>, Size: <span class="font-semibold">{{ (state.workingDoc?.fileSize / 1024).toFixed(2) }} KB</span>
          </SheetDescription>
        </SheetHeader>

        <edge-editor
          v-if="state.workingDoc"
          :doc-id="state.workingDoc.docId"
          collection="files"
          :new-doc-schema="state.newDocs.media"
          :schema="schemas.media"
          :show-footer="false"
          :show-header="false"
          class="w-full px-0 mx-0 bg-transparent"
          :save-function-override="onSubmit"
          card-content-class="mx-0 px-0"
        >
          <template #main="slotProps">
            <div class="p-6 space-y-4  h-[calc(100vh-628px)] overflow-y-auto">
              <edge-shad-input
                v-model="slotProps.workingDoc.name"
                name="name"
                label="Display Name"
                class="w-full mb-4"
                placeholder="File name"
              />
              <edge-shad-select-tags
                v-model="slotProps.workingDoc.meta.tags"
                :items="getTagsFromMedia"
                label="Tags"
                name="tags"
                placeholder="Select tags"
                :allow-additions="true"
                class="w-full max-w-[800px] mx-auto mb-5 text-black"
              />
            </div>
            <SheetFooter class="pt-2 flex justify-between">
              <edge-shad-button variant="destructive" class="text-white" @click="state.editMedia = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button :disabled="slotProps.submitting" type="submit" class=" bg-slate-800 hover:bg-slate-400 w-full">
                <Loader2 v-if="slotProps.submitting" class=" h-4 w-4 animate-spin" />
                Update
              </edge-shad-button>
            </SheetFooter>
          </template>
        </edge-editor>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style>
.data-\[state\=on\]\:bg-accent[data-state="on"] {
    background-color: #D9D9D9;
    box-shadow: 0px 4px 4px 0px #202C3E52 inset;

}
</style>
