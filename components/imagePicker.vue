<script setup>
import { useVModel } from '@vueuse/core'
import { ImagePlus, Trash2 } from 'lucide-vue-next'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: 'Photo',
  },
  dialogTitle: {
    type: String,
    default: 'Select Image',
  },
  site: {
    type: String,
    default: 'clearwater-hub-images',
  },
  defaultTags: {
    type: Array,
    default: () => [],
  },
  includeCmsAll: {
    type: Boolean,
    default: true,
  },
  heightClass: {
    type: String,
    default: 'h-[160px]',
  },
  showRemove: {
    type: Boolean,
    default: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const state = reactive({
  dialog: false,
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const openDialog = () => {
  if (props.disabled)
    return
  state.dialog = true
}

const closeDialog = () => {
  state.dialog = false
}

const selectImage = (url) => {
  modelValue.value = url || ''
  closeDialog()
}

const clearImage = () => {
  if (props.disabled)
    return
  modelValue.value = ''
}
</script>

<template>
  <div class="rounded-lg border bg-background p-4 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {{ props.label }}
      </div>
      <div class="flex items-center gap-2">
        <edge-shad-button size="sm" variant="outline" class="h-8 px-2" :disabled="props.disabled" @click="openDialog">
          <ImagePlus class="h-4 w-4 mr-2" />
          Select
        </edge-shad-button>
        <edge-shad-button
          v-if="props.showRemove && modelValue"
          size="icon"
          variant="ghost"
          class="h-8 w-8 text-destructive/80 hover:text-destructive"
          :disabled="props.disabled"
          @click="clearImage"
        >
          <Trash2 class="h-4 w-4" />
        </edge-shad-button>
      </div>
    </div>
    <div class="rounded-lg flex items-center justify-center overflow-hidden border bg-muted/20" :class="props.heightClass">
      <img
        v-if="modelValue"
        :src="modelValue"
        alt=""
        class="max-h-full max-w-full h-auto w-auto object-contain"
      >
      <span v-else class="text-sm text-muted-foreground italic">No photo selected</span>
    </div>
  </div>

  <Dialog v-model:open="state.dialog">
    <DialogContent class="w-full max-w-[1200px] max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ props.dialogTitle }}</DialogTitle>
        <DialogDescription />
      </DialogHeader>
      <edge-cms-media-manager
        :site="props.site"
        :default-tags="props.defaultTags"
        :include-cms-all="props.includeCmsAll"
        :select-mode="true"
        @select="selectImage"
      />
    </DialogContent>
  </Dialog>
</template>
