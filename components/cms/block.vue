<script setup>
import { useVModel } from '@vueuse/core'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue'])
const modelValue = useVModel(props, 'modelValue', emit)

const state = reactive({
  open: false,
  draft: {},
})

const openEditor = () => {
  state.draft = JSON.parse(JSON.stringify(modelValue.value?.values || {}))
  state.open = true
}

const save = () => {
  const updated = {
    ...modelValue.value,
    values: JSON.parse(JSON.stringify(state.draft)),
  }
  modelValue.value = updated
  state.open = false
}
</script>

<template>
  <div>
    <div
      class="cursor-pointer"
      @click="openEditor"
    >
      <edge-cms-block-render :content="modelValue?.blockTemplate" :values="modelValue?.values" />
    </div>

    <edge-shad-dialog v-model="state.open">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Block</DialogTitle>
        </DialogHeader>
        <DialogDescription />

        <div class="mt-4 space-y-4">
          <edge-shad-form>
            <template v-for="(meta, f) in modelValue.meta" :key="f">
              <div v-if="meta.type === 'array'">
                <edge-shad-tags v-model="state.draft[f]" :label="meta.title" :name="f" />
              </div>
              <div v-else-if="meta?.options">
                <!-- Treat text and image as plain strings; image expected to be URL -->
                <edge-shad-select
                  v-model="state.draft[f]"
                  :label="meta.title"
                  :name="f"
                  :items="meta.options || []"
                  item-title="title"
                  item-value="value"
                />
              </div>
              <div v-else>
                <edge-shad-input v-model="state.draft[f]" :name="f" :label="meta.title" />
              </div>
            </template>
          </edge-shad-form>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button type="button" class="px-3 py-2 border rounded" @click="state.open = false">
            Cancel
          </button>
          <button type="button" class="px-3 py-2 border rounded" @click="save">
            Save
          </button>
        </div>
      </DialogContent>
    </edge-shad-dialog>
  </div>
</template>
