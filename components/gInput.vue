<script setup>
// TODO:  ADD HELPERS TO THE SCHEMA PARAMS
// TODO: START SHAD CONVERSION AT
import { computed, defineProps, inject, nextTick, onBeforeMount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  disableTracking: {
    type: Boolean,
    default: false,
  },
  parentTrackerId: {
    type: String,
    default: '',
  },
  helper: {
    type: String,
    default: '',
  },
  items: {
    type: Array,
    default: () => [],
  },
  fieldType: {
    type: String,
    default: 'text',
  },
  fieldTypes: {
    type: Array,
    default: () => ['string', 'boolean', 'array', 'object', 'number', 'integer'],
  },
  subFieldType: {
    type: String,
    default: '',
  },
  collectionPath: {
    type: String,
    default: '',
  },
  collectionTitleField: {
    type: String,
    default: 'name',
  },
  collectionValueField: {
    type: String,
    default: 'docId',
  },
  titleField: {
    type: String,
    default: 'title',
  },
  valueField: {
    type: String,
    default: 'value',
  },
  modelValue: {
    type: [Number, String, Array, Object, Boolean],
  },
  rules: {
    type: Array,
    default: () => [],
  },
  label: {
    type: String,
    default: '',
  },
  rows: {
    type: String,
    default: '1',
  },
  hint: {
    type: String,
    default: '',
  },
  persistentHint: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  passThroughProps: {
    type: [Number, String, Array, Object, Boolean],
    required: false,
    default: null,
  },
  maskOptions: {
    type: [Object],
    required: false,
    default: null,
  },
  bindings: {
    type: [Object],
    required: false,
    default: () => ({}),
  },
  forFunctions: {
    type: Boolean,
    default: false,
  },
  name: {
    type: String,
    required: true,
  },
})
const emit = defineEmits(['update:modelValue'])

const generateShortId = () => {
  return Math.random().toString(36).substr(2, 6)
}

const jsonSchemaStringFormats = [
  '',
  'date-time',
  'date',
  'time',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uri',
  'uri-reference',
  'uri-template',
  'json-pointer',
  'relative-json-pointer',
  'regex',
]
// const edgeGlobal = inject('edgeGlobal')
const edgeFirebase = inject('edgeFirebase')
const state = reactive({
  loaded: false,
  afterMount: false,
  trackerKey: '',
  helper: false,
  fieldsTypes: ['string', 'boolean', 'array', 'object', 'number', 'integer'],
  fieldInsert: { key: '', type: 'string' },
  fieldInsertKeyRequired: false,
  fieldInsertDialog: false,
  removeField: null,
  fieldErrorMessage: '',
  keyMenu: false,
  newKey: null,
  currentKey: null,
  order: [],
  orderUpdateFromWatcher: false,
  objectListOriginalOrder: {},
  arrayAdd: null,
  isEditing: false,
  removeFieldDialogShow: false,
})

const returnObject = computed(() => {
  if (props.bindings && props.bindings['return-object']) {
    return props.bindings['return-object']
  }
  return false
})

const fieldTypes = computed(() => {
  if (props.fieldTypes.length > 0) {
    return props.fieldTypes
  }
  return state.fieldsTypes
})

// {
//   "type": "string",                        // Declares the data type as string
//   "description": "A text value",           // Describes the property
//   "minLength": 1,                          // Minimum length of the string
//   "maxLength": 100,                        // Maximum length of the string
//   "pattern": "^[a-zA-Z0-9]+$",             // Regular expression pattern for string validation
//   "format": "email",                       // Specific format of the string, e.g., email, date-time, uri
//   "enum": ["option1", "option2", "option3"], // Enumerates allowable values for the string
//   "default": "defaultText",                // Default value for the string
//   "examples": ["exampleText1", "exampleText2"] // Examples of valid strings
// }

