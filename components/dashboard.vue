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
  paginatedSort: {
    type: Array,
    default: () => [],
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
    default: 'bg-secondary py-2',
  },
  footerClass: {
    type: String,
    default: 'justify-end py-2 bg-secondary',
  },
  searchFields: {
    type: Array,
    default: () => [{ title: 'Name', name: 'name' }],
  },
  queryField: {
    type: String,
    default: '',
  },
  queryValue: {
    type: String,
    default: '',
  },
  queryOperator: {
    type: String,
    default: '==',
  },
  hideSearch: {
    type: Boolean,
    default: false,
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
  queryField: '',
  queryValue: '',
  queryOperator: '',
  scrollPosition: 0,
  staticCurrentPage: '',
  searching: false,
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
  else if (word.endsWith('es') && word.length > 2) {
    // if the word ends with one of the common "es" patterns, remove "es"
    if (
      word.endsWith('ches')
      || word.endsWith('shes')
      || word.endsWith('xes')
      || word.endsWith('ses')
      || word.endsWith('zes')
    ) {
      return word.slice(0, -2)
    }
    else {
      // otherwise, the plural is likely just the singular plus "s"
      return word.slice(0, -1)
    }
  }
  else if (word.endsWith('s') && word.length > 1) {
    return word.slice(0, -1)
  }
  else {
    return word
  }
}

const snapShotQuery = computed(() => {
  const queryInfo = props.searchFields.find(field => field.name === state.queryField)
  let operator = '=='
  if (queryInfo?.operators) {
    operator = state.queryOperator
  }
  if (state.queryField && state.queryValue) {
    return [
      { field: state.queryField, operator, value: state.queryValue },
    ]
  }
  return []
})

const searchQuery = computed(() => {
  if (state.queryField && state.queryValue) {
    const upperCaseValue = state.queryValue.toUpperCase()

    const searchField = props.searchFields.find(field => field.name === state.queryField)
    if (searchField?.choices) {
      return [
        { field: state.queryField, operator: '==', value: state.queryValue },
      ]
    }
    return [
      { field: state.queryField, operator: '>=', value: upperCaseValue },
      { field: state.queryField, operator: '<=', value: `${upperCaseValue}\uF8FF` },
    ]
  }
  return []
})

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

  if (props.paginated) {
    return filtered
  }

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
  state.staticSearch = new edgeFirebase.SearchStaticData()
  if (state.queryField === '') {
    state.queryField = props.searchFields[0].name
  }
  let sortFields = [{ field: state.queryField, direction: 'asc' }]
  if (!props.paginatedSort.some(sort => sort.field === state.queryField)) {
    sortFields.push(...props.paginatedSort)
  }

  sortFields = sortFields.filter(
    (item, index, self) =>
      index === self.findIndex(t => t.field === item.field),
  )

  const finalSortFields = []
  sortFields.forEach((sortField) => {
    console.log(sortField)
    const findPaginatedSort = props.paginatedSort.find(sort => sort.field === sortField.field)
    console.log(findPaginatedSort)
    if (findPaginatedSort) {
      finalSortFields.push(findPaginatedSort)
    }
    else {
      finalSortFields.push(sortField)
    }
  })

  await state.staticSearch.getData(
    `${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`,
    searchQuery.value,
    finalSortFields,
    props.paginatedLimit,
  )
  state.staticCurrentPage = state.staticSearch.results.staticCurrentPage
  console.log(state.staticSearch.results)
  const initialResults = state.staticSearch.results.data || {}
  state.paginatedResults = Object.values(initialResults)
}

const loadMoreData = async () => {
  if (state.staticSearch && !state.staticSearch.results.staticIsLastPage && !state.loadingMore) {
    state.loadingMore = true
    await state.staticSearch.next()
    const newResults = state.staticSearch.results.data || {}
    console.log(newResults)
    // Append new results to paginatedResults
    if (state.staticCurrentPage !== state.staticSearch.results.staticCurrentPage) {
      state.paginatedResults = [
        ...state.paginatedResults,
        ...Object.values(newResults),
      ]
    }

    state.staticCurrentPage = state.staticSearch.results.staticCurrentPage
  }
  state.loadingMore = false
}

watch (
  () => edgeGlobal.edgeState.organizationDocPath,
  async () => {
    state.afterMount = false
    console.log('organizationDocPath changed')
    if (!props.paginated) {
      if (!state.searchField) {
        state.queryField = props.queryField
      }
      if (!state.queryValue) {
        state.queryValue = props.queryValue
      }
      if (!state.queryOperator) {
        state.queryOperator = props.queryOperator
      }
      console.log('start snapshot')
      console.log(snapShotQuery.value)
      await edgeFirebase.stopSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
      await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, snapShotQuery.value)
    }
    else {
      await loadInitialData()
    }
    state.afterMount = true
  },
)

onBeforeMount(async () => {
  console.log('before mount')
  if (!props.paginated) {
    if (!state.searchField) {
      state.queryField = props.queryField
    }
    if (!state.queryValue) {
      state.queryValue = props.queryValue
    }
    if (!state.queryOperator) {
      state.queryOperator = props.queryOperator
    }
    console.log('start snapshot')
    console.log(snapShotQuery.value)
    await edgeFirebase.stopSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
    await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, snapShotQuery.value)
  }
  else {
    await loadInitialData()
  }
  state.afterMount = true
})

const handleScroll = async (event) => {
  if (props.paginated) {
    state.scrollPosition = event.target.scrollTop
    const scrollContainer = event.target
    if (
      scrollContainer.scrollTop + scrollContainer.clientHeight
    >= scrollContainer.scrollHeight - 10
    ) {
    // Load more data when near the bottom of the scroll container
      await loadMoreData()
    }
  }
}

