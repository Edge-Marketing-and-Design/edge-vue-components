<script setup>
const props = defineProps({
  modelValue: {
    type: [String, Object],
    default: '',
  },
  siteVars: {
    type: Array,
    default: () => [],
  },
  globals: {
    type: Array,
    default: () => [],
  },
  siteImages: {
    type: Array,
    default: () => [],
  },
  siteBlocks: {
    type: Array,
    default: () => [],
  },
  assets: {
    type: Array,
    default: () => [],
  },
  blocks: {
    type: Array,
    default: () => [],
  },
  images: {
    type: Array,
    default: () => [],
  },
  fields: {
    type: Array,
    default: () => [],
  },
  height: {
    type: String,
    default: 'calc(100vh - 400px)',
  },
  chatgpt: {
    type: Boolean,
    default: false,
  },
  language: {
    type: String,
    default: 'json',
  },
  title: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'lineClick'])
const localModelValue = ref(null)
const edgeFirebase = inject('edgeFirebase')
const expectsJsonObject = ref(false)

const editorOptions = {
  mode: 'htmlmixed',
  lineNumbers: true,
  theme: 'default',
}
const state = reactive({
  content: '',
  afterMount: false,
  insertDialog: false,
  tab: 'globals',
  selectionRange: null,
  gpt: '',
  editHistory: [],
  currentHistory: 0,
  gptLoading: false,
  gptMenu: false,
  undoredo: false,
  gptHTML: '',
  diffDialog: false,
  chatGPT: false,
})

onMounted(() => {
  nextTick(() => {
    state.afterMount = true
  })
})

const toEditorValue = (value) => {
  if (props.language === 'json') {
    if (value === null || value === undefined)
      return ''
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2)
      }
      catch (err) {
        console.warn('Unable to stringify JSON object for editor', err)
        return ''
      }
    }
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2)
      }
      catch {
        return value
      }
    }
  }
  return value ?? ''
}

const toEmittedValue = (value) => {
  if (props.language === 'json' && expectsJsonObject.value) {
    try {
      return value ? JSON.parse(value) : {}
    }
    catch (err) {
      console.warn('Invalid JSON; emitting raw string instead of object')
      return value
    }
  }
  return value
}

watch(() => props.modelValue, (newValue) => {
  if (state.afterMount) {
    expectsJsonObject.value = props.language === 'json' && newValue !== null && typeof newValue === 'object'
    localModelValue.value = toEditorValue(newValue)
  }
})

watch(localModelValue, () => {
  if (state.afterMount) {
    emit('update:modelValue', toEmittedValue(localModelValue.value))
    if (!state.undoredo) {
      state.editHistory.push(localModelValue.value)
      state.currentHistory = state.editHistory.length - 1
    }
    state.undoredo = false
  }
}, { deep: true })

const undo = () => {
  if (state.currentHistory > 0) {
    state.undoredo = true
    state.currentHistory--
    localModelValue.value = state.editHistory[state.currentHistory]
  }
}

const redo = () => {
  console.log(state.editHistory)
  if (state.currentHistory <= state.editHistory.length - 1) {
    state.undoredo = true
    state.currentHistory++
    localModelValue.value = state.editHistory[state.currentHistory]
  }
}

const editorCompRef = ref(null)
const editorInstanceRef = shallowRef(null)

const setCursor = () => {
  const editor = editorInstanceRef.value
  if (editor) {
    const cm = editor
    state.cursorPosition = cm.getPosition()
    state.selectionRange = cm.getSelections?.() || [cm.getSelection()]
  }
}

const initValue = ref()

onBeforeMount(() => {
  expectsJsonObject.value = props.language === 'json' && props.modelValue !== null && typeof props.modelValue === 'object'
  localModelValue.value = toEditorValue(edgeGlobal.dupObject(props.modelValue))
  initValue.value = localModelValue.value
  if (localModelValue.value) {
    state.editHistory.push(localModelValue.value)
    state.currentHistory = 0
  }
})