const extraTypeFields = {
  string: {
    enum: { default: [], bindings: { 'field-type': 'stringArray', 'label': 'Enum' } },
    minLength: { default: 0, bindings: { 'field-type': 'integer', 'label': 'Minimum Length' } },
    maxLength: { default: 100, bindings: { 'field-type': 'integer', 'label': 'Maximum Length' } },
    pattern: { default: '', bindings: { 'field-type': 'text', 'label': 'Pattern' } },
    format: { default: '', bindings: { 'field-type': 'select', 'label': 'Format', 'items': jsonSchemaStringFormats } },
    default: { default: '', bindings: { 'field-type': 'text', 'label': 'Default' } },
    examples: { default: [], bindings: { 'field-type': 'stringArray', 'label': 'Examples' } },
  },
  boolean: {
    default: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Default' } },
  },
  number: {
    enum: { default: [], bindings: { 'field-type': 'numberArray', 'label': 'Enum' } },
    minimum: { default: 0, bindings: { 'field-type': 'number', 'label': 'Minimum' } },
    maximum: { default: 10, bindings: { 'field-type': 'number', 'label': 'Maximum' } },
    exclusiveMinimum: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Exclusive Minimum' } },
    exclusiveMaximum: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Exclusive Maximum' } },
    multipleOf: { default: 0.5, bindings: { 'field-type': 'number', 'label': 'Multiple Of' } },
    default: { default: 5, bindings: { 'field-type': 'number', 'label': 'Default' } },
    examples: { default: [], bindings: { 'field-type': 'numberArray', 'label': 'Examples' } },
  },
  integer: {
    enum: { default: [], bindings: { 'field-type': 'integerArray', 'label': 'Enum' } },
    minimum: { default: 0, bindings: { 'field-type': 'integer', 'label': 'Minimum' } },
    maximum: { default: 10, bindings: { 'field-type': 'integer', 'label': 'Maximum' } },
    exclusiveMinimum: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Exclusive Minimum' } },
    exclusiveMaximum: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Exclusive Maximum' } },
    multipleOf: { default: 1, bindings: { 'field-type': 'integer', 'label': 'Multiple Of' } },
    default: { default: 5, bindings: { 'field-type': 'integer', 'label': 'Default' } },
    examples: { default: [], bindings: { 'field-type': 'integerArray', 'label': 'Examples' } },
  },
  array: {
    minItems: { default: 0, bindings: { 'field-type': 'integer', 'label': 'Minimum Items' } },
    maxItems: { default: 10, bindings: { 'field-type': 'integer', 'label': 'Maximum Items' } },
    uniqueItems: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Unique Items' } },
    additionalItems: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Additional Items' } },
    items: { default: [], bindings: { 'field-type': 'array', 'label': 'Items' } },
    default: { default: [], bindings: { 'field-type': 'array', 'label': 'Default' } },
    examples: { default: [], bindings: { 'field-type': 'array', 'label': 'Examples' } },
  },
  object: {
    required: { default: [], bindings: { 'field-type': 'stringArray', 'label': 'Required' } },
    additionalProperties: { default: false, bindings: { 'field-type': 'boolean', 'label': 'Additional Properties' } },
    minProperties: { default: 0, bindings: { 'field-type': 'integer', 'label': 'Minimum Properties' } },
    maxProperties: { default: 10, bindings: { 'field-type': 'integer', 'label': 'Maximum Properties' } },
  },
}

const clearExtraFields = () => {
  if (!props.forFunctions) {
    return
  }
  state.fieldInsert = {
    key: state.fieldInsert.key,
    type: state.fieldInsert.type,
    description: state.fieldInsert.description,
    required: state.fieldInsert.required,
  }
  // const extraFields = extraTypeFields[state.fieldInsert.type]
  // Object.keys(extraFields).forEach((field) => {
  //   state.fieldInsert[field] = extraFields[field].default
  // })
}

// eslint-disable-next-line vue/no-dupe-keys
const modelValue = ref(null)

const refreshArray = ref(true)
const addArray = () => {
  if (state.arrayAdd === null || state.arrayAdd === '') {
    return
  }
  if (typeof state.arrayAdd !== 'string' && isNaN(state.arrayAdd)) {
    return
  }
  if (modelValue.value.includes(state.arrayAdd)) {
    return
  }
  modelValue.value.push(state.arrayAdd)
  state.arrayAdd = null
  refreshArray.value = false
  nextTick(() => {
    refreshArray.value = true
  })
}

const editField = (item) => {
  state.isEditing = true
  state.fieldInsert = edgeGlobal.dupObject(modelValue.value[item.key])
  state.fieldInsertDialog = true
}

