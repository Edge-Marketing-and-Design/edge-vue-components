<script setup>
import { useElementVisibility } from '@vueuse/core'
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
  filters: {
    type: Array,
    default: () => [],
  },
  filter: {
    type: [String, Array],
    default: '',
  },
  filterFields: {
    type: Array,
    default: () => ['name'],
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
    default: () => [],
  },
  queryField: {
    type: String,
    default: '',
  },
  queryValue: {
    type: [String, Array, Boolean],
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
  defaultFilterFields: {
    type: Array,
    default: () => [],
  },
  loadFirstIfOne: {
    type: Boolean,
    default: false,
  },
})

defineOptions({ name: 'EdgeDashboard' })

const target = ref(null)
const isVisible = useElementVisibility(target)

const edgeFirebase = inject('edgeFirebase')
const router = useRouter()
const route = useRoute()

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
  filterFields: [],
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

const getByPath = (obj, path) => {
  if (!obj || !path)
    return undefined
  return path.split('.').reduce((acc, key) => {
    if (acc == null)
      return undefined
    return acc[key]
  }, obj)
}

const snapShotQuery = computed(() => {
  if (state.queryField && state.queryValue) {
    // console.log('snapShotQuery', state.queryField, state.queryOperator, state.queryValue)
    return [
      { field: state.queryField, operator: state.queryOperator, value: state.queryValue },
    ]
  }
  if (state.queryValue === false) {
    return [
      { field: state.queryField, operator: '==', value: state.queryValue },
    ]
  }
  return []
})

const searchQuery = computed(() => {
  const field = state.queryField
  const rawVal = state.queryValue

  // Bail early if field or value is missing/empty
  if (!field || rawVal == null || (Array.isArray(rawVal) && rawVal.length === 0)) {
    return []
  }

  // Normalize to an array of trimmed, non-empty strings
  const values = (Array.isArray(rawVal) ? rawVal : [rawVal])
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)

  if (values.length === 0)
    return []

  const searchField = props.searchFields.find(f => f.name === field)

  // If this field has discrete choices, support multi-select with 'in'
  if (searchField?.choices) {
    if (values.length === 1) {
      return [{ field, operator: '==', value: values[0] }]
    }
    // Firestore 'in' supports up to 10 values
    return [{ field, operator: 'in', value: values.slice(0, 10) }]
  }

  // Prefix search: use the FIRST value (Firestore can't OR multiple prefix ranges)
  const upper = values[0].toUpperCase()
  return [
    { field, operator: '>=', value: upper },
    { field, operator: '<=', value: `${upper}\uF8FF` },
  ]
})
const filterText = computed(() => {
  if (props.filter) {
    return props.filter
  }
  return state.filter
})

const allData = computed(() => {
  if (!props.paginated) {
    if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`]) {
      return []
    }
    return Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`])
  }
  return state.paginatedResults
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

  const qRaw = filterText.value
  const fieldsToSearch = (Array.isArray(props.filterFields) && props.filterFields.length > 0) ? props.filterFields : ['name']

  // Helper: does a "has value" check for strings/arrays
  const hasValue = val => !(val == null || (typeof val === 'string' && val.trim() === '') || (Array.isArray(val) && val.length === 0))

  // Helper: apply one filter group to a dataset
  const applyFilterToData = (data, qRawLocal, fieldsLocal) => {
    return data.filter((entry) => {
    // If no query value, keep everything
      if (!hasValue(qRawLocal))
        return true

      // If the filter text is an array, treat it as an "allowlist":
      // include the entry if the field's value is IN that array (case-insensitive).
      if (Array.isArray(qRawLocal)) {
        const qSet = new Set(
          qRawLocal.map(v => String(v).toLowerCase().trim()).filter(Boolean),
        )
        if (qSet.size === 0)
          return true

        return fieldsLocal.some((fieldPath) => {
          const raw = getByPath(entry, fieldPath)
          if (raw === undefined || raw === null)
            return false

          // If the field itself is an array, match on any overlap
          if (Array.isArray(raw)) {
            return raw.some(val => qSet.has(String(val).toLowerCase()))
          }

          const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
          return qSet.has(String(str).toLowerCase())
        })
      }

      // Otherwise, treat it as a substring match on any of the fields
      const q = String(qRawLocal).trim().toLowerCase()
      return fieldsLocal.some((fieldPath) => {
        const raw = getByPath(entry, fieldPath)
        if (raw === undefined || raw === null)
          return false

        // If the field is an array, check if any element includes the substring
        if (Array.isArray(raw)) {
          return raw.some(val => String(val).toLowerCase().includes(q))
        }

        const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
        return String(str).toLowerCase().includes(q)
      })
    })
  }

  // Build the list of filter groups to apply in order.
  // Group 1 (optional): props.filter + props.filterFields (if it "has value")
  const filterGroups = []
  if (hasValue(qRaw)) {
    filterGroups.push({ filterFields: fieldsToSearch, value: qRaw })
  }

  // Additional groups: props.filters (array of { filterFields: string[], value: string | string[] })
  if (Array.isArray(props.filters) && props.filters.length > 0) {
    props.filters.forEach((g) => {
      const gFields = (Array.isArray(g?.filterFields) && g.filterFields.length > 0) ? g.filterFields : ['name']
      filterGroups.push({ filterFields: gFields, value: g?.value })
    })
  }

  // Apply all groups sequentially; if none exist, keep all data
  let filtered = allData
  if (filterGroups.length > 0) {
    for (const g of filterGroups) {
      filtered = applyFilterToData(filtered, g.value, g.filterFields)
    }
  }

  if (props.paginated) {
    return filtered
  }

  if (state.filterFields.length > 0) {
    state.filterFields.forEach((filter) => {
      filtered = filtered.filter((item) => {
        if (item[filter.field] === undefined) {
          return false
        }
        if (typeof item[filter.field] === 'string') {
          return item[filter.field].toLowerCase().includes(filter.value.toLowerCase())
        }
        return item[filter.field] === filter.value
      })
    })
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
  if (state.staticSearch?.results) {
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
  }
  state.loadingMore = false
}