const runChatGpt = async () => {
  state.gptMenu = false
  state.gptLoading = true

  if (localModelValue.value !== state.editHistory[state.editHistory.length - 1]) {
    state.editHistory.push(localModelValue.value)
  }

  const variables = {
    globals: props.globals.map(global => `{{global_block_${global.name}}}`),
    siteImages: props.siteImages.map(image => `{{site_image_${image.name}}}`),
    siteBlocks: props.siteBlocks.map(block => `{{site_block_${block.name}}}`),
    blocks: props.blocks.map(block => `{{block_${block.name}}}`),
    images: props.images.map(image => `{{image_${image.name}}}`),
  }

  console.log(JSON.stringify(variables))

  const results = await edgeFirebase.runFunction('landings-chatGpt', { prompt: state.gpt, currentFile: localModelValue.value, variables: JSON.stringify(variables) })
  // localModelValue.value = results.data.html
  if (localModelValue.value.length === 0) {
    localModelValue.value = results.data.html
  }
  else {
    state.gptHTML = results.data.html
    state.diffDialog = true
  }

  state.editHistory.push(localModelValue.value)
  state.currentHistory = state.editHistory.length - 1

  state.gpt = ''
  state.gptLoading = false
}

const handleMount = (editor) => {
  editorInstanceRef.value = editor
  editorInstanceRef.value?.getAction('editor.action.formatDocument').run()
  editor.onMouseDown((event) => {
    const position = event?.target?.position
    const model = editor.getModel?.()
    if (!position || !model)
      return
    const lineContent = model.getLineContent(position.lineNumber)
    const offset = model.getOffsetAt(position)
    emit('lineClick', {
      lineNumber: position.lineNumber,
      column: position.column,
      lineContent,
      offset,
    })
  })
}

const formatCode = () => {
  const editorInstance = editorInstanceRef.value
  if (!editorInstance)
    return console.error('Editor instance not found')

  const model = editorInstance.getModel()
  if (!model)
    return console.error('Editor model not found')

  const value = model.getValue()

  if (props.language === 'json') {
    try {
      const parsed = JSON.parse(value)
      const pretty = JSON.stringify(parsed, null, 2)
      model.setValue(pretty)
    }
    catch (e) {
      console.warn('Invalid JSON — falling back to Monaco formatter')
      editorInstance.getAction('editor.action.formatDocument')?.run()
    }
  }
  else {
    editorInstance.getAction('editor.action.formatDocument')?.run()
  }
}

const insertBlock = (text) => {
  if (!text && text !== '')
    return
  const editor = editorInstanceRef.value
  if (!editor)
    return console.error('Editor instance not ready')

  let range = editor.getSelection()

  if (!range) {
    const position = editor.getPosition()
    if (!position)
      return console.error('No active selection or cursor position')
    range = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }
  }

  const op = { range, text, forceMoveMarkers: true }
  editor.executeEdits('insert-block', [op])
  editor.focus()
  state.insertDialog = false
}

defineExpose({
  insertSnippet: insertBlock,
})

const diffEditorRef = shallowRef()
const handleMountDiff = (editor) => {
  diffEditorRef.value = editor
}
const getChanges = () => {
  if (diffEditorRef.value) {
    const modifiedEditor = diffEditorRef.value.getModifiedEditor()
    const modifiedContent = modifiedEditor.getValue()
    localModelValue.value = modifiedContent
    initValue.value = modifiedContent
    state.diffDialog = false
    formatCode()
  }
}
</script>

