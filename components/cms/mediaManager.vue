<script setup>
import { ImagePlus, Loader2, Square, SquareCheckBig } from 'lucide-vue-next'
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
      class="w-full max-w-7xl mx-auto border-dashed border-secondary bg-primary py-10 text-white rounded-[20px] my-5"
    >
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
      header-class=""
      sort-direction="desc" class="w-full max-w-7xl flex-1 border-none shadow-none  bg-white"
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
                <edge-shad-input
                  v-model="state.filter"
                  label=""
                  name="filter"
                  class="text-foreground"
                  placeholder="Search"
                />
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
        <div class="max-w-7xl mx-auto px-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div v-for="item in slotProps.filtered" :key="item.docId" class="w-full">
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
  </div>
</template>

<style>
.data-\[state\=on\]\:bg-accent[data-state="on"] {
    background-color: #D9D9D9;
    box-shadow: 0px 4px 4px 0px #202C3E52 inset;

}
</style>