const addField = async () => {
  let fieldId = generateShortId()
  if (state.fieldInsert?.fieldId) {
    fieldId = state.fieldInsert.fieldId
  }
  if (props.fieldType === 'object') {
    if (!state.fieldInsert.key) {
      state.fieldInsertKeyRequired = true
      state.fieldErrorMessage = 'Key is required'
      return
    }
    if (!state.isEditing) {
      if (Object.keys(modelValue.value).some((k) => {
        return k.toLowerCase() === state.fieldInsert.key.toLowerCase()
      })) {
        state.fieldInsertKeyRequired = true
        state.fieldErrorMessage = 'Key already exists'
        return
      }
      state.order.push({ key: state.fieldInsert.key })
    }
  }
  if (props.fieldType === 'array') {
    let value = null
    if (state.fieldInsert.type === 'string') {
      value = ''
    }
    else if (state.fieldInsert.type === 'boolean') {
      value = false
    }
    else if (state.fieldInsert.type === 'array') {
      value = []
    }
    else if (state.fieldInsert.type === 'object') {
      value = {}
    }
    else if (state.fieldInsert.type === 'number') {
      value = 0
    }
    else if (state.fieldInsert.type === 'integer') {
      value = 0
    }
    let finalValue = null
    if (props.forFunctions) {
      finalValue = {
        fieldId,
        gptGenerated: true,
        value,
        ...state.fieldInsert,
      }
    }
    else {
      finalValue = {
        value,
        type: state.fieldInsert.type,
      }
    }
    console.log(state.isEditing)
    if (state.isEditing) {
      modelValue.value[0] = finalValue
    }
    else {
      modelValue.value.push(finalValue)
    }
    state.order = modelValue.value.map((value, index) => {
      return {
        key: index,
        value,
      }
    })
    // state.order.push({ key: state.order.length, value: arrayValue })

    state.fieldInsert.key = ''
    state.fieldInsert.description = ''
    state.fieldInsert.type = 'string'
    if (props.forFunctions) {
      state.fieldInsert.required = false
      clearExtraFields()
    }
    state.fieldInsertKeyRequired = false
    state.fieldErrorMessage = ''
    state.isEditing = false
    state.fieldInsertDialog = false
    return
  }
  if (!state.fieldInsert.key) {
    state.fieldInsertKeyRequired = true
    state.fieldErrorMessage = 'Key is required'
    return
  }
  if (!state.isEditing) {
    if (Object.keys(modelValue.value).some((k) => {
      return k.toLowerCase() === state.fieldInsert.key.toLowerCase()
    })) {
      state.fieldInsertKeyRequired = true
      state.fieldErrorMessage = 'Key already exists'
      return
    }
  }
  let value = null
  if (state.fieldInsert.type === 'string') {
    value = ''
  }
  else if (state.fieldInsert.type === 'boolean') {
    value = false
  }
  else if (state.fieldInsert.type === 'array') {
    value = []
  }
  else if (state.fieldInsert.type === 'object') {
    value = {}
  }
  else if (state.fieldInsert.type === 'number') {
    value = 0
  }
  else if (state.fieldInsert.type === 'integer') {
    value = 0
  }
  let finalValue = null
  if (props.forFunctions) {
    finalValue = {
      fieldId,
      gptGenerated: true,
      value,
      ...state.fieldInsert,
    }
  }
  else {
    finalValue = {
      value,
      type: state.fieldInsert.type,
    }
  }
  const existingFieldIndex = Object.values(modelValue.value).findIndex(item => item.fieldId === fieldId)

  if (existingFieldIndex !== -1) {
    if (modelValue.value[existingFieldIndex]?.value) {
      finalValue.value = modelValue.value[existingFieldIndex].value
    }
    const oldKey = Object.keys(modelValue.value)[existingFieldIndex]
    delete modelValue.value[oldKey]
    modelValue.value[state.fieldInsert.key] = finalValue
    const orderIndex = state.order.findIndex(item => item.key === oldKey)
    if (orderIndex !== -1) {
      state.order[orderIndex].key = state.fieldInsert.key
    }
  }
  else {
    modelValue.value[state.fieldInsert.key] = finalValue
  }
  modelValue.value[state.fieldInsert.key] = finalValue
  state.fieldInsert.key = ''
  state.fieldInsert.description = ''
  state.isEditing = false
  if (props.forFunctions) {
    state.fieldInsert.required = false
    clearExtraFields()
  }
  state.fieldInsertDialog = false
  state.fieldInsertKeyRequired = false
  state.fieldErrorMessage = ''
}

const typeColor = (fieldType) => {
  console.log('typeColor')
  console.log(fieldType)
  if (fieldType === 'string') {
    return '#0d47a1' // dark blue
  }
  if (fieldType === 'boolean') {
    return '#2e7d32' // dark green
  }
  if (fieldType === 'array') {
    return '#424242' // dark grey
  }
  if (fieldType === 'object') {
    return '#1565c0' // darker light blue
  }
  if (fieldType === 'number' || fieldType === 'integer') {
    return '#000000' // black
  }
  return '#0d47a1' // dark blue
}

const removeField = (key) => {
  if (props.fieldType === 'array') {
    modelValue.value.splice(key, 1)
    if (modelValue.value.length === 0) {
      modelValue.value = []
      state.order = []
    }
    else {
      state.order = modelValue.value.map((value, index) => {
        return {
          key: index,
          value,
        }
      })
    }
    state.removeField = null
    return
  }
  delete modelValue.value[key]
  state.order = state.order.filter((k) => {
    return k.key !== key
  })
  state.removeField = null
}

const undo = async () => {
  modelValue.value = edgeGlobal.dupObject(edgeGlobal.edgeState.changeTracker[state.trackerKey])
  if (props.fieldType === 'array') {
    if (modelValue.value === null) {
      state.order = []
    }
    else {
      state.order = modelValue.value.map((value, index) => {
        return {
          key: index,
          value,
        }
      })
    }
  }
  if (props.fieldType === 'object') {
    if (!edgeGlobal.objHas(modelValue.value, 'flingKeyOrder')) {
      state.order = Object.entries(modelValue.value).map(([key, value]) => {
        return {
          key,
        }
      }).filter((k) => {
        return k.key !== 'flingKeyOrder'
      })
    }
    else {
      state.order = edgeGlobal.dupObject(modelValue.value.flingKeyOrder)
    }
  }
  state.loaded = false
  await nextTick()
  state.loaded = true
}

onBeforeMount(async () => {
  if (props.forFunctions) {
    state.fieldInsert.required = false
    state.fieldInsert.description = ''
  }
  modelValue.value = edgeGlobal.dupObject(props.modelValue)
  if (props.fieldType === 'objectList') {
    props.modelValue.forEach((item, index) => {
      state.objectListOriginalOrder[item.id] = index
    })
  }
  if (props.fieldType === 'object') {
    if (!edgeGlobal.objHas(props.modelValue, 'flingKeyOrder')) {
      if (props.modelValue === null) {
        state.order = []
      }
      else {
        state.order = Object.entries(props.modelValue).map(([key, value]) => {
          return {
            key,
          }
        }).filter((k) => {
          return k.key !== 'flingKeyOrder'
        })
      }
    }
    else {
      state.order = edgeGlobal.dupObject(props.modelValue.flingKeyOrder)
    }
  }
  if (props.fieldType === 'array') {
    if (props.modelValue === null) {
      state.order = []
    }
    else {
      state.order = props.modelValue.map((value, index) => {
        return {
          key: index,
          value,
        }
      })
    }
  }
  if (props.fieldType === 'collection') {
    if (props.collectionPath) {
      // only if startSnapshot is not already running
      if (edgeGlobal.objHas(edgeFirebase.data, props.collectionPath) === false) {
        console.log('startSnapshot')
        await edgeFirebase.startSnapshot(props.collectionPath)
        console.log(edgeFirebase.data[props.collectionPath])
      }
    }
  }
  state.loaded = true
})

