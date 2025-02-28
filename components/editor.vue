<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  docId: {
    type: String,
    default: '',
  },
  collection: {
    type: String,
    required: true,
  },
  newDocSchema: {
    type: Object,
    required: true,
  },
  schema: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
  showFooter: {
    type: Boolean,
    default: true,
  },
  class: {
    type: String,
    default: '',
  },
  stringsToUpperCase: {
    type: Boolean,
    default: false,
  },
  saveRedirectOverride: {
    type: String,
    default: '',
  },
  customDocId: {
    type: String,
    default: '',
  },
  noCloseAfterSave: {
    type: Boolean,
    default: false,
  },
})

const newDoc = computed(() => {
  return Object.entries(props.newDocSchema).reduce((newObj, [key, val]) => {
    newObj[key] = val.value
    return newObj
  }, {})
})

const router = useRouter()
const route = useRoute()

const state = reactive({
  workingDoc: {},
  form: false,
  tab: 'forms',
  bypassUnsavedChanges: false,
  bypassRoute: '',
  afterMount: false,
  submitting: false,
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const unsavedChanges = computed(() => {
  if (props.docId === 'new') {
    return false
  }
  return JSON.stringify(state.workingDoc) !== JSON.stringify(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][props.docId])
})

const subCollection = (collection) => {
  if (edgeGlobal.objHas(edgeFirebase.data, `${edgeGlobal.edgeState.organizationDocPath}/${collection}`) === false) {
    return []
  }
  // need to return an array of objects title is name and value is docId
  return Object.entries(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${collection}`]).map(([key, val]) => {
    return {
      title: val.name,
      value: key,
    }
  })
}

onBeforeRouteLeave((to, from, next) => {
  state.bypassRoute = to.path
  if (unsavedChanges.value && !state.bypassUnsavedChanges) {
    state.dialog = true
    next(false)
    return
  }
  edgeGlobal.edgeState.changeTracker = {}
  next()
})

const discardChanges = async () => {
  if (props.docId === 'new') {
    state.bypassUnsavedChanges = true
    edgeGlobal.edgeState.changeTracker = {}
    if (props.saveRedirectOverride) {
      router.push(props.saveRedirectOverride)
    }
    else {
      router.push(`/app/dashboard/${props.collection}`)
    }
    return
  }
  state.workingDoc = await edgeGlobal.dupObject(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][props.docId])
  state.bypassUnsavedChanges = true
  state.dialog = false
  edgeGlobal.edgeState.changeTracker = {}
  if (state.bypassRoute) {
    router.push(state.bypassRoute)
  }
  else {
    if (props.saveRedirectOverride) {
      router.push(props.saveRedirectOverride)
    }
    else {
      router.push(`/app/dashboard/${props.collection}`)
    }
  }
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

const title = computed(() => {
  if (props.docId !== 'new') {
    if (!edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`]) {
      return ''
    }
    if (!edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][props.docId]) {
      return ''
    }
    return capitalizeFirstLetter(`${edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][props.docId].name}`)
  }
  else {
    return `New ${capitalizeFirstLetter(singularize(props.collection))}`
  }
})

const onSubmit = async () => {
  console.log(state.workingDoc)
  state.submitting = true
  state.bypassUnsavedChanges = true
  Object.keys(state.workingDoc).forEach((key) => {
    const schemaFieldType = props.newDocSchema[key]?.bindings['field-type']
    if (typeof state.workingDoc[key] === 'string' && props.stringsToUpperCase) {
      if (key !== 'docId') {
        state.workingDoc[key] = state.workingDoc[key].toUpperCase()
      }
    }
    if (schemaFieldType === 'money') {
      state.workingDoc[key] = Number(parseFloat(state.workingDoc[key]).toFixed(2))
    }
  })
  if (props.customDocId) {
    state.workingDoc.docId = state.workingDoc[props.customDocId]
  }
  console.log('saving', state.workingDoc)
  const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, state.workingDoc)
  state.workingDoc.docId = result.meta.docId
  edgeGlobal.edgeState.lastPaginatedDoc = state.workingDoc
  if (props.noCloseAfterSave) {
    state.submitting = false
    return
  }
  edgeGlobal.edgeState.changeTracker = {}
  state.workingDoc = {}
  if (props.saveRedirectOverride) {
    router.push(props.saveRedirectOverride)
  }
  else {
    router.back()
    // router.push(`/app/dashboard/${props.collection}`)
  }
  state.submitting = false
}

