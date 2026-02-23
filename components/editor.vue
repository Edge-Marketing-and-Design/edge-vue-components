<script setup>
import { CheckCircle2 } from 'lucide-vue-next'
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
  headerClass: {
    type: String,
    default: 'py-4 bg-secondary text-foreground rounded-none sticky top-0',
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
  saveFunctionOverride: {
    type: Function,
    default: null,
  },
  workingDocOverrides: {
    type: Object,
    default: null,
  },
  cardContentClass: {
    type: String,
    default: '',
  },
  titleField: {
    type: String,
    default: 'name',
  },
})

const emit = defineEmits(['unsavedChanges', 'workingDoc', 'error', 'saved'])

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
  errors: {},
  // When creating a new doc, suppress the very first validation pass that happens right after initial values load
  skipNextValidation: props.docId === 'new',
  overrideClose: false,
  collectionData: {},
  successMessage: '',
  dialog: false,
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const normalizeObject = (value) => {
  if (Array.isArray(value)) {
    return value.map(item => normalizeObject(item))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeObject(value[key])
        return acc
      }, {})
  }

  return value
}

const withSchemaDefaults = (doc = {}) => {
  const normalizedDoc = edgeGlobal.dupObject(doc || {})
  Object.keys(newDoc.value).forEach((field) => {
    if (!edgeGlobal.objHas(normalizedDoc, field)) {
      normalizedDoc[field] = newDoc.value[field]
    }
  })
  return normalizedDoc
}

const comparableDoc = (doc = {}) => {
  const sourceDoc = (doc && typeof doc === 'object') ? doc : {}
  const comparable = {}
  Object.keys(props.newDocSchema || {}).forEach((field) => {
    if (edgeGlobal.objHas(sourceDoc, field)) {
      comparable[field] = sourceDoc[field]
      return
    }
    comparable[field] = newDoc.value[field]
  })
  return normalizeObject(comparable)
}

const unsavedChanges = computed(() => {
  if (props.docId === 'new') {
    return false
  }

  // If the baseline doc is not yet loaded (e.g. on page refresh) avoid flagging unsaved changes
  const baselineDoc = state.collectionData?.[props.docId]
  if (!state.afterMount || !baselineDoc) {
    return false
  }

  const workingComparable = comparableDoc(state.workingDoc)
  const baselineComparable = comparableDoc(baselineDoc)
  return JSON.stringify(workingComparable) !== JSON.stringify(baselineComparable)
})

onBeforeRouteLeave((to, from, next) => {
  state.bypassRoute = to.path
  // console.log('bypassRoute', state.bypassRoute)
  // console.log('unsavedChanges', unsavedChanges.value)
  // console.log('bypassUnsavedChanges', state.bypassUnsavedChanges)
  if (unsavedChanges.value && !state.bypassUnsavedChanges) {
    state.dialog = true
    next(false)
    return
  }
  edgeGlobal.edgeState.changeTracker = {}
  next()
})

onBeforeRouteUpdate((to, from, next) => {
  state.bypassRoute = to.path
  if (unsavedChanges.value && !state.bypassUnsavedChanges) {
    state.dialog = true
    next(false)
    return
  }
  edgeGlobal.edgeState.changeTracker = {}
  next()
})

watch(() => unsavedChanges.value, (newVal) => {
  console.log('test', newVal)
  emit('unsavedChanges', newVal)
  if (newVal) {
    state.successMessage = ''
  }
})

const discardChanges = async () => {
  state.successMessage = ''
  if (props.docId === 'new') {
    state.bypassUnsavedChanges = true
    edgeGlobal.edgeState.changeTracker = {}
    if (props.saveRedirectOverride) {
      router.push(props.saveRedirectOverride)
    }
    else {
      if (props.saveFunctionOverride) {
        emit('unsavedChanges', false)
        props.saveFunctionOverride()
      }
      else {
        router.push(`/app/dashboard/${props.collection}`)
      }
    }
    return
  }
  state.workingDoc = withSchemaDefaults(state.collectionData[props.docId])
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
      if (props.saveFunctionOverride) {
        emit('unsavedChanges', false)
        props.saveFunctionOverride()
      }
      else {
        router.push(`/app/dashboard/${props.collection}`)
      }
    }
  }
}

const capitalizeFirstLetter = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, char => char.toUpperCase())
}

