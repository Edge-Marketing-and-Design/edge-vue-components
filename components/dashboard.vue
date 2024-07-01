<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({
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
})

const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')
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
})

const gotoSite = (docId) => {
  router.push(`/app/dashboard/${props.collection}/${docId}`)
}

const capitalizeFirstLetter = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const singularize = (word) => {
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`
  }
  else if (word.endsWith('es')) {
    return word.slice(0, -2)
  }
  else if (word.endsWith('s')) {
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
  if (edgeGlobal.objHas(edgeFirebase.data, `${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`) === false) {
    return []
  }

  const allData = Object.values(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`])

  const filtered = allData.filter((entry) => {
    if (filterText.value.trim() === '') {
      return true
    }

    // Modify the condition as needed, e.g., using "startsWith" or "includes"
    return entry.name.toLowerCase().includes(filterText.value.toLowerCase())
  })
  return filtered.sort((a, b) => {
    if (a.name < b.name) {
      return -1
    }
    if (a.name > b.name) {
      return 1
    }
    return 0
  })
})

onBeforeMount (async () => {
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
  state.afterMount = true
})

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
    <edge-menu class="py-9">
      <template #start>
        <slot name="header-start">
          <Box class="mr-2" />
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
    <CardContent>
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
          <DialogTitle class="text-left">
            Are you sure you want to delete "{{ state.deleteItemName }}"?
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. {{ state.deleteItemName }} will be permanently deleted.
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