const deleteItem = (docId) => {
  state.deleteDialog = true
  if (props.paginated) {
    state.deleteItemName = state.paginatedResults.find(item => item.docId === docId).name
  }
  else {
    state.deleteItemName = edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][docId].name
  }

  state.deleteItemDocId = docId
}

const deleteAction = () => {
  console.log('deleteAction', state.deleteItemDocId)
  edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, state.deleteItemDocId)
  if (props.paginated) {
    state.paginatedResults = state.paginatedResults.filter(item => item.docId !== state.deleteItemDocId)
  }
  state.deleteDialog = false
}

watch(searchQuery, async () => {
  if (props.paginated) {
    state.staticSearch = new edgeFirebase.SearchStaticData()
    await loadInitialData()
  }
})

watch (snapShotQuery, async () => {
  if (state.afterMount) {
    if (!props.paginated) {
      await edgeFirebase.stopSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
      await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, snapShotQuery.value)
    }
  }
})
const scrollContainerRef = ref(null)

// Restore the scroll position in the div
const restoreScrollPosition = async () => {
  const cardText = document.querySelector('.scroll-area')
  // console.log(cardText)
  nextTick(() => {
    if (cardText) {
      cardText.scrollTop = state.scrollPosition
    }
  })
}

// When the component is activated (coming back to this route)
onActivated(() => {
  console.log('activated')
  restoreScrollPosition() // Restore the scroll position when the component is activated
  if (props.paginated) {
    const workingDoc = edgeGlobal.edgeState.lastPaginatedDoc
    if (workingDoc) {
      state.paginatedResults = state.paginatedResults.map((item) => {
        if (item.docId === workingDoc.docId) {
          return workingDoc
        }
        return item
      })
    }
  }
})

const runSearch = (field, value) => {
  state.afterMount = false
  state.queryField = field
  state.queryValue = value
  nextTick(() => {
    state.afterMount = true
  })
}

const searchDropDown = computed(() => {
  const searchField = props.searchFields.find(field => field.name === state.queryField)
  if (searchField?.choices) {
    const title = searchField.choices.title
    const name = searchField.name
    return searchField.choices.data.map(choice => ({
      name: String(choice[name]),
      title: String(choice[title]),
    }))
  }
  return null
})
</script>

<template>
  <Card v-if="state.afterMount" :class="cn('mx-auto bg-muted/50 w-full', props.class)">
    <edge-menu class="bg-primary text-primary-foreground" :class="props.headerClass">
      <template #start>
        <slot name="header-start">
          <LayoutDashboard class="mr-2" />
          {{ capitalizeFirstLetter(props.collection) }}
        </slot>
      </template>
      <template #center>
        <slot name="header-center" :filter="state.filter">
          <div v-if="!props.hideSearch" class="w-full px-6">
            <edge-shad-input
              v-if="props.searchFields.length === 0"
              v-model="state.filter"
              label=""
              name="filter"
              placeholder="Search..."
            />
            <div v-else class="py-0 flex gap-2 w-full">
              <div class="w-48">
                <edge-shad-select
                  v-model="state.queryField"
                  :items="props.searchFields"
                  class="uppercase"
                  name="search"
                />
              </div>
              <div v-if="props.searchFields.find(field => field.name === state.queryField)?.operators">
                <edge-shad-select
                  v-model="state.queryOperator"
                  :items="props.searchFields.find(field => field.name === state.queryField)?.operators"
                  item-title="title"
                  item-value="operator"
                  name="operator"
                  class="uppercase"
                />
              </div>
              <div class="flex-grow">
                <div v-if="searchDropDown" class="py-1">
                  <edge-shad-combobox
                    v-model="state.queryValue"
                    :items="searchDropDown"
                    name="filter"
                    placeholder="Search For..."
                  />
                </div>
                <div v-else-if="props.searchFields.find(field => field.name === state.queryField)?.fieldType === 'date'" class="py-1">
                  <edge-shad-datepicker
                    v-model="state.queryValue"
                    name="filter"
                    placeholder="Search For..."
                  />
                </div>
                <edge-shad-input
                  v-else
                  v-model="state.queryValue"
                  name="filter"
                  placeholder="Search For..."
                />
              </div>
            </div>
          </div>
        </slot>
      </template>
      <template #end>
        <slot v-if="props.paginated" name="header-end" :record-count="state.staticSearch?.results?.total" :title="singularize(props.collection)">
          <edge-shad-button v-if="!props.paginated" class="uppercase bg-slate-600" :to="`/app/dashboard/${props.collection}/new`">
            Add {{ singularize(props.collection) }}
          </edge-shad-button>
          <span v-else>
            {{ state.staticSearch.results.total.toLocaleString() }} records
          </span>
        </slot>
        <slot v-else name="header-end" :record-count="filtered.length" :title="singularize(props.collection)">
          <edge-shad-button v-if="!props.paginated" class="uppercase bg-slate-600" :to="`/app/dashboard/${props.collection}/new`">
            Add {{ singularize(props.collection) }}
          </edge-shad-button>
          <span v-else>
            {{ state.staticSearch.results.total.toLocaleString() }} records
          </span>
        </slot>
      </template>
    </edge-menu>
    <div v-if="$slots['list-header']" class="flex flex-wrap items-center py-0 mx-8 text-sm">
      <slot name="list-header" />
    </div>
    <CardContent
      ref="scrollContainerRef"
      class="p-3 w-full  overflow-y-auto scroll-area"
      @scroll="handleScroll"
    >
      <div class="flex flex-wrap items-center py-0">
        <template v-for="item in filtered" :key="item.docId">
          <slot name="list-item" :item="item" :delete-item="deleteItem" :run-search="runSearch">
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