// Output: "Hello World From Javascript"

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
    if (!state.collectionData) {
      return ''
    }
    if (!state.collectionData[props.docId]) {
      return ''
    }
    // if (!state.collectionData?.[props.docId]?.name) {
    //   return capitalizeFirstLetter(`${state.collectionData[props.docId]}`)
    // }
    return capitalizeFirstLetter(`${state.collectionData[props.docId][props.titleField]}`)
  }
  else {
    return `New ${toTitleCase(singularize(props.collection)).replace('-', ' ')}`
  }
})

const onSubmit = async () => {
  state.successMessage = ''
  const workingDocOverrides = props.workingDocOverrides
  if (workingDocOverrides) {
    Object.keys(workingDocOverrides).forEach((key) => {
      state.workingDoc[key] = workingDocOverrides[key]
    })
  }
  // console.log(state.workingDoc)
  state.submitting = true
  state.bypassUnsavedChanges = true
  Object.keys(state.workingDoc).forEach((key) => {
    const schemaFieldType = props.newDocSchema[key]?.bindings?.['field-type']
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
  // console.log('saving', state.workingDoc)
  const result = await edgeFirebase.storeDoc(`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`, state.workingDoc)
  state.workingDoc.docId = result.meta.docId
  emit('saved', {
    collection: props.collection,
    docId: state.workingDoc.docId,
    data: edgeGlobal.dupObject(state.workingDoc),
  })
  edgeGlobal.edgeState.lastPaginatedDoc = JSON.parse(JSON.stringify(state.workingDoc))
  console.log('save result', result)
  if (state.overrideClose) {
    state.submitting = false
    // state.overrideClose = false
    // state.workingDoc = edgeGlobal.dupObject(state.collectionData[props.docId])
    state.collectionData = edgeFirebase.data[`${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`]
    emit('unsavedChanges', false)
    // console.log('bypassUnsavedChanges', state.bypassUnsavedChanges)
    edgeGlobal.edgeState.changeTracker = {}
    state.bypassUnsavedChanges = false
    state.successMessage = 'All changes saved. You can close or continue editing.'
    return
  }
  edgeGlobal.edgeState.changeTracker = {}
  state.workingDoc = {}
  if (props.saveRedirectOverride) {
    router.push(props.saveRedirectOverride)
  }
  else {
    if (props.saveFunctionOverride) {
      emit('unsavedChanges', false)
      props.saveFunctionOverride()
    }
    else {
      router.push(`/app/dashboard/${props.collection}`)
    }
  }
  state.submitting = false
}

const onCancel = () => {
  state.successMessage = ''
  if (props.saveRedirectOverride) {
    router.push(props.saveRedirectOverride)
  }
  else {
    if (props.saveFunctionOverride) {
      emit('unsavedChanges', false)
      props.saveFunctionOverride()
    }
    else {
      router.push(`/app/dashboard/${props.collection}`)
    }
  }
}

const initData = (newVal) => {
  if (props.docId !== 'new') {
    if (edgeGlobal.objHas(newVal, props.docId) === false) {
      return
    }
    state.workingDoc = withSchemaDefaults(newVal[props.docId])
    state.afterMount = true
  }
  else {
    if (!state.afterMount) {
      state.workingDoc = withSchemaDefaults(newDoc.value)
    }
    state.afterMount = true
  }
}

const startCollectionSnapshots = async () => {
  for (const field of Object.keys(props.newDocSchema || {})) {
    if (props.newDocSchema[field].type === 'collection') {
      await edgeFirebase.startSnapshot(`${edgeGlobal.edgeState.organizationDocPath}/${field}`)
    }
  }
}

const setCollectionData = async () => {
  const collectionPath = `${edgeGlobal.edgeState.organizationDocPath}/${props.collection}`
  if (!edgeFirebase.data?.[collectionPath]) {
    if (props.docId !== 'new') {
      const docData = await edgeFirebase.getDocData(collectionPath, props.docId)
      state.collectionData = {
        ...(state.collectionData || {}),
        [props.docId]: docData,
      }
    }
    else if (!state.collectionData || typeof state.collectionData !== 'object') {
      state.collectionData = {}
    }
    return
  }
  state.collectionData = edgeFirebase.data[collectionPath]
}

const resetEditorState = () => {
  state.bypassUnsavedChanges = false
  state.bypassRoute = ''
  state.afterMount = false
  state.dialog = false
  state.successMessage = ''
  state.skipNextValidation = props.docId === 'new'
  edgeGlobal.edgeState.changeTracker = {}
}

const refreshEditorData = async () => {
  resetEditorState()
  await startCollectionSnapshots()
  await setCollectionData()
  initData(state.collectionData)
  emit('unsavedChanges', unsavedChanges.value)
}

onBeforeMount(async () => {
  await refreshEditorData()
  if (props.noCloseAfterSave) {
    state.overrideClose = true
  }
})

watch(() => state.collectionData, (newVal) => {
  initData(newVal)
})

watch(() => [props.collection, props.docId], async (newVal, oldVal) => {
  if (!oldVal) {
    return
  }
  if (newVal[0] === oldVal[0] && newVal[1] === oldVal[1]) {
    return
  }
  await refreshEditorData()
})

onActivated(() => {
  // console.log('activated')
  state.bypassUnsavedChanges = false
  state.bypassRoute = ''
  // console.log('bypass', state.bypassUnsavedChanges)
  state.afterMount = false
  if (props.docId !== 'new') {
    if (edgeGlobal.objHas(state.collectionData, props.docId) === false) {
      return
    }
    state.workingDoc = withSchemaDefaults(state.collectionData[props.docId])

    // console.log('state.workingDoc', state.workingDoc)
  }
  else {
    state.workingDoc = withSchemaDefaults(newDoc.value)
    Object.entries(route.query).forEach(([key, value]) => {
    // Check if the key exists in state.workingDoc, and if so, set the value
      if (key in state.workingDoc) {
        state.workingDoc[key] = value
      }
    })
    // console.log('state.workingDoc', state.workingDoc)
  }
  //
  nextTick(() => {
    state.afterMount = true
  })
})

const WIDTHS = {
  1: 'md:w-1/12',
  2: 'md:w-2/12',
  3: 'md:w-3/12',
  4: 'md:w-4/12',
  5: 'md:w-5/12',
  6: 'md:w-6/12',
  7: 'md:w-7/12',
  8: 'md:w-8/12',
  9: 'md:w-9/12',
  10: 'md:w-10/12',
  11: 'md:w-11/12',
  12: 'w-full',
}

const numColsToTailwind = cols => WIDTHS[cols] || 'md:w-full'

const formRef = ref(null)

const onKeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (formRef.value) {
      if (props.noCloseAfterSave) {
        state.overrideClose = true
      }
      formRef.value.handleSubmit(onSubmit)()
    }
  }
}