const collectionItems = computed(() => {
  if (!props.collectionPath || !props.collectionTitleField) {
    return []
  }
  if (edgeGlobal.objHas(edgeFirebase.data, props.collectionPath) === false) {
    return []
  }
  // if collection props.collectionValueField is the same as props.collectionTitleField return an a array of vaules of the title field
  if (props.collectionValueField === props.collectionTitleField) {
    return Object.values(edgeFirebase.data[props.collectionPath]).map(item => item[props.collectionTitleField])
  }
  return Object.values(edgeFirebase.data[props.collectionPath]).map(item => ({
    title: item[props.collectionTitleField],
    value: item.docId,
  }))
})

watch (() => state.removeField, () => {
  if (state.removeField !== null) {
    state.removeFieldDialogShow = true
  }
  else {
    state.removeFieldDialogShow = false
  }
})

const originalCompare = computed(() => {
  if (props.fieldType === 'objectList' || props.fieldType === 'object' || props.fieldType === 'array' || returnObject) {
    return JSON.stringify(edgeGlobal.edgeState.changeTracker[state.trackerKey])
  }
  else {
    return edgeGlobal.edgeState.changeTracker[state.trackerKey]
  }
})

const isTracked = computed(() => {
  return edgeGlobal.objHas(edgeGlobal.edgeState.changeTracker, state.trackerKey)
})

const modelCompare = computed(() => {
  if (props.fieldType === 'objectList' || props.fieldType === 'object' || props.fieldType === 'array' || returnObject) {
    return JSON.stringify(modelValue.value)
  }
  else {
    return modelValue.value
  }
})

const getArrayObjectLabel = (key) => {
  if (props.fieldType === 'object') {
    return key
  }
  else {
    if (props.forFunctions) {
      return 'Array Item Params'
    }
    return `Array Item #${key + 1}`
  }
}

const openKeyMenu = (key) => {
  state.keyMenu = true
  state.currentKey = key
  state.newKey = key
}

const updateKey = async () => {
  const keyArray = Object.keys(modelValue.value)
  const keyIndex = keyArray.findIndex(k => k === state.currentKey)
  keyArray[keyIndex] = state.newKey

  const value = modelValue.value[state.currentKey]
  delete modelValue.value[state.currentKey]

  const newObject = {}
  keyArray.forEach((k) => {
    if (k === state.newKey) {
      newObject[k] = value
    }
    else {
      newObject[k] = modelValue.value[k]
    }
  })

  const newItem = { key: state.newKey }
  const index = state.order.findIndex(item => item.key === state.currentKey)
  if (index !== -1) {
    state.order.splice(index, 1, newItem)
  }
  modelValue.value = newObject
  state.keyMenu = false
}

const isNumber = (value) => {
  return !isNaN(parseFloat(value)) && isFinite(value)
}

onMounted(() => {
  state.trackerKey = (`${props.parentTrackerId}-${props.label.replaceAll(' ', '-')}`).toLowerCase()
  if (!edgeGlobal.objHas(edgeGlobal.edgeState.changeTracker, state.trackerKey)) {
    if (!props.disableTracking) {
      edgeGlobal.edgeState.changeTracker[state.trackerKey] = edgeGlobal.dupObject(modelValue.value)
    }
  }
  state.afterMount = true
})

const userItem = (id) => {
  if (!edgeGlobal.objHas(edgeFirebase.state.users, id)) {
    return ''
  }
  if (!edgeGlobal.objHas(edgeFirebase.state.users[id], 'meta')) {
    return ''
  }
  if (!edgeGlobal.objHas(edgeFirebase.state.users[id].meta, 'name')) {
    return ''
  }
  return edgeFirebase.state.users[id].meta.name
}

const collectionItem = (id) => {
  if (!props.collectionPath || !props.collectionTitleField) {
    return ''
  }
  if (!edgeGlobal.objHas(edgeFirebase.data, props.collectionPath)) {
    return ''
  }
  if (!edgeGlobal.objHas(edgeFirebase.data[props.collectionPath], id)) {
    return ''
  }
  if (!edgeGlobal.objHas(edgeFirebase.data[props.collectionPath][id], props.collectionTitleField)) {
    return ''
  }
  return edgeFirebase.data[props.collectionPath][id][props.collectionTitleField]
}