<template>
  <Card class="border-0 px-0 shadow-none">
    <edge-menu class="border-0 shadow-none py-2 px-0">
      <template #start>
        <Popover v-if="props.chatgpt">
          <PopoverTrigger as-child>
            <edge-shad-button
              size="icon"
              class="bg-slate-400  w-8 h-8"
            >
              <Bot class="w-5 h-5" />
            </edge-shad-button>
          </PopoverTrigger>
          <PopoverContent class="w-[400px]">
            <Card class="border-0 p-0 w-full">
              <CardHeader class="p-2">
                <CardTitle>
                  ChatGPT
                </CardTitle>
              </CardHeader>
              <CardContent class="p-1">
                <edge-logging-in v-if="state.gptLoading" />
                <edge-shad-textarea
                  v-else
                  v-model="state.gpt"
                  label="Instructions"
                  name="gpt"
                  @keydown.enter.stop="runChatGpt"
                />
              </CardContent>
              <CardFooter class="p-2 flex justify-end">
                <edge-shad-button
                  color="primary"
                  class="bg-slate-400"
                  @click="runChatGpt"
                >
                  Submit
                </edge-shad-button>
              </CardFooter>
            </Card>
          </PopoverContent>
        </Popover>
        <span>
          {{ props.title }}
        </span>
      </template>
      <template #center>
        <div class="w-full px-2">
          <Alert v-if="props.error" variant="destructive" class="rounded-[6px] py-1">
            <TriangleAlert class="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {{ props.error }}
            </AlertDescription>
          </Alert>
        </div>
      </template>
      <template #end>
        <edge-tooltip>
          <edge-shad-button
            size="icon"
            class="bg-slate-400 w-8 h-8"
            @click.prevent.stop="formatCode"
          >
            <AlignHorizontalJustifyStart class="w-4 h-4" />
          </edge-shad-button>
          <template #content>
            Format Code
          </template>
        </edge-tooltip>
        <insert-menu v-if="props.siteVars && props.siteVars.length" :items="props.siteVars" var-prefix="siteVar" insert-type="vars" @value-sent="insertBlock">
          <Code class="w-4 h-4" /> Site Variables
        </insert-menu>
        <insert-menu v-if="props.globals && props.globals.length" :items="props.globals" var-prefix="globalVar" insert-type="vars" @value-sent="insertBlock">
          <Globe class="w-4 h-4" /> Globals
        </insert-menu>
      </template>
    </edge-menu>
    <CardContent class="px-0">
      <edge-shad-dialog
        v-model="state.diffDialog"
      >
        <DialogContent class="w-screen h-screen max-h-screen max-w-screen">
          <DialogHeader>
            <DialogTitle>
              Verify ChatGPT Changes
            </DialogTitle>
            <DialogDescription>
              <edge-shad-button
                variant="destructive"
                class="mr-2 h-6"
                @click="state.diffDialog = false"
              >
                Discard Changes
              </edge-shad-button>
              <edge-shad-button
                class="h-6 bg-slate-800"
                @click="getChanges"
              >
                Accept Changes
              </edge-shad-button>
            </DialogDescription>
          </DialogHeader>

          <vue-monaco-diff-editor
            v-if="state.diffDialog"
            ref="diffEditorRef"
            :theme="edgeGlobal.isDarkMode() ? 'vs-dark' : 'vs'"
            :original="localModelValue"
            :modified="state.gptHTML"
            :language="props.language"
            :options="{
              automaticLayout: true,
              formatOnType: true,
              formatOnPaste: true,
            }"
            style="height: calc(100vh - 120px)"
            @mount="handleMountDiff"
          />
        </DialogContent>
      </edge-shad-dialog>
      <vue-monaco-editor
        v-if="state.afterMount && state.diffDialog === false"
        ref="editorCompRef"
        v-model:value="localModelValue"
        :theme="edgeGlobal.isDarkMode() ? 'vs-dark' : 'vs'"
        :style="{ height: props.height }"
        :language="props.language"
        :options="{
          automaticLayout: true,
          formatOnType: true,
          formatOnPaste: true,
        }"
        @mount="handleMount"
      />
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>
/* Add this in your component's style section or in a global CSS file */
.codemirror-large-font {
  font-size: 15px !important; /* Adjust the font size as needed */
}
.inverted-logo {
    filter: invert(1);
  }
</style>
