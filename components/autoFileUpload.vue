<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  title: {
    type: String,
    default: 'Upload Files',
  },
  description: {
    type: String,
    default: 'Drag and drop files here or click to upload.',
  },
  modelValue: {
    type: [Array, Object],
    default: () => [],
  },
  accept: {
    type: String,
    default: '',
  },
  name: {
    type: String,
    default: '',
  },
  multiple: {
    type: Boolean,
    default: false,
  },
  dropDirectory: {
    type: Boolean,
    default: false,
  },
  files: {
    type: Boolean,
    default: false,
  },
  public: {
    type: Boolean,
    default: false,
  },
  r2: {
    type: Boolean,
    default: false,
  },
  filePath: {
    type: String,
    default: '',
  },
})

const emits = defineEmits(['update:modelValue'])

const edgeFirebase = inject('edgeFirebase')

const state = reactive({
  files: [],
  uploading: false,
  uploadProgress: 0,
  currentUploadFile: '',
  uploadErrors: [],
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const uploadFiles = async () => {
  const results = []
  if (state.files && state.files.length > 0) {
    state.uploadErrors = []
    state.uploadProgress = 0
    state.uploading = true
    try {
      let index = 0
      for (const file of state.files) {
        if (props.accept && !file.name.match(props.accept)) {
          state.currentUploadFile = `Skipped: ${file.name} (unsupported file type)`
          state.uploadErrors.push(`"${file.name}" is an unsupported file type. Please upload "${props.accept}" files only.`)
        }
        else {
          state.currentUploadFile = `Uploading: ${file.name}`
          const result = await edgeFirebase.uploadFile(edgeGlobal.edgeState.currentOrganization, file.file, props.filePath, props.public, props.r2)
          results.push(result)
          state.uploadProgress = ((index + 1) / state.files.length) * 100
          index++
        }
      }
      state.currentUploadFile = 'Upload complete!'
      state.files = []
      modelValue.value = results
    }
    catch (error) {
      state.uploadErrors.push(error)
    }
    state.uploading = false
  }
}

const uploadProgress = computed(() => {
  if (!state.uploading) {
    return 100
  }
  if (state.files.length === 1) {
    return edgeFirebase.state.currentUploadProgress
  }
  return state.uploadProgress
})

const dropFiles = computed(() => {
  return state.files
})

// Ensure modelValue is always an array
watch(dropFiles, (newValue) => {
  console.log(newValue)
  uploadFiles()
})
</script>

<template>
  <Card color="secondary" class="px-0 py-2 my-2 drop-active text-center z-10 top-0 cursor-pointer">
    <file-upload
      v-model="state.files"
      :accept="props.accept"
      :name="props.name"
      :multiple="props.multiple"
      :drop-directory="props.dropDirectory"
      :files="props.files"
      drop
      class="w-full cursor-pointer"
    >
      <Card-title class="pt-6">
        <slot name="title">
          Upload Files
        </slot>
      </Card-title>
      <CardContent style="width:100%;" class="pb-3">
        <slot name="description">
          Drag and drop files here or click to upload.
        </slot>
      </CardContent>
    </file-upload>
    <Progress
      v-if="state.uploading && uploadProgress > 0"
      v-model="uploadProgress"
      class="mx-auto w-1/2 mb-2"
    />
    <span v-if="state.uploading || state.uploadProgress > 0">{{ state.currentUploadFile }} </span>
    <template v-if="state.uploadErrors.length > 0">
      <Alert
        v-for="(error, index) in state.uploadErrors"
        :key="index"
        variant="destructive"
        class="my-2 mx-auto w-1/2 text-left"
      >
        <AlertCircle class="h-5 w-5" />
        <AlertTitle>File Not Uploaded</AlertTitle>
        <AlertDescription>
          {{ error }}
        </AlertDescription>
      </Alert>
    </template>
  </Card>
</template>

<style>
label[for="file"] {
  cursor: pointer;
}
</style>
