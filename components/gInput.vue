<script setup>
// TODO:  ADD HELPERS TO THE SCHEMA PARAMS
// TODO: START SHAD CONVERSION AT text
import { computed, defineProps, inject, nextTick, onBeforeMount, onMounted, reactive, ref, watch } from 'vue'
import { Braces, Brackets, Pencil, Trash } from 'lucide-vue-next'

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
    default: '',
  },
  collectionValueField: {
    type: String,
    default: 'docId',
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

const addArray = () => {
  console.log(state.arrayAdd)
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
    <template v-if="props.fieldType === 'collection'">
      <v-combobox
        v-if="props.collectionValueField === props.collectionTitleField"
        v-model="modelValue"
        :rules="props.rules"
        :clearable="true"
        :label="props.label"
        :items="collectionItems"
        v-bind="props.bindings"
        :return-object="false"
        :disabled="props.disabled"
      >
        <template v-if="props.helper" #append>
          <edge-g-helper :helper="props.helper" />
        </template>
      </v-combobox>
      <v-select
        v-else
        v-model="modelValue"
        :rules="props.rules"
        :clearable="true"
        :label="props.label"
        :items="collectionItems"
        v-bind="props.bindings"
        :return-object="false"
        :disabled="props.disabled"
      >
        <template v-if="props.helper" #append>
          <edge-g-helper :helper="props.helper" />
        </template>
      </v-select>
    </template>
    <v-input
      v-if="props.fieldType === 'stringArray' || props.fieldType === 'numberArray' || props.fieldType === 'intArray'"
      v-model="modelValue"
      v-bind="props.bindings"
      :rules="props.rules"
      :label="props.label"
      :hint="props.hint"
      :persistent-hint="props.persistentHint"
      :disabled="props.disabled"
      class="mt-1"
    >
      <v-card flat width="100%" variant="tonal" class="px-3">
        <v-card-title v-if="state.fieldInsert.type !== 'string'" class="headline">
          {{ props.label }}
        </v-card-title>
        <v-toolbar color="transparent" flat class="pl-2">
          <template v-if="props.fieldType === 'numberArray'">
            <vue-number-input
              v-model="state.arrayAdd"
              :step=".1"
              controls
              size="medium"
              v-bind="props.bindings"
              @keyup.enter="addArray"
            />
            <v-spacer />
            <v-btn icon @click="addArray">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </template>
          <template v-else-if="props.fieldType === 'intArray'">
            <vue-number-input
              v-model="state.arrayAdd"
              :step="1"
              controls
              size="medium"
              v-bind="props.bindings"
              @keyup.enter="addArray"
              @keydown="event => (event.key === '.' || event.keyCode === 190) && event.preventDefault()"
            />
            <v-spacer />
            <v-btn icon @click="addArray">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </template>
          <v-text-field
            v-else
            v-model="state.arrayAdd"
            variant="underlined"
            density="compact"
            hide-details
            :label="props.label"
            append-inner-icon="mdi-plus"
            class="mr-2"
            @click:append-inner="addArray"
            @keyup.enter="addArray"
          />
        </v-toolbar>
        <v-list variant="tonal" density="compact">
          <v-list-item
            v-for="(item, i) in modelValue"
            :key="i"
            :value="item"
            color="primary"
          >
            <v-list-item-title>
              {{ item }}
            </v-list-item-title>
            <template #append>
              <v-btn flat size="x-small" icon @click="modelValue.splice(i, 1)">
                <Trash class="text-sm" />
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </v-input>
    <v-select
      v-if="props.fieldType === 'users'"
      v-model="modelValue"
      :rules="props.rules"
      :clearable="true"
      :label="props.label"
      :items="Object.values(edgeFirebase.state.users).filter(user => user.userId !== '')"
      v-bind="props.bindings"
      item-title="meta.name"
      item-value="userId"
      :disabled="props.disabled"
    >
      <template v-if="props.helper" #append>
        <edge-g-helper :helper="props.helper" />
      </template>
    </v-select>
    <v-card v-if="props.fieldType === 'number'" flat color="transparent">
      <v-card-title class="text-caption pb-0">
        {{ props.label }}
      </v-card-title>
      <v-input
        v-model="modelValue"
        v-bind="props.bindings"
        :rules="props.rules"
        :label="props.label"
        :hint="props.hint"
        :persistent-hint="props.persistentHint"
        :disabled="props.disabled"
        class="mt-1"
      >
        <vue-number-input
          v-model="modelValue"
          style="width: 100%"
          :step=".1"
          controls
          size="medium"
          v-bind="props.bindings"
          :rules="props.rules"
          :disabled="props.disabled"
        />
      </v-input>
    </v-card>
    <v-card v-if="props.fieldType === 'integer'" flat color="transparent">
      <v-card-title class="text-caption pb-0">
        {{ props.label }}
      </v-card-title>
      <v-input
        v-model="modelValue"
        v-bind="props.bindings"
        :rules="props.rules"
        :label="props.label"
        :hint="props.hint"
        :persistent-hint="props.persistentHint"
        :disabled="props.disabled"
        class="mt-1"
      >
        <vue-number-input
          v-model="modelValue"
          style="width: 100%"
          :step="1"
          controls
          size="medium"
          v-bind="props.bindings"
          :rules="props.rules"
          :disabled="props.disabled"
          @keydown="event => (event.key === '.' || event.keyCode === 190) && event.preventDefault()"
        />
      </v-input>
    </v-card>
    <v-text-field
      v-if="props.fieldType === 'money'"
      v-model="modelValue"
      v-maska:[props.maskOptions]
      v-bind="props.bindings"
      :rules="props.rules"
      :label="props.label"
      :hint="props.hint"
      :persistent-hint="props.persistentHint"
      :disabled="props.disabled"
      prefix="$"
      @keydown="validateInput"
    >
      <template v-if="props.helper" #append-inner>
        <edge-g-helper :helper="props.helper" />
      </template>
    </v-text-field>
    <edge-shad-input
      v-if="props.fieldType === 'text'"
      v-model="modelValue"
      v-maska:[props.maskOptions]
      type="text"
      :name="props.name"
      v-bind="props.bindings"
      :label="props.label"
      :disabled="props.disabled"
    >
      <template #icon>
        <edge-g-helper v-if="props.helper" :helper="props.helper" />
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
        <edge-g-helper v-if="props.helper" :helper="props.helper" />
      </template>
    </edge-shad-checkbox>
    <edge-shad-select
      v-if="props.fieldType === 'select'"
      v-model="modelValue"
      :label="props.label"
      :items="props.items"
      v-bind="props.bindings"
      :disabled="props.disabled"
      :name="props.name"
      class="pr-8"
    >
      <template v-if="props.helper" #icon>
        <edge-g-helper :helper="props.helper" />
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
        <edge-g-helper :helper="props.helper" />
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
              <edge-g-helper v-if="props.helper" :helper="props.helper" />
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
                    <v-icon class="handle pointer">
                      mdi-format-align-justify
                    </v-icon>
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
      <Card class="h-100">
        <CardHeader class="pt-3 pb-2">
          <CardTitle class="text-lg flex items-center">
            <div>{{ props.label }}</div>
            <div class="grow text-right">
              <component :is="`edge-form-subtypes-${props.subFieldType}`" v-model:items="modelValue" :pass-through-props="passThroughProps" />
            </div>
            <edge-g-helper v-if="props.helper" :helper="props.helper" />
          </CardTitle>
          <CardDescription>
            <Separator />
          </CardDescription>
        </CardHeader>
        <CardContent class="mt-0">
          <v-list class="mt-0 pt-0" bg-color="transparent">
            <draggable
              v-model="modelValue"
              handle=".handle"
              item-key="id"
            >
              <template #item="{ element, index }">
                <div>
                  <component :is="`edge-form-subtypes-${props.subFieldType}`" v-model:items="modelValue" :item="element" :pass-through-props="passThroughProps" />
                  <v-fade-transition>
                    <v-alert v-if="isTracked && state.afterMount && (JSON.stringify(modelValue[index]) !== JSON.stringify(edgeGlobal.edgeState.changeTracker[state.trackerKey][state.objectListOriginalOrder[element.id]]))" class="mt-0 mb-3 text-caption" density="compact" variant="tonal" type="warning">
                      <v-row dense class="pa-0 ma-0">
                        <v-col v-if="props.fieldType === 'objectList'">
                          This item has been modified
                        </v-col>
                        <v-col v-else>
                          Modified from "{{ originalCompare }}"
                        </v-col>
                        <v-col cols="4" class="text-right">
                          <v-btn variant="tonal" class="ml-8" size="x-small" @click="modelValue[index] = edgeGlobal.edgeState.changeTracker[state.trackerKey][state.objectListOriginalOrder[element.id]]">
                            Undo
                          </v-btn>
                          <!-- <v-btn v-else variant="text" class="ml-8" size="x-small" @click="modelValue = edgeState.changeTracker[state.trackerKey]">
                            Undo
                          </v-btn> -->
                        </v-col>
                      </v-row>
                    </v-alert>
                  </v-fade-transition>
                  <Separator
                    class="dark:bg-slate-600"
                  />
                </div>
              </template>
            </draggable>
          </v-list>
        </CardContent>
      </Card>
      <v-input
        v-model="modelValue"
        density="compact"
        :rules="props.rules"
        v-bind="props.bindings"
      />
    </template>
    <v-fade-transition>
      <v-alert v-if="isTracked && state.afterMount && (modelCompare !== originalCompare)" class="mt-0 mb-3 text-caption" density="compact" variant="tonal" type="warning">
        <v-row dense class="pa-0 ma-0">
          <template v-if="props.fieldType === 'objectList' || props.fieldType === 'object' || props.fieldType === 'array' || returnObject">
            <v-col>
              {{ props.label }} has been modified
            </v-col>
            <v-btn variant="tonal" class="ml-8" size="x-small" @click="undo()">
              Undo All
            </v-btn>
          </template>
          <template v-else>
            <v-col v-if="props.fieldType === 'collection'">
              <template v-if="props.collectionTitleField !== props.collectionValueField">
                Modified to "{{ collectionItem(modelValue) }}"
              </template>
              <template v-else>
                Modified from "{{ originalCompare }}" to "{{ modelValue }}"
              </template>
            </v-col>
            <v-col v-else-if="props.fieldType === 'users'">
              Modified to "{{ userItem(modelValue) }}"
            </v-col>
            <v-col v-else>
              Modified from "{{ originalCompare }}" to "{{ modelValue }}"
            </v-col>
            <v-col cols="4" class="text-right">
              <v-btn variant="tonal" class="ml-8" size="x-small" @click="undo()">
                Undo
              </v-btn>
            </v-col>
          </template>
        </v-row>
      </v-alert>
    </v-fade-transition>
  </div>
  <v-dialog v-model="state.fieldInsertDialog" max-width="400">
    <v-card>
      <v-toolbar density="compact">
        <v-toolbar-title v-if="props.fieldType === 'object'">
          <template v-if="!state.isEditing">
            Add Field
          </template>
          <template v-else>
            Update Field
          </template>
        </v-toolbar-title>
        <v-toolbar-title v-else>
          Add Item
        </v-toolbar-title>
        <v-spacer />
        <v-btn icon @click="state.fieldInsertDialog = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-card-text>
        <v-text-field
          v-if="props.fieldType === 'object'"
          v-model="state.fieldInsert.key"
          :error="state.fieldInsertKeyRequired"
          v-bind="props.bindings"
          label="Field Key"
          :error-messages="state.fieldErrorMessage"
        />
        <v-select
          v-if="(fieldTypes.length > 1) || props.forFunctions"
          v-model="state.fieldInsert.type"
          :disabled="state.isEditing"
          v-bind="props.bindings"
          :items="fieldTypes"
          label="Type"
          hide-details
        />
        <v-textarea
          v-if="props.forFunctions"
          v-model="state.fieldInsert.description"
          label="Description"
          hide-details
          rows="2"
        />
        <v-checkbox
          v-if="props.forFunctions && props.fieldType !== 'array'"
          v-model="state.fieldInsert.required"
          label="Field Required"
          hide-details
        />
        <v-menu v-if="props.forFunctions">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              block
              variant="tonal"
            >
              Add JSON Schema Params
            </v-btn>
          </template>
          <v-list>
            <template v-for="(item, i) in extraTypeFields[state.fieldInsert.type]">
              <v-list-item
                v-if="!state.fieldInsert.hasOwnProperty(i)"
                :key="i"
                :value="item"
                color="primary"
                @click="state.fieldInsert[i] = item.default"
              >
                <v-list-item-title>
                  {{ item.bindings.label }}
                </v-list-item-title>
              </v-list-item>
            </template>
          </v-list>
        </v-menu>
        <template v-for="(value, key) in state.fieldInsert" :key="key">
          <edge-g-input v-if="!['type', 'key', 'description', 'required', 'gptGenerated', 'value', 'fieldId'].includes(key)" v-model="state.fieldInsert[key]" :name="key" :disable-tracking="true" v-bind="extraTypeFields[state.fieldInsert.type][key].bindings" />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="state.fieldInsertDialog = false">
          Cancel
        </v-btn>
        <v-btn color="primary" @click="addField">
          <template v-if="!state.isEditing">
            Insert
          </template>
          <template v-else>
            Update
          </template>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style lang="scss">
.vue-number-input input {
  background-color: transparent !important;
}
.pointer {
  cursor: move;
}
</style>