const onCancel = () => {
  if (props.saveRedirectOverride) {
    router.push(props.saveRedirectOverride)
  }
  else {
    router.back()
  }
}

onBeforeMount(async () => {
  console.log('test')
  state.bypassUnsavedChanges = false
  edgeGlobal.edgeState.changeTracker = {}
  for (const field of Object.keys(props.newDocSchema)) {
    if (props.newDocSchema[field].type === 'collection') {
      await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${field}`)
    }
  }
  await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`)
})

watch(() => edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`], (newVal) => {
  console.log('newVal', newVal)
  if (props.docId !== 'new') {
    if (edgeGlobal.objHas(newVal, props.docId) === false) {
      return
    }
    state.workingDoc = edgeGlobal.dupObject(newVal[props.docId])
    Object.keys(newDoc.value).forEach((field) => {
      if (!edgeGlobal.objHas(state.workingDoc, field)) {
        state.workingDoc[field] = newDoc.value[field]
      }
    })
    state.afterMount = true
  }
  else {
    state.workingDoc = edgeGlobal.dupObject(newDoc.value)
    state.afterMount = true
  }
})
onActivated(() => {
  console.log('activated')
  state.bypassUnsavedChanges = false
  state.bypassRoute = ''
  console.log('bypass', state.bypassUnsavedChanges)
  state.afterMount = false
  if (props.docId !== 'new') {
    if (edgeGlobal.objHas(edgeFirebase.data, `${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`) === false) {
      return
    }
    if (edgeGlobal.objHas(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`], props.docId) === false) {
      return
    }
    state.workingDoc = edgeGlobal.dupObject(edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`][props.docId])
    Object.keys(newDoc.value).forEach((field) => {
      if (!edgeGlobal.objHas(state.workingDoc, field)) {
        state.workingDoc[field] = newDoc.value[field]
      }
    })

    console.log('state.workingDoc', state.workingDoc)
  }
  else {
    state.workingDoc = edgeGlobal.dupObject(newDoc.value)
    Object.entries(route.query).forEach(([key, value]) => {
    // Check if the key exists in state.workingDoc, and if so, set the value
      if (key in state.workingDoc) {
        state.workingDoc[key] = value
      }
    })
    console.log('state.workingDoc', state.workingDoc)
  }
  //
  nextTick(() => {
    state.afterMount = true
  })
})

const numColsToTailwind = (cols) => {
  if (cols === '12') {
    return 'w-full'
  }
  return `w-${cols}/12`
}

const formRef = ref(null)

const triggerSubmit = () => {
  if (formRef.value) {
    formRef.value.handleSubmit(onSubmit)()
  }
}
</script>

<template>
  <Card v-if="state.afterMount" :class="cn('m-auto bg-muted/50 w-full flex flex-col', props.class)">
    <edge-shad-form
      ref="formRef"
      v-model="state.form"
      :schema="props.schema"
      :initial-values="state.workingDoc"
      class="flex flex-col flex-1"
      @submit="onSubmit"
    >
      <slot name="header" :on-submit="triggerSubmit" :on-cancel="onCancel" :submitting="state.submitting" :unsaved-changes="unsavedChanges" :title="title" :working-doc="state.workingDoc">
        <edge-menu v-if="props.showHeader" class="py-2 bg-primary text-primary-foreground">
          <template #start>
            <slot name="header-start" :unsaved-changes="unsavedChanges" :title="title" :working-doc="state.workingDoc">
              <FilePenLine class="mr-2" />
              {{ title }}
            </slot>
          </template>
          <template #center>
            <slot name="header-center" :unsaved-changes="unsavedChanges" :title="title" :working-doc="state.workingDoc" />
          </template>
          <template #end>
            <slot name="header-end" :unsaved-changes="unsavedChanges" :submitting="state.submitting" :title="title" :working-doc="state.workingDoc">
              <edge-shad-button
                v-if="!unsavedChanges"
                type="destructive"
                @click="onCancel"
              >
                Close
              </edge-shad-button>
              <edge-shad-button
                v-else
                class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20 "
                @click="onCancel"
              >
                Cancel
              </edge-shad-button>
              <edge-shad-button
                type="submit"
                class="bg-slate-500 uppercase h-8 hover:bg-slate-400 w-[120px] mb-1"
                :disabled="state.submitting"
              >
                <Loader2 v-if="state.submitting" class="w-4 h-4 mr-2 animate-spin" />
                <span v-if="state.submitting">Saving...</span>
                <span v-else>Save</span>
              </edge-shad-button>
            </slot>
          </template>
        </edge-menu>
      </slot>
      <CardContent class="flex-1 flex flex-col p-0">
        <slot name="main" :title="title" :on-cancel="onCancel" :submitting="state.submitting" :unsaved-changes="unsavedChanges" :on-submit="triggerSubmit" :working-doc="state.workingDoc">
          <div class="flex flex-wrap py-2 items-center">
            <div v-for="(field, name, index) in props.newDocSchema" :key="index" :class="numColsToTailwind(field.cols)">
              <edge-shad-datepicker
                v-if="field.bindings['field-type'] === 'date'"
                v-model="state.workingDoc[name]"
                :label="field.bindings.label"
                :name="name"
              />
              <edge-g-input
                v-else-if="field.bindings['field-type'] !== 'collection'"
                v-model="state.workingDoc[name]"
                :name="name"
                :disable-tracking="true"
                :parent-tracker-id="`${props.collection}-${props.docId}`"
                v-bind="field.bindings"
              />
              <edge-g-input
                v-else
                v-model="state.workingDoc[name]"
                :disable-tracking="true"
                field-type="collection"
                :collection-path="`${edgeGlobal.edgeState.organizationDocPath}/${field.bindings['collection-path']}`"
                :label="field.bindings.label"
                :name="name"
                :parent-tracker-id="`${props.collection}-${props.docId}`"
              />
            </div>
          </div>
        </slot>
        <edge-shad-dialog v-model="state.dialog">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Unsaved Changes!
              </DialogTitle>
              <DialogDescription>
                <h4>"{{ title }}" has unsaved changes.</h4>
                <p>Are you sure you want to discard them?</p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter class="pt-2 flex justify-between">
              <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.dialog = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button variant="destructive" class="text-white w-full" @click="discardChanges()">
                Discard
              </edge-shad-button>
            </DialogFooter>
          </DialogContent>
        </edge-shad-dialog>
      </CardContent>
      <CardFooter v-if="showFooter" class="flex gap-1">
        <slot name="footer" :on-submit="triggerSubmit" :unsaved-changes="unsavedChanges" :title="title" :submitting="state.submitting" :working-doc="state.workingDoc">
          <edge-shad-button
            v-if="!unsavedChanges"
            class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
            @click="onCancel"
          >
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
            @click="onCancel"
          >
            Cancel
          </edge-shad-button>

          <edge-shad-button
            type="submit"
            class="bg-slate-500 uppercase h-8 hover:bg-slate-400 w-[120px] mb-1"
            :disabled="state.submitting"
          >
            <Loader2 v-if="state.submitting" class="w-4 h-4 mr-2 animate-spin" />
            <span v-if="state.submitting">Saving...</span>
            <span v-else>Save</span>
          </edge-shad-button>
        </slot>
      </CardFooter>
    </edge-shad-form>
  </Card>
</template>

<style lang="scss" scoped>

</style>
