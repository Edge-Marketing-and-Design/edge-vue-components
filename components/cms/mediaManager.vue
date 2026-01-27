<script setup>
import { ImagePlus, Loader2, Square, SquareCheckBig } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  site: {
    type: String,
    required: false,
    default: 'all',
  },
  selectMode: {
    type: Boolean,
    required: false,
    default: false,
  },
  defaultTags: {
    type: Array,
    required: false,
    default: () => [],
  },
})

// const edgeGlobal = inject('edgeGlobal')

const emits = defineEmits(['select'])

const edgeFirebase = inject('edgeFirebase')
const route = useRoute()
const router = useRouter()

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
  showUpload: false,
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
onBeforeMount(() => {
  console.log('Default tags prop:', props.defaultTags)
  if (props.defaultTags && Array.isArray(props.defaultTags) && props.defaultTags.length > 0) {
    state.filterTags = [...props.defaultTags]
  }
})

const canDeleteMedia = (item) => {
  if (!props.site)
    return true
  if (item?.meta?.cmssite && Array.isArray(item.meta.cmssite)) {
    return item.meta.cmssite.includes(props.site)
  }
  return false
}

const itemClick = (item) => {
  if (props.selectMode) {
    emits('select', edgeGlobal.getImage(item, 'public') || '')
  }
  else {
    state.editMedia = true
    state.workingDoc = item
  }
}

const isLightName = (name) => {
  if (!name)
    return false
  return String(name).toLowerCase().includes('light')
}

const previewBackgroundClass = computed(() => (isLightName(state.workingDoc?.name) ? 'bg-neutral-900/90' : 'bg-neutral-100'))
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
    class="w-full mx-auto bg-background text-foreground rounded-[9.96px] px-0 border border-border/70 shadow-sm"
  >
    <Sheet v-model:open="state.showUpload">
      <SheetContent side="top" class="w-full max-w-none sm:max-w-none max-w-2xl bg-card text-foreground border border-border">
        <SheetHeader>
          <SheetTitle />
          <SheetDescription />
        </SheetHeader>
        <edge-shad-form class="px-2 sm:px-4">
          <edge-shad-select-tags
            v-model="state.tags"
            :items="getTagsFromMedia"
            name="tags"
            placeholder="Select tags"
            :allow-additions="true"
            class="w-full max-w-[800px] mx-auto mb-4 text-foreground"
          />
        </edge-shad-form>
        <div class="relative">
          <edge-auto-file-upload
            v-model="state.file"
            name="file"
            :multiple="true"
            :accept="['image/jpg', 'image/jpeg', 'image/png', 'image/gif']"
            file-path="images"
            :r2="true"
            :disabled="state.tags.length === 0"
            disabled-text="Tags are required"
            class="w-full mx-auto border-dashed border-primary/60 bg-gradient-to-br from-primary/90 via-primary to-primary/90 dark:from-muted dark:via-muted/90 dark:to-muted border text-primary-foreground dark:text-foreground py-10 rounded-[20px] my-3 shadow-lg shadow-primary/20 dark:shadow-black/30"
            :extra-meta="{ tags: state.tags, cmsmedia: true, cmssite: [props.site] }"
          >
            <template #title>
              <div class="flex items-center gap-2 justify-center gap-5 text-primary-foreground dark:text-foreground drop-shadow">
                <div>
                  <ImagePlus class="h-10 w-10" />
                </div>
                <div>
                  <h1 class="text-4xl font-[700] leading-none">
                    Drag & Drop
                  </h1>
                </div>
                <div class="text-xl pt-2 font-sans font-semibold">
                  OR
                </div>
              </div>
            </template>
            <template #description>
              <edge-shad-button class="bg-secondary mt-3 text-primary shadow-sm">
                Upload
              </edge-shad-button>
              <div class="hidden" />
            </template>
          </edge-auto-file-upload>
          <div
            v-if="state.tags.length === 0"
            class="pointer-events-auto absolute inset-0 z-20 rounded-[20px] border border-dashed border-border/70 bg-background/85 dark:bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6 text-foreground"
          >
            <div class="text-lg font-semibold">Tags are required</div>
            <div class="text-sm text-muted-foreground">Add tags above to enable upload</div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
    <edge-dashboard
      :filter="state.filter"
      sort-field="uploadTime"
      query-field="meta.cmssite"
      :filters="filters"
      :query-value="['all', props.site]"
      query-operator="array-contains-any"
      header-class=""
      sort-direction="desc" class="w-full flex-1 border-none shadow-none bg-background"
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
                  <div>
                    <edge-shad-button @click="state.showUpload = true">
                      <ImagePlus class="h-5 w-5 mr-2" />
                      Upload Media
                    </edge-shad-button>
                  </div>
                  <div class="w-1/2">
                    <edge-shad-select
                      v-if="!state.clearingTags"
                      v-model="state.filterTags"
                      :multiple="true"
                      name="tags"
                      class="text-foreground w-full"
                      :items="getTagsFromMedia"
                      placeholder="Filter Tags"
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
        <div v-if="!selectMode" class="flex justify-end gap-2 mt-2 px-3">
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
        <div class=" mx-auto px-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div v-for="item in slotProps.filtered" :key="item.docId" class="w-full cursor-pointer" @click="itemClick(item)">
            <edge-cms-media-card
              :item="item"
              :selected="state.selected.includes(item.docId)"
              class="block w-full h-full"
              :select-mode="props.selectMode"
              :can-delete="canDeleteMedia(item)"
              @select="(checked, docId) => handleCheckboxChange(checked, docId)"
              @delete="(docId) => slotProps.deleteItem(docId)"
            />
          </div>
        </div>
      </template>
    </edge-dashboard>
    <Sheet v-model:open="state.editMedia">
      <SheetContent class="w-full md:w-1/2 max-w-none sm:max-w-none max-w-2xl bg-card text-foreground border border-border">
        <SheetHeader>
          <SheetTitle>{{ state.workingDoc?.fileName }}</SheetTitle>
          <SheetDescription>
            <div class="h-[450px] rounded-lg mb-4 flex items-center justify-center overflow-hidden" :class="previewBackgroundClass">
              <img
                :src="edgeGlobal.getImage(state.workingDoc, 'public')"
                alt=""
                class="max-h-full max-w-full h-auto w-auto object-contain"
              >
            </div>
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
                class="w-full max-w-[800px] mx-auto mb-5 text-foreground"
              />
            </div>
            <SheetFooter class="pt-2 flex justify-between">
              <edge-shad-button variant="destructive" class="text-white" @click="state.editMedia = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button :disabled="slotProps.submitting" type="submit" class="w-full">
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
