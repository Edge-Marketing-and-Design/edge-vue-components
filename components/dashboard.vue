<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  paginated: {
    type: Boolean,
    default: false,
  },
  paginatedQuery: {
    type: Array,
    default: () => [],
  },
  pagintedSort: {
    type: Array,
    default: () => [{ field: 'name', direction: 'asc' }],
  },
  paginatedLimit: {
    type: Number,
    default: 100,
  },
  collection: {
    type: String,
    required: true,
  },
  class: {
    type: String,
    default: '',
  },
  filter: {
    type: String,
    default: '',
  },
  sortField: {
    type: String,
    default: 'name',
  },
  sortDirection: {
    type: String,
    default: 'asc',
  },
  deleteTitle: {
    type: String,
    default: '',
  },
  deleteDescription: {
    type: String,
    default: '',
  },
  headerClass: {
    type: String,
    default: 'bg-primary py-2',
  },
  footerClass: {
    type: String,
    default: 'justify-end py-2 bg-secondary',
  },
})

const edgeFirebase = inject('edgeFirebase')
const router = useRouter()

const state = reactive({
  form: false,
  menu: false,
  dialog: false,
  apiKeys: [],
  filter: '',
  empty: false,
  afterMount: false,
  deleteDialog: false,
  deleteItemName: '',
  deleteItemDocId: '',
  staticSearch: {},
  paginatedResults: [],
  loadingMore: false,
})

const gotoSite = (docId) => {
  router.push(`/app/dashboard/${props.collection}/${docId}`)
}

const capitalizeFirstLetter = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const singularize = (word) => {
  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`
  }
  else if (word.endsWith('es') && word.length > 5) {
    return word.slice(0, -2)
  }
  else if (word.endsWith('s') && word.length > 2) {
    return word.slice(0, -1)
  }
  else {
    return word
  }
}

const filterText = computed(() => {
  if (props.filter) {
    return props.filter
  }
  return state.filter
})

const filtered = computed(() => {
  let allData = []
  if (!props.paginated) {
    if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`]) {
      return []
    }
    allData = Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`])
  }
  else {
    allData = state.paginatedResults
  }

  const filtered = allData.filter((entry) => {
    if (filterText.value.trim() === '') {
      return true
    }
    return entry.name.toLowerCase().includes(filterText.value.toLowerCase())
  })

  return filtered.sort((a, b) => {
    const field = props.sortField
    const direction = props.sortDirection === 'asc' ? 1 : -1

    if (a[field] < b[field]) {
      return -1 * direction
    }
    if (a[field] > b[field]) {
      return 1 * direction
    }
    return 0
  })
})

const loadInitialData = async () => {
  await state.staticSearch.getData(
    `${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`,
    props.paginatedQuery,
    props.pagintedSort,
    props.paginatedLimit,
  )
  const initialResults = state.staticSearch.results.data || {}
  state.paginatedResults = Object.values(initialResults)
}

onBeforeMount(async () => {
  if (!props.paginated) {
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
  }
  else {
    state.staticSearch = new edgeFirebase.SearchStaticData()
    await loadInitialData()
  }
  state.afterMount = true
})

const loadMoreData = async () => {
  if (state.staticSearch && !state.staticSearch.results.staticIsLastPage && !state.loadingMore) {
    state.loadingMore = true
    await state.staticSearch.next()
    const newResults = state.staticSearch.results.data || {}

    // Append new results to paginatedResults
    state.paginatedResults = [
      ...state.paginatedResults,
      ...Object.values(newResults),
    ]
    state.loadingMore = false
  }
}

const handleScroll = async (event) => {
  const scrollContainer = event.target
  if (
    scrollContainer.scrollTop + scrollContainer.clientHeight
    >= scrollContainer.scrollHeight - 150
  ) {
    // Load more data when near the bottom of the scroll container
    await loadMoreData()
  }
}

const deleteItem = (docId) => {
  state.deleteDialog = true
  state.deleteItemName = edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][docId].name
  state.deleteItemDocId = docId
}

const deleteAction = () => {
  edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, state.deleteItemDocId)
  state.deleteDialog = false
}
</script>

<template>
  <Card v-if="state.afterMount" :class="cn('mx-auto bg-muted/50 w-full max-w-7xl', props.class)" max-width="1200">
    <edge-menu :class="props.headerClass">
      <template #start>
        <slot name="header-start">
          <LayoutDashboard class="mr-2" />
          {{ capitalizeFirstLetter(props.collection) }}
        </slot>
      </template>
      <template #center>
        <slot name="header-center" :filter="state.filter">
          <div class="w-full px-6">
            <edge-shad-input
              v-model="state.filter"
              label=""
              name="filter"
              placeholder="Search..."
            />
          </div>
        </slot>
      </template>
      <template #end>
        <slot name="header-end" :title="singularize(props.collection)">
          <edge-shad-button class="uppercase bg-slate-600" :to="`/app/dashboard/${props.collection}/new`">
            Add {{ singularize(props.collection) }}
          </edge-shad-button>
        </slot>
      </template>
    </edge-menu>
    <CardContent
      class="p-3 w-full h-[calc(100vh-190px)] overflow-y-auto"
      @scroll="handleScroll"
    >
      <div class="flex flex-wrap items-center py-0">
        <template v-for="item in filtered" :key="item.docId">
          <slot name="list-item" :item="item" :delete-item="deleteItem">
            <div class="cursor-pointer w-full flex justify-between items-center py-1 gap-3" @click="gotoSite(item.docId)">
              <div>
                <Avatar class="cursor-pointer p-0 h-8 w-8 mr-2">
                  <FilePenLine class="h-5 w-5" />
                </Avatar>
              </div>
              <div class="grow">
                <div class="text-lg">
                  {{ item.name }}
                </div>
              </div>
              <div>
                <edge-shad-button
                  size="icon"
                  class="bg-slate-600 h-7 w-7"
                  @click.stop="deleteItem(item.docId)"
                >
                  <Trash class="h-5 w-5" />
                </edge-shad-button>
              </div>
            </div>
            <Separator class="dark:bg-slate-600" />
          </slot>
        </template>
      </div>
    </CardContent>
    <edge-shad-dialog
      v-model="state.deleteDialog"
    >
      <DialogContent class="pt-10">
        <DialogHeader>
          <DialogTitle v-if="!props.deleteTitle" class="text-left">
            Are you sure you want to delete "{{ state.deleteItemName }}"?
          </DialogTitle>
          <DialogTitle v-else class="text-left">
            {{ props.deleteTitle }}
          </DialogTitle>
          <DialogDescription v-if="!props.deleteDescription">
            This action cannot be undone. {{ state.deleteItemName }} will be permanently deleted.
          </DialogDescription>
          <DialogDescription v-else>
            {{ props.deleteDescription }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="pt-2 flex justify-between">
          <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.deleteDialog = false">
            Cancel
          </edge-shad-button>
          <edge-shad-button variant="destructive" class="text-white w-full" @click="deleteAction()">
            Delete
          </edge-shad-button>
        </DialogFooter>
      </DialogContent>
    </edge-shad-dialog>
  </Card>
</template>

<style lang="scss" scoped>

</style>