const validateInput = (event) => {
  // Allow keys that don't result in character input.
  if (['Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key)) {
    return
  }

  // Create a copy of the value that would result from this keypress.
  const proposedValue = event.target.value + event.key

  // Create a regex that matches valid inputs: up to one decimal point, and up to two digits after the decimal point.
  const regex = /^\d*\.?\d{0,2}$/

  // If the proposed value doesn't match the regex, prevent the keypress.
  if (!regex.test(proposedValue)) {
    event.preventDefault()
  }
}
watch(() => props.modelValue, (newValue) => {
  if (state.afterMount) {
    if (props.fieldType === 'objectList') {
    // Only update if the objects are different
      if (JSON.stringify(modelValue.value) !== JSON.stringify(newValue)) {
        modelValue.value = edgeGlobal.dupObject(newValue)
      }
    }
  }
  // console.log('order changed')
})

watch(() => state.order, () => {
  if (props.fieldType === 'object') {
    modelValue.value.flingKeyOrder = edgeGlobal.dupObject(state.order)
  }
  if (props.fromFunctions) {
    return
  }
  console.log('order changed')
  if (props.fieldType === 'array') {
    if (!state.orderUpdateFromWatcher) {
      if (state.order.length > 0) {
        const currentValues = edgeGlobal.dupObject(modelValue.value)
        modelValue.value = state.order.map((item) => {
          return currentValues[item.key]
        })

        state.orderUpdateFromWatcher = true
        if (modelValue.value.some(item => typeof item !== 'object' || item === null)) {
          state.order = modelValue.value.map((value, index) => {
            return {
              key: index,
              value,
            }
          })
        }
      }
    }
  }
},
{ deep: true })

const fieldInsertType = computed(() => {
  return state.fieldInsert.type
})

watch(fieldInsertType, (newValue, oldValue) => {
  if (state.isEditing) {
    return
  }
  if (oldValue !== newValue) {
    console.log('fieldInsertType changed')
    clearExtraFields()
  }
})

watch(() => state.fieldInsertDialog, () => {
  if (!state.fieldInsertDialog) {
    state.isEditing = false
  }
  if (state.isEditing) {
    return
  }
  if (state.fieldInsertDialog) {
    if (props.fieldType === 'array') {
      if (!props.forFunctions) {
        // addField()
      }
    }
  }
  else {
    state.fieldInsert.key = ''
    if (props.forFunctions) {
      state.fieldInsert.required = false
      clearExtraFields()
    }
    state.fieldInsertKeyRequired = false
    state.fieldErrorMessage = ''
  }
},
{ deep: true })

watch(modelValue, () => {
  if (state.afterMount) {
    emit('update:modelValue', modelValue.value)
  }
  if (props.fieldType === 'array') {
    state.orderUpdateFromWatcher = false
  }
}, { deep: true })
</script>

<template>
  <div v-if="state.loaded">
    <edge-shad-combobox
      v-if="props.fieldType === 'collection'"
      v-model="modelValue"
      :label="props.label"
      :items="collectionItems"
      v-bind="props.bindings"
      :disabled="props.disabled"
      :name="props.name"
      item-value="value"
      item-title="title"
      :placeholder="`${props.label}...`"
    >
      <template v-if="props.helper" #append>
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-combobox>
    <Card v-if="props.fieldType === 'stringArray' || props.fieldType === 'numberArray' || props.fieldType === 'intArray'" class="p-1">
      <CardHeader class="py-2 px-3">
        <CardTitle class="text-md">
          {{ props.label }}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div v-if="refreshArray" class="w-full flex items-center">
          <div class="grow">
            <edge-shad-number
              v-if="props.fieldType === 'numberArray'"
              v-model="state.arrayAdd"
              :step=".1"
              :name="`${props.name}Input`"
              v-bind="props.bindings"
              class="w-full"
            />
            <edge-shad-number
              v-else-if="props.fieldType === 'intArray'"
              v-model="state.arrayAdd"
              :step="1"
              :name="`${props.name}Input`"
              :format-options="{ maximumFractionDigits: 0 }"
              v-bind="props.bindings"
            />
            <edge-shad-input
              v-else
              v-model="state.arrayAdd"
              :name="`${props.name}Input`"
            />
          </div>
          <edge-shad-button size="icon" class="text-white bg-slate-800 hover:bg-slate-400" @click.stop.prevent="addArray">
            <ListPlus width="16" height="16" />
          </edge-shad-button>
        </div>

        <div>
          <draggable
            v-model="modelValue"
            handle=".handle"
            item-key="key"
          >
            <template #item="{ element }">
              <div :key="element" class="w-full flex odd:bg-slate-700 even:bg-slate-500 rounded-sm py-1 items-center">
                <div class="text-left px-2">
                  <Grip class="handle pointer" />
                </div>
                <div class="grow  text-white px-2">
                  {{ element }}
                </div>
                <div class="pr-1">
                  <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" size="icon" @click="modelValue.splice(i, 1)">
                    <Trash width="16" height="16" />
                  </edge-shad-button>
                </div>
              </div>
            </template>
          </draggable>
        </div>
      </CardContent>
    </Card>
    <edge-shad-select
      v-if="props.fieldType === 'users'"
      v-model="modelValue"
      :label="props.label"
      v-bind="props.bindings"
      :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')"
      item-title="meta.name"
      item-value="userId"
      :disabled="props.disabled"
      :name="props.name"
      :description="props.hint"
    >
      <template v-if="props.helper" #icon>
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-select>
    <edge-shad-number
      v-if="props.fieldType === 'number'"
      v-model="modelValue"
      :step=".1"
      :name="props.name"
      :disabled="props.disabled"
      v-bind="props.bindings"
      :label="props.label"
      :description="props.hint"
    >
      <template v-if="props.helper">
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-number>
    <edge-shad-number
      v-if="props.fieldType === 'integer'"
      v-model="modelValue"
      :step="1"
      :name="props.name"
      :disabled="props.disabled"
      v-bind="props.bindings"
      :label="props.label"
      :description="props.hint"
      :format-options="{ maximumFractionDigits: 0 }"
    >
      <template v-if="props.helper">
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-number>
    <edge-shad-number
      v-if="props.fieldType === 'money'"
      v-model="modelValue"
      :step=".1"
      :name="props.name"
      :disabled="props.disabled"
      v-bind="props.bindings"
      :label="props.label"
      :description="props.hint"
      :format-options="{
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'symbol',
        currencySign: 'accounting',
      }"
    >
      <template v-if="props.helper">
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-number>
    <edge-shad-input
      v-if="props.fieldType === 'text'"
      v-model="modelValue"
      v-maska:[props.maskOptions]
      type="text"
      :name="props.name"
      v-bind="props.bindings"
      :label="props.label"
      :disabled="props.disabled"
      :description="props.hint"
    >
      <template #icon>
        <edge-g-helper v-if="props.helper" :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-input>
    <edge-shad-checkbox
      v-if="props.fieldType === 'boolean'"
      v-model="modelValue"
      :name="props.name"
      v-bind="props.bindings"
    >
      {{ props.label }}
      <template #icon>
        <edge-g-helper v-if="props.helper" :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-checkbox>
    <edge-shad-combobox
      v-if="props.fieldType === 'combobox'"
      v-model="modelValue"
      :label="props.label"
      :items="props.items"
      v-bind="props.bindings"
      :disabled="props.disabled"
      :name="props.name"
      :item-value="props.valueField"
      :item-title="props.titleField"
      :placeholder="`${props.label}...`"
    >
      <template v-if="props.helper" #append>
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-combobox>
    <edge-shad-select
      v-if="props.fieldType === 'select'"
      v-model="modelValue"
      :label="props.label"
      :items="props.items"
      v-bind="props.bindings"
      :disabled="props.disabled"
      :name="props.name"
    >
      <template v-if="props.helper" #icon>
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-select>
    <edge-shad-textarea
      v-if="props.fieldType === 'textarea'"
      v-model="modelValue"
      v-maska:[props.maskOptions]
      type="text"
      :name="props.name"
      v-bind="props.bindings"
      :label="props.label"
      :disabled="props.disabled"
    >
      <template v-if="props.helper" #icon>
        <edge-g-helper :title="props.label" :helper="props.helper" />
      </template>
    </edge-shad-textarea>
    <template v-if="props.fieldType === 'object' || props.fieldType === 'array'">
      <edge-shad-dialog v-model="state.keyMenu">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span v-if="props.fieldType === 'object'">
                Update Key
              </span>
              <span v-else>
                Add Item
              </span>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription />
          <edge-shad-input
            v-model="state.newKey"
            name="key"
            class="mb-1"
            label="Key"
            v-bind="props.bindings"
          />
          <DialogFooter class="pt-6 flex justify-between">
            <edge-shad-button variant="destructive" @click="state.keyMenu = false">
              Cancel
            </edge-shad-button>
            <edge-shad-button class="text-white w-full bg-slate-800 hover:bg-slate-400" @click="updateKey">
              Submit
            </edge-shad-button>
          </DialogFooter>
        </DialogContent>
      </edge-shad-dialog>
      <Card v-if="!(props.forFunctions && modelValue.length >= 1)" class="p-0" :class="state.forFunctions ? '' : 'bg-transparent mb-1'">
        <CardHeader class="p-2" :class="state.forFunctions ? '' : 'bg-transparent'">
          <div class="w-full flex justify-between">
            <div v-if="!props.forFunctions" class="flex items-center">
              <Braces v-if="props.fieldType === 'object'" class="mx-2" />

              <Brackets v-else class="mx-2" />

              <div>
                {{ props.label }}
              </div>
            </div>
            <div class="flex items-center">
              <edge-shad-button class="bg-slate-500 mx-2 h-6 text-xs" @click.stop.prevent="state.fieldInsertDialog = true">
                <template v-if="props.fieldType === 'object'">
                  Add Field
                </template>
                <template v-else>
                  <template v-if="props.forFunctions">
                    Array Item Params
                  </template>
                  <template v-else>
                    Add Item
                  </template>
                </template>
              </edge-shad-button>
              <edge-g-helper v-if="props.helper" :title="props.label" :helper="props.helper" />
            </div>
          </div>
        </CardHeader>
        <CardContent class="py-0 px-2">
          <draggable
            v-model="state.order"
            handle=".handle"
            item-key="key"
          >
            <template #item="{ element }">
              <div :key="element.key" class="w-full">
                <div class="flex w-full py-1 justify-between items-center">
                  <div class="text-left px-2">
                    <Grip class="handle pointer" />
                  </div>
                  <div
                    v-show="props.fieldType !== 'array'"
                    class="w-1/6 text-left mr-2"
                  >
                    <template v-if="modelValue[element.key].gptGenerated">
                      <edge-shad-button class="bg-slate-500 mx-2 h-6 text-xs" @click.prevent.stop="editField(element)">
                        {{ element.key }}
                      </edge-shad-button>
                    </template>
                    <edge-shad-button v-else class="bg-slate-500 mx-2 h-6 text-xs" @click.prevent.stop="openKeyMenu(element.key)">
                      {{ element.key }}
                    </edge-shad-button>
                  </div>
                  <div
                    v-if="props.fieldType === 'array'"
                  >
                    <edge-shad-button v-if="props.forFunctions" class="bg-slate-500 mx-2 h-6 text-xs" @click.prevent.stop="editField(element)">
                      <Pencil width="16" height="16" />
                      {{ element.value.type }}
                    </edge-shad-button>
                  </div>
                  <div class="py-0 text-right grow">
                    <template v-if="modelValue[element.key].gptGenerated || props.forFunctions">
                      <edge-function-chips class="mt-5" :field="modelValue[element.key]" />
                    </template>
                    <template v-else-if="typeof modelValue[element.key].value !== 'object'">
                      <edge-shad-input
                        v-if="typeof modelValue[element.key].value === 'string'"
                        v-model="modelValue[element.key].value"
                        v-bind="props.bindings"
                        placeholder="Enter value here"
                        :name="typeof modelValue[element.key].value"
                      />
                      <edge-shad-checkbox
                        v-else-if="typeof modelValue[element.key].value === 'boolean'"
                        v-model="modelValue[element.key].value"
                        class="mb-1"
                        v-bind="props.bindings"
                        :name="typeof modelValue[element.key].value"
                      >
                        {{ getArrayObjectLabel(element.key) }}
                      </edge-shad-checkbox>
                      <edge-shad-number
                        v-else-if="modelValue[element.key].type === 'number'"
                        v-model="modelValue[element.key].value"
                        :step=".1"
                        :name="typeof modelValue[element.key].value"
                        v-bind="props.bindings"
                      />
                      <edge-shad-number
                        v-else-if="modelValue[element.key].type === 'integer'"
                        v-model="modelValue[element.key].value"
                        :step="1"
                        :name="typeof modelValue[element.key].value"
                        :format-options="{ maximumFractionDigits: 0 }"
                        v-bind="props.bindings"
                      />
                    </template>
                    <template v-else>
                      <Separator class="dark:bg-slate-600" />
                    </template>
                  </div>
                  <edge-shad-button variant="text" size="icon" @click.prevent.stop="state.removeField = element.key">
                    <Trash width="18" height="18" />
                  </edge-shad-button>
                </div>
                <div v-if="typeof modelValue[element.key].value === 'object'" class="w-full py-1">
                  <edge-g-input v-model="modelValue[element.key].value" :name="element.key" :for-functions="props.forFunctions" :bindings="props.bindings" :label="getArrayObjectLabel(element.key)" :disable-tracking="true" :field-type="Array.isArray(modelValue[element.key].value) ? 'array' : 'object'" />
                </div>
              </div>
            </template>
          </draggable>
          <edge-shad-dialog
            v-model="state.removeFieldDialogShow"
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Delete "{{ getArrayObjectLabel (state.removeField) }}"
                </DialogTitle>
                <DialogDescription class="mt-3">
                  Are you sure you want to delete "{{ getArrayObjectLabel(state.removeField) }}"?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter class="pt-6 flex justify-between">
                <edge-shad-button class="text-white bg-slate-800 hover:bg-slate-400" @click="state.removeField = null">
                  Cancel
                </edge-shad-button>
                <edge-shad-button variant="destructive" class="w-full" @click="removeField(state.removeField)">
                  Delete
                </edge-shad-button>
              </DialogFooter>
            </DialogContent>
          </edge-shad-dialog>
        </CardContent>
      </Card>
    </template>
    <template v-if="props.fieldType === 'objectList'">
      <Card class="bg-transparent border-0">
        <CardHeader class="pt-3 pb-2">
          <CardTitle class="text-lg flex items-center">
            <div>{{ props.label }}</div>
            <div class="grow text-right">
              <component :is="`${props.subFieldType}`" v-model:items="modelValue" :pass-through-props="passThroughProps" />
            </div>
            <edge-g-helper v-if="props.helper" :title="props.label" :helper="props.helper" />
          </CardTitle>
          <CardDescription>
            <Separator />
          </CardDescription>
        </CardHeader>
        <CardContent class="mt-0">
          <draggable
            v-model="modelValue"
            handle=".handle"
            item-key="id"
          >
            <template #item="{ element, index }">
              <div>
                <component :is="`${props.subFieldType}`" v-model:items="modelValue" :item="element" :pass-through-props="passThroughProps" />
                <Alert v-if="isTracked && state.afterMount && (JSON.stringify(modelValue[index]) !== JSON.stringify(edgeGlobal.edgeState.changeTracker[state.trackerKey][state.objectListOriginalOrder[element.id]]))" class="mt-0 mb-3 bg-warning py-2 px-1">
                  <div class="flex flex-wrap justify-center py-0 items-center">
                    <div v-if="props.fieldType === 'objectList'" class="flex flex-wrap justify-center grow">
                      This item has been modified
                    </div>
                    <div v-else class="flex flex-wrap justify-center grow">
                      Modified from "{{ originalCompare }}"
                    </div>
                    <div class="text-right">
                      <edge-shad-button class="text-white  bg-slate-700 mx-2 h-6 text-xs" @click="modelValue[index] = edgeGlobal.edgeState.changeTracker[state.trackerKey][state.objectListOriginalOrder[element.id]]">
                        Undo
                      </edge-shad-button>
                    </div>
                  </div>
                </Alert>
                <Separator
                  class="dark:bg-slate-600"
                />
              </div>
            </template>
          </draggable>
        </CardContent>
      </Card>
    </template>
    <Alert v-if="isTracked && state.afterMount && (modelCompare !== originalCompare)" class="mt-0 mb-3 bg-warning py-2 px-1">
      <div class="flex flex-wrap justify-center py-0 items-center">
        <template v-if="props.fieldType === 'objectList' || props.fieldType === 'object' || props.fieldType === 'array' || returnObject">
          <div class="justify-center text-center grow">
            {{ props.label }} has been modified
          </div>
          <div class="text-right">
            <edge-shad-button class="text-white bg-slate-700 mx-2 h-6 text-xs" @click="undo()">
              Undo All
            </edge-shad-button>
          </div>
        </template>

        <template v-else>
          <div v-if="props.fieldType === 'collection'" class="flex flex-wrap justify-center grow">
            <template v-if="props.collectionTitleField !== props.collectionValueField">
              Modified to "{{ collectionItem(modelValue) }}"
            </template>
            <template v-else>
              Modified from "{{ originalCompare }}" to "{{ modelValue }}"
            </template>
          </div>
          <div v-else-if="props.fieldType === 'users'" class="flex flex-wrap justify-center grow">
            Modified to "{{ userItem(modelValue) }}"
          </div>
          <div v-else class="flex flex-wrap justify-center grow">
            Modified from "{{ originalCompare }}" to "{{ modelValue }}"
          </div>
          <div class="text-right">
            <edge-shad-button class="text-white  bg-slate-700 mx-2 h-6 text-xs" @click="undo()">
              Undo
            </edge-shad-button>
          </div>
        </template>
      </div>
    </Alert>
  </div>
  <edge-shad-dialog v-model="state.fieldInsertDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          <template v-if="!state.isEditing">
            Add Field
          </template>
          <template v-else>
            Update Field
          </template>
        </DialogTitle>
      </DialogHeader>
      <DialogDescription />
      <edge-shad-input
        v-if="props.fieldType === 'object'"
        v-model="state.fieldInsert.key"
        v-bind="props.bindings"
        label="Field Key"
        name="key"
        class="mb-0"
      />
      <Alert v-if="state.fieldInsertKeyRequired" class="mt-0 mb-3 bg-error py-2 px-1">
        <div class="flex flex-wrap justify-center py-0 items-center">
          <div class="justify-center grow pl-2 text-bold">
            {{ state.fieldErrorMessage }}
          </div>
        </div>
      </Alert>
      <edge-shad-select
        v-if="(fieldTypes.length > 1) || props.forFunctions"
        v-model="state.fieldInsert.type"
        :disabled="state.isEditing"
        v-bind="props.bindings"
        :items="fieldTypes"
        label="Type"
        name="type"
      />
      <edge-shad-textarea
        v-if="props.forFunctions"
        v-model="state.fieldInsert.description"
        label="Description"
        name="description"
      />
      <edge-shad-checkbox
        v-if="props.forFunctions && props.fieldType !== 'array'"
        v-model="state.fieldInsert.required"
        label="Field Required"
        name="required"
      />
      <DropdownMenu v-if="props.forFunctions">
        <DropdownMenuTrigger as-child>
          <Button variant="outline" class="">
            Add JSON Schema Params
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-56">
          <DropdownMenuGroup>
            <template v-for="(item, i) in extraTypeFields[state.fieldInsert.type]" :key="i">
              <DropdownMenuItem
                v-if="!state.fieldInsert.hasOwnProperty(i)"
                :key="i"
                :value="item"
                color="primary"
                class="cursor-pointer"
                @click="state.fieldInsert[i] = item.default"
              >
                <span>{{ item.bindings.label }}</span>
              </DropdownMenuItem>
            </template>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <template v-for="(value, key) in state.fieldInsert" :key="key">
        <edge-g-input v-if="!['type', 'key', 'description', 'required', 'gptGenerated', 'value', 'fieldId'].includes(key)" v-model="state.fieldInsert[key]" :name="key" :disable-tracking="true" v-bind="extraTypeFields[state.fieldInsert.type][key].bindings" />
      </template>
      <DialogFooter class="pt-6 flex justify-between">
        <edge-shad-button variant="destructive" @click="state.fieldInsertDialog = false">
          Cancel
        </edge-shad-button>
        <edge-shad-button class="w-full text-white bg-slate-800 hover:bg-slate-400" @click="addField">
          <template v-if="!state.isEditing">
            Insert
          </template>
          <template v-else>
            Update
          </template>
        </edge-shad-button>
      </DialogFooter>
    </DialogContent>
  </edge-shad-dialog>
</template>

<style lang="scss">
.vue-number-input input {
  background-color: transparent !important;
}
.pointer {
  cursor: grab;
}
</style>