watch(isVisible, async (visible) => {
  if (visible) {
    await loadMoreData()
  }
})

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

    if (!edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`]) {
      await edgeFirebase.stopSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
      await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, snapShotQuery.value)
    }
  }
  else {
    await loadInitialData()
  }
  state.filterFields = props.defaultFilterFields.map(field => ({
    field: field.field,
    value: field.value,
  }))

  console.log('after mount')
  console.log(filtered.value)
  if (props.loadFirstIfOne && filtered.value.length === 1) {
    gotoSite(filtered.value[0].docId)
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
      console.log('snapShotQuery changed')
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
  console.log('activated dashboard')
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

const removeFilter = (field) => {
  state.filterFields = state.filterFields.filter(f => f.field !== field)
}

const addFilter = (field, value) => {
  if (state.filterFields.some(f => f.field === field)) {
    const existingFilterKey = state.filterFields.findIndex(f => f.field === field)
    state.filterFields[existingFilterKey] = { field, value }
  }
  else {
    state.filterFields.push({ field, value })
  }
  if (!value) {
    removeFilter(field)
  }
}
</script>

<template>
  <Card v-if="state.afterMount" :class="cn('mx-auto bg-muted/50 w-full flex-1 border-none shadow-none pt-2', props.class)">
    <slot name="header" :add-filter="addFilter" :icon="edgeGlobal.iconFromMenu(route)" :add-title="capitalizeFirstLetter(singularize(props.collection))" :title="capitalizeFirstLetter(props.collection).replaceAll('-', ' ')">
      <edge-menu class="bg-primary text-foreground rounded-none sticky top-0" :class="props.headerClass">
        <template #start>
          <slot name="header-start" :record-count="allData.length" :add-filter="addFilter" :icon="edgeGlobal.iconFromMenu(route)" :title="capitalizeFirstLetter(props.collection).replaceAll('-', ' ')">
            <component :is="edgeGlobal.iconFromMenu(route)" class="mr-2" />
            <span class="capitalize">{{ capitalizeFirstLetter(props.collection).replaceAll('-', ' ') }}</span>
          </slot>
        </template>
        <template #center>
          <slot name="header-center" :add-filter="addFilter" :filter="state.filter">
            <div v-if="!props.hideSearch" class="w-full px-6">
              <edge-shad-form>
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
                      class="uppercase bg-background text-foreground"
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
                      class="uppercase bg-background text-foreground"
                    />
                  </div>
                  <div class="flex-grow">
                    <div v-if="searchDropDown" class="py-1">
                      <edge-shad-combobox
                        v-model="state.queryValue"
                        :items="searchDropDown"
                        name="filter"
                        placeholder="Search For..."
                        class="uppercase bg-background text-foreground w-full"
                      />
                    </div>
                    <div v-else-if="props.searchFields.find(field => field.name === state.queryField)?.fieldType === 'date'" class="py-1">
                      <edge-shad-datepicker
                        v-model="state.queryValue"
                        name="filter"
                        placeholder="Search For..."
                        class="!bg-yellow-900 !text-foreground"
                      />
                    </div>
                    <edge-shad-input
                      v-else
                      v-model="state.queryValue"
                      name="filter"
                      class="bg-background text-foreground"
                      placeholder="Search For..."
                    />
                  </div>
                </div>
              </edge-shad-form>
            </div>
          </slot>
        </template>
        <template #end>
          <slot v-if="props.paginated" name="header-end" :add-filter="addFilter" :record-count="state.staticSearch?.results?.total" :title="singularize(props.collection)">
            <edge-shad-button v-if="!props.paginated" class="uppercase bg-primary" :to="`/app/dashboard/${props.collection}/new`">
              Add {{ singularize(props.collection).replaceAll('-', ' ') }}
            </edge-shad-button>
            <span v-else>
              {{ state.staticSearch.results.total.toLocaleString() }} records
            </span>
          </slot>
          <slot v-else name="header-end" :add-filter="addFilter" :record-count="filtered.length" :title="singularize(props.collection)">
            <edge-shad-button v-if="!props.paginated" class="uppercase bg-primary" :to="`/app/dashboard/${props.collection}/new`">
              Add {{ singularize(props.collection).replaceAll('-', ' ') }}
            </edge-shad-button>
            <span v-else>
              {{ state.staticSearch.results.total.toLocaleString() }} records
            </span>
          </slot>
        </template>
      </edge-menu>
    </slot>
    <div v-if="$slots['list-header']" class="flex flex-wrap items-center py-0 mx-8 text-sm">
      <slot name="list-header" />
    </div>
    <CardContent
      ref="scrollContainerRef"
      class="p-3 w-full  overflow-y-auto scroll-area"
      @scroll="handleScroll"
    >
      <div class="flex flex-wrap items-center py-0">
        <slot name="list" :filtered="filtered" :delete-item="deleteItem" :run-search="runSearch" :loading-more="state.loadingMore">
          <template v-for="item in filtered" :key="item.docId">
            <slot name="list-item" :item="item" :delete-item="deleteItem" :run-search="runSearch" :goto-site="gotoSite">
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
        </slot>
        <div ref="target" />
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