onMounted(() => {
  if (props.noCloseAfterSave) {
    window.addEventListener('keydown', onKeydown)
  }
})
onUnmounted(() => {
  if (props.noCloseAfterSave) {
    window.removeEventListener('keydown', onKeydown)
  }
})

const triggerSubmit = async (insertedValues = {}) => {
  if (formRef.value) {
    Object.keys(insertedValues).forEach((key) => {
      if (insertedValues[key]) {
        state.workingDoc[key] = insertedValues[key]
      }
    })
    await nextTick()
    await formRef.value.setValues(state.workingDoc, true)
    await formRef.value.validate()
    console.log(formRef.value?.errors)
    await nextTick()
    await formRef.value.handleSubmit(onSubmit)()
    await nextTick()
    console.log(formRef.value?.errors)
    state.errors = formRef.value?.errors
  }
}

watch(() => state.workingDoc, async () => {
  emit('workingDoc', state.workingDoc)
  // Do nothing until the component signals it's ready
  if (state.afterMount === false)
    return

  if (!formRef.value)
    return

  // If this is the first change on a brand-new doc, set values WITHOUT validation and exit.
  if (state.skipNextValidation && props.docId === 'new') {
    await formRef.value.setValues(state.workingDoc, false) // no validate on initial fill
    state.skipNextValidation = false
    return
  }

  // Normal behavior thereafter: update values and validate
  await formRef.value.setValues(state.workingDoc, true)
  await formRef.value.validate()
  await nextTick()
  state.errors = formRef.value?.errors
  emit('unsavedChanges', unsavedChanges.value)
  // console.log('formRef.value.errors', state.errors)
}, { deep: true, immediate: false })

const onError = async () => {
  // console.log('form error', formRef.value?.errors)
  if (!formRef.value)
    return
  await formRef.value.setValues(state.workingDoc, false) // sync without triggering per-field validate
  await formRef.value.validate() // run full form validation once
  state.errors = formRef.value?.errors // reflect in UI
  emit('error', state.errors)
}
</script>

<template>
  <Card v-if="state.afterMount" :class="cn('bg-muted/50 w-full flex-1 border-none shadow-none pt-2 px-2 m-auto flex-col', props.class)">
    <edge-shad-form
      ref="formRef"
      v-model="state.form"
      :schema="props.schema"
      :initial-values="state.workingDoc"
      class="flex flex-col flex-1"
      @submit="onSubmit"
      @error="onError"
    >
      <slot name="header" :on-submit="triggerSubmit" :on-cancel="onCancel" :submitting="state.submitting" :unsaved-changes="unsavedChanges" :title="title" :working-doc="state.workingDoc" :errors="state.errors">
        <edge-menu v-if="props.showHeader" :class="props.headerClass">
          <template #start>
            <slot name="header-start" :unsaved-changes="unsavedChanges" :title="title" :errors="state.errors" :working-doc="state.workingDoc">
              <FilePenLine class="mr-2" />
              {{ title }}
            </slot>
          </template>
          <template #center>
            <slot name="header-center" :unsaved-changes="unsavedChanges" :title="title" :working-doc="state.workingDoc" />
          </template>
          <template #end>
            <slot name="header-end" :on-submit="triggerSubmit" :unsaved-changes="unsavedChanges" :on-cancel="onCancel" :errors="state.errors" :submitting="state.submitting" :title="title" :working-doc="state.workingDoc">
              <edge-shad-button
                v-if="!unsavedChanges"
                class="bg-red-700 uppercase h-8 hover:bg-red-400 w-20"
                @click="onCancel"
              >
                Close
              </edge-shad-button>
              <edge-shad-button
                v-else
                class="bg-red-700 uppercase h-8 hover:bg-red-400 w-20"
                @click="onCancel"
              >
                Cancel
              </edge-shad-button>
              <edge-shad-button
                type="submit"
                class="bg-primary uppercase h-8 hover:bg-slate-400 px-8"
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
      <CardContent :class="cn('flex-1 flex flex-col px-4', props.cardContentClass)">
        <Alert
          v-if="state.successMessage"
          class="mb-4 border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 mt-2"
        >
          <CheckCircle2 class="h-5 w-5" />
          <AlertTitle>
            Changes saved
          </AlertTitle>
          <AlertDescription>
            {{ state.successMessage }}
          </AlertDescription>
          <slot name="success-alert" :message="state.successMessage" :working-doc="state.workingDoc" />
        </Alert>
        <slot name="main" :title="title" :on-cancel="onCancel" :submitting="state.submitting" :unsaved-changes="unsavedChanges" :on-submit="triggerSubmit" :working-doc="state.workingDoc">
          <div class="flex flex-wrap justify-between">
            <div v-for="(field, name, index) in props.newDocSchema" :key="index" class="w-full" :class="numColsToTailwind(field.cols)">
              <div v-if="field.bindings['field-type'] === 'date'" class="p-3 items-center">
                <edge-shad-datepicker
                  v-model="state.workingDoc[name]"
                  :label="field.bindings.label"
                  :name="name"
                  :bindings="field.bindings"
                  :errors="state.errors?.[name]"
                  :pass-through-props="state.workingDoc"
                />
              </div>
              <div v-else-if="field.bindings['field-type'] !== 'collection'" :class="field.bindings['field-type'] === 'textarea' ? 'mb-10' : ''" class="p-3 items-center">
                <edge-g-input
                  v-model="state.workingDoc[name]"
                  :name="name"
                  :disable-tracking="true"
                  :parent-tracker-id="`${props.collection}-${props.docId}`"
                  v-bind="field.bindings"
                  :bindings="field.bindings"
                  :errors="state.errors?.[name]"
                  :pass-through-props="state.workingDoc"
                />
              </div>
              <div v-else class="p-3 items-center">
                <edge-g-input
                  v-model="state.workingDoc[name]"
                  :disable-tracking="true"
                  field-type="collection"
                  :collection-path="`${edgeGlobal.edgeState.organizationDocPath}/${field.bindings['collection-path']}`"
                  :label="field.bindings.label"
                  :name="name"
                  :bindings="field.bindings"
                  :parent-tracker-id="`${props.collection}-${props.docId}`"
                  :errors="state.errors?.[name]"
                  :pass-through-props="state.workingDoc"
                />
              </div>
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
            class="bg-red-700 uppercase h-8 hover:bg-red-200 w-20"
            @click="onCancel"
          >
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            class="bg-red-700 uppercase h-8 hover:bg-red-200 w-20"
            @click="onCancel"
          >
            Cancel
          </edge-shad-button>

          <edge-shad-button
            type="submit"
            class="bg-primary uppercase h-8 hover:bg-slate-400 px-8"
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
